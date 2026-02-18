import { z } from "zod";
import type Dockerode from "dockerode";
import { PortMappingInputSchema } from "../types/ports.js";
import { MountInputSchema } from "../types/mounts.js";
import { ResourceConfigSchema } from "../types/resources.js";
import {
  SecurityConfigSchema,
  SecurityPresetNameSchema,
} from "../types/security.js";
import { RestartPolicySchema } from "../types/restart.js";
import { HealthCheckConfigSchema } from "../types/health-check.js";
import type { ConfigWarning } from "../types/warnings.js";
import type { ConfigDiff } from "../types/orchestrator.js";
import { resolvePortMappings } from "./port-mapper.js";
import { resolveVolumeMounts } from "./volume-mapper.js";
import { buildResourceHostConfig } from "../core/resource-limits.js";
import { buildSecurityConfig, applySecurityPreset } from "../core/security.js";
import { buildRestartPolicy } from "../core/restart-policy.js";
import {
  validateResourceLimits,
  validateSecurityConfig,
  validateRestartPolicy,
  validateProductionConfig,
  filterWarnings,
} from "../core/validation.js";

// ---------------------------------------------------------------------------
// Port Schema (simple format)
// ---------------------------------------------------------------------------

const PortMappingSchema = z.object({
  container: z.number().int().positive(),
  host: z.number().int().positive().optional(),
  protocol: z.enum(["tcp", "udp"]).default("tcp"),
});

// ---------------------------------------------------------------------------
// Final Container Config Schema (Phase 6 - all fields from Phase 1–5)
// ---------------------------------------------------------------------------

export const ContainerConfigSchema = z.object({
  // Basis
  image: z.string().min(1),
  name: z.string().min(1).optional(),
  tag: z.string().optional(),
  cmd: z.array(z.string()).optional(),
  entrypoint: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  labels: z.record(z.string()).optional(),
  workingDir: z.string().optional(),

  // Network (Phase 4)
  ports: z.array(PortMappingSchema).optional(),
  portMappings: z.array(PortMappingInputSchema).optional(),
  networks: z
    .record(
      z.object({
        aliases: z.array(z.string()).optional(),
        ipv4Address: z.string().optional(),
      }),
    )
    .optional(),
  hostname: z.string().optional(),
  domainName: z.string().optional(),
  dns: z.array(z.string()).optional(),

  // Storage (Phase 4)
  volumes: z
    .array(
      z.object({
        host: z.string(),
        container: z.string(),
        readOnly: z.boolean().default(false),
      }),
    )
    .optional(),
  mounts: z.array(MountInputSchema).optional(),
  tmpfs: z.record(z.string()).optional(),

  // Resources (Phase 5)
  resources: ResourceConfigSchema.optional(),

  // Security (Phase 5)
  security: SecurityConfigSchema.optional(),
  securityProfile: SecurityPresetNameSchema.optional(),

  // Lifecycle
  restartPolicy: z
    .enum(["no", "always", "unless-stopped", "on-failure"])
    .default("unless-stopped"),
  advancedRestartPolicy: RestartPolicySchema.optional(),
  stopTimeout: z.number().int().positive().default(10),
  healthCheck: HealthCheckConfigSchema.optional(),

  // Meta
  /** Mark as production to enable stricter validation warnings */
  production: z.boolean().optional(),
  /** Suppress specific warning codes */
  suppressWarnings: z.array(z.string()).optional(),
});

export type ContainerConfig = z.infer<typeof ContainerConfigSchema>;

// ---------------------------------------------------------------------------
// Defaults documentation
// ---------------------------------------------------------------------------

/**
 * Default values applied when fields are not set:
 *
 * - restartPolicy: "unless-stopped" — containers restart after daemon restart
 * - stopTimeout: 10 seconds — graceful shutdown window
 * - securityProfile: "standard" when not set (applied in Orchestrator)
 * - tag: "latest" when not specified (with warning)
 * - healthCheck.interval: 10s
 * - healthCheck.timeout: 5s
 * - healthCheck.retries: 3
 * - healthCheck.startPeriod: 0s
 */
export const CONFIG_DEFAULTS = {
  restartPolicy: "unless-stopped" as const,
  stopTimeout: 10,
  securityProfile: "standard" as const,
  tag: "latest",
} as const;

// ---------------------------------------------------------------------------
// Build Result
// ---------------------------------------------------------------------------

export interface BuildContainerConfigResult {
  config: Dockerode.ContainerCreateOptions;
  warnings: ConfigWarning[];
}

