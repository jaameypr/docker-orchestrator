/**
 * Mock stream utilities for testing Docker stream operations.
 * Provides helpers for creating simulated Readable/Writable streams
 * including Docker's multiplexed stream format.
 */
import { PassThrough, Readable, Writable } from "node:stream";
import { StreamType } from "../../src/utils/stream-parser.js";

/**
 * Creates a simulated readable stream that can be controlled in tests.
 * Use .push() to emit data and .push(null) to end the stream.
 */
export function createMockReadableStream(): PassThrough {
  return new PassThrough();
}

/**
 * Creates a simulated writable stream that collects all written data.
 * Access collected data via .chunks or the full buffer via .getBuffer().
 */
export function createMockWritableStream(): Writable & {
  chunks: Buffer[];
  getBuffer: () => Buffer;
  getString: () => string;
} {
  const chunks: Buffer[] = [];

  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  }) as Writable & {
    chunks: Buffer[];
    getBuffer: () => Buffer;
    getString: () => string;
  };

  stream.chunks = chunks;
  stream.getBuffer = () => Buffer.concat(chunks);
  stream.getString = () => Buffer.concat(chunks).toString("utf8");

  return stream;
}

/**
 * Creates a Docker multiplexed stream frame (8-byte header + payload).
 *
 * Docker multiplexed stream header format:
 * - Byte 0: stream type (0=stdin, 1=stdout, 2=stderr)
 * - Bytes 1-3: reserved (zero)
 * - Bytes 4-7: payload length (big-endian uint32)
 */
export function createMultiplexedFrame(streamType: StreamType, payload: string | Buffer): Buffer {
  const payloadBuf = typeof payload === "string" ? Buffer.from(payload) : payload;
  const header = Buffer.alloc(8);
  header[0] = streamType;
  header.writeUInt32BE(payloadBuf.length, 4);
  return Buffer.concat([header, payloadBuf]);
}

/**
 * Creates a Docker multiplexed stream with multiple frames.
 * Useful for simulating log output with both stdout and stderr.
 */
export function createMultiplexedStream(frames: Array<{ type: StreamType; data: string }>): Buffer {
  const buffers = frames.map((f) => createMultiplexedFrame(f.type, f.data));
  return Buffer.concat(buffers);
}

/**
 * Creates a readable stream that emits Docker multiplexed frames.
 * Each frame is pushed with a small delay to simulate streaming.
 */
export function createMockLogStream(
  entries: Array<{ type: "stdout" | "stderr"; message: string; timestamp?: string }>,
  options: { delayMs?: number } = {},
): PassThrough {
  const stream = new PassThrough();
  const { delayMs = 0 } = options;

  // Push frames asynchronously
  (async () => {
    for (const entry of entries) {
      const streamType = entry.type === "stdout" ? StreamType.Stdout : StreamType.Stderr;
      const line = entry.timestamp ? `${entry.timestamp} ${entry.message}\n` : `${entry.message}\n`;
      const frame = createMultiplexedFrame(streamType, line);

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      if (!stream.destroyed) {
        stream.write(frame);
      }
    }

    if (!stream.destroyed) {
      stream.end();
    }
  })();

  return stream;
}

/**
 * Creates a readable stream that emits raw JSON objects line-by-line.
 * Useful for simulating Docker stats or events streams.
 */
export function createMockJsonStream(
  objects: unknown[],
  options: { delayMs?: number } = {},
): PassThrough {
  const stream = new PassThrough();
  const { delayMs = 0 } = options;

  (async () => {
    for (const obj of objects) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      if (!stream.destroyed) {
        stream.write(JSON.stringify(obj) + "\n");
      }
    }

    if (!stream.destroyed) {
      stream.end();
    }
  })();

  return stream;
}

/**
 * Creates a readable stream that errors after emitting some data.
 */
export function createErrorStream(
  error: Error,
  options: { dataBeforeError?: Buffer; delayMs?: number } = {},
): Readable {
  const { dataBeforeError, delayMs = 10 } = options;

  const stream = new PassThrough();

  setTimeout(() => {
    if (dataBeforeError && !stream.destroyed) {
      stream.write(dataBeforeError);
    }
    if (!stream.destroyed) {
      stream.destroy(error);
    }
  }, delayMs);

  return stream;
}

/**
 * Collects all data from a readable stream into a single buffer.
 */
export function collectStreamData(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/**
 * Waits for a stream to emit a specific number of events.
 */
export function waitForStreamEvents<T>(
  stream: { on: (event: string, cb: (data: T) => void) => void },
  eventName: string,
  count: number,
  timeoutMs = 5000,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const collected: T[] = [];
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timeout waiting for ${count} "${eventName}" events (received ${collected.length})`,
        ),
      );
    }, timeoutMs);

    stream.on(eventName, (data: T) => {
      collected.push(data);
      if (collected.length >= count) {
        clearTimeout(timer);
        resolve(collected);
      }
    });
  });
}
