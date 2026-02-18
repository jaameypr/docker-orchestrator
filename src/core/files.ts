import type Docker from "dockerode";
import * as fs from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";
import * as tar from "tar-stream";
import { mapDockerError } from "../errors/mapping.js";
import { ContainerNotFoundError, FileNotFoundError, PermissionError } from "../errors/base.js";
import {
  CopyToContainerOptionsSchema,
  CopyFromContainerOptionsSchema,
  type CopyToContainerOptions,
  type CopyFromContainerOptions,
} from "../types/files.js";

// ---------------------------------------------------------------------------
// TAR Stream Utilities
// ---------------------------------------------------------------------------

/**
 * Creates a TAR archive stream from a host filesystem path (file or directory).
 */
export function createTarFromPath(hostPath: string): Readable {
  const stat = fs.statSync(hostPath);
  const pack = tar.pack();

  if (stat.isFile()) {
    const content = fs.readFileSync(hostPath);
    const name = path.basename(hostPath);
    pack.entry(
      {
        name,
        size: content.length,
        mode: stat.mode,
        mtime: stat.mtime,
        uid: stat.uid,
        gid: stat.gid,
      },
      content,
    );
    pack.finalize();
  } else if (stat.isDirectory()) {
    packDirectory(pack, hostPath, "");
    pack.finalize();
  } else {
    pack.finalize();
  }

  return pack;
}

/**
 * Recursively packs a directory into a TAR archive.
 */
function packDirectory(pack: tar.Pack, rootPath: string, relativePath: string): void {
  const fullPath = path.join(rootPath, relativePath);
  const entries = fs.readdirSync(fullPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryRelative = path.join(relativePath, entry.name);
    const entryFull = path.join(rootPath, entryRelative);

    if (entry.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(entryFull);
      const stat = fs.lstatSync(entryFull);
      pack.entry({
        name: entryRelative,
        type: "symlink",
        linkname: linkTarget,
        mode: stat.mode,
        mtime: stat.mtime,
        uid: stat.uid,
        gid: stat.gid,
      });
    } else if (entry.isDirectory()) {
      const stat = fs.statSync(entryFull);
      pack.entry({
        name: entryRelative + "/",
        type: "directory",
        mode: stat.mode,
        mtime: stat.mtime,
        uid: stat.uid,
        gid: stat.gid,
      });
      packDirectory(pack, rootPath, entryRelative);
    } else if (entry.isFile()) {
      const stat = fs.statSync(entryFull);
      const content = fs.readFileSync(entryFull);
      pack.entry(
        {
          name: entryRelative,
          size: content.length,
          mode: stat.mode,
          mtime: stat.mtime,
          uid: stat.uid,
          gid: stat.gid,
        },
        content,
      );
    }
  }
}

/**
 * Creates a TAR archive stream from an in-memory buffer (single file).
 */
export function createTarFromBuffer(filename: string, content: Buffer | string): Readable {
  const pack = tar.pack();
  const buf = typeof content === "string" ? Buffer.from(content, "utf-8") : content;

  pack.entry({ name: filename, size: buf.length }, buf);
  pack.finalize();

  return pack;
}

/**
 * Extracts a TAR stream to a host filesystem path.
 */
export async function extractTarToPath(tarStream: Readable, destPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const extract = tar.extract();

    extract.on("entry", (header, stream, next) => {
      const entryPath = path.join(destPath, header.name);
      const dir = path.dirname(entryPath);

      // Ensure parent directory exists
      fs.mkdirSync(dir, { recursive: true });

      if (header.type === "directory") {
        fs.mkdirSync(entryPath, { recursive: true });
        if (header.mode) {
          try {
            fs.chmodSync(entryPath, header.mode);
          } catch {
            // Permission setting may fail on some systems
          }
        }
        stream.resume();
        next();
      } else if (header.type === "symlink" && header.linkname) {
        try {
          fs.symlinkSync(header.linkname, entryPath);
        } catch {
          // Symlink creation may fail
        }
        stream.resume();
        next();
      } else if (header.type === "file") {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          fs.writeFileSync(entryPath, Buffer.concat(chunks));
          if (header.mode) {
            try {
              fs.chmodSync(entryPath, header.mode);
            } catch {
              // Permission setting may fail
            }
          }
          next();
        });
        stream.on("error", reject);
      } else {
        stream.resume();
        next();
      }
    });

    extract.on("finish", resolve);
    extract.on("error", reject);

    tarStream.pipe(extract);
  });
}

