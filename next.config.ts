import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Internal tool: tell crawlers not to index anything, including non-HTML
  // responses (API, images) that page metadata cannot cover.
  // Security: no other site may show our pages inside a frame (clickjacking),
  // browsers must not guess file types, links to other sites carry only our
  // domain (never a guest's share link), and HTTPS is always used.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
