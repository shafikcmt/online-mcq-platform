# Production deployment — livemodeltest.com

How the live Public Website (`https://livemodeltest.com`) and Admin Panel
(`https://admin.livemodeltest.com`) are deployed and operated on the Hostinger VPS
(Ubuntu 24.04, 2 vCPU / 8 GB, IP `201.18.206.240`). The staging demo is a different setup
(`DEPLOYMENT.md` §9).

Nothing in this repository contains a production secret. Secrets are generated **on the
server** and stay there.

## 1. How it works

```
push / merge to main
  └─ GitHub-hosted runners: backend + admin + website CI (the same CI as every PR)
       └─ build 3 Docker images → GHCR  ghcr.io/shafikcmt/online-mcq-platform/<image>:<commit sha>
            └─ the VPS's own runner (user `deploy`, label `mcq-production`):
                 stage /srv/mcq/releases/<sha> → deploy.sh <sha>
                   check .env.prod + server (ports, files) → pull images
                   → check settings (manage.py check --deploy) + nginx/certificate (nginx -t)
                   → back up DB (verified) → migrate → collectstatic → start
                   → health checks (HTTPS through nginx, Celery ping) → record release
                   → unhealthy? start the previous release again (automatic)
```

- **Branches**: feature branches, `develop` and pull requests run CI only; **only `main`
  deploys** (`.github/workflows/deploy-production.yml`). Releasing = merging `develop` into
  `main`. The deploy and rollback jobs additionally refuse any other branch, any pull
  request event and any fork (`if:` guard, tested), and the `production` environment only
  accepts `main` (§3.6).
- **Images are built on GitHub**, never on the server, and tagged with the commit SHA —
  every release can be started again exactly.
- **One deployment at a time** (GitHub concurrency group + a lock file on the server).
- **Data is never deleted**: the volumes `mcq-prod_postgres_data`, `mcq-prod_media_files`,
  `mcq-prod_static_files` survive every deployment and rollback; the scripts never run
  `down -v`, `flush` or any destructive database command.
- **Secrets**: the only credential the workflows use is GitHub's short-lived per-job token
  (to push/pull images). No SSH key, password or app secret is stored in GitHub.

### Services (`docker-compose.prod.yml`, project `mcq-prod`)

| Service | Network | Public? | Memory |
|---|---|---|---|
| nginx | edge + internal | **only this one** — ports 80, 443 | 128 MB |
| backend (gunicorn) | internal + egress | no | 1 GB |
| celery, celery-beat | internal + egress | no | 768 / 256 MB |
| admin, website (Next.js) | internal | no | 768 MB each |
| postgres | internal only (no internet) | no | 1.5 GB |
| redis | internal only (no internet) | no | 256 MB |

`egress` gives the backend and Celery internet access for the payment gateway and SMS
provider. PostgreSQL and Redis are never on a network with internet access.

### Hosts (`deploy/nginx/prod-*.conf`)

| Address | Serves | Notes |
|---|---|---|
| `livemodeltest.com` | website + `/api/v1/public/` only | indexable (robots.txt / sitemap from the site) |
| `www.livemodeltest.com` | 301 → `https://livemodeltest.com` | |
| `admin.livemodeltest.com` | Admin Panel, `/api/`, secret Django-admin path, `/static/`, `/media/` | `noindex`; **Basic Auth** on panel pages + Django admin |
| anything else (bare IP, other names) | dropped | no page, no certificate |

Basic Auth does **not** cover `/api/` (mobile app, payment callbacks, the panel's own API
calls — each endpoint has its own authentication), `/media/` (question images in the
app), `/static/` or certificate renewals. nginx removes the Basic Auth header before
forwarding anything, so Django never receives that password.

### Payments and SMS on the first release

- `PAYMENT_PROVIDER=unavailable`: every purchase attempt is answered with *"Payments are
  temporarily unavailable. Please try again later."* (HTTP 503, code `payment_unavailable`)
  — no payment record, no provider call, never a success. Switch to SSLCommerz **live**
  later by editing `/srv/mcq/.env.prod` (§6.4).
- SMS: no real SMS gateway is integrated yet; the mock (sends nothing) is explicitly
  allowed, so OTP sign-up / password reset cannot complete until a gateway is added.

