import { CheckCircle2, CircleDashed, CircleSlash, Clock3, FileEdit, Archive, XCircle, Send, EyeOff, FlaskConical, Radio, AlertTriangle } from "lucide-react";
import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

/** One mapping for every status in the panel: tone colour + icon + text label
 * (never colour alone — docs/UI_UX_GUIDELINES.md §2.1). */
export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "brand";

export const STATUS_TONES: Record<string, { tone: Tone; icon: ComponentType<{ className?: string }> }> = {
  active: { tone: "success", icon: CheckCircle2 },
  inactive: { tone: "neutral", icon: CircleSlash },
  draft: { tone: "neutral", icon: FileEdit },
  published: { tone: "success", icon: Send },
  unpublished: { tone: "warning", icon: EyeOff },
  archived: { tone: "neutral", icon: Archive },
  success: { tone: "success", icon: CheckCircle2 },
  initiated: { tone: "info", icon: CircleDashed },
  pending: { tone: "warning", icon: Clock3 },
  failed: { tone: "danger", icon: XCircle },
  cancelled: { tone: "neutral", icon: CircleSlash },
  // payment gateways
  sandbox: { tone: "info", icon: FlaskConical },
  live: { tone: "brand", icon: Radio },
  connected: { tone: "success", icon: CheckCircle2 },
  untested: { tone: "neutral", icon: CircleDashed },
  unsupported: { tone: "neutral", icon: CircleSlash },
  ready: { tone: "success", icon: CheckCircle2 },
  not_ready: { tone: "warning", icon: AlertTriangle },
  not_implemented: { tone: "neutral", icon: CircleSlash },
  scheduled: { tone: "info", icon: Clock3 },
  expired: { tone: "neutral", icon: CircleSlash },
};

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success-50 text-success-700 ring-success-700/15",
  warning: "bg-warning-50 text-warning-700 ring-warning-700/15",
  danger: "bg-danger-50 text-danger-700 ring-danger-700/15",
  info: "bg-info-50 text-info-700 ring-info-700/15",
  neutral: "bg-neutral-50 text-neutral-700 ring-neutral-700/15",
  brand: "bg-brand-50 text-brand-700 ring-brand-700/15",
};

export const TONE_BAR: Record<Tone, string> = {
  success: "bg-success-700",
  warning: "bg-accent-500",
  danger: "bg-danger-700",
  info: "bg-info-700",
  neutral: "bg-line-strong",
  brand: "bg-brand-600",
};

export function StatusBadge({ status, label, className }: { status: string; label: string; className?: string }) {
  const config = STATUS_TONES[status] ?? { tone: "neutral" as Tone, icon: CircleDashed };
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONE_CLASS[config.tone],
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}
