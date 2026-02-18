import Docker from "dockerode";
import { existsSync } from "node:fs";
import { ConnectionError } from "../errors/base.js";
import { mapDockerError } from "../errors/mapping.js";
import { ClientOptionsSchema, type ClientOptions, type DockerVersionInfo } from "../types/index.js";

const DEFAULT_SOCKET_PATH = "/var/run/docker.sock";
const MIN_DOCKER_VERSION = "20.10";

function detectSocketPath(): string | undefined {
  if (existsSync(DEFAULT_SOCKET_PATH)) {
    return DEFAULT_SOCKET_PATH;
  }
  return undefined;
}

function parseVersion(version: string): number[] {
  return version.split(".").map(Number);
}

function isVersionAtLeast(current: string, minimum: string): boolean {
  const curr = parseVersion(current);
  const min = parseVersion(minimum);
  for (let i = 0; i < min.length; i++) {
    const c = curr[i] ?? 0;
    const m = min[i] ?? 0;
    if (c > m) return true;
    if (c < m) return false;
  }
  return true;
}

export interface CreateClientResult {
  docker: Docker;
  versionInfo: DockerVersionInfo;
}

/**
 * Creates and validates a Docker client connection.
 *
 * Auto-detects the Docker socket on Linux if no options are provided.
 * Tests the connection via ping and retrieves version info.
 * Warns if Docker version is below 20.10.
 */
export async function createClient(options?: ClientOptions): Promise<CreateClientResult> {
  const parsed = ClientOptionsSchema.parse(options ?? {});

  const dockerOptions: Docker.DockerOptions = {};

  if (parsed.host) {
    dockerOptions.host = parsed.host;
    dockerOptions.port = parsed.port;

    if (parsed.ca || parsed.cert || parsed.key) {
      dockerOptions.ca = parsed.ca;
      dockerOptions.cert = parsed.cert;
      dockerOptions.key = parsed.key;
    }
  } else {
    const socketPath = parsed.socketPath ?? detectSocketPath();
    if (!socketPath) {
      throw new ConnectionError(
        `Docker socket not found at ${DEFAULT_SOCKET_PATH}. Provide socketPath or host/port options.`,
      );
    }
    dockerOptions.socketPath = socketPath;
  }

  const docker = new Docker(dockerOptions);

  // Test connectivity
  try {
    await docker.ping();
  } catch (err) {
    throw mapDockerError(err);
  }

  // Retrieve version info
  let versionInfo: DockerVersionInfo;
  try {
    const info = await docker.version();
    versionInfo = {
      version: info.Version,
      apiVersion: info.ApiVersion,
      os: info.Os,
      arch: info.Arch,
      kernelVersion: info.KernelVersion,
    };
  } catch (err) {
    throw mapDockerError(err);
  }

  if (!isVersionAtLeast(versionInfo.version, MIN_DOCKER_VERSION)) {
    console.warn(
      `[docker-orch] Warning: Docker version ${versionInfo.version} is below the recommended minimum ${MIN_DOCKER_VERSION}`,
    );
  }

  return { docker, versionInfo };
}
