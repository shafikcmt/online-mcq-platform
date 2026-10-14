# Online MCQ Examination Platform

A production-oriented Online MCQ Examination Platform with:

- Android Mobile App (students take exams here)
- Public Website (information only)
- Admin Panel
- Secure Backend/API (Django + Django REST Framework)
- PostgreSQL Database, Redis, Celery
- Bangla + English (bilingual) throughout

## Current Status

**Milestone 5 — Payments & subscriptions.** Backend skeleton, Docker setup, tests, CI, the custom
User model (mobile number login) + student profile, OTP verification, the student
authentication API (register, login, JWT refresh/logout, password reset/change, profile),
the Category → Subject catalog, the question bank (questions with options and optional
images), the exam builder (question lists, publish rules, duplicate) with an admin API, public
exam/category listing, packages with access rules, manually granted subscriptions with the
server-side `user_can_access_exam` check, the exam engine (start/resume, autosave, batch sync,
submit, automatic finalization), server-side scoring with results, answer review, configurable merit
lists and leaderboards, an append-only audit log, and payments (mock gateway + SSLCommerz behind
one gateway interface, server-side verification, subscription activation, reconciliation and
subscription expiry jobs) exist. See `docs/ROADMAP.md`.

Planning documents live in `docs/` — start with `docs/ARCHITECTURE.md`.

---

## Project structure

```
online-mcq-platform/
├── backend/                  Django + DRF API (the "brain")
│   ├── config/               project configuration
│   │   ├── settings/         base.py (shared), dev.py, test.py, prod.py, checks.py, env.py
│   │   ├── urls.py           root URLs (/api/v1/…, API docs)
│   │   ├── api_v1.py         all version-1 API routes
│   │   └── celery.py         Celery (background jobs) app
│   ├── apps/
│   │   ├── core/             shared code: health endpoint, error format, pagination,
│   │   │                     language middleware, Bangla/English + mobile number helpers
│   │   ├── accounts/         custom User (mobile number login), StudentProfile, roles, auth API
│   │   ├── verification/     SMS OTP codes and verification tokens
│   │   ├── audit/            append-only audit log of admin actions
│   │   ├── catalog/          Category → Subject (bilingual), admin API
│   │   ├── questions/        question bank: questions + options (exactly one correct), images
│   │   ├── exams/            exam builder: exams, question lists, publish rules, public listing
│   │   ├── subscriptions/    packages, access rules, subscriptions, exam access check
│   │   ├── attempts/         exam engine: start/resume, answers, submit, auto-finalize
│   │   ├── results/          scoring, result visibility, answer review, merit, leaderboards
│   │   └── payments/         payments + event log, gateways (mock, SSLCommerz), verification
│   ├── locale/               translation files (bn, en)
│   ├── tests/                automated tests (pytest)
│   ├── requirements/         base.txt (runtime) and dev.txt (+ test/lint tools)
│   ├── pyproject.toml        ruff + pytest configuration
│   ├── Dockerfile
│   └── manage.py
├── web/                      Public Website (placeholder — Milestone 9)
├── admin/                    Admin Panel (placeholder — Milestone 7)
├── mobile/                   Mobile App (placeholder — Milestone 8)
├── design/                   Shared design tokens (placeholder)
├── docs/                     requirements and planning documents
├── docker-compose.yml        local development stack
├── .env.example              environment variable template (placeholders only)
└── .github/workflows/        CI (GitHub Actions)
```

---

## 1. Environment file

Settings and secrets come from environment variables, never from code.

```bash
cp .env.example .env
```

Then open `.env` and at least change `POSTGRES_PASSWORD` (any local password is fine).
`.env` is ignored by Git — **never commit it**.

---

## 2. Run with Docker (recommended)

Requires Docker Desktop (or Docker Engine) with Docker Compose.

```bash
# Start everything (first run builds the backend image)
docker compose up --build

# …or start in the background
docker compose up --build -d

# See running services and their health
docker compose ps

# Follow logs
docker compose logs -f backend
```

