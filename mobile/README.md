# Mobile App (Expo, Android)

The students' app — the only place where exams are taken. React Native + Expo (SDK 58) +
TypeScript, Expo Router for navigation. Bangla and English; Bangla is the default.

**Built so far:** app shell, theme, bundled fonts, language choice, sign-in, registration
with an SMS code, forgot password, Profile (details, edit, language, change password, sign
out) — Milestone 8A — and the Home dashboard (8B): exams open now / upcoming / practice with
what the student can do, active packages, recent results and the unread count, all times
counted from the server's clock — and the Exams tab with exam details (8C): open now /
upcoming / past, and for each exam what the student can do and why not — and the exam
room (8D), results, answer review, leaderboard and history (8E), and packages and payment
(8F), and in-app notifications and notices (8G) — every Milestone 8 screen. Device testing
and the Play Store build are part of Milestone 10 (`docs/ROADMAP.md`).

## Run it

```bash
cd mobile
npm install
cp .env.example .env.local      # set EXPO_PUBLIC_API_URL to your backend (see the comments)
npx expo start                  # then press "a" for an Android emulator, or scan with Expo Go
```

The backend must be running (`README.md` at the repository root). With the mock SMS provider
the code is not sent anywhere; in development set `SMS_MOCK_LOG_CONTENT=true` (with `DEBUG`)
to see it in the backend/Celery log.

| Command | What it does |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm test` | Jest + React Native Testing Library: API client, translations, every auth/profile flow and the Home dashboard on the real routes with a fake backend (run in the Asia/Dhaka time zone) |
| `npm run export:web` | Bundle check; the web build is used only for browser QA |
| `npx playwright test` | End-to-end on the web build against the real backend — only through `admin/e2e/stack/run.sh` with `E2E_PROJECT_DIR=mobile` (`docs/DEPLOYMENT.md` §8) |

## How it is organised

```
src/
├── app/                 screens (Expo Router: one file = one route)
│   ├── _layout.tsx      fonts, language, session; three guarded areas (Stack.Protected)
│   ├── language.tsx     first launch: বাংলা / English
│   ├── (auth)/          login, register, forgot-password      (signed out)
│   └── (app)/           tabs (home, exams, results, packages, profile), exam/[slug],
│                        attempt/[id] (exam room), result/[id], review/[id], leaderboard/[slug],
│                        payment/[id], payments, payment-result (return link), notifications,
│                        edit-profile, change-password
├── api/                 fetch wrapper, error shape, error → sentence
├── auth/                session provider, token storage, types
├── features/auth/       phone and SMS-code steps shared by registration and reset
├── features/dashboard/  Home: API call, result row, package card, sections
├── features/exams/      exam list/details API, paging, exam card, time labels
├── features/attempt/    exam room: session (save/retry/submit rules), timer, question, palette
├── features/results/    results, history, review and leaderboard API, rows
├── features/packages/   packages, payment start, checkout browser, status polling
├── features/notifications/  notifications and notices API
├── components/          AppText, Button, TextField, OtpInput, Banner, Card, dialogs…
├── i18n/                i18next setup + locales/{bn,en}/{common,auth,profile,home,exams,room,results,packages,notifications}.json
├── lib/                 phone numbers, digits, dates, server clock, screen data loading, paging
└── theme/               design tokens (same values as the Admin Panel)
```

## Rules this app follows

- **Tokens:** the refresh token only in `expo-secure-store` (Android Keystore); the access
  token only in memory; nothing in AsyncStorage. A `401` triggers one shared refresh; a refused
  refresh signs the student out. (`docs/SECURITY_PLAN.md`)
- **Config:** `EXPO_PUBLIC_*` values are compiled into the app and readable by anyone — only
  public settings (the API URL). Never a secret.
- **Text:** every string comes from the translation files, in both languages (a test checks
  it). Server messages arrive already translated (`Accept-Language`). Numbers in the Bangla UI
  use Bangla digits; input accepts both.
- **Fonts:** bundled Inter and Noto Sans Bengali; `AppText` picks the font per script and
  gives Bangla a taller line height. System font scaling is respected.
- **Server clock:** exam windows and countdowns use the server's time (`server_time` in
  responses → `lib/server-clock.ts`), never the phone's own clock, which may be wrong.
- **Exam room:** the server decides everything that counts — the deadline, what is saved,
  the score. The app keeps unconfirmed answer changes on the phone (`mcq.attempt.<id>` in
  AsyncStorage — the student's own choices, never answer keys, which the app never receives)
  so a dropped connection or a closed app loses nothing chosen before the deadline; they are
  retried every few seconds and re-sent on the next start. Submit carries a stored
  Idempotency-Key, so a retried submit cannot count twice. The rules live in
  `features/attempt/session.ts` (tested on their own in `tests/attempt-session.test.ts`).
- **Payments:** the app sends only the package id; the price comes from the server. The
  provider's page opens in an in-app browser (`expo-web-browser`); afterwards the app asks
  the server (`GET /payments/{id}/`) — the server verifies with the provider, the app never
  decides "paid". The return link `livemodeltest://payment-result` only brings the student
  back; its `status` is ignored. Set the backend's `PAYMENT_RETURN_URL` to that link.
- **Server is the source of truth:** the app validates only for quick feedback; the server
  validates again (mobile numbers, passwords, OTP rules).

## App identity

Name **Live Model Test** / **লাইভ মডেল টেস্ট**, Android package `com.livemodeltest.app` (it
cannot change after the first Play Store upload), URL scheme `livemodeltest` (the backend's
`APP_DEEP_LINK_SCHEME` must be the same). Icons, splash and the in-app mark come from the
owner's logo (`assets/images/`; the Admin Panel uses the same mark).

## Building an Android APK (test build, no Play Console needed)

1. Install the CLI and sign in to a free Expo account: `npm i -g eas-cli && eas login`.
2. Put your real staging API address in `eas.json` → `build.preview.env.EXPO_PUBLIC_API_URL`
   (https, ending in `/api/v1`; this value is public, never put a secret here).
3. From `mobile/`: `eas init` (first time only), then `eas build -p android --profile preview`.
4. When it finishes, EAS prints a download link / QR code for the `.apk`; open it on the phone and install
   (allow "install unknown apps"). The `production` profile builds an `.aab` for Google Play later.
