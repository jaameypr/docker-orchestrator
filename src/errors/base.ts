// ---------------------------------------------------------------------------
// Error Codes
// ---------------------------------------------------------------------------

export type ErrorCode =
  // Connection
  | "CONNECTION_ERROR"
  | "DOCKER_DAEMON_NOT_RUNNING"
  | "DOCKER_API_VERSION_ERROR"
  // Container
  | "CONTAINER_NOT_FOUND"
  | "CONTAINER_NOT_RUNNING"
  | "CONTAINER_ALREADY_RUNNING"
  | "CONTAINER_ALREADY_STOPPED"
  | "CONTAINER_ALREADY_EXISTS"
  // Image
  | "IMAGE_NOT_FOUND"
  | "IMAGE_PULL_ERROR"
  // Resource
  | "PORT_ALREADY_IN_USE"
  | "INSUFFICIENT_RESOURCES"
  | "OOM_KILLED"
  | "VOLUME_IN_USE"
  // Operation
  | "COMMAND_FAILED"
  | "COMMAND_TIMEOUT"
  | "HEALTH_CHECK_TIMEOUT"
  | "DEPLOYMENT_FAILED"
  | "RECREATION_FAILED"
  | "CRITICAL_RECREATION_ERROR"
  | "UPDATE_FAILED"
  | "BATCH_OPERATION_ERROR"
  | "TIMEOUT"
  | "CIRCUIT_OPEN"
  // Config
  | "VALIDATION_ERROR"
  | "INVALID_RESOURCE_CONFIG"
  | "INVALID_SECURITY_CONFIG"
  | "INVALID_MOUNT"
  | "INVALID_SUBNET"
  // Network
  | "NETWORK_NOT_FOUND"
  | "NETWORK_ALREADY_EXISTS"
  // Volume
  | "VOLUME_NOT_FOUND"
  | "VOLUME_ALREADY_EXISTS"
  // Other
  | "FILE_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "SECCOMP_PROFILE_NOT_FOUND"
  | "CONTAINER_STILL_CONNECTED"
  | "DEPENDENCY_RESOLUTION_ERROR"
  | "NOT_FOUND"
  | "NOT_MODIFIED"
  | "CONFLICT"
  | "DOCKER_INTERNAL_ERROR"
  | "UNKNOWN"
  // Attach / Console
  | "STDIN_NOT_AVAILABLE"
  | "CONSOLE_DISCONNECTED"
  | "CONSOLE_COMMAND_TIMEOUT"
  | "GRACEFUL_STOP_TIMEOUT"
  // Preset
  | "PRESET_NOT_FOUND"
  | "PRESET_ALREADY_EXISTS"
  | "PRESET_VALIDATION_ERROR"
  | "READY_CHECK_TIMEOUT";

// ---------------------------------------------------------------------------
// Base Error
// ---------------------------------------------------------------------------

export class DockerOrchestratorError extends Error {
  public readonly code: string;
  public readonly cause?: Error;
  public readonly context?: Record<string, unknown>;
  public readonly timestamp: Date;

  constructor(message: string, code: string, cause?: Error, context?: Record<string, unknown>) {
    super(message);
    this.name = "DockerOrchestratorError";
    this.code = code;
    this.cause = cause;
    this.context = context;
    this.timestamp = new Date();
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      cause: this.cause
        ? {
            name: this.cause.name,
            message: this.cause.message,
          }
        : undefined,
      stack: this.stack,
    };
  }
}

// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------

export function isDockerOrchestratorError(error: unknown): error is DockerOrchestratorError {
  return error instanceof DockerOrchestratorError;
}

const TRANSIENT_CODES = new Set<string>([
  "CONNECTION_ERROR",
  "DOCKER_DAEMON_NOT_RUNNING",
  "TIMEOUT",
  "COMMAND_TIMEOUT",
  "DOCKER_INTERNAL_ERROR",
]);

