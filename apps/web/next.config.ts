import type { NextConfig } from "next";

// Multi-tenant Next.js config. We don't lock to a single hostname here —
// middleware does the per-request tenant resolution. Vercel attaches
// promoted-niche domains to this project via the Domains API.

const config: NextConfig = {
  reactStrictMode: true,
  // Allow Drizzle / postgres-js bundling on the server.
  serverExternalPackages: ["postgres"],
  // Transpile workspace packages so monorepo aliases resolve in the bundler.
  transpilePackages: [
    "@nichefinder/db",
    "@nichefinder/shared",
    "@nichefinder/agent-sdk",
    "@nichefinder/ui",
  ],
  // Public env exposure is opt-in: only NEXT_PUBLIC_* surface; nothing else.
  experimental: {
    // Will revisit Turbopack production builds once it's stable for this stack.
  },
  // Security headers (baseline; tenant-specific CSP injected in middleware later)
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
