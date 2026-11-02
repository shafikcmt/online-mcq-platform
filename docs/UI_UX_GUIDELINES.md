# UI/UX Guidelines — Online MCQ Examination Platform

> Status: **Planning document.** Applies to the Mobile App (Expo), Public Website (Next.js) and
> Admin Panel (Next.js).
> Reference for *flow and usability ideas only*: https://web.livemcq.com/. We do **not** copy its
> branding, text, assets, code or visual identity. Our name, colors, illustrations and copy are our own.
> The reference was not accessible from the planning environment; per project decision this does not
> block work — these guidelines are based on the requirements and modern UI/UX principles.
> **Every screen is bilingual (বাংলা / English)** — see §14 and `LOCALIZATION.md`.

---

## 1. Overall design principles

1. **Calm and serious.** This is an exam platform. Students may be stressed; admins handle real
   money and results. Neutral backgrounds, one confident brand color, no visual noise.
2. **Clarity over decoration.** Every screen answers: *Where am I? What can I do? What happens next?*
3. **One primary action per screen.** e.g. "Start exam", "Submit", "Save question". Secondary actions are visually quieter.
4. **Fast by default.** Skeletons instead of spinners, optimistic UI only where safe (never for submit/payment), small bundles, cached public data.
5. **Mobile-first.** Design the smallest screen first, then expand.
6. **Honest states.** Always show loading, empty, error and success states. Never a blank screen.
7. **Server is the truth.** UI shows server time, server status and server results; it never pretends something succeeded before the API confirms it.
8. **Consistency.** Same words, colors, icons and component behavior on all three platforms.
9. **Accessible.** Readable contrast, large touch targets, works with system font scaling.
10. **Bilingual by design.** Layouts are built for Bangla and English from day one — flexible widths, no text baked into images, no hard-coded strings.

---

## 2. Design tokens (shared foundation)

Stored once in `design/` and consumed by Tailwind (web/admin) and the RN theme (mobile).

### 2.1 Color (proposal — final brand color chosen by owner)
| Token | Purpose | Light value (proposal) |
|---|---|---|
| `primary-600` | Main actions, active nav | Deep blue `#1D4ED8` |
| `primary-50` | Selected backgrounds | `#EFF6FF` |
| `neutral-900` | Main text | `#0F172A` |
| `neutral-600` | Secondary text | `#475569` |
| `neutral-200` | Borders/dividers | `#E2E8F0` |
| `neutral-50` | App background | `#F8FAFC` |
| `surface` | Cards | `#FFFFFF` |
| `success-600` | Correct, paid, active, passed | `#16A34A` |
| `warning-600` | Mark for review, expiring, pending | `#D97706` |
| `danger-600` | Wrong, failed, errors, time almost up | `#DC2626` |
| `info-600` | Notices, upcoming | `#0284C7` |

Rules:
- **Never use color alone** to communicate status — always add an icon or text (e.g. ✓ "Answered").
- Semantic colors are reserved: green = good/correct/paid, amber = attention/review/pending, red = wrong/error/danger. Don't use red as decoration.
- Dark mode: tokens designed so dark mode can be added later; Phase-1 ships light mode (optional dark mode for the exam room only if time allows).

### 2.2 Typography
- Fonts (Unicode-safe, free/open-licensed, bundled — not loaded from the phone): **Inter** for Latin + **Noto Sans Bengali** (or Hind Siliguri) for Bangla, set as a font stack so mixed Bangla/English text renders correctly.
- Scale (px): 12 caption · 14 body-sm · 16 body · 18 lead · 20 h4 · 24 h3 · 30 h2 · 36 h1 (website hero up to 48).
- Body line-height ≥ 1.5; Bangla uses ~1.6–1.7 and may need +1px size (conjuncts and vowel signs above/below need space).
- Never use letter-spacing or ALL-CAPS styling for meaning (no effect / broken look in Bangla).
- Question text in exam room: **min 16px, default 17–18px**, adjustable.
- Numbers (timer, marks, tables): tabular figures so digits don't jump.

### 2.3 Spacing, radius, elevation
- Spacing scale: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64.
- Radius: 6 (inputs/buttons small) · 10 (cards) · 16 (sheets/modals) · full (chips/badges).
- Elevation: flat cards with 1px border by default; shadow only for floating elements (dropdowns, modals, bottom sheets, sticky submit bar).

### 2.4 Iconography
- One open-source outline icon set everywhere (e.g. Lucide — available for React and React Native).
- 20px in dense UI, 24px default.

