import type Docker from "dockerode";
import {
  StackConfigSchema,
  type StackConfig,
  type StackDeployResult,
  type StackServiceResult,
} from "../types/stack.js";
import type { ContainerConfig } from "../builders/config-builder.js";
import type { ConfigWarning } from "../types/warnings.js";
import type { DeployResult, ProgressCallback } from "../types/orchestrator.js";
import { Orchestrator } from "./orchestrator.js";
import { DependencyResolutionError } from "../errors/base.js";
import { createNetwork, listNetworks, removeNetwork } from "./network.js";

// ---------------------------------------------------------------------------
// Stack Labels
// ---------------------------------------------------------------------------

const STACK_LABEL = "orchestrator.stack";
const STACK_SERVICE_LABEL = "orchestrator.stack.service";

// ---------------------------------------------------------------------------
// Dependency Resolution (Topological Sort)
// ---------------------------------------------------------------------------

/**
 * Performs topological sort on services based on dependsOn.
 * Throws DependencyResolutionError on circular dependencies.
 */
export function resolveDependencyOrder(
  containers: Record<string, { dependsOn?: string[] }>,
): string[] {
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Initialize
  for (const name of Object.keys(containers)) {
    graph.set(name, []);
    inDegree.set(name, 0);
  }

  // Build edges
  for (const [name, config] of Object.entries(containers)) {
    if (config.dependsOn) {
      for (const dep of config.dependsOn) {
        if (!graph.has(dep)) {
          throw new DependencyResolutionError([name, dep]);
        }
        graph.get(dep)!.push(name);
        inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);

    for (const neighbor of graph.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (order.length !== Object.keys(containers).length) {
    // Find the cycle
    const remaining = Object.keys(containers).filter((n) => !order.includes(n));
    throw new DependencyResolutionError(remaining);
  }

  return order;
}

// ---------------------------------------------------------------------------
// Deploy Stack
// ---------------------------------------------------------------------------

/**
 * Deploys a full stack of containers in dependency order.
 * Creates shared networks, then deploys services respecting dependsOn.
 */
export async function deployStack(
  docker: Docker,
  stackConfig: StackConfig,
  onProgress?: ProgressCallback,
): Promise<StackDeployResult> {
  const config = StackConfigSchema.parse(stackConfig);
  const orchestrator = new Orchestrator(docker);
  const warnings: ConfigWarning[] = [];
  const createdNetworks: string[] = [];

  // Create stack network (shared by all services)
  const stackNetworkName = `${config.name}_default`;
  onProgress?.("network", `Creating stack network ${stackNetworkName}`);
  try {
    const existingNets = await listNetworks(docker, {
      name: stackNetworkName,
    });
    const exists = existingNets.some((n) => n.name === stackNetworkName);
    if (!exists) {
      await createNetwork(docker, {
        name: stackNetworkName,
        labels: { [STACK_LABEL]: config.name },
      } as unknown as Parameters<typeof createNetwork>[1]);
      createdNetworks.push(stackNetworkName);
    }
  } catch {
    // May already exist
  }

  // Create additional networks
  if (config.networks) {
    for (const [netName, netConfig] of Object.entries(config.networks)) {
      const fullNetName = `${config.name}_${netName}`;
      onProgress?.("network", `Creating network ${fullNetName}`);
      try {
        const existingNets = await listNetworks(docker, {
          name: fullNetName,
        });
        const exists = existingNets.some((n) => n.name === fullNetName);
        if (!exists) {
          await createNetwork(docker, {
            name: fullNetName,
            driver:
              netConfig.driver === "host" || netConfig.driver === "none"
                ? "bridge"
                : netConfig.driver,
            internal: netConfig.internal,
            labels: {
              [STACK_LABEL]: config.name,
              ...netConfig.labels,
            },
          } as unknown as Parameters<typeof createNetwork>[1]);
          createdNetworks.push(fullNetName);
        }
      } catch {
        // May already exist
      }
    }
  }

  // Resolve deployment order
  const deployOrder = resolveDependencyOrder(config.containers);
  const serviceResults: StackServiceResult[] = [];

  // Deploy services in order
  for (const serviceName of deployOrder) {
    const serviceConfig = config.containers[serviceName];
    const scale = serviceConfig.scale ?? 1;
    const deployResults: DeployResult[] = [];

    for (let i = 0; i < scale; i++) {
      const instanceName =
        scale > 1 ? `${config.name}_${serviceName}_${i + 1}` : `${config.name}_${serviceName}`;

      // Build container config from service config
      const containerConfig: ContainerConfig = {
        ...serviceConfig,
        name: instanceName,
        labels: {
          ...serviceConfig.labels,
          [STACK_LABEL]: config.name,
          [STACK_SERVICE_LABEL]: serviceName,
        },
        // Connect to stack network for service discovery
        networks: {
          [stackNetworkName]: {
            aliases: [serviceName],
          },
          ...serviceConfig.networks,
        },
      };

      onProgress?.(
        "deploy",
        `Deploying ${instanceName} (${deployOrder.indexOf(serviceName) + 1}/${deployOrder.length})`,
      );

      try {
        const result = await orchestrator.deploy(containerConfig);
        deployResults.push(result);
      } catch (err) {
        warnings.push({
          level: "critical",
          code: "no-memory-limit",
          message: `Failed to deploy service ${serviceName}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    serviceResults.push({ serviceName, deployResults });
  }

  return {
    stackName: config.name,
    services: serviceResults,
    networks: createdNetworks,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Destroy Stack
// ---------------------------------------------------------------------------

/**
 * Destroys all containers in a stack in reverse dependency order.
 * Then removes stack networks.
 */
export async function destroyStack(
  docker: Docker,
  stackName: string,
  options?: { removeVolumes?: boolean; timeout?: number },
): Promise<void> {
  const removeVolumes = options?.removeVolumes ?? false;
  const timeout = options?.timeout ?? 10;

  // Find all containers in this stack
  const containers = await docker.listContainers({
    all: true,
    filters: JSON.stringify({
      label: [`${STACK_LABEL}=${stackName}`],
    }),
  });

  // Stop and remove containers in reverse order
  for (const container of containers.reverse()) {
    try {
      const c = docker.getContainer(container.Id);
      if (container.State === "running") {
        await c.stop({ t: timeout });
      }
      await c.remove({ force: true, v: removeVolumes });
    } catch {
      // Best effort
    }
  }

  // Remove stack networks
  const networks = await docker.listNetworks({
    filters: JSON.stringify({
      label: [`${STACK_LABEL}=${stackName}`],
    }),
  });

  for (const net of networks) {
    try {
      const netObj = net as unknown as Record<string, unknown>;
      await removeNetwork(docker, (netObj.Id ?? "") as string, true);
    } catch {
      // Best effort
    }
  }
}
