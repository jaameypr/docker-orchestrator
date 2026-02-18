import { createServer } from "node:net";
import type Docker from "dockerode";
import { PortAlreadyInUseError } from "../errors/base.js";
import type {
  PortMappingInput,
  ResolvedPortMapping,
  DockerPortConfig,
  AssignedPort,
} from "../types/ports.js";
import { PortMappingInputSchema } from "../types/ports.js";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parses a single port mapping input into one or more ResolvedPortMappings.
 *
 * Supports:
 *   - number: 8080 → host 8080 : container 8080 / tcp
 *   - string: "8080:80" → host 8080 : container 80 / tcp
 *   - string: "127.0.0.1:8080:80" → bound to 127.0.0.1
 *   - string: "8080:80/udp" → UDP protocol
 *   - string: "8080-8090:80-90" → port range
 *   - object: { host, container, protocol, ip }
 */
export function parsePortMapping(input: PortMappingInput): ResolvedPortMapping[] {
  const parsed = PortMappingInputSchema.parse(input);

  if (typeof parsed === "number") {
    return [
      {
        hostPort: parsed,
        containerPort: parsed,
        protocol: "tcp",
        hostIp: "0.0.0.0",
      },
    ];
  }

  if (typeof parsed === "string") {
    return parsePortString(parsed);
  }

  // Object syntax
  return [
    {
      hostPort: parsed.host,
      containerPort: parsed.container,
      protocol: parsed.protocol,
      hostIp: parsed.ip,
    },
  ];
}

function parsePortString(spec: string): ResolvedPortMapping[] {
  // Extract protocol suffix
  let protocol: "tcp" | "udp" = "tcp";
  let rest = spec;

  const slashIdx = spec.lastIndexOf("/");
  if (slashIdx !== -1) {
    const proto = spec.substring(slashIdx + 1).toLowerCase();
    if (proto === "tcp" || proto === "udp") {
      protocol = proto;
      rest = spec.substring(0, slashIdx);
    }
  }

  const parts = rest.split(":");

  let hostIp = "0.0.0.0";
  let hostPart: string;
  let containerPart: string;

  if (parts.length === 3) {
    // ip:hostPort:containerPort
    hostIp = parts[0];
    hostPart = parts[1];
    containerPart = parts[2];
  } else if (parts.length === 2) {
    // hostPort:containerPort
    hostPart = parts[0];
    containerPart = parts[1];
  } else if (parts.length === 1) {
    // Just containerPort (auto-assign host port)
    hostPart = parts[0];
    containerPart = parts[0];
  } else {
    throw new Error(`Invalid port mapping format: ${spec}`);
  }

  // Check for port range
  if (hostPart.includes("-") && containerPart.includes("-")) {
    return expandPortRange(hostPart, containerPart, protocol, hostIp);
  }

  const hostPort = parseInt(hostPart, 10);
  const containerPort = parseInt(containerPart, 10);

  if (isNaN(hostPort) || isNaN(containerPort)) {
    throw new Error(`Invalid port numbers in: ${spec}`);
  }

  if (containerPort <= 0 || containerPort > 65535) {
    throw new Error(`Container port out of range: ${containerPort}`);
  }

  if (hostPort < 0 || hostPort > 65535) {
    throw new Error(`Host port out of range: ${hostPort}`);
  }

  return [{ hostPort, containerPort, protocol, hostIp }];
}

function expandPortRange(
  hostRange: string,
  containerRange: string,
  protocol: "tcp" | "udp",
  hostIp: string,
): ResolvedPortMapping[] {
  const [hostStart, hostEnd] = hostRange.split("-").map(Number);
  const [containerStart, containerEnd] = containerRange.split("-").map(Number);

  if (
    isNaN(hostStart) || isNaN(hostEnd) ||
    isNaN(containerStart) || isNaN(containerEnd)
  ) {
    throw new Error(
      `Invalid port range: ${hostRange}:${containerRange}`,
    );
  }

  const hostCount = hostEnd - hostStart + 1;
  const containerCount = containerEnd - containerStart + 1;

  if (hostCount !== containerCount) {
    throw new Error(
      `Port range mismatch: host range has ${hostCount} ports, container range has ${containerCount} ports`,
    );
  }

  if (hostCount <= 0) {
    throw new Error(`Invalid port range: start must be <= end`);
  }

  const mappings: ResolvedPortMapping[] = [];
  for (let i = 0; i < hostCount; i++) {
    mappings.push({
      hostPort: hostStart + i,
      containerPort: containerStart + i,
      protocol,
      hostIp,
    });
  }

  return mappings;
}

