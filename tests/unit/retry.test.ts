import { describe, it, expect, vi } from "vitest";
import { retry, calculateDelay } from "../../src/utils/retry.js";
import { ConnectionError } from "../../src/errors/base.js";

describe("Retry", () => {
  describe("calculateDelay", () => {
    it("should calculate exponential delay", () => {
      expect(calculateDelay(0, 1000, 2, 30000, false)).toBe(1000);
      expect(calculateDelay(1, 1000, 2, 30000, false)).toBe(2000);
      expect(calculateDelay(2, 1000, 2, 30000, false)).toBe(4000);
      expect(calculateDelay(3, 1000, 2, 30000, false)).toBe(8000);
    });

    it("should respect maxDelay cap", () => {
      expect(calculateDelay(10, 1000, 2, 30000, false)).toBe(30000);
    });

    it("should apply jitter within ±25%", () => {
      const delays = Array.from({ length: 50 }, () =>
        calculateDelay(1, 1000, 2, 30000, true),
      );
      const base = 2000;
      for (const d of delays) {
        expect(d).toBeGreaterThanOrEqual(base * 0.75);
        expect(d).toBeLessThanOrEqual(base * 1.25);
      }
      // Ensure there's actual variation (not all the same)
      const unique = new Set(delays);
      expect(unique.size).toBeGreaterThan(1);
    });
  });

  describe("retry()", () => {
    it("should succeed on first attempt without retry", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      const result = await retry(fn, { jitter: false });
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry on transient error and succeed", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new ConnectionError("fail"))
        .mockResolvedValue("ok");

      const result = await retry(fn, {
        initialDelay: 10,
        jitter: false,
      });
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should throw after maxRetries exhausted", async () => {
      const fn = vi.fn().mockRejectedValue(new ConnectionError("fail"));

      await expect(
        retry(fn, { maxRetries: 2, initialDelay: 10, jitter: false }),
      ).rejects.toThrow("fail");
      expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it("should not retry non-transient errors", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("not transient"));

      await expect(
        retry(fn, { maxRetries: 3, initialDelay: 10, jitter: false }),
      ).rejects.toThrow("not transient");
      expect(fn).toHaveBeenCalledTimes(1); // no retry
    });

    it("should call onRetry callback", async () => {
      const onRetry = vi.fn();
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new ConnectionError("fail"))
        .mockResolvedValue("ok");

      await retry(fn, {
        initialDelay: 10,
        jitter: false,
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(
        1,
        expect.any(ConnectionError),
        10,
      );
    });

    it("should respect AbortSignal", async () => {
      const controller = new AbortController();
      const fn = vi.fn().mockRejectedValue(new ConnectionError("fail"));

      // Abort immediately
      controller.abort(new Error("cancelled"));

      await expect(
        retry(fn, {
          maxRetries: 5,
          initialDelay: 10,
          signal: controller.signal,
        }),
      ).rejects.toThrow("cancelled");
      expect(fn).toHaveBeenCalledTimes(0);
    });

    it("should abort during retry sleep", async () => {
      const controller = new AbortController();
      const fn = vi.fn().mockRejectedValue(new ConnectionError("fail"));

      // Abort after 50ms
      setTimeout(() => controller.abort(new Error("aborted")), 50);

      await expect(
        retry(fn, {
          maxRetries: 5,
          initialDelay: 500,
          signal: controller.signal,
          jitter: false,
        }),
      ).rejects.toThrow("aborted");
    });

    it("should support custom retryOn predicate", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("retry me"))
        .mockResolvedValue("ok");

      const result = await retry(fn, {
        initialDelay: 10,
        jitter: false,
        retryOn: (err) =>
          err instanceof Error && err.message === "retry me",
      });
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
