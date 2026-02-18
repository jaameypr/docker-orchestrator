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
  // Phase 5: Resource & Security errors
  InsufficientResourcesError,
  OOMKilledError,
  InvalidResourceConfigError,
  InvalidSecurityConfigError,
  SeccompProfileNotFoundError,
  // Phase 6: Orchestrator errors
  DeploymentFailedError,
  HealthCheckTimeoutError,
  UpdateFailedError,
  BatchOperationError,
  DependencyResolutionError,
  ImagePullError,
} from "./base.js";
export { mapDockerError } from "./mapping.js";
