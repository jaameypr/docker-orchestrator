import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator, createOrchestrator } from "../../src/core/orchestrator.js";
import { DeploymentFailedError, ImagePullError } from "../../src/errors/base.js";

// ---------------------------------------------------------------------------
// Mock Docker Client
// ---------------------------------------------------------------------------

function createMockContainer(
  id: string,
  overrides?: Partial<{
    inspectData: Record<string, unknown>;
    startFail: boolean;
  }>,
) {
  const defaultInspect = {
    Id: id,
    Name: `/test-${id.substring(0, 8)}`,
    Config: {
      Image: "alpine:3.18",
      Env: [],
      Cmd: null,
      Labels: {},
      Hostname: "",
      WorkingDir: "",
      User: "",
      Entrypoint: null,
      ExposedPorts: {},
    },
    State: {
      Status: "running",
      Running: true,
      Health: { Status: "healthy" },
    },
    HostConfig: {
      PortBindings: {},
      Binds: [],
      RestartPolicy: { Name: "no", MaximumRetryCount: 0 },
      NetworkMode: "default",
      Memory: 0,
      CpuShares: 0,
      CpuQuota: 0,
    },
    NetworkSettings: {
      Networks: {},
      Ports: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }] },
    },
    Mounts: [],
    ...(overrides?.inspectData ?? {}),
  };

  return {
    id,
    inspect: vi.fn().mockResolvedValue(defaultInspect),
    start: overrides?.startFail
      ? vi.fn().mockRejectedValue(new Error("start failed"))
      : vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockDocker(options?: {
  imageExists?: boolean;
  containers?: ReturnType<typeof createMockContainer>[];
  createFail?: boolean;
  listContainers?: Array<Record<string, unknown>>;
}) {
  const containers = options?.containers ?? [createMockContainer("abc123def456")];
  let containerIdx = 0;

  const mock = {
    getImage: vi.fn().mockReturnValue({
      inspect: options?.imageExists === false
        ? vi.fn().mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 }))
        : vi.fn().mockResolvedValue({ Id: "sha256:abc123" }),
    }),
    pull: vi.fn().mockImplementation((_name: string) => {
      return Promise.resolve({} as NodeJS.ReadableStream);
    }),
    modem: {
      followProgress: vi.fn().mockImplementation(
        (_stream: unknown, onFinish: (err: Error | null) => void) => {
          onFinish(null);
        },
      ),
    },
    createContainer: options?.createFail
      ? vi.fn().mockRejectedValue(new Error("create failed"))
      : vi.fn().mockImplementation(() => {
          const c = containers[containerIdx % containers.length];
          containerIdx++;
          return Promise.resolve(c);
        }),
    getContainer: vi.fn().mockImplementation((id: string) => {
      const c = containers.find((c) => c.id === id) ?? containers[0];
      return c;
    }),
    getVolume: vi.fn().mockReturnValue({
      inspect: vi.fn().mockRejectedValue(
        Object.assign(new Error("not found"), { statusCode: 404 }),
      ),
    }),
    createVolume: vi.fn().mockResolvedValue({ Name: "test-vol" }),
    listNetworks: vi.fn().mockResolvedValue([]),
    createNetwork: vi.fn().mockResolvedValue({ id: "net-123" }),
    getNetwork: vi.fn().mockReturnValue({
      connect: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({ Containers: {} }),
      remove: vi.fn().mockResolvedValue(undefined),
    }),
    listContainers: vi.fn().mockResolvedValue(options?.listContainers ?? []),
  };

  return mock;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Orchestrator", () => {
  describe("constructor", () => {
    it("should create with defaults", () => {
      const docker = createMockDocker();
      const orch = new Orchestrator(docker as never);
      expect(orch).toBeDefined();
      expect(orch.client).toBe(docker);
    });

    it("should accept options", () => {
      const docker = createMockDocker();
      const orch = new Orchestrator(docker as never, {
        defaultNetwork: "my-net",
        defaultSecurityProfile: "hardened",
      });
      expect(orch).toBeDefined();
    });
  });

  describe("createOrchestrator factory", () => {
    it("should create Orchestrator instance", () => {
      const docker = createMockDocker();
      const orch = createOrchestrator(docker as never);
      expect(orch).toBeInstanceOf(Orchestrator);
    });
  });

  describe("deploy", () => {
    it("should deploy container with all steps in order", async () => {
      const container = createMockContainer("abc123def456");
      const docker = createMockDocker({ containers: [container] });
      const orch = new Orchestrator(docker as never);

      const steps: string[] = [];
      const result = await orch.deploy(
        { image: "alpine:3.18", name: "test-deploy" },
        (step) => steps.push(step),
      );

      expect(result.containerId).toBe("abc123def456");
      expect(result.name).toBe("test-deploy");
      expect(result.status).toBe("running");
      expect(result.warnings).toBeInstanceOf(Array);

      // Verify steps occurred
      expect(steps).toContain("validate");
      expect(steps).toContain("image");
      expect(steps).toContain("create");
      expect(steps).toContain("start");
    });

    it("should pull image when not found locally", async () => {
      const container = createMockContainer("abc123def456");
      const docker = createMockDocker({
        imageExists: false,
        containers: [container],
      });
      const orch = new Orchestrator(docker as never);

      const steps: string[] = [];
      await orch.deploy(
        { image: "alpine:3.18", name: "test-pull" },
        (step) => steps.push(step),
      );

      expect(steps).toContain("pull");
    });

    it("should throw DeploymentFailedError on create failure", async () => {
      const docker = createMockDocker({ createFail: true });
      const orch = new Orchestrator(docker as never);

      await expect(
        orch.deploy({ image: "alpine:3.18", name: "test-fail" }),
      ).rejects.toThrow(DeploymentFailedError);
    });

    it("should throw DeploymentFailedError on start failure and clean up", async () => {
      const container = createMockContainer("abc123def456", {
        startFail: true,
      });
      const docker = createMockDocker({ containers: [container] });
      const orch = new Orchestrator(docker as never);

      await expect(
        orch.deploy({ image: "alpine:3.18", name: "test-start-fail" }),
      ).rejects.toThrow(DeploymentFailedError);

      // Container should have been cleaned up
      expect(container.remove).toHaveBeenCalled();
    });

    it("should set orchestrator labels", async () => {
      const container = createMockContainer("abc123def456");
      const docker = createMockDocker({ containers: [container] });
      const orch = new Orchestrator(docker as never);

      await orch.deploy({ image: "alpine:3.18", name: "test-labels" });

      const createCall = docker.createContainer.mock.calls[0][0];
      expect(createCall.Labels["orchestrator.managed"]).toBe("true");
      expect(createCall.Labels["orchestrator.deployed-at"]).toBeDefined();
    });

    it("should apply default network from options", async () => {
      const container = createMockContainer("abc123def456");
      const docker = createMockDocker({ containers: [container] });
      const orch = new Orchestrator(docker as never, {
        defaultNetwork: "custom-net",
      });

      await orch.deploy({ image: "alpine:3.18", name: "test-network" });

      // Should have checked/created the default network
      expect(docker.listNetworks).toHaveBeenCalled();
    });

    it("should resolve port mappings from running container", async () => {
      const container = createMockContainer("abc123def456");
      const docker = createMockDocker({ containers: [container] });
      const orch = new Orchestrator(docker as never);

      const result = await orch.deploy({
        image: "nginx:1.25",
        name: "web",
        ports: [{ container: 80, host: 8080 }],
      });

      expect(result.ports.length).toBeGreaterThan(0);
      expect(result.ports[0].containerPort).toBe(80);
      expect(result.ports[0].hostPort).toBe(8080);
    });
  });

  describe("destroy", () => {
    it("should stop and remove container", async () => {
      const container = createMockContainer("abc123def456");
      const docker = createMockDocker({ containers: [container] });
      const orch = new Orchestrator(docker as never);

      await orch.destroy("abc123def456");

      expect(container.stop).toHaveBeenCalled();
      expect(container.remove).toHaveBeenCalled();
    });

    it("should force stop when force option is set", async () => {
      const container = createMockContainer("abc123def456");
      const docker = createMockDocker({ containers: [container] });
      const orch = new Orchestrator(docker as never);

      await orch.destroy("abc123def456", { force: true });

      expect(container.stop).toHaveBeenCalledWith({ t: 0 });
    });

    it("should respect custom timeout", async () => {
      const container = createMockContainer("abc123def456");
      const docker = createMockDocker({ containers: [container] });
      const orch = new Orchestrator(docker as never);

      await orch.destroy("abc123def456", { timeout: 30 });

      expect(container.stop).toHaveBeenCalledWith({ t: 30 });
    });
  });

  describe("deployMany", () => {
    it("should deploy multiple containers", async () => {
      const containers = [
        createMockContainer("aaa111"),
        createMockContainer("bbb222"),
        createMockContainer("ccc333"),
      ];
      const docker = createMockDocker({ containers });
      const orch = new Orchestrator(docker as never);

      const result = await orch.deployMany([
        { image: "alpine:3.18", name: "svc-1" },
        { image: "alpine:3.18", name: "svc-2" },
        { image: "alpine:3.18", name: "svc-3" },
      ]);

      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.results.length).toBe(3);
    });

    it("should handle partial failures", async () => {
      const goodContainer = createMockContainer("aaa111");
      const badContainer = createMockContainer("bbb222", { startFail: true });
      const docker = createMockDocker({
        containers: [goodContainer, badContainer],
      });
      const orch = new Orchestrator(docker as never);

      const result = await orch.deployMany([
        { image: "alpine:3.18", name: "good" },
        { image: "alpine:3.18", name: "bad" },
      ]);

      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results.length).toBe(2);
    });

    it("should respect concurrency limit", async () => {
      const containers = Array.from({ length: 10 }, (_, i) =>
        createMockContainer(`container-${i}`),
      );
      const docker = createMockDocker({ containers });
      const orch = new Orchestrator(docker as never);

      const configs = Array.from({ length: 10 }, (_, i) => ({
        image: "alpine:3.18",
        name: `svc-${i}`,
      }));

      const result = await orch.deployMany(configs, { concurrency: 3 });
      expect(result.succeeded).toBe(10);
    });
  });

  describe("destroyMany", () => {
    it("should destroy multiple containers", async () => {
      const containers = [
        createMockContainer("aaa111"),
        createMockContainer("bbb222"),
      ];
      const docker = createMockDocker({ containers });
      const orch = new Orchestrator(docker as never);

      const result = await orch.destroyMany(["aaa111", "bbb222"]);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
    });
  });

  describe("listManagedContainers", () => {
    it("should return only orchestrator-managed containers", async () => {
      const docker = createMockDocker({
        listContainers: [
          {
            Id: "abc123",
            Names: ["/my-container"],
            State: "running",
            Labels: {
              "orchestrator.managed": "true",
              "orchestrator.deployed-at": "2024-01-01T00:00:00Z",
            },
          },
        ],
      });
      const orch = new Orchestrator(docker as never);

      const managed = await orch.listManagedContainers();
      expect(managed.length).toBe(1);
      expect(managed[0].containerId).toBe("abc123");
      expect(managed[0].name).toBe("my-container");
      expect(managed[0].deployedAt).toBe("2024-01-01T00:00:00Z");
    });
  });

  describe("syncState", () => {
    it("should detect orphaned containers", async () => {
      const docker = createMockDocker({
        listContainers: [
          {
            Id: "orphan-123",
            Names: ["/orphan"],
            State: "running",
            Labels: { "orchestrator.managed": "true" },
          },
        ],
      });
      const orch = new Orchestrator(docker as never);

      const { synced, orphans } = await orch.syncState();
      expect(synced).toBe(0);
      expect(orphans).toContain("orphan-123");
    });
  });
});
