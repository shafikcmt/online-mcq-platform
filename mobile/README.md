# Mobile App (Expo, Android)

The students' app — the only place where exams are taken. React Native + Expo (SDK 58) +
TypeScript, Expo Router for navigation. Bangla and English; Bangla is the default.

**Built so far (Milestone 8A):** app shell, theme, bundled fonts, language choice, sign-in,
registration with an SMS code, forgot password, Home (greeting) and Profile (details, edit,
language, change password, sign out). Exams, results, packages and payments come next
(`docs/ROADMAP.md` Milestone 8).

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
| `npm test` | Jest + React Native Testing Library: API client, translations, every auth/profile flow on the real routes with a fake backend |
| `npm run export:web` | Bundle check; the web build is used only for browser QA |
| `npx playwright test` | End-to-end on the web build against the real backend — only through `admin/e2e/stack/run.sh` with `E2E_PROJECT_DIR=mobile` (`docs/DEPLOYMENT.md` §8) |

## How it is organised

```
src/
├── app/                 screens (Expo Router: one file = one route)
│   ├── _layout.tsx      fonts, language, session; three guarded areas (Stack.Protected)
│   ├── language.tsx     first launch: বাংলা / English
│   ├── (auth)/          login, register, forgot-password      (signed out)
│   └── (app)/           tabs (home, profile), edit-profile, change-password (signed in)
├── api/                 fetch wrapper, error shape, error → sentence
├── auth/                session provider, token storage, types
├── features/auth/       phone and SMS-code steps shared by registration and reset
├── components/          AppText, Button, TextField, OtpInput, Banner, Card, dialogs…
├── i18n/                i18next setup + locales/{bn,en}/{common,auth,profile,home}.json
├── lib/                 phone numbers, digits, dates
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
- **Server is the source of truth:** the app validates only for quick feedback; the server
  validates again (mobile numbers, passwords, OTP rules).

## Open owner decisions

- Android package name (`com.onlinemcq.app` is a placeholder in `app.json`) and the app's
  URL scheme (`onlinemcq`, must match the backend's `APP_DEEP_LINK_SCHEME`).
- Final app name, icon and splash artwork (the current ones are a simple placeholder mark of
  our own, `assets/images/`).
