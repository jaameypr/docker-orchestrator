import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dockerode and fs before importing the module under test
vi.mock("dockerode", () => {
  const MockDocker = vi.fn();
  MockDocker.prototype.ping = vi.fn();
  MockDocker.prototype.version = vi.fn();
  return { default: MockDocker };
});

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

import Docker from "dockerode";
import { existsSync } from "node:fs";
import { createClient } from "../../src/core/client.js";
import { ConnectionError } from "../../src/errors/base.js";

const mockExistsSync = vi.mocked(existsSync);

const fakeVersionInfo = {
  Version: "24.0.7",
  ApiVersion: "1.43",
  Os: "linux",
  Arch: "amd64",
  KernelVersion: "5.15.0",
};

describe("createClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should auto-detect socket path on Linux", async () => {
    mockExistsSync.mockReturnValue(true);

    getMockDockerAfterConstruction(fakeVersionInfo);

    const result = await createClient();
    expect(result.docker).toBeDefined();
    expect(result.versionInfo.version).toBe("24.0.7");
    expect(result.versionInfo.apiVersion).toBe("1.43");
  });

  it("should throw ConnectionError when socket not found", async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(createClient()).rejects.toThrow(ConnectionError);
  });

  it("should use provided socketPath", async () => {
    getMockDockerAfterConstruction(fakeVersionInfo);

    const result = await createClient({ socketPath: "/custom/docker.sock" });
    expect(result.versionInfo.version).toBe("24.0.7");
  });

  it("should use host/port for TCP connection", async () => {
    getMockDockerAfterConstruction(fakeVersionInfo);

    const result = await createClient({ host: "localhost", port: 2375 });
    expect(result.versionInfo.version).toBe("24.0.7");
  });

  it("should throw ConnectionError on ping failure (ECONNREFUSED)", async () => {
    mockExistsSync.mockReturnValue(true);

    // We need the constructor to run first, then override ping on the instance
    const pingError = new Error("connect ECONNREFUSED 127.0.0.1:2375");

    // Use a fresh mock that fails
    const MockDockerClass = vi.mocked(Docker);
    MockDockerClass.mockImplementationOnce(function (this: { ping: () => void; version: () => void }) {
      this.ping = vi.fn().mockRejectedValue(pingError);
      this.version = vi.fn();
      return this;
    } as unknown as () => Docker);

    await expect(createClient()).rejects.toThrow(ConnectionError);
  });

  it("should warn on outdated Docker version", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockExistsSync.mockReturnValue(true);

    const oldVersion = { ...fakeVersionInfo, Version: "19.03.0" };
    const MockDockerClass = vi.mocked(Docker);
    MockDockerClass.mockImplementationOnce(function (this: { ping: () => void; version: () => void }) {
      this.ping = vi.fn().mockResolvedValue("OK");
      this.version = vi.fn().mockResolvedValue(oldVersion);
      return this;
    } as unknown as () => Docker);

    const result = await createClient();
    expect(result.versionInfo.version).toBe("19.03.0");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("below the recommended minimum"),
    );

    warnSpy.mockRestore();
  });

  it("should accept TLS options with host", async () => {
    getMockDockerAfterConstruction(fakeVersionInfo);

    const result = await createClient({
      host: "remote-host",
      port: 2376,
      ca: "ca-cert",
      cert: "client-cert",
      key: "client-key",
    });

    expect(result.versionInfo.version).toBe("24.0.7");
  });
});

/**
 * Helper: sets up the mock so the next Docker constructor call
 * returns an instance with working ping and version.
 */
function getMockDockerAfterConstruction(versionInfo: typeof fakeVersionInfo) {
  const MockDockerClass = vi.mocked(Docker);
  MockDockerClass.mockImplementationOnce(function (this: { ping: () => void; version: () => void }) {
    this.ping = vi.fn().mockResolvedValue("OK");
    this.version = vi.fn().mockResolvedValue(versionInfo);
    return this;
  } as unknown as () => Docker);
}
