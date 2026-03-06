import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createNetwork,
  removeNetwork,
  inspectNetwork,
  listNetworks,
  connectContainer,
  disconnectContainer,
  pruneNetworks,
} from "../../src/core/network.js";
import {
  NetworkNotFoundError,
  NetworkAlreadyExistsError,
  ContainerStillConnectedError,
  InvalidSubnetError,
} from "../../src/errors/base.js";
import type Docker from "dockerode";

function createMockDocker() {
  return {
    createNetwork: vi.fn(),
    getNetwork: vi.fn(),
    listNetworks: vi.fn(),
    pruneNetworks: vi.fn(),
  } as unknown as Docker & {
    createNetwork: ReturnType<typeof vi.fn>;
    getNetwork: ReturnType<typeof vi.fn>;
    listNetworks: ReturnType<typeof vi.fn>;
    pruneNetworks: ReturnType<typeof vi.fn>;
  };
}

describe("createNetwork", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should create a network with default bridge driver", async () => {
    docker.listNetworks.mockResolvedValue([]);
    docker.createNetwork.mockResolvedValue({ id: "net-123" });

    const id = await createNetwork(docker, { name: "my-network" });

    expect(id).toBe("net-123");
    expect(docker.createNetwork).toHaveBeenCalledWith(
      expect.objectContaining({
        Name: "my-network",
        Driver: "bridge",
      }),
    );
  });

  it("should create a network with overlay driver", async () => {
    docker.listNetworks.mockResolvedValue([]);
    docker.createNetwork.mockResolvedValue({ id: "net-456" });

    await createNetwork(docker, { name: "my-overlay", driver: "overlay" });

    expect(docker.createNetwork).toHaveBeenCalledWith(
      expect.objectContaining({ Driver: "overlay" }),
    );
  });

  it("should create a network with subnet and gateway", async () => {
    docker.listNetworks.mockResolvedValue([]);
    docker.createNetwork.mockResolvedValue({ id: "net-789" });

    await createNetwork(docker, {
      name: "custom-net",
      subnet: "10.0.0.0/24",
      gateway: "10.0.0.1",
    });

    expect(docker.createNetwork).toHaveBeenCalledWith(
      expect.objectContaining({
        IPAM: {
          Driver: "default",
          Config: [{ Subnet: "10.0.0.0/24", Gateway: "10.0.0.1" }],
        },
      }),
    );
  });

  it("should throw NetworkAlreadyExistsError for duplicate name", async () => {
    docker.listNetworks.mockResolvedValue([{ Name: "existing-net" }]);

    await expect(createNetwork(docker, { name: "existing-net" })).rejects.toThrow(
      NetworkAlreadyExistsError,
    );
  });

  it("should pass labels to Docker API", async () => {
    docker.listNetworks.mockResolvedValue([]);
    docker.createNetwork.mockResolvedValue({ id: "net-lab" });

    await createNetwork(docker, {
      name: "labeled-net",
      labels: { env: "test", app: "docker-orch" },
    });

    expect(docker.createNetwork).toHaveBeenCalledWith(
      expect.objectContaining({
        Labels: { env: "test", app: "docker-orch" },
      }),
    );
  });
});

describe("removeNetwork", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should remove a network with no containers", async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    const mockInspect = vi.fn().mockResolvedValue({ Containers: {} });

    docker.getNetwork.mockReturnValue({
      inspect: mockInspect,
      remove: mockRemove,
    });

    await removeNetwork(docker, "net-123");

    expect(mockRemove).toHaveBeenCalled();
  });

  it("should throw ContainerStillConnectedError when containers connected", async () => {
    docker.getNetwork.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Containers: {
          abc123: { Name: "my-container" },
        },
      }),
    });

    await expect(removeNetwork(docker, "net-123")).rejects.toThrow(ContainerStillConnectedError);
  });

  it("should force remove even with connected containers", async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    docker.getNetwork.mockReturnValue({ remove: mockRemove });

    await removeNetwork(docker, "net-123", true);

    expect(mockRemove).toHaveBeenCalled();
  });

  it("should throw NetworkNotFoundError for 404", async () => {
    docker.getNetwork.mockReturnValue({
      inspect: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 })),
    });

    await expect(removeNetwork(docker, "nonexistent")).rejects.toThrow(NetworkNotFoundError);
  });
});

