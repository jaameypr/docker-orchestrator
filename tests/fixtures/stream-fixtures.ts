/**
 * Stream fixture data for testing Docker log parsing, event streams, and stats streams.
 */
import { StreamType } from "../../src/utils/stream-parser.js";

// ---------------------------------------------------------------------------
// Log Stream Fixtures (Docker multiplexed 8-byte header format)
// ---------------------------------------------------------------------------

/**
 * Creates a Docker multiplexed stream frame buffer.
 */
function makeFrame(streamType: StreamType, payload: string): Buffer {
  const payloadBuf = Buffer.from(payload);
  const header = Buffer.alloc(8);
  header[0] = streamType;
  header.writeUInt32BE(payloadBuf.length, 4);
  return Buffer.concat([header, payloadBuf]);
}

/** Simple stdout-only log output. */
export const simpleStdoutLog = makeFrame(StreamType.Stdout, "Hello, World!\n");

/** Simple stderr-only log output. */
export const simpleStderrLog = makeFrame(StreamType.Stderr, "Error: something failed\n");

/** Mixed stdout and stderr frames. */
export const mixedStdoutStderrLog = Buffer.concat([
  makeFrame(StreamType.Stdout, "Starting application...\n"),
  makeFrame(StreamType.Stderr, "Warning: deprecated API usage\n"),
  makeFrame(StreamType.Stdout, "Server listening on port 8080\n"),
  makeFrame(StreamType.Stderr, "Error: failed to connect to database\n"),
  makeFrame(StreamType.Stdout, "Retrying connection...\n"),
]);

/** Log output with Docker timestamps. */
export const timestampedLog = Buffer.concat([
  makeFrame(StreamType.Stdout, "2024-01-15T10:30:00.123456789Z Starting application...\n"),
  makeFrame(StreamType.Stdout, "2024-01-15T10:30:01.000000000Z Server listening on port 8080\n"),
  makeFrame(StreamType.Stderr, "2024-01-15T10:30:02.500000000Z Warning: high memory usage\n"),
]);

/** Large log output (multiple frames). */
export const largeLogOutput = Buffer.concat(
  Array.from({ length: 100 }, (_, i) =>
    makeFrame(StreamType.Stdout, `Log line ${i + 1}: ${Array(50).fill("x").join("")}\n`),
  ),
);

/** Empty log output (no frames). */
export const emptyLogOutput = Buffer.alloc(0);

/** Fragmented frame: header without complete payload (for testing reassembly). */
export function createFragmentedFrames(): {
  fragment1: Buffer;
  fragment2: Buffer;
  complete: Buffer;
} {
  const payload = "This is a fragmented message\n";
  const complete = makeFrame(StreamType.Stdout, payload);

  // Split at an arbitrary point inside the payload
  const splitPoint = 12; // Middle of the header+payload
  return {
    fragment1: complete.subarray(0, splitPoint),
    fragment2: complete.subarray(splitPoint),
    complete,
  };
}

/** Frame with zero-length payload. */
export const zeroLengthFrame = makeFrame(StreamType.Stdout, "");

// ---------------------------------------------------------------------------
// Event Stream Fixtures (JSON lines)
// ---------------------------------------------------------------------------

/** Container start event. */
export const containerStartEvent = JSON.stringify({
  Type: "container",
  Action: "start",
  Actor: {
    ID: "abc123",
    Attributes: { name: "test-container", image: "alpine:latest" },
  },
  time: 1705312200,
  timeNano: 1705312200000000000,
});

/** Container stop event. */
export const containerStopEvent = JSON.stringify({
  Type: "container",
  Action: "stop",
  Actor: {
    ID: "abc123",
    Attributes: { name: "test-container", image: "alpine:latest" },
  },
  time: 1705312260,
  timeNano: 1705312260000000000,
});

/** Container die event. */
export const containerDieEvent = JSON.stringify({
  Type: "container",
  Action: "die",
  Actor: {
    ID: "abc123",
    Attributes: {
      name: "test-container",
      image: "alpine:latest",
      exitCode: "0",
    },
  },
  time: 1705312260,
  timeNano: 1705312260000000000,
});

