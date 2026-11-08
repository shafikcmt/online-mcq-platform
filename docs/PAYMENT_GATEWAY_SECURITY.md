# Payment gateway security

What protects the payment gateway system, what an attacker or a mistake can and cannot do,
and what the owner must do to keep it that way. Every row of the table is backed by a test
(see `PAYMENT_GATEWAY_TESTING.md`); rows that depend on a real provider say so.

## 1. Rules for credentials

- Provider credentials (bKash app key/secret/username/password, SSLCommerz store ID/password)
  go **only** into the Admin Panel form or the server's `/srv/mcq/.env.prod` (mode 600).
  Never into git, chat, e-mail, tickets or screenshots. No one at the platform asks for them
  in a message; if someone does, it is not us.
- The panel stores them **encrypted** (Fernet) with `SECRET_ENCRYPTION_KEY`, which lives only
  in the server environment. The database alone cannot reveal a credential.
- They are **write-only**: after saving, the panel shows "set" and the last four characters
  (only for values longer than 8 characters). No API returns a stored value.
- A credential is decrypted **in memory**, only for the adapter call that needs it. It is not
  logged, not put in an exception message, not in an audit entry, not in the gateway history,
  not in a payment event, and not in `repr()` of the configuration object.

## 2. Who can change what

| Action | Who | Extra check |
|---|---|---|
| View gateways, history, statistics | Admin role only | session + CSRF |
| Create / edit a gateway, enable / disable, add or remove testers, revoke a test subscription | Admin role only | session + CSRF |
| **Save or change credentials** | Admin role only | the admin's **own password again** |
| **Switch sandbox ⇄ live** | Admin role only | the admin's **own password again** |

Students (also their mobile tokens) and anonymous visitors get 401/403 on every admin route;
a crawl of **all** `/api/v1/admin/` routes and methods enforces it, so a route added later is
checked automatically. The only admin-prefixed routes open before sign-in are the sign-in
itself and its CSRF cookie.

**Password re-confirmation** counts wrong attempts per admin: 5 wrong in 15 minutes lock the
action (429 `reauth_locked`) even for the right password, so a stolen session cannot guess the
password. The password is never written to a log, an audit entry or the history.

## 3. Money safety

1. A browser callback only **finds** the payment. It never grants anything.
2. Access is granted only after a **server-to-server** answer from the provider whose
   reference, amount and currency match our own record. The provider's number is compared to
   ours, not trusted: a "paid 1 taka" answer for a 500 taka package does not grant.
3. With several merchant accounts, the callback signature is checked with **that payment's own
   account**. A callback signed with another account's secret is refused before the provider is
   even asked.
4. A payment keeps the gateway row and **mode** it was created under (a PostgreSQL trigger
   forbids changing them). Editing, disabling or switching a gateway to live cannot move an
   existing payment to other credentials.
5. A replayed callback, a repeated provider transaction, eight simultaneous confirmations or a
   double click create **one** payment and **one** subscription (row locks, unique provider
   transaction, idempotency key).
6. A provider answer that is unexpected or missing leaves the payment unchanged; it never
   becomes "paid" by default.
7. The browser is redirected only to server-configured return URLs.
8. Prices come from the server; the client sends only the package, the gateway and the channel.

## 4. Sandbox and live are kept apart

- Separate credentials, hosts and payment records per mode.
- A sandbox gateway is offered only to designated testers; a sandbox payment gives only a
  revocable **test subscription**, excluded from real subscriptions, revenue, statistics and the
  dashboard.
- Going live requires every live credential **and** a successful sandbox payment on **that
  gateway**; no request shape bypasses it (mode endpoint, PATCH, create with `mode=live`).

## 5. Abuse limits

| Limit | Default |
|---|---|
| Start a payment | 10 per hour per student (`THROTTLE_PAYMENT_INIT`) |
| Method list | 60 per minute per student (`THROTTLE_PAYMENT_METHODS`) |
| Provider callback / IPN | 120 per minute per IP (`THROTTLE_PAYMENT_CALLBACK`) |
| Connection test | one per gateway every 5 seconds |
| Re-verify one payment | cooldown `PAYMENT_REVERIFY_COOLDOWN_SECONDS` (60) |
| Admin password guesses | 5 per 15 minutes per admin |

If the cache (Redis) is unavailable the throttles **fail closed** (the request is refused).

## 6. Audit trail

Every gateway change writes (1) the gateway's own **append-only** history (the model, the
queryset and a PostgreSQL trigger all refuse edit and delete) and (2) the admin audit log,
in the same transaction, with the actor and IP. They record *what* changed (field names, modes,
counts) and never a value.

## 7. What the owner must do

1. **Back up `SECRET_ENCRYPTION_KEY`** in the password store, separate from the server. If it
   is lost or changed, every stored credential (and the SMS key) becomes unreadable and must be
   typed in again; payments in flight fail until you do. There is no re-encryption tool yet.
2. Keep `/srv/mcq/.env.prod` mode 600, readable only by the deploy user.
3. Give the Admin role to as few people as possible; each admin needs a strong password and
   should use the Basic-Auth lock in front of the panel.
4. After any suspicion, change the provider credentials **at the provider first**, then in
   the panel (see the incident steps in `PAYMENT_GATEWAY_READINESS.md`).
5. Review the gateway history and the admin audit log periodically for changes you did not make.
6. Keep payments `unavailable` until a provider has accepted a sandbox payment from this code.

## 8. What this does **not** protect against

- A malicious or compromised **admin** who knows their own password can change credentials and
  gateways. The history and audit log record it; nothing prevents it.
- Someone with the server's shell **and** the environment can read `.env.prod` and decrypt the
  credentials. Protect the server (SSH keys, no shared logins, firewall: only Nginx publishes
  ports).
- Weaknesses inside a provider's own system.
- **Anything about the real bKash and SSLCommerz behaviour**: the adapters are tested only
  against fakes. Their signature rules, status values and failure cases are unproven until a
  real sandbox payment has been run (see `PAYMENT_GATEWAY_READINESS.md`).
- Logos: the logo is an admin-entered https address loaded from that host into students'
  browsers; use an address you control.
- No external penetration test and no dependency audit has been done.
