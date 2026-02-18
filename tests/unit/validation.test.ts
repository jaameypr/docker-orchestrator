import { describe, it, expect } from "vitest";
import {
  validateResourceLimits,
  validateSecurityConfig,
  validateRestartPolicy,
  validateProductionConfig,
  filterWarnings,
} from "../../src/core/validation.js";
import type { ConfigWarning } from "../../src/types/warnings.js";

describe("validateResourceLimits", () => {
  it("should warn when reservation exceeds limit", () => {
    const warnings = validateResourceLimits({
      memory: { limit: "256m", reservation: "512m" },
    });
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: "memory-reservation-exceeds-limit" }),
    );
  });

  it("should warn when memory limit below 6MB", () => {
    const warnings = validateResourceLimits({
      memory: { limit: 1048576 }, // 1MB
    });
    expect(warnings).toContainEqual(expect.objectContaining({ code: "memory-below-minimum" }));
  });

  it("should warn when oom kill disabled", () => {
    const warnings = validateResourceLimits({
      memory: { oomKillDisable: true },
    });
    expect(warnings).toContainEqual(expect.objectContaining({ code: "oom-kill-disabled" }));
  });

  it("should warn when nanoCpus combined with shares/period/quota", () => {
    const warnings = validateResourceLimits({
      cpu: { nanoCpus: 1.5, shares: 512 },
    });
    expect(warnings).toContainEqual(expect.objectContaining({ code: "nano-cpus-with-shares" }));
  });

  it("should not warn for valid config", () => {
    const warnings = validateResourceLimits({
      memory: { limit: "512m", reservation: "256m" },
      cpu: { nanoCpus: 1.5 },
      pids: { limit: 200 },
    });
    expect(warnings).toEqual([]);
  });

  it("should not warn for empty config", () => {
    const warnings = validateResourceLimits({});
    expect(warnings).toEqual([]);
  });
});

describe("validateSecurityConfig", () => {
  it("should warn for root user", () => {
    const warnings = validateSecurityConfig({ user: "root" });
    expect(warnings).toContainEqual(expect.objectContaining({ code: "root-user" }));
  });

  it("should warn for user 0", () => {
    const warnings = validateSecurityConfig({ user: "0" });
    expect(warnings).toContainEqual(expect.objectContaining({ code: "root-user" }));
  });

  it("should warn for user 0:0", () => {
    const warnings = validateSecurityConfig({ user: "0:0" });
    expect(warnings).toContainEqual(expect.objectContaining({ code: "root-user" }));
  });

  it("should warn when no user set", () => {
    const warnings = validateSecurityConfig({});
    expect(warnings).toContainEqual(expect.objectContaining({ code: "no-user-set" }));
  });

  it("should not warn about no-user-set when privileged", () => {
    const warnings = validateSecurityConfig({ privileged: true });
    const noUserWarning = warnings.find((w) => w.code === "no-user-set");
    expect(noUserWarning).toBeUndefined();
  });

  it("should critically warn for privileged mode", () => {
    const warnings = validateSecurityConfig({ privileged: true });
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: "privileged-mode", level: "critical" }),
    );
  });

  it("should warn for dangerous capabilities", () => {
    const warnings = validateSecurityConfig({
      user: "node",
      capAdd: ["SYS_ADMIN"],
    });
    expect(warnings).toContainEqual(expect.objectContaining({ code: "dangerous-capability" }));
  });

  it("should warn for multiple dangerous capabilities", () => {
    const warnings = validateSecurityConfig({
      user: "node",
      capAdd: ["SYS_ADMIN", "NET_ADMIN"],
    });
    const dangerousWarnings = warnings.filter((w) => w.code === "dangerous-capability");
    expect(dangerousWarnings.length).toBe(2);
  });

  it("should warn for seccomp unconfined", () => {
    const warnings = validateSecurityConfig({
      user: "node",
      seccomp: "unconfined",
    });
    expect(warnings).toContainEqual(expect.objectContaining({ code: "seccomp-unconfined" }));
  });

  it("should warn for readonly without tmpfs", () => {
    const warnings = validateSecurityConfig({
      user: "node",
      readonlyRootfs: true,
      autoTmpfs: false,
    });
    expect(warnings).toContainEqual(expect.objectContaining({ code: "readonly-without-tmpfs" }));
  });

  it("should not warn when user is set and config is secure", () => {
    const warnings = validateSecurityConfig({
      user: "1000:1000",
      noNewPrivileges: true,
      seccomp: "default",
    });
    expect(warnings).toEqual([]);
  });
});

describe("validateRestartPolicy", () => {
  it("should warn when maxRetries used with non on-failure type", () => {
    const warnings = validateRestartPolicy({ type: "always", maxRetries: 3 });
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: "max-retries-without-on-failure" }),
    );
  });

  it("should not warn for valid on-failure with maxRetries", () => {
    const warnings = validateRestartPolicy({ type: "on-failure", maxRetries: 3 });
    expect(warnings).toEqual([]);
  });

  it("should not warn for string shorthand", () => {
    const warnings = validateRestartPolicy("always");
    expect(warnings).toEqual([]);
  });
});

describe("validateProductionConfig", () => {
  it("should warn when no memory limit in production", () => {
    const warnings = validateProductionConfig({}, undefined);
    expect(warnings).toContainEqual(expect.objectContaining({ code: "no-memory-limit" }));
  });

  it("should warn when no CPU limit in production", () => {
    const warnings = validateProductionConfig({}, undefined);
    expect(warnings).toContainEqual(expect.objectContaining({ code: "no-cpu-limit" }));
  });

  it("should warn when no PID limit in production", () => {
    const warnings = validateProductionConfig({}, undefined);
    expect(warnings).toContainEqual(expect.objectContaining({ code: "no-pid-limit" }));
  });

  it("should not warn when limits are set", () => {
    const warnings = validateProductionConfig(
      {
        memory: { limit: "512m" },
        cpu: { nanoCpus: 1 },
        pids: { limit: 200 },
      },
      undefined,
    );
    expect(warnings).toEqual([]);
  });
});

describe("filterWarnings", () => {
  const warnings: ConfigWarning[] = [
    { level: "warn", code: "root-user", message: "Running as root" },
    { level: "critical", code: "privileged-mode", message: "Privileged" },
    { level: "warn", code: "no-memory-limit", message: "No memory limit" },
  ];

  it("should return all warnings when no suppressions", () => {
    expect(filterWarnings(warnings)).toEqual(warnings);
    expect(filterWarnings(warnings, [])).toEqual(warnings);
  });

  it("should filter suppressed warnings", () => {
    const result = filterWarnings(warnings, ["root-user"]);
    expect(result.length).toBe(2);
    expect(result.find((w) => w.code === "root-user")).toBeUndefined();
  });

  it("should filter multiple suppressed warnings", () => {
    const result = filterWarnings(warnings, ["root-user", "privileged-mode"]);
    expect(result.length).toBe(1);
    expect(result[0].code).toBe("no-memory-limit");
  });

  it("should handle unknown suppression codes gracefully", () => {
    const result = filterWarnings(warnings, ["unknown-code"]);
    expect(result).toEqual(warnings);
  });
});
