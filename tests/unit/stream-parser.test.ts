import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import {
  parseHeader,
  parseFrames,
  demuxStream,
  parseDockerTimestamp,
  formatBytes,
  StreamType,
} from "../../src/utils/stream-parser.js";

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

describe("parseHeader", () => {
  it("should parse a valid 8-byte header", () => {
    const header = Buffer.alloc(8);
    header[0] = 1; // stdout
    header.writeUInt32BE(42, 4);

    const result = parseHeader(header);
    expect(result).toEqual({ streamType: 1, payloadLength: 42 });
  });

  it("should return null for buffers smaller than 8 bytes", () => {
    expect(parseHeader(Buffer.alloc(7))).toBeNull();
    expect(parseHeader(Buffer.alloc(0))).toBeNull();
  });

  it("should extract stderr stream type", () => {
    const header = Buffer.alloc(8);
    header[0] = 2; // stderr
    header.writeUInt32BE(10, 4);

    const result = parseHeader(header);
    expect(result).toEqual({ streamType: 2, payloadLength: 10 });
  });

  it("should extract stdin stream type", () => {
    const header = Buffer.alloc(8);
    header[0] = 0; // stdin
    header.writeUInt32BE(5, 4);

    const result = parseHeader(header);
    expect(result).toEqual({ streamType: 0, payloadLength: 5 });
  });
});

describe("parseFrames", () => {
  it("should parse a single complete frame", () => {
    const frame = buildFrame(1, "hello world");
    const { frames, remainder } = parseFrames(frame);

    expect(frames).toHaveLength(1);
    expect(frames[0].streamType).toBe(StreamType.Stdout);
    expect(frames[0].payload.toString("utf8")).toBe("hello world");
    expect(remainder.length).toBe(0);
  });

  it("should parse multiple frames", () => {
    const frame1 = buildFrame(1, "stdout line");
    const frame2 = buildFrame(2, "stderr line");
    const combined = Buffer.concat([frame1, frame2]);

    const { frames, remainder } = parseFrames(combined);

    expect(frames).toHaveLength(2);
    expect(frames[0].streamType).toBe(StreamType.Stdout);
    expect(frames[0].payload.toString("utf8")).toBe("stdout line");
    expect(frames[1].streamType).toBe(StreamType.Stderr);
    expect(frames[1].payload.toString("utf8")).toBe("stderr line");
    expect(remainder.length).toBe(0);
  });

  it("should return remainder for truncated header", () => {
    const partialHeader = Buffer.alloc(5); // less than 8 bytes
    const { frames, remainder } = parseFrames(partialHeader);

    expect(frames).toHaveLength(0);
    expect(remainder.length).toBe(5);
  });

  it("should return remainder for incomplete frame payload", () => {
    const header = Buffer.alloc(8);
    header[0] = 1;
    header.writeUInt32BE(100, 4); // payload says 100 bytes
    const partialPayload = Buffer.from("short");
    const data = Buffer.concat([header, partialPayload]);

    const { frames, remainder } = parseFrames(data);

    expect(frames).toHaveLength(0);
    expect(remainder.length).toBe(data.length);
  });

  it("should handle empty frames (zero-length payload)", () => {
    const frame = buildFrame(1, "");
    const { frames, remainder } = parseFrames(frame);

    expect(frames).toHaveLength(1);
    expect(frames[0].payload.length).toBe(0);
    expect(remainder.length).toBe(0);
  });

  it("should handle multi-frame reassembly from fragmented data", () => {
    const frame1 = buildFrame(1, "first");
    const frame2 = buildFrame(2, "second");
    const combined = Buffer.concat([frame1, frame2]);

    // Simulate fragmentation: first call gets partial data
    const fragment1 = combined.subarray(0, frame1.length + 5);
    const fragment2 = combined.subarray(frame1.length + 5);

    // First fragment: complete first frame + partial second
    const result1 = parseFrames(Buffer.from(fragment1));
    expect(result1.frames).toHaveLength(1);
    expect(result1.frames[0].payload.toString("utf8")).toBe("first");
    expect(result1.remainder.length).toBe(5);

    // Reassemble with next fragment
    const reassembled = Buffer.concat([result1.remainder, fragment2]);
    const result2 = parseFrames(reassembled);
    expect(result2.frames).toHaveLength(1);
    expect(result2.frames[0].payload.toString("utf8")).toBe("second");
    expect(result2.remainder.length).toBe(0);
  });

  it("should handle very large payloads", () => {
    const largePayload = "x".repeat(65536);
    const frame = buildFrame(1, largePayload);
    const { frames, remainder } = parseFrames(frame);

    expect(frames).toHaveLength(1);
    expect(frames[0].payload.length).toBe(65536);
    expect(remainder.length).toBe(0);
  });
});

