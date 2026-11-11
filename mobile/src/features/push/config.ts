import Constants from "expo-constants";

/** The Expo project ID (not a secret) from the app's config; absent until the owner has set up Expo
 * (docs/PUSH_NOTIFICATIONS.md). Without it push is simply unavailable: nothing is asked or registered. */
export function projectId(): string {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? "";
}
