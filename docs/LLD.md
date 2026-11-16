# Veyra low-level design

This document describes the running local demo and clearly separates implemented behavior from production design artifacts. For setup, full API examples, Mermaid diagrams, and the project overview, see the [README](../README.md).

## 1. Scope and actors

### Actors

| Actor | Responsibility |
|---|---|
| Customer | Views the demo wallet, sends wallet-funded transfers, checks activity/ledger, and starts a top-up. |
| Razorpay Checkout/API | Provides hosted test checkout, order creation, and payment details fetched by the API for verification. |
| Notification observer | Receives a transfer notification; the configured implementation writes to the API console. |
| Bank/card payout provider | Future integration point. The current strategies return `PAYMENT_RAIL_UNAVAILABLE`. |

The runnable API has no authentication. Requests use one fixed demo user/wallet (`usr_charan`); this is an explicit scope limit, not an identity model.

## 2. Requirements

### Functional requirements

1. Read wallet balance, currency, daily spend, daily cap, transfer history, and ledger entries.
2. Send money from the Veyra wallet to a recipient identifier after validating amount, recipient, demo fraud rule, daily cap, and balance.
3. Accept an idempotency key for each send. Repeating the same request with the same key returns the original transfer and cannot add another debit. Reusing a key with changed payload returns a conflict.
4. Serialize mutations for the same wallet in the running API process to prevent concurrent overspending.
5. Record debit and credit movements as append-only ledger entries and persist local state across restarts.
6. Create Razorpay test-mode top-up orders and credit a wallet once after server-side proof and captured-payment validation.
7. Show transfer history, search/filter activity, transfer details, and export a CSV statement.

### Non-functional requirements and current limits

| Requirement | Design / limit |
|---|---|
| Money precision | Integer paise are stored; transfer UI and domain inputs use whole rupees and convert to paise at the store boundary. |
| Idempotency | Sender-scoped key and SHA-256 request hash are persisted. Relational production schema includes a unique `(sender_wallet_id, idempotency_key)` constraint. |
| Concurrency | Promise-chain lock serializes one wallet in one Node process. It is not shared across processes or hosts. |
| Ledger integrity | Ledger entries are frozen in memory and appended. JSON snapshot persists state; production requires DB transaction and access controls. |
| Provider secrets | Razorpay secret is read by the server only; the UI receives the public key ID and order response. |
| Availability/error clarity | Typed domain errors map to JSON `{error:{code,message}}`. Local JSON storage has no replicated durability. |
| Security | No user authentication, authorization, rate limiting, or public deployment support. Keep the API local. |
| Refunds | State model includes `REFUNDED`, but there is no refund API, reconciliation worker, or reversal implementation. |

## 3. Use cases

### UC-1: Send from wallet

**Preconditions:** API is running, amount is a positive whole number, request has an idempotency key, and wallet has sufficient funds.

**Main path:** UI submits a transfer → route maps UI source to domain source → `TransferService` obtains sender lock → checks existing key/hash → runs validation chain → persists `INITIATED`, then `PROCESSING` → wallet strategy debits balance and appends a `DEBIT` ledger entry → service marks `SUCCESS` and notifies observers → API returns transfer ID/status.

**Alternate paths:** validation fails before transfer creation; same key/same body returns existing result; same key/different body returns 409; bank/card strategy persists a failed transfer then returns 422.

**Retry:** UI preserves the same key while transfer outcome is uncertain. The server never creates a second debit for an identical request.

### UC-2: Top up wallet

Customer chooses ₹100–₹1,00,000 → UI requests order → API converts rupees to paise and creates Razorpay order using the server secret → API registers order as not credited → UI opens hosted checkout → UI sends order/payment/signature to verification endpoint → server validates HMAC and fetches payment from Razorpay → verifies captured status, order ID, currency, and amount → under wallet lock, credits once and appends `CREDIT` ledger entry.

### UC-3: Review activity and ledger

UI loads wallet, transfer, and ledger resources from API. Activity can be searched and filtered. Selecting a row shows transfer details; statement action exports visible transfer records as CSV. Initial dashboard activity and monthly chart totals are static illustrative data, labeled as sample data.

