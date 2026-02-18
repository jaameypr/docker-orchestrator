import { readFileSync, existsSync } from "node:fs";
import { InvalidSecurityConfigError, SeccompProfileNotFoundError } from "../errors/base.js";
import type { SecurityConfig, SecurityPresetName } from "../types/security.js";
import {
  SecurityConfigSchema,
  SecurityPresets,
  CapabilityProfiles,
  LINUX_CAPABILITIES,
} from "../types/security.js";

// ---------------------------------------------------------------------------
// Default tmpfs mounts for read-only root filesystem
// ---------------------------------------------------------------------------

const DEFAULT_TMPFS_MOUNTS: Record<string, string> = {
  "/tmp": "rw,noexec,nosuid,size=64m",
  "/var/run": "rw,noexec,nosuid,size=16m",
  "/var/tmp": "rw,noexec,nosuid,size=32m",
};

// ---------------------------------------------------------------------------
// Resolved security host config
// ---------------------------------------------------------------------------

export interface ResolvedSecurityConfig {
  User?: string;
  GroupAdd?: string[];
  CapDrop?: string[];
  CapAdd?: string[];
  ReadonlyRootfs?: boolean;
  Tmpfs?: Record<string, string>;
  SecurityOpt?: string[];
  Privileged?: boolean;
}

// ---------------------------------------------------------------------------
// Build security config for Docker API
// ---------------------------------------------------------------------------

export function buildSecurityConfig(input: SecurityConfig): ResolvedSecurityConfig {
  const config = SecurityConfigSchema.parse(input);
  const result: ResolvedSecurityConfig = {};

  // User
  if (config.user !== undefined) {
    result.User = config.user;
  }

  // Group add
  if (config.groupAdd && config.groupAdd.length > 0) {
    result.GroupAdd = config.groupAdd;
  }

  // Capabilities: profile first, then explicit overrides
  let capDrop: string[] = [];
  let capAdd: string[] = [];

  if (config.capabilityProfile) {
    const profile = CapabilityProfiles[config.capabilityProfile];
    capDrop = [...profile.drop];
    capAdd = [...profile.add];
  }

  // Explicit cap overrides replace profile values
  if (config.capDrop) {
    capDrop = config.capDrop;
  }
  if (config.capAdd) {
    capAdd = config.capAdd;
  }

  if (capDrop.length > 0) {
    result.CapDrop = capDrop;
  }
  if (capAdd.length > 0) {
    result.CapAdd = capAdd;
  }

  // Read-only root filesystem
  if (config.readonlyRootfs) {
    result.ReadonlyRootfs = true;

    // Auto tmpfs for common writable paths
    const tmpfs: Record<string, string> = {};

    if (config.autoTmpfs !== false) {
      Object.assign(tmpfs, DEFAULT_TMPFS_MOUNTS);
    }

    // User-specified tmpfs mounts override defaults
    if (config.tmpfsMounts) {
      Object.assign(tmpfs, config.tmpfsMounts);
    }

    if (Object.keys(tmpfs).length > 0) {
      result.Tmpfs = tmpfs;
    }
  }

  // Security options
  const securityOpt: string[] = [];

  // no-new-privileges
  if (config.noNewPrivileges) {
    securityOpt.push("no-new-privileges");
  }

  // Seccomp
  if (config.seccomp) {
    if (config.seccomp === "unconfined") {
      securityOpt.push("seccomp=unconfined");
    } else if (config.seccomp === "default") {
      // Docker default - no special option needed
    } else if (typeof config.seccomp === "object" && config.seccomp.profilePath) {
      const profileContent = loadSeccompProfile(config.seccomp.profilePath);
      securityOpt.push(`seccomp=${profileContent}`);
    }
  }

  // AppArmor
  if (config.apparmorProfile) {
    securityOpt.push(`apparmor=${config.apparmorProfile}`);
  }

  // SELinux
  if (config.selinuxLabel) {
    securityOpt.push(`label=${config.selinuxLabel}`);
  }

  if (securityOpt.length > 0) {
    result.SecurityOpt = securityOpt;
  }

  // Privileged
  if (config.privileged) {
    result.Privileged = true;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Apply security preset with optional overrides
// ---------------------------------------------------------------------------

export function applySecurityPreset(
  presetName: SecurityPresetName,
  overrides?: Partial<SecurityConfig>,
): ResolvedSecurityConfig {
  const preset = SecurityPresets[presetName];
  if (!preset) {
    throw new InvalidSecurityConfigError(
      "securityProfile",
      `Unknown security preset: "${presetName}"`,
    );
  }

  // Merge: explicit overrides win over preset defaults
  const merged: SecurityConfig = { ...preset.config };
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  }

  return buildSecurityConfig(merged);
}

// ---------------------------------------------------------------------------
// Load seccomp profile from JSON file
// ---------------------------------------------------------------------------

export function loadSeccompProfile(profilePath: string): string {
  if (!existsSync(profilePath)) {
    throw new SeccompProfileNotFoundError(profilePath);
  }

  try {
    const content = readFileSync(profilePath, "utf-8");
    // Validate it's valid JSON
    JSON.parse(content);
    return content;
  } catch (err) {
    if (err instanceof SeccompProfileNotFoundError) throw err;
    throw new InvalidSecurityConfigError(
      "seccomp",
      `Failed to load seccomp profile from "${profilePath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Validate capability names
// ---------------------------------------------------------------------------

export function validateCapabilities(caps: string[]): string[] {
  const unknown: string[] = [];
  const allCaps = new Set<string>([...LINUX_CAPABILITIES, "ALL"]);

  for (const cap of caps) {
    if (!allCaps.has(cap.toUpperCase())) {
      unknown.push(cap);
    }
  }

  return unknown;
}
