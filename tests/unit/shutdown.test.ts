import { describe, it, expect, vi } from "vitest";
import { ShutdownManager } from "../../src/utils/shutdown.js";

describe("ShutdownManager", () => {
  it("should execute registered cleanup callbacks", async () => {
    const manager = new ShutdownManager({ timeout: 5000 });
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    manager.register("cb1", cb1);
    manager.register("cb2", cb2);

    await manager.shutdown();

    expect(cb1).toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
  });

  it("should execute callbacks in reverse order (LIFO)", async () => {
    const order: string[] = [];
    const manager = new ShutdownManager({ timeout: 5000 });

    manager.register("first", () => order.push("first"));
    manager.register("second", () => order.push("second"));
    manager.register("third", () => order.push("third"));

    await manager.shutdown();

    expect(order).toEqual(["third", "second", "first"]);
  });

  it("should handle async cleanup callbacks", async () => {
    const manager = new ShutdownManager({ timeout: 5000 });
    const results: string[] = [];

    manager.register("async", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      results.push("done");
    });

    await manager.shutdown();
    expect(results).toEqual(["done"]);
  });

  it("should continue with other callbacks if one fails", async () => {
    const manager = new ShutdownManager({ timeout: 5000 });
    const cb2 = vi.fn();

    manager.register("failing", () => {
      throw new Error("cleanup failed");
    });
    manager.register("succeeding", cb2);

    await manager.shutdown();
    expect(cb2).toHaveBeenCalled();
  });

  it("should timeout if cleanup takes too long", async () => {
    const manager = new ShutdownManager({ timeout: 50 });

    manager.register("slow", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    });

    // Should complete within the timeout (not hang)
    const start = Date.now();
    await manager.shutdown();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });

  it("should not run shutdown twice concurrently", async () => {
    const manager = new ShutdownManager({ timeout: 5000 });
    const cb = vi.fn();
    manager.register("cb", cb);

    // Start two shutdowns
    await Promise.all([manager.shutdown(), manager.shutdown()]);

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("should report isShuttingDown correctly", async () => {
    const manager = new ShutdownManager({ timeout: 5000 });
    let wasShuttingDown = false;

    manager.register("check", () => {
      wasShuttingDown = manager.isShuttingDown();
    });

    expect(manager.isShuttingDown()).toBe(false);
    await manager.shutdown();
    expect(wasShuttingDown).toBe(true);
    expect(manager.isShuttingDown()).toBe(false);
  });

  it("should allow unregistering callbacks", async () => {
    const manager = new ShutdownManager({ timeout: 5000 });
    const cb = vi.fn();

    manager.register("removable", cb);
    manager.unregister("removable");

    await manager.shutdown();
    expect(cb).not.toHaveBeenCalled();
  });

  it("should unregister be a no-op for non-existent name", async () => {
    const manager = new ShutdownManager({ timeout: 5000 });
    manager.unregister("does-not-exist"); // should not throw
  });

  it("should install and remove signal handlers", () => {
    const manager = new ShutdownManager({ timeout: 5000 });
    const onSpy = vi.spyOn(process, "on").mockImplementation(() => process);
    const removeListenerSpy = vi.spyOn(process, "removeListener").mockImplementation(() => process);

    manager.installSignalHandlers();
    expect(onSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));

    manager.removeSignalHandlers();
    expect(removeListenerSpy).toHaveBeenCalledTimes(2);

    onSpy.mockRestore();
    removeListenerSpy.mockRestore();
  });

  it("should handle non-Error thrown in cleanup", async () => {
    const manager = new ShutdownManager({ timeout: 5000 });
    const cb2 = vi.fn();

    manager.register("string-thrower", () => {
      throw "string error";
    });
    manager.register("succeeding", cb2);

    await manager.shutdown();
    expect(cb2).toHaveBeenCalled();
  });

  it("should log shutdown messages with logger", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const manager = new ShutdownManager({ timeout: 5000, logger });
    manager.register("test-cb", () => {});

    await manager.shutdown();
    expect(logger.info).toHaveBeenCalledWith("Graceful shutdown started");
    expect(logger.debug).toHaveBeenCalledWith("Running cleanup: test-cb");
    expect(logger.debug).toHaveBeenCalledWith("Cleanup completed: test-cb");
    expect(logger.info).toHaveBeenCalledWith("Graceful shutdown completed");
  });
});
