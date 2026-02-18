import { z } from "zod";
import type { ConfigWarning } from "./warnings.js";
import type { ResolvedPortMapping } from "./ports.js";

// ---------------------------------------------------------------------------
// Deploy Result
// ---------------------------------------------------------------------------

export interface DeployResult {
  containerId: string;
  name: string;
  status: "running" | "healthy";
  ports: ResolvedPortMapping[];
  warnings: ConfigWarning[];
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
}