describe("inspectNetwork", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should return formatted network info with containers", async () => {
    docker.getNetwork.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: "net-123",
        Name: "my-network",
        Driver: "bridge",
        Scope: "local",
        Internal: false,
        EnableIPv6: false,
        IPAM: {
          Driver: "default",
          Config: [{ Subnet: "172.18.0.0/16", Gateway: "172.18.0.1" }],
        },
        Containers: {
          abc123: {
            Name: "web-app",
            IPv4Address: "172.18.0.2/16",
            MacAddress: "02:42:ac:12:00:02",
          },
        },
        Labels: { env: "test" },
        Created: "2024-01-01T00:00:00Z",
      }),
    });

    const info = await inspectNetwork(docker, "net-123");

    expect(info.id).toBe("net-123");
    expect(info.name).toBe("my-network");
    expect(info.driver).toBe("bridge");
    expect(info.containers["abc123"].name).toBe("web-app");
    expect(info.ipam.config[0].Subnet).toBe("172.18.0.0/16");
  });

  it("should throw NetworkNotFoundError for 404", async () => {
    docker.getNetwork.mockReturnValue({
      inspect: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 })),
    });

    await expect(inspectNetwork(docker, "nonexistent")).rejects.toThrow(NetworkNotFoundError);
  });
});

describe("connectContainer", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should connect container to network", async () => {
    const mockConnect = vi.fn().mockResolvedValue(undefined);
    docker.getNetwork.mockReturnValue({ connect: mockConnect });

    await connectContainer(docker, "net-123", "container-456");

    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({ Container: "container-456" }),
    );
  });

  it("should pass DNS aliases", async () => {
    const mockConnect = vi.fn().mockResolvedValue(undefined);
    docker.getNetwork.mockReturnValue({ connect: mockConnect });

    await connectContainer(docker, "net-123", "container-456", {
      aliases: ["web", "frontend"],
    });

    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        Container: "container-456",
        EndpointConfig: expect.objectContaining({
          Aliases: ["web", "frontend"],
        }),
      }),
    );
  });

  it("should pass fixed IP address", async () => {
    const mockConnect = vi.fn().mockResolvedValue(undefined);
    const mockInspect = vi.fn().mockResolvedValue({
      IPAM: { Config: [{ Subnet: "10.0.0.0/24" }] },
    });
    docker.getNetwork.mockReturnValue({
      connect: mockConnect,
      inspect: mockInspect,
    });

    await connectContainer(docker, "net-123", "container-456", {
      ipv4Address: "10.0.0.50",
    });

    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        EndpointConfig: expect.objectContaining({
          IPAMConfig: { IPv4Address: "10.0.0.50" },
        }),
      }),
    );
  });

  it("should throw InvalidSubnetError when IP is outside subnet", async () => {
    docker.getNetwork.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        IPAM: { Config: [{ Subnet: "10.0.0.0/24" }] },
      }),
    });

    await expect(
      connectContainer(docker, "net-123", "container-456", {
        ipv4Address: "192.168.1.100",
      }),
    ).rejects.toThrow(InvalidSubnetError);
  });
});

