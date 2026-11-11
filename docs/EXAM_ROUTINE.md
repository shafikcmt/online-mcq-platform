# Exam routine

The schedule of exams students plan by, on the website and in the app, with an optional routine PDF.

## What students see

- **Website:** `/bn/routine` or `/en/routine` (linked from the footer, the menu and the Exams page):
  every scheduled exam that has not ended, **by day** (Bangladesh time), with its time range,
  title, category and subject, duration, questions, marks, free/paid and **Live now / Upcoming**.
  Each exam opens its own page (syllabus, rules). A **Download routine PDF** button appears when the
  admin has published one.
- **App:** the calendar icon in the Exams tab opens the same list, with the PDF button. No sign-in is
  needed to read the routine.
- Which exams appear: published exams **with a start time** whose end has not passed (an exam with no
  end time stays for a day after it starts). "Any time" exams (no start time) are not part of a routine.

## For the admin

Admin Panel → **Content → Exam routine**.

- **The schedule is not typed in again.** It is read live from the exams' start and end times, so it is
  always up to date. To change a time, edit the exam (Exams → open it → Schedule). The page shows the
  current schedule and links to the exams.
- **Routine PDF** (optional): upload the printable routine. **Upload / Replace / Open / Remove.**
  A plain PDF up to 10 MB; a PDF with scripts or actions is refused (export it again as a plain PDF).
  Replacing keeps the same address, so links students already have keep working.

## Developer notes

- Public API: `GET /api/v1/public/routine/` → `{pdf: {available, size_bytes, updated_at}, exams: [...]}`
  (no paging, up to 300 exams, the public exam fields without answers or syllabus);
  `GET /api/v1/public/routine/pdf/` serves the file.
- Admin API: `GET` / `POST` (multipart `file`) / `DELETE /api/v1/admin/routine/pdf/`.
- Model `exams.RoutinePdf` (migration `exams 0004`): a single row; the stored file name is random and
  never taken from the upload; its SHA-256 is the `ETag`.
- PDF safety (`apps/core/documents.py`, reused for notice PDFs): size limit `DOCUMENT_MAX_BYTES`
  (10 MB), must start with `%PDF-` and end with an end marker, no `/JavaScript`, `/JS`, `/Launch`,
  `/EmbeddedFile`, `/SubmitForm`, `/ImportData`, `/GoToR`, `/RichMedia`. Served by the API only
  (`application/pdf`, `nosniff`, `Content-Security-Policy: default-src 'none'`), never from a guessable
  media path; the old file is deleted only after the change commits.
- Limits: 30 uploads per hour per admin (`THROTTLE_DOCUMENT_UPLOAD`); admin only, CSRF protected, audited
  (`routine.pdf_set`, `routine.pdf_remove`, never the file's content).
- Tests: `backend/tests/test_exam_routine.py` (27), `admin/tests/routine-view.test.tsx`,
  `web/tests/routine.test.tsx`, `mobile/tests/routine.test.tsx`.
- Not covered: a PDF **generated** by the server from the schedule (Bangla text needs a font and text
  shaping that a plain PDF library does not do correctly), per-category routines, calendar (ICS) export.
- Whether a phone shows the PDF inside the app or hands it to another app depends on the phone; the
  button opens the address, and Android offers a PDF viewer.
