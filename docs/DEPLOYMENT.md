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
