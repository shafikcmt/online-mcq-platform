# Deployment notes — Admin Panel routing (Milestone 7)

> Scope: how the Admin Panel (Next.js) and the API (Django) are served in production.
> Example config: `deploy/nginx/admin-panel.conf.example`.

## 1. Request flow

```
Browser ──https──▶ nginx (admin.example.com)
                    ├── /api/*  ──▶ Django (gunicorn)      session cookie + CSRF, real client IP
                    ├── /media/ ──▶ uploaded files — NOT configured yet (see §4a, Milestone 10)
                    └── /*      ──▶ Next.js (`next start`) panel pages (server-rendered)
Next.js server ──▶ https://admin.example.com/api/…  (its own server-side reads, through nginx)
```

- **One browser origin.** The panel and its API share `https://admin.example.com`; the browser
  only ever calls `/api/*` on that origin. No CORS configuration is needed or wanted, and Django
  is never exposed on a separate browser-facing origin.
- **The Next.js `/api` rewrite is development-only.** The production build contains no `/api`
  proxy (`admin/next.config.ts`), so nothing about the backend is baked into the build and the
  browser's API traffic never passes through Next.js.
- **Server-side reads** (server components) call `API_ORIGIN` at runtime with the admin's own
  cookies. In production set `API_ORIGIN=https://admin.example.com` so they go through nginx too
  (TLS, `Host` and `X-Forwarded-*` are then handled exactly as for browsers; no extra
  `ALLOWED_HOSTS` entry and no conflict with `SECURE_SSL_REDIRECT`).

## 2. nginx contract for `/api/*`

| Header | Value | Why |
|---|---|---|
| `Host` | `$host` | Django's `ALLOWED_HOSTS` and the CSRF `Origin` check compare against it |
| `X-Real-IP` | `$remote_addr` | informational |
| `X-Forwarded-For` | `$proxy_add_x_forwarded_for` | nginx appends the real client IP **on the right** |
| `X-Forwarded-Proto` | `$scheme` | `SECURE_PROXY_SSL_HEADER` (HTTPS detection, secure cookies) |

`proxy_pass http://django_api;` has **no URI part**, so the path (including Django's trailing
slash) and the query string reach Django unchanged; methods, bodies, cookies and `X-CSRFToken`
pass through as-is.

## 3. Client IP, throttling and the audit log

`apps.core.net.get_client_ip` uses `REMOTE_ADDR` unless `TRUSTED_PROXY_COUNT` > 0; then it takes
the N-th `X-Forwarded-For` entry **from the right** — the one written by your own proxy. Anything
further left was sent by the client and is ignored, so a forged header cannot change the IP used
for login throttles or recorded in the audit log.

- Exactly one proxy (nginx) in front of Django → `TRUSTED_PROXY_COUNT=1`.
- CDN/load balancer → nginx → Django → `2`. Never set it higher than the real number of hops.
- Django's port must be reachable **only** from the proxy (not published to the internet).

## 4. Admin sign-in security (summary)

- Session cookie: httpOnly, Secure (production), SameSite=Lax; rotated at sign-in.
- CSRF required on every unsafe request, including sign-in itself (`/api/v1/admin/auth/csrf/`
  sets the cookie first).
- Admin sessions last **12 hours** (`ADMIN_SESSION_AGE_SECONDS`, set only on Admin Panel
  sign-in; other sessions keep `SESSION_COOKIE_AGE`). Sign-out deletes the session server-side.
- Throttles (own buckets, never shared with student logins): `admin_login_ip` 60/hour per IP,
  `admin_login` 10/hour per IP + mobile number. Every failure (unknown number, wrong password,
  student, inactive admin) gives the same `401 invalid_credentials`; `429` looks the same for every
  number.

## 4a. Uploaded media (open item — Milestone 10)

Question images are uploaded through the API (`POST /api/v1/admin/questions/{id}/image/`,
multipart) and API responses link them as `/media/<path>` on the same origin. **Production
media serving is not designed yet**; this section records the constraints, not a solution.

- **Django must not serve media in production.** It serves `/media/` only when `DEBUG` is on
  (local development and QA).