// ---------------------------------------------------------------------------
// Host → Container
// ---------------------------------------------------------------------------

/**
 * Copies a file or directory from the host to a container.
 */
export async function copyToContainer(
  docker: Docker,
  containerId: string,
  options: CopyToContainerOptions,
): Promise<void> {
  const opts = CopyToContainerOptionsSchema.parse(options);

  // Validate source path on host
  if (!fs.existsSync(opts.sourcePath)) {
    throw new FileNotFoundError(opts.sourcePath, "host");
  }

  const tarStream = createTarFromPath(opts.sourcePath);
  const container = docker.getContainer(containerId);

  try {
    await container.putArchive(tarStream, { path: opts.destPath });
  } catch (err) {
    const error = err as { statusCode?: number; message?: string };
    if (error.statusCode === 404) {
      throw new ContainerNotFoundError(containerId, err instanceof Error ? err : undefined);
    }
    if (error.message?.includes("permission denied")) {
      throw new PermissionError(opts.destPath, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err, { containerId });
  }
}

// ---------------------------------------------------------------------------
// Container → Host
// ---------------------------------------------------------------------------

/**
 * Copies a file or directory from a container to the host.
 */
export async function copyFromContainer(
  docker: Docker,
  containerId: string,
  options: CopyFromContainerOptions,
): Promise<void> {
  const opts = CopyFromContainerOptionsSchema.parse(options);
  const container = docker.getContainer(containerId);

  let tarStream: NodeJS.ReadableStream;
  try {
    tarStream = await container.getArchive({ path: opts.sourcePath });
  } catch (err) {
    const error = err as { statusCode?: number; message?: string };
    if (error.statusCode === 404) {
      throw new FileNotFoundError(
        opts.sourcePath,
        "container",
        err instanceof Error ? err : undefined,
      );
    }
    if (error.message?.includes("permission denied")) {
      throw new PermissionError(opts.sourcePath, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err, { containerId });
  }

  // Ensure destination directory exists
  fs.mkdirSync(opts.destPath, { recursive: true });

  await extractTarToPath(tarStream as Readable, opts.destPath);
}

// ---------------------------------------------------------------------------
// Buffer-based Transfers
// ---------------------------------------------------------------------------

/**
 * Copies an in-memory buffer/string to a container as a file.
 * Useful for config files, scripts, etc. without touching the host filesystem.
 */
export async function copyBufferToContainer(
  docker: Docker,
  containerId: string,
  destPath: string,
  filename: string,
  content: Buffer | string,
): Promise<void> {
  const tarStream = createTarFromBuffer(filename, content);
  const container = docker.getContainer(containerId);

  try {
    await container.putArchive(tarStream, { path: destPath });
  } catch (err) {
    const error = err as { statusCode?: number; message?: string };
    if (error.statusCode === 404) {
      throw new ContainerNotFoundError(containerId, err instanceof Error ? err : undefined);
    }
    if (error.message?.includes("permission denied")) {
      throw new PermissionError(destPath, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err, { containerId });
  }
}

/**
 * Reads a single file from a container and returns it as a Buffer.
 * Does not extract to the host filesystem.
 */
export async function readFileFromContainer(
  docker: Docker,
  containerId: string,
  filePath: string,
): Promise<Buffer> {
  const container = docker.getContainer(containerId);

  let tarStream: NodeJS.ReadableStream;
  try {
    tarStream = await container.getArchive({ path: filePath });
  } catch (err) {
    const error = err as { statusCode?: number; message?: string };
    if (error.statusCode === 404) {
      throw new FileNotFoundError(filePath, "container", err instanceof Error ? err : undefined);
    }
    if (error.message?.includes("permission denied")) {
      throw new PermissionError(filePath, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err, { containerId });
  }

  return new Promise<Buffer>((resolve, reject) => {
    const extract = tar.extract();
    let fileBuffer: Buffer | null = null;

    extract.on("entry", (header, stream, next) => {
      if (header.type === "file") {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          fileBuffer = Buffer.concat(chunks);
          next();
        });
        stream.on("error", reject);
      } else {
        stream.resume();
        next();
      }
    });

    extract.on("finish", () => {
      if (fileBuffer === null) {
        reject(new FileNotFoundError(filePath, "container"));
      } else {
        resolve(fileBuffer);
      }
    });

    extract.on("error", reject);

    (tarStream as Readable).pipe(extract);
  });
}
