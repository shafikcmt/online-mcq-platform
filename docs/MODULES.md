# Modules — Online MCQ Examination Platform (Phase-1)

> Status: **Planning document.** Describes the backend Django apps (modules), what each owns,
> how they depend on each other, and the matching client features.

---

## 1. Module rules (how we keep the monolith "modular")

1. **Each module owns its tables.** Only that module writes them.
2. **Cross-module calls go through a `services.py` (writes) or `selectors.py` (reads)** function,
   e.g. `subscriptions.selectors.user_can_access_exam(user, exam)` — not by copying query logic.
3. **Dependencies point one way** (see order below). A lower module never imports a higher one.
   If a lower module must react to a higher one, use a service call from the higher module or a
   carefully-documented Django signal.
4. **Views stay thin.** Views = HTTP in/out + permissions. Business logic lives in services
   (easy to unit-test without HTTP).
5. **Student vs admin APIs are separate serializers/views** in each module (`api/student.py`,
   `api/admin.py`) so admin-only fields (like `is_correct`) can't leak by accident.
6. **No hard-coded user-facing text.** Backend messages use `gettext`; content uses bilingual
   `*_bn`/`*_en` fields; clients use translation files (see `LOCALIZATION.md`).

Typical internal layout of one app:
```
apps/exams/
├── models.py
├── services.py       # create/update/publish logic, validation of business rules
├── selectors.py      # read queries used by other modules
├── api/
│   ├── student.py    # student views + serializers
│   ├── admin.py      # admin views + serializers
│   └── public.py     # public views + serializers (if any)
├── tasks.py          # Celery tasks (if any)
├── admin.py          # Django admin registration (ops/debug only)
├── urls.py
└── tests/
```

---

## 2. Backend modules

