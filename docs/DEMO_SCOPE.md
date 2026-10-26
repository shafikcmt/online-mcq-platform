# Client demo — scope and acceptance checklist

The staging demo (`docs/DEPLOYMENT.md` §9) shows the work completed so far on a private server
with **synthetic data only** (fictional students, mock payment history, no real money, no SMS).
The seeded mobile numbers look real but are made up; SMS is mock-only and the app containers have
no internet route, so nobody is ever contacted (`docs/DEPLOYMENT.md` §9.6).

## Ready to demo (Admin Panel, English and Bangla)

- Dashboard (students, attempts today, active subscriptions, revenue, exams and payments by status)
- Users (search, filters, masked contact details, detail with activity counts and links)
- Categories and Subjects
- Question bank (bilingual questions, options, difficulty, images)
- Exams — create/edit, schedule, retake/merit settings, **question picker**, publish
- Attempts (read-only, server-computed timing)
- Results — publish/hide, merit list generation
- Packages — create/edit, access rules, activate/deactivate
- Subscriptions — list and detail; **grant**, **extend** and **cancel** (retry-safe: a double click or a lost response never grants twice)
- Payments — list and detail, including the purchased validity ("Validity bought"); **Re-verify with provider** for payments that are not successful (guarded: never for a successful payment, one provider query per payment per minute)
- Bangla/English switch; responsive layout (desktop, tablet, phone)

## Not complete yet — do not present as finished

- Mobile App
- Public Website
- Admin CMS pages: announcements, FAQ, pages, site settings, contact messages, audit log
- A real payment gateway end to end (merchant credentials, public callbacks)
- Final production deployment and hardening (sizing, media storage, monitoring, backups off-site)

## Acceptance checklist (before the client sees it)

- [ ] HTTPS certificate valid; HTTP redirects to HTTPS; `X-Robots-Tag: noindex, nofollow` present
- [ ] Admin sign-in works (client account and operator account); no DEBUG pages (a wrong URL shows
      a plain JSON/HTML "not found"); `/api/schema/` and `/api/docs/` answer 404
- [ ] No secrets, real payment credentials or real personal data anywhere (all data from `seed_demo`)
- [ ] Every ready section above loads; no 5xx in `dc logs nginx backend`
- [ ] `dc ps`: all services healthy/running; Celery worker and beat log their periodic tasks
- [ ] `migrate --check` clean; `check_services` OK
- [ ] Payments offer only "Re-verify with provider" (not on successful payments; no status buttons); Subscriptions offer grant, extend and cancel only
- [ ] One payment shows "Validity bought: 30 days" while the package now says 45 days
- [ ] Bangla and English; phone width without sideways scrolling
- [ ] A backup exists (`deploy/staging/backup.sh`) and the reset script was dry-run on the server
