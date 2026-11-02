import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));

import { PanelError } from "@/components/shell/panel-error";
import { ApiError, networkError } from "@/lib/api/errors";

import { renderWithI18n } from "./helpers";

describe("PanelError", () => {
  it("never shows Next's masked server error text", () => {
    const error = Object.assign(new Error("An error occurred in the Server Components render."), { digest: "123" });
    renderWithI18n(<PanelError error={error} reset={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The server couldn't complete this request.");
    expect(screen.queryByText(/Server Components/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("explains a network failure in the UI language", () => {
    renderWithI18n(<PanelError error={networkError()} reset={vi.fn()} />, "bn");
    expect(screen.getByRole("alert")).toHaveTextContent("সার্ভারে সংযোগ করা যাচ্ছে না।");
  });

  it("never shows raw text of an unknown client error", () => {
    renderWithI18n(<PanelError error={new Error("TypeError: x is undefined at foo.js:12")} reset={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
    expect(screen.queryByText(/foo\.js/)).not.toBeInTheDocument();
  });

  it("sends a lost client session to sign-in, returning to the current page", () => {
    renderWithI18n(<PanelError error={new ApiError(401, "not_authenticated", "x")} reset={vi.fn()} />);
    expect(replace).toHaveBeenLastCalledWith("/login?expired=1");
    window.history.pushState({}, "", "/questions?search=light");
    renderWithI18n(<PanelError error={new ApiError(401, "not_authenticated", "x")} reset={vi.fn()} />);
    expect(replace).toHaveBeenLastCalledWith("/login?expired=1&next=%2Fquestions%3Fsearch%3Dlight");
    window.history.pushState({}, "", "/");
  });
});
