# Roadmap — Online MCQ Examination Platform (Phase-1)

> Status: **Planning document.** Order follows the module dependency order in `MODULES.md`.
> Each milestone = one or more `feature/*` branches merged into `develop` after review and tests.
>
> **Progress is milestone-based, not day-based.** There are no fixed durations or deadlines in this
> roadmap. A milestone is finished when its completion criteria and checks pass — as soon as that
> happens, the next milestone starts. Milestones whose dependencies are met may run in parallel.

---

## 0. Working rules

- Branches: `main` (production releases) ← `develop` (integration) ← `feature/<name>`.
- Every milestone ends with: completion criteria met, tests passing, lint passing, short demo, docs updated.
- No milestone adds features outside `PHASE_1_REQUIREMENTS.md` without explicit approval.
- Commit / push / deploy only when the project owner asks.
- Bilingual (বাংলা / English) and the UI/UX guidelines apply to every milestone that touches user-facing text or screens.

### Milestone overview

| # | Milestone | Depends on | Can run in parallel with |
|---|---|---|---|
| 0 | Planning ✅ | — | — |
| 1 | Foundation | 0 | — |
| 2 | Accounts & OTP | 1 | 6 (CMS part) |
| 3 | Catalog, Question bank, Exams | 1, 2 (admin auth) | 6 |
| 4 | Exam engine & Results | 3 | 6 |
| 5 | Payments & Subscriptions | 4 (packages/access), SSLCommerz sandbox credentials | 6, 7 (early sections) |
| 6 | CMS, Notifications, Dashboard API | 1 (CMS); 4–5 (notification triggers, stats) | 3–5 |
| 7 | Admin Panel | API of 2–3 for first sections; 4–6 for the rest | 8, 9 |
| 8 | Mobile App | API of 2, 4, 5 | 7, 9 |
| 9 | Public Website | Public API (3, 6) | 7, 8 |
| 10 | Hardening, QA & Deployment | 1–9; hosting decision | — |

---

## Milestone 0 — Planning ✅
- **Scope:** requirement analysis; architecture, database, API, security, modules, roadmap, UI/UX and localization plans; owner decisions recorded in §Decisions log.
- **Completion criteria:** documents reviewed; remaining open questions answered or explicitly deferred.

---

## Milestone 1 — Foundation
Branch: `feature/project-foundation`

- **Scope**
  - Monorepo folders (`backend/`, `web/`, `admin/`, `mobile/`, `design/`).
  - Django project with split settings (base/dev/prod), env loading, `core` app (base model, error handler, pagination, permissions).
  - **i18n foundation:** `LANGUAGES = bn, en`, `LocaleMiddleware`, `locale/` folders, bilingual-field helper, Bangla-digit and NFC normalization utilities.
  - Docker Compose: postgres, redis, backend, celery worker, celery beat.
  - Health-check endpoint, OpenAPI docs, pytest, ruff/black (lint/format), pre-commit.
  - GitHub Actions CI: lint + tests on PRs to `develop`.
- **Dependencies:** Milestone 0.
- **Completion criteria:** `docker compose up` starts all services; `/api/v1/health` returns OK; OpenAPI docs load; CI green on a PR.
- **Tests/checks:** health-check test; i18n helper unit tests (language fallback, digit normalization, NFC); settings check rejects placeholder `SECRET_KEY` / `DEBUG=True` in production mode; lint passes.
- **Risks:** over-building infrastructure too early → keep only what later milestones need; environment differences between dev machines → everything via Docker Compose.

## Milestone 2 — Accounts & OTP
Branches: `feature/accounts`, `feature/otp-verification`

- **Scope**
  - Custom user model (**mobile number mandatory**, email optional), student profile (language, display name), roles.
  - OTP request/verify with hashed codes, cooldowns, limits; bilingual SMS templates; mock SMS provider + Celery task; SMS gateway adapter interface.
  - Register (after SMS OTP), login with mobile + password, refresh, logout, **forgot/reset password via SMS OTP**, change password, profile.
  - Throttles for OTP/login. Audit module basics.
