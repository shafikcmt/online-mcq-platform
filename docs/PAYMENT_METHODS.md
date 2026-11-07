# Payment methods

How students pay, which methods exist, which are only planned, and what each one needs
before it can take real money. The code that talks to a provider is one small class behind
one interface (`apps/payments/gateways/base.py`); adding a method changes no other module,
API or table.

## 1. Status

| Method | Status | What it still needs |
|---|---|---|
| **SSLCommerz** (bKash, Nagad, Rocket, cards, banks through one gateway) | Built, tested with a fake provider, run against nothing real yet | Merchant account in the **client's name**; sandbox store ID/password to test, live ones to launch |
| **bKash** (direct, Tokenized Checkout) | Built, tested with a fake bKash. **Never run against bKash** | bKash merchant onboarding; sandbox credentials; the checklist in §4 |
| **Nagad** (direct) | **Not built** | Merchant ID, merchant private key, Nagad's public key and Nagad's own API document (§5) |
| **Rocket** (direct) | **Not built** | No public API found. Needs a merchant agreement and API document from DBBL, or use it through SSLCommerz (§6) |
| **Bangla QR** | **Planned** | A bank / payment-service-provider agreement and its confirmation API (§7) |
| Google Play Billing | **Not planned for now** | See §8 |

Nothing in this file is a promise that a method is live: until a provider has accepted a
sandbox payment from this code, it is untested against the real thing.

## 2. How the server chooses

- `PAYMENT_PROVIDER` – the main provider. **`unavailable` switches every payment off**,
  whatever else is set (the safe default for a server without merchant credentials).
- `PAYMENT_ENABLED_PROVIDERS` – optional comma-separated list of every method students may
  choose from, in display order; the first is the default. Empty = just `PAYMENT_PROVIDER`.
  Example: `PAYMENT_PROVIDER=bkash` and `PAYMENT_ENABLED_PROVIDERS=bkash,sslcommerz`.
- `GET /api/v1/payments/methods/` – what a signed-in student can choose now
  (`{"results": [{"provider": "bkash", "label": "বিকাশ"}]}`; labels follow the language).
- `POST /api/v1/payments/` takes `package_id` and, optionally, `provider`. The price always
  comes from the server; a `provider` that is not offered is refused (400
  `provider_not_offered`); a repeated `Idempotency-Key` cannot switch the method.
- Production refuses to start if any enabled method is half configured (missing credentials,
  `mock`, sandbox without the explicit test flag) — `config/settings/checks.py`.

Secrets are read from the server's environment only (`/srv/mcq/.env.prod`, mode 600). They
are never in git, logs, API answers or the database, and never pasted into chat.

## 3. What every method must guarantee

1. The browser callback only **finds** the payment; it decides nothing.
2. Money is granted only after a **server-to-server** answer from the provider whose
   reference, amount and currency match our record (`apply_verification`).
3. A replayed callback or a duplicate provider transaction grants nothing twice.
4. Background reconciliation only **reads** state; it never starts a charge.
5. Unexpected answers leave the payment unchanged (`ERROR`), never "paid".

## 4. bKash: sandbox checklist (do this before real money)

The adapter (`gateways/bkash.py`) was written from the public description of the Tokenized
Checkout flow, **not** from bKash's own reference, which we could not read. Every line below
is something the code assumes. Run a sandbox payment end to end and tick each one; fix the
adapter where bKash says otherwise.

Setup: `BKASH_SANDBOX=true`, the four sandbox credentials, `PAYMENT_ALLOW_SANDBOX_IN_PRODUCTION=true`
only on a non-public test deployment. Confirm bKash's current API version and set
`BKASH_API_VERSION` (default `v1.2.0-beta`).

- [ ] **Grant token**: `POST …/token/grant` with headers `username`, `password` and body
      `app_key`, `app_secret` returns `id_token` and `statusCode: "0000"`. Token lifetime is
      long enough for our 50-minute cache; ask bKash about any token-grant rate limit.
- [ ] **Create**: headers `Authorization: <id_token>` and `X-APP-Key`; body fields `mode: "0011"`,
      `payerReference`, `callbackURL`, `amount` (string, two decimals), `currency: "BDT"`,
      `intent: "sale"`, `merchantInvoiceNumber`; answer has `paymentID` and `bkashURL`.
- [ ] `merchantInvoiceNumber` allows our 27-character reference (`MCQ` + 24 hex) and is
      **echoed back** in the status and execute answers. If it is not, a real payment is
      refused as a reference mismatch (fail-closed): the adapter must then match by `paymentID`.
- [ ] **Callback**: bKash redirects the browser to our `callbackURL` with `paymentID` and
      `status` (`success` / `failure` / `cancel`) and nothing else needed.
- [ ] **Status values**: `Initiated`, `Authorized`, `Completed`, `Failed`, `Cancelled` are the
      names bKash really uses, and what the status call returns after the student cancels
      or the payment times out.
- [ ] **Execute**: after the student confirms, status is `Authorized`; calling execute returns
      `transactionStatus: "Completed"` with `trxID`, `amount`, `currency`. A second execute
      is refused harmlessly (our flow checks status first).
- [ ] The code for an **invalid / expired token** (`2079` is assumed; HTTP 401 also handled).
- [ ] Amount comparison: bKash returns the amount as it was sent (`500.00` vs `500`).
- [ ] Failure paths: wrong PIN, insufficient balance, timeout, student closes the page — each
      ends `failed`/`cancelled`/abandoned, never "paid" and never stuck forever.
- [ ] **Go-live**: bKash's production sign-off steps, and whether production API access needs
      our server's public IP whitelisted (ask bKash). Refunds and bKash's webhook/IPN are not
      implemented.

## 5. Nagad (not built)

Direct Nagad integration signs and RSA-encrypts every request (initialize → checkout →
verify), so it cannot be written correctly without Nagad's official document and keys.
Community examples disagree on endpoint paths and fields, so none is used. **Needed from the
client:** Nagad merchant ID, merchant private key, Nagad's public key, sandbox access and the
API document. Until then Nagad is available **through SSLCommerz**.

## 6. Rocket (not built)

No public merchant API or sandbox was found. Either ask DBBL for a merchant agreement and API
document, or accept Rocket through SSLCommerz. Not built on guesses.

## 7. SSLCommerz and Bangla QR (kept in the plan)

- **SSLCommerz** is implemented (`gateways/sslcommerz.py`) and is the simplest way to offer
  bKash, Nagad, Rocket, cards and banks together. It needs the client's merchant account:
  sandbox credentials to test, live credentials to launch (set on the server only).
- **Bangla QR** needs an acquiring bank / PSP that issues a merchant QR and tells us, by API
  or webhook, that a payment arrived. It would be another `PaymentGateway`, with the same
  rule: grant only after a server-to-server confirmation matching our reference and amount.
  Not started; waits for an agreement.

## 8. Google Play

Whether a Play-distributed app may sell digital subscriptions through methods other than
Google Play Billing depends on Google's policy for the developer's country; it has not been
confirmed for Bangladesh. The payment code is independent of that decision. The mobile app's
purchase screens are intended to be switchable per build (direct APK vs Play) once Google's
answer is known. Until then, do not publish a Play build that sells subscriptions outside Play
Billing without Google's written confirmation.

## 9. Order of work

1. SSLCommerz sandbox end to end (needs the client's sandbox credentials).
2. bKash sandbox checklist (§4).
3. Method chooser in the website and the app (the API is ready).
4. Nagad and Rocket when their documents and credentials exist.
5. Bangla QR when a bank/PSP agreement exists.
6. Live credentials on the server, one method at a time, with a small real payment first.
