import { describe, it, expect, vi } from "vitest";
import {
  parseMount,
  parseMounts,
  validateMounts,
  toDockerBinds,
  toDockerMounts,
  resolveVolumeMounts,
} from "../../src/builders/volume-mapper.js";
import { InvalidMountError } from "../../src/errors/base.js";

// Mock fs.existsSync for validation tests
vi.mock("node:fs", () => ({
  existsSync: vi.fn((path: string) => {
    if (path === "/existing/path") return true;
    if (path === "/nonexistent/path") return false;
    return false;
  }),
}));

describe("parseMount – string syntax", () => {
  it("should parse bind mount: /host/path:/container/path", () => {
    const result = parseMount("/host/data:/container/data");
    expect(result).toEqual({
      type: "bind",
      source: "/host/data",
      target: "/container/data",
      readOnly: false,
    });
  });

  it("should parse read-only bind mount: /host/path:/container/path:ro", () => {
    const result = parseMount("/host/data:/container/data:ro");
    expect(result).toEqual({
      type: "bind",
      source: "/host/data",
      target: "/container/data",
      readOnly: true,
    });
  });

  it("should parse named volume: volumeName:/container/path", () => {
    const result = parseMount("myvolume:/container/data");
    expect(result).toEqual({
      type: "volume",
      source: "myvolume",
      target: "/container/data",
      readOnly: false,
    });
  });

  it("should parse read-only named volume: volumeName:/container/path:ro", () => {
    const result = parseMount("myvolume:/container/data:ro");
    expect(result).toEqual({
      type: "volume",
      source: "myvolume",
      target: "/container/data",
      readOnly: true,
    });
  });

  it("should reject invalid option (not 'ro')", () => {
    expect(() => parseMount("/host:/container:rw")).toThrow(InvalidMountError);
  });

  it("should reject too few parts", () => {
    expect(() => parseMount("only-one-part")).toThrow(InvalidMountError);
  });

  it("should reject too many parts", () => {
    expect(() => parseMount("a:b:c:d")).toThrow(InvalidMountError);
  });

  it("should reject non-absolute container path", () => {
    expect(() => parseMount("/host:relative/path")).toThrow(InvalidMountError);
  });

  it("should reject invalid volume name", () => {
    expect(() => parseMount("!invalid:/container/path")).toThrow(InvalidMountError);
  });

  it("should accept volume names with dots and dashes", () => {
    const result = parseMount("my-vol.name_v2:/data");
    expect(result.type).toBe("volume");
    expect(result.source).toBe("my-vol.name_v2");
  });
});

describe("parseMount – object syntax", () => {
  it("should parse bind mount object", () => {
    const result = parseMount({
      type: "bind",
      source: "/host/data",
      target: "/container/data",
      readOnly: false,
    });
    expect(result).toEqual({
      type: "bind",
      source: "/host/data",
      target: "/container/data",
      readOnly: false,
    });
  });

  it("should parse volume mount object", () => {
    const result = parseMount({
      type: "volume",
      source: "myvol",
      target: "/data",
      readOnly: true,
    });
    expect(result).toEqual({
      type: "volume",
      source: "myvol",
      target: "/data",
      readOnly: true,
    });
  });

  it("should parse tmpfs mount object", () => {
    const result = parseMount({
      type: "tmpfs",
      source: "",
      target: "/tmp",
      readOnly: false,
      tmpfsSize: 67108864, // 64MB
    });
    expect(result).toEqual({
      type: "tmpfs",
      source: "",
      target: "/tmp",
      readOnly: false,
      tmpfsSize: 67108864,
    });
  });

  it("should reject non-absolute target in object syntax", () => {
    expect(() =>
      parseMount({ type: "bind", source: "/host", target: "relative", readOnly: false }),
    ).toThrow(InvalidMountError);
  });

  it("should reject invalid volume name in object syntax", () => {
    expect(() =>
      parseMount({ type: "volume", source: "!bad", target: "/data", readOnly: false }),
    ).toThrow(InvalidMountError);
  });
});

describe("parseMounts", () => {
  it("should parse multiple inputs", () => {
    const results = parseMounts([
      "/host:/container",
      "myvolume:/data",
      { type: "tmpfs", source: "", target: "/tmp", readOnly: false },
    ]);
    expect(results).toHaveLength(3);
    expect(results[0].type).toBe("bind");
    expect(results[1].type).toBe("volume");
    expect(results[2].type).toBe("tmpfs");
  });
});

describe("validateMounts", () => {
  it("should warn about non-existent host paths", () => {
    const warnings = validateMounts([
      { type: "bind", source: "/nonexistent/path", target: "/data", readOnly: false },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("does not exist");
  });

  it("should not warn about existing host paths", () => {
    const warnings = validateMounts([
      { type: "bind", source: "/existing/path", target: "/data", readOnly: false },
    ]);
    expect(warnings).toHaveLength(0);
  });

  it("should not warn about named volumes", () => {
    const warnings = validateMounts([
      { type: "volume", source: "myvol", target: "/data", readOnly: false },
    ]);
    expect(warnings).toHaveLength(0);
  });
});

describe("toDockerBinds", () => {
  it("should convert bind mounts to Docker Binds format", () => {
    const binds = toDockerBinds([
      { type: "bind", source: "/host", target: "/container", readOnly: false },
      { type: "bind", source: "/host2", target: "/container2", readOnly: true },
      { type: "volume", source: "vol", target: "/data", readOnly: false },
    ]);
    expect(binds).toEqual(["/host:/container", "/host2:/container2:ro", "vol:/data"]);
  });

  it("should skip tmpfs mounts", () => {
    const binds = toDockerBinds([{ type: "tmpfs", source: "", target: "/tmp", readOnly: false }]);
    expect(binds).toEqual([]);
  });
});

describe("toDockerMounts", () => {
  it("should convert all mount types to Docker Mounts format", () => {
    const mounts = toDockerMounts([
      { type: "bind", source: "/host", target: "/container", readOnly: false },
      { type: "tmpfs", source: "", target: "/tmp", readOnly: false, tmpfsSize: 1000000 },
    ]);

    expect(mounts).toEqual([
      { Type: "bind", Source: "/host", Target: "/container", ReadOnly: false },
      {
        Type: "tmpfs",
        Source: "",
        Target: "/tmp",
        ReadOnly: false,
        TmpfsOptions: { SizeBytes: 1000000 },
      },
    ]);
  });
});

describe("resolveVolumeMounts", () => {
  it("should separate bind/volume into binds and tmpfs into mounts", () => {
    const result = resolveVolumeMounts([
      "/host:/container",
      "myvol:/data",
      { type: "tmpfs", source: "", target: "/tmp", readOnly: false, tmpfsSize: 1000000 },
    ]);

    expect(result.binds).toEqual(["/host:/container", "myvol:/data"]);
    expect(result.mounts).toHaveLength(1);
    expect(result.mounts[0].Type).toBe("tmpfs");
  });
});
