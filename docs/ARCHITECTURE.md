# Architecture — Online MCQ Examination Platform (Phase-1)

> Status: **Planning document.** No application code exists yet.
> Source of truth for scope: `docs/requirements/PHASE_1_REQUIREMENTS.md`.
> Related docs: `DATABASE_DESIGN.md`, `API_PLAN.md`, `SECURITY_PLAN.md`, `MODULES.md`, `ROADMAP.md`, `UI_UX_GUIDELINES.md`, `LOCALIZATION.md`.
> Languages: the whole platform supports **Bangla (`bn`) and English (`en`)** — see §11a.

---

> Reference website (`web.livemcq.com`) is inspiration only and was not accessible from the
> planning environment; per `CLAUDE.md` this does not block work. Nothing is copied from it.

## 1. The big picture (in plain words)

We are building **one brain** (the backend) and **three faces** (mobile app, public website, admin panel).

- The **brain** is a Django + Django REST Framework (DRF) application. It owns all the rules:
  who can log in, which exams a student can open, how long they have, what their score is,
  whether a payment really succeeded.
- The **memory** is one PostgreSQL database. It is the only source of truth.
- The **faces** only *display* data and *send* user actions to the brain over a JSON API.
  They never decide anything important by themselves.

```
                 ┌───────────────────────┐
                 │  Android App (Expo)   │  ← students take exams here
                 └──────────┬────────────┘
                            │ HTTPS / JSON (JWT)
┌──────────────────────┐    │    ┌───────────────────────┐
│ Public Website       │    │    │ Admin Panel           │
│ (Next.js, SSR/ISR)   │    │    │ (Next.js)             │
│ read-only public API │    │    │ admin API (role=admin)│
└──────────┬───────────┘    │    └──────────┬────────────┘
           │                │               │
           ▼                ▼               ▼
        ┌─────────────────────────────────────────┐
        │  Reverse proxy (Nginx) — TLS, gzip,     │
        │  static/media, request size limits      │
        └───────────────────┬─────────────────────┘
                            ▼
        ┌─────────────────────────────────────────┐
        │  Django + DRF  (modular monolith)       │
        │  /api/v1/public/*  /api/v1/*            │
        │  /api/v1/admin/*                        │
        └──────┬──────────────────┬───────────────┘
               │                  │ enqueue jobs
               ▼                  ▼
        ┌─────────────┐    ┌─────────────┐     ┌──────────────────┐
        │ PostgreSQL  │    │   Redis     │◄────│ Celery worker +  │
        │ (truth)     │    │ cache/broker│     │ Celery beat      │
        └─────────────┘    │ rate limits │     │ (OTP SMS, expiry,│
                           └─────────────┘     │  auto-submit…)   │
                                               └────────┬─────────┘
                                                        ▼
                                External: SMS gateway (OTP only),
                                Payment gateway interface →
                                SSLCommerz (first) · bKash · Nagad (later)
```

---

## 2. Why a modular monolith?

A **monolith** = one deployable backend application.
**Modular** = inside it, code is split into clear Django apps (accounts, exams, payments…) with
clear boundaries.

Why this is right for Phase-1:

| Concern | Modular monolith | Microservices |
|---|---|---|
| Budget / team size | Small team, one codebase | Needs DevOps for many services |
| Transactions (e.g. payment → subscription) | One DB transaction, simple | Distributed transactions, hard |
| Deployment | One Docker image + workers | Many images, service discovery |
| Future split | Possible later if modules stay clean | Already split |

Rule we follow so we can split later if ever needed: **modules talk to each other through
service functions, not by reaching into each other's tables everywhere** (see `MODULES.md`).

---

## 3. Technology choices

| Layer | Technology | Purpose |
|---|---|---|
| Backend framework | Django 5.x (LTS line) | ORM, migrations, auth, admin tooling, security defaults |
| API | Django REST Framework | Serializers (validation), viewsets, permissions, throttling |
| Auth tokens | `djangorestframework-simplejwt` (planned) | Short-lived access token + rotating refresh token |
| API schema | `drf-spectacular` (planned) | OpenAPI schema → docs + optional TypeScript type generation |
| Database | PostgreSQL 16 | Source of truth, constraints, transactions, row locks |
| Cache / broker | Redis 7 | Celery broker, throttling counters, short-lived cache |
| Background jobs | Celery + Celery beat | SMS sending, auto-submit of expired attempts, subscription expiry, merit generation |
| Public website | Next.js (App Router) + TypeScript + Tailwind | SEO-friendly server rendering of public data |
| Admin panel | Next.js (App Router) + TypeScript + Tailwind | Data management UI (tables, forms, filters) |
| Mobile app | React Native + Expo + TypeScript | Android exam app; `expo-secure-store` for tokens |
| Local/dev infra | Docker Compose | One command to run db, redis, backend, workers, web apps |
| Source control / CI | GitHub (+ GitHub Actions later) | Branching (`main`, `develop`, `feature/*`), PR checks |