## 4. Domain model and relationships

Runtime domain types are `Request`, `Transfer`, `Entry`, `Source`, and `Status`. Runtime services and collaborators are shown in the [class diagram](class-diagram.mmd). The running code has no standalone `User`, `Wallet`, or `PaymentMethod` classes: one demo wallet is represented by an ID and maps. The normalized tables in [`schema.sql`](schema.sql) are a future persistence model.

| Runtime data | Key fields | Ownership / relationship |
|---|---|---|
| `Request` | senderId, recipient, amount in rupees, source, optional note | Transfer input value. |
| `Transfer` | id, sender/recipient, amount, source, key/hash, status, timestamp | Stored by `LocalStore`; idempotency map indexes it. |
| `Entry` | id, walletId, referenceId, amountMinor, direction, timestamp | Stored in the ledger list; transfer/order is identified by referenceId. |
| Top-up record | Razorpay order ID, amount in paise, credited flag | Stored in `LocalStore.topups`; credit is idempotent under wallet lock. |
| Wallet balance | wallet ID → amount in paise | Stored in `LocalStore.balances`; demo starts at ₹48,290.50. |

The PostgreSQL model adds normalized `app_user`, `wallet`, `payment_method`, `transfer`, `ledger_entry`, `razorpay_order`, and `notification_outbox` tables. It documents intended keys and indexes; the Express API currently does not use PostgreSQL.

## 5. Object-oriented design, SOLID, and patterns

| Concept | Implementation | Assessment |
|---|---|---|
| Abstraction | `PaymentStrategy`, `TransferRule`, and `Notifier` interfaces; `Rule` abstract class. | Implemented. |
| Encapsulation | `LocalStore` controls balance, idempotency, transfer, and ledger mutations; `State.move` guards transitions. | Store maps are exposed for route reads in the demo, so encapsulation can be tightened. |
| Inheritance / polymorphism | Validation rule subclasses extend `Rule`; payment implementations and notifier implementations substitute their interfaces. | Implemented. |
| SRP | HTTP route wiring, transfer orchestration, validation, strategy authorization, persistence, and notification are separate units. | The API module also contains Razorpay orchestration. |
| OCP | `PaymentFactory` selects implementations through `PaymentStrategy`; rules are polymorphic. | Additions do not alter authorization logic, but rule chain and registrations are wired in constructors/container. |
| LSP | Wallet/external/decorated strategies follow `PaymentStrategy`; rule implementations follow `TransferRule`. | Implemented by shared contracts. |
| ISP | Small interfaces separate payment authorization, validation, and notification. | Implemented. |
| DIP | Transfer service uses factory, rule, and notifier abstractions. | `TransferService` and `BalanceRule` still depend directly on `LocalStore`; a repository interface is a clear next improvement. |
| Strategy + Factory | `PaymentStrategy` and `PaymentFactory`. | Wallet is operational; bank/card intentionally reject. |
| Chain of Responsibility | Input → fraud → daily limit → balance rule. | First failure stops processing. |
| State | `State.move(current,next)` allows explicit lifecycle transitions. | No refund workflow despite `REFUNDED` being a possible status. |
| Observer | `NotificationBus` fans out to `Notifier` observers. | Only `ConsoleNotifier` is configured. |
| Decorator | `LoggingDecorator` wraps a strategy and records authorization timing. | Configured around wallet strategy. |
| Builder | `RazorpayOrderBuilder` constructs order request. | Implemented. |
| Composition root | `container.ts` creates one process-scoped LocalStore, factory, service, and notification bus. | Module instance is local to a single process; not a shared distributed singleton. |

## 6. Transfer lifecycle

Allowed transitions implemented in `State`:

```text
INITIATED → PROCESSING → SUCCESS
                    ↘ FAILED → REFUNDED
INITIATED → FAILED
```

`SUCCESS` and `REFUNDED` are terminal. The current wallet happy path runs `INITIATED → PROCESSING → SUCCESS`. An unavailable external payout runs `INITIATED → PROCESSING → FAILED`. `FAILED → REFUNDED` is only permitted by the state model; there is no operation that triggers it.

