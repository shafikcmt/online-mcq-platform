# Google Play: what is ready and what the owner must do

> **সারসংক্ষেপ (Bangla):** Play Store-এ অ্যাপ দেওয়ার জন্য কোডের দিকে দরকারি জিনিস তৈরি: গোপনীয়তা নীতি,
> শর্তাবলি ও "অ্যাকাউন্ট মুছুন" ওয়েব পেজ, অ্যাপে অ্যাকাউন্ট মোছার স্ক্রিন, আর অ্যাডমিনের ব্যক্তিগত তথ্য মোছার
> বোতাম। বাকি কাজ (Console-এর ফর্ম, ছবি, অ্যাকাউন্ট যাচাই, টেস্টার) আপনার। Google-এর নিয়ম বদলায়, তাই Console-এর
> নিজস্ব লেখা ও "Learn more" পেজই চূড়ান্ত।

Nothing here was checked with Google's own tools. The texts below are drafts from what the system really does;
the owner (and a lawyer, if wanted) must read them before publishing.

## Built in the product

| Play asks for | Where it is |
|---|---|
| A public **privacy policy** URL | `https://livemodeltest.com/en/privacy` (and `/bn/privacy`). Our text, replaceable in Admin Panel → Pages with a page of slug `privacy` |
| **Terms** (not required, good practice) | `/en/terms`, replaceable with a page of slug `terms` |
| **Account deletion inside the app** | App → Profile → Delete account (password + a second confirmation) |
| **Account deletion URL on the web** | `https://livemodeltest.com/en/delete-account` (steps, what is deleted and kept, contact route) |
| Fulfilling a request from someone who cannot use the app | Admin Panel → Users → the student → **Erase personal data** |

