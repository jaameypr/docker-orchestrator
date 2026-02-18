import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import * as path from "node:path";
import Docker from "dockerode";
import {
  createContainer,
  startContainer,
  removeContainer,
} from "../../src/core/container.js";
import { executeCommand } from "../../src/core/exec.js";
import {
  copyToContainer,
  copyFromContainer,
  copyBufferToContainer,
  readFileFromContainer,
} from "../../src/core/files.js";
import { buildContainerConfig } from "../../src/builders/config-builder.js";

const TEST_IMAGE = "alpine:latest";
const TEST_PREFIX = "docker-orch-files-test-";
const TMP_DIR = `/tmp/docker-orch-integration-files-${Date.now()}`;

const createdContainers: string[] = [];
const dockerAvailable = existsSync("/var/run/docker.sock");
const describeDocker = dockerAvailable ? describe : describe.skip;

describeDocker("Integration: File Operations", () => {
  const docker = new Docker({ socketPath: "/var/run/docker.sock" });
  let containerId: string;

  beforeAll(async () => {
    mkdirSync(TMP_DIR, { recursive: true });

    const config = buildContainerConfig({
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
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("should copy a text file to container and verify via exec", async () => {
    const filePath = path.join(TMP_DIR, "upload.txt");
    writeFileSync(filePath, "Hello from host!");

    await copyToContainer(docker, containerId, {
      sourcePath: filePath,
      destPath: "/tmp",
    });

    const result = await executeCommand(docker, containerId, ["cat", "/tmp/upload.txt"]);
    expect(result.stdout).toBe("Hello from host!");
  });

  it("should copy a file from container to host", async () => {
    // First create a file in the container
    await executeCommand(docker, containerId, [
      "sh", "-c", "echo 'from container' > /tmp/download.txt",
    ]);

    const destDir = path.join(TMP_DIR, "download-dest");
    await copyFromContainer(docker, containerId, {
      sourcePath: "/tmp/download.txt",
      destPath: destDir,
    });

    const content = readFileSync(path.join(destDir, "download.txt"), "utf-8");
    expect(content.trim()).toBe("from container");
  });

  it("should copy a directory and preserve structure", async () => {
    const dirPath = path.join(TMP_DIR, "mydir");
    mkdirSync(path.join(dirPath, "sub"), { recursive: true });
    writeFileSync(path.join(dirPath, "root.txt"), "root content");
    writeFileSync(path.join(dirPath, "sub", "nested.txt"), "nested content");

    await copyToContainer(docker, containerId, {
      sourcePath: dirPath,
      destPath: "/tmp",
    });

    const rootResult = await executeCommand(docker, containerId, ["cat", "/tmp/root.txt"]);
    expect(rootResult.stdout).toBe("root content");

    const nestedResult = await executeCommand(docker, containerId, ["cat", "/tmp/sub/nested.txt"]);
    expect(nestedResult.stdout).toBe("nested content");
  });

  it("should copy a buffer to container without host file", async () => {
    const configContent = JSON.stringify({ setting: "value" });

    await copyBufferToContainer(docker, containerId, "/tmp", "config.json", configContent);

    const result = await executeCommand(docker, containerId, ["cat", "/tmp/config.json"]);
    expect(result.stdout).toBe(configContent);
  });

  it("should read a file from container as buffer", async () => {
    await executeCommand(docker, containerId, [
      "sh", "-c", "echo -n 'buffer test' > /tmp/bufferfile.txt",
    ]);

    const buffer = await readFileFromContainer(docker, containerId, "/tmp/bufferfile.txt");
    expect(buffer.toString("utf-8")).toBe("buffer test");
  });

  it("should handle file permissions correctly", async () => {
    const filePath = path.join(TMP_DIR, "perms.txt");
    writeFileSync(filePath, "permission test");

    await copyToContainer(docker, containerId, {
      sourcePath: filePath,
      destPath: "/tmp",
    });

    const result = await executeCommand(docker, containerId, [
      "stat", "-c", "%a", "/tmp/perms.txt",
    ]);
    // Should have some valid permission
    expect(result.stdout.trim()).toMatch(/^\d{3,4}$/);
  });
});
