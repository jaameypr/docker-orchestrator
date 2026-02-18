import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractContainerConfig,
  mergeContainerConfig,
  recreateContainer,
} from "../../src/core/container-recreation.js";
import {
  ContainerNotFoundError,
  RecreationFailedError,
  CriticalRecreationError,
} from "../../src/errors/base.js";
import type { ExtractedContainerConfig } from "../../src/types/recreation.js";
import type Docker from "dockerode";

function createMockDocker() {
  return {
    getContainer: vi.fn(),
    createContainer: vi.fn(),
  } as unknown as Docker & {
    getContainer: ReturnType<typeof vi.fn>;
    createContainer: ReturnType<typeof vi.fn>;
  };
}

const fakeInspectData = {
  Id: "old-container-123",
  Name: "/my-app",
  Config: {
    Image: "node:18",
    Env: ["NODE_ENV=production", "PORT=3000"],
    Cmd: ["node", "server.js"],
    Entrypoint: null,
    Hostname: "my-app",
    ExposedPorts: { "3000/tcp": {} },
    Labels: { app: "web", version: "1.0" },
    WorkingDir: "/app",
    User: "",
    Healthcheck: null,
  },
  State: {
    Status: "running",
    Running: true,
    Pid: 1234,
    ExitCode: 0,
    StartedAt: "2024-01-01T00:00:00Z",
    FinishedAt: "0001-01-01T00:00:00Z",
    Health: null,
  },
  HostConfig: {
    PortBindings: { "3000/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }] },
    Binds: ["/data:/app/data"],
    Mounts: [],
    NetworkMode: "bridge",
    Memory: 536870912,
    CpuShares: 1024,
    CpuQuota: 0,
    RestartPolicy: { Name: "always", MaximumRetryCount: 0 },
  },
  NetworkSettings: {
    Networks: {
      bridge: { IPAMConfig: null, Aliases: null },
    },
    IPAddress: "172.17.0.2",
    Ports: {},
  },
};

describe("extractContainerConfig", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should extract config from container inspect data", async () => {
    docker.getContainer.mockReturnValue({
      inspect: vi.fn().mockResolvedValue(fakeInspectData),
    });

    const config = await extractContainerConfig(docker, "old-container-123");

    expect(config.image).toBe("node:18");
    expect(config.name).toBe("my-app");
    expect(config.env).toEqual(["NODE_ENV=production", "PORT=3000"]);
    expect(config.cmd).toEqual(["node", "server.js"]);
    expect(config.hostname).toBe("my-app");
    expect(config.portBindings).toEqual({
      "3000/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }],
    });
    expect(config.binds).toEqual(["/data:/app/data"]);
    expect(config.memoryLimit).toBe(536870912);
    expect(config.cpuShares).toBe(1024);
    expect(config.restartPolicy).toEqual({ Name: "always", MaximumRetryCount: 0 });
    expect(config.labels).toEqual({ app: "web", version: "1.0" });
  });

  it("should throw ContainerNotFoundError for 404", async () => {
    docker.getContainer.mockReturnValue({
      inspect: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 })),
    });

    await expect(extractContainerConfig(docker, "nonexistent")).rejects.toThrow(
      ContainerNotFoundError,
    );
  });

  it("should handle null entrypoint", async () => {
    docker.getContainer.mockReturnValue({
      inspect: vi.fn().mockResolvedValue(fakeInspectData),
    });

    const config = await extractContainerConfig(docker, "old-container-123");
    expect(config.entrypoint).toBeNull();
  });
});

