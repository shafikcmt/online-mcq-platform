# Bulk question import (CSV / Excel)

Add hundreds or thousands of questions from a file. Admin Panel → **Questions → Import from file**.
You **check** the file first (nothing is saved), see every problem row by row, then **import** the
correct rows. Written for the admin; the developer notes are at the end.

## The file

A `.csv` (save as **CSV UTF-8** so Bangla stays readable) or `.xlsx`. The first row holds the
column names (any order, upper or lower case). Download the CSV or Excel template from the page.

| Column | Required | Meaning |
|---|---|---|
| `question` | yes | The question. Bangla or English is detected from the letters. Use `question_bn` / `question_en` for a question written in both languages. |
| `option_a`, `option_b` … up to `option_j` | at least 2 | The options. For a bilingual question use `option_a_bn` / `option_a_en`. Options must be filled in order (no empty option before a filled one). |
| `correct_answer` | yes | `A`–`J`, `1`–`10`, or `ক`–`ঞ` / `১`–`১০`. Exactly one. |
| `subject` | yes, unless a default subject is chosen | The name (Bangla or English) or slug of an **existing** subject. A subject is never created from a file. |
| `explanation` | no | Shown after the exam. `explanation_bn` / `explanation_en` for both languages. |
| `chapter`, `topic` | no | Where the question sits in the syllabus (free text, up to 150 characters). |
| `difficulty` | no | `easy`, `medium` or `hard`. |

Text that is only digits or symbols (`3`, `100%`) takes the language of the question. Columns the
system does not know are listed in the check (not silently ignored).

## What the check tells you

- How many rows are in the file, how many are ready, how many have problems.
- Every problem with its **row number** (header = row 1), the field and the reason, in Bangla or
  English. **Download error report (CSV)** gives the full list to fix and re-upload.
- The first correct rows, as they will be imported.

Problems it finds: empty question, missing or invalid correct answer, fewer than 2 options or a gap
between options, two identical options, a language missing from an option, unknown or ambiguous
subject, bad difficulty, text too long, the question **already in the bank** for that subject, or
repeated **inside the file**. Because of the last two, uploading the same file twice never doubles
the questions.

## Importing

- **If some rows are wrong:** *import the correct rows, skip the wrong ones* (default), or *import
  nothing unless every row is correct*.
- Each question is created exactly as if added by hand: same rules, same audit entry (who and
  when, never the question text). One summary entry (`question.import`) records the counts.
- Afterwards each question can be **edited or deleted** in Questions as usual.
- Limits per upload: 2000 questions and 5 MB (`QUESTION_IMPORT_MAX_ROWS`,
  `QUESTION_IMPORT_MAX_BYTES`); 30 checks or imports per hour per admin (`THROTTLE_QUESTION_IMPORT`).

## Developer notes

- Backend: `apps/questions/importer.py` (reading, row rules, duplicate checks, commit, templates),
  `apps/questions/api/import_views.py` (`POST /api/v1/admin/questions/import/` with `file`, `subject`,
  `mode=preview|import`, `on_error=skip|abort`; `GET …/import/template/?file_format=csv|xlsx`).
  The preview and the import run the same code over the same file (the file is uploaded again for the
  import; the server keeps nothing between the two steps).
- Database: `questions.Question` gained `chapter` and `topic` (migration `0002`, additive). They never
  affect scoring, so they stay editable on a question that is locked by a published exam.
- Dependencies: `openpyxl` (workbook read/write) and `defusedxml` (refuses XML entity attacks).
- Safety: `.csv`/`.xlsx` only, checked by content as well as the name; size and row limits; a zip-bomb
  guard (unpacked size and entry count); workbooks are read read-only and **formulas are never
  evaluated** (a formula cell reads as empty and the row is refused); the error report CSV prefixes cells
  starting with `= + - @` with an apostrophe; admin only, CSRF protected, throttled.
- Tests: `backend/tests/test_question_import.py` (36), `admin/tests/question-import.test.tsx` (13).
- Not covered: images in the file (add them per question), per-import undo (use the Questions list
  filters; each question has its own audit entry), very large files (split them).
