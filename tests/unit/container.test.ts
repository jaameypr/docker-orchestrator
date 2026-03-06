import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
  inspectContainer,
  listContainers,
} from "../../src/core/container.js";
import {
  ContainerNotFoundError,
  ContainerAlreadyRunningError,
  ContainerAlreadyStoppedError,
  DockerOrchestratorError,
} from "../../src/errors/base.js";
import type Docker from "dockerode";

function createMockDocker() {
  return {
    createContainer: vi.fn(),
    getContainer: vi.fn(),
    listContainers: vi.fn(),
  } as unknown as Docker & {
    createContainer: ReturnType<typeof vi.fn>;
    getContainer: ReturnType<typeof vi.fn>;
    listContainers: ReturnType<typeof vi.fn>;
  };
}

const fakeInspectData = {
  Id: "abc123",
  Name: "/test-container",
  Config: {
    Image: "alpine:latest",
    Hostname: "test",
    Env: ["FOO=bar"],
    Cmd: ["sh"],
  },
  State: {
    Status: "running",
    Running: true,
    Pid: 1234,
    ExitCode: 0,
    StartedAt: "2024-01-01T00:00:00Z",
    FinishedAt: "0001-01-01T00:00:00Z",
  },
  NetworkSettings: {
    IPAddress: "172.17.0.2",
    Ports: {
      "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }],
    },
  },
};

describe("createContainer", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should create a container and return its ID", async () => {
    docker.createContainer.mockResolvedValue({ id: "new-container-123" });

    const id = await createContainer(docker, { Image: "alpine:latest" });
    expect(id).toBe("new-container-123");
    expect(docker.createContainer).toHaveBeenCalledWith({ Image: "alpine:latest" });
  });

  it("should throw on conflict (name already in use)", async () => {
    const err = Object.assign(new Error("Conflict"), { statusCode: 409 });
    docker.createContainer.mockRejectedValue(err);

    await expect(createContainer(docker, { Image: "alpine", name: "existing" })).rejects.toThrow(
      DockerOrchestratorError,
    );
  });
});

describe("startContainer", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should start a container successfully", async () => {
    docker.getContainer.mockReturnValue({
      start: vi.fn().mockResolvedValue(undefined),
    });

    await expect(startContainer(docker, "abc123")).resolves.toBeUndefined();
  });

  it("should throw ContainerNotFoundError for missing container", async () => {
    docker.getContainer.mockReturnValue({
      start: vi.fn().mockRejectedValue({ statusCode: 404 }),
    });

    await expect(startContainer(docker, "nonexistent")).rejects.toThrow(ContainerNotFoundError);
  });

  it("should throw ContainerAlreadyRunningError for 304 status", async () => {
    docker.getContainer.mockReturnValue({
      start: vi.fn().mockRejectedValue({ statusCode: 304 }),
    });

    await expect(startContainer(docker, "running-container")).rejects.toThrow(
      ContainerAlreadyRunningError,
    );
  });
});

describe("stopContainer", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should stop a container with default timeout", async () => {
    const stopFn = vi.fn().mockResolvedValue(undefined);
    docker.getContainer.mockReturnValue({ stop: stopFn });

    await stopContainer(docker, "abc123");
    expect(stopFn).toHaveBeenCalledWith({ t: 10 });
  });

  it("should stop a container with custom timeout", async () => {
    const stopFn = vi.fn().mockResolvedValue(undefined);
    docker.getContainer.mockReturnValue({ stop: stopFn });

    await stopContainer(docker, "abc123", 30);
    expect(stopFn).toHaveBeenCalledWith({ t: 30 });
  });

  it("should throw ContainerNotFoundError for missing container", async () => {
    docker.getContainer.mockReturnValue({
      stop: vi.fn().mockRejectedValue({ statusCode: 404 }),
    });

    await expect(stopContainer(docker, "nonexistent")).rejects.toThrow(ContainerNotFoundError);
  });

  it("should throw ContainerAlreadyStoppedError for 304 status", async () => {
    docker.getContainer.mockReturnValue({
      stop: vi.fn().mockRejectedValue({ statusCode: 304 }),
    });

    await expect(stopContainer(docker, "stopped-container")).rejects.toThrow(
      ContainerAlreadyStoppedError,
    );
  });
});

describe("removeContainer", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should remove container normally", async () => {
    const removeFn = vi.fn().mockResolvedValue(undefined);
    docker.getContainer.mockReturnValue({ remove: removeFn });

    await removeContainer(docker, "abc123");
    expect(removeFn).toHaveBeenCalledWith({ force: false });
  });

  it("should force-remove container", async () => {
    const removeFn = vi.fn().mockResolvedValue(undefined);
    docker.getContainer.mockReturnValue({ remove: removeFn });

    await removeContainer(docker, "abc123", true);
    expect(removeFn).toHaveBeenCalledWith({ force: true });
  });

  it("should throw ContainerNotFoundError for missing container", async () => {
    docker.getContainer.mockReturnValue({
      remove: vi.fn().mockRejectedValue({ statusCode: 404 }),
    });

    await expect(removeContainer(docker, "nonexistent")).rejects.toThrow(ContainerNotFoundError);
  });
});

