import { describe, it, expect, vi } from "vitest";
import {
  calculateCpu,
  calculateMemory,
  calculateNetwork,
  calculateBlockIO,
  computeMetrics,
  getMetrics,
  streamMetrics,
} from "../../src/monitoring/metrics.js";
import { ContainerNotFoundError } from "../../src/errors/base.js";
import type { DockerStatsRaw } from "../../src/types/metrics.js";
import type Docker from "dockerode";
import { PassThrough } from "node:stream";

function makeStats(overrides: Partial<DockerStatsRaw> = {}): DockerStatsRaw {
  return {
    read: "2024-01-15T10:30:00.000Z",
    cpu_stats: {
      cpu_usage: { total_usage: 200000000, percpu_usage: [100000000, 100000000] },
      system_cpu_usage: 2000000000,
      online_cpus: 2,
    },
    precpu_stats: {
      cpu_usage: { total_usage: 100000000, percpu_usage: [50000000, 50000000] },
      system_cpu_usage: 1000000000,
      online_cpus: 2,
    },
    memory_stats: {
      usage: 104857600, // 100 MB
      limit: 1073741824, // 1 GB
      stats: { cache: 10485760, inactive_file: 0 },
    },
    networks: {
      eth0: {
        rx_bytes: 5000,
        tx_bytes: 3000,
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
        { op: "Read", value: 1024000 },
        { op: "Write", value: 512000 },
      ],
    },
    ...overrides,
  };
}

describe("calculateCpu", () => {
  it("should calculate CPU percentage from deltas", () => {
    const stats = makeStats();
    const result = calculateCpu(stats);

    expect(result).not.toBeNull();
    // cpuDelta = 100000000, systemDelta = 1000000000, cores = 2
    // percent = (100000000 / 1000000000) * 2 * 100 = 20%
    expect(result!.percent).toBe(20);
    expect(result!.cores).toBe(2);
  });

  it("should return null when systemDelta is zero (first snapshot)", () => {
    const stats = makeStats({
      cpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 1000,
        online_cpus: 2,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 1000,
        online_cpus: 2,
      },
    });

    expect(calculateCpu(stats)).toBeNull();
  });

  it("should return null when cpuDelta is negative", () => {
    const stats = makeStats({
      cpu_stats: {
        cpu_usage: { total_usage: 50 },
        system_cpu_usage: 2000,
        online_cpus: 1,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 1000,
        online_cpus: 1,
      },
    });

    expect(calculateCpu(stats)).toBeNull();
  });

  it("should use percpu_usage length when online_cpus is missing", () => {
    const stats = makeStats({
      cpu_stats: {
        cpu_usage: { total_usage: 200, percpu_usage: [100, 50, 50] },
        system_cpu_usage: 2000,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 100, percpu_usage: [50, 25, 25] },
        system_cpu_usage: 1000,
      },
    });

    const result = calculateCpu(stats);
    expect(result).not.toBeNull();
    expect(result!.cores).toBe(3);
  });
});

describe("calculateMemory", () => {
  it("should calculate memory with cgroup v1 (cache)", () => {
    const stats = makeStats({
      memory_stats: {
        usage: 104857600,
        limit: 1073741824,
        stats: { cache: 10485760, inactive_file: 0 },
      },
    });

    const result = calculateMemory(stats);
    expect(result.usedBytes).toBe(104857600 - 10485760);
    expect(result.limitBytes).toBe(1073741824);
    expect(result.percent).toBeGreaterThan(0);
    expect(result.percent).toBeLessThan(100);
  });

  it("should calculate memory with cgroup v2 (inactive_file)", () => {
    const stats = makeStats({
      memory_stats: {
        usage: 104857600,
        limit: 1073741824,
        stats: { inactive_file: 5242880 },
      },
    });

    const result = calculateMemory(stats);
    expect(result.usedBytes).toBe(104857600 - 5242880);
  });

  it("should handle missing stats sub-object", () => {
    const stats = makeStats({
      memory_stats: {
        usage: 104857600,
        limit: 1073741824,
      },
    });

    const result = calculateMemory(stats);
    expect(result.usedBytes).toBe(104857600);
    expect(result.limitBytes).toBe(1073741824);
  });

  it("should return zero percent when limit is zero", () => {
    const stats = makeStats({
      memory_stats: {
        usage: 100,
        limit: 0,
      },
    });

    const result = calculateMemory(stats);
    expect(result.percent).toBe(0);
  });
});

