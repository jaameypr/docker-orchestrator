import { describe, it, expect } from "vitest";
import {
  buildContainerConfig,
  ContainerConfigSchema,
  diffConfigs,
  serializeConfig,
  deserializeConfig,
  CONFIG_DEFAULTS,
} from "../../src/builders/config-builder.js";
import { ZodError } from "zod";

describe("ContainerConfigSchema Phase 6 — finalized schema", () => {
  it("should have unless-stopped as default restart policy", () => {
    const result = ContainerConfigSchema.parse({ image: "alpine:3.18" });
    expect(result.restartPolicy).toBe("unless-stopped");
  });

  it("should have stopTimeout default of 10", () => {
    const result = ContainerConfigSchema.parse({ image: "alpine:3.18" });
    expect(result.stopTimeout).toBe(10);
  });

  it("should accept all Phase 6 fields", () => {
    const input = {
      image: "nginx",
      name: "web-server",
      tag: "1.25",
      cmd: ["nginx", "-g", "daemon off;"],
      entrypoint: ["/docker-entrypoint.sh"],
      env: { NODE_ENV: "production" },
      labels: { app: "web" },
      workingDir: "/app",
      ports: [{ container: 80, host: 8080 }],
      networks: { mynet: { aliases: ["web"] } },
      hostname: "web",
      domainName: "example.com",
      dns: ["8.8.8.8"],
      volumes: [{ host: "/data", container: "/app/data" }],
      tmpfs: { "/tmp": "rw,noexec,size=100m" },
      resources: { memory: { limit: "512m" } },
      security: { user: "1000:1000" },
      securityProfile: "standard" as const,
      restartPolicy: "always" as const,
      stopTimeout: 30,
      healthCheck: {
        type: "exec" as const,
        exec: { command: ["curl", "-f", "http://localhost/"] },
        interval: 15,
        timeout: 5,
        retries: 3,
        startPeriod: 10,
      },
    };
    const result = ContainerConfigSchema.parse(input);
    expect(result.tag).toBe("1.25");
    expect(result.entrypoint).toEqual(["/docker-entrypoint.sh"]);
    expect(result.domainName).toBe("example.com");
    expect(result.dns).toEqual(["8.8.8.8"]);
    expect(result.tmpfs).toEqual({ "/tmp": "rw,noexec,size=100m" });
    expect(result.healthCheck).toBeDefined();
    expect(result.healthCheck!.type).toBe("exec");
  });

  it("should reject invalid health check config (http without httpGet)", () => {
    expect(() =>
      ContainerConfigSchema.parse({
        image: "alpine",
        healthCheck: { type: "http" },
      }),
    ).toThrow(ZodError);
  });
});

describe("buildContainerConfig Phase 6 — final builder", () => {
  it("should apply default restartPolicy unless-stopped", () => {
    const { config } = buildContainerConfig({ image: "alpine:3.18" });
    expect(config.HostConfig?.RestartPolicy?.Name).toBe("unless-stopped");
  });

  it("should set StopTimeout in HostConfig", () => {
    const { config } = buildContainerConfig({
      image: "alpine:3.18",
      stopTimeout: 30,
    });
    expect((config.HostConfig as Record<string, unknown>).StopTimeout).toBe(
      30,
    );
  });

  it("should resolve image tag from tag field", () => {
    const { config } = buildContainerConfig({ image: "nginx", tag: "1.25" });
    expect(config.Image).toBe("nginx:1.25");
  });

  it("should override tag in image string with tag field", () => {
    const { config } = buildContainerConfig({
      image: "nginx:latest",
      tag: "1.25",
    });
    expect(config.Image).toBe("nginx:1.25");
  });

  it("should warn on implicit latest tag", () => {
    const { warnings } = buildContainerConfig({ image: "alpine" });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].message).toContain(":latest");
  });

  it("should not warn when explicit tag provided in image", () => {
    const { warnings } = buildContainerConfig({ image: "alpine:3.18" });
    const tagWarnings = warnings.filter((w) => w.message.includes(":latest"));
    expect(tagWarnings.length).toBe(0);
  });

  it("should set Entrypoint", () => {
    const { config } = buildContainerConfig({
      image: "alpine:3.18",
      entrypoint: ["/bin/sh", "-c"],
    });
    expect(config.Entrypoint).toEqual(["/bin/sh", "-c"]);
  });

  it("should set WorkingDir", () => {
    const { config } = buildContainerConfig({
      image: "alpine:3.18",
      workingDir: "/app",
    });
    expect(config.WorkingDir).toBe("/app");
  });

  it("should set Labels", () => {
    const { config } = buildContainerConfig({
      image: "alpine:3.18",
      labels: { app: "test", version: "1.0" },
    });
    expect(config.Labels).toEqual({ app: "test", version: "1.0" });
  });

  it("should set DomainName", () => {
    const { config } = buildContainerConfig({
      image: "alpine:3.18",
      domainName: "example.com",
    });
    expect(config.Domainname).toBe("example.com");
  });

  it("should set DNS servers", () => {
    const { config } = buildContainerConfig({
      image: "alpine:3.18",
      dns: ["8.8.8.8", "1.1.1.1"],
    });
    expect((config.HostConfig as Record<string, unknown>).Dns).toEqual([
      "8.8.8.8",
      "1.1.1.1",
    ]);
  });

  it("should set tmpfs mounts", () => {
    const { config } = buildContainerConfig({
      image: "alpine:3.18",
      tmpfs: { "/tmp": "rw,noexec" },
    });
    expect((config.HostConfig as Record<string, unknown>).Tmpfs).toEqual({
      "/tmp": "rw,noexec",
    });
  });

  it("should build Docker-native exec healthcheck with nanoseconds", () => {
    const { config } = buildContainerConfig({
      image: "alpine:3.18",
      healthCheck: {
        type: "exec",
        exec: { command: ["test", "-f", "/healthy"] },
        interval: 10,
        timeout: 5,
        retries: 3,
        startPeriod: 15,
      },
    });
    const hc = (config as Record<string, unknown>).Healthcheck as Record<
      string,
      unknown
    >;
    expect(hc).toBeDefined();
    expect(hc.Test).toEqual(["CMD", "test", "-f", "/healthy"]);
    expect(hc.Interval).toBe(10_000_000_000);
    expect(hc.Timeout).toBe(5_000_000_000);
    expect(hc.Retries).toBe(3);
    expect(hc.StartPeriod).toBe(15_000_000_000);
  });

  it("should not set Docker healthcheck for HTTP type (package-side)", () => {
    const { config } = buildContainerConfig({
      image: "nginx:latest",
      healthCheck: {
        type: "http",
        httpGet: { path: "/health", port: 80 },
      },
    });
    const hc = (config as Record<string, unknown>).Healthcheck;
    expect(hc).toBeUndefined();
  });

  it("should handle minimal config with all defaults", () => {
    const { config, warnings } = buildContainerConfig({ image: "alpine:3.18" });
    expect(config.Image).toBe("alpine:3.18");
    expect(config.HostConfig?.RestartPolicy?.Name).toBe("unless-stopped");
    expect(
      (config.HostConfig as Record<string, unknown>).StopTimeout,
    ).toBe(10);
    // No tag warning since explicit tag
    const tagWarns = warnings.filter((w) => w.message.includes(":latest"));
    expect(tagWarns.length).toBe(0);
  });
});

