import type Docker from "dockerode";
import { mapDockerError } from "../errors/mapping.js";
import {
  NetworkNotFoundError,
  NetworkAlreadyExistsError,
  ContainerStillConnectedError,
  InvalidSubnetError,
} from "../errors/base.js";
import {
  NetworkCreateOptionsSchema,
  ConnectOptionsSchema,
  type NetworkCreateOptions,
  type ConnectOptions,
  type NetworkInfo,
  type NetworkListFilter,
  type NetworkContainerInfo,
} from "../types/network.js";

// ---------------------------------------------------------------------------
// IP-in-Subnet validation helper
// ---------------------------------------------------------------------------

function ipToLong(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isIpInSubnet(ip: string, cidr: string): boolean {
  const [subnetIp, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr, 10);

  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const ipLong = ipToLong(ip);
  const subnetLong = ipToLong(subnetIp);

  return (ipLong & mask) === (subnetLong & mask);
}

// ---------------------------------------------------------------------------
// Create Network
// ---------------------------------------------------------------------------

/**
 * Creates a Docker network with the given options.
 * Checks for duplicate names before creation.
 */
export async function createNetwork(
  docker: Docker,
  options: NetworkCreateOptions,
): Promise<string> {
  const config = NetworkCreateOptionsSchema.parse(options);

  // Duplicate detection
  try {
    const existing = await docker.listNetworks({
      filters: JSON.stringify({ name: [config.name] }),
    });
    const exactMatch = existing.find((n: { Name: string }) => n.Name === config.name);
    if (exactMatch) {
      throw new NetworkAlreadyExistsError(config.name);
    }
  } catch (err) {
    if (err instanceof NetworkAlreadyExistsError) throw err;
    // Ignore list errors and try to create anyway
  }

  const ipamConfig: Array<{ Subnet?: string; Gateway?: string }> = [];
  if (config.subnet || config.gateway) {
    ipamConfig.push({
      Subnet: config.subnet,
      Gateway: config.gateway,
    });
  }

  try {
    const network = await docker.createNetwork({
      Name: config.name,
      Driver: config.driver,
      Internal: config.internal,
      EnableIPv6: config.enableIPv6,
      IPAM: ipamConfig.length > 0 ? { Driver: "default", Config: ipamConfig } : undefined,
      Labels: config.labels,
    });

    return network.id;
  } catch (err) {
    const error = err as { statusCode?: number; message?: string };
    if (error.statusCode === 409 || error.message?.includes("already exists")) {
      throw new NetworkAlreadyExistsError(config.name, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err);
  }
}

// ---------------------------------------------------------------------------
// Remove Network
// ---------------------------------------------------------------------------

/**
 * Removes a Docker network.
 * If force is false, checks for connected containers first.
 */
export async function removeNetwork(
  docker: Docker,
  networkId: string,
  force = false,
): Promise<void> {
  const network = docker.getNetwork(networkId);

  if (!force) {
    // Check for connected containers
    try {
      const info = await network.inspect();
      const containers = info.Containers ?? {};
      const connectedIds = Object.keys(containers);

      if (connectedIds.length > 0) {
        const names = connectedIds.map((id) => containers[id]?.Name ?? id.substring(0, 12));
        throw new ContainerStillConnectedError(networkId, names);
      }
    } catch (err) {
      if (err instanceof ContainerStillConnectedError) throw err;
      const error = err as { statusCode?: number };
      if (error.statusCode === 404) {
        throw new NetworkNotFoundError(networkId, err instanceof Error ? err : undefined);
      }
      throw mapDockerError(err);
    }
  }

  try {
    await network.remove();
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      throw new NetworkNotFoundError(networkId, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err);
  }
}

// ---------------------------------------------------------------------------
// Inspect Network
// ---------------------------------------------------------------------------

/**
 * Returns detailed info about a network, including connected containers.
 */
export async function inspectNetwork(docker: Docker, networkId: string): Promise<NetworkInfo> {
  try {
    const data = await docker.getNetwork(networkId).inspect();

    const containers: Record<string, NetworkContainerInfo> = {};
    for (const [id, info] of Object.entries(data.Containers ?? {})) {
      const cInfo = info as {
        Name?: string;
        IPv4Address?: string;
        MacAddress?: string;
      };
      containers[id] = {
        containerId: id,
        name: cInfo.Name ?? "",
        ipv4Address: cInfo.IPv4Address ?? "",
        macAddress: cInfo.MacAddress ?? "",
      };
    }

    return {
      id: data.Id,
      name: data.Name,
      driver: data.Driver,
      scope: data.Scope,
      internal: data.Internal ?? false,
      enableIPv6: data.EnableIPv6 ?? false,
      ipam: {
        driver: data.IPAM?.Driver ?? "default",
        config: data.IPAM?.Config ?? [],
      },
      containers,
      labels: data.Labels ?? {},
      created: data.Created ?? "",
    };
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      throw new NetworkNotFoundError(networkId, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err);
  }
}

// ---------------------------------------------------------------------------
// List Networks
// ---------------------------------------------------------------------------

/**
 * Lists all networks, with optional filters.
 */
export async function listNetworks(
  docker: Docker,
  filter?: NetworkListFilter,
): Promise<NetworkInfo[]> {
  try {
    const filters: Record<string, string[]> = {};
    if (filter?.driver) filters.driver = [filter.driver];
    if (filter?.name) filters.name = [filter.name];
    if (filter?.label) filters.label = filter.label;
    if (filter?.scope) filters.scope = [filter.scope];

    const networks = await docker.listNetworks({
      filters: Object.keys(filters).length > 0 ? JSON.stringify(filters) : undefined,
    });

    return networks.map((n) => {
      const net = n as unknown as Record<string, unknown>;
      const ipam = net.IPAM as
        | { Driver?: string; Config?: Array<{ Subnet?: string; Gateway?: string }> }
        | undefined;
      return {
        id: net.Id as string,
        name: net.Name as string,
        driver: net.Driver as string,
        scope: net.Scope as string,
        internal: (net.Internal ?? false) as boolean,
        enableIPv6: (net.EnableIPv6 ?? false) as boolean,
        ipam: {
          driver: ipam?.Driver ?? "default",
          config: ipam?.Config ?? [],
        },
        containers: {},
        labels: (net.Labels ?? {}) as Record<string, string>,
        created: (net.Created ?? "") as string,
      };
    });
  } catch (err) {
    throw mapDockerError(err);
  }
}

// ---------------------------------------------------------------------------
// Connect Container
// ---------------------------------------------------------------------------

/**
 * Connects a container to a network, with optional DNS aliases and fixed IP.
 * Validates that the IP is within the network's subnet if provided.
 */
export async function connectContainer(
  docker: Docker,
  networkId: string,
  containerId: string,
  options?: ConnectOptions,
): Promise<void> {
  const opts = options ? ConnectOptionsSchema.parse(options) : {};

  // Validate IP against subnet if provided
  if (opts.ipv4Address) {
    try {
      const netInfo = await docker.getNetwork(networkId).inspect();
      const ipamConfigs = netInfo.IPAM?.Config ?? [];

      if (ipamConfigs.length > 0) {
        const subnet = ipamConfigs[0]?.Subnet;
        if (subnet && !isIpInSubnet(opts.ipv4Address, subnet)) {
          throw new InvalidSubnetError(opts.ipv4Address, subnet);
        }
      }
    } catch (err) {
      if (err instanceof InvalidSubnetError) throw err;
      const error = err as { statusCode?: number };
      if (error.statusCode === 404) {
        throw new NetworkNotFoundError(networkId, err instanceof Error ? err : undefined);
      }
      // If we can't inspect, proceed anyway and let Docker validate
    }
  }

  const endpointConfig: Record<string, unknown> = {};
  if (opts.ipv4Address) {
    endpointConfig.IPAMConfig = { IPv4Address: opts.ipv4Address };
  }
  if (opts.aliases) {
    endpointConfig.Aliases = opts.aliases;
  }

  try {
    await docker.getNetwork(networkId).connect({
      Container: containerId,
      EndpointConfig: Object.keys(endpointConfig).length > 0 ? endpointConfig : undefined,
    });
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      throw new NetworkNotFoundError(networkId, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err, { containerId });
  }
}

// ---------------------------------------------------------------------------
// Disconnect Container
// ---------------------------------------------------------------------------

/**
 * Disconnects a container from a network.
 */
export async function disconnectContainer(
  docker: Docker,
  networkId: string,
  containerId: string,
  force = false,
): Promise<void> {
  try {
    await docker.getNetwork(networkId).disconnect({
      Container: containerId,
      Force: force,
    });
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      throw new NetworkNotFoundError(networkId, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err, { containerId });
  }
}

// ---------------------------------------------------------------------------
// Prune Networks
// ---------------------------------------------------------------------------

/**
 * Removes all unused networks. Returns the names of deleted networks.
 */
export async function pruneNetworks(docker: Docker): Promise<string[]> {
  try {
    const result = await docker.pruneNetworks();
    return result.NetworksDeleted ?? [];
  } catch (err) {
    throw mapDockerError(err);
  }
}
