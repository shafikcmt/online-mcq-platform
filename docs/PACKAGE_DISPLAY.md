# Package display by category

Packages are shown as plan cards that say **what they unlock**, grouped by category (for example Medical,
Engineering, University, Job preparation). The categories are the ones the admin already manages
(Content → Categories); nothing about Medical/Engineering/… is hard-coded.

## How it works

A package's access rules (Admin Panel → Packages → access rules) say what it grants: **all paid exams**,
**selected categories**, or **selected exams**. The server turns those rules into a coverage block on every
active package (`access` on `GET /api/v1/public/packages/` and `GET /api/v1/packages/`):

```json
"access": {
  "scope": "selected",            // "all" = every paid exam, "selected" = the categories listed
  "exam_count": 8,                // paid exams students can open right now
  "categories": [ { "slug": "medical", "name": "Medical", "exam_count": 5 } ]
}
```

- Only **published paid exams in an active category** are counted, so a card never promises a draft exam or a
  hidden category. Free exams are not counted (they need no package).
- A single-exam rule counts once and is merged into its category; an exam already inside a whole-category rule is
  not counted twice. Categories come in the admin's category order and only when they have a paid exam.
- The counts are live (they change when exams are published), computed in a fixed number of queries.

## What people see

- **Website `/bn/packages`, `/en/packages`:** one section per category (cards for packages that cover only that
  category), then "Several categories and all exams" for the rest; a row of jump links appears when there is
  more than one section. Each card shows price, validity, **"8 exams · Medical, Engineering"** (or "All paid
  exams (N open now)"), description and features.
- **App, Packages tab:** the same coverage line on each card, and category chips above the list. A chip keeps the
  packages that cover that category plus the all-exams packages.

## For the admin

Nothing new to learn: name your categories (Content → Categories), then give each package its access rules.
A package that covers exactly one category appears under it on the website; one covering several (or all) goes
to the "Several categories" section. To move a package, change its rules.

## Developer notes

- `apps/subscriptions/selectors.py`: `active_package_coverage()` (rules + exam counts → `PackageCoverage`);
  `PublicPackageSerializer.access` (the student list reuses it). Tests: `backend/tests/test_package_coverage.py`.
- Web: `web/src/lib/packages.ts` (`groupPackages`, `coverageLine`). App: `features/packages/categories.ts`,
  `category-chips.tsx`.
- Not built: per-package category images/ordering independent of package order, a separate "package category"
  entity (it reuses exam categories on purpose).
