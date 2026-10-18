"use client";

import { AlertTriangle, Inbox, Lock, RotateCw, WifiOff } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "./button";

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-neutral-50 text-ink-subtle">
        <Inbox className="size-5" aria-hidden />
      </span>
      <p className="mt-3 text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title,
  message,
  kind = "error",
  onRetry,
  retryLabel,
}: {
  title: string;
  message: string;
  kind?: "error" | "forbidden" | "network";
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const Icon = kind === "forbidden" ? Lock : kind === "network" ? WifiOff : AlertTriangle;
  return (
    <div role="alert" className="flex flex-col items-center rounded-card border border-line bg-surface px-6 py-12 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-danger-50 text-danger-700">
        <Icon className="size-5" aria-hidden />
      </span>
      <h2 className="mt-4 text-base font-semibold text-ink">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-ink-muted">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-5" onClick={onRetry}>
          <RotateCw aria-hidden />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
