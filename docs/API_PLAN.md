# API Plan — Online MCQ Examination Platform (Phase-1)

> Status: **Planning document.** One centralized REST API (Django REST Framework) serves the
> Mobile App, Public Website and Admin Panel.

---

## 1. Conventions

| Topic | Convention |
|---|---|
| Base URL | `https://api.<domain>/api/v1/` |
| Format | JSON, UTF-8, `snake_case` fields |
| Auth | `Authorization: Bearer <access_token>` (mobile); httpOnly cookies + `X-CSRFToken` (admin web) |
| Areas | `/public/*` = no login · `/auth/*` = login/registration · `/*` = logged-in student · `/admin/*` = admin role only |
| Time | ISO-8601 UTC (`2026-10-05T09:30:00Z`); responses for exams/attempts include `server_time` |
| IDs in URLs | numeric IDs for catalog content; UUID `public_id` for attempts and payments |
| Pagination | `?page=1&page_size=20` (max 100) → `{ count, next, previous, results }` |
| Filtering/sorting | `?search=`, `?category=`, `?status=`, `?ordering=-created_at` |
| Idempotency | `Idempotency-Key` header on submit and payment-initiation endpoints |
| Versioning | URL prefix `v1`; breaking changes → `v2` (old app versions keep working) |
| Language | `Accept-Language: bn` or `en` (optional `?lang=`) — see §1.2 |
| Docs | OpenAPI schema at `/api/schema/`, Swagger UI at `/api/docs/` (disabled or admin-only in production) |

### 1.1 Standard error shape
```json
{
  "error": {
    "code": "exam_not_available",
    "message": "This exam is not open yet.",
    "details": { "start_at": "2026-10-06T04:00:00Z" },
    "field_errors": { "mobile_number": ["Enter a valid Bangladeshi mobile number."] }
  }
}
```
| HTTP | When |
|---|---|
| 400 | Validation error (`field_errors` filled) |
| 401 | Not logged in / token expired |
| 403 | Logged in but not allowed (e.g. paid exam without subscription, not admin) |
| 404 | Not found (also used instead of 403 when revealing existence would leak info) |
| 409 | Conflict (already submitted, attempt already open, OTP already used) |
| 410 | Gone (attempt deadline passed) |
| 422 | Business rule failed (exam not published, attempt limit reached) |
| 429 | Rate limited (`Retry-After` header) |
| 5xx | Server error (generic message, details only in server logs) |

`code` values are stable machine strings the clients map to friendly UI messages.
`message` is localized (Bangla or English) using the request language; `code` never changes.

### 1.2 Bilingual responses
- Language chosen from `?lang` → `Accept-Language` → user's `preferred_language` → site default.
- **Student & public endpoints** return one resolved value per content field in the request
  language, falling back to the other language when empty (e.g. `"title": "…"`).
- **Admin endpoints** return and accept both values (`"title_bn": "…", "title_en": "…"`).
- Numbers are always Western digits in JSON; the server also accepts Bangla digits (০-৯) in
  phone/OTP/number inputs and normalizes them.
- Exams with `content_language = "both"` return `text_bn`/`text_en` for each question and option in
  the attempt payload so the exam room can switch language without another request.
- Full rules: `LOCALIZATION.md`.

---

## 2. Authentication flow

```
Registration (mobile number + SMS OTP are mandatory; email is optional):
 1. POST /auth/otp/request      {mobile_number, purpose:"registration", language?} → 202 {detail} (generic, same for every number)
 2. POST /auth/otp/verify       {mobile_number, purpose, code}        → {verification_token, expires_at} (short-lived, single-use)
 3. POST /auth/register         {verification_token, mobile_number, full_name, password, email?, preferred_language?}
                                → 201 {user, access, refresh}   (409 account_exists if the number is already registered)

Login (student accounts only — Admin Panel auth is designed in Milestone 7):
    POST /auth/login            {mobile_number, password} → {user, access, refresh}   (401 invalid_credentials for every failure)
    POST /auth/token/refresh    {refresh} → {access, refresh}  (rotation; the old refresh token is blacklisted)
    POST /auth/logout           {refresh} (authenticated; must be the caller's own token) → 204

Forgot password (SMS OTP only):
    POST /auth/otp/request      {mobile_number, purpose:"password_reset"} → 202 {detail}
                                (identical status/body/errors whether or not an active student account exists;
                                 an SMS is only sent for real accounts). The request only runs the
                                 abuse checks and queues one task; the Celery worker checks the
                                 account and issues the code, so response time does not reveal it either
    POST /auth/otp/verify       → {verification_token, expires_at}  (errors collapsed to one generic otp_invalid)
    POST /auth/password/reset   {verification_token, mobile_number, new_password} → 204

Password change (authenticated): POST /auth/password/change {current_password, new_password} → 204
```
Token lifetimes (configurable): access 15 min, refresh 30 days. Every token carries the user's
`auth_version`; a password reset or change increments it, so **all** existing access and refresh
tokens (every device, including the current one) stop working immediately.

