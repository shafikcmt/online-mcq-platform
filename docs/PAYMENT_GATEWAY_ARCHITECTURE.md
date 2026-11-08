# Payment gateway architecture

How the dynamic payment gateway system is built: what a gateway is, where its configuration
lives, how a payment moves from "student taps Pay" to "access granted", and which rule keeps
each step safe. Read `PAYMENT_GATEWAY_SETUP.md` to put it into service,
`PAYMENT_GATEWAY_SECURITY.md` for the protections, `PAYMENT_GATEWAY_TESTING.md` for the tests
and `PAYMENT_GATEWAY_READINESS.md` for what is and is not proven. `PAYMENT_METHODS.md` keeps the
per-provider notes (bKash sandbox checklist, Nagad, Rocket, Bangla QR, Google Play).

## 1. The pieces

| Piece | What it is | Where |
|---|---|---|
| **Adapter** | The code that talks to one provider (bKash, SSLCommerz). One small class behind one interface; adding a provider changes no table and no API. | `apps/payments/gateways/` |
| **Registry** | The list of adapters with the credential fields and options each needs. The admin form is drawn from it; unknown fields are refused. | `gateways/registry.py` |
| **Gateway** | One **merchant account** configured by an admin: adapter, name, mode, channels, limits, return URLs. The same adapter can be added twice for two accounts. | `models.PaymentGateway` |
| **Credentials** | The secret values of a gateway, one encrypted row per (gateway, mode, field). Sandbox and live never share a row. | `models.PaymentGatewayCredential`, `gateway_store.py` |
| **Gateway manager** | Decides which gateways a student is offered and builds an adapter with the right configuration. | `gateway_manager.py` |
| **Gateway admin** | Every admin operation (create, edit, credentials, mode, enable, test, testers, revoke) with password re-confirmation. | `gateway_admin.py`, `api/gateway_views.py` |
| **Payment services** | Starts a payment, handles callbacks, verifies with the provider, reconciles. Unchanged in principle from the first payment batch. | `services.py` |
| **Admin Panel** | Commerce → Payment gateways. Uses only the admin API. | `admin/src/components/gateways/` |
| **Website / app checkout** | Ask for the methods of their own channel, send the chosen gateway and the channel. | `web/.../account/buy`, `mobile/.../packages` |

## 2. Configuration: database first, environment as fallback

1. **Database gateways** are offered only while *all* of these hold: the gateway is enabled,
   its adapter is implemented, every required credential for its **current mode** exists and
   can be decrypted, it is switched on for the caller's channel (website or app), and the
   package price and currency fit its limits.
2. **Environment fallback** (`PAYMENT_PROVIDER`, `PAYMENT_ENABLED_PROVIDERS`, `BKASH_*`,
   `SSLCOMMERZ_*`): used for an adapter only while the database holds **no gateway row for
   that adapter at all**. An existing deployment keeps working untouched; the moment an
   admin adds a gateway for an adapter, the panel wins for it.
3. `PAYMENT_PROVIDER=unavailable` switches **every** payment off, whatever else is configured.
   It is the emergency switch.
4. `PAYMENT_PROVIDER=database` offers **only** the database gateways: no environment
   fallback, and production's startup check asks for no `BKASH_*` / `SSLCOMMERZ_*`
   credentials (it still requires the callback and return addresses). This is the intended
   production value once gateways are managed in the panel.

## 3. Modes and testers

- A gateway is in **sandbox** or **live** mode. Each mode has its own credentials, its own
  provider host and its own payments. Mode is part of the gateway's configuration, never a
  request parameter.
- A sandbox gateway is offered **only to designated tester accounts** (`PaymentTester`).
  Everyone else never sees it, and naming it in a request does not help.
- What a tester buys through a sandbox gateway is a **test subscription** (`is_test`). It
  gives the tester access so the exam flow can be checked, but it is kept apart from real
  subscriptions, revenue, payment statistics and the dashboard, and an admin can revoke it.
  A sandbox payment never creates, extends or changes a real subscription, and a live
  payment never extends a test one.
- **Going live** needs (1) every required live credential and (2) at least one *successful*
  sandbox payment recorded in our own database for **that gateway**. The mode endpoint
  refuses otherwise (409 `live_not_ready`, listing what is missing).

