import {
  ConnectionError,
  ContainerAlreadyExistsError,
  ContainerAlreadyRunningError,
  ContainerAlreadyStoppedError,
  ContainerNotFoundError,
  DockerInternalError,
  DockerOrchestratorError,
  ImageNotFoundError,
  NetworkNotFoundError,
  VolumeInUseError,
} from "./base.js";

/**
 * Maps raw Docker API errors to typed DockerOrchestratorError subclasses.
 */
export function mapDockerError(
  err: unknown,
  context?: {
    containerId?: string;
    imageName?: string;
    networkId?: string;
    volumeName?: string;
  },
): DockerOrchestratorError {
  const error = err instanceof Error ? err : new Error(String(err));
  const message = error.message ?? "";
  const statusCode = (error as { statusCode?: number }).statusCode;

  // Connection errors
  if (
    message.includes("ECONNREFUSED") ||
    message.includes("ENOENT") ||
    message.includes("connect EACCES")
  ) {
    return new ConnectionError(`Cannot connect to Docker daemon: ${message}`, error);
  }

  // 304 - not modified (e.g. container already started/stopped)
  if (statusCode === 304) {
    if (context?.containerId) {
      if (message.toLowerCase().includes("already started")) {
        return new ContainerAlreadyRunningError(context.containerId, error);
      }
      return new ContainerAlreadyStoppedError(context.containerId, error);
    }
    return new DockerOrchestratorError(
      `Operation had no effect: ${message}`,
      "NOT_MODIFIED",
      error,
    );
  }

  // 404 errors
  if (statusCode === 404) {
    if (context?.containerId) {
      return new ContainerNotFoundError(context.containerId, error);
    }
    if (context?.imageName) {
      return new ImageNotFoundError(context.imageName, error);
    }
    if (context?.networkId) {
      return new NetworkNotFoundError(context.networkId, error);
    }
    return new DockerOrchestratorError(`Resource not found: ${message}`, "NOT_FOUND", error);
  }

  // 409 - conflict (e.g. container name already in use, volume in use)
  if (statusCode === 409) {
    if (context?.containerId) {
      return new ContainerAlreadyExistsError(context.containerId, error);
    }
    if (context?.volumeName) {
      return new VolumeInUseError(context.volumeName, error);
    }
    return new DockerOrchestratorError(`Conflict: ${message}`, "CONFLICT", error);
  }

  // 500 - internal error
  if (statusCode === 500) {
    return new DockerInternalError(message || "Docker internal error", error);
  }

  return new DockerOrchestratorError(message || "Unknown Docker error", "UNKNOWN", error);
}
