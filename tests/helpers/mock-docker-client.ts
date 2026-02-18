/**
 * Creates a fully mocked dockerode client for unit testing.
 * All methods are vi.fn() stubs that can be configured per test.
 */
import { vi } from "vitest";
import type Docker from "dockerode";

export interface MockContainer {
  id: string;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  restart: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  unpause: ReturnType<typeof vi.fn>;
  inspect: ReturnType<typeof vi.fn>;
  logs: ReturnType<typeof vi.fn>;
  stats: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
  getArchive: ReturnType<typeof vi.fn>;
  putArchive: ReturnType<typeof vi.fn>;
  wait: ReturnType<typeof vi.fn>;
  rename: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  top: ReturnType<typeof vi.fn>;
}

export interface MockNetwork {
  id: string;
  inspect: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

export interface MockVolume {
  name: string;
  inspect: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

export interface MockExec {
  id: string;
  start: ReturnType<typeof vi.fn>;
  inspect: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
}

export interface MockImage {
  inspect: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  tag: ReturnType<typeof vi.fn>;
}

export interface MockDockerClient {
  // Container operations
  createContainer: ReturnType<typeof vi.fn>;
  getContainer: ReturnType<typeof vi.fn>;
  listContainers: ReturnType<typeof vi.fn>;

  // Image operations
  getImage: ReturnType<typeof vi.fn>;
  listImages: ReturnType<typeof vi.fn>;
  pull: ReturnType<typeof vi.fn>;
  createImage: ReturnType<typeof vi.fn>;

  // Network operations
  createNetwork: ReturnType<typeof vi.fn>;
  getNetwork: ReturnType<typeof vi.fn>;
  listNetworks: ReturnType<typeof vi.fn>;
  pruneNetworks: ReturnType<typeof vi.fn>;

  // Volume operations
  createVolume: ReturnType<typeof vi.fn>;
  getVolume: ReturnType<typeof vi.fn>;
  listVolumes: ReturnType<typeof vi.fn>;
  pruneVolumes: ReturnType<typeof vi.fn>;

  // System operations
  ping: ReturnType<typeof vi.fn>;
  version: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  getEvents: ReturnType<typeof vi.fn>;
  df: ReturnType<typeof vi.fn>;

