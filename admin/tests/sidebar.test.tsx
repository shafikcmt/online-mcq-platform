import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

import { SidebarNav } from "@/components/shell/sidebar";

import { renderWithI18n } from "./helpers";

describe("SidebarNav", () => {
  it("marks the current page and lists every admin area", () => {
    renderWithI18n(<SidebarNav />);
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(nav).toBeInTheDocument();
    const dashboard = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboard).toHaveAttribute("aria-current", "page");
    expect(dashboard).toHaveAttribute("href", "/dashboard");
    for (const label of ["Users", "Questions", "Exams", "Payments", "Audit log"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("every admin area is built: all entries are links, none marked Soon", () => {
    renderWithI18n(<SidebarNav />);
    expect(document.querySelector("[aria-disabled]")).toBeNull();
    expect(screen.queryByText(/\(Soon\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Dimmed sections are not built yet/)).not.toBeInTheDocument();
  });

  it("links every screen (Milestones 7B–7H, website content, settings, inbox, audit log)", () => {
    renderWithI18n(<SidebarNav />);
    expect(screen.getByRole("link", { name: "Categories" })).toHaveAttribute("href", "/categories");
    expect(screen.getByRole("link", { name: "Subjects" })).toHaveAttribute("href", "/subjects");
    expect(screen.getByRole("link", { name: "Questions" })).toHaveAttribute("href", "/questions");
    expect(screen.getByRole("link", { name: "Exams" })).toHaveAttribute("href", "/exams");
    expect(screen.getByRole("link", { name: "Exam routine" })).toHaveAttribute("href", "/routine");
    expect(screen.getByRole("link", { name: "Results" })).toHaveAttribute("href", "/results");
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("href", "/users");
    expect(screen.getByRole("link", { name: "Attempts" })).toHaveAttribute("href", "/attempts");
    expect(screen.getByRole("link", { name: "Packages" })).toHaveAttribute("href", "/packages");
    expect(screen.getByRole("link", { name: "Subscriptions" })).toHaveAttribute("href", "/subscriptions");
    expect(screen.getByRole("link", { name: "Payments" })).toHaveAttribute("href", "/payments");
    expect(screen.getByRole("link", { name: "Payment gateways" })).toHaveAttribute("href", "/payment-gateways");
    expect(screen.getByRole("link", { name: "Announcements" })).toHaveAttribute("href", "/announcements");
    expect(screen.getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "/faqs");
    expect(screen.getByRole("link", { name: "Pages" })).toHaveAttribute("href", "/pages");
    expect(screen.getByRole("link", { name: "Contact messages" })).toHaveAttribute("href", "/contact-messages");
    expect(screen.getByRole("link", { name: "Site settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: "Audit log" })).toHaveAttribute("href", "/audit-log");
  });

  it("keeps labels for screen readers when collapsed", () => {
    renderWithI18n(<SidebarNav collapsed />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
  });
});
