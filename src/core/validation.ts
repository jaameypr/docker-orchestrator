import type { ResourceConfig } from "../types/resources.js";
import type { SecurityConfig } from "../types/security.js";
import type { RestartPolicy } from "../types/restart.js";
import type { ConfigWarning } from "../types/warnings.js";
import { DANGEROUS_CAPABILITIES } from "../types/security.js";
import { parseMemoryString } from "./resource-limits.js";

// ---------------------------------------------------------------------------
// Docker minimum memory limit: 6MB
// ---------------------------------------------------------------------------

const DOCKER_MIN_MEMORY = 6 * 1024 * 1024; // 6MB

// ---------------------------------------------------------------------------
// Resolve a memory value to bytes for validation
// ---------------------------------------------------------------------------

function resolveMemoryValue(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  return parseMemoryString(value);
}

// ---------------------------------------------------------------------------
// Validate resource limits
// ---------------------------------------------------------------------------

export function validateResourceLimits(config: ResourceConfig): ConfigWarning[] {
  const warnings: ConfigWarning[] = [];

  if (config.memory) {
    const mem = config.memory;
    const limitBytes = resolveMemoryValue(mem.limit);
    const reservationBytes = resolveMemoryValue(mem.reservation);

    // Memory limit below Docker minimum
    if (limitBytes !== undefined && limitBytes < DOCKER_MIN_MEMORY) {
      warnings.push({
        level: "critical",
        code: "memory-below-minimum",
        message: `Memory limit ${limitBytes} bytes is below Docker minimum of ${DOCKER_MIN_MEMORY} bytes (6MB)`,
      });
    }

    // Reservation exceeds limit
    if (
      reservationBytes !== undefined &&
      limitBytes !== undefined &&
      reservationBytes > limitBytes
    ) {
      warnings.push({
        level: "critical",
        code: "memory-reservation-exceeds-limit",
        message: `Memory reservation (${reservationBytes} bytes) exceeds hard limit (${limitBytes} bytes)`,
      });
    }

    // Swap below memory
    if (mem.swap !== undefined && limitBytes !== undefined) {
      const swapVal =
        typeof mem.swap === "string" ? parseMemoryString(mem.swap) : mem.swap;
      if (swapVal !== -1 && swapVal < 0) {
        warnings.push({
          level: "critical",
          code: "swap-below-memory",
          message: `Swap value must be -1 (unlimited) or a positive number`,
        });
      }
    }

    // OOM kill disabled
    if (mem.oomKillDisable === true) {
      warnings.push({
        level: "warn",
        code: "oom-kill-disabled",
        message:
          "OOM killer is disabled. The container may hang if it exhausts memory instead of being killed.",
      });
    }
  }

  if (config.cpu) {
    const cpu = config.cpu;

    // NanoCPUs and shares/period/quota are mutually exclusive
    const hasNanoCpus = cpu.nanoCpus !== undefined;
    const hasCfsControls =
      cpu.shares !== undefined ||
      cpu.period !== undefined ||
      cpu.quota !== undefined;

    if (hasNanoCpus && hasCfsControls) {
      warnings.push({
        level: "critical",
        code: "nano-cpus-with-shares",
        message:
          "NanoCPUs cannot be combined with CpuShares/CpuPeriod/CpuQuota. Use one method or the other.",
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Validate security config
// ---------------------------------------------------------------------------

export function validateSecurityConfig(config: SecurityConfig): ConfigWarning[] {
  const warnings: ConfigWarning[] = [];

  // Root user warning
  if (config.user === "root" || config.user === "0" || config.user === "0:0") {
    warnings.push({
      level: "warn",
      code: "root-user",
      message:
        "Container is configured to run as root. Consider using a non-root user for better security.",
    });
  }

  // No user set
  if (!config.user && !config.privileged) {
    warnings.push({
      level: "warn",
      code: "no-user-set",
      message:
        "No user specified. Container will run as root by default. Consider setting a non-root user.",
    });
  }

  // Privileged mode
  if (config.privileged) {
    warnings.push({
      level: "critical",
      code: "privileged-mode",
      message:
        "Privileged mode grants full host access. This is a significant security risk. Only use when absolutely necessary.",
    });
  }

  // Dangerous capabilities
  const allCaps = [...(config.capAdd ?? [])];
  for (const cap of allCaps) {
    if (DANGEROUS_CAPABILITIES.includes(cap as (typeof DANGEROUS_CAPABILITIES)[number])) {
      warnings.push({
        level: "warn",
        code: "dangerous-capability",
        message: `Adding dangerous capability: ${cap}. Ensure this is required for your use case.`,
      });
    }
  }

  // Seccomp unconfined
  if (config.seccomp === "unconfined") {
    warnings.push({
      level: "warn",
      code: "seccomp-unconfined",
      message:
        "Seccomp is set to unconfined, disabling syscall filtering. This reduces container isolation.",
    });
  }

  // Read-only FS without tmpfs
  if (config.readonlyRootfs && !config.autoTmpfs && !config.tmpfsMounts) {
    warnings.push({
      level: "warn",
      code: "readonly-without-tmpfs",
      message:
        "Read-only root filesystem enabled without tmpfs mounts. Applications may fail to write to /tmp or /var/run. Consider enabling autoTmpfs.",
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Validate restart policy
// ---------------------------------------------------------------------------

export function validateRestartPolicy(config: RestartPolicy): ConfigWarning[] {
  const warnings: ConfigWarning[] = [];

  if (typeof config === "object") {
    if (config.maxRetries !== undefined && config.type !== "on-failure") {
      warnings.push({
        level: "critical",
        code: "max-retries-without-on-failure",
        message: `maxRetries is only valid with "on-failure" policy, got "${config.type}"`,
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Production mode warnings
// ---------------------------------------------------------------------------

export function validateProductionConfig(
  resources?: ResourceConfig,
  _security?: SecurityConfig,
): ConfigWarning[] {
  const warnings: ConfigWarning[] = [];

  // No memory limit
  if (!resources?.memory?.limit) {
    warnings.push({
      level: "warn",
      code: "no-memory-limit",
      message:
        "No memory limit set in production mode. Containers can consume unlimited memory.",
    });
  }

  // No CPU limit
  if (!resources?.cpu?.nanoCpus && !resources?.cpu?.quota) {
    warnings.push({
      level: "warn",
      code: "no-cpu-limit",
      message:
        "No CPU limit set in production mode. Containers can consume unlimited CPU.",
    });
  }

  // No PID limit
  if (!resources?.pids?.limit) {
    warnings.push({
      level: "warn",
      code: "no-pid-limit",
      message:
        "No PID limit set in production mode. Container is vulnerable to fork bombs.",
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Filter warnings by suppressed codes
// ---------------------------------------------------------------------------

export function filterWarnings(
  warnings: ConfigWarning[],
  suppressWarnings?: string[],
): ConfigWarning[] {
  if (!suppressWarnings || suppressWarnings.length === 0) return warnings;
  const suppressed = new Set(suppressWarnings);
  return warnings.filter((w) => !suppressed.has(w.code));
}
