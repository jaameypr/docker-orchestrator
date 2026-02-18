import { z } from "zod";

/**
 * Extracted container configuration for recreation.
 * Represents the portable configuration of a container.
 */
export interface ExtractedContainerConfig {
  image: string;
  name: string;
  env: string[];
  cmd: string[] | null;
  entrypoint: string[] | null;
  hostname: string;
  exposedPorts: Record<string, object>;
  portBindings: Record<string, Array<{ HostIp: string; HostPort: string }>>;
  binds: string[];
  mounts: Array<{
    Type: string;
    Source: string;
    Target: string;
    ReadOnly: boolean;
  }>;
  networkMode: string;
  networks: Record<string, { IPAMConfig?: object; Aliases?: string[] }>;
  memoryLimit: number;
  cpuShares: number;
  cpuQuota: number;
  restartPolicy: { Name: string; MaximumRetryCount: number };
  labels: Record<string, string>;
  workingDir: string;
  user: string;
}

/**
 * Schema for recreation options (updates to merge into existing config).
 */
export const RecreationOptionsSchema = z.object({
  image: z.string().optional(),
  env: z.record(z.string()).optional(),
  cmd: z.array(z.string()).optional(),
  entrypoint: z.array(z.string()).optional(),
  labels: z.record(z.string()).optional(),
  portOverrides: z
    .array(
      z.object({
        container: z.number().int().positive(),
        host: z.number().int().positive().optional(),
        protocol: z.enum(["tcp", "udp"]).default("tcp"),
      }),
    )
    .optional(),
  portStrategy: z.enum(["merge", "replace"]).default("merge"),
  volumes: z
    .array(
      z.object({
        host: z.string(),
        container: z.string(),
        readOnly: z.boolean().default(false),
      }),
    )
    .optional(),
  memoryLimit: z.number().int().nonnegative().optional(),
  cpuShares: z.number().int().nonnegative().optional(),
  restartPolicy: z.enum(["no", "always", "unless-stopped", "on-failure"]).optional(),
  stopTimeout: z.number().int().positive().default(10),
  healthCheckTimeout: z.number().int().positive().default(60000),
});

export type RecreationOptions = z.infer<typeof RecreationOptionsSchema>;

export type RollbackStatus = "succeeded" | "failed" | "not_needed";

/**
 * Result of a container recreation operation.
 */
export interface RecreationResult {
  oldContainerId: string;
  newContainerId: string;
  rollbackStatus: RollbackStatus;
  recreatedAt: string;
}
