import type { NextConfig } from "next";

/**
 * Data and API routing
 * - Pages read the backend's public API on the server (`API_ORIGIN`, never sent to the
 *   browser).
 * - The only browser call is the Contact form: `POST /api/v1/public/contact/` on the site's
 *   own origin. In production **nginx** routes `/api/v1/public/` straight to Django (real
 *   client IP via X-Forwarded-For for the per-IP limit; no CORS), so the production build
 *   contains NO /api rewrite (docs/DEPLOYMENT.md).
 * - Development (`next dev`) and the disposable E2E stack (`DEV_PUBLIC_API_PROXY=1` at build
 *   time) only: Next.js proxies `/api/v1/public/*` to API_ORIGIN. Never set it in production:
 *   it adds no X-Forwarded-For, so every visitor would share one rate limit.
 */
const proxyPublicApi = process.env.NODE_ENV !== "production" || process.env.DEV_PUBLIC_API_PROXY === "1";
const DEV_API_ORIGIN = (process.env.API_ORIGIN ?? "http://127.0.0.1:8000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Django routes end with "/"; never redirect them away.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return proxyPublicApi ? [{ source: "/api/v1/public/:path*/", destination: `${DEV_API_ORIGIN}/api/v1/public/:path*/` }] : [];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