---

## 3. Mobile app screen structure (Android, Expo)

### 3.1 Navigation
```
Auth stack (logged out)
 ├─ Language choice (বাংলা / English) — first launch only, changeable later
 ├─ Welcome / Onboarding (1–3 short slides, skippable)
 ├─ Login (mobile number + password)
 ├─ Register → mobile number (mandatory) → SMS OTP verify → name, password, email (optional)
 └─ Forgot password → mobile number → SMS OTP → New password

Main (logged in) — bottom tab bar (max 5 tabs)
 ├─ Home        (dashboard)
 ├─ Exams       (Live/Upcoming · Available · Practice tabs + filters)
 ├─ Results     (history + leaderboards)
 ├─ Packages    (plans, my subscription, payment history)
 └─ Profile     (profile, settings, notices, help, logout)

Full-screen stack (no tab bar)
 ├─ Exam details / instructions
 ├─ Exam room
 ├─ Submit confirmation → Submitted / Result
 ├─ Answer review
 ├─ Leaderboard
 ├─ Payment checkout (in-app browser) → Payment status
 └─ Notifications
```

### 3.2 Key screens
| Screen | Content & layout |
|---|---|
| **Home** | Greeting + subscription status card (active till date / "Get a package" CTA) · "Live now / Starting soon" horizontal cards with countdown · Available exams list · Practice shortcut · Recent results (score + %) · Notices preview · notification bell with badge |
| **Exams list** | Segmented tabs; search + category filter chips; exam card = title, category/subject, duration, questions, marks, **Free/Paid badge**, language badge (`বাং` / `EN` / `বাং+EN`), schedule, attempts (`1 of 3 used`), status button (`Start`, `Resume`, `Retake`, `Locked 🔒 – Get package`, `Starts in 2h`, `Ended`) |
| **Exam details** | Key facts grid (duration, questions, total marks, negative marking, pass marks), schedule, instructions list, attempts used/allowed, primary **Start exam** button (disabled with reason if not allowed). **Live exam joined late:** clear notice "Exam ends at 8:00 PM — you will have 18 minutes" before starting |
| **Result** | Big score + percentage ring, Pass/Fail badge, grid: correct / wrong / unanswered / negative marks / time used, merit position, buttons: Review answers (if allowed), Leaderboard |
| **Leaderboard** | Top 3 highlighted, then ranked list (rank, display name per privacy setting — masked by default, marks, time); "Your position" sticky row (you always see your own name) |
| **Packages** | Package cards: name, price, validity, what's included, CTA; current plan highlighted |
| **Payment status** | Pending (spinner + "Verifying with provider…"), Success (check + new expiry date), Failed/Cancelled (reason + Try again) |
| **Profile / Settings** | Avatar/initials, name, phone (verified ✓), email (optional), display name for leaderboards, edit, change password, **language (বাংলা / English)**, notices, FAQ/help, contact, about, logout |
| **Notifications** | In-app list (Phase-1 has no push): icon by type, title, short body, relative time, unread dot; tap navigates (result, payment, package); "Mark all as read"; empty state |

---

## 4. Exam-taking UI guidance (most important screen)

### 4.1 Layout
```
┌─────────────────────────────────────┐
│ ← Exit   Exam title        ⏱ 24:13  │  sticky header (timer always visible)
│ ███████████░░░░░░  18 / 50 answered │  progress bar
├─────────────────────────────────────┤
│ Question 19 of 50   বাং|EN  ☆ Review │  (language toggle only for bilingual exams)
│                                     │
│ Question text (large, readable)     │
│ [optional image, tap to zoom]       │
│                                     │
│ ( ক ) Option text                   │  full-width tappable rows,
│ ( খ ) Option text  ← selected       │  min 48px tall; labels A–D in
│ ( গ ) Option text                   │  English UI, ক–ঘ in Bangla UI
│ ( ঘ ) Option text                   │
│                      Clear answer   │
├─────────────────────────────────────┤
│ ◀ Previous   [ ▦ Palette ]   Next ▶ │  sticky bottom bar
└─────────────────────────────────────┘
```
- One question per screen; swipe left/right **and** buttons for Previous/Next.
- **Question palette**: bottom sheet with a numbered grid. States (color + shape/icon):
  - Not visited — outlined neutral
  - Visited, unanswered — neutral fill
  - Answered — primary/green fill + ✓
  - Marked for review — amber + flag icon (can also be answered: amber with ✓)
  - Current — thick outline
  - Legend + counts at top; filter "Show unanswered / Show marked".
