import { describe, it, expect, vi } from "vitest";
import {
  parsePortMapping,
  parsePortMappings,
  toDockerPortConfig,
  resolvePortMappings,
  checkPortAvailable,
  validatePortAvailability,
  getAssignedPorts,
} from "../../src/builders/port-mapper.js";
import type Docker from "dockerode";

describe("parsePortMapping – integer", () => {
  it("should map integer to same host:container TCP port", () => {
    const result = parsePortMapping(8080);
    expect(result).toEqual([
      { hostPort: 8080, containerPort: 8080, protocol: "tcp", hostIp: "0.0.0.0" },
    ]);
  });
});

describe("parsePortMapping – string syntax", () => {
  it('should parse "8080:80" → host 8080 : container 80 / tcp', () => {
    const result = parsePortMapping("8080:80");
    expect(result).toEqual([
      { hostPort: 8080, containerPort: 80, protocol: "tcp", hostIp: "0.0.0.0" },
    ]);
  });

  it('should parse "127.0.0.1:8080:80" → bound to specific interface', () => {
    const result = parsePortMapping("127.0.0.1:8080:80");
    expect(result).toEqual([
      { hostPort: 8080, containerPort: 80, protocol: "tcp", hostIp: "127.0.0.1" },
    ]);
  });

  it('should parse "8080:80/udp" → UDP port', () => {
    const result = parsePortMapping("8080:80/udp");
    expect(result).toEqual([
      { hostPort: 8080, containerPort: 80, protocol: "udp", hostIp: "0.0.0.0" },
    ]);
  });

  it('should parse "8080:80/tcp" → explicit TCP port', () => {
    const result = parsePortMapping("8080:80/tcp");
    expect(result).toEqual([
      { hostPort: 8080, containerPort: 80, protocol: "tcp", hostIp: "0.0.0.0" },
    ]);
  });

  it("should parse port range: 8080-8082:80-82", () => {
    const result = parsePortMapping("8080-8082:80-82");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      hostPort: 8080,
      containerPort: 80,
      protocol: "tcp",
      hostIp: "0.0.0.0",
    });
    expect(result[1]).toEqual({
      hostPort: 8081,
      containerPort: 81,
      protocol: "tcp",
      hostIp: "0.0.0.0",
    });
    expect(result[2]).toEqual({
      hostPort: 8082,
      containerPort: 82,
      protocol: "tcp",
      hostIp: "0.0.0.0",
    });
  });

  it("should throw on mismatched port ranges", () => {
    expect(() => parsePortMapping("8080-8082:80-84")).toThrow(/mismatch/);
  });

  it("should throw on invalid port numbers", () => {
    expect(() => parsePortMapping("abc:80")).toThrow();
  });
});

describe("parsePortMapping – object syntax", () => {
  it("should parse object with all fields", () => {
    const result = parsePortMapping({
      host: 3000,
      container: 80,
      protocol: "tcp",
      ip: "192.168.1.1",
    });
    expect(result).toEqual([
      {
        hostPort: 3000,
        containerPort: 80,
        protocol: "tcp",
        hostIp: "192.168.1.1",
      },
    ]);
  });

  it("should handle auto-assign (host: 0)", () => {
    const result = parsePortMapping({ host: 0, container: 80 });
    expect(result[0].hostPort).toBe(0);
    expect(result[0].containerPort).toBe(80);
  });
});

describe("parsePortMappings", () => {
  it("should parse mixed inputs into flat array", () => {
    const results = parsePortMappings([
      8080,
      "3000:3000",
      { host: 9090, container: 90 },
    ]);
    expect(results).toHaveLength(3);
    expect(results[0].hostPort).toBe(8080);
    expect(results[1].hostPort).toBe(3000);
    expect(results[2].hostPort).toBe(9090);
  });

  it("should flatten port ranges", () => {
    const results = parsePortMappings(["8080-8082:80-82"]);
    expect(results).toHaveLength(3);
  });
});

describe("toDockerPortConfig", () => {
  it("should produce correct ExposedPorts and PortBindings", () => {
    const config = toDockerPortConfig([
      { hostPort: 8080, containerPort: 80, protocol: "tcp", hostIp: "0.0.0.0" },
      { hostPort: 8443, containerPort: 443, protocol: "tcp", hostIp: "0.0.0.0" },
    ]);

    expect(config.exposedPorts).toEqual({
      "80/tcp": {},
      "443/tcp": {},
    });
    expect(config.portBindings).toEqual({
      "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }],
      "443/tcp": [{ HostIp: "0.0.0.0", HostPort: "8443" }],
    });
  });

  it("should handle UDP ports", () => {
    const config = toDockerPortConfig([
      { hostPort: 5353, containerPort: 53, protocol: "udp", hostIp: "0.0.0.0" },
    ]);

    expect(config.exposedPorts["53/udp"]).toBeDefined();
    expect(config.portBindings["53/udp"]).toEqual([
      { HostIp: "0.0.0.0", HostPort: "5353" },
    ]);
  });

  it("should handle auto-assign (hostPort 0)", () => {
    const config = toDockerPortConfig([
      { hostPort: 0, containerPort: 80, protocol: "tcp", hostIp: "0.0.0.0" },
    ]);

    expect(config.portBindings["80/tcp"]).toEqual([
      { HostIp: "0.0.0.0", HostPort: "0" },
    ]);
  });
});

describe("resolvePortMappings", () => {
  it("should parse and transform in one call", () => {
    const config = resolvePortMappings([8080, "3000:80/udp"]);

    expect(config.exposedPorts["8080/tcp"]).toBeDefined();
    expect(config.exposedPorts["80/udp"]).toBeDefined();
    expect(config.portBindings["8080/tcp"]).toEqual([
      { HostIp: "0.0.0.0", HostPort: "8080" },
    ]);
    expect(config.portBindings["80/udp"]).toEqual([
      { HostIp: "0.0.0.0", HostPort: "3000" },
    ]);
  });
});

describe("checkPortAvailable", () => {
  it("should return true for an available high port", async () => {
    // High-numbered port should be available in test env
    const available = await checkPortAvailable(59999, "127.0.0.1");
    expect(available).toBe(true);
  });
});

describe("validatePortAvailability", () => {
  it("should skip validation for auto-assign (hostPort 0)", async () => {
    // Should not throw for host port 0
    await expect(
      validatePortAvailability([
        { hostPort: 0, containerPort: 80, protocol: "tcp", hostIp: "0.0.0.0" },
      ]),
    ).resolves.toBeUndefined();
  });
});

describe("getAssignedPorts", () => {
  it("should extract port info from container inspect data", async () => {
    const mockDocker = {
      getContainer: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          NetworkSettings: {
            Ports: {
              "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "32768" }],
              "443/tcp": [{ HostIp: "0.0.0.0", HostPort: "32769" }],
              "53/udp": null,
            },
          },
        }),
      }),
    } as unknown as Docker;

    const ports = await getAssignedPorts(mockDocker, "container-123");

    expect(ports).toHaveLength(2);
    expect(ports[0]).toEqual({
      containerPort: 80,
      hostPort: 32768,
      protocol: "tcp",
      hostIp: "0.0.0.0",
    });
    expect(ports[1]).toEqual({
      containerPort: 443,
      hostPort: 32769,
      protocol: "tcp",
      hostIp: "0.0.0.0",
    });
  });
});
