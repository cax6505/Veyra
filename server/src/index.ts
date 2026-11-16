import "dotenv/config";
import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import Razorpay from "razorpay";
import {
  DomainError,
  RazorpayOrderBuilder,
  validSignature,
  type Source,
} from "./domain.js";
import { store, transfers } from "./container.js";

const app = express();
app.use(cors({ origin: process.env.WEB_ORIGIN || "http://localhost:5174" }));
app.use(express.json({ limit: "32kb" }));
app.get("/api/health", (_req, res) =>
  res.json({ status: "ok", service: "veyra-api" }),
);
app.get("/api/wallet", async (_req, res) =>
  res.json({
    walletId: "usr_charan",
    currency: "INR",
    balanceMinor: await store.balance("usr_charan"),
    dailySpentMinor: await store.daily("usr_charan"),
    dailyLimitMinor: 10_000_000,
  }),
);
app.get("/api/transfers", (_req, res) =>
  res.json(
    [...store.transfers.values()].map((t) => ({
      transferId: t.id,
      recipient: t.recipient,
      amount: t.amount,
      note: t.note,
      source: t.source,
      status: t.status,
      createdAt: t.createdAt,
      idempotencyKey: t.key,
    })),
  ),
);
app.get("/api/ledger", (_req, res) => res.json(store.entries));
app.post("/api/transfers", async (req, res, next) => {
  try {
    const { recipient, amount, note, paymentMethod } = req.body ?? {};
    const source: Source = paymentMethod?.startsWith("HDFC")
      ? "BANK"
      : paymentMethod?.startsWith("Visa")
        ? "CARD"
        : "WALLET";
    const transfer = await transfers.send(
      {
        senderId: "usr_charan",
        recipient,
        amount: Number(amount),
        note,
        source,
      },
      req.header("Idempotency-Key") || "",
    );
    res.json({
      transferId: transfer.id,
      status: transfer.status[0] + transfer.status.slice(1).toLowerCase(),
      amount: transfer.amount,
    });
  } catch (error) {
    next(error);
  }
});

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;
const razorpay =
  keyId && keySecret
    ? new Razorpay({ key_id: keyId, key_secret: keySecret })
    : null;
app.post("/api/razorpay/orders", async (req, res, next) => {
  try {
    if (!razorpay)
      throw new DomainError(
        "RAZORPAY_NOT_CONFIGURED",
        "Configure Razorpay test keys in server/.env.",
        503,
      );
    const amount = Number(req.body?.amount);
    if (!Number.isSafeInteger(amount) || amount < 100 || amount > 100_000)
      throw new DomainError(
        "INVALID_AMOUNT",
        "Top-ups must be ₹100–₹1,00,000.",
      );
    const orderRequest = new RazorpayOrderBuilder()
      .amount(amount * 100)
      .receipt(`topup_${randomUUID().slice(0, 20)}`)
      .wallet("usr_charan")
      .build();
    const order = await razorpay.orders.create(orderRequest);
    await store.register(order.id, Number(order.amount));
    res.status(201).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,
    });
  } catch (error) {
    next(error);
  }
});
app.post("/api/razorpay/verify", async (req, res, next) => {
  try {
    if (!razorpay || !keySecret)
      throw new DomainError(
        "RAZORPAY_NOT_CONFIGURED",
        "Configure Razorpay test keys.",
        503,
      );
    const { orderId, paymentId, signature } = req.body ?? {};
    if (
      ![orderId, paymentId, signature].every(
        (value) => typeof value === "string" && value.length > 0,
      )
    ) {
      throw new DomainError(
        "INVALID_PAYMENT_PROOF",
        "Payment verification details are incomplete.",
      );
    }
    if (!validSignature(orderId, paymentId, signature, keySecret))
      throw new DomainError(
        "INVALID_PAYMENT_SIGNATURE",
        "Payment signature could not be verified.",
      );
    const payment = await razorpay.payments.fetch(paymentId);
    const order = store.topups.get(orderId);
    if (
      payment.order_id !== orderId ||
      payment.status !== "captured" ||
      payment.currency !== "INR" ||
      !order ||
      order.amount !== payment.amount
    ) {
      throw new DomainError(
        "PAYMENT_NOT_CAPTURED",
        "Captured payment details do not match this order.",
        409,
      );
    }
    res.json({ verified: true, ...(await store.settle(orderId, paymentId)) });
  } catch (error) {
    next(error);
  }
});
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof DomainError)
      return res
        .status(error.httpStatus)
        .json({ error: { code: error.code, message: error.message } });
    console.error(error);
    return res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Request could not be completed.",
      },
    });
  },
);
app.listen(Number(process.env.PORT || 4000), () =>
  console.info("Veyra API listening on :4000"),
);
