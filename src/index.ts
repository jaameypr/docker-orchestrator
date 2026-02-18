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

// Core – Exec
export {
  createExec,
  startExec,
  executeCommand,
  executeInteractive,
  executeScript,
} from "./core/exec.js";

// Core – Files
export {
  createTarFromPath,
  createTarFromBuffer,
  extractTarToPath,
  copyToContainer,
  copyFromContainer,
  copyBufferToContainer,
  readFileFromContainer,
} from "./core/files.js";

// Core – Container Recreation
export {
  extractContainerConfig,
  mergeContainerConfig,
  recreateContainer,
} from "./core/container-recreation.js";

// Core – Network Management (Phase 4)
export {
  createNetwork,
  removeNetwork,
  inspectNetwork,
  listNetworks,
  connectContainer,
  disconnectContainer,
  pruneNetworks,
} from "./core/network.js";

// Core – Volume Management (Phase 4)
export {
  createVolume,
  removeVolume,
  inspectVolume,
  listVolumes,
  pruneVolumes,
  volumeExists,
} from "./core/volume.js";

// Core – Resource Limits (Phase 5)
export {
  parseMemoryString,
  parseCpuString,
  buildResourceHostConfig,
} from "./core/resource-limits.js";
export type { ResolvedResourceHostConfig } from "./core/resource-limits.js";

// Core – Security (Phase 5)
export {
  buildSecurityConfig,
  applySecurityPreset,
  loadSeccompProfile,
  validateCapabilities,
} from "./core/security.js";
export type { ResolvedSecurityConfig } from "./core/security.js";

// Core – Restart Policy (Phase 5)
export { buildRestartPolicy } from "./core/restart-policy.js";

// Core – Validation (Phase 5)
export {
  validateResourceLimits,
  validateSecurityConfig,
  validateRestartPolicy,
  validateProductionConfig,
  filterWarnings,
} from "./core/validation.js";

// Core – Health Check (Phase 6)
export {
  buildDockerHealthcheck,
  waitForHealthy,
  checkHttp,
  checkTcp,
  resolveHostPort,
  healthEmitter,
} from "./core/health-check.js";

// Core – Orchestrator (Phase 6)
export { Orchestrator } from "./core/orchestrator.js";

// Core – Stack (Phase 6)
export {
  resolveDependencyOrder,
  deployStack,
  destroyStack,
} from "./core/stack.js";

// Builders
export {
  buildContainerConfig,
  ContainerConfigSchema,
  CONFIG_DEFAULTS,
  diffConfigs,
  serializeConfig,
  deserializeConfig,
} from "./builders/config-builder.js";
export type { ContainerConfig, BuildContainerConfigResult } from "./builders/config-builder.js";

// Builders – Port Mapper (Phase 4)
export {
  parsePortMapping,
  parsePortMappings,
  toDockerPortConfig,
  resolvePortMappings,
  checkPortAvailable,
  validatePortAvailability,
  getAssignedPorts,
} from "./builders/port-mapper.js";

// Builders – Volume Mapper (Phase 4)
export {
  parseMount,
  parseMounts,
  validateMounts,
  toDockerBinds,
  toDockerMounts,
  resolveVolumeMounts,
} from "./builders/volume-mapper.js";

