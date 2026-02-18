import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import { attachContainer, sendCommand, sendCommands } from "../../src/core/attach.js";
import {
  ContainerNotFoundError,
  ContainerNotRunningError,
  StdinNotAvailableError,
} from "../../src/errors/base.js";

// ---------------------------------------------------------------------------
// Mock Docker
// ---------------------------------------------------------------------------

function createMockDocker(options?: {
  exists?: boolean;
  running?: boolean;
  openStdin?: boolean;
  tty?: boolean;
}) {
  const stream = new PassThrough();
  const inspectData = {
    State: { Running: options?.running ?? true },
    Config: {
      OpenStdin: options?.openStdin ?? true,
      Tty: options?.tty ?? false,
    },
  };

  const container = {
    inspect: options?.exists === false
      ? vi.fn().mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 }))
      : vi.fn().mockResolvedValue(inspectData),
    attach: vi.fn().mockResolvedValue(stream),
  };

  const docker = {
    getContainer: vi.fn().mockReturnValue(container),
  };

  return { docker, container, stream };
}

// ---------------------------------------------------------------------------
// attachContainer
// ---------------------------------------------------------------------------

describe("attachContainer", () => {
  it("should attach to a running container with OpenStdin", async () => {
    const { docker } = createMockDocker();

    const result = await attachContainer(docker as never, "test-container-id");
    expect(result.stream).toBeDefined();
    expect(result.tty).toBe(false);
    expect(result.demuxed).not.toBeNull();
  });

  it("should return null demuxed for TTY containers", async () => {
    const { docker } = createMockDocker({ tty: true });

    const result = await attachContainer(docker as never, "test-container-id");
    expect(result.tty).toBe(true);
    expect(result.demuxed).toBeNull();
  });

  it("should throw ContainerNotFoundError when container does not exist", async () => {
    const { docker } = createMockDocker({ exists: false });

    await expect(
      attachContainer(docker as never, "nonexistent"),
    ).rejects.toThrow(ContainerNotFoundError);
  });

  it("should throw ContainerNotRunningError when container is not running", async () => {
    const { docker } = createMockDocker({ running: false });

    await expect(
      attachContainer(docker as never, "stopped-container"),
    ).rejects.toThrow(ContainerNotRunningError);
  });

  it("should throw StdinNotAvailableError when OpenStdin is false", async () => {
    const { docker } = createMockDocker({ openStdin: false });

    await expect(
      attachContainer(docker as never, "no-stdin-container"),
    ).rejects.toThrow(StdinNotAvailableError);
  });

  it("should not check OpenStdin when stdin option is false", async () => {
    const { docker } = createMockDocker({ openStdin: false });

    const result = await attachContainer(docker as never, "no-stdin-container", {
      stdin: false,
      stdout: true,
      stderr: true,
    });
    expect(result.stream).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// sendCommand
// ---------------------------------------------------------------------------

describe("sendCommand", () => {
  it("should send a command with newline and end the stream", async () => {
    const { docker, stream } = createMockDocker();
    const writeSpy = vi.spyOn(stream, "write");
    const endSpy = vi.spyOn(stream, "end");

    await sendCommand(docker as never, "test-container", "hello");

    expect(writeSpy).toHaveBeenCalledWith("hello\n");
    expect(endSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sendCommands
// ---------------------------------------------------------------------------

describe("sendCommands", () => {
  it("should send multiple commands sequentially", async () => {
    const { docker, stream } = createMockDocker();
    const writeSpy = vi.spyOn(stream, "write");
    const endSpy = vi.spyOn(stream, "end");

    await sendCommands(docker as never, "test-container", ["cmd1", "cmd2", "cmd3"]);

    expect(writeSpy).toHaveBeenCalledTimes(3);
    expect(writeSpy).toHaveBeenNthCalledWith(1, "cmd1\n");
    expect(writeSpy).toHaveBeenNthCalledWith(2, "cmd2\n");
    expect(writeSpy).toHaveBeenNthCalledWith(3, "cmd3\n");
    expect(endSpy).toHaveBeenCalled();
  });
});
