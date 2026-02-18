/**
 * Static Docker API response fixtures for all major endpoints.
 * These represent realistic responses from the Docker Engine API.
 */

// ---------------------------------------------------------------------------
// Container Responses
// ---------------------------------------------------------------------------

export const containerCreateResponse = {
  Id: "e90e34656806",
  Warnings: [],
};

export const containerListResponse = [
  {
    Id: "8dfafdbc3a40",
    Names: ["/boring_feynman"],
    Image: "ubuntu:latest",
    ImageID: "sha256:d131e0fa2585a7efbfb187f70d648aa50e251d9d3b7f1f68a8f1da1e81a7a15e",
    Command: "/bin/bash",
    Created: 1367854155,
    State: "running",
    Status: "Up 5 minutes",
    Ports: [
      { PrivatePort: 2222, PublicPort: 3333, Type: "tcp" },
    ],
    Labels: { com_example_vendor: "Acme", com_example_license: "GPL" },
    SizeRw: 12288,
    SizeRootFs: 0,
    HostConfig: { NetworkMode: "default" },
    NetworkSettings: {
      Networks: {
        bridge: {
          NetworkID: "7ea29fc1412292a2d7bba362f9253545fecdfa8ce9a6e37dd10ba8bee7129812",
          EndpointID: "2cdc4edb1ded3631c81f57966563e5c8525b81121bb3706b89a0df573049c6d0",
          Gateway: "172.17.0.1",
          IPAddress: "172.17.0.2",
          IPPrefixLen: 16,
          MacAddress: "02:42:ac:11:00:02",
        },
      },
    },
    Mounts: [],
  },
];

export const containerInspectResponse = {
  Id: "abc123def456",
  Created: "2024-01-15T09:00:00.000000000Z",
  Path: "sh",
  Args: [],
  State: {
    Status: "running",
    Running: true,
    Paused: false,
    Restarting: false,
    OOMKilled: false,
    Dead: false,
    Pid: 1234,
    ExitCode: 0,
    Error: "",
    StartedAt: "2024-01-15T10:00:00.000000000Z",
    FinishedAt: "0001-01-01T00:00:00Z",
  },
  Image: "sha256:abc123image",
  Name: "/test-container",
  Config: {
    Hostname: "test-contai",
    Env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],
    Cmd: ["sh"],
    Image: "alpine:latest",
    Labels: {},
  },
  NetworkSettings: {
    IPAddress: "172.17.0.2",
    Ports: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }] },
    Networks: {
      bridge: {
        IPAddress: "172.17.0.2",
        Gateway: "172.17.0.1",
      },
    },
  },
  HostConfig: {
    Binds: [],
    PortBindings: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }] },
    RestartPolicy: { Name: "no", MaximumRetryCount: 0 },
    NetworkMode: "bridge",
    Memory: 0,
    NanoCpus: 0,
    CapAdd: null,
    CapDrop: null,
    ReadonlyRootfs: false,
  },
  Mounts: [],
};

// ---------------------------------------------------------------------------
// Image Responses
// ---------------------------------------------------------------------------

export const imageListResponse = [
  {
    Id: "sha256:d4ff818577bc193b309b355b02ebc9220427090057b54a59e73b79bdfe139b83",
    ParentId: "",
    RepoTags: ["alpine:latest"],
    RepoDigests: ["alpine@sha256:c5b1261d6d3e43071626931fc004f70149baeba2c8ec672bd4f27761f8e1ad6b"],
    Created: 1700000000,
    Size: 7633757,
    VirtualSize: 7633757,
    SharedSize: -1,
    Labels: null,
    Containers: -1,
  },
  {
    Id: "sha256:e3c71d48cdbd96e9ef963f1c4547e783bbfe4cf4e1f5c3e7a6c3cf4e8b5f6c7a",
    ParentId: "",
    RepoTags: ["nginx:latest"],
    RepoDigests: ["nginx@sha256:abc123"],
    Created: 1700001000,
    Size: 142000000,
    VirtualSize: 142000000,
    SharedSize: -1,
    Labels: null,
    Containers: -1,
  },
];

