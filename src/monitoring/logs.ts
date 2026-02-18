import type Docker from "dockerode";
import EventEmitter from "eventemitter3";
import { ContainerNotFoundError } from "../errors/base.js";
import { mapDockerError } from "../errors/mapping.js";
import { parseFrames, StreamType, parseDockerTimestamp } from "../utils/stream-parser.js";
import {
  LogOptionsSchema,
  type LogOptions,
  type LogEntry,
  type LogStream,
  type LogStreamEvents,
} from "../types/logs.js";

/**
 * Converts a Date or Unix timestamp to seconds since epoch.
 */
function toUnixSeconds(value: Date | number): number {
  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }
  return value;
}

/**
 * Parses a raw line of Docker log output into a LogEntry.
 * If timestamps are enabled, the line starts with an RFC 3339 timestamp followed by a space.
 */
function parseLogLine(
  line: string,
  streamName: "stdout" | "stderr",
  hasTimestamps: boolean,
): LogEntry {
  if (!hasTimestamps) {
    return { stream: streamName, timestamp: null, message: line };
  }

  // Timestamp format: "2024-01-15T10:30:00.123456789Z message..."
  const spaceIdx = line.indexOf(" ");
  if (spaceIdx === -1) {
    return { stream: streamName, timestamp: null, message: line };
  }

  const rawTimestamp = line.slice(0, spaceIdx);
  const message = line.slice(spaceIdx + 1);
  const timestamp = parseDockerTimestamp(rawTimestamp);

  return { stream: streamName, timestamp, message };
}

function destroyStream(stream: NodeJS.ReadableStream): void {
  const s = stream as unknown as { destroy?: () => void };
  if (typeof s.destroy === "function") {
    s.destroy();
  }
}

/**
 * Calls container.logs() with the given options, working around Dockerode's
 * discriminated-union overloads by casting through unknown.
 */
async function containerLogs(
  container: ReturnType<Docker["getContainer"]>,
  opts: Record<string, unknown>,
): Promise<NodeJS.ReadableStream> {
  // Dockerode overloads discriminate on `follow` literal type.
  // We cast through unknown to call the general signature.
  const fn = container.logs.bind(container) as unknown as (
    opts: Record<string, unknown>,
  ) => Promise<NodeJS.ReadableStream>;
  return fn(opts);
}

/**
 * Retrieves container logs as structured LogEntry objects.
 * Supports both one-shot retrieval and streaming (follow) mode.
 */
export async function getContainerLogs(
  docker: Docker,
  containerId: string,
  options?: LogOptions,
): Promise<LogEntry[] | LogStream> {
  const opts = LogOptionsSchema.parse(options ?? {});
  const container = docker.getContainer(containerId);

  const dockerOpts: Record<string, unknown> = {
    follow: opts.follow,
    stdout: opts.stdout,
    stderr: opts.stderr,
    timestamps: opts.timestamps,
    tail: opts.tail === "all" ? "all" : String(opts.tail),
  };

  if (opts.since !== undefined) {
    dockerOpts.since = toUnixSeconds(opts.since);
  }
  if (opts.until !== undefined) {
    dockerOpts.until = toUnixSeconds(opts.until);
  }

  let rawStream: NodeJS.ReadableStream;
  try {
    rawStream = await containerLogs(container, dockerOpts);
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      throw new ContainerNotFoundError(containerId, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err, { containerId });
  }

  if (opts.follow) {
    return createLogStream(docker, containerId, rawStream, opts);
  }

  // One-shot mode: collect all log data and parse
  return collectLogs(rawStream, opts);
}

/**
 * Collects all log data from a non-follow stream and returns parsed entries.
 */
function collectLogs(
  rawStream: NodeJS.ReadableStream,
  opts: { timestamps: boolean; stdout: boolean; stderr: boolean },
): Promise<LogEntry[]> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    rawStream.on("data", (chunk: Buffer) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as Uint8Array));
    });

    rawStream.on("end", () => {
      const data = Buffer.concat(chunks);
      const entries = parseLogBuffer(data, opts);
      resolve(entries);
    });

    rawStream.on("error", (err: Error) => {
      reject(mapDockerError(err));
    });
  });
}

/**
 * Parses a complete log buffer using Docker's multiplexed stream format.
 */