- **Dependencies:** Milestone 1. Real SMS provider credentials only needed for final OTP testing (mock works until then).
- **Completion criteria:** a student can register, verify OTP, log in, refresh, log out and reset password via the API in both languages; admin user can be created by management command.
- **Tests/checks:** registration/login/OTP/reset flows; OTP expiry, single use, wrong-attempt lock, resend cooldown; throttling; password reset revokes refresh tokens; deactivated user rejected; Bangla-digit phone input accepted; no OTP/password in logs.
- **Risks:** custom user model must be right **before the first migration**; SMS provider not chosen yet (mitigated by mock adapter); SMS abuse/cost (throttles).
- **Note (Milestone 2C):** the "audit module basics" item is **intentionally deferred to Milestone 3**, where the first admin actions (catalog, questions, exams) exist to be audited. Milestone 2 logs security events (logins, OTP, password changes) to the application log with masked mobile numbers.

## Milestone 3 — Catalog, Question bank, Exams
Branches: `feature/catalog`, `feature/questions`, `feature/exams`

- **Scope**
  - Category → Subject CRUD (one subject belongs to one category), bilingual fields.
  - Question (belongs to a subject) + options CRUD, bilingual text, "exactly one correct", sanitization, optional images.
  - Exam CRUD incl. content language, `allow_retake`, `max_attempts`, `merit_strategy`; assign/reorder questions, marks override, schedule, publish rules (incl. translation completeness), duplicate exam.
  - Public exam listing endpoints.
- **Dependencies:** Milestone 1; Milestone 2 for admin authentication/permissions.
- **Completion criteria:** an admin can build and publish a complete exam through the API; public endpoints list published exams without questions.
- **Tests/checks:** admin-only permissions; one-correct-option rule; publish validation (question count, schedule, translations, live = 1 attempt); delete protection for used items; XSS sanitization; public endpoints never expose questions/answers.
- **Risks:** editing questions after they are used in attempts (edit locks); bilingual validation rules too strict/too loose — confirm with real admin content.

## Milestone 4 — Exam engine & Results (highest-risk milestone)
Branches: `feature/subscriptions-core`, `feature/exam-engine`, `feature/results-merit`

- **Scope**
  - Packages + access rules (all paid exams / selected categories / selected exams) + `user_can_access_exam` (subscriptions created in tests for now).
  - Start/resume attempt with server-side eligibility & retake rules (live = 1 attempt), shuffle questions/options, snapshots, autosave + batch sync, server deadline (late joiners capped at global end), grace.
  - Submit (idempotent, locked), auto-finalize Celery job.
  - Scoring (marks, negative marks, percentage, pass/fail, time used), result visibility, answer review.
  - Configurable merit (`first_attempt` / `best_attempt` / `latest_attempt`; live = single attempt) + leaderboard with masked/configurable names.
- **Dependencies:** Milestone 3.
- **Completion criteria:** a student can start, answer, resume, submit (or be auto-submitted) and see a correct result and merit position, entirely via the API, with all exam-integrity rules enforced server-side.
- **Tests/checks:** timing & deadline (incl. late join, grace, device-clock independence); double and concurrent submit; retake limits; negative-marking and scoring edge cases (all wrong, all unanswered, negative totals); correct answers never in pre-submit responses; IDOR; result visibility modes; merit strategies and tie-break; leaderboard name masking.
- **Risks:** race conditions on submit (row locks + constraints); time-zone/clock bugs (UTC + server time); scoring errors damage trust (heavy unit tests); auto-finalize job failures (idempotent job + monitoring).

## Milestone 5 — Payments & Subscriptions
Branch: `feature/payments`

- **Scope**
  - Payment state machine, `payment_events`, common `PaymentGateway` interface.
  - Mock gateway end-to-end → subscription activation after verified success.
  - **SSLCommerz** gateway in sandbox (session init, success/fail/cancel, IPN, Validation API), then live credentials.
  - bKash/Nagad: **not built now** — added later as new gateway classes through the same interface.
  - Reconciliation job, subscription expiry job, admin payment views.
