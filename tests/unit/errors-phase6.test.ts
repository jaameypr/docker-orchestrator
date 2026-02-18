import { describe, it, expect } from "vitest";
import {
  DeploymentFailedError,
  HealthCheckTimeoutError,
  UpdateFailedError,
  BatchOperationError,
  DependencyResolutionError,
  ImagePullError,
  DockerOrchestratorError,
} from "../../src/errors/base.js";

describe("Phase 6 Error Classes", () => {
  describe("DeploymentFailedError", () => {
    it("should contain step and message", () => {
      const err = new DeploymentFailedError("create", "could not create");
      expect(err).toBeInstanceOf(DockerOrchestratorError);
      expect(err.name).toBe("DeploymentFailedError");
      expect(err.code).toBe("DEPLOYMENT_FAILED");
      expect(err.step).toBe("create");
      expect(err.message).toContain("create");
      expect(err.message).toContain("could not create");
    });

    it("should support cause", () => {
      const cause = new Error("original");
      const err = new DeploymentFailedError("start", "failed", cause);
      expect(err.cause).toBe(cause);
    });
  });

  describe("HealthCheckTimeoutError", () => {
    it("should contain containerId and timeout", () => {
      const err = new HealthCheckTimeoutError("abc123", 60000);
      expect(err).toBeInstanceOf(DockerOrchestratorError);
      expect(err.name).toBe("HealthCheckTimeoutError");
      expect(err.code).toBe("HEALTH_CHECK_TIMEOUT");
      expect(err.containerId).toBe("abc123");
      expect(err.timeoutMs).toBe(60000);
      expect(err.message).toContain("60000ms");
    });
  });

  describe("UpdateFailedError", () => {
    it("should contain containerId and rollback status", () => {
      const err = new UpdateFailedError("abc123", "succeeded", "port conflict");
      expect(err).toBeInstanceOf(DockerOrchestratorError);
      expect(err.name).toBe("UpdateFailedError");
      expect(err.code).toBe("UPDATE_FAILED");
      expect(err.containerId).toBe("abc123");
      expect(err.rollbackStatus).toBe("succeeded");
    });

    it("should support failed rollback status", () => {
      const err = new UpdateFailedError("abc123", "failed", "critical error");
      expect(err.rollbackStatus).toBe("failed");
    });
  });

  describe("BatchOperationError", () => {
    it("should contain success/failure counts and errors", () => {
      const errors = [{ index: 1, error: new Error("fail1") }];
      const err = new BatchOperationError("deploy", 2, 1, errors);
      expect(err).toBeInstanceOf(DockerOrchestratorError);
      expect(err.name).toBe("BatchOperationError");
      expect(err.code).toBe("BATCH_OPERATION_ERROR");
      expect(err.succeeded).toBe(2);
      expect(err.failed).toBe(1);
      expect(err.errors).toHaveLength(1);
      expect(err.errors[0].index).toBe(1);
    });
  });

  describe("DependencyResolutionError", () => {
    it("should list services in cycle", () => {
      const err = new DependencyResolutionError(["a", "b", "c"]);
      expect(err).toBeInstanceOf(DockerOrchestratorError);
      expect(err.name).toBe("DependencyResolutionError");
      expect(err.code).toBe("DEPENDENCY_RESOLUTION_ERROR");
      expect(err.services).toEqual(["a", "b", "c"]);
      expect(err.message).toContain("a → b → c");
    });
  });

  describe("ImagePullError", () => {
    it("should contain image name and reason", () => {
      const err = new ImagePullError("myregistry/myimage:latest", "auth failed");
      expect(err).toBeInstanceOf(DockerOrchestratorError);
      expect(err.name).toBe("ImagePullError");
      expect(err.code).toBe("IMAGE_PULL_ERROR");
      expect(err.imageName).toBe("myregistry/myimage:latest");
      expect(err.message).toContain("auth failed");
    });

    it("should support cause", () => {
      const cause = new Error("network timeout");
      const err = new ImagePullError("alpine", "network error", cause);
      expect(err.cause).toBe(cause);
    });
  });
});
