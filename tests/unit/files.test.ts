import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";
import * as tar from "tar-stream";
import {
  createTarFromBuffer,
  createTarFromPath,
  extractTarToPath,
  copyToContainer,
  copyFromContainer,
  copyBufferToContainer,
  readFileFromContainer,
} from "../../src/core/files.js";
import {
  ContainerNotFoundError,
  FileNotFoundError,
  PermissionError,
} from "../../src/errors/base.js";
import type Docker from "dockerode";

function createMockDocker() {
  return {
    getContainer: vi.fn(),
  } as unknown as Docker & {
    getContainer: ReturnType<typeof vi.fn>;
  };
}

/**
 * Reads all entries from a TAR stream and returns them as a map of name → buffer.
 */
async function readTarEntries(stream: Readable): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Buffer>();
    const extract = tar.extract();

    extract.on("entry", (header, entryStream, next) => {
      const chunks: Buffer[] = [];
      entryStream.on("data", (chunk: Buffer) => chunks.push(chunk));
      entryStream.on("end", () => {
        entries.set(header.name, Buffer.concat(chunks));
        next();
      });
      entryStream.on("error", reject);
    });

    extract.on("finish", () => resolve(entries));
    extract.on("error", reject);

    stream.pipe(extract);
  });
}

describe("createTarFromBuffer", () => {
  it("should create a TAR with a single file from string content", async () => {
    const tarStream = createTarFromBuffer("test.txt", "hello world");
    const entries = await readTarEntries(tarStream);

    expect(entries.size).toBe(1);
    expect(entries.has("test.txt")).toBe(true);
    expect(entries.get("test.txt")!.toString("utf-8")).toBe("hello world");
  });

  it("should create a TAR with a single file from Buffer content", async () => {
    const content = Buffer.from([0x00, 0x01, 0x02, 0xff]);
    const tarStream = createTarFromBuffer("binary.bin", content);
    const entries = await readTarEntries(tarStream);

    expect(entries.size).toBe(1);
    expect(entries.get("binary.bin")).toEqual(content);
  });

  it("should handle empty file content", async () => {
    const tarStream = createTarFromBuffer("empty.txt", "");
    const entries = await readTarEntries(tarStream);

    expect(entries.size).toBe(1);
    expect(entries.get("empty.txt")!.length).toBe(0);
  });

  it("should handle filenames with special characters", async () => {
    const tarStream = createTarFromBuffer("path/to/my file (1).txt", "content");
    const entries = await readTarEntries(tarStream);

    expect(entries.has("path/to/my file (1).txt")).toBe(true);
  });
});

describe("createTarFromPath", () => {
  const tmpDir = "/tmp/docker-orch-test-tar-" + Date.now();

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should create a TAR from a single file", async () => {
    const filePath = path.join(tmpDir, "single.txt");
    fs.writeFileSync(filePath, "single file content");

    const tarStream = createTarFromPath(filePath);
    const entries = await readTarEntries(tarStream);

    expect(entries.size).toBe(1);
    expect(entries.get("single.txt")!.toString("utf-8")).toBe("single file content");
  });

  it("should create a TAR from a directory", async () => {
    const dirPath = path.join(tmpDir, "subdir");
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, "a.txt"), "aaa");
    fs.writeFileSync(path.join(dirPath, "b.txt"), "bbb");

    const tarStream = createTarFromPath(dirPath);
    const entries = await readTarEntries(tarStream);

    expect(entries.has("a.txt")).toBe(true);
    expect(entries.has("b.txt")).toBe(true);
    expect(entries.get("a.txt")!.toString("utf-8")).toBe("aaa");
    expect(entries.get("b.txt")!.toString("utf-8")).toBe("bbb");
  });

  it("should handle nested directories", async () => {
    const dirPath = path.join(tmpDir, "nested");
    fs.mkdirSync(path.join(dirPath, "sub"), { recursive: true });
    fs.writeFileSync(path.join(dirPath, "root.txt"), "root");
    fs.writeFileSync(path.join(dirPath, "sub", "child.txt"), "child");

    const tarStream = createTarFromPath(dirPath);
    const entries = await readTarEntries(tarStream);

    expect(entries.has("root.txt")).toBe(true);
    expect(entries.has("sub/child.txt")).toBe(true);
  });
});

describe("extractTarToPath", () => {
  const tmpDir = "/tmp/docker-orch-test-extract-" + Date.now();

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should extract a TAR stream to a directory", async () => {
    // Create a TAR in memory
    const tarStream = createTarFromBuffer("extracted.txt", "extracted content");
    await extractTarToPath(tarStream, tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, "extracted.txt"), "utf-8");
    expect(content).toBe("extracted content");
  });

  it("should handle roundtrip: buffer → TAR → extract → identical content", async () => {
    const original = "The quick brown fox jumps over the lazy dog";
    const tarStream = createTarFromBuffer("roundtrip.txt", original);
    await extractTarToPath(tarStream, tmpDir);

    const result = fs.readFileSync(path.join(tmpDir, "roundtrip.txt"), "utf-8");
    expect(result).toBe(original);
  });
});

