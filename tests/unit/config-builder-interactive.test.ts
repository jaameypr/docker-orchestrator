import { describe, it, expect } from "vitest";
import { buildContainerConfig, ContainerConfigSchema } from "../../src/builders/config-builder.js";

describe("ContainerConfigSchema - interactive/tty fields", () => {
  it("should accept interactive: true", () => {
    const result = ContainerConfigSchema.parse({
      image: "alpine:latest",
      interactive: true,
    });
    expect(result.interactive).toBe(true);
  });

  it("should accept tty: true", () => {
    const result = ContainerConfigSchema.parse({
      image: "alpine:latest",
      tty: true,
    });
    expect(result.tty).toBe(true);
  });

  it("should default interactive and tty to undefined", () => {
    const result = ContainerConfigSchema.parse({ image: "alpine:latest" });
    expect(result.interactive).toBeUndefined();
    expect(result.tty).toBeUndefined();
  });

  it("should accept preset field", () => {
    const result = ContainerConfigSchema.parse({
      image: "alpine:latest",
      preset: "minecraft",
    });
    expect(result.preset).toBe("minecraft");
  });
});

describe("buildContainerConfig - interactive/tty", () => {
  it("should set OpenStdin and AttachStdin/Stdout/Stderr when interactive: true", () => {
    const { config } = buildContainerConfig({
      image: "alpine:latest",
      interactive: true,
    });

    const raw = config as Record<string, unknown>;
    expect(raw.OpenStdin).toBe(true);
    expect(raw.AttachStdin).toBe(true);
    expect(raw.AttachStdout).toBe(true);
    expect(raw.AttachStderr).toBe(true);
  });

  it("should not set OpenStdin when interactive is not set", () => {
    const { config } = buildContainerConfig({
      image: "alpine:latest",
    });

    const raw = config as Record<string, unknown>;
    expect(raw.OpenStdin).toBeUndefined();
    expect(raw.AttachStdin).toBeUndefined();
  });

  it("should set Tty when tty: true", () => {
    const { config } = buildContainerConfig({
      image: "alpine:latest",
      interactive: true,
      tty: true,
    });

    const raw = config as Record<string, unknown>;
    expect(raw.Tty).toBe(true);
    expect(raw.OpenStdin).toBe(true);
  });

  it("should warn when tty: true without interactive: true", () => {
    const { config, warnings } = buildContainerConfig({
      image: "alpine:latest",
      tty: true,
    });

    const raw = config as Record<string, unknown>;
    expect(raw.Tty).toBe(true);
    expect(raw.OpenStdin).toBeUndefined();

    const ttyWarning = warnings.find((w) => w.code === "tty-without-interactive");
    expect(ttyWarning).toBeDefined();
    expect(ttyWarning!.level).toBe("warn");
  });

  it("should not warn when tty: true with interactive: true", () => {
    const { warnings } = buildContainerConfig({
      image: "alpine:latest",
      interactive: true,
      tty: true,
    });

    const ttyWarning = warnings.find((w) => w.code === "tty-without-interactive");
    expect(ttyWarning).toBeUndefined();
  });
});
