import {
  ContainerPresetSchema,
  type ContainerPreset,
  type PresetRegistryOptions,
} from "../types/presets.js";
import {
  PresetNotFoundError,
  PresetAlreadyExistsError,
  PresetValidationError,
} from "../errors/base.js";
import type { ContainerConfig } from "../builders/config-builder.js";

// ---------------------------------------------------------------------------
// definePreset
// ---------------------------------------------------------------------------

/**
 * Validates and returns a typed ContainerPreset.
 * Accepts raw input (e.g. from JSON) and validates at runtime.
 */
export function definePreset(input: unknown): ContainerPreset {
  const result = ContainerPresetSchema.safeParse(input);
  if (!result.success) {
    throw new PresetValidationError(result.error.message);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Preset Serialization
// ---------------------------------------------------------------------------

/**
 * Serializes a preset to JSON. Handles RegExp in readyCheck.logMatch
 * by converting to a string format: "/pattern/flags".
 */
export function serializePreset(preset: ContainerPreset): string {
  return JSON.stringify(preset, (_, value) => {
    if (value instanceof RegExp) {
      return `__REGEXP__${value.source}__FLAGS__${value.flags}`;
    }
    return value;
  }, 2);
}

/**
 * Deserializes a preset from JSON. Restores RegExp instances
 * from their serialized form.
 */
export function deserializePreset(json: string): ContainerPreset {
  const parsed = JSON.parse(json, (_, value) => {
    if (typeof value === "string" && value.startsWith("__REGEXP__")) {
      const match = value.match(/^__REGEXP__(.+)__FLAGS__(.*)$/);
      if (match) {
        return new RegExp(match[1], match[2]);
      }
    }
    return value;
  });
  return definePreset(parsed);
}

// ---------------------------------------------------------------------------
// Preset Merge Logic
// ---------------------------------------------------------------------------

/**
 * Merges a preset config with user overrides.
 *
 * Merge rules:
 * - env: key-based merge (user wins on same key)
 * - ports/portMappings: user completely overwrites preset
 * - volumes/mounts: additive (preset + user combined)
 * - Everything else: deep merge, user wins
 */
export function mergePresetConfig(
  presetConfig: Partial<ContainerConfig>,
  userOverrides: Partial<ContainerConfig>,
): Partial<ContainerConfig> {
  const result: Record<string, unknown> = { ...presetConfig };

  for (const [key, userValue] of Object.entries(userOverrides)) {
    if (userValue === undefined) continue;

    switch (key) {
      case "env": {
        // Key-based merge: preset + user, user wins on same key
        const presetEnv = (presetConfig.env ?? {}) as Record<string, string>;
        const userEnv = userValue as Record<string, string>;
        result.env = { ...presetEnv, ...userEnv };
        break;
      }

      case "ports":
      case "portMappings": {
        // User completely overwrites preset ports
        result[key] = userValue;
        break;
      }

      case "volumes": {
        // Additive merge
        const presetVols = (presetConfig.volumes ?? []) as Array<{ host: string; container: string; readOnly?: boolean }>;
        const userVols = userValue as Array<{ host: string; container: string; readOnly?: boolean }>;
        result.volumes = [...presetVols, ...userVols];
        break;
      }

      case "mounts": {
        // Additive merge
        const presetMounts = (presetConfig.mounts ?? []) as unknown[];
        const userMounts = userValue as unknown[];
        result.mounts = [...presetMounts, ...userMounts];
        break;
      }

      case "labels": {
        // Key-based merge
        const presetLabels = (presetConfig.labels ?? {}) as Record<string, string>;
        const userLabels = userValue as Record<string, string>;
        result.labels = { ...presetLabels, ...userLabels };
        break;
      }

      default: {
        // User wins
        result[key] = userValue;
        break;
      }
    }
  }

  return result as Partial<ContainerConfig>;
}

// ---------------------------------------------------------------------------
// Preset Registry
// ---------------------------------------------------------------------------

const PRESET_LABEL = "orchestrator.preset";

export { PRESET_LABEL };

export class PresetRegistry {
  private readonly presets = new Map<string, ContainerPreset>();

  /**
   * Register a new preset.
   * @throws PresetAlreadyExistsError if name exists and overwrite is false
   */
  register(preset: ContainerPreset, options?: PresetRegistryOptions): void {
    const validated = definePreset(preset);

    if (this.presets.has(validated.name) && !options?.overwrite) {
      throw new PresetAlreadyExistsError(validated.name);
    }

    this.presets.set(validated.name, validated);
  }

  /**
   * Register multiple presets at once.
   */
  registerMany(presets: ContainerPreset[], options?: PresetRegistryOptions): void {
    for (const preset of presets) {
      this.register(preset, options);
    }
  }

  /**
   * Get a preset by name.
   * @throws PresetNotFoundError if not found
   */
  get(name: string): ContainerPreset {
    const preset = this.presets.get(name);
    if (!preset) {
      throw new PresetNotFoundError(name);
    }
    return preset;
  }

  /**
   * Check if a preset exists.
   */
  has(name: string): boolean {
    return this.presets.has(name);
  }

  /**
   * List all registered preset names.
   */
  list(): string[] {
    return Array.from(this.presets.keys());
  }

  /**
   * Remove a preset by name.
   */
  remove(name: string): boolean {
    return this.presets.delete(name);
  }

  /**
   * Remove all presets.
   */
  clear(): void {
    this.presets.clear();
  }
}
