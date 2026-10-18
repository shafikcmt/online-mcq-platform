import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { I18nProvider } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/messages";

export function renderWithI18n(ui: ReactElement, locale: Locale = "en") {
  return render(<I18nProvider locale={locale}>{ui}</I18nProvider>);
}
