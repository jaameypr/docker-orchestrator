import { describe, it, expect, vi } from "vitest";
import { retry } from "../../src/utils/retry.js";
import { CircuitBreaker } from "../../src/utils/circuit-breaker.js";
import { ShutdownManager } from "../../src/utils/shutdown.js";
import { withTimeout } from "../../src/utils/timeout.js";
import { ResilientStream } from "../../src/utils/resilient-stream.js";
import { CircuitOpenError, TimeoutError } from "../../src/errors/base.js";
import { Readable } from "node:stream";

describe("Phase 7 Integration – Resilience", () => {
  describe("Retry + Circuit Breaker interaction", () => {
    it("should retry through circuit breaker until success", async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 10,
        resetTimeout: 100,
        halfOpenMaxAttempts: 1,
        monitorInterval: 60000,
      });

      let attempts = 0;
      const result = await retry(
        async () => {
          return breaker.execute(async () => {
            attempts++;
            if (attempts < 3) throw new Error("ECONNREFUSED");
            return "connected";
          });
        },
        {
          maxRetries: 5,
          initialDelay: 10,
          jitter: false,
          retryOn: (err) =>
            !(err instanceof CircuitOpenError) &&
            err instanceof Error &&
            err.message.includes("ECONNREFUSED"),
        },
      );

      expect(result).toBe("connected");
      expect(attempts).toBe(3);
      expect(breaker.getState()).toBe("closed");

      breaker.destroy();
    });

    it("should stop retrying when circuit opens", async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 10000,
        halfOpenMaxAttempts: 1,
        monitorInterval: 60000,
      });

      let attempts = 0;
      await expect(
        retry(
          async () => {
            return breaker.execute(async () => {
              attempts++;
              throw new Error("ECONNREFUSED");
            });
          },
          {
            maxRetries: 10,
            initialDelay: 10,
            jitter: false,
            retryOn: (err) => !(err instanceof CircuitOpenError),
          },
        ),
      ).rejects.toThrow(CircuitOpenError);

      // Should have stopped at 2 failures (circuit opens) + no retry on CircuitOpenError
      expect(attempts).toBe(2);
      expect(breaker.getState()).toBe("open");

      breaker.destroy();
    });
  });

  describe("Retry + Timeout interaction", () => {
    it("should timeout slow retries", async () => {
      const fn = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 5000)),
      );

      await expect(
        withTimeout(
          retry(fn, {
            maxRetries: 3,
            initialDelay: 10,
            jitter: false,
            retryOn: () => true,
          }),
          100,
          "test-operation",
        ),
      ).rejects.toThrow(TimeoutError);
    });

    it("should succeed within timeout on retry", async () => {
      let calls = 0;
      const fn = vi.fn().mockImplementation(async () => {
        calls++;
        if (calls < 2) throw new Error("ECONNREFUSED");
        return "ok";
      });

      const result = await withTimeout(
        retry(fn, {
          maxRetries: 3,
          initialDelay: 10,
          jitter: false,
          retryOn: (err) =>
            err instanceof Error && err.message.includes("ECONNREFUSED"),
        }),
        5000,
        "test",
      );

      expect(result).toBe("ok");
    });
  });

  describe("Graceful Shutdown integration", () => {
    it("should shut down streams and circuit breaker cleanly", async () => {
      const shutdown = new ShutdownManager({ timeout: 5000 });
      const breaker = new CircuitBreaker({ failureThreshold: 5, resetTimeout: 30000, halfOpenMaxAttempts: 1, monitorInterval: 60000 });

      const streamDestroyed = vi.fn();
      const breakerDestroyed = vi.fn();

      shutdown.register("stream", () => {
        streamDestroyed();
      });
      shutdown.register("circuit-breaker", () => {
        breaker.destroy();
        breakerDestroyed();
      });

      await shutdown.shutdown();

      expect(streamDestroyed).toHaveBeenCalled();
      expect(breakerDestroyed).toHaveBeenCalled();
    });

    it("should handle cleanup failures gracefully", async () => {
      const shutdown = new ShutdownManager({ timeout: 5000 });

      shutdown.register("failing", () => {
        throw new Error("cleanup explosion");
      });

      const secondCb = vi.fn();
      shutdown.register("succeeding", secondCb);

      // Should not throw even though first cleanup fails
      await shutdown.shutdown();
      expect(secondCb).toHaveBeenCalled();
    });
  });

  describe("ResilientStream reconnection", () => {
    it("should reconnect and continue receiving data after error", async () => {
      let callCount = 0;
      const allData: string[] = [];

      const factory = vi.fn().mockImplementation(() => {
        callCount++;
        const chunks = callCount === 1
          ? ["chunk1"]  // first stream will error
          : ["chunk2", "chunk3"];

        let idx = 0;
        const stream = new Readable({
          read() {
            if (callCount === 1 && idx >= 1) {
              this.destroy(new Error("connection lost"));
              return;
            }
            if (idx < chunks.length) {
              this.push(chunks[idx++]);
            } else {
              this.push(null);
            }
          },
        });
        return Promise.resolve(stream);
      });

      const resilient = new ResilientStream(factory, {
        maxReconnectAttempts: 3,
        initialReconnectDelay: 10,
        maxReconnectDelay: 50,
      });

      resilient.on("data", (chunk) => allData.push(String(chunk)));

      await resilient.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      resilient.destroy();

      expect(allData).toContain("chunk1");
      // After reconnect, should get data from second stream
      expect(factory.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
