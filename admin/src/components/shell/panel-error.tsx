"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { ErrorState } from "@/components/ui/states";
import { ApiError, describeError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";

/** Route error boundary content. Server errors reach the browser without details in
 * production, so the message is generic; a lost session sends the admin to sign in. */
export function PanelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  // Errors thrown on the server reach the browser with a digest and a masked message in
  // production; never show that raw text. (401/403 on server reads are already redirected
  // to sign-in by adminRead.) Client-side ApiErrors are described by their code.
  const fromServer = Boolean(error.digest);
  const apiError = error instanceof ApiError ? error : null;
  const message = fromServer ? t("error.server") : describeError(apiError ?? error, t);
  const unauthenticated = apiError?.isUnauthenticated ?? false;
  const forbidden = apiError?.isForbidden ?? false;
  const network = apiError?.isNetwork ?? false;

  useEffect(() => {
    if (unauthenticated) router.replace("/login?expired=1");
  }, [unauthenticated, router]);

  return (
    <ErrorState
      title={forbidden ? t("error.forbidden") : t("error.title")}
      message={forbidden ? "" : message || t("error.title")}
      kind={forbidden ? "forbidden" : network ? "network" : "error"}
      retryLabel={t("common.retry")}
      onRetry={() => {
        reset();
        router.refresh();
      }}
    />
  );
}