describe("disconnectContainer", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should disconnect container from network", async () => {
    const mockDisconnect = vi.fn().mockResolvedValue(undefined);
    docker.getNetwork.mockReturnValue({ disconnect: mockDisconnect });

    await disconnectContainer(docker, "net-123", "container-456");

    expect(mockDisconnect).toHaveBeenCalledWith({
      Container: "container-456",
      Force: false,
    });
  });

  it("should force disconnect when requested", async () => {
    const mockDisconnect = vi.fn().mockResolvedValue(undefined);
    docker.getNetwork.mockReturnValue({ disconnect: mockDisconnect });

    await disconnectContainer(docker, "net-123", "container-456", true);

    expect(mockDisconnect).toHaveBeenCalledWith({
      Container: "container-456",
      Force: true,
    });
  });

  it("should throw NetworkNotFoundError for 404 on disconnect", async () => {
    docker.getNetwork.mockReturnValue({
      disconnect: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 })),
    });

    await expect(disconnectContainer(docker, "nonexistent-net", "c1")).rejects.toThrow(
      NetworkNotFoundError,
    );
  });

  it("should rethrow generic errors from disconnect", async () => {
    docker.getNetwork.mockReturnValue({
      disconnect: vi.fn().mockRejectedValue(new Error("network error")),
    });

    await expect(disconnectContainer(docker, "net-123", "c1")).rejects.toThrow();
  });
});

describe("listNetworks", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should list all networks", async () => {
    docker.listNetworks.mockResolvedValue([
      {
        Id: "net-1",
        Name: "bridge",
        Driver: "bridge",
        Scope: "local",
        IPAM: { Driver: "default", Config: [] },
        Labels: {},
      },
      {
        Id: "net-2",
        Name: "my-network",
        Driver: "bridge",
        Scope: "local",
        IPAM: { Driver: "default", Config: [] },
        Labels: { env: "test" },
      },
    ]);

    const networks = await listNetworks(docker);

    expect(networks).toHaveLength(2);
    expect(networks[0].name).toBe("bridge");
    expect(networks[1].labels.env).toBe("test");
  });
});

describe("pruneNetworks", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should return deleted network names", async () => {
    docker.pruneNetworks.mockResolvedValue({
      NetworksDeleted: ["unused-net-1", "unused-net-2"],
    });

    const deleted = await pruneNetworks(docker);

    expect(deleted).toEqual(["unused-net-1", "unused-net-2"]);
  });

  it("should default to empty array when NetworksDeleted is null", async () => {
    docker.pruneNetworks.mockResolvedValue({ NetworksDeleted: null });

    const deleted = await pruneNetworks(docker);
    expect(deleted).toEqual([]);
  });
});

describe("createNetwork - error paths", () => {
  it("should throw NetworkAlreadyExistsError for 409 status on create", async () => {
    const docker = createMockDocker();
    docker.listNetworks.mockResolvedValue([]);
    docker.createNetwork.mockRejectedValue(
      Object.assign(new Error("conflict"), { statusCode: 409 }),
    );

    await expect(createNetwork(docker, { name: "dup-net" })).rejects.toThrow(
      NetworkAlreadyExistsError,
    );
  });

  it("should throw NetworkAlreadyExistsError for message-based detection", async () => {
    const docker = createMockDocker();
    docker.listNetworks.mockResolvedValue([]);
    docker.createNetwork.mockRejectedValue(new Error("network already exists"));

    await expect(createNetwork(docker, { name: "dup-net" })).rejects.toThrow(
      NetworkAlreadyExistsError,
    );
  });

  it("should rethrow generic create errors", async () => {
    const docker = createMockDocker();
    docker.listNetworks.mockResolvedValue([]);
    docker.createNetwork.mockRejectedValue(new Error("daemon error"));

    await expect(createNetwork(docker, { name: "fail-net" })).rejects.toThrow();
  });
});

describe("removeNetwork - error on remove", () => {
  it("should throw NetworkNotFoundError for 404 on remove call", async () => {
    const docker = createMockDocker();
    docker.getNetwork.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({ Containers: {} }),
      remove: vi.fn().mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 })),
    });

    await expect(removeNetwork(docker, "gone-net")).rejects.toThrow(NetworkNotFoundError);
  });

  it("should rethrow generic errors on remove", async () => {
    const docker = createMockDocker();
    docker.getNetwork.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({ Containers: {} }),
      remove: vi.fn().mockRejectedValue(new Error("daemon crashed")),
    });

    await expect(removeNetwork(docker, "net-1")).rejects.toThrow();
  });
});

