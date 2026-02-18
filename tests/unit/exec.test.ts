import { describe, it, expect, vi, beforeEach } from "vitest";
import { PassThrough } from "node:stream";
import {
  createExec,
  startExec,
  executeCommand,
  executeInteractive,
  executeScript,
} from "../../src/core/exec.js";
import {
  ContainerNotFoundError,
  ContainerNotRunningError,
  CommandFailedError,
  CommandTimeoutError,
} from "../../src/errors/base.js";
import type Docker from "dockerode";

function createMockDocker() {
  return {
    getContainer: vi.fn(),
  } as unknown as Docker & {
    getContainer: ReturnType<typeof vi.fn>;
  };
}

function createMockStream() {
  const stream = new PassThrough();
  return stream;
}

/**
 * Builds a Docker multiplex frame: 8-byte header + payload.
 * streamType: 1=stdout, 2=stderr
 */
function buildFrame(streamType: number, data: string): Buffer {
  const payload = Buffer.from(data, "utf-8");
  const header = Buffer.alloc(8);
  header[0] = streamType;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

describe("createExec", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should create an exec instance with correct options", async () => {
    const execMock = { id: "exec-123" };
    docker.getContainer.mockReturnValue({
      exec: vi.fn().mockResolvedValue(execMock),
    });

    const result = await createExec(docker, "container-1", {
      cmd: ["ls", "-la"],
      attachStdout: true,
      attachStderr: true,
      attachStdin: false,
      tty: false,
      privileged: false,
    });

    expect(result).toEqual(execMock);
    expect(docker.getContainer).toHaveBeenCalledWith("container-1");
  });

  it("should pass env and workingDir to Docker API", async () => {
    const execFn = vi.fn().mockResolvedValue({ id: "exec-456" });
    docker.getContainer.mockReturnValue({ exec: execFn });

    await createExec(docker, "container-1", {
      cmd: ["env"],
      attachStdout: true,
      attachStderr: true,
      attachStdin: false,
      tty: false,
      privileged: false,
      env: ["FOO=bar"],
      workingDir: "/app",
      user: "nobody",
    });

    expect(execFn).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ["env"],
        Env: ["FOO=bar"],
        WorkingDir: "/app",
        User: "nobody",
      }),
    );
  });

  it("should throw ContainerNotFoundError for 404", async () => {
    docker.getContainer.mockReturnValue({
      exec: vi.fn().mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 })),
    });

    await expect(
      createExec(docker, "nonexistent", {
        cmd: ["ls"],
        attachStdout: true,
        attachStderr: true,
        attachStdin: false,
        tty: false,
        privileged: false,
      }),
    ).rejects.toThrow(ContainerNotFoundError);
  });

  it("should throw ContainerNotRunningError for 409", async () => {
    docker.getContainer.mockReturnValue({
      exec: vi.fn().mockRejectedValue(Object.assign(new Error("not running"), { statusCode: 409 })),
    });

    await expect(
      createExec(docker, "stopped-container", {
        cmd: ["ls"],
        attachStdout: true,
        attachStderr: true,
        attachStdin: false,
        tty: false,
        privileged: false,
      }),
    ).rejects.toThrow(ContainerNotRunningError);
  });
});

describe("startExec", () => {
  it("should collect stdout and stderr from non-TTY exec", async () => {
    const stream = createMockStream();

    const mockExec = {
      start: vi.fn().mockResolvedValue(stream),
      inspect: vi.fn().mockResolvedValue({ Running: false, ExitCode: 0, Pid: 42 }),
    };

    // Push multiplexed frames then end
    const stdoutFrame = buildFrame(1, "hello stdout");
    const stderrFrame = buildFrame(2, "hello stderr");

    setTimeout(() => {
      stream.write(stdoutFrame);
      stream.write(stderrFrame);
      stream.end();
    }, 10);

    const result = await startExec(mockExec as unknown as Docker.Exec, false);

    expect(result.stdout).toBe("hello stdout");
    expect(result.stderr).toBe("hello stderr");
    expect(result.exitCode).toBe(0);
  });

  it("should collect output from TTY exec (no demuxing)", async () => {
    const stream = createMockStream();

    const mockExec = {
      start: vi.fn().mockResolvedValue(stream),
      inspect: vi.fn().mockResolvedValue({ Running: false, ExitCode: 0, Pid: 42 }),
    };

    setTimeout(() => {
      stream.write(Buffer.from("tty output here"));
      stream.end();
    }, 10);

    const result = await startExec(mockExec as unknown as Docker.Exec, true);

    expect(result.stdout).toBe("tty output here");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should return correct exit code on failure", async () => {
    const stream = createMockStream();

    const mockExec = {
      start: vi.fn().mockResolvedValue(stream),
      inspect: vi.fn().mockResolvedValue({ Running: false, ExitCode: 42, Pid: 0 }),
    };

    setTimeout(() => {
      stream.end();
    }, 10);

    const result = await startExec(mockExec as unknown as Docker.Exec, false);
    expect(result.exitCode).toBe(42);
  });
});

