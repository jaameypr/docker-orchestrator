import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import Docker from "dockerode";
import { createContainer, startContainer, removeContainer } from "../../src/core/container.js";
import { pullImage, imageExists } from "../../src/core/image.js";
import { buildContainerConfig } from "../../src/builders/config-builder.js";
import { getAssignedPorts, checkPortAvailable } from "../../src/builders/port-mapper.js";

const TEST_IMAGE = "alpine:latest";
const TEST_PREFIX = "docker-orch-port-test-";

const createdContainers: string[] = [];

const dockerAvailable = existsSync("/var/run/docker.sock");
const describeDocker = dockerAvailable ? describe : describe.skip;

describeDocker("Integration: Port Mapping", () => {
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
        /* ignore */
      }
    }
  });

  it("should create a container with port mapping and read assigned port", async () => {
    const { config } = buildContainerConfig({
      image: TEST_IMAGE,
      name: `${TEST_PREFIX}port-${Date.now()}`,
      cmd: ["sleep", "30"],
      ports: [{ container: 80, host: 18080 }],
    });
    const id = await createContainer(docker, config);
    createdContainers.push(id);
    await startContainer(docker, id);

    const ports = await getAssignedPorts(docker, id);
    expect(ports.length).toBeGreaterThanOrEqual(1);
    expect(ports[0].containerPort).toBe(80);
    expect(ports[0].hostPort).toBe(18080);
  });

  it("should auto-assign host port when not specified", async () => {
    const { config } = buildContainerConfig({
      image: TEST_IMAGE,
      name: `${TEST_PREFIX}auto-${Date.now()}`,
      cmd: ["sleep", "30"],
      ports: [{ container: 80 }], // no host port → random assign
    });
    const id = await createContainer(docker, config);
    createdContainers.push(id);
    await startContainer(docker, id);

    const ports = await getAssignedPorts(docker, id);
    expect(ports.length).toBeGreaterThanOrEqual(1);
    expect(ports[0].containerPort).toBe(80);
    expect(ports[0].hostPort).toBeGreaterThan(0);
  });

  it("should use portMappings field with string syntax", async () => {
    const { config } = buildContainerConfig({
      image: TEST_IMAGE,
      name: `${TEST_PREFIX}pmaps-${Date.now()}`,
      cmd: ["sleep", "30"],
      portMappings: ["18081:80", "18082:443/tcp"],
    });
    const id = await createContainer(docker, config);
    createdContainers.push(id);
    await startContainer(docker, id);

    const ports = await getAssignedPorts(docker, id);
    const port80 = ports.find((p) => p.containerPort === 80);
    const port443 = ports.find((p) => p.containerPort === 443);

    expect(port80).toBeDefined();
    expect(port80!.hostPort).toBe(18081);
    expect(port443).toBeDefined();
    expect(port443!.hostPort).toBe(18082);
  });

  it("should verify checkPortAvailable returns false for an in-use port", async () => {
    const { config } = buildContainerConfig({
      image: TEST_IMAGE,
      name: `${TEST_PREFIX}inuse-${Date.now()}`,
      cmd: ["nc", "-l", "-p", "8080"],
      ports: [{ container: 8080, host: 18099 }],
    });
    const id = await createContainer(docker, config);
    createdContainers.push(id);
    await startContainer(docker, id);

    // Give container a moment to start listening
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const available = await checkPortAvailable(18099);
    expect(available).toBe(false);
  });
});