- **Submit** button lives in the palette sheet and on the last question — not next to "Next", to prevent accidental taps.

### 4.2 Timer behavior
- Countdown computed from server `deadline_at` and `server_time` offset — never from device time alone.
- Calm neutral color normally; **amber at 5 min**, **red at 1 min** with a single gentle vibration/toast (no constant flashing).
- At 00:00: lock inputs, show "Time is up — submitting your answers…" full-screen state, submit automatically, then show result/“submitted” screen.

### 4.3 Saving & connectivity (no full offline mode in Phase-1)
- The exam must be started online. Answers are kept in a **local temporary state** and **autosaved** to the server on every change.
- Small status text in the header: "Saved ✓" / "Saving…" / "Connection lost — retrying…" / "N answers waiting to sync".
- During a **temporary connection loss** the student can keep answering; pending answers are retried automatically and synced when the connection returns. A clear amber banner explains that answers only count once they reach the server before time ends.
- Never block the student because a single autosave failed.
- If the app is killed: reopening the exam resumes from the **server's** saved answers and the correct remaining time.
- Bilingual exams: switching বাং/EN never changes or loses the selected answers.

### 4.4 Submission
- Confirmation dialog shows a **summary**: answered, unanswered, marked for review; warning if unanswered > 0; buttons: "Go back" (secondary) and "Submit now" (primary).
- After submit: a clear success state. If results are hidden: "Submitted successfully. Results will be published on <date>."

### 4.5 Distraction & safety
- No ads, banners or notifications inside the exam room.
- Back button / Exit → confirmation ("The timer keeps running even if you leave").
- Keep screen awake during exam (`expo-keep-awake`).
- Optional screenshot blocking (pending decision).
- Respect system font size; provide A−/A+ text size control in the exam header menu.

### 4.6 Answer review (after result is published)
- Same question layout; correct option marked green ✓, student's wrong choice red ✗, unanswered labeled; explanation in a soft card below; palette filters: All / Wrong / Unanswered / Correct.

---

## 5. Public website structure (Next.js)

Website is informational — **it does not run exams**.

```
Header: Logo · Exams · Packages · Notices · Results · FAQ · বাংলা|English · [Download App / Open App] (primary)
         (Results = public leaderboards with masked/configured names, only for exams whose results are visible)
Footer: About · Contact · FAQ · Terms · Privacy · Play Store badge · language switch · social links
```

| Page | Sections |
|---|---|
| **Home** | Hero (value proposition + Download App CTA + phone mockup of our own design) · Key features (3–6 icon cards) · Upcoming/live exams strip · Popular categories · Packages teaser (3 cards) · Latest notices · How it works (3 steps: Download → Choose exam → Get result & rank) · FAQ preview · Final download CTA |
| **Exams** | Tabs: Upcoming · Available; filters by category/type/free-paid; exam cards with schedule; "Take this exam in the app" CTA |
| **Exam detail** | Facts, schedule, syllabus/instructions text, CTA to app |
| **Packages** | Pricing cards, comparison of what's included, FAQ about payment |
| **Notices** | List with date, pinned items first; detail page |
| **Results/Leaderboard** | Per-exam top list; names per `public_leaderboard_name_mode` (default masked); never phone/email |
| **About / FAQ** | Simple content pages; FAQ as accordion |
| **Contact** | Contact form (left/top) + contact details card (right/bottom) |

Website rules (Phase-1 decisions):
- **No login/register on the website.** The header's primary button is **Download App**; on Android
  phones it becomes **Open App** (tries to open the installed app, falls back to the Play Store).
- **Language switcher** (`বাংলা | English`) in header and footer; routes `/bn/...` and `/en/...`.
- **Contact page** has a basic form: name, mobile or email, subject, message → success state
  "Thanks! We'll get back to you soon." with throttling and friendly validation; plus contact info.
- Public leaderboards show **masked or configured display names** only.

SEO: server-rendered pages, proper titles/meta descriptions, Open Graph image, sitemap, fast LCP (< 2.5 s target on 4G).

---

## 6. Admin panel layout

