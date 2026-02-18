import { z } from "zod";

// ---------------------------------------------------------------------------
// Restart Policy
// ---------------------------------------------------------------------------

export const RestartPolicySchema = z.union([
  /** String shorthand: "no", "always", "unless-stopped", "on-failure" */
  z.enum(["no", "always", "unless-stopped", "on-failure"]),
  /** Object syntax with optional maxRetries (only valid for on-failure) */
  z.object({
    type: z.enum(["no", "always", "unless-stopped", "on-failure"]),
    maxRetries: z.number().int().positive().optional(),
  }),
]);

export type RestartPolicy = z.infer<typeof RestartPolicySchema>;

/** Docker API restart policy format */
export interface DockerRestartPolicy {
  Name: "no" | "always" | "unless-stopped" | "on-failure";
  MaximumRetryCount: number;
}
