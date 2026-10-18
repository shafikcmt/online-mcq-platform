import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", async () => {
  const errors = await import("@/lib/api/errors");
  return { apiFetch: (...args: unknown[]) => apiFetch(...args), ensureCsrfToken: vi.fn(), ApiError: errors.ApiError };
});

import { LoginForm } from "@/app/(auth)/login/login-form";
import { ApiError } from "@/lib/api/errors";

import { renderWithI18n } from "./helpers";

beforeEach(() => {
  replace.mockReset();
  apiFetch.mockReset();
});

describe("LoginForm", () => {
  it("validates required fields before calling the API", async () => {
    renderWithI18n(<LoginForm next="/dashboard" expired={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getAllByText("This field is required.")).toHaveLength(2);
    expect(screen.getByLabelText("Mobile number")).toHaveAttribute("aria-invalid", "true");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("shows the server's generic error and stays on the page", async () => {
    apiFetch.mockRejectedValue(
      new ApiError(401, "invalid_credentials", "Mobile number or password is incorrect.", {}, true),
    );
    renderWithI18n(<LoginForm next="/dashboard" expired={false} />);
    await userEvent.type(screen.getByLabelText("Mobile number"), "01611111111");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Mobile number or password is incorrect.");
    expect(replace).not.toHaveBeenCalled();
  });

  it("signs in and goes to the requested page", async () => {
    apiFetch.mockResolvedValue({ full_name: "Ops" });
    renderWithI18n(<LoginForm next="/dashboard" expired={false} />);
    await userEvent.type(screen.getByLabelText("Mobile number"), "01611111111");
    await userEvent.type(screen.getByLabelText("Password"), "secret-pass");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(apiFetch).toHaveBeenCalledWith("/admin/auth/login/", {
      method: "POST",
      body: { mobile_number: "01611111111", password: "secret-pass" },
    });
  });

  it("shows a translated message when the server is unreachable", async () => {
    const { networkError } = await import("@/lib/api/errors");
    apiFetch.mockRejectedValue(networkError());
    renderWithI18n(<LoginForm next="/dashboard" expired={false} />, "bn");
    await userEvent.type(screen.getByLabelText("মোবাইল নম্বর"), "01611111111");
    await userEvent.type(screen.getByLabelText("পাসওয়ার্ড"), "secret-pass");
    await userEvent.click(screen.getByRole("button", { name: "সাইন ইন" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("সার্ভারে সংযোগ করা যাচ্ছে না।");
  });

  it("explains an expired session", () => {
    renderWithI18n(<LoginForm next="/dashboard" expired />);
    expect(screen.getByRole("alert")).toHaveTextContent("Your session has ended.");
  });
});
