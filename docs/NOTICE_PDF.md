# Notice PDF

A notice (announcement) can carry one optional PDF, for example a circular or a syllabus, in addition
to its text.

## What people see

- **Website** (`/bn/notices`, `/en/notices`, and the notice cards on the home page): an **Open PDF**
  button with the file size under notices that have a PDF. It opens in the visitor's own PDF viewer.
  Only notices for the public (audience "public" or "all") are reachable this way.
- **App** (Notifications → Notices): an **Open PDF** button. The app asks the server for a short-lived
  signed address (valid 10 minutes) and hands it to the phone's browser or PDF viewer, which cannot send the
  student's login token.

## For the admin

Admin Panel → **Announcements** → edit a notice → **PDF attachment**: Attach / Replace / Open / Remove.
It acts immediately (it does not wait for Save). A new notice must be saved once first. PDF only, up to
10 MB; a PDF with scripts or actions is refused (export it again as a plain PDF). Deleting the notice
deletes its file.

## Developer notes

- Model: `cms.Announcement.pdf` plus `pdf_name`, `pdf_size`, `pdf_sha256` (migration `cms 0003`). The stored
  name is random (`documents/<uuid>.pdf`); the original name is only a display label. The old file is deleted
  only after the change commits.
- Validation and serving are shared with the routine PDF (`apps/core/documents.py`: `validate_pdf`,
  `pdf_response`): size, `%PDF-` start, end marker, no active content; served by the API only, as
  `application/pdf` with `nosniff`, a locked-down CSP and an ETag.
- Endpoints:
  - Admin: `POST` (multipart `file`) / `DELETE /api/v1/admin/announcements/<id>/pdf/` (throttle
    `document_upload`, 30/hour per admin). Admin announcement objects include `pdf: {available, name, size_bytes}`.
  - Public: `GET /api/v1/public/announcements/<id>/pdf/` (visible public notices only);
    the public and student lists include `id` and `pdf`.
  - Student (JWT): `GET /api/v1/announcements/<id>/pdf-link/` → `{path, expires_in}`; then
    `GET /api/v1/public/notice-files/<token>/` serves the file. The token is a signed notice id (salt
    `cms.notice-pdf`, 600 s); the notice must still be visible to students when it is opened.
- Security: a draft, scheduled, expired or wrong-audience notice never reveals its file (it answers 404, the
  same as a missing notice); no file path is ever returned; tests in `backend/tests/test_notice_pdf.py`.

## Testing by hand

1. Admin Panel: edit a notice, attach a small PDF, see its name and size; try a `.txt` renamed to `.pdf`
   (refused) and open the PDF.
2. Website: the notice shows **Open PDF**; it opens the file. Remove it in the panel; the button disappears.
3. App: sign in, Notifications → Notices → **Open PDF** opens the viewer.

## Notices about one exam

An announcement can be linked to an exam ("About this exam" in the form). It then also appears on that exam's
own page on the website and in the app ("Notices for this exam"), and the notices list names the exam with a
link. Audience, publish time, expiry and the PDF work the same as for any notice. Only a published exam is ever
named to students; deleting the exam keeps the notice as a general one. API: `?exam=<slug>` on
`GET /public/announcements/` and `GET /announcements/`; `exam` (id) on the admin endpoints.
