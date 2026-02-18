import type Docker from "dockerode";
import type Dockerode from "dockerode";
import { mapDockerError } from "../errors/mapping.js";
import {
  ContainerNotFoundError,
  ContainerAlreadyRunningError,
  ContainerAlreadyStoppedError,
} from "../errors/base.js";
import type { ContainerInfo, ContainerInspectResult } from "../types/index.js";

/**
 * Creates a container without starting it.
 * Returns the container ID.
 */
export async function createContainer(
  docker: Docker,
  config: Dockerode.ContainerCreateOptions,
): Promise<string> {
  try {
    const container = await docker.createContainer(config);
    return container.id;
  } catch (err) {
    throw mapDockerError(err);
  }
}

/**
 * Starts a container by ID.
 * Throws ContainerNotFoundError if the container doesn't exist.
 * Throws ContainerAlreadyRunningError if already running.
 */
export async function startContainer(docker: Docker, id: string): Promise<void> {
  try {
    await docker.getContainer(id).start();
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      throw new ContainerNotFoundError(id, err instanceof Error ? err : undefined);
    }
    if (error.statusCode === 304) {
      throw new ContainerAlreadyRunningError(id, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err, { containerId: id });
  }
}

/**
 * Stops a container gracefully with configurable timeout.
 * Throws ContainerNotFoundError if the container doesn't exist.
 * Throws ContainerAlreadyStoppedError if already stopped.
 */
export async function stopContainer(docker: Docker, id: string, timeout = 10): Promise<void> {
  try {
    await docker.getContainer(id).stop({ t: timeout });
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      throw new ContainerNotFoundError(id, err instanceof Error ? err : undefined);
    }
    if (error.statusCode === 304) {
      throw new ContainerAlreadyStoppedError(id, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err, { containerId: id });
  }
}

/**
 * Removes a container, optionally by force.
 */
export async function removeContainer(docker: Docker, id: string, force = false): Promise<void> {
  try {
    await docker.getContainer(id).remove({ force });
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      throw new ContainerNotFoundError(id, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err, { containerId: id });
  }
}

/**
 * Inspects a container and returns structured info.
 */
export async function inspectContainer(
  docker: Docker,
  id: string,
): Promise<ContainerInspectResult> {
  try {
    const data = await docker.getContainer(id).inspect();
    return {
      id: data.Id,
      name: data.Name.replace(/^\//, ""),
      image: data.Config.Image,
      state: {
        status: data.State.Status,
        running: data.State.Running,
        pid: data.State.Pid,
        exitCode: data.State.ExitCode,
        startedAt: data.State.StartedAt,
        finishedAt: data.State.FinishedAt,
      },
      config: {
        hostname: data.Config.Hostname,
        env: data.Config.Env ?? [],
        cmd: data.Config.Cmd ?? [],
        image: data.Config.Image,
      },
      networkSettings: {
        ipAddress: data.NetworkSettings.IPAddress,
        ports: data.NetworkSettings.Ports ?? {},
      },
    };
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      throw new ContainerNotFoundError(id, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err, { containerId: id });
  }
}

/**
 * Lists containers. When `all` is true, includes stopped containers.
 */
export async function listContainers(docker: Docker, all = false): Promise<ContainerInfo[]> {
  try {
    const containers = await docker.listContainers({ all });
    return containers.map((c) => ({
      id: c.Id,
      name: (c.Names[0] ?? "").replace(/^\//, ""),
      image: c.Image,
      state: c.State,
      status: c.Status,
      ports: (c.Ports ?? []).map((p) => ({
        privatePort: p.PrivatePort,
        publicPort: p.PublicPort,
        type: p.Type,
      })),
      created: c.Created,
    }));
  } catch (err) {
    throw mapDockerError(err);
  }
}
