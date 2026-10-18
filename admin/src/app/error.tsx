"use client";

import { PanelError } from "@/components/shell/panel-error";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <PanelError error={error} reset={reset} />
    </div>
  );
}
