import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildDockerHealthcheck,
  waitForHealthy,
  healthEmitter,
} from "../../src/core/health-check.js";
import { HealthCheckConfigSchema } from "../../src/types/health-check.js";
import type { HealthCheckConfig } from "../../src/types/health-check.js";

describe("HealthCheckConfigSchema", () => {
  it("should parse exec health check", () => {
    const result = HealthCheckConfigSchema.parse({
      type: "exec",
      exec: { command: ["curl", "-f", "http://localhost/"] },
    });
    expect(result.type).toBe("exec");
    expect(result.interval).toBe(10);
    expect(result.timeout).toBe(5);
    expect(result.retries).toBe(3);
    expect(result.startPeriod).toBe(0);
  });

  it("should parse http health check", () => {
    const result = HealthCheckConfigSchema.parse({
      type: "http",
      httpGet: { path: "/health", port: 8080 },
    });
    expect(result.type).toBe("http");
    expect(result.httpGet!.path).toBe("/health");
    expect(result.httpGet!.port).toBe(8080);
  });

  it("should parse tcp health check", () => {
    const result = HealthCheckConfigSchema.parse({
      type: "tcp",
      tcpSocket: { port: 5432 },
    });
    expect(result.type).toBe("tcp");
    expect(result.tcpSocket!.port).toBe(5432);
  });

  it("should parse none health check", () => {
    const result = HealthCheckConfigSchema.parse({ type: "none" });
    expect(result.type).toBe("none");
  });

  it("should reject http without httpGet", () => {
    expect(() =>
      HealthCheckConfigSchema.parse({ type: "http" }),
    ).toThrow();
  });

  it("should reject tcp without tcpSocket", () => {
    expect(() =>
      HealthCheckConfigSchema.parse({ type: "tcp" }),
    ).toThrow();
  });

  it("should reject exec without exec config", () => {
    expect(() =>
      HealthCheckConfigSchema.parse({ type: "exec" }),
    ).toThrow();
  });

  it("should apply default values", () => {
    const result = HealthCheckConfigSchema.parse({
      type: "exec",
      exec: { command: ["true"] },
    });
    expect(result.interval).toBe(10);
    expect(result.timeout).toBe(5);
    expect(result.retries).toBe(3);
    expect(result.startPeriod).toBe(0);
  });

  it("should allow custom timing", () => {
    const result = HealthCheckConfigSchema.parse({
      type: "exec",
      exec: { command: ["true"] },
      interval: 30,
      timeout: 10,
      retries: 5,
      startPeriod: 60,
    });
    expect(result.interval).toBe(30);
    expect(result.timeout).toBe(10);
    expect(result.retries).toBe(5);
    expect(result.startPeriod).toBe(60);
  });
});

describe("buildDockerHealthcheck", () => {
  it("should build exec healthcheck with nanosecond conversion", () => {
    const hc = buildDockerHealthcheck({
      type: "exec",
      exec: { command: ["test", "-f", "/healthy"] },
      interval: 10,
      timeout: 5,
      retries: 3,
      startPeriod: 15,
    } as HealthCheckConfig);

    expect(hc).toBeDefined();
    expect(hc!.Test).toEqual(["CMD", "test", "-f", "/healthy"]);
    expect(hc!.Interval).toBe(10_000_000_000);
    expect(hc!.Timeout).toBe(5_000_000_000);
    expect(hc!.Retries).toBe(3);
    expect(hc!.StartPeriod).toBe(15_000_000_000);
  });

  it("should return NONE test for type none", () => {
    const hc = buildDockerHealthcheck({
      type: "none",
      interval: 10,
      timeout: 5,
      retries: 3,
      startPeriod: 0,
    } as HealthCheckConfig);
    expect(hc).toEqual({ Test: ["NONE"] });
  });

  it("should return undefined for http type (package-side check)", () => {
    const hc = buildDockerHealthcheck({
      type: "http",
      httpGet: { path: "/health", port: 80 },
      interval: 10,
      timeout: 5,
      retries: 3,
      startPeriod: 0,
    } as HealthCheckConfig);
    expect(hc).toBeUndefined();
  });

  it("should return undefined for tcp type (package-side check)", () => {
    const hc = buildDockerHealthcheck({
      type: "tcp",
      tcpSocket: { port: 5432 },
      interval: 10,
      timeout: 5,
      retries: 3,
      startPeriod: 0,
    } as HealthCheckConfig);
    expect(hc).toBeUndefined();
  });
});

describe("waitForHealthy", () => {
  function createMockDocker(
    healthStatuses: Array<string | null>,
  ): Record<string, unknown> {
    let callCount = 0;
    return {
      getContainer: () => ({
        inspect: async () => {
          const status =
            callCount < healthStatuses.length
              ? healthStatuses[callCount]
              : healthStatuses[healthStatuses.length - 1];
          callCount++;
          return {
            State: {
              Health: status !== null ? { Status: status } : undefined,
            },
            NetworkSettings: {
              Ports: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }] },
            },
          };
        },
      }),
    };
  }

  it("should return healthy immediately for type none", async () => {
    const docker = createMockDocker([]);
    const result = await waitForHealthy(
      docker as never,
      "container-123",
      {
        type: "none",
        interval: 1,
        timeout: 1,
        retries: 1,
        startPeriod: 0,
      } as HealthCheckConfig,
    );
    expect(result.status).toBe("healthy");
    expect(result.checks).toBe(0);
  });

  it("should poll Docker-native health check until healthy", async () => {
    const docker = createMockDocker([
      "starting",
      "starting",
      "starting",
      "healthy",
    ]);

    const result = await waitForHealthy(
      docker as never,
      "container-123",
      {
        type: "exec",
        exec: { command: ["true"] },
        interval: 0.05,
        timeout: 1,
        retries: 3,
        startPeriod: 0,
      } as HealthCheckConfig,
      { timeout: 5000, pollInterval: 50 },
    );

    expect(result.status).toBe("healthy");
    expect(result.checks).toBeGreaterThanOrEqual(2);
  });

  it("should timeout when container never becomes healthy", async () => {
    const docker = createMockDocker(["starting"]);

    const result = await waitForHealthy(
      docker as never,
      "container-123",
      {
        type: "exec",
        exec: { command: ["true"] },
        interval: 0.05,
        timeout: 1,
        retries: 3,
        startPeriod: 0,
      } as HealthCheckConfig,
      { timeout: 200, pollInterval: 50 },
    );

    expect(result.status).toBe("timeout");
  });

  it("should emit health events", async () => {
    const docker = createMockDocker(["starting", "healthy"]);
    const events: string[] = [];

    const onChecking = () => events.push("checking");
    const onHealthy = () => events.push("healthy");

    healthEmitter.on("health.checking", onChecking);
    healthEmitter.on("health.healthy", onHealthy);

    await waitForHealthy(
      docker as never,
      "container-123",
      {
        type: "exec",
        exec: { command: ["true"] },
        interval: 0.05,
        timeout: 1,
        retries: 3,
        startPeriod: 0,
      } as HealthCheckConfig,
      { timeout: 5000, pollInterval: 50 },
    );

    healthEmitter.off("health.checking", onChecking);
    healthEmitter.off("health.healthy", onHealthy);

    expect(events).toContain("checking");
    expect(events).toContain("healthy");
  });
});
