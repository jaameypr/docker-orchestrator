/**
 * Fixture generators for Docker API responses.
 * Each generator returns a full, valid response object with optional overrides.
 */
import type { DockerStatsRaw } from "../../src/types/metrics.js";

// ---------------------------------------------------------------------------
// Docker Stats Fixture
// ---------------------------------------------------------------------------

/**
 * Generates a complete Docker stats response fixture.
 * Defaults produce a container using 20% CPU and ~100MB memory.
 */
export function generateStatsFixture(overrides: Partial<DockerStatsRaw> = {}): DockerStatsRaw {
  return {
    read: "2024-01-15T10:30:00.000000000Z",
    cpu_stats: {
      cpu_usage: {
        total_usage: 200_000_000,
        percpu_usage: [100_000_000, 100_000_000],
      },
      system_cpu_usage: 2_000_000_000,
      online_cpus: 2,
    },
    precpu_stats: {
      cpu_usage: {
        total_usage: 100_000_000,
        percpu_usage: [50_000_000, 50_000_000],
      },
      system_cpu_usage: 1_000_000_000,
      online_cpus: 2,
    },
    memory_stats: {
      usage: 104_857_600, // 100 MB
      limit: 1_073_741_824, // 1 GB
      stats: { cache: 10_485_760, inactive_file: 0 },
    },
    networks: {
      eth0: {
        rx_bytes: 5_000,
        tx_bytes: 3_000,
        rx_packets: 50,
        tx_packets: 30,
        rx_errors: 0,
        tx_errors: 0,
        rx_dropped: 0,
        tx_dropped: 0,
      },
    },
    blkio_stats: {
      io_service_bytes_recursive: [
        { op: "Read", value: 1_024_000 },
        { op: "Write", value: 512_000 },
      ],
    },
    ...overrides,
  };
}

/**
 * Generates stats fixture representing a high-CPU container (80% CPU).
 */
export function generateHighCpuStatsFixture(): DockerStatsRaw {
  return generateStatsFixture({
    cpu_stats: {
      cpu_usage: {
        total_usage: 900_000_000,
        percpu_usage: [450_000_000, 450_000_000],
      },
      system_cpu_usage: 2_000_000_000,
      online_cpus: 2,
    },
    precpu_stats: {
      cpu_usage: {
        total_usage: 100_000_000,
        percpu_usage: [50_000_000, 50_000_000],
      },
      system_cpu_usage: 1_000_000_000,
      online_cpus: 2,
    },
  });
}

/**
 * Generates stats fixture representing high memory usage (90%).
 */
export function generateHighMemoryStatsFixture(): DockerStatsRaw {
  return generateStatsFixture({
    memory_stats: {
      usage: 966_367_641, // ~921 MB
      limit: 1_073_741_824, // 1 GB
      stats: { cache: 0, inactive_file: 0 },
    },
  });
}

/**
 * Generates stats fixture for the first snapshot where CPU delta is zero.
 */
export function generateInitialStatsFixture(): DockerStatsRaw {
  return generateStatsFixture({
    cpu_stats: {
      cpu_usage: { total_usage: 100_000_000 },
      system_cpu_usage: 1_000_000_000,
      online_cpus: 2,
    },
    precpu_stats: {
      cpu_usage: { total_usage: 100_000_000 },
      system_cpu_usage: 1_000_000_000,
      online_cpus: 2,
    },
  });
}

/**
 * Generates stats with cgroup v2 format (inactive_file instead of cache).
 */
export function generateCgroupV2StatsFixture(): DockerStatsRaw {
  return generateStatsFixture({
    memory_stats: {
      usage: 104_857_600,
      limit: 1_073_741_824,
      stats: { inactive_file: 5_242_880 },
    },
  });
}

// ---------------------------------------------------------------------------
// Docker Inspect Fixture
// ---------------------------------------------------------------------------