describe("executeCommand", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should execute a simple string command", async () => {
    const stream = createMockStream();
    const stdoutFrame = buildFrame(1, "file.txt\n");

    const execFn = vi.fn().mockResolvedValue({
      start: vi.fn().mockResolvedValue(stream),
      inspect: vi.fn().mockResolvedValue({ Running: false, ExitCode: 0, Pid: 1 }),
    });
    docker.getContainer.mockReturnValue({ exec: execFn });

    setTimeout(() => {
      stream.write(stdoutFrame);
      stream.end();
    }, 10);

    const result = await executeCommand(docker, "container-1", "ls -la");

    expect(result.stdout).toBe("file.txt\n");
    expect(result.exitCode).toBe(0);

    // Verify command was split correctly
    expect(execFn).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ["ls", "-la"],
      }),
    );
  });

  it("should execute a command array", async () => {
    const stream = createMockStream();
    const stdoutFrame = buildFrame(1, "output\n");

    const execFn = vi.fn().mockResolvedValue({
      start: vi.fn().mockResolvedValue(stream),
      inspect: vi.fn().mockResolvedValue({ Running: false, ExitCode: 0, Pid: 1 }),
    });
    docker.getContainer.mockReturnValue({ exec: execFn });

    setTimeout(() => {
      stream.write(stdoutFrame);
      stream.end();
    }, 10);

    const result = await executeCommand(docker, "container-1", ["echo", "hello world"]);

    expect(result.stdout).toBe("output\n");
    expect(execFn).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ["echo", "hello world"],
      }),
    );
  });

  it("should throw CommandFailedError when exit code is non-zero", async () => {
    const stream = createMockStream();
    const stderrFrame = buildFrame(2, "command not found\n");

    const execFn = vi.fn().mockResolvedValue({
      start: vi.fn().mockResolvedValue(stream),
      inspect: vi.fn().mockResolvedValue({ Running: false, ExitCode: 127, Pid: 0 }),
    });
    docker.getContainer.mockReturnValue({ exec: execFn });

    setTimeout(() => {
      stream.write(stderrFrame);
      stream.end();
    }, 10);

    await expect(executeCommand(docker, "container-1", "nonexistent_command")).rejects.toThrow(
      CommandFailedError,
    );
  });

  it("should throw CommandTimeoutError when command exceeds timeout", async () => {
    const stream = createMockStream();

    const execFn = vi.fn().mockResolvedValue({
      start: vi.fn().mockResolvedValue(stream),
      inspect: vi.fn().mockResolvedValue({ Running: true, ExitCode: -1, Pid: 1 }),
    });
    docker.getContainer.mockReturnValue({ exec: execFn });

    // Stream never ends, timeout should fire
    await expect(
      executeCommand(docker, "container-1", "sleep 999", { timeout: 100 }),
    ).rejects.toThrow(CommandTimeoutError);

    stream.destroy();
  });
});

describe("executeInteractive", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should return interactive handle with stdin/stdout in TTY mode", async () => {
    const stream = createMockStream();

    const mockExec = {
      start: vi.fn().mockResolvedValue(stream),
      inspect: vi.fn().mockResolvedValue({ Running: true, ExitCode: -1, Pid: 42 }),
      resize: vi.fn().mockResolvedValue(undefined),
    };

    docker.getContainer.mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockExec),
    });

    const handle = await executeInteractive(docker, "container-1", "/bin/sh", { tty: true });

    expect(handle.stdin).toBeDefined();
    expect(handle.stdout).toBeDefined();
    expect(handle.stderr).toBeNull(); // No stderr in TTY mode
    expect(typeof handle.resize).toBe("function");
    expect(typeof handle.inspect).toBe("function");

    stream.destroy();
  });

  it("should demux stdout/stderr in non-TTY mode", async () => {
    const stream = createMockStream();

    const mockExec = {
      start: vi.fn().mockResolvedValue(stream),
      inspect: vi.fn().mockResolvedValue({ Running: true, ExitCode: -1, Pid: 42 }),
      resize: vi.fn().mockResolvedValue(undefined),
    };

    docker.getContainer.mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockExec),
    });

    const handle = await executeInteractive(docker, "container-1", "/bin/sh", { tty: false });

    expect(handle.stdout).toBeDefined();
    expect(handle.stderr).not.toBeNull();

    stream.destroy();
  });

  it("should support resize in TTY mode", async () => {
    const stream = createMockStream();

    const mockExec = {
      start: vi.fn().mockResolvedValue(stream),
      inspect: vi.fn().mockResolvedValue({ Running: true, ExitCode: -1, Pid: 42 }),
      resize: vi.fn().mockResolvedValue(undefined),
    };

    docker.getContainer.mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockExec),
    });

    const handle = await executeInteractive(docker, "container-1", "/bin/sh", { tty: true });
    await handle.resize(120, 40);

    expect(mockExec.resize).toHaveBeenCalledWith({ w: 120, h: 40 });

    stream.destroy();
  });
});

describe("executeScript", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should write script, execute it, and clean up", async () => {
    const calls: string[][] = [];

    // Each call to exec creates a new stream
    const createStream = (exitCode: number, output = "") => {
      const stream = createMockStream();
      setTimeout(() => {
        if (output) {
          stream.write(buildFrame(1, output));
        }
        stream.end();
      }, 10);
      return stream;
    };

    let callIndex = 0;
    docker.getContainer.mockReturnValue({
      exec: vi.fn().mockImplementation((opts: { Cmd: string[] }) => {
        calls.push(opts.Cmd);
        const idx = callIndex++;
        // 0: write script, 1: chmod, 2: execute, 3: cleanup
        const exitCode = 0;
        const output = idx === 2 ? "script output\n" : "";
        const stream = createStream(exitCode, output);
        return Promise.resolve({
          start: vi.fn().mockResolvedValue(stream),
          inspect: vi.fn().mockResolvedValue({ Running: false, ExitCode: exitCode, Pid: 1 }),
        });
      }),
    });

    const result = await executeScript(docker, "container-1", 'echo "hello"');

    // Should have 4 exec calls: write, chmod, execute, cleanup
    expect(calls.length).toBe(4);
    expect(result.stdout).toBe("script output\n");
    expect(result.exitCode).toBe(0);
  });
});
