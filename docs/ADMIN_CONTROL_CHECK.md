# Requirements specification: where each item stands

Checked against "LIVE MODEL TEST – Software Development Requirements Specification" (14 items) and its
"Admin Panel – Centralized Control Summary". Status is what is **built and tested in code**; nothing here has
been walked through by a person on a real browser and phone yet (see the release checklist), and the real
payment providers have never been run (see `PAYMENT_GATEWAY_READINESS.md`).

| # | Requirement | Status | Where / notes |
|---|---|---|---|
| 1 | Simulated examinee profiles (admin) | Built (as clearly labelled **sample participants**) | `SAMPLE_PARTICIPANTS.md` Many names can be added at once. |
| 2 | Simulated examinee count per exam | Built | Per exam, shown apart: "120 students + 30 sample participants". |
| 3 | Simulated leaderboard entries | Built, labelled, unranked, separate block | Real merit list and positions are never touched. A sample row can say in words where its marks would stand ("by marks, this would be position N"); it is never placed in the real list. |
| 4 | Live exam routine (website, app, PDF, admin) | Built | `EXAM_ROUTINE.md` |
| 5 | YouTube videos, per teacher/category, embedded | Built | `STUDY_MATERIALS.md`. Public/Unlisted videos only (a Private video cannot be shown to anyone but its owner). Teacher is a plain name. |
| 6 | Package/plan cards by category with price, exam count, validity, benefits | Built | `PACKAGE_DISPLAY.md` |
| 7 | Notices: text and PDF | Built | `NOTICE_PDF.md` (text notices existed) |
| 8 | Bulk question upload CSV/Excel | Built | `QUESTION_BULK_IMPORT.md`. Edit/delete of imported questions is the normal question screen. |
| 9 | App size 25–30 MB | **Not done** | Needs measuring and new builds run by the owner (preview APK ≈ 98 MB). |
| 10 | Upcoming-exam card and notifications | Built; push **not yet proven on a phone** | Card shows date/time, start–end, subject, marks, duration, status, syllabus and a link to the exam's study materials (website and app). Push messages and automatic exam reminders are built end to end and tested with a fake Expo, but **switched off** until the owner creates the Expo project and push credentials (`PUSH_NOTIFICATIONS.md`). Per-exam notices also work through announcements. A notice can be linked to one exam and is then shown on that exam's page (`NOTICE_PDF.md`). A newly published exam is announced by push once, automatically (`PUSH_NOTIFICATIONS.md`). |
| 11 | Student dashboard: Routine, Result, Archive, Syllabus | Built | App Home quick access: Routine, Study materials, Open now, Upcoming, My results, **Past exams** (archive), Packages. Result (marks, merit position, correct/wrong, analysis) and review of old questions exist in the Results tab; syllabus is on every exam page. The paper of an exam that is over (questions, answers, explanations) can be read in the app also by a student who did not take it (`QUESTION_ARCHIVE.md`). |
| 12 | UI/UX reference | Followed | Not seen by eye on real devices. |
| 13 | Admin control summary | See below | |
| 14 | Final instructions (no UI-only features; test everything) | Followed for the above | Every built item has backend, database, admin screen and tests; full suites pass. |

## Admin control summary

| Admin can manage | Status |
|---|---|
| Create exams and change times | Yes (Content → Exams) |
| Publish notices (text and PDF) | Yes (Site → Announcements) |
| Bulk question upload (CSV/Excel) | Yes (Content → Questions → Import) |
| Syllabus and routine | Yes (exam page → Syllabus; Content → Exam routine) |
| Results and leaderboard control | Yes: results list/detail, merit generation, publish/hide, leaderboard name mode (Settings) and sample entries per exam |
| Study materials and YouTube | Yes (Content → Study materials) |
| Exam packages and subscription plans | Yes (Commerce → Packages, Subscriptions, Payments, Gateways) |
| Send push notifications | Yes (Site → Push notifications; automatic reminders), off until the owner's Expo setup |
| Simulated examinee control | Yes, as labelled sample participants (People → Sample participants; exam page section) |

## Open decisions (owner)

1. **Sample participants** are built in the transparent form the spec itself asks for (always labelled "Sample",
   in their own block, no rank, counted apart, never in real results or statistics). They are not mixed into real
   ranks or presented as real students: that would mislead students and could breach consumer-protection and
   app-store rules. The label wording can be changed in the message files. See `SAMPLE_PARTICIPANTS.md`.
2. **Push notifications** need the Expo project id and push credentials (FCM), set up by the owner as described
   in `PUSH_NOTIFICATIONS.md`; secrets go only on the server, never in chat. Nothing has been sent to a real phone yet.
3. **App size** needs new EAS builds (see `APP_SIZE.md`: a `preview-small` profile is ready).
4. **Paid study materials** (everything is public today) and a separate teacher entity are not built.

## Google Play readiness

Privacy policy, terms and "delete your account" pages are on the website, the app can delete the student's own
account, and an admin can erase a student's personal data on request: see `PLAY_STORE_READINESS.md` (also what the
owner still has to do in the Play Console, and the payments-policy risk).
