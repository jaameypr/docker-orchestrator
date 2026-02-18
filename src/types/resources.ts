import { z } from "zod";

// ---------------------------------------------------------------------------
// Memory Limits
// ---------------------------------------------------------------------------

export const MemoryLimitsSchema = z.object({
  /** Hard memory limit in bytes, or as string like "512m", "2g" */
  limit: z.union([z.number().int().positive(), z.string()]).optional(),
  /** Soft limit / reservation in bytes or string */
  reservation: z.union([z.number().int().positive(), z.string()]).optional(),
  /** Swap limit in bytes or string. -1 for unlimited. Total = memory + swap */
  swap: z.union([z.number().int(), z.string()]).optional(),
  /** Swappiness 0-100 */
  swappiness: z.number().int().min(0).max(100).optional(),
  /** Disable OOM killer. Default false. */
  oomKillDisable: z.boolean().optional(),
});

export type MemoryLimits = z.infer<typeof MemoryLimitsSchema>;

// ---------------------------------------------------------------------------
// CPU Limits
// ---------------------------------------------------------------------------

export const CpuLimitsSchema = z.object({
  /** CPU cores as decimal (e.g. 1.5 = 1.5 cores). Converted to NanoCPUs internally. */
  nanoCpus: z.union([z.number().positive(), z.string()]).optional(),
  /** Relative CPU weight (default 1024) */
  shares: z.number().int().positive().optional(),
  /** CFS period in microseconds (default 100000) */
  period: z.number().int().positive().optional(),
  /** CFS quota in microseconds */
  quota: z.number().int().optional(),
  /** Pin to specific CPUs, e.g. "0,1" or "0-3" */
  cpusetCpus: z.string().optional(),
});

export type CpuLimits = z.infer<typeof CpuLimitsSchema>;

// ---------------------------------------------------------------------------
// PID Limits
// ---------------------------------------------------------------------------

export const PidLimitsSchema = z.object({
  /** Maximum number of PIDs. Protection against fork bombs. */
  limit: z.number().int().positive(),
});

export type PidLimits = z.infer<typeof PidLimitsSchema>;

// ---------------------------------------------------------------------------
// Block I/O Limits
// ---------------------------------------------------------------------------

export const DeviceRateSchema = z.object({
  /** Device path, e.g. "/dev/sda" */
  path: z.string().min(1),
  /** Rate in bytes per second */
  rate: z.number().int().positive(),
});

export type DeviceRate = z.infer<typeof DeviceRateSchema>;

export const BlockIOLimitsSchema = z.object({
  /** Block I/O weight (10-1000) */
  weight: z.number().int().min(10).max(1000).optional(),
  /** Device-specific read rate limits */
  deviceReadBps: z.array(DeviceRateSchema).optional(),
  /** Device-specific write rate limits */
  deviceWriteBps: z.array(DeviceRateSchema).optional(),
});

export type BlockIOLimits = z.infer<typeof BlockIOLimitsSchema>;

// ---------------------------------------------------------------------------
// Combined Resource Config
// ---------------------------------------------------------------------------

export const ResourceConfigSchema = z.object({
  memory: MemoryLimitsSchema.optional(),
  cpu: CpuLimitsSchema.optional(),
  pids: PidLimitsSchema.optional(),
  blockIO: BlockIOLimitsSchema.optional(),
});

export type ResourceConfig = z.infer<typeof ResourceConfigSchema>;
