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
