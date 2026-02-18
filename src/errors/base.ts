export class DockerOrchestratorError extends Error {
  public readonly code: string;
  public readonly cause?: Error;

  constructor(message: string, code: string, cause?: Error) {
    super(message);
    this.name = "DockerOrchestratorError";
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConnectionError extends DockerOrchestratorError {
  constructor(message: string, cause?: Error) {
    super(message, "CONNECTION_ERROR", cause);
    this.name = "ConnectionError";
  }
}

export class ContainerNotFoundError extends DockerOrchestratorError {
  public readonly containerId: string;

  constructor(containerId: string, cause?: Error) {
    super(`Container not found: ${containerId}`, "CONTAINER_NOT_FOUND", cause);
    this.name = "ContainerNotFoundError";
    this.containerId = containerId;
  }
}

export class ImageNotFoundError extends DockerOrchestratorError {
  public readonly imageName: string;

  constructor(imageName: string, cause?: Error) {
    super(`Image not found: ${imageName}`, "IMAGE_NOT_FOUND", cause);
    this.name = "ImageNotFoundError";
    this.imageName = imageName;
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

export class FileNotFoundError extends DockerOrchestratorError {
  public readonly path: string;

  constructor(path: string, location: "host" | "container", cause?: Error) {
    super(`File not found on ${location}: ${path}`, "FILE_NOT_FOUND", cause);
    this.name = "FileNotFoundError";
    this.path = path;
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

export class PermissionError extends DockerOrchestratorError {
  public readonly path: string;

  constructor(path: string, cause?: Error) {
    super(
      `Permission denied: ${path}. Check UID/GID settings.`,
      "PERMISSION_DENIED",
      cause,
    );
    this.name = "PermissionError";
    this.path = path;
  }
}

export class RecreationFailedError extends DockerOrchestratorError {
  public readonly rollbackStatus: "succeeded" | "failed";
  public readonly containerId: string;

  constructor(
    containerId: string,
    rollbackStatus: "succeeded" | "failed",
    cause?: Error,
  ) {
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
    super(
      `Network with name "${networkName}" already exists`,
      "NETWORK_ALREADY_EXISTS",
      cause,
    );
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

export class InvalidSubnetError extends DockerOrchestratorError {
  public readonly subnet: string;
  public readonly ip: string;

  constructor(ip: string, subnet: string, cause?: Error) {
    super(
      `IP address ${ip} is not within subnet ${subnet}`,
      "INVALID_SUBNET",
      cause,
    );
    this.name = "InvalidSubnetError";
    this.subnet = subnet;
    this.ip = ip;
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

export class VolumeAlreadyExistsError extends DockerOrchestratorError {
  public readonly volumeName: string;

  constructor(volumeName: string, cause?: Error) {
    super(
      `Volume with name "${volumeName}" already exists`,
      "VOLUME_ALREADY_EXISTS",
      cause,
    );
    this.name = "VolumeAlreadyExistsError";
    this.volumeName = volumeName;
  }
}

// ---------------------------------------------------------------------------
// Port Errors
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

// ---------------------------------------------------------------------------
// Mount Errors
// ---------------------------------------------------------------------------

export class InvalidMountError extends DockerOrchestratorError {
  public readonly mountSpec: string;

  constructor(mountSpec: string, reason: string, cause?: Error) {
    super(
      `Invalid mount specification "${mountSpec}": ${reason}`,
      "INVALID_MOUNT",
      cause,
    );
    this.name = "InvalidMountError";
    this.mountSpec = mountSpec;
  }
}

// ---------------------------------------------------------------------------
// Phase 5: Resource & Security Errors
// ---------------------------------------------------------------------------

export class InsufficientResourcesError extends DockerOrchestratorError {
  public readonly resource: string;

  constructor(resource: string, detail: string, cause?: Error) {
    super(
      `Insufficient resources (${resource}): ${detail}`,
      "INSUFFICIENT_RESOURCES",
      cause,
    );
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

export class SeccompProfileNotFoundError extends DockerOrchestratorError {
  public readonly profilePath: string;

  constructor(profilePath: string, cause?: Error) {
    super(
      `Seccomp profile not found: ${profilePath}`,
      "SECCOMP_PROFILE_NOT_FOUND",
      cause,
    );
    this.name = "SeccompProfileNotFoundError";
    this.profilePath = profilePath;
  }
}

// ---------------------------------------------------------------------------
// Phase 6: Orchestrator Errors
// ---------------------------------------------------------------------------

export class DeploymentFailedError extends DockerOrchestratorError {
  public readonly step: string;

  constructor(step: string, message: string, cause?: Error) {
    super(
      `Deployment failed at step "${step}": ${message}`,
      "DEPLOYMENT_FAILED",
      cause,
    );
    this.name = "DeploymentFailedError";
    this.step = step;
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

export class ImagePullError extends DockerOrchestratorError {
  public readonly imageName: string;

  constructor(imageName: string, reason: string, cause?: Error) {
    super(
      `Failed to pull image "${imageName}": ${reason}`,
      "IMAGE_PULL_ERROR",
      cause,
    );
    this.name = "ImagePullError";
    this.imageName = imageName;
  }
}