## 2. Server layout

```
/srv/mcq/                         owner deploy:deploy, mode 750
├── .env.prod                     settings + secrets (mode 600) — init-env.sh
├── nginx/admin.htpasswd          Basic Auth (hash only) — set-admin-password.sh
├── certbot-www/                  Let's Encrypt renewal challenges
├── releases/<sha>/               compose file + deploy/ of each release (last 5 kept, plus
│                                 always the live and the previous one)
├── current → releases/<sha>      the live release
├── previous                      SHA of the release before it
├── backups/                      pre-deploy-*.dump (last 10), daily-*.dump (last 14)
└── deploy-history.log            one line per deploy / rollback
/etc/letsencrypt/live/livemodeltest.com/   one certificate for all three names
/home/deploy/actions-runner-mcq/  this project's GitHub Actions runner (systemd service)
```

## 3. One-time setup (done by the owner, once)

Every command is run by you on the VPS (SSH as your normal sudo user) or in GitHub's web
interface. Nothing here is ever pasted into chat: not the runner token, not a password,
not the contents of `.env.prod`.

### 3.1 Check the server

```bash
sudo ss -ltnp 'sport = :80' ; sudo ss -ltnp 'sport = :443'   # must print nothing but the header
docker --version && docker compose version
free -h && df -h /
```
If ports 80/443 are already used (for example by the Garments OCR project's web server on
this VPS), stop here: two projects cannot both own ports 80/443; they then need one shared
reverse proxy (ask before changing anything).

### 3.2 Dedicated `deploy` user (never root)

```bash
sudo adduser --disabled-password --gecos "" deploy   # no password: nobody logs in as deploy
sudo usermod -aG docker deploy                       # can run Docker (= root-level access!)
```
Docker group membership is effectively root on this machine. That is why the runner may
only run this private repository's `main` workflows (§3.6).

### 3.3 Project folder (separate from every other project)

```bash
sudo mkdir -p /srv/mcq/releases /srv/mcq/backups /srv/mcq/nginx /srv/mcq/certbot-www
sudo chown -R deploy:deploy /srv/mcq
sudo chmod 750 /srv/mcq
```

