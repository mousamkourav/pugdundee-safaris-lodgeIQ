import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Internal tool: tell crawlers not to index anything, including non-HTML
  // responses (API, images) that page metadata cannot cover.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
