import { z } from "zod";
import type Dockerode from "dockerode";
import { PortMappingInputSchema } from "../types/ports.js";
import { MountInputSchema } from "../types/mounts.js";
import { ResourceConfigSchema, type ResourceConfig } from "../types/resources.js";
import { SecurityConfigSchema, type SecurityConfig, SecurityPresetNameSchema, type SecurityPresetName } from "../types/security.js";
import { RestartPolicySchema, type RestartPolicy } from "../types/restart.js";
import type { ConfigWarning } from "../types/warnings.js";
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

const PortMappingSchema = z.object({
  container: z.number().int().positive(),
  host: z.number().int().positive().optional(),
  protocol: z.enum(["tcp", "udp"]).default("tcp"),
});

export const ContainerConfigSchema = z.object({
  image: z.string().min(1),
  name: z.string().min(1).optional(),
  env: z.record(z.string()).optional(),
  ports: z.array(PortMappingSchema).optional(),
  cmd: z.array(z.string()).optional(),
  volumes: z
    .array(
      z.object({
        host: z.string(),
        container: z.string(),
        readOnly: z.boolean().default(false),
      }),
    )
    .optional(),
  restartPolicy: z.enum(["no", "always", "unless-stopped", "on-failure"]).default("no"),
  hostname: z.string().optional(),
  // Phase 4: New fields
  networks: z
    .record(
      z.object({
        aliases: z.array(z.string()).optional(),
        ipv4Address: z.string().optional(),
      }),
    )
    .optional(),
  portMappings: z.array(PortMappingInputSchema).optional(),
  mounts: z.array(MountInputSchema).optional(),
  // Phase 5: Resource limits, security, restart policy
  resources: ResourceConfigSchema.optional(),
  security: SecurityConfigSchema.optional(),
  securityProfile: SecurityPresetNameSchema.optional(),
  advancedRestartPolicy: RestartPolicySchema.optional(),
  /** Mark as production to enable stricter validation warnings */
  production: z.boolean().optional(),
  /** Suppress specific warning codes */
  suppressWarnings: z.array(z.string()).optional(),
});

export type ContainerConfig = z.infer<typeof ContainerConfigSchema>;

export interface BuildContainerConfigResult {
  config: Dockerode.ContainerCreateOptions;
  warnings: ConfigWarning[];
}

/**
 * Transforms a user-friendly container config into
 * the dockerode ContainerCreateOptions format.
 * Returns both the config and any validation warnings.
 */
export function buildContainerConfig(
  input: ContainerConfig,
): BuildContainerConfigResult {
  const config = ContainerConfigSchema.parse(input);
  const warnings: ConfigWarning[] = [];

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
    resourceHostConfig = buildResourceHostConfig(config.resources) as Record<string, unknown>;
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

    // Validate the merged security config
    const mergedSecurity = {
      ...config.security,
      ...(config.securityProfile === "hardened"
        ? { user: resolved.User ?? config.security?.user }
        : {}),
    };
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

  // Phase 5: Restart policy (advanced object form)
  let restartPolicyObj: { Name: string; MaximumRetryCount?: number } = {
    Name: config.restartPolicy,
  };
  if (config.advancedRestartPolicy) {
    warnings.push(...validateRestartPolicy(config.advancedRestartPolicy));
    const resolved = buildRestartPolicy(config.advancedRestartPolicy);
    restartPolicyObj = resolved;
  }

  // Phase 5: Production mode warnings
  if (config.production) {
    warnings.push(
      ...validateProductionConfig(config.resources, config.security),
    );
  }

  // Build the final HostConfig by merging all sources
  const hostConfig: Record<string, unknown> = {
    PortBindings: Object.keys(portBindings).length > 0 ? portBindings : undefined,
    Binds: binds.length > 0 ? binds : undefined,
    Mounts: dockerMounts,
    RestartPolicy: restartPolicyObj,
    ...resourceHostConfig,
    ...securityHostConfig,
  };

  const result: Dockerode.ContainerCreateOptions = {
    Image: config.image,
    Env: env,
    Cmd: config.cmd,
    ExposedPorts: Object.keys(exposedPorts).length > 0 ? exposedPorts : undefined,
    Hostname: config.hostname ?? config.name,
    HostConfig: hostConfig as Dockerode.ContainerCreateOptions["HostConfig"],
    NetworkingConfig: networkingConfig as Dockerode.ContainerCreateOptions["NetworkingConfig"],
  };

  if (config.name) {
    result.name = config.name;
  }

  if (userField) {
    result.User = userField;
  }

  // Filter suppressed warnings
  const filteredWarnings = filterWarnings(warnings, config.suppressWarnings);

  return { config: result, warnings: filteredWarnings };
}
