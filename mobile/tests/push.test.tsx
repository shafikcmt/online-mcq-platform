import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, userEvent, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { projectId } from "@/features/push/config";
import { disablePush, enablePush, pushState, refreshPush, routeForNotification } from "@/features/push/push";

import { mockBackend, renderApp, resetDevice, STUDENT } from "./helpers";

jest.setTimeout(20_000);
jest.mock("@/features/push/config", () => ({ projectId: jest.fn() }));

type PushMock = { permission: { granted: boolean; canAskAgain: boolean }; token: string; lastResponse: unknown };
const phone = (Notifications as unknown as { __state: PushMock }).__state;
const TOKEN = "ExponentPushToken[abcdefghijklmnopqrst]";
const DEVICES = "/me/push-devices/";
const okDevices = { [`POST ${DEVICES}`]: { status: 200, body: { registered: true } }, [`DELETE ${DEVICES}`]: { status: 200, body: { registered: false } } };

const realOS = Platform.OS;
function withExpoProject(on: boolean) {
  (projectId as jest.Mock).mockReturnValue(on ? "00000000-0000-4000-8000-000000000000" : "");
}

beforeEach(async () => {
  jest.clearAllMocks();
  phone.permission = { granted: false, canAskAgain: true };
  phone.token = TOKEN;
  phone.lastResponse = null;
  (Platform as { OS: string }).OS = "android";
  withExpoProject(true);
  await AsyncStorage.clear();
});
afterEach(() => {
  (Platform as { OS: string }).OS = realOS;
});

describe("push state", () => {
  test("unsupported without an Expo project or off Android", async () => {
    withExpoProject(false);
    expect(await pushState()).toBe("unsupported");
    withExpoProject(true);
    (Platform as { OS: string }).OS = "ios";
    expect(await pushState()).toBe("unsupported");
  });

  test("off until turned on; denied when the phone blocks it", async () => {
    expect(await pushState()).toBe("off");
    phone.permission = { granted: false, canAskAgain: false };
    expect(await pushState()).toBe("denied");
  });
});

describe("turning notifications on and off", () => {
  test("asks permission, registers the token with the server and remembers it", async () => {
    const backend = mockBackend(okDevices);
    await resetDevice({ language: "en", refresh: "R0" });
    expect(await enablePush()).toBe("on");
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(backend.find("POST", DEVICES)[0].body).toEqual({ token: TOKEN });
    expect(await pushState()).toBe("on");
  });

  test("a refused permission registers nothing", async () => {
    const backend = mockBackend(okDevices);
    (Notifications.requestPermissionsAsync as jest.Mock).mockImplementationOnce(async () => {
      phone.permission = { granted: false, canAskAgain: false }; // what the phone remembers after a refusal
      return phone.permission;
    });
    expect(await enablePush()).toBe("denied");
    expect(backend.find("POST", DEVICES)).toHaveLength(0);
    expect(await pushState()).toBe("denied");
  });

  test("a failed registration reports an error and stays off", async () => {
    mockBackend({ [`POST ${DEVICES}`]: "network" });
    expect(await enablePush()).toBe("error");
    expect(await pushState()).toBe("off");
  });

  test("turning off removes this phone from the server", async () => {
    const backend = mockBackend(okDevices);
    await enablePush();
    await disablePush();
    expect(backend.find("DELETE", DEVICES)[0].body).toEqual({ token: TOKEN });
    expect(await pushState()).toBe("off");
  });

  test("turning off with the server unreachable still turns it off on the phone", async () => {
    mockBackend({ [`POST ${DEVICES}`]: { status: 200, body: {} }, [`DELETE ${DEVICES}`]: "network" });
    await enablePush();
    await expect(disablePush()).resolves.toBeUndefined();
    expect(await pushState()).toBe("off");
  });

  test("after sign-in a phone that had it on registers again, a changed token replaces the old one, and it never asks", async () => {
    const backend = mockBackend(okDevices);
    await enablePush();
    backend.calls.length = 0;
    phone.token = "ExponentPushToken[zzzzzzzzzzzzzzzzzzzz]";
    await refreshPush();
    expect(backend.find("POST", DEVICES)[0].body).toEqual({ token: phone.token });
    expect(backend.find("DELETE", DEVICES)[0].body).toEqual({ token: TOKEN });
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1); // only the first enable asked
  });

  test("a phone that never turned it on is left alone after sign-in", async () => {
    const backend = mockBackend(okDevices);
    await refreshPush();
    expect(backend.calls).toHaveLength(0);
  });
});

