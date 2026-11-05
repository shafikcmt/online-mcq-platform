# Phase-1 Pending Tasks

> Status check of what is still open in Phase-1, written while the **Google Play Console
> account verification is pending**. Source: `ROADMAP.md` (Milestones 8 and 10) and
> `ACCEPTANCE_CHECKLIST.md` (rows marked ⏳). Last checked: 2026-11-05.

**Summary:** all Phase-1 code and screens are built (Milestones 1–9 complete; Milestone 10 A–H
done). What remains is deployment, real-provider checks and real-device checks. **Only one
item truly needs the Play Console** (publishing to Google Play). The rest can continue now.

## A. Blocked by Google Play Console verification

| Task | Why it waits |
|---|---|
| Upload the app to Google Play (internal / closed / production track) and the store listing | Needs the verified developer account |
| Store link for the website's "Download App" button | The Play URL exists only after the app is created in the Console. Until then the site shows "Coming soon to Google Play" (set the link later in Admin → Site settings; no code change) |
| Final Play review | Starts after upload |

Note: the Android package `com.livemodeltest.app` cannot change after the first upload
(decisions log #24), so confirm it before creating the app in the Console.

## B. NOT blocked by Play Console — can continue now

| Task | How |
|---|---|
| Android build for testing | Build an installable **APK** (EAS `preview` profile or a local build) and send it to phones directly. No Play account needed. `mobile/` has no `eas.json` yet — adding one (APK preview + AAB production profiles) is a small next step |
| Real-device checks: low-end and mid-range Android, poor network, font scale 1.3×, TalkBack | Use the APK above. Required by Milestone 8's completion criteria |
| Full journey on a real device (register → buy → exam → result, Bangla + English) | Same APK against the staging server |
| Production server, domain, HTTPS (`PRODUCTION_DEPLOYMENT.md`) | Needs the client's VPS and DNS, not Play |
| Real SMS gateway test (open question 1) | Needs SMS provider credentials |
| SSLCommerz sandbox run, then live (open question 2) | Needs store credentials |
| Restore drill on the real server, production secrets, error reporting | Deployment-time items from `PRODUCTION_SETTINGS_AUDIT.md` |
| Source handover + setup notes | After completion / final payment |

## C. Open owner questions (still unresolved in `ROADMAP.md`)

SMS provider · SSLCommerz account · default language / glossary · hosting provider and
subdomains · screenshot blocking (`FLAG_SECURE`) on exam screens · single vs. limited admin role.

## Recommended next step

1. Keep the Play Console verification going (it only gates section A).
2. Meanwhile, add `mobile/eas.json` and produce a test **APK**, then run the real-device checks
   in section B. This closes the remaining Milestone 8 criteria without waiting for Google.
3. When the account is verified: create the app with package `com.livemodeltest.app`, upload an
   **AAB** to the internal testing track first, then paste the Play link into Site settings.
