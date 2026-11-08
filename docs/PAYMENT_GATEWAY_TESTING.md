# Payment gateway testing

What is tested automatically, what each test file proves, how to run them, and the manual
checklist for the one thing automation cannot do here: a payment against the provider's real
sandbox.

## 1. Run the tests

| Part | Command (from the folder) | Last result |
|---|---|---|
| Backend | `pytest` in `backend/` (needs PostgreSQL and Redis; the test database is created for you) | 2372 passed |
| Admin Panel | `npm test` in `admin/` (also `npm run typecheck`, `npm run lint`) | 366 passed |
| Website | `npm test` in `web/` | 71 passed |
| Mobile app | `npm test` in `mobile/` (also `npm run typecheck`, `npm run lint`) | 155 passed |
| Lint | `ruff check .` and `ruff format --check .` in `backend/` | clean |
| API schema | `python manage.py spectacular --validate --fail-on-warn` | valid |
| Migrations | `python manage.py makemigrations --check --dry-run` | none pending |

After switching git branches run the backend suite once with `--create-db` so the test
database matches the migrations.

## 2. What each backend test file proves

| File | Proves |
|---|---|
| `test_payments.py`, `test_payments_bkash.py` | The original payment flow, the mock provider, SSLCommerz and bKash adapters against **fake** providers: verification rules, replay, forged cancel, duplicate transactions, reconciliation, unavailable switch. |
| `test_payment_gateways_store.py` (41) | Models and storage: encrypted credentials with hints, write-only behaviour, blank keeps old value, sandbox/live separation, key rotation, append-only log (including raw SQL), the live-activation rule per gateway. |
| `test_payment_gateways_admin.py` (114) | The gateway manager and the admin API: offers (database first, environment fallback, channels, limits, testers), password re-confirmation, mode and enable rules, connection test, payments through a chosen gateway (own credentials, own mode), test subscriptions and revocation, return URLs, statistics. |
| `test_payment_security.py` (33) | The system under attack: every admin route refuses non-admins; CSRF; junk and malformed input never gives a 500; no secret in any response, log, audit row, event, table, Django admin or raw database row; password lock and no password in logs; no route to live without the rule; forged and cross-account callbacks; mismatched amounts; cross-payment mix-ups; concurrency; throttle on the method list. |
| `test_payment_validity.py`, `test_payment_reverify_guards.py`, `test_admin_payments.py` | Validity windows, admin re-verify guards, the admin payments list. |

Admin, website and mobile tests cover the screens: gateway list and forms, masked credentials,
password dialog, mode panel, testers, the buy page (method choice, gateway and channel sent,
limits, test marking), and the app's checkout dialog.

## 3. What the tests do **not** prove

Every provider call in the tests is a fake. They prove our code behaves correctly **given**
the answers we assumed. They do **not** prove bKash or SSLCommerz actually answer that way.
Until the checklist below has been run and passed for a provider, that provider is
**untested against the real thing**, whatever the pass count says.

## 4. Real sandbox checklist (per provider, per gateway)

Prerequisites: a sandbox account at the provider, sandbox credentials entered in the panel
(never in chat), the gateway enabled in sandbox mode, your test account added as a tester,
and the server switch set as described in `PAYMENT_GATEWAY_SETUP.md` §1.

For **each** provider:

1. **Connection test** (bKash): passes. (SSLCommerz: "not supported" is expected.)
2. **Start**: the sandbox gateway appears with *Test payment*, the provider's page opens.
3. **Success**: pay with the provider's sandbox wallet/card. The browser returns to the right
   page (website or app), the payment is `success`, and a **test** subscription exists.
4. **Cancel**: cancel on the provider's page. The payment ends `cancelled`, no subscription.
5. **Failure**: wrong PIN / insufficient balance / expired. Ends `failed`, no subscription.
6. **Close the page** and never come back: the payment stays open, then reconciliation
   settles it (or closes it as abandoned after 24 h).
7. **Amount**: the provider's answer shows the amount you expected; compare formats (`500.00`
   vs `500`).
8. **Reference**: the provider echoes our merchant reference; if not, note it (the adapter
   refuses a mismatch by design).
9. **Callback signature** (SSLCommerz): a real callback is accepted, and an edited copy is not.
10. **Repeat the callback**: grants nothing twice.
11. **Admin re-verify** of a pending payment works and respects the cooldown.
12. Tick the provider-specific list in `PAYMENT_METHODS.md` §4 (bKash).
13. Record the date, the provider's API version and any difference found, and fix the adapter
    for each difference **before** going live.
14. **Live smoke test** after going live: one small real payment by the owner; confirm it in
    the provider's dashboard and in the admin payments list.

Only after steps 1–13 passed may the gateway be switched to **live** (the panel enforces that
at least one sandbox payment succeeded, but it cannot know the other steps were done: that
is on the owner).

## 5. Adding tests for a new provider

Copy the structure of `test_payments_bkash.py`: a fake that records calls, then cover
initiate, signature, verify (paid, failed, cancelled, pending, not found, error), amount and
currency mismatch, replay, concurrency and "no secret in any log or event". Add its adapter to
the route-crawl and secret-sweep tests only if it introduces new routes or credential fields
(both pick up registry fields and admin routes automatically).
