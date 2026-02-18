import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { InvalidMountError } from "../errors/base.js";
import type { MountInput, ResolvedMount, DockerMountConfig } from "../types/mounts.js";
import { MountInputSchema } from "../types/mounts.js";

// ---------------------------------------------------------------------------
// Volume name validation
// ---------------------------------------------------------------------------

const VALID_VOLUME_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

function isValidVolumeName(name: string): boolean {
  return VALID_VOLUME_NAME_RE.test(name);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parses a single mount input (string or object) into a ResolvedMount.
 *
 * String syntax:
 *   "/host/path:/container/path"      → bind mount
 *   "/host/path:/container/path:ro"   → read-only bind mount
 *   "volumeName:/container/path"      → named volume
 *   "volumeName:/container/path:ro"   → read-only named volume
 *
 * Object syntax:
 *   { type, source, target, readOnly, tmpfsSize }
 */
export function parseMount(input: MountInput): ResolvedMount {
  const parsed = MountInputSchema.parse(input);

  if (typeof parsed === "string") {
    return parseMountString(parsed);
  }

  // Object syntax
  if (parsed.type === "tmpfs") {
    if (!isAbsolute(parsed.target)) {
      throw new InvalidMountError(
        parsed.target,
        "Container path (target) must be an absolute path",
      );
    }
    return {
      type: "tmpfs",
      source: "",
      target: parsed.target,
      readOnly: parsed.readOnly,
      tmpfsSize: parsed.tmpfsSize,
    };
  }

  if (parsed.type === "volume") {
    if (!isValidVolumeName(parsed.source)) {
      throw new InvalidMountError(
        parsed.source,
        "Invalid volume name. Must start with alphanumeric and contain only [a-zA-Z0-9_.-]",
      );
    }
  }

  if (!isAbsolute(parsed.target)) {
    throw new InvalidMountError(parsed.target, "Container path (target) must be an absolute path");
  }

  return {
    type: parsed.type,
    source: parsed.source,
    target: parsed.target,
    readOnly: parsed.readOnly,
  };
}

function parseMountString(spec: string): ResolvedMount {
  const parts = spec.split(":");

  if (parts.length < 2 || parts.length > 3) {
    throw new InvalidMountError(spec, "Expected format: source:target[:ro]");
  }

  const source = parts[0];
  const target = parts[1];
  const options = parts[2];

  if (!target || !isAbsolute(target)) {
    throw new InvalidMountError(spec, "Container path must be an absolute path");
  }

  const readOnly = options === "ro";
  if (options && options !== "ro") {
    throw new InvalidMountError(spec, `Unknown option "${options}". Only "ro" is supported.`);
  }

  // Determine type: absolute source path → bind, otherwise → named volume
  const type = isAbsolute(source) ? "bind" : "volume";

  if (type === "volume" && !isValidVolumeName(source)) {
    throw new InvalidMountError(
      source,
      "Invalid volume name. Must start with alphanumeric and contain only [a-zA-Z0-9_.-]",
    );
  }

  return { type, source, target, readOnly };
}

// ---------------------------------------------------------------------------
// Batch parsing
// ---------------------------------------------------------------------------

/**
 * Parses an array of mount inputs into resolved mounts.
 */
export function parseMounts(inputs: MountInput[]): ResolvedMount[] {
  return inputs.map(parseMount);
}

// ---------------------------------------------------------------------------
// Validation (optional warnings)
// ---------------------------------------------------------------------------

export interface MountValidationWarning {
  mount: ResolvedMount;
  message: string;
}

/**
 * Validates resolved mounts and returns warnings (e.g., host path doesn't exist).
 * This does NOT throw – it returns warnings for the caller to handle.
 */
export function validateMounts(mounts: ResolvedMount[]): MountValidationWarning[] {
  const warnings: MountValidationWarning[] = [];

  for (const mount of mounts) {
    if (mount.type === "bind" && !existsSync(mount.source)) {
      warnings.push({
        mount,
        message: `Host path "${mount.source}" does not exist. Docker will create it as a directory.`,
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Transformation → Docker API format
// ---------------------------------------------------------------------------

/**
 * Converts resolved mounts to Docker API HostConfig.Binds strings.
 * Only handles bind mounts and named volumes (not tmpfs).
 */
export function toDockerBinds(mounts: ResolvedMount[]): string[] {
  return mounts
    .filter((m) => m.type === "bind" || m.type === "volume")
    .map((m) => {
      const base = `${m.source}:${m.target}`;
      return m.readOnly ? `${base}:ro` : base;
    });
}

/**
 * Converts resolved mounts to Docker API HostConfig.Mounts format.
 * Handles all mount types including tmpfs.
 */
export function toDockerMounts(mounts: ResolvedMount[]): DockerMountConfig[] {
  return mounts.map((m) => {
    const mount: DockerMountConfig = {
      Type: m.type,
      Source: m.type === "tmpfs" ? "" : m.source,
      Target: m.target,
      ReadOnly: m.readOnly,
    };

    if (m.type === "tmpfs" && m.tmpfsSize) {
      mount.TmpfsOptions = { SizeBytes: m.tmpfsSize };
    }

    return mount;
  });
}

/**
 * High-level function: parse user inputs and produce Docker API config.
 * Uses Binds for simple bind/volume mounts, and Mounts for tmpfs.
 */
export function resolveVolumeMounts(inputs: MountInput[]): {
  binds: string[];
  mounts: DockerMountConfig[];
} {
  const resolved = parseMounts(inputs);

  const bindMounts = resolved.filter((m) => m.type !== "tmpfs");
  const tmpfsMounts = resolved.filter((m) => m.type === "tmpfs");

  return {
    binds: toDockerBinds(bindMounts),
    mounts: toDockerMounts(tmpfsMounts),
  };
}
