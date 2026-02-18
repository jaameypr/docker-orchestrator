import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import Docker from "dockerode";
import {
  createNetwork,
  removeNetwork,
  inspectNetwork,
  listNetworks,
  connectContainer,
  disconnectContainer,
  pruneNetworks,
} from "../../src/core/network.js";
import {
  createContainer,
  startContainer,
  removeContainer,
} from "../../src/core/container.js";
import { executeCommand } from "../../src/core/exec.js";
import { pullImage, imageExists } from "../../src/core/image.js";
import { buildContainerConfig } from "../../src/builders/config-builder.js";
import {
  NetworkAlreadyExistsError,
  ContainerStillConnectedError,
} from "../../src/errors/base.js";

const TEST_IMAGE = "alpine:latest";
const TEST_PREFIX = "docker-orch-net-test-";

const createdContainers: string[] = [];
const createdNetworks: string[] = [];

const dockerAvailable = existsSync("/var/run/docker.sock");
const describeDocker = dockerAvailable ? describe : describe.skip;

describeDocker("Integration: Network Management", () => {
  const docker = new Docker({ socketPath: "/var/run/docker.sock" });

  beforeAll(async () => {
    const exists = await imageExists(docker, TEST_IMAGE);
    if (!exists) {
      await pullImage(docker, TEST_IMAGE);
    }
  });

  afterAll(async () => {
    // Cleanup containers first (they may be connected to networks)
    for (const id of createdContainers) {
      try {
        await removeContainer(docker, id, true);
      } catch { /* ignore */ }
    }
    // Then cleanup networks
    for (const id of createdNetworks) {
      try {
        await removeNetwork(docker, id, true);
      } catch { /* ignore */ }
    }
  });

  it("should create and inspect a custom bridge network", async () => {
    const name = `${TEST_PREFIX}bridge-${Date.now()}`;
    const netId = await createNetwork(docker, {
      name,
      driver: "bridge",
      subnet: "10.99.0.0/24",
      gateway: "10.99.0.1",
      labels: { test: "true" },
    });
    createdNetworks.push(netId);

    expect(netId).toBeTruthy();

    const info = await inspectNetwork(docker, netId);
    expect(info.name).toBe(name);
    expect(info.driver).toBe("bridge");
    expect(info.ipam.config[0].Subnet).toBe("10.99.0.0/24");
    expect(info.ipam.config[0].Gateway).toBe("10.99.0.1");
    expect(info.labels.test).toBe("true");
  });

  it("should reject duplicate network names", async () => {
    const name = `${TEST_PREFIX}dup-${Date.now()}`;
    const netId = await createNetwork(docker, { name });
    createdNetworks.push(netId);

    await expect(createNetwork(docker, { name })).rejects.toThrow(
      NetworkAlreadyExistsError,
    );
  });

  it("should list networks including custom ones", async () => {
    const name = `${TEST_PREFIX}list-${Date.now()}`;
    const netId = await createNetwork(docker, { name });
    createdNetworks.push(netId);

    const networks = await listNetworks(docker);
    const found = networks.find((n) => n.id === netId);
    expect(found).toBeDefined();
    expect(found!.name).toBe(name);
  });

  it("should connect and disconnect a container from a network", async () => {
    const netName = `${TEST_PREFIX}connect-${Date.now()}`;
    const netId = await createNetwork(docker, {
      name: netName,
      subnet: "10.98.0.0/24",
      gateway: "10.98.0.1",
    });
    createdNetworks.push(netId);

    const config = buildContainerConfig({
      image: TEST_IMAGE,
      name: `${TEST_PREFIX}con-${Date.now()}`,
      cmd: ["sleep", "30"],
    });
    const containerId = await createContainer(docker, config);
    createdContainers.push(containerId);
    await startContainer(docker, containerId);

    // Connect
    await connectContainer(docker, netId, containerId, {
      aliases: ["test-alias"],
    });

    // Verify container is connected
    const netInfo = await inspectNetwork(docker, netId);
    expect(netInfo.containers[containerId]).toBeDefined();

    // Disconnect
    await disconnectContainer(docker, netId, containerId);

    // Verify container is disconnected
    const netInfoAfter = await inspectNetwork(docker, netId);
    expect(netInfoAfter.containers[containerId]).toBeUndefined();
  });

  it("should connect container with a fixed IP address", async () => {
    const netName = `${TEST_PREFIX}fixedip-${Date.now()}`;
    const netId = await createNetwork(docker, {
      name: netName,
      subnet: "10.97.0.0/24",
      gateway: "10.97.0.1",
    });
    createdNetworks.push(netId);

    const config = buildContainerConfig({
      image: TEST_IMAGE,
      name: `${TEST_PREFIX}fixip-${Date.now()}`,
      cmd: ["sleep", "30"],
    });
    const containerId = await createContainer(docker, config);
    createdContainers.push(containerId);
    await startContainer(docker, containerId);

    await connectContainer(docker, netId, containerId, {
      ipv4Address: "10.97.0.50",
    });

    // Verify via exec ip addr
    const result = await executeCommand(docker, containerId, "ip addr show");
    expect(result.stdout).toContain("10.97.0.50");
  });

  it("should allow containers in the same network to communicate", async () => {
    const netName = `${TEST_PREFIX}comm-${Date.now()}`;
    const netId = await createNetwork(docker, {
      name: netName,
      subnet: "10.96.0.0/24",
      gateway: "10.96.0.1",
    });
    createdNetworks.push(netId);

    // Container A
    const configA = buildContainerConfig({
      image: TEST_IMAGE,
      name: `${TEST_PREFIX}comm-a-${Date.now()}`,
      cmd: ["sleep", "30"],
    });
    const containerA = await createContainer(docker, configA);
    createdContainers.push(containerA);
    await startContainer(docker, containerA);

    // Container B
    const configB = buildContainerConfig({
      image: TEST_IMAGE,
      name: `${TEST_PREFIX}comm-b-${Date.now()}`,
      cmd: ["sleep", "30"],
    });
    const containerB = await createContainer(docker, configB);
    createdContainers.push(containerB);
    await startContainer(docker, containerB);

    // Connect both to the same network
    await connectContainer(docker, netId, containerA, {
      ipv4Address: "10.96.0.10",
    });
    await connectContainer(docker, netId, containerB, {
      ipv4Address: "10.96.0.11",
    });

    // Ping from A to B
    const result = await executeCommand(docker, containerA, "ping -c 1 -W 2 10.96.0.11");
    expect(result.exitCode).toBe(0);
  });

  it("should refuse to remove network with connected containers (no force)", async () => {
    const netName = `${TEST_PREFIX}refuse-${Date.now()}`;
    const netId = await createNetwork(docker, { name: netName });
    createdNetworks.push(netId);

    const config = buildContainerConfig({
      image: TEST_IMAGE,
      name: `${TEST_PREFIX}ref-${Date.now()}`,
      cmd: ["sleep", "30"],
    });
    const containerId = await createContainer(docker, config);
    createdContainers.push(containerId);
    await startContainer(docker, containerId);

    await connectContainer(docker, netId, containerId);

    await expect(removeNetwork(docker, netId)).rejects.toThrow(
      ContainerStillConnectedError,
    );
  });

  it("should prune unused networks", async () => {
    const netName = `${TEST_PREFIX}prune-${Date.now()}`;
    const netId = await createNetwork(docker, {
      name: netName,
      labels: { "docker-orch-test": "prune" },
    });

    // Don't add to createdNetworks since prune should remove it
    const deleted = await pruneNetworks(docker);

    // The network should be in the deleted list
    expect(deleted).toContain(netName);

    // Remove from tracking if still there
    const idx = createdNetworks.indexOf(netId);
    if (idx !== -1) createdNetworks.splice(idx, 1);
  });
});
