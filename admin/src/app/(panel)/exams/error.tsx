"use client";

import { PanelError } from "@/components/shell/panel-error";

export default function ExamsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PanelError error={error} reset={reset} />;
}
