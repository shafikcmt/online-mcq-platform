import type { NextConfig } from "next";

/**
 * API routing
 * - Production: the browser calls /api/* on the panel's own origin and **nginx** routes it
 *   straight to Django (real client IP via X-Forwarded-For, nothing baked into this build).
 *   The production build therefore contains NO /api rewrite. See docs/DEPLOYMENT.md.
 * - Development (`next dev`) only: Next.js proxies /api/* to API_ORIGIN, keeping Django's
 *   trailing slashes. Not for production — it adds no X-Forwarded-For header.
 */
const isDevelopment = process.env.NODE_ENV !== "production";
const DEV_API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:8000";

export function devApiRewrites() {
  return [
    // Keep the trailing slash Django's routes require (the first rule wins).
    { source: "/api/:path*/", destination: `${DEV_API_ORIGIN}/api/:path*/` },
    { source: "/api/:path*", destination: `${DEV_API_ORIGIN}/api/:path*` },
  ];
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Django routes end with "/"; never redirect them away.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return isDevelopment ? devApiRewrites() : [];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
