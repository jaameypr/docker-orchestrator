import { describe, it, expect } from "vitest";
import {
  buildSecurityConfig,
  applySecurityPreset,
  validateCapabilities,
} from "../../src/core/security.js";

describe("buildSecurityConfig", () => {
  it("should set user", () => {
    const result = buildSecurityConfig({ user: "1000:1000" });
    expect(result.User).toBe("1000:1000");
  });

  it("should set user with name", () => {
    const result = buildSecurityConfig({ user: "node" });
    expect(result.User).toBe("node");
  });

  it("should set groupAdd", () => {
    const result = buildSecurityConfig({ groupAdd: ["audio", "video"] });
    expect(result.GroupAdd).toEqual(["audio", "video"]);
  });

  it("should apply minimal capability profile (all caps dropped)", () => {
    const result = buildSecurityConfig({ capabilityProfile: "minimal" });
    expect(result.CapDrop).toEqual(["ALL"]);
    expect(result.CapAdd).toBeUndefined();
  });

  it("should apply web capability profile", () => {
    const result = buildSecurityConfig({ capabilityProfile: "web" });
    expect(result.CapDrop).toEqual(["ALL"]);
    expect(result.CapAdd).toEqual(["NET_BIND_SERVICE"]);
  });

  it("should apply default capability profile (no changes)", () => {
    const result = buildSecurityConfig({ capabilityProfile: "default" });
    expect(result.CapDrop).toBeUndefined();
    expect(result.CapAdd).toBeUndefined();
  });

  it("should allow explicit cap overrides over profile", () => {
    const result = buildSecurityConfig({
      capabilityProfile: "minimal",
      capDrop: ["NET_RAW"],
      capAdd: ["CHOWN"],
    });
    // Explicit overrides replace profile values
    expect(result.CapDrop).toEqual(["NET_RAW"]);
    expect(result.CapAdd).toEqual(["CHOWN"]);
  });

  it("should set read-only root filesystem with auto tmpfs", () => {
    const result = buildSecurityConfig({ readonlyRootfs: true });
    expect(result.ReadonlyRootfs).toBe(true);
    expect(result.Tmpfs).toBeDefined();
    expect(result.Tmpfs!["/tmp"]).toBeDefined();
    expect(result.Tmpfs!["/var/run"]).toBeDefined();
    expect(result.Tmpfs!["/var/tmp"]).toBeDefined();
  });

  it("should allow disabling auto tmpfs", () => {
    const result = buildSecurityConfig({
      readonlyRootfs: true,
      autoTmpfs: false,
    });
    expect(result.ReadonlyRootfs).toBe(true);
    expect(result.Tmpfs).toBeUndefined();
  });

  it("should merge user tmpfs with auto tmpfs", () => {
    const result = buildSecurityConfig({
      readonlyRootfs: true,
      tmpfsMounts: { "/custom": "rw,size=128m" },
    });
    expect(result.Tmpfs!["/tmp"]).toBeDefined();
    expect(result.Tmpfs!["/custom"]).toBe("rw,size=128m");
  });

  it("should set no-new-privileges", () => {
    const result = buildSecurityConfig({ noNewPrivileges: true });
    expect(result.SecurityOpt).toContain("no-new-privileges");
  });

  it("should set seccomp unconfined", () => {
    const result = buildSecurityConfig({ seccomp: "unconfined" });
    expect(result.SecurityOpt).toContain("seccomp=unconfined");
  });

  it("should not add seccomp option for default", () => {
    const result = buildSecurityConfig({ seccomp: "default" });
    expect(result.SecurityOpt).toBeUndefined();
  });

  it("should set AppArmor profile", () => {
    const result = buildSecurityConfig({ apparmorProfile: "docker-default" });
    expect(result.SecurityOpt).toContain("apparmor=docker-default");
  });

  it("should set SELinux label", () => {
    const result = buildSecurityConfig({ selinuxLabel: "type:container_t" });
    expect(result.SecurityOpt).toContain("label=type:container_t");
  });

  it("should set privileged mode", () => {
    const result = buildSecurityConfig({ privileged: true });
    expect(result.Privileged).toBe(true);
  });

  it("should return empty config for empty input", () => {
    const result = buildSecurityConfig({});
    expect(result.User).toBeUndefined();
    expect(result.CapDrop).toBeUndefined();
    expect(result.CapAdd).toBeUndefined();
    expect(result.ReadonlyRootfs).toBeUndefined();
    expect(result.SecurityOpt).toBeUndefined();
    expect(result.Privileged).toBeUndefined();
  });

  it("should combine multiple security options", () => {
    const result = buildSecurityConfig({
      noNewPrivileges: true,
      apparmorProfile: "docker-default",
      seccomp: "unconfined",
    });
    expect(result.SecurityOpt).toContain("no-new-privileges");
    expect(result.SecurityOpt).toContain("apparmor=docker-default");
    expect(result.SecurityOpt).toContain("seccomp=unconfined");
    expect(result.SecurityOpt!.length).toBe(3);
  });
});

describe("applySecurityPreset", () => {
  it("should apply hardened preset", () => {
    const result = applySecurityPreset("hardened");
    expect(result.User).toBe("1000:1000");
    expect(result.ReadonlyRootfs).toBe(true);
    expect(result.CapDrop).toEqual(["ALL"]);
    expect(result.SecurityOpt).toContain("no-new-privileges");
    expect(result.Privileged).toBeUndefined();
  });

  it("should apply standard preset", () => {
    const result = applySecurityPreset("standard");
    expect(result.SecurityOpt).toContain("no-new-privileges");
  });

  it("should apply permissive preset", () => {
    const result = applySecurityPreset("permissive");
    // Permissive preset has empty config, so most things should be undefined
    expect(result.CapDrop).toBeUndefined();
    expect(result.ReadonlyRootfs).toBeUndefined();
  });

  it("should allow overrides on top of preset", () => {
    const result = applySecurityPreset("hardened", {
      user: "node",
      readonlyRootfs: false,
    });
    expect(result.User).toBe("node");
    expect(result.ReadonlyRootfs).toBeUndefined();
  });

  it("should merge override caps with preset", () => {
    const result = applySecurityPreset("hardened", {
      capAdd: ["NET_BIND_SERVICE"],
    });
    expect(result.CapDrop).toEqual(["ALL"]);
    expect(result.CapAdd).toEqual(["NET_BIND_SERVICE"]);
  });
});

describe("validateCapabilities", () => {
  it("should return empty array for valid capabilities", () => {
    const unknown = validateCapabilities(["CHOWN", "NET_RAW", "SETUID"]);
    expect(unknown).toEqual([]);
  });

  it("should accept ALL", () => {
    const unknown = validateCapabilities(["ALL"]);
    expect(unknown).toEqual([]);
  });

  it("should return unknown capabilities", () => {
    const unknown = validateCapabilities(["CHOWN", "FAKE_CAP", "INVALID"]);
    expect(unknown).toEqual(["FAKE_CAP", "INVALID"]);
  });

  it("should be case-insensitive", () => {
    const unknown = validateCapabilities(["chown", "net_raw"]);
    expect(unknown).toEqual([]);
  });
});
