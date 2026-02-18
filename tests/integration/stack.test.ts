import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import Docker from "dockerode";
import { deployStack, destroyStack } from "../../src/core/stack.js";
import type { StackConfig } from "../../src/types/stack.js";

const TEST_PREFIX = "docker-orch-stack-";

const dockerAvailable = existsSync("/var/run/docker.sock");
const describeDocker = dockerAvailable ? describe : describe.skip;

describeDocker("Integration: Stack Deployment", () => {
  const docker = new Docker({ socketPath: "/var/run/docker.sock" });
  const stackNames: string[] = [];

  afterEach(async () => {
    // Clean up stacks
    for (const name of stackNames.splice(0)) {
      try {
        await destroyStack(docker, name, { removeVolumes: true, timeout: 2 });
      } catch {
        /* ignore */
      }
    }
  });

  it("should deploy a stack with DB and Web (app depends on db)", async () => {
    const stackName = `${TEST_PREFIX}basic-${Date.now()}`;
    stackNames.push(stackName);

    const stackConfig: StackConfig = {
      name: stackName,
      containers: {
        db: {
          image: "alpine:3.18",
          cmd: ["sleep", "60"],
          restartPolicy: "unless-stopped",
          stopTimeout: 10,
        },
        web: {
          image: "alpine:3.18",
          cmd: ["sleep", "60"],
          dependsOn: ["db"],
          restartPolicy: "unless-stopped",
          stopTimeout: 10,
        },
      },
    } as StackConfig;

    const steps: string[] = [];
    const result = await deployStack(docker, stackConfig, (step) => steps.push(step));

    expect(result.stackName).toBe(stackName);
    expect(result.services).toHaveLength(2);

    // DB should have been deployed first (web depends on db)
    const dbService = result.services.find((s) => s.serviceName === "db");
    const webService = result.services.find((s) => s.serviceName === "web");
    expect(dbService).toBeDefined();
    expect(webService).toBeDefined();
    expect(dbService!.deployResults.length).toBe(1);
    expect(webService!.deployResults.length).toBe(1);
  });

  it("should destroy stack and remove containers", async () => {
    const stackName = `${TEST_PREFIX}destroy-${Date.now()}`;
    stackNames.push(stackName);

    const stackConfig: StackConfig = {
      name: stackName,
      containers: {
        svc1: {
          image: "alpine:3.18",
          cmd: ["sleep", "60"],
          restartPolicy: "unless-stopped",
          stopTimeout: 10,
        },
      },
    } as StackConfig;

    await deployStack(docker, stackConfig);
    await destroyStack(docker, stackName, { timeout: 2 });

    // Verify containers are gone
    const containers = await docker.listContainers({
      all: true,
      filters: JSON.stringify({
        label: [`orchestrator.stack=${stackName}`],
      }),
    });
    expect(containers).toHaveLength(0);
  });

  it("should create shared network for service discovery", async () => {
    const stackName = `${TEST_PREFIX}network-${Date.now()}`;
    stackNames.push(stackName);

    const stackConfig: StackConfig = {
      name: stackName,
      containers: {
        app: {
          image: "alpine:3.18",
          cmd: ["sleep", "60"],
          restartPolicy: "unless-stopped",
          stopTimeout: 10,
        },
      },
    } as StackConfig;

    await deployStack(docker, stackConfig);

    // Should have created the default network
    const expectedNetName = `${stackName}_default`;
    const networks = await docker.listNetworks({
      filters: JSON.stringify({ name: [expectedNetName] }),
    });
    const found = networks.find((n: Record<string, unknown>) => n.Name === expectedNetName);
    expect(found).toBeDefined();
  });
});