describe("tapping a notification", () => {
  test("only a plain exam slug is followed", () => {
    expect(routeForNotification({ type: "exam", exam_slug: "physics-1" })).toEqual({ pathname: "/exam/[slug]", params: { slug: "physics-1" } });
    for (const bad of [null, undefined, {}, { exam_slug: "" }, { exam_slug: "../admin" }, { exam_slug: "A B" }, { exam_slug: 5 }, { exam_slug: "x".repeat(141) }, { type: "notice" }]) {
      expect(routeForNotification(bad)).toBeNull();
    }
  });

  test("a tap that started the app opens the exam", async () => {
    mockBackend({ "GET /exams/physics-1/": { status: 404, body: { error: { code: "not_found", message: "x" } } } });
    await resetDevice({ language: "en", refresh: "R0" });
    phone.lastResponse = {
      actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
      notification: { request: { identifier: "n1", content: { data: { type: "exam", exam_slug: "physics-1" } } } },
    };
    mockBackend({
      "POST /auth/token/refresh/": { status: 200, body: { access: "A1", refresh: "R1" } },
      "GET /me/": { status: 200, body: STUDENT },
      "GET /exams/physics-1/": { status: 404, body: { error: { code: "not_found", message: "x" } } },
    });
    await renderApp("/home");
    await waitFor(() => expect(screen).toHavePathname("/exam/physics-1"));
  });
});

describe("the screens", () => {
  async function signedIn() {
    await resetDevice({ language: "en", refresh: "R0" });
    return mockBackend({
      "POST /auth/token/refresh/": { status: 200, body: { access: "A1", refresh: "R1" } },
      "GET /me/": { status: 200, body: STUDENT },
      ...okDevices,
    });
  }

  test("Home offers notifications once; Not now hides it for good", async () => {
    await signedIn();
    await renderApp("/home");
    expect(await screen.findByText("Never miss an exam")).toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByText("Never miss an exam")).toBeNull());
    expect(await AsyncStorage.getItem("mcq.push.prompt_dismissed")).toBe("1");
  });

  test("Home offers nothing when push cannot work (no Expo project)", async () => {
    withExpoProject(false);
    await signedIn();
    await renderApp("/home");
    await screen.findByRole("heading", { name: "Quick access" });
    expect(screen.queryByText("Never miss an exam")).toBeNull();
  });

  test("Turn on from Home registers the phone", async () => {
    const backend = await signedIn();
    await renderApp("/home");
    await userEvent.setup().press(await screen.findByRole("button", { name: "Turn on notifications" }));
    await waitFor(() => expect(backend.find("POST", DEVICES)).toHaveLength(1));
  });

  test("Profile has a switch that turns notifications on and off", async () => {
    const backend = await signedIn();
    await renderApp("/profile");
    const toggle = await screen.findByLabelText("Exam reminders and notices");
    await fireEvent(toggle, "valueChange", true);
    await waitFor(() => expect(backend.find("POST", DEVICES)).toHaveLength(1));
    await waitFor(() => expect(phone.permission.granted).toBe(true)); // the phone was asked and allowed
    await fireEvent(screen.getByLabelText("Exam reminders and notices"), "valueChange", false);
    await waitFor(() => expect(backend.find("DELETE", DEVICES)).toHaveLength(1));
  });

  test("a blocked permission says where to change it", async () => {
    phone.permission = { granted: false, canAskAgain: false };
    await signedIn();
    await renderApp("/profile");
    expect(await screen.findByText(/blocked for this app/)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Open phone settings" })).toBeOnTheScreen();
  });

  test("Profile shows no switch without an Expo project", async () => {
    withExpoProject(false);
    await signedIn();
    await renderApp("/profile");
    await screen.findByText("Settings");
    expect(screen.queryByLabelText("Exam reminders and notices")).toBeNull();
  });
});
