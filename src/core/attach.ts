import type Docker from "dockerode";
import type { Duplex } from "node:stream";
import {
  ContainerNotFoundError,
  ContainerNotRunningError,
  StdinNotAvailableError,
  TimeoutError,
} from "../errors/base.js";
import { mapDockerError } from "../errors/mapping.js";
import type { AttachOptions } from "../types/attach.js";
import { demuxStream, type DemuxedStreams } from "../utils/stream-parser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AttachResult {
  /** Raw duplex stream (stdin writable, stdout/stderr readable) */
  stream: Duplex;
  /** Demuxed stdout/stderr (only available when Tty: false) */
  demuxed: DemuxedStreams | null;
  /** Whether the container uses TTY mode */
  tty: boolean;
}

// ---------------------------------------------------------------------------
// Low-Level Attach
// ---------------------------------------------------------------------------

/**
 * Attaches to a running container's stdin/stdout/stderr.
 *
 * Pre-conditions:
 * - Container must exist
 * - Container must be running
 * - If stdin is requested, container must have been created with OpenStdin: true
 *
 * Returns a raw duplex stream. If the container is non-TTY, also returns
 * demuxed stdout/stderr streams (8-byte header protocol).
 */
export async function attachContainer(
  docker: Docker,
  containerId: string,
  options?: Partial<AttachOptions>,
): Promise<AttachResult> {
  const opts: AttachOptions = {
    stdin: options?.stdin ?? true,
    stdout: options?.stdout ?? true,
    stderr: options?.stderr ?? true,
  };

  // Pre-condition checks
  const container = docker.getContainer(containerId);
  let inspectData: Record<string, unknown>;
  try {
    inspectData = (await container.inspect()) as unknown as Record<string, unknown>;
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      throw new ContainerNotFoundError(containerId, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err, { containerId });
  }

  const state = inspectData.State as { Running?: boolean } | undefined;
  if (!state?.Running) {
    throw new ContainerNotRunningError(containerId);
  }

  const config = inspectData.Config as { OpenStdin?: boolean; Tty?: boolean } | undefined;
  if (opts.stdin && !config?.OpenStdin) {
    throw new StdinNotAvailableError(containerId);
  }

  const tty = config?.Tty ?? false;

  // Attach
  const stream = (await container.attach({
    stream: true,
    hijack: true,
    stdin: opts.stdin,
    stdout: opts.stdout,
    stderr: opts.stderr,
  })) as unknown as Duplex;

  // Demux if non-TTY
  const demuxed = tty ? null : demuxStream(stream);

  return { stream, demuxed, tty };
}

// ---------------------------------------------------------------------------
// Send Command (Fire-and-Forget)
// ---------------------------------------------------------------------------

/**
 * Sends a single command to a container's stdin and closes the stream.
 * The command is terminated with a newline character.
 *
 * @param timeout - Maximum time to wait for attach (default: 5000ms)
 */
export async function sendCommand(
  docker: Docker,
  containerId: string,
  command: string,
  timeout = 5000,
): Promise<void> {
  const result = await Promise.race([
    attachContainer(docker, containerId, { stdin: true, stdout: false, stderr: false }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new TimeoutError("sendCommand", timeout)), timeout),
    ),
  ]);

  result.stream.write(command + "\n");
  result.stream.end();
}

/**
 * Sends multiple commands sequentially to a container's stdin.
 *
 * @param delayMs - Optional delay between commands (default: 0)
 * @param timeout - Maximum time to wait for attach (default: 5000ms)
 */
export async function sendCommands(
  docker: Docker,
  containerId: string,
  commands: string[],
  delayMs = 0,
  timeout = 5000,
): Promise<void> {
  const result = await Promise.race([
    attachContainer(docker, containerId, { stdin: true, stdout: false, stderr: false }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new TimeoutError("sendCommands", timeout)), timeout),
    ),
  ]);

  for (let i = 0; i < commands.length; i++) {
    result.stream.write(commands[i] + "\n");
    if (delayMs > 0 && i < commands.length - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  result.stream.end();
}
