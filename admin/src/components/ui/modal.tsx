"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

import { Button } from "./button";

/** Centered dialog (bottom sheet on phones). Radix traps focus inside, closes on Escape,
 * hides the rest of the page from screen readers and returns focus to the element that
 * opened it. `role="alertdialog"` is used for confirmations. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  role = "dialog",
  closeDisabled = false,
  initialFocus,
  layer = "base",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  role?: "dialog" | "alertdialog";
  /** While a request runs: Escape/outside click/close button do nothing. */
  closeDisabled?: boolean;
  /** Element to focus when the dialog opens (default: the first focusable one). */
  initialFocus?: React.RefObject<HTMLElement | null>;
  /** "top": above any other open dialog (the session-expired notice). */
  layer?: "base" | "top";
}) {
  const { t } = useI18n();
  // These dialogs are opened from row buttons, not a Dialog.Trigger, so Radix has no
  // trigger to return focus to: remember the opener and go back to it ourselves.
  const opener = useRef<HTMLElement | null>(null);
  const guard = (event: Event) => {
    if (closeDisabled) event.preventDefault();
  };
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (!next && closeDisabled ? undefined : onOpenChange(next))}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn("drawer-overlay fixed inset-0 bg-ink/40", layer === "top" ? "z-[70]" : "z-40")} />
        <Dialog.Content
          role={role}
          onEscapeKeyDown={guard}
          onPointerDownOutside={guard}
          onInteractOutside={guard}
          onOpenAutoFocus={(event) => {
            const active = document.activeElement;
            opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
            if (initialFocus?.current) {
              event.preventDefault();
              initialFocus.current.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = opener.current?.isConnected ? opener.current : document.getElementById("main");
            target?.focus();
          }}
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cn(
            "modal-panel fixed inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-dialog bg-surface shadow-float focus:outline-none",
            "sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[calc(100vw-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-dialog",
            layer === "top" ? "z-[80]" : "z-50",
            size === "sm" && "sm:max-w-md",
            size === "md" && "sm:max-w-xl",
            size === "lg" && "sm:max-w-3xl",
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold text-ink">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-sm text-ink-muted">{description}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" className="-mt-1 -mr-2" aria-label={t("common.close")} disabled={closeDisabled}>
                <X aria-hidden />
              </Button>
            </Dialog.Close>
          </div>
          {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>}
          {footer && (
            <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
