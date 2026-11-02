"use client";

import { PanelError } from "@/components/shell/panel-error";

export default function PaymentsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PanelError error={error} reset={reset} />;
}
