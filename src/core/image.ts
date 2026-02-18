import type Docker from "dockerode";
import { mapDockerError } from "../errors/mapping.js";
import { ImageNotFoundError } from "../errors/base.js";
import type { ImageInfo, PullProgressCallback, PullProgressEvent } from "../types/index.js";

/**
 * Checks whether an image exists locally.
 */
export async function imageExists(docker: Docker, name: string): Promise<boolean> {
  try {
    await docker.getImage(name).inspect();
    return true;
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      return false;
    }
    throw mapDockerError(err, { imageName: name });
  }
}

/**
 * Pulls an image from the registry.
 * Optionally reports progress through a callback.
 */
export async function pullImage(
  docker: Docker,
  name: string,
  onProgress?: PullProgressCallback,
): Promise<void> {
  let stream: NodeJS.ReadableStream;
  try {
    stream = await docker.pull(name);
  } catch (err) {
    throw mapDockerError(err, { imageName: name });
  }

  return new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err: Error | null) => {
        if (err) {
          reject(mapDockerError(err, { imageName: name }));
        } else {
          resolve();
        }
      },
      (event: PullProgressEvent) => {
        onProgress?.(event);
      },
    );
  });
}

/**
 * Lists all locally available images.
 */
export async function listImages(docker: Docker): Promise<ImageInfo[]> {
  try {
    const images = await docker.listImages();
    return images.map((img) => ({
      id: img.Id,
      repoTags: img.RepoTags ?? [],
      size: img.Size,
      created: img.Created,
    }));
  } catch (err) {
    throw mapDockerError(err);
  }
}

/**
 * Removes a local image.
 */
export async function removeImage(docker: Docker, name: string, force = false): Promise<void> {
  try {
    await docker.getImage(name).remove({ force });
  } catch (err) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      throw new ImageNotFoundError(name, err instanceof Error ? err : undefined);
    }
    throw mapDockerError(err, { imageName: name });
  }
}
