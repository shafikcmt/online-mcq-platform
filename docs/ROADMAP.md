# Roadmap — Online MCQ Examination Platform (Phase-1)

> Status: **Planning document.** Order follows the module dependency order in `MODULES.md`.
> Each milestone = one or more `feature/*` branches merged into `develop` after review and tests.
> Durations are rough estimates for a single developer and should be adjusted with the client.

---

## 0. Working rules

- Branches: `main` (production releases) ← `develop` (integration) ← `feature/<name>`.
- Every milestone ends with: tests passing, lint passing, short demo, docs updated.
- No milestone adds features outside `PHASE_1_REQUIREMENTS.md` without explicit approval.
- Commit / push / deploy only when the project owner asks.

---

## Milestone 0 — Planning ✅ (this step)
- Requirement analysis, architecture, database, API, security, modules, roadmap, UI/UX guidelines, localization plan.
- Owner decisions recorded in §Decisions log.
- **Exit:** remaining open questions answered or explicitly deferred.

## Milestone 1 — Foundation (≈ 3–4 days)
Branch: `feature/project-foundation`
- Monorepo folders (`backend/`, `web/`, `admin/`, `mobile/`, `design/`).
- Django project with split settings (base/dev/prod), env loading, `core` app (base model, error handler, pagination, permissions).
- **i18n foundation:** `LANGUAGES = bn, en`, `LocaleMiddleware`, `locale/` folders, bilingual-field helper, digit/NFC normalization utilities.
- Docker Compose: postgres, redis, backend, celery worker, celery beat.
- Health-check endpoint, OpenAPI docs, pytest setup, ruff/black (lint/format), pre-commit.
- GitHub Actions CI: lint + tests on PRs to `develop`.
- **Exit:** `docker compose up` runs; `/api/v1/health` returns OK; CI green.

## Milestone 2 — Accounts & OTP (≈ 4–5 days)
Branches: `feature/accounts`, `feature/otp-verification`
- Custom user model (**mobile number mandatory**, email optional), student profile (language, display name), roles.
- OTP request/verify with hashed codes, cooldowns, limits; bilingual SMS templates; mock SMS provider + Celery task.
- Register (after SMS OTP), login with mobile + password, refresh, logout, **forgot/reset password via SMS OTP**, change password, profile.
- Throttles for OTP/login. Audit module basics.
- **Exit:** tests for registration/login/OTP/reset flows and throttling.

## Milestone 3 — Catalog, Question bank, Exams (≈ 5–6 days)
Branches: `feature/catalog`, `feature/questions`, `feature/exams`
- Category → Subject CRUD (one subject belongs to one category), bilingual fields.
- Question (belongs to a subject) + options CRUD, bilingual text, "exactly one correct", sanitization, optional images.
- Exam CRUD incl. content language, `allow_retake`, `max_attempts`, `merit_strategy`; assign/reorder questions, marks override, schedule, publish rules (incl. translation completeness), duplicate exam.
- Public exam listing endpoints.
- **Exit:** admin API tests; publish validation tests.

## Milestone 4 — Exam engine & Results (≈ 7–9 days) — highest-risk milestone
Branches: `feature/subscriptions-core`, `feature/exam-engine`, `feature/results-merit`
- Packages + access rules (all paid exams / selected categories / selected exams) + `user_can_access_exam` (subscriptions created in tests for now).
- Start/resume attempt with server-side eligibility & retake rules (live = 1 attempt), shuffle questions/options, snapshots, autosave + batch sync, server deadline (late joiners capped at global end), grace.
- Submit (idempotent, locked), auto-finalize Celery job.
- Scoring (marks, negative marks, percentage, pass/fail, time used), result visibility, review.
- Configurable merit (`first_attempt` / `best_attempt` / `latest_attempt`; live = single attempt) + leaderboard with masked/configurable names.
- **Exit:** full test suite for timing, double-submit, negative marking, answer-leak, IDOR.

## Milestone 5 — Payments & Subscriptions (≈ 5–7 days, depends on provider credentials)
Branch: `feature/payments`
- Payment state machine, `payment_events`, common `PaymentGateway` interface.
- Mock gateway end-to-end → subscription activation after verified success.
- **SSLCommerz** gateway in sandbox (session init, success/fail/cancel, IPN, Validation API), then live credentials.
- bKash/Nagad: **not built now** — added later as new gateway classes through the same interface.
- Reconciliation job, subscription expiry job, admin payment views.
- **Exit:** payment security checklist from `SECURITY_PLAN.md` passes in sandbox.

## Milestone 6 — CMS, Notifications, Dashboards API (≈ 3–4 days)
Branches: `feature/cms`, `feature/notifications`, `feature/dashboard-api`
- Bilingual site settings (default language, leaderboard name modes, app links), announcements, FAQ, pages.
- Website **contact form** endpoint + admin contact-message inbox.
- **In-app notifications only** (bilingual templates); push/SMS/email channels deferred.
- Admin dashboard (basic operational statistics) & student dashboard endpoints.

