import { describe, expect, test } from "vitest";

import { downloadMode } from "@/lib/app-download";

describe("downloadMode", () => {
  test("no link → not ready", () => {
    expect(downloadMode("")).toBe("none");
    expect(downloadMode(undefined)).toBe("none");
    expect(downloadMode("not a url")).toBe("none");
  });
  test("an APK (or any file) link", () => {
    expect(downloadMode("https://expo.dev/artifacts/eas/abc.apk")).toBe("apk");
    expect(downloadMode("https://files.example.org/live-model-test.apk")).toBe("apk");
  });
  test("the Google Play page switches the whole page and notice to Play wording", () => {
    expect(downloadMode("https://play.google.com/store/apps/details?id=com.livemodeltest.app")).toBe("play");
    expect(downloadMode("https://PLAY.GOOGLE.COM/store/apps/details?id=x")).toBe("play");
  });
  test("a look-alike host is not Google Play", () => {
    expect(downloadMode("https://play.google.com.evil.example/x")).toBe("apk");
    expect(downloadMode("https://evilplay.google.com.example/x")).toBe("apk");
  });
});
