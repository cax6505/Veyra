import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Status =
  "INITIATED" | "PROCESSING" | "SUCCESS" | "FAILED" | "REFUNDED";
export type Source = "WALLET" | "BANK" | "CARD";
export type Request = {
  senderId: string;
  recipient: string;
  amount: number;
  note?: string;
  source: Source;
  transferId?: string;
};
export type Transfer = Request & {
  id: string;
  key: string;
  requestHash: string;
  status: Status;
  createdAt: Date;
};
export type Entry = {
  id: string;
  walletId: string;
  referenceId: string;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  createdAt: Date;
};
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus = 400,
  ) {
    super(message);
  }
}
export interface PaymentStrategy {
  source: Source;
  authorize(request: Request): Promise<void>;
}
export interface TransferRule {
  check(request: Request): Promise<void>;
  next(rule: TransferRule): TransferRule;
}
export interface Notifier {
  notify(user: string, message: string): Promise<void>;
}

abstract class Rule implements TransferRule {
  private following?: TransferRule;
  next(rule: TransferRule) {
    this.following = rule;
    return rule;
  }
  async check(request: Request) {
    await this.validate(request);
    if (this.following) await this.following.check(request);
  }
  protected abstract validate(request: Request): Promise<void>;
}
export class InputRule extends Rule {
  protected async validate(request: Request) {
    if (!request.recipient?.trim() || request.recipient.length > 160)
      throw new DomainError("INVALID_RECIPIENT", "Enter a valid recipient.");
    if (
      !Number.isSafeInteger(request.amount) ||
      request.amount < 1 ||
      request.amount > 100_000
    )
      throw new DomainError("INVALID_AMOUNT", "Amount must be ₹1–₹1,00,000.");
  }
}
export class FraudRule extends Rule {
  protected async validate(request: Request) {
    if (request.recipient.toLowerCase().includes("blocked"))
      throw new DomainError(
        "PAYMENT_REVIEW",
        "This recipient needs a manual review.",
        403,
      );
  }
}
export class DailyLimitRule extends Rule {
  constructor(private readonly total: (userId: string) => Promise<number>) {
    super();
  }
  protected async validate(request: Request) {
    if (
      (await this.total(request.senderId)) + request.amount * 100 >
      10_000_000
    )
      throw new DomainError(
        "DAILY_LIMIT_EXCEEDED",
        "Daily send limit exceeded.",
      );
  }
}
export class BalanceRule extends Rule {
  constructor(private readonly store: LocalStore) {
    super();
  }
  protected async validate(request: Request) {
    if (
      request.source === "WALLET" &&
      (await this.store.balance(request.senderId)) < request.amount * 100
    )
      throw new DomainError(
        "INSUFFICIENT_BALANCE",
        "Wallet balance is too low.",
      );
  }
}
export class State {
  private static readonly transitions: Record<Status, Status[]> = {
    INITIATED: ["PROCESSING", "FAILED"],
    PROCESSING: ["SUCCESS", "FAILED"],
    SUCCESS: [],
    FAILED: ["REFUNDED"],
    REFUNDED: [],
  };
  static move(current: Status, next: Status) {
    if (!this.transitions[current].includes(next))
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        `Cannot move ${current} to ${next}.`,
        409,
      );
    return next;
  }
}

export class LocalStore {
  readonly transfers = new Map<string, Transfer>();
  readonly balances = new Map<string, number>([["usr_charan", 4_829_050]]);
  readonly topups = new Map<string, { amount: number; credited: boolean }>();
  private readonly idempotency = new Map<string, string>();
  private ledger: Entry[] = [];
  private readonly locks = new Map<string, Promise<void>>();
  private readonly file =
    process.env.VEYRA_STATE_FILE ||
    resolve(dirname(fileURLToPath(import.meta.url)), "../data/state.json");

