import { describe, it, expect, vi, beforeEach } from "vitest";
import { PassThrough } from "node:stream";
import {
  getContainerLogs,
  tailLogs,
  streamLogs,
} from "../../src/monitoring/logs.js";
import { ContainerNotFoundError } from "../../src/errors/base.js";
import type { LogEntry } from "../../src/types/logs.js";
import type Docker from "dockerode";

/**
 * Helper to build a Docker multiplexed stream frame.
 */
function buildFrame(streamType: number, payload: string): Buffer {
  const payloadBuf = Buffer.from(payload, "utf8");
  const header = Buffer.alloc(8);
  header[0] = streamType;
  header.writeUInt32BE(payloadBuf.length, 4);
  return Buffer.concat([header, payloadBuf]);
}

function createMockDocker() {
  return {
    getContainer: vi.fn(),
  } as unknown as Docker & {
    getContainer: ReturnType<typeof vi.fn>;
  };
}

describe("getContainerLogs (one-shot)", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should return parsed log entries from stdout", async () => {
    const stream = new PassThrough();
    docker.getContainer.mockReturnValue({
      logs: vi.fn().mockResolvedValue(stream),
    });

    const resultPromise = getContainerLogs(docker, "abc123", {
      follow: false,
      stdout: true,
      stderr: true,
    });

    // Write frames and end
    stream.write(buildFrame(1, "hello from stdout\n"));
    stream.write(buildFrame(2, "hello from stderr\n"));
    stream.end();

    const entries = (await resultPromise) as LogEntry[];
    expect(entries).toHaveLength(2);
    expect(entries[0].stream).toBe("stdout");
    expect(entries[0].message).toBe("hello from stdout");
    expect(entries[1].stream).toBe("stderr");
    expect(entries[1].message).toBe("hello from stderr");
  });

  it("should filter out stderr when stderr=false", async () => {
    const stream = new PassThrough();
    docker.getContainer.mockReturnValue({
      logs: vi.fn().mockResolvedValue(stream),
    });

    const resultPromise = getContainerLogs(docker, "abc123", {
      follow: false,
      stdout: true,
      stderr: false,
    });

    stream.write(buildFrame(1, "stdout line\n"));
    stream.write(buildFrame(2, "stderr line\n"));
    stream.end();

    const entries = (await resultPromise) as LogEntry[];
    expect(entries).toHaveLength(1);
    expect(entries[0].stream).toBe("stdout");
  });

  it("should parse timestamps when timestamps=true", async () => {
    const stream = new PassThrough();
    docker.getContainer.mockReturnValue({
      logs: vi.fn().mockResolvedValue(stream),
    });

    const resultPromise = getContainerLogs(docker, "abc123", {
      follow: false,
      timestamps: true,
    });

    stream.write(buildFrame(1, "2024-01-15T10:30:00.123456789Z my log message\n"));
    stream.end();

    const entries = (await resultPromise) as LogEntry[];
    expect(entries).toHaveLength(1);
    expect(entries[0].timestamp).toBeInstanceOf(Date);
    expect(entries[0].message).toBe("my log message");
  });

  it("should throw ContainerNotFoundError for missing container", async () => {
    docker.getContainer.mockReturnValue({
      logs: vi.fn().mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 })),
    });

    await expect(
      getContainerLogs(docker, "nonexistent", { follow: false }),
    ).rejects.toThrow(ContainerNotFoundError);
  });

  it("should only return last N lines with tail option", async () => {
    const stream = new PassThrough();
    const logsFn = vi.fn().mockResolvedValue(stream);
    docker.getContainer.mockReturnValue({ logs: logsFn });

    const resultPromise = getContainerLogs(docker, "abc123", {
      follow: false,
      tail: 5,
    });

    stream.write(buildFrame(1, "line 1\n"));
    stream.end();

    await resultPromise;

    // Verify tail was passed to Docker API
    expect(logsFn).toHaveBeenCalledWith(
      expect.objectContaining({ tail: "5" }),
    );
  });
});

describe("getContainerLogs (follow mode)", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should return a LogStream in follow mode", async () => {
    const stream = new PassThrough();
    docker.getContainer.mockReturnValue({
      logs: vi.fn().mockResolvedValue(stream),
      inspect: vi.fn().mockResolvedValue({ State: { Running: false } }),
    });

    const logStream = await getContainerLogs(docker, "abc123", {
      follow: true,
    });

    expect(logStream).toHaveProperty("stop");
    expect(logStream).toHaveProperty("on");

    // Emit data
    const entries: LogEntry[] = [];
    (logStream as { on: (event: string, cb: (entry: LogEntry) => void) => void }).on("data", (entry: LogEntry) => {
      entries.push(entry);
    });

    stream.write(buildFrame(1, "live log\n"));

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe("live log");

    (logStream as { stop: () => void }).stop();
  });

  it("should stop emitting after stop() is called", async () => {
    const stream = new PassThrough();
    docker.getContainer.mockReturnValue({
      logs: vi.fn().mockResolvedValue(stream),
      inspect: vi.fn().mockResolvedValue({ State: { Running: false } }),
    });

    const logStream = await getContainerLogs(docker, "abc123", {
      follow: true,
    });

    const entries: LogEntry[] = [];
    (logStream as { on: (event: string, cb: (entry: LogEntry) => void) => void }).on("data", (entry: LogEntry) => {
      entries.push(entry);
    });

    stream.write(buildFrame(1, "before stop\n"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    (logStream as { stop: () => void }).stop();

    stream.write(buildFrame(1, "after stop\n"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe("before stop");
  });
});

describe("tailLogs", () => {
  it("should return log entries with timestamps", async () => {
    const docker = createMockDocker();
    const stream = new PassThrough();
    docker.getContainer.mockReturnValue({
      logs: vi.fn().mockResolvedValue(stream),
    });

    const resultPromise = tailLogs(docker, "abc123", 10);

    stream.write(buildFrame(1, "2024-01-15T10:30:00Z tail entry\n"));
    stream.end();

    const entries = await resultPromise;
    expect(entries).toHaveLength(1);
    expect(entries[0].timestamp).toBeInstanceOf(Date);
  });
});

describe("streamLogs", () => {
  it("should return a LogStream with follow mode", async () => {
    const docker = createMockDocker();
    const stream = new PassThrough();
    docker.getContainer.mockReturnValue({
      logs: vi.fn().mockResolvedValue(stream),
      inspect: vi.fn().mockResolvedValue({ State: { Running: false } }),
    });

    const logStream = await streamLogs(docker, "abc123");
    expect(logStream).toHaveProperty("stop");
    (logStream as { stop: () => void }).stop();
  });
});
