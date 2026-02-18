import type Docker from "dockerode";
import { mapDockerError } from "../errors/mapping.js";
import { VolumeNotFoundError, VolumeInUseError, VolumeAlreadyExistsError } from "../errors/base.js";
import {
  VolumeCreateOptionsSchema,
  type VolumeCreateOptions,
  type VolumeInfo,
  type VolumeListFilter,
  type PruneVolumesResult,
} from "../types/volume.js";

// ---------------------------------------------------------------------------
// Create Volume
// ---------------------------------------------------------------------------

/**
 * Creates a Docker volume with the given options.
 * Checks for duplicate names before creation.
 */
export async function createVolume(
  docker: Docker,
  options: VolumeCreateOptions,
): Promise<VolumeInfo> {
  const config = VolumeCreateOptionsSchema.parse(options);

  // Duplicate detection
  try {
    const existing = await docker.getVolume(config.name).inspect();
    if (existing) {
      throw new VolumeAlreadyExistsError(config.name);
    }
  } catch (err) {
    if (err instanceof VolumeAlreadyExistsError) throw err;
    const error = err as { statusCode?: number };
    if (error.statusCode !== 404) {
      // Unexpected error during check – ignore and try to create
    }
  }

  try {
    await docker.createVolume({
      Name: config.name,
      Driver: config.driver,
      DriverOpts: config.driverOpts,
      Labels: config.labels,
    });

    // Inspect the created volume to get full info
    // (createVolume returns a Volume object, not VolumeInfo)
    const data = await docker.getVolume(config.name).inspect();
    return mapVolumeData(data as unknown as Record<string, unknown>);
  } catch (err) {
    const error = err as { statusCode?: number; message?: string };
    if (error.statusCode === 409 || error.message?.includes("already exists")) {
      throw new VolumeAlreadyExistsError(config.name, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err);
  }
}

// ---------------------------------------------------------------------------
// Remove Volume
// ---------------------------------------------------------------------------

/**
 * Removes a Docker volume by name.
 * If force is false, Docker will refuse to remove volumes in use.
 */
export async function removeVolume(
  docker: Docker,
  volumeName: string,
  force = false,
): Promise<void> {
  try {
    await docker.getVolume(volumeName).remove({ force });
  } catch (err) {
    const error = err as { statusCode?: number; message?: string };
    if (error.statusCode === 404) {
      throw new VolumeNotFoundError(volumeName, err instanceof Error ? err : undefined);
    }
    if (error.statusCode === 409 || error.message?.includes("in use")) {
      throw new VolumeInUseError(volumeName, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err);
  }
}

// ---------------------------------------------------------------------------
// Inspect Volume
// ---------------------------------------------------------------------------

/**
 * Returns detailed info about a volume.
 */
export async function inspectVolume(docker: Docker, volumeName: string): Promise<VolumeInfo> {
  try {
    const data = await docker.getVolume(volumeName).inspect();
    return mapVolumeData(data as unknown as Record<string, unknown>);
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      throw new VolumeNotFoundError(volumeName, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err);
  }
}

// ---------------------------------------------------------------------------
// List Volumes
// ---------------------------------------------------------------------------

/**
 * Lists all volumes, with optional filters.
 */
export async function listVolumes(
  docker: Docker,
  filter?: VolumeListFilter,
): Promise<VolumeInfo[]> {
  try {
    const filters: Record<string, string[]> = {};
    if (filter?.name) filters.name = [filter.name];
    if (filter?.driver) filters.driver = [filter.driver];
    if (filter?.label) filters.label = filter.label;
    if (filter?.dangling !== undefined) filters.dangling = [String(filter.dangling)];

    const result = await docker.listVolumes({
      filters: Object.keys(filters).length > 0 ? JSON.stringify(filters) : undefined,
    });

    const volumes = result.Volumes ?? [];
    return volumes.map((v) => mapVolumeData(v as unknown as Record<string, unknown>));
  } catch (err) {
    throw mapDockerError(err);
  }
}

// ---------------------------------------------------------------------------
// Prune Volumes
// ---------------------------------------------------------------------------

/**
 * Removes unused volumes and returns the space reclaimed.
 */
export async function pruneVolumes(docker: Docker): Promise<PruneVolumesResult> {
  try {
    const result = await docker.pruneVolumes();
    return {
      volumesDeleted: result.VolumesDeleted ?? [],
      spaceReclaimed: result.SpaceReclaimed ?? 0,
    };
  } catch (err) {
    throw mapDockerError(err);
  }
}

// ---------------------------------------------------------------------------
// Volume Exists
// ---------------------------------------------------------------------------

/**
 * Checks if a volume exists. Returns true/false.
 */
export async function volumeExists(docker: Docker, volumeName: string): Promise<boolean> {
  try {
    await docker.getVolume(volumeName).inspect();
    return true;
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      return false;
    }
    throw mapDockerError(err);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function mapVolumeData(data: Record<string, unknown>): VolumeInfo {
  const usageData = data.UsageData as { Size?: number; RefCount?: number } | undefined;

  return {
    name: (data.Name ?? "") as string,
    driver: (data.Driver ?? "local") as string,
    mountpoint: (data.Mountpoint ?? "") as string,
    labels: (data.Labels ?? {}) as Record<string, string>,
    scope: (data.Scope ?? "local") as string,
    created: (data.CreatedAt ?? "") as string,
    status: (data.Status ?? null) as Record<string, unknown> | null,
    usageData: usageData
      ? { size: usageData.Size ?? -1, refCount: usageData.RefCount ?? -1 }
      : null,
  };
}
