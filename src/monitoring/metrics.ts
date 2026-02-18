import type Docker from "dockerode";
import EventEmitter from "eventemitter3";
import { ContainerNotFoundError } from "../errors/base.js";
import { mapDockerError } from "../errors/mapping.js";
import type {
  ContainerMetrics,
  CpuMetrics,
  MemoryMetrics,
  NetworkMetrics,
  BlockIOMetrics,
  DockerStatsRaw,
  MetricsStream,
  MetricsStreamEvents,
} from "../types/metrics.js";

/**
 * Calculates CPU usage percentage from two consecutive Docker stats snapshots.
 * Uses the delta method matching `docker stats` CLI output.
 *
 * Returns null on first snapshot (no delta available).
 */
export function calculateCpu(stats: DockerStatsRaw): CpuMetrics | null {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;

  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;

  if (systemDelta <= 0 || cpuDelta < 0) {
    return null;
  }

  const cores = stats.cpu_stats.online_cpus ?? stats.cpu_stats.cpu_usage.percpu_usage?.length ?? 1;

  const percent = (cpuDelta / systemDelta) * cores * 100;

  return { percent: Math.round(percent * 100) / 100, cores };
}

/**
 * Calculates memory usage, handling cgroup v1 and v2 differences.
 *
 * cgroup v1: usage - stats.cache
 * cgroup v2: usage - stats.inactive_file
 */
export function calculateMemory(stats: DockerStatsRaw): MemoryMetrics {
  const memStats = stats.memory_stats;
  const limit = memStats.limit;

  // Determine cache to subtract (cgroup v1 vs v2)
  let cache = 0;
  if (memStats.stats) {
    if (memStats.stats.inactive_file !== undefined && memStats.stats.inactive_file > 0) {
      // cgroup v2: use inactive_file
      cache = memStats.stats.inactive_file;
    } else if (memStats.stats.cache !== undefined) {
      // cgroup v1: use cache
      cache = memStats.stats.cache;
    }
  }

  const usedBytes = memStats.usage - cache;
  const percent = limit > 0 ? Math.round((usedBytes / limit) * 100 * 100) / 100 : 0;

  return { usedBytes, limitBytes: limit, percent };
}

/**
 * Calculates network I/O by aggregating all interfaces.
 */
export function calculateNetwork(
  stats: DockerStatsRaw,
  previousStats?: DockerStatsRaw,
  intervalMs?: number,
): NetworkMetrics {
  let rxBytes = 0;
  let txBytes = 0;

  if (stats.networks) {
    for (const iface of Object.values(stats.networks)) {
      rxBytes += iface.rx_bytes;
      txBytes += iface.tx_bytes;
    }
  }

  let rxBytesPerSec = 0;
  let txBytesPerSec = 0;

  if (previousStats?.networks && intervalMs && intervalMs > 0) {
    let prevRx = 0;
    let prevTx = 0;

    for (const iface of Object.values(previousStats.networks)) {
      prevRx += iface.rx_bytes;
      prevTx += iface.tx_bytes;
    }

    const seconds = intervalMs / 1000;
    rxBytesPerSec = Math.max(0, (rxBytes - prevRx) / seconds);
    txBytesPerSec = Math.max(0, (txBytes - prevTx) / seconds);
  }

  return {
    rxBytes,
    txBytes,
    rxBytesPerSec: Math.round(rxBytesPerSec * 100) / 100,
    txBytesPerSec: Math.round(txBytesPerSec * 100) / 100,
  };
}

/**
 * Extracts block I/O read and write bytes from stats.
 */
export function calculateBlockIO(stats: DockerStatsRaw): BlockIOMetrics {
  let readBytes = 0;
  let writeBytes = 0;

  const entries = stats.blkio_stats?.io_service_bytes_recursive;
  if (entries && Array.isArray(entries)) {
    for (const entry of entries) {
      const op = entry.op.toLowerCase();
      if (op === "read") {
        readBytes += entry.value;
      } else if (op === "write") {
        writeBytes += entry.value;
      }
    }
  }

  return { readBytes, writeBytes };
}

/**
 * Computes a complete ContainerMetrics from a raw Docker stats object.
 */
export function computeMetrics(
  containerId: string,
  stats: DockerStatsRaw,
  previousStats?: DockerStatsRaw,
  intervalMs?: number,
): ContainerMetrics | null {
  const cpu = calculateCpu(stats);
  if (!cpu) return null;

  const memory = calculateMemory(stats);
  const network = calculateNetwork(stats, previousStats, intervalMs);
  const blockIO = calculateBlockIO(stats);

  return {
    containerId,
    timestamp: new Date(stats.read),
    cpu,
    memory,
    network,
    blockIO,
  };
}

/**
 * Retrieves a single metrics snapshot for a container.
 * Internally fetches a stats object that includes precpu_stats for delta calculation.
 */
export async function getMetrics(docker: Docker, containerId: string): Promise<ContainerMetrics> {
  const container = docker.getContainer(containerId);

  let stats: DockerStatsRaw;
  try {
    stats = (await container.stats({ stream: false })) as unknown as DockerStatsRaw;
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      throw new ContainerNotFoundError(containerId, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err, { containerId });
  }

  const cpu = calculateCpu(stats);
  const memory = calculateMemory(stats);
  const network = calculateNetwork(stats);
  const blockIO = calculateBlockIO(stats);

  return {
    containerId,
    timestamp: new Date(stats.read),
    cpu: cpu ?? { percent: 0, cores: 1 },
    memory,
    network,
    blockIO,
  };
}

/**
 * Creates a continuous metrics stream for a container.
 * Emits computed metrics at each interval.
 */
export async function streamMetrics(
  docker: Docker,
  containerId: string,
  _intervalMs = 1000,
): Promise<MetricsStream> {
  const container = docker.getContainer(containerId);
  const emitter = new EventEmitter<MetricsStreamEvents>() as MetricsStream;
  let stopped = false;
  let rawStream: NodeJS.ReadableStream;
  let previousStats: DockerStatsRaw | undefined;
  let previousTime: number | undefined;

  try {
    rawStream = (await container.stats({ stream: true })) as unknown as NodeJS.ReadableStream;
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      throw new ContainerNotFoundError(containerId, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err, { containerId });
  }

  let buffer = "";

  rawStream.on("data", (chunk: Buffer) => {
    if (stopped) return;

    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    // Keep the last incomplete line in the buffer
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim().length === 0) continue;

      let stats: DockerStatsRaw;
      try {
        stats = JSON.parse(line) as DockerStatsRaw;
      } catch {
        continue;
      }

      const now = Date.now();
      const elapsed = previousTime ? now - previousTime : _intervalMs;

      const metrics = computeMetrics(containerId, stats, previousStats, elapsed);
      previousStats = stats;
      previousTime = now;

      if (metrics) {
        emitter.emit("data", metrics);
      }
    }
  });

  rawStream.on("end", () => {
    if (!stopped) {
      emitter.emit("end");
    }
  });

  rawStream.on("error", (err: Error) => {
    if (!stopped) {
      emitter.emit("error", err);
    }
  });

  emitter.stop = function stop(): void {
    stopped = true;
    const s = rawStream as unknown as { destroy?: () => void };
    if (typeof s.destroy === "function") {
      s.destroy();
    }
    emitter.emit("end");
    emitter.removeAllListeners();
  };

  return emitter;
}