| # | Module | Owns | Responsibilities | Depends on |
|---|---|---|---|---|
| 1 | `core` | abstract base models, utils | Timestamps/UUID base model, error handler (localized messages), pagination, base permissions (`IsAdminRole`), throttle classes, settings helper for DB-backed config, **i18n helpers** (language negotiation, bilingual field resolver + fallback, Bangla-digit and NFC normalization) | — |
| 2 | `accounts` | `users`, `student_profiles` | Custom user (**mobile number mandatory**, email optional), registration after SMS OTP, login by mobile number, JWT, password change, **SMS-OTP password reset**, profile, language preference, display name, activate/deactivate *(7E: admin read-only user list/detail built; activate/deactivate not built yet)* | core, verification* |
| 3 | `verification` | `otp_codes` | Generate/hash/verify OTP, cooldowns, bilingual SMS templates, SMS gateway adapter (`mock` + real provider), Celery send task | core |
| 4 | `cms` | `site_settings`, `announcements`, `faqs`, `pages`, `contact_messages` | Basic settings (name/logo/app links, default language, leaderboard name modes), bilingual notices/FAQ/pages, **website contact form**, business config values *(6A: built without logo and business-config values — see DATABASE_DESIGN §4.10 notes; `results` reads the leaderboard modes and `core.middleware` the default language through `cms.selectors`)* | core |
| 5 | `audit` | `audit_logs` | `audit.services.log(actor, action, obj, changes)` used by admin actions | core, accounts |
| 6 | `catalog` | `categories`, `subjects` | Academic structure **Category → Subjects** (one subject belongs to one category); bilingual CRUD, active lists for clients | core |
| 7 | `questions` | `questions`, `question_options` | Questions belong to a **Subject** (category derived). Bilingual CRUD with nested options, "exactly one correct" rule, edit-lock when used in submitted attempts | catalog |
| 8 | `exams` | `exams`, `exam_questions` | Exam config incl. content language, `allow_retake`/`max_attempts` (live forced to 1), `merit_strategy`; assign/reorder questions, schedule, publish/unpublish rules, visibility | catalog, questions |
| 9 | `subscriptions` | `packages`, `package_access_rules`, `subscriptions`, `grant_requests` | Package CRUD, access rules (**all paid exams / selected categories / selected exams**), `user_can_access_exam`, activate/extend subscription, expiry job *(7G: Admin Panel packages management built — list, create, edit, activate/deactivate, delete while unused, access-rules editor; subscriptions read-only list/detail with the new `effective_status` filter (`selectors.effective_status_filter`); admin subscription responses mask the student's mobile number (`mobile_display`); grant/extend/cancel not in the panel yet)* *(Grant-idempotency slice: the admin grant endpoint requires an `Idempotency-Key`; `services.grant_subscription_once` wraps the unchanged `grant_subscription` and records each completed manual grant in the `GrantRequest` ledger (same transaction) so retries replay instead of extending again; payments still call `grant_subscription` directly — their own idempotency is the payment row)* | accounts, catalog, exams |
| 10 | `attempts` | `exam_attempts`, `attempt_answers` | **Exam engine:** server-side eligibility (schedule, access, retake rules), start/resume, shuffling, snapshot, autosave + batch sync of pending answers, deadline enforcement (late joiners capped at global end), submit, auto-finalize job *(7F: admin read-only attempt list/detail built — status, server timing and overdue state from `attempts.selectors`, stored result summary; no answers, no mutations)* | exams, questions, subscriptions, results (calls scoring) |
| 11 | `results` | `results` | Scoring + negative marking, visibility rules, review, **configurable merit** (`first_attempt` / `best_attempt` / `latest_attempt`; live = single attempt), leaderboard with configurable name masking | attempts (reads), exams |
| 12 | `payments` | `payments`, `payment_events` | Common `PaymentGateway` interface; gateways: `mock` + **SSLCommerz first**, bKash/Nagad later (same interface), initiation, callback/IPN, verification, reconciliation job; on success → `subscriptions.services.grant_subscription()` *(M5: the same service as manual grants, inside the verification transaction)* *(7H: Admin Panel Payments built **read-only** — list with student/package/subscription/status/provider filters, exact reference/transaction-ID search, detail with an allow-listed verification summary and the latest 50 events as short codes (`payments.selectors`); the admin API no longer returns raw provider data, event payloads, source IPs or the provider session key; no payment actions in the panel)* *(Payment-safety slice: `validity_days` snapshot at initiation, immutable with `amount`/`currency`; verified successes call `grant_subscription(validity_days=payment.validity_days, for_verified_payment=True)`)* | accounts, subscriptions |
| 13 | `notifications` | `notifications` | **In-app only** (Phase-1): create from bilingual templates (result published, payment success, subscription expiring), list/mark read. Push/SMS/email channels are future extensions *(6B: built for payment success + result published; `payments` and `results` call `notifications.services` inside their own transactions; subscription expiring not built yet)* | accounts |
| 14 | `dashboard` | — (read-only) | **Basic reports:** admin operational statistics (advanced analytics/exports = Phase-2); student dashboard aggregation endpoint (calls selectors of other modules) *(6C: built — no tables; `GET /me/dashboard/` and `GET /admin/dashboard/` read through `exams.selectors` (`listable_exams`, `open_window`), `subscriptions.selectors` (`active_window`, `active_grants`), `results.selectors` (`own_results`, `visible_results_filter`) and `attempts.selectors` (`start_options`, `grace` — the exam engine's start rules, shared with `start_attempt`); SQL aggregates and bounded lists only)* | most modules (read-only) |

\* `accounts` uses `verification` to confirm a verification token at registration/password reset.

> Note on `attempts` ↔ `results`: `attempts.submit()` calls `results.services.calculate(attempt)`
> inside the same transaction. `results` only **reads** attempt data; it never changes attempt status.
> This keeps a one-way flow: attempts → results.

---

## 3. Module dependency order (build order)

```
core
 ├─► verification ─► accounts ─► audit
 ├─► cms
 └─► catalog ─► questions ─► exams ─► subscriptions ─► attempts ─► results
                                            │
                                            └─► payments
notifications (after accounts; hooked into results & payments when they exist)
dashboard (last — reads from everything)
```

Recommended implementation order:
1. `core` + project skeleton + Docker Compose
2. `accounts` (custom user model **first**) + `verification` (OTP with mock SMS)
3. `audit` (small, used by all admin actions after this point)
4. `catalog`
5. `questions`
6. `exams`
7. `subscriptions` (packages + access rule check; manual activation for testing)
8. `attempts` (exam engine) + `results` (scoring) — built together, heavily tested
9. Merit/leaderboard (part of `results`)
10. `payments` (mock provider first, then real provider)
11. `cms` (settings, announcements, FAQ) — can be done in parallel any time after `core`
12. `notifications`
13. `dashboard`

---

## 4. Client features mapped to modules

### 4.1 Mobile app (Expo) — feature folders
| Feature | Backend modules |
|---|---|
| Auth (register with mobile + SMS OTP, login with mobile, forgot password via SMS OTP) | accounts, verification |
| Language switch (বাংলা / English) | accounts (`preferred_language`), core i18n |
| Profile & settings | accounts |
| Home dashboard | dashboard, exams, subscriptions, results, cms |
| Exam list & details (free/paid labels, locked reasons) | exams, subscriptions |
| Exam room (questions, palette, timer, local answer state + autosave + retry sync, submit) | attempts |
| Result & review | results |
| Leaderboard | results |
| History | attempts, results |
| Packages & payment | subscriptions, payments |
| Notifications & notices | notifications, cms |

### 4.2 Public website (Next.js)
| Page | Backend modules |
|---|---|
| Home (intro, features, upcoming exams, packages teaser, notices, app download) | cms, exams, subscriptions |
| Exams (available / upcoming) | exams, catalog |
| Packages / pricing | subscriptions |
| Notices | cms |
| Results / leaderboard (where appropriate) | results |
| About, FAQ | cms |
| Contact form | cms (`contact_messages`) |
| Download App / Open App | cms (app links) |
| Language switch (`/bn`, `/en`) | — (website i18n) |

No website login in Phase-1.

### 4.3 Admin panel (Next.js)
| Section | Backend modules |
|---|---|
| Dashboard (basic reports) | dashboard |
| Users | accounts, subscriptions, attempts, payments (read) |
| Categories & Subjects | catalog |
| Question bank | questions |
| Exams (+ question assignment, schedule, publish) | exams |
| Attempts & Results (+ publish/hide, merit) | attempts, results |
| Packages & Subscriptions | subscriptions |
| Payments | payments |
| Settings (language, leaderboard names, app links), Announcements, FAQ, Pages | cms |
| Contact messages | cms |
| Audit log | audit |

---

## 5. Shared frontend packages (light)

| Package | Content | Used by |
|---|---|---|
| `design/` tokens | colors, spacing, radius, typography scale, shadows (JSON/TS) | web, admin, mobile |
| API types | Generated from OpenAPI schema (optional, `openapi-typescript`) | web, admin, mobile |
| API error code → message map | shared constants | web, admin, mobile |
| i18n glossary & shared message keys | `bn`/`en` JSON for shared terms (exam, result, package…) | web, admin, mobile |

Kept small on purpose; no heavy monorepo tooling in Phase-1 unless it clearly saves time.

---

## 6. Phase-2 modules (placeholders only — not built)
`imports` (bulk Excel/CSV), `analytics` (advanced reports/exports), `invoices`, `live_monitoring`,
notification channels (`push`/FCM, SMS, email), `cms_pages` (full CMS), deep links/App Links,
website student accounts.