### What "delete" does (decided here, change only with care)
The account is **anonymised, not removed**: name → "Deleted user", mobile number → an unused placeholder, e-mail and
nickname erased, password unusable, every session ended, push devices and pending SMS codes for the number
deleted. Exam attempts, results and merit positions (so other students' ranks do not move) and payments and
subscriptions (accounting) stay, without a name. The old number can register again. Audited as
`user.delete_account` / `user.anonymise`. API: `POST /api/v1/auth/account/delete/` (student, current password),
`POST /api/v1/admin/users/{id}/anonymise/` (admin, `{"confirm": true}`).

If a lawyer says payment records must also lose their link to the person, or must be kept for a set number of
years, that is a change to this one function (`accounts.services._erase_personal_data`).

## Data safety form: draft answers (check in the Console)

| Question | Draft answer |
|---|---|
| Collects personal info | Yes: **name**, **phone number**, **e-mail (optional)** |
| Collects financial info | The app records **purchase history** (package, amount, status). Card and wallet details are entered on the payment provider's page and never reach us |
| App activity | Yes: exam answers, marks, results (in-app actions) |
| Device or other IDs | Only the push notification token, and only if the student turns notifications on |
| Location, photos, files, contacts, calendar | No |
| Shared with third parties | Mobile number → SMS provider (verification codes); payment details → payment provider; push token → Expo. These are service providers acting for us; confirm how Google wants them counted |
| Sold to third parties | No |
| Encrypted in transit | Yes (HTTPS) |
| Users can ask for deletion | Yes: in the app, and at the URL above |
| Required or optional | Name and phone number are required for an account; e-mail and nickname are optional |

## Store listing: draft texts

**Category:** Education. **Contact e-mail and website:** the owner's.

- **Short description (EN):** Practice model tests, take live exams and see your merit position.
- **Short description (BN):** মডেল টেস্ট দিন, লাইভ পরীক্ষায় অংশ নিন, মেধা অবস্থান দেখুন।
- **Full description (EN):** Live Model Test helps you prepare for exams. Take timed model tests and live exams on your phone,
  see your marks as soon as results are published, review answers with explanations, and find your place on the merit
  list. Browse exams by category, follow the exam routine and syllabus, watch study videos and open PDF notes, and get a
  reminder before an exam starts. In Bangla and English.
- **Full description (BN):** লাইভ মডেল টেস্ট আপনার পরীক্ষার প্রস্তুতির সঙ্গী। ফোনে সময় ধরে মডেল টেস্ট ও লাইভ পরীক্ষা দিন,
  ফলাফল প্রকাশ হওয়ামাত্র নম্বর দেখুন, ব্যাখ্যাসহ উত্তর মিলিয়ে নিন এবং মেধা তালিকায় নিজের অবস্থান জানুন। ক্যাটাগরি
  অনুযায়ী পরীক্ষা বাছুন, রুটিন ও সিলেবাস দেখুন, স্টাডি ভিডিও ও PDF নোট পড়ুন, আর পরীক্ষা শুরুর আগে রিমাইন্ডার পান।
  বাংলা ও ইংরেজি দুই ভাষায়।

**Needed from the owner:** app icon 512×512 PNG, feature graphic 1024×500, at least two phone screenshots (take them
from the real phone after the next build), the content-rating questionnaire (answers: no violence, no user-generated
content shared between users, no ads), the target audience (students; if under 13 is included, Google's family policy
applies), and the account's identity, trader and phone checks.

## Before the first release

1. **Account:** identity verification, trader status, phone verification (the Console tells you). A personal account
   created recently may also need a **closed test** with a number of testers for a number of days before Production:
   the Console's Dashboard shows the exact rule.
2. **Build a bundle, not an APK:** `npx eas-cli@latest build --platform android --profile production` (the profile
   already produces an `.aab`). Upload it to Internal testing first.
3. **Signing:** let Google manage the app signing key (the Console's default). People who installed our APK have an app
   signed with a different key, so they must uninstall it once before installing from Play.
4. **Payments policy (important, not yet resolved):** Google says digital services sold inside an app generally have to
   use Google Play Billing. Our packages are paid with bKash and SSLCommerz. Read Google's *Payments* policy for
   Bangladesh before publishing; a safe alternative may be to leave in-app buying out of the Play version and sell
   packages on the website. This is the biggest rejection risk. See also `PAYMENT_METHODS.md` §8.
5. **Push:** if the Play build shows the "notifications" card, FCM must be set up first (`PUSH_NOTIFICATIONS.md`).
6. Fill the Data safety form from the table above, add the privacy and delete-account URLs, set the app's package
   name as it is (`com.livemodeltest.app`: it cannot be changed after the first upload).

## Store graphics (ready)

`docs/play-store/app-icon-512.png` (512×512) and `docs/play-store/feature-graphic-1024x500.png`, made from the
brand files in `docs/brand`. Phone screenshots are not included: take 4–6 from a real phone with the build
(Home, Exam, Result, Merit list), 16:9 or 9:16, at least 320 px on the short side.

## Order of work (Personal account)

1. Finish the Console's list (store listing, category and contact details).
2. Build the bundle: `npx eas-cli@latest build --platform android --profile production` (app version 0.2.1; the
   Android versionCode is raised by EAS itself).
3. Internal testing first (your own Gmail), then a **Closed test** release.
4. Closed test needs **12 testers opted in for 14 days** (the Dashboard shows the live count). Collect 15–20 Gmail
   addresses, create a tester list or Google Group, and send each person the opt-in link.
5. After 14 days: *Apply for production* and answer Google's questions about the test.

## Releasing an update (every new build)

1. `git pull origin develop`, then in `mobile`: `npx eas-cli@latest build --platform android --profile production`
   (EAS raises the Android versionCode by itself; the app version in `app.json` is what students see, now 0.2.2).
2. Download the `.aab` from the Expo build page.
3. Play Console → **Test and release → Testing → Closed testing → Alpha → Releases → Create new release** → upload the
   `.aab`, set the release name to the version, write release notes, **Next → Save and publish**.
   (Do the same on **Internal testing** if you also test there.)
4. Publishing overview → **Send changes for review** if it asks. Testers get the update through the Play Store by themselves.
5. For students on the APK (not Play): upload the new APK, then raise **Latest version** in Admin → Site settings.

