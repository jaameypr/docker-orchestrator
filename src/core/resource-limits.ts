import { InvalidResourceConfigError } from "../errors/base.js";
import type { ResourceConfig } from "../types/resources.js";
import { ResourceConfigSchema } from "../types/resources.js";

// ---------------------------------------------------------------------------
// Memory string parser: "512m", "2g", "1.5gb" → bytes
// ---------------------------------------------------------------------------

const MEMORY_UNITS: Record<string, number> = {
  b: 1,
  k: 1024,
  kb: 1024,
  m: 1024 * 1024,
  mb: 1024 * 1024,
  g: 1024 * 1024 * 1024,
  gb: 1024 * 1024 * 1024,
  t: 1024 * 1024 * 1024 * 1024,
  tb: 1024 * 1024 * 1024 * 1024,
};

export function parseMemoryString(input: string): number {
  const trimmed = input.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([a-z]*)$/);
  if (!match) {
    throw new InvalidResourceConfigError(
      "memory",
      `Invalid memory string: "${input}". Use format like "512m", "2g", "1.5gb"`,
    );
  }

  const value = parseFloat(match[1]);
  const unit = match[2] || "b";

  const multiplier = MEMORY_UNITS[unit];
  if (multiplier === undefined) {
    throw new InvalidResourceConfigError(
      "memory",
      `Unknown memory unit: "${match[2]}". Valid units: b, k, kb, m, mb, g, gb, t, tb`,
    );
  }

  return Math.floor(value * multiplier);
}

// ---------------------------------------------------------------------------
// CPU string parser: "1.5", "0.5" → NanoCPUs
// ---------------------------------------------------------------------------

const NANO_CPU_FACTOR = 1_000_000_000;

export function parseCpuString(input: string): number {
  const trimmed = input.trim();
  const value = parseFloat(trimmed);

  if (isNaN(value) || value <= 0) {
    throw new InvalidResourceConfigError(
      "cpu",
      `Invalid CPU value: "${input}". Use a positive decimal number like "1.5"`,
    );
  }

  return Math.floor(value * NANO_CPU_FACTOR);
}

// ---------------------------------------------------------------------------
// Resolve memory value (number or string) to bytes
// ---------------------------------------------------------------------------

function resolveMemory(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  return parseMemoryString(value);
}

// ---------------------------------------------------------------------------
// Resolve CPU value (number or string) to NanoCPUs
// ---------------------------------------------------------------------------

function resolveCpu(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return Math.floor(value * NANO_CPU_FACTOR);
  return parseCpuString(value);
}

// ---------------------------------------------------------------------------
// Build HostConfig fields from resource config
// ---------------------------------------------------------------------------

export interface ResolvedResourceHostConfig {
  Memory?: number;
  MemoryReservation?: number;
  MemorySwap?: number;
  MemorySwappiness?: number;
  OomKillDisable?: boolean;
  NanoCpus?: number;
  CpuShares?: number;
  CpuPeriod?: number;
  CpuQuota?: number;
  CpusetCpus?: string;
  PidsLimit?: number;
  BlkioWeight?: number;
  BlkioDeviceReadBps?: Array<{ Path: string; Rate: number }>;
  BlkioDeviceWriteBps?: Array<{ Path: string; Rate: number }>;
}

export function buildResourceHostConfig(input: ResourceConfig): ResolvedResourceHostConfig {
  const config = ResourceConfigSchema.parse(input);
  const result: ResolvedResourceHostConfig = {};

  // Memory
  if (config.memory) {
    const mem = config.memory;
    const limitBytes = resolveMemory(mem.limit);
    const reservationBytes = resolveMemory(mem.reservation);

    if (limitBytes !== undefined) {
      result.Memory = limitBytes;
    }
    if (reservationBytes !== undefined) {
      result.MemoryReservation = reservationBytes;
    }
    if (mem.swap !== undefined) {
      const swapVal = typeof mem.swap === "string" ? parseMemoryString(mem.swap) : mem.swap;
      // Docker API: MemorySwap = total (memory + swap). -1 = unlimited
      if (swapVal === -1) {
        result.MemorySwap = -1;
      } else {
        // User specifies additional swap. Total = memory + swap
        result.MemorySwap = (limitBytes ?? 0) + swapVal;
      }
    }
    if (mem.swappiness !== undefined) {
      result.MemorySwappiness = mem.swappiness;
    }
    if (mem.oomKillDisable !== undefined) {
      result.OomKillDisable = mem.oomKillDisable;
    }
  }

  // CPU
  if (config.cpu) {
    const cpu = config.cpu;
    const nanoCpus = resolveCpu(cpu.nanoCpus);

    if (nanoCpus !== undefined) {
      result.NanoCpus = nanoCpus;
    }
    if (cpu.shares !== undefined) {
      result.CpuShares = cpu.shares;
    }
    if (cpu.period !== undefined) {
      result.CpuPeriod = cpu.period;
    }
    if (cpu.quota !== undefined) {
      result.CpuQuota = cpu.quota;
    }
    if (cpu.cpusetCpus !== undefined) {
      result.CpusetCpus = cpu.cpusetCpus;
    }
  }

  // PIDs
  if (config.pids) {
    result.PidsLimit = config.pids.limit;
  }

  // Block I/O
  if (config.blockIO) {
    const bio = config.blockIO;
    if (bio.weight !== undefined) {
      result.BlkioWeight = bio.weight;
    }
    if (bio.deviceReadBps) {
      result.BlkioDeviceReadBps = bio.deviceReadBps.map((d) => ({
        Path: d.path,
        Rate: d.rate,
      }));
    }
    if (bio.deviceWriteBps) {
      result.BlkioDeviceWriteBps = bio.deviceWriteBps.map((d) => ({
        Path: d.path,
        Rate: d.rate,
      }));
    }
  }

  return result;
}