  constructor() {
    this.load();
  }
  get entries() {
    return Object.freeze([...this.ledger]);
  }
  async lock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) || Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    const tail = previous.then(() => next);
    this.locks.set(id, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(id) === tail) this.locks.delete(id);
    }
  }
  async balance(id: string) {
    return this.balances.get(id) || 0;
  }
  async find(key: string) {
    const id = this.idempotency.get(key);
    return id ? this.transfers.get(id) : undefined;
  }
  async save(transfer: Transfer) {
    this.transfers.set(transfer.id, transfer);
    this.idempotency.set(transfer.key, transfer.id);
    this.persist();
  }
  async updateStatus(id: string, next: Status) {
    const transfer = this.transfers.get(id);
    if (!transfer)
      throw new DomainError("NOT_FOUND", "Transfer not found.", 404);
    transfer.status = State.move(transfer.status, next);
    this.persist();
  }
  hasLedgerEntry(referenceId: string, direction: Entry["direction"]) {
    return this.ledger.some(
      (entry) =>
        entry.referenceId === referenceId && entry.direction === direction,
    );
  }
  async recordDebit(walletId: string, amountMinor: number, transferId: string) {
    const current = await this.balance(walletId);
    if (current < amountMinor)
      throw new DomainError(
        "INSUFFICIENT_BALANCE",
        "Wallet balance is too low.",
      );
    this.balances.set(walletId, current - amountMinor);
    this.ledger.push(
      Object.freeze({
        id: `le_${randomUUID()}`,
        walletId,
        referenceId: transferId,
        amountMinor,
        direction: "DEBIT",
        createdAt: new Date(),
      }),
    );
    this.persist();
  }
  async append(entry: Entry) {
    this.ledger.push(Object.freeze(entry));
    this.persist();
  }
  async daily(userId: string) {
    const today = new Date().toDateString();
    return [...this.transfers.values()]
      .filter(
        (transfer) =>
          transfer.senderId === userId &&
          transfer.createdAt.toDateString() === today &&
          ["PROCESSING", "SUCCESS"].includes(transfer.status),
      )
      .reduce((sum, transfer) => sum + transfer.amount * 100, 0);
  }
  async register(orderId: string, amount: number) {
    this.topups.set(orderId, { amount, credited: false });
    this.persist();
  }
  async settle(orderId: string, paymentId: string) {
    return this.lock("usr_charan", async () => {
      const topup = this.topups.get(orderId);
      if (!topup)
        throw new DomainError(
          "TOPUP_NOT_FOUND",
          "Top-up order not found.",
          404,
        );
      if (!topup.credited) {
        this.balances.set(
          "usr_charan",
          (await this.balance("usr_charan")) + topup.amount,
        );
        this.ledger.push(
          Object.freeze({
            id: `le_${randomUUID()}`,
            walletId: "usr_charan",
            referenceId: orderId,
            amountMinor: topup.amount,
            direction: "CREDIT",
            createdAt: new Date(),
          }),
        );
        topup.credited = true;
        this.persist();
      }
      return { balanceMinor: await this.balance("usr_charan"), paymentId };
    });
  }
  private load() {
    try {
      const saved = JSON.parse(readFileSync(this.file, "utf8")) as {
        transfers: Array<Omit<Transfer, "createdAt"> & { createdAt: string }>;
        balances: [string, number][];
        topups: [string, { amount: number; credited: boolean }][];
        ledger: Array<Omit<Entry, "createdAt"> & { createdAt: string }>;
      };
      this.transfers.clear();
      this.idempotency.clear();
      for (const item of saved.transfers || []) {
        const transfer = { ...item, createdAt: new Date(item.createdAt) };
        this.transfers.set(transfer.id, transfer);
        this.idempotency.set(transfer.key, transfer.id);
      }
      this.balances.clear();
      for (const [id, amount] of saved.balances || [])
        this.balances.set(id, amount);
      this.topups.clear();
      for (const [id, value] of saved.topups || []) this.topups.set(id, value);
      this.ledger = (saved.ledger || []).map((entry) =>
        Object.freeze({ ...entry, createdAt: new Date(entry.createdAt) }),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  private persist() {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    const snapshot = {
      transfers: [...this.transfers.values()],
      balances: [...this.balances],
      topups: [...this.topups],
      ledger: this.ledger,
    };
    writeFileSync(temp, JSON.stringify(snapshot), { mode: 0o600 });
    renameSync(temp, this.file);
  }
}

export class WalletPayment implements PaymentStrategy {
  readonly source = "WALLET" as const;
  constructor(private readonly store: LocalStore) {}
  async authorize(request: Request) {
    if (!request.transferId)
      throw new DomainError(
        "TRANSFER_CONTEXT_REQUIRED",
        "Transfer context is missing.",
        500,
      );
    await this.store.recordDebit(
      request.senderId,
      request.amount * 100,
      request.transferId,
    );
  }
}
export class ExternalPayment implements PaymentStrategy {
  constructor(public source: "BANK" | "CARD") {}
  async authorize() {
    throw new DomainError(
      "PAYMENT_RAIL_UNAVAILABLE",
      `${this.source} payout is not connected in this demo. Choose Veyra balance.`,
      422,
    );
  }
}
export class PaymentFactory {
  constructor(private readonly strategies: PaymentStrategy[]) {}
  for(source: Source) {
    const strategy = this.strategies.find((item) => item.source === source);
    if (!strategy)
      throw new DomainError(
        "UNSUPPORTED_SOURCE",
        "Unsupported payment source.",
        422,
      );
    return strategy;
  }
}
export class NotificationBus implements Notifier {
  constructor(private readonly observers: Notifier[]) {}
  attach(observer: Notifier) {
    this.observers.push(observer);
  }
  async notify(user: string, message: string) {
    await Promise.all(
      this.observers.map((observer) => observer.notify(user, message)),
    );
  }
}
export class ConsoleNotifier implements Notifier {
  async notify(user: string, message: string) {
    console.info(`[notify:${user}] ${message}`);
  }
}
export class LoggingDecorator implements PaymentStrategy {
  readonly source: Source;
  constructor(private readonly wrapped: PaymentStrategy) {
    this.source = wrapped.source;
  }
  async authorize(request: Request) {
    const started = Date.now();
    try {
      await this.wrapped.authorize(request);
    } finally {
      console.info(`payment ${this.source}: ${Date.now() - started}ms`);
    }
  }
}
export class RazorpayOrderBuilder {
  private data = {
    amount: 0,
    currency: "INR",
    receipt: "",
    notes: { walletId: "" },
  };
  amount(value: number) {
    this.data.amount = value;
    return this;
  }
  receipt(value: string) {
    this.data.receipt = value;
    return this;
  }
  wallet(value: string) {
    this.data.notes.walletId = value;
    return this;
  }
  build() {
    if (!this.data.amount || !this.data.receipt || !this.data.notes.walletId)
      throw new DomainError("INVALID_ORDER", "Order details incomplete.");
    return this.data;
  }
}
export class TransferService {
  private readonly rules: TransferRule;
  constructor(
    private readonly store: LocalStore,
    private readonly factory: PaymentFactory,
    private readonly notifier: Notifier,
  ) {
    const input = new InputRule();
    input
      .next(new FraudRule())
      .next(new DailyLimitRule((id) => store.daily(id)))
      .next(new BalanceRule(store));
    this.rules = input;
  }
  async send(request: Request, key: string) {
    if (!key || key.length > 128)
      throw new DomainError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "Provide an Idempotency-Key.",
      );
    return this.store.lock(request.senderId, async () => {
      const scopedKey = `${request.senderId}:${key}`,
        requestHash = createHash("sha256")
          .update(JSON.stringify(request))
          .digest("hex");
      const existing = await this.store.find(scopedKey);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new DomainError(
            "IDEMPOTENCY_KEY_REUSED",
            "Use a new key when transfer details change.",
            409,
          );
        if (
          existing.status === "PROCESSING" &&
          this.store.hasLedgerEntry(existing.id, "DEBIT")
        ) {
          await this.store.updateStatus(existing.id, "SUCCESS");
        } else if (
          existing.status === "INITIATED" ||
          (existing.status === "PROCESSING" && request.source === "WALLET")
        )
          return this.complete(request, existing);
        return existing;
      }
      await this.rules.check(request);
      const transfer: Transfer = {
        ...request,
        id: `tr_${randomUUID()}`,
        key: scopedKey,
        requestHash,
        status: "INITIATED",
        createdAt: new Date(),
      };
      await this.store.save(transfer);
      return this.complete(request, transfer);
    });
  }
  private async complete(request: Request, transfer: Transfer) {
    try {
      if (transfer.status === "INITIATED")
        await this.store.updateStatus(transfer.id, "PROCESSING");
      await this.factory
        .for(request.source)
        .authorize({ ...request, transferId: transfer.id });
      await this.store.updateStatus(transfer.id, "SUCCESS");
      await this.notifier.notify(
        request.senderId,
        `Transfer ${transfer.id} succeeded.`,
      );
      return transfer;
    } catch (error) {
      if (transfer.status === "PROCESSING")
        await this.store.updateStatus(transfer.id, "FAILED");
      throw error;
    }
  }
}
export function validSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  secret: string,
) {
  const expected = createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  const actual = Buffer.from(signature),
    expectedBuffer = Buffer.from(expected);
  return (
    actual.length === expectedBuffer.length &&
    timingSafeEqual(actual, expectedBuffer)
  );
}
