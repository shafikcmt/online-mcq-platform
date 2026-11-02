import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/** Where the tokens live (docs/SECURITY_PLAN.md §2):
 * - the ACCESS token only in memory (lost when the app closes; 15-minute lifetime);
 * - the REFRESH token in `expo-secure-store` (Android Keystore-backed), never AsyncStorage.
 * On the web build (used only for local QA in a browser) there is no secure store, so the
 * refresh token is kept in memory too: a reload signs out. Nothing goes to localStorage. */
const REFRESH_KEY = "mcq.refresh_token";

let accessToken: string | null = null;
let webRefreshToken: string | null = null;
const useSecureStore = Platform.OS !== "web";

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export async function getRefreshToken(): Promise<string | null> {
  if (!useSecureStore) return webRefreshToken;
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function setRefreshToken(token: string | null): Promise<void> {
  if (!useSecureStore) {
    webRefreshToken = token;
    return;
  }
  if (token) await SecureStore.setItemAsync(REFRESH_KEY, token);
  else await SecureStore.deleteItemAsync(REFRESH_KEY);
}

/** Save a new pair: the refresh token first, so a crash in between never leaves a
 * rotated-away (already blacklisted) refresh token as the only one stored. */
export async function saveTokens(pair: { access: string; refresh: string }): Promise<void> {
  await setRefreshToken(pair.refresh);
  accessToken = pair.access;
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  await setRefreshToken(null);
}