// ---------------------------------------------------------------------------
// Batch parsing
// ---------------------------------------------------------------------------

/**
 * Parses an array of port mapping inputs into resolved mappings.
 */
export function parsePortMappings(inputs: PortMappingInput[]): ResolvedPortMapping[] {
  return inputs.flatMap(parsePortMapping);
}

// ---------------------------------------------------------------------------
// Transformation → Docker API format
// ---------------------------------------------------------------------------

/**
 * Converts resolved port mappings to Docker API format
 * (ExposedPorts + HostConfig.PortBindings).
 */
export function toDockerPortConfig(mappings: ResolvedPortMapping[]): DockerPortConfig {
  const exposedPorts: Record<string, object> = {};
  const portBindings: Record<string, Array<{ HostIp: string; HostPort: string }>> = {};

  for (const m of mappings) {
    const key = `${m.containerPort}/${m.protocol}`;
    exposedPorts[key] = {};

    if (!portBindings[key]) {
      portBindings[key] = [];
    }
    portBindings[key].push({
      HostIp: m.hostIp,
      HostPort: String(m.hostPort),
    });
  }

  return { exposedPorts, portBindings };
}

/**
 * High-level function: parse user inputs and produce Docker API config.
 */
export function resolvePortMappings(inputs: PortMappingInput[]): DockerPortConfig {
  const resolved = parsePortMappings(inputs);
  return toDockerPortConfig(resolved);
}

// ---------------------------------------------------------------------------
// Port conflict detection
// ---------------------------------------------------------------------------

/**
 * Checks if a host port is available by attempting to bind a socket.
 * Returns true if the port is available, false if in use.
 */
export function checkPortAvailable(port: number, host = "0.0.0.0"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, host);
  });
}

/**
 * Finds the next available port starting from a given port number.
 */
async function findAvailablePort(startPort: number, host = "0.0.0.0"): Promise<number> {
  const maxAttempts = 100;
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (port > 65535) break;
    if (await checkPortAvailable(port, host)) {
      return port;
    }
  }
  return startPort + 1; // Fallback suggestion
}

/**
 * Validates that all host ports in the resolved mappings are available.
 * Throws PortAlreadyInUseError if a port is already in use.
 * Skips ports with hostPort=0 (auto-assign).
 */
export async function validatePortAvailability(
  mappings: ResolvedPortMapping[],
): Promise<void> {
  for (const m of mappings) {
    if (m.hostPort === 0) continue; // auto-assign, skip check

    const available = await checkPortAvailable(m.hostPort, m.hostIp);
    if (!available) {
      const suggested = await findAvailablePort(m.hostPort + 1, m.hostIp);
      throw new PortAlreadyInUseError(m.hostPort, suggested);
    }
  }
}

// ---------------------------------------------------------------------------
// Utility: get assigned ports from a running container
// ---------------------------------------------------------------------------

/**
 * Reads the actually assigned ports from a running container.
 * Useful when host port was set to 0 (auto-assign by Docker).
 */
export async function getAssignedPorts(
  docker: Docker,
  containerId: string,
): Promise<AssignedPort[]> {
  const container = docker.getContainer(containerId);
  const data = await container.inspect();

  const ports: AssignedPort[] = [];
  const networkPorts = data.NetworkSettings?.Ports ?? {};

  for (const [key, bindings] of Object.entries(networkPorts)) {
    if (!bindings) continue;

    const [portStr, protocol] = key.split("/");
    const containerPort = parseInt(portStr, 10);

    for (const binding of bindings) {
      ports.push({
        containerPort,
        hostPort: parseInt(binding.HostPort, 10),
        protocol: protocol ?? "tcp",
        hostIp: binding.HostIp || "0.0.0.0",
      });
    }
  }

  return ports;
}
