/**
 * Docker API error response fixtures.
 * Covers all standard Docker Engine API error status codes.
 */

/**
 * Creates a Docker API error object with the given status code and message.
 * Matches the shape of errors thrown by dockerode.
 */
export function createDockerApiError(
  statusCode: number,
  message: string,
): Error & { statusCode: number; reason: string } {
  const error = new Error(message) as Error & {
    statusCode: number;
    reason: string;
  };
  error.statusCode = statusCode;
  error.reason = message;
  return error;
}

// ---------------------------------------------------------------------------
// HTTP 304 – Not Modified (container already in desired state)
// ---------------------------------------------------------------------------

/** Container already started – returned by start when container is already running. */
export const containerAlreadyStarted = createDockerApiError(
  304,
  "container already started",
);

/** Container already stopped – returned by stop when container is already stopped. */
export const containerAlreadyStopped = createDockerApiError(
  304,
  "container already stopped",
);

// ---------------------------------------------------------------------------
// HTTP 400 – Bad Request
// ---------------------------------------------------------------------------

export const badParameterError = createDockerApiError(
  400,
  "bad parameter: invalid restart policy",
);

// ---------------------------------------------------------------------------
// HTTP 404 – Not Found
// ---------------------------------------------------------------------------

/** Container not found. */
export const containerNotFound = createDockerApiError(
  404,
  "No such container: nonexistent-container",
);

/** Image not found. */
export const imageNotFound = createDockerApiError(
  404,
  "No such image: nonexistent:latest",
);

/** Network not found. */
export const networkNotFound = createDockerApiError(
  404,
  "network nonexistent-network not found",
);

/** Volume not found. */
export const volumeNotFound = createDockerApiError(
  404,
  "get test-volume: no such volume",
);

/** Exec not found. */
export const execNotFound = createDockerApiError(
  404,
  "No such exec instance: nonexistent-exec",
);

// ---------------------------------------------------------------------------
// HTTP 409 – Conflict
// ---------------------------------------------------------------------------

/** Container name already in use. */
export const containerNameConflict = createDockerApiError(
  409,
  'Conflict. The container name "/existing-container" is already in use',
);

/** Container is running – cannot remove without force. */
export const containerRunningConflict = createDockerApiError(
  409,
  "You cannot remove a running container. Stop the container before attempting removal or force remove",
);

/** Network name already exists. */
export const networkAlreadyExists = createDockerApiError(
  409,
  'network with name "existing-network" already exists',
);

/** Volume name already exists. */
export const volumeAlreadyExists = createDockerApiError(
  409,
  'volume name "existing-volume" already in use',
);

/** Volume is in use – cannot remove. */
export const volumeInUse = createDockerApiError(
  409,
  "remove test-volume: volume is in use",
);

/** Container still connected to network. */
export const containerStillConnected = createDockerApiError(
  409,
  "error while removing network: network has active endpoints",
);

// ---------------------------------------------------------------------------
// HTTP 500 – Internal Server Error
// ---------------------------------------------------------------------------

/** Generic Docker daemon internal error. */
export const internalServerError = createDockerApiError(
  500,
  "server error",
);

/** OOM killed error. */
export const oomKilledError = createDockerApiError(
  500,
  "OOM killed",
);

// ---------------------------------------------------------------------------
// Connection Errors
// ---------------------------------------------------------------------------

/** Docker daemon not running / socket not accessible. */
export function createConnectionError(): Error & { code: string } {
  const error = new Error(
    "connect ENOENT /var/run/docker.sock",
  ) as Error & { code: string };
  error.code = "ENOENT";
  return error;
}

/** Connection refused. */
export function createConnectionRefusedError(): Error & { code: string } {
  const error = new Error("connect ECONNREFUSED 127.0.0.1:2375") as Error & {
    code: string;
  };
  error.code = "ECONNREFUSED";
  return error;
}

/** Connection timeout. */
export function createConnectionTimeoutError(): Error & { code: string } {
  const error = new Error("connect ETIMEDOUT 127.0.0.1:2375") as Error & {
    code: string;
  };
  error.code = "ETIMEDOUT";
  return error;
}

// ---------------------------------------------------------------------------
// Permission Errors
// ---------------------------------------------------------------------------

/** Permission denied accessing Docker socket. */
export const permissionDenied = createDockerApiError(
  403,
  "permission denied while trying to connect to the Docker daemon socket",
);
