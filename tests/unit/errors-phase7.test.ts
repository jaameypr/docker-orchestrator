import { describe, it, expect } from "vitest";
import {
  DockerOrchestratorError,
  ConnectionError,
  DockerDaemonNotRunningError,
  DockerApiVersionError,
  ContainerNotFoundError,
  ContainerAlreadyStoppedError,
  ContainerAlreadyExistsError,
  ImageNotFoundError,
  PortAlreadyInUseError,
  VolumeInUseError,
  CommandFailedError,
  CommandTimeoutError,
  BatchOperationError,
  TimeoutError,
  CircuitOpenError,
  ValidationError,
  NetworkNotFoundError,
  DockerInternalError,
  DependencyResolutionError,
  isDockerOrchestratorError,
  isTransientError,
} from "../../src/errors/base.js";
import { mapDockerError } from "../../src/errors/mapping.js";

describe("Phase 7 Error Classes", () => {
  describe("DockerOrchestratorError base", () => {
    it("should have code, message, context, and timestamp", () => {
      const err = new DockerOrchestratorError("test error", "TEST_CODE");
      expect(err.code).toBe("TEST_CODE");
      expect(err.message).toBe("test error");
      expect(err.timestamp).toBeInstanceOf(Date);
      expect(err.context).toBeUndefined();
    });

    it("should accept optional context", () => {
      const err = new DockerOrchestratorError("msg", "CODE", undefined, {
        containerId: "abc",
      });
      expect(err.context).toEqual({ containerId: "abc" });
    });

    it("should preserve cause chain", () => {
      const cause = new Error("original");
      const err = new DockerOrchestratorError("wrapped", "CODE", cause);
      expect(err.cause).toBe(cause);
    });

    it("toJSON() should serialize all fields", () => {
      const cause = new Error("original");
      const err = new DockerOrchestratorError("msg", "CODE", cause, {
        extra: "data",
      });
      const json = err.toJSON();
      expect(json.name).toBe("DockerOrchestratorError");
      expect(json.code).toBe("CODE");
      expect(json.message).toBe("msg");
      expect(json.timestamp).toBeDefined();
      expect(json.context).toEqual({ extra: "data" });
      expect(json.cause).toEqual({
        name: "Error",
        message: "original",
      });
      expect(json.stack).toBeDefined();
    });

    it("toJSON() should omit cause when undefined", () => {
      const err = new DockerOrchestratorError("msg", "CODE");
      const json = err.toJSON();
      expect(json.cause).toBeUndefined();
    });
  });

  describe("isDockerOrchestratorError type guard", () => {
    it("should return true for DockerOrchestratorError", () => {
      expect(
        isDockerOrchestratorError(
          new DockerOrchestratorError("msg", "CODE"),
        ),
      ).toBe(true);
    });

    it("should return true for subclasses", () => {
      expect(isDockerOrchestratorError(new ConnectionError("fail"))).toBe(
        true,
      );
      expect(
        isDockerOrchestratorError(new ContainerNotFoundError("abc")),
      ).toBe(true);
    });

    it("should return false for plain Error", () => {
      expect(isDockerOrchestratorError(new Error("fail"))).toBe(false);
    });

    it("should return false for non-errors", () => {
      expect(isDockerOrchestratorError("not an error")).toBe(false);
      expect(isDockerOrchestratorError(null)).toBe(false);
      expect(isDockerOrchestratorError(undefined)).toBe(false);
    });
  });

  describe("isTransientError", () => {
    it("should identify CONNECTION_ERROR as transient", () => {
      expect(isTransientError(new ConnectionError("fail"))).toBe(true);
    });

    it("should identify DOCKER_DAEMON_NOT_RUNNING as transient", () => {
      expect(isTransientError(new DockerDaemonNotRunningError())).toBe(true);
    });

    it("should identify TIMEOUT as transient", () => {
      expect(isTransientError(new TimeoutError("op", 5000))).toBe(true);
    });

    it("should identify COMMAND_TIMEOUT as transient", () => {
      expect(isTransientError(new CommandTimeoutError(5000))).toBe(true);
    });

    it("should identify DOCKER_INTERNAL_ERROR as transient", () => {
      expect(isTransientError(new DockerInternalError("crash"))).toBe(true);
    });

    it("should not identify CONTAINER_NOT_FOUND as transient", () => {
      expect(isTransientError(new ContainerNotFoundError("abc"))).toBe(false);
    });

    it("should not identify VALIDATION_ERROR as transient", () => {
      expect(isTransientError(new ValidationError("field", "invalid"))).toBe(
        false,
      );
    });

    it("should not identify PORT_ALREADY_IN_USE as transient", () => {
      expect(isTransientError(new PortAlreadyInUseError(3000, 3001))).toBe(
        false,
      );
    });

    it("should detect ECONNREFUSED in plain errors", () => {
      expect(isTransientError(new Error("connect ECONNREFUSED"))).toBe(true);
    });

    it("should detect ETIMEDOUT in plain errors", () => {
      expect(isTransientError(new Error("ETIMEDOUT"))).toBe(true);
    });

    it("should return false for non-errors", () => {
      expect(isTransientError("string")).toBe(false);
    });
  });

  describe("New error classes", () => {
    it("DockerDaemonNotRunningError", () => {
      const err = new DockerDaemonNotRunningError();
      expect(err).toBeInstanceOf(DockerOrchestratorError);
      expect(err.name).toBe("DockerDaemonNotRunningError");
      expect(err.code).toBe("DOCKER_DAEMON_NOT_RUNNING");
      expect(err.message).toContain("not running");
    });

    it("DockerApiVersionError", () => {
      const err = new DockerApiVersionError("1.41", "1.30");
      expect(err).toBeInstanceOf(DockerOrchestratorError);
      expect(err.name).toBe("DockerApiVersionError");
      expect(err.code).toBe("DOCKER_API_VERSION_ERROR");
      expect(err.requiredVersion).toBe("1.41");
      expect(err.actualVersion).toBe("1.30");
    });

    it("ContainerAlreadyExistsError", () => {
      const err = new ContainerAlreadyExistsError("my-container");
      expect(err).toBeInstanceOf(DockerOrchestratorError);
      expect(err.name).toBe("ContainerAlreadyExistsError");
      expect(err.code).toBe("CONTAINER_ALREADY_EXISTS");
      expect(err.containerName).toBe("my-container");
    });

    it("TimeoutError", () => {
      const err = new TimeoutError("imagePull", 300000);
      expect(err).toBeInstanceOf(DockerOrchestratorError);
      expect(err.name).toBe("TimeoutError");
      expect(err.code).toBe("TIMEOUT");
      expect(err.operation).toBe("imagePull");
      expect(err.timeoutMs).toBe(300000);
      expect(err.message).toContain("300000ms");
    });

    it("CircuitOpenError", () => {
      const err = new CircuitOpenError();
      expect(err).toBeInstanceOf(DockerOrchestratorError);
      expect(err.name).toBe("CircuitOpenError");
      expect(err.code).toBe("CIRCUIT_OPEN");
    });

    it("ValidationError", () => {
      const err = new ValidationError("ports[0].host", "must be > 0");
      expect(err).toBeInstanceOf(DockerOrchestratorError);
      expect(err.name).toBe("ValidationError");
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.fieldPath).toBe("ports[0].host");
    });

    it("DockerInternalError", () => {
      const err = new DockerInternalError("internal server error");
      expect(err).toBeInstanceOf(DockerOrchestratorError);
      expect(err.name).toBe("DockerInternalError");
      expect(err.code).toBe("DOCKER_INTERNAL_ERROR");
    });
  });

  describe("Docker API statuscode mapping", () => {
    it("should map 404 to ContainerNotFoundError with containerId context", () => {
      const raw = Object.assign(new Error("not found"), { statusCode: 404 });
      const mapped = mapDockerError(raw, { containerId: "abc123" });
      expect(mapped).toBeInstanceOf(ContainerNotFoundError);
    });

    it("should map 404 to ImageNotFoundError with imageName context", () => {
      const raw = Object.assign(new Error("not found"), { statusCode: 404 });
      const mapped = mapDockerError(raw, { imageName: "alpine" });
      expect(mapped).toBeInstanceOf(ImageNotFoundError);
    });

    it("should map 404 to NetworkNotFoundError with networkId context", () => {
      const raw = Object.assign(new Error("not found"), { statusCode: 404 });
      const mapped = mapDockerError(raw, { networkId: "net1" });
      expect(mapped).toBeInstanceOf(NetworkNotFoundError);
    });

    it("should map 409 to ContainerAlreadyExistsError with containerId", () => {
      const raw = Object.assign(new Error("conflict"), { statusCode: 409 });
      const mapped = mapDockerError(raw, { containerId: "my-container" });
      expect(mapped).toBeInstanceOf(ContainerAlreadyExistsError);
    });

    it("should map 409 to VolumeInUseError with volumeName", () => {
      const raw = Object.assign(new Error("conflict"), { statusCode: 409 });
      const mapped = mapDockerError(raw, { volumeName: "my-vol" });
      expect(mapped).toBeInstanceOf(VolumeInUseError);
    });

    it("should map 500 to DockerInternalError", () => {
      const raw = Object.assign(new Error("internal"), { statusCode: 500 });
      const mapped = mapDockerError(raw);
      expect(mapped).toBeInstanceOf(DockerInternalError);
    });

    it("should map 304 to ContainerAlreadyStoppedError by default", () => {
      const raw = Object.assign(new Error("not modified"), {
        statusCode: 304,
      });
      const mapped = mapDockerError(raw, { containerId: "abc" });
      expect(mapped).toBeInstanceOf(ContainerAlreadyStoppedError);
    });

    it("should map ECONNREFUSED to ConnectionError", () => {
      const raw = new Error("connect ECONNREFUSED");
      const mapped = mapDockerError(raw);
      expect(mapped).toBeInstanceOf(ConnectionError);
    });
  });

  describe("Existing error classes still work", () => {
    it("CommandFailedError preserves stdout/stderr/exitCode", () => {
      const err = new CommandFailedError(1, "out", "err");
      expect(err.exitCode).toBe(1);
      expect(err.stdout).toBe("out");
      expect(err.stderr).toBe("err");
      expect(err.code).toBe("COMMAND_FAILED");
    });

    it("BatchOperationError preserves counts and errors", () => {
      const errors = [{ index: 0, error: new Error("fail") }];
      const err = new BatchOperationError("deploy", 2, 1, errors);
      expect(err.succeeded).toBe(2);
      expect(err.failed).toBe(1);
      expect(err.errors).toHaveLength(1);
    });

    it("DependencyResolutionError preserves services", () => {
      const err = new DependencyResolutionError(["a", "b", "c"]);
      expect(err.services).toEqual(["a", "b", "c"]);
      expect(err.message).toContain("a → b → c");
    });
  });
});
