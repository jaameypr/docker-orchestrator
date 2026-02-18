/**
 * Integration test helpers.
 * Provides Docker availability checks, cleanup utilities, and test container management.
 */
import { existsSync } from "node:fs";
import Docker from "dockerode";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Test image used for basic container tests. */
export const TEST_IMAGE = "alpine:latest";

/** Prefix for all test container names. */
export const TEST_PREFIX = "docker-orch-test-";

/** Label applied to all test resources for cleanup. */
export const TEST_LABEL = { "docker-orch-test": "true" };

// ---------------------------------------------------------------------------
// Docker Availability
// ---------------------------------------------------------------------------

/**
 * Checks if a Docker daemon is available and responding.
 * Returns false if the socket doesn't exist or ping fails.
 */
export async function isDockerAvailable(): Promise<boolean> {
  if (!existsSync("/var/run/docker.sock")) {
    return false;
  }

  try {
    const docker = new Docker({ socketPath: "/var/run/docker.sock" });
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a Docker client for integration testing.
 */
export function createTestDocker(): Docker {
  return new Docker({ socketPath: "/var/run/docker.sock" });
}

// ---------------------------------------------------------------------------
// Cleanup Utilities
// ---------------------------------------------------------------------------

/**
 * Removes all containers matching the test label or name prefix.
 * Force-kills running containers with a 5s timeout.
 */
export async function cleanupContainers(
  docker: Docker,
  options: { prefix?: string; label?: string; timeoutSeconds?: number } = {},
): Promise<number> {
  const { prefix = TEST_PREFIX, label, timeoutSeconds = 5 } = options;
  let removed = 0;

  try {
    const containers = await docker.listContainers({
      all: true,
      filters: label ? JSON.stringify({ label: [label] }) : undefined,
    });

    for (const info of containers) {
      const name = info.Names?.[0]?.replace(/^\//, "") ?? "";
      const hasLabel = label
        ? Object.keys(info.Labels ?? {}).some((k) => k === label.split("=")[0])
        : false;
      const hasPrefix = name.startsWith(prefix);

      if (!hasLabel && !hasPrefix) continue;

      const container = docker.getContainer(info.Id);

      try {
        if (info.State === "running") {
          await container.stop({ t: timeoutSeconds }).catch(() => {});
        }
        await container.remove({ force: true });
        removed++;
      } catch {
        // Container may already be gone
      }
    }
  } catch {
    // Docker API error during cleanup – non-fatal
  }

  return removed;
}

/**
 * Removes all networks matching the test name prefix.
 */
export async function cleanupNetworks(
  docker: Docker,
  prefix = TEST_PREFIX,
): Promise<number> {
  let removed = 0;

  try {
    const networks = await docker.listNetworks();
    for (const net of networks) {
      if (net.Name?.startsWith(prefix)) {
        try {
          await docker.getNetwork(net.Id).remove();
          removed++;
        } catch {
          // Network may be in use or already gone
        }
      }
    }
  } catch {
    // Docker API error during cleanup – non-fatal
  }

  return removed;
}

/**
 * Removes all volumes matching the test name prefix.
 */
export async function cleanupVolumes(
  docker: Docker,
  prefix = TEST_PREFIX,
): Promise<number> {
  let removed = 0;

  try {
    const result = await docker.listVolumes();
    const volumes = result.Volumes ?? [];
    for (const vol of volumes) {
      if (vol.Name?.startsWith(prefix)) {
        try {
          await docker.getVolume(vol.Name).remove({ force: true });
          removed++;
        } catch {
          // Volume may be in use or already gone
        }
      }
    }
  } catch {
    // Docker API error during cleanup – non-fatal
  }

  return removed;
}

/**
 * Cleans up all test resources (containers, networks, volumes).
 */
export async function cleanupAll(docker: Docker): Promise<{
  containers: number;
  networks: number;
  volumes: number;
}> {
  const [containers, networks, volumes] = await Promise.all([
    cleanupContainers(docker),
    cleanupNetworks(docker),
    cleanupVolumes(docker),
  ]);

  return { containers, networks, volumes };
}

// ---------------------------------------------------------------------------
// Test Container Helpers
// ---------------------------------------------------------------------------

/**
 * Creates and starts a test container, runs the callback, then cleans up.
 * Ensures cleanup happens even if the test fails.
 */
export async function withTestContainer(
  docker: Docker,
  options: {
    image?: string;
    cmd?: string[];
    env?: string[];
    name?: string;
    labels?: Record<string, string>;
  },
  callback: (containerId: string) => Promise<void>,
): Promise<void> {
  const {
    image = TEST_IMAGE,
    cmd = ["sleep", "30"],
    env = [],
    name = `${TEST_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    labels = TEST_LABEL,
  } = options;

  const container = await docker.createContainer({
    Image: image,
    Cmd: cmd,
    Env: env,
    name,
    Labels: labels,
  });

  try {
    await container.start();
    await callback(container.id);
  } finally {
    try {
      await container.stop({ t: 2 }).catch(() => {});
      await container.remove({ force: true });
    } catch {
      // Cleanup failure – non-fatal
    }
  }
}

// ---------------------------------------------------------------------------
// Timeout Utility
// ---------------------------------------------------------------------------

/**
 * Wraps a promise with a timeout.
 * Rejects with a clear error message if the operation takes too long.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operation = "Operation",
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${operation} timed out after ${ms}ms`)),
      ms,
    );

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