// Errors
export {
  // Types
  type ErrorCode,
  // Base
  DockerOrchestratorError,
  isDockerOrchestratorError,
  isTransientError,
  // Connection Errors
  ConnectionError,
  DockerDaemonNotRunningError,
  DockerApiVersionError,
  // Container Errors
  ContainerNotFoundError,
  ContainerNotRunningError,
  ContainerAlreadyRunningError,
  ContainerAlreadyStoppedError,
  ContainerAlreadyExistsError,
  // Image Errors
  ImageNotFoundError,
  ImagePullError,
  // Resource Errors
  PortAlreadyInUseError,
  InsufficientResourcesError,
  OOMKilledError,
  VolumeInUseError,
  // Operation Errors
  CommandFailedError,
  CommandTimeoutError,
  HealthCheckTimeoutError,
  DeploymentFailedError,
  RecreationFailedError,
  CriticalRecreationError,
  UpdateFailedError,
  BatchOperationError,
  TimeoutError,
  CircuitOpenError,
  // Config Errors
  ValidationError,
  InvalidResourceConfigError,
  InvalidSecurityConfigError,
  InvalidMountError,
  InvalidSubnetError,
  // Network Errors
  NetworkNotFoundError,
  NetworkAlreadyExistsError,
  ContainerStillConnectedError,
  // Volume Errors
  VolumeNotFoundError,
  VolumeAlreadyExistsError,
  // Other Errors
  FileNotFoundError,
  PermissionError,
  SeccompProfileNotFoundError,
  DependencyResolutionError,
  DockerInternalError,
  // Mapping
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

// Utils – Retry (Phase 7)
export { retry, calculateDelay, DEFAULT_RETRY_POLICIES } from "./utils/retry.js";
export type { RetryOptions, RetryPolicy, RetryPolicies } from "./utils/retry.js";

// Utils – Circuit Breaker (Phase 7)
export { CircuitBreaker } from "./utils/circuit-breaker.js";
export type {
  CircuitState,
  CircuitBreakerOptions,
  CircuitBreakerEvents,
} from "./utils/circuit-breaker.js";

// Utils – Timeout (Phase 7)
export { withTimeout, DEFAULT_TIMEOUTS } from "./utils/timeout.js";
export type { TimeoutConfig } from "./utils/timeout.js";

// Utils – Logger (Phase 7)
export {
  ConsoleLogger,
  NoopLogger,
  createLogger,
  redactSensitiveData,
} from "./utils/logger.js";
export type { Logger, LogLevel, LogContext, ConsoleLoggerOptions } from "./utils/logger.js";

// Utils – Daemon Monitor (Phase 7)
export { DaemonMonitor } from "./utils/daemon-monitor.js";
export type {
  DaemonState,
  DaemonMonitorOptions,
  DaemonMonitorEvents,
} from "./utils/daemon-monitor.js";

// Utils – Resilient Stream (Phase 7)
export { ResilientStream } from "./utils/resilient-stream.js";
export type {
  ResilientStreamOptions,
  StreamHealthMetrics,
  ResilientStreamEvents,
} from "./utils/resilient-stream.js";

// Utils – Shutdown (Phase 7)
export { ShutdownManager } from "./utils/shutdown.js";
export type { ShutdownOptions, CleanupCallback } from "./utils/shutdown.js";

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

// Types – Exec
export type {
  ExecOptions,
  ExecResult,
  ExecInspectResult,
  InteractiveExecHandle,
  SimpleExecOptions,
  InteractiveExecOptions,
} from "./types/exec.js";
export { ExecOptionsSchema, SimpleExecOptionsSchema, InteractiveExecOptionsSchema } from "./types/exec.js";

// Types – Files
export type {
  CopyToContainerOptions,
  CopyFromContainerOptions,
} from "./types/files.js";
export { CopyToContainerOptionsSchema, CopyFromContainerOptionsSchema } from "./types/files.js";

// Types – Recreation
export type {
  ExtractedContainerConfig,
  RecreationOptions,
  RecreationResult,
  RollbackStatus,
} from "./types/recreation.js";
export { RecreationOptionsSchema } from "./types/recreation.js";

// Types – Network (Phase 4)
export type {
  NetworkCreateOptions,
  ConnectOptions,
  NetworkInfo,
  NetworkContainerInfo,
  NetworkListFilter,
} from "./types/network.js";
export { NetworkCreateOptionsSchema, ConnectOptionsSchema } from "./types/network.js";

// Types – Volume (Phase 4)
export type {
  VolumeCreateOptions,
  VolumeInfo,
  VolumeListFilter,
  PruneVolumesResult,
} from "./types/volume.js";
export { VolumeCreateOptionsSchema } from "./types/volume.js";

// Types – Ports (Phase 4)
export type {
  PortMappingInput,
  ResolvedPortMapping,
  DockerPortConfig,
  AssignedPort,
} from "./types/ports.js";
export { PortMappingInputSchema } from "./types/ports.js";

// Types – Mounts (Phase 4)
export type {
  MountInput,
  ResolvedMount,
  DockerMountConfig,
} from "./types/mounts.js";
export { MountInputSchema } from "./types/mounts.js";

// Types – Resources (Phase 5)
export type {
  MemoryLimits,
  CpuLimits,
  PidLimits,
  BlockIOLimits,
  DeviceRate,
  ResourceConfig,
} from "./types/resources.js";
export {
  MemoryLimitsSchema,
  CpuLimitsSchema,
  PidLimitsSchema,
  BlockIOLimitsSchema,
  DeviceRateSchema,
  ResourceConfigSchema,
} from "./types/resources.js";

// Types – Security (Phase 5)
export type {
  LinuxCapability,
  CapabilityProfile,
  CapabilityProfileName,
  SeccompConfig,
  SecurityConfig,
  SecurityPresetName,
  SecurityPreset,
} from "./types/security.js";
export {
  LINUX_CAPABILITIES,
  DANGEROUS_CAPABILITIES,
  CapabilityProfileNameSchema,
  CapabilityProfiles,
  SeccompConfigSchema,
  SecurityConfigSchema,
  SecurityPresetNameSchema,
  SecurityPresets,
} from "./types/security.js";

// Types – Restart Policy (Phase 5)
export type { RestartPolicy, DockerRestartPolicy } from "./types/restart.js";
export { RestartPolicySchema } from "./types/restart.js";

// Types – Warnings (Phase 5)
export type { WarningLevel, WarningCode, ConfigWarning } from "./types/warnings.js";
export { WARNING_CODES, ConfigWarningSchema } from "./types/warnings.js";

// Types – Health Check (Phase 6)
export type {
  HttpGet,
  TcpSocket,
  ExecCheck,
  HealthCheckConfig,
  HealthStatus,
  HealthCheckResult,
  HealthCheckEvents,
} from "./types/health-check.js";
export {
  HealthCheckConfigSchema,
  HttpGetSchema,
  TcpSocketSchema,
  ExecCheckSchema,
} from "./types/health-check.js";

// Types – Orchestrator (Phase 6/7)
export type {
  DeployResult,
  ConfigDiff,
  UpdateResult,
  DestroyOptions,
  BatchItemResult,
  BatchResult,
  ProgressCallback,
  OrchestratorOptions,
  OrchestratorHealthStatus,
} from "./types/orchestrator.js";
export { DestroyOptionsSchema } from "./types/orchestrator.js";

// Types – Stack (Phase 6)
export type {
  StackServiceConfig,
  StackNetworkConfig,
  StackVolumeConfig,
  StackConfig,
  StackServiceResult,
  StackDeployResult,
} from "./types/stack.js";
export {
  StackServiceSchema,
  StackNetworkSchema,
  StackVolumeSchema,
  StackConfigSchema,
} from "./types/stack.js";

// Factory function (Phase 6)
export { createOrchestrator } from "./core/orchestrator.js";
