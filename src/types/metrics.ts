import type { EventEmitter } from "eventemitter3";

/**
 * CPU metrics for a container.
 */
export interface CpuMetrics {
  percent: number;
  cores: number;
}

/**
 * Memory metrics for a container.
 */
export interface MemoryMetrics {
  usedBytes: number;
  limitBytes: number;
  percent: number;
}

/**
 * Network metrics for a container.
 */
export interface NetworkMetrics {
  rxBytes: number;
  txBytes: number;
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

/**
 * Block I/O metrics for a container.
 */
export interface BlockIOMetrics {
  readBytes: number;
  writeBytes: number;
}

/**
 * Complete metrics snapshot for a container.
 */
export interface ContainerMetrics {
  containerId: string;
  timestamp: Date;
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  network: NetworkMetrics;
  blockIO: BlockIOMetrics;
}

/**
 * Events emitted by a metrics stream.
 */
export interface MetricsStreamEvents {
  data: (metrics: ContainerMetrics) => void;
  error: (err: Error) => void;
  end: () => void;
}

/**
 * A controllable metrics stream that can be stopped.
 */
export interface MetricsStream extends EventEmitter<MetricsStreamEvents> {
  stop(): void;
}

/**
 * Raw Docker stats object (subset of fields we use).
 */
export interface DockerStatsRaw {
  read: string;
  cpu_stats: {
    cpu_usage: {
      total_usage: number;
      percpu_usage?: number[];
    };
    system_cpu_usage: number;
    online_cpus?: number;
  };
  precpu_stats: {
    cpu_usage: {
      total_usage: number;
      percpu_usage?: number[];
    };
    system_cpu_usage: number;
    online_cpus?: number;
  };
  memory_stats: {
    usage: number;
    limit: number;
    stats?: {
      cache?: number;
      inactive_file?: number;
    };
  };
  networks?: Record<
    string,
    {
      rx_bytes: number;
      tx_bytes: number;
      rx_packets: number;
      tx_packets: number;
      rx_errors: number;
      tx_errors: number;
      rx_dropped: number;
      tx_dropped: number;
    }
  >;
  blkio_stats?: {
    io_service_bytes_recursive?: Array<{
      op: string;
      value: number;
    }> | null;
  };
}
