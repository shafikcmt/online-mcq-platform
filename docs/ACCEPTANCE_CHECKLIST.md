# Phase-1 Acceptance Checklist

> Every requirement in `docs/requirements/PHASE_1_REQUIREMENTS.md`, in its own order, with
> where it lives and what proves it. Written in Milestone 10C as the basis for the client's
> acceptance review. **Status:** ✅ done · 🟡 done with a note / owner decision · ⏳ needs the
> client's accounts, server or devices (Milestone 10 deployment) · ➖ not required.
>
> Test suites: backend `backend/tests/` (pytest), Admin Panel `admin/tests/` (Vitest) +
> `admin/e2e/` (Playwright, real stack), Mobile App `mobile/tests/` (Jest) + `mobile/e2e/`
> (Playwright on the app's web build), Website `web/tests/` (Vitest) + `web/e2e/`. The
> security and bilingual checklists are `SECURITY_PLAN.md` §4 and `LOCALIZATION.md` §11.

## Included platforms

| Requirement | Status | Where / evidence |
|---|---|---|
| Android Mobile Application (primary exam interface) | ✅ ⏳ | `mobile/` (Expo, Android package `com.livemodeltest.app`). Play Store build and real-device checks need the client's Play Console account and phones |
| Web-based Admin Panel | ✅ | `admin/` (Milestone 7) |
| Public Responsive Website | ✅ | `web/` (Milestone 9) |
| Secure Backend/API | ✅ | `backend/` (Django REST Framework) |
| Central PostgreSQL Database | ✅ | `DATABASE_DESIGN.md`; migrations checked in CI |

## Mobile App

| Requirement | Status | Where / evidence |
|---|---|---|
| Registration using mobile number and/or email | ✅ | Mobile mandatory, email optional (decision #1). `mobile/e2e/auth.spec.ts`, `backend/tests/test_auth_api.py` |
| SMS OTP verification during registration | ✅ ⏳ | `test_verification.py`; real SMS provider: client account (open question 1) |
| Login / logout | ✅ | `auth.spec.ts`; logout revokes the refresh token |
| Forgot password / password reset | ✅ | `auth.spec.ts` (reset by SMS code), `test_auth_api.py` |
| Basic profile management | ✅ | Profile → edit; `mobile/tests/profile.test.tsx` |
| Basic account settings | ✅ | Language (synced to the account), change password |
| Dashboard: available / upcoming / practice exams | ✅ | Home; `mobile/e2e/dashboard.spec.ts`, `test_dashboard.py` |
| Free and paid labels / status | ✅ | Exam cards and details |
| Active subscription / package status | ✅ | Home + Packages tab |
| Recent results; exam history | ✅ | Home + Results tab (every attempt); `mobile/e2e/results.spec.ts` |
| Basic merit / leaderboard | ✅ | Exam leaderboard with own position |
| Basic notifications / announcements | ✅ | Bell → notifications and notices; `mobile/e2e/notifications.spec.ts` |
| Accessible, readable screens (UI/UX guidelines §11) | ✅ ⏳ | **10F:** axe-core WCAG 2.1 A/AA on every screen of the web build, both languages — `mobile/e2e/accessibility.spec.ts`, 0 violations. A TalkBack and font-scale run on a real phone is still to do |
| Open available exams | ✅ | `mobile/e2e/exams.spec.ts` |
| MCQ interface, Previous/Next, question palette | ✅ | `mobile/e2e/exam-room.spec.ts`, `mobile/tests/exam-room.test.tsx` |
| Answered / unanswered status; mark for review | ✅ | Palette states; same tests |
| Countdown timer; automatic submission when time expires | ✅ | Server deadline + server clock; `test_attempts.py` deadline/grace tests, auto submit in `exam-room.test.tsx` |
| Manual final submission with confirmation | ✅ | Submit summary dialog |
| Negative marking; configurable marks per question | ✅ | `test_results.py::test_all_wrong_with_negative_marking_goes_below_zero`, per-question marks |
| Random question / option order where required | ✅ | Exam settings `shuffle_questions` / `shuffle_options`; `test_attempts.py::test_orders_are_persisted_and_reused` |
| Exam progress indicator | ✅ | "Answered x/y" in the room |
| Server-side validation before accepting final submission | ✅ | `SECURITY_PLAN.md` §4 (deadline, grace, idempotent submit) |

## MCQ exam engine

| Requirement | Status | Where / evidence |
|---|---|---|
| Configurable title, category, subject, duration, total questions, marks, negative marks, pass marks | ✅ | Admin exam editor; `test_exams.py` |
| Practice and regular exams; basic scheduled / live exams | ✅ | `exam_type`; live: one attempt, late joiners get the remaining time (`test_live_late_joiner_gets_remaining_window`) |
| Free / paid flag | ✅ | `access_type`; paid needs a subscription (403) |
| Server-controlled timing | ✅ | `test_device_clock_never_decides_timing` |
| Duplicate final-submission prevention | ✅ | `test_double_submit_transitions_once` |
| Server-side result calculation | ✅ | `apps/results` services; no score-editing endpoint (`test_no_score_editing_endpoint`) |

## Result & basic merit

| Requirement | Status | Where / evidence |
|---|---|---|
| Totals, correct, wrong, unanswered, negative marks, obtained marks, percentage, pass/fail, time used | ✅ | Result screen; `test_results.py` (incl. `test_pass_threshold`) |
| Exam-wise merit position; basic leaderboard | ✅ | Merit generation (decision #18); app + website leaderboards |
| Exam history and previous result view | ✅ | Results tab |
| Admin-controlled result visibility | ✅ | Immediate / after end / manual publish-hide; `test_hidden_results_hide_the_leaderboard` |

## Admin Panel

| Requirement | Status | Where / evidence |
|---|---|---|
| Dashboard: overview, student count, exam count | ✅ | `test_dashboard.py::test_exact_seeded_counts` |
| Dashboard: recent exams / activities | 🟡 | Today's activity is shown as counts (attempts started/submitted today, in progress); the full activity list is the **Audit log** screen. A "recent exams" card is a small optional addition — owner's call |
| View / search users; view basic profile | ✅ | `admin/e2e/users.spec.ts` (contact details masked) |
| **Activate / deactivate account** | ✅ | **Added in 10C.** Students only, after a confirmation, audited; deactivating signs the student out everywhere. `test_admin_users.py::TestActivation`, `admin/tests/users-view.test.tsx`, `users.spec.ts` |
| Categories and subjects: create / edit / delete | ✅ | `admin/e2e/content.spec.ts`, `test_catalog.py` |
| Questions: add / edit / delete, category & subject, options, correct answer, explanation, difficulty | ✅ | `content.spec.ts`, `test_questions.py` |
| Exams: create / edit / delete, assign questions, duration, marks, negative and pass marks, status, schedule, publish / unpublish | ✅ | `admin/e2e/exams.spec.ts`, `test_exams.py` |
| Results: attempts, results, publish / hide, merit generation | ✅ | `admin/e2e/attempts.spec.ts`, `results.spec.ts` |
| Packages: name, description, price, validity, status, access rules | ✅ | `admin/e2e/packages.spec.ts` |
| Subscriptions: view active, start / expiry; automatic activation after verified payment | ✅ | `subscriptions.spec.ts`; `test_payments.py` (verified success grants the paid snapshot) |
| Payments: initiation, transaction ID / status, pending / success / failed / cancelled, server-side verification, history | ✅ | `admin/e2e/payments.spec.ts`, `test_payments.py` |
| Integration target: bKash / Nagad / SSLCommerz | ✅ ⏳ | SSLCommerz first (decision #5), common gateway interface; the live sandbox run needs the client's store credentials (open question 2) |
| Basic settings: platform name | ✅ | Site settings (Bangla + English) |
| Basic settings: **logo** | 🟡 | The logo is the owner-supplied brand asset built into the apps and the website (decision #24); changing it is a small code/asset update, not a setting. Owner's call whether an upload setting is wanted |
| Basic settings: announcements / notices; app download link | ✅ | `admin/e2e/cms.spec.ts`, `site-admin.spec.ts` |
| Accessible, readable panel (UI/UX guidelines §11) | ✅ | **10E:** axe-core WCAG 2.1 A/AA on every screen, both languages, phone and desktop — `admin/e2e/accessibility.spec.ts`, 0 violations |

## Public Website

| Requirement | Status | Where / evidence |
|---|---|---|
| Responsive home; introduction / key features | ✅ | `web/e2e/home.spec.ts` (360–1280 px, both languages) |
| Available and upcoming exams information | ✅ | `/exams` tabs and exam pages; `exams-packages.spec.ts` |
| Package / pricing information | ✅ | `/packages` |
| Notices / announcements | ✅ | `/notices`; `notices-leaderboard.spec.ts` |
| Basic results / leaderboard display | ✅ | `/leaderboard` and per-exam merit lists (masked names) |
| About Us, Contact, FAQ | ✅ | `about-faq-contact.spec.ts` (contact form: field checks, honeypot, rate limit) |
| Download App / Google Play link | ✅ ⏳ | Button reads the link from Site settings ("coming soon" until the store link exists) |
| Login / Register link if required | ➖ | Not required: no website login in Phase-1 (decision #11); the app button is the way in |
| Mobile / tablet / desktop responsive | ✅ | Every web E2E suite checks for horizontal overflow; Lighthouse and axe (9E) |
| Website does not run exams | ✅ | No exam UI; the public API has no questions or answers |

## Backend / API / Database

| Requirement | Status | Where / evidence |
|---|---|---|
| One central backend/API for app, website and panel | ✅ | `ARCHITECTURE.md` |
| Authentication, authorization, basic roles | ✅ | Student JWT, admin session + CSRF + role; `test_admin_auth.py` |
| Input validation; structured error handling | ✅ | One error shape (`apps/core/exceptions.py`, `test_errors.py`); `code` stable across languages |
| Secure exam submission; server-side results | ✅ | See the exam engine above |
| Basic rate limiting / API protection | ✅ | Login, OTP, contact-form throttles (`SECURITY_PLAN.md` §3) |
| Core entities | ✅ | `DATABASE_DESIGN.md`; all listed entities exist |
| Designed for future expansion | ✅ | Modular monolith (`MODULES.md`), bilingual fields, provider-neutral payments |

## Basic security

| Requirement | Status | Where / evidence |
|---|---|---|
| Password hashing; token / session management; authorization; validation; SQL injection protection; XSS / CSRF | ✅ | `SECURITY_PLAN.md` §4 — every item names its test |
| Server-side timing / result validation; no correct answers before submission | ✅ | Same checklist |
| Credentials in environment variables | ✅ | `.env.example` files only; production settings refuse placeholders (`test_configuration.py`) |
| Basic logging of important errors / activities | ✅ | Structured logs without personal data; audit log for every admin change and verified payment |

## Basic testing & delivery

| Requirement | Status | Where / evidence |
|---|---|---|
| Registration / login / OTP testing | ✅ | Backend + `mobile/e2e/auth.spec.ts` |
| Exam loading / navigation testing | ✅ | `exams.spec.ts`, `exam-room.spec.ts` |
| Timer / automatic submission testing | ✅ | Backend deadline tests + room auto submit |
| Negative-marking and result-calculation testing | ✅ | `test_results.py` |
| Admin question / exam management testing | ✅ | `admin/e2e/content.spec.ts`, `exams.spec.ts` |
| Subscription / payment flow testing (sandbox or mock) | ✅ ⏳ | Mock provider end to end (`mobile/e2e/payments.spec.ts`, `admin/e2e/payments.spec.ts`); SSLCommerz sandbox run needs credentials |
| Responsive website testing | ✅ | All website suites + accessibility suite |
| Basic API / permission testing | ✅ | Permission tests on every admin and student endpoint |
| Production deployment support (one agreed server) | ⏳ | `DEPLOYMENT.md` (staging demo ready, §9; website route §8). Needs the client's server, domain and credentials |
| Source-code handover; setup / deployment notes | ⏳ | Repository + `START_HERE.md`, `DEPLOYMENT.md`; handover after completion / final payment |

## Owner decisions still open

1. **Admin Panel digits in Bangla** — Bangla digits like the app and website, or Western digits with an exception in `LOCALIZATION.md` (10A).
2. **Admin dashboard "recent exams"** — is the Audit log enough, or add a small "recent exams" card?
3. **Logo setting** — keep the built-in brand logo, or add a logo upload to Site settings?
4. Already listed in `ROADMAP.md`: SMS provider, SSLCommerz account, default language and glossary.
