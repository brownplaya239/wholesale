import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // PGlite is a local-testing stand-in for Postgres; never ship it to Vercel.
  outputFileTracingExcludes: { "*": ["node_modules/@electric-sql/pglite/**"] },
  async headers() {
    // Landing + conversion pages must never be indexed, even if a crawler
    // ignores the meta robots tag.
    const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
    return [
      { source: "/lp/:path*", headers: noindex },
      { source: "/thank-you", headers: noindex },
    ];
  },
};

export default nextConfig;
