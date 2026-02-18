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
