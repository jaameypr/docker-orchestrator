import { z } from "zod";
import type { ConfigWarning } from "./warnings.js";
import type { ResolvedPortMapping } from "./ports.js";
import type { RetryPolicies } from "../utils/retry.js";
import type { CircuitBreakerOptions, CircuitState } from "../utils/circuit-breaker.js";
import type { TimeoutConfig } from "../utils/timeout.js";
import type { Logger } from "../utils/logger.js";
import type { DaemonMonitorOptions, DaemonState } from "../utils/daemon-monitor.js";

// ---------------------------------------------------------------------------
// Deploy Result
// ---------------------------------------------------------------------------

export interface DeployResult {
  containerId: string;
  name: string;
  status: "running" | "healthy";
  ports: ResolvedPortMapping[];
  warnings: ConfigWarning[];
  /** Persistent console (only when interactive mode is enabled) */
  console?: import("../core/console.js").ContainerConsole;
}

// ---------------------------------------------------------------------------
// Config Diff
// ---------------------------------------------------------------------------

export interface ConfigDiff {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

// ---------------------------------------------------------------------------
// Update Result
// ---------------------------------------------------------------------------

export interface UpdateResult {
  containerId: string;
  changes: ConfigDiff[];
  restarted: boolean;
  warnings: ConfigWarning[];
}

// ---------------------------------------------------------------------------
// Destroy Options
// ---------------------------------------------------------------------------

export const DestroyOptionsSchema = z.object({
  /** Delete associated named volumes (default: false) */
  removeVolumes: z.boolean().default(false),
  /** Force-stop running container (default: false) */
  force: z.boolean().default(false),
  /** Graceful stop timeout in seconds (default: 10) */
  timeout: z.number().int().positive().default(10),
});

export type DestroyOptions = z.infer<typeof DestroyOptionsSchema>;

// ---------------------------------------------------------------------------
// Batch Result
// ---------------------------------------------------------------------------

export type BatchItemResult<T> =
  | { status: "fulfilled"; value: T; index: number }
  | { status: "rejected"; reason: Error; index: number };

export interface BatchResult<T> {
  results: BatchItemResult<T>[];
  succeeded: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Progress Callback
// ---------------------------------------------------------------------------

export type ProgressCallback = (step: string, detail: string) => void;

// ---------------------------------------------------------------------------
// Orchestrator Options
// ---------------------------------------------------------------------------

export interface OrchestratorOptions {
  /** Default network to attach containers to */
  defaultNetwork?: string;
  /** Default security profile */
  defaultSecurityProfile?: "hardened" | "standard" | "permissive";
  /** Default labels added to all managed containers */
  defaultLabels?: Record<string, string>;
  /** Retry policies per operation type */
  retryPolicy?: Partial<RetryPolicies>;
  /** Circuit breaker configuration (false to disable) */
  circuitBreaker?: Partial<CircuitBreakerOptions> | false;
  /** Timeout configuration per operation type */
  timeouts?: Partial<TimeoutConfig>;
  /** Logger instance */
  logger?: Logger;
  /** Daemon monitor configuration (false to disable) */
  daemonMonitor?: boolean | Partial<DaemonMonitorOptions>;
}

// ---------------------------------------------------------------------------
// Health Status
// ---------------------------------------------------------------------------

export interface OrchestratorHealthStatus {
  daemon: DaemonState;
  circuit: CircuitState;
  activeStreams: number;
  pendingOperations: number;
}
