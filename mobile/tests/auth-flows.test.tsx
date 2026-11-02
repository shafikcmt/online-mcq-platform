import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, userEvent } from "@testing-library/react-native";

import { apiError, mockBackend, renderApp, resetDevice, secureStore, STUDENT } from "./helpers";

jest.setTimeout(20_000);

const TOKENS = { access: "A1", refresh: "R1" };

describe("first launch", () => {
  test("asks for the language, remembers it, then shows sign-in in that language", async () => {
    await resetDevice();
    mockBackend({});
    const user = userEvent.setup();
    await renderApp();
    expect(await screen.findByText("আপনার ভাষা বেছে নিন")).toBeOnTheScreen();
    await user.press(screen.getByRole("radio", { name: "English" }));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeOnTheScreen();
    expect(screen.getByText("Welcome back! Sign in with your mobile number and password.")).toBeOnTheScreen();
    expect(await AsyncStorage.getItem("mcq.language")).toBe("en");
  });

  test("a chosen language skips the question and Bangla is used", async () => {
    await resetDevice({ language: "bn" });
    mockBackend({});
    await renderApp();
    expect(await screen.findByRole("button", { name: "সাইন ইন করুন" })).toBeOnTheScreen();
    expect(screen.queryByText("আপনার ভাষা বেছে নিন")).not.toBeOnTheScreen();
  });
});

