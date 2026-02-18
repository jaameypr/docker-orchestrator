import { describe, it, expect, vi } from "vitest";
import { Orchestrator } from "../../src/core/orchestrator.js";
import { definePreset } from "../../src/core/presets.js";

// ---------------------------------------------------------------------------
// Mock Docker Client
// ---------------------------------------------------------------------------

function createMockContainer(
  id: string,
  overrides?: {
    labels?: Record<string, string>;
    openStdin?: boolean;
    tty?: boolean;
  },
) {
  const defaultInspect = {
    Id: id,
    Name: `/test-${id.substring(0, 8)}`,
    Config: {
      Image: "alpine:3.18",
      Env: [],
      Cmd: null,
      Labels: overrides?.labels ?? {},
      Hostname: "",
      WorkingDir: "",
      User: "",
      Entrypoint: null,
      ExposedPorts: {},
      OpenStdin: overrides?.openStdin ?? false,
      Tty: overrides?.tty ?? false,
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
      Ports: {},
    },
    Mounts: [],
  };

  return {
    id,
    inspect: vi.fn().mockResolvedValue(defaultInspect),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    attach: vi.fn().mockResolvedValue(new (await import("node:stream")).PassThrough()),
    logs: vi.fn().mockResolvedValue(new (await import("node:stream")).PassThrough()),
  };
}

function createMockDocker(options?: {
  containers?: ReturnType<typeof createMockContainer>[];
}) {
  const containers = options?.containers ?? [createMockContainer("abc123def456")];
  let containerIdx = 0;

  return {
    getImage: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({ Id: "sha256:abc123" }),
    }),
    pull: vi.fn().mockReturnValue(Promise.resolve({} as NodeJS.ReadableStream)),
    modem: {
      followProgress: vi.fn().mockImplementation(
        (_stream: unknown, onFinish: (err: Error | null) => void) => {
          onFinish(null);
        },
      ),
    },
    createContainer: vi.fn().mockImplementation(() => {
      const c = containers[containerIdx % containers.length];
      containerIdx++;
      return Promise.resolve(c);
    }),
    getContainer: vi.fn().mockImplementation((id: string) => {
      return containers.find((c) => c.id === id) ?? containers[0];
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
    }),
    listContainers: vi.fn().mockResolvedValue([]),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Orchestrator - Preset Integration", () => {
  describe("presets accessor", () => {
    it("should provide access to preset registry", () => {
      const docker = createMockDocker();
      const orch = new Orchestrator(docker as never);

      expect(orch.presets).toBeDefined();
      expect(typeof orch.presets.register).toBe("function");
      expect(typeof orch.presets.get).toBe("function");
      expect(typeof orch.presets.list).toBe("function");
    });

    it("should allow registering and retrieving presets", () => {
      const docker = createMockDocker();
      const orch = new Orchestrator(docker as never);

      orch.presets.register(definePreset({
        name: "test-preset",
        config: { image: "nginx:latest" },
      }));

      expect(orch.presets.has("test-preset")).toBe(true);
      expect(orch.presets.get("test-preset").config).toEqual({ image: "nginx:latest" });
    });
  });

  describe("deploy with preset", () => {
    it("should merge preset config with user overrides", async () => {
      const container = createMockContainer("preset-container-123");
      const docker = createMockDocker({ containers: [container] });
      const orch = new Orchestrator(docker as never);

      orch.presets.register(definePreset({
        name: "my-preset",
        config: {
          image: "nginx:latest",
          env: { PORT: "80", MODE: "default" },
        },
      }));

      const result = await orch.deploy({
        image: "nginx:latest",
        preset: "my-preset",
        env: { MODE: "custom", EXTRA: "yes" },
      });

      expect(result.containerId).toBe("preset-container-123");
      // The docker config should have the merged env
      const createCall = docker.createContainer.mock.calls[0][0];
      expect(createCall.Env).toContain("PORT=80");
      expect(createCall.Env).toContain("MODE=custom");
      expect(createCall.Env).toContain("EXTRA=yes");
    });

    it("should add preset label to container", async () => {
      const container = createMockContainer("labeled-container");
      const docker = createMockDocker({ containers: [container] });
      const orch = new Orchestrator(docker as never);

      orch.presets.register(definePreset({
        name: "labeled-preset",
        config: { image: "alpine:latest" },
      }));

      await orch.deploy({
        image: "alpine:latest",
        preset: "labeled-preset",
      });

      const createCall = docker.createContainer.mock.calls[0][0];
      expect(createCall.Labels["orchestrator.preset"]).toBe("labeled-preset");
    });
  });

  describe("deploy without preset", () => {
    it("should work normally without preset", async () => {
      const container = createMockContainer("normal-container");
      const docker = createMockDocker({ containers: [container] });
      const orch = new Orchestrator(docker as never);

      const result = await orch.deploy({ image: "alpine:latest" });
      expect(result.containerId).toBe("normal-container");

      const createCall = docker.createContainer.mock.calls[0][0];
      expect(createCall.Labels["orchestrator.preset"]).toBeUndefined();
    });
  });

  describe("attach namespace", () => {
    it("should expose attach.send method", () => {
      const docker = createMockDocker();
      const orch = new Orchestrator(docker as never);

      expect(typeof orch.attach.send).toBe("function");
      expect(typeof orch.attach.sendMany).toBe("function");
      expect(typeof orch.attach.console).toBe("function");
    });
  });
});
