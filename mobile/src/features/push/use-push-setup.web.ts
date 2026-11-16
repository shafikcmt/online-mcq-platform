/** Browser preview of the app (`expo start --web`): there are no push notifications there, and the
 * native module is missing, so the signed-in area must not touch it. The Android app uses
 * `use-push-setup.ts`. */
export function usePushSetup(): void {}
