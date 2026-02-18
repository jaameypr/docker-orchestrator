import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ConsoleLogger,
  NoopLogger,
  createLogger,
  redactSensitiveData,
} from "../../src/utils/logger.js";
import type { Logger } from "../../src/utils/logger.js";

describe("Logger", () => {
  describe("redactSensitiveData", () => {
    it("should redact keys containing sensitive patterns", () => {
      const result = redactSensitiveData({
        apiKey: "super-secret-key",
        password: "mypassword",
        secretToken: "tok_123",
        name: "visible",
      });
      expect(result.apiKey).toBe("***");
      expect(result.password).toBe("***");
      expect(result.secretToken).toBe("***");
      expect(result.name).toBe("visible");
    });

    it("should redact nested objects", () => {
      const result = redactSensitiveData({
        db: {
          password: "secret",
          host: "localhost",
        },
      });
      const nested = result.db as Record<string, unknown>;
      expect(nested.password).toBe("***");
      expect(nested.host).toBe("localhost");
    });

    it("should handle empty objects", () => {
      expect(redactSensitiveData({})).toEqual({});
    });

    it("should pass through arrays as-is", () => {
      const result = redactSensitiveData({
        items: [1, 2, 3],
      });
      expect(result.items).toEqual([1, 2, 3]);
    });
  });

  describe("ConsoleLogger", () => {
    let consoleSpy: {
      log: ReturnType<typeof vi.spyOn>;
      error: ReturnType<typeof vi.spyOn>;
      warn: ReturnType<typeof vi.spyOn>;
      debug: ReturnType<typeof vi.spyOn>;
    };

    beforeEach(() => {
      consoleSpy = {
        log: vi.spyOn(console, "log").mockImplementation(() => {}),
        error: vi.spyOn(console, "error").mockImplementation(() => {}),
        warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
        debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      };
    });

    it("should log all levels at trace level", () => {
      const logger = new ConsoleLogger({ level: "trace" });
      logger.error("err");
      logger.warn("wrn");
      logger.info("inf");
      logger.debug("dbg");
      logger.trace("trc");

      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.log).toHaveBeenCalledTimes(1); // info
      expect(consoleSpy.debug).toHaveBeenCalledTimes(2); // debug + trace
    });

    it("should filter by log level", () => {
      const logger = new ConsoleLogger({ level: "warn" });
      logger.error("err");
      logger.warn("wrn");
      logger.info("inf");
      logger.debug("dbg");

      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.log).toHaveBeenCalledTimes(0);
      expect(consoleSpy.debug).toHaveBeenCalledTimes(0);
    });

    it("should output JSON when json mode enabled", () => {
      const logger = new ConsoleLogger({ level: "info", json: true });
      logger.info("test message", { operation: "deploy", host: "localhost" });

      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      const output = consoleSpy.log.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe("info");
      expect(parsed.message).toBe("test message");
      expect(parsed.operation).toBe("deploy");
      expect(parsed.host).toBe("localhost");
      expect(parsed.timestamp).toBeDefined();
    });

    it("should redact sensitive data in context", () => {
      const logger = new ConsoleLogger({ level: "info", json: true });
      logger.info("db connect", { password: "secret", host: "localhost" });

      const output = consoleSpy.log.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.password).toBe("***");
      expect(parsed.host).toBe("localhost");
    });
  });

  describe("NoopLogger", () => {
    it("should implement Logger interface without side effects", () => {
      const logger: Logger = new NoopLogger();
      // These should all be callable without error
      logger.error("msg");
      logger.warn("msg");
      logger.info("msg");
      logger.debug("msg");
      logger.trace("msg");
    });
  });

  describe("createLogger", () => {
    it("should create a ConsoleLogger", () => {
      const logger = createLogger({ level: "debug" });
      expect(logger).toBeInstanceOf(ConsoleLogger);
    });
  });
});
