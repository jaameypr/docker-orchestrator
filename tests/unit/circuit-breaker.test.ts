import { describe, it, expect, vi, beforeEach } from "vitest";
import { CircuitBreaker } from "../../src/utils/circuit-breaker.js";
import { CircuitOpenError } from "../../src/errors/base.js";

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 100,
      halfOpenMaxAttempts: 1,
      monitorInterval: 60000,
    });
  });

  it("should start in closed state", () => {
    expect(breaker.getState()).toBe("closed");
  });

  it("should pass through successful calls in closed state", async () => {
    const result = await breaker.execute(async () => "ok");
    expect(result).toBe("ok");
    expect(breaker.getState()).toBe("closed");
  });

  it("should pass through failed calls and count failures", async () => {
    await expect(
      breaker.execute(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");
    expect(breaker.getState()).toBe("closed");
  });

  it("should transition to open after failureThreshold failures", async () => {
    for (let i = 0; i < 3; i++) {
      await breaker
        .execute(async () => {
          throw new Error("fail");
        })
        .catch(() => {});
    }
    expect(breaker.getState()).toBe("open");
  });

  it("should reject calls immediately in open state", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await breaker
        .execute(async () => {
          throw new Error("fail");
        })
        .catch(() => {});
    }

    await expect(breaker.execute(async () => "should not reach")).rejects.toThrow(CircuitOpenError);
  });

  it("should transition to half-open after resetTimeout", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await breaker
        .execute(async () => {
          throw new Error("fail");
        })
        .catch(() => {});
    }
    expect(breaker.getState()).toBe("open");

    // Wait for resetTimeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Next call should be allowed (half-open)
    const result = await breaker.execute(async () => "recovered");
    expect(result).toBe("recovered");
    expect(breaker.getState()).toBe("closed");
  });

  it("should go back to open from half-open on failure", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await breaker
        .execute(async () => {
          throw new Error("fail");
        })
        .catch(() => {});
    }

    // Wait for resetTimeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Fail in half-open state
    await breaker
      .execute(async () => {
        throw new Error("still failing");
      })
      .catch(() => {});

    expect(breaker.getState()).toBe("open");
  });

  it("should emit events on state transitions", async () => {
    const openHandler = vi.fn();
    const halfOpenHandler = vi.fn();
    const closedHandler = vi.fn();

    breaker.on("circuit.open", openHandler);
    breaker.on("circuit.half-open", halfOpenHandler);
    breaker.on("circuit.closed", closedHandler);

    // Trip to open
    for (let i = 0; i < 3; i++) {
      await breaker
        .execute(async () => {
          throw new Error("fail");
        })
        .catch(() => {});
    }
    expect(openHandler).toHaveBeenCalledTimes(1);

    // Wait for half-open
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Succeed in half-open → closed
    await breaker.execute(async () => "ok");
    expect(closedHandler).toHaveBeenCalledTimes(1);
  });

  it("forceReset() should set state to closed", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await breaker
        .execute(async () => {
          throw new Error("fail");
        })
        .catch(() => {});
    }
    expect(breaker.getState()).toBe("open");

    breaker.forceReset();
    expect(breaker.getState()).toBe("closed");

    // Should work normally after reset
    const result = await breaker.execute(async () => "ok");
    expect(result).toBe("ok");
  });

  it("should clean up on destroy", () => {
    breaker.destroy();
    expect(breaker.listenerCount("circuit.open")).toBe(0);
  });
});