## Milestone 7 — Admin Panel (Next.js) (≈ 7–9 days)
Branch: `feature/admin-panel-*` (one per section)
- Layout shell, login, design tokens, i18n (বাংলা/English UI), reusable table/form/filter components, bilingual content editor.
- Sections: dashboard (basic reports), users, categories/subjects, questions, exams (+question picker, retake/merit settings), results, packages/subscriptions, payments, settings/content, contact messages, audit log.

## Milestone 8 — Mobile App (Expo) (≈ 10–12 days)
Branch: `feature/mobile-*`
- App shell, navigation, theme, i18n (বাংলা/English, bundled fonts), API client with token refresh, secure storage.
- Auth screens (register with mobile + SMS OTP, login, forgot password via OTP), profile/settings (language).
- Home dashboard, exam list/details, **exam room** (palette, timer, mark for review, local answer state + autosave + retry/sync after temporary connection loss — *not* a full offline mode, auto-submit, confirm submit), result, review, leaderboard, history.
- Packages & payment (SSLCommerz checkout in in-app browser + status polling), in-app notifications.
- **Exit:** tested on low-end and mid-range Android devices; poor-network test.

## Milestone 9 — Public Website (Next.js) (≈ 4–5 days)
Branch: `feature/public-website`
- `/bn` and `/en` routes, language switcher, `hreflang`.
- Home, exams (available/upcoming), packages, notices, leaderboard (masked names), About, Contact (**basic contact form**), FAQ, **Download App / Open App** flow. No website login. SEO meta, responsive QA.

## Milestone 10 — Hardening, QA & Deployment (≈ 4–5 days)
Branch: `release/1.0`
- Full requirement test checklist (see "Basic Testing & Delivery" in requirements) + bilingual QA (`LOCALIZATION.md` §11).
- Production compose, Nginx + TLS, backups, production settings checks, logging.
- Play Store build & listing support; deployment notes; source handover.

**Indicative total:** ~55–70 developer-days.

> ⚠ **Budget reality check:** the requirement's development budget (BDT 40,000) is very tight for
> this scope (three clients + payments + exam engine). This roadmap does not add scope, but the
> project owner should know that strict prioritization (and possibly trimming nice-to-haves like
> image questions, website leaderboard, or second payment provider) may be needed. This is a
> business decision, not a technical one.

---

## Priority within Phase-1 (if time gets tight)

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
| 12 | Leaderboard privacy | Configurable display-name mode (default masked), separately for website and app; never phone/email |
| 13 | Reports | Phase-1 = basic operational dashboard statistics; advanced analytics = Phase-2 |
| 14 | Answer saving | No full offline exam mode; local temporary state + server autosave + retry/sync after temporary disconnection; server is source of truth |
| 15 | Server-side controls | Timer, eligibility, submission, scoring, negative marking, payment verification, subscription access |

## Open questions (still unresolved)

1. **SMS provider:** which Bangladeshi SMS gateway (and sender ID) for OTP? Needed for real OTP testing. Bangla SMS costs more per message (70 chars/segment).
2. **SSLCommerz account:** sandbox store ID/password available now? Live merchant onboarding timeline?
3. **Default language:** Bangla as the platform default and English as the admin default — OK? Please also confirm the Bangla glossary in `LOCALIZATION.md` §10.1.
4. **Practice exams:** results shown immediately, unlimited retakes, no merit — OK as defaults?
5. **Answer review:** may students see correct answers + explanations after results are published (per-exam `allow_answer_review`, default on)?
6. **Merit tie-break:** marks ↓, then time used ↑, then submit time ↑ — OK?
7. **Default leaderboard name mode:** `masked` on the website and in the app — or `display_name`/full name inside the app?
8. **"Open App" flow:** a simple app URL scheme with Play Store fallback is planned; verified Android App Links / content deep links are listed as Phase-2 in the requirements — confirm that's sufficient.
9. **Contact form handling:** messages stored and shown in the Admin Panel only (email forwarding is a future extension) — OK?
10. **Admin roles:** is one "admin" role enough, or is a limited staff role (e.g. question editor) needed?
11. **Question format:** images in questions/options needed? Math formulas?
12. **Manual subscription grant** by admin (e.g. cash/offline payment) — allowed?
13. **Refunds/cancellations:** assumed out of scope — confirm.
14. **Hosting:** which server/provider for production; domain + subdomains (`api.`, `admin.`)?
15. **Two Next.js apps vs one:** plan uses separate `web/` and `admin/` apps; merge into one only if budget requires.
16. **Screenshot blocking** (`FLAG_SECURE`) on exam screens — wanted?
17. **Budget vs scope:** BDT 40,000 is tight for this scope (~55–70 dev-days estimated); confirm priorities using the table above.

---

## Definition of Done (each feature)

- Requirement item(s) referenced in the PR description.
- Unit/API tests written and passing; lint/format clean.
- No secrets in code; new env vars added to `.env.example` as placeholders.
- Migrations included and reviewed.
- Loading/empty/error states implemented (UI features).
- All user-facing text in translation files / bilingual fields; screen checked in **both** Bangla and English.
- Docs updated if API or data model changed.
