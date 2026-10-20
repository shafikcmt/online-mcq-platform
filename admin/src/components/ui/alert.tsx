import { AlertTriangle, Info, Lock } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const TONES = {
  info: { box: "border-info-700/20 bg-info-50 text-info-700", icon: Info },
  warning: { box: "border-warning-700/25 bg-warning-50 text-warning-700", icon: AlertTriangle },
  danger: { box: "border-danger-700/25 bg-danger-50 text-danger-700", icon: AlertTriangle },
  locked: { box: "border-warning-700/25 bg-warning-50 text-warning-700", icon: Lock },
} as const;

/** Inline message box (icon + title + text; tone is never carried by colour alone). Use
 * `live` for messages that appear after an action so screen readers announce them. */
export function Alert({
  tone = "info",
  title,
  children,
  live = false,
  className,
}: {
  tone?: keyof typeof TONES;
  title?: string;
  children?: ReactNode;
  live?: boolean;
  className?: string;
}) {
  const { box, icon: Icon } = TONES[tone];
  return (
    <div role={live ? "alert" : undefined} className={cn("flex gap-3 rounded-card border px-4 py-3 text-sm", box, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "text-ink-muted")}>{children}</div>}
      </div>
    </div>
  );
}
