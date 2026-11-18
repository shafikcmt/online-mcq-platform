import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import type { Href } from "expo-router";
import { Platform } from "react-native";

import { api } from "@/api/client";

import { projectId } from "./config";

const PREF_KEY = "mcq.push.enabled";
const TOKEN_KEY = "mcq.push.token";
const PROMPT_KEY = "mcq.push.prompt_dismissed";
const CHANNEL = "default";
const IMPORTANCE_DEFAULT = 3; // Android NotificationManager.IMPORTANCE_DEFAULT (sound, no pop-up)

export const pushSupported = () => Platform.OS === "android" && projectId() !== "";

/** `unsupported` (no Expo project or not Android), `denied` (the phone's setting blocks it), `on` or `off`. */
export type PushState = "unsupported" | "denied" | "on" | "off";

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain === false) return "denied";
  const wanted = (await AsyncStorage.getItem(PREF_KEY)) === "1";
  return wanted && permission.granted ? "on" : "off";
}

async function currentToken(): Promise<string> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Live Model Test", importance: IMPORTANCE_DEFAULT });
  }
  return (await Notifications.getExpoPushTokenAsync({ projectId: projectId() })).data;
}

async function register(): Promise<void> {
  const token = await currentToken();
  const previous = await AsyncStorage.getItem(TOKEN_KEY);
  await api("/me/push-devices/", { method: "POST", body: { token } });
  // A changed token replaces the old one: drop it so this phone is not counted twice.
  if (previous && previous !== token) await api("/me/push-devices/", { method: "DELETE", body: { token: previous } }).catch(() => undefined);
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

/** The student turns notifications on: ask the phone's permission, register the token with the server. */
export async function enablePush(): Promise<"on" | "denied" | "unsupported" | "error"> {
  if (!pushSupported()) return "unsupported";
  try {
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return "denied";
    await register();
    await AsyncStorage.setItem(PREF_KEY, "1");
    return "on";
  } catch {
    return "error";
  }
}

/** The student turns notifications off (or signs out): remove this phone from the server. Best effort. */
export async function disablePush(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  await AsyncStorage.multiRemove([PREF_KEY, TOKEN_KEY]);
  if (token) await api("/me/push-devices/", { method: "DELETE", body: { token } }).catch(() => undefined);
}

/** The account is gone on the server (and its devices with it): only forget the settings kept on this phone. */
export async function forgetPush(): Promise<void> {
  await AsyncStorage.multiRemove([PREF_KEY, TOKEN_KEY]);
}

/** After sign-in: a phone that had notifications on registers again (the token can change). Never asks. */
export async function refreshPush(): Promise<void> {
  if (!pushSupported() || (await AsyncStorage.getItem(PREF_KEY)) !== "1") return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await register().catch(() => undefined);
}

export async function promptDismissed(): Promise<boolean> {
  return (await AsyncStorage.getItem(PROMPT_KEY)) === "1";
}

export async function dismissPrompt(): Promise<void> {
  await AsyncStorage.setItem(PROMPT_KEY, "1");
}

/** Where a tapped notification goes: its exam, or nowhere (the app just opens). Only an exam slug of
 * plain characters is accepted; the data comes from our server but is still checked. */
export function routeForNotification(data: unknown): Href | null {
  const slug = (data as { exam_slug?: unknown } | null)?.exam_slug;
  if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 140) return null;
  return { pathname: "/exam/[slug]", params: { slug } };
}