describe("mergeContainerConfig", () => {
  const baseConfig: ExtractedContainerConfig = {
    image: "node:18",
    name: "my-app",
    env: ["NODE_ENV=production", "PORT=3000", "DB_HOST=localhost"],
    cmd: ["node", "server.js"],
    entrypoint: null,
    hostname: "my-app",
    exposedPorts: { "3000/tcp": {} },
    portBindings: { "3000/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }] },
    binds: ["/data:/app/data"],
    mounts: [],
    networkMode: "bridge",
    networks: {},
    memoryLimit: 536870912,
    cpuShares: 1024,
    cpuQuota: 0,
    restartPolicy: { Name: "always", MaximumRetryCount: 0 },
    labels: { app: "web", version: "1.0" },
    workingDir: "/app",
    user: "",
  };

  it("should merge env vars key-based (new value wins)", () => {
    const merged = mergeContainerConfig(baseConfig, {
      env: { NODE_ENV: "staging", NEW_VAR: "hello" },
    });

    expect(merged.env).toContain("NODE_ENV=staging");
    expect(merged.env).toContain("PORT=3000");
    expect(merged.env).toContain("DB_HOST=localhost");
    expect(merged.env).toContain("NEW_VAR=hello");
    // Old NODE_ENV=production should be replaced
    expect(merged.env).not.toContain("NODE_ENV=production");
  });

  it("should override image", () => {
    const merged = mergeContainerConfig(baseConfig, { image: "node:20" });
    expect(merged.image).toBe("node:20");
  });

  it("should override cmd", () => {
    const merged = mergeContainerConfig(baseConfig, { cmd: ["node", "worker.js"] });
    expect(merged.cmd).toEqual(["node", "worker.js"]);
  });

  it("should merge labels key-based", () => {
    const merged = mergeContainerConfig(baseConfig, {
      labels: { version: "2.0", tier: "frontend" },
    });
    expect(merged.labels).toEqual({ app: "web", version: "2.0", tier: "frontend" });
  });

  it("should merge ports additively with merge strategy", () => {
    const merged = mergeContainerConfig(baseConfig, {
      portOverrides: [{ container: 9090, host: 9090, protocol: "tcp" }],
      portStrategy: "merge",
    });

    expect(merged.exposedPorts["3000/tcp"]).toBeDefined();
    expect(merged.exposedPorts["9090/tcp"]).toBeDefined();
  });

  it("should replace ports with replace strategy", () => {
    const merged = mergeContainerConfig(baseConfig, {
      portOverrides: [{ container: 9090, host: 9090, protocol: "tcp" }],
      portStrategy: "replace",
    });

    expect(merged.exposedPorts["3000/tcp"]).toBeUndefined();
    expect(merged.exposedPorts["9090/tcp"]).toBeDefined();
  });

  it("should add volumes additively", () => {
    const merged = mergeContainerConfig(baseConfig, {
      volumes: [{ host: "/logs", container: "/app/logs", readOnly: false }],
    });

    expect(merged.binds).toContain("/data:/app/data");
    expect(merged.binds).toContain("/logs:/app/logs");
  });

  it("should not duplicate existing volumes", () => {
    const merged = mergeContainerConfig(baseConfig, {
      volumes: [{ host: "/data", container: "/app/data", readOnly: false }],
    });

    const count = merged.binds.filter((b) => b === "/data:/app/data").length;
    expect(count).toBe(1);
  });

  it("should update memory limit", () => {
    const merged = mergeContainerConfig(baseConfig, { memoryLimit: 1073741824 });
    expect(merged.memoryLimit).toBe(1073741824);
  });

  it("should update restart policy", () => {
    const merged = mergeContainerConfig(baseConfig, { restartPolicy: "unless-stopped" });
    expect(merged.restartPolicy.Name).toBe("unless-stopped");
  });

  it("should not modify original config", () => {
    const originalEnv = [...baseConfig.env];
    mergeContainerConfig(baseConfig, { env: { NEW: "var" } });
    expect(baseConfig.env).toEqual(originalEnv);
  });
});

describe("recreateContainer", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should execute recreation workflow in correct order", async () => {
    const callOrder: string[] = [];

    const oldContainer = {
      inspect: vi.fn().mockResolvedValue(fakeInspectData),
      stop: vi.fn().mockImplementation(() => {
        callOrder.push("old.stop");
        return Promise.resolve();
      }),
      rename: vi.fn().mockImplementation(() => {
        callOrder.push("old.rename");
        return Promise.resolve();
      }),
      remove: vi.fn().mockImplementation(() => {
        callOrder.push("old.remove");
        return Promise.resolve();
      }),
    };

    const newContainer = {
      rename: vi.fn().mockImplementation(() => {
        callOrder.push("new.rename");
        return Promise.resolve();
      }),
      start: vi.fn().mockImplementation(() => {
        callOrder.push("new.start");
        return Promise.resolve();
      }),
      inspect: vi.fn().mockResolvedValue({
        ...fakeInspectData,
        Config: { ...fakeInspectData.Config, Healthcheck: null },
      }),
    };

    // getContainer returns different mocks depending on ID
    docker.getContainer.mockImplementation((id: string) => {
      if (id === "old-container-123") return oldContainer;
      return newContainer; // new container
    });

    docker.createContainer.mockImplementation(() => {
      callOrder.push("create");
      return Promise.resolve({ id: "new-container-456" });
    });

    const result = await recreateContainer(docker, "old-container-123", {
      env: { NODE_ENV: "staging" },
    });

    expect(result.oldContainerId).toBe("old-container-123");
    expect(result.newContainerId).toBe("new-container-456");
    expect(result.rollbackStatus).toBe("not_needed");

    // Verify order: create → stop → rename old → rename new → start new
    expect(callOrder).toEqual([
      "create",
      "old.stop",
      "old.rename",
      "new.rename",
      "new.start",
      "old.remove",
    ]);
  });

  it("should rollback when new container fails to start", async () => {
    const oldContainer = {
      inspect: vi.fn().mockResolvedValue(fakeInspectData),
      stop: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
    };

    const newContainer = {
      rename: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockRejectedValue(new Error("start failed")),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue(fakeInspectData),
    };

    docker.getContainer.mockImplementation((id: string) => {
      if (id === "old-container-123") return oldContainer;
      return newContainer;
    });

    docker.createContainer.mockResolvedValue({ id: "new-container-789" });

    await expect(recreateContainer(docker, "old-container-123")).rejects.toThrow(
      RecreationFailedError,
    );

    // Verify rollback happened: old container was renamed back and restarted
    expect(oldContainer.rename).toHaveBeenCalledTimes(2); // once forward, once back
    expect(oldContainer.start).toHaveBeenCalled();
  });

  it("should throw CriticalRecreationError when recreation AND rollback fail", async () => {
    const oldContainer = {
      inspect: vi.fn().mockResolvedValue(fakeInspectData),
      stop: vi.fn().mockResolvedValue(undefined),
      rename: vi
        .fn()
        .mockResolvedValueOnce(undefined) // First rename succeeds
        .mockRejectedValueOnce(new Error("rename failed")), // Rollback rename fails
      start: vi.fn().mockResolvedValue(undefined),
    };

    const newContainer = {
      rename: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockRejectedValue(new Error("start failed")),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue(fakeInspectData),
    };

    docker.getContainer.mockImplementation((id: string) => {
      if (id === "old-container-123") return oldContainer;
      return newContainer;
    });

    docker.createContainer.mockResolvedValue({ id: "new-container-fail" });

    await expect(recreateContainer(docker, "old-container-123")).rejects.toThrow(
      CriticalRecreationError,
    );
  });

  it("should not stop container if already stopped", async () => {
    const stoppedInspect = {
      ...fakeInspectData,
      State: { ...fakeInspectData.State, Running: false },
    };

    const oldContainer = {
      inspect: vi.fn().mockResolvedValue(stoppedInspect),
      stop: vi.fn(),
      rename: vi.fn().mockResolvedValue(undefined),
    };

    const newContainer = {
      rename: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({
        ...stoppedInspect,
        Config: { ...stoppedInspect.Config, Healthcheck: null },
      }),
    };

    docker.getContainer.mockImplementation((id: string) => {
      if (id === "old-container-123") return oldContainer;
      return newContainer;
    });

    docker.createContainer.mockResolvedValue({ id: "new-container-456" });

    await recreateContainer(docker, "old-container-123");

    // Stop should not have been called
    expect(oldContainer.stop).not.toHaveBeenCalled();
  });
});
