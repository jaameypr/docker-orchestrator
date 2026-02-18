import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import Docker from "dockerode";
import {
  createContainer,
  startContainer,
  removeContainer,
} from "../../src/core/container.js";
import { buildContainerConfig } from "../../src/builders/config-builder.js";
import { attachContainer, sendCommand } from "../../src/core/attach.js";
import { ContainerConsole, createConsole } from "../../src/core/console.js";

const TEST_IMAGE = "alpine:latest";
const TEST_PREFIX = "docker-orch-attach-test-";

const createdContainers: string[] = [];
const dockerAvailable = existsSync("/var/run/docker.sock");
const describeDocker = dockerAvailable ? describe : describe.skip;

describeDocker("Integration: Attach / Console Operations", () => {
  const docker = new Docker({ socketPath: "/var/run/docker.sock" });

  afterAll(async () => {
    for (const id of createdContainers) {
      try {
        await removeContainer(docker, id, true);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("Basic Attach", () => {
    let containerId: string;

    beforeAll(async () => {
      const { config } = buildContainerConfig({
        image: TEST_IMAGE,
        name: `${TEST_PREFIX}cat-${Date.now()}`,
        cmd: ["cat"],
        interactive: true,
      });

      containerId = await createContainer(docker, config);
      createdContainers.push(containerId);
      await startContainer(docker, containerId);
    });

    it("should attach to a container with OpenStdin", async () => {
      const result = await attachContainer(docker, containerId);
      expect(result.stream).toBeDefined();
      expect(result.tty).toBe(false);
      expect(result.demuxed).not.toBeNull();

      // Send data and verify echo
      result.stream.write("hello\n");

      const output = await new Promise<string>((resolve) => {
        result.demuxed!.stdout.once("data", (chunk: Buffer) => {
          resolve(chunk.toString("utf-8"));
        });
      });

      expect(output.trim()).toBe("hello");
      result.stream.end();
    });
  });

  describe("sendCommand", () => {
    let containerId: string;

    beforeAll(async () => {
      const { config } = buildContainerConfig({
        image: TEST_IMAGE,
        name: `${TEST_PREFIX}send-${Date.now()}`,
        cmd: ["cat"],
        interactive: true,
      });

      containerId = await createContainer(docker, config);
      createdContainers.push(containerId);
      await startContainer(docker, containerId);
    });

    it("should send a command to the container", async () => {
      // sendCommand is fire-and-forget, just verify it doesn't throw
      await expect(sendCommand(docker, containerId, "hello")).resolves.not.toThrow();
    });
  });

  describe("Console", () => {
    let containerId: string;
    let console: ContainerConsole;

    beforeAll(async () => {
      const { config } = buildContainerConfig({
        image: TEST_IMAGE,
        name: `${TEST_PREFIX}console-${Date.now()}`,
        cmd: ["cat"],
        interactive: true,
      });

      containerId = await createContainer(docker, config);
      createdContainers.push(containerId);
      await startContainer(docker, containerId);
    });

    afterAll(() => {
      if (console) {
        console.disconnect();
      }
    });

    it("should create a console and send/receive data", async () => {
      console = await createConsole(docker, containerId);
      expect(console.status).toBe("connected");

      // Send a command and wait for output
      const result = await console.sendAndWait("test123", {
        matchOutput: "test123",
        timeout: 5000,
      });

      expect(result.output).toContain("test123");
      expect(result.duration).toBeGreaterThan(0);
    });

    it("should buffer output", async () => {
      if (!console || console.status !== "connected") {
        console = await createConsole(docker, containerId);
      }

      console.clearBuffer();
      console.send("buffered-line");

      await new Promise((r) => setTimeout(r, 500));

      const buffer = console.getBuffer();
      expect(buffer.length).toBeGreaterThanOrEqual(1);
      const found = buffer.find((line) => line.message.includes("buffered-line"));
      expect(found).toBeDefined();
    });
  });
});