Services started:

| Service | What it is | Reachable from |
|---|---|---|
| `backend` | Django development server | http://localhost:8000 |
| `postgres` | PostgreSQL 16 database | other containers only |
| `redis` | Redis 7 (cache + Celery broker) | other containers only |
| `celery` | Celery worker (no tasks yet) | — |

Stop:

```bash
docker compose down        # stop containers, keep database data
docker compose down -v     # stop AND delete database data (fresh start)
```

### Database setup (first run)

```bash
docker compose exec backend python manage.py migrate          # create tables
docker compose exec backend python manage.py createsuperuser  # internal admin account
```

`createsuperuser` asks for a **mobile number** (e.g. `01712345678` — Bangla digits also work),
full name and password. Never put real credentials in code or committed files.

### Authentication API (students)

`/api/v1/auth/…` — OTP request/verify, register, login, token refresh, logout, password
reset/change — and `/api/v1/me/` (profile). See `docs/API_PLAN.md` §2 for the flow and the
interactive docs at `/api/docs/`. Send the access token as `Authorization: Bearer <token>`.

Behind reverse proxies set `TRUSTED_PROXY_COUNT` (Nginx only = 1; Cloudflare → Nginx = 2).
With the default `0`, `X-Forwarded-For` is ignored, so clients cannot fake their IP to dodge
rate limits. Never set it higher than the number of proxies you actually run, and when it is
above `0` make sure the backend is **not reachable directly from the internet** — only through
those proxies — otherwise anyone could send a forged `X-Forwarded-For` header.

OTP codes in development: no real SMS is sent (`SMS_PROVIDER=mock`). To see codes in the
logs while developing, set `SMS_MOCK_LOG_CONTENT=true` in `.env` (works only with
`DJANGO_DEBUG=true`; never enable it on a real server).

### Admin API (catalog, audit log)

`/api/v1/admin/categories/`, `/api/v1/admin/subjects/`, `/api/v1/admin/questions/`,
`/api/v1/admin/exams/`, `/api/v1/admin/packages/`, `/api/v1/admin/subscriptions/`,
`/api/v1/admin/payments/` and `/api/v1/admin/audit-logs/` need an
**admin session** (cookie) and the `admin` role — student tokens are not accepted.
**Temporary (Milestone 3, backend only):** sign in at the internal Django admin with an admin
account, then call the API from the same browser session. Write requests also need the CSRF
token in an `X-CSRFToken` header. This is not the final Admin Panel login — that is built in
Milestone 7. Every create/update/delete is written to the append-only audit log.

Public endpoints (no login): `/api/v1/public/categories/`, `/api/v1/public/exams/` and
`/api/v1/public/exams/{slug}/` — published exams only, never questions or answers — and
`/api/v1/public/packages/` (active packages and prices). Students see their own subscriptions
at `/api/v1/me/subscriptions/` (student token). Subscriptions are bought through payments (below)
or, for support, granted manually with `POST /api/v1/admin/subscriptions/grant/` (audited).

Exam engine (student token): `POST /api/v1/exams/{slug}/attempts/` starts or resumes an attempt;
answers are saved with `PUT /api/v1/attempts/{id}/answers/{question_id}/` (or the batch
`PUT …/answers/`) and the attempt is submitted with `POST /api/v1/attempts/{id}/submit/`. The
`celery-beat` service finalizes abandoned attempts every minute and generates merit lists.

Results (student token): `GET /api/v1/results/`, `/api/v1/results/{attempt_id}/`, answer review at
`/api/v1/results/{attempt_id}/review/`, and `GET /api/v1/exams/{slug}/leaderboard/`. The public merit
list is `GET /api/v1/public/exams/{slug}/leaderboard/` (masked names).

