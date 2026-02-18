import { describe, it, expect, afterAll } from "vitest";
import { existsSync } from "node:fs";
import Docker from "dockerode";
import { Orchestrator } from "../../src/core/orchestrator.js";
import { definePreset } from "../../src/core/presets.js";

const dockerAvailable = existsSync("/var/run/docker.sock");
const describeDocker = dockerAvailable ? describe : describe.skip;

const createdContainers: string[] = [];

describeDocker("Integration: Preset Workflow", () => {
  const docker = new Docker({ socketPath: "/var/run/docker.sock" });
  const orch = new Orchestrator(docker);

  afterAll(async () => {
    for (const id of createdContainers) {
      try {
        await orch.destroy(id, { force: true });
      } catch {
        try {
          await docker.getContainer(id).remove({ force: true });
        } catch {
          // Ignore
        }
      }
    }
    orch.presets.clear();
  });

  it("should register a preset and deploy a container with it", async () => {
    orch.presets.register(
      definePreset({
        name: "test-alpine",
        config: {
          image: "alpine:latest",
          cmd: ["sleep", "60"],
          env: { PRESET_VAR: "from-preset" },
          labels: { "test.source": "preset" },
        },
      }),
    );

    const result = await orch.deploy({
      image: "alpine:latest",
      preset: "test-alpine",
      name: `preset-test-${Date.now()}`,
    });

    createdContainers.push(result.containerId);

    expect(result.containerId).toBeDefined();
    expect(result.status).toBe("running");

    // Verify preset label is set on the container
    const inspectData = await docker.getContainer(result.containerId).inspect();
    expect(inspectData.Config.Labels["orchestrator.preset"]).toBe("test-alpine");

    // Verify env from preset
    expect(inspectData.Config.Env).toContain("PRESET_VAR=from-preset");
  });

  it("should merge user overrides with preset config", async () => {
    orch.presets.register(
      definePreset({
        name: "merge-test",
        config: {
          image: "alpine:latest",
          cmd: ["sleep", "60"],
          env: { A: "1", B: "2" },
        },
      }),
    );

    const result = await orch.deploy({
      image: "alpine:latest",
      preset: "merge-test",
      name: `merge-test-${Date.now()}`,
      env: { B: "overridden", C: "new" },
    });

    createdContainers.push(result.containerId);

    const inspectData = await docker.getContainer(result.containerId).inspect();
    expect(inspectData.Config.Env).toContain("A=1");
    expect(inspectData.Config.Env).toContain("B=overridden");
    expect(inspectData.Config.Env).toContain("C=new");
  });

  it("should deploy and destroy with graceful stop", async () => {
    orch.presets.register(
      definePreset({
        name: "graceful-test",
        config: {
          image: "alpine:latest",
          cmd: ["cat"],
          interactive: true,
        },
        gracefulStop: {
          command: "exit",
          waitForExit: false,
          timeout: 5000,
        },
      }),
    );

    const result = await orch.deploy({
      image: "alpine:latest",
      preset: "graceful-test",
      name: `graceful-test-${Date.now()}`,
    });

    createdContainers.push(result.containerId);

    // Destroy should attempt graceful stop
    await expect(orch.destroy(result.containerId, { timeout: 5 })).resolves.not.toThrow();

    // Remove from tracking since destroy already ran
    createdContainers.pop();
  });
});
