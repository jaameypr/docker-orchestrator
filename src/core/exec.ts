import type Docker from "dockerode";
import { PassThrough, type Readable } from "node:stream";
import { mapDockerError } from "../errors/mapping.js";
import {
  ContainerNotFoundError,
  ContainerNotRunningError,
  CommandFailedError,
  CommandTimeoutError,
} from "../errors/base.js";
import {
  ExecOptionsSchema,
  SimpleExecOptionsSchema,
  InteractiveExecOptionsSchema,
  type ExecOptions,
  type ExecResult,
  type ExecInspectResult,
  type SimpleExecOptions,
  type InteractiveExecOptions,
  type InteractiveExecHandle,
} from "../types/exec.js";
import { demuxStream } from "../utils/stream-parser.js";

/**
 * Creates an exec instance in a running container.
 * Returns the exec instance for starting.
 */
export async function createExec(
  docker: Docker,
  containerId: string,
  options: ExecOptions,
): Promise<Docker.Exec> {
  const opts = ExecOptionsSchema.parse(options);
  const container = docker.getContainer(containerId);

  try {
    const exec = await container.exec({
      Cmd: opts.cmd,
      AttachStdout: opts.attachStdout,
      AttachStderr: opts.attachStderr,
      AttachStdin: opts.attachStdin,
      Tty: opts.tty,
      Env: opts.env,
      WorkingDir: opts.workingDir,
      User: opts.user,
      Privileged: opts.privileged,
    });
    return exec;
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      throw new ContainerNotFoundError(containerId, err instanceof Error ? err : undefined);
    }
    if (error.statusCode === 409) {
      throw new ContainerNotRunningError(containerId, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err, { containerId });
  }
}

/**
 * Starts an exec instance and collects stdout/stderr output.
 * Demuxes the stream unless TTY mode is enabled.
 * Returns structured output with stdout, stderr, and exitCode.
 */
export async function startExec(
  exec: Docker.Exec,
  tty: boolean,
): Promise<ExecResult> {
  const stream = await exec.start({ hijack: true, stdin: false, Detach: false, Tty: tty });

  return new Promise<ExecResult>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    if (tty) {
      // TTY mode: single stream, no demuxing
      stream.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
    } else {
      // Non-TTY: demux into separate stdout/stderr
      const { stdout, stderr } = demuxStream(stream);

      stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });
    }

    stream.on("end", async () => {
      try {
        const inspectResult = await waitForExecCompletion(exec);
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
          stderr: Buffer.concat(stderrChunks).toString("utf-8"),
          exitCode: inspectResult.exitCode,
        });
      } catch (err) {
        reject(err);
      }
    });

    stream.on("error", (err: Error) => {
      reject(mapDockerError(err));
    });
  });
}

/**
 * Polls exec.inspect() until the exec instance is no longer running.
 * Returns the final inspect result with exit code.
 */
async function waitForExecCompletion(
  exec: Docker.Exec,
  timeoutMs = 60000,
  intervalMs = 100,
): Promise<ExecInspectResult> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const data = await exec.inspect();
    if (!data.Running) {
      return {
        exitCode: data.ExitCode ?? -1,
        running: false,
        pid: data.Pid ?? 0,
      };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new CommandTimeoutError(timeoutMs);
}

// ---------------------------------------------------------------------------
// Convenience API
// ---------------------------------------------------------------------------

/**
 * Executes a command in a running container and returns the result.
 * String commands are automatically split into arrays.
 * Throws CommandFailedError if exit code !== 0.
 */
export async function executeCommand(
  docker: Docker,
  containerId: string,
  command: string | string[],
  options?: Partial<SimpleExecOptions>,
): Promise<ExecResult> {
  const opts = SimpleExecOptionsSchema.parse(options ?? {});
  const cmd = typeof command === "string" ? splitCommand(command) : command;

  const exec = await createExec(docker, containerId, {
    cmd,
    attachStdout: true,
    attachStderr: true,
    attachStdin: false,
    tty: false,
    env: opts.env,
    workingDir: opts.workingDir,
    user: opts.user,
    privileged: false,
  });

  const resultPromise = startExec(exec, false);

  // Timeout handling
  const result = await Promise.race([
    resultPromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new CommandTimeoutError(opts.timeout)), opts.timeout),
    ),
  ]);

  if (result.exitCode !== 0) {
    throw new CommandFailedError(result.exitCode, result.stdout, result.stderr);
  }

  return result;
}