- **Dependencies:** Milestone 4 (packages & access rules); SSLCommerz sandbox credentials for the real-gateway part (mock gateway can proceed without them).
- **Completion criteria:** buying a package through SSLCommerz sandbox activates exactly one subscription only after server-side validation; failed/cancelled/tampered payments never grant access.
- **Tests/checks:** payment security checklist in `SECURITY_PLAN.md` (fake callback, replay, tampered amount, idempotency); subscription extension rules; expiry job; reconciliation of stuck pending payments.
- **Risks:** waiting on merchant credentials/onboarding (mitigated by mock gateway); provider API changes or sandbox downtime; callback URL reachability in development (use a tunnel or staging server).

## Milestone 6 — CMS, Notifications, Dashboard API
Branches: `feature/cms`, `feature/notifications`, `feature/dashboard-api`

- **Scope**
  - Bilingual site settings (default language, leaderboard name modes, app links), announcements, FAQ, pages.
  - Website **contact form** endpoint + admin contact-message inbox.
  - **In-app notifications only** (bilingual templates); push/SMS/email channels deferred.
  - Admin dashboard (basic operational statistics) & student dashboard endpoints.
- **Dependencies:** Milestone 1 for CMS; Milestones 4–5 for notification triggers (result published, payment success) and dashboard statistics.
- **Completion criteria:** all public content endpoints serve both languages; notifications are created on the defined events; dashboards return correct counts.
- **Tests/checks:** content fallback between languages; contact form validation, throttling, honeypot; notifications re-render in the reader's language; dashboard numbers match seeded data; admin-only access to stats.
- **Risks:** scope creep toward a full CMS or advanced reports (Phase-2) — keep to the listed items.

## Milestone 7 — Admin Panel (Next.js)
Branch: `feature/admin-panel-*` (one per section)

**Status:** every section listed below now has a screen (7A–7H, then subscription grant/extend/cancel, payment re-verify, website content, site settings, contact inbox and the audit log). Bilingual and accessibility review of the whole panel remains part of Milestone 10.

- **Scope**
  - Layout shell, login, design tokens, i18n (বাংলা/English UI), reusable table/form/filter components, bilingual content editor.
  - Sections: dashboard (basic reports), users, categories/subjects, questions, exams (+question picker, retake/merit settings), results, packages/subscriptions, payments, settings/content, contact messages, audit log.
- **Dependencies:** backend APIs for each section (first sections need Milestones 2–3; results, payments and dashboard need 4–6).
- **Completion criteria:** an admin can run the whole platform from the panel — content, exams, results, packages, payments, settings — in either language.
- **Tests/checks:** component tests for shared table/form/filter; end-to-end smoke tests of key flows (create question → build exam → publish → publish results); CSRF/cookie auth; non-admin rejected; loading/empty/error states present; responsive check (tablet/mobile); both languages reviewed.
- **Risks:** exam builder UX complexity (question picker, reordering); inconsistency across sections (enforce shared components from `UI_UX_GUIDELINES.md`).

## Milestone 8 — Mobile App (Expo)
Branch: `feature/mobile-*`