Protected fields: `role`, `is_staff`, `is_superuser`, `is_mobile_verified` and `auth_version`
(plus `mobile_number` and `password` on `PATCH /me`) are rejected with 400 `validation_error`
and a `field_errors` entry; nothing is saved. Other unknown fields are ignored.

---

## 3. Endpoint catalogue

### 3.1 Auth (`/auth/`)
| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/auth/otp/request` | anyone | Send OTP (throttled per phone + per IP) |
| POST | `/auth/otp/verify` | anyone | Verify OTP → verification token |
| POST | `/auth/register` | anyone | Create student account |
| POST | `/auth/login` | anyone | Login with mobile number + password (students & admins; the admin panel rejects non-admin roles) |
| POST | `/auth/token/refresh` | holder of refresh | New access token |
| POST | `/auth/logout` | logged-in | Revoke the caller's own refresh token |
| POST | `/auth/password/reset` | verified | Set new password via SMS OTP verification token |
| POST | `/auth/password/change` | logged-in | Change password (needs current password); logs out every device |

### 3.2 Public (`/public/`) — website & app, no login, cacheable
| Method | Path | Purpose |
|---|---|---|
| GET | `/public/settings` | Platform name, logo, app download link, contact info |
| GET | `/public/categories` | Categories with subjects *(3C: active categories, each with its active subjects; `slug`, localized `name`/`description`)* |
| GET | `/public/exams` | Published exams (filters: `type`, `access`, `category` = category slug, `upcoming=true`) — **no questions**. *(3C: only published exams in an active category/subject; ordered by start time, unscheduled last, then id)* |
| GET | `/public/exams/{slug}` | Exam info (duration, marks, schedule, free/paid). *(3C fields: `slug`, `title`, `description`, `instructions` — resolved to the request language — `exam_type`, `access_type`, `content_language`, `category`/`subject` `{slug, name}`, `duration_minutes`, `total_questions`, `total_marks`, `negative_marks`, `pass_marks`, `start_at`, `end_at`, `is_featured`. No ids, no questions/answers.)* |
| GET | `/public/packages` | Active packages & prices *(4A: `slug`, localized `name`/`description`/`features`, `price`, `currency`, `validity_days`, `is_featured`; ordered by `sort_order`, id. No ids, no access rules)* |
| GET | `/public/announcements` | Public notices |
| GET | `/public/faqs` | FAQ list |
| GET | `/public/pages/{slug}` | About / Terms / Privacy |
| GET | `/public/exams/{slug}/leaderboard` | Top N merit (only if results visible). Names rendered per `public_leaderboard_name_mode` (default **masked**, e.g. `Rah*** H.`); never phone/email *(4C: published exams only; N = `LEADERBOARD_PUBLIC_SIZE`, default 100; rows `{position, name, obtained_marks, total_marks, percentage, time_used_seconds}`; `404` when merit is off or results are not visible)* |
| POST | `/public/contact` | Basic contact form `{name, phone?, email?, subject, message}` — throttled + honeypot field; stored in `contact_messages` |
| GET | `/public/app-links` | Play Store URL + app open URL for the "Download / Open App" flow (from site settings) |

*(Milestone 6A — built: `/public/settings/` → `{platform_name, tagline, address, contact_email,
contact_phone, app_download_url, app_open_url, default_language}` (text in the request language with
fallback; leaderboard modes stay server-side). `/public/app-links/` → `{app_download_url,
app_open_url}`. `/public/announcements/` (paginated) → `{title, body, is_pinned, published_at,
expires_at}`, audience `public`/`all`, published and not expired, pinned first then newest.
`/public/faqs/` (paginated) → `{question, answer}`, active, by `sort_order`. `/public/pages/{slug}/` →
`{slug, title, body, updated_at}`; inactive or unknown → `404`. No ids or admin fields anywhere.
`POST /public/contact/` → always `202 {"status": "received"}` for valid input (a filled honeypot field
`website` stores nothing); `400` field errors for invalid input; `429` from the `contact_form` throttle.
Only `name`, `phone`, `email`, `subject`, `message`, `website` are read; `language` = request language.)*

The website has **no login** in Phase-1; all website endpoints are under `/public/*`.

### 3.3 Student — profile & dashboard
| Method | Path | Purpose |
|---|---|---|
| GET / PATCH | `/me` | View/update basic profile & settings (name, optional email, optional `display_name`, `preferred_language`); other fields are ignored |
| GET | `/me/dashboard` | One call for home screen: available/upcoming/practice exams (short lists), active subscription, recent results, unread notification count |
| GET | `/me/subscriptions` | Active and past subscriptions *(4A: own rows only; `package {slug, name}`, `status`, `effective_status` = `active`/`scheduled`/`expired`/`cancelled` computed from server time, `starts_at`, `expires_at`; no ids, no price)* |
| GET | `/me/notifications` | Paginated **in-app** notifications, rendered in the user's language |
| POST | `/me/notifications/{id}/read` · `/me/notifications/read-all` | Mark read |

*(Milestone 6B — built: `GET /me/notifications/` (newest first, paginated, `?is_read=true|false`) and
`GET /me/notifications/{id}/` → `{id, type, title, message, target, is_read, created_at, read_at}`;
`{id}` = the notification's UUID; `title`/`message` rendered in the request language (else the
student's preferred language) at read time; `target` = navigation ids only (`{type: "payment",
payment_id}` or `{type: "result", attempt_id}`, or `null`) — never a URL. `POST
/me/notifications/{id}/read/` → the notification (idempotent: the first `read_at` is kept; the client
cannot set it). `POST /me/notifications/read-all/` → `{updated: n}` (only the caller's unread rows).
Student JWT only; another student's notification → `404`. No create/edit/delete endpoint —
notifications come only from server events: **payment verified success** (incl. the late-success
recovery) and **result published** = the result became visible to its student: at scoring when
already visible (immediate mode, or an exam already published/ended), on admin publication (task
after commit), or when an `after_exam_end` exam ends (Celery beat every 2 minutes, bounded). One per
result, ever: hiding and re-publishing does not announce again. The beat job is also the catch-up:
any visible result without its notification whose visibility began after the notifications rollout
boundary is announced on the next run, however long workers were down; results visible before the
rollout are never announced. Responses carry public UUIDs only — never internal ids or `source_id`.)*
| GET | `/announcements` | Notices for students + public *(6A: audience `students`/`all`, same shape and rules as `/public/announcements/`)* |

### 3.4 Student — exams & attempts (exam engine)
| Method | Path | Purpose |
|---|---|---|
| GET | `/exams` | Exams visible to the student, with computed `can_start`, `locked_reason` (`needs_subscription`, `not_started`, `ended`, `attempt_limit`, `retake_not_allowed`), `attempts_used`, `attempts_allowed`, `remaining_time_if_joined_now` (live exams) |
| GET | `/exams/{id}` | Exam details & instructions |
| POST | `/exams/{id}/attempts` | **Start** (or resume the open) attempt → returns attempt + questions |
| GET | `/attempts/{public_id}` | Resume: questions, saved answers, `deadline_at`, `server_time` |
| PUT | `/attempts/{public_id}/answers/{question_id}` | Autosave one answer `{selected_option_id \| null, is_marked_for_review}` |
| PUT | `/attempts/{public_id}/answers` | Batch sync of pending answers after a temporary connection loss (each item carries `client_saved_at`; server keeps the newest per question) |
| POST | `/attempts/{public_id}/submit` | Final submit (idempotent) `{answers?: [...], source: "manual"\|"client_timeout"}` |
| GET | `/attempts` | My exam history |

*(4B implementation — student JWT; every query filtered by `request.user`; attempts addressed only by UUID.)*
- **Start/resume:** `POST /exams/{slug}/attempts` *(slug, not id: exams are public by slug since 3C)*,
  body `{client_info?}` → `201` new attempt or `200` the open one (same deadline, order and answers).
  Errors: `404` (not published / inactive category or subject / unknown), `403 needs_subscription`,
  `422 exam_not_started` (`details.start_at`), `422 exam_ended`, `422 retake_not_allowed`,
  `422 attempt_limit_reached` (`details.max_attempts`). An open attempt past deadline + grace is
  finalized (`server_auto`) before a new one starts.
- **Room payload** (start, resume): `attempt_id`, `attempt_no`, `status`, `server_time`, `started_at`,
  `deadline_at`, `remaining_seconds`, `can_edit`, `can_submit`, `submitted_at`, `submit_source`,
  `content_language`, `exam {slug, title, instructions, exam_type, content_language, duration_minutes,
  total_questions, negative_marks}`, `questions [{question_id, number, text, (text_bn, text_en for
  "both"), image, marks, options [{id, text, (text_bn, text_en)}], selected_option_id,
  is_marked_for_review}]` in this attempt's own order.
- **Autosave:** `PUT /attempts/{id}/answers/{question_id}` `{selected_option_id?, is_marked_for_review?,
  client_saved_at}` — omitted = keep, `null` = clear. **Batch:** `PUT /attempts/{id}/answers`
  `{answers: [{question_id, …}]}` in one transaction. Response `{server_time, deadline_at,
  remaining_seconds, answers: [{question_id, status: saved|stale, selected_option_id,
  is_marked_for_review}]}`. An item whose `client_saved_at` is **older** than the stored one is `stale`
  and changes nothing; an invalid item (question not in the attempt, option of another question,
  duplicate) rejects the whole request (`400`). Errors: `409 attempt_not_in_progress`,
  `410 attempt_deadline_passed` (from `deadline_at` on — also during the submit grace),
  `403 needs_subscription` (access re-checked on every save and submit).
- **Submit:** `POST /attempts/{id}/submit` `{source: manual|client_timeout, answers?}`, optional
  `Idempotency-Key` header (stored). A finished attempt is returned as is (`200`). Within
  `deadline_at + grace` it is submitted; `answers` in the body are applied only before `deadline_at`
  (else reported `deadline_passed`). After `deadline_at + grace` the server finalizes it
  (`auto_submitted`, `server_auto`) and returns that state. `result_available: false`, `result: null`
  until the results milestone.
- **Timing rule:** answers change only while `now < deadline_at`; submit is accepted until
  `deadline_at + ATTEMPT_SUBMIT_GRACE_SECONDS` (default 30 s) with its answers applied only before
  `deadline_at`; then the server finalizes (`server_auto`). `client_saved_at` never affects timing.
- **Exam status changes:** unpublish/archive or an inactive category/subject block **new** starts
  (`404`); a running attempt still resumes (`GET /attempts/{id}`), saves and submits until its deadline.
- **History:** `GET /attempts` — paginated summaries with `exam {slug, title}`.
- Not built yet: `GET /exams`, `GET /exams/{id}` with `can_start`/`locked_reason` (planned with the
  dashboard/results work).

**Start/resume response (example):**
```json
{
  "attempt_id": "6f1c…",
  "status": "in_progress",
  "server_time": "2026-10-05T09:30:00Z",
  "deadline_at": "2026-10-05T10:00:00Z",
  "exam": { "id": 12, "title": "…", "total_questions": 50, "negative_marks": "0.25" },
  "questions": [
    {
      "question_id": 991, "number": 1, "text": "…", "image": null, "marks": "1.00",
      "options": [ {"id": 4411, "text": "…"}, {"id": 4409, "text": "…"} ],
      "selected_option_id": null, "is_marked_for_review": false
    }
  ]
}
```
Never included before submission: `is_correct`, `explanation`, any correct-answer hint.

**Submit response:** `{ "attempt_id", "status": "submitted", "result_available": true|false, "result": {...} | null }`
*(4C: `result` is the result summary below whenever the exam's results are visible — `immediate`, or
already ended/published — otherwise `null`; the result is calculated either way.)*
(`result` is null when `result_visibility` is `after_exam_end` or `manual`.)

### 3.5 Student — results & merit
| Method | Path | Purpose |
|---|---|---|
| GET | `/results` | My results (only visible ones) |
| GET | `/results/{attempt_public_id}` | Result summary: counts, marks, %, pass/fail, time used, merit position |
| GET | `/results/{attempt_public_id}/review` | Per-question review with correct answers & explanations — **only if result visible AND exam.allow_answer_review** |
| GET | `/exams/{id}/leaderboard` | Exam merit list (paginated) + `my_position`; uses the exam's `merit_strategy` (live = single attempt); names per `app_leaderboard_name_mode` (student always sees own name) |

*(4C implementation — student JWT, own data only, results addressed by the attempt UUID:)*
- `GET /results` — my results whose exam results are visible now (newest first, paginated).
- `GET /results/{attempt_public_id}` — `attempt_id`, `attempt_no`, `status`, `exam {slug, title,
  exam_type}`, `submitted_at`, `total_questions`, `correct_count`, `wrong_count`, `unanswered_count`,
  `positive_marks`, `negative_marks_total`, `obtained_marks`, `total_marks`, `percentage`, `pass_marks`,
  `is_passed`, `time_used_seconds`, `is_merit_counted`, `merit_position`, `review_available`.
  Not finished / not mine → `404`; finished but not visible yet → `403 result_not_visible`.
- `GET /results/{attempt_public_id}/review` — `{result, questions: [{question_id, number, text, image,
  options [{id, text, is_correct}], selected_option_id, correct_option_id, is_correct, marks,
  awarded_marks, is_marked_for_review, explanation}]}` (plus `_bn`/`_en` pairs for "both" exams);
  `403 result_not_visible` / `403 review_not_allowed` otherwise.
- `GET /exams/{slug}/leaderboard` *(slug, like the start endpoint)* — the **generated** merit list:
  `{count, next, previous, my_position, results: [{position, name, obtained_marks, total_marks,
  percentage, time_used_seconds, is_me}]}`; exams the student can see (published, or taken by them);
  `404 merit_disabled`, `403 result_not_visible`.
- Name modes come from settings (`LEADERBOARD_APP_NAME_MODE`, `LEADERBOARD_PUBLIC_NAME_MODE`, default
  `masked`) until the site settings of Milestone 6 exist.
- Merit positions follow ROADMAP decision #18 (marks ↓, time ↑, submit ↑, attempt id ↑; sequential).
  Open-ended exams are re-ranked by Celery beat every 5 minutes, so their leaderboard can lag a new
  result by up to that interval.
- Exam create/update/publish: `result_visibility = after_exam_end` without `end_at` → `400
  validation_error` (`end_at`: `end_required_for_results`).

### 3.6 Student — packages & payments
| Method | Path | Purpose |
|---|---|---|
| GET | `/packages` | Packages (same as public + "already subscribed" flags) |
| POST | `/payments` | Initiate `{package_id}` (Idempotency-Key) → `{payment_id, checkout_url}` |
| GET | `/payments/{public_id}` | Poll status (`pending/success/failed/cancelled`) |
| GET | `/payments` | My payment history |

*(Milestone 5 — built: `POST /payments/` → `201` with the payment (`payment_id`, `merchant_reference`,
`status`, `provider`, `amount`, `currency`, `package {slug, name}`, `checkout_url` (only while
`pending`), `transaction_id` (only on `success`), `verified_at`, `created_at`, `updated_at`). Only
`package_id` is read from the body — amount and currency come from the server-side package. Same
`Idempotency-Key` again → `200` with the same payment; reused for another package → `409
idempotency_key_reused`. Errors: `400` unknown package, `409 package_inactive`,
`409 package_not_purchasable` (price 0), `403 not_student`, `503 payment_unavailable` (provider
session could not be opened — the payment is `failed`, `details.payment_id`), `429` (`payment_init`
throttle). `GET` endpoints show only the caller's own payments (another student's → `404`); no
provider payloads, events or internal ids. The `GET /packages` "already subscribed" flags are not
built yet.)*

### 3.7 Payment gateway interface & callbacks

All providers implement one backend interface (in `payments/gateways/`):
```
class PaymentGateway:
    code: str                                  # "sslcommerz" | "bkash" | "nagad" | "mock"
    def initiate(payment) -> InitiateResult     # returns checkout_url + provider session id
    def handle_callback(request) -> CallbackData# parse redirect/IPN, validate signature/hash
    def verify(payment) -> VerificationResult   # server-to-server status/amount check (source of truth)
    def query(payment) -> VerificationResult    # used by the reconciliation job
```
- Active provider chosen by configuration (`PAYMENT_PROVIDER`), so adding bKash/Nagad later = a new
  gateway class + settings; **no change** to the API, database or clients.
- **First implementation: SSLCommerz** (sandbox first, then live).

| Method | Path | Purpose |
|---|---|---|
| POST/GET | `/payments/callback/{provider}/success` | Browser redirect after payment → server **validates with provider API** → redirects the in-app browser to an app return page |
| POST/GET | `/payments/callback/{provider}/fail` · `/cancel` | Marks failed/cancelled only after checking our record; never grants access |
| POST | `/payments/ipn/{provider}` | Server-to-server notification (SSLCommerz IPN) — hash validated, then verified via the validation API |

SSLCommerz flow: create session (`initiate`) → `GatewayPageURL` → success/IPN with `val_id` →
call SSLCommerz Validation API → check `status=VALID/VALIDATED`, `amount`, `currency`, `tran_id`
(our `merchant_reference`) → success + subscription activation in one transaction.

These endpoints never trust the query/body alone; they look up the `merchant_reference`,
call the provider's verify/query API and compare amount + currency + status.

*(Milestone 5 — built, as `/payments/callback/{provider}/{success|fail|cancel}/` (GET or form POST)
and `/payments/ipn/{provider}/` (POST); no login, `payment_callback` throttle per IP; not in the
OpenAPI schema (provider-facing). Success/IPN → signature check (SSLCommerz `verify_sign`) →
Validation API with `val_id`; fail/cancel → transaction query by `tran_id` (a forged "cancel" cannot
end a paid payment). Unknown reference, bad signature, another payment's `val_id` → nothing
changes. Browser callbacks redirect to the server setting `PAYMENT_RETURN_URL` with
`?payment=<payment_id>&status=<status>` (`status=unknown` for an unknown reference; the target never
comes from the request); without it they answer that JSON. IPN always answers `200
{"status": "received"}`. Development: the mock provider's checkout page
`/payments/mock/checkout/{reference}/?result=success|fail|cancel` (404 in production).)*

### 3.8 Admin (`/admin/`) — role `admin` required
| Area | Endpoints |
|---|---|
| Dashboard (basic reports) | `GET /admin/dashboard` — basic operational statistics only: student count, exam count, attempts today, payments/revenue summary, recent activity. Advanced analytics & exports are Phase-2 |
| Users | `GET /admin/users` (search by name/phone/email, filter active/role), `GET /admin/users/{id}` (profile, subscriptions, attempts, payments), `POST /admin/users/{id}/activate`, `POST /admin/users/{id}/deactivate` |
| Categories | `GET/POST /admin/categories`, `GET/PATCH/DELETE /admin/categories/{id}` — filters `is_active`, `search` (Bangla/English name, slug), `ordering` (`sort_order`, `name_bn`, `name_en`, `created_at`, `updated_at`, `id`; `-` = descending). `DELETE` of a category that still has subjects → `409 in_use` |
| Subjects | `GET/POST /admin/subjects`, `GET/PATCH/DELETE /admin/subjects/{id}` — same filters plus `category` |
| Questions | `GET/POST /admin/questions` (filters: `category`, `subject`, `difficulty`, `is_active`, `language` = `bn`/`en`/`both`, `search` over Bangla/English text; `ordering` = `id`, `created_at`, `updated_at`, `difficulty`), `GET/PATCH/DELETE /admin/questions/{id}` — options are nested in the question payload and saved atomically. On `PATCH`, `options` (when sent) is the **complete** new option set and replaces the current one. `POST/DELETE /admin/questions/{id}/image` uploads (multipart field `image`) or removes the question image *(Milestone 3B; used instead of a generic upload endpoint so no unreferenced files are left behind)*. Bulk import is Phase-2 |
| Exams | Fields include `content_language`, `allow_retake`, `max_attempts`, `merit_enabled`, `merit_strategy` (live exams forced to 1 attempt / `first_attempt`). `GET/POST /admin/exams`, `GET/PATCH/DELETE /admin/exams/{id}`, `POST /admin/exams/{id}/publish`, `POST /admin/exams/{id}/unpublish`, `POST /admin/exams/{id}/duplicate` *(3C: also `POST /admin/exams/{id}/archive`; filters `exam_type`, `status`, `content_language`, `access_type`, `category`, `subject`, `is_featured`, `upcoming`, `search` (titles); `ordering` = `id`, `created_at`, `updated_at`, `start_at`. `status` is read-only — it changes only through the actions. Publish failures → `400 validation_error` with `field_errors`; wrong status → `409` (`exam_locked`, `already_published`, `not_published`, `not_archivable`, `invalid_status`, `exam_not_deletable`). Duplicate → new draft, same configuration and question list, schedule cleared, slug `<slug>-copy[-n]`)* |
| Exam questions | `GET /admin/exams/{id}/questions`, `PATCH /admin/exams/{id}/questions` with `{"questions": [{"question", "sort_order"?, "marks"?}]}` — the **complete** new list (add, remove, reorder and marks overrides in one atomic request). *(3C: replaces the separate add/reorder/marks/remove endpoints planned earlier.)* Editing a question used by a published exam → `409 question_locked` |
| Attempts & results | `GET /admin/exams/{id}/attempts`, `GET /admin/attempts/{public_id}`, `GET /admin/results?exam=`, `POST /admin/exams/{id}/results/publish`, `POST /admin/exams/{id}/results/hide`, `POST /admin/exams/{id}/merit/generate` (applies the exam's `merit_strategy`) *(4C: built — `GET /admin/results` (filters `exam`, `user`, `merit_counted`), publish/hide (set/clear `result_published_at`, audited, repeated calls are no-ops) and merit/generate (`{ranked_count}`, audited; `409 merit_disabled`). Not yet: the admin attempt list/detail. No endpoint edits or recalculates a score.)* |
| Packages | `GET/POST /admin/packages`, `GET/PATCH/DELETE /admin/packages/{id}`, nested access rules *(4A: filters `status`, `is_featured`, `search`; `ordering` = `id`, `sort_order`, `price`, `validity_days`, `created_at`, `updated_at`. `DELETE` of a package with subscriptions → `409 in_use`. Rules: `GET/PATCH /admin/packages/{id}/access-rules` with `{"rules": [{"rule_type": "all_paid_exams"\|"category"\|"exam", "category"?, "exam"?}]}` — the **complete** list, replaced atomically; exam rules need a paid exam)* |
| Subscriptions | `GET /admin/subscriptions` (filter active/expired, package, user), `POST /admin/subscriptions` (manual grant — audited) *(4A — manual grant approved for Phase-1, ROADMAP decisions log #16: support, testing and legitimate manual entitlements; admin session + CSRF + admin role; every grant/extension audited; no Payment row needed; never available to students or the public. `GET /admin/subscriptions` filters `status`, `active` (computed from server time), `package`, `user`; `GET /admin/subscriptions/{id}`; `POST /admin/subscriptions/grant` `{user, package, price_paid?, starts_at?}` → `201` new or `200` extension of the running subscription to the same package; `POST /admin/subscriptions/{id}/cancel` → `409 already_cancelled` / `subscription_expired` when not running. Status is read-only — no PATCH/PUT/DELETE.)* |
| Payments | `GET /admin/payments` (filter status/provider/date), `GET /admin/payments/{id}` (with events), `POST /admin/payments/{id}/reverify` (re-query provider) *(M5 — built with `{id}` = the payment's `payment_id` UUID. List filters `status`, `provider`, `user`, `package`, `created_from`/`created_to` (UTC dates), `search` (exact merchant reference or transaction ID); `ordering` = `id`, `created_at`, `updated_at`, `amount`, `verified_at`. Detail adds the sanitized `raw_verification` and `events`. Re-verify queries the provider and applies its answer exactly like a callback (audited `payment.reverify`; `409 provider_disabled`); for a `failed`/`cancelled` payment that the provider proves was paid this performs the late-success recovery. No PATCH/PUT/DELETE and no "mark success".)* |
| Contact messages | `GET /admin/contact-messages`, `PATCH /admin/contact-messages/{id}` (status) *(6A — built: also `GET /admin/contact-messages/{id}`; filters `status`, `language`, `search` (name, e-mail, phone, subject); `ordering` = `id`, `created_at`, `updated_at`, `status`. PATCH accepts only `{status: new\|read\|resolved}`, records `handled_by`, audited `contact_message.status`. No create/delete/reply. The sender IP is never returned.)* |
| Content | `GET/PATCH /admin/settings` (incl. default language, leaderboard name modes, app links), CRUD `/admin/announcements`, CRUD `/admin/faqs`, CRUD `/admin/pages` *(6A — built: `GET/PATCH /admin/settings/` returns environment defaults until first saved; announcements filters `audience`, `published`, `is_pinned`, `search`, with a computed `state` = `draft`/`scheduled`/`live`/`expired`; FAQ and pages filter `is_active`, `search`. Every create/update/delete is audited (`site_settings.update`, `announcement.*`, `faq.*`, `page.*`); unchanged updates write nothing.)* |
| Uploads | `POST /admin/uploads/image` (type/size validated) |
| Audit | `GET /admin/audit-logs` (read-only; filters `action`, `entity_type`, `entity_id`, `actor`) |

Admin `DELETE` behaviour: soft delete or `409 in_use` when the object is referenced by attempts/results/payments.

**Admin API authentication — temporary Milestone 3 backend-only behaviour (not the final design):** `/admin/*` views accept only a
Django **session cookie** with a mandatory **CSRF token** (`X-CSRFToken`) on unsafe methods, plus the
`admin` role (checked on every request; inactive users rejected). Student JWTs are never accepted there,
and admin sessions are not accepted on student endpoints. No session → `401`; logged in but not an
admin → `403`. `is_staff`/`is_superuser` alone do not grant access. For now the workflow is
*internal Django admin login → Django session → admin API*; the real Admin Panel login (its own endpoint,
httpOnly cookies + CSRF) is designed and built in **Milestone 7** and replaces this workflow.
Every admin write is recorded in `audit_logs` in the same transaction.

---

## 4. Permissions matrix (summary)

| Resource | Anonymous | Student | Admin |
|---|---|---|---|
| Public info | read | read | read |
| Own profile / attempts / results / payments | – | read/write own only | read all |
| Other students' data | – | ❌ (leaderboard shows limited public fields only) | read |
| Questions with correct answers | ❌ | only after submission + visible result + review allowed | read/write |
| Exams/questions/packages management | – | – | full |
| Payment status changes | – | – | re-verify only (no manual "mark success" without audit) |

Object-level rule: every student query is filtered by `user=request.user` in the queryset —
never only by the ID in the URL (prevents IDOR).

---

## 5. Rate limiting (DRF throttles backed by Redis — values configurable)

| Scope | Example limit |
|---|---|
| `otp_request` | 1 per 60 s per phone; 5 per hour per phone; 20 per hour per IP |
| `contact_form` | 5 per hour per IP |
| `otp_verify` | 5 wrong tries per OTP, then OTP invalid |
| `login` | 10 per 15 min per IP + phone |
| `answer_save` | 120 per minute per user |
| `submit` | 10 per minute per user |
| `payment_init` | 10 per hour per user |
| `payment_callback` | 120 per minute per IP *(M5: provider callbacks/IPN)* |
| anonymous public API | 120 per minute per IP |
| authenticated general | 600 per minute per user |

---

## 6. Caching (light, Phase-1)

- Public endpoints (settings, categories, packages, FAQs) cached in Redis for a few minutes and
  invalidated on admin update; website uses Next.js revalidation (ISR).
- **Never cache** attempt, answer, result-review or payment endpoints.

---

## 7. Client-specific notes

- **Mobile (no full offline exam mode in Phase-1):** the exam must be **started online**. During the
  attempt the app keeps a *local temporary answer state* and autosaves each change to the server.
  If the connection drops briefly, unsent answers wait in a small pending queue and are retried with
  backoff, then synced via the batch endpoint. The server remains the source of truth: only answers it
  received before `deadline_at` count (grace only covers the submit request). If the device timer hits zero, call submit with
  `source=client_timeout`; the server finalizes anyway via Celery if the request never arrives.
- **Website:** server-side fetch from `/public/*` only; no login and no tokens in the browser.
  "Download App" opens the Play Store; "Open App" tries the app's URL scheme and falls back to the Play
  Store (full verified deep links/App Links are Phase-2).
- **Admin:** all mutating requests send CSRF token; list pages use server pagination & filters.

---

## 8. Testing plan for the API

- Unit tests for services: scoring, negative marking, timer/deadline, access rules, payment state machine.
- API tests (DRF `APIClient`): auth flows, permission matrix (student vs admin vs anonymous),
  IDOR attempts, double-submit, late-submit, correct answers not leaked, throttling.
- Payment tests with the `mock` provider + recorded sandbox responses.
