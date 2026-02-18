import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const VolumeCreateOptionsSchema = z.object({
  name: z.string().min(1),
  driver: z.string().default("local"),
  driverOpts: z.record(z.string()).optional(),
  labels: z.record(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VolumeCreateOptions = z.infer<typeof VolumeCreateOptionsSchema>;

export interface VolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
  labels: Record<string, string>;
  scope: string;
  created: string;
  status: Record<string, unknown> | null;
  usageData: {
    size: number;
    refCount: number;
  } | null;
}

export interface VolumeListFilter {
  name?: string;
  driver?: string;
  label?: string[];
  dangling?: boolean;
}

export interface PruneVolumesResult {
  volumesDeleted: string[];
  spaceReclaimed: number;
}
