import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ApiError } from "@/lib/api/errors";
import { describeDeleteError } from "@/lib/content-errors";
import { MESSAGES, translate } from "@/lib/i18n/messages";

import { renderWithI18n } from "./helpers";

const t = (key: Parameters<typeof translate>[1]) => translate(MESSAGES.en, key);

function Harness({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <ConfirmDialog
          open
          onOpenChange={setOpen}
          title="Delete this category?"
          description="“HSC” will be deleted permanently."
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          onConfirm={async () => {
            await onConfirm();
            setOpen(false);
          }}
          describe={(error) => describeDeleteError(error, t)}
        />
      )}
    </>
  );
}

describe("ConfirmDialog", () => {
  it("is an alert dialog that starts on Cancel and returns focus when closed", async () => {
    renderWithI18n(<Harness onConfirm={vi.fn()} />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("alertdialog", { name: "Delete this category?" });
    expect(dialog).toHaveAccessibleDescription("“HSC” will be deleted permanently.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus()); // Radix restores focus after unmount
  });

  it("keeps the dialog open and explains a 409 in_use (nothing removed)", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new ApiError(409, "in_use", "This category still has subjects.", {}, true));
    renderWithI18n(<Harness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Can't delete this item");
    expect(alert).toHaveTextContent("This category still has subjects.");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("disables both buttons while the request runs and closes on success", async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    renderWithI18n(<Harness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("describes 404 and network failures", () => {
    expect(describeDeleteError(new ApiError(404, "not_found", "Not found."), t).message).toBe(t("error.notFound"));
    expect(describeDeleteError(new ApiError(0, "network_error", "x"), t).message).toBe(t("error.network"));
  });
});
