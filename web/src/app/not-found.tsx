import Link from "next/link";

import "./globals.css";

/** Outside /bn and /en (rare: the middleware adds a language first). Bilingual on purpose. */
export default function NotFound() {
  return (
    <html lang="bn">
      <body className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-2xl font-bold">পাতাটি পাওয়া যায়নি · Page not found</h1>
          <Link href="/bn" className="font-semibold text-brand-700">
            হোম · Home
          </Link>
        </div>
      </body>
    </html>
  );
}
