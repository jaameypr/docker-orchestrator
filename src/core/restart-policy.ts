import { InvalidResourceConfigError } from "../errors/base.js";
import type { RestartPolicy, DockerRestartPolicy } from "../types/restart.js";
import { RestartPolicySchema } from "../types/restart.js";

// ---------------------------------------------------------------------------
// Build Docker API restart policy from user config
// ---------------------------------------------------------------------------

export function buildRestartPolicy(input: RestartPolicy): DockerRestartPolicy {
  const parsed = RestartPolicySchema.parse(input);

  // String shorthand
  if (typeof parsed === "string") {
    return {
      Name: parsed,
      MaximumRetryCount: 0,
    };
  }

  // Object syntax
  if (parsed.maxRetries !== undefined && parsed.type !== "on-failure") {
    throw new InvalidResourceConfigError(
      "restartPolicy",
      `maxRetries is only valid with "on-failure" policy, got "${parsed.type}"`,
    );
  }

  return {
    Name: parsed.type,
    MaximumRetryCount: parsed.maxRetries ?? 0,
  };
}