### 3.4 Swap (safety margin; skip if `free -h` already shows swap)

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/90-swappiness.conf && sudo sysctl --system
```

### 3.5 DNS, then the certificate

1. Namecheap → Advanced DNS (§4). Wait until `nslookup admin.livemodeltest.com` shows
   `201.18.206.240`.
2. First certificate, in standalone mode (port 80 must be free, §3.1):
   ```bash
   sudo apt-get update && sudo apt-get install -y certbot
   sudo certbot certonly --standalone --cert-name livemodeltest.com \
     -d livemodeltest.com -d www.livemodeltest.com -d admin.livemodeltest.com
   ```
   (After the first deployment, §5 step 6 switches renewals to the running nginx.)

### 3.6 GitHub repository settings

1. **Keep the repository private.** Only you have write access (Settings → Collaborators).
   Anyone who can push a workflow to this repository could run commands on the VPS.
2. **Protect `main`** (Settings → Branches → Add rule → `main`): require a pull request
   before merging; require status checks (Backend CI, Admin Panel CI, Public Website CI);
   do not allow force pushes or deletion.
3. **Environment** (Settings → Environments → New environment → `production`):
   *Deployment branches and tags* → **Selected branches** → add `main`. Optional:
   *Required reviewers* → yourself (every deployment then waits for your click).
4. **Actions secrets: none are needed.** The workflows use only GitHub's temporary job
   token for GHCR. Do not add SSH keys, the root password or app secrets to GitHub.
5. Settings → Actions → General → *Fork pull request workflows*: leave disabled.

### 3.7 Install the runner (as `deploy`, its own folder)

1. GitHub: Settings → Actions → Runners → **New self-hosted runner** → Linux, x64. Keep the
   page open; it shows the download commands and a **one-time registration token** (valid
   about an hour — never share it).
2. On the VPS:
   ```bash
   sudo -iu deploy
   mkdir -p ~/actions-runner-mcq && cd ~/actions-runner-mcq
   # run GitHub's "Download" commands here (curl … tar xzf …), then:
   # replace TOKEN_FROM_GITHUB_PAGE with the token shown on the GitHub page (type it here only)
   ./config.sh --url https://github.com/shafikcmt/online-mcq-platform \
     --token TOKEN_FROM_GITHUB_PAGE \
     --name mcq-production-vps --labels mcq-production --work _work --unattended
   exit
   ```
3. Run it as a service **as the deploy user** (never root):
   ```bash
   cd /home/deploy/actions-runner-mcq
   sudo ./svc.sh install deploy
   sudo ./svc.sh start
   sudo ./svc.sh status        # "active (running)"
   ```
4. GitHub → Settings → Actions → Runners shows `mcq-production-vps` **Idle** with labels
   `self-hosted`, `Linux`, `X64`, `mcq-production`.

Isolation: this runner is registered only to this repository, lives in its own folder
(`/home/deploy/actions-runner-mcq`), has its own systemd service
(`actions.runner.shafikcmt-online-mcq-platform.mcq-production-vps.service`) and label; the
project uses its own folder (`/srv/mcq`), Compose project (`mcq-prod`), networks and
volumes. Another project's runner is unaffected.

## 4. DNS (Namecheap → Advanced DNS)

Remove the parking `CNAME www → parkingpage.namecheap.com.` and the `URL Redirect @`
records, then add:

| Type | Host | Value | TTL |
|---|---|---|---|
| A | `@` | `201.18.206.240` | 5 min |
| A | `www` | `201.18.206.240` | 5 min |
| A | `admin` | `201.18.206.240` | 5 min |

## 5. First deployment

1. Merge PR #50 (10H) into `develop`, then the production-deployment PR into `develop`,
   then open a pull request **`develop` → `main`** and merge it.
2. *Actions → Deploy production* runs: CI → images → deploy job on `mcq-production`. On the
   very first run the deploy job **stops at the preflight** with `NOT READY:` lines
   (`.env.prod` and `admin.htpasswd` do not exist yet). Nothing is started. Note the
   commit SHA shown in the run title.
3. On the VPS, as `deploy` (`sudo -iu deploy`), with `SHA=<the 40-character SHA>`:
   ```bash
   /srv/mcq/releases/$SHA/deploy/prod/init-env.sh                # random secrets, none printed
   /srv/mcq/releases/$SHA/deploy/prod/set-admin-password.sh admin # Basic Auth, hidden prompt
   ```
   `init-env.sh` fills `/srv/mcq/.env.prod` (mode 600) from `.env.prod.example`:
   hosts `livemodeltest.com` / `admin.livemodeltest.com`, `PAYMENT_PROVIDER=unavailable`,
   generated `DJANGO_SECRET_KEY`, `JWT_SIGNING_KEY`, `POSTGRES_PASSWORD` and a secret
   Django-admin path. Review it privately with `nano /srv/mcq/.env.prod` if you wish.
4. GitHub → the run → **Re-run failed jobs**. The deploy job now: checks settings and
   nginx/certificate → backs up the (empty) database → migrates → starts → health checks.
5. First Admin Panel account (hidden password prompt; use a **different** password from
   Basic Auth):
   ```bash
   cd /srv/mcq/current
   export IMAGE_TAG=$(basename "$(readlink -f /srv/mcq/current)")
   docker compose --project-name mcq-prod --env-file /srv/mcq/.env.prod -f docker-compose.prod.yml \
     run --rm backend python manage.py create_admin --mobile 01XXXXXXXXX --full-name "Your Name"
   ```
6. Certificate renewals through the running nginx (as your sudo user):
   ```bash
   sudo certbot reconfigure --cert-name livemodeltest.com --webroot -w /srv/mcq/certbot-www \
     --deploy-hook "docker exec mcq-prod-nginx-1 nginx -s reload"
   sudo certbot renew --dry-run
   ```
7. Daily database backup (as `deploy`: `crontab -e`, add one line):
   ```
   17 3 * * * /srv/mcq/current/deploy/prod/backup.sh >>/srv/mcq/backups/backup.log 2>&1
   ```

### 5.1 Verify

| Check | Expected |
|---|---|
| `https://livemodeltest.com` | website, padlock, Bangla home page |
| `https://www.livemodeltest.com` and `http://livemodeltest.com` | redirect to `https://livemodeltest.com` |
| `https://admin.livemodeltest.com` | browser asks for the Basic Auth login, then the panel sign-in |
| Panel sign-in with the `create_admin` account | dashboard opens |
| `https://admin.livemodeltest.com/api/v1/health/` | `{"status": "ok"}` without any password |
| `https://201.18.206.240` | no page (connection refused / closed) |
| `tail /srv/mcq/deploy-history.log` | `deploy <sha> ok` |
| `ls -l /srv/mcq/backups` | a `pre-deploy-…dump` file |

