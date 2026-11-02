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
default), marks, percent and time; never a phone number or an email.

**9D:** `/about` (the Admin Panel's "about" page, or the site's own text until one exists),
`/faq` (all active FAQs as native disclosure widgets + FAQPage structured data), `/contact`
(contact details from Site settings + the contact form). The form posts to
`/api/v1/public/contact/` **on the site's own origin**: nginx routes it to Django in
production (real client IP for the per-IP limit, no CORS); `next dev` and the E2E build
(`DEV_PUBLIC_API_PROXY=1`) proxy it instead (`next.config.ts`). It checks the fields before
sending, shows the backend's field errors, explains "too many messages" and network
failures without losing the text, and has a hidden honeypot field for bots.

**9E (quality):** `e2e/accessibility.spec.ts` runs axe-core (WCAG 2.1 A/AA) on every page in
both languages at phone and desktop width, plus the open phone menu and the contact form's
error state (0 violations). Lighthouse (mobile, on a local production build with sample
content): Accessibility / Best Practices / SEO 100, Performance 93–96, layout shift 0.
Fonts come from `src/lib/fonts.ts` (`next/font/local`: preloaded, size-matched fallback,
only the Latin and Bengali subsets); the logo goes through `next/image` (resized, WebP/AVIF).
See `docs/ROADMAP.md` Milestone 9 for the full history (milestone complete)
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

## Docker image and demo copies

`web/Dockerfile` builds the production image (lint, typecheck and unit tests run inside the
build; `next start` as a non-root user). Build arguments end up in the static pages:
`SITE_URL` (the site's address) and `SITE_NOINDEX=1` for any **demo or preview copy** — it
closes `robots.txt`, marks every page `noindex, nofollow` (meta tag and `X-Robots-Tag`) and drops
the sitemap link, so a copy never competes with livemodeltest.com in search results. Run time:
`API_ORIGIN`. The staging demo runs it next to the panel (`docker-compose.staging.yml`,
`docs/DEPLOYMENT.md` §9). A Vercel preview would set the same `SITE_NOINDEX=1`.

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
