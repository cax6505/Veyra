# Low-level design

## Actors and requirements

**Actors:** Customer (checks balance, sends and reviews transfers); Razorpay Checkout/API (collects top-ups); bank/UPI rail adapter (future payout integration); notification channel (console now, SMS/push/email adapters); risk reviewer (future review queue).

**Functional:** link wallet/bank/card sources; validate recipient, amount, daily cap, balance and risk; send to a recipient; return the original transfer for same-key retries; serialize spends per wallet; maintain lifecycle `INITIATED → PROCESSING → SUCCESS | FAILED → REFUNDED`; append debit/credit ledger events; send transfer notifications; add wallet funds via signed Razorpay order/payment verification.

**Non-functional:** integer paise accounting; idempotency; immutable append-only ledger; concurrent-spend protection; secrets stay server-side; clear typed errors; accessible responsive UI; production mutation transaction must atomically update wallet, transfer and ledger.

## Use cases

- Send: customer enters recipient/source/amount → request keyed by `Idempotency-Key` → validation chain → strategy authorization → ledger append → state update → notification.
- Add money: create Razorpay order → hosted checkout → verify HMAC and captured order/amount server-side → credit once → append credit entry.
- Retry: same customer and key returns original transfer; it does not create another debit.
- Inspect: filter history and view transfer ID, funding source and lifecycle.

## OOP, SOLID and patterns

| Item | Where it appears |
|---|---|
| Encapsulation / State | `State` validates allowed transfer transitions. |
| Abstraction / DIP | `PaymentStrategy`, `TransferRule`, `Notifier`; `TransferService` depends on abstractions. |
| Inheritance / polymorphism | Rule subclasses extend `Rule`; wallet/bank/card strategies share `PaymentStrategy`. |
| SRP | Routes handle HTTP; service orchestrates; rules validate; strategy authorizes; store persists; notifier dispatches. |
| OCP | Register another payment strategy or validation rule without changing the orchestration flow. |
| LSP | Rules and payment strategies implement substitutable contracts. |
| ISP | Separate focused rule, payment and notification interfaces. |
| Strategy + Factory | `PaymentFactory` selects authorization by funding source. |
| Chain of Responsibility | Input → fraud → daily limit → wallet balance validation. |
| Observer | `NotificationBus` fans out to attached `Notifier` observers. |
| Decorator | `LoggingDecorator` adds timing around a payment strategy. |
| Builder | `RazorpayOrderBuilder` assembles validated server-side order data. |
| Singleton/composition root | `container.ts` exports one process-scoped service graph; durable multi-process deployment must use shared storage. |

## API

Base `/api`; JSON errors: `{error:{code,message}}`.

- `GET /health` — service status.
- `GET /wallet` — wallet id, currency and integer `balanceMinor`.
- `GET /transfers` — transfer records.
- `GET /ledger` — append-only wallet movements.
- `POST /transfers` — `Idempotency-Key` header; body `{recipient, amount, note?, paymentMethod}`; response `{transferId,status,amount}`.
- `POST /razorpay/orders` — body `{amount}` in INR, ₹100–₹1,00,000; returns provider order id, amount in paise, INR and public key id.
- `POST /razorpay/verify` — `{orderId,paymentId,signature}`; verifies signature, captured status, order and amount before one-time wallet credit.

## Errors, concurrency and edge cases

Invalid amount/recipient/key → typed 4xx; daily cap, fraud or low balance → reject before authorization; invalid lifecycle move → 409; same idempotency key → existing transfer; same wallet requests serialize on a lock. Razorpay absent → 503; invalid signature/order/amount or uncaptured payment → no credit. A failed debited transfer needs a compensating credit and `REFUNDED` state; ledger entries are never deleted. Production needs a database unique key `(sender_wallet_id,idempotency_key)`, a conditional balance update/row lock and a transaction spanning transfer/debit/ledger. The local JSON store is durable for a single process; bank/card strategies do not move funds. Production requires a relational transaction and shared locking across service instances.

## Database mapping

The runnable demo persists local state in `server/data/state.json`. See `schema.sql` for the normalized PostgreSQL mapping and production indexes for users, wallets, payment methods, transfers, ledger entries, Razorpay orders and the notification outbox.
