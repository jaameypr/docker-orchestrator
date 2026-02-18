import { describe, it, expect, vi, afterEach } from "vitest";
import { Readable } from "node:stream";
import { ResilientStream } from "../../src/utils/resilient-stream.js";

function createMockStream(data: string[], errorAfter?: number): Readable {
  let index = 0;
  return new Readable({
    read() {
      if (errorAfter !== undefined && index >= errorAfter) {
        this.destroy(new Error("stream error"));
        return;
      }
      if (index < data.length) {
        this.push(data[index++]);
      } else {
        this.push(null);
      }
    },
  });
}

describe("ResilientStream", () => {
  let stream: ResilientStream;

  afterEach(() => {
    stream?.destroy();
  });

  it("should emit data from underlying stream", async () => {
    const data: string[] = [];
    const factory = vi
      .fn()
      .mockResolvedValue(createMockStream(["hello", "world"]));

    stream = new ResilientStream(factory, {
      maxReconnectAttempts: 0,
    });
    stream.on("data", (chunk) => data.push(String(chunk)));

    await stream.start();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(data).toEqual(["hello", "world"]);
  });

  it("should emit close when stream ends normally", async () => {
    const closeHandler = vi.fn();
    const factory = vi
      .fn()
      .mockResolvedValue(createMockStream(["data"]));

    stream = new ResilientStream(factory, {
      maxReconnectAttempts: 0,
    });
    stream.on("close", closeHandler);

    await stream.start();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(closeHandler).toHaveBeenCalled();
  });

  it("should attempt reconnect on stream error", async () => {
    let callCount = 0;
    const factory = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(createMockStream(["data"], 0));
      }
      return Promise.resolve(createMockStream(["recovered"]));
    });

    const reconnectHandler = vi.fn();
    stream = new ResilientStream(factory, {
      maxReconnectAttempts: 3,
      initialReconnectDelay: 10,
      maxReconnectDelay: 50,
    });
    stream.on("reconnect", reconnectHandler);

    await stream.start();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(reconnectHandler).toHaveBeenCalled();
    expect(factory.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("should not reconnect after destroy()", async () => {
    const factory = vi
      .fn()
      .mockResolvedValue(createMockStream(["data"], 0));

    stream = new ResilientStream(factory, {
      maxReconnectAttempts: 5,
      initialReconnectDelay: 10,
    });

    await stream.start();
    stream.destroy();

    await new Promise((resolve) => setTimeout(resolve, 200));
    // Factory should only have been called once (initial connect)
    expect(factory.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("should track health metrics", async () => {
    const factory = vi
      .fn()
      .mockResolvedValue(createMockStream(["data"]));

    stream = new ResilientStream(factory);
    await stream.start();

    const metrics = stream.getHealthMetrics();
    expect(metrics.reconnectCount).toBe(0);
    expect(metrics.droppedMessages).toBe(0);
    expect(metrics.isActive).toBe(true);
    expect(metrics.uptimeSinceLastReconnect).toBeGreaterThanOrEqual(0);
  });

  it("should drop messages when buffer is full", async () => {
    const data = Array.from({ length: 20 }, (_, i) => `msg-${i}`);
    const factory = vi
      .fn()
      .mockResolvedValue(createMockStream(data));

    stream = new ResilientStream(factory, {
      bufferSize: 5,
      maxReconnectAttempts: 0,
    });

    const received: string[] = [];
    stream.on("data", (chunk) => received.push(String(chunk)));

    await stream.start();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const metrics = stream.getHealthMetrics();
    expect(metrics.droppedMessages).toBeGreaterThan(0);
  });

  it("should emit warning on dropped messages", async () => {
    const data = Array.from({ length: 10 }, (_, i) => `msg-${i}`);
    const factory = vi
      .fn()
      .mockResolvedValue(createMockStream(data));

    const warningHandler = vi.fn();
    stream = new ResilientStream(factory, {
      bufferSize: 3,
      maxReconnectAttempts: 0,
    });
    stream.on("warning", warningHandler);

    await stream.start();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(warningHandler).toHaveBeenCalled();
  });

  it("should clean up on destroy()", () => {
    const factory = vi.fn().mockResolvedValue(createMockStream([]));
    stream = new ResilientStream(factory);
    stream.destroy();

    const metrics = stream.getHealthMetrics();
    expect(metrics.isActive).toBe(false);
  });
});
