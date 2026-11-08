# Payment gateway setup

Step-by-step: from "payments are off" to "a student can pay", safely. Written for the owner of
the platform. Credentials are typed **only** into the server's `.env.prod` or the Admin Panel
form, never into chat, git, e-mail or a screenshot.

> **সারসংক্ষেপ (Bangla):** ১) সার্ভারে `SECRET_ENCRYPTION_KEY` আছে কিনা দেখুন।
> ২) Admin Panel → Commerce → Payment gateways-এ gateway যোগ করুন (প্রথমে sandbox)।
> ৩) sandbox credential বসান (পাসওয়ার্ড লাগবে)। ৪) নিজের একটা অ্যাকাউন্টকে tester করুন।
> ৫) সেই অ্যাকাউন্টে ওয়েবসাইট থেকে sandbox পেমেন্ট করে দেখুন। ৬) সফল হলে live credential
> বসিয়ে Live করুন। ধাপ ৫ ছাড়া Live করা যায় না।

## 0. Before you start

| You need | Why |
|---|---|
| `SECRET_ENCRYPTION_KEY` on the server | Gateway credentials are stored encrypted with it. Already set for the SMS gateway; check below. |
| A provider account in the **client's name** | bKash merchant onboarding, or an SSLCommerz merchant account. |
| **Sandbox** credentials from the provider | To test without real money. |
| The provider's public callback addresses allowed (if it asks) | Our callback base is `PAYMENT_CALLBACK_BASE_URL` (`https://admin.livemodeltest.com`). |

Check the key exists (on the server, as the deploy user; this prints a count, not the key):

```
grep -c '^SECRET_ENCRYPTION_KEY=.' /srv/mcq/.env.prod      # 1 = set, 0 = missing
```

If it is missing, generate one **once** and keep a copy in the password store:

```
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Put it in `/srv/mcq/.env.prod` as `SECRET_ENCRYPTION_KEY=...` and restart the backend. Never
change it afterwards: stored credentials (and the SMS key) become unreadable, and every
gateway credential would have to be typed in again.

## 1. The server-level switch (read this before step 2)

> **Known gap G1 (see `PAYMENT_GATEWAY_READINESS.md`).** Today the server switch and the panel
> do **not** yet work cleanly together in production. Until G1 is fixed, follow this section
> exactly.

How `PAYMENT_PROVIDER` in `/srv/mcq/.env.prod` behaves today:

- `unavailable` (the default and the emergency switch): the server takes **no** payments,
  including the panel's gateways and sandbox tests. The panel itself still works (you can
  create gateways, store credentials and read history), but nothing is ever offered.
- `bkash` or `sslcommerz`: panel gateways can be offered, **but** production's startup check
  then also requires that provider's **environment** credentials (`BKASH_APP_KEY`,
  `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD`, or `SSLCOMMERZ_STORE_ID`,
  `SSLCOMMERZ_STORE_PASSWORD`) to be set to real, non-placeholder values, and refuses
  sandbox values unless `PAYMENT_ALLOW_SANDBOX_IN_PRODUCTION=true`. Without them the backend
  **will not start**. Those environment values are **not used** for an adapter that already
  has a gateway row in the panel (the panel wins); they are only there to pass the check.

Because of that, do it in this order so students are never exposed by accident:

1. Do steps 2–4 below **first**, with `PAYMENT_PROVIDER=unavailable`. A gateway row (even a
   disabled one) hides the environment fallback for its adapter, so adding the row before
   changing the switch means the environment values can never be offered by themselves.
2. When you are ready for step 5 (sandbox test) set `PAYMENT_PROVIDER` to the provider and
   provide its environment values (plus `PAYMENT_ALLOW_SANDBOX_IN_PRODUCTION=true` and the
   `*_SANDBOX=true` flag while you only hold sandbox values), then restart the backend. Real
   students still cannot pay: the gateway is disabled or in sandbox mode (testers only).
3. Switch back to `unavailable` at any time to stop everything.

Restart the backend after editing `.env.prod`.

## 2. Add a gateway

Admin Panel → **Commerce → Payment gateways → Add gateway**.

1. Choose the **provider** (bKash or SSLCommerz). Nagad and Rocket are listed as *Not
   implemented* and cannot be added.
2. **Identifier**: 2–40 lowercase letters, digits, hyphens, e.g. `bkash-main`. It cannot be
   changed later.
3. **Display name** (optional): what students see; fill both languages on the gateway page.
4. A second merchant account of the same provider is simply another gateway (`bkash-second`).

The new gateway is created **disabled**, in **sandbox** mode.

## 3. Fill in its settings

Open the gateway:

- **Names, description, logo** (logo must be an `https://` address) — shown to students.
- **Channels**: switch the **website** and the **app** on or off separately.
- **Limits**: optional minimum / maximum amount; currencies (default `BDT`); priority (lower
  shows first).
