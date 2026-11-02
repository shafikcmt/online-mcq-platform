import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { AppShell } from "@/components/shell/app-shell";

import { renderWithI18n } from "./helpers";

const profile = { full_name: "Nusrat Jahan", mobile_number: "017*****678", preferred_language: "en", role: "admin" };

describe("AppShell", () => {
  it("opens and closes the mobile navigation drawer", async () => {
    renderWithI18n(
      <AppShell profile={profile}>
        <p>Page body</p>
      </AppShell>,
    );
    expect(screen.getByText("Page body")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const drawer = await screen.findByRole("dialog", { name: "Main navigation" });
    expect(drawer).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close navigation" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); // after the exit transition
  });

  it("shows the signed-in admin and a skip link", () => {
    renderWithI18n(<AppShell profile={profile}>x</AppShell>);
    expect(screen.getByRole("button", { name: "Account menu" })).toHaveTextContent("NJ");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
  });

  it("collapses the desktop sidebar", async () => {
    renderWithI18n(<AppShell profile={profile}>x</AppShell>);
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
  });
});
