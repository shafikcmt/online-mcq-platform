/* eslint-disable @next/next/no-img-element -- a small static brand asset; no optimisation needed */
import { cn } from "@/lib/utils";

/** The official Live Model Test logo mark (owner-supplied artwork, transparent PNG). The
 * Mobile App uses the same mark (`mobile/assets/images/logo-mark.png`). */
export const LOGO_MARK_SRC = "/brand/logo-mark.png";

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

/** Mark + "LIVE MODEL TEST" wordmark set in text (navy / sky blue / navy). */
export function Logo({
  className,
  compact = false,
  size = "md",
}: {
  className?: string;
  compact?: boolean;
  size?: "md" | "lg";
}) {
  return (
    <span className={cn("inline-flex items-center", size === "lg" ? "gap-3.5" : "gap-2.5", className)}>
      <LogoMark className={size === "lg" ? "size-16" : "size-9"} />
      {!compact && (
        <span
          className={cn(
            "leading-none font-extrabold tracking-tight whitespace-nowrap",
            size === "lg" ? "text-2xl" : "text-[15px]",
          )}
        >
          <span className="text-brand-900">LIVE </span>
          <span className="text-brand-500">MODEL </span>
          <span className="text-brand-900">TEST</span>
        </span>
      )}
    </span>
  );
}
