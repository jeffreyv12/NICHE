import type { NextConfig } from "next";

// Single source of truth for env is the monorepo-root .env.local (CLAUDE.md #11).
// Next only auto-loads .env from the app dir (apps/web), so bridge the root file
// into process.env here, before Next reads env for NEXT_PUBLIC_* inlining and
// runtime. Built-in since Node 22; no dependency. On Vercel/CI there is no root
// .env.local (env comes from the platform) — the throw is caught and ignored.
try {
  process.loadEnvFile(path.resolve(process.cwd(), "../../.env.local"));
} catch {
  // No root .env.local present — rely on platform-provided environment.
}

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
  // Turbopack is default in Next.js 16. Declare an empty config to acknowledge
  // this and suppress the "webpack config with no turbopack config" error.
  turbopack: {},
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
