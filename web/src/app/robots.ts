import type { MetadataRoute } from "next";

import { NOINDEX, SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  // A demo / preview copy (SITE_NOINDEX=1) is closed to every crawler and offers no sitemap.
  if (NOINDEX) return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${SITE_URL}/sitemap.xml` };
}