export function isTransientError(error: unknown): boolean {
  if (error instanceof DockerOrchestratorError) {
    return TRANSIENT_CODES.has(error.code);
  }
  if (error instanceof Error) {
    const msg = error.message;
    return (
      msg.includes("ECONNREFUSED") ||
      msg.includes("ECONNRESET") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("ENOENT") ||
      msg.includes("socket hang up")
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Connection Errors
// ---------------------------------------------------------------------------

export class ConnectionError extends DockerOrchestratorError {
  constructor(message: string, cause?: Error) {
    super(message, "CONNECTION_ERROR", cause);
    this.name = "ConnectionError";
  }
}

export class DockerDaemonNotRunningError extends DockerOrchestratorError {
  constructor(message?: string, cause?: Error) {
    super(message ?? "Docker daemon is not running", "DOCKER_DAEMON_NOT_RUNNING", cause);
    this.name = "DockerDaemonNotRunningError";
  }
}

export class DockerApiVersionError extends DockerOrchestratorError {
  public readonly requiredVersion: string;
  public readonly actualVersion: string;

  constructor(requiredVersion: string, actualVersion: string, cause?: Error) {
    super(
      `Docker API version ${actualVersion} is incompatible (requires ${requiredVersion})`,
      "DOCKER_API_VERSION_ERROR",
      cause,
    );
    this.name = "DockerApiVersionError";
    this.requiredVersion = requiredVersion;
    this.actualVersion = actualVersion;
  }
}

// ---------------------------------------------------------------------------
// Container Errors
// ---------------------------------------------------------------------------

export class ContainerNotFoundError extends DockerOrchestratorError {
  public readonly containerId: string;

  constructor(containerId: string, cause?: Error) {
    super(`Container not found: ${containerId}`, "CONTAINER_NOT_FOUND", cause);
    this.name = "ContainerNotFoundError";
    this.containerId = containerId;
  }
}

export class ContainerNotRunningError extends DockerOrchestratorError {
  public readonly containerId: string;

  constructor(containerId: string, cause?: Error) {
    super(`Container is not running: ${containerId}`, "CONTAINER_NOT_RUNNING", cause);
    this.name = "ContainerNotRunningError";
    this.containerId = containerId;
  }
}

export class ContainerAlreadyRunningError extends DockerOrchestratorError {
  public readonly containerId: string;

  constructor(containerId: string, cause?: Error) {
    super(`Container is already running: ${containerId}`, "CONTAINER_ALREADY_RUNNING", cause);
    this.name = "ContainerAlreadyRunningError";
    this.containerId = containerId;
  }
}

export class ContainerAlreadyStoppedError extends DockerOrchestratorError {
  public readonly containerId: string;

  constructor(containerId: string, cause?: Error) {
    super(`Container is already stopped: ${containerId}`, "CONTAINER_ALREADY_STOPPED", cause);
    this.name = "ContainerAlreadyStoppedError";
    this.containerId = containerId;
  }
}

export class ContainerAlreadyExistsError extends DockerOrchestratorError {
  public readonly containerName: string;

  constructor(containerName: string, cause?: Error) {
    super(
      `Container with name "${containerName}" already exists`,
      "CONTAINER_ALREADY_EXISTS",
      cause,
    );
    this.name = "ContainerAlreadyExistsError";
    this.containerName = containerName;
  }
}

// ---------------------------------------------------------------------------
// Image Errors
// ---------------------------------------------------------------------------

export class ImageNotFoundError extends DockerOrchestratorError {
  public readonly imageName: string;

  constructor(imageName: string, cause?: Error) {
    super(`Image not found: ${imageName}`, "IMAGE_NOT_FOUND", cause);
    this.name = "ImageNotFoundError";
    this.imageName = imageName;
  }
}

export class ImagePullError extends DockerOrchestratorError {
  public readonly imageName: string;

  constructor(imageName: string, reason: string, cause?: Error) {
    super(`Failed to pull image "${imageName}": ${reason}`, "IMAGE_PULL_ERROR", cause);
    this.name = "ImagePullError";
    this.imageName = imageName;
  }
}

// ---------------------------------------------------------------------------
// Resource Errors
// ---------------------------------------------------------------------------

export class PortAlreadyInUseError extends DockerOrchestratorError {
  public readonly port: number;
  public readonly suggestedPort: number;

  constructor(port: number, suggestedPort: number, cause?: Error) {
    super(
      `Port ${port} is already in use. Try port ${suggestedPort} instead.`,
      "PORT_ALREADY_IN_USE",
      cause,
    );
    this.name = "PortAlreadyInUseError";
    this.port = port;
    this.suggestedPort = suggestedPort;
  }
}

export class InsufficientResourcesError extends DockerOrchestratorError {
  public readonly resource: string;

  constructor(resource: string, detail: string, cause?: Error) {
    super(`Insufficient resources (${resource}): ${detail}`, "INSUFFICIENT_RESOURCES", cause);
    this.name = "InsufficientResourcesError";
    this.resource = resource;
  }
}

export class OOMKilledError extends DockerOrchestratorError {
  public readonly containerId: string;
  public readonly memoryLimit: number;

  constructor(containerId: string, memoryLimit: number, cause?: Error) {
    super(
      `Container ${containerId} was killed by OOM killer (memory limit: ${memoryLimit} bytes)`,
      "OOM_KILLED",
      cause,
    );
    this.name = "OOMKilledError";
    this.containerId = containerId;
    this.memoryLimit = memoryLimit;
  }
}

export class VolumeInUseError extends DockerOrchestratorError {
  public readonly volumeName: string;

  constructor(volumeName: string, cause?: Error) {
    super(
      `Volume "${volumeName}" is currently in use by one or more containers`,
      "VOLUME_IN_USE",
      cause,
    );
    this.name = "VolumeInUseError";
    this.volumeName = volumeName;
  }
}

// ---------------------------------------------------------------------------
// Operation Errors
// ---------------------------------------------------------------------------

export class CommandFailedError extends DockerOrchestratorError {
  public readonly stdout: string;
  public readonly stderr: string;
  public readonly exitCode: number;

  constructor(exitCode: number, stdout: string, stderr: string, cause?: Error) {
    super(
      `Command failed with exit code ${exitCode}: ${stderr || stdout}`.slice(0, 500),
      "COMMAND_FAILED",
      cause,
    );
    this.name = "CommandFailedError";
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export class CommandTimeoutError extends DockerOrchestratorError {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number, cause?: Error) {
    super(`Command timed out after ${timeoutMs}ms`, "COMMAND_TIMEOUT", cause);
    this.name = "CommandTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class HealthCheckTimeoutError extends DockerOrchestratorError {
  public readonly containerId: string;
  public readonly timeoutMs: number;

  constructor(containerId: string, timeoutMs: number, cause?: Error) {
    super(
      `Health check timed out after ${timeoutMs}ms for container ${containerId}`,
      "HEALTH_CHECK_TIMEOUT",
      cause,
    );
    this.name = "HealthCheckTimeoutError";
    this.containerId = containerId;
    this.timeoutMs = timeoutMs;
  }
}

export class DeploymentFailedError extends DockerOrchestratorError {
  public readonly step: string;

  constructor(step: string, message: string, cause?: Error) {
    super(`Deployment failed at step "${step}": ${message}`, "DEPLOYMENT_FAILED", cause);
    this.name = "DeploymentFailedError";
    this.step = step;
  }
}

export class RecreationFailedError extends DockerOrchestratorError {
  public readonly rollbackStatus: "succeeded" | "failed";
  public readonly containerId: string;

  constructor(containerId: string, rollbackStatus: "succeeded" | "failed", cause?: Error) {
    super(
      `Container recreation failed for ${containerId}. Rollback ${rollbackStatus}.`,
      "RECREATION_FAILED",
      cause,
    );
    this.name = "RecreationFailedError";
    this.containerId = containerId;
    this.rollbackStatus = rollbackStatus;
  }
}

export class CriticalRecreationError extends DockerOrchestratorError {
  public readonly containerId: string;
  public readonly recreationError: Error;
  public readonly rollbackError: Error;

  constructor(containerId: string, recreationError: Error, rollbackError: Error) {
    super(
      `CRITICAL: Container recreation AND rollback both failed for ${containerId}. ` +
        `Recreation error: ${recreationError.message}. Rollback error: ${rollbackError.message}`,
      "CRITICAL_RECREATION_ERROR",
      recreationError,
    );
    this.name = "CriticalRecreationError";
    this.containerId = containerId;
    this.recreationError = recreationError;
    this.rollbackError = rollbackError;
  }
}

export class UpdateFailedError extends DockerOrchestratorError {
  public readonly containerId: string;
  public readonly rollbackStatus: "succeeded" | "failed" | "not_attempted";

  constructor(
    containerId: string,
    rollbackStatus: "succeeded" | "failed" | "not_attempted",
    message: string,
    cause?: Error,
  ) {
    super(
      `Update failed for container ${containerId}. Rollback ${rollbackStatus}. ${message}`,
      "UPDATE_FAILED",
      cause,
    );
    this.name = "UpdateFailedError";
    this.containerId = containerId;
    this.rollbackStatus = rollbackStatus;
  }
}

export class BatchOperationError extends DockerOrchestratorError {
  public readonly succeeded: number;
  public readonly failed: number;
  public readonly errors: Array<{ index: number; error: Error }>;

  constructor(
    operation: string,
    succeeded: number,
    failed: number,
    errors: Array<{ index: number; error: Error }>,
  ) {
    super(
      `Batch ${operation} partially failed: ${succeeded} succeeded, ${failed} failed`,
      "BATCH_OPERATION_ERROR",
    );
    this.name = "BatchOperationError";
    this.succeeded = succeeded;
    this.failed = failed;
    this.errors = errors;
  }
}

export class TimeoutError extends DockerOrchestratorError {
  public readonly timeoutMs: number;
  public readonly operation: string;

  constructor(operation: string, timeoutMs: number, cause?: Error) {
    super(`Operation "${operation}" timed out after ${timeoutMs}ms`, "TIMEOUT", cause);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
    this.operation = operation;
  }
}

export class CircuitOpenError extends DockerOrchestratorError {
  constructor(message?: string, cause?: Error) {
    super(
      message ?? "Circuit breaker is open – requests are being rejected",
      "CIRCUIT_OPEN",
      cause,
    );
    this.name = "CircuitOpenError";
  }
}

// ---------------------------------------------------------------------------
// Config Errors
// ---------------------------------------------------------------------------

export class ValidationError extends DockerOrchestratorError {
  public readonly fieldPath: string;

  constructor(fieldPath: string, message: string, cause?: Error) {
    super(`Validation error at "${fieldPath}": ${message}`, "VALIDATION_ERROR", cause);
    this.name = "ValidationError";
    this.fieldPath = fieldPath;
  }
}

export class InvalidResourceConfigError extends DockerOrchestratorError {
  public readonly field: string;

  constructor(field: string, reason: string, cause?: Error) {
    super(
      `Invalid resource configuration for "${field}": ${reason}`,
      "INVALID_RESOURCE_CONFIG",
      cause,
    );
    this.name = "InvalidResourceConfigError";
    this.field = field;
  }
}

export class InvalidSecurityConfigError extends DockerOrchestratorError {
  public readonly field: string;

  constructor(field: string, reason: string, cause?: Error) {
    super(
      `Invalid security configuration for "${field}": ${reason}`,
      "INVALID_SECURITY_CONFIG",
      cause,
    );
    this.name = "InvalidSecurityConfigError";
    this.field = field;
  }
}

export class InvalidMountError extends DockerOrchestratorError {
  public readonly mountSpec: string;

  constructor(mountSpec: string, reason: string, cause?: Error) {
    super(`Invalid mount specification "${mountSpec}": ${reason}`, "INVALID_MOUNT", cause);
    this.name = "InvalidMountError";
    this.mountSpec = mountSpec;
  }
}

export class InvalidSubnetError extends DockerOrchestratorError {
  public readonly subnet: string;
  public readonly ip: string;

  constructor(ip: string, subnet: string, cause?: Error) {
    super(`IP address ${ip} is not within subnet ${subnet}`, "INVALID_SUBNET", cause);
    this.name = "InvalidSubnetError";
    this.subnet = subnet;
    this.ip = ip;
  }
}

// ---------------------------------------------------------------------------
// Network Errors
// ---------------------------------------------------------------------------

export class NetworkNotFoundError extends DockerOrchestratorError {
  public readonly networkId: string;

  constructor(networkId: string, cause?: Error) {
    super(`Network not found: ${networkId}`, "NETWORK_NOT_FOUND", cause);
    this.name = "NetworkNotFoundError";
    this.networkId = networkId;
  }
}

export class NetworkAlreadyExistsError extends DockerOrchestratorError {
  public readonly networkName: string;

  constructor(networkName: string, cause?: Error) {
    super(`Network with name "${networkName}" already exists`, "NETWORK_ALREADY_EXISTS", cause);
    this.name = "NetworkAlreadyExistsError";
    this.networkName = networkName;
  }
}

export class ContainerStillConnectedError extends DockerOrchestratorError {
  public readonly networkId: string;
  public readonly connectedContainers: string[];

  constructor(networkId: string, connectedContainers: string[], cause?: Error) {
    super(
      `Cannot remove network ${networkId}: ${connectedContainers.length} container(s) still connected (${connectedContainers.join(", ")})`,
      "CONTAINER_STILL_CONNECTED",
      cause,
    );
    this.name = "ContainerStillConnectedError";
    this.networkId = networkId;
    this.connectedContainers = connectedContainers;
  }
}

// ---------------------------------------------------------------------------
// Volume Errors
// ---------------------------------------------------------------------------

export class VolumeNotFoundError extends DockerOrchestratorError {
  public readonly volumeName: string;

  constructor(volumeName: string, cause?: Error) {
    super(`Volume not found: ${volumeName}`, "VOLUME_NOT_FOUND", cause);
    this.name = "VolumeNotFoundError";
    this.volumeName = volumeName;
  }
}

export class VolumeAlreadyExistsError extends DockerOrchestratorError {
  public readonly volumeName: string;

  constructor(volumeName: string, cause?: Error) {
    super(`Volume with name "${volumeName}" already exists`, "VOLUME_ALREADY_EXISTS", cause);
    this.name = "VolumeAlreadyExistsError";
    this.volumeName = volumeName;
  }
}

// ---------------------------------------------------------------------------
// Other Errors
// ---------------------------------------------------------------------------

export class FileNotFoundError extends DockerOrchestratorError {
  public readonly path: string;

  constructor(path: string, location: "host" | "container", cause?: Error) {
    super(`File not found on ${location}: ${path}`, "FILE_NOT_FOUND", cause);
    this.name = "FileNotFoundError";
    this.path = path;
  }
}

export class PermissionError extends DockerOrchestratorError {
  public readonly path: string;

  constructor(path: string, cause?: Error) {
    super(`Permission denied: ${path}. Check UID/GID settings.`, "PERMISSION_DENIED", cause);
    this.name = "PermissionError";
    this.path = path;
  }
}

export class SeccompProfileNotFoundError extends DockerOrchestratorError {
  public readonly profilePath: string;

  constructor(profilePath: string, cause?: Error) {
    super(`Seccomp profile not found: ${profilePath}`, "SECCOMP_PROFILE_NOT_FOUND", cause);
    this.name = "SeccompProfileNotFoundError";
    this.profilePath = profilePath;
  }
}

export class DependencyResolutionError extends DockerOrchestratorError {
  public readonly services: string[];

  constructor(services: string[], cause?: Error) {
    super(
      `Circular dependency detected among services: ${services.join(" → ")}`,
      "DEPENDENCY_RESOLUTION_ERROR",
      cause,
    );
    this.name = "DependencyResolutionError";
    this.services = services;
  }
}

export class DockerInternalError extends DockerOrchestratorError {
  constructor(message: string, cause?: Error) {
    super(message, "DOCKER_INTERNAL_ERROR", cause);
    this.name = "DockerInternalError";
  }
}

// ---------------------------------------------------------------------------
// Attach / Console Errors
// ---------------------------------------------------------------------------

export class StdinNotAvailableError extends DockerOrchestratorError {
  public readonly containerId: string;

  constructor(containerId: string, cause?: Error) {
    super(
      `Container ${containerId} was not created with OpenStdin: true. Cannot attach stdin.`,
      "STDIN_NOT_AVAILABLE",
      cause,
    );
    this.name = "StdinNotAvailableError";
    this.containerId = containerId;
  }
}

export class ConsoleDisconnectedError extends DockerOrchestratorError {
  public readonly containerId: string;

  constructor(containerId: string, cause?: Error) {
    super(
      `Console for container ${containerId} is disconnected and command queue is disabled`,
      "CONSOLE_DISCONNECTED",
      cause,
    );
    this.name = "ConsoleDisconnectedError";
    this.containerId = containerId;
  }
}

export class ConsoleCommandTimeoutError extends DockerOrchestratorError {
  public readonly containerId: string;
  public readonly timeoutMs: number;

  constructor(containerId: string, timeoutMs: number, cause?: Error) {
    super(
      `Console command timed out after ${timeoutMs}ms for container ${containerId}`,
      "CONSOLE_COMMAND_TIMEOUT",
      cause,
    );
    this.name = "ConsoleCommandTimeoutError";
    this.containerId = containerId;
    this.timeoutMs = timeoutMs;
  }
}

export class GracefulStopTimeoutError extends DockerOrchestratorError {
  public readonly containerId: string;
  public readonly timeoutMs: number;

  constructor(containerId: string, timeoutMs: number, cause?: Error) {
    super(
      `Graceful stop timed out after ${timeoutMs}ms for container ${containerId}`,
      "GRACEFUL_STOP_TIMEOUT",
      cause,
    );
    this.name = "GracefulStopTimeoutError";
    this.containerId = containerId;
    this.timeoutMs = timeoutMs;
  }
}

// ---------------------------------------------------------------------------
// Preset Errors
// ---------------------------------------------------------------------------

export class PresetNotFoundError extends DockerOrchestratorError {
  public readonly presetName: string;

  constructor(presetName: string, cause?: Error) {
    super(`Preset not found: "${presetName}"`, "PRESET_NOT_FOUND", cause);
    this.name = "PresetNotFoundError";
    this.presetName = presetName;
  }
}

export class PresetAlreadyExistsError extends DockerOrchestratorError {
  public readonly presetName: string;

  constructor(presetName: string, cause?: Error) {
    super(
      `Preset "${presetName}" already exists. Use overwrite: true to replace it.`,
      "PRESET_ALREADY_EXISTS",
      cause,
    );
    this.name = "PresetAlreadyExistsError";
    this.presetName = presetName;
  }
}

export class PresetValidationError extends DockerOrchestratorError {
  public readonly details: string;

  constructor(details: string, cause?: Error) {
    super(`Invalid preset: ${details}`, "PRESET_VALIDATION_ERROR", cause);
    this.name = "PresetValidationError";
    this.details = details;
  }
}

export class ReadyCheckTimeoutError extends DockerOrchestratorError {
  public readonly containerId: string;
  public readonly timeoutMs: number;

  constructor(containerId: string, timeoutMs: number, cause?: Error) {
    super(
      `Ready check timed out after ${timeoutMs}ms for container ${containerId}`,
      "READY_CHECK_TIMEOUT",
      cause,
    );
    this.name = "ReadyCheckTimeoutError";
    this.containerId = containerId;
    this.timeoutMs = timeoutMs;
  }
}
