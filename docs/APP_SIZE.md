# Android app size (target 25–30 MB)

**Status: measured and prepared, not yet achieved.** The preview APK built by EAS is about **98 MB**.
Nothing can be built or measured as an APK in this development environment, so the numbers below are
split into *measured here* and *expected, to be confirmed by the owner's build*. No size is promised
until a build has been made and checked.

## Where the 98 MB comes from

Measured here with `expo export --platform android` (what ships inside every APK/AAB):

| Part | Size |
|---|---|
| JavaScript (Hermes bytecode bundle) | 5.4 MB |
| Fonts (Inter ×4 and Noto Sans Bengali ×4 weights, about 140–350 KB each) | about 2.8 MB |
| Images (icons, logo, splash) | about 1.3 MB (two launcher images are about 0.55–0.6 MB each) |
| All exported assets together | 13 MB (including copies at several resolutions) |

So the app's own code and assets are only **about 10–15 MB**. The rest of the 98 MB is **Android native
libraries (React Native, Hermes, Reanimated and the Expo modules) built four times**, once per processor type
(arm64-v8a, armeabi-v7a, x86, x86_64) in the "universal" APK that the `preview` profile produces. A phone
uses exactly one of those four copies.

## What is prepared (opt-in, nothing existing changes)

A new EAS profile, **`preview-small`** (`mobile/eas.json`), builds an APK with `SMALL_BUILD=1`.
`mobile/app.config.js` then adds the official `expo-build-properties` plugin with:

- `buildArchs: ["arm64-v8a"]`: only 64-bit ARM, which practically every Android phone sold in the last
  several years uses. This is the biggest lever (the universal APK carries four copies).
- `enableMinifyInReleaseBuilds` (R8) and `enableShrinkResourcesInReleaseBuilds`: smaller Java/Kotlin code and no
  unused resources.

The existing `preview` and `production` profiles are **unchanged**.
`expo config` was checked to resolve both ways (without and with `SMALL_BUILD=1`).

## Expected result (an estimate, to be confirmed)

One ABI instead of four should bring the APK to roughly a third of its size, plausibly in the **30–40 MB**
range; R8 and resource shrinking may take a few more MB off. Reaching **25–30 MB** may need the extra steps
below. Only a real build shows the truth.

## Owner steps

1. Run `eas build --platform android --profile preview-small` (it needs your Expo login; nothing is shared in
   chat) and note the APK size in the EAS dashboard.
2. Install it on a real **arm64** phone and use the app end to end (sign in, exam, results, payments page, PDFs,
   videos). R8 can, rarely, remove code that is needed at run time; if anything misbehaves, tell me what and the
   rule can be added (`extraProguardRules`).
3. If the size is acceptable and it works, use the same settings for the Google Play build: Play delivers only the
   phone's own processor type and language from an **AAB** (`--profile production`), so the download is already
   about the size of one ABI. To apply the small settings to production, add `SMALL_BUILD=1` to its `env`.

## If it is still above 30 MB (not done yet, each needs a decision)

- Fewer font weights (for example drop the Medium weights): about 1.4 MB, slight visual change.
- Replace the two large launcher images with a plain colour (the adaptive icon already has
  `backgroundColor`): about 1.1 MB, needs a visual check.
- Remove unused libraries after an import audit (none found obviously unused; each removal needs testing).
- Anything that is content (videos, PDFs, images of exams) already comes from the server, not the app.
- 32-bit-only phones (rare) would not be served by an arm64-only APK; Google Play's AAB serves them.
