# Study materials (YouTube videos and PDF handouts)

Free preparation material students can open on the website and in the app, grouped by **category,
subject, exam and teacher**. The admin manages everything from the panel; nothing is hard-coded.

## What people see

- **Website:** `/bn/materials`, `/en/materials` (footer and menu). Filter by type (Videos / PDFs) and category.
  A video shows a cover with a play button; **nothing is loaded from YouTube until the visitor presses
  play**, then the privacy-friendly `youtube-nocookie.com` player appears in place. A "Watch on YouTube" link
  always works. A PDF has an **Open PDF** button. Cards show the teacher, the category and subject, and a link to
  the related exam when that exam is published.
- **App:** Exams tab → the play-circle icon. Videos open in the YouTube app or the browser (no embedded player:
  it keeps the app small); PDFs open in the phone's viewer. No sign-in is needed.

## For the admin

Admin Panel → **Content → Study materials**.

- **New material:** choose the type.
  - **Video:** paste a YouTube link (`youtube.com/watch…`, `youtu.be/…`, `/embed/`, `/shorts/`, `/live/` are all
    accepted). Only the video ID is kept. The video must be **Public or Unlisted** on YouTube: a *Private*
    video cannot be played by anyone but its owner, so it cannot be shown to students.
  - **PDF:** save the material, then **Attach PDF** (up to 10 MB; a PDF with scripts or actions is refused).
- Optional: category, subject (must belong to the category), a related exam, teacher name, order (small first).
- **Publishing:** now, at a set time (Bangladesh time) or draft. A PDF material with no file yet is listed
  without an Open button, so attach the file before publishing.
- Filter the list by type, category, publication state; search by title or teacher.

## Developer notes

- New module `apps/materials` (modular monolith). Model `StudyMaterial` (migration `materials 0001`): `kind`
  (`video`|`pdf`), bilingual title/description (title needed in at least one language), `youtube_id`, `pdf` +
  `pdf_name`/`pdf_size`/`pdf_sha256`, FKs `category`, `subject`, `exam` (all `SET_NULL`), `teacher`, `sort_order`,
  `published_at` (null = draft). DB check constraints: a video has an ID, a PDF material never has one.
- **YouTube safety:** `parse_youtube_id` accepts only `http(s)` links on YouTube's own hosts
  (`youtube.com`, `www.`, `m.`, `youtube-nocookie.com`, `youtu.be`) and returns the 11-character ID; anything else
  (other hosts, lookalikes such as `youtube.com.evil.example`, credentials in the URL, scripts) is refused.
  Clients build every address from the ID alone, so a stored value can never inject a host or a script.
- **PDF safety:** the same checks and serving as the routine and notice PDFs (`apps/core/documents.py`):
  random stored name, API-only serving with `application/pdf`, `nosniff`, a locked-down CSP and an ETag; the old
  file is deleted only after the change commits; deleting a material (or turning it into a video) deletes its file.
- Endpoints:
  - Admin: `GET`/`POST /api/v1/admin/materials/` (filters `kind`, `category`, `subject`, `exam`, `published`,
    `search`, `ordering`), `GET`/`PATCH`/`DELETE …/materials/<id>/`, `POST`/`DELETE …/materials/<id>/pdf/`
    (throttle `document_upload`). Every write is audited (`material.create|update|delete|pdf_set|pdf_remove`).
  - Public: `GET /api/v1/public/materials/` (filters `kind`, `category`, `subject`, `exam` by slug, `teacher`,
    `search`; published only, in an active category), `GET …/materials/<id>/pdf/`.
- The public list never returns a stored file name or path, an unpublished exam, or admin fields.
- Not built (needs a decision): paid/subscriber-only materials (everything is public today), per-student
  progress, comments, a teacher entity (teacher is a plain name for now), playlists, YouTube API usage (no API
  key is needed or used).

## Testing by hand

1. Panel: add a video with a normal YouTube link and publish it now; try a bad link (refused under the field).
2. Add a PDF material, save, attach a small PDF; try a renamed `.txt` (refused).
3. Website `/en/materials`: the video shows a cover; press play and it plays; the PDF opens.
4. App: Exams tab → play icon: the video opens in YouTube, the PDF opens in the viewer.
5. Unpublish (draft) in the panel: it disappears from both.