## 4. Life of a payment

```
Student taps Pay (website or app)
  → POST /api/v1/payments/  {package_id, gateway, channel}   (price is never sent)
      server: pick the offer for that student/channel/price; freeze gateway + mode + channel
      on the payment; open a session with the provider using that gateway's credentials
  → student pays on the provider's own page
  → provider sends the browser to  /api/v1/payments/callback/<provider>/<success|fail|cancel>/
    and (SSLCommerz) posts an IPN to  /api/v1/payments/ipn/<provider>/
      server step 1: find the payment from the reference — no credentials involved
      server step 2: check the callback signature with THAT payment's merchant account
      server step 3: ask the provider server-to-server for the transaction's real state
      server step 4: grant only if reference, amount and currency match our record
  → browser is redirected to the return page chosen by the server
      (gateway's own URL for the channel → PAYMENT_WEB_RETURN_URL / PAYMENT_RETURN_URL)
  → the page/app asks the server for the payment's status; that answer is what is shown
  → Celery beat reconciles open payments (every 10 minutes by default, `PAYMENT_RECONCILE_INTERVAL_SECONDS`; read-only)
```

Rules that never bend:

1. A browser callback only **finds** the payment; it decides nothing.
2. Money is granted only after the provider's **server-to-server** answer matches our
   reference, amount and currency (`apply_verification`, under a row lock).
3. A replayed callback or a repeated provider transaction grants nothing twice.
4. A payment keeps the **gateway row and mode it was created under** (frozen by a database
   trigger): switching a gateway to live, disabling it or editing it cannot send an existing
   payment to other credentials. Disabling a gateway stops *new* payments, never the
   settlement of old ones.
5. Unexpected provider answers leave the payment unchanged (`ERROR`), never "paid".
6. Return URLs come from server configuration or the admin panel, never from the request.

## 5. Channels

The website and the mobile app are separate **channels**. Each gateway can be on or off for
each, and may have its own return URL for each. The client sends `channel` (`web` or `app`)
with the method list request and with the payment; the server uses it for availability and
for the return redirect. Mobile deep link: `livemodeltest://payment-result` (the app's
scheme from `mobile/app.json`).

## 6. Data model (payments app)

- `PaymentGateway`: slug (unique, fixed after creation), adapter, names and descriptions in
  both languages, logo URL (https), `mode`, `enabled`, `web_enabled`, `app_enabled`,
  currencies, min/max amount, priority, return URLs, options (validated JSON), last connection
  test result.
- `PaymentGatewayCredential`: gateway, mode, field, `value_encrypted` (Fernet), `hint` (last 4
  characters, only for secrets longer than 8). Unique per (gateway, mode, field).
- `PaymentGatewayLog`: append-only history (model, queryset **and** a PostgreSQL trigger refuse
  update and delete). Stores field *names* and modes, never values.
- `PaymentTester`: the accounts allowed to use sandbox gateways.
- `Payment`: now also `gateway`, `mode`, `channel`. Older payments have no gateway and keep
  reconciling through the environment configuration.
- `Subscription.is_test`: marks test subscriptions.

## 7. Admin API (all under `/api/v1/admin/`, admin session + CSRF + admin role)

`payment-gateways/` (list, create), `payment-gateways/adapters/`, `payment-gateways/stats/`,
`payment-gateways/<id>/` (read, edit), `…/credentials/` (write-only, password), `…/mode/`
(password), `…/enable/`, `…/disable/`, `…/test/`, `…/logs/`, `payment-testers/`,
`test-subscriptions/<id>/revoke/`. Student API: `GET /payments/methods/?channel=&package_id=`,
`POST /payments/`, `GET /payments/<id>/`.

## 8. Adding a provider later

1. Write the adapter class (`initiate`, `handle_callback`, `verify`, `query`, optionally
   `test_connection`) from the provider's **official** document.
2. Register it in `PAYMENT_PROVIDERS` and `gateways/registry.py` with its credential fields.
3. Add tests with a fake provider; then run it against the provider's real sandbox before
   anything else (see `PAYMENT_GATEWAY_TESTING.md`).
No migration, no API change and no admin-panel change is needed: the form is drawn from the registry.