> Packages are listed as **planned only**. Nothing is installed at this stage.

---

## 4. Repository layout (planned)

A single repository (monorepo) keeps the three clients and the backend in sync.

```
online-mcq-platform/
├── backend/                 # Django project
│   ├── config/              # settings (base/dev/prod), urls, celery, wsgi/asgi
│   ├── apps/
│   │   ├── core/            # shared base models, errors, pagination, permissions
│   │   ├── accounts/        # users, profiles, roles, login, password
│   │   ├── verification/    # OTP generation/verification, SMS gateway adapter
│   │   ├── catalog/         # categories, subjects
│   │   ├── questions/       # questions, options
│   │   ├── exams/           # exam definitions, exam-question assignment, scheduling
│   │   ├── attempts/        # exam engine: start, save answers, submit, timer
│   │   ├── results/         # scoring, result, merit, leaderboard
│   │   ├── subscriptions/   # packages, access rules, subscriptions
│   │   ├── payments/        # payment records, PaymentGateway interface (SSLCommerz first), verification
│   │   ├── cms/             # site settings, announcements, FAQ, pages, contact form (bilingual)
│   │   ├── notifications/   # in-app notifications (Phase-1 channel)
│   │   ├── audit/           # audit log of important admin/system actions
│   │   └── dashboard/       # read-only basic operational statistics
│   ├── tests/
│   ├── manage.py
│   └── Dockerfile
├── web/                     # Public website (Next.js)
├── admin/                   # Admin panel (Next.js)
├── mobile/                  # Android app (Expo)
├── design/                  # Shared design tokens (colors, spacing, type) as JSON/TS
├── docs/
├── docker-compose.yml       # local development
├── docker-compose.prod.yml  # production overrides (later)
├── .env.example
└── CLAUDE.md
```

**Why separate `web/` and `admin/` Next.js apps instead of one?**
- The admin code (and its routes) is never shipped to public visitors.
- Admin can live on its own subdomain (e.g. `admin.example.com`) with stricter headers/cookies.
- Each app stays small and simple.
- Trade-off: two builds instead of one. Acceptable. (If budget pressure is high, they can be
  merged into one Next.js app with route groups — see "Open questions" in `ROADMAP.md`.)

---

## 5. Clients and how each talks to the backend

| Client | Who uses it | Auth | API area used |
|---|---|---|---|
| Mobile app | Students | JWT access token (memory) + refresh token (SecureStore) | `/api/v1/auth/*`, `/api/v1/*` (student endpoints), `/api/v1/public/*` |
| Public website | Anonymous visitors | None — **no website login in Phase-1** | `/api/v1/public/*` only (read-only + contact form) |
| Admin panel | Admins / staff | JWT delivered in **httpOnly, Secure, SameSite** cookies + CSRF token | `/api/v1/admin/*`, `/api/v1/auth/*` |

Notes:
- The **website does not run exams** and has **no login** in Phase-1. Its calls-to-action are
  **Download App** (Play Store link) and **Open App** (tries the app's URL scheme, falls back to the
  Play Store). Verified deep links/App Links remain Phase-2.
- **Students register with a mandatory mobile number + SMS OTP**; email is optional; password reset
  uses SMS OTP.
- The mobile app never receives correct answers before the attempt is submitted
  (and only afterwards if the result is published and review is allowed).

---

## 6. Request flow examples

### 6.1 Student starts an exam
```
App ──POST /api/v1/exams/{id}/attempts/──► Django
  1. Is the user authenticated & active?
  2. Is the exam published and within its schedule window?
  3. Free exam? or does the user have an active subscription whose package covers it
     (all paid exams / the exam's category / this exam)?
  4. Retake rules: live = 1 attempt only; regular = allow_retake + max_attempts; practice = configurable
  5. Create ExamAttempt (status=in_progress, started_at=now,
     deadline_at = min(now + duration, exam.end_at) → a late joiner only gets time until the global end)
  6. Create one AttemptAnswer row per question (random order if configured) with snapshot marks
  7. Return questions + options (NO is_correct, NO explanation) + deadline_at + server_time
App: shows timer = deadline_at − server_time (corrected for device clock drift)
```