Payments (student token): `POST /api/v1/payments/` with `{"package_id": …}` (optional
`Idempotency-Key` header) returns the payment with a `checkout_url`; `GET /api/v1/payments/` and
`GET /api/v1/payments/{payment_id}/` show history and status. The price always comes from the
server. Only a **server-to-server verification** with the provider marks a payment successful
and creates/extends the subscription — callbacks alone never grant access. Development uses
`PAYMENT_PROVIDER=mock`: open the `checkout_url` with `?result=success` (or `fail` / `cancel`)
to simulate the provider. For the SSLCommerz sandbox set `PAYMENT_PROVIDER=sslcommerz`,
`SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD` and a public `PAYMENT_CALLBACK_BASE_URL`
(e.g. a tunnel) in `.env` — never commit them. Admins: `GET /api/v1/admin/payments/`,
`GET /api/v1/admin/payments/{payment_id}/` (with events) and
`POST /api/v1/admin/payments/{payment_id}/reverify/` (asks the provider again; audited) — there is
no way to set a payment status by hand. `celery-beat` reconciles stuck payments every 10 minutes
and marks expired subscriptions hourly.

Question images are uploaded with `POST /api/v1/admin/questions/{id}/image/` (multipart field
`image`, JPEG/PNG/WebP, max 2 MB). They are stored under `MEDIA_ROOT` (default `backend/media/`,
ignored by Git) and served by Django only while `DJANGO_DEBUG=true`.

Internal Django admin (operations only, not the product Admin Panel):
http://localhost:8000/django-admin/

---

## 3. Test the health endpoint

```bash
curl http://localhost:8000/api/v1/health/
# {"status":"ok"}

# Language selection (Bangla is the default; English on request)
curl -i -H "Accept-Language: en" http://localhost:8000/api/v1/health/   # Content-Language: en
curl -i "http://localhost:8000/api/v1/health/?lang=bn"                    # Content-Language: bn

# Unknown paths return the standard JSON error format
curl http://localhost:8000/api/v1/does-not-exist/
```

API documentation (development only): http://localhost:8000/api/docs/

Check that PostgreSQL and Redis are reachable:

```bash
docker compose exec backend python manage.py check_services
```

---

## 4. Backend tests

With Docker:

```bash
docker compose exec backend pytest
```

Without Docker (Python 3.11+):

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements/dev.txt
pytest
```

Without Docker, compile the translations once before running tests (needs GNU gettext):
`python manage.py compilemessages`. In Docker this happens automatically at startup.

Tests need **PostgreSQL** (pytest creates and deletes its own `test_…` database).
With Docker this is already running; without Docker, point the `POSTGRES_*` variables at
a local PostgreSQL user that is allowed to create databases. Redis is not needed for tests.

---

## 5. Lint, format and Django checks

Run from `backend/` (or prefix with `docker compose exec backend`):

```bash
ruff format --check .        # is the code formatted?
ruff format .                # format it
ruff check .                 # lint + import order
ruff check . --fix           # auto-fix what can be fixed
python manage.py check       # Django system check
python manage.py makemigrations --check --dry-run   # no forgotten migrations
```

### Translations (Bangla + English)

User-facing backend text is written in English inside `_("…")` and translated in
`backend/locale/bn/LC_MESSAGES/django.po`. After adding or changing such text:

```bash
python manage.py makemessages -l bn -l en --no-location --no-obsolete   # update .po files
# edit backend/locale/bn/LC_MESSAGES/django.po (fill in msgstr)
python manage.py compilemessages                                       # build .mo files
```

These need GNU gettext (already installed in the Docker image). Only the `.po` files are
committed; `.mo` files are generated (Docker build/startup and CI run `compilemessages`).

The same checks run automatically on GitHub (`.github/workflows/backend-ci.yml`) for pushes
and pull requests to `develop` and `main`.

---

## Git workflow

- `main` = releases, `develop` = integration, `feature/<name>` = one branch per feature.
- Never commit `.env`, passwords, API keys, SMS/payment credentials or private keys.
