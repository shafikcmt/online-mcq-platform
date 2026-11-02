/* eslint-disable @next/next/no-img-element -- small static SVG brand assets; no optimisation needed */
import { cn } from "@/lib/utils";

/** The official Live Model Test logo ("Rank Signal" brand kit, owner-supplied SVG): three
 * ascending bars + a live gold dot. The Website and the Mobile App use the same artwork. */
export const LOGO_MARK_SRC = "/brand/icon-color.svg";
export const LOGO_LOCKUP_SRC = "/brand/lockup-horizontal.svg";

/** The icon alone (square) — collapsed sidebar, small screens, favicon-size spots. */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <img
      src={LOGO_MARK_SRC}
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
      width={64}
      height={64}
      className={cn("shrink-0", className)}
      draggable={false}
    />
  );
}

/** The full logo: icon + "LIVE MODEL TEST" wordmark (one SVG). `compact` = icon only. */
export function Logo({
  className,
  compact = false,
  size = "md",
}: {
  className?: string;
  compact?: boolean;
  size?: "md" | "lg";
}) {
  if (compact) return <LogoMark className={cn(size === "lg" ? "size-16" : "size-9", className)} />;
  return (
    <img
      src={LOGO_LOCKUP_SRC}
      alt="Live Model Test"
      width={1244}
      height={442}
      className={cn("w-auto shrink-0", size === "lg" ? "h-16" : "h-9", className)}
      draggable={false}
    />
  );
}
