# Exam syllabus

What an exam covers, line by line: subject, chapter and topic. The admin writes it; students see
it on the exam page of the website and in the app.

## For the admin

Admin Panel → **Exams → open an exam → Syllabus** (below the question list).

- Each line has a **Subject**, a **Chapter** and a **Topic**; fill any of them (at least one).
  Text is free: write it in Bangla or English as you want students to read it.
- **Add line**, move a line **up/down**, or **remove** it. **Save syllabus** sends the whole list.
- Completely blank lines are left out when you save.
- Unlike the questions, the syllabus can be changed **at any time, even after the exam is
  published**: it never changes what is asked or how it is scored.
- Up to 200 lines, each part up to 150 characters.

## For students

- **Website:** the exam page has a **Syllabus** table (stacked lines on a phone).
- **App:** the exam screen has a **Syllabus** card above the instructions.
- No syllabus, no section.

## Developer notes

- Model `exams.ExamSyllabusItem` (migration `exams 0003`, additive): exam, `sort_order`, `subject`,
  `chapter`, `topic`. The database refuses an all-empty line and a repeated position.
- Admin API: `GET` / `PUT /api/v1/admin/exams/<id>/syllabus/`. `PUT` replaces the complete list in one
  transaction; an unchanged list writes nothing and no audit entry. Each change is audited as
  `exam.syllabus_update` (the text itself is never in the audit log).
- Public and student exam APIs carry `syllabus` (a list of `{subject, chapter, topic}`); it is
  prefetched by `exams.selectors.listable_exams`, so listing exams adds one query, not one per exam.
- An unpublished exam is not public, and neither is its syllabus.
- Tests: `backend/tests/test_exam_syllabus.py` (18), `admin/tests/exam-syllabus.test.tsx`,
  `web/tests/syllabus-table.test.tsx`, `mobile/tests/exams.test.tsx`.
- Not built yet: filling the syllabus from the exam's questions (they carry `chapter` and `topic` since
  the bulk import), and per-line language fields.
