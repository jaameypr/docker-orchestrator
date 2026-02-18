import { z } from "zod";
import type Dockerode from "dockerode";
import { PortMappingInputSchema } from "../types/ports.js";
import { MountInputSchema } from "../types/mounts.js";
import { resolvePortMappings } from "./port-mapper.js";
import { resolveVolumeMounts } from "./volume-mapper.js";

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
});

export type ContainerConfig = z.infer<typeof ContainerConfigSchema>;

/**
 * Transforms a user-friendly container config into
 * the dockerode ContainerCreateOptions format.
 */
export function buildContainerConfig(
  input: ContainerConfig,
): Dockerode.ContainerCreateOptions {
  const config = ContainerConfigSchema.parse(input);

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

  const result: Dockerode.ContainerCreateOptions = {
    Image: config.image,
    Env: env,
    Cmd: config.cmd,
    ExposedPorts: Object.keys(exposedPorts).length > 0 ? exposedPorts : undefined,
    Hostname: config.hostname ?? config.name,
    HostConfig: {
      PortBindings: Object.keys(portBindings).length > 0 ? portBindings : undefined,
      Binds: binds.length > 0 ? binds : undefined,
      Mounts: dockerMounts,
      RestartPolicy: {
        Name: config.restartPolicy,
      },
    },
    NetworkingConfig: networkingConfig as Dockerode.ContainerCreateOptions["NetworkingConfig"],
  };

  if (config.name) {
    result.name = config.name;
  }

  return result;
}