- **Return URLs** (optional, per channel): where the browser goes after paying. Empty = the
  server-wide `PAYMENT_WEB_RETURN_URL` (website) or `PAYMENT_RETURN_URL` (app). For the app to
  come back into the app use `livemodeltest://payment-result`.
- **Options**: provider-specific, e.g. request timeout.

## 4. Enter the sandbox credentials

**Credentials** panel → mode **Sandbox**:

| Provider | Fields |
|---|---|
| bKash | app key, app secret, username, password |
| SSLCommerz | store ID, store password |

Each field is **write-only**: after saving you see only "set" and the last four characters.
Leaving a field blank keeps the stored value. Saving asks for **your own admin password** again
(5 wrong attempts lock the action for 15 minutes).

Then press **Test connection** (bKash checks the token grant; SSLCommerz has no safe check and
says "not supported", which is never shown as a pass). **Enable** the gateway. It is offered
only when its credentials for the current mode are complete.

## 5. Add a tester and run a sandbox payment

1. **Payment gateways → Testers and test subscriptions → add** the phone number of a student
   account you control.
2. Sign in to the website (or the app) with that account → **Buy a package**. The sandbox
   gateway appears marked **Test payment**.
3. Pay with the provider's **sandbox** wallet/card (the provider documents the test numbers).
4. The payment must end **successful**; the tester gets a **test subscription** (shown under
   *Testers and test subscriptions*; you can revoke it).
5. Also try a cancelled payment and a failed one: each must end cancelled/failed, never paid.
6. For bKash, walk through the checklist in `PAYMENT_METHODS.md` §4 and fix anything bKash
   answers differently. This is the first time the adapter meets the real provider.

Real students never see a sandbox gateway and a sandbox payment never creates a real
subscription or counts in revenue.

## 6. Go live

1. **Credentials → mode Live**: enter the **live** credentials (a separate set from sandbox).
2. **Mode → Live** (password again). The server refuses unless every live credential is set
   **and** this gateway has at least one successful sandbox payment (step 5). The refusal
   lists what is missing.
3. Make one **small real payment** yourself, then check the provider's merchant dashboard
   shows it, and the payment in our admin payments list is `success`.
4. Only then leave the gateway **enabled** for students. Going back to sandbox is always
   allowed.

## 7. Everyday operations

- **Switch a gateway off for new payments**: Disable. Payments already started still settle.
- **Emergency stop of all payments**: set `PAYMENT_PROVIDER=unavailable` and restart the
  backend (nothing is offered, whatever the panel says).
- **Rotate a credential**: enter the new value (password required). Old and new are never mixed
  within one payment attempt; payments already started continue with the credentials of their
  mode.
- **Look at history**: the gateway's *History* tab lists every change and connection test
  (names and modes only, never values).
- **Statistics** (list page): real and sandbox payments are counted apart.
- **Environment fallback** (`BKASH_*`, `SSLCOMMERZ_*`): still works for an adapter that has no
  gateway row. Once you add a gateway for it, the panel is used instead.

## 8. If something is wrong

| Symptom | Likely cause |
|---|---|
| "Add gateway" works, but students see no method | Gateway disabled, wrong channel, credentials incomplete for the current mode, price outside limits, `PAYMENT_PROVIDER=unavailable`, or a sandbox gateway and the student is not a tester. The gateway page shows the exact reason. |
| "Credentials can't be saved" (503) | `SECRET_ENCRYPTION_KEY` is missing or invalid on the server. |
| Credentials "unreadable" | The encryption key was changed. Re-enter the credentials. |
| "Live not ready" | Missing live credential, or no successful sandbox payment on this gateway. |
| Payment stays pending | The provider has not confirmed. The system re-asks the provider every 10 minutes; an admin can re-verify one payment. A payment the provider never heard of closes as abandoned after 24 hours. |
| Student paid but sees nothing | Check the payment in admin payments: if `success` the subscription exists; if pending, wait for reconciliation or re-verify. Never mark paid by hand. |
