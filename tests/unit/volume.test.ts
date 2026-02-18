import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createVolume,
  removeVolume,
  inspectVolume,
  listVolumes,
  pruneVolumes,
  volumeExists,
} from "../../src/core/volume.js";
import {
  VolumeNotFoundError,
  VolumeInUseError,
  VolumeAlreadyExistsError,
} from "../../src/errors/base.js";
import type Docker from "dockerode";

function createMockDocker() {
  return {
    getVolume: vi.fn(),
    createVolume: vi.fn(),
    listVolumes: vi.fn(),
    pruneVolumes: vi.fn(),
  } as unknown as Docker & {
    getVolume: ReturnType<typeof vi.fn>;
    createVolume: ReturnType<typeof vi.fn>;
    listVolumes: ReturnType<typeof vi.fn>;
    pruneVolumes: ReturnType<typeof vi.fn>;
  };
}

const fakeVolumeData = {
  Name: "my-volume",
  Driver: "local",
  Mountpoint: "/var/lib/docker/volumes/my-volume/_data",
  Labels: { app: "test" },
  Scope: "local",
  CreatedAt: "2024-01-01T00:00:00Z",
  Status: null,
  UsageData: { Size: 1024, RefCount: 1 },
};

describe("createVolume", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should create a volume with default local driver", async () => {
    docker.getVolume.mockReturnValue({
      inspect: vi.fn().mockRejectedValue(
        Object.assign(new Error("not found"), { statusCode: 404 }),
      ),
    });
    docker.createVolume.mockResolvedValue(fakeVolumeData);

    const info = await createVolume(docker, { name: "my-volume" });

    expect(info.name).toBe("my-volume");
    expect(info.driver).toBe("local");
    expect(docker.createVolume).toHaveBeenCalledWith(
      expect.objectContaining({
        Name: "my-volume",
        Driver: "local",
      }),
    );
  });

  it("should pass driver opts and labels", async () => {
    docker.getVolume.mockReturnValue({
      inspect: vi.fn().mockRejectedValue(
        Object.assign(new Error("not found"), { statusCode: 404 }),
      ),
    });
    docker.createVolume.mockResolvedValue(fakeVolumeData);

    await createVolume(docker, {
      name: "my-vol",
      driver: "local",
      driverOpts: { type: "tmpfs", device: "tmpfs" },
      labels: { env: "test" },
    });

    expect(docker.createVolume).toHaveBeenCalledWith(
      expect.objectContaining({
        DriverOpts: { type: "tmpfs", device: "tmpfs" },
        Labels: { env: "test" },
      }),
    );
  });

  it("should throw VolumeAlreadyExistsError for duplicate name", async () => {
    docker.getVolume.mockReturnValue({
      inspect: vi.fn().mockResolvedValue(fakeVolumeData),
    });

    await expect(
      createVolume(docker, { name: "my-volume" }),
    ).rejects.toThrow(VolumeAlreadyExistsError);
  });
});

describe("removeVolume", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should remove a volume", async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    docker.getVolume.mockReturnValue({ remove: mockRemove });

    await removeVolume(docker, "my-volume");

    expect(mockRemove).toHaveBeenCalledWith({ force: false });
  });

  it("should force remove a volume", async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    docker.getVolume.mockReturnValue({ remove: mockRemove });

    await removeVolume(docker, "my-volume", true);

    expect(mockRemove).toHaveBeenCalledWith({ force: true });
  });

  it("should throw VolumeNotFoundError for 404", async () => {
    docker.getVolume.mockReturnValue({
      remove: vi.fn().mockRejectedValue(
        Object.assign(new Error("not found"), { statusCode: 404 }),
      ),
    });

    await expect(removeVolume(docker, "nonexistent")).rejects.toThrow(
      VolumeNotFoundError,
    );
  });

  it("should throw VolumeInUseError for 409", async () => {
    docker.getVolume.mockReturnValue({
      remove: vi.fn().mockRejectedValue(
        Object.assign(new Error("volume in use"), { statusCode: 409 }),
      ),
    });

    await expect(removeVolume(docker, "in-use-vol")).rejects.toThrow(
      VolumeInUseError,
    );
  });
});

describe("inspectVolume", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should return formatted volume info", async () => {
    docker.getVolume.mockReturnValue({
      inspect: vi.fn().mockResolvedValue(fakeVolumeData),
    });

    const info = await inspectVolume(docker, "my-volume");

    expect(info.name).toBe("my-volume");
    expect(info.driver).toBe("local");
    expect(info.mountpoint).toBe("/var/lib/docker/volumes/my-volume/_data");
    expect(info.labels).toEqual({ app: "test" });
    expect(info.usageData).toEqual({ size: 1024, refCount: 1 });
  });

  it("should throw VolumeNotFoundError for 404", async () => {
    docker.getVolume.mockReturnValue({
      inspect: vi.fn().mockRejectedValue(
        Object.assign(new Error("not found"), { statusCode: 404 }),
      ),
    });

    await expect(inspectVolume(docker, "nonexistent")).rejects.toThrow(
      VolumeNotFoundError,
    );
  });
});

describe("listVolumes", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should list all volumes", async () => {
    docker.listVolumes.mockResolvedValue({
      Volumes: [
        fakeVolumeData,
        {
          Name: "other-volume",
          Driver: "local",
          Mountpoint: "/var/lib/docker/volumes/other/_data",
          Labels: {},
          Scope: "local",
          CreatedAt: "2024-01-02T00:00:00Z",
        },
      ],
    });

    const volumes = await listVolumes(docker);

    expect(volumes).toHaveLength(2);
    expect(volumes[0].name).toBe("my-volume");
    expect(volumes[1].name).toBe("other-volume");
  });

  it("should handle empty volumes list", async () => {
    docker.listVolumes.mockResolvedValue({ Volumes: [] });

    const volumes = await listVolumes(docker);
    expect(volumes).toHaveLength(0);
  });

  it("should pass filters to Docker API", async () => {
    docker.listVolumes.mockResolvedValue({ Volumes: [] });

    await listVolumes(docker, { dangling: true });

    expect(docker.listVolumes).toHaveBeenCalledWith({
      filters: expect.stringContaining("dangling"),
    });
  });
});

describe("pruneVolumes", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should return deleted volumes and space reclaimed", async () => {
    docker.pruneVolumes.mockResolvedValue({
      VolumesDeleted: ["old-vol-1", "old-vol-2"],
      SpaceReclaimed: 5242880,
    });

    const result = await pruneVolumes(docker);

    expect(result.volumesDeleted).toEqual(["old-vol-1", "old-vol-2"]);
    expect(result.spaceReclaimed).toBe(5242880);
  });
});

describe("volumeExists", () => {
  let docker: ReturnType<typeof createMockDocker>;

  beforeEach(() => {
    docker = createMockDocker();
  });

  it("should return true for existing volume", async () => {
    docker.getVolume.mockReturnValue({
      inspect: vi.fn().mockResolvedValue(fakeVolumeData),
    });

    const exists = await volumeExists(docker, "my-volume");
    expect(exists).toBe(true);
  });

  it("should return false for non-existing volume", async () => {
    docker.getVolume.mockReturnValue({
      inspect: vi.fn().mockRejectedValue(
        Object.assign(new Error("not found"), { statusCode: 404 }),
      ),
    });

    const exists = await volumeExists(docker, "nonexistent");
    expect(exists).toBe(false);
  });
});
