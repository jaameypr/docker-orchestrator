import { z } from "zod";
import type Dockerode from "dockerode";

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

  // Build port bindings and exposed ports
  const exposedPorts: Record<string, object> = {};
  const portBindings: Record<string, Array<{ HostPort: string }>> = {};

  if (config.ports) {
    for (const port of config.ports) {
      const key = `${port.container}/${port.protocol}`;
      exposedPorts[key] = {};
      portBindings[key] = [{ HostPort: port.host ? String(port.host) : "" }];
    }
  }

  // Build volume binds
  const binds: string[] = [];
  if (config.volumes) {
    for (const vol of config.volumes) {
      const bind = vol.readOnly
        ? `${vol.host}:${vol.container}:ro`
        : `${vol.host}:${vol.container}`;
      binds.push(bind);
    }
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
      RestartPolicy: {
        Name: config.restartPolicy,
      },
    },
  };

  if (config.name) {
    result.name = config.name;
  }

  return result;
}
