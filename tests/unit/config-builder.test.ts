import { describe, it, expect } from "vitest";
import { buildContainerConfig, ContainerConfigSchema } from "../../src/builders/config-builder.js";
import { ZodError } from "zod";

describe("ContainerConfigSchema validation", () => {
  it("should accept minimal valid config", () => {
    const result = ContainerConfigSchema.parse({ image: "alpine:latest" });
    expect(result.image).toBe("alpine:latest");
    expect(result.restartPolicy).toBe("no");
  });

  it("should reject empty image", () => {
    expect(() => ContainerConfigSchema.parse({ image: "" })).toThrow(ZodError);
  });

  it("should reject missing image", () => {
    expect(() => ContainerConfigSchema.parse({})).toThrow(ZodError);
  });

  it("should accept full config", () => {
    const input = {
      image: "nginx:latest",
      name: "my-nginx",
      env: { NODE_ENV: "production" },
      ports: [{ container: 80, host: 8080 }],
      cmd: ["nginx", "-g", "daemon off;"],
      volumes: [{ host: "/data", container: "/app/data", readOnly: true }],
      restartPolicy: "always" as const,
      hostname: "webserver",
    };
    const result = ContainerConfigSchema.parse(input);
    expect(result).toBeDefined();
    expect(result.restartPolicy).toBe("always");
  });

  it("should default port protocol to tcp", () => {
    const result = ContainerConfigSchema.parse({
      image: "alpine",
      ports: [{ container: 80 }],
    });
    expect(result.ports![0].protocol).toBe("tcp");
  });

  it("should reject invalid port numbers", () => {
    expect(() =>
      ContainerConfigSchema.parse({
        image: "alpine",
        ports: [{ container: -1 }],
      }),
    ).toThrow(ZodError);
  });
});

describe("buildContainerConfig", () => {
  it("should transform minimal config", () => {
    const { config: result } = buildContainerConfig({ image: "alpine:latest" });
    expect(result.Image).toBe("alpine:latest");
    expect(result.HostConfig?.RestartPolicy?.Name).toBe("no");
  });

  it("should transform env variables to key=value format", () => {
    const { config: result } = buildContainerConfig({
      image: "alpine",
      env: { FOO: "bar", BAZ: "qux" },
    });
    expect(result.Env).toEqual(["FOO=bar", "BAZ=qux"]);
  });

  it("should configure port bindings", () => {
    const { config: result } = buildContainerConfig({
      image: "nginx",
      ports: [
        { container: 80, host: 8080, protocol: "tcp" },
        { container: 443, host: 8443, protocol: "tcp" },
      ],
    });

    expect(result.ExposedPorts).toEqual({
      "80/tcp": {},
      "443/tcp": {},
    });
    expect(result.HostConfig?.PortBindings).toEqual({
      "80/tcp": [{ HostPort: "8080" }],
      "443/tcp": [{ HostPort: "8443" }],
    });
  });

  it("should handle port without host (random assignment)", () => {
    const { config: result } = buildContainerConfig({
      image: "nginx",
      ports: [{ container: 80 }],
    });

    expect(result.HostConfig?.PortBindings?.["80/tcp"]).toEqual([
      { HostPort: "" },
    ]);
  });

  it("should configure volume binds", () => {
    const { config: result } = buildContainerConfig({
      image: "alpine",
      volumes: [
        { host: "/host/data", container: "/data" },
        { host: "/host/config", container: "/config", readOnly: true },
      ],
    });

    expect(result.HostConfig?.Binds).toEqual([
      "/host/data:/data",
      "/host/config:/config:ro",
    ]);
  });

  it("should set hostname from name when hostname not provided", () => {
    const { config: result } = buildContainerConfig({
      image: "alpine",
      name: "my-container",
    });
    expect(result.Hostname).toBe("my-container");
    expect(result.name).toBe("my-container");
  });

  it("should prefer explicit hostname over name", () => {
    const { config: result } = buildContainerConfig({
      image: "alpine",
      name: "my-container",
      hostname: "custom-host",
    });
    expect(result.Hostname).toBe("custom-host");
  });

  it("should set restart policy", () => {
    const { config: result } = buildContainerConfig({
      image: "alpine",
      restartPolicy: "unless-stopped",
    });
    expect(result.HostConfig?.RestartPolicy?.Name).toBe("unless-stopped");
  });

  it("should pass cmd array", () => {
    const { config: result } = buildContainerConfig({
      image: "alpine",
      cmd: ["echo", "hello"],
    });
    expect(result.Cmd).toEqual(["echo", "hello"]);
  });

  it("should omit undefined optional fields", () => {
    const { config: result } = buildContainerConfig({ image: "alpine" });
    expect(result.Env).toBeUndefined();
    expect(result.ExposedPorts).toBeUndefined();
    expect(result.HostConfig?.PortBindings).toBeUndefined();
    expect(result.HostConfig?.Binds).toBeUndefined();
  });

  it("should return warnings array", () => {
    const { warnings } = buildContainerConfig({ image: "alpine" });
    expect(Array.isArray(warnings)).toBe(true);
  });
});
