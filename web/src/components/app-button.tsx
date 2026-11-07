"use client";

import { Download, Smartphone } from "lucide-react";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/cn";

const noop = () => () => {};
const isAndroid = () => /Android/i.test(navigator.userAgent);

type Labels = { download: string; open: string; soon: string };
type Props = { downloadUrl: string; openUrl: string; labels: Labels; lang: string; className?: string; size?: "md" | "lg" };

/** The website's main action. Desktop and iPhone: "Download App" (the download page).
 * Android: "Open App" — tries the app's own link and, if the app is not installed (the
 * page is still visible after a moment), goes to the download page. Without a store link yet
 * (set in the Admin Panel → Site settings) it points to the Home page's "coming soon" section. */
export function AppButton({ downloadUrl, openUrl, labels, lang, className, size = "md" }: Props) {
  // The device is known only in the browser; the server renders "Download".
  const android = useSyncExternalStore(noop, isAndroid, () => false);
  const canOpen = android && !!openUrl;
  // The download page (install and update steps) opens first; it holds the real link.
  const href = downloadUrl ? `/${lang}/download` : `/${lang}#get-app`;
  const classes = cn(
    // A long label (Bangla "coming soon") may wrap on a phone: padding and a tight line
    // height keep two lines inside the button.
    "inline-flex items-center justify-center gap-2 rounded-control bg-brand-600 text-center leading-snug font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-offset-4",
    size === "lg" ? "min-h-12 px-6 py-2.5 text-base" : "min-h-10 px-4 py-2 text-sm",
    className,
  );

  function open(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!canOpen) return;
    event.preventDefault();
    const fallback = window.setTimeout(() => {
      if (document.visibilityState === "visible") window.location.href = href;
    }, 1500);
    window.addEventListener("pagehide", () => window.clearTimeout(fallback), { once: true });
    window.location.href = openUrl;
  }

  return (
    <a href={canOpen ? openUrl : href} onClick={open} className={classes}>
      {canOpen ? <Smartphone className="size-5 shrink-0" aria-hidden /> : <Download className="size-5 shrink-0" aria-hidden />}
      {canOpen ? labels.open : downloadUrl ? labels.download : labels.soon}
    </a>
  );
}
