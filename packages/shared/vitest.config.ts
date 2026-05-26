import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 },
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
});