describe("inspectContainer", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should inspect and transform container data", async () => {
    docker.getContainer.mockReturnValue({
      inspect: vi.fn().mockResolvedValue(fakeInspectData),
    });

    const result = await inspectContainer(docker, "abc123");
    expect(result.id).toBe("abc123");
    expect(result.name).toBe("test-container");
    expect(result.state.running).toBe(true);
    expect(result.config.env).toEqual(["FOO=bar"]);
    expect(result.networkSettings.ipAddress).toBe("172.17.0.2");
  });

  it("should throw ContainerNotFoundError for missing container", async () => {
    docker.getContainer.mockReturnValue({
      inspect: vi.fn().mockRejectedValue({ statusCode: 404 }),
    });

    await expect(inspectContainer(docker, "nonexistent")).rejects.toThrow(ContainerNotFoundError);
  });

  it("should rethrow non-404 errors from inspect", async () => {
    docker.getContainer.mockReturnValue({
      inspect: vi.fn().mockRejectedValue(new Error("connection refused")),
    });

    await expect(inspectContainer(docker, "abc123")).rejects.toThrow();
  });
});

describe("listContainers", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should list and transform running containers", async () => {
    docker.listContainers.mockResolvedValue([
      {
        Id: "abc123",
        Names: ["/my-container"],
        Image: "alpine:latest",
        State: "running",
        Status: "Up 5 minutes",
        Ports: [{ PrivatePort: 80, PublicPort: 8080, Type: "tcp" }],
        Created: 1700000000,
      },
    ]);

    const containers = await listContainers(docker);
    expect(containers).toHaveLength(1);
    expect(containers[0]).toEqual({
      id: "abc123",
      name: "my-container",
      image: "alpine:latest",
      state: "running",
      status: "Up 5 minutes",
      ports: [{ privatePort: 80, publicPort: 8080, type: "tcp" }],
      created: 1700000000,
    });
  });

  it("should pass all=true to list all containers", async () => {
    docker.listContainers.mockResolvedValue([]);

    await listContainers(docker, true);
    expect(docker.listContainers).toHaveBeenCalledWith({ all: true });
  });

  it("should pass all=false by default", async () => {
    docker.listContainers.mockResolvedValue([]);

    await listContainers(docker);
    expect(docker.listContainers).toHaveBeenCalledWith({ all: false });
  });

  it("should handle containers with no ports", async () => {
    docker.listContainers.mockResolvedValue([
      {
        Id: "abc123",
        Names: ["/no-ports"],
        Image: "alpine",
        State: "running",
        Status: "Up",
        Ports: [],
        Created: 1700000000,
      },
    ]);

    const containers = await listContainers(docker);
    expect(containers[0].ports).toEqual([]);
  });

  it("should rethrow errors from listContainers", async () => {
    docker.listContainers.mockRejectedValue(new Error("daemon error"));
    await expect(listContainers(docker)).rejects.toThrow();
  });

  it("should handle container with missing Names[0]", async () => {
    docker.listContainers.mockResolvedValue([
      {
        Id: "abc123",
        Names: [],
        Image: "alpine",
        State: "running",
        Status: "Up",
        Ports: [],
        Created: 1700000000,
      },
    ]);

    const containers = await listContainers(docker);
    expect(containers[0].name).toBe("");
  });

  it("should handle container with null Ports", async () => {
    docker.listContainers.mockResolvedValue([
      {
        Id: "abc123",
        Names: ["/test"],
        Image: "alpine",
        State: "running",
        Status: "Up",
        Ports: null,
        Created: 1700000000,
      },
    ]);

    const containers = await listContainers(docker);
    expect(containers[0].ports).toEqual([]);
  });
});

describe("startContainer - generic errors", () => {
  it("should rethrow non-404/304 errors", async () => {
    const docker = createMockDocker();
    docker.getContainer.mockReturnValue({
      start: vi.fn().mockRejectedValue(new Error("daemon crashed")),
    });
    await expect(startContainer(docker, "c1")).rejects.toThrow();
  });
});

describe("stopContainer - generic errors", () => {
  it("should rethrow non-404/304 errors", async () => {
    const docker = createMockDocker();
    docker.getContainer.mockReturnValue({
      stop: vi.fn().mockRejectedValue(new Error("daemon crashed")),
    });
    await expect(stopContainer(docker, "c1")).rejects.toThrow();
  });
});

describe("removeContainer - generic errors", () => {
  it("should rethrow non-404 errors", async () => {
    const docker = createMockDocker();
    docker.getContainer.mockReturnValue({
      remove: vi.fn().mockRejectedValue(new Error("daemon crashed")),
    });
    await expect(removeContainer(docker, "c1")).rejects.toThrow();
  });
});

describe("inspectContainer - null fields", () => {
  it("should handle null Env, Cmd, and Ports", async () => {
    const docker = createMockDocker();
    docker.getContainer.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: "abc123",
        Name: "/test",
        Config: {
          Image: "alpine",
          Hostname: "test",
          Env: null,
          Cmd: null,
        },
        State: {
          Status: "running",
          Running: true,
          Pid: 1,
          ExitCode: 0,
          StartedAt: "",
          FinishedAt: "",
        },
        NetworkSettings: {
          IPAddress: "",
          Ports: null,
        },
      }),
    });

    const result = await inspectContainer(docker, "abc123");
    expect(result.config.env).toEqual([]);
    expect(result.config.cmd).toEqual([]);
    expect(result.networkSettings.ports).toEqual({});
  });
});
