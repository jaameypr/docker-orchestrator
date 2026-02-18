import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import Dockerode from "dockerode";
import { buildContainerConfig } from "../../src/builders/config-builder.js";
import {
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
} from "../../src/core/container.js";
import { executeCommand } from "../../src/core/exec.js";
import { imageExists, pullImage } from "../../src/core/image.js";

const dockerAvailable = existsSync("/var/run/docker.sock");
const describeDocker = dockerAvailable ? describe : describe.skip;

const TEST_IMAGE = "alpine:latest";
const TEST_PREFIX = "dorch-test-secres-";

describeDocker("Phase 5: Security & Resource Limits Integration", () => {
  let docker: Dockerode;
  const createdContainers: string[] = [];

  beforeAll(async () => {
    docker = new Dockerode({ socketPath: "/var/run/docker.sock" });
    if (!(await imageExists(docker, TEST_IMAGE))) {
      await pullImage(docker, TEST_IMAGE);
    }
  });

  afterAll(async () => {
    for (const id of createdContainers) {
      try {
        await stopContainer(docker, id, 2);
      } catch {
        /* ignore */
      }
      try {
        await removeContainer(docker, id, true);
      } catch {
        /* ignore */
      }
    }
  });

  describe("Memory Limits", () => {
    it("should start container with memory limit and verify via inspect", async () => {
      const { config } = buildContainerConfig({
        image: TEST_IMAGE,
        name: `${TEST_PREFIX}mem-${Date.now()}`,
        cmd: ["sleep", "30"],
        resources: {
          memory: { limit: "64m" },
        },
      });

      const id = await createContainer(docker, config);
      createdContainers.push(id);
      await startContainer(docker, id);

      const container = docker.getContainer(id);
      const info = await container.inspect();
      expect(info.HostConfig.Memory).toBe(67108864); // 64MB in bytes
    });
  });

  describe("CPU Limits", () => {
    it("should start container with CPU limit via NanoCPUs", async () => {
      const { config } = buildContainerConfig({
        image: TEST_IMAGE,
        name: `${TEST_PREFIX}cpu-${Date.now()}`,
        cmd: ["sleep", "30"],
        resources: {
          cpu: { nanoCpus: 0.5 },
        },
      });

      const id = await createContainer(docker, config);
      createdContainers.push(id);
      await startContainer(docker, id);

      const container = docker.getContainer(id);
      const info = await container.inspect();
      expect(info.HostConfig.NanoCpus).toBe(500000000);
    });
  });

  describe("PID Limits", () => {
    it("should start container with PID limit", async () => {
      const { config } = buildContainerConfig({
        image: TEST_IMAGE,
        name: `${TEST_PREFIX}pid-${Date.now()}`,
        cmd: ["sleep", "30"],
        resources: {
          pids: { limit: 50 },
        },
      });

      const id = await createContainer(docker, config);
      createdContainers.push(id);
      await startContainer(docker, id);

      const container = docker.getContainer(id);
      const info = await container.inspect();
      expect(info.HostConfig.PidsLimit).toBe(50);
    });
  });

  describe("Security: Non-root user", () => {
    it("should run container as non-root user", async () => {
      const { config } = buildContainerConfig({
        image: TEST_IMAGE,
        name: `${TEST_PREFIX}nonroot-${Date.now()}`,
        cmd: ["sleep", "30"],
        security: {
          user: "1000:1000",
        },
      });

      const id = await createContainer(docker, config);
      createdContainers.push(id);
      await startContainer(docker, id);

      const result = await executeCommand(docker, id, ["id", "-u"]);
      expect(result.stdout.trim()).toBe("1000");
    });
  });

  describe("Security: Read-only filesystem", () => {
    it("should prevent writes to root filesystem", async () => {
      const { config } = buildContainerConfig({
        image: TEST_IMAGE,
        name: `${TEST_PREFIX}readonly-${Date.now()}`,
        cmd: ["sleep", "30"],
        security: {
          user: "1000:1000",
          readonlyRootfs: true,
        },
      });

      const id = await createContainer(docker, config);
      createdContainers.push(id);
      await startContainer(docker, id);

      // Writing to root FS should fail
      const result = await executeCommand(docker, id, [
        "sh",
        "-c",
        "touch /testfile 2>&1 || echo READONLY",
      ]);
      expect(result.stdout).toContain("READONLY");
    });
  });

  describe("Security: Capabilities", () => {
    it("should drop all capabilities when using minimal profile", async () => {
      const { config } = buildContainerConfig({
        image: TEST_IMAGE,
        name: `${TEST_PREFIX}capdrop-${Date.now()}`,
        cmd: ["sleep", "30"],
        security: {
          user: "1000:1000",
          capDrop: ["ALL"],
        },
      });

      const id = await createContainer(docker, config);
      createdContainers.push(id);
      await startContainer(docker, id);

      const container = docker.getContainer(id);
      const info = await container.inspect();
      expect(info.HostConfig.CapDrop).toContain("ALL");
    });

    it("should add specific capabilities after dropping all", async () => {
      const { config } = buildContainerConfig({
        image: TEST_IMAGE,
        name: `${TEST_PREFIX}capadd-${Date.now()}`,
        cmd: ["sleep", "30"],
        security: {
          user: "1000:1000",
          capDrop: ["ALL"],
          capAdd: ["NET_RAW"],
        },
      });

      const id = await createContainer(docker, config);
      createdContainers.push(id);
      await startContainer(docker, id);

      const container = docker.getContainer(id);
      const info = await container.inspect();
      expect(info.HostConfig.CapDrop).toContain("ALL");
      expect(info.HostConfig.CapAdd).toContain("NET_RAW");
    });
  });

  describe("Restart Policy", () => {
    it("should apply on-failure restart policy with maxRetries", async () => {
      const { config } = buildContainerConfig({
        image: TEST_IMAGE,
        name: `${TEST_PREFIX}restart-${Date.now()}`,
        cmd: ["sleep", "30"],
        advancedRestartPolicy: { type: "on-failure", maxRetries: 3 },
      });

      const id = await createContainer(docker, config);
      createdContainers.push(id);

      const container = docker.getContainer(id);
      const info = await container.inspect();
      expect(info.HostConfig.RestartPolicy?.Name).toBe("on-failure");
      expect(info.HostConfig.RestartPolicy?.MaximumRetryCount).toBe(3);
    });
  });

  describe("Security Presets", () => {
    it("should apply hardened security preset", async () => {
      const { config } = buildContainerConfig({
        image: TEST_IMAGE,
        name: `${TEST_PREFIX}hardened-${Date.now()}`,
        cmd: ["sleep", "30"],
        securityProfile: "hardened",
      });

      const id = await createContainer(docker, config);
      createdContainers.push(id);
      await startContainer(docker, id);

      const container = docker.getContainer(id);
      const info = await container.inspect();
      expect(info.Config.User).toBe("1000:1000");
      expect(info.HostConfig.ReadonlyRootfs).toBe(true);
      expect(info.HostConfig.CapDrop).toContain("ALL");
      expect(info.HostConfig.SecurityOpt).toContain("no-new-privileges");
    });
  });

  describe("Config Builder Warnings", () => {
    it("should produce production warnings when no limits set", () => {
      const { warnings } = buildContainerConfig({
        image: TEST_IMAGE,
        production: true,
      });
      const codes = warnings.map((w) => w.code);
      expect(codes).toContain("no-memory-limit");
      expect(codes).toContain("no-cpu-limit");
      expect(codes).toContain("no-pid-limit");
    });

    it("should suppress warnings with suppressWarnings", () => {
      const { warnings } = buildContainerConfig({
        image: TEST_IMAGE,
        production: true,
        suppressWarnings: ["no-memory-limit", "no-cpu-limit", "no-pid-limit"],
      });
      const codes = warnings.map((w) => w.code);
      expect(codes).not.toContain("no-memory-limit");
      expect(codes).not.toContain("no-cpu-limit");
      expect(codes).not.toContain("no-pid-limit");
    });

    it("should warn for privileged mode", () => {
      const { warnings } = buildContainerConfig({
        image: TEST_IMAGE,
        security: { privileged: true },
      });
      expect(warnings).toContainEqual(
        expect.objectContaining({ code: "privileged-mode", level: "critical" }),
      );
    });
  });
});
