import { describe, it, expect } from "vitest";
import {
  definePreset,
  serializePreset,
  deserializePreset,
  mergePresetConfig,
  PresetRegistry,
} from "../../src/core/presets.js";
import {
  PresetNotFoundError,
  PresetAlreadyExistsError,
  PresetValidationError,
} from "../../src/errors/base.js";

// ---------------------------------------------------------------------------
// definePreset
// ---------------------------------------------------------------------------

describe("definePreset", () => {
  it("should return a typed preset for valid input", () => {
    const preset = definePreset({
      name: "test-preset",
      config: { image: "alpine:latest" },
    });
    expect(preset.name).toBe("test-preset");
    expect(preset.config).toEqual({ image: "alpine:latest" });
  });

  it("should throw PresetValidationError for invalid input", () => {
    expect(() => definePreset({})).toThrow(PresetValidationError);
    expect(() => definePreset({ name: "" })).toThrow(PresetValidationError);
    expect(() => definePreset({ name: "a" })).toThrow(PresetValidationError);
  });

  it("should accept optional gracefulStop config", () => {
    const preset = definePreset({
      name: "with-stop",
      config: { image: "node:18" },
      gracefulStop: {
        command: "shutdown",
        waitForExit: true,
        timeout: 15000,
      },
    });
    expect(preset.gracefulStop).toBeDefined();
    expect(preset.gracefulStop!.command).toBe("shutdown");
    expect(preset.gracefulStop!.timeout).toBe(15000);
  });

  it("should accept optional readyCheck config", () => {
    const preset = definePreset({
      name: "with-ready",
      config: { image: "node:18" },
      readyCheck: {
        logMatch: "READY",
        timeout: 30000,
      },
    });
    expect(preset.readyCheck).toBeDefined();
    expect(preset.readyCheck!.logMatch).toBe("READY");
  });

  it("should accept optional metadata", () => {
    const preset = definePreset({
      name: "with-meta",
      config: { image: "alpine" },
      metadata: { version: "1.0", author: "test" },
    });
    expect(preset.metadata).toEqual({ version: "1.0", author: "test" });
  });
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

describe("Preset Serialization", () => {
  it("should serialize and deserialize a preset", () => {
    const original = definePreset({
      name: "serialize-test",
      config: { image: "nginx:latest", env: { PORT: "8080" } },
      metadata: { description: "test" },
    });

    const json = serializePreset(original);
    const restored = deserializePreset(json);

    expect(restored.name).toBe(original.name);
    expect(restored.config).toEqual(original.config);
    expect(restored.metadata).toEqual(original.metadata);
  });

  it("should serialize and deserialize RegExp in logMatch", () => {
    const original = definePreset({
      name: "regex-test",
      config: { image: "alpine" },
      readyCheck: {
        logMatch: /Server started/i,
        timeout: 10000,
      },
    });

    const json = serializePreset(original);
    const restored = deserializePreset(json);

    expect(restored.readyCheck!.logMatch).toBeInstanceOf(RegExp);
    const regex = restored.readyCheck!.logMatch as RegExp;
    expect(regex.source).toBe("Server started");
    expect(regex.flags).toBe("i");
    expect(regex.test("Server started on port 8080")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mergePresetConfig
// ---------------------------------------------------------------------------

describe("mergePresetConfig", () => {
  it("should merge env vars key-based (user wins on same key)", () => {
    const result = mergePresetConfig(
      { image: "alpine", env: { A: "1", B: "2" } },
      { env: { B: "3", C: "4" } },
    );
    expect(result.env).toEqual({ A: "1", B: "3", C: "4" });
  });

  it("should completely overwrite ports from preset when user provides ports", () => {
    const result = mergePresetConfig(
      { image: "alpine", ports: [{ container: 80, host: 8080, protocol: "tcp" as const }] },
      { ports: [{ container: 443, host: 8443, protocol: "tcp" as const }] },
    );
    expect(result.ports).toEqual([{ container: 443, host: 8443, protocol: "tcp" }]);
  });

  it("should additively merge volumes", () => {
    const result = mergePresetConfig(
      { image: "alpine", volumes: [{ host: "/data", container: "/app/data" }] },
      { volumes: [{ host: "/logs", container: "/app/logs" }] },
    );
    expect(result.volumes).toHaveLength(2);
    expect(result.volumes).toEqual([
      { host: "/data", container: "/app/data" },
      { host: "/logs", container: "/app/logs" },
    ]);
  });

  it("should let user override image", () => {
    const result = mergePresetConfig(
      { image: "alpine:3.18" },
      { image: "alpine:3.19" },
    );
    expect(result.image).toBe("alpine:3.19");
  });

  it("should merge labels key-based", () => {
    const result = mergePresetConfig(
      { image: "alpine", labels: { app: "test", version: "1" } },
      { labels: { version: "2", env: "prod" } },
    );
    expect(result.labels).toEqual({ app: "test", version: "2", env: "prod" });
  });

  it("should preserve preset config when user provides no overrides", () => {
    const result = mergePresetConfig(
      { image: "alpine", env: { A: "1" }, cmd: ["sh"] },
      {},
    );
    expect(result.image).toBe("alpine");
    expect(result.env).toEqual({ A: "1" });
    expect(result.cmd).toEqual(["sh"]);
  });

  it("should additively merge mounts", () => {
    const result = mergePresetConfig(
      { image: "alpine", mounts: ["/data:/data" as unknown as import("../../src/types/mounts.js").MountInput] },
      { mounts: ["/logs:/logs" as unknown as import("../../src/types/mounts.js").MountInput] },
    );
    expect(result.mounts).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// PresetRegistry
// ---------------------------------------------------------------------------

describe("PresetRegistry", () => {
  it("should register and retrieve a preset", () => {
    const registry = new PresetRegistry();
    const preset = definePreset({
      name: "test",
      config: { image: "alpine" },
    });
    registry.register(preset);

    const retrieved = registry.get("test");
    expect(retrieved.name).toBe("test");
  });

  it("should throw PresetAlreadyExistsError on duplicate without overwrite", () => {
    const registry = new PresetRegistry();
    const preset = definePreset({
      name: "dup",
      config: { image: "alpine" },
    });
    registry.register(preset);
    expect(() => registry.register(preset)).toThrow(PresetAlreadyExistsError);
  });

  it("should overwrite when overwrite: true", () => {
    const registry = new PresetRegistry();
    registry.register(definePreset({
      name: "overwrite-test",
      config: { image: "alpine:3.18" },
    }));
    registry.register(
      definePreset({
        name: "overwrite-test",
        config: { image: "alpine:3.19" },
      }),
      { overwrite: true },
    );

    const retrieved = registry.get("overwrite-test");
    expect(retrieved.config).toEqual({ image: "alpine:3.19" });
  });

  it("should throw PresetNotFoundError for unknown preset", () => {
    const registry = new PresetRegistry();
    expect(() => registry.get("nonexistent")).toThrow(PresetNotFoundError);
  });

  it("should check existence with has()", () => {
    const registry = new PresetRegistry();
    registry.register(definePreset({
      name: "exists",
      config: { image: "alpine" },
    }));

    expect(registry.has("exists")).toBe(true);
    expect(registry.has("nope")).toBe(false);
  });

  it("should list all preset names", () => {
    const registry = new PresetRegistry();
    registry.register(definePreset({ name: "a", config: { image: "a" } }));
    registry.register(definePreset({ name: "b", config: { image: "b" } }));
    registry.register(definePreset({ name: "c", config: { image: "c" } }));

    const names = registry.list();
    expect(names).toHaveLength(3);
    expect(names).toContain("a");
    expect(names).toContain("b");
    expect(names).toContain("c");
  });

  it("should remove a preset", () => {
    const registry = new PresetRegistry();
    registry.register(definePreset({ name: "removable", config: { image: "a" } }));
    expect(registry.has("removable")).toBe(true);

    const removed = registry.remove("removable");
    expect(removed).toBe(true);
    expect(registry.has("removable")).toBe(false);
  });

  it("should return false when removing nonexistent preset", () => {
    const registry = new PresetRegistry();
    expect(registry.remove("ghost")).toBe(false);
  });

  it("should clear all presets", () => {
    const registry = new PresetRegistry();
    registry.register(definePreset({ name: "a", config: { image: "a" } }));
    registry.register(definePreset({ name: "b", config: { image: "b" } }));

    registry.clear();
    expect(registry.list()).toHaveLength(0);
  });

  it("should register many presets at once", () => {
    const registry = new PresetRegistry();
    registry.registerMany([
      definePreset({ name: "x", config: { image: "x" } }),
      definePreset({ name: "y", config: { image: "y" } }),
    ]);

    expect(registry.list()).toHaveLength(2);
    expect(registry.has("x")).toBe(true);
    expect(registry.has("y")).toBe(true);
  });
});
