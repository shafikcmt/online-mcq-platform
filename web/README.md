# Public Website (Next.js)

`livemodeltest.com` — information only: the website does not run exams and has no login
(Phase-1). Next.js 15 (App Router) + TypeScript + Tailwind CSS 4, the same design tokens and
logo as the Admin Panel and the Mobile App.

**Built so far (Milestone 9A):** bilingual routing (`/bn`, `/en`; Bangla by default, an
English browser gets English, a choice is remembered), header and footer with the language
switch and the Download / Open App button, the Home page with live data (open and upcoming
exams, packages, notices, FAQs) and SEO basics (titles, descriptions, canonical, `hreflang`,
Open Graph, `sitemap.xml`, `robots.txt`).

**9B:** `/exams` — Open now / Upcoming / Ended tabs, filters (category, type, free/paid) and
pages, all in the address (`?when=upcoming&type=live&page=2`; shareable, works without
JavaScript, unknown values are dropped in `src/lib/exam-filters.ts`; filtered views are
`noindex`); `/exams/{slug}` — an exam's rules, schedule and instructions with the way to the
app (no questions or answers: the public API has none); `/packages` — every package and how
buying works; a localized 404 inside the site.

**9C:** `/notices` — website notices (audience public or everyone), pinned first, full
text, pages; `/leaderboard` — the exams whose merit list is public; `/exams/{slug}/leaderboard`
— the top students with names shortened by the platform's privacy setting (masked by
default), marks, percent and time; never a phone number or an email. The other pages come next
(`docs/ROADMAP.md` Milestone 9).

## Run it

```bash
cd web
npm install
cp .env.example .env.local   # API_ORIGIN = the backend, SITE_URL = the site's address
npm run dev                  # http://localhost:3002
```

| Command | What it does |
|---|---|
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Vitest: messages in both languages, formatting, language routing, the app button |
| `npm run build` | Production build (works without a backend: sections fall back) |
| `npx playwright test` | End-to-end on the real backend — only through `admin/e2e/stack/run.sh` with `E2E_PROJECT_DIR=web` (`docs/DEPLOYMENT.md` §8); Playwright builds and starts the site itself |

## How it works

- **Data:** server components read the backend's **public** API only (`/api/v1/public/*`) on the
  server (`API_ORIGIN` is never sent to the browser), with `Accept-Language` for the page's
  language. Pages are regenerated at most every 60 s (`REVALIDATE` in `src/lib/api.ts`). A failed
  read shows that section's fallback; the site never breaks because the API is briefly down.
- **Languages:** `src/middleware.ts` puts every page under `/bn` or `/en`; texts come from
  `messages/{bn,en}.json` (a test checks both have the same keys and placeholders). Numbers and
  dates use Bangla digits on Bangla pages; times are Bangladesh time.
- **Download / Open App:** `src/components/app-button.tsx`. The links come from the Admin Panel →
  Site settings (`app_download_url` = the Play Store page, `app_open_url` = `livemodeltest://open`).
  On Android it tries to open the app and falls back to the store; without a store link it says
  "coming soon".
- **SEO:** `src/lib/site.ts` (`SITE_URL`, `hreflang` alternates), `src/app/sitemap.ts`,
  `src/app/robots.ts`.
