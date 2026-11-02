import { NextResponse, type NextRequest } from "next/server";

import { DEFAULT_LANG, isLang, type Lang } from "./lib/i18n";

/** Every page lives under `/bn/…` or `/en/…`. A path without a language goes to the
 * visitor's language: the one chosen before (cookie), else the browser's if it prefers
 * English, else Bangla (the platform default). */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const first = pathname.split("/")[1];
  if (isLang(first)) {
    const response = NextResponse.next();
    if (request.cookies.get("lang")?.value !== first) {
      response.cookies.set("lang", first, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    }
    return response;
  }
  const url = request.nextUrl.clone();
  url.pathname = `/${preferred(request)}${pathname === "/" ? "" : pathname}`;
  url.search = search;
  return NextResponse.redirect(url);
}

function preferred(request: NextRequest): Lang {
  const saved = request.cookies.get("lang")?.value;
  if (isLang(saved)) return saved;
  const accept = request.headers.get("accept-language") ?? "";
  const first = accept.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("en") ? "en" : DEFAULT_LANG;
}

export const config = {
  // Not for Next.js internals, the API (nginx / the dev proxy), files with an extension,
  // the sitemap or robots.txt.
  matcher: ["/((?!_next|api/|.*\\..*).*)"],
};