See [send sequence](send-sequence.mmd), [top-up sequence](topup-sequence.mmd), and [transfer activity](transfer-activity.mmd) for diagrams.

## 7. API and interface design

All routes use JSON and the `/api` prefix. Money in `balanceMinor`, `dailySpentMinor`, `dailyLimitMinor`, and ledger entries is paise. Send and order request amounts are whole rupees.

| Endpoint | Signature / contract |
|---|---|
| `GET /api/health` | Returns `{status:"ok",service:"veyra-api"}`. |
| `GET /api/wallet` | Returns wallet ID, currency, balance paise, daily spend paise, and daily cap paise. |
| `GET /api/transfers` | Returns transfers from local store. |
| `GET /api/ledger` | Returns append-only ledger entries from local store. |
| `POST /api/transfers` | Header `Idempotency-Key`; body `{recipient,amount,note?,paymentMethod}`; success `{transferId,status,amount}`. |
| `POST /api/razorpay/orders` | Body `{amount}` in rupees; returns HTTP 201 with `{orderId,amount,currency,keyId}`. |
| `POST /api/razorpay/verify` | Body `{orderId,paymentId,signature}`; verifies provider payment and returns `{verified,balanceMinor,paymentId}`. |

Domain errors use `{error:{code,message}}`. Important codes include `INVALID_RECIPIENT`, `INVALID_AMOUNT`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`, `PAYMENT_REVIEW`, `DAILY_LIMIT_EXCEEDED`, `INSUFFICIENT_BALANCE`, `PAYMENT_RAIL_UNAVAILABLE`, `RAZORPAY_NOT_CONFIGURED`, `INVALID_PAYMENT_SIGNATURE`, and `PAYMENT_NOT_CAPTURED`.

## 8. Persistence and schema

### Running demo

`LocalStore` loads and writes one JSON snapshot at `server/data/state.json` by default (or `VEYRA_STATE_FILE`). A temporary file is renamed over the snapshot on mutation. `.gitignore` excludes the state file. This prevents accidental commits of local wallet data but does not provide database-level isolation or cross-process locking.

### Production schema proposal

[`schema.sql`](schema.sql) defines users, wallets, payment methods, transfers, Razorpay orders, ledger entries, and a notification outbox. It includes:

- A sender-wallet/idempotency-key uniqueness constraint.
- History and reconciliation indexes.
- Unique provider payment ID and unique ledger references per transfer/order and direction.
- Nonnegative balances and positive ledger/transfer amounts.

Production send must perform the balance check, debit, transfer update, and ledger insert in one serializable or correctly locked database transaction. Use an outbox for notifications after commit.

## 9. Errors, edge cases, and recovery

| Scenario | Behavior |
|---|---|
| Invalid recipient, amount, or missing/long key | Typed 4xx domain error; validation before new transfer creation. |
| Same key and identical payload | Return the saved transfer; do not authorize/debit again. |
| Same key with changed payload | 409 conflict. |
| Two sends contend for the same wallet | In-process sender lock serializes rule checks and mutation; second request sees the updated balance/daily total. |
| Insufficient balance / daily cap / blocked demo recipient | Reject with typed error before a wallet debit. |
| Bank/card selected | Strategy rejects with 422; the demo does not debit the wallet. A failed transfer may remain in history. |
| Server stops after debit but before success state | Retry sees a persisted debit ledger row and can reconcile PROCESSING to SUCCESS. |
| Razorpay keys missing | Top-up order endpoint returns 503; transfer API remains available. |
| Razorpay payment is invalid, uncaptured, or mismatched | No wallet credit. |
| Repeated verification after successful top-up | `credited` flag and wallet lock prevent a second credit in this single process. |
| Crash or simultaneous API processes | JSON snapshots and in-memory locks are insufficient for production guarantees; use DB transaction, unique constraints, and shared locking. |

## 10. Setup

From the repo root, install dependencies with `npm install`, copy `server/.env.example` to `server/.env`, and use two terminals:

```sh
npm run dev:server
```

```sh
npm run dev
```

Open `http://localhost:5174`. Add Razorpay test keys to `server/.env` to enable test-mode top-ups. See the [README setup section](../README.md#run-locally) for full environment variables, curl examples, and build command.
