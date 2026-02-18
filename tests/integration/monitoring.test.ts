import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import Docker from "dockerode";
import {
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
} from "../../src/core/container.js";
import { imageExists, pullImage } from "../../src/core/image.js";
import { buildContainerConfig } from "../../src/builders/config-builder.js";
import { getContainerLogs, tailLogs, streamLogs } from "../../src/monitoring/logs.js";
import { getMetrics, streamMetrics } from "../../src/monitoring/metrics.js";
import { subscribeEvents } from "../../src/monitoring/events.js";
import type { LogEntry } from "../../src/types/logs.js";
import type { DockerEvent } from "../../src/types/events.js";

const TEST_IMAGE = "alpine:latest";
const TEST_PREFIX = "docker-orch-mon-test-";

const createdContainers: string[] = [];
const dockerAvailable = existsSync("/var/run/docker.sock");
const describeDocker = dockerAvailable ? describe : describe.skip;

describeDocker("Integration: Monitoring & Logs", () => {
  const docker = new Docker({ socketPath: "/var/run/docker.sock" });

  beforeAll(async () => {
    const exists = await imageExists(docker, TEST_IMAGE);
    if (!exists) {
      await pullImage(docker, TEST_IMAGE);
    }
  });

  afterAll(async () => {
    for (const id of createdContainers) {
      try {
        await removeContainer(docker, id, true);
      } catch {
        // ignore
      }
    }
  });

  describe("Logs", () => {
    it("should retrieve logs from a container with known output", async () => {
      const name = `${TEST_PREFIX}logs-${Date.now()}`;
      const { config } = buildContainerConfig({
        image: TEST_IMAGE,
        name,
        cmd: ["sh", "-c", 'echo "hello from stdout" && echo "hello from stderr" >&2'],
      });

      const id = await createContainer(docker, config);
      createdContainers.push(id);
      await startContainer(docker, id);

      // Wait for container to finish
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const entries = (await getContainerLogs(docker, id, {
        follow: false,
        stdout: true,
        stderr: true,
      })) as LogEntry[];

      expect(entries.length).toBeGreaterThanOrEqual(2);

      const stdoutEntries = entries.filter((e) => e.stream === "stdout");
      const stderrEntries = entries.filter((e) => e.stream === "stderr");

      expect(stdoutEntries.length).toBeGreaterThanOrEqual(1);
      expect(stderrEntries.length).toBeGreaterThanOrEqual(1);

      expect(stdoutEntries.some((e) => e.message.includes("hello from stdout"))).toBe(true);
      expect(stderrEntries.some((e) => e.message.includes("hello from stderr"))).toBe(true);
    });

    it("should tail last N lines", async () => {
      const name = `${TEST_PREFIX}tail-${Date.now()}`;
      const { config } = buildContainerConfig({
        image: TEST_IMAGE,
        name,
        cmd: ["sh", "-c", 'for i in $(seq 1 20); do echo "line $i"; done'],
      });

      const id = await createContainer(docker, config);
      createdContainers.push(id);
      await startContainer(docker, id);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const entries = await tailLogs(docker, id, 5);
      expect(entries.length).toBeLessThanOrEqual(5);
    });

    it("should stream live logs from a running container", async () => {
      const name = `${TEST_PREFIX}stream-${Date.now()}`;
      const { config } = buildContainerConfig({
        image: TEST_IMAGE,
        name,
        cmd: ["sh", "-c", 'for i in 1 2 3; do echo "live line $i"; sleep 0.5; done'],
      });

      const id = await createContainer(docker, config);
      createdContainers.push(id);
      await startContainer(docker, id);

      const logStream = await streamLogs(docker, id);
      const entries: LogEntry[] = [];

      logStream.on("data", (entry: LogEntry) => {
        entries.push(entry);
      });

      // Wait for logs to arrive
      await new Promise((resolve) => setTimeout(resolve, 4000));

      logStream.stop();

      expect(entries.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Metrics", () => {
    it("should get metrics from a running container", async () => {
      const name = `${TEST_PREFIX}metrics-${Date.now()}`;
      const { config } = buildContainerConfig({
        image: TEST_IMAGE,
        name,
        cmd: ["sh", "-c", "while true; do :; done"],
      });

      const id = await createContainer(docker, config);
      createdContainers.push(id);
      await startContainer(docker, id);

      // Give it a moment to generate some CPU usage
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const metrics = await getMetrics(docker, id);

      expect(metrics.containerId).toBe(id);
      expect(metrics.cpu.percent).toBeGreaterThanOrEqual(0);
      expect(metrics.cpu.cores).toBeGreaterThanOrEqual(1);
      expect(metrics.memory.usedBytes).toBeGreaterThan(0);
      expect(metrics.memory.limitBytes).toBeGreaterThan(0);
      expect(metrics.memory.percent).toBeGreaterThanOrEqual(0);
      expect(metrics.timestamp).toBeInstanceOf(Date);

      // Stop the busy-wait container
      await stopContainer(docker, id, 1);
    });

    it("should stream metrics from a running container", async () => {
      const name = `${TEST_PREFIX}metrics-stream-${Date.now()}`;
      const { config } = buildContainerConfig({
        image: TEST_IMAGE,
        name,
        cmd: ["sh", "-c", "while true; do :; done"],
      });

      const id = await createContainer(docker, config);
      createdContainers.push(id);
      await startContainer(docker, id);

      const metricsStream = await streamMetrics(docker, id);
      const snapshots: unknown[] = [];

      metricsStream.on("data", (m) => snapshots.push(m));

      // Wait for at least one metrics snapshot
      await new Promise((resolve) => setTimeout(resolve, 5000));

      metricsStream.stop();

      expect(snapshots.length).toBeGreaterThanOrEqual(1);

      await stopContainer(docker, id, 1);
    });
  });

  describe("Events", () => {
    it("should receive container start and stop events", async () => {
      const sub = await subscribeEvents(docker, { type: "container" });
      const events: DockerEvent[] = [];

      sub.on("event", (event) => events.push(event));

      // Create and start a container to trigger events
      const name = `${TEST_PREFIX}events-${Date.now()}`;
      const { config } = buildContainerConfig({
        image: TEST_IMAGE,
        name,
        cmd: ["sleep", "5"],
      });

      const id = await createContainer(docker, config);
      createdContainers.push(id);
      await startContainer(docker, id);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      await stopContainer(docker, id, 1);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      sub.unsubscribe();

      const startEvents = events.filter((e) => e.action === "start");
      const dieEvents = events.filter((e) => e.action === "die" || e.action === "stop");

      expect(startEvents.length).toBeGreaterThanOrEqual(1);
      expect(dieEvents.length).toBeGreaterThanOrEqual(1);
    });

    it("should filter events by specific container", async () => {
      const name1 = `${TEST_PREFIX}evt-a-${Date.now()}`;
      const name2 = `${TEST_PREFIX}evt-b-${Date.now()}`;

      const { config: config1 } = buildContainerConfig({ image: TEST_IMAGE, name: name1, cmd: ["sleep", "5"] });
      const { config: config2 } = buildContainerConfig({ image: TEST_IMAGE, name: name2, cmd: ["sleep", "5"] });

      const id1 = await createContainer(docker, config1);
      createdContainers.push(id1);

      const sub = await subscribeEvents(docker, { containerId: id1 });
      const events: DockerEvent[] = [];
      sub.on("event", (event) => events.push(event));

      const id2 = await createContainer(docker, config2);
      createdContainers.push(id2);

      await startContainer(docker, id1);
      await startContainer(docker, id2);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      sub.unsubscribe();

      // All events should be for id1 only
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.every((e) => e.actor.id === id1)).toBe(true);
    });
  });
});
