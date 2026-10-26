# Security Plan — Online MCQ Examination Platform (Phase-1)

> Status: **Planning document.** Scope is "Basic Security" from the Phase-1 requirements.
> Penetration testing and advanced audits are Phase-2 (out of scope), so the controls below
> focus on strong defaults and the most likely real-world abuse for an exam + payment platform.

---

## 1. What are we protecting? (assets)

| Asset | Why it matters |
|---|---|
| Correct answers & explanations | If leaked before/during an exam, results and merit lists become meaningless |
| Exam timing & results | Students may try to get extra time or alter scores |
| Payments & subscriptions | Direct money loss if someone gets paid access without paying |
| User accounts (phone, email, password) | Personal data; account takeover |
| Admin accounts | Full control of the platform |
| SMS balance | OTP abuse ("SMS pumping") costs the client real money |
| Secrets (API keys, DB password, `SECRET_KEY`) | Total compromise if leaked |

## 2. Who might attack? (threats)

1. **Cheating students** — modify the app/network traffic to read answers, extend time, resubmit.
2. **Fraudsters** — fake payment callbacks, replay a successful transaction, change amounts.
3. **Bots** — spam OTP requests, brute-force logins or OTP codes, scrape content.
4. **Account takeover** — weak passwords, stolen tokens, OTP guessing.
5. **Malicious/compromised admin input** — stored XSS through question text or notices.
6. **Accidental leaks** — secrets committed to Git, verbose error pages in production.

---

## 3. Controls

### 3.1 Authentication
- Accounts are identified by a **mandatory, OTP-verified mobile number**; email is optional and never used for password recovery in Phase-1.
- Passwords hashed with Django's hashers (**Argon2** preferred, PBKDF2 fallback). Never stored or logged in plain text.
- Django password validators: min length (8+), not too common, not all-numeric, not similar to phone/email.
- JWT: short-lived access token (~15 min), refresh token rotation + blacklist on logout and password reset.
  Tokens carry the user's `auth_version`; password reset/change increments it, so already-issued
  access tokens fail immediately (no waiting for expiry). Separate `JWT_SIGNING_KEY`, minimal claims (no PII).
