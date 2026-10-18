# Deployment notes — Admin Panel routing (Milestone 7)

> Scope: how the Admin Panel (Next.js) and the API (Django) are served in production.
> Example config: `deploy/nginx/admin-panel.conf.example`.

## 1. Request flow

```
Browser ──https──▶ nginx (admin.example.com)
                    ├── /api/*  ──▶ Django (gunicorn)      session cookie + CSRF, real client IP
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
