import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { AppButton } from "@/components/app-button";

const labels = { download: "Download App", open: "Open App", soon: "Coming soon to Google Play" };
const store = "https://play.google.com/store/apps/details?id=com.livemodeltest.app";

afterEach(() => vi.unstubAllGlobals());

function agent(userAgent: string) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
}

test("desktop: Download App → the download page (which holds the real link)", () => {
  agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
  render(<AppButton downloadUrl={store} openUrl="livemodeltest://open" labels={labels} lang="en" />);
  expect(screen.getByRole("link", { name: "Download App" })).toHaveAttribute("href", "/en/download");
});

test("Android with the app link: Open App → the app's own link", () => {
  agent("Mozilla/5.0 (Linux; Android 14; Pixel 7)");
  render(<AppButton downloadUrl={store} openUrl="livemodeltest://open" labels={labels} lang="en" />);
  expect(screen.getByRole("link", { name: "Open App" })).toHaveAttribute("href", "livemodeltest://open");
});

test("no store link yet: coming soon → the section that says so", () => {
  agent("Mozilla/5.0 (Linux; Android 14; Pixel 7)");
  render(<AppButton downloadUrl="" openUrl="" labels={labels} lang="en" />);
  expect(screen.getByRole("link", { name: "Coming soon to Google Play" })).toHaveAttribute("href", "/en#get-app"); // from any page
});