/** Image pull event. */
export const imagePullEvent = JSON.stringify({
  Type: "image",
  Action: "pull",
  Actor: {
    ID: "sha256:abc123",
    Attributes: { name: "alpine:latest" },
  },
  time: 1705312100,
  timeNano: 1705312100000000000,
});

/** Network create event. */
export const networkCreateEvent = JSON.stringify({
  Type: "network",
  Action: "create",
  Actor: {
    ID: "net123",
    Attributes: { name: "test-network", type: "bridge" },
  },
  time: 1705312300,
  timeNano: 1705312300000000000,
});

/** Volume create event. */
export const volumeCreateEvent = JSON.stringify({
  Type: "volume",
  Action: "create",
  Actor: {
    ID: "vol123",
    Attributes: { driver: "local" },
  },
  time: 1705312400,
  timeNano: 1705312400000000000,
});

/** Multiple events as a newline-delimited stream. */
export const multipleEventsStream =
  [containerStartEvent, containerStopEvent, containerDieEvent].join("\n") + "\n";

/** Health status event. */
export const healthStatusEvent = JSON.stringify({
  Type: "container",
  Action: "health_status",
  Actor: {
    ID: "abc123",
    Attributes: {
      name: "test-container",
      image: "alpine:latest",
      health_status: "healthy",
    },
  },
  time: 1705312500,
  timeNano: 1705312500000000000,
});

// ---------------------------------------------------------------------------
// Stats Stream Fixtures (JSON lines)
// ---------------------------------------------------------------------------

/** Stats snapshot 1 (baseline). */
export const statsSnapshot1 = JSON.stringify({
  read: "2024-01-15T10:30:00.000000000Z",
  cpu_stats: {
    cpu_usage: { total_usage: 100000000, percpu_usage: [50000000, 50000000] },
    system_cpu_usage: 1000000000,
    online_cpus: 2,
  },
  precpu_stats: {
    cpu_usage: { total_usage: 50000000, percpu_usage: [25000000, 25000000] },
    system_cpu_usage: 500000000,
    online_cpus: 2,
  },
  memory_stats: {
    usage: 52428800,
    limit: 1073741824,
    stats: { cache: 5242880, inactive_file: 0 },
  },
  networks: {
    eth0: {
      rx_bytes: 1000,
      tx_bytes: 500,
      rx_packets: 10,
      tx_packets: 5,
      rx_errors: 0,
      tx_errors: 0,
      rx_dropped: 0,
      tx_dropped: 0,
    },
  },
  blkio_stats: {
    io_service_bytes_recursive: [
      { op: "Read", value: 512000 },
      { op: "Write", value: 256000 },
    ],
  },
});

/** Stats snapshot 2 (higher CPU, more network). */
export const statsSnapshot2 = JSON.stringify({
  read: "2024-01-15T10:30:01.000000000Z",
  cpu_stats: {
    cpu_usage: { total_usage: 300000000, percpu_usage: [150000000, 150000000] },
    system_cpu_usage: 2000000000,
    online_cpus: 2,
  },
  precpu_stats: {
    cpu_usage: { total_usage: 100000000, percpu_usage: [50000000, 50000000] },
    system_cpu_usage: 1000000000,
    online_cpus: 2,
  },
  memory_stats: {
    usage: 78643200,
    limit: 1073741824,
    stats: { cache: 5242880, inactive_file: 0 },
  },
  networks: {
    eth0: {
      rx_bytes: 5000,
      tx_bytes: 3000,
      rx_packets: 50,
      tx_packets: 30,
      rx_errors: 0,
      tx_errors: 0,
      rx_dropped: 0,
      tx_dropped: 0,
    },
  },
  blkio_stats: {
    io_service_bytes_recursive: [
      { op: "Read", value: 1024000 },
      { op: "Write", value: 512000 },
    ],
  },
});

/** Multiple stats snapshots as a newline-delimited stream. */
export const multipleStatsStream = [statsSnapshot1, statsSnapshot2].join("\n") + "\n";