// ---------------------------------------------------------------------------
// buildContainerConfig
// ---------------------------------------------------------------------------

/**
 * Transforms a user-friendly container config into
 * the dockerode ContainerCreateOptions format.
 * Returns both the config and any validation warnings.
 *
 * Supports partial config — only set fields override defaults.
 */
export function buildContainerConfig(
  input: ContainerConfig,
): BuildContainerConfigResult {
  const config = ContainerConfigSchema.parse(input);
  const warnings: ConfigWarning[] = [];

  // Resolve image tag — warn on implicit :latest
  let image = config.image;
  if (config.tag) {
    // Explicit tag overrides any tag in image string
    const baseImage = image.includes(":") ? image.split(":")[0] : image;
    image = `${baseImage}:${config.tag}`;
  } else if (!image.includes(":") && !image.includes("@")) {
    // No tag and no digest → implicit :latest
    warnings.push({
      level: "warn",
      code: "no-memory-limit", // re-use closest code; we emit a clear message
      message: `Image "${image}" has no explicit tag; will default to :latest. Pin a specific tag for reproducibility.`,
    });
  }

  // Build env array
  const env = config.env
    ? Object.entries(config.env).map(([k, v]) => `${k}=${v}`)
    : undefined;

  // Build port bindings and exposed ports (legacy format)
  let exposedPorts: Record<string, object> = {};
  let portBindings: Record<string, Array<{ HostPort: string }>> = {};

  if (config.ports) {
    for (const port of config.ports) {
      const key = `${port.container}/${port.protocol}`;
      exposedPorts[key] = {};
      portBindings[key] = [{ HostPort: port.host ? String(port.host) : "" }];
    }
  }

  // Phase 4: Port-Mapper integration (new portMappings field)
  if (config.portMappings) {
    const resolved = resolvePortMappings(config.portMappings);
    exposedPorts = { ...exposedPorts, ...resolved.exposedPorts };
    portBindings = { ...portBindings, ...resolved.portBindings };
  }

  // Build volume binds (legacy format)
  const binds: string[] = [];
  if (config.volumes) {
    for (const vol of config.volumes) {
      const bind = vol.readOnly
        ? `${vol.host}:${vol.container}:ro`
        : `${vol.host}:${vol.container}`;
      binds.push(bind);
    }
  }

  // Phase 4: Volume-Mapper integration (new mounts field)
  let dockerMounts: Dockerode.MountConfig | undefined;
  if (config.mounts) {
    const resolved = resolveVolumeMounts(config.mounts);
    binds.push(...resolved.binds);
    if (resolved.mounts.length > 0) {
      dockerMounts = resolved.mounts as unknown as Dockerode.MountConfig;
    }
  }

  // Phase 4: Network configuration
  let networkingConfig: Record<string, unknown> | undefined;
  if (config.networks) {
    const endpoints: Record<string, unknown> = {};
    for (const [netName, netOpts] of Object.entries(config.networks)) {
      const endpointConfig: Record<string, unknown> = {};
      if (netOpts.ipv4Address) {
        endpointConfig.IPAMConfig = { IPv4Address: netOpts.ipv4Address };
      }
      if (netOpts.aliases) {
        endpointConfig.Aliases = netOpts.aliases;
      }
      endpoints[netName] = endpointConfig;
    }
    networkingConfig = { EndpointsConfig: endpoints };
  }

  // Phase 5: Resource limits
  let resourceHostConfig: Record<string, unknown> = {};
  if (config.resources) {
    warnings.push(...validateResourceLimits(config.resources));
    resourceHostConfig = buildResourceHostConfig(config.resources) as Record<
      string,
      unknown
    >;
  }

  // Phase 5: Security
  let securityHostConfig: Record<string, unknown> = {};
  let userField: string | undefined;
  if (config.securityProfile) {
    const resolved = applySecurityPreset(
      config.securityProfile,
      config.security,
    );
    if (resolved.User) userField = resolved.User;
    securityHostConfig = { ...resolved };
    if ("User" in securityHostConfig) delete securityHostConfig.User;

    if (config.security) {
      warnings.push(...validateSecurityConfig(config.security));
    }
  } else if (config.security) {
    warnings.push(...validateSecurityConfig(config.security));
    const resolved = buildSecurityConfig(config.security);
    if (resolved.User) userField = resolved.User;
    securityHostConfig = { ...resolved };
    if ("User" in securityHostConfig) delete securityHostConfig.User;
  }

  // Restart policy
  let restartPolicyObj: { Name: string; MaximumRetryCount?: number } = {
    Name: config.restartPolicy,
  };
  if (config.advancedRestartPolicy) {
    warnings.push(...validateRestartPolicy(config.advancedRestartPolicy));
    const resolved = buildRestartPolicy(config.advancedRestartPolicy);
    restartPolicyObj = resolved;
  }

  // Production mode warnings
  if (config.production) {
    warnings.push(
      ...validateProductionConfig(config.resources, config.security),
    );
  }

  // Phase 6: Health check → Docker native (exec type only)
  let healthcheckConfig: Record<string, unknown> | undefined;
  if (config.healthCheck && config.healthCheck.type === "exec" && config.healthCheck.exec) {
    healthcheckConfig = {
      Test: ["CMD", ...config.healthCheck.exec.command],
      Interval: config.healthCheck.interval * 1_000_000_000,
      Timeout: config.healthCheck.timeout * 1_000_000_000,
      Retries: config.healthCheck.retries,
      StartPeriod: config.healthCheck.startPeriod * 1_000_000_000,
    };
  }

  // Phase 6: tmpfs mounts
  let tmpfsConfig: Record<string, string> | undefined;
  if (config.tmpfs && Object.keys(config.tmpfs).length > 0) {
    tmpfsConfig = config.tmpfs;
  }

  // Build the final HostConfig by merging all sources
  const hostConfig: Record<string, unknown> = {
    PortBindings:
      Object.keys(portBindings).length > 0 ? portBindings : undefined,
    Binds: binds.length > 0 ? binds : undefined,
    Mounts: dockerMounts,
    RestartPolicy: restartPolicyObj,
    StopTimeout: config.stopTimeout,
    Dns: config.dns && config.dns.length > 0 ? config.dns : undefined,
    Tmpfs: tmpfsConfig,
    ...resourceHostConfig,
    ...securityHostConfig,
  };

  const result: Dockerode.ContainerCreateOptions = {
    Image: image,
    Env: env,
    Cmd: config.cmd,
    Entrypoint: config.entrypoint,
    ExposedPorts:
      Object.keys(exposedPorts).length > 0 ? exposedPorts : undefined,
    Hostname: config.hostname ?? config.name,
    Domainname: config.domainName,
    WorkingDir: config.workingDir,
    Labels: config.labels,
    HostConfig: hostConfig as Dockerode.ContainerCreateOptions["HostConfig"],
    NetworkingConfig:
      networkingConfig as Dockerode.ContainerCreateOptions["NetworkingConfig"],
  };

  if (config.name) {
    result.name = config.name;
  }

  if (userField) {
    result.User = userField;
  }

  if (healthcheckConfig) {
    (result as Record<string, unknown>).Healthcheck = healthcheckConfig;
  }

  // Filter suppressed warnings
  const filteredWarnings = filterWarnings(warnings, config.suppressWarnings);

  return { config: result, warnings: filteredWarnings };
}

