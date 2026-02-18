import { z } from "zod";
import { HealthCheckConfigSchema } from "./health-check.js";

// ---------------------------------------------------------------------------
// Graceful Stop Config
// ---------------------------------------------------------------------------

export const GracefulStopConfigSchema = z.object({
  command: z.string().min(1),
  waitForExit: z.boolean().default(true),
  timeout: z.number().int().positive().default(30000),
});

export type GracefulStopConfig = z.infer<typeof GracefulStopConfigSchema>;

// ---------------------------------------------------------------------------
// Ready Check Config
// ---------------------------------------------------------------------------

export const ReadyCheckConfigSchema = z.object({
  logMatch: z
    .union([z.string(), z.instanceof(RegExp)])
    .optional(),
  healthCheck: HealthCheckConfigSchema.optional(),
  timeout: z.number().int().positive().default(60000),
});

export type ReadyCheckConfig = z.infer<typeof ReadyCheckConfigSchema>;

// ---------------------------------------------------------------------------
// Container Preset
// ---------------------------------------------------------------------------

export const ContainerPresetSchema = z.object({
  name: z.string().min(1),
  config: z.record(z.unknown()),
  gracefulStop: GracefulStopConfigSchema.optional(),
  readyCheck: ReadyCheckConfigSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ContainerPreset = z.infer<typeof ContainerPresetSchema>;

// ---------------------------------------------------------------------------
// Preset Registry Options
// ---------------------------------------------------------------------------

export interface PresetRegistryOptions {
  overwrite?: boolean;
}
