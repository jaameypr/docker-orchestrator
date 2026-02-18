import type Docker from "dockerode";
import {
  buildContainerConfig,
  diffConfigs,
  ContainerConfigSchema,
  type ContainerConfig,
} from "../builders/config-builder.js";
import {
  type DeployResult,
  type UpdateResult,
  type ConfigDiff,
  DestroyOptionsSchema,
  type DestroyOptions,
  type BatchResult,
  type BatchItemResult,
  type ProgressCallback,
  type OrchestratorOptions,
  type OrchestratorHealthStatus,
} from "../types/orchestrator.js";
import type { ConfigWarning } from "../types/warnings.js";
import type { ResolvedPortMapping } from "../types/ports.js";
import {
  waitForHealthy,
  buildDockerHealthcheck,
} from "./health-check.js";
import { imageExists, pullImage } from "./image.js";
import { createNetwork, listNetworks } from "./network.js";
import { volumeExists, createVolume } from "./volume.js";
import {
  extractContainerConfig,
  recreateContainer,
} from "./container-recreation.js";
import { mapDockerError } from "../errors/mapping.js";
import {
  DeploymentFailedError,
  HealthCheckTimeoutError,
  UpdateFailedError,
  ImagePullError,
  ContainerNotFoundError,
} from "../errors/base.js";
import type { PullProgressCallback } from "../types/index.js";
import type { Logger } from "../utils/logger.js";
import { NoopLogger } from "../utils/logger.js";
import { CircuitBreaker } from "../utils/circuit-breaker.js";
import { DaemonMonitor } from "../utils/daemon-monitor.js";
import { ShutdownManager } from "../utils/shutdown.js";
import { DEFAULT_TIMEOUTS, type TimeoutConfig } from "../utils/timeout.js";
import { DEFAULT_RETRY_POLICIES, type RetryPolicies } from "../utils/retry.js";

// ---------------------------------------------------------------------------
// Orchestrator Labels
// ---------------------------------------------------------------------------

const MANAGED_LABEL = "orchestrator.managed";
const DEPLOYED_AT_LABEL = "orchestrator.deployed-at";
const STACK_LABEL = "orchestrator.stack";

// ---------------------------------------------------------------------------
// Orchestrator Class
// ---------------------------------------------------------------------------

export class Orchestrator {
  private readonly docker: Docker;
  private readonly options: OrchestratorOptions;
  private readonly managedContainers = new Map<
    string,
    { name: string; config: ContainerConfig; deployedAt: string }
  >();

  // Phase 7 components
  private readonly logger: Logger;
  private readonly circuitBreaker: CircuitBreaker | null;
  private readonly daemonMonitor: DaemonMonitor | null;
  private readonly shutdownManager: ShutdownManager;
  private readonly timeouts: TimeoutConfig;
  private readonly retryPolicies: RetryPolicies;
  private pendingOperations = 0;

  constructor(docker: Docker, options?: OrchestratorOptions) {
    this.docker = docker;
    this.options = options ?? {};

    // Logger
    this.logger = this.options.logger ?? new NoopLogger();

    // Timeouts
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...this.options.timeouts };

    // Retry policies
    this.retryPolicies = {
      ...DEFAULT_RETRY_POLICIES,
      ...this.options.retryPolicy,
    };

    // Circuit breaker
    if (this.options.circuitBreaker === false) {
      this.circuitBreaker = null;
    } else {
      this.circuitBreaker = new CircuitBreaker({
        ...this.options.circuitBreaker as Record<string, unknown> ?? {},
        logger: this.logger,
      } as ConstructorParameters<typeof CircuitBreaker>[0]);
    }

    // Daemon monitor
    if (this.options.daemonMonitor === false || this.options.daemonMonitor === undefined) {
      this.daemonMonitor = null;
    } else {
      const monitorOpts =
        typeof this.options.daemonMonitor === "object"
          ? this.options.daemonMonitor
          : {};
      this.daemonMonitor = new DaemonMonitor(docker, {
        ...monitorOpts,
        logger: this.logger,
      });
    }

    // Shutdown manager
    this.shutdownManager = new ShutdownManager({
      logger: this.logger,
    });

