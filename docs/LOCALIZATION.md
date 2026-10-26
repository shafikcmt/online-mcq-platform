# Localization Plan — Bangla (বাংলা) & English

> Status: **Planning document.** Required by `CLAUDE.md` → "Language Requirements".
> Applies to the backend/API, Mobile App, Public Website and Admin Panel.
> Related: `DATABASE_DESIGN.md` §2a (bilingual fields), `API_PLAN.md` §1.2, `UI_UX_GUIDELINES.md` §2.2 and §14.

---

## 1. Goals

1. Every screen, label, validation message, notification, SMS and piece of exam content can be shown in **Bangla (`bn`)** and **English (`en`)**.
2. **No hard-coded user-facing text** in components, serializers or services — all text comes from translation files (UI text) or bilingual database fields (admin-entered content).
3. Adding a third language later must be a configuration + translation job, not a rewrite.
4. Bangla must look and behave as well as English: correct fonts, line height, digits, dates, search and sorting.

---

## 2. Two kinds of text (the key idea)

| Kind | Examples | Who writes it | Where it lives |
|---|---|---|---|
| **UI text** (static) | Button labels, menu items, form labels, validation errors, empty states, SMS templates, notification templates | Developers + translator | **Translation files** in each codebase (`bn` + `en`) |
| **Content** (dynamic) | Category/subject names, exam titles & instructions, questions, options, explanations, package names, notices, FAQ, pages, site settings | Admins in the Admin Panel | **Bilingual fields in PostgreSQL** (`*_bn`, `*_en`) |

Students never see a database field name or a translation key — they only see the resolved text in their chosen language.

---

## 3. Language settings & resolution

### 3.1 Language preferences
| Setting | Stored in | Default |
|---|---|---|
| Platform default language | `site_settings.default_language` (admin-configurable) | `bn` (proposal — confirm with owner) *(6A: built. Cached for 5 minutes; saving clears the cache entry, but application instances that do not share that cache may use the old default until their entry expires — maximum propagation delay = the 5-minute TTL (accepted 6A limitation, no distributed invalidation). Until first saved, or if the cache/database fails, the environment `DEFAULT_LANGUAGE` is used.)* |
| Student UI language | `student_profiles.preferred_language` (synced from app) | device language if `bn`/`en`, else platform default |
| Admin UI language | `users.preferred_language` | `en` (proposal) |
| Website visitor language | URL prefix `/bn/…` or `/en/…` + cookie | platform default |
| Exam content language | `exams.content_language` (`bn` \| `en` \| `both`) | `bn` |

> **UI language ≠ exam content language.** A student may use the app in English while taking a
> Bangla-medium exam. The exam room shows a language toggle only when the exam is `both`.

### 3.2 How the backend picks a language for a request
1. `?lang=bn|en` query param (useful for website SSR & debugging) — optional
2. `Accept-Language` header (mobile app & website send the user's choice)
3. Logged-in user's `preferred_language`
4. `site_settings.default_language`

Django's `LocaleMiddleware` + `LANGUAGES = [("bn", "বাংলা"), ("en", "English")]` handles steps 2 and 4; a small custom step adds the user preference.

### 3.3 Fallback rule for content
If the requested language field is empty, return the other language (and mark it):
```
title = title_bn if lang == "bn" and title_bn else title_en or title_bn
```
API returns `"title": "...", "title_lang": "en"` only where a fallback happened (optional, lets the UI set the correct font/`lang` attribute).

---

## 4. Backend (Django/DRF)

- **UI/system text:** Django `gettext` (`gettext_lazy` in models/serializers) → `.po` files at `backend/locale/bn/LC_MESSAGES/django.po` and `en`. Covers API error messages, validation messages, email/SMS templates, notification templates.
- **Error responses:** stable machine `code` + localized `message` (clients may also map `code` to their own translated text).
- **Content fields:** paired columns (`title_bn`, `title_en`, …) on content models. Implementation option: a small shared abstract helper in `core` or the `django-modeltranslation` package — decided at implementation time (nothing installed now).
- **Serializers:**
  - Student/public serializers return **one resolved value** per field (`title`) in the request language.
  - Admin serializers return **both** (`title_bn`, `title_en`) for editing.
- **Validation:** "at least one language required" for each bilingual field; when `exams.content_language = both`, publishing requires all assigned questions/options to have both languages.
- **Notifications:** stored as `template_key + params` (e.g. `result_published`, `{exam_id, exam_title_bn, exam_title_en}`) and rendered in the reader's language when listed → a user who switches language sees old notifications in the new language.
- **SMS (OTP):** template per language, chosen from the user's (or registration screen's) language. Note: Bangla SMS uses Unicode encoding → **70 characters per SMS segment instead of 160**, so Bangla OTP text must be very short (cost impact — SMS fees are a client cost).
- **Time zone:** store UTC, display Asia/Dhaka in both languages.

---

## 5. Digits, numbers, dates, currency

