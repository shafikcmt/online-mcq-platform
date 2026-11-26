# Exam groups (shelves inside a category)

> **সারসংক্ষেপ (Bangla):** ক্যাটাগরির ভেতরে এখন **গ্রুপ** বানানো যায় (যেমন "ফ্রি সাপ্তাহিক মডেল টেস্ট", "ডেইলি কুইজ",
> "৫২তম বিসিএস প্রস্তুতি"), আর গ্রুপের ভেতরে **উপগ্রুপ**। শিক্ষার্থী অ্যাপ ও ওয়েবসাইটে ক্যাটাগরি → গ্রুপ → উপগ্রুপ → পরীক্ষা
> এই ক্রমে ঢোকে। Admin Panel → **পরীক্ষার গ্রুপ** থেকে গ্রুপ বানান, আর প্রতিটি পরীক্ষার ফর্মে "গ্রুপ" বেছে দিন।
> গ্রুপ না দিলে পরীক্ষা আগের মতো সরাসরি ক্যাটাগরির নিচে দেখায়।

## Shape

```
Category ──┬─ Group ──┬─ Sub-group ── exams
           │          └─ exams
           ├─ Group ── exams
           └─ exams that sit in no group
```

- A **group** belongs to one category. A **sub-group** has a parent group of the same category. Two levels at most.
- An exam has an optional `group` (any group or sub-group of its own category). The server refuses a group of another
  category.
- A group's slug is unique across all groups (one address per group).

## What students see

- **A category** lists its groups first (name, exam count, sub-group count, a red dot and "Live" if a scheduled exam in it
  is running now), then the exams that sit in no group. A category with no groups looks exactly as before.
- **A group** lists its sub-groups, then its own exams (running first, then upcoming, then past ones marked "Archived"),
  then the shortcuts (Archive, Results, Routine, Study).
- **Empty shelves are never shown:** a group (or sub-group) appears only when a published exam is in it or below it.
- Switching a group off hides it; its exams do not vanish, they list directly under the category.

## Admin

- Admin Panel → **Exam groups**: create, rename, order (sort order), switch on/off, delete. A group that still has exams or
  sub-groups cannot be deleted (409); move or deactivate instead.
- Exam form → **Group** (only the chosen category's groups are offered; a sub-group is shown as "Parent › Child").
- Changing the category of an exam clears its group.
- Every change is audited (`group.create`, `group.update`, `group.delete`; the exam's group id is in the exam's audit).

## API

| Endpoint | Who | What |
|---|---|---|
| `GET/POST /api/v1/admin/groups/`, `GET/PATCH/DELETE …/{id}/` | admin | CRUD; filters `category`, `parent`, `top_level=true`, `is_active`, `search` |
| `GET /api/v1/public/groups/?category=<slug>[&parent=<slug>]` | anyone | the category's top-level groups, or a group's sub-groups, with `exam_count`, `live_count`, `child_count` |
| `GET /api/v1/public/groups/<slug>/` | anyone | one group, its category, its parent and its sub-groups |
| `GET /api/v1/public/exams/` and `GET /api/v1/exams/` | anyone / student | new filters `group=<slug>` (exams directly in it) and `ungrouped=true` (no group, or a switched-off group) |

Only published exams count; no answers or marks data are exposed. The exam payloads carry `group: {slug, name} | null`.

## Database

`catalog_examgroup` (category, parent, bilingual name and description, slug, sort order, active) and `exams_exam.group_id`
(nullable, PROTECT). Migrations `catalog/0002_exam_groups`, `exams/0006_exam_groups`. Existing exams keep `group = NULL`.

## Not part of this change

"Favorite" and "Wrong & Unanswered" (seen in the reference video) are separate features and are not built yet.
