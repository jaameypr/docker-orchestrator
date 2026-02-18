import type Docker from "dockerode";
import { EventEmitter } from "eventemitter3";
import {
  HealthCheckConfigSchema,
  type HealthCheckConfig,
  type HealthCheckResult,
  type HealthStatus,
  type HealthCheckEvents,
} from "../types/health-check.js";
import { HealthCheckTimeoutError } from "../errors/base.js";
import { mapDockerError } from "../errors/mapping.js";
import { ContainerNotFoundError } from "../errors/base.js";
import http from "http";
import net from "net";

// ---------------------------------------------------------------------------
// Health Check Event Emitter
// ---------------------------------------------------------------------------

export const healthEmitter = new EventEmitter<HealthCheckEvents>();

// ---------------------------------------------------------------------------
// Build Docker-native Healthcheck config
// ---------------------------------------------------------------------------

/**
 * Transforms a HealthCheckConfig (type: exec) into a Docker Healthcheck object
 * suitable for ContainerCreateOptions. Converts seconds to nanoseconds.
 */
export function buildDockerHealthcheck(
  config: HealthCheckConfig,
): Record<string, unknown> | undefined {
  const parsed = HealthCheckConfigSchema.parse(config);

  if (parsed.type === "none") {
    return { Test: ["NONE"] };
  }

  if (parsed.type === "exec" && parsed.exec) {
    return {
      Test: ["CMD", ...parsed.exec.command],
      Interval: secondsToNanos(parsed.interval),
      Timeout: secondsToNanos(parsed.timeout),
      Retries: parsed.retries,
      StartPeriod: secondsToNanos(parsed.startPeriod),
    };
  }

  // HTTP and TCP are package-side checks, not Docker-native
  return undefined;
}

// ---------------------------------------------------------------------------
// Port Mapping Resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a container port to the corresponding host port
 * by inspecting the container's port mappings.
 */
export async function resolveHostPort(
  docker: Docker,
  containerId: string,
  containerPort: number,
): Promise<number> {
  let data: unknown;
  try {
    data = await docker.getContainer(containerId).inspect();
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      throw new ContainerNotFoundError(
        containerId,
        err instanceof Error ? err : undefined,
      );
    }
    throw mapDockerError(err, { containerId });
  }

  const dataObj = data as Record<string, unknown>;
  const networkSettings = dataObj.NetworkSettings as Record<string, unknown>;
  const ports = (networkSettings?.Ports ?? {}) as Record<
    string,
    Array<{ HostIp: string; HostPort: string }> | null
  >;

  // Try both tcp and udp
  for (const proto of ["tcp", "udp"]) {
    const key = `${containerPort}/${proto}`;
    const bindings = ports[key];
    if (bindings && bindings.length > 0) {
      const hostPort = parseInt(bindings[0].HostPort, 10);
      if (!isNaN(hostPort) && hostPort > 0) {
        return hostPort;
      }
    }
  }

  throw new Error(
    `No host port mapping found for container port ${containerPort} on container ${containerId}`,
  );
}

// ---------------------------------------------------------------------------
// Package-side Health Checks (HTTP / TCP)
// ---------------------------------------------------------------------------

/**
 * Performs an HTTP health check against a container port.
 */