```
┌──────────┬──────────────────────────────────────────────┐
│  Logo    │ Breadcrumb / Page title      🔍  🔔  Admin ▾ │ top bar
│──────────│──────────────────────────────────────────────│
│ Dashboard│                                              │
│ Users    │  Page header: title · short description ·   │
│ Catalog ▸│               primary action (e.g. + New)    │
│ Questions│                                              │
│ Exams    │  Filter bar (search · selects · date range · │
│ Results  │              reset) + active filter chips    │
│ Packages │                                              │
│ Subscript│  Content: table / form / detail view         │
│ Payments │                                              │
│ Content ▸│                                              │
│ Settings │                                              │
│ Audit log│                                              │
└──────────┴──────────────────────────────────────────────┘
```
- Collapsible sidebar (icons only when collapsed); on tablet/mobile it becomes a drawer.
- Grouped navigation: **Overview** (Dashboard) · **People** (Users, Subscriptions) · **Content** (Categories/Subjects, Questions, Exams) · **Results** · **Commerce** (Packages, Payments) · **Site** (Announcements, FAQ, Pages, Settings) · **System** (Audit log).
- Detail pages: summary header (status badge + key actions) + tabs (e.g. Exam: Details · Questions · Attempts · Results).
- **Exam builder**: left = exam settings form; right/tab = question picker (search/filter question bank, multi-select, add) and assigned list with drag-to-reorder, marks override, live counters ("42 / 50 questions, 50 total marks"). Publish button disabled with reason until valid.
- **Exam settings form sections:** Basics (title বাং/EN, category, subject, type, content language) · Timing & schedule · Marking (marks, negative marks, pass marks) · Access (free/paid) · **Attempts & merit** (allow retake, max attempts, merit strategy — locked to "1 attempt / single attempt" for live exams with an explanatory hint) · Results (visibility, answer review).
- **Question editor**: subject select (category shown automatically), question text and options with **বাংলা / English tabs** and a completeness indicator, radio to choose correct, explanation, difficulty, live preview with language toggle.
- **Bilingual content editor pattern** (all content: categories, subjects, questions, exams, packages, notices, FAQ, pages, settings): `বাংলা | English` tabs (side-by-side on wide screens), ✓/⚠ completeness badge, list filter "Missing translation".
- **Contact messages** inbox: table (date, name, contact, subject, status) + detail drawer + status change (new/read/resolved).
- Dangerous actions (delete, deactivate user, unpublish exam, hide results) use a confirmation dialog stating the consequence; deletes of referenced items explain why they're blocked.

---

## 7. Dashboard & basic reports guidance

Phase-1 "reports" = basic operational statistics on dashboards and filtered list pages. Advanced
analytics, custom reports and exports are Phase-2 — don't design for them yet, but keep the same card
and table patterns so they can be added consistently later.

**Admin dashboard**
- Top row: 4 KPI cards (Students, Published exams, Attempts today, Revenue this month) — number, label, small trend vs previous period if cheap to compute.
- Middle: "Live & upcoming exams" table; "Recent payments" list with status badges.
- Bottom: "Recent activity" (from audit log), "Latest registrations".
- Advanced analytics/exports are Phase-2 — keep charts to at most one simple line/bar chart (e.g. attempts per day for 14 days).

**Student dashboard (mobile Home)**
- Prioritize *time-sensitive* content: live/starting-soon exams first, then subscription status, then available exams, then recent results.
- Keep it scannable: short horizontal carousels + "See all" links; no more than ~5 sections.

Rules: each card answers one question; numbers formatted (`1,250`, `৳ 499`); dates relative when near ("in 2 h"), absolute otherwise (`05 Oct 2026, 7:30 PM`).

---

## 8. Form, table and filter standards

### 8.1 Forms
- Label above input (never placeholder-only labels); helper text under input; required fields marked.
- Validate on blur and on submit; show field error under the field in `danger` color + icon; summary at top for long forms.
- Map API `field_errors` directly to fields.
- Primary button right-aligned on desktop, full-width at bottom on mobile; disable + show spinner while submitting; prevent double submit.
- Group long forms into sections with headings (e.g. Exam: Basics · Timing & schedule · Marking · Access · Results).
- Unsaved changes warning when leaving a dirty form.
- Inputs: phone with `+880` prefix & numeric keyboard; OTP as 6 separate boxes with auto-advance/paste support and resend countdown; password with show/hide toggle.

### 8.2 Tables (admin)
- Sticky header, zebra-free with row hover, right-aligned numbers, status as badges.
- Columns: most important first; actions in a final "⋯" menu column.
- Server-side pagination (page size 20/50/100), sorting on key columns, row count shown ("Showing 1–20 of 1,532").
- Bulk selection only where needed (e.g. adding questions to an exam).
- On small screens tables become stacked cards (label: value).