describe("copyToContainer", () => {
  let docker: ReturnType<typeof createMockDocker>;
  const tmpDir = "/tmp/docker-orch-test-copy-" + Date.now();

  beforeEach(() => {
    docker = createMockDocker();
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should call putArchive with correct parameters", async () => {
    const filePath = path.join(tmpDir, "upload.txt");
    fs.writeFileSync(filePath, "upload content");

    const putArchive = vi.fn().mockResolvedValue(undefined);
    docker.getContainer.mockReturnValue({ putArchive });

    await copyToContainer(docker, "container-1", {
      sourcePath: filePath,
      destPath: "/tmp",
    });

    expect(putArchive).toHaveBeenCalledWith(expect.anything(), { path: "/tmp" });
  });

  it("should throw FileNotFoundError for missing host path", async () => {
    await expect(
      copyToContainer(docker, "container-1", {
        sourcePath: "/nonexistent/path",
        destPath: "/tmp",
      }),
    ).rejects.toThrow(FileNotFoundError);
  });

  it("should throw ContainerNotFoundError for 404", async () => {
    const filePath = path.join(tmpDir, "upload.txt");
    fs.writeFileSync(filePath, "content");

    docker.getContainer.mockReturnValue({
      putArchive: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 })),
    });

    await expect(
      copyToContainer(docker, "nonexistent", {
        sourcePath: filePath,
        destPath: "/tmp",
      }),
    ).rejects.toThrow(ContainerNotFoundError);
  });

  it("should throw PermissionError for permission denied", async () => {
    const filePath = path.join(tmpDir, "upload.txt");
    fs.writeFileSync(filePath, "content");

    docker.getContainer.mockReturnValue({
      putArchive: vi.fn().mockRejectedValue(new Error("permission denied")),
    });

    await expect(
      copyToContainer(docker, "container-1", {
        sourcePath: filePath,
        destPath: "/root",
      }),
    ).rejects.toThrow(PermissionError);
  });
});

describe("copyFromContainer", () => {
  let docker: ReturnType<typeof createMockDocker>;
  const tmpDir = "/tmp/docker-orch-test-copyfrom-" + Date.now();

  beforeEach(() => {
    docker = createMockDocker();
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should extract TAR response from container", async () => {
    // Create a fake TAR stream as if from container
    const pack = tar.pack();
    pack.entry({ name: "downloaded.txt", size: 8 }, "download");
    pack.finalize();

    docker.getContainer.mockReturnValue({
      getArchive: vi.fn().mockResolvedValue(pack),
    });

    const destPath = path.join(tmpDir, "download-dest");
    await copyFromContainer(docker, "container-1", {
      sourcePath: "/app/downloaded.txt",
      destPath,
    });

    const content = fs.readFileSync(path.join(destPath, "downloaded.txt"), "utf-8");
    expect(content).toBe("download");
  });

  it("should throw FileNotFoundError for 404 from container", async () => {
    docker.getContainer.mockReturnValue({
      getArchive: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 })),
    });

    await expect(
      copyFromContainer(docker, "container-1", {
        sourcePath: "/nonexistent",
        destPath: tmpDir,
      }),
    ).rejects.toThrow(FileNotFoundError);
  });
});

describe("copyBufferToContainer", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should send a TAR with single file to container", async () => {
    const putArchive = vi.fn().mockResolvedValue(undefined);
    docker.getContainer.mockReturnValue({ putArchive });

    await copyBufferToContainer(docker, "container-1", "/tmp", "config.json", '{"key":"value"}');

    expect(putArchive).toHaveBeenCalledWith(expect.anything(), { path: "/tmp" });
  });

  it("should throw ContainerNotFoundError for 404", async () => {
    docker.getContainer.mockReturnValue({
      putArchive: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 })),
    });

    await expect(
      copyBufferToContainer(docker, "nonexistent", "/tmp", "file.txt", "content"),
    ).rejects.toThrow(ContainerNotFoundError);
  });
});

describe("readFileFromContainer", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should read a single file from container TAR response", async () => {
    const pack = tar.pack();
    pack.entry({ name: "app.log", size: 11 }, "log content");
    pack.finalize();

    docker.getContainer.mockReturnValue({
      getArchive: vi.fn().mockResolvedValue(pack),
    });

    const buffer = await readFileFromContainer(docker, "container-1", "/var/log/app.log");
    expect(buffer.toString("utf-8")).toBe("log content");
  });

  it("should throw FileNotFoundError for 404", async () => {
    docker.getContainer.mockReturnValue({
      getArchive: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 })),
    });

    await expect(readFileFromContainer(docker, "container-1", "/nonexistent")).rejects.toThrow(
      FileNotFoundError,
    );
  });

  it("should throw PermissionError for permission denied", async () => {
    docker.getContainer.mockReturnValue({
      getArchive: vi.fn().mockRejectedValue(new Error("permission denied")),
    });

    await expect(readFileFromContainer(docker, "container-1", "/root/secret")).rejects.toThrow(
      PermissionError,
    );
  });
});
