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
- OTP verification returns a short-lived, single-use `verification_token` bound to phone + purpose.
- `SMS_PROVIDER=mock` in dev logs the code to the console — **never enabled in production** (startup check).

### 3.3 Authorization
- Default DRF permission = **IsAuthenticated**; public endpoints explicitly opt out.
- Role check (`IsAdminRole`) on every `/admin/*` view via a shared base class — not per-view copy-paste.
- **Object-level ownership**: student querysets always filtered by `request.user` (prevents IDOR — reading someone else's attempt by guessing the ID). Attempts/payments also use UUIDs.
- Paid exam access is checked **server-side** at attempt start (subscription active & package rule matches).
- Admin cannot be created through public registration; first admin created by `createsuperuser`/management command.

### 3.4 Exam integrity (most important for this product)
| Risk | Control |
|---|---|
| Reading correct answers from API traffic | Student serializers never include `is_correct` / `explanation`; tests assert their absence. Answers revealed only after submit + visible result + `allow_answer_review` |
| Extending time by changing phone clock | Server computes `deadline_at`; client only displays it using `server_time` offset |
| Submitting late | Answers/submit rejected after `deadline_at + grace` (grace configurable, small) |
| Double submit / race from two devices | Row lock + status check + one-to-one result; only one open attempt per exam (partial unique index) |
| Re-taking to improve merit | Live exams: exactly one attempt. Regular: `allow_retake` + `max_attempts` enforced server-side; the merit attempt is chosen by the exam's `merit_strategy` on the server — never by the client |
| Joining a live exam late to get extra time | `deadline_at` capped at the exam's global `end_at` |
| Losing answers / injecting answers after time | No offline exam mode: answers count only when the server receives them before `deadline_at + grace`; retried saves carry `client_saved_at` only for ordering, never for timing |
| Bypassing eligibility (paid/locked exam) | Eligibility (published, schedule, subscription access, attempt limit) re-checked on the server at start **and** on every save/submit |
| Submitting an option from a different question | Server validates option belongs to the question in this attempt |
| Changing marks via request | Marks never accepted from client; snapshot from server at attempt start |
| Abandoning attempt to avoid a bad score | Celery auto-finalizes expired attempts |
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

### 3.6 Input validation & injection
- All input passes through DRF serializers (types, lengths, choices, ranges).
- Django ORM parameterized queries → SQL injection protection. **No raw SQL with string formatting.**
- Rich text (question text, explanations, announcements): sanitized on save with an allow-list HTML sanitizer (e.g. `nh3`/`bleach`), and rendered safely on clients (React escapes by default; no `dangerouslySetInnerHTML` without sanitized content).
- Text is **Unicode NFC-normalized**; Bangla and Western digits normalized in numeric inputs on the server.
- **Contact form:** throttled per IP, hidden honeypot field, length limits, stored as plain text (escaped on display in admin), no file attachments.
- File uploads (images): extension + MIME + real image check (Pillow), size limit (e.g. 2 MB), random file names, served as static files, never executed.
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
- `audit_logs` table for admin actions (who, what, when, from which IP).
- Production errors: generic message to the client, stack trace in server logs only.
  (Optional: Sentry — external cost, client decision.)

### 3.11 Data protection & backups
- Collect only needed personal data (name, phone, email, optional institution).
- Leaderboards use a **configurable display-name mode** (default `masked`, e.g. `Rah*** H.`; alternatives initials / student-chosen display name / full name) set separately for the public website and the app. Phone numbers and emails are never shown.
- Daily `pg_dump` backups stored off-server; test restore at least once before launch.
- DB and Redis not exposed to the internet (Docker internal network only).

### 3.12 Dependencies & supply chain
- Pin versions (`requirements.txt` with hashes / `package-lock.json`); Dependabot alerts.
- Install only well-known packages; review before adding new ones.

---

## 4. Security testing checklist (Phase-1)

- [ ] Student API responses never contain `is_correct`/`explanation` before submission (automated test)
- [ ] Submit twice → one result; concurrent submit → one result
- [ ] Submit after deadline + grace → rejected; Celery finalizes abandoned attempt
- [ ] Changing device clock does not change remaining time
- [ ] Student A cannot read Student B's attempt/result/payment (IDOR tests)
- [ ] Student token rejected on `/admin/*`
- [ ] Paid exam without subscription → 403
- [ ] Fake payment callback without provider verification → payment stays pending
- [ ] Replayed success callback → no second subscription
- [ ] Tampered amount → payment fails verification
- [ ] OTP brute-force → locked after N tries; OTP resend cooldown works
- [ ] XSS payload in question text/announcement is neutralized
- [ ] Production settings check fails with placeholder secrets / DEBUG on
- [ ] Deactivated user cannot log in or refresh
- [ ] Late join on a live exam gets only time until global end
- [ ] Retake blocked when `allow_retake=false` or `max_attempts` reached; live exam allows only one attempt
- [ ] SSLCommerz success redirect without a valid Validation API response → no subscription
- [ ] Public leaderboard never returns full name when mode is `masked`, and never phone/email
- [ ] Contact form throttling and honeypot work; HTML in messages is not rendered
- [ ] Bangla-digit phone/OTP input is accepted and normalized

---

## 5. Residual risks (accepted for Phase-1)

- No proctoring; off-device cheating is possible.
- Rooted devices can bypass `FLAG_SECURE`.
- No formal penetration test (Phase-2 item).
- Single server = single point of failure; mitigated only by backups.
