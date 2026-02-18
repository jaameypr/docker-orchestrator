import { PassThrough, type Readable } from "node:stream";

/**
 * Docker multiplexed stream header size: 8 bytes.
 * Byte 0: stream type (0=stdin, 1=stdout, 2=stderr)
 * Bytes 1-3: reserved (zero)
 * Bytes 4-7: payload length (big-endian uint32)
 */
const HEADER_SIZE = 8;

export const enum StreamType {
  Stdin = 0,
  Stdout = 1,
  Stderr = 2,
}

export interface ParsedFrame {
  streamType: StreamType;
  payload: Buffer;
}

/**
 * Parses the 8-byte Docker multiplex stream header.
 * Returns the stream type and payload length, or null if the buffer is too small.
 */
export function parseHeader(header: Buffer): { streamType: StreamType; payloadLength: number } | null {
  if (header.length < HEADER_SIZE) {
    return null;
  }

  const streamType = header[0] as StreamType;
  const payloadLength = header.readUInt32BE(4);

  return { streamType, payloadLength };
}

/**
 * Parses a complete Docker multiplexed stream buffer into individual frames.
 * Handles multi-frame reassembly from fragmented data.
 *
 * Returns parsed frames and any remaining incomplete data.
 */
export function parseFrames(data: Buffer): { frames: ParsedFrame[]; remainder: Buffer } {
  const frames: ParsedFrame[] = [];
  let offset = 0;

  while (offset + HEADER_SIZE <= data.length) {
    const header = parseHeader(data.subarray(offset, offset + HEADER_SIZE));
    if (!header) break;

    const frameEnd = offset + HEADER_SIZE + header.payloadLength;
    if (frameEnd > data.length) {
      // Incomplete frame – return remainder for reassembly
      break;
    }

    frames.push({
      streamType: header.streamType,
      payload: data.subarray(offset + HEADER_SIZE, frameEnd),
    });

    offset = frameEnd;
  }

  return { frames, remainder: data.subarray(offset) };
}

export interface DemuxedStreams {
  stdout: Readable;
  stderr: Readable;
}

/**
 * Demultiplexes a Docker container stream into separate stdout and stderr streams.
 * Handles backpressure correctly: if a consumer is slow, the source stream is paused.
 */
export function demuxStream(source: Readable): DemuxedStreams {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let buffer = Buffer.alloc(0);

  function processBuffer(): void {
    const { frames, remainder } = parseFrames(buffer);
    buffer = Buffer.from(remainder);

    for (const frame of frames) {
      if (frame.streamType === StreamType.Stdout) {
        if (!stdout.write(frame.payload)) {
          source.pause();
          stdout.once("drain", () => source.resume());
        }
      } else if (frame.streamType === StreamType.Stderr) {
        if (!stderr.write(frame.payload)) {
          source.pause();
          stderr.once("drain", () => source.resume());
        }
      }
    }
  }

  source.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    processBuffer();
  });

  source.on("end", () => {
    // Process any final data in the buffer
    if (buffer.length > 0) {
      processBuffer();
    }
    stdout.end();
    stderr.end();
  });

  source.on("error", (err: Error) => {
    stdout.destroy(err);
    stderr.destroy(err);
  });

  return { stdout, stderr };
}

/**
 * Parses Docker RFC 3339 Nano timestamps (e.g. "2024-01-15T10:30:00.123456789Z").
 * Returns a Date object, or null for invalid/empty input.
 */
export function parseDockerTimestamp(raw: string): Date | null {
  if (!raw || raw === "0001-01-01T00:00:00Z") {
    return null;
  }

  // Docker uses RFC 3339 with nanosecond precision.
  // JavaScript Date only supports millisecond precision, so we truncate nanos.
  // Format: "2024-01-15T10:30:00.123456789Z"
  const match = raw.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match) {
    return null;
  }

  const [, dateTimePart, fracPart, tzPart] = match;
  // Truncate fractional seconds to 3 digits (milliseconds)
  const msPart = fracPart ? fracPart.slice(0, 3).padEnd(3, "0") : "000";
  const isoString = `${dateTimePart}.${msPart}${tzPart}`;

  const date = new Date(isoString);
  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

/**
 * Formats bytes into a human-readable string (e.g. "1.5 MB").
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  return `${value.toFixed(decimals)} ${units[i]}`;
}
