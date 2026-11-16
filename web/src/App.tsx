import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  CreditCard,
  Filter,
  Landmark,
  LockKeyhole,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
type Status = "Success" | "Processing" | "Failed" | "Refunded";
type Tx = {
  id: string;
  name: string;
  handle: string;
  note: string;
  time: string;
  amount: number;
  status: Status;
  initials: string;
  kind: string;
  method: string;
};
type LedgerRow = {
  id: string;
  walletId: string;
  referenceId: string;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  createdAt: string;
};
const seed: Tx[] = [
  {
    id: "VYR-9K2A7D",
    name: "Mira Kapoor",
    handle: "mira.k@okaxis",
    note: "Dinner at O Pedro",
    time: "10:42 AM",
    amount: -1840,
    status: "Success",
    initials: "MK",
    kind: "plum",
    method: "Veyra balance",
  },
  {
    id: "VYR-8J1B4E",
    name: "Aarav Mehta",
    handle: "aarav.mehta@okhdfcbank",
    note: "Weekend trip",
    time: "9:18 AM",
    amount: -5200,
    status: "Processing",
    initials: "AM",
    kind: "sky",
    method: "HDFC Bank ·· 4821",
  },
  {
    id: "VYR-7G0C3F",
    name: "Nina Shah",
    handle: "nina.shah@oksbi",
    note: "Shared cab",
    time: "Yesterday, 8:36 PM",
    amount: 620,
    status: "Success",
    initials: "NS",
    kind: "rose",
    method: "Veyra balance",
  },
  {
    id: "VYR-6F9D2G",
    name: "The Daily Cut",
    handle: "dailystudio@okicici",
    note: "Haircut",
    time: "Yesterday, 5:12 PM",
    amount: -950,
    status: "Success",
    initials: "DC",
    kind: "gold",
    method: "HDFC Bank ·· 4821",
  },
  {
    id: "VYR-5E8E1H",
    name: "Ishaan Rao",
    handle: "ishaan.rao@okaxis",
    note: "Books",
    time: "15 Nov, 1:05 PM",
    amount: -1480,
    status: "Refunded",
    initials: "IR",
    kind: "mint",
    method: "Veyra balance",
  },
];
const cash = (n: number) => `₹${Math.abs(n).toLocaleString("en-IN")}`;
function fromApiTransfer(t: {
  transferId: string;
  recipient: string;
  amount: number;
  note?: string;
  source: string;
  status: string;
  createdAt: string;
  idempotencyKey?: string;
}): Tx {
  const name = t.recipient.split("@")[0].replace(/[._]/g, " "),
    status = t.status[0] + t.status.slice(1).toLowerCase();
  return {
    id: t.transferId,
    name: name.replace(/\b\w/g, (c) => c.toUpperCase()),
    handle: t.recipient,
    note: t.note || "Sent with Veyra",
    time: new Date(t.createdAt).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }),
    amount: -t.amount,
    status: status as Status,
    initials: name
      .split(" ")
      .map((v) => v[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
    kind: "sky",
    method:
      t.source === "BANK"
        ? "HDFC Bank ·· 4821"
        : t.source === "CARD"
          ? "Visa ·· 0906"
          : "Veyra balance",
  };
}
export default function App() {
  const [txs, setTxs] = useState(seed),
    [ledger, setLedger] = useState<LedgerRow[]>([]),
    [page, setPage] = useState("Overview"),
    [send, setSend] = useState(false),
    [topup, setTopup] = useState(false),
    [detail, setDetail] = useState<Tx | null>(null),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("All activity"),
    [toast, setToast] = useState(""),
    [balance, setBalance] = useState(4829050),
    [dailySpent, setDailySpent] = useState(0),
    [dailyLimit, setDailyLimit] = useState(10_000_000),
    [balanceVisible, setBalanceVisible] = useState(true),
    [recipientPrefill, setRecipientPrefill] = useState(""),
    [apiStatus, setApiStatus] = useState("Checking connection");
  const say = (s: string) => {
    setToast(s);
    setTimeout(() => setToast(""), 3500);
  };
  const filtered = useMemo(
    () =>
      txs.filter(
        (t) =>
          `${t.name} ${t.handle} ${t.note}`
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (status === "All activity" || t.status === status),
      ),
    [txs, query, status],
  );
  useEffect(() => {
    let alive = true;
    const refreshDashboard = async () => {
      try {
        const [health, wallet, history, entries] = await Promise.all([
          fetch("/api/health"),
          fetch("/api/wallet"),
          fetch("/api/transfers"),
          fetch("/api/ledger"),
        ]);
        if (!health.ok || !wallet.ok || !history.ok || !entries.ok)
          throw Error("API unavailable");
        const [account, records, ledgerRows] = await Promise.all([
          wallet.json(),
          history.json(),
          entries.json(),
        ]);
        if (alive) {
          setBalance(account.balanceMinor);
          setDailySpent(account.dailySpentMinor);
          setDailyLimit(account.dailyLimitMinor);
          setLedger(ledgerRows);
          const live = (records as Parameters<typeof fromApiTransfer>[0][]).map(
            fromApiTransfer,
          );
          setTxs((current) => [
            ...live,
            ...current.filter((item) => !live.some((tx) => tx.id === item.id)),
          ]);
          setApiStatus("Connected to demo API");
        }
      } catch {
        if (alive) setApiStatus("API offline");
      }
    };
    void refreshDashboard();
    const timer = window.setInterval(() => void refreshDashboard(), 15_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  async function sendMoney(
    recipient: string,
    amount: number,
    note: string,
    method: string,
    key: string,
  ): Promise<{ error?: string; retry?: boolean }> {
    if (!recipient.trim() || !Number.isSafeInteger(amount) || amount < 1)
      return {
        error: "Add a recipient and a whole-number amount greater than ₹0.",
      };
    if (amount > 25000)
      return { error: "The demo per-transfer limit is ₹25,000." };
    const name = recipient.split("@")[0].replace(/[._]/g, " "),
      item: Tx = {
        id: key,
        name: name.replace(/\b\w/g, (c) => c.toUpperCase()),
        handle: recipient.includes("@")
          ? recipient
          : `${name.replace(/\s/g, ".").toLowerCase()}@okaxis`,
        note: note || "Sent with Veyra",
        time: "Just now",
        amount: -amount,
        status: "Processing",
        initials: name
          .split(" ")
          .map((v) => v[0])
          .join("")
          .slice(0, 2)
          .toUpperCase(),
        kind: "sky",
        method,
      };
    setTxs((current) =>
      current.some((tx) => tx.id === key) ? current : [item, ...current],
    );
    try {
      const response = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({
          recipient,
          amount,
          note,
          paymentMethod: method,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        const message =
          body.error?.message || "Transfer could not be completed.";
        if (response.status >= 500)
          return {
            error: `${message} Retry with the same details to safely check the result.`,
            retry: true,
          };
        setTxs((current) =>
          current.map((tx) =>
            tx.id === key ? { ...tx, status: "Failed" } : tx,
          ),
        );
        return { error: message };
      }
      const resultStatus = (body.status || "Success") as Status;
      setTxs((current) =>
        current.map((tx) =>
          tx.id === key
            ? { ...tx, id: body.transferId || key, status: resultStatus }
            : tx,
        ),
      );
      if (resultStatus === "Processing")
        return {
          error:
            "The payment rail has not confirmed yet. Retry with the same details to check again.",
          retry: true,
        };
      if (resultStatus !== "Success")
        return {
          error:
            "This transfer did not complete. Change the details or payment source to start a new attempt.",
        };
      setSend(false);
      say("Transfer completed successfully.");
      try {
        const [wallet, entries] = await Promise.all([
          fetch("/api/wallet"),
          fetch("/api/ledger"),
        ]);
        if (wallet.ok) {
          const account = await wallet.json();
          setBalance(account.balanceMinor);
          setDailySpent(account.dailySpentMinor);
        }
        if (entries.ok) setLedger(await entries.json());
      } catch {
        setApiStatus("Balance refresh needed");
      }
      return {};
    } catch {
      say(
        "No confirmation received. Retry this same transfer to safely check its result.",
      );
      return {
        error:
          "Connection lost before confirmation. Retry with the same details; the same idempotency key will be reused.",
        retry: true,
      };
    }
  }
  const navItems = [
    { name: "Overview", Icon: Wallet },
    { name: "Activity", Icon: ArrowDownLeft },
    { name: "People", Icon: Send },
  ];
  return (
    <div className="layout">
      <aside className="sidebar">
        <a className="logo" onClick={() => setPage("Overview")}>
          <i>v</i>veyra
        </a>
        <div className="account">
          <span className="account-icon">C</span>
          <span>
            <b>Charan’s wallet</b>
            <small>Personal account</small>
          </span>
          <ChevronDown size={15} />
        </div>
        <label>Your money</label>
        {navItems.map(({ name, Icon }) => (
          <button
            key={name}
            className={`nav ${page === name ? "selected" : ""}`}
            onClick={() => setPage(name)}
          >
            <Icon size={17} />
            {name}
            {name === "Activity" && (
              <small className="count">{txs.length}</small>
            )}
          </button>
        ))}
        <label className="manage">Manage</label>
        <button
          className="nav"
          onClick={() =>
            say("Linking bank accounts requires an approved provider.")
          }
        >
          <CreditCard size={17} />
          Payment methods
        </button>
        <button className="nav" onClick={() => setPage("Ledger")}>
          <BookOpen size={17} />
          Ledger
        </button>
        <button
          className="nav"
          onClick={() => {
            const csv = [
              "Transfer ID,Recipient,Amount,Status",
              ...txs.map((t) => `${t.id},${t.name},${t.amount},${t.status}`),
            ].join("\n");
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
            a.download = "veyra-statement.csv";
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          <ArrowDownLeft size={17} />
          Statements
        </button>
        <div className="bottom">
          <div className="protect">
            <ShieldCheck size={18} />
            <span>
              <b>Demo mode</b>
              <small>Sample data only. No real funds move.</small>
            </span>
          </div>
          <div className="profile">
            <span>CK</span>
            <b>
              Charan K.<small>charan.k@email.com</small>
            </b>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div className="crumb">
            <button
              className="hamb"
              onClick={() =>
                document.querySelector(".sidebar")?.classList.toggle("show")
              }
            >
              ☰
            </button>
            Personal <i>/</i> <b>{page}</b>
          </div>
          <div className="head-right">
            <span className="normal">
              <i
                className={
                  apiStatus === "Connected to demo API" ? "online" : "offline"
                }
              />
              {apiStatus}
            </span>
            <button
              className="bell"
              onClick={() => say("You’re all caught up.")}
            >
              <Bell size={17} />
              <i />
            </button>
            <span className="avatar">CK</span>
          </div>
        </header>
        <div className="content">
          <div className="welcome">
            <div>
              <small className="date">DEMO WALLET · INR</small>
              <h1>
                {page === "Overview" ? "Good morning, Charan" : page}
                <em>✳</em>
              </h1>
              <p>Here’s what’s happening with your money.</p>
            </div>
            <button
              className="primary"
              onClick={() => {
                setRecipientPrefill("");
                setSend(true);
              }}
            >
              <Send size={15} />
              Send money
            </button>
          </div>
          {page === "Ledger" ? (
            <LedgerView entries={ledger} />
          ) : page === "People" ? (
            <section className="panel people">
              <h2>People you pay</h2>
              <p>Your recent UPI contacts.</p>
              {seed.slice(0, 4).map((t) => (
                <button
                  className="person"
                  onClick={() => {
                    setRecipientPrefill(t.handle);
                    setSend(true);
                  }}
                  key={t.id}
                >
                  <span className={`face ${t.kind}`}>{t.initials}</span>
                  <b>
                    {t.name}
                    <small>{t.handle}</small>
                  </b>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </section>
          ) : (
            <>
              <section className="stats">
                <article className="balance-card">
                  <div className="bal-top">
                    <small>AVAILABLE BALANCE</small>
                    <button
                      onClick={() => setBalanceVisible((value) => !value)}
                    >
                      {balanceVisible ? "Hide" : "Show"}
                    </button>
                  </div>
                  <strong>
                    {balanceVisible ? (
                      <>
                        ₹{Math.floor(balance / 100).toLocaleString("en-IN")}
                        <small>.{String(balance % 100).padStart(2, "0")}</small>
                      </>
                    ) : (
                      "₹••,•••.••"
                    )}
                  </strong>
                  <div className="bal-bottom">
                    <span>↗ Sample balance</span>
                    <button onClick={() => setTopup(true)}>
                      <Plus size={13} /> Add money
                    </button>
                  </div>
                  <b className="watermark">v</b>
                </article>
                <article className="stat">
                  <div>
                    Sent this month{" "}
                    <span className="stat-icon blue">
                      <ArrowUpRight size={17} />
                    </span>
                  </div>
                  <strong>₹18,420</strong>
                  <small>
                    <b>Sample activity</b>
                  </small>
                  <div className="bars">
                    {[
                      32, 56, 41, 70, 50, 83, 61, 96, 56, 76, 92, 72, 100, 78,
                      64, 88, 55, 81, 66, 94,
                    ].map((h, i) => (
                      <i key={i} style={{ height: `${h}%` }} />
                    ))}
                  </div>
                </article>
                <article className="stat">
                  <div>
                    Received this month{" "}
                    <span className="stat-icon green">
                      <ArrowDownLeft size={17} />
                    </span>
                  </div>
                  <strong>₹26,800</strong>
                  <small>
                    <b>Sample activity</b>
                  </small>
                  <div className="received">
                    <span>NS</span> From <b>Nina and 8 others</b>
                  </div>
                </article>
              </section>
              <section className="columns">
                <article className="panel activity">
                  <div className="section-head">
                    <div>
                      <h2>
                        {page === "Activity"
                          ? "All activity"
                          : "Recent activity"}
                      </h2>
                      <p>Your transfers, all in one place.</p>
                    </div>
                    <button
                      onClick={() =>
                        setPage(page === "Activity" ? "Overview" : "Activity")
                      }
                    >
                      {page === "Activity" ? "Back to overview" : "View all"}{" "}
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  {page === "Activity" && (
                    <div className="tools">
                      <span>
                        <Search size={15} />
                        <input
                          placeholder="Search people or notes"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </span>
                      <span>
                        <Filter size={14} />
                        <select
                          value={status}
                          onChange={(e) => setStatus(e.target.value)}
                        >
                          {[
                            "All activity",
                            "Success",
                            "Processing",
                            "Failed",
                            "Refunded",
                          ].map((x) => (
                            <option key={x}>{x}</option>
                          ))}
                        </select>
                      </span>
                    </div>
                  )}
                  <div>
                    {filtered
                      .slice(0, page === "Activity" ? 50 : 5)
                      .map((t) => (
                        <button
                          className="tx"
                          key={t.id}
                          onClick={() => setDetail(t)}
                        >
                          <span className={`face ${t.kind}`}>{t.initials}</span>
                          <span className="tx-copy">
                            <b>{t.name}</b>
                            <small>
                              {t.note} <i>·</i> {t.time}
                            </small>
                          </span>
                          <span className="tx-value">
                            <b className={t.amount > 0 ? "positive" : ""}>
                              {t.amount > 0 ? "+" : "−"}
                              {cash(t.amount)}
                            </b>
                            <small
                              className={`state ${t.status.toLowerCase()}`}
                            >
                              <i />
                              {t.status}
                            </small>
                          </span>
                          <ChevronDown className="row-arrow" size={14} />
                        </button>
                      ))}
                  </div>
                  {page === "Overview" && (
                    <button className="all" onClick={() => setPage("Activity")}>
                      See all activity <ArrowRight size={14} />
                    </button>
                  )}
                </article>
                <aside className="rail">
                  <article className="panel methods">
                    <div className="section-head">
                      <div>
                        <h2>Payment methods</h2>
                        <p>Choose how you pay.</p>
                      </div>
                      <button
                        className="add"
                        onClick={() =>
                          say("Link a bank account from your profile settings.")
                        }
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                    <button
                      className="method"
                      onClick={() =>
                        say("Veyra wallet is your default payment method.")
                      }
                    >
                      <span className="method-icon wallet">
                        <Wallet size={16} />
                      </span>
                      <b>
                        Veyra wallet<small>Available balance</small>
                      </b>
                      <strong>
                        {balanceVisible
                          ? `₹${Math.floor(balance / 100).toLocaleString("en-IN")}`
                          : "₹••,•••"}
                      </strong>
                    </button>
                    <button
                      className="method"
                      onClick={() =>
                        say("Bank payout rail is not connected in this demo.")
                      }
                    >
                      <span className="method-icon bank">
                        <Landmark size={16} />
                      </span>
                      <b>
                        HDFC Bank
                        <small>
                          •••• 4821 <i>Demo only</i>
                        </small>
                      </b>
                      <span className="radio">
                        <Check size={11} />
                      </span>
                    </button>
                    <button
                      className="method"
                      onClick={() =>
                        say("Card payout rail is not connected in this demo.")
                      }
                    >
                      <span className="method-icon card">
                        <CreditCard size={16} />
                      </span>
                      <b>
                        Visa ·· 0906<small>Demo only · Expires 08/28</small>
                      </b>
                      <strong className="visa">VISA</strong>
                    </button>
                    <button
                      className="add-method"
                      onClick={() =>
                        say("Link a new bank or card from payment methods.")
                      }
                    >
                      <Plus size={13} /> Add a payment method
                    </button>
                  </article>
                  <article className="panel limit">
                    <div className="limit-head">
                      <b>
                        Daily send limit<small>Resets in 7h 24m</small>
                      </b>
                      <Clock3 size={16} />
                    </div>
                    <strong>
                      ₹{Math.floor(dailySpent / 100).toLocaleString("en-IN")}{" "}
                      <small>
                        of ₹
                        {Math.floor(dailyLimit / 100).toLocaleString("en-IN")}
                      </small>
                    </strong>
                    <div className="progress">
                      <i
                        style={{
                          width: `${Math.min(100, dailyLimit ? (dailySpent / dailyLimit) * 100 : 0)}%`,
                        }}
                      />
                    </div>
                    <div className="limit-foot">
                      <span>
                        {Math.round(
                          dailyLimit ? (dailySpent / dailyLimit) * 100 : 0,
                        )}
                        % used
                      </span>
                      <span>
                        ₹
                        {Math.max(
                          0,
                          Math.floor((dailyLimit - dailySpent) / 100),
                        ).toLocaleString("en-IN")}{" "}
                        left
                      </span>
                    </div>
                  </article>
                  <div className="trust">
                    <LockKeyhole size={14} />
                    Demo only · No real money moves{" "}
                    <button
                      onClick={() =>
                        say(
                          "Razorpay test checkout is used for top-ups when configured.",
                        )
                      }
                    >
                      <CircleHelp size={13} />
                    </button>
                  </div>
                </aside>
              </section>
            </>
          )}
          <footer>
            Veyra demo · sample activity · Razorpay test mode for top-ups
          </footer>
        </div>
      </main>
      {send && (
        <SendModal
          close={() => setSend(false)}
          onSend={sendMoney}
          initialRecipient={recipientPrefill}
        />
      )}
      {topup && (
        <TopupModal
          close={() => setTopup(false)}
          done={(b) => {
            setBalance(b);
            setTopup(false);
            say("Money added to your Veyra wallet.");
            void fetch("/api/ledger")
              .then((r) => (r.ok ? r.json() : []))
              .then(setLedger)
              .catch(() => {});
          }}
        />
      )}
      {detail && <Detail tx={detail} close={() => setDetail(null)} />}
      {toast && (
        <div className="toast">
          <i>
            <Check size={13} />
          </i>
          {toast}
          <button onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
function LedgerView({ entries }: { entries: LedgerRow[] }) {
  return (
    <section className="panel ledger-panel">
      <div className="section-head">
        <div>
          <h2>Wallet ledger</h2>
          <p>Append-only record of confirmed wallet movements.</p>
        </div>
        <span className="ledger-count">{entries.length} entries</span>
      </div>
      {entries.length ? (
        entries
          .slice()
          .reverse()
          .map((entry) => (
            <div className="ledger-row" key={entry.id}>
              <span
                className={`ledger-symbol ${entry.direction.toLowerCase()}`}
              >
                {entry.direction === "CREDIT" ? (
                  <ArrowDownLeft size={17} />
                ) : (
                  <ArrowUpRight size={17} />
                )}
              </span>
              <span className="ledger-copy">
                <b>
                  {entry.direction === "CREDIT"
                    ? "Money added"
                    : "Transfer sent"}
                </b>
                <small>
                  Ref {entry.referenceId} ·{" "}
                  {new Date(entry.createdAt).toLocaleString("en-IN")}
                </small>
              </span>
              <strong
                className={entry.direction === "CREDIT" ? "positive" : ""}
              >
                {entry.direction === "CREDIT" ? "+" : "−"}₹
                {(entry.amountMinor / 100).toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </strong>
            </div>
          ))
      ) : (
        <div className="ledger-empty">
          <BookOpen size={23} />
          <b>No ledger entries yet</b>
          <span>
            Confirmed wallet transfers and verified top-ups will appear here.
          </span>
        </div>
      )}
      <p className="ledger-footnote">
        Ledger entries are immutable in the domain model. The local demo
        persists these entries on disk; use a database transaction for
        multi-instance deployment.
      </p>
    </section>
  );
}

function SendModal({
  close,
  onSend,
  initialRecipient,
}: {
  close: () => void;
  initialRecipient: string;
  onSend: (
    r: string,
    a: number,
    n: string,
    m: string,
    key: string,
  ) => Promise<{ error?: string; retry?: boolean }>;
}) {
  const freshKey = () => `VYR-${crypto.randomUUID()}`;
  const [recipient, setRecipient] = useState(initialRecipient),
    [amount, setAmount] = useState(""),
    [note, setNote] = useState(""),
    [method, setMethod] = useState("Veyra balance"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retryNeeded, setRetryNeeded] = useState(false),
    [key, setKey] = useState(freshKey);
  const update = (fn: () => void) => {
    fn();
    if (!retryNeeded) setKey(freshKey());
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const result = await onSend(recipient, Number(amount), note, method, key);
    setError(result.error || "");
    setRetryNeeded(Boolean(result.retry));
    setBusy(false);
  }
  return (
    <div
      className="scrim"
      onMouseDown={(e) =>
        e.currentTarget === e.target && !busy && !retryNeeded && close()
      }
    >
      <section className="modal">
        <div className="modal-top">
          <small>
            NEW TRANSFER · {retryNeeded ? "RETRY SAME REQUEST" : "01 / 02"}
          </small>
          <button onClick={close} disabled={busy || retryNeeded}>
            <X size={17} />
          </button>
        </div>
        <h2>{retryNeeded ? "Confirm transfer status" : "Send money"}</h2>
        <p>
          {retryNeeded
            ? "Keep the same details to safely retry with the original idempotency key."
            : "Move money to anyone with a UPI ID or phone number."}
        </p>
        <form onSubmit={submit}>
          <label>To</label>
          <input
            autoFocus
            value={recipient}
            disabled={retryNeeded || busy}
            onChange={(e) => update(() => setRecipient(e.target.value))}
            placeholder="Name, phone or UPI ID"
          />
          <label>Amount</label>
          <div className="amount">
            <i>₹</i>
            <input
              type="number"
              min="1"
              max="25000"
              step="1"
              value={amount}
              disabled={retryNeeded || busy}
              onChange={(e) => update(() => setAmount(e.target.value))}
              placeholder="0"
            />
            <small>INR</small>
          </div>
          <div className="quick">
            {[500, 1000, 2000].map((x) => (
              <button
                type="button"
                disabled={retryNeeded || busy}
                onClick={() => update(() => setAmount(String(x)))}
                key={x}
              >
                + ₹{x.toLocaleString("en-IN")}
              </button>
            ))}
          </div>
          <label>
            Add a note <small>Optional</small>
          </label>
          <input
            value={note}
            disabled={retryNeeded || busy}
            onChange={(e) => update(() => setNote(e.target.value))}
            placeholder="What’s this for?"
          />
          <label>Pay from</label>
          <select
            value={method}
            disabled={retryNeeded || busy}
            onChange={(e) => update(() => setMethod(e.target.value))}
          >
            <option>Veyra balance</option>
            <option>HDFC Bank ·· 4821 · demo rail unavailable</option>
            <option>Visa ·· 0906 · demo rail unavailable</option>
          </select>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <div className="secure">
            <ShieldCheck size={14} />
            Demo transfer · No real UPI PIN is collected
          </div>
          <button className="primary submit" disabled={busy}>
            {busy
              ? "Checking transfer…"
              : retryNeeded
                ? "Retry same transfer"
                : "Continue"}{" "}
            <ArrowRight size={15} />
          </button>
        </form>
      </section>
    </div>
  );
}
function TopupModal({
  close,
  done,
}: {
  close: () => void;
  done: (b: number) => void;
}) {
  const [a, A] = useState("2000"),
    [err, E] = useState(""),
    [busy, B] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    B(true);
    try {
      const r = await fetch("/api/razorpay/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(a) }),
      });
      const o = await r.json();
      if (!r.ok)
        throw Error(o.error?.message || "Could not create a Razorpay order.");
      if (!window.Razorpay)
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://checkout.razorpay.com/v1/checkout.js";
          s.onload = () => resolve();
          s.onerror = () => reject(Error("Razorpay Checkout failed to load."));
          document.body.appendChild(s);
        });
      if (!window.Razorpay) throw Error("Razorpay Checkout did not load.");
      new window.Razorpay({
        key: o.keyId,
        order_id: o.orderId,
        amount: o.amount,
        currency: o.currency,
        name: "Veyra",
        description: "Add money to your wallet",
        prefill: { name: "Charan K.", email: "charan.k@email.com" },
        theme: { color: "#315eea" },
        modal: { ondismiss: () => B(false) },
        handler: async (p) => {
          try {
            const v = await fetch("/api/razorpay/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  orderId: p.razorpay_order_id,
                  paymentId: p.razorpay_payment_id,
                  signature: p.razorpay_signature,
                }),
              }),
              j = await v.json();
            if (!v.ok)
              throw Error(j.error?.message || "Payment verification failed.");
            done(j.balanceMinor);
          } catch (x) {
            E(x instanceof Error ? x.message : "Payment verification failed.");
            B(false);
          }
        },
      }).open();
    } catch (x) {
      E(x instanceof Error ? x.message : "Could not start checkout.");
      B(false);
    }
  }
  return (
    <div className="scrim">
      <section className="modal">
        <div className="modal-top">
          <small>WALLET TOP-UP · RAZORPAY</small>
          <button onClick={close}>
            <X size={17} />
          </button>
        </div>
        <h2>Add money</h2>
        <p>Add funds securely using Razorpay Checkout.</p>
        <form onSubmit={submit}>
          <label>Amount to add</label>
          <div className="amount">
            <i>₹</i>
            <input
              type="number"
              min="100"
              max="100000"
              step="100"
              value={a}
              onChange={(e) => A(e.target.value)}
            />
            <small>INR</small>
          </div>
          <div className="quick">
            {[1000, 2000, 5000].map((x) => (
              <button type="button" onClick={() => A(String(x))} key={x}>
                ₹{x.toLocaleString("en-IN")}
              </button>
            ))}
          </div>
          {err && <div className="error">{err}</div>}
          <div className="secure">
            <LockKeyhole size={14} />
            Test mode · Wallet credit follows server verification
          </div>
          <button className="primary submit" disabled={busy}>
            {busy ? "Opening secure checkout…" : "Continue to checkout"}{" "}
            <ArrowRight size={15} />
          </button>
        </form>
      </section>
    </div>
  );
}
declare global {
  interface Window {
    Razorpay?: new (o: {
      key: string;
      order_id: string;
      amount: number;
      currency: string;
      name: string;
      description: string;
      prefill: { name: string; email: string };
      theme: { color: string };
      modal: { ondismiss: () => void };
      handler: (p: {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      }) => void;
    }) => { open: () => void };
  }
}
function Detail({ tx, close }: { tx: Tx; close: () => void }) {
  const [copyLabel, setCopyLabel] = useState("Copy transfer ID");
  async function copyTransferId() {
    try {
      await navigator.clipboard.writeText(tx.id);
      setCopyLabel("Copied");
      window.setTimeout(() => setCopyLabel("Copy transfer ID"), 1800);
    } catch {
      setCopyLabel("Clipboard unavailable");
    }
  }
  return (
    <div
      className="scrim"
      onMouseDown={(e) => e.currentTarget === e.target && close()}
    >
      <section className="modal detail">
        <div className="modal-top">
          <small>
            TRANSFER DETAILS ·{" "}
            <i className={`state ${tx.status.toLowerCase()}`}>
              <i />
              {tx.status}
            </i>
          </small>
          <button onClick={close}>
            <X size={17} />
          </button>
        </div>
        <span className={`face detail-face ${tx.kind}`}>{tx.initials}</span>
        <h2>{tx.name}</h2>
        <p>{tx.handle}</p>
        <strong className="detail-value">
          {tx.amount > 0 ? "+" : "−"}
          {cash(tx.amount)}
        </strong>
        <p>{tx.note}</p>
        <div className="steps">
          <div className="step">
            <i>
              <Check size={12} />
            </i>
            <b>
              Initiated<small>{tx.time}</small>
            </b>
          </div>
          <div
            className={`step ${tx.status === "Processing" ? "processing" : ""}`}
          >
            <i>
              {tx.status === "Processing" ? (
                <Clock3 size={12} />
              ) : (
                <Check size={12} />
              )}
            </i>
            <b>
              Processing<small>Bank confirmation</small>
            </b>
          </div>
          <div className={`step ${tx.status === "Failed" ? "failed" : ""}`}>
            <i>
              {tx.status === "Failed" ? <X size={12} /> : <Check size={12} />}
            </i>
            <b>
              {tx.status === "Processing" ? "Awaiting confirmation" : tx.status}
              <small>{tx.id}</small>
            </b>
          </div>
        </div>
        <div className="meta">
          <span>
            Paid with<b>{tx.method}</b>
          </span>
          <span>
            Transfer ID<b>{tx.id}</b>
          </span>
        </div>
        <button className="copy" onClick={() => void copyTransferId()}>
          {copyLabel} <ArrowRight size={14} />
        </button>
      </section>
    </div>
  );
}
