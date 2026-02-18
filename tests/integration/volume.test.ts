import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import Docker from "dockerode";
import {
  createVolume,
  removeVolume,
  inspectVolume,
  listVolumes,
  pruneVolumes,
  volumeExists,
} from "../../src/core/volume.js";
import {
  createContainer,
  startContainer,
  removeContainer,
  stopContainer,
} from "../../src/core/container.js";
import { executeCommand } from "../../src/core/exec.js";
import { pullImage, imageExists } from "../../src/core/image.js";
import { buildContainerConfig } from "../../src/builders/config-builder.js";
import {
  VolumeAlreadyExistsError,
  VolumeNotFoundError,
} from "../../src/errors/base.js";

const TEST_IMAGE = "alpine:latest";
const TEST_PREFIX = "docker-orch-vol-test-";

const createdContainers: string[] = [];
const createdVolumes: string[] = [];

const dockerAvailable = existsSync("/var/run/docker.sock");
const describeDocker = dockerAvailable ? describe : describe.skip;

describeDocker("Integration: Volume Management", () => {
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
      } catch { /* ignore */ }
    }
    for (const name of createdVolumes) {
      try {
        await removeVolume(docker, name, true);
      } catch { /* ignore */ }
    }
  });

  it("should create and inspect a volume", async () => {
    const name = `${TEST_PREFIX}basic-${Date.now()}`;
    const info = await createVolume(docker, {
      name,
      labels: { test: "true" },
    });
    createdVolumes.push(name);

    expect(info.name).toBe(name);
    expect(info.driver).toBe("local");

    const inspected = await inspectVolume(docker, name);
    expect(inspected.name).toBe(name);
    expect(inspected.labels.test).toBe("true");
  });

  it("should reject duplicate volume names", async () => {
    const name = `${TEST_PREFIX}dup-${Date.now()}`;
    await createVolume(docker, { name });
    createdVolumes.push(name);

    await expect(createVolume(docker, { name })).rejects.toThrow(
      VolumeAlreadyExistsError,
    );
  });

  it("should check volume existence", async () => {
    const name = `${TEST_PREFIX}exists-${Date.now()}`;
    await createVolume(docker, { name });
    createdVolumes.push(name);

    expect(await volumeExists(docker, name)).toBe(true);
    expect(await volumeExists(docker, "nonexistent-vol-" + Date.now())).toBe(false);
  });

  it("should list volumes", async () => {
    const name = `${TEST_PREFIX}list-${Date.now()}`;
    await createVolume(docker, { name });
    createdVolumes.push(name);

    const volumes = await listVolumes(docker);
    const found = volumes.find((v) => v.name === name);
    expect(found).toBeDefined();
  });

  it("should remove a volume", async () => {
    const name = `${TEST_PREFIX}remove-${Date.now()}`;
    await createVolume(docker, { name });

    await removeVolume(docker, name);
    // Should no longer exist
    expect(await volumeExists(docker, name)).toBe(false);
  });

  it("should throw VolumeNotFoundError when removing nonexistent", async () => {
    await expect(
      removeVolume(docker, "nonexistent-vol-" + Date.now()),
    ).rejects.toThrow(VolumeNotFoundError);
  });

  it("should persist data across container lifecycle", async () => {
    const volName = `${TEST_PREFIX}persist-${Date.now()}`;
    await createVolume(docker, { name: volName });
    createdVolumes.push(volName);

    // Create first container with volume, write a file
    const { config: config1 } = buildContainerConfig({
      image: TEST_IMAGE,
      name: `${TEST_PREFIX}write-${Date.now()}`,
      cmd: ["sh", "-c", "echo 'hello persistence' > /data/test.txt && sleep 5"],
      volumes: [{ host: volName, container: "/data" }],
    });
    const id1 = await createContainer(docker, config1);
    createdContainers.push(id1);
    await startContainer(docker, id1);
    // Wait for file to be written
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await stopContainer(docker, id1, 5);

    // Create second container with same volume, read the file
    const { config: config2 } = buildContainerConfig({
      image: TEST_IMAGE,
      name: `${TEST_PREFIX}read-${Date.now()}`,
      cmd: ["sleep", "30"],
      volumes: [{ host: volName, container: "/data" }],
    });
    const id2 = await createContainer(docker, config2);
    createdContainers.push(id2);
    await startContainer(docker, id2);

    const result = await executeCommand(docker, id2, "cat /data/test.txt");
    expect(result.stdout.trim()).toBe("hello persistence");
  });

  it("should support read-only mounts", async () => {
    const volName = `${TEST_PREFIX}readonly-${Date.now()}`;
    await createVolume(docker, { name: volName });
    createdVolumes.push(volName);

    const { config } = buildContainerConfig({
      image: TEST_IMAGE,
      name: `${TEST_PREFIX}ro-${Date.now()}`,
      cmd: ["sleep", "30"],
      volumes: [{ host: volName, container: "/data", readOnly: true }],
    });
    const id = await createContainer(docker, config);
    createdContainers.push(id);
    await startContainer(docker, id);

    // Try to write – should fail
    const result = await executeCommand(docker, id, "touch /data/readonly-test 2>&1 || echo WRITE_FAILED");
    expect(result.stdout).toContain("WRITE_FAILED");
  });

  it("should prune unused volumes", async () => {
    const volName = `${TEST_PREFIX}prune-${Date.now()}`;
    await createVolume(docker, { name: volName });

    const result = await pruneVolumes(docker);
    expect(result.volumesDeleted).toContain(volName);
    expect(result.spaceReclaimed).toBeGreaterThanOrEqual(0);
  });
});