  // Raw access for type casting
  modem: { followProgress: ReturnType<typeof vi.fn> };
}

/**
 * Creates a fully mocked dockerode client.
 * All methods return vi.fn() stubs.
 * Can be cast to Docker when passing to functions under test.
 */
export function createMockDockerClient(): MockDockerClient & Docker {
  const mock: MockDockerClient = {
    // Container operations
    createContainer: vi.fn(),
    getContainer: vi.fn(),
    listContainers: vi.fn(),

    // Image operations
    getImage: vi.fn(),
    listImages: vi.fn(),
    pull: vi.fn(),
    createImage: vi.fn(),

    // Network operations
    createNetwork: vi.fn(),
    getNetwork: vi.fn(),
    listNetworks: vi.fn(),
    pruneNetworks: vi.fn(),

    // Volume operations
    createVolume: vi.fn(),
    getVolume: vi.fn(),
    listVolumes: vi.fn(),
    pruneVolumes: vi.fn(),

    // System operations
    ping: vi.fn().mockResolvedValue("OK"),
    version: vi.fn().mockResolvedValue({
      Version: "24.0.0",
      ApiVersion: "1.43",
      Os: "linux",
      Arch: "amd64",
      KernelVersion: "5.15.0",
    }),
    info: vi.fn().mockResolvedValue({}),
    getEvents: vi.fn(),
    df: vi.fn(),

    // Modem for pull progress
    modem: { followProgress: vi.fn() },
  };

  return mock as MockDockerClient & Docker;
}

export interface MockContainerOptions {
  id?: string;
  name?: string;
  state?: "created" | "running" | "paused" | "restarting" | "exited" | "dead";
  image?: string;
  exitCode?: number;
  env?: string[];
  cmd?: string[];
  ports?: Record<string, Array<{ HostIp: string; HostPort: string }> | null>;
  ipAddress?: string;
  pid?: number;
}

/**
 * Creates a mock container object with configurable state.
 * Includes commonly used methods as vi.fn() stubs.
 */
export function createMockContainer(options: MockContainerOptions = {}): MockContainer {
  const {
    id = "mock-container-" + Math.random().toString(36).slice(2, 10),
    name = "mock-container",
    state = "running",
    image = "alpine:latest",
    exitCode = 0,
    env = [],
    cmd = ["sh"],
    ports = {},
    ipAddress = "172.17.0.2",
    pid = 1234,
  } = options;

  const isRunning = state === "running";

  const inspectData = {
    Id: id,
    Name: `/${name}`,
    Config: {
      Image: image,
      Hostname: name.slice(0, 12),
      Env: env,
      Cmd: cmd,
      Labels: {},
      ExposedPorts: {},
    },
    State: {
      Status: state,
      Running: isRunning,
      Paused: state === "paused",
      Restarting: state === "restarting",
      Dead: state === "dead",
      Pid: isRunning ? pid : 0,
      ExitCode: exitCode,
      StartedAt: isRunning ? "2024-01-01T00:00:00Z" : "0001-01-01T00:00:00Z",
      FinishedAt: state === "exited" ? "2024-01-01T01:00:00Z" : "0001-01-01T00:00:00Z",
    },
    NetworkSettings: {
      IPAddress: ipAddress,
      Ports: ports,
      Networks: {
        bridge: {
          IPAddress: ipAddress,
          Gateway: "172.17.0.1",
          MacAddress: "02:42:ac:11:00:02",
        },
      },
    },
    HostConfig: {
      Binds: [],
      PortBindings: {},
      RestartPolicy: { Name: "no", MaximumRetryCount: 0 },
      NetworkMode: "bridge",
      Memory: 0,
      NanoCpus: 0,
      CapAdd: null,
      CapDrop: null,
      ReadonlyRootfs: false,
    },
    Mounts: [],
  };

  return {
    id,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    unpause: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue(inspectData),
    logs: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    stats: vi.fn().mockResolvedValue({}),
    exec: vi.fn(),
    getArchive: vi.fn(),
    putArchive: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue({ StatusCode: exitCode }),
    rename: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    top: vi.fn().mockResolvedValue({ Processes: [], Titles: [] }),
  };
}

/**
 * Creates a mock network object.
 */
export function createMockNetwork(
  id = "mock-network-" + Math.random().toString(36).slice(2, 10),
): MockNetwork {
  return {
    id,
    inspect: vi.fn().mockResolvedValue({
      Id: id,
      Name: "mock-network",
      Driver: "bridge",
      Scope: "local",
      IPAM: {
        Config: [{ Subnet: "172.18.0.0/16", Gateway: "172.18.0.1" }],
      },
      Containers: {},
      Options: {},
      Labels: {},
    }),
    remove: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Creates a mock volume object.
 */
export function createMockVolume(
  name = "mock-volume-" + Math.random().toString(36).slice(2, 10),
): MockVolume {
  return {
    name,
    inspect: vi.fn().mockResolvedValue({
      Name: name,
      Driver: "local",
      Mountpoint: `/var/lib/docker/volumes/${name}/_data`,
      CreatedAt: "2024-01-01T00:00:00Z",
      Labels: {},
      Scope: "local",
      Options: null,
    }),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Creates a mock exec instance.
 */
export function createMockExec(
  id = "mock-exec-" + Math.random().toString(36).slice(2, 10),
): MockExec {
  return {
    id,
    start: vi.fn(),
    inspect: vi.fn().mockResolvedValue({
      ID: id,
      Running: false,
      ExitCode: 0,
      Pid: 0,
    }),
    resize: vi.fn().mockResolvedValue(undefined),
  };
}