- Mobile stores refresh token in `expo-secure-store` (Android Keystore), access token in memory only. Never in AsyncStorage.
- Admin web: tokens in `httpOnly`, `Secure`, `SameSite=Strict` cookies → not readable by JavaScript (XSS can't steal them); CSRF token required for mutations.
- Deactivated users: login refused and existing tokens rejected (check `is_active` on each request).
- Login error messages are generic ("Invalid credentials") — don't reveal which part was wrong.

### 3.2 OTP security
- 6-digit code from a cryptographically secure generator (`secrets`), stored **hashed**.
- Expiry ~5 min, single use, max 5 wrong attempts per code — all configurable.
- Resend cooldown (60 s) + per-phone hourly/daily caps + per-IP caps (protects SMS balance).
- Bangladeshi number format validation before sending (Bangla digits ০-৯ normalized first); optional allow-list of country codes.
- Password reset is **SMS OTP only**. The reset OTP request returns the same response whether or not the account exists (no user enumeration).
  The web request does identical work for every number (abuse checks + one queued task); the Celery
  worker checks the account and issues the code, so response timing does not reveal accounts either.
- OTP verification returns a short-lived, single-use `verification_token` bound to phone + purpose.
- `SMS_PROVIDER=mock` in dev logs the code to the console — **never enabled in production** (startup check).

### 3.3 Authorization
- Default DRF permission = **IsAuthenticated**; public endpoints explicitly opt out.
- Role check (`IsAdminRole`) on every `/admin/*` view via a shared base class — not per-view copy-paste.
- **Object-level ownership**: student querysets always filtered by `request.user` (prevents IDOR — reading someone else's attempt by guessing the ID). Attempts/payments also use UUIDs.
- Paid exam access is checked **server-side** at attempt start (subscription active & package rule matches). *(4A: one policy function, `subscriptions.selectors.user_can_access_exam`; "active" is computed from server time — status, `starts_at`, `expires_at` — so an expired-but-not-yet-marked subscription grants nothing; only active student accounts are entitled; unknown access types fail closed. `/me/subscriptions` is filtered by `request.user`; subscription status changes only through audited grant/cancel actions.)*
- Admin cannot be created through public registration; first admin created by `createsuperuser`/management command.

### 3.4 Exam integrity (most important for this product)
| Risk | Control |
|---|---|
| Reading correct answers from API traffic | Student serializers never include `is_correct` / `explanation`; tests assert their absence. Answers revealed only after submit + visible result + `allow_answer_review` |
| Extending time by changing phone clock | Server computes `deadline_at`; client only displays it using `server_time` offset |
| Submitting late | **One cutoff for answers: `deadline_at`.** Saves are rejected from `deadline_at` on (`410 attempt_deadline_passed`). A small, configurable grace (`ATTEMPT_SUBMIT_GRACE_SECONDS`, default 30 s) only absorbs network latency of the **submit request**: it is accepted until `deadline_at + grace`, but answers sent with it are applied only if it arrived before `deadline_at` — grace never extends answer editing. After `deadline_at + grace` the server finalizes the attempt (`server_auto`) with the answers saved so far |
| Double submit / race from two devices | Row lock + status check + one-to-one result; only one open attempt per exam (partial unique index) *(4B: starts lock the student's user row; saves/submit lock the attempt row; a finished attempt never changes — retried submits return it as is)* |
| Re-taking to improve merit | Live exams: exactly one attempt. Regular: `allow_retake` + `max_attempts` enforced server-side; the merit attempt is chosen by the exam's `merit_strategy` on the server — never by the client |
| Joining a live exam late to get extra time | `deadline_at` capped at the exam's global `end_at` |
| Losing answers / injecting answers after time | No offline exam mode: answers count only when the server receives them before `deadline_at`; retried saves carry `client_saved_at` only for ordering (an older retry never overwrites a newer answer), never for timing |
| Changing a question after its exam is published | *(3C)* Questions used by a published/unpublished/archived exam are content-locked (409) and cannot be deactivated while the exam is published; published exams are not editable; publish locks the exam and its questions so a concurrent edit cannot slip in; a system check fails if the lock is not registered |
| Bypassing eligibility (paid/locked exam) | **Start** checks everything on the server: published exam with active category/subject, schedule window, subscription access (`user_can_access_exam`) and retake limits. **Every save and submit** re-checks the attempt (owner, still open, inside its deadline — which is never later than the exam's end) and subscription access: a cancelled/expired subscription stops further saves and the submit (`403 needs_subscription`); saved answers stay and the server finalizes the attempt after its deadline. *(4B decision)* Unpublishing/archiving an exam or deactivating its category/subject stops **new** attempts only — it never strands a student mid-exam: the running attempt keeps working from its own snapshot until its deadline |
| Submitting an option from a different question | Server validates option belongs to the question in this attempt |
| Changing marks via request | Marks never accepted from client; snapshot from server at attempt start |
| Abandoning attempt to avoid a bad score | Celery auto-finalizes expired attempts *(4B: `celery beat` every minute, bounded batches, `SKIP LOCKED`, idempotent; a new start also finalizes the student's overdue open attempt)* |
| Screenshots/sharing questions | Android `FLAG_SECURE` (via Expo module) on exam screens — *deterrent only*, optional (pending decision in ROADMAP) |

> Honest limitation: a determined student can still take photos with another phone or get help
> from others. Phase-1 controls make cheating via the **app and API** hard; they cannot proctor
> the real world.

### 3.5 Payment security
- One `PaymentGateway` interface for all providers; **SSLCommerz implemented first**, bKash/Nagad later. Every gateway must implement server-side `verify()`; a gateway without it cannot be enabled.
- Amount is taken from the **package price on the server**, never from the client.
- Payment success only after **server-to-server verification** with the provider (bKash execute/query, Nagad verify, SSLCommerz validation API) — callback parameters alone are never trusted.
- Compare provider-reported amount, currency, merchant reference and status with our record.
- Validate signatures/hashes on callbacks and IPNs where the provider supports them (SSLCommerz `verify_sign`/`verify_key` + Validation API with `val_id`; later Nagad signature with merchant keys, bKash token-authenticated query).
- Success/fail/cancel **redirect pages never change access by themselves**; only `verify()` can mark a payment successful.
- Subscription access is checked on the server for every paid-exam start (active subscription + package rule: all paid exams / selected categories / selected exams).
- Idempotent processing: unique `provider_transaction_id`, status can only move forward, all inside one DB transaction with row lock.
- Every step logged to `payment_events` (sanitized — no secrets, no full card data; we never handle card numbers ourselves).
- Reconciliation job re-queries pending payments.
- Admin cannot silently mark a payment successful; "re-verify" calls the provider; any manual override (if ever allowed) is audited.
- Provider keys (bKash app secret, Nagad private key, SSLCommerz store password) only in env/secret files with restricted permissions.
- *(Milestone 5 — as built)* Callback/return URLs are built from server settings
  (`PAYMENT_CALLBACK_BASE_URL`, `PAYMENT_RETURN_URL`), never from the request (no open redirect).
  Fail/cancel callbacks also query the provider, so a forged "cancel" cannot end a paid payment;
  a provider answer about another reference (e.g. a replayed `val_id`) changes nothing. Amount,
  currency, reference and a non-reused provider transaction ID must all match before success;
  SSLCommerz `risk_level = 1` is held (no activation). A `failed`/`cancelled` payment can
  become `success` only through the provider-verified late-success path (all facts must match;
  never from a callback parameter, an API or an admin edit). Provider authenticity is
  established only by the server-side gateway verification service; a database trigger
  additionally prevents accidental or ordinary direct status mutations that violate the payment
  state machine (it guards the shape of transitions and, with CHECK constraints, success-row
  integrity — not that a verification happened). A compromised database superuser is outside the
  application's threat boundary (protected by database credentials and access control).
  Payment events and `raw_verification`
  store allow-listed provider fields only. The admin payments API (7H) never returns them
  whole: no `raw_verification` blob, no event payloads, no source IP addresses, no provider
  session key (`provider_payment_id`), checkout URL or idempotency key — only a four-field
  verification summary and event short codes that must match known values or strict
  patterns (`payments.selectors`), and the student's masked mobile number.
  The commercial snapshot of a payment — `amount`, `currency` and (payment-safety slice)
  `validity_days` — is taken at initiation and protected by a PostgreSQL trigger that rejects
  any change; the subscription a verified payment creates or extends always uses the
  snapshot, so editing a package can neither shorten nor lengthen what a student already
  bought. Logs carry ids/references/statuses only (no contact
  data, secrets or payloads). Production refuses `PAYMENT_PROVIDER=mock` (and forces the mock
  gateway off), missing SSLCommerz credentials, the SSLCommerz sandbox (unless
  `PAYMENT_ALLOW_SANDBOX_IN_PRODUCTION=true` on a non-public test server), a non-https callback
  base URL and an empty return URL.

### 3.6 Input validation & injection
- All input passes through DRF serializers (types, lengths, choices, ranges).
- Django ORM parameterized queries → SQL injection protection. **No raw SQL with string formatting.**
- Rich text (question text, explanations, announcements): sanitized on save with an allow-list HTML sanitizer (e.g. `nh3`/`bleach`), and rendered safely on clients (React escapes by default; no `dangerouslySetInnerHTML` without sanitized content).
  *(Milestone 3B: question/option/explanation text is **plain text** — stored as typed, never interpreted
  as HTML, always rendered escaped. A sanitizer is only needed if rich text is approved later.)*
- Text is **Unicode NFC-normalized**; Bangla and Western digits normalized in numeric inputs on the server.
- **Contact form:** throttled per IP, hidden honeypot field, length limits, stored as plain text (escaped on display in admin), no file attachments.
  *(Milestone 6A: CMS text — announcements, FAQ, pages, site settings — is plain text too, never HTML.
  App links accept only `https://` or the project's own configured app scheme
  (`APP_DEEP_LINK_SCHEME`); every other scheme — `javascript:`/`data:`/`vbscript:`/`file:`/`http:`
  and other apps' schemes — is refused by validation, and a database CHECK refuses the dangerous ones. Site settings hold no secrets; credentials and
  business rules stay in environment settings.)*
- File uploads (images): extension + MIME + real image check (Pillow), size limit (e.g. 2 MB), random file names, served as static files, never executed.
  *(Milestone 3B, question images: the filename and declared type are ignored; Pillow detects the format
  (JPEG/PNG/WebP only), size and pixel limits are settings, the image is **re-encoded** (drops EXIF/GPS and
  anything embedded) and saved under a random name. Pillow's decompression-bomb warning is treated as an
  error. File lifecycle: the new file is written before the (durable) transaction and removed again if it
  does not commit; replaced/removed/deleted files are deleted only after the commit. Production must serve
  `MEDIA_ROOT` as static files only, from a separate volume — configured with the deployment, Milestone 10;
  Django serves media only when `DEBUG` is on.)*
- Request body size limits at Nginx and Django.

### 3.7 Web security (website & admin)
- HTTPS everywhere (Let's Encrypt), HSTS in production.
- Django: `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `X_FRAME_OPTIONS=DENY`, `SECURE_CONTENT_TYPE_NOSNIFF`, `DEBUG=False`.
- CORS: allow-list only our website/admin origins (`django-cors-headers`); mobile app is not affected by CORS.
- Content-Security-Policy on Next.js apps (restrictive for admin).
- Admin panel on a separate subdomain, `noindex`.

### 3.8 Rate limiting & abuse
- DRF throttles (Redis) per scope: OTP, login, submit, payment, general (see `API_PLAN.md` §5).
- Nginx `limit_req` as an outer layer for very high request rates.
- Client IP for throttles comes from `REMOTE_ADDR` unless `TRUSTED_PROXY_COUNT` > 0; then the N-th
  `X-Forwarded-For` entry from the right is used and anything further left (client-supplied) is
  ignored. **When `TRUSTED_PROXY_COUNT` > 0 the app server must not be reachable directly from the
  internet** — only through that proxy chain (firewall / Docker network) — otherwise clients could
  forge the header. Proxy IP ranges (e.g. Cloudflare) are not hard-coded; the count is configuration.
- Optional CAPTCHA on OTP request if SMS abuse is observed (not in Phase-1 by default).

### 3.9 Secrets & configuration
- Never commit: `.env`, API keys, SMS/payment credentials, DB passwords, `SECRET_KEY`, certificates/private keys (`.gitignore` already covers `.env*`, `*.pem`, `*.key`).
- `.env.example` contains placeholders only.
- Production settings refuse to start if `SECRET_KEY` is the placeholder, `DEBUG=True`, or mock SMS/payment providers are enabled.
- Enable GitHub secret scanning / push protection on the repository.
- Different secrets per environment (dev/staging/prod).

### 3.10 Logging, monitoring & audit
- Log: login success/failure, OTP requests, password resets, attempt start/submit, auto-submits, payment events, admin changes, permission denials, 5xx errors.
- **Never log**: passwords, OTP codes (except mock mode in dev), tokens, provider secrets.
- `audit_logs` table for admin actions (who, what, when, from which IP). *(Milestone 3A)* Append-only
  (PostgreSQL trigger + model + read-only admin/API); metadata limited to allow-listed field names and
  short identity values — never request bodies, passwords, tokens, cookies or keys. Users with audit
  history are **deactivated, never hard-deleted** (the actor reference is `PROTECT`).
- Production errors: generic message to the client, stack trace in server logs only.
  (Optional: Sentry — external cost, client decision.)

### 3.11 Data protection & backups
- Collect only needed personal data (name, phone, email, optional institution).
- Leaderboards use a **configurable display-name mode** (default `masked`, e.g. `Rah*** H.`; alternatives initials / student-chosen display name / full name) set separately for the public website and the app. Phone numbers and emails are never shown. *(4C: modes from settings until Milestone 6; unknown values fall back to `masked`; leaderboard rows carry no user ids; a student sees their own full name only in their own row.)*
- *(4C)* Results: scored only on the server from the attempt snapshot and the answer key (no score field is ever accepted from a client); one result per attempt (one-to-one + row lock); visibility checked by one policy (`results.selectors.results_visible`) on every result, review and leaderboard endpoint — a stored result is not proof of visibility; correct answers and explanations only in the separate review payload after visibility **and** `allow_answer_review`; no endpoint edits or recalculates scores.
- Daily `pg_dump` backups stored off-server; test restore at least once before launch.
- DB and Redis not exposed to the internet (Docker internal network only).

### 3.12 Dependencies & supply chain
- Pin versions (`requirements.txt` with hashes / `package-lock.json`); Dependabot alerts.
- Install only well-known packages; review before adding new ones.

---

## 4. Security testing checklist (Phase-1)

- [x] In-app notifications: created only by server events (verified payment success, result visible) — no API can create or edit one; per-type allow-listed params (no provider data, contact data or amounts); own rows only (IDOR → 404); one per event by a unique index *(6B tests)*
- [x] Admin Panel sign-in: session cookie (httpOnly, Secure, SameSite=Lax) + CSRF on every unsafe request including login; admin role only, one generic error and identical 429s; admin-only throttle buckets (per IP + number, per IP) separate from student logins; session rotated, 12-hour lifetime, deleted on sign-out; audited with the real client IP behind nginx (`TRUSTED_PROXY_COUNT`); no tokens in browser storage; same-origin `/api/*` via nginx — `docs/DEPLOYMENT.md` *(Milestone 7 tests)*
- [x] Payment snapshot: `amount`/`currency`/`validity_days` frozen at initiation (database trigger refuses changes); every verified success path grants the snapshot, never the package's current validity; legacy rows backfilled from the audit history with reported fallbacks *(payment-safety slice tests, incl. a migration upgrade test)*
- [ ] Manual subscription grant idempotency (a repeated/concurrent identical grant must not extend twice) — **implemented in the grant-idempotency slice; tick when it is merged**: required `Idempotency-Key` (format-checked, ≤ 64, never logged in full), durable `GrantRequest` ledger written in the grant's own transaction (unique per admin + key), same-key replay with no mutation and no audit event, `409 idempotency_key_reused` for a different request, failed grants store nothing; admin session + CSRF + admin role unchanged *(tests: replay, key reuse, rollback, per-admin scope, permissions, threaded same-key / different-key / HTTP double-click races)*
- [x] Admin payments API: allow-listed only — no raw provider answer, event payloads, source IPs, provider session key, checkout URL, idempotency key or raw mobile number in list, detail or re-verify responses (planted-value regression tests); provider transaction ID on the detail only; exact-match search on reference/transaction ID only; the panel is read-only (no re-verify or status actions) *(7H tests)*
- [x] Dashboards: `/me/dashboard/` student JWT, own rows only, public ids only (no answers, prices, contact or payment data); `/admin/dashboard/` admin session + role only (student JWT/anonymous rejected), counts and sums only — no lists of people, contact messages, provider data or audit metadata *(6C tests)*
- [ ] Student API responses never contain `is_correct`/`explanation` before submission (automated test)
- [ ] Submit twice → one result; concurrent submit → one result
- [ ] Save at/after `deadline_at` → rejected (also during grace); submit after `deadline_at + grace` → not accepted, server finalizes (`server_auto`); Celery finalizes abandoned attempts
- [ ] Changing device clock does not change remaining time
- [ ] Student A cannot read Student B's attempt/result/payment (IDOR tests)
- [ ] Student token rejected on `/admin/*`
- [ ] Paid exam without subscription → 403
- [x] Fake payment callback without provider verification → payment stays pending *(M5 tests)*
- [x] Replayed success callback → no second subscription *(M5 tests, incl. concurrent callback/IPN/reconciliation)*
- [x] Tampered amount → payment fails verification *(M5 tests: amount, currency, reference, reused transaction ID)*
- [ ] OTP brute-force → locked after N tries; OTP resend cooldown works
- [ ] XSS payload in question text/announcement is neutralized *(3B: stored as plain text; clients must escape)*
- [ ] Production settings check fails with placeholder secrets / DEBUG on
- [ ] Deactivated user cannot log in or refresh
- [ ] Late join on a live exam gets only time until global end
- [ ] Retake blocked when `allow_retake=false` or `max_attempts` reached; live exam allows only one attempt
- [x] SSLCommerz success redirect without a valid Validation API response → no subscription *(M5 tests with mocked provider HTTP; live sandbox run pending credentials)*
- [ ] Public leaderboard never returns full name when mode is `masked`, and never phone/email
- [x] Contact form throttling and honeypot work; HTML in messages is not rendered *(6A tests: per-IP throttle counts invalid and honeypot posts too; spoofed X-Forwarded-For ignored; honeypot stores nothing and answers like a real submission; messages and CMS text stored as plain text; logs carry only the message id and language)*
- [ ] Bangla-digit phone/OTP input is accepted and normalized

---

## 5. Residual risks (accepted for Phase-1)

- No proctoring; off-device cheating is possible.
- Rooted devices can bypass `FLAG_SECURE`.
- No formal penetration test (Phase-2 item).
- Single server = single point of failure; mitigated only by backups.
- Password-reset enumeration via side channels outside the HTTP response: an attacker who owns the
  target number would of course see the SMS; queue/worker load is not observable to clients.
- `TRUSTED_PROXY_COUNT` misconfiguration (too high, or app reachable directly) lets clients pick
  their throttle IP — deployment checklist item.
- JTI-only refresh-token storage depends on simplejwt 5.5.1 internals (pinned; re-test on upgrade).
