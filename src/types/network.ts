import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const NetworkCreateOptionsSchema = z.object({
  name: z.string().min(1),
  driver: z.enum(["bridge", "overlay", "macvlan"]).default("bridge"),
  subnet: z.string().optional(),
  gateway: z.string().optional(),
  labels: z.record(z.string()).optional(),
  internal: z.boolean().default(false),
  enableIPv6: z.boolean().default(false),
});

export const ConnectOptionsSchema = z.object({
  aliases: z.array(z.string()).optional(),
  ipv4Address: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NetworkCreateOptions = z.infer<typeof NetworkCreateOptionsSchema>;

export type ConnectOptions = z.infer<typeof ConnectOptionsSchema>;

export interface NetworkContainerInfo {
  containerId: string;
  name: string;
  ipv4Address: string;
  macAddress: string;
}

export interface NetworkInfo {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  enableIPv6: boolean;
  ipam: {
    driver: string;
    config: Array<{ Subnet?: string; Gateway?: string }>;
  };
  containers: Record<string, NetworkContainerInfo>;
  labels: Record<string, string>;
  created: string;
}

export interface NetworkListFilter {
  driver?: string;
  name?: string;
  label?: string[];
  scope?: string;
}
