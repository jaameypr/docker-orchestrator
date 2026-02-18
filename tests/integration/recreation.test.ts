import { describe, it, expect, afterAll } from "vitest";
import { existsSync } from "node:fs";
import Docker from "dockerode";
import {
  createContainer,
  startContainer,
  removeContainer,
  inspectContainer,
} from "../../src/core/container.js";
import { executeCommand } from "../../src/core/exec.js";
import { recreateContainer } from "../../src/core/container-recreation.js";
import { buildContainerConfig } from "../../src/builders/config-builder.js";

const TEST_IMAGE = "alpine:latest";
const TEST_PREFIX = "docker-orch-recreate-test-";

const createdContainers: string[] = [];
const dockerAvailable = existsSync("/var/run/docker.sock");
const describeDocker = dockerAvailable ? describe : describe.skip;

describeDocker("Integration: Container Recreation", () => {
  const docker = new Docker({ socketPath: "/var/run/docker.sock" });

  afterAll(async () => {
    // Cleanup all test containers
    for (const id of createdContainers) {
      try {
        await removeContainer(docker, id, true);
      } catch {
        // Ignore
      }
    }

    // Also clean up any containers with test prefix
    try {
      const all = await docker.listContainers({ all: true });
      for (const c of all) {
        const name = (c.Names[0] ?? "").replace(/^\//, "");
        if (name.startsWith(TEST_PREFIX) || name.includes("_old_") || name.includes("_new_")) {
          try {
            await docker.getContainer(c.Id).remove({ force: true });
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Ignore
    }
  });

  it("should recreate container with new env var", async () => {
    const containerName = `${TEST_PREFIX}env-${Date.now()}`;
    const { config } = buildContainerConfig({
      image: TEST_IMAGE,
      name: containerName,
      cmd: ["sleep", "120"],
      env: { ORIGINAL_VAR: "original" },
    });

    const id = await createContainer(docker, config);
    createdContainers.push(id);
    await startContainer(docker, id);

    // Verify original env
    const origResult = await executeCommand(docker, id, "env");
    expect(origResult.stdout).toContain("ORIGINAL_VAR=original");

    // Recreate with new env var
    const result = await recreateContainer(docker, id, {
      env: { NEW_VAR: "added" },
    });

    createdContainers.push(result.newContainerId);
    expect(result.rollbackStatus).toBe("not_needed");

    // Verify new container has both env vars
    const newResult = await executeCommand(docker, result.newContainerId, "env");
    expect(newResult.stdout).toContain("ORIGINAL_VAR=original");
    expect(newResult.stdout).toContain("NEW_VAR=added");
  });

  it("should recreate container with named volume data preserved", async () => {
    const containerName = `${TEST_PREFIX}vol-${Date.now()}`;
    const volumeName = `${TEST_PREFIX}vol-data-${Date.now()}`;

    // Create a named volume
    await docker.createVolume({ Name: volumeName });

    const config: Docker.ContainerCreateOptions = {
      Image: TEST_IMAGE,
      name: containerName,
      Cmd: ["sleep", "120"],
      HostConfig: {
        Binds: [`${volumeName}:/data`],
      },
    };

    const id = await createContainer(docker, config);
    createdContainers.push(id);
    await startContainer(docker, id);

    // Write data to the named volume
    await executeCommand(docker, id, ["sh", "-c", "echo 'persistent data' > /data/test.txt"]);

    // Recreate
    const result = await recreateContainer(docker, id);
    createdContainers.push(result.newContainerId);

    // Verify data persists in new container
    const dataResult = await executeCommand(docker, result.newContainerId, [
      "cat", "/data/test.txt",
    ]);
    expect(dataResult.stdout.trim()).toBe("persistent data");

    // Cleanup volume
    try {
      await docker.getVolume(volumeName).remove();
    } catch {
      // Ignore
    }
  });

  it("should rollback when recreating with invalid image", async () => {
    const containerName = `${TEST_PREFIX}rollback-${Date.now()}`;
    const { config } = buildContainerConfig({
      image: TEST_IMAGE,
      name: containerName,
      cmd: ["sleep", "120"],
    });

    const id = await createContainer(docker, config);
    createdContainers.push(id);
    await startContainer(docker, id);

    // Try to recreate with a nonexistent image
    await expect(
      recreateContainer(docker, id, {
        image: "nonexistent-image-that-does-not-exist:99.99.99",
      }),
    ).rejects.toThrow();

    // Verify old container is still running (rollback succeeded)
    const info = await inspectContainer(docker, id);
    expect(info.state.running).toBe(true);
  });
});