describe("listNetworks - filters", () => {
  it("should pass driver, name, label, and scope filters", async () => {
    const docker = createMockDocker();
    docker.listNetworks.mockResolvedValue([]);

    await listNetworks(docker, {
      driver: "overlay",
      name: "my-net",
      label: ["env=prod"],
      scope: "swarm",
    });

    const call = docker.listNetworks.mock.calls[0][0];
    const filters = JSON.parse(call.filters);
    expect(filters.driver).toEqual(["overlay"]);
    expect(filters.name).toEqual(["my-net"]);
    expect(filters.label).toEqual(["env=prod"]);
    expect(filters.scope).toEqual(["swarm"]);
  });

  it("should not pass filters when none specified", async () => {
    const docker = createMockDocker();
    docker.listNetworks.mockResolvedValue([]);

    await listNetworks(docker);

    expect(docker.listNetworks).toHaveBeenCalledWith({ filters: undefined });
  });

  it("should handle networks with null IPAM", async () => {
    const docker = createMockDocker();
    docker.listNetworks.mockResolvedValue([
      {
        Id: "net-1",
        Name: "no-ipam",
        Driver: "bridge",
        Scope: "local",
        IPAM: null,
        Labels: {},
      },
    ]);

    const networks = await listNetworks(docker);
    expect(networks[0].ipam.driver).toBe("default");
    expect(networks[0].ipam.config).toEqual([]);
  });

  it("should handle networks with null Internal/EnableIPv6/Labels/Created", async () => {
    const docker = createMockDocker();
    docker.listNetworks.mockResolvedValue([
      {
        Id: "net-1",
        Name: "minimal",
        Driver: "bridge",
        Scope: "local",
        Internal: null,
        EnableIPv6: null,
        IPAM: { Driver: "default", Config: [] },
        Labels: null,
        Created: null,
      },
    ]);

    const networks = await listNetworks(docker);
    expect(networks[0].internal).toBe(false);
    expect(networks[0].enableIPv6).toBe(false);
    expect(networks[0].labels).toEqual({});
    expect(networks[0].created).toBe("");
  });
});

describe("connectContainer - error paths", () => {
  it("should throw NetworkNotFoundError for 404 on inspect during IP validation", async () => {
    const docker = createMockDocker();
    docker.getNetwork.mockReturnValue({
      inspect: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 })),
    });

    await expect(
      connectContainer(docker, "net-1", "c1", { ipv4Address: "10.0.0.5" }),
    ).rejects.toThrow(NetworkNotFoundError);
  });

  it("should throw NetworkNotFoundError for 404 on connect call", async () => {
    const docker = createMockDocker();
    docker.getNetwork.mockReturnValue({
      connect: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 })),
    });

    await connectContainer(docker, "net-1", "c1").catch(() => {});

    await expect(connectContainer(docker, "net-1", "c1")).rejects.toThrow(NetworkNotFoundError);
  });

  it("should connect without endpoint config when no options", async () => {
    const docker = createMockDocker();
    const mockConnect = vi.fn().mockResolvedValue(undefined);
    docker.getNetwork.mockReturnValue({ connect: mockConnect });

    await connectContainer(docker, "net-1", "c1");

    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        Container: "c1",
        EndpointConfig: undefined,
      }),
    );
  });

  it("should proceed with connect when inspect fails for non-404 during IP validation", async () => {
    const docker = createMockDocker();
    const mockConnect = vi.fn().mockResolvedValue(undefined);
    docker.getNetwork.mockReturnValue({
      inspect: vi.fn().mockRejectedValue(new Error("server error")),
      connect: mockConnect,
    });

    await connectContainer(docker, "net-1", "c1", { ipv4Address: "10.0.0.5" });

    expect(mockConnect).toHaveBeenCalled();
  });
});
