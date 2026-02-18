import { z } from "zod";

// ---------------------------------------------------------------------------
// Health Check Configuration
// ---------------------------------------------------------------------------

export const HttpGetSchema = z.object({
  path: z.string().min(1),
  port: z.number().int().positive(),
  expectedStatus: z
    .union([z.number().int().positive(), z.array(z.number().int().positive())])
    .optional(),
});

export type HttpGet = z.infer<typeof HttpGetSchema>;

export const TcpSocketSchema = z.object({
  port: z.number().int().positive(),
});

export type TcpSocket = z.infer<typeof TcpSocketSchema>;

export const ExecCheckSchema = z.object({
  command: z.array(z.string().min(1)).min(1),
});

export type ExecCheck = z.infer<typeof ExecCheckSchema>;

export const HealthCheckConfigSchema = z
  .object({
    type: z.enum(["http", "tcp", "exec", "none"]),
    /** HTTP health check configuration */
    httpGet: HttpGetSchema.optional(),
    /** TCP socket health check configuration */
    tcpSocket: TcpSocketSchema.optional(),
    /** Exec health check configuration */
    exec: ExecCheckSchema.optional(),
    /** Seconds between checks (default: 10) */
    interval: z.number().positive().default(10),
    /** Timeout per check in seconds (default: 5) */
    timeout: z.number().positive().default(5),
    /** Failed attempts before unhealthy (default: 3) */
    retries: z.number().int().positive().default(3),
    /** Grace period after start in seconds (default: 0) */
    startPeriod: z.number().nonnegative().default(0),
  })
  .refine(
    (data) => {
      if (data.type === "http" && !data.httpGet) return false;
      if (data.type === "tcp" && !data.tcpSocket) return false;
      if (data.type === "exec" && !data.exec) return false;
      return true;
    },
    {
      message:
        "Health check configuration must include the corresponding options for its type (httpGet for http, tcpSocket for tcp, exec for exec)",
    },
  );

export type HealthCheckConfig = z.infer<typeof HealthCheckConfigSchema>;

// ---------------------------------------------------------------------------
// Health Check Result
// ---------------------------------------------------------------------------

export type HealthStatus = "healthy" | "unhealthy" | "timeout";

export interface HealthCheckResult {
  status: HealthStatus;
  checks: number;
  elapsed: number;
  lastError?: string;
}

// ---------------------------------------------------------------------------
// Health Check Events
// ---------------------------------------------------------------------------

export interface HealthCheckEvents {
  "health.checking": { containerId: string; check: number };
  "health.healthy": { containerId: string; checks: number; elapsed: number };
  "health.unhealthy": {
    containerId: string;
    checks: number;
    error: string;
  };
  "health.timeout": { containerId: string; elapsed: number };
}