    if (this.circuitBreaker) {
      this.shutdownManager.register("circuit-breaker", () => {
        this.circuitBreaker?.destroy();
      });
    }

    if (this.daemonMonitor) {
      this.shutdownManager.register("daemon-monitor", () => {
        this.daemonMonitor?.destroy();
      });
    }
  }

  // -------------------------------------------------------------------------
  // 6.3.1 deployContainer
  // -------------------------------------------------------------------------

  /**
   * Full deployment workflow:
   * 1. Validate config (Zod schema, collect warnings)
   * 2. Ensure image exists (pull if needed)
   * 3. Create named volumes if missing
   * 4. Create custom networks if missing
   * 5. Create container
   * 6. Connect to additional networks
   * 7. Start container
   * 8. Wait for health check (if defined)
   * 9. On health check failure: stop + remove → DeploymentFailedError
   */
  async deploy(
    userConfig: ContainerConfig,
    onProgress?: ProgressCallback,
  ): Promise<DeployResult> {
    // Step 1: Validate config
    onProgress?.("validate", "Validating configuration");
    const config = ContainerConfigSchema.parse(userConfig);

    // Apply orchestrator defaults
    const finalConfig = this.applyDefaults(config);

    // Build docker config
    const { config: dockerConfig, warnings } =
      buildContainerConfig(finalConfig);

    // Add orchestrator labels
    const deployedAt = new Date().toISOString();
    dockerConfig.Labels = {
      ...dockerConfig.Labels,
      [MANAGED_LABEL]: "true",
      [DEPLOYED_AT_LABEL]: deployedAt,
    };

    // Step 2: Ensure image exists
    onProgress?.("image", `Checking image ${dockerConfig.Image}`);
    const imageRef = dockerConfig.Image!;
    try {
      const exists = await imageExists(this.docker, imageRef);
      if (!exists) {
        onProgress?.("pull", `Pulling image ${imageRef}`);
        const progressCb: PullProgressCallback | undefined = onProgress
          ? (evt) => onProgress("pull", evt.status + (evt.progress ?? ""))
          : undefined;
        await pullImage(this.docker, imageRef, progressCb);
      }
    } catch (err) {
      throw new ImagePullError(
        imageRef,
        err instanceof Error ? err.message : String(err),
        err instanceof Error ? err : undefined,
      );
    }

    // Step 3: Create named volumes if needed
    if (finalConfig.mounts) {
      for (const mount of finalConfig.mounts) {
        if (typeof mount === "object" && "type" in mount && mount.type === "volume" && "source" in mount) {
          const volName = mount.source as string;
          if (volName) {
            onProgress?.("volume", `Ensuring volume ${volName} exists`);
            const exists = await volumeExists(this.docker, volName);
            if (!exists) {
              await createVolume(this.docker, { name: volName } as Parameters<typeof createVolume>[1]);
            }
          }
        }
      }
    }

    // Step 4: Create custom networks if needed
    const networkNames = finalConfig.networks
      ? Object.keys(finalConfig.networks)
      : [];
    for (const netName of networkNames) {
      onProgress?.("network", `Ensuring network ${netName} exists`);
      try {
        const existingNets = await listNetworks(this.docker, {
          name: netName,
        });
        const exists = existingNets.some((n) => n.name === netName);
        if (!exists) {
          await createNetwork(this.docker, { name: netName } as Parameters<typeof createNetwork>[1]);
        }
      } catch {
        // Network creation may fail if it already exists; that's fine
      }
    }

    // Step 5: Create container
    onProgress?.("create", "Creating container");
    let containerId: string;
    try {
      const container = await this.docker.createContainer(dockerConfig);
      containerId = container.id;
    } catch (err) {
      throw new DeploymentFailedError(
        "create",
        err instanceof Error ? err.message : String(err),
        err instanceof Error ? err : undefined,
      );
    }

    // Step 6: Connect to additional networks (first network is handled by NetworkingConfig)
    if (networkNames.length > 1) {
      const additionalNetworks = networkNames.slice(1);
      for (const netName of additionalNetworks) {
        onProgress?.("network", `Connecting to network ${netName}`);
        try {
          const netOpts = finalConfig.networks![netName];
          const endpointConfig: Record<string, unknown> = {};
          if (netOpts.ipv4Address) {
            endpointConfig.IPAMConfig = {
              IPv4Address: netOpts.ipv4Address,
            };
          }
          if (netOpts.aliases) {
            endpointConfig.Aliases = netOpts.aliases;
          }

          await this.docker.getNetwork(netName).connect({
            Container: containerId,
            EndpointConfig:
              Object.keys(endpointConfig).length > 0
                ? endpointConfig
                : undefined,
          });
        } catch {
          // Best-effort network connection
        }
      }
    }

    // Step 7: Start container
    onProgress?.("start", "Starting container");
    try {
      await this.docker.getContainer(containerId).start();
    } catch (err) {
      // Cleanup on start failure
      try {
        await this.docker.getContainer(containerId).remove({ force: true });
      } catch { /* best effort */ }
      throw new DeploymentFailedError(
        "start",
        err instanceof Error ? err.message : String(err),
        err instanceof Error ? err : undefined,
      );
    }

    // Step 8: Health check
    let status: "running" | "healthy" = "running";
    if (finalConfig.healthCheck && finalConfig.healthCheck.type !== "none") {
      onProgress?.("healthcheck", "Waiting for container to become healthy");
      const hcResult = await waitForHealthy(
        this.docker,
        containerId,
        finalConfig.healthCheck,
      );

      if (hcResult.status === "timeout" || hcResult.status === "unhealthy") {
        // Step 9: Cleanup on health check failure
        try {
          await this.docker.getContainer(containerId).stop({ t: 5 });
        } catch { /* may not be running */ }
        try {
          await this.docker.getContainer(containerId).remove({ force: true });
        } catch { /* best effort */ }

        throw new DeploymentFailedError(
          "healthcheck",
          `Container failed health check: ${hcResult.lastError ?? "timeout"}`,
          new HealthCheckTimeoutError(containerId, 60000),
        );
      }

      status = "healthy";
    }

    // Resolve port mappings
    const ports = await this.getResolvedPorts(containerId);

    // Track managed container
    const containerName = finalConfig.name ?? containerId.substring(0, 12);
    this.managedContainers.set(containerId, {
      name: containerName,
      config: finalConfig,
      deployedAt,
    });

    return {
      containerId,
      name: containerName,
      status,
      ports,
      warnings,
    };
  }

  // -------------------------------------------------------------------------
  // 6.3.2 updateContainer
  // -------------------------------------------------------------------------

  /**
   * Updates a container with new configuration.
   * 1. Extract current config
   * 2. Compute diff
   * 3. Determine if restart required
   * 4. Recreate if necessary (with rollback)
   * 5. Wait for health check after update
   */
  async update(
    containerId: string,
    newConfig: Partial<ContainerConfig>,
    onProgress?: ProgressCallback,
  ): Promise<UpdateResult> {
    onProgress?.("inspect", "Inspecting current container config");

    // Extract current config
    const currentExtracted = await extractContainerConfig(
      this.docker,
      containerId,
    );

    // Build a comparable config from extracted data
    const currentUserConfig: Partial<ContainerConfig> =
      this.managedContainers.get(containerId)?.config ?? {
        image: currentExtracted.image,
        name: currentExtracted.name,
      };

    // Compute diff
    const changes = diffConfigs(currentUserConfig, {
      ...currentUserConfig,
      ...newConfig,
    });

    if (changes.length === 0) {
      return {
        containerId,
        changes: [],
        restarted: false,
        warnings: [],
      };
    }

    onProgress?.("diff", `${changes.length} change(s) detected`);

    // Determine if restart is required
    const restartRequired = requiresRestart(changes);

    if (restartRequired) {
      onProgress?.("recreate", "Changes require container recreation");

      try {
        // Merge new config values into recreation options
        const recreationOpts: Record<string, unknown> = {};
        if (newConfig.image) recreationOpts.image = newConfig.image;
        if (newConfig.env) recreationOpts.env = newConfig.env;
        if (newConfig.cmd) recreationOpts.cmd = newConfig.cmd;
        if (newConfig.entrypoint)
          recreationOpts.entrypoint = newConfig.entrypoint;
        if (newConfig.labels) recreationOpts.labels = newConfig.labels;
        if (newConfig.restartPolicy)
          recreationOpts.restartPolicy = newConfig.restartPolicy;

        const result = await recreateContainer(
          this.docker,
          containerId,
          recreationOpts,
        );

        const newContainerId = result.newContainerId;

        // Wait for health check on new container
        const mergedConfig = { ...currentUserConfig, ...newConfig };
        const warnings: ConfigWarning[] = [];

        if (mergedConfig.healthCheck && mergedConfig.healthCheck.type !== "none") {
          onProgress?.(
            "healthcheck",
            "Waiting for updated container to become healthy",
          );
          const hcResult = await waitForHealthy(
            this.docker,
            newContainerId,
            mergedConfig.healthCheck,
          );

          if (
            hcResult.status === "timeout" ||
            hcResult.status === "unhealthy"
          ) {
            warnings.push({
              level: "critical",
              code: "no-memory-limit",
              message: `Updated container failed health check: ${hcResult.lastError ?? "timeout"}`,
            });
          }
        }

        // Update internal tracking
        if (this.managedContainers.has(containerId)) {
          const tracked = this.managedContainers.get(containerId)!;
          this.managedContainers.delete(containerId);
          this.managedContainers.set(newContainerId, {
            ...tracked,
            config: { ...tracked.config, ...newConfig } as ContainerConfig,
          });
        }

        return {
          containerId: newContainerId,
          changes,
          restarted: true,
          warnings,
        };
      } catch (err) {
        if (
          err instanceof Error &&
          (err.name === "RecreationFailedError" ||
            err.name === "CriticalRecreationError")
        ) {
          throw new UpdateFailedError(
            containerId,
            err.name === "RecreationFailedError" ? "succeeded" : "failed",
            err.message,
            err,
          );
        }
        throw new UpdateFailedError(
          containerId,
          "not_attempted",
          err instanceof Error ? err.message : String(err),
          err instanceof Error ? err : undefined,
        );
      }
    }

    // No restart needed: apply live updates where possible (labels only for now)
    const warnings: ConfigWarning[] = [];
    // Docker doesn't support live label updates without recreation,
    // but we track the intent
    if (this.managedContainers.has(containerId)) {
      const tracked = this.managedContainers.get(containerId)!;
      tracked.config = { ...tracked.config, ...newConfig } as ContainerConfig;
    }

    return {
      containerId,
      changes,
      restarted: false,
      warnings,
    };
  }

  // -------------------------------------------------------------------------
  // 6.3.3 destroyContainer
  // -------------------------------------------------------------------------

  /**
   * Destroys a container with optional volume cleanup.
   * 1. Inspect container config
   * 2. Stop container (graceful or force)
   * 3. Remove container
   * 4. Remove named volumes (if requested)
   * 5. Cleanup orphaned networks
   */
  async destroy(
    containerId: string,
    options?: Partial<DestroyOptions>,
  ): Promise<void> {
    const opts = DestroyOptionsSchema.parse(options ?? {});

    // Inspect to get config for volume/network cleanup
    let volumeNames: string[] = [];
    try {
      const data = (await this.docker
        .getContainer(containerId)
        .inspect()) as unknown as Record<string, unknown>;
      const mounts = (data.Mounts ?? []) as Array<{
        Type?: string;
        Name?: string;
      }>;

      // Collect named volume names
      volumeNames = mounts
        .filter((m) => m.Type === "volume" && m.Name)
        .map((m) => m.Name!);
    } catch (err) {
      const error = err as { statusCode?: number };
      if (error.statusCode === 404) {
        throw new ContainerNotFoundError(
          containerId,
          err instanceof Error ? err : undefined,
        );
      }
      // If we can't inspect, proceed with stop/remove
    }

    // Stop container
    try {
      if (opts.force) {
        await this.docker
          .getContainer(containerId)
          .stop({ t: 0 });
      } else {
        await this.docker
          .getContainer(containerId)
          .stop({ t: opts.timeout });
      }
    } catch {
      // Container may already be stopped
    }

    // Remove container
    try {
      await this.docker
        .getContainer(containerId)
        .remove({ force: opts.force });
    } catch (err) {
      const error = err as { statusCode?: number };
      if (error.statusCode === 404) {
        // Already gone
      } else {
        throw mapDockerError(err, { containerId });
      }
    }

    // Remove named volumes if requested
    if (opts.removeVolumes && volumeNames.length > 0) {
      for (const volName of volumeNames) {
        try {
          await this.docker.getVolume(volName).remove();
        } catch {
          // Best effort - volume may be in use by another container
        }
      }
    }

    // Clean up internal tracking
    this.managedContainers.delete(containerId);
  }

  // -------------------------------------------------------------------------
  // 6.3.4 Batch Operations
  // -------------------------------------------------------------------------

  /**
   * Deploy multiple containers in parallel with concurrency limit.
   * Errors in one container do not stop others.
   */
  async deployMany(
    configs: ContainerConfig[],
    options?: { concurrency?: number; onProgress?: ProgressCallback },
  ): Promise<BatchResult<DeployResult>> {
    const concurrency = options?.concurrency ?? 5;
    return this.batchExecute(
      configs,
      (config, idx) =>
        this.deploy(config, (step, detail) =>
          options?.onProgress?.(`[${idx}] ${step}`, detail),
        ),
      concurrency,
    );
  }

  /**
   * Destroy multiple containers in parallel.
   */
  async destroyMany(
    containerIds: string[],
    options?: Partial<DestroyOptions> & { concurrency?: number },
  ): Promise<BatchResult<void>> {
    const { concurrency = 5, ...destroyOpts } = options ?? {};
    return this.batchExecute(
      containerIds,
      (id) => this.destroy(id, destroyOpts),
      concurrency,
    );
  }

  /**
   * Update multiple containers in parallel.
   */
  async updateMany(
    updates: Array<{ containerId: string; config: Partial<ContainerConfig> }>,
    options?: { concurrency?: number; onProgress?: ProgressCallback },
  ): Promise<BatchResult<UpdateResult>> {
    const concurrency = options?.concurrency ?? 5;
    return this.batchExecute(
      updates,
      (upd, idx) =>
        this.update(upd.containerId, upd.config, (step, detail) =>
          options?.onProgress?.(`[${idx}] ${step}`, detail),
        ),
      concurrency,
    );
  }

  // -------------------------------------------------------------------------
  // 6.5 Container State Tracking
  // -------------------------------------------------------------------------

  /**
   * Lists only containers managed by this orchestrator.
   */
  async listManagedContainers(): Promise<
    Array<{
      containerId: string;
      name: string;
      status: string;
      deployedAt: string;
    }>
  > {
    const containers = await this.docker.listContainers({
      all: true,
      filters: JSON.stringify({
        label: [`${MANAGED_LABEL}=true`],
      }),
    });

    return (containers as unknown as Array<Record<string, unknown>>).map((c) => {
      const names = (c.Names ?? []) as string[];
      const labels = (c.Labels ?? {}) as Record<string, string>;
      return {
        containerId: c.Id as string,
        name: (names[0] ?? "").replace(/^\//, ""),
        status: c.State as string,
        deployedAt: labels[DEPLOYED_AT_LABEL] ?? "unknown",
      };
    });
  }

  /**
   * Syncs internal state with Docker reality.
   * Identifies orphaned containers (have orchestrator labels but not tracked internally).
   */
  async syncState(): Promise<{
    synced: number;
    orphans: string[];
  }> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: JSON.stringify({
        label: [`${MANAGED_LABEL}=true`],
      }),
    });

    const orphans: string[] = [];
    let synced = 0;

    for (const c of containers as unknown as Array<Record<string, unknown>>) {
      const id = c.Id as string;
      if (this.managedContainers.has(id)) {
        synced++;
      } else {
        orphans.push(id);
      }
    }

    return { synced, orphans };
  }

  // -------------------------------------------------------------------------
  // 7.12 Health & Shutdown
  // -------------------------------------------------------------------------

  health(): OrchestratorHealthStatus {
    return {
      daemon: this.daemonMonitor?.getState() ?? "connected",
      circuit: this.circuitBreaker?.getState() ?? "closed",
      activeStreams: 0,
      pendingOperations: this.pendingOperations,
    };
  }

  async shutdown(): Promise<void> {
    this.logger.info("Orchestrator shutdown requested");
    await this.shutdownManager.shutdown();
  }

  // -------------------------------------------------------------------------
  // Accessors for sub-modules (power-user access)
  // -------------------------------------------------------------------------

  get client(): Docker {
    return this.docker;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private applyDefaults(config: ContainerConfig): ContainerConfig {
    const result = { ...config };

    // Apply default security profile if not set
    if (
      !result.securityProfile &&
      !result.security &&
      this.options.defaultSecurityProfile
    ) {
      result.securityProfile = this.options.defaultSecurityProfile;
    }

    // Apply default network
    if (!result.networks && this.options.defaultNetwork) {
      result.networks = {
        [this.options.defaultNetwork]: {},
      };
    }

    // Apply default labels
    if (this.options.defaultLabels) {
      result.labels = {
        ...this.options.defaultLabels,
        ...result.labels,
      };
    }

    return result;
  }

  private async getResolvedPorts(
    containerId: string,
  ): Promise<ResolvedPortMapping[]> {
    try {
      const data = (await this.docker.getContainer(containerId).inspect()) as unknown as Record<string, unknown>;
      const ports = data.NetworkSettings as Record<
        string,
        unknown
      >;
      const portMap = (ports?.Ports ?? {}) as Record<
        string,
        Array<{ HostIp: string; HostPort: string }> | null
      >;

      const resolved: ResolvedPortMapping[] = [];
      for (const [key, bindings] of Object.entries(portMap)) {
        if (!bindings || bindings.length === 0) continue;
        const [portStr, protocol] = key.split("/");
        const containerPort = parseInt(portStr, 10);
        for (const binding of bindings) {
          const hostPort = parseInt(binding.HostPort, 10);
          if (!isNaN(hostPort) && hostPort > 0) {
            resolved.push({
              containerPort,
              hostPort,
              protocol: (protocol as "tcp" | "udp") ?? "tcp",
              hostIp: binding.HostIp || "0.0.0.0",
            });
          }
        }
      }
      return resolved;
    } catch {
      return [];
    }
  }

  private async batchExecute<TInput, TResult>(
    items: TInput[],
    fn: (item: TInput, index: number) => Promise<TResult>,
    concurrency: number,
  ): Promise<BatchResult<TResult>> {
    const results: BatchItemResult<TResult>[] = [];
    let succeeded = 0;
    let failed = 0;

    // Process in batches of `concurrency`
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      const batchPromises = batch.map((item, batchIdx) => {
        const index = i + batchIdx;
        return fn(item, index)
          .then((value) => {
            succeeded++;
            results.push({ status: "fulfilled", value, index });
          })
          .catch((err) => {
            failed++;
            results.push({
              status: "rejected",
              reason: err instanceof Error ? err : new Error(String(err)),
              index,
            });
          });
      });

      await Promise.all(batchPromises);
    }

    // Sort by original index
    results.sort((a, b) => a.index - b.index);

    return { results, succeeded, failed };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fields that require container restart/recreation when changed */
const RESTART_FIELDS = new Set([
  "image",
  "tag",
  "ports",
  "portMappings",
  "resources",
  "security",
  "securityProfile",
  "cmd",
  "entrypoint",
  "workingDir",
  "volumes",
  "mounts",
  "networks",
  "hostname",
  "dns",
  "tmpfs",
  "healthCheck",
]);

function requiresRestart(changes: ConfigDiff[]): boolean {
  return changes.some((c) => RESTART_FIELDS.has(c.field));
}

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------

/**
 * Convenience factory for creating an Orchestrator instance.
 */
export function createOrchestrator(
  docker: Docker,
  options?: OrchestratorOptions,
): Orchestrator {
  return new Orchestrator(docker, options);
}
