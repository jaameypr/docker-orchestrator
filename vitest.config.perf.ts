import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Performance test configuration.
 * - Separate run with extended timeouts.
 * - Requires a running Docker daemon.
 * - Results are written to JSON for regression detection.
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
    include: ["tests/performance/**/*.test.ts"],
    testTimeout: 300_000, // 5 minutes per test
    hookTimeout: 60_000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // No retries for performance tests – results must be deterministic
    retry: 0,
  },
});
