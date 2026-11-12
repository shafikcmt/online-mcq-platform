# Payment gateway: production readiness review

An honest account of what is ready, what is proven, what is not, and what must happen before
real money moves. Passing automated tests is **not** the same as being production-ready: all
provider calls in the tests are fakes.

> **সারসংক্ষেপ (Bangla):** সিস্টেমের কাঠামো, নিরাপত্তা আর টেস্ট তৈরি। কিন্তু bKash বা
> SSLCommerz-এর আসল sandbox-এ একবারও চালানো হয়নি, তাই কোনো gateway-কে "production-ready"
> বলা যাবে না। Live-এর আগে নিচের "Gap" গুলো (বিশেষ করে G2) মেটাতে হবে। G1 (সার্ভার সুইচ) এখন `PAYMENT_PROVIDER=database` দিয়ে মেটানো।
> ততদিন সার্ভারে `PAYMENT_PROVIDER=unavailable` থাকবে।

## 1. Verdict

| Item | Status |
|---|---|
| Gateway management (database, admin API, Admin Panel) | Built and tested |
| Encrypted, write-only credentials; password re-confirmation; audit | Built and tested |
| Website and app checkout using the chosen gateway and channel | Built and tested (fakes); not seen in a real browser or on a device by the author |
| Sandbox tester flow and test subscriptions | Built and tested |
| Security hardening | Built; attack tests added (`PAYMENT_GATEWAY_SECURITY.md`); no external penetration test |
| **bKash** | Code only. **Never run against bKash.** Not production-ready |
| **SSLCommerz** | Code only. **Never run against SSLCommerz.** Not production-ready |
| Nagad, Rocket (direct) | **Not built.** Listed as "Not implemented"; Rocket may go through SSLCommerz |
| Refunds | **Not implemented** (deferred until a provider's refund API is verified) |
| Bangla QR | Not started |
| Production setting | `PAYMENT_PROVIDER=unavailable`; payments are off |

## 2. Gaps and risks (open)

| # | Gap | Impact | What closes it |
|---|---|---|---|
| **G1** | ~~Server switch vs panel~~ **Resolved:** `PAYMENT_PROVIDER=database` offers only the panel's gateways and needs no environment credentials; `unavailable` stays the kill switch. Found during this review (before, any value other than `unavailable` made production demand `BKASH_*` / `SSLCOMMERZ_*` environment credentials that the panel's gateway never used). | None now. The server still runs `unavailable`; change it to `database` only when you begin sandbox testing. | Done (tests in `test_payment_database_mode.py`). Takes effect on the server after the next deploy and a `.env.prod` change. |
| **G2** | **No real provider run.** Signature rules, status names, amount formats, whether the reference is echoed, token limits, failure paths are assumptions from public descriptions. | A real payment could be refused (fail-closed) or mishandled until corrected. | Run `PAYMENT_GATEWAY_TESTING.md` §4 and `PAYMENT_METHODS.md` §4 with the client's sandbox credentials; fix the adapter for each difference. |
| **G3** | ~~No key rotation tool.~~ **Closed:** `SECRET_ENCRYPTION_KEY_PREVIOUS` + `manage.py rotate_secrets` ([SECRET_KEY_ROTATION.md](SECRET_KEY_ROTATION.md)). A **lost** key still cannot be recovered. | Only if the key is lost: credentials must be typed in again. | Keep the key backed up. The tool is tested automatically; it has not been run on the production server. |
| **G4** | **Return into the app.** `PAYMENT_RETURN_URL` in `.env.prod.example` is the website's `/payment-return` page. An in-app payment returns to the website page, not into the app, unless the app's return URL is `livemodeltest://payment-result` (server setting or the gateway's own app return URL). | Only matters if students pay inside the app. The app's checkout waits for the app link to close the in-app browser. | Set the app return URL when app payments are used; test on a device. Whether the app may sell subscriptions outside Google Play Billing is **unconfirmed for Bangladesh** (`PAYMENT_METHODS.md` §8). |
| **G5** | **bKash has no IPN here.** Settlement relies on the browser returning plus the 10-minute reconciliation. | A student who closes the page waits up to the reconciliation interval (default 10 min) for activation. | Acceptable; admin can re-verify one payment. Add bKash's webhook only from its official document. |
| **G6** | **Old app builds** send `provider` and no `channel`. The server still accepts that (first gateway of the adapter, default return URL). | Old builds cannot choose between two accounts of one provider, and return via the default URL. | New APK (bump `mobile/app.json` version) and update notice. |
| **G7** | **Not seen by eye.** The Admin Panel gateway screens and the new checkout UI were tested by automated tests, not by someone clicking through on a real browser and phone. | Layout or wording problems may exist. | Walk through `PAYMENT_GATEWAY_SETUP.md` §2–5 once, on desktop and phone, in both languages. |
| **G8** | **Logos** are admin-entered https addresses loaded from other hosts. | A host that disappears shows no logo; a hostile host sees visitors' IPs. | Host logos on our own site. |
| **G9** | **No external review.** No penetration test, no dependency audit. | Unknown unknowns. | Do both before large-scale launch. |
| **G10** | **Single points:** one Redis (throttles, password lock fail closed), one backend host. | A Redis outage blocks payment starts and admin credential changes (by design) until it returns. | Normal operations monitoring. |

## 3. Before real money: checklist

All items are the owner's unless stated.

- [ ] Merchant account(s) exist **in the client's name**; sandbox and live credentials received
      through the provider's channel, never chat.
- [ ] `PAYMENT_PROVIDER=database` set on the server (G1: resolved in code; needs the deploy and the `.env.prod` edit).
- [ ] `SECRET_ENCRYPTION_KEY` set and **backed up** in the password store (G3).
- [ ] Gateway added in the panel; credentials entered in sandbox mode; connection test run.
- [ ] Tester account added; **every step 1–13 of `PAYMENT_GATEWAY_TESTING.md` §4 passed** for
      that provider, with the date and API version noted (G2).
- [ ] Any adapter difference found in the sandbox is fixed, tested and deployed.
- [ ] Return URLs correct for the website (and the app if used); tested end to end (G4).
- [ ] Panel walkthrough done on desktop and phone, both languages (G7).
- [ ] Backups of the database are running and a restore has been tried.
- [ ] Live credentials entered; gateway switched to **live** (the panel enforces the rule).
- [ ] One **small real payment** by the owner confirmed in the provider's dashboard **and** the
      admin payments list; the subscription is real and the test did not appear in revenue
      wrongly.
- [ ] Support knows the stuck-payment procedure below.
- [ ] Only then enable for students and announce.

## 4. Incident procedures

**Stop all payments now:** on the server set `PAYMENT_PROVIDER=unavailable` in
`/srv/mcq/.env.prod`, restart the backend. Nothing is offered; running payments still settle
when the provider answers. (Single gateway: Disable it in the panel.)

**A student paid but has no access:** open the payment in the admin payments list. `success`
means access exists (check the student's subscription). `pending`: use **re-verify** (cooldown
applies) or wait for reconciliation. `failed` with a reason (`amount_mismatch`,
`duplicate_transaction`, …): money may have moved without access: check the provider's
dashboard and resolve with the provider and the student by hand. Never mark a payment paid
manually.

**Credentials may have leaked:** (1) change them **at the provider** first; (2) enter the new
ones in the panel; (3) look at the gateway history and the admin audit log for unfamiliar
changes; (4) if an admin account may be involved, change its password and review the admin
users. If `SECRET_ENCRYPTION_KEY` leaked, change it with the rotation steps in
[SECRET_KEY_ROTATION.md](SECRET_KEY_ROTATION.md) (no credential has to be typed in again), and
also change the provider credentials, since a leaked key may have exposed them.

**Encryption key lost:** the panel shows credentials as unreadable. Generate a new key, set it,
re-enter every gateway credential (and the SMS key).

**Provider outage:** payments stay pending and reconcile when it returns; consider disabling
the gateway so students are not sent to a broken page.

**Wrong amount or currency in a payment:** the system fails the payment (`amount_mismatch` /
`currency_mismatch`) and grants nothing; follow "paid but no access".

## 5. What changed in the database and server (already deployed with `main`)

Migrations (all additive): `payments` 0003 (gateways, credentials, log, payment gateway/mode),
`payments` 0004 (channel, testers), `subscriptions` 0003 (`is_test`), `cms` 0002 (app update
notice). No data was removed. Environment variables added to `.env.prod.example` (placeholders
only): `PAYMENT_PROVIDER=database` (new value), `PAYMENT_WEB_RETURN_URL`, `SECRET_ENCRYPTION_KEY` note, optional `THROTTLE_PAYMENT_METHODS`.
Not verified by the author: that the Deploy production runs for these commits succeeded; check
GitHub Actions.

## 6. Not planned in this system

Refunds, Nagad/Rocket direct, Bangla QR, bKash webhook, Google Play Billing, key rotation tool,
automatic gateway health alerts. Each needs its own decision (and, for providers, the official
document and credentials).