export interface InspectOverrides {
  id?: string;
  name?: string;
  image?: string;
  state?: "created" | "running" | "paused" | "restarting" | "exited" | "dead";
  running?: boolean;
  exitCode?: number;
  pid?: number;
  env?: string[];
  cmd?: string[];
  hostname?: string;
  ipAddress?: string;
  ports?: Record<string, Array<{ HostIp: string; HostPort: string }> | null>;
  labels?: Record<string, string>;
  startedAt?: string;
  finishedAt?: string;
  restartPolicy?: { Name: string; MaximumRetryCount: number };
  memory?: number;
  nanoCpus?: number;
  binds?: string[];
  networkMode?: string;
  capAdd?: string[] | null;
  capDrop?: string[] | null;
  readonlyRootfs?: boolean;
}

/**
 * Generates a complete Docker container inspect response fixture.
 */
export function generateInspectFixture(overrides: InspectOverrides = {}) {
  const {
    id = "abc123def456",
    name = "test-container",
    image = "alpine:latest",
    state = "running",
    running = state === "running",
    exitCode = 0,
    pid = running ? 1234 : 0,
    env = ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],
    cmd = ["sh"],
    hostname = name.slice(0, 12),
    ipAddress = "172.17.0.2",
    ports = {},
    labels = {},
    startedAt = running ? "2024-01-15T10:00:00.000000000Z" : "0001-01-01T00:00:00Z",
    finishedAt = state === "exited" ? "2024-01-15T11:00:00.000000000Z" : "0001-01-01T00:00:00Z",
    restartPolicy = { Name: "no", MaximumRetryCount: 0 },
    memory = 0,
    nanoCpus = 0,
    binds = [],
    networkMode = "bridge",
    capAdd = null,
    capDrop = null,
    readonlyRootfs = false,
  } = overrides;

  return {
    Id: id,
    Created: "2024-01-15T09:00:00.000000000Z",
    Path: cmd[0] ?? "",
    Args: cmd.slice(1),
    State: {
      Status: state,
      Running: running,
      Paused: state === "paused",
      Restarting: state === "restarting",
      OOMKilled: false,
      Dead: state === "dead",
      Pid: pid,
      ExitCode: exitCode,
      Error: "",
      StartedAt: startedAt,
      FinishedAt: finishedAt,
    },
    Image: `sha256:${id}image`,
    Name: `/${name}`,
    RestartCount: 0,
    Config: {
      Hostname: hostname,
      Domainname: "",
      User: "",
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      ExposedPorts: Object.keys(ports).reduce(
        (acc, port) => {
          acc[port] = {};
          return acc;
        },
        {} as Record<string, object>,
      ),
      Tty: false,
      OpenStdin: false,
      StdinOnce: false,
      Env: env,
      Cmd: cmd,
      Image: image,
      Volumes: null,
      WorkingDir: "",
      Entrypoint: null,
      Labels: labels,
    },
    NetworkSettings: {
      Bridge: "",
      SandboxID: `sandbox-${id}`,
      IPAddress: ipAddress,
      IPPrefixLen: 16,
      Gateway: "172.17.0.1",
      MacAddress: "02:42:ac:11:00:02",
      Ports: ports,
      Networks: {
        [networkMode === "bridge" ? "bridge" : networkMode]: {
          IPAMConfig: null,
          Links: null,
          Aliases: null,
          NetworkID: "bridge-network-id",
          EndpointID: `endpoint-${id}`,
          Gateway: "172.17.0.1",
          IPAddress: ipAddress,
          IPPrefixLen: 16,
          MacAddress: "02:42:ac:11:00:02",
        },
      },
    },
    HostConfig: {
      Binds: binds,
      PortBindings: Object.entries(ports).reduce(
        (acc, [port, bindings]) => {
          if (bindings) {
            acc[port] = bindings;
          }
          return acc;
        },
        {} as Record<string, Array<{ HostIp: string; HostPort: string }>>,
      ),
      RestartPolicy: restartPolicy,
      NetworkMode: networkMode,
      Memory: memory,
      MemorySwap: memory > 0 ? memory * 2 : 0,
      NanoCpus: nanoCpus,
      CpuShares: 0,
      CpuPeriod: 0,
      CpuQuota: 0,
      CapAdd: capAdd,
      CapDrop: capDrop,
      ReadonlyRootfs: readonlyRootfs,
      SecurityOpt: null,
    },
    Mounts: binds.map((bind) => {
      const parts = bind.split(":");
      return {
        Type: "bind",
        Source: parts[0],
        Destination: parts[1] ?? parts[0],
        Mode: parts[2] ?? "",
        RW: !(parts[2] ?? "").includes("ro"),
        Propagation: "rprivate",
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Docker Event Fixture
// ---------------------------------------------------------------------------

export interface EventOverrides {
  type?: "container" | "image" | "volume" | "network";
  action?: string;
  actorId?: string;
  actorName?: string;
  actorAttributes?: Record<string, string>;
  time?: number;
  timeNano?: number;
}

/**
 * Generates a raw Docker event response fixture.
 */
export function generateEventFixture(overrides: EventOverrides = {}) {
  const {
    type = "container",
    action = "start",
    actorId = "abc123",
    actorName = "test-container",
    actorAttributes = {},
    time = Math.floor(Date.now() / 1000),
    timeNano = time * 1_000_000_000,
  } = overrides;

  return {
    Type: type,
    Action: action,
    Actor: {
      ID: actorId,
      Attributes: { name: actorName, ...actorAttributes },
    },
    time,
    timeNano,
  };
}

// ---------------------------------------------------------------------------
// Docker Network Fixtures
// ---------------------------------------------------------------------------

export function generateNetworkInspectFixture(
  overrides: {
    id?: string;
    name?: string;
    driver?: string;
    subnet?: string;
    gateway?: string;
    containers?: Record<string, { Name: string; IPv4Address: string }>;
  } = {},
) {
  const {
    id = "network-abc123",
    name = "test-network",
    driver = "bridge",
    subnet = "172.18.0.0/16",
    gateway = "172.18.0.1",
    containers = {},
  } = overrides;

  return {
    Id: id,
    Name: name,
    Created: "2024-01-15T09:00:00.000000000Z",
    Scope: "local",
    Driver: driver,
    EnableIPv6: false,
    IPAM: {
      Driver: "default",
      Config: [{ Subnet: subnet, Gateway: gateway }],
      Options: {},
    },
    Internal: false,
    Attachable: false,
    Ingress: false,
    Containers: containers,
    Options: {},
    Labels: {},
  };
}

// ---------------------------------------------------------------------------
// Docker Volume Fixtures
// ---------------------------------------------------------------------------

export function generateVolumeInspectFixture(
  overrides: {
    name?: string;
    driver?: string;
    mountpoint?: string;
    labels?: Record<string, string>;
  } = {},
) {
  const {
    name = "test-volume",
    driver = "local",
    mountpoint = `/var/lib/docker/volumes/${name ?? "test-volume"}/_data`,
    labels = {},
  } = overrides;

  return {
    Name: name,
    Driver: driver,
    Mountpoint: mountpoint,
    CreatedAt: "2024-01-15T09:00:00.000000000Z",
    Labels: labels,
    Scope: "local",
    Options: null,
    Status: {},
  };
}

// ---------------------------------------------------------------------------
// Docker Image Fixtures
// ---------------------------------------------------------------------------

export function generateImageInspectFixture(
  overrides: {
    id?: string;
    repoTags?: string[];
    size?: number;
    created?: number;
  } = {},
) {
  const {
    id = "sha256:abc123",
    repoTags = ["alpine:latest"],
    size = 5_600_000,
    created = 1700000000,
  } = overrides;

  return {
    Id: id,
    RepoTags: repoTags,
    RepoDigests: repoTags.map((tag) => tag.replace(/:.*/, "@sha256:digest123")),
    Created: created,
    Size: size,
    VirtualSize: size,
    Architecture: "amd64",
    Os: "linux",
  };
}

// ---------------------------------------------------------------------------
// Docker Exec Fixtures
// ---------------------------------------------------------------------------

export function generateExecInspectFixture(
  overrides: {
    id?: string;
    running?: boolean;
    exitCode?: number;
    pid?: number;
  } = {},
) {
  const { id = "exec-abc123", running = false, exitCode = 0, pid = 0 } = overrides;

  return {
    ID: id,
    Running: running,
    ExitCode: exitCode,
    ProcessConfig: {
      entrypoint: "/bin/sh",
      arguments: ["-c", "echo hello"],
      privileged: false,
      tty: false,
      user: "",
    },
    OpenStdin: false,
    OpenStdout: true,
    OpenStderr: true,
    Pid: pid,
    ContainerID: "container-abc123",
    CanRemove: false,
  };
}
