# Push notifications and exam reminders

Messages that reach a student's phone even when the app is closed: a message an admin writes, and automatic
exam reminders. Built on **Expo's push service**. **Switched off by default**: nothing is sent until the owner
creates the Expo project, configures push credentials and sets `PUSH_ENABLED=1` (steps below). Until then the
Admin Panel shows "Push is switched off" and saves messages in the history without sending them.

> Not verified: no real push has ever been sent (it needs your Expo project and a phone). All tests use a fake
> Expo. Follow "Owner steps" and test with one phone before announcing it.

## What it does

- **Registration:** after sign-in the app asks the student for permission and registers the phone's Expo push
  token (`POST /api/v1/me/push-devices/`). Turning notifications off, or signing out, removes it. Only the token
  is stored (no device name, no IP). A phone belongs to whoever signed in last.
- **Admin message:** Admin Panel → Site → **Push notifications** → write a title and text (Bangla, English or
  both; each phone gets its owner's language, falling back to the other), optionally choose an exam to open when
  tapped, confirm. It goes to every registered phone of an active student, in batches of 100, and cannot be recalled.
  The history shows the type, status and "118 of 120" delivered.
- **Automatic exam reminders:** a background job (every minute) sends "“Physics test” starts in 1 hour." for every
  published exam at the offsets in `EXAM_REMINDER_OFFSETS_MINUTES` (default `1440,60`: one day and one hour before).
  Each exam gets each reminder **once** (a database constraint), a reminder that was missed by more than 5 minutes
  is skipped, and an exam published later than the reminder time gets none for that offset.
- **Tap to open:** a message about an exam opens that exam in the app; a general message just opens the app.
- **Dead phones:** when Expo answers `DeviceNotRegistered` the device is switched off automatically.

## Owner steps (nothing here goes in chat or git)

1. Create (or open) the **Expo project** for the app and note its **project ID** (a UUID). Put it in
   `mobile/app.json` under `expo.extra.eas.projectId` (the ID is not a secret) — `eas init` does this.
2. **Android push credentials (FCM):** in the Firebase console create a project, register the Android app
   `com.livemodeltest.app`, download `google-services.json` (keep it out of git), and upload the FCM v1 service
   account key to Expo (`eas credentials`). Expo's guide: "Push notifications setup".
3. Build a new app with EAS (the notification module is part of the build; see `APP_SIZE.md`).
4. On the server, in `.env.prod`: `PUSH_ENABLED=1` (and `EXPO_ACCESS_TOKEN` only if you turned on "Enhanced push
   security" in the Expo dashboard). Restart the backend, the worker and **celery beat** (the reminder job).
5. Install the new app on a phone, sign in, allow notifications. In the panel the status should say "Phones
   registered: 1". Send a test message. Then create an exam starting in ~1 hour and check the reminder arrives.

## Developer notes

- Module `apps/notifications` (migration `0003`): `PushDevice` (unique token), `PushMessage` (manual and reminder,
  bilingual, optional exam, status and counts; unique `(exam, kind, reminder_offset)` for reminders).
- `push.py` is the only code that talks to Expo (`POST https://exp.host/--/api/v2/push/send`, ≤100 messages,
  https only, 15 s timeout, optional bearer token from the environment; tokens and secrets are never logged).
  `push_services.py`: register/unregister, create, `deliver` (idempotent claim `pending → sending`), reminders.
- Endpoints: `POST/DELETE /me/push-devices/` (throttle `push_device`), admin `GET /admin/push/` and
  `GET/POST /admin/push/messages/` (throttle `push_send`, 20/hour). Tasks: `send_push_message_task`,
  `send_exam_reminders_task` (beat `send-exam-reminders`).
- Tests: `backend/tests/test_push.py` (50), admin `push-view.test.tsx`, app `push.test.tsx`.
- Not built: delivery receipts (Expo's second step; tickets are recorded), per-student or per-category targeting,
  scheduled (future) admin messages, notification preferences per type, iOS (the app is Android only today).