| Item | Rule |
|---|---|
| Display digits | In `bn` UI, show Bangla digits (০১২৩৪৫৬৭৮৯) for counts, marks, timer, dates, prices; in `en` UI use Western digits. Implemented with `Intl.NumberFormat('bn-BD')` / `('en-US')` on clients. |
| **Input digits** | Phone, OTP, marks, price and search inputs **must accept both Bangla and Western digits**. Clients normalize to Western digits before sending; **backend normalizes again** (never trust the client). |
| Stored numbers | Always Western digits / numeric types in the database. |
| Phone numbers | Normalized to E.164 `+8801XXXXXXXXX` regardless of input digits. |
| Dates | `Intl.DateTimeFormat('bn-BD' | 'en-GB', { timeZone: 'Asia/Dhaka' })` → e.g. `৫ অক্টোবর ২০২৬, সন্ধ্যা ৭:৩০` / `05 Oct 2026, 7:30 PM` |
| Relative time | `Intl.RelativeTimeFormat` → `২ ঘণ্টা পরে` / `in 2 hours` |
| Currency | `৳ ৪৯৯` (bn) / `৳ 499` (en); amounts stored as `NUMERIC` BDT |
| Option labels | `ক খ গ ঘ` (bn) or `A B C D` (en) — generated by the client from display order, never stored as answers |
| Pluralization | Use ICU message format in i18n libraries (English needs plural forms; Bangla mostly doesn't) |

---

## 6. Text handling in the database

- PostgreSQL database in **UTF-8** (default) — stores Bangla safely.
- Normalize all incoming text to **Unicode NFC** before saving (Bangla can be typed in different code-point sequences that look identical; NFC makes search & uniqueness checks reliable).
- **Search:** PostgreSQL full-text search has no Bangla stemmer → use `pg_trgm` trigram indexes (or `ILIKE` for small tables) on `*_bn` and `*_en` text fields in the admin question bank. Western/Bangla digit variants normalized before searching.
- **Sorting:** names sorted with an ICU collation (PostgreSQL ICU collations, e.g. `und-x-icu`) or by `sort_order` set by admins.
- **Slugs/URLs:** ASCII only, generated from the English title or entered by admin (Bangla slugs make ugly, percent-encoded URLs).

---

## 7. Mobile app (Expo)

- i18n library: `i18next` + `react-i18next`, `expo-localization` for the device language *(8A: built; a test checks that every key exists in both languages with the same placeholders)*.
- Translation files: `mobile/src/i18n/locales/{bn,en}/{common,auth,exam,result,payment,…}.json` split by feature namespace.
- Language switch in onboarding (first screen) and Profile → Settings; takes effect instantly without restart; saved locally and synced to `preferred_language`; sent as `Accept-Language` on every request.
- Bundled fonts (Bangla + Latin) via `expo-font` so rendering doesn't depend on the phone's fonts.
- Exam room language toggle (`বাং | EN`) for `both`-language exams; selected language remembered per attempt.

## 8. Public website (Next.js)

- Locale-prefixed routes: `/bn/...` and `/en/...` (root `/` redirects by cookie → `Accept-Language` → default).
- i18n library planned: `next-intl` (or equivalent) — **not installed now**.
- Translation files: `web/messages/{bn,en}.json`.
- SEO: `<html lang="bn">` / `lang="en"`, `hreflang` alternate links, localized `<title>`/meta, localized sitemap entries.
- Language switcher in header (and footer), keeps the user on the same page.

## 9. Admin panel (Next.js)

- Admin UI itself is translatable (`admin/messages/{bn,en}.json`); default English, switchable to Bangla.
- **Bilingual content editor pattern:** every bilingual field shows `বাংলা` / `English` tabs (or side-by-side on wide screens), with a completeness indicator (✓ both / ⚠ one missing).
- List pages show content in the admin's UI language with a small badge when a translation is missing; filter "Missing translation".
- Question editor preview can toggle `bn`/`en` to see exactly what students will see.

---

## 10. Translation workflow

1. Developers add keys in English **and** Bangla in the same PR (no key without both).
2. Key naming: `feature.screen.element` (e.g. `exam.room.submitButton`), never raw sentences as keys.
3. CI check (later): fail if a key exists in one locale but not the other.
4. A Bangla-speaking reviewer proofreads UI text before release (tone: polite, simple, standard Bangla — avoid machine-translation phrasing).
5. Shared glossary (below) keeps terms consistent across app, website and admin.

### 10.1 Glossary (proposal — owner to confirm wording)
| English | বাংলা |
|---|---|
| Exam | পরীক্ষা |
| Practice exam | অনুশীলন পরীক্ষা |
| Live exam | লাইভ পরীক্ষা |
| Question | প্রশ্ন |
| Option | অপশন / বিকল্প |
| Correct / Wrong / Unanswered | সঠিক / ভুল / উত্তর দেওয়া হয়নি |
| Mark for review | পরে দেখার জন্য চিহ্নিত করুন |
| Submit | জমা দিন |
| Result | ফলাফল |
| Merit position | মেধাক্রম |
| Leaderboard | লিডারবোর্ড |
| Negative marking | নেগেটিভ মার্কিং |
| Package | প্যাকেজ |
| Subscription | সাবস্ক্রিপশন |
| Payment | পেমেন্ট |
| Notice | নোটিশ |
| Time remaining | সময় বাকি |

---

## 11. Testing checklist

- [ ] Every screen in both languages: no missing keys, no clipped/overflowing Bangla text
- [ ] Bangla digits shown in `bn` UI; Bangla-digit input accepted for phone/OTP/marks/price
- [ ] Fallback works when one content language is missing
- [ ] Exam with `content_language=both` toggles question language without losing selected answers
- [ ] Error messages localized; `code` unchanged across languages
- [x] Notifications re-render in the new language after switching *(6B: rendered from gettext templates + bilingual name snapshots at read time; tested with `Accept-Language` and `preferred_language`)*
- [ ] OTP SMS correct in both languages and within the intended segment length
- [ ] Website `hreflang`, `lang` attributes and localized metadata correct
- [ ] Search finds Bangla questions (NFC-normalized, trigram)

---

## 12. Out of scope (Phase-1)

- Automatic machine translation of content.
- Right-to-left languages.
- More than two languages (architecture allows it later).
