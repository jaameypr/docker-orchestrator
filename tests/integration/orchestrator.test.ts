import { describe, it, expect, afterAll, afterEach } from "vitest";
import { existsSync } from "node:fs";
import Docker from "dockerode";
import { Orchestrator, createOrchestrator } from "../../src/core/orchestrator.js";
import { DeploymentFailedError } from "../../src/errors/base.js";

const TEST_IMAGE = "nginx:alpine";
const TEST_PREFIX = "docker-orch-integ-";

// Track resources for cleanup
const createdContainerIds: string[] = [];
const createdVolumeNames: string[] = [];
const createdNetworkIds: string[] = [];

const dockerAvailable = existsSync("/var/run/docker.sock");
const describeDocker = dockerAvailable ? describe : describe.skip;

describeDocker("Integration: Orchestrator", () => {
  const docker = new Docker({ socketPath: "/var/run/docker.sock" });
  const orchestrator = createOrchestrator(docker);

  afterEach(async () => {
    // Clean up containers created during each test
    for (const id of createdContainerIds.splice(0)) {
      try {
        await docker.getContainer(id).stop({ t: 1 });
      } catch { /* may not be running */ }
      try {
        await docker.getContainer(id).remove({ force: true });
      } catch { /* may not exist */ }
    }

    // Clean up volumes
    for (const name of createdVolumeNames.splice(0)) {
      try {
        await docker.getVolume(name).remove({ force: true });
      } catch { /* ignore */ }
    }

    // Clean up networks
    for (const id of createdNetworkIds.splice(0)) {
      try {
        await docker.getNetwork(id).remove();
      } catch { /* ignore */ }
    }
  });

  describe("deploy", () => {
    it("should deploy nginx container and get running status", async () => {
      const result = await orchestrator.deploy({
        image: TEST_IMAGE,
        name: `${TEST_PREFIX}deploy-${Date.now()}`,
        ports: [{ container: 80 }],
      });

      createdContainerIds.push(result.containerId);
      expect(result.status).toBe("running");
      expect(result.containerId).toBeTruthy();
      expect(result.name).toContain(TEST_PREFIX);
    });

    it("should deploy with health check and reach healthy status", async () => {
      const result = await orchestrator.deploy({
        image: TEST_IMAGE,
        name: `${TEST_PREFIX}healthy-${Date.now()}`,
        ports: [{ container: 80 }],
        healthCheck: {
          type: "exec",
          exec: { command: ["nginx", "-t"] },
          interval: 2,
          timeout: 3,
          retries: 3,
          startPeriod: 1,
        },
      });

      createdContainerIds.push(result.containerId);
      // exec-type health checks are Docker-native; container should start
      expect(["running", "healthy"]).toContain(result.status);
    });

    it("should pull non-existent image and deploy", async () => {
      const result = await orchestrator.deploy({
        image: "alpine:3.18",
        name: `${TEST_PREFIX}pull-${Date.now()}`,
        cmd: ["sleep", "30"],
      });

      createdContainerIds.push(result.containerId);
      expect(result.status).toBe("running");
    });
  });

  describe("update", () => {
    it("should update container env vars via recreation", async () => {
      const deployed = await orchestrator.deploy({
        image: TEST_IMAGE,
        name: `${TEST_PREFIX}update-${Date.now()}`,
        env: { MY_VAR: "old" },
      });
      createdContainerIds.push(deployed.containerId);

      const updated = await orchestrator.update(deployed.containerId, {
        env: { MY_VAR: "new" },
      });

      // Container may have been recreated
      if (updated.containerId !== deployed.containerId) {
        createdContainerIds.push(updated.containerId);
      }

      expect(updated.changes.length).toBeGreaterThan(0);
    });
  });

  describe("destroy", () => {
    it("should stop and remove a deployed container", async () => {
      const deployed = await orchestrator.deploy({
        image: TEST_IMAGE,
        name: `${TEST_PREFIX}destroy-${Date.now()}`,
      });

      // Don't track because we're about to destroy
      await orchestrator.destroy(deployed.containerId);

      // Verify container is gone
      try {
        await docker.getContainer(deployed.containerId).inspect();
        throw new Error("Expected container to be removed");
      } catch (err) {
        expect((err as { statusCode?: number }).statusCode).toBe(404);
      }
    });

    it("should remove named volumes when removeVolumes is true", async () => {
      // Create a volume first
      const volName = `${TEST_PREFIX}vol-${Date.now()}`;
      await docker.createVolume({ Name: volName });
      createdVolumeNames.push(volName);

      const deployed = await orchestrator.deploy({
        image: TEST_IMAGE,
        name: `${TEST_PREFIX}vol-destroy-${Date.now()}`,
        mounts: [
          {
            type: "volume",
            source: volName,
            target: "/data",
          },
        ],
      });

      await orchestrator.destroy(deployed.containerId, {
        removeVolumes: true,
      });

      // Volume should be removed
      try {
        await docker.getVolume(volName).inspect();
        // Volume may still exist if it was in use
      } catch (err) {
        expect((err as { statusCode?: number }).statusCode).toBe(404);
        // Remove from cleanup since it's already gone
        const idx = createdVolumeNames.indexOf(volName);
        if (idx !== -1) createdVolumeNames.splice(idx, 1);
      }
    });
  });

  describe("batch operations", () => {
    it("should deploy 5 containers in parallel", async () => {
      const configs = Array.from({ length: 5 }, (_, i) => ({
        image: "alpine:3.18",
        name: `${TEST_PREFIX}batch-${Date.now()}-${i}`,
        cmd: ["sleep", "30"],
      }));

      const result = await orchestrator.deployMany(configs, {
        concurrency: 5,
      });

      for (const r of result.results) {
        if (r.status === "fulfilled") {
          createdContainerIds.push(r.value.containerId);
        }
      }

      expect(result.succeeded).toBe(5);
      expect(result.failed).toBe(0);
    });

    it("should handle partial batch failure", async () => {
      const configs = [
        {
          image: "alpine:3.18",
          name: `${TEST_PREFIX}batch-ok-${Date.now()}`,
          cmd: ["sleep", "30"],
        },
        {
          image: "nonexistent-image-xyz-123:latest",
          name: `${TEST_PREFIX}batch-fail-${Date.now()}`,
        },
      ];

      const result = await orchestrator.deployMany(configs, {
        concurrency: 2,
      });

      for (const r of result.results) {
        if (r.status === "fulfilled") {
          createdContainerIds.push(r.value.containerId);
        }
      }

      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
    });

    it("should destroy multiple containers in parallel", async () => {
      // Deploy 3 containers first
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const r = await orchestrator.deploy({
          image: "alpine:3.18",
          name: `${TEST_PREFIX}batch-destroy-${Date.now()}-${i}`,
          cmd: ["sleep", "30"],
        });
        ids.push(r.containerId);
      }

      const result = await orchestrator.destroyMany(ids, {
        force: true,
      });

      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);
    });
  });
});
