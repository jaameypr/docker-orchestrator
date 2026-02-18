import { describe, it, expect, vi, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import { ContainerConsole } from "../../src/core/console.js";
import { ConsoleDisconnectedError } from "../../src/errors/base.js";

// ---------------------------------------------------------------------------
// Mock Docker
// ---------------------------------------------------------------------------

function createMockDocker(options?: { running?: boolean; openStdin?: boolean; tty?: boolean }) {
  const stream = new PassThrough();
  const inspectData = {
    State: { Running: options?.running ?? true },
    Config: {
      OpenStdin: options?.openStdin ?? true,
      Tty: options?.tty ?? false,
    },
  };

  const container = {
    inspect: vi.fn().mockResolvedValue(inspectData),
    attach: vi.fn().mockResolvedValue(stream),
  };

  const docker = {
    getContainer: vi.fn().mockReturnValue(container),
  };

  return { docker, container, stream };
}

// ---------------------------------------------------------------------------
// ContainerConsole
// ---------------------------------------------------------------------------

describe("ContainerConsole", () => {
  let consoleInstance: ContainerConsole;

  afterEach(() => {
    if (consoleInstance) {
      consoleInstance.disconnect();
    }
  });

  describe("connect/disconnect lifecycle", () => {
    it("should connect and set status to connected", async () => {
      const { docker, stream } = createMockDocker();
      mockStream = stream;

      consoleInstance = new ContainerConsole(docker as never, "test-container");
      await consoleInstance.connect();

      expect(consoleInstance.status).toBe("connected");
    });

    it("should set status to disconnected after disconnect()", async () => {
      const { docker, stream } = createMockDocker();
      mockStream = stream;

      consoleInstance = new ContainerConsole(docker as never, "test-container");
      await consoleInstance.connect();
      consoleInstance.disconnect();

      expect(consoleInstance.status).toBe("disconnected");
    });

    it("should emit connected event on connect", async () => {
      const { docker, stream } = createMockDocker();
      mockStream = stream;

      consoleInstance = new ContainerConsole(docker as never, "test-container");
      const connectSpy = vi.fn();
      consoleInstance.on("connected", connectSpy);
      await consoleInstance.connect();

      expect(connectSpy).toHaveBeenCalled();
    });

    it("should emit disconnected event on disconnect", async () => {
      const { docker, stream } = createMockDocker();
      mockStream = stream;

      consoleInstance = new ContainerConsole(docker as never, "test-container");
      await consoleInstance.connect();

      const disconnectSpy = vi.fn();
      consoleInstance.on("disconnected", disconnectSpy);
      consoleInstance.disconnect();

      expect(disconnectSpy).toHaveBeenCalled();
    });

    it("should have zero uptime when disconnected", () => {
      const { docker } = createMockDocker();
      consoleInstance = new ContainerConsole(docker as never, "test-container");
      expect(consoleInstance.uptime).toBe(0);
    });

    it("should track uptime when connected", async () => {
      const { docker, stream } = createMockDocker();
      mockStream = stream;

      consoleInstance = new ContainerConsole(docker as never, "test-container");
      await consoleInstance.connect();

      // Small delay to get measurable uptime
      await new Promise((r) => setTimeout(r, 10));
      expect(consoleInstance.uptime).toBeGreaterThan(0);
    });
  });

  describe("send", () => {
    it("should write command with newline to stream", async () => {
      const { docker, stream } = createMockDocker();
      mockStream = stream;

      consoleInstance = new ContainerConsole(docker as never, "test-container");
      await consoleInstance.connect();

      const writeSpy = vi.spyOn(stream, "write");
      consoleInstance.send("hello");

      expect(writeSpy).toHaveBeenCalledWith("hello\n");
    });

    it("should throw ConsoleDisconnectedError when not connected (queue disabled)", () => {
      const { docker } = createMockDocker();
      consoleInstance = new ContainerConsole(docker as never, "test-container");

      expect(() => consoleInstance.send("hello")).toThrow(ConsoleDisconnectedError);
    });

    it("should queue commands when disconnected and queueCommands enabled", () => {
      const { docker } = createMockDocker();
      consoleInstance = new ContainerConsole(docker as never, "test-container", {
        queueCommands: true,
      });

      // Should not throw
      expect(() => consoleInstance.send("queued-cmd")).not.toThrow();
    });
  });

  describe("output buffer", () => {
    it("should buffer output lines", async () => {
      const { docker, stream } = createMockDocker({ tty: true });
      mockStream = stream;

      consoleInstance = new ContainerConsole(docker as never, "test-container");
      await consoleInstance.connect();

      // Simulate output by writing to the stream (TTY mode - data event on stream)
      stream.push(Buffer.from("line1\nline2\n"));

      // Wait for event processing
      await new Promise((r) => setTimeout(r, 50));

      const buffer = consoleInstance.getBuffer();
      expect(buffer.length).toBeGreaterThanOrEqual(2);
      expect(buffer[0].message).toBe("line1");
      expect(buffer[1].message).toBe("line2");
    });

    it("should clear buffer", async () => {
      const { docker, stream } = createMockDocker({ tty: true });
      mockStream = stream;

      consoleInstance = new ContainerConsole(docker as never, "test-container");
      await consoleInstance.connect();

      stream.push(Buffer.from("data\n"));
      await new Promise((r) => setTimeout(r, 50));

      consoleInstance.clearBuffer();
      expect(consoleInstance.getBuffer()).toHaveLength(0);
    });

    it("should respect outputBufferSize (ring buffer)", async () => {
      const { docker, stream } = createMockDocker({ tty: true });
      mockStream = stream;

      consoleInstance = new ContainerConsole(docker as never, "test-container", {
        outputBufferSize: 3,
      });
      await consoleInstance.connect();

      stream.push(Buffer.from("a\nb\nc\nd\ne\n"));
      await new Promise((r) => setTimeout(r, 50));

      const buffer = consoleInstance.getBuffer();
      expect(buffer.length).toBe(3);
      // The oldest entries should have been dropped
      expect(buffer[0].message).toBe("c");
      expect(buffer[1].message).toBe("d");
      expect(buffer[2].message).toBe("e");
    });
  });

  describe("output events", () => {
    it("should emit output events for each line", async () => {
      const { docker, stream } = createMockDocker({ tty: true });
      mockStream = stream;

      consoleInstance = new ContainerConsole(docker as never, "test-container");
      const outputSpy = vi.fn();
      consoleInstance.on("output", outputSpy);

      await consoleInstance.connect();

      stream.push(Buffer.from("hello world\n"));
      await new Promise((r) => setTimeout(r, 50));

      expect(outputSpy).toHaveBeenCalled();
      expect(outputSpy.mock.calls[0][0]).toMatchObject({
        stream: "stdout",
        message: "hello world",
      });
    });

    it("should include timestamp in output lines", async () => {
      const { docker, stream } = createMockDocker({ tty: true });
      mockStream = stream;

      consoleInstance = new ContainerConsole(docker as never, "test-container");
      const outputSpy = vi.fn();
      consoleInstance.on("output", outputSpy);

      await consoleInstance.connect();

      stream.push(Buffer.from("test\n"));
      await new Promise((r) => setTimeout(r, 50));

      expect(outputSpy.mock.calls[0][0].timestamp).toBeInstanceOf(Date);
    });
  });
});
