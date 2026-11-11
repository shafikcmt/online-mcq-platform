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

jest.mock("expo-keep-awake", () => ({ useKeepAwake: jest.fn() }));

jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn(async () => ({ type: "dismiss" })) }));

// Push notifications: no phone, no Expo. Tests set what the phone answers through __state.
const mockPush = {
  permission: { granted: false, canAskAgain: true },
  token: "ExponentPushToken[abcdefghijklmnopqrst]",
  lastResponse: null as unknown,
};
jest.mock("expo-notifications", () => ({
  __state: mockPush,
  AndroidImportance: { DEFAULT: 3 },
  DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ ...mockPush.permission })),
  requestPermissionsAsync: jest.fn(async () => {
    mockPush.permission = { granted: true, canAskAgain: true };
    return { ...mockPush.permission };
  }),
  getExpoPushTokenAsync: jest.fn(async () => ({ type: "expo", data: mockPush.token })),
  useLastNotificationResponse: jest.fn(() => mockPush.lastResponse),
}));