function parseLogBuffer(
  data: Buffer,
  opts: { timestamps: boolean; stdout: boolean; stderr: boolean },
): LogEntry[] {
  const entries: LogEntry[] = [];
  const { frames } = parseFrames(data);

  for (const frame of frames) {
    const streamName = frame.streamType === StreamType.Stdout ? "stdout" : "stderr";

    if (streamName === "stdout" && !opts.stdout) continue;
    if (streamName === "stderr" && !opts.stderr) continue;

    const text = frame.payload.toString("utf8");
    const lines = text.split("\n");

    for (const line of lines) {
      if (line.length === 0) continue;
      entries.push(parseLogLine(line, streamName, opts.timestamps));
    }
  }

  return entries;
}

/**
 * Creates a live log stream with reconnect logic.
 */
function createLogStream(
  docker: Docker,
  containerId: string,
  rawStream: NodeJS.ReadableStream,
  opts: ReturnType<typeof LogOptionsSchema.parse>,
): LogStream {
  const emitter = new EventEmitter<LogStreamEvents>() as LogStream;
  let buffer = Buffer.alloc(0);
  let stopped = false;
  let lastTimestamp: Date | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let currentStream: NodeJS.ReadableStream = rawStream;

  function processBuffer(): void {
    const { frames, remainder } = parseFrames(buffer);
    buffer = Buffer.from(remainder);

    for (const frame of frames) {
      const streamName = frame.streamType === StreamType.Stdout ? "stdout" : "stderr";

      if (streamName === "stdout" && !opts.stdout) continue;
      if (streamName === "stderr" && !opts.stderr) continue;

      const text = frame.payload.toString("utf8");
      const lines = text.split("\n");

      for (const line of lines) {
        if (line.length === 0) continue;
        const entry = parseLogLine(line, streamName, opts.timestamps);
        if (entry.timestamp) {
          lastTimestamp = entry.timestamp;
        }
        emitter.emit("data", entry);
      }
    }
  }

  function attachStream(stream: NodeJS.ReadableStream): void {
    currentStream = stream;

    stream.on("data", (chunk: Buffer) => {
      if (stopped) return;
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as Uint8Array);
      buffer = Buffer.concat([buffer, incoming]);
      processBuffer();
    });

    stream.on("end", () => {
      if (stopped) {
        emitter.emit("end");
        return;
      }
      // Container may have stopped – attempt reconnect
      attemptReconnect();
    });

    stream.on("error", (err: Error) => {
      if (stopped) return;
      emitter.emit("error", err);
      attemptReconnect();
    });
  }

  async function attemptReconnect(): Promise<void> {
    if (stopped) return;

    // Check if container is still running
    try {
      const info = await docker.getContainer(containerId).inspect();
      if (!info.State.Running) {
        emitter.emit("end");
        return;
      }
    } catch {
      emitter.emit("end");
      return;
    }

    // Reconnect with since to avoid missing logs
    const reconnectOpts: Record<string, unknown> = {
      follow: true,
      stdout: opts.stdout,
      stderr: opts.stderr,
      timestamps: opts.timestamps,
      tail: "0",
    };

    if (lastTimestamp) {
      reconnectOpts.since = Math.floor(lastTimestamp.getTime() / 1000);
    }

    reconnectTimer = setTimeout(async () => {
      if (stopped) return;
      try {
        const newStream = await containerLogs(docker.getContainer(containerId), reconnectOpts);
        buffer = Buffer.alloc(0);
        attachStream(newStream);
      } catch {
        emitter.emit("end");
      }
    }, 1000);
  }

  emitter.stop = function stop(): void {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    destroyStream(currentStream);
    emitter.emit("end");
    emitter.removeAllListeners();
  };

  attachStream(rawStream);
  return emitter;
}

/**
 * Returns the last N lines of container logs.
 */
export async function tailLogs(
  docker: Docker,
  containerId: string,
  lines = 100,
): Promise<LogEntry[]> {
  const result = await getContainerLogs(docker, containerId, {
    follow: false,
    tail: lines,
    timestamps: true,
  });
  return result as LogEntry[];
}

/**
 * Opens a live log stream with sensible defaults.
 */
export async function streamLogs(docker: Docker, containerId: string): Promise<LogStream> {
  const result = await getContainerLogs(docker, containerId, {
    follow: true,
    timestamps: true,
    tail: 50,
  });
  return result as LogStream;
}