### 8.3 Filters
- Filter bar above the table: search box (debounced 300 ms) + up to 3–4 visible filters + "More filters" drawer.
- Active filters shown as removable chips + "Clear all".
- Filters reflected in the URL query string (shareable, back button works).

---

## 9. Responsive behavior

| Breakpoint (Tailwind) | Website | Admin |
|---|---|---|
| < 640 (`sm`) | Single column, hamburger menu, sticky "Download App" button | Drawer nav, tables → cards, full-width forms |
| 640–1023 (`sm`–`md`) | 2-column grids | Collapsed icon sidebar |
| ≥ 1024 (`lg`) | 3–4 column grids, max content width ~1200px | Full sidebar, multi-column forms |

Mobile app: support small Android screens (360×640 dp) up to tablets; respect safe areas; test with system font scale 1.3×. Portrait-first; exam room works in landscape without layout breaks.

---

## 10. Loading, empty, error and success states

| State | Pattern | Example copy (our own) |
|---|---|---|
| **Loading** | Skeletons matching the final layout (cards/rows). Spinner only for short in-button actions. Pull-to-refresh on mobile lists. | — |
| **Empty** | Simple illustration/icon + one sentence + one action | "No exams right now. New exams will appear here." [Browse practice exams] |
| **Error (network)** | Inline card with retry; keep previously loaded data visible | "Couldn't connect. Check your internet and try again." [Retry] |
| **Error (permission/locked)** | Explain why + how to fix | "This is a paid exam. Get a package to unlock it." [See packages] |
| **Error (server)** | Generic friendly message + reference code if available | "Something went wrong on our side. Please try again." |
| **Success** | Toast for small actions ("Question saved"); full screen for big moments (exam submitted, payment successful) | "Payment successful. Your package is active until 05 Nov 2026." |
| **Warning** | Amber banner, persistent until resolved | "Your package expires in 3 days." |
| **Pending** | Neutral/amber status with explanation | "Verifying your payment…" |

Rules: error messages say *what happened* and *what to do*; never show raw technical errors, stack traces or HTTP codes to students.

---

## 11. Accessibility basics

- Contrast: text ≥ 4.5:1, large text/icons ≥ 3:1 (WCAG AA).
- Touch targets ≥ 48×48 dp (mobile) / 44×44 px (web).
- Status never by color alone (icons/text too) — important for the question palette.
- All interactive elements keyboard-accessible on web with visible focus rings; logical tab order; skip-to-content link on website.
- Proper semantic HTML (buttons are `<button>`, headings in order), form labels linked to inputs, `aria-live` for toasts and timer warnings (not every second).
- React Native: `accessibilityLabel`, `accessibilityRole`, `accessibilityState` (selected/checked) on options and palette items.
- Support system font scaling; avoid text in images.
- Motion: subtle (150–250 ms), respect "reduce motion" settings.

---

## 12. Reusable component strategy

Build a small, shared component vocabulary — same names and behavior on web and mobile, implemented separately (Tailwind for web/admin, RN `StyleSheet`/theme for mobile) from the same tokens.

| Group | Components |
|---|---|
| Primitives | Button (primary/secondary/ghost/danger; sizes; loading), IconButton, Input, Textarea, Select, Checkbox, Radio, Switch, OTPInput, PhoneInput, SearchInput |
| Display | Card, Badge (status), Chip, Avatar, Stat/KPI card, ProgressBar, ProgressRing, Countdown, EmptyState, ErrorState, Skeleton, Divider |
| Feedback | Toast, Banner/Alert, ConfirmDialog, Modal / BottomSheet |
| Navigation | Tabs/SegmentedControl, Pagination, Breadcrumbs, Sidebar (admin), BottomTabBar (mobile) |
| Data | DataTable (sorting, pagination, empty/loading built-in), FilterBar, FilterChips, KeyValueList |
| Domain | ExamCard, ExamStatusBadge, AccessBadge (Free/Paid/Locked), PackageCard, ResultSummary, LeaderboardRow, QuestionView, OptionItem, QuestionPalette, ExamTimer, PaymentStatus |

Approach:
- Web/admin: Tailwind + a headless accessible library (e.g. Radix UI primitives / shadcn-style components owned in our repo) — decided at implementation time, no package installed now.
- Mobile: own components on top of React Native primitives; keep third-party UI kits minimal.
- Each component documents its states (default, hover/pressed, focus, disabled, loading, error).
- Domain components receive API-shaped data, so the same props work across clients.

---