### 6.2 Student answers questions (online exam with retry — not a full offline mode)
```
App: keeps a local temporary answer state (in memory + small local cache for crash recovery)
App ──PUT /api/v1/attempts/{id}/answers/{question_id}/──► Django   (autosave per answer)
  - rejects if attempt not in_progress or now ≥ deadline_at (grace never extends answer editing)
  - stores selected_option and mark_for_review
On temporary connection loss: unsent changes go into a pending queue → retried with backoff →
  PUT /attempts/{id}/answers (batch sync) when the connection returns.
```
- The exam must be **started online**; Phase-1 has **no full offline exam system**.
- The **server is the source of truth**: only answers it receives before `deadline_at` count.
- Autosave means an app crash or short network drop does not lose saved answers, and the student can resume.

### 6.3 Final submission (manual or automatic)
```
App ──POST /api/v1/attempts/{id}/submit/ (Idempotency-Key)──► Django
  1. SELECT … FOR UPDATE on the attempt row (prevents double submit race)
  2. If already submitted → return existing result (idempotent, no duplicate)
  3. Accept the submit only if now ≤ deadline_at + grace_seconds; apply its final answer batch
     only if now < deadline_at (after deadline + grace the server finalizes instead)
  4. Mark submitted, compute result server-side (correct/wrong/unanswered/negative/percentage/pass)
  5. Commit transaction
  (Merit is computed later by the merit service using the exam's merit_strategy:
   live = the single submitted attempt; regular = configurable first/best/latest attempt.)
Celery beat (every minute): any attempt with deadline passed and still in_progress
  → auto-finalize with the answers saved so far (status=auto_submitted).
```

### 6.4 Payment and subscription activation (SSLCommerz first, via a common gateway interface)
```
App ──POST /api/v1/payments/ {package_id}──► Django creates Payment(pending), calls gateway.initiate()
   ◄── returns provider checkout URL
App opens checkout (in-app browser) → user pays at bKash/Nagad/SSLCommerz
Provider ──callback/IPN──► Django
  1. Look up Payment by our merchant reference
  2. gateway.verify(): provider's server-side API — for SSLCommerz the Validation API with val_id
     (never trust callback params or the app alone)
  3. Check amount + currency + status match
  4. In one DB transaction: Payment=success, create/extend Subscription
  5. Idempotent: a repeated callback does nothing new
App polls GET /api/v1/payments/{id}/ to show final status
```
The `PaymentGateway` interface (`initiate`, `handle_callback`, `verify`, `query`) lets bKash and
Nagad be added later as new gateway classes without changing the API, database or clients.

---

## 7. Background jobs (Celery)

| Job | Trigger | Why it runs in background |
|---|---|---|
| Send OTP SMS | On OTP request | External HTTP call can be slow; retry on failure (SMS is used **only for OTP** in Phase-1) |
| Create in-app notifications | Result published, payment success, subscription expiring | Notifications are **in-app only** in Phase-1 (push/SMS/email = future channels) |
| Auto-finalize expired attempts | Celery beat, every 1 min | Student may have closed the app; result must still be produced |
| Expire subscriptions | Celery beat, hourly | Change `active` → `expired` status for reporting (access checks also compare dates directly) |
| Reconcile pending payments | Celery beat, every 10–15 min | Re-query provider for payments stuck in `pending` |
| Generate merit positions | After exam window closes / on admin request | Ranking many results is heavier work; applies the exam's `merit_strategy` |
| Clean expired OTPs | Celery beat, daily | Keep tables small |

Important rule: **jobs must be idempotent** (safe to run twice) because Celery may retry.

---

## 8. Time & timer strategy (server-controlled)

- All timestamps stored in **UTC** (`USE_TZ=True`); displayed in **Asia/Dhaka** in clients.
- Attempt `deadline_at = min(started_at + exam.duration, exam.end_at)` for scheduled/live exams — a
  student who joins a live exam late only gets the time left until the global end.
- Every attempt response includes `server_time`; clients compute an offset so a wrong phone
  clock cannot extend the exam.
- A small **grace period** (`ATTEMPT_SUBMIT_GRACE_SECONDS`, default 30 s) absorbs network latency of
  the final **submit request** only: it is accepted until `deadline_at + grace`. Answers (saves, or
  answers inside the submit) count only when received before `deadline_at`.