describe("demuxStream", () => {
  it("should separate stdout and stderr into different streams", async () => {
    const source = new PassThrough();
    const { stdout, stderr } = demuxStream(source);

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk.toString()));
    stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk.toString()));

    const frame1 = buildFrame(1, "out1");
    const frame2 = buildFrame(2, "err1");
    const frame3 = buildFrame(1, "out2");

    source.write(Buffer.concat([frame1, frame2, frame3]));
    source.end();

    await new Promise((resolve) => stdout.on("end", resolve));

    expect(stdoutChunks.join("")).toBe("out1out2");
    expect(stderrChunks.join("")).toBe("err1");
  });

  it("should end both streams when source ends", async () => {
    const source = new PassThrough();
    const { stdout, stderr } = demuxStream(source);

    let stdoutEnded = false;
    let stderrEnded = false;

    stdout.on("end", () => { stdoutEnded = true; });
    stderr.on("end", () => { stderrEnded = true; });

    // Drain data events
    stdout.resume();
    stderr.resume();

    source.end();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(stdoutEnded).toBe(true);
    expect(stderrEnded).toBe(true);
  });

  it("should propagate errors from source to both output streams", async () => {
    const source = new PassThrough();
    const { stdout, stderr } = demuxStream(source);

    const errors: Error[] = [];
    stdout.on("error", (err) => errors.push(err));
    stderr.on("error", (err) => errors.push(err));

    const testError = new Error("test error");
    source.destroy(testError);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(errors).toHaveLength(2);
    expect(errors[0].message).toBe("test error");
    expect(errors[1].message).toBe("test error");
  });
});

describe("parseDockerTimestamp", () => {
  it("should parse standard RFC 3339 timestamps", () => {
    const date = parseDockerTimestamp("2024-01-15T10:30:00Z");
    expect(date).toBeInstanceOf(Date);
    expect(date!.toISOString()).toBe("2024-01-15T10:30:00.000Z");
  });

  it("should parse timestamps with nanosecond precision", () => {
    const date = parseDockerTimestamp("2024-01-15T10:30:00.123456789Z");
    expect(date).toBeInstanceOf(Date);
    // Should truncate to milliseconds
    expect(date!.getMilliseconds()).toBe(123);
  });

  it("should parse timestamps with millisecond precision", () => {
    const date = parseDockerTimestamp("2024-06-20T14:30:45.500Z");
    expect(date).toBeInstanceOf(Date);
    expect(date!.getMilliseconds()).toBe(500);
  });

  it("should parse timestamps with timezone offsets", () => {
    const date = parseDockerTimestamp("2024-01-15T10:30:00+02:00");
    expect(date).toBeInstanceOf(Date);
    expect(date).not.toBeNull();
  });

  it("should return null for Docker zero-value timestamps", () => {
    expect(parseDockerTimestamp("0001-01-01T00:00:00Z")).toBeNull();
  });

  it("should return null for empty strings", () => {
    expect(parseDockerTimestamp("")).toBeNull();
  });

  it("should return null for invalid timestamps", () => {
    expect(parseDockerTimestamp("not-a-date")).toBeNull();
    expect(parseDockerTimestamp("2024-13-01T00:00:00Z")).toBeNull();
  });
});

describe("formatBytes", () => {
  it("should format zero bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("should format bytes", () => {
    expect(formatBytes(500)).toBe("500.00 B");
  });

  it("should format kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(1536)).toBe("1.50 KB");
  });

  it("should format megabytes", () => {
    expect(formatBytes(1048576)).toBe("1.00 MB");
  });

  it("should format gigabytes", () => {
    expect(formatBytes(1073741824)).toBe("1.00 GB");
  });

  it("should respect custom decimal places", () => {
    expect(formatBytes(1536, 1)).toBe("1.5 KB");
    expect(formatBytes(1536, 0)).toBe("2 KB");
  });
});