export function checkHttp(
  hostPort: number,
  path: string,
  expectedStatus?: number | number[],
  timeoutMs = 5000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: "127.0.0.1", port: hostPort, path, timeout: timeoutMs },
      (res) => {
        const statusOk = isStatusOk(res.statusCode ?? 0, expectedStatus);
        res.resume(); // drain
        resolve(statusOk);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Performs a TCP socket health check against a container port.
 */
export function checkTcp(hostPort: number, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: hostPort });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.on("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------------
// waitForHealthy
// ---------------------------------------------------------------------------

export interface WaitForHealthyOptions {
  /** Maximum wait time in milliseconds (default: 60000) */
  timeout?: number;
  /** Override polling interval in ms (default: uses config interval) */
  pollInterval?: number;
}

/**
 * Waits for a container to become healthy according to its health check config.
 *
 * - Docker-native (exec): polls container.inspect().State.Health.Status
 * - HTTP: sends GET requests to the mapped host port
 * - TCP: attempts socket connections to the mapped host port
 * - none: resolves immediately as 'healthy'
 *
 * Emits events: health.checking, health.healthy, health.unhealthy, health.timeout
 */
export async function waitForHealthy(
  docker: Docker,
  containerId: string,
  config: HealthCheckConfig,
  options?: WaitForHealthyOptions,
): Promise<HealthCheckResult> {
  const parsed = HealthCheckConfigSchema.parse(config);

  if (parsed.type === "none") {
    const result: HealthCheckResult = {
      status: "healthy",
      checks: 0,
      elapsed: 0,
    };
    healthEmitter.emit("health.healthy", {
      containerId,
      checks: 0,
      elapsed: 0,
    });
    return result;
  }

  const timeoutMs = options?.timeout ?? 60000;
  const pollMs = options?.pollInterval ?? parsed.interval * 1000;
  const startPeriodMs = parsed.startPeriod * 1000;
  const deadline = Date.now() + timeoutMs;
  let checks = 0;
  let lastError: string | undefined;
  const startTime = Date.now();

  // Wait for start period
  if (startPeriodMs > 0) {
    await sleep(Math.min(startPeriodMs, timeoutMs));
  }

  while (Date.now() < deadline) {
    checks++;
    healthEmitter.emit("health.checking", { containerId, check: checks });

    let healthy = false;
    try {
      healthy = await performCheck(docker, containerId, parsed);
    } catch (err) {
      lastError =
        err instanceof Error ? err.message : String(err);
    }

    if (healthy) {
      const elapsed = Date.now() - startTime;
      const result: HealthCheckResult = {
        status: "healthy",
        checks,
        elapsed,
      };
      healthEmitter.emit("health.healthy", {
        containerId,
        checks,
        elapsed,
      });
      return result;
    }

    if (!lastError) {
      lastError = "Check returned unhealthy";
    }

    // Check if we still have time for another poll
    if (Date.now() + pollMs >= deadline) {
      break;
    }

    await sleep(pollMs);
  }

  const elapsed = Date.now() - startTime;

  // Emit unhealthy then timeout
  healthEmitter.emit("health.unhealthy", {
    containerId,
    checks,
    error: lastError ?? "Unknown",
  });
  healthEmitter.emit("health.timeout", { containerId, elapsed });

  return {
    status: "timeout",
    checks,
    elapsed,
    lastError,
  };
}

// ---------------------------------------------------------------------------
// Internal: perform a single health check
// ---------------------------------------------------------------------------

async function performCheck(
  docker: Docker,
  containerId: string,
  config: HealthCheckConfig,
): Promise<boolean> {
  switch (config.type) {
    case "exec":
      return performDockerNativeCheck(docker, containerId);
    case "http":
      return performHttpCheck(docker, containerId, config);
    case "tcp":
      return performTcpCheck(docker, containerId, config);
    default:
      return true;
  }
}

async function performDockerNativeCheck(
  docker: Docker,
  containerId: string,
): Promise<boolean> {
  const data = (await docker.getContainer(containerId).inspect()) as unknown as Record<string, unknown>;
  const health = data.State as Record<string, unknown>;
  const healthObj = health?.Health as { Status?: string } | undefined;

  if (!healthObj) {
    // No health check configured on container → consider healthy
    return true;
  }

  return healthObj.Status === "healthy";
}

async function performHttpCheck(
  docker: Docker,
  containerId: string,
  config: HealthCheckConfig,
): Promise<boolean> {
  if (!config.httpGet) return false;

  const hostPort = await resolveHostPort(
    docker,
    containerId,
    config.httpGet.port,
  );
  return checkHttp(
    hostPort,
    config.httpGet.path,
    config.httpGet.expectedStatus,
    config.timeout * 1000,
  );
}

async function performTcpCheck(
  docker: Docker,
  containerId: string,
  config: HealthCheckConfig,
): Promise<boolean> {
  if (!config.tcpSocket) return false;

  const hostPort = await resolveHostPort(
    docker,
    containerId,
    config.tcpSocket.port,
  );
  return checkTcp(hostPort, config.timeout * 1000);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function secondsToNanos(seconds: number): number {
  return seconds * 1_000_000_000;
}

function isStatusOk(
  status: number,
  expected?: number | number[],
): boolean {
  if (expected === undefined) {
    // Default: 200-399
    return status >= 200 && status < 400;
  }
  if (Array.isArray(expected)) {
    return expected.includes(status);
  }
  return status === expected;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
