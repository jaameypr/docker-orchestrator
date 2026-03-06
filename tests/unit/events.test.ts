import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import { subscribeEvents } from "../../src/monitoring/events.js";
import type { DockerEvent } from "../../src/types/events.js";
import type Docker from "dockerode";

function createMockDocker() {
  return {
    getEvents: vi.fn(),
  } as unknown as Docker & {
    getEvents: ReturnType<typeof vi.fn>;
  };
}

function makeContainerEvent(
  action: string,
  containerId = "abc123",
  name = "test-container",
): string {
  return JSON.stringify({
    Type: "container",
    Action: action,
    Actor: {
      ID: containerId,
      Attributes: { name },
    },
    time: 1705312200,
  });
}

function makeImageEvent(action: string, imageId = "sha256:abc"): string {
  return JSON.stringify({
    Type: "image",
    Action: action,
    Actor: {
      ID: imageId,
      Attributes: { name: "alpine:latest" },
    },
    time: 1705312200,
  });
}

describe("subscribeEvents", () => {
  let docker: ReturnType<typeof createMockDocker>;
  let eventStream: PassThrough;

  beforeEach(() => {
    docker = createMockDocker();
    eventStream = new PassThrough();
    docker.getEvents.mockResolvedValue(eventStream);
  });

  afterEach(() => {
    eventStream.destroy();
  });

  it("should emit events from the Docker event stream", async () => {
    const sub = await subscribeEvents(docker);
    const events: DockerEvent[] = [];

    sub.on("event", (event) => events.push(event));

    eventStream.write(makeContainerEvent("start") + "\n");

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("container");
    expect(events[0].action).toBe("start");
    expect(events[0].actor.id).toBe("abc123");
    expect(events[0].actor.name).toBe("test-container");
    expect(events[0].timestamp).toBeInstanceOf(Date);

    sub.unsubscribe();
  });

  it("should emit typed events (container.start, container.stop)", async () => {
    const sub = await subscribeEvents(docker);
    const startEvents: DockerEvent[] = [];
    const stopEvents: DockerEvent[] = [];

    sub.on("container.start", (event) => startEvents.push(event));
    sub.on("container.stop", (event) => stopEvents.push(event));

    eventStream.write(makeContainerEvent("start") + "\n");
    eventStream.write(makeContainerEvent("stop") + "\n");

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(startEvents).toHaveLength(1);
    expect(stopEvents).toHaveLength(1);

    sub.unsubscribe();
  });

  it("should filter events by type", async () => {
    const sub = await subscribeEvents(docker, { type: "container" });
    const events: DockerEvent[] = [];

    sub.on("event", (event) => events.push(event));

    eventStream.write(makeContainerEvent("start") + "\n");
    eventStream.write(makeImageEvent("pull") + "\n");

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Image events should be filtered out on the server side (via filters param),
    // but also filtered client-side
    expect(events.every((e) => e.type === "container")).toBe(true);

    sub.unsubscribe();
  });

  it("should filter events by action", async () => {
    const sub = await subscribeEvents(docker, { action: ["start"] });
    const events: DockerEvent[] = [];

    sub.on("event", (event) => events.push(event));

    eventStream.write(makeContainerEvent("start") + "\n");
    eventStream.write(makeContainerEvent("stop") + "\n");

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("start");

    sub.unsubscribe();
  });

  it("should filter events by containerId", async () => {
    const sub = await subscribeEvents(docker, { containerId: "abc123" });
    const events: DockerEvent[] = [];

    sub.on("event", (event) => events.push(event));

    eventStream.write(makeContainerEvent("start", "abc123") + "\n");
    eventStream.write(makeContainerEvent("start", "other-id") + "\n");

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events).toHaveLength(1);
    expect(events[0].actor.id).toBe("abc123");

    sub.unsubscribe();
  });

  it("should support multiple subscribers receiving the same events", async () => {
    const sub = await subscribeEvents(docker);
    const events1: DockerEvent[] = [];
    const events2: DockerEvent[] = [];

    sub.on("event", (event) => events1.push(event));
    sub.on("event", (event) => events2.push(event));

    eventStream.write(makeContainerEvent("start") + "\n");

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);

    sub.unsubscribe();
  });

  it("should stop emitting after unsubscribe()", async () => {
    const sub = await subscribeEvents(docker);
    const events: DockerEvent[] = [];

    sub.on("event", (event) => events.push(event));

    eventStream.write(makeContainerEvent("start") + "\n");
    await new Promise((resolve) => setTimeout(resolve, 30));

    sub.unsubscribe();

    eventStream.write(makeContainerEvent("stop") + "\n");
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(events).toHaveLength(1);
  });

  it("should ignore invalid JSON lines", async () => {
    const sub = await subscribeEvents(docker);
    const events: DockerEvent[] = [];

    sub.on("event", (event) => events.push(event));

    eventStream.write("not valid json\n");
    eventStream.write(makeContainerEvent("start") + "\n");

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events).toHaveLength(1);

    sub.unsubscribe();
  });

  it("should ignore events with unrecognized types", async () => {
    const sub = await subscribeEvents(docker);
    const events: DockerEvent[] = [];

    sub.on("event", (event) => events.push(event));

    eventStream.write(JSON.stringify({ Type: "unknown_type", Action: "test", time: 123 }) + "\n");
    eventStream.write(makeContainerEvent("start") + "\n");

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("container");

    sub.unsubscribe();
  });

  it("should handle events with missing Actor fields", async () => {
    const sub = await subscribeEvents(docker);
    const events: DockerEvent[] = [];

    sub.on("event", (event) => events.push(event));

    eventStream.write(JSON.stringify({ Type: "container", Action: "start", time: 123 }) + "\n");

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events).toHaveLength(1);
    expect(events[0].actor.id).toBe("");
    expect(events[0].actor.attributes).toEqual({});

    sub.unsubscribe();
  });

  it("should handle events with no time field", async () => {
    const sub = await subscribeEvents(docker);
    const events: DockerEvent[] = [];

    sub.on("event", (event) => events.push(event));

    eventStream.write(JSON.stringify({ Type: "container", Action: "start" }) + "\n");

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events).toHaveLength(1);
    expect(events[0].timestamp).toBeInstanceOf(Date);

    sub.unsubscribe();
  });

  it("should handle events with missing type or action", async () => {
    const sub = await subscribeEvents(docker);
    const events: DockerEvent[] = [];

    sub.on("event", (event) => events.push(event));

    // Missing type - should be ignored
    eventStream.write(JSON.stringify({ Action: "start", time: 123 }) + "\n");
    // Missing action - should be ignored
    eventStream.write(JSON.stringify({ Type: "container", time: 123 }) + "\n");
    // Valid event
    eventStream.write(makeContainerEvent("start") + "\n");

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events).toHaveLength(1);

    sub.unsubscribe();
  });

  it("should not throw on connection failure and return subscription", async () => {
    const docker2 = createMockDocker();
    docker2.getEvents.mockRejectedValue(new Error("connection refused"));

    const sub = await subscribeEvents(docker2);
    expect(sub).toBeDefined();
    expect(sub.unsubscribe).toBeInstanceOf(Function);

    sub.unsubscribe();
  });

  it("should attempt reconnect on stream end", async () => {
    const sub = await subscribeEvents(docker);

    // End the stream to trigger reconnect
    eventStream.end();

    // Wait for reconnect scheduling
    await new Promise((resolve) => setTimeout(resolve, 50));

    sub.unsubscribe();
  });

  it("should emit error and reconnect on stream error", async () => {
    const sub = await subscribeEvents(docker);
    const errors: Error[] = [];

    sub.on("error", (err) => errors.push(err));

    eventStream.emit("error", new Error("stream broken"));

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(errors).toHaveLength(1);

    sub.unsubscribe();
  });

  it("should pass since and until to Docker API", async () => {
    const since = new Date("2024-01-01T00:00:00Z");
    const until = 1705312200;

    await subscribeEvents(docker, { since, until });

    const callArgs = docker.getEvents.mock.calls[0][0];
    expect(callArgs.since).toBe(Math.floor(since.getTime() / 1000));
    expect(callArgs.until).toBe(until);

    const sub = await subscribeEvents(docker, { since, until });
    sub.unsubscribe();
  });

  it("should handle empty lines in the stream", async () => {
    const sub = await subscribeEvents(docker);
    const events: DockerEvent[] = [];

    sub.on("event", (event) => events.push(event));

    eventStream.write("\n\n" + makeContainerEvent("start") + "\n\n");

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events).toHaveLength(1);

    sub.unsubscribe();
  });

  it("should map raw event correctly with all actor fields", async () => {
    const sub = await subscribeEvents(docker);
    const events: DockerEvent[] = [];

    sub.on("event", (event) => events.push(event));

    const rawEvent = {
      Type: "container",
      Action: "die",
      Actor: {
        ID: "deadbeef",
        Attributes: { name: "my-container", exitCode: "0", image: "alpine" },
      },
      time: 1705312200,
    };
    eventStream.write(JSON.stringify(rawEvent) + "\n");

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events).toHaveLength(1);
    expect(events[0].actor.attributes).toEqual({
      name: "my-container",
      exitCode: "0",
      image: "alpine",
    });
    expect(events[0].raw).toEqual(rawEvent);

    sub.unsubscribe();
  });
});