- **Local storage needs a shared, persistent volume.** Files are written to the backend's
  `MEDIA_ROOT`. If local storage is kept, that directory must be a persistent volume (not the
  container filesystem) mounted read-only into nginx, which then serves it at `/media/`. No such
  volume exists in the current Compose files, so the `location /media/` block in
  `deploy/nginx/admin-panel.conf.example` is **commented out as a TODO**.
- **Object storage may replace it.** Milestone 10 may move uploads to S3-compatible storage
  (Django storage API); the API would then return that storage's URLs and nginx needs no
  `/media/` route at all.
- **Whatever is chosen:** expose only the dedicated upload directory (never the app or a
  parent directory), read-only (`GET`/`HEAD`), no directory listings, `nosniff`, and a
  restrictive `Content-Security-Policy`. Images are already re-encoded by the backend (JPEG/PNG/
  WebP only). `client_max_body_size` must stay above `QUESTION_IMAGE_MAX_BYTES`.

Until this is settled, image previews in the Admin Panel work in development/QA (Django with
`DEBUG`) but not behind the production nginx example.

**Staging demo exception (§9):** the client-demo stack uses the local option — a shared
`media_files` volume written by the backend and served read-only by nginx at `/media/` with the
headers above. That is demo storage only; the production decision is still open.

## 5. CSRF and CORS

- **CORS: not needed** — same origin.
- **`CSRF_TRUSTED_ORIGINS`: not needed in this shape.** nginx forwards `Host`, so the browser's
  `Origin` (`https://admin.example.com`) matches `request.get_host()` with HTTPS detected from
  `X-Forwarded-Proto`. Leave it empty in production. It is only needed when the host Django sees
  differs from the panel's origin — e.g. the local Next.js dev proxy (`http://localhost:3001`).

## 6. Production environment variables

Backend (`backend` service):

| Variable | Example | Note |
|---|---|---|
| `DJANGO_ALLOWED_HOSTS` | `admin.example.com,api.example.com` | the panel host (plus the mobile API host, if separate) |
| `TRUSTED_PROXY_COUNT` | `1` | nginx is the only hop |
| `CSRF_TRUSTED_ORIGINS` | *(empty)* | see §5 |
| `ADMIN_SESSION_AGE_SECONDS` | `43200` | 12 h |
| `THROTTLE_ADMIN_LOGIN` / `THROTTLE_ADMIN_LOGIN_IP` | `10/hour` / `60/hour` | |

Admin Panel (`admin` service, runtime):

| Variable | Example | Note |
|---|---|---|
| `API_ORIGIN` | `https://admin.example.com` | server-side reads only; runtime, not build time |

## 7. Development

`npm run dev` (port 3001) proxies `/api/*` to `API_ORIGIN` (default `http://127.0.0.1:8000`);
the backend then needs `CSRF_TRUSTED_ORIGINS=http://localhost:3001` because the proxy rewrites
`Host`. This proxy adds no `X-Forwarded-For` — fine for development, never for production.

## 7a. Migrations with a data backfill

`payments.0002_payment_validity_days` (payment-safety slice) adds `Payment.validity_days`, fills
it for existing payments, then makes it NOT NULL, adds `CHECK 1..3650` and installs the
`payments_payment_snapshot_guard` trigger (amount/currency/validity_days immutable). Run it with
the normal `python manage.py migrate` before the new code serves traffic.

- The backfill is an **audit-derived reconstruction**: for each payment, the package validity in
  force at the payment's `created_at`, taken from the append-only `package.create` /
  `package.update` audit entries (an entry at the same instant counts as earlier). It is not a
  claim of exact history — timestamps come from the application servers' clocks.