**Status:** 8A built — app shell (Expo SDK 58, Expo Router, own theme from the shared tokens, bundled Inter + Noto Sans Bengali), Bangla/English with a first-launch choice, API client with secure token storage and refresh, registration with SMS code, sign-in, forgot password, Profile (details, edit, language synced to the account, change password, sign out). 8B built — Home dashboard from `GET /me/dashboard/`: exams open now / upcoming / practice with the server's start/resume/access flags, active packages, recent results (marks, pass/fail, merit), unread notification count, countdowns from server time, quiet reload on return and pull-to-refresh, last data kept on a failed reload. 8C built — Exams tab (open now / upcoming / past, paged) and exam details (facts, instructions, what the student can do and why not), from the new student endpoints `GET /exams/` and `GET /exams/{slug}/` (public fields + the exam engine's start state; the dashboard now uses the same selector); Home cards open the details. 8D built — exam room: start after a confirmation / continue, one question at a time, palette, mark for review, question language switch for bilingual exams, countdown to the server's `deadline_at` on the server clock, answers kept on the phone until the server confirms them (batch save, retried after a connection drop, re-sent after a restart; the server's newer answer wins), submit with a summary and a stored Idempotency-Key, automatic submit at the deadline, the result when the exam shows it at once, screen kept awake. 8E built — Results tab (published results; history of every attempt, open ones lead back to the room), result details (marks, percentage, pass/fail, counts, negative marking, time used, merit position), answer review with filters (only when the server allows it), exam leaderboard (own position, names as the server's privacy mode sends them). 8F built — Packages tab (prices and features from the server, own subscription → Extend), buy: confirm → `POST /payments/` (package id + Idempotency-Key only) → provider page in an in-app browser → payment screen polling the server (success only when the server verified it), payment history, return link `livemodeltest://payment-result` (its status ignored), "See packages" from locked paid exams and Home; new student endpoint `GET /packages/` (public fields + id + own subscription). 8G built — in-app notifications: the Home bell opens the student's notifications (result published, payment successful; opening one marks it read and goes to the result or payment; mark all as read) and the admin's notices for students. **All Milestone 8 screens are built.** Still open for the milestone's completion criteria (Milestone 10 work): testing on real low-end and mid-range Android devices, a poor-network run and font scale 1.3× on a device, the Play Store build.

- **Scope**
  - App shell, navigation, theme, i18n (বাংলা/English, bundled fonts), API client with token refresh, secure storage.
  - Auth screens (register with mobile + SMS OTP, login, forgot password via OTP), profile/settings (language).
  - Home dashboard, exam list/details, **exam room** (palette, timer, mark for review, local answer state + autosave + retry/sync after temporary connection loss — *not* a full offline mode, auto-submit, confirm submit), result, review, leaderboard, history.
  - Packages & payment (SSLCommerz checkout in in-app browser + status polling), in-app notifications.
- **Dependencies:** APIs from Milestones 2, 4 and 5 (6 for notifications/dashboard).
- **Completion criteria:** a student can complete the full journey on a real Android device: register → buy package → take exam → see result & merit, in both languages.
- **Tests/checks:** exam room tests (timer from server time, auto-submit, resume after app kill, connection drop and resync); tested on low-end and mid-range Android devices; poor-network test; font scale 1.3×; both languages; tokens only in SecureStore.
- **Risks:** low-end device performance in the exam room; unreliable networks (retry/sync design); payment return flow from the in-app browser; Play Store policy requirements.

## Milestone 9 — Public Website (Next.js)
Branch: `feature/public-website`

**Status:** 9A built — Next.js site in `web/`: `/bn` and `/en` (Bangla default, English browsers get English, the choice is remembered), header/footer with the language switch and Download / Open App (Android tries the app, falls back to the store; "coming soon" until a store link is set), Home with live public-API data (open and upcoming exams, packages, notices, FAQs) and SEO basics (titles, descriptions, canonical, `hreflang`, Open Graph, sitemap, robots). 9B built — `/exams` (Open now / Upcoming / Ended tabs, category / type / free-paid filters and pages in the address, no JavaScript needed; backend `GET /public/exams/?when=open|upcoming|ended`), `/exams/{slug}` (rules, schedule, instructions, the way to the app; in the sitemap), `/packages` (all packages, how buying works), a localized 404. 9C built — `/notices` (website notices, pinned first, full text, pages), `/leaderboard` (exams with a public merit list; backend `GET /public/leaderboards/`) and `/exams/{slug}/leaderboard` (top N with names shortened by the privacy setting, marks, percent, time; the exam page links to it). 9D built — `/about` (CMS page "about", site text as fallback), `/faq` (accordion + FAQPage structured data), `/contact` (Site-settings contact details + the contact form posting to the same-origin public API: field checks, backend field errors, throttled/failed states, honeypot); desktop header keeps the main sections, footer and phone menu list every page. 9E done — quality pass: axe-core WCAG 2.1 A/AA check of every page in both languages at phone and desktop width (`web/e2e/accessibility.spec.ts`, 0 violations); Lighthouse (mobile) on 8 key pages: Accessibility, Best Practices and SEO 100, Performance 93–96 (Home 78 → 94 after self-hosted preloaded fonts via `next/font` with only the Latin + Bengali subsets, and the logo through `next/image`), layout shift 0. **Milestone 9 complete**; the deployment-time items (nginx route for `/api/v1/public/`, real-device checks) are in Milestone 10.

- **Scope**
  - `/bn` and `/en` routes, language switcher, `hreflang`.
  - Home, exams (available/upcoming), packages, notices, leaderboard (masked names), About, Contact (**basic contact form**), FAQ, **Download App / Open App** flow. No website login. SEO metadata.
- **Dependencies:** public API (Milestones 3 and 6).
- **Completion criteria:** all pages live in both languages, responsive on mobile/tablet/desktop, data from the API, contact form working.
- **Tests/checks:** responsive testing (requirement); Lighthouse performance/accessibility/SEO pass on key pages; `hreflang`/`lang` correct; contact form errors and success state; no private data on public leaderboards.
- **Risks:** "Open App" behavior differs between browsers/devices (Play Store fallback); content not ready in both languages at launch.

## Milestone 10 — Hardening, QA & Deployment
Branch: `release/1.0`

**Status:** 10A done — bilingual QA (`LOCALIZATION.md` §11): every checklist item is now backed by a named automated test. Found and fixed: Bangla times showed an English "AM/PM" in all three clients — they now name the part of the day ("সকাল ৬:২৯"). New tests: Bangla-digit marks/minutes/price input, the question-language switch keeps the selected answer. Open owner decision: the Admin Panel shows Western digits in Bangla (the rule asks for Bangla digits). 10B done — security checklist (`SECURITY_PLAN.md` §4): all 30 items checked, each naming its test; gaps closed with new tests (public leaderboard never contains a full name, phone or email; the website's only raw HTML — FAQ structured data — is escaped by a tested `jsonLd()`; an XSS notice shows as text and never runs, website E2E). Still for deployment: the live SSLCommerz sandbox run and real-provider SMS checks (credentials).

- **Scope**
  - Full requirement test checklist ("Basic Testing & Delivery") + bilingual QA (`LOCALIZATION.md` §11) + security checklist (`SECURITY_PLAN.md` §4).
  - Production compose, Nginx + TLS, backups, production settings checks, logging.
  - Play Store build & listing support; deployment notes; source handover.
- **Dependencies:** Milestones 1–9; hosting server, domain and live SMS/SSLCommerz credentials from the client.
- **Completion criteria:** production environment running over HTTPS with real SMS and SSLCommerz; backup restore tested once; app published (or submitted) to Google Play; deployment notes delivered.
- **Tests/checks:** end-to-end acceptance run on production-like environment; backup/restore test; production settings check; smoke test after deployment.
- **Risks:** delays from external parties (hosting, merchant approval, Play Store review); environment-specific bugs (staging mirrors production).

> **Scope note:** the development budget in the requirements is fixed and the Phase-1 scope is large
> (three clients + exam engine + payments). This roadmap adds no scope; if trade-offs are ever needed,
> use the priority table below. This is a business decision, not a technical one.

---

## Priority within Phase-1 (if trade-offs are needed)

| Must-have (core of the product) | Should-have | Could-have (simplest version only) |
|---|---|---|
| Auth + SMS OTP, bilingual i18n foundation, exam engine, server-side scoring, admin question/exam management, SSLCommerz payment, subscriptions | Merit/leaderboard, result publish/hide, in-app notifications, public website pages, contact form | Random option order, question images, website leaderboard, difficulty level, mark-for-review polish |

---

## Decisions log (approved by project owner)

| # | Topic | Decision |
|---|---|---|
| 1 | Registration | Mobile number **mandatory**; SMS OTP verification **mandatory**; email optional; password reset via SMS OTP |
| 2 | Language | Whole platform bilingual — Bangla + English; i18n structure from the start; no hard-coded user-facing text (`LOCALIZATION.md`) |
| 3 | Reference website | Inspiration only; if not accessible, don't retry and don't block work |
| 4 | UI/UX | Modern, clean, responsive, consistent across app, website, admin, exam, results, leaderboard, packages, subscription, payment, reports, settings |
| 5 | Payment | Common gateway interface for SSLCommerz, bKash, Nagad; **SSLCommerz first**; verification always server-side |
| 6 | Notifications | Phase-1 = in-app only; push/SMS/email are future extensions |
| 7 | Attempts | Regular exams: admin-configurable `allow_retake` + `max_attempts`; live exams: one attempt; late joiners get time only until the global end |
| 8 | Merit | Live = the single submitted attempt; regular = configurable `merit_strategy` (first/best/latest) via `results.is_merit_counted` — no redesign needed |
| 9 | Academic structure | Category → many Subjects → many Questions; one subject belongs to one category |
| 10 | Packages | Can grant all paid exams, selected categories, selected exams |
| 11 | Website | No exams, no login (Phase-1); basic contact form; Download App / Open App flow |
| 12 | Leaderboard privacy | Display-name mode defaults to `masked` on both the public website and the app; phone/email are never exposed; the mode becomes configurable (separately for website and app) through the Milestone 6 site settings *(built in 6A: `GET/PATCH /admin/settings/`)* |
| 13 | Reports | Phase-1 = basic operational dashboard statistics; advanced analytics = Phase-2 |
| 14 | Answer saving | No full offline exam mode; local temporary state + server autosave + retry/sync after temporary disconnection; server is source of truth |
| 15 | Server-side controls | Timer, eligibility, submission, scoring, negative marking, payment verification, subscription access |
| 17 | Answer review *(decided in Milestone 4C; was open question 5)* | Correct answers and explanations are shown **only** when the attempt is finalized **and** its result is visible (per `result_visibility` / admin publication) **and** the exam's `allow_answer_review` is on (default on). Otherwise no answer key or explanation is exposed anywhere |
| 18 | Merit order and ties *(decided in Milestone 4C; was open question 6)* | Merit order: obtained marks ↓, then time used ↑, then submit time ↑, then the attempt's stable id ↑ as the final deterministic key. Positions are **sequential, never shared**: an exact tie (same marks, time and submit instant) still gets 1, 2, … by the final key. One position per student per exam (`UNIQUE(exam, merit_position)`) |
| 19 | Verified payment after deactivation *(decided in Milestone 5)* | A payment the provider verifies as genuinely paid is **honoured** even if the package or the student account became inactive after initiation (`grant_subscription(for_verified_payment=True)`). Normal account restrictions still apply: an inactive account cannot use protected resources (e.g. cannot open exams) |
| 20 | Payment edge cases *(decided in Milestone 5)* | SSLCommerz `risk_level = 1` → the payment stays `pending` (`provider_risk_review`), no access, admin review. An **explicit provider "not found"** after `PAYMENT_ABANDON_AFTER_SECONDS` (24 h) may close a payment as `failed` (`abandoned`); timeouts, network errors, 5xx, malformed answers and provider outages never count as "not found". A `failed`/`cancelled` payment may become `success` **only** through the server-to-server verified late-success path (`late_provider_success`: provider, reference, amount, currency and an unused transaction ID must match; the payment itself then creates/extends the subscription); contradictory answers are recorded and left for admin review. A manual grant is never used as a substitute for a genuinely verified paid transaction. Zero-price packages never enter the payment flow (free/manual entitlement uses the existing non-payment grant) |
| 21 | Payment buys a fixed duration *(decided in the payment-safety slice after 7H; closes the M5 validity debt)* | A payment snapshots the package's `validity_days` at checkout together with `amount`/`currency`; the three are immutable (database trigger). Every verified success (callback, IPN, late success, reconciliation, admin re-verify) creates or extends the subscription by that snapshot — editing a package never changes what was already bought. Manual admin grants keep using the package's current validity. Payments created before the change were backfilled from the package audit history (reported fallbacks); historical subscriptions are not rewritten. Manual-grant idempotency: decisions log #22 |
| 22 | Manual grant idempotency *(decided in the grant-idempotency slice; the debt is closed when that slice is merged)* | `POST /admin/subscriptions/grant/` requires an `Idempotency-Key` (`^[A-Za-z0-9._:-]{1,64}$`), scoped to the signed-in admin. A durable ledger (`GrantRequest`, unique per admin + key) is written in the grant's own transaction. Same key + same request (as originally sent) → replay: original status, current subscription state, `Idempotent-Replayed: true`, no mutation and no audit event. Same key + different request → `409 idempotency_key_reused`. Different keys stay separate intentional grants (no payload-based deduplication). Failed grants store nothing (the key may be retried). Concurrent identical requests grant once. Grant price, validity and extension rules and cancel behaviour are unchanged |
| 23 | Admin payment re-verify *(decided in the re-verify-guards slice)* | A successful payment is final: re-verify refuses it (`409 already_successful`) without asking the provider. Each payment is queried at most once per `PAYMENT_REVERIFY_COOLDOWN_SECONDS` (default 60; an atomic claim on `last_checked_at`, which callbacks and reconciliation also set) → `429` + `Retry-After`. Failed/cancelled payments remain re-verifiable (late-success recovery, decisions log #20). The Admin Panel offers it as "Re-verify with provider" after a confirmation; it never sets a status by itself |
| 24 | Brand, domain and app identity *(owner, during Milestone 8)* | Product name **Live Model Test** (বাংলা: **লাইভ মডেল টেস্ট**), domain **livemodeltest.com**, the owner-supplied logo (hexagon MCQ mark; `admin/public/brand/logo-mark.png`, `mobile/assets/images/`). Android package `com.livemodeltest.app`, app URL scheme `livemodeltest` (set the backend's `APP_DEEP_LINK_SCHEME` to the same value). The package name cannot change after the first Play Store upload |
| 16 | Manual subscription grant *(decided in Milestone 4A; was open question 12)* | **Allowed in Phase-1** for support, testing and legitimate manual entitlements (e.g. offline payment). Admin-only: admin session + CSRF + `admin` role (`POST /admin/subscriptions/grant`); never exposed to students or the public. Every grant and extension is written to the audit log. No Payment row is required. Payment-created subscriptions arrive in Milestone 5 through the same `grant_subscription` service |

## Open questions (still unresolved)

1. **SMS provider:** which Bangladeshi SMS gateway (and sender ID) for OTP? Needed for real OTP testing. Bangla SMS costs more per message (70 chars/segment).
2. **SSLCommerz account:** sandbox store ID/password available now? Live merchant onboarding timeline?
3. **Default language:** Bangla as the platform default and English as the admin default — OK? Please also confirm the Bangla glossary in `LOCALIZATION.md` §10.1.
4. **Practice exams:** results shown immediately, unlimited retakes, no merit — OK as defaults?
5. ~~**Answer review**~~ — **resolved in Milestone 4C** (Decisions log #17).
6. ~~**Merit tie-break**~~ — **resolved in Milestone 4C** (Decisions log #18).
7. ~~**Default leaderboard name mode**~~ — **resolved:** `masked` on both the website and the app, configurable per channel later in the Milestone 6 site settings (Decisions log #12).
8. **"Open App" flow:** a simple app URL scheme with Play Store fallback is planned; verified Android App Links / content deep links are listed as Phase-2 in the requirements — confirm that's sufficient.
9. **Contact form handling:** messages stored and shown in the Admin Panel only (email forwarding is a future extension) — OK?
10. **Admin roles:** is one "admin" role enough, or is a limited staff role (e.g. question editor) needed?
11. **Question format:** images in questions/options needed? Math formulas?
12. ~~**Manual subscription grant** by admin~~ — **resolved in Milestone 4A:** allowed, admin-only and audited (Decisions log #16).
13. **Refunds/cancellations:** assumed out of scope — confirm.
14. **Hosting:** which server/provider for production? *(Domain decided: `livemodeltest.com`, decisions log #24; the subdomains — planned `api.` and `admin.` — still to confirm.)*
15. **Two Next.js apps vs one:** plan uses separate `web/` and `admin/` apps; merge into one only if budget requires.
16. **Screenshot blocking** (`FLAG_SECURE`) on exam screens — wanted?
17. **Priorities:** confirm the must/should/could priority table above, in case scope trade-offs are ever needed.

---

## Definition of Done (each feature)

- Requirement item(s) referenced in the PR description.
- Unit/API tests written and passing; lint/format clean.
- No secrets in code; new env vars added to `.env.example` as placeholders.
- Migrations included and reviewed.
- Loading/empty/error states implemented (UI features).
- All user-facing text in translation files / bilingual fields; screen checked in **both** Bangla and English.
- Docs updated if API or data model changed.
