/**
 * Fixtures index - re-exports all test fixtures.
 */

// Docker API response fixtures
export {
  containerCreateResponse,
  containerListResponse,
  containerInspectResponse,
  imageListResponse,
  imagePullProgressEvents,
  networkCreateResponse,
  networkListResponse,
  volumeCreateResponse,
  volumeListResponse,
  volumePruneResponse,
  versionResponse,
  pingResponse,
  execCreateResponse,
  execInspectResponse,
} from "./docker-api-responses.js";

// Error response fixtures
export {
  createDockerApiError,
  containerAlreadyStarted,
  containerAlreadyStopped,
  badParameterError,
  containerNotFound,
  imageNotFound,
  networkNotFound,
  volumeNotFound,
  execNotFound,
  containerNameConflict,
  containerRunningConflict,
  networkAlreadyExists,
  volumeAlreadyExists,
  volumeInUse,
  containerStillConnected,
  internalServerError,
  oomKilledError,
  createConnectionError,
  createConnectionRefusedError,
  createConnectionTimeoutError,
  permissionDenied,
} from "./error-responses.js";

// Stream fixtures
export {
  simpleStdoutLog,
  simpleStderrLog,
  mixedStdoutStderrLog,
  timestampedLog,
  largeLogOutput,
  emptyLogOutput,
  createFragmentedFrames,
  zeroLengthFrame,
  containerStartEvent,
  containerStopEvent,
  containerDieEvent,
  imagePullEvent,
  networkCreateEvent,
  volumeCreateEvent,
  multipleEventsStream,
  healthStatusEvent,
  statsSnapshot1,
  statsSnapshot2,
  multipleStatsStream,
} from "./stream-fixtures.js";
