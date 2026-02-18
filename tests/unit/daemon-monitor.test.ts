import { describe, it, expect, vi, afterEach } from "vitest";
import type Docker from "dockerode";
import { DaemonMonitor } from "../../src/utils/daemon-monitor.js";

type MockDocker = { ping: ReturnType<typeof vi.fn> };

function createMockDocker(pingResult: "success" | "fail" = "success"): MockDocker {
  return {
    ping: vi.fn().mockImplementation(() => {
      if (pingResult === "fail") {
        return Promise.reject(new Error("ECONNREFUSED"));
      }
      return Promise.resolve("OK");
    }),
  };
}

describe("DaemonMonitor", () => {
  let monitor: DaemonMonitor;

  afterEach(() => {
    monitor?.destroy();
  });

  it("should start in disconnected state", () => {
    const docker = createMockDocker();
    monitor = new DaemonMonitor(docker as unknown as Docker, {
      pingInterval: 100,
      failureThreshold: 2,
    });
    expect(monitor.getState()).toBe("disconnected");
  });

  it("should transition to connected on successful ping", async () => {
    const docker = createMockDocker("success");
    monitor = new DaemonMonitor(docker as unknown as Docker, {
      pingInterval: 5000,
      failureThreshold: 2,
    });
    await monitor.start();
    expect(monitor.getState()).toBe("connected");
  });

  it("should transition to disconnected after failureThreshold ping failures", async () => {
    const docker = createMockDocker("success");
    monitor = new DaemonMonitor(docker as unknown as Docker, {
      pingInterval: 50,
      failureThreshold: 2,
    });
    await monitor.start();
    expect(monitor.getState()).toBe("connected");

    // Make ping fail
    docker.ping.mockRejectedValue(new Error("ECONNREFUSED"));

    // Wait for failures
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(monitor.getState()).toBe("disconnected");
  });

  it("should emit daemon.connected event", async () => {
    const docker = createMockDocker("success");
    monitor = new DaemonMonitor(docker as unknown as Docker, {
      pingInterval: 5000,
      failureThreshold: 2,
    });

    const handler = vi.fn();
    monitor.on("daemon.connected", handler);

    await monitor.start();
    expect(handler).toHaveBeenCalled();
  });

  it("should emit daemon.disconnected event", async () => {
    const docker = createMockDocker("success");
    monitor = new DaemonMonitor(docker as unknown as Docker, {
      pingInterval: 50,
      failureThreshold: 2,
    });

    const handler = vi.fn();
    monitor.on("daemon.disconnected", handler);

    await monitor.start();

    // Make ping fail
    docker.ping.mockRejectedValue(new Error("ECONNREFUSED"));

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(handler).toHaveBeenCalled();
  });

  it("should call onDaemonDisconnect callback", async () => {
    const docker = createMockDocker("success");
    monitor = new DaemonMonitor(docker as unknown as Docker, {
      pingInterval: 50,
      failureThreshold: 2,
    });

    const cb = vi.fn();
    monitor.onDaemonDisconnect(cb);

    await monitor.start();

    docker.ping.mockRejectedValue(new Error("fail"));

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(cb).toHaveBeenCalled();
  });

  it("should call onDaemonReconnect callback after recovery", async () => {
    const docker = createMockDocker("success");
    monitor = new DaemonMonitor(docker as unknown as Docker, {
      pingInterval: 50,
      failureThreshold: 2,
    });

    const reconnectCb = vi.fn();
    monitor.onDaemonReconnect(reconnectCb);

    await monitor.start();
    expect(monitor.getState()).toBe("connected");

    // Disconnect
    docker.ping.mockRejectedValue(new Error("fail"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(monitor.getState()).toBe("disconnected");

    // Reconnect
    docker.ping.mockResolvedValue("OK");
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(monitor.getState()).toBe("connected");
    expect(reconnectCb).toHaveBeenCalled();
  });

  it("should stop periodic pings on stop()", async () => {
    const docker = createMockDocker("success");
    monitor = new DaemonMonitor(docker as unknown as Docker, {
      pingInterval: 50,
      failureThreshold: 2,
    });
    await monitor.start();

    const callCountBefore = docker.ping.mock.calls.length;
    monitor.stop();

    await new Promise((resolve) => setTimeout(resolve, 200));
    // Should not have been called many more times
    expect(docker.ping.mock.calls.length - callCountBefore).toBeLessThan(2);
  });

  it("should clean up on destroy()", () => {
    const docker = createMockDocker("success");
    monitor = new DaemonMonitor(docker as unknown as Docker, {
      pingInterval: 50,
      failureThreshold: 2,
    });
    monitor.destroy();
    expect(monitor.listenerCount("daemon.connected")).toBe(0);
  });
});
