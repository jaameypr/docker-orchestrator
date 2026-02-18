import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Unit test configuration.
 * - Fast execution, no Docker dependency.
 * - Short timeouts since everything is mocked.
 * - Coverage thresholds enforced.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    testTimeout: 5_000,
    hookTimeout: 5_000,
    pool: "forks",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/types/**/*.ts"],
      reporter: ["text", "text-summary", "lcov", "json-summary"],
      reportsDirectory: "coverage/unit",
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
