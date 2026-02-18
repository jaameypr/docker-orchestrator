import type Docker from "dockerode";
import type Dockerode from "dockerode";
import { mapDockerError } from "../errors/mapping.js";
import {
  ContainerNotFoundError,
  RecreationFailedError,
  CriticalRecreationError,
} from "../errors/base.js";
import {
  RecreationOptionsSchema,
  type ExtractedContainerConfig,
  type RecreationOptions,
  type RecreationResult,
} from "../types/recreation.js";

// ---------------------------------------------------------------------------
// Config Extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the portable configuration from a running container.
 * Uses container.inspect() and maps raw Docker data to a clean format.
 */
export async function extractContainerConfig(
  docker: Docker,
  containerId: string,
): Promise<ExtractedContainerConfig> {
  const container = docker.getContainer(containerId);

  let data: Dockerode.ContainerInspectInfo;
  try {
    data = await container.inspect();
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      throw new ContainerNotFoundError(containerId, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err, { containerId });
  }

  const hostConfig = data.HostConfig ?? {};
  const networkSettings = data.NetworkSettings ?? {};

  return {
    image: data.Config.Image,
    name: data.Name.replace(/^\//, ""),
    env: data.Config.Env ?? [],
    cmd: data.Config.Cmd ?? null,
    entrypoint: (data.Config.Entrypoint as string[] | undefined) ?? null,
    hostname: data.Config.Hostname ?? "",
    exposedPorts: data.Config.ExposedPorts ?? {},
    portBindings:
      ((hostConfig as Record<string, unknown>).PortBindings as Record<
        string,
        Array<{ HostIp: string; HostPort: string }>
      >) ?? {},
    binds: ((hostConfig as Record<string, unknown>).Binds as string[]) ?? [],
    mounts:
      ((hostConfig as Record<string, unknown>).Mounts as Array<{
        Type: string;
        Source: string;
        Target: string;
        ReadOnly: boolean;
      }>) ?? [],
    networkMode: ((hostConfig as Record<string, unknown>).NetworkMode as string) ?? "default",
    networks: networkSettings.Networks ?? {},
    memoryLimit: ((hostConfig as Record<string, unknown>).Memory as number) ?? 0,
    cpuShares: ((hostConfig as Record<string, unknown>).CpuShares as number) ?? 0,
    cpuQuota: ((hostConfig as Record<string, unknown>).CpuQuota as number) ?? 0,
    restartPolicy: {
      Name:
        ((hostConfig as Record<string, unknown>).RestartPolicy as { Name?: string })?.Name ?? "no",
      MaximumRetryCount:
        ((hostConfig as Record<string, unknown>).RestartPolicy as { MaximumRetryCount?: number })
          ?.MaximumRetryCount ?? 0,
    },
    labels: data.Config.Labels ?? {},
    workingDir: data.Config.WorkingDir ?? "",
    user: data.Config.User ?? "",
  };
}

// ---------------------------------------------------------------------------
// Config Merge
// ---------------------------------------------------------------------------

/**
 * Merges existing container config with new updates.
 * - Env vars: key-based merge (same key → new value wins)
 * - Ports: additive (merge) or replace strategy
 * - Volumes/binds: additive
 * - Labels: key-based merge
 */
export function mergeContainerConfig(
  existing: ExtractedContainerConfig,
  updates: RecreationOptions,
): ExtractedContainerConfig {
  const merged = { ...existing };

  // Image
  if (updates.image) {
    merged.image = updates.image;
  }

  // Env vars: key-based merge
  if (updates.env) {
    const envMap = new Map<string, string>();
    for (const entry of existing.env) {
      const eqIdx = entry.indexOf("=");
      if (eqIdx !== -1) {
        envMap.set(entry.substring(0, eqIdx), entry.substring(eqIdx + 1));
      }
    }
    for (const [key, value] of Object.entries(updates.env)) {
      envMap.set(key, value);
    }
    merged.env = Array.from(envMap.entries()).map(([k, v]) => `${k}=${v}`);
  }

  // Cmd
  if (updates.cmd) {
    merged.cmd = updates.cmd;
  }

  // Entrypoint
  if (updates.entrypoint) {
    merged.entrypoint = updates.entrypoint;
  }

  // Labels: key-based merge
  if (updates.labels) {
    merged.labels = { ...existing.labels, ...updates.labels };
  }

  // Ports
  if (updates.portOverrides) {
    if (updates.portStrategy === "replace") {
      merged.exposedPorts = {};
      merged.portBindings = {};
    }
    for (const port of updates.portOverrides) {
      const key = `${port.container}/${port.protocol}`;
      merged.exposedPorts[key] = {};
      merged.portBindings[key] = [
        { HostIp: "0.0.0.0", HostPort: port.host ? String(port.host) : "" },
      ];
    }
  }

  // Volumes: additive
  if (updates.volumes) {
    const existingBindSet = new Set(merged.binds);
    for (const vol of updates.volumes) {
      const bind = vol.readOnly
        ? `${vol.host}:${vol.container}:ro`
        : `${vol.host}:${vol.container}`;
      if (!existingBindSet.has(bind)) {
        merged.binds.push(bind);
      }
    }
  }

  // Resource limits
  if (updates.memoryLimit !== undefined) {
    merged.memoryLimit = updates.memoryLimit;
  }
  if (updates.cpuShares !== undefined) {
    merged.cpuShares = updates.cpuShares;
  }

  // Restart policy
  if (updates.restartPolicy) {
    merged.restartPolicy = { Name: updates.restartPolicy, MaximumRetryCount: 0 };
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Build Dockerode Config from Extracted Config
// ---------------------------------------------------------------------------

/**
 * Converts an ExtractedContainerConfig back into Dockerode.ContainerCreateOptions.
 */
function buildDockerodeConfig(config: ExtractedContainerConfig): Dockerode.ContainerCreateOptions {
  const result: Dockerode.ContainerCreateOptions = {
    Image: config.image,
    name: config.name,
    Env: config.env.length > 0 ? config.env : undefined,
    Cmd: config.cmd ?? undefined,
    Entrypoint: config.entrypoint ?? undefined,
    Hostname: config.hostname || undefined,
    ExposedPorts: Object.keys(config.exposedPorts).length > 0 ? config.exposedPorts : undefined,
    Labels: Object.keys(config.labels).length > 0 ? config.labels : undefined,
    WorkingDir: config.workingDir || undefined,
    User: config.user || undefined,
    HostConfig: {
      PortBindings: Object.keys(config.portBindings).length > 0 ? config.portBindings : undefined,
      Binds: config.binds.length > 0 ? config.binds : undefined,
      NetworkMode: config.networkMode !== "default" ? config.networkMode : undefined,
      Memory: config.memoryLimit || undefined,
      CpuShares: config.cpuShares || undefined,
      CpuQuota: config.cpuQuota || undefined,
      RestartPolicy: {
        Name: config.restartPolicy.Name,
        MaximumRetryCount: config.restartPolicy.MaximumRetryCount,
      },
    },
  };

  return result;
}

// ---------------------------------------------------------------------------
// Recreation Workflow
// ---------------------------------------------------------------------------

/**
 * Recreates a container with optional new configuration.
 *
 * Workflow:
 * 1. Inspect old container → extract config
 * 2. Merge with newConfig (if provided)
 * 3. Create new container (not started)
 * 4. Stop old container gracefully
 * 5. Rename old container (suffix _old_<timestamp>)
 * 6. Rename new container to original name
 * 7. Start new container
 * 8. Wait for health check (if defined)
 * 9. Remove old container on success
 * 10. On failure → rollback
 */
export async function recreateContainer(
  docker: Docker,
  containerId: string,
  newConfig?: Partial<RecreationOptions>,
): Promise<RecreationResult> {
  const options = RecreationOptionsSchema.parse(newConfig ?? {});

  // Step 1: Extract existing config
  const existingConfig = await extractContainerConfig(docker, containerId);
  const originalName = existingConfig.name;

  // Check for anonymous volumes and warn
  const oldContainer = docker.getContainer(containerId);
  let oldInspect: Dockerode.ContainerInspectInfo;
  try {
    oldInspect = await oldContainer.inspect();
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      throw new ContainerNotFoundError(containerId, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err, { containerId });
  }

  // Step 2: Merge config
  const finalConfig = mergeContainerConfig(existingConfig, options);

  // We need to create the new container with a temporary name first
  const tempName = `${originalName}_new_${Date.now()}`;
  const oldRename = `${originalName}_old_${Date.now()}`;

  const dockerodeConfig = buildDockerodeConfig(finalConfig);
  // Override the name for creation since we need temp name
  dockerodeConfig.name = tempName;

  let newContainerId: string | null = null;
  let oldStopped = false;
  let oldRenamed = false;
  let newRenamed = false;

  try {
    // Step 3: Create new container (not started yet)
    const newContainer = await docker.createContainer(dockerodeConfig);
    newContainerId = newContainer.id;

    // Step 4: Stop old container gracefully
    if (oldInspect.State.Running) {
      await oldContainer.stop({ t: options.stopTimeout });
      oldStopped = true;
    }

    // Step 5: Rename old container
    await oldContainer.rename({ name: oldRename });
    oldRenamed = true;

    // Step 6: Rename new container to original name
    await docker.getContainer(newContainerId).rename({ name: originalName });
    newRenamed = true;

    // Step 7: Start new container
    await docker.getContainer(newContainerId).start();

    // Step 8: Wait for health check (if container has one)
    const newInspect = await docker.getContainer(newContainerId).inspect();
    if (newInspect.Config.Healthcheck) {
      await waitForHealthy(docker, newContainerId, options.healthCheckTimeout);
    }

    // Step 9: Remove old container
    try {
      await docker.getContainer(oldInspect.Id).remove({ force: true });
    } catch {
      // Best-effort: old container removal is not critical
    }

    return {
      oldContainerId: containerId,
      newContainerId,
      rollbackStatus: "not_needed",
      recreatedAt: new Date().toISOString(),
    };
  } catch (recreationError) {
    // Rollback
    const error =
      recreationError instanceof Error ? recreationError : new Error(String(recreationError));

    try {
      await performRollback(docker, {
        oldContainerId: containerId,
        newContainerId,
        originalName,
        oldRename,
        oldStopped,
        oldRenamed,
        newRenamed,
        oldWasRunning: oldInspect.State.Running,
      });

      throw new RecreationFailedError(containerId, "succeeded", error);
    } catch (rollbackErr) {
      if (rollbackErr instanceof RecreationFailedError) {
        throw rollbackErr;
      }

      const rbError = rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr));
      throw new CriticalRecreationError(containerId, error, rbError);
    }
  }
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

interface RollbackContext {
  oldContainerId: string;
  newContainerId: string | null;
  originalName: string;
  oldRename: string;
  oldStopped: boolean;
  oldRenamed: boolean;
  newRenamed: boolean;
  oldWasRunning: boolean;
}

async function performRollback(docker: Docker, ctx: RollbackContext): Promise<void> {
  // Stop and remove new container if it was created
  if (ctx.newContainerId) {
    try {
      const newContainer = docker.getContainer(ctx.newContainerId);
      try {
        await newContainer.stop({ t: 5 });
      } catch {
        // May not be running
      }
      await newContainer.remove({ force: true });
    } catch {
      // Best-effort removal
    }
  }

  // Rename old container back to original name
  if (ctx.oldRenamed) {
    const oldContainer = docker.getContainer(ctx.oldContainerId);
    await oldContainer.rename({ name: ctx.originalName });
  }

  // Restart old container if it was running before
  if (ctx.oldStopped && ctx.oldWasRunning) {
    const oldContainer = docker.getContainer(ctx.oldContainerId);
    await oldContainer.start();
  }
}

// ---------------------------------------------------------------------------
// Health Check Waiting
// ---------------------------------------------------------------------------

async function waitForHealthy(
  docker: Docker,
  containerId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const interval = 1000;

  while (Date.now() < deadline) {
    const data = await docker.getContainer(containerId).inspect();
    const health = data.State.Health;

    if (!health) {
      // No health check configured - consider healthy
      return;
    }

    if (health.Status === "healthy") {
      return;
    }

    if (health.Status === "unhealthy") {
      throw new Error(`Container ${containerId} became unhealthy`);
    }

    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error(`Health check timed out after ${timeoutMs}ms for container ${containerId}`);
}
