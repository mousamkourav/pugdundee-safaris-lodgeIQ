import type { MetadataRoute } from "next";

// Internal tool: disallow all crawling. Served at /robots.txt (excluded from
// the auth middleware so crawlers can read it without signing in).
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
