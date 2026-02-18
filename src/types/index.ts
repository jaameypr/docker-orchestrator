import { z } from "zod";

export const ClientOptionsSchema = z.object({
  socketPath: z.string().optional(),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  ca: z.string().optional(),
  cert: z.string().optional(),
  key: z.string().optional(),
});

export type ClientOptions = z.infer<typeof ClientOptionsSchema>;

export interface DockerVersionInfo {
  version: string;
  apiVersion: string;
  os: string;
  arch: string;
  kernelVersion: string;
}

export interface PullProgressEvent {
  status: string;
  id?: string;
  progress?: string;
  progressDetail?: {
    current?: number;
    total?: number;
  };
}

export type PullProgressCallback = (event: PullProgressEvent) => void;

export interface ImageInfo {
  id: string;
  repoTags: string[];
  size: number;
  created: number;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: Array<{
    privatePort: number;
    publicPort?: number;
    type: string;
  }>;
  created: number;
}

export interface ContainerInspectResult {
  id: string;
  name: string;
  image: string;
  state: {
    status: string;
    running: boolean;
    pid: number;
    exitCode: number;
    startedAt: string;
    finishedAt: string;
  };
  config: {
    hostname: string;
    env: string[];
    cmd: string[];
    image: string;
  };
  networkSettings: {
    ipAddress: string;
    ports: Record<
      string,
      Array<{ HostIp: string; HostPort: string }> | null
    >;
  };
}
