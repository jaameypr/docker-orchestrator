import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import Docker from "dockerode";
import { createContainer, startContainer, removeContainer } from "../../src/core/container.js";
import { executeCommand, executeScript } from "../../src/core/exec.js";
import { buildContainerConfig } from "../../src/builders/config-builder.js";
import { CommandFailedError } from "../../src/errors/base.js";

const TEST_IMAGE = "alpine:latest";
const TEST_PREFIX = "docker-orch-exec-test-";

const createdContainers: string[] = [];
const dockerAvailable = existsSync("/var/run/docker.sock");
const describeDocker = dockerAvailable ? describe : describe.skip;

describeDocker("Integration: Exec Operations", () => {
  const docker = new Docker({ socketPath: "/var/run/docker.sock" });
  let containerId: string;

  beforeAll(async () => {
    const { config } = buildContainerConfig({
      image: TEST_IMAGE,
      name: `${TEST_PREFIX}${Date.now()}`,
      cmd: ["sleep", "120"],
    });

    containerId = await createContainer(docker, config);
    createdContainers.push(containerId);
    await startContainer(docker, containerId);
  });

  afterAll(async () => {
    for (const id of createdContainers) {
      try {
        await removeContainer(docker, id, true);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it("should execute echo command and get stdout", async () => {
    const result = await executeCommand(docker, containerId, ["echo", "test output"]);
    expect(result.stdout.trim()).toBe("test output");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should execute ls / and find expected directories", async () => {
    const result = await executeCommand(docker, containerId, "ls /");
    expect(result.stdout).toContain("bin");
    expect(result.stdout).toContain("etc");
    expect(result.stdout).toContain("tmp");
  });

  it("should return correct exit code for failed commands", async () => {
    await expect(executeCommand(docker, containerId, ["sh", "-c", "exit 42"])).rejects.toThrow(
      CommandFailedError,
    );

    try {
      await executeCommand(docker, containerId, ["sh", "-c", "exit 42"]);
    } catch (err) {
      expect(err).toBeInstanceOf(CommandFailedError);
      expect((err as CommandFailedError).exitCode).toBe(42);
    }
  });

  it("should pass env vars to exec", async () => {
    const result = await executeCommand(docker, containerId, ["env"], {
      env: ["CUSTOM_VAR=hello_world"],
    });
    expect(result.stdout).toContain("CUSTOM_VAR=hello_world");
  });

  it("should execute a script", async () => {
    const script = `#!/bin/sh
echo "line 1"
echo "line 2"
echo "sum: $((1 + 2))"`;

    const result = await executeScript(docker, containerId, script);
    expect(result.stdout).toContain("line 1");
    expect(result.stdout).toContain("line 2");
    expect(result.stdout).toContain("sum: 3");
  });
});