/**
 * Starts an interactive exec session with stdin/stdout streaming.
 * Returns a handle with stdin (writable), stdout (readable), and resize support.
 */
export async function executeInteractive(
  docker: Docker,
  containerId: string,
  command: string | string[],
  options?: Partial<InteractiveExecOptions>,
): Promise<InteractiveExecHandle> {
  const opts = InteractiveExecOptionsSchema.parse(options ?? {});
  const cmd = typeof command === "string" ? splitCommand(command) : command;

  const exec = await createExec(docker, containerId, {
    cmd,
    attachStdout: true,
    attachStderr: true,
    attachStdin: true,
    tty: opts.tty,
    env: opts.env,
    workingDir: opts.workingDir,
    user: opts.user,
    privileged: false,
  });

  const stream = await exec.start({ hijack: true, stdin: true, Detach: false, Tty: opts.tty });

  const stdinStream = new PassThrough();
  stdinStream.pipe(stream);

  let stdoutStream: Readable;
  let stderrStream: Readable | null;

  if (opts.tty) {
    // TTY mode: single combined stream
    stdoutStream = stream;
    stderrStream = null;
  } else {
    // Non-TTY: demux
    const demuxed = demuxStream(stream);
    stdoutStream = demuxed.stdout;
    stderrStream = demuxed.stderr;
  }

  return {
    stdin: stdinStream,
    stdout: stdoutStream,
    stderr: stderrStream,
    resize: async (width: number, height: number) => {
      await exec.resize({ w: width, h: height });
    },
    inspect: async () => {
      const data = await exec.inspect();
      return {
        exitCode: data.ExitCode ?? -1,
        running: data.Running,
        pid: data.Pid ?? 0,
      };
    },
  };
}

/**
 * Executes a script string inside a container using an interpreter.
 * Writes the script as a temp file, runs it, then cleans up.
 *
 * Requires copyBufferToContainer from files.ts — accepts it as a parameter
 * to avoid circular dependency.
 */
export async function executeScript(
  docker: Docker,
  containerId: string,
  script: string,
  interpreter = "/bin/sh",
  copyFn?: (docker: Docker, containerId: string, destPath: string, filename: string, content: Buffer | string) => Promise<void>,
): Promise<ExecResult> {
  const scriptPath = `/tmp/_docker_orch_script_${Date.now()}.sh`;

  if (copyFn) {
    await copyFn(docker, containerId, "/tmp", `_docker_orch_script_${Date.now()}.sh`, script);
  } else {
    // Fallback: use exec with heredoc to write the script
    const writeExec = await createExec(docker, containerId, {
      cmd: ["/bin/sh", "-c", `cat > ${scriptPath} << 'DOCKER_ORCH_EOF'\n${script}\nDOCKER_ORCH_EOF`],
      attachStdout: true,
      attachStderr: true,
      attachStdin: false,
      tty: false,
      privileged: false,
    });
    await startExec(writeExec, false);
  }

  try {
    // Make script executable
    const chmodExec = await createExec(docker, containerId, {
      cmd: ["/bin/sh", "-c", `chmod +x ${scriptPath}`],
      attachStdout: true,
      attachStderr: true,
      attachStdin: false,
      tty: false,
      privileged: false,
    });
    await startExec(chmodExec, false);

    // Execute the script
    const runExec = await createExec(docker, containerId, {
      cmd: [interpreter, scriptPath],
      attachStdout: true,
      attachStderr: true,
      attachStdin: false,
      tty: false,
      privileged: false,
    });
    return await startExec(runExec, false);
  } finally {
    // Cleanup: remove the temp script
    try {
      const cleanupExec = await createExec(docker, containerId, {
        cmd: ["rm", "-f", scriptPath],
        attachStdout: false,
        attachStderr: false,
        attachStdin: false,
        tty: false,
        privileged: false,
      });
      await startExec(cleanupExec, false);
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * Splits a command string into an array.
 * Handles basic quoting (single and double quotes).
 */
function splitCommand(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escape = false;

  for (const char of command) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (char === "\\" && !inSingleQuote) {
      escape = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === " " && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}
