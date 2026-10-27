import AsyncStorage from "@react-native-async-storage/async-storage";
import { screen, userEvent } from "@testing-library/react-native";

import { apiError, mockBackend, renderApp, resetDevice, secureStore, STUDENT } from "./helpers";

jest.setTimeout(20_000);

/** Start signed in (stored refresh token → refresh → /me) and open Profile. */
async function openProfile(routes: Parameters<typeof mockBackend>[0] = {}, language: "bn" | "en" = "en") {
  const editLabel = language === "bn" ? "প্রোফাইল সম্পাদনা" : "Edit profile";
  await resetDevice({ language, refresh: "R0" });
  const backend = mockBackend({
    "POST /auth/token/refresh/": { status: 200, body: { access: "A1", refresh: "R1" } },
    "GET /me/": { status: 200, body: { ...STUDENT, preferred_language: language } },
    ...routes,
  });
  const user = userEvent.setup();
  await renderApp("/profile");
  await screen.findByRole("button", { name: editLabel });
  return { backend, user };
}

test("shows the student's own details, verified badge and join date", async () => {
  await openProfile();
  expect(screen.getByText("Rahim Uddin")).toBeOnTheScreen();
  expect(screen.getByText("01712 345678")).toBeOnTheScreen();
  expect(screen.getByText("Verified")).toBeOnTheScreen();
  expect(screen.getByText("Email: Not added")).toBeOnTheScreen();
  expect(screen.getByText(/Member since 1 October 2026/)).toBeOnTheScreen();
});

test("Bangla UI shows the phone number in Bangla digits", async () => {
  await openProfile({}, "bn");
  expect(screen.getByText("০১৭১২ ৩৪৫৬৭৮")).toBeOnTheScreen();
  expect(screen.getByText("যাচাইকৃত")).toBeOnTheScreen();
});

test("switching language is instant, remembered on the phone and saved to the account", async () => {
  const { backend, user } = await openProfile({
    "PATCH /me/": (call) => ({ status: 200, body: { ...STUDENT, ...(call.body as object) } }),
  });
  await user.press(screen.getByRole("radio", { name: "বাংলা" }));
  expect(await screen.findByRole("heading", { name: "প্রোফাইল" })).toBeOnTheScreen();
  expect(backend.find("PATCH", "/me/").at(-1)?.body).toEqual({ preferred_language: "bn" });
  expect(await AsyncStorage.getItem("mcq.language")).toBe("bn");
});

test("a language change that cannot reach the server still applies on the phone", async () => {
  const { user } = await openProfile({ "PATCH /me/": "network" });
  await user.press(screen.getByRole("radio", { name: "বাংলা" }));
  expect(await screen.findByText("এই ফোনে ভাষা বদলানো হয়েছে। পরের বার আপনার অ্যাকাউন্টেও সংরক্ষণ হবে।")).toBeOnTheScreen();
  expect(await AsyncStorage.getItem("mcq.language")).toBe("bn");
});

test("edit profile sends only the changed fields; server field errors show under the field", async () => {
  const { backend, user } = await openProfile({
    "PATCH /me/": [
      apiError(400, "validation_error", "Invalid input.", { field_errors: { email: ["Enter a valid email address."] } }),
      (call) => ({ status: 200, body: { ...STUDENT, ...(call.body as object) } }),
    ],
  });
  await user.press(screen.getByRole("button", { name: "Edit profile" }));
  await user.type(await screen.findByLabelText("Email"), "bad@");
  await user.press(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Enter a valid email address.")).toBeOnTheScreen();
  await user.clear(screen.getByLabelText("Email"));
  await user.type(screen.getByLabelText("Email"), "rahim@example.org");
  await user.type(screen.getByLabelText("Leaderboard name"), "Rahim U");
  await user.press(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Profile saved.")).toBeOnTheScreen();
  expect(backend.find("PATCH", "/me/").at(-1)?.body).toEqual({ email: "rahim@example.org", display_name: "Rahim U" });
  expect(await screen.findByText("Email: rahim@example.org")).toBeOnTheScreen();
});

test("change password: wrong current password stays; success signs out with a message", async () => {
  const { backend, user } = await openProfile({
    "POST /auth/password/change/": [
      apiError(400, "invalid_current_password", "Your current password is incorrect.", { field_errors: { current_password: ["Your current password is incorrect."] } }),
      { status: 204 },
    ],
  });
  await user.press(screen.getByRole("button", { name: "Change password" }));
  await user.type(await screen.findByLabelText("Current password"), "nope");
  await user.type(screen.getByLabelText("New password"), "next-pass-2026");
  await user.type(screen.getByLabelText("Confirm password"), "next-pass-2026");
  await user.press(screen.getAllByRole("button", { name: "Change password" }).at(-1)!);
  expect(await screen.findByText("Your current password is incorrect.")).toBeOnTheScreen();
  expect(secureStore.get("mcq.refresh_token")).toBe("R1");
  await user.press(screen.getAllByRole("button", { name: "Change password" }).at(-1)!);
  expect(await screen.findByText("Password changed. Please sign in with your new password.")).toBeOnTheScreen();
  expect(backend.find("POST", "/auth/password/change/").at(-1)?.body).toEqual({ current_password: "nope", new_password: "next-pass-2026" });
  expect(secureStore.has("mcq.refresh_token")).toBe(false);
});

test("sign out asks first, revokes the refresh token on the server and forgets it", async () => {
  const { backend, user } = await openProfile({ "POST /auth/logout/": { status: 204 } });
  await user.press(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByText("Sign out?")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Cancel" }));
  expect(backend.find("POST", "/auth/logout/")).toHaveLength(0);
  await user.press(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByText("Sign out?");
  await user.press(screen.getAllByRole("button", { name: "Sign out" }).at(-1)!);
  expect(await screen.findByRole("button", { name: "Sign in" })).toBeOnTheScreen();
  const logout = backend.find("POST", "/auth/logout/")[0];
  expect(logout.body).toEqual({ refresh: "R1" });
  expect(logout.headers.Authorization).toBe("Bearer A1");
  expect(secureStore.has("mcq.refresh_token")).toBe(false);
});

test("sign out still works offline (tokens removed from the phone)", async () => {
  const { user } = await openProfile({ "POST /auth/logout/": "network" });
  await user.press(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByText("Sign out?");
  await user.press(screen.getAllByRole("button", { name: "Sign out" }).at(-1)!);
  expect(await screen.findByRole("button", { name: "Sign in" })).toBeOnTheScreen();
  expect(secureStore.has("mcq.refresh_token")).toBe(false);
});

test("signed-in screens cannot be opened without a session", async () => {
  await resetDevice({ language: "en" });
  mockBackend({});
  await renderApp("/profile");
  expect(await screen.findByRole("button", { name: "Sign in" })).toBeOnTheScreen();
  expect(screen.queryByText("Rahim Uddin")).not.toBeOnTheScreen();
});