- When a package has no usable audit history, it falls back to `earliest_known` (the value
  before the package's first recorded change) and then `current_package`. The migration prints
  one line with the counts, e.g.
  `payments.0002 validity_days backfill: total=… audit=… earliest_known=… current_package=…;
  successful payments whose checkout validity differs from the package validity at
  verification (reported, not corrected)=…`. Keep it in the deployment log; review
  `earliest_known`/`current_package` rows and the reported successful payments **before**
  production use — subscriptions are never rewritten automatically.
- Reversible: `migrate payments 0001` drops the trigger, the CHECK and the column.

## 8. Full-stack (Playwright) test runs

The E2E suites (`admin/e2e/*.spec.ts`) sign in with a real admin account, so they count toward
the production admin sign-in throttles (`admin_login` 10/hour per IP + number). The throttles
are **not** relaxed for tests and there is no test-only behaviour in authentication. Instead:

- run full-stack tests against an **isolated test stack** (its own database and its own Redis),
  never against a shared or production Redis;
- reset that test Redis between suites — the 7A shell suite and the 7B content suite together
  sign in more than ten times;
- a sign-in that fails during a run with `429` means the throttle worked, not that the code broke.

### Disposable database (`admin/e2e/stack/run.sh`)

The suites exercise the full exam lifecycle. A published exam, the questions it locks and the
audit log can never be deleted — by design, and there is **no** test-only endpoint or force-delete
to get around it. So instead of cleaning up record by record, the suites run on a throwaway
database:

1. `e2e-db.sh template` creates `mcq_e2e_template`, migrates it and runs `seed.py` (the admin
   account from `E2E_ADMIN_MOBILE`/`E2E_ADMIN_PASSWORD`, one published exam, and — for the
   Results suite — two published exams with five results submitted by four students without
   passwords, merit not generated; for the Users suite, one inactive student with an
   email; for the Attempts suite, one open attempt started through the exam engine and not
   submitted; for the Packages and Subscriptions suites, a paid draft exam, three packages
   (one unused) with access rules and an active, a scheduled and a cancelled subscription
   granted/cancelled by the subscription services; for the Payments suite, five payments
   through the payment services and the **mock** provider only — two verified E2E Gold
   payments that both extend Tanvir's running subscription (two payments, one
   subscription), one failed, one cancelled and one still pending; the mock provider's
   ledger is kept in the seeding process's local memory, so seeding touches no Redis
   database; all created through the normal services, students submitting through the
   exam engine).
2. Before **each** suite, `e2e-db.sh fresh` re-creates `mcq_e2e` as a copy of the template, and
   Redis databases 14 (broker) and 15 (cache) are emptied with `FLUSHDB` (never `FLUSHALL`).
3. `run.sh` starts its own Django server (development settings) on that database, with a new
   empty `MEDIA_ROOT`, and prints what each suite added above the seed.
4. At the end — also after a failure — both databases are dropped, the media folder deleted and
   the two Redis databases emptied; the script then verifies that none of them remain.

```bash
E2E_DISPOSABLE_DB=destroy-and-recreate \
POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5432 POSTGRES_USER=… POSTGRES_PASSWORD=… \
PYTHON=backend/.venv/bin/python E2E_BASE_URL=http://localhost:8088 \
E2E_ADMIN_MOBILE=… E2E_ADMIN_PASSWORD=… \
admin/e2e/stack/run.sh payments packages subscriptions attempts users results exams content admin-shell api-proxy
```

**Mobile App (web QA build).** The same script runs the app's suites
(`mobile/e2e/*.spec.ts`) against the app's web build. The web build is only a QA vehicle on a
desktop browser — the product is the Android app with the same code. Extra options:

- `E2E_PROJECT_DIR=mobile` — run that project's Playwright suites instead of the panel's;
- `E2E_CELERY_WORKER=1` — also start a Celery worker on the same disposable database and
  Redis databases (it issues the SMS codes) and stop it at the end;
- the server and worker use the **mock** SMS provider with `SMS_MOCK_LOG_CONTENT=true`
  (development settings, `DEBUG` on), so the code appears in the disposable server log, whose
  path the suites receive as `E2E_DJANGO_LOG`; the log is deleted with the media folder.

Serve the exported build (`EXPO_PUBLIC_API_URL=/api/v1 npx expo export --platform web`) and
`/api/` on one origin (an nginx `server` with `try_files $uri /index.html` for the app and
`/api/` → Django), then:

```bash
E2E_DISPOSABLE_DB=destroy-and-recreate … E2E_BASE_URL=http://localhost:8089 \
E2E_PROJECT_DIR=mobile E2E_CELERY_WORKER=1 admin/e2e/stack/run.sh notifications payments results exam-room exams dashboard auth
```

The panel (`next start`) and nginx must already run, with nginx sending `/api/` to
`127.0.0.1:8000` (`E2E_DJANGO_PORT`); the port must be free, since the script starts Django there.

**Safety guards** — `e2e-db.sh` refuses to create or drop anything unless all of these hold:

- `E2E_DISPOSABLE_DB=destroy-and-recreate` is set (explicit opt-in; any other value refuses);
- `POSTGRES_HOST` is the local machine (`localhost`, `127.0.0.1`, `::1`);
- the database name matches `^mcq_e2e[a-z0-9_]*$`, is not `online_mcq` and is not the
  `POSTGRES_DB` configured in the repository's `.env`;
- an **existing** database is dropped only if it carries the marker comment this tool writes
  when it creates one — a database that merely has a matching name is never touched.

`exams.spec.ts` refuses to start without `E2E_DISPOSABLE_DB=destroy-and-recreate`, so it cannot
be run by accident against a database whose records it could not remove.

## 9. First client demo — staging deployment (manual, controlled)

> A **staging / demo** environment for the client review. It is **not** the production
> deployment: production sizing (20,000 students), media storage, monitoring and real payment/SMS
> providers are separate, later work. Files: `docker-compose.staging.yml`,
> `.env.staging.example`, `deploy/nginx/demo-admin*.conf`, `deploy/staging/*.sh`,
> `backend/Dockerfile` (`production` target), `admin/Dockerfile`. Demo scope: `docs/DEMO_SCOPE.md`.

### 9.1 Shape

```
Internet ──▶ nginx (only published ports 80/443; edge + internal networks)
              ├─ /api/*, /<DJANGO_ADMIN_URL> ─▶ backend (gunicorn, prod settings)
              ├─ /static/  (shared volume, read-only)      ◀─ collectstatic
              ├─ /media/   (shared volume, read-only)      ◀─ question image uploads
              └─ /*        ─▶ admin (next start)
internal network (internal: true — NO internet route):
   backend · celery (worker) · celery-beat · admin · postgres (online_mcq_demo) · redis
```

- **One public host**, e.g. `demo-admin.<domain>`, for the panel and its API — same origin, so no
  CORS and no `CSRF_TRUSTED_ORIGINS` (§5). Inside Docker that name is a network alias of nginx,
  so the panel's server-side reads (`API_ORIGIN=https://demo-admin.<domain>`) never leave the server.
- **No internet route** for the app containers: the API, Celery and the panel cannot contact a
  payment gateway or an SMS provider at all. (Production will need egress — a later decision.)
- **Media:** a shared volume served read-only by nginx — **demo storage only**, not the final
  production media design (§4a).
- Images run as non-root users (`app`, `node`); secrets come only from `.env.staging` at run time.
  Every service has `restart: unless-stopped`, Docker log rotation (10 MB × 5) and a memory limit.

### 9.2 Payments and SMS in the demo

- **No real money, no merchant credentials, no real SMS.** Production settings refuse the mock
  payment provider, so the runtime provider is the SSLCommerz **sandbox** with non-functional
  placeholder store values (`PAYMENT_ALLOW_SANDBOX_IN_PRODUCTION=true`), and SMS is the mock
  provider (`SMS_ALLOW_MOCK_IN_PRODUCTION=true`; production settings force OTP text out of logs).
  These two allowances exist **only** in `.env.staging.example` — never copy them into production.
- Nothing in the demo starts a payment (no student app yet; the panel is read-only), and the
  internal network has no route out anyway.
- **Sample payments** come from `seed_demo`, which — inside its own process only — enables the
  in-process mock gateway while creating them (no network). They are stored as provider `mock`;
  at runtime the mock provider stays disabled, so the reconciliation job **skips** them (a
  "provider disabled" warning in the logs) and re-verify would answer `409 provider_disabled`.

### 9.3 TLS strategy