// ---------------------------------------------------------------------------
// Config Diffing
// ---------------------------------------------------------------------------

/**
 * Compares two ContainerConfig objects and returns a list of differences.
 * Useful for logging/audit purposes.
 */
export function diffConfigs(
  oldConfig: Partial<ContainerConfig>,
  newConfig: Partial<ContainerConfig>,
): ConfigDiff[] {
  const diffs: ConfigDiff[] = [];
  const allKeys = new Set([
    ...Object.keys(oldConfig),
    ...Object.keys(newConfig),
  ]);

  for (const key of allKeys) {
    const oldVal = (oldConfig as Record<string, unknown>)[key];
    const newVal = (newConfig as Record<string, unknown>)[key];

    if (!deepEqual(oldVal, newVal)) {
      diffs.push({ field: key, oldValue: oldVal, newValue: newVal });
    }
  }

  return diffs;
}

// ---------------------------------------------------------------------------
// Config Serialization
// ---------------------------------------------------------------------------

/**
 * Exports a ContainerConfig as a JSON string for reproducibility.
 */
export function serializeConfig(config: ContainerConfig): string {
  return JSON.stringify(config, null, 2);
}

/**
 * Imports a ContainerConfig from a JSON string with validation.
 */
export function deserializeConfig(json: string): ContainerConfig {
  const parsed = JSON.parse(json);
  return ContainerConfigSchema.parse(parsed);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const key of keys) {
      if (!deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }

  return false;
}
