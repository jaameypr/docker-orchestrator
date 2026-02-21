import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveDependencyOrder, deployStack, destroyStack } from "../../src/core/stack.js";
import { StackConfigSchema } from "../../src/types/stack.js";
import { DependencyResolutionError } from "../../src/errors/base.js";

// ---------------------------------------------------------------------------
// Module mocks for deployStack / destroyStack
// ---------------------------------------------------------------------------

const mockDeploy = vi.hoisted(() => vi.fn());

vi.mock("../../src/core/orchestrator.js", () => ({
  Orchestrator: vi.fn().mockImplementation(() => ({ deploy: mockDeploy })),
}));

vi.mock("../../src/core/network.js", () => ({
  listNetworks: vi.fn().mockResolvedValue([]),
  createNetwork: vi.fn().mockResolvedValue({ id: "net-123" }),
  removeNetwork: vi.fn().mockResolvedValue(undefined),
}));

describe("resolveDependencyOrder", () => {
  it("should return correct order for simple dependencies", () => {
    const order = resolveDependencyOrder({
      web: { dependsOn: ["db", "redis"] },
      db: {},
      redis: {},
    });

    const webIdx = order.indexOf("web");
    const dbIdx = order.indexOf("db");
    const redisIdx = order.indexOf("redis");

    expect(webIdx).toBeGreaterThan(dbIdx);
    expect(webIdx).toBeGreaterThan(redisIdx);
  });

  it("should handle chain dependencies", () => {
    const order = resolveDependencyOrder({
      app: { dependsOn: ["api"] },
      api: { dependsOn: ["db"] },
      db: {},
    });

    expect(order.indexOf("db")).toBeLessThan(order.indexOf("api"));
    expect(order.indexOf("api")).toBeLessThan(order.indexOf("app"));
  });

  it("should handle services with no dependencies", () => {
    const order = resolveDependencyOrder({
      a: {},
      b: {},
      c: {},
    });

    expect(order).toHaveLength(3);
    expect(order).toContain("a");
    expect(order).toContain("b");
    expect(order).toContain("c");
  });

  it("should throw DependencyResolutionError for circular dependencies", () => {
    expect(() =>
      resolveDependencyOrder({
        a: { dependsOn: ["b"] },
        b: { dependsOn: ["c"] },
        c: { dependsOn: ["a"] },
      }),
    ).toThrow(DependencyResolutionError);
  });

  it("should throw for self-referencing dependency", () => {
    expect(() =>
      resolveDependencyOrder({
        a: { dependsOn: ["a"] },
      }),
    ).toThrow(DependencyResolutionError);
  });

  it("should throw when dependsOn references unknown service", () => {
    expect(() =>
      resolveDependencyOrder({
        web: { dependsOn: ["nonexistent"] },
      }),
    ).toThrow(DependencyResolutionError);
  });

  it("should handle complex dependency graph", () => {
    const order = resolveDependencyOrder({
      frontend: { dependsOn: ["api", "cdn"] },
      api: { dependsOn: ["db", "cache"] },
      db: {},
      cache: {},
      cdn: {},
      worker: { dependsOn: ["db", "cache"] },
    });

    expect(order).toHaveLength(6);
    expect(order.indexOf("db")).toBeLessThan(order.indexOf("api"));
    expect(order.indexOf("cache")).toBeLessThan(order.indexOf("api"));
    expect(order.indexOf("api")).toBeLessThan(order.indexOf("frontend"));
    expect(order.indexOf("cdn")).toBeLessThan(order.indexOf("frontend"));
    expect(order.indexOf("db")).toBeLessThan(order.indexOf("worker"));
    expect(order.indexOf("cache")).toBeLessThan(order.indexOf("worker"));
  });
});

