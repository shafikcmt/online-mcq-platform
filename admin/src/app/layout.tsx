import type { Metadata, Viewport } from "next";

import { getLocale } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/provider";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Admin · Live Model Test", template: "%s · Live Model Test Admin" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0f3a8f" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