describe("sign in", () => {
  test("validates locally, normalizes the number (Bangla digits too), signs in and lands on Home", async () => {
    await resetDevice({ language: "en" });
    const backend = mockBackend({ "POST /auth/login/": { status: 200, body: { user: STUDENT, ...TOKENS } } });
    const user = userEvent.setup();
    await renderApp();
    await user.press(await screen.findByRole("button", { name: "Sign in" }));
    expect(screen.getAllByText("This field is required.")).toHaveLength(2);
    await user.type(screen.getByLabelText("Mobile number"), "12345");
    await user.press(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter a valid Bangladeshi mobile number, e.g. 01712345678.")).toBeOnTheScreen();
    expect(backend.calls).toHaveLength(0);

    await user.clear(screen.getByLabelText("Mobile number"));
    await user.type(screen.getByLabelText("Mobile number"), "০১৭১২৩৪৫৬৭৮");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.press(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Rahim")).toBeOnTheScreen();
    expect(backend.find("POST", "/auth/login/")[0].body).toEqual({ mobile_number: "+8801712345678", password: "correct horse" });
    expect(secureStore.get("mcq.refresh_token")).toBe("R1");
  });

  test("shows the server's one generic message and clears the password", async () => {
    await resetDevice({ language: "en" });
    mockBackend({ "POST /auth/login/": apiError(401, "invalid_credentials", "Mobile number or password is incorrect.") });
    const user = userEvent.setup();
    await renderApp();
    await user.type(await screen.findByLabelText("Mobile number"), "01712345678");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.press(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Mobile number or password is incorrect.")).toBeOnTheScreen();
    expect(screen.getByLabelText("Password")).toHaveDisplayValue("");
    expect(secureStore.has("mcq.refresh_token")).toBe(false);
  });

  test("adopts the account's language at sign-in", async () => {
    await resetDevice({ language: "en" });
    mockBackend({ "POST /auth/login/": { status: 200, body: { user: { ...STUDENT, preferred_language: "bn" }, ...TOKENS } } });
    const user = userEvent.setup();
    await renderApp();
    await user.type(await screen.findByLabelText("Mobile number"), "01712345678");
    await user.type(screen.getByLabelText("Password"), "pw");
    await user.press(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Rahim")).toBeOnTheScreen();
    expect(await AsyncStorage.getItem("mcq.language")).toBe("bn");
  });

  test("offline at sign-in → a friendly message, no technical text", async () => {
    await resetDevice({ language: "en" });
    mockBackend({ "POST /auth/login/": "network" });
    const user = userEvent.setup();
    await renderApp();
    await user.type(await screen.findByLabelText("Mobile number"), "01712345678");
    await user.type(screen.getByLabelText("Password"), "pw");
    await user.press(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("No internet connection. Check your connection and try again.")).toBeOnTheScreen();
  });
});

describe("start-up with a stored session", () => {
  test("refreshes, loads the profile and opens Home; the phone's language is synced to the account", async () => {
    await resetDevice({ language: "bn", refresh: "R0" });
    const backend = mockBackend({
      "POST /auth/token/refresh/": { status: 200, body: TOKENS },
      "GET /me/": { status: 200, body: STUDENT },
      "PATCH /me/": (call) => ({ status: 200, body: { ...STUDENT, ...(call.body as object) } }),
    });
    await renderApp();
    expect(await screen.findByText("Rahim")).toBeOnTheScreen();
    expect(backend.find("POST", "/auth/token/refresh/")[0].body).toEqual({ refresh: "R0" });
    expect(backend.find("PATCH", "/me/")[0].body).toEqual({ preferred_language: "bn" });
    expect(secureStore.get("mcq.refresh_token")).toBe("R1");
  });

  test("an expired session goes to sign-in", async () => {
    await resetDevice({ language: "en", refresh: "R0" });
    mockBackend({ "POST /auth/token/refresh/": apiError(401, "token_not_valid", "") });
    await renderApp();
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeOnTheScreen();
    expect(secureStore.has("mcq.refresh_token")).toBe(false);
  });

  test("no internet → offline screen keeps the session; Try again recovers", async () => {
    await resetDevice({ language: "en", refresh: "R0" });
    mockBackend({
      "POST /auth/token/refresh/": ["network", { status: 200, body: TOKENS }],
      "GET /me/": { status: 200, body: STUDENT },
    });
    const user = userEvent.setup();
    await renderApp();
    expect(await screen.findByText("Can't reach the server")).toBeOnTheScreen();
    expect(secureStore.get("mcq.refresh_token")).toBe("R0");
    await user.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Rahim")).toBeOnTheScreen();
  });
});

describe("registration", () => {
  test("number → SMS code → details → signed in; sends the chosen language", async () => {
    await resetDevice({ language: "en" });
    const backend = mockBackend({
      "POST /auth/otp/request/": { status: 202, body: { detail: "sent" } },
      "POST /auth/otp/verify/": [apiError(400, "otp_invalid", "The code is incorrect.", { details: { attempts_remaining: 4 } }), { status: 200, body: { verification_token: "VT", expires_at: "2026-10-26T10:00:00Z" } }],
      "POST /auth/register/": { status: 201, body: { user: { ...STUDENT, full_name: "Nusrat Jahan" }, ...TOKENS } },
    });
    const user = userEvent.setup();
    await renderApp("/register");
    expect(await screen.findByText("Step 1 of 3")).toBeOnTheScreen();
    await user.type(screen.getByLabelText("Mobile number"), "01812345678");
    await user.press(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText("We sent a 6-digit code by SMS to 01812 345678.")).toBeOnTheScreen();
    expect(backend.find("POST", "/auth/otp/request/")[0].body).toEqual({ mobile_number: "+8801812345678", purpose: "registration", language: "en" });
    expect(screen.getByRole("button", { name: /Resend code in/ })).toBeDisabled();

    await user.type(screen.getByLabelText("6-digit verification code"), "111111");
    expect(await screen.findByText("The code is incorrect. 4 attempts left.")).toBeOnTheScreen();
    await user.type(screen.getByLabelText("6-digit verification code"), "১২৩৪৫৬");
    expect(await screen.findByText("Your details")).toBeOnTheScreen();
    expect(backend.find("POST", "/auth/otp/verify/")[1].body).toEqual({ mobile_number: "+8801812345678", purpose: "registration", code: "123456" });

    await user.type(screen.getByLabelText("Full name"), "Nusrat Jahan");
    await user.type(screen.getByLabelText("Password"), "a-strong-pass-77");
    await user.type(screen.getByLabelText("Confirm password"), "different");
    await user.press(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("The passwords do not match.")).toBeOnTheScreen();
    expect(backend.find("POST", "/auth/register/")).toHaveLength(0);

    await user.clear(screen.getByLabelText("Confirm password"));
    await user.type(screen.getByLabelText("Confirm password"), "a-strong-pass-77");
    await user.press(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Nusrat")).toBeOnTheScreen();
    expect(backend.find("POST", "/auth/register/")[0].body).toEqual({
      verification_token: "VT",
      mobile_number: "+8801812345678",
      full_name: "Nusrat Jahan",
      password: "a-strong-pass-77",
      preferred_language: "en",
    });
  });

  test("server password rules show under the field; an existing account offers sign-in; an expired verification restarts", async () => {
    await resetDevice({ language: "en" });
    mockBackend({
      "POST /auth/otp/request/": { status: 202, body: { detail: "sent" } },
      "POST /auth/otp/verify/": { status: 200, body: { verification_token: "VT", expires_at: "x" } },
      "POST /auth/register/": [
        apiError(400, "validation_error", "Invalid input.", { field_errors: { password: ["This password is too common."] } }),
        apiError(409, "account_exists", "An account with this mobile number already exists."),
        apiError(400, "verification_token_invalid", "Your verification has expired or is invalid. Please verify again."),
      ],
    });
    const user = userEvent.setup();
    await renderApp("/register");
    await user.type(await screen.findByLabelText("Mobile number"), "01812345678");
    await user.press(screen.getByRole("button", { name: "Send code" }));
    await user.type(await screen.findByLabelText("6-digit verification code"), "123456");
    await user.type(await screen.findByLabelText("Full name"), "Nusrat");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.type(screen.getByLabelText("Confirm password"), "password");
    await user.press(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("This password is too common.")).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("An account with this mobile number already exists.")).toBeOnTheScreen();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Your verification has expired. Please verify your number again.")).toBeOnTheScreen();
    expect(screen.getByText("Step 1 of 3")).toBeOnTheScreen();
  });
});

describe("forgot password", () => {
  test("number → code → new password → sign-in says it worked", async () => {
    await resetDevice({ language: "en" });
    const backend = mockBackend({
      "POST /auth/otp/request/": { status: 202, body: { detail: "If the details are valid…" } },
      "POST /auth/otp/verify/": { status: 200, body: { verification_token: "RT", expires_at: "x" } },
      "POST /auth/password/reset/": { status: 204 },
    });
    const user = userEvent.setup();
    await renderApp("/forgot-password");
    await user.type(await screen.findByLabelText("Mobile number"), "01912345678");
    await user.press(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText("If 01912 345678 is registered, we sent a 6-digit code to it by SMS.")).toBeOnTheScreen();
    await user.type(screen.getByLabelText("6-digit verification code"), "654321");
    await user.type(await screen.findByLabelText("New password"), "brand-new-pass-1");
    await user.type(screen.getByLabelText("Confirm password"), "brand-new-pass-1");
    await user.press(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByText("Password changed. Sign in with your new password.")).toBeOnTheScreen();
    expect(backend.find("POST", "/auth/otp/request/")[0].body).toMatchObject({ purpose: "password_reset" });
    expect(backend.find("POST", "/auth/password/reset/")[0].body).toEqual({
      verification_token: "RT",
      mobile_number: "+8801912345678",
      new_password: "brand-new-pass-1",
    });
  });

  test("resend unlocks after the countdown; a refusal shows the server's wait time", async () => {
    await resetDevice({ language: "en" });
    const backend = mockBackend({
      "POST /auth/otp/request/": [{ status: 202, body: { detail: "ok" } }, apiError(429, "otp_rate_limited", "Too many code requests. Please try again later.", { details: { retry_after: 3600 } })],
    });
    const user = userEvent.setup();
    await renderApp("/forgot-password");
    await user.type(await screen.findByLabelText("Mobile number"), "01912345678");
    await user.press(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText("6-digit verification code");
    expect(screen.getByRole("button", { name: "Resend code in 60s" })).toBeDisabled();
    // renderRouter runs on Jest fake timers: move the clock through the 60 s countdown.
    for (let i = 0; i < 60; i += 1) await act(async () => jest.advanceTimersByTime(1000));
    await fireEvent.press(screen.getByRole("button", { name: "Resend code" }));
    expect(await screen.findByText("Too many code requests. Please try again later.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Resend code in 3600s" })).toBeDisabled();
    expect(backend.find("POST", "/auth/otp/request/")).toHaveLength(2);
  });
});
