import { z } from "zod";

// ---------------------------------------------------------------------------
// Warning System
// ---------------------------------------------------------------------------

export const WarningLevel = z.enum(["warn", "critical"]);
export type WarningLevel = z.infer<typeof WarningLevel>;

/** All known warning codes */
export const WARNING_CODES = [
  "root-user",
  "no-user-set",
  "privileged-mode",
  "oom-kill-disabled",
  "no-memory-limit",
  "no-cpu-limit",
  "no-pid-limit",
  "memory-reservation-exceeds-limit",
  "memory-below-minimum",
  "swap-below-memory",
  "nano-cpus-with-shares",
  "dangerous-capability",
  "seccomp-unconfined",
  "no-new-privileges-disabled",
  "readonly-without-tmpfs",
  "invalid-seccomp-profile",
  "max-retries-without-on-failure",
  "tty-without-interactive",
] as const;

export type WarningCode = (typeof WARNING_CODES)[number];

export interface ConfigWarning {
  level: WarningLevel;
  code: WarningCode;
  message: string;
}

export const ConfigWarningSchema = z.object({
  level: WarningLevel,
  code: z.enum(WARNING_CODES),
  message: z.string(),
});
