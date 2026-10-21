# Admin Panel — Live Model Test

Next.js 15 (App Router) + TypeScript + Tailwind CSS v4. Uses only the backend's existing
`/api/v1/admin/*` endpoints. English is the default UI language; Bangla is complete (switch in
the top bar). Milestone 7 — this first step is the foundation: sign-in, shell, design tokens,
shared components and the dashboard. Other sections are listed in the sidebar and are built in
the next steps.

## Run locally

```bash
cp .env.example .env.local          # API_ORIGIN=http://127.0.0.1:8000
npm ci
npm run dev -- -p 3001              # http://localhost:3001 (with the dev /api proxy)
```

The backend needs `CSRF_TRUSTED_ORIGINS=http://localhost:3001` (see the root `.env.example`).

## How it talks to the backend

- The browser only calls the panel's own origin (`/api/*`).
  - **Production:** nginx routes `/api/*` straight to Django and everything else to `next start`
    (`docs/DEPLOYMENT.md`, `deploy/nginx/admin-panel.conf.example`). The production build has
    **no** `/api` proxy.
  - **Development:** `npm run dev` proxies `/api/*` to `API_ORIGIN`, keeping Django's trailing
    slashes. Development only — it adds no `X-Forwarded-For`.
- `API_ORIGIN` is also used at runtime by server-side reads (production:
  `https://<panel host>` so they go through nginx too).
- Sign-in: `POST /api/v1/admin/auth/login/` creates a Django session (**httpOnly** cookie).
  Unsafe requests send the `csrftoken` cookie value in `X-CSRFToken`. Nothing is stored in
  `localStorage` except the sidebar collapsed preference.
- Server components read with the visitor's own cookies (`src/lib/api/server.ts`); the backend
  checks the session and admin role on every request. `src/middleware.ts` only redirects visitors
  with no session cookie at all.
- Errors use the backend's standard shape (`src/lib/api/errors.ts`): 401 → sign-in,
  403 → permission message, network failure → retry state.

## Scripts

| Command | What |
|---|---|
| `npm run lint` · `npm run typecheck` | ESLint · TypeScript |
| `npm test` | Unit/component tests (Vitest + Testing Library) |
| `npm run build` | Production build |
| `e2e/stack/run.sh <suites…>` | Playwright against the full stack on a **disposable** database, re-created for every suite and dropped afterwards — local/manual, not in CI (`docs/DEPLOYMENT.md` §8: required variables and safety guards; screenshots → `SCREENSHOT_DIR`) |

CI (`.github/workflows/admin-ci.yml`) runs `npm ci`, lint, typecheck, Vitest and the production
build on every change under `admin/`.

## Known limitations

- **Unsaved exam edits and the browser's Back/Forward buttons.** The exam editor warns before
  leaving with unsaved changes: the browser's own prompt on reload, closing the tab or typing
  another address (`beforeunload`), and the panel's "Discard unsaved changes?" dialog for every
  link inside the panel — the Back link, Cancel, the sidebar and the top bar — and for **Sign
  out** (a button: it asks through the shell's leave guard, offering "Keep editing" or "Discard
  and sign out"; `src/lib/use-unsaved-guard.ts`). The browser's Back/Forward buttons are **not** intercepted:
  the Next.js 15 App Router has no navigation-blocking API, and the workarounds (patching
  `popstate`, inserting fake history entries, forcing reloads) rewrite browser history, which
  this panel deliberately avoids. Pressing Back with unsaved changes therefore leaves the editor
  without asking.

## Structure

```
src/app/(auth)/login        sign-in
src/app/(panel)/            protected area (layout checks /admin/auth/me/)
src/components/brand        Live Model Test logo (SVG)
src/components/shell        app shell, sidebar, top bar, navigation map
src/components/ui           button, card, status badge, page header, states, skeleton
src/components/dashboard    dashboard view + skeleton
src/lib/api                 browser client (CSRF), server reads, error parsing
src/lib/i18n                English/Bangla strings
```

Brand: `public/brand/logo-mark.svg` is a **temporary reconstructed placeholder**, not the official
logo — replace that one file with the official mark (keep the name), and the favicon
`src/app/icon.svg` likewise.

Design tokens live in `src/app/globals.css` (`@theme`), following `docs/UI_UX_GUIDELINES.md` §2
with the brand colours from the logo.