---

## 9. Configuration strategy (no hard-coded business rules)

Two kinds of configuration:

| Kind | Where | Examples |
|---|---|---|
| Technical / secret | Environment variables (`.env`, never committed) | `DJANGO_SECRET_KEY`, DB password, SMS API key, payment keys, `PAYMENT_PROVIDER` |
| Business rules | Database (admin-editable) or per-record fields | Exam duration, negative marks, pass marks, `allow_retake`, `max_attempts`, `merit_strategy`, package price/validity/access rules, shuffle flags, result visibility, OTP expiry/resend cooldown, submission grace seconds, platform name, app links, default language, leaderboard name display mode |

Sensible defaults live in code constants but can be overridden from the database settings table.

---

## 10. Environments & deployment (Phase-1)

| Env | How it runs |
|---|---|
| Local dev | `docker compose up` → postgres, redis, backend (runserver), celery worker, celery beat, web, admin. Mobile runs via Expo on a phone/emulator pointing to the dev API. |
| Staging (optional) | Same compose file on a small VPS with mock SMS/payment |
| Production | One VPS (client-provided): Nginx (TLS via Let's Encrypt) → gunicorn (Django), celery, celery beat, Next.js apps (Node), PostgreSQL, Redis. Daily DB backups (`pg_dump`) to off-server storage. |

The Android app is built with EAS Build (or local build) and published to Google Play.

---

## 11. Cross-cutting concerns

- **Errors:** one JSON error shape everywhere (see `API_PLAN.md`).
- **Logging:** structured logs (JSON in production) for errors, auth events, payment events, submissions.
- **Reports:** Phase-1 = basic operational dashboard statistics only; advanced analytics/exports = Phase-2.
- **Audit:** admin actions on exams/questions/results/payments/users recorded in `audit_log`.
- **Pagination:** all list endpoints are paginated.
- **Versioning:** URL prefix `/api/v1/` so a future `v2` won't break old app versions in users' phones.
- **Localization:** Bangla + English everywhere — see §11a and `LOCALIZATION.md`.
- **Media:** question images (if used) and logo stored on disk/volume in Phase-1 via Django storage API (swappable to S3-compatible storage later).

---

## 11a. Bilingual (Bangla + English) architecture

Bilingual support is a **cross-cutting** concern, designed in from the first migration so it never
has to be retro-fitted.

```
                   Accept-Language: bn | en
 Mobile / Website / Admin ───────────────────────► Django LocaleMiddleware
                                                   (+ user.preferred_language fallback)
                                                          │
             ┌────────────────────────────────────────────┼─────────────────────────────┐
             ▼                                            ▼                             ▼
   UI/system text (gettext .po)          Content fields in PostgreSQL         Templates (SMS, notifications)
   errors, validation, emails            title_bn / title_en, text_bn / …     rendered per user language
             │                                            │
             └──────────────► localized JSON response ◄───┘
                     student/public: one resolved value (with fallback)
                     admin: both values for editing
```

| Layer | Responsibility |
|---|---|
| Backend | Language negotiation, `.po` translations for API messages, bilingual content columns, fallback rule, digit normalization (Bangla ↔ Western), NFC text normalization, localized SMS/notification templates |
| Mobile app | Translation JSON per feature, language switch (instant), bundled Bangla + Latin fonts, Bangla digits/dates via `Intl`, exam-room language toggle for `both`-language exams |
| Website | `/bn` and `/en` routes, `hreflang` + localized SEO metadata, language switcher |
| Admin panel | Translatable admin UI, bilingual content editor (বাংলা / English tabs + completeness indicator), "missing translation" filters |
| Database | UTF-8, NFC-normalized text, trigram search for Bangla, ASCII slugs |

Two separate language concepts:
- **UI language** — the language of the app/website chrome (per user / visitor).
- **Exam content language** — `bn`, `en` or `both`, set per exam by the admin.

---

## 12. What is intentionally NOT in Phase-1 architecture

From the requirement's Phase-2 list: large-scale live monitoring, websockets, advanced caching/queue
tuning, CDN, disaster-recovery automation, iOS app, deep links, full CMS, bulk import, advanced
analytics. Also deferred by decision: push/SMS/email notification channels, bKash/Nagad gateways
(interface ready), website student login, full offline exam mode. The architecture leaves room for them (Redis, Celery, API versioning, storage
abstraction) but does not build them.
