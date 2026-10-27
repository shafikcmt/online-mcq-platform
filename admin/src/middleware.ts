import { NextResponse, type NextRequest } from "next/server";

/** Fast redirect for visitors without any session cookie. The real check is the backend
 * (`/admin/auth/me/`) in the panel layout — a cookie being present proves nothing. */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!request.cookies.has("sessionid")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except the sign-in page, the API proxy, Next internals and static files.
  matcher: ["/((?!login|api|_next|icon.png|apple-icon.png|brand|.*\\.(?:svg|png|jpg|ico|woff2?)$).*)"],
};
