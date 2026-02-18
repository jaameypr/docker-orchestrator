import { describe, it, expect, vi, beforeEach } from "vitest";
import { imageExists, pullImage, listImages, removeImage } from "../../src/core/image.js";
import { ImageNotFoundError, DockerOrchestratorError } from "../../src/errors/base.js";
import type Docker from "dockerode";

function createMockDocker() {
  return {
    getImage: vi.fn(),
    pull: vi.fn(),
    listImages: vi.fn(),
    modem: {
      followProgress: vi.fn(),
    },
  } as unknown as Docker & {
    getImage: ReturnType<typeof vi.fn>;
    pull: ReturnType<typeof vi.fn>;
    listImages: ReturnType<typeof vi.fn>;
    modem: { followProgress: ReturnType<typeof vi.fn> };
  };
}

describe("imageExists", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should return true when image exists", async () => {
    docker.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({ Id: "sha256:abc" }),
    });

    const result = await imageExists(docker, "alpine:latest");
    expect(result).toBe(true);
    expect(docker.getImage).toHaveBeenCalledWith("alpine:latest");
  });

  it("should return false when image does not exist (404)", async () => {
    docker.getImage.mockReturnValue({
      inspect: vi.fn().mockRejectedValue({ statusCode: 404 }),
    });

    const result = await imageExists(docker, "nonexistent:latest");
    expect(result).toBe(false);
  });

  it("should throw on other errors", async () => {
    docker.getImage.mockReturnValue({
      inspect: vi.fn().mockRejectedValue(new Error("server error")),
    });

    await expect(imageExists(docker, "alpine:latest")).rejects.toThrow(DockerOrchestratorError);
  });
});

describe("pullImage", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should pull image and resolve on success", async () => {
    const fakeStream = {};
    docker.pull.mockResolvedValue(fakeStream);

    // Simulate followProgress calling onFinished with no error
    docker.modem.followProgress.mockImplementation(
      (_stream: unknown, onFinished: (err: Error | null) => void) => {
        onFinished(null);
      },
    );

    await expect(pullImage(docker, "alpine:latest")).resolves.toBeUndefined();
  });

  it("should call progress callback during pull", async () => {
    const fakeStream = {};
    docker.pull.mockResolvedValue(fakeStream);

    const progressEvents = [
      { status: "Pulling from library/alpine", id: "latest" },
      { status: "Downloading", progress: "50%" },
      { status: "Pull complete" },
    ];

    docker.modem.followProgress.mockImplementation(
      (
        _stream: unknown,
        onFinished: (err: Error | null) => void,
        onProgress: (event: { status: string; id?: string; progress?: string }) => void,
      ) => {
        for (const event of progressEvents) {
          onProgress(event);
        }
        onFinished(null);
      },
    );

    const callback = vi.fn();
    await pullImage(docker, "alpine:latest", callback);

    expect(callback).toHaveBeenCalledTimes(3);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ status: "Downloading" }),
    );
  });

  it("should reject on pull error", async () => {
    docker.pull.mockRejectedValue(new Error("unauthorized"));

    await expect(pullImage(docker, "private/image")).rejects.toThrow(DockerOrchestratorError);
  });

  it("should reject on stream error", async () => {
    const fakeStream = {};
    docker.pull.mockResolvedValue(fakeStream);

    docker.modem.followProgress.mockImplementation(
      (_stream: unknown, onFinished: (err: Error | null) => void) => {
        onFinished(new Error("network error"));
      },
    );

    await expect(pullImage(docker, "alpine:latest")).rejects.toThrow(DockerOrchestratorError);
  });
});

describe("listImages", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should list and transform images", async () => {
    docker.listImages.mockResolvedValue([
      {
        Id: "sha256:abc",
        RepoTags: ["alpine:latest"],
        Size: 5000000,
        Created: 1700000000,
      },
      {
        Id: "sha256:def",
        RepoTags: null,
        Size: 10000000,
        Created: 1700000001,
      },
    ]);

    const images = await listImages(docker);
    expect(images).toHaveLength(2);
    expect(images[0]).toEqual({
      id: "sha256:abc",
      repoTags: ["alpine:latest"],
      size: 5000000,
      created: 1700000000,
    });
    // null RepoTags becomes empty array
    expect(images[1].repoTags).toEqual([]);
  });
});

describe("removeImage", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should remove image successfully", async () => {
    docker.getImage.mockReturnValue({
      remove: vi.fn().mockResolvedValue(undefined),
    });

    await expect(removeImage(docker, "alpine:latest")).resolves.toBeUndefined();
  });

  it("should throw ImageNotFoundError for missing image", async () => {
    docker.getImage.mockReturnValue({
      remove: vi.fn().mockRejectedValue({ statusCode: 404, message: "not found" }),
    });

    await expect(removeImage(docker, "nonexistent")).rejects.toThrow(ImageNotFoundError);
  });
});
