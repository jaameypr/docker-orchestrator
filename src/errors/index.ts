export {
  DockerOrchestratorError,
  ConnectionError,
  ContainerNotFoundError,
  ImageNotFoundError,
  ContainerAlreadyRunningError,
  ContainerAlreadyStoppedError,
  CommandFailedError,
  CommandTimeoutError,
  FileNotFoundError,
  ContainerNotRunningError,
  PermissionError,
  RecreationFailedError,
  CriticalRecreationError,
  // Phase 4: Network errors
  NetworkNotFoundError,
  NetworkAlreadyExistsError,
  ContainerStillConnectedError,
  InvalidSubnetError,
  // Phase 4: Volume errors
  VolumeNotFoundError,
  VolumeInUseError,
  VolumeAlreadyExistsError,
  // Phase 4: Port errors
  PortAlreadyInUseError,
  // Phase 4: Mount errors
  InvalidMountError,
} from "./base.js";
export { mapDockerError } from "./mapping.js";
