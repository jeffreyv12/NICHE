import type { NextConfig } from "next";

// Bridge the monorepo-root .env.local into process.env for local dev.
// On Vercel/CI there is no .env.local — the throw is caught and ignored.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
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
