/* Test doubles for native modules (there is no phone in Jest). */
import mockAsyncStorage from "@react-native-async-storage/async-storage/jest/async-storage-mock";

jest.mock("@react-native-async-storage/async-storage", () => mockAsyncStorage);

// In-memory SecureStore; tests read it to check where tokens went.
const mockSecureStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  __store: mockSecureStore,
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));

jest.mock("expo-localization", () => ({
  getLocales: () => [{ languageCode: "bn", languageTag: "bn-BD" }],
}));

jest.mock("expo-splash-screen", () => ({ preventAutoHideAsync: jest.fn(async () => true), hideAsync: jest.fn(async () => true) }));
