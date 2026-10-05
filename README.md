# Online MCQ Examination Platform

A production-oriented Online MCQ Examination Platform with:

- Android Mobile App (students take exams here)
- Public Website (information only)
- Admin Panel
- Secure Backend/API (Django + Django REST Framework)
- PostgreSQL Database, Redis, Celery
- Bangla + English (bilingual) throughout

## Current Status

**Milestone 1 — Project Foundation.** The backend skeleton, Docker setup, tests and CI exist.
No business features yet (no users, exams, payments…). See `docs/ROADMAP.md`.

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
│   │   └── core/             shared code: health endpoint, error format, pagination,
│   │                         language middleware, Bangla/English helpers
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

> ⚠️ **Do not run `python manage.py migrate` yet.** The custom User model is created in
> Milestone 2 before the first migration. Running migrations now is blocked on purpose and
> prints an explanation.

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

Tests do not need PostgreSQL or Redis running (they use in-memory replacements).

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

The same checks run automatically on GitHub (`.github/workflows/backend-ci.yml`) for pushes
and pull requests to `develop` and `main`.

---

## Git workflow

- `main` = releases, `develop` = integration, `feature/<name>` = one branch per feature.
- Never commit `.env`, passwords, API keys, SMS/payment credentials or private keys.