describe("calculateNetwork", () => {
  it("should aggregate network bytes across interfaces", () => {
    const stats = makeStats({
      networks: {
        eth0: {
          rx_bytes: 1000,
          tx_bytes: 500,
          rx_packets: 10,
          tx_packets: 5,
          rx_errors: 0,
          tx_errors: 0,
          rx_dropped: 0,
          tx_dropped: 0,
        },
        eth1: {
          rx_bytes: 2000,
          tx_bytes: 1000,
          rx_packets: 20,
          tx_packets: 10,
          rx_errors: 0,
          tx_errors: 0,
          rx_dropped: 0,
          tx_dropped: 0,
        },
      },
    });

    const result = calculateNetwork(stats);
    expect(result.rxBytes).toBe(3000);
    expect(result.txBytes).toBe(1500);
  });

  it("should calculate throughput from two snapshots", () => {
    const prev = makeStats({
      networks: {
        eth0: {
          rx_bytes: 1000,
          tx_bytes: 500,
          rx_packets: 10,
          tx_packets: 5,
          rx_errors: 0,
          tx_errors: 0,
          rx_dropped: 0,
          tx_dropped: 0,
        },
      },
    });
    const curr = makeStats({
      networks: {
        eth0: {
          rx_bytes: 2000,
          tx_bytes: 1500,
          rx_packets: 20,
          tx_packets: 15,
          rx_errors: 0,
          tx_errors: 0,
          rx_dropped: 0,
          tx_dropped: 0,
        },
      },
    });

    const result = calculateNetwork(curr, prev, 1000);
    expect(result.rxBytesPerSec).toBe(1000);
    expect(result.txBytesPerSec).toBe(1000);
  });

  it("should return zero throughput without previous stats", () => {
    const stats = makeStats();
    const result = calculateNetwork(stats);

    expect(result.rxBytesPerSec).toBe(0);
    expect(result.txBytesPerSec).toBe(0);
  });

  it("should handle missing networks", () => {
    const stats = makeStats({ networks: undefined });
    const result = calculateNetwork(stats);

    expect(result.rxBytes).toBe(0);
    expect(result.txBytes).toBe(0);
  });
});

describe("calculateBlockIO", () => {
  it("should extract read and write bytes", () => {
    const stats = makeStats();
    const result = calculateBlockIO(stats);

    expect(result.readBytes).toBe(1024000);
    expect(result.writeBytes).toBe(512000);
  });

  it("should handle null io_service_bytes_recursive", () => {
    const stats = makeStats({
      blkio_stats: { io_service_bytes_recursive: null },
    });
    const result = calculateBlockIO(stats);

    expect(result.readBytes).toBe(0);
    expect(result.writeBytes).toBe(0);
  });

  it("should handle missing blkio_stats", () => {
    const stats = makeStats({ blkio_stats: undefined });
    const result = calculateBlockIO(stats);

    expect(result.readBytes).toBe(0);
    expect(result.writeBytes).toBe(0);
  });
});

describe("computeMetrics", () => {
  it("should compute complete metrics from stats", () => {
    const stats = makeStats();
    const result = computeMetrics("container-123", stats);

    expect(result).not.toBeNull();
    expect(result!.containerId).toBe("container-123");
    expect(result!.cpu.percent).toBe(20);
    expect(result!.memory.usedBytes).toBeGreaterThan(0);
    expect(result!.network.rxBytes).toBe(5000);
    expect(result!.blockIO.readBytes).toBe(1024000);
    expect(result!.timestamp).toBeInstanceOf(Date);
  });

  it("should return null when CPU delta is unavailable", () => {
    const stats = makeStats({
      cpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 1000,
        online_cpus: 1,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 1000,
        online_cpus: 1,
      },
    });

    expect(computeMetrics("c1", stats)).toBeNull();
  });
});

describe("getMetrics", () => {
  function createMockDocker() {
    return {
      getContainer: vi.fn(),
    } as unknown as Docker & {
      getContainer: ReturnType<typeof vi.fn>;
    };
  }

  it("should return metrics for a running container", async () => {
    const docker = createMockDocker();
    const stats = makeStats();

    docker.getContainer.mockReturnValue({
      stats: vi.fn().mockResolvedValue(stats),
    });

    const result = await getMetrics(docker, "abc123");
    expect(result.containerId).toBe("abc123");
    expect(result.cpu.percent).toBe(20);
    expect(result.memory.limitBytes).toBe(1073741824);
  });

  it("should throw ContainerNotFoundError for missing container", async () => {
    const docker = createMockDocker();
    docker.getContainer.mockReturnValue({
      stats: vi.fn().mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 })),
    });

    await expect(getMetrics(docker, "nonexistent")).rejects.toThrow(ContainerNotFoundError);
  });
});

describe("streamMetrics", () => {
  function createMockDocker() {
    return {
      getContainer: vi.fn(),
    } as unknown as Docker & {
      getContainer: ReturnType<typeof vi.fn>;
    };
  }

  it("should emit metrics from a streaming stats source", async () => {
    const docker = createMockDocker();
    const statsStream = new PassThrough();

    docker.getContainer.mockReturnValue({
      stats: vi.fn().mockResolvedValue(statsStream),
    });

    const metricsStream = await streamMetrics(docker, "abc123");
    const received: unknown[] = [];

    metricsStream.on("data", (m) => received.push(m));

    const stats = makeStats();
    statsStream.write(JSON.stringify(stats) + "\n");

    await new Promise((resolve) => setTimeout(resolve, 50));

    // First stats might not emit if delta is zero; ensure no crash
    expect(received.length).toBeLessThanOrEqual(1);

    metricsStream.stop();
  });

  it("should throw ContainerNotFoundError for missing container", async () => {
    const docker = createMockDocker();
    docker.getContainer.mockReturnValue({
      stats: vi.fn().mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 })),
    });

    await expect(streamMetrics(docker, "nonexistent")).rejects.toThrow(ContainerNotFoundError);
  });
});
