"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type Item = { href: string; label: string };

/** Phone-width navigation: a full-width sheet under the header (Radix dialog: focus is
 * trapped while open, Escape closes it). */
export function MobileMenu({ items, labels, children }: { items: Item[]; labels: { menu: string; close: string; nav: string }; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="inline-flex size-10 items-center justify-center rounded-control text-ink hover:bg-brand-50 lg:hidden" aria-label={labels.menu}>
        <Menu className="size-6" aria-hidden />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="menu-overlay fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content className="menu-panel fixed inset-x-0 top-0 z-50 rounded-b-dialog bg-surface p-4 shadow-float" aria-describedby={undefined}>
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">{labels.menu}</Dialog.Title>
            <Dialog.Close className="inline-flex size-10 items-center justify-center rounded-control hover:bg-brand-50" aria-label={labels.close}>
              <X className="size-6" aria-hidden />
            </Dialog.Close>
          </div>
          <nav aria-label={labels.nav} className="mt-2 flex flex-col">
            {items.map((item) => (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="rounded-control px-3 py-3 text-base font-medium hover:bg-brand-50">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
