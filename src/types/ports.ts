import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const PortMappingObjectSchema = z.object({
  host: z.number().int().nonnegative(),
  container: z.number().int().positive(),
  protocol: z.enum(["tcp", "udp"]).default("tcp"),
  ip: z.string().default("0.0.0.0"),
});

/**
 * Union type: user can provide a port mapping as:
 * - number:  8080 → container 8080, host 8080
 * - string:  "8080:80", "127.0.0.1:8080:80", "8080:80/udp", "8080-8090:80-90"
 * - object:  { host, container, protocol, ip }
 */
export const PortMappingInputSchema = z.union([
  z.number().int().positive(),
  z.string().min(1),
  PortMappingObjectSchema,
]);

export type PortMappingInput = z.infer<typeof PortMappingInputSchema>;

// ---------------------------------------------------------------------------
// Resolved types (after parsing)
// ---------------------------------------------------------------------------

export interface ResolvedPortMapping {
  hostPort: number;
  containerPort: number;
  protocol: "tcp" | "udp";
  hostIp: string;
}

/**
 * Docker API format for port bindings.
 */
export interface DockerPortConfig {
  exposedPorts: Record<string, object>;
  portBindings: Record<string, Array<{ HostIp: string; HostPort: string }>>;
}

export interface AssignedPort {
  containerPort: number;
  hostPort: number;
  protocol: string;
  hostIp: string;
}
