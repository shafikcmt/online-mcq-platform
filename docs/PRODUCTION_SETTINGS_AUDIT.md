# Production settings & security audit (Milestone 10H)

Audit of the production configuration — settings, secrets, HTTPS, cookies, headers,
database, Redis, logging, static/media, gunicorn, nginx and Docker — **before** the first
production deployment. Nothing was deployed; no server, DNS or credential was touched.
Baseline: `develop` at `9c82404`.

Legend: ✅ in place and verified · 🔧 fixed in 10H · ⏳ needs the real server, domain,
credentials or an owner decision (do not invent values) · 💡 recommendation.

## 1. Django `check --deploy`

✅ `python manage.py check --deploy --fail-level WARNING` with `config.settings.prod`:
**no issues (1 silenced)**. The silenced check is `security.W021` (HSTS preload) — a
deliberate later decision, because preload is hard to undo (`prod.py`).

🔧 New regression test `tests/test_configuration.py::test_production_settings_pass_djangos_deploy_check`
runs the same command in a fresh process with throwaway random values. Verified that it
fails when production is weakened (e.g. `DJANGO_SECURE_SSL_REDIRECT=false` →
`security.W008`, `DJANGO_SECURE_HSTS_SECONDS=0` → `security.W004`).

## 2. Settings review

