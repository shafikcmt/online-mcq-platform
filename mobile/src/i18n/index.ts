import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import bnAuth from "./locales/bn/auth.json";
import bnCommon from "./locales/bn/common.json";
import bnExams from "./locales/bn/exams.json";
import bnHome from "./locales/bn/home.json";
import bnNotifications from "./locales/bn/notifications.json";
import bnCategory from "./locales/bn/category.json";
import bnMaterials from "./locales/bn/materials.json";
import bnRoutine from "./locales/bn/routine.json";
import bnPackages from "./locales/bn/packages.json";
import bnProfile from "./locales/bn/profile.json";
import bnResults from "./locales/bn/results.json";
import bnRoom from "./locales/bn/room.json";
import bnUpdate from "./locales/bn/update.json";
import enAuth from "./locales/en/auth.json";
import enCommon from "./locales/en/common.json";
import enExams from "./locales/en/exams.json";
import enHome from "./locales/en/home.json";
import enNotifications from "./locales/en/notifications.json";
import enCategory from "./locales/en/category.json";
import enMaterials from "./locales/en/materials.json";
import enRoutine from "./locales/en/routine.json";
import enPackages from "./locales/en/packages.json";
import enProfile from "./locales/en/profile.json";
import enResults from "./locales/en/results.json";
import enRoom from "./locales/en/room.json";
import enUpdate from "./locales/en/update.json";

/** UI translations (docs/LOCALIZATION.md §7): one JSON file per feature namespace and
 * language; every key exists in both languages (tests/i18n.test.ts checks it). The UI
 * language is independent of exam content language. */
export const LANGUAGES = ["bn", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const resources = {
  bn: { common: bnCommon, auth: bnAuth, profile: bnProfile, home: bnHome, exams: bnExams, room: bnRoom, results: bnResults, packages: bnPackages, notifications: bnNotifications, update: bnUpdate, routine: bnRoutine, materials: bnMaterials, category: bnCategory },
  en: { common: enCommon, auth: enAuth, profile: enProfile, home: enHome, exams: enExams, room: enRoom, results: enResults, packages: enPackages, notifications: enNotifications, update: enUpdate, routine: enRoutine, materials: enMaterials, category: enCategory },
} as const;

const i18n = createInstance();
void i18n.use(initReactI18next).init({
  resources,
  lng: "bn",
  fallbackLng: "bn",
  ns: ["common", "auth", "profile", "home", "exams", "room", "results", "packages", "notifications", "update", "routine", "materials", "category"],
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
