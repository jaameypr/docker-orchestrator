import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import Docker from "dockerode";
import {
  createContainer,
  startContainer,
  inspectContainer,
  stopContainer,
  removeContainer,
  listContainers,
} from "../../src/core/container.js";
import { imageExists, pullImage, listImages } from "../../src/core/image.js";
import { buildContainerConfig } from "../../src/builders/config-builder.js";
import { ContainerNotFoundError } from "../../src/errors/base.js";

const TEST_IMAGE = "alpine:latest";
const TEST_PREFIX = "docker-orch-test-";

// Track containers created during tests for cleanup
const createdContainers: string[] = [];

// Skip all tests if Docker socket is not available on disk
const dockerAvailable = existsSync("/var/run/docker.sock");
const describeDocker = dockerAvailable ? describe : describe.skip;

describeDocker("Integration: Docker Smoke Test", () => {
  const docker = new Docker({ socketPath: "/var/run/docker.sock" });

  afterAll(async () => {
    // Cleanup: remove all test containers
    for (const id of createdContainers) {
      try {
        await removeContainer(docker, id, true);
      } catch {
        // Container may already be removed, ignore
      }
    }
  });

  it("should ping Docker daemon", async () => {
    const result = await docker.ping();
    expect(result).toBeTruthy();
  });

  it("should pull alpine image", async () => {
    const progressEvents: string[] = [];

    await pullImage(docker, TEST_IMAGE, (event) => {
      progressEvents.push(event.status);
    });

    // Verify image exists after pull
    const exists = await imageExists(docker, TEST_IMAGE);
    expect(exists).toBe(true);
  });

  it("should list images including alpine", async () => {
    const images = await listImages(docker);
    const alpine = images.find((img) =>
      img.repoTags.some((tag) => tag.includes("alpine")),
    );
    expect(alpine).toBeDefined();
  });

  it("should run full container lifecycle: create → start → inspect → stop → remove", async () => {
    const containerName = `${TEST_PREFIX}lifecycle-${Date.now()}`;

    // Build config
    const { config } = buildContainerConfig({
      image: TEST_IMAGE,
      name: containerName,
      cmd: ["sleep", "30"],
      env: { TEST_VAR: "hello" },
    });

    // Create
    const id = await createContainer(docker, config);
    createdContainers.push(id);
    expect(id).toBeTruthy();

    // Start
    await startContainer(docker, id);

    // Inspect
    const info = await inspectContainer(docker, id);
    expect(info.state.running).toBe(true);
    expect(info.name).toBe(containerName);
    expect(info.config.env).toContain("TEST_VAR=hello");

    // Verify it appears in running container list
    const running = await listContainers(docker);
    const found = running.find((c) => c.id === id);
    expect(found).toBeDefined();

    // Stop
    await stopContainer(docker, id, 5);

    // Verify stopped
    const stoppedInfo = await inspectContainer(docker, id);
    expect(stoppedInfo.state.running).toBe(false);

    // Remove
    await removeContainer(docker, id);
    // Remove from cleanup list since we already removed it
    const idx = createdContainers.indexOf(id);
    if (idx !== -1) createdContainers.splice(idx, 1);

    // Verify removed
    await expect(inspectContainer(docker, id)).rejects.toThrow(
      ContainerNotFoundError,
    );
  });

  it("should list all containers including stopped ones", async () => {
    const containerName = `${TEST_PREFIX}list-${Date.now()}`;

    const { config } = buildContainerConfig({
      image: TEST_IMAGE,
      name: containerName,
      cmd: ["true"], // exits immediately
    });

    const id = await createContainer(docker, config);
    createdContainers.push(id);

    await startContainer(docker, id);
    // Wait a moment for the container to exit
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Should appear in all=true list
    const all = await listContainers(docker, true);
    const found = all.find((c) => c.id === id);
    expect(found).toBeDefined();
  });
});
