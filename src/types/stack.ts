import { z } from "zod";
import { ContainerConfigSchema } from "../builders/config-builder.js";
import type { DeployResult } from "./orchestrator.js";
import type { ConfigWarning } from "./warnings.js";

// ---------------------------------------------------------------------------
// Stack Service Config
// ---------------------------------------------------------------------------

export const StackServiceSchema = ContainerConfigSchema.extend({
  /** Services that must start before this one */
  dependsOn: z.array(z.string()).optional(),
  /** Number of instances to run (default: 1) */
  scale: z.number().int().positive().default(1),
});

export type StackServiceConfig = z.infer<typeof StackServiceSchema>;

// ---------------------------------------------------------------------------
// Network Config (in stack context)
// ---------------------------------------------------------------------------

export const StackNetworkSchema = z.object({
  driver: z.enum(["bridge", "overlay", "host", "none", "macvlan"]).default("bridge"),
  internal: z.boolean().default(false),
  labels: z.record(z.string()).optional(),
});

export type StackNetworkConfig = z.infer<typeof StackNetworkSchema>;

// ---------------------------------------------------------------------------
// Volume Config (in stack context)
// ---------------------------------------------------------------------------

export const StackVolumeSchema = z.object({
  driver: z.string().default("local"),
  driverOpts: z.record(z.string()).optional(),
  labels: z.record(z.string()).optional(),
});

export type StackVolumeConfig = z.infer<typeof StackVolumeSchema>;

// ---------------------------------------------------------------------------
// Stack Config
// ---------------------------------------------------------------------------

export const StackConfigSchema = z.object({
  name: z.string().min(1),
  containers: z.record(StackServiceSchema),
  networks: z.record(StackNetworkSchema).optional(),
  volumes: z.record(StackVolumeSchema).optional(),
});

export type StackConfig = z.infer<typeof StackConfigSchema>;

// ---------------------------------------------------------------------------
// Stack Deploy Result
// ---------------------------------------------------------------------------

export interface StackServiceResult {
  serviceName: string;
  deployResults: DeployResult[];
}

export interface StackDeployResult {
  stackName: string;
  services: StackServiceResult[];
  networks: string[];
  warnings: ConfigWarning[];
}