describe("diffConfigs", () => {
  it("should return empty array for identical configs", () => {
    const config = { image: "alpine:3.18", name: "test" };
    const diffs = diffConfigs(config, config);
    expect(diffs).toEqual([]);
  });

  it("should detect changed fields", () => {
    const old = { image: "alpine:3.18", env: { FOO: "bar" } };
    const newConf = { image: "alpine:3.19", env: { FOO: "bar" } };
    const diffs = diffConfigs(old, newConf);
    expect(diffs.length).toBe(1);
    expect(diffs[0].field).toBe("image");
    expect(diffs[0].oldValue).toBe("alpine:3.18");
    expect(diffs[0].newValue).toBe("alpine:3.19");
  });

  it("should detect added fields", () => {
    const old = { image: "alpine:3.18" };
    const newConf = { image: "alpine:3.18", name: "test" };
    const diffs = diffConfigs(old, newConf);
    expect(diffs.length).toBe(1);
    expect(diffs[0].field).toBe("name");
    expect(diffs[0].oldValue).toBeUndefined();
    expect(diffs[0].newValue).toBe("test");
  });

  it("should detect removed fields", () => {
    const old = { image: "alpine:3.18", name: "test" };
    const newConf = { image: "alpine:3.18" };
    const diffs = diffConfigs(old, newConf);
    expect(diffs.length).toBe(1);
    expect(diffs[0].field).toBe("name");
  });

  it("should detect nested object changes", () => {
    const old = { image: "alpine:3.18", env: { FOO: "bar" } };
    const newConf = { image: "alpine:3.18", env: { FOO: "baz" } };
    const diffs = diffConfigs(old, newConf);
    expect(diffs.length).toBe(1);
    expect(diffs[0].field).toBe("env");
  });

  it("should detect array changes", () => {
    const old = { image: "alpine:3.18", cmd: ["echo", "hello"] };
    const newConf = { image: "alpine:3.18", cmd: ["echo", "world"] };
    const diffs = diffConfigs(old, newConf);
    expect(diffs.length).toBe(1);
    expect(diffs[0].field).toBe("cmd");
  });
});

describe("serializeConfig / deserializeConfig", () => {
  it("should round-trip a config through serialization", () => {
    const config = ContainerConfigSchema.parse({
      image: "nginx:1.25",
      name: "web",
      env: { NODE_ENV: "production" },
      ports: [{ container: 80, host: 8080 }],
    });

    const json = serializeConfig(config);
    expect(typeof json).toBe("string");

    const restored = deserializeConfig(json);
    expect(restored.image).toBe("nginx:1.25");
    expect(restored.name).toBe("web");
    expect(restored.env).toEqual({ NODE_ENV: "production" });
  });

  it("should validate on deserialize", () => {
    expect(() => deserializeConfig('{"name": "no-image"}')).toThrow(ZodError);
  });

  it("should handle JSON parse errors", () => {
    expect(() => deserializeConfig("not json")).toThrow();
  });
});

describe("CONFIG_DEFAULTS", () => {
  it("should expose documented defaults", () => {
    expect(CONFIG_DEFAULTS.restartPolicy).toBe("unless-stopped");
    expect(CONFIG_DEFAULTS.stopTimeout).toBe(10);
    expect(CONFIG_DEFAULTS.securityProfile).toBe("standard");
    expect(CONFIG_DEFAULTS.tag).toBe("latest");
  });
});
