# Veyra — Mini UPI Wallet

A responsive wallet dashboard and TypeScript API for the system design assignment. It demonstrates idempotent transfers, per-wallet concurrency serialization, validation rules, funding strategies, lifecycle transitions, an append-only ledger, notifications and Razorpay Checkout top-ups.

## Run locally

Requires Node.js 22+ and npm.

```sh
npm install
cp server/.env.example server/.env
# Add Razorpay test credentials in server/.env to enable top-ups
npm run dev:server
# In another terminal
npm run dev
```

Open the exact URL printed by Vite. Veyra uses port 5174 to avoid a stale browser service worker on 5173. The API listens on port 4000.

## What works

- Wallet overview, people, searchable/filterable activity, CSV statement download, transfer detail timeline and wallet ledger.
- Wallet funded sends with validation, a per-wallet lock, same-key retry handling, mismatch rejection and a debit plus immutable ledger append saved together.
- Persistent local demo state in `server/data/state.json`; wallet, transfers, idempotency records and ledger survive API restarts.
- Razorpay test-mode order creation, hosted Checkout, HMAC verification, captured-order/amount checks and one-time wallet credit.
- Bank/card methods are shown as sample linked sources, but payout rails are not connected. They return a clear error rather than reporting a fake success.

This is a classroom demo, not a live payment service. It does not authenticate users or move real UPI funds. Use only Razorpay test keys. The normalized PostgreSQL production mapping is in `docs/schema.sql`; replacing the single-process JSON demo repository with a database transaction and shared locking is required before production deployment.