Host-level **certbot (webroot)** + the nginx container. nginx mounts `/etc/letsencrypt` and the
webroot read-only. Two site templates (filled from the environment at container start):

- `demo-admin-http.conf` — **bootstrap**: HTTP only, serves the ACME challenge; needs no
  certificate, so nginx always starts;
- `demo-admin.conf` — **HTTPS**: HTTP → HTTPS redirect (ACME still answered on port 80), TLS 1.2/1.3,
  short HSTS (`HSTS_SECONDS`, 1 hour at first), `X-Robots-Tag: noindex, nofollow` on everything.

Switch with `NGINX_SITE` in `.env.staging` and `up -d nginx`. Renewal: certbot's own timer with a
deploy hook that reloads nginx (step 15).

### 9.4 Ordered first-deploy checklist

Run as the non-root `deploy` user in `/srv/mcq-demo/app` (a checkout of a **pinned tag**). Shorthand:
`dc() { docker compose --env-file .env.staging -f docker-compose.staging.yml "$@"; }`

1. **VPS** — Ubuntu LTS, 2 vCPU / 4 GB RAM / 40 GB SSD minimum (comfortable: 2–4 vCPU / 8 GB);
   add 2 GB swap (the panel image build is memory-hungry); enable unattended security upgrades.
2. **Deploy user** — create `deploy` with SSH-key login; disable password and root SSH login;
   firewall (UFW): allow 22 (ideally from your IP only), 80, 443 — nothing else.
3. **Docker** — Docker Engine + Compose plugin; add `deploy` to the `docker` group.
4. **DNS** — `A` (and `AAAA` if used) record `demo-admin.<domain>` → the VPS; wait until it resolves.
5. **Checkout** — `git clone … /srv/mcq-demo/app && git -C /srv/mcq-demo/app checkout <tag>`
   (e.g. `demo-2026.10-1` — never a floating branch).
6. **`.env.staging`** — `cp .env.staging.example .env.staging && chmod 600 .env.staging`; set
   `DEMO_HOST`, `API_ORIGIN`, `DJANGO_ALLOWED_HOSTS`, `PAYMENT_*_URL`, `IMAGE_TAG` (= the tag),
   `NGINX_SITE=demo-admin-http.conf`, and **new** values for `DJANGO_SECRET_KEY`, `JWT_SIGNING_KEY`
   (different), `POSTGRES_PASSWORD`, `DJANGO_ADMIN_URL`. `mkdir -p /srv/mcq-demo/certbot-www /srv/mcq-demo/backups`.
7. **Build** — `dc build` (the panel image runs lint, typecheck and `next build` itself).
   **First-VPS verification item:** the backend image's `apt-get install gettext` step (Debian
   mirrors) has not been executed in a real build yet — confirm it succeeds here (§9.6).
8. **PostgreSQL/Redis** — `dc up -d --wait postgres redis`.
9. **Migrate** — `dc run --rm backend python manage.py migrate --noinput`.
10. **Static files** — `dc run --rm backend python manage.py collectstatic --noinput`.
11. **Demo data** — `dc run --rm backend python manage.py seed_demo` (refuses unless
    `DEMO_SEED_ALLOWED=true`, `DEMO_ENVIRONMENT=staging-demo` and `POSTGRES_DB=online_mcq_demo`;
    running it again changes nothing).
12. **Admin accounts** (two; passwords typed at a hidden prompt — never on the command line):
    `dc run --rm backend python manage.py create_demo_admin --mobile <number> --full-name "Client Demo"`
    and the same for your own operator account. Both are `role=admin`, **not** Django
    superusers. Running it again for a number sets a new password (use this to rotate after the demo).
13. **Bootstrap nginx (HTTP)** — `dc up -d --wait` (all services; nginx starts with the HTTP site).
14. **TLS certificate** — on the host: `sudo apt install certbot` then
    `sudo certbot certonly --webroot -w /srv/mcq-demo/certbot-www -d demo-admin.<domain> --agree-tos -m <email>`.
    **External verification item:** real issuance has not been tested yet (§9.6); if it fails,
    nginx keeps serving the HTTP bootstrap site — fix DNS/firewall and retry before step 15.
