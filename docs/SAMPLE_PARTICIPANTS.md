# Sample participants (the "simulated examinee" requirement)

The specification asks for invented examinees an admin controls per exam, counted in the participant number
and shown next to real results, **"with a transparent distinction between simulated and real results in
backend and frontend"**. This is built exactly in that transparent form: invented people are never presented
as real, and they can never change anything real.

## Rules that are built in (not options)

- **Separate by construction.** Sample participants live in their own tables (`SamplePerson`, `SampleEntry`).
  They have no user account, phone number, attempt, result, merit position, payment or login. Every real query
  (results, merit generation, leaderboards, dashboards, revenue, student lists) ignores these tables.
- **Always labelled.** Everywhere they appear the label **"Sample" / "স্যাম্পল"** is next to the name, they are
  in their **own block** with a note that they are not real students, and the API marks every row
  `is_sample: true`.
- **No rank.** They never get a position, and the real merit list and every student's real merit position are
  unchanged (a test checks the public and app leaderboards and all results are identical before and after).
- **Counted apart.** The participant line reads "150: 120 students + 30 sample participants", never a single
  inflated number.
- **Visibility follows the real merit list.** The sample list is hidden (404) until the exam's real merit list
  is visible.

## For the admin

- **Library:** Admin Panel → People → **Sample participants**: add names (a display name only), deactivate or
  delete them. A participant that is in an exam cannot be deleted until it is removed from the exam (409).
  Inactive participants are not shown to students.
- **Per exam:** open an exam → **Sample participants** section: choose people from the library and give each
  **marks** (0 up to the exam's total marks). Saved as a complete list; allowed on a published exam (it changes
  no question, scoring or real result). At most 500 per exam. Every change is audited.
- The admin controls who they are and their marks. Their position follows from the marks in the sample list
  (best first); it is not a real rank.

## What students see

- **Website:** exam page participant line; the exam's merit-list page gets a "Sample participants" block under
  the real list.
- **App:** exam detail participant line; the leaderboard screen gets the same block under the real list.

## Developer notes

- Module `apps/simulation` (migration `simulation 0001`): `SamplePerson(name, is_active)`,
  `SampleEntry(exam, person, marks)` with a unique `(exam, person)`; `PROTECT` on the person so it cannot vanish
  from an exam; entries cascade with their exam.
- Admin API: `GET/POST /api/v1/admin/sample-participants/`, `GET/PATCH/DELETE …/<id>/`,
  `GET/PUT /api/v1/admin/exams/<id>/sample-participants/` (the COMPLETE list; marks validated against the
  exam's total marks, `ROUND_HALF_UP` to two decimals).
- Public API: `GET /api/v1/public/exams/<slug>/participation/` (`real_count`, `sample_count`, `total_count`;
  real = distinct students who started the exam) and `GET …/sample-participants/` (labelled rows, no ids or ranks).
- Tests: `backend/tests/test_simulation.py` (22), admin `sample-participants.test.tsx`, web `sample-block.test.tsx`,
  mobile tests in `results.test.tsx` and `exams.test.tsx`.

## Open decisions (owner)

- The wording of the label ("Sample participant") can be changed in the message files; removing the label or
  mixing these entries into real ranks is deliberately not supported, because showing invented people as real
  students would mislead students and could breach consumer-protection and app-store rules.
- Not built: per-entry control of a *position* independent of marks (position follows marks), bulk import of names,
  random generation of names/marks, photos.