### 5.2 Verify automatic deployment and rollback (once)

1. Make a harmless change on a feature branch (e.g. a docs line) → PR into `develop` (CI
   only, nothing deploys) → PR `develop` → `main` → merge. *Deploy production* runs by
   itself and ends green; `deploy-history.log` shows the new SHA.
2. *Actions → Rollback production → Run workflow* (branch `main`, SHA empty). The previous
   release is live again (`readlink /srv/mcq/current`); the website and panel still work;
   data is unchanged.
3. Roll forward: *Actions → Deploy production → Run workflow* on `main`.

## 6. Operations

### 6.1 Deploy
Each run first stages its files with `deploy/prod/stage-release.sh`: copied into a hidden
folder and renamed into `releases/<sha>` in one step. An existing release folder is never
deleted or overwritten — re-running the same commit (e.g. *Re-run jobs*, or redeploying
the live SHA) reuses its identical folder; a folder whose files were edited on the server
is refused with a message, never silently replaced.
Merge to `main`. Watch *Actions → Deploy production*. The run is green only when the new
release answers through nginx: website `/bn` 200, `www` 301, `/api/v1/health/` 200, admin
pages 401 (Basic Auth), Celery worker and beat running and the worker answering a ping
through Redis. A wrong setting, certificate or nginx file stops the run **before** the
backup, the migrations or any container change ("the live site is untouched").

### 6.2 Rollback (code)
- **Automatic**: if the new release fails its health checks, `deploy.sh` starts the
  previous release again and the run fails (the failed release never becomes `current`).
- **Manual**: *Actions → Rollback production → Run workflow* (empty SHA = the previous
  release; or a full SHA from `ls /srv/mcq/releases`). Starts that release's images
  without migrations. On the server by hand:
  `/srv/mcq/releases/<sha>/deploy/prod/deploy.sh --rollback <sha>`.
- Rolling back code does **not** undo migrations. Migrations should stay backwards
  compatible (add columns/tables first, remove them in a later release).

### 6.3 Database restore (manual, deliberate)
Every deployment writes `backups/pre-deploy-<time>-<sha>.dump` before migrating. Restoring
replaces live data, so it is never automatic: stop the app services, restore with
`pg_restore --clean --if-exists` into the `postgres` container, start the matching release.
Practise it on a copy first. Copy backups off the server regularly (e.g. `scp` to your PC).

### 6.4 Settings changes
Edit `/srv/mcq/.env.prod` (keep mode 600), then re-run the latest *Deploy production*
workflow (or `deploy.sh <current sha>`). Never change `POSTGRES_PASSWORD` once the database
exists. Real payments later: `PAYMENT_PROVIDER=sslcommerz`, `SSLCOMMERZ_SANDBOX=false` and
the live store ID/password — only on the server.

### 6.5 Logs and status
```
cd /srv/mcq/current
export IMAGE_TAG=$(basename "$(readlink -f /srv/mcq/current)")
dc() { docker compose --project-name mcq-prod --env-file /srv/mcq/.env.prod -f docker-compose.prod.yml "$@"; }
dc ps                 # every service healthy?
dc logs --tail 100 backend
tail /srv/mcq/deploy-history.log
```
Container logs rotate automatically (10 MB × 5 per service).

### 6.6 HSTS
Starts at 1 day (`HSTS_SECONDS` = `DJANGO_SECURE_HSTS_SECONDS` = 86400). After a week
without HTTPS problems raise both to `31536000` and redeploy.