## 13. Design consistency rules

1. Use tokens only — no hard-coded hex colors, spacing or font sizes in components.
2. Same label for the same thing everywhere: "Exam", "Practice exam", "Live exam", "Package", "Subscription", "Result", "Merit position", "Mark for review".
3. Same status → same badge color/icon on all platforms (e.g. `Paid` = primary, `Free` = success, `Locked` = neutral + lock, `Pending` = warning, `Failed` = danger).
4. Date/time format: `05 Oct 2026, 7:30 PM` (en) / `৫ অক্টোবর ২০২৬, সন্ধ্যা ৭:৩০` (bn), Asia/Dhaka; currency `৳ 499` / `৳ ৪৯৯` (BDT). Always via `Intl` formatters, never hand-built strings.
5. Buttons: verbs ("Start exam", "Submit answers", "Buy package"), sentence case.
6. One primary button per view; destructive actions always confirm.
7. Icons from one set, one stroke width.
8. New screens must include loading, empty and error states before review.
9. Copy tone: short, polite, encouraging, no jargon; no blaming the user.
10. No hard-coded user-facing text: every label comes from translation keys; every screen is reviewed in both languages.
11. Any new pattern must be added to this document (and the component library) before it is reused elsewhere.

---

## 14. Bilingual UI rules (Bangla + English)

- **Language switch** is always reachable: app (onboarding + Settings), website (header/footer), admin (user menu). Switching is instant and remembered.
- **Text expansion:** Bangla labels can be 20–40% longer or taller than English. Buttons, badges, tabs and table headers must grow/wrap gracefully — no fixed widths, no truncation of critical text (truncate only secondary text with a tooltip/expand).
- **Mixed content:** UI language and exam content language can differ; content blocks set their own `lang` attribute (web) so the correct font and screen-reader voice are used.
- **Digits:** Bangla UI shows Bangla digits (timer `২৪:১৩`, marks, ranks, prices); inputs accept both Bangla and Western digits.
- **Option labels:** `ক খ গ ঘ` in Bangla UI, `A B C D` in English UI.
- **Fallback indicator:** when content is missing in the chosen language and the other language is shown, display it normally (no error) — admins see the ⚠ missing-translation badge, students don't.
- **Images/illustrations** contain no text, so they work for both languages.
- **Validation and error messages** come from the API's localized `message` or client translation keys mapped from the error `code`.
- **Testing:** every screen screenshot-reviewed in both languages at 360 dp / 1.3× font scale.

---

## 15. Consistency across modules

The same tokens, components and state patterns are used everywhere. Module-specific rules:

| Module | Key UI pattern (same on app, website and admin where applicable) |
|---|---|
| **Authentication & OTP** | Mobile input with `+880` prefix (Bangla/Western digits), 6-box OTP with resend countdown, password show/hide; one primary button; clear error per field |
| **Exam interface** | §4 — sticky timer, progress, palette bottom sheet, autosave status, confirm-submit summary |
| **Results** | ResultSummary component: score + percentage ring, pass/fail badge, correct/wrong/unanswered/negative/time grid, merit position; identical structure in app and admin result detail |
| **Leaderboard** | LeaderboardRow: rank, display name (privacy mode), marks, time; top-3 highlight; sticky "my position" in app; same masking rules on website |
| **Packages** | PackageCard: name, price, validity, what's included (all exams / categories / exams), CTA; current plan highlighted; same card on website and app |
| **Subscription** | Status card: active (green) / expiring soon (amber, ≤ 7 days) / expired (neutral) with expiry date and renew CTA |
| **Payment** | PaymentStatus: pending → "Verifying your payment…", success → full-screen confirmation with new expiry, failed/cancelled → reason + retry. Payment provider shown as a neutral logo badge (SSLCommerz first; bKash/Nagad later use the same component) |
| **Notifications** | In-app list item with type icon, unread dot, relative time; same badge count style on app and admin |
| **Reports (basic)** | KPI stat cards + one simple chart + filtered tables; same DataTable/FilterBar as other admin pages |
| **Settings** | Grouped settings cards with section headings; save bar appears only when there are changes; language settings first |

---

## 16. What we take (and don't take) from the reference site

**Take as inspiration (generic patterns common to exam platforms):** dashboard-first home for students, clear separation of live/upcoming/practice exams, prominent exam timer, question palette with answered/marked states, result summary followed by merit position, package cards with validity.

**Do not take:** logo, name, colors, illustrations, screenshots, wording, page code, or exact layouts.