describe("StackConfigSchema", () => {
  it("should validate minimal stack config", () => {
    const result = StackConfigSchema.parse({
      name: "my-stack",
      containers: {
        web: { image: "nginx:1.25" },
      },
    });

    expect(result.name).toBe("my-stack");
    expect(result.containers.web).toBeDefined();
  });

  it("should validate full stack config with networks and volumes", () => {
    const result = StackConfigSchema.parse({
      name: "full-stack",
      containers: {
        db: {
          image: "postgres:16",
          env: { POSTGRES_PASSWORD: "secret" },
        },
        web: {
          image: "nginx:1.25",
          dependsOn: ["db"],
          scale: 2,
          ports: [{ container: 80, host: 8080 }],
        },
      },
      networks: {
        backend: {
          driver: "bridge",
          internal: true,
        },
      },
      volumes: {
        pgdata: {
          driver: "local",
        },
      },
    });

    expect(result.containers.web.dependsOn).toEqual(["db"]);
    expect(result.containers.web.scale).toBe(2);
    expect(result.networks!.backend.internal).toBe(true);
    expect(result.volumes!.pgdata.driver).toBe("local");
  });

  it("should apply default scale of 1", () => {
    const result = StackConfigSchema.parse({
      name: "test",
      containers: { web: { image: "nginx:1.25" } },
    });
    expect(result.containers.web.scale).toBe(1);
  });

  it("should reject empty stack name", () => {
    expect(() =>
      StackConfigSchema.parse({
        name: "",
        containers: { web: { image: "nginx" } },
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// deployStack
// ---------------------------------------------------------------------------

function createStackDocker() {
  return {
    listContainers: vi.fn().mockResolvedValue([]),
    getContainer: vi.fn().mockReturnValue({
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    }),
    listNetworks: vi.fn().mockResolvedValue([]),
  };
}

describe("deployStack", () => {
  beforeEach(() => {
    mockDeploy.mockReset();
    mockDeploy.mockResolvedValue({ containerId: "c-mock" });
  });

  it("should return stack result with name and services", async () => {
    const docker = createStackDocker();

    const result = await deployStack(docker as never, {
      name: "mystack",
      containers: { web: { image: "nginx:latest" } },
    });

    expect(result.stackName).toBe("mystack");
    expect(result.services).toHaveLength(1);
    expect(result.services[0].serviceName).toBe("web");
    expect(result.services[0].deployResults[0].containerId).toBe("c-mock");
  });

  it("should deploy services in dependency order", async () => {
    const docker = createStackDocker();
    const deployOrder: string[] = [];

    mockDeploy.mockImplementation((config: { name?: string }) => {
      deployOrder.push(config.name ?? "");
      return Promise.resolve({ containerId: "c-mock" });
    });

    await deployStack(docker as never, {
      name: "mystack",
      containers: {
        web: { image: "nginx:latest", dependsOn: ["db"] },
        db: { image: "postgres:16" },
      },
    });

    expect(deployOrder.indexOf("mystack_db")).toBeLessThan(deployOrder.indexOf("mystack_web"));
  });

  it("should collect warnings when a service deploy fails", async () => {
    const docker = createStackDocker();
    mockDeploy
      .mockResolvedValueOnce({ containerId: "c-db" })
      .mockRejectedValueOnce(new Error("out of memory"));

    const result = await deployStack(docker as never, {
      name: "mystack",
      containers: {
        db: { image: "postgres:16" },
        web: { image: "nginx:latest", dependsOn: ["db"] },
      },
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0].message).toContain("web");
  });

  it("should call onProgress for each deploy step", async () => {
    const docker = createStackDocker();
    const progressEvents: string[] = [];

    await deployStack(
      docker as never,
      {
        name: "mystack",
        containers: { api: { image: "node:20" } },
      },
      (step) => progressEvents.push(step),
    );

    expect(progressEvents).toContain("network");
    expect(progressEvents).toContain("deploy");
  });

  it("should not recreate the stack network if it already exists", async () => {
    const { createNetwork } = await import("../../src/core/network.js");
    const { listNetworks } = await import("../../src/core/network.js");

    vi.mocked(createNetwork).mockClear();
    vi.mocked(listNetworks).mockResolvedValueOnce([{ name: "mystack_default" } as never]);

    const docker = createStackDocker();
    await deployStack(docker as never, {
      name: "mystack",
      containers: { web: { image: "nginx:latest" } },
    });

    // createNetwork should NOT have been called for the default network since it exists
    const createCalls = vi.mocked(createNetwork).mock.calls;
    const defaultNetCalls = createCalls.filter((c) =>
      (c[1] as { name?: string })?.name?.includes("mystack_default"),
    );
    expect(defaultNetCalls).toHaveLength(0);
  });

  it("should create custom networks defined in the stack", async () => {
    const { createNetwork } = await import("../../src/core/network.js");
    vi.mocked(createNetwork).mockClear();

    const docker = createStackDocker();
    await deployStack(docker as never, {
      name: "mystack",
      containers: { web: { image: "nginx:latest" } },
      networks: { backend: { driver: "bridge", internal: true } },
    });

    const networkNames = vi.mocked(createNetwork).mock.calls.map(
      (c) => (c[1] as { name?: string })?.name,
    );
    expect(networkNames.some((n) => n?.includes("backend"))).toBe(true);
  });

  it("should deploy multiple instances when scale > 1", async () => {
    const docker = createStackDocker();

    const result = await deployStack(docker as never, {
      name: "mystack",
      containers: { worker: { image: "node:20", scale: 3 } },
    });

    expect(result.services[0].deployResults).toHaveLength(3);
    expect(mockDeploy).toHaveBeenCalledTimes(3);
  });

  it("should add stack network to container networks on deploy", async () => {
    const docker = createStackDocker();
    const deployedConfigs: unknown[] = [];

    mockDeploy.mockImplementation((config: unknown) => {
      deployedConfigs.push(config);
      return Promise.resolve({ containerId: "c-mock" });
    });

    await deployStack(docker as never, {
      name: "mystack",
      containers: { web: { image: "nginx:latest" } },
    });

    const deployedConfig = deployedConfigs[0] as { networks?: Record<string, unknown> };
    expect(deployedConfig.networks).toHaveProperty("mystack_default");
  });
});

// ---------------------------------------------------------------------------
// destroyStack
// ---------------------------------------------------------------------------

describe("destroyStack", () => {
  it("should stop and remove running containers", async () => {
    const mockStop = vi.fn().mockResolvedValue(undefined);
    const mockRemove = vi.fn().mockResolvedValue(undefined);

    const docker = {
      listContainers: vi.fn().mockResolvedValue([{ Id: "c1", State: "running" }]),
      getContainer: vi.fn().mockReturnValue({ stop: mockStop, remove: mockRemove }),
      listNetworks: vi.fn().mockResolvedValue([]),
    };

    await destroyStack(docker as never, "mystack");

    expect(mockStop).toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalledWith({ force: true, v: false });
  });

  it("should only remove containers that are not running", async () => {
    const mockStop = vi.fn().mockResolvedValue(undefined);
    const mockRemove = vi.fn().mockResolvedValue(undefined);

    const docker = {
      listContainers: vi.fn().mockResolvedValue([{ Id: "c1", State: "exited" }]),
      getContainer: vi.fn().mockReturnValue({ stop: mockStop, remove: mockRemove }),
      listNetworks: vi.fn().mockResolvedValue([]),
    };

    await destroyStack(docker as never, "mystack");

    expect(mockStop).not.toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalled();
  });

  it("should remove stack networks after containers", async () => {
    const { removeNetwork } = await import("../../src/core/network.js");
    vi.mocked(removeNetwork).mockClear();

    const docker = {
      listContainers: vi.fn().mockResolvedValue([]),
      getContainer: vi.fn().mockReturnValue({
        stop: vi.fn(),
        remove: vi.fn().mockResolvedValue(undefined),
      }),
      listNetworks: vi.fn().mockResolvedValue([{ Id: "net1" }, { Id: "net2" }]),
    };

    await destroyStack(docker as never, "mystack");

    expect(vi.mocked(removeNetwork)).toHaveBeenCalledTimes(2);
  });

  it("should pass removeVolumes to container remove", async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);

    const docker = {
      listContainers: vi.fn().mockResolvedValue([{ Id: "c1", State: "exited" }]),
      getContainer: vi.fn().mockReturnValue({ stop: vi.fn(), remove: mockRemove }),
      listNetworks: vi.fn().mockResolvedValue([]),
    };

    await destroyStack(docker as never, "mystack", { removeVolumes: true });

    expect(mockRemove).toHaveBeenCalledWith({ force: true, v: true });
  });

  it("should succeed with an empty stack (no containers or networks)", async () => {
    const docker = {
      listContainers: vi.fn().mockResolvedValue([]),
      getContainer: vi.fn(),
      listNetworks: vi.fn().mockResolvedValue([]),
    };

    await expect(destroyStack(docker as never, "empty-stack")).resolves.toBeUndefined();
  });
});