export const imagePullProgressEvents = [
  { status: "Pulling from library/alpine", id: "latest" },
  { status: "Pulling fs layer", progressDetail: {}, id: "abc123" },
  { status: "Downloading", progressDetail: { current: 500000, total: 3000000 }, progress: "[=====>                                           ]  500kB/3MB", id: "abc123" },
  { status: "Downloading", progressDetail: { current: 3000000, total: 3000000 }, progress: "[==================================================>]  3MB/3MB", id: "abc123" },
  { status: "Download complete", progressDetail: {}, id: "abc123" },
  { status: "Extracting", progressDetail: { current: 3000000, total: 3000000 }, progress: "[==================================================>]  3MB/3MB", id: "abc123" },
  { status: "Pull complete", progressDetail: {}, id: "abc123" },
  { status: "Digest: sha256:d4ff818577bc193b309b355b02ebc9220427090057b54a59e73b79bdfe139b83" },
  { status: "Status: Downloaded newer image for alpine:latest" },
];

// ---------------------------------------------------------------------------
// Network Responses
// ---------------------------------------------------------------------------

export const networkCreateResponse = {
  Id: "22be93d5babb089c5aab8dbc369042fad48ff791584ca2da2100db837a1c7c30",
  Warning: "",
};

export const networkListResponse = [
  {
    Name: "bridge",
    Id: "f2de39df4171b0dc801e8002c4b5e85e3903938cfb981ded62dab3e50e9e25f0",
    Created: "2024-01-15T09:00:00.000000000Z",
    Scope: "local",
    Driver: "bridge",
    EnableIPv6: false,
    IPAM: {
      Driver: "default",
      Config: [{ Subnet: "172.17.0.0/16", Gateway: "172.17.0.1" }],
    },
    Internal: false,
    Attachable: false,
    Containers: {},
    Options: { "com.docker.network.bridge.default_bridge": "true" },
    Labels: {},
  },
];

// ---------------------------------------------------------------------------
// Volume Responses
// ---------------------------------------------------------------------------

export const volumeCreateResponse = {
  Name: "test-volume",
  Driver: "local",
  Mountpoint: "/var/lib/docker/volumes/test-volume/_data",
  CreatedAt: "2024-01-15T09:00:00.000000000Z",
  Labels: {},
  Scope: "local",
  Options: null,
};

export const volumeListResponse = {
  Volumes: [
    {
      Name: "test-volume",
      Driver: "local",
      Mountpoint: "/var/lib/docker/volumes/test-volume/_data",
      CreatedAt: "2024-01-15T09:00:00.000000000Z",
      Labels: {},
      Scope: "local",
      Options: null,
    },
  ],
  Warnings: [],
};

export const volumePruneResponse = {
  VolumesDeleted: ["unused-volume-1", "unused-volume-2"],
  SpaceReclaimed: 1048576,
};

// ---------------------------------------------------------------------------
// System / Version Responses
// ---------------------------------------------------------------------------

export const versionResponse = {
  Version: "24.0.0",
  ApiVersion: "1.43",
  MinAPIVersion: "1.12",
  GitCommit: "abc123",
  GoVersion: "go1.21.0",
  Os: "linux",
  Arch: "amd64",
  KernelVersion: "5.15.0-91-generic",
  BuildTime: "2024-01-15T09:00:00.000000000Z",
};

export const pingResponse = "OK";

// ---------------------------------------------------------------------------
// Exec Responses
// ---------------------------------------------------------------------------

export const execCreateResponse = {
  Id: "exec-abc123",
};

export const execInspectResponse = {
  ID: "exec-abc123",
  Running: false,
  ExitCode: 0,
  ProcessConfig: {
    entrypoint: "/bin/sh",
    arguments: ["-c", "echo hello"],
    privileged: false,
    tty: false,
    user: "",
  },
  OpenStdin: false,
  OpenStdout: true,
  OpenStderr: true,
  Pid: 0,
  ContainerID: "container-abc123",
  CanRemove: false,
};
