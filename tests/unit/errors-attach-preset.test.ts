import { describe, it, expect } from "vitest";
import {
  StdinNotAvailableError,
  ConsoleDisconnectedError,
  ConsoleCommandTimeoutError,
  GracefulStopTimeoutError,
  PresetNotFoundError,
  PresetAlreadyExistsError,
  PresetValidationError,
  ReadyCheckTimeoutError,
  DockerOrchestratorError,
  isDockerOrchestratorError,
} from "../../src/errors/base.js";

describe("Attach/Console Error Classes", () => {
  describe("StdinNotAvailableError", () => {
    it("should have correct code and message", () => {
      const err = new StdinNotAvailableError("container-123");
      expect(err.code).toBe("STDIN_NOT_AVAILABLE");
      expect(err.containerId).toBe("container-123");
      expect(err.message).toContain("OpenStdin");
      expect(err.name).toBe("StdinNotAvailableError");
      expect(isDockerOrchestratorError(err)).toBe(true);
    });
  });

  describe("ConsoleDisconnectedError", () => {
    it("should have correct code and message", () => {
      const err = new ConsoleDisconnectedError("container-456");
      expect(err.code).toBe("CONSOLE_DISCONNECTED");
      expect(err.containerId).toBe("container-456");
      expect(err.message).toContain("disconnected");
      expect(err.name).toBe("ConsoleDisconnectedError");
    });
  });

  describe("ConsoleCommandTimeoutError", () => {
    it("should have correct code, containerId, and timeoutMs", () => {
      const err = new ConsoleCommandTimeoutError("container-789", 5000);
      expect(err.code).toBe("CONSOLE_COMMAND_TIMEOUT");
      expect(err.containerId).toBe("container-789");
      expect(err.timeoutMs).toBe(5000);
      expect(err.message).toContain("5000ms");
    });
  });

  describe("GracefulStopTimeoutError", () => {
    it("should have correct code and timeoutMs", () => {
      const err = new GracefulStopTimeoutError("container-abc", 30000);
      expect(err.code).toBe("GRACEFUL_STOP_TIMEOUT");
      expect(err.containerId).toBe("container-abc");
      expect(err.timeoutMs).toBe(30000);
      expect(err.message).toContain("30000ms");
    });
  });
});

describe("Preset Error Classes", () => {
  describe("PresetNotFoundError", () => {
    it("should have correct code and presetName", () => {
      const err = new PresetNotFoundError("minecraft");
      expect(err.code).toBe("PRESET_NOT_FOUND");
      expect(err.presetName).toBe("minecraft");
      expect(err.message).toContain("minecraft");
      expect(err.name).toBe("PresetNotFoundError");
    });
  });

  describe("PresetAlreadyExistsError", () => {
    it("should have correct code and presetName", () => {
      const err = new PresetAlreadyExistsError("web-server");
      expect(err.code).toBe("PRESET_ALREADY_EXISTS");
      expect(err.presetName).toBe("web-server");
      expect(err.message).toContain("overwrite");
    });
  });

  describe("PresetValidationError", () => {
    it("should have correct code and details", () => {
      const err = new PresetValidationError("missing name");
      expect(err.code).toBe("PRESET_VALIDATION_ERROR");
      expect(err.details).toBe("missing name");
      expect(err.message).toContain("missing name");
    });
  });

  describe("ReadyCheckTimeoutError", () => {
    it("should have correct code, containerId, and timeoutMs", () => {
      const err = new ReadyCheckTimeoutError("container-ready", 60000);
      expect(err.code).toBe("READY_CHECK_TIMEOUT");
      expect(err.containerId).toBe("container-ready");
      expect(err.timeoutMs).toBe(60000);
    });
  });
});

describe("Error hierarchy", () => {
  it("all new errors should extend DockerOrchestratorError", () => {
    const errors = [
      new StdinNotAvailableError("a"),
      new ConsoleDisconnectedError("a"),
      new ConsoleCommandTimeoutError("a", 100),
      new GracefulStopTimeoutError("a", 100),
      new PresetNotFoundError("a"),
      new PresetAlreadyExistsError("a"),
      new PresetValidationError("a"),
      new ReadyCheckTimeoutError("a", 100),
    ];

    for (const err of errors) {
      expect(err).toBeInstanceOf(DockerOrchestratorError);
      expect(err).toBeInstanceOf(Error);
      expect(err.timestamp).toBeInstanceOf(Date);
      expect(typeof err.toJSON()).toBe("object");
    }
  });
});
