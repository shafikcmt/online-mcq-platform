# Question archive: the paper of a past exam

> **সারসংক্ষেপ (Bangla):** পরীক্ষা শেষ হয়ে গেলে শিক্ষার্থী অ্যাপে সেই পরীক্ষার প্রশ্ন, সঠিক উত্তর ও ব্যাখ্যা
> দেখতে পারে, পরীক্ষাটি না দিয়ে থাকলেও। পরীক্ষা চলাকালীন বা শুরুর আগে কখনো উত্তর দেখানো হয় না।

## What students get

On the screen of an exam that is over, the app shows **"View questions and answers"**. It opens the question
paper: every question in the exam's order with its options and marks. Answers and explanations are hidden until
the student presses **"Show answers"**, so the paper can be used for practice first. A two-language exam can be
read in Bangla or English.

(A student who took the exam still has "Review answers" in Results, which also shows their own answers.)

## When the paper opens (decided by the server)

All of these must hold (`results.selectors.paper_allowed`):

1. The exam is published and **has an end time that has passed**. An exam with no end time can always be taken,
   so its answers are never shown this way.
2. **Answer review is allowed** for the exam (the exam form's switch).
3. **Results are visible** for the exam (immediately, after the end, or published by the admin: the exam's own
   result setting).
4. The student may see the exam: it is free, or their subscription covers it.

Otherwise the API answers `403 questions_not_available` and the button is not shown.

## Admin control

Nothing new to manage. To keep a paper closed, switch off "allow answer review" on the exam, or use the manual
result setting and do not publish the results. To open it, the exam must have an end time.

## API

- `GET /api/v1/exams/{slug}/` → `questions_available` (boolean).
- `GET /api/v1/exams/{slug}/questions/` (student sign-in) → `slug`, `title`, `total_questions`, `questions[]`
  with `number`, `text`, `image`, `options[] {id, text, is_correct}`, `correct_option_id`, `marks`, `explanation`
  (and the `_bn` / `_en` variants for a two-language exam).

The exam list and the exam details never contain questions or answers. Not on the website (it has no student
exam area). Tests: `backend/tests/test_student_exams.py::TestQuestionPaper`, `mobile/tests/exams.test.tsx`.
