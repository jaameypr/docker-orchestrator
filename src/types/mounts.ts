import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const MountObjectSchema = z.object({
  type: z.enum(["bind", "volume", "tmpfs"]),
  source: z.string(),
  target: z.string().min(1),
  readOnly: z.boolean().default(false),
  tmpfsSize: z.number().int().positive().optional(),
});

/**
 * Union type: user can provide a mount as:
 * - string:  "/host/path:/container/path" → bind mount
 * - string:  "/host/path:/container/path:ro" → read-only bind mount
 * - string:  "volumeName:/container/path" → named volume
 * - object:  { type, source, target, readOnly, tmpfsSize }
 */
export const MountInputSchema = z.union([z.string().min(1), MountObjectSchema]);

export type MountInput = z.infer<typeof MountInputSchema>;

// ---------------------------------------------------------------------------
// Resolved types (after parsing)
// ---------------------------------------------------------------------------

export interface ResolvedMount {
  type: "bind" | "volume" | "tmpfs";
  source: string;
  target: string;
  readOnly: boolean;
  tmpfsSize?: number;
}

/**
 * Docker API mount format for HostConfig.Mounts.
 */
export interface DockerMountConfig {
  Type: "bind" | "volume" | "tmpfs";
  Source: string;
  Target: string;
  ReadOnly: boolean;
  TmpfsOptions?: {
    SizeBytes: number;
  };
}