15. **Enable HTTPS** — set `NGINX_SITE=demo-admin.conf`, `dc up -d nginx`; add a renewal hook:
    `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` running
    `docker compose --env-file /srv/mcq-demo/app/.env.staging -f /srv/mcq-demo/app/docker-compose.staging.yml exec -T nginx nginx -s reload`;
    check `sudo certbot renew --dry-run`.
16. **All services** — `dc ps` shows every service `healthy`/`running`.
17. **Service check** — `dc run --rm backend python manage.py check_services`.
18. **Browser smoke test** — `docs/DEMO_SCOPE.md` acceptance list (login, every panel route,
    EN/BN, phone width, payments read-only, "Validity bought", HTTPS + `noindex` headers).
19. **Backup** — `deploy/staging/backup.sh` (custom-format dump to `/srv/mcq-demo/backups`, 7-day
    retention); add a nightly cron entry for it.
20. **Client demo** — send the URL and, through a separate channel, the client account's password.

### 9.5 Operations

- **Reset demo data:** `deploy/staging/reset-demo.sh --yes` — backup → stop app services → drop and
  recreate `online_mcq_demo` → migrate → `seed_demo` → start → `check_services`. It refuses without
  the `DEMO_ENVIRONMENT=staging-demo` marker or for any database other than `online_mcq_demo`.
  Admin accounts are not recreated by the script (that would need passwords in a script) — run
  step 12 again afterwards.
- **Update to a new tag:** `deploy/staging/backup.sh` → `git checkout <new-tag>` → set
  `IMAGE_TAG` → `dc build` → `dc run --rm backend python manage.py migrate --noinput` →
  `collectstatic` → `dc up -d --wait`.
- **Rollback:** previous images stay tagged (`mcq-backend:<old-tag>`, `mcq-admin:<old-tag>`): set
  `IMAGE_TAG` back and `dc up -d --wait`. If the new tag ran a migration, the simplest safe path
  is restoring the pre-update dump:
  `dc exec -T postgres pg_restore -U mcq_demo -d online_mcq_demo --clean --if-exists < <dump>`.
- **Rebuild from scratch:** a new VPS → this checklist → restore the latest dump instead of
  `seed_demo` (or reset).
- **After the demo window:** rotate the client account's password (step 12 again) or deactivate it.

### 9.6 Validation status (before the first VPS deploy)

Validated locally (sandbox Docker, self-signed certificate, no internet route):

- backend suite **1799 passed** (including the 30 staging tests in `tests/test_demo_staging.py`);
  ruff, `check`, `makemigrations --check` and the OpenAPI schema clean;
- both images built; all seven services healthy; only nginx published host ports (no 3000,
  8000, 5432 or 6379 on the host);
- `migrate`, `collectstatic`, `seed_demo` and a second, unchanged `seed_demo` run;
- admin sign-in; every panel route in English and Bangla, desktop and phone width; payments and
  subscriptions read-only; "Validity bought 30 days"; static files and question-image upload
  and read-back through nginx; one HSTS header; `noindex` headers; API docs 404;
- Celery worker and beat running; reconciliation skipped the seeded mock payments with **no**
  gateway call; outbound DNS/connections from the app containers failed (no egress);
- `backup.sh` (including same-second and concurrent runs), retention, the demo guards and
  `reset-demo.sh --yes`.

The local image builds used a sandbox-only workaround (the sandbox network blocks Debian mirrors
and needs a proxy CA); that workaround is **not** part of the repository.

**Not yet verified — check on the first VPS deploy:**

1. the real `apt-get install gettext` step of `backend/Dockerfile` against the Debian mirrors (step 7);
2. real Let's Encrypt issuance with certbot webroot, the switch to `demo-admin.conf`, and
   `certbot renew --dry-run` with the nginx reload hook (steps 14–15).

**Synthetic data:** all seeded students use made-up `017000003xx` numbers and `example.org`
emails. They look like valid Bangladeshi numbers, but the demo has **no SMS provider** (mock
only) and **no internet route**, and no scheduled job sends SMS, so they are never contacted.
Never replace them with real people's numbers.
