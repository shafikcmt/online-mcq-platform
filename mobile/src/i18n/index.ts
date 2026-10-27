import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import bnAuth from "./locales/bn/auth.json";
import bnCommon from "./locales/bn/common.json";
import bnExams from "./locales/bn/exams.json";
import bnHome from "./locales/bn/home.json";
import bnProfile from "./locales/bn/profile.json";
import bnRoom from "./locales/bn/room.json";
import enAuth from "./locales/en/auth.json";
import enCommon from "./locales/en/common.json";
import enExams from "./locales/en/exams.json";
import enHome from "./locales/en/home.json";
import enProfile from "./locales/en/profile.json";
import enRoom from "./locales/en/room.json";

/** UI translations (docs/LOCALIZATION.md §7): one JSON file per feature namespace and
 * language; every key exists in both languages (tests/i18n.test.ts checks it). The UI
 * language is independent of exam content language. */
export const LANGUAGES = ["bn", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const resources = {
  bn: { common: bnCommon, auth: bnAuth, profile: bnProfile, home: bnHome, exams: bnExams, room: bnRoom },
  en: { common: enCommon, auth: enAuth, profile: enProfile, home: enHome, exams: enExams, room: enRoom },
} as const;

const i18n = createInstance();
void i18n.use(initReactI18next).init({
  resources,
  lng: "bn",
  fallbackLng: "bn",
  ns: ["common", "auth", "profile", "home", "exams", "room"],
  defaultNS: "common",
  interpolation: { escapeValue: false }, // React escapes; no HTML is ever rendered
  returnNull: false,
});

export default i18n;

const STORAGE_KEY = "mcq.language";

export function isLanguage(value: unknown): value is Language {
  return value === "bn" || value === "en";
}

/** The language picked on this phone, or null before the first choice. The choice is a
 * preference, not a secret, so AsyncStorage is fine here (tokens never go there). */
export async function loadStoredLanguage(): Promise<Language | null> {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

export async function storeLanguage(language: Language): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Not fatal: the app asks again on the next launch.
  }
}

/** The phone's language when it is Bangla or English, else Bangla (platform default). */
export function deviceLanguage(): Language {
  const code = getLocales()[0]?.languageCode;
  return isLanguage(code) ? code : "bn";
}
