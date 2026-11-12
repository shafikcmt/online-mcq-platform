# Changing `SECRET_ENCRYPTION_KEY` (key rotation)

> **সারসংক্ষেপ (Bangla):** এনক্রিপশন কী বদলাতে হলে পুরোনো কী-টা
> `SECRET_ENCRYPTION_KEY_PREVIOUS`-এ রাখুন, নতুন কী `SECRET_ENCRYPTION_KEY`-এ বসান, তারপর
> `rotate_secrets --apply` চালান। পেমেন্ট ক্রেডেনশিয়াল বা SMS কী আবার টাইপ করতে হবে না।
> কী **হারিয়ে গেলে** এই টুল কিছু ফেরত আনতে পারে না।

## What is encrypted with this key

| Where | Column |
|---|---|
| Payment gateway credentials (Admin Panel > Commerce > Payment gateways) | `PaymentGatewayCredential.value_encrypted` |
| SMS gateway API key (Admin Panel > SMS gateway) | `SmsGatewaySettings.api_key_encrypted` |

The key lives only in the server environment (`/srv/mcq/.env.prod`), never in git or chat.

## When to change it

- The key may have leaked (someone saw `.env.prod`, a backup went astray).
- A person who knew it no longer works on the project.

If the key leaked, also change the provider credentials at the provider: the leak may have
exposed them.

## Steps (on the server)

1. Take a database backup.
2. Generate a new key:
   `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
3. In `/srv/mcq/.env.prod`:
   - `SECRET_ENCRYPTION_KEY_PREVIOUS=<the old key>`
   - `SECRET_ENCRYPTION_KEY=<the new key>`
4. Restart the backend, the worker and celery beat. From now on everything is still readable
   (old key) and new secrets are written with the new key.
5. Report only (changes nothing):
   `docker compose -f docker-compose.prod.yml exec backend python manage.py rotate_secrets`
6. Write the changes:
   `docker compose -f docker-compose.prod.yml exec backend python manage.py rotate_secrets --apply`
7. Run step 5 again. It must print `Nothing to do.`
8. Remove the `SECRET_ENCRYPTION_KEY_PREVIOUS` line, restart again, and save the new key in
   the password store. Check in the Admin Panel that a gateway's "Test connection" and the SMS
   test still work.

Adjust the compose file name and service name to the ones the server uses.

## How it behaves

- Without `--apply` it only counts. With `--apply` it re-encrypts in one transaction: all
  rows or none.
- If any secret cannot be read with the current or a previous key, it stops, changes nothing,
  and names the row (for example `payment gateway credential #12`). Add the right old key to
  `SECRET_ENCRYPTION_KEY_PREVIOUS`, or type that secret in again in the Admin Panel.
- It prints only counts and row numbers: never a secret, a key or a hint.
- Several old keys can be listed, separated by commas.
- Running it twice is safe.

## Limits

- A **lost** key cannot be recovered. Keep a copy in the password store.
- Tested automatically (`backend/tests/test_rotate_secrets.py`); it has not been run on the
  production server.
