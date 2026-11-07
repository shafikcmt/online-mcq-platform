import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Linking from "expo-linking";

import i18n from "@/i18n";
import { UpdatePrompt } from "@/features/update/update-prompt";

import { mockBackend } from "./helpers";

jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "0.1.0" } } }));

const APK = "https://files.example.org/live-model-test-0.2.0.apk";
const PLAY = "https://play.google.com/store/apps/details?id=com.livemodeltest.app";
const none = { latest_version: "", min_version: "", download_url: "", note: "", update_available: false, update_required: false };
const notice = (overrides = {}) => ({ latest_version: "0.2.0", min_version: "", download_url: APK, note: "Bug fixes.", update_available: true, update_required: false, ...overrides });
// Lets the launch check (a request and a storage read) finish before asserting "nothing shown".
const settle = () => waitFor(() => new Promise<void>((resolve) => setTimeout(resolve, 40)));
const answer = (body: unknown) => ({ "GET /public/app-update/": { status: 200, body } });

beforeEach(async () => {
  await AsyncStorage.clear();
  await i18n.changeLanguage("en");
  jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

test("an up-to-date app shows nothing, and tells the server which version it runs", async () => {
  const backend = mockBackend(answer(none));
  await render(<UpdatePrompt />);
  await waitFor(() => expect(backend.calls.find((c) => c.path === "/public/app-update/")).toBeTruthy());
  expect(backend.calls.find((c) => c.path === "/public/app-update/")?.query.version).toBe("0.1.0");
  expect(screen.queryByText("A new version is ready")).toBeNull();
});

test("a new version: title, version, note and install steps; Update now opens the link", async () => {
  mockBackend(answer(notice()));
  await render(<UpdatePrompt />);
  expect(await screen.findByText("A new version is ready")).toBeTruthy();
  expect(screen.getByText(/Live Model Test 0\.2\.0 is available/)).toBeTruthy();
  expect(screen.getByText("Bug fixes.")).toBeTruthy();
  expect(screen.getByText(/open it and tap Install/)).toBeTruthy();
  fireEvent.press(screen.getByText("Update now"));
  expect(Linking.openURL).toHaveBeenCalledWith(APK);
});

test("Later hides it and is remembered for that version only", async () => {
  mockBackend(answer(notice()));
  const first = await render(<UpdatePrompt />);
  fireEvent.press(await screen.findByText("Later"));
  await waitFor(() => expect(screen.queryByText("A new version is ready")).toBeNull());
  await waitFor(async () => expect(await AsyncStorage.getItem("mcq.update.dismissed")).toBe("0.2.0"));
  await first.unmount();

  await render(<UpdatePrompt />); // next launch, same version: quiet
  await settle();
  expect(screen.queryByText("A new version is ready")).toBeNull();

  mockBackend(answer(notice({ latest_version: "0.3.0" }))); // a newer version asks again
  await render(<UpdatePrompt />);
  expect(await screen.findByText(/0\.3\.0 is available/)).toBeTruthy();
});

test("a required update cannot be postponed", async () => {
  mockBackend(answer(notice({ update_required: true, min_version: "0.2.0" })));
  await render(<UpdatePrompt />);
  expect(await screen.findByText("Please update the app")).toBeTruthy();
  expect(screen.getByText(/too old to keep using/)).toBeTruthy();
  expect(screen.queryByText("Later")).toBeNull();
});

test("a required update ignores an earlier 'Later'", async () => {
  await AsyncStorage.setItem("mcq.update.dismissed", "0.2.0");
  mockBackend(answer(notice({ update_required: true })));
  await render(<UpdatePrompt />);
  expect(await screen.findByText("Please update the app")).toBeTruthy();
});

test("a Google Play link switches the wording to Play", async () => {
  mockBackend(answer(notice({ download_url: PLAY })));
  await render(<UpdatePrompt />);
  expect(await screen.findByText(/open Google Play, then tap Update/)).toBeTruthy();
  expect(screen.queryByText(/allow installing from this source/)).toBeNull();
  fireEvent.press(screen.getByText("Update now"));
  expect(Linking.openURL).toHaveBeenCalledWith(PLAY);
});

test("a link that is not https is never offered", async () => {
  mockBackend(answer(notice({ download_url: "http://files.example.org/app.apk" })));
  await render(<UpdatePrompt />);
  await settle();
  expect(screen.queryByText("A new version is ready")).toBeNull();
});

test("a failing server shows nothing and does not crash", async () => {
  mockBackend({ "GET /public/app-update/": "network" });
  await render(<UpdatePrompt />);
  await settle();
  expect(screen.queryByText("A new version is ready")).toBeNull();
});

test("in Bangla", async () => {
  await i18n.changeLanguage("bn");
  mockBackend(answer(notice({ note: "ত্রুটি সংশোধন।" })));
  await render(<UpdatePrompt />);
  expect(await screen.findByText("নতুন ভার্সন এসেছে")).toBeTruthy();
  expect(screen.getByText("এখনই আপডেট")).toBeTruthy();
});
