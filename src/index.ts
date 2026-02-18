// Core
export { createClient } from "./core/client.js";
export type { CreateClientResult } from "./core/client.js";
export { imageExists, pullImage, listImages, removeImage } from "./core/image.js";
export {
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
  inspectContainer,
  listContainers,
} from "./core/container.js";

// Builders
export { buildContainerConfig, ContainerConfigSchema } from "./builders/config-builder.js";
export type { ContainerConfig } from "./builders/config-builder.js";

// Errors
export {
  DockerOrchestratorError,
  ConnectionError,
  ContainerNotFoundError,
  ImageNotFoundError,
  ContainerAlreadyRunningError,
  ContainerAlreadyStoppedError,
  mapDockerError,
} from "./errors/index.js";

// Monitoring – Logs
export { getContainerLogs, tailLogs, streamLogs } from "./monitoring/logs.js";

// Monitoring – Metrics
export {
  getMetrics,
  streamMetrics,
  calculateCpu,
  calculateMemory,
  calculateNetwork,
  calculateBlockIO,
  computeMetrics,
} from "./monitoring/metrics.js";

// Monitoring – Events
export { subscribeEvents } from "./monitoring/events.js";

// Utils
export {
  parseHeader,
  parseFrames,
  demuxStream,
  parseDockerTimestamp,
  formatBytes,
  StreamType,
} from "./utils/stream-parser.js";

// Types – Core
export type {
  ClientOptions,
  DockerVersionInfo,
  PullProgressEvent,
  PullProgressCallback,
  ImageInfo,
  ContainerInfo,
  ContainerInspectResult,
} from "./types/index.js";
export { ClientOptionsSchema } from "./types/index.js";

// Types – Logs
export type { LogOptions, LogEntry, LogStream, LogStreamEvents } from "./types/logs.js";
export { LogOptionsSchema } from "./types/logs.js";

// Types – Metrics
export type {
  CpuMetrics,
  MemoryMetrics,
  NetworkMetrics,
  BlockIOMetrics,
  ContainerMetrics,
  MetricsStream,
  MetricsStreamEvents,
  DockerStatsRaw,
} from "./types/metrics.js";

// Types – Events
export type {
  DockerEventType,
  EventFilter,
  DockerEventActor,
  DockerEvent,
  DockerEventStreamEvents,
  EventSubscription,
} from "./types/events.js";
export { EventFilterSchema } from "./types/events.js";
