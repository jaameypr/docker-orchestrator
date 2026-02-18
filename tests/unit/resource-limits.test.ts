import { describe, it, expect } from "vitest";
import {
  parseMemoryString,
  parseCpuString,
  buildResourceHostConfig,
} from "../../src/core/resource-limits.js";
import { InvalidResourceConfigError } from "../../src/errors/base.js";

describe("parseMemoryString", () => {
  it("should parse megabytes", () => {
    expect(parseMemoryString("512m")).toBe(536870912);
    expect(parseMemoryString("512mb")).toBe(536870912);
    expect(parseMemoryString("512M")).toBe(536870912);
  });

  it("should parse gigabytes", () => {
    expect(parseMemoryString("2g")).toBe(2147483648);
    expect(parseMemoryString("2gb")).toBe(2147483648);
    expect(parseMemoryString("2G")).toBe(2147483648);
  });

  it("should parse fractional values", () => {
    expect(parseMemoryString("1.5gb")).toBe(1610612736);
    expect(parseMemoryString("0.5g")).toBe(536870912);
  });

  it("should parse kilobytes", () => {
    expect(parseMemoryString("1024k")).toBe(1048576);
    expect(parseMemoryString("1024kb")).toBe(1048576);
  });

  it("should parse bytes (no unit)", () => {
    expect(parseMemoryString("1048576")).toBe(1048576);
  });

  it("should parse terabytes", () => {
    expect(parseMemoryString("1t")).toBe(1099511627776);
    expect(parseMemoryString("1tb")).toBe(1099511627776);
  });

  it("should handle whitespace", () => {
    expect(parseMemoryString("  512m  ")).toBe(536870912);
    expect(parseMemoryString("2 g")).toBe(2147483648);
  });

  it("should throw for invalid format", () => {
    expect(() => parseMemoryString("abc")).toThrow(InvalidResourceConfigError);
    expect(() => parseMemoryString("")).toThrow(InvalidResourceConfigError);
    expect(() => parseMemoryString("512x")).toThrow(InvalidResourceConfigError);
  });
});

describe("parseCpuString", () => {
  it("should parse decimal CPU values to NanoCPUs", () => {
    expect(parseCpuString("1.5")).toBe(1500000000);
    expect(parseCpuString("0.5")).toBe(500000000);
    expect(parseCpuString("2")).toBe(2000000000);
    expect(parseCpuString("1")).toBe(1000000000);
  });

  it("should handle fractional values", () => {
    expect(parseCpuString("0.25")).toBe(250000000);
    expect(parseCpuString("0.1")).toBe(100000000);
  });

  it("should throw for invalid values", () => {
    expect(() => parseCpuString("abc")).toThrow(InvalidResourceConfigError);
    expect(() => parseCpuString("0")).toThrow(InvalidResourceConfigError);
    expect(() => parseCpuString("-1")).toThrow(InvalidResourceConfigError);
  });
});

describe("buildResourceHostConfig", () => {
  it("should build memory limits from numeric values", () => {
    const result = buildResourceHostConfig({
      memory: {
        limit: 536870912,
        reservation: 268435456,
      },
    });
    expect(result.Memory).toBe(536870912);
    expect(result.MemoryReservation).toBe(268435456);
  });

  it("should build memory limits from string values", () => {
    const result = buildResourceHostConfig({
      memory: {
        limit: "512m",
        reservation: "256m",
      },
    });
    expect(result.Memory).toBe(536870912);
    expect(result.MemoryReservation).toBe(268435456);
  });

  it("should calculate swap correctly (memory + swap)", () => {
    const result = buildResourceHostConfig({
      memory: {
        limit: "512m",
        swap: "256m",
      },
    });
    // MemorySwap = Memory + Swap
    expect(result.MemorySwap).toBe(536870912 + 268435456);
  });

  it("should handle unlimited swap (-1)", () => {
    const result = buildResourceHostConfig({
      memory: {
        limit: "512m",
        swap: -1,
      },
    });
    expect(result.MemorySwap).toBe(-1);
  });

  it("should set swappiness", () => {
    const result = buildResourceHostConfig({
      memory: { swappiness: 60 },
    });
    expect(result.MemorySwappiness).toBe(60);
  });

  it("should set OomKillDisable", () => {
    const result = buildResourceHostConfig({
      memory: { oomKillDisable: true },
    });
    expect(result.OomKillDisable).toBe(true);
  });

  it("should build CPU limits with NanoCPUs from numeric input", () => {
    const result = buildResourceHostConfig({
      cpu: { nanoCpus: 1.5 },
    });
    expect(result.NanoCpus).toBe(1500000000);
  });

  it("should build CPU limits with NanoCPUs from string input", () => {
    const result = buildResourceHostConfig({
      cpu: { nanoCpus: "0.5" },
    });
    expect(result.NanoCpus).toBe(500000000);
  });

  it("should build CPU shares", () => {
    const result = buildResourceHostConfig({
      cpu: { shares: 512 },
    });
    expect(result.CpuShares).toBe(512);
  });

  it("should build CPU period and quota", () => {
    const result = buildResourceHostConfig({
      cpu: { period: 100000, quota: 50000 },
    });
    expect(result.CpuPeriod).toBe(100000);
    expect(result.CpuQuota).toBe(50000);
  });

  it("should build CpusetCpus", () => {
    const result = buildResourceHostConfig({
      cpu: { cpusetCpus: "0,1" },
    });
    expect(result.CpusetCpus).toBe("0,1");
  });

  it("should build PID limit", () => {
    const result = buildResourceHostConfig({
      pids: { limit: 200 },
    });
    expect(result.PidsLimit).toBe(200);
  });

  it("should build block I/O weight", () => {
    const result = buildResourceHostConfig({
      blockIO: { weight: 500 },
    });
    expect(result.BlkioWeight).toBe(500);
  });

  it("should build device-specific I/O limits", () => {
    const result = buildResourceHostConfig({
      blockIO: {
        deviceReadBps: [{ path: "/dev/sda", rate: 1048576 }],
        deviceWriteBps: [{ path: "/dev/sda", rate: 524288 }],
      },
    });
    expect(result.BlkioDeviceReadBps).toEqual([
      { Path: "/dev/sda", Rate: 1048576 },
    ]);
    expect(result.BlkioDeviceWriteBps).toEqual([
      { Path: "/dev/sda", Rate: 524288 },
    ]);
  });

  it("should return empty object for empty config", () => {
    const result = buildResourceHostConfig({});
    expect(result).toEqual({});
  });

  it("should build combined resource config", () => {
    const result = buildResourceHostConfig({
      memory: { limit: "256m" },
      cpu: { nanoCpus: 0.5 },
      pids: { limit: 100 },
    });
    expect(result.Memory).toBe(268435456);
    expect(result.NanoCpus).toBe(500000000);
    expect(result.PidsLimit).toBe(100);
  });
});
