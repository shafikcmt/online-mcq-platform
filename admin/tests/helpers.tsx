import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { I18nProvider } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/messages";

/** Render inside the language provider (`wrapper`, so `rerender` keeps it too). */
export function renderWithI18n(ui: ReactElement, locale: Locale = "en") {
  return render(ui, { wrapper: ({ children }: { children: ReactNode }) => <I18nProvider locale={locale}>{children}</I18nProvider> });
}