| Area | Status | Where / notes |
|---|---|---|
| `DEBUG` | ✅ | Defaults to false (`base.py`); `prod.py` refuses to start with `DJANGO_DEBUG=true` (`checks.validate_production_settings`). |
| `ALLOWED_HOSTS` | ✅ ⏳ | From the environment; production refuses an empty list or `*`. The real host names come with the domain. |
| `SECRET_KEY` / `JWT_SIGNING_KEY` | ✅ | From the environment only; production refuses placeholders, values shorter than 50 characters, and the two being equal. Not in the image (`Dockerfile`: "secrets come from the environment at run time"). |
| Database password | ✅ | From the environment; production refuses placeholders. |
| SMS / payment | ✅ ⏳ | Production refuses the mock SMS provider (unless explicitly allowed for a non-public test), never allows the mock payment provider, refuses SSLCommerz sandbox (unless explicitly allowed), requires an `https://` callback URL. Real SMS and SSLCommerz credentials: client (open questions 1, 2). |
| `.env` templates | ✅ | `.env.example`, `.env.staging.example`, `web/.env.example`: placeholders only; `.env*` files are git-ignored. |
| HTTPS | ✅ | `SECURE_SSL_REDIRECT` (default on), `SECURE_PROXY_SSL_HEADER` — safe because nginx always overwrites `X-Forwarded-Proto` and gunicorn is never published. |
| HSTS | ✅ ⏳ | Django: 1 year, `includeSubDomains`, no preload. The staging demo deliberately starts at 1 hour (`HSTS_SECONDS` = `DJANGO_SECURE_HSTS_SECONDS`, kept equal). Raise to a year only when the domain is final and **every** subdomain serves HTTPS (`includeSubDomains`). Preload: owner decision later. |
| Cookies | ✅ | `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE` in production; session cookie HttpOnly and SameSite=Lax (Django defaults); admin sessions expire after `ADMIN_SESSION_AGE_SECONDS` (12 h). The CSRF cookie stays readable by the panel's JavaScript by design (double-submit header). |
| CSRF | ✅ | Admin Panel: session + CSRF; same origin through nginx, so `CSRF_TRUSTED_ORIGINS` stays empty in production. Student API: JWT (no cookies, no CSRF). |
| CORS | ✅ | No CORS package and no CORS headers: the panel and the website call the API on their own origin through nginx; the Android app is not a browser. Cross-origin browser calls are therefore refused — intended. |
| JWT | ✅ | Access 15 min, refresh 30 days, rotation + blacklist after rotation; deactivation revokes refresh tokens (10C). |
| Passwords | ✅ | Argon2; validators incl. minimum length and similarity to mobile number / name / email. |
| Throttling | ✅ | Login, OTP, contact form and admin sign-in throttles. Client IP: `TRUSTED_PROXY_COUNT=1` behind nginx (staging template), 0 (spoof-safe) by default. |
| Security headers (API) | ✅ | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`; JSON-only renderer and parser (no browsable API); JSON 404/500 handlers. |
| Security headers (panel, website) | ✅ 💡 | Next.js: `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, no `X-Powered-By`. 💡 A Content-Security-Policy for the two Next.js apps (needs nonces for Next's inline scripts) and a `Permissions-Policy` header are worthwhile follow-ups. |
| API docs | ✅ | `/api/schema/` and `/api/docs/` off in production (`API_DOCS_ENABLED=false`). |
| Django admin | ✅ ⏳ | At `DJANGO_ADMIN_URL` (staging template: `ops-change-me/`, to be replaced on the server); internal operations only. 💡 Production could additionally restrict this path by IP in nginx. |
| Health endpoint | ✅ | `GET /api/v1/health/` returns only `{"status": "ok"}`. |

## 3. Database (PostgreSQL)

- ✅ Not published: the staging stack publishes **only nginx** (test
  `test_compose_publishes_only_nginx_and_isolates_the_rest`); PostgreSQL sits on the
  internal Docker network. Local development binds to `127.0.0.1` only.
- ✅ Password from the environment; `CONN_MAX_AGE` 60 s with health checks.
- ✅ Backup and guarded restore scripts (`deploy/staging/backup.sh`, `restore.sh`), restore
  drill passed locally (10D). ⏳ The drill on the real server.
- 💡 TLS to the database is unnecessary while it runs on the same host's internal network;
  needed only if it moves to a separate server.
- 💡 Least privilege: the app connects as the database owner (it runs migrations). A
  separate migration role and a non-owner runtime role is an option for later.

## 4. Redis

- ✅ Not published (internal network only, same test as above); cache and Celery broker
  only, nothing that must survive a restart (`--save "" --appendonly no` in staging).
- 💡 `requirepass` (and a password in `REDIS_URL`) as defence in depth if Redis ever leaves
  the internal Docker network.

## 5. Logging and error reporting

- ✅ Console logging (Docker captures it, size-limited log rotation in the staging
  compose); gunicorn access and error logs to stdout/stderr.
- ✅ No secrets or OTP text in logs: production forces `SMS_MOCK_LOG_CONTENT=false`;
  structured logs without personal data (`SECURITY_PLAN.md` §4).
- ⏳ No external error reporting (e.g. Sentry) is configured — it needs an account and a
  DSN from the owner. Until then, errors are in the container logs.

## 6. Static files and media

- ✅ `collectstatic` → shared volume served by nginx (`/static/`, `autoindex off`).
- ✅ Media (question images): served by nginx only, never by Django in production,
  `autoindex off`, `nosniff`, `Content-Security-Policy: default-src 'none'; img-src 'self'; sandbox`;
  upload limits 2 MB / 16 MP (nginx body limit 10 MB).

## 7. gunicorn and reverse proxy

- ✅ gunicorn (`backend/gunicorn.conf.py`): bound inside the Docker network only, 3 sync
  workers, 60 s timeout, worker recycling, logs to stdout — sized for a small VPS, tunable
  by environment.
- ✅ nginx: one origin per host; `X-Forwarded-Proto` / `X-Forwarded-For` set by nginx;
  HTTP → HTTPS redirect; ACME challenge path for certificate renewal; website host exposes
  only `/api/v1/public/`; `noindex` on the demo hosts; containers resolved by name at
  request time.
- 🔧 **`server_tokens off`** added to every `server` block of every nginx configuration
  (`deploy/nginx/*`): nginx no longer reveals its version in the `Server` header or on its
  error pages. New test `test_nginx_never_reveals_its_version`. All five files pass
  `nginx -t`.

## 8. Docker production configuration

- ✅ Production image target: runtime requirements only, non-root user (`app`, uid 1000),
  code baked in, no source mount, `config.settings.prod` by default, no secrets in the
  image; translations compiled at build time.
- ✅ Staging compose: only nginx publishes ports; memory limits; health checks; restart
  policies; log rotation; CI validates the compose file (config only).
- ⏳ A dedicated production compose / server layout is part of the deployment on the
  client's VPS (currently the staging compose is the template).
- 💡 Pin base images by digest (`python:3.12-slim`, `postgres:16-alpine`, `redis:7-alpine`,
  `nginx:1.27-alpine`) for reproducible production builds, and rebuild regularly for
  security updates.

## 9. Pending before production (needs the client)

1. Real domain(s) → `DJANGO_ALLOWED_HOSTS`, nginx host names, TLS certificates, final HSTS.
2. Production secrets generated **on the server** (never in chat or the repository):
   `DJANGO_SECRET_KEY`, `JWT_SIGNING_KEY`, `POSTGRES_PASSWORD`, `DJANGO_ADMIN_URL`.
3. Real SMS provider credentials; SSLCommerz live credentials and the public callback URL.
4. Error reporting account (optional but recommended).
5. Backup restore drill on the real server.
