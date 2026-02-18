import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Integration test configuration.
 * - Requires a running Docker daemon.
 * - Longer timeouts for real Docker operations.
 * - Sequential execution to avoid resource contention.
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
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // Run integration tests sequentially to avoid Docker resource contention
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Retry flaky integration tests once
    retry: 1,
  },
});
