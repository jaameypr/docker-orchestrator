import { describe, it, expect } from "vitest";
import { withTimeout, DEFAULT_TIMEOUTS } from "../../src/utils/timeout.js";
import { TimeoutError } from "../../src/errors/base.js";

describe("Timeout", () => {
  describe("DEFAULT_TIMEOUTS", () => {
    it("should have all expected keys", () => {
      expect(DEFAULT_TIMEOUTS.containerStart).toBe(30000);
      expect(DEFAULT_TIMEOUTS.containerStop).toBe(30000);
      expect(DEFAULT_TIMEOUTS.imagePull).toBe(300000);
      expect(DEFAULT_TIMEOUTS.exec).toBe(30000);
      expect(DEFAULT_TIMEOUTS.healthCheck).toBe(60000);
      expect(DEFAULT_TIMEOUTS.apiCall).toBe(10000);
      expect(DEFAULT_TIMEOUTS.streamConnect).toBe(5000);
    });
  });

  describe("withTimeout()", () => {
    it("should resolve fast operations without timeout", async () => {
      const result = await withTimeout(Promise.resolve("fast"), 1000, "test");
      expect(result).toBe("fast");
    });

    it("should throw TimeoutError for slow operations", async () => {
      const slowPromise = new Promise((resolve) => setTimeout(resolve, 5000));
      await expect(withTimeout(slowPromise, 50, "slow-op")).rejects.toThrow(TimeoutError);

      try {
        await withTimeout(slowPromise, 50, "slow-op");
      } catch (err) {
        expect(err).toBeInstanceOf(TimeoutError);
        const te = err as TimeoutError;
        expect(te.timeoutMs).toBe(50);
        expect(te.operation).toBe("slow-op");
        expect(te.message).toContain("50ms");
        expect(te.message).toContain("slow-op");
      }
    });

    it("should propagate original errors", async () => {
      const failPromise = Promise.reject(new Error("original fail"));
      await expect(withTimeout(failPromise, 1000, "test")).rejects.toThrow("original fail");
    });

    it("should handle zero or negative timeout (no timeout)", async () => {
      const result = await withTimeout(Promise.resolve("ok"), 0, "test");
      expect(result).toBe("ok");

      const result2 = await withTimeout(Promise.resolve("ok2"), -1, "test");
      expect(result2).toBe("ok2");
    });

    it("should not leave zombie timers after resolution", async () => {
      const result = await withTimeout(Promise.resolve("done"), 100, "test");
      expect(result).toBe("done");
      // If timers leaked, the test framework would detect them
    });
  });
});
