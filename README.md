# @pruefertit/docker-orchestrator

A TypeScript-first Docker orchestration library for programmatic container lifecycle management, monitoring, networking, and resilient operations.

[![NPM Version](https://img.shields.io/npm/v/@pruefertit/docker-orchestrator)](https://www.npmjs.com/package/@pruefertit/docker-orchestrator)
[![CI Status](https://img.shields.io/github/actions/workflow/status/jaameypr/docker-orchestrator/ci.yml?branch=master&label=CI)](https://github.com/jaameypr/docker-orchestrator/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-green)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-%E2%89%A520.10-blue)](https://docs.docker.com/engine/)
[![npm downloads](https://img.shields.io/npm/dm/@pruefertit/docker-orchestrator)](https://www.npmjs.com/package/@pruefertit/docker-orchestrator)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)

---

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage Examples](#usage-examples)
  - [1. Container Lifecycle](#1-container-lifecycle)
  - [2. Configuration](#2-configuration)
  - [3. Monitoring](#3-monitoring)
  - [4. Exec & Files](#4-exec--files)
  - [5. Networking](#5-networking)
  - [6. Volumes](#6-volumes)
  - [7. Resource Limits](#7-resource-limits)
  - [8. Security](#8-security)
  - [9. Health Checks](#9-health-checks)
  - [10. Container Updates](#10-container-updates)
  - [11. Batch Operations](#11-batch-operations)
  - [12. Stack Deployment](#12-stack-deployment)
  - [13. Resilience & Error Handling](#13-resilience--error-handling)
  - [14. Advanced Patterns](#14-advanced-patterns)
  - [15. Attach/STDIN & Console](#15-attachstdin--console)
  - [16. Preset System](#16-preset-system)
- [API Quick Reference](#api-quick-reference)
  - [Orchestrator](#orchestrator)
  - [Client & Container](#client--container)
  - [Image](#image)
  - [Logs & Metrics](#logs--metrics)
  - [Events](#events)
  - [Exec & Files](#exec--files-1)
  - [Networking](#networking)
  - [Volume](#volume)
  - [Stack](#stack)
  - [Attach & Console](#attach--console)
  - [Presets](#presets)
  - [Config & Validation](#config--validation)
  - [Resilience](#resilience)
- [Configuration Reference](#configuration-reference)
  - [ContainerConfig](#containerconfig)
  - [Defaults](#defaults)
  - [Security Presets](#security-presets)
  - [Orchestrator Options](#orchestrator-options)
- [Error Handling Reference](#error-handling-reference)
  - [Error Classes](#error-classes)
  - [Transient vs. Permanent Errors](#transient-vs-permanent-errors)
  - [Retry Behavior per Operation](#retry-behavior-per-operation)
- [Troubleshooting](#troubleshooting)
- [Further Documentation](#further-documentation)
- [License](#license)
- [Links](#links)

---

## Features

- **Container Lifecycle Management** — Create, Start, Stop, Remove, Recreate with automatic rollback
- **Real-Time Log Streaming** — stdout/stderr separation, follow mode, tail, time-range filtering
- **Container Metrics** — CPU, Memory, Network I/O, Block I/O with continuous streaming
- **Docker Event System** — Subscribe to typed events with filtering and auto-reconnect
- **Command Execution** — Run commands in containers: simple exec, interactive TTY, script execution
- **Attach/STDIN Streaming** — Low-level container attach with stdin/stdout/stderr, fire-and-forget commands
- **Persistent Console** — Interactive container console with reconnect, output buffering, sendAndWait, and command queue
- **Preset System** — Reusable container configurations with merge logic, graceful stop hooks, and ready-check integration
- **Bidirectional File Transfer** — Copy files and buffers between host and container
- **Network Management** — Custom bridge/overlay/macvlan networks, DNS aliases, fixed IPs
- **Volume Management** — Named volumes, bind mounts, tmpfs with automatic creation
- **Flexible Port Mapping** — String/number/object syntax, ranges, UDP, auto-assign with availability checks
- **Resource Limits** — Memory (hard/soft), CPU (cores/shares), PID limits, Block I/O weights
- **Security Profiles** — Presets (hardened/standard/permissive), capabilities, read-only FS, seccomp
- **Health Checks** — HTTP, TCP, and exec-based checks with configurable intervals and timeouts
- **Batch Operations** — Parallel deploy/destroy/update with concurrency control and partial-failure handling
- **Resilience** — Retry with exponential backoff, circuit breaker, stream recovery, graceful shutdown
- **Stack Deployment** — Multi-container stacks with dependency ordering and service scaling
- **Fully Typed** — TypeScript-first with Zod schema validation, 200+ exported types

---

## Prerequisites

| Requirement | Version |
|---|---|
| **Node.js** | ≥ 18 (recommended: 20) |
| **Docker Engine** | ≥ 20.10 (API v1.41+) |
| **Platform** | Linux (primarily supported) |

Docker socket access (`/var/run/docker.sock`) must be available. The library auto-detects the default socket.

> **Security Notice:** Access to the Docker socket is functionally equivalent to root access on the host system. Ensure that only trusted processes are granted access.

---

## Installation

```bash
# npm
npm install @pruefertit/docker-orchestrator

# yarn
yarn add @pruefertit/docker-orchestrator

# pnpm
pnpm add @pruefertit/docker-orchestrator
```

The library has the following runtime dependencies:
- `dockerode` — Docker Engine API client
- `eventemitter3` — Event emitter
- `tar-stream` — TAR streaming for file transfer
- `zod` — Schema validation

---

## Quick Start

```typescript
import { createClient, createOrchestrator } from "@pruefertit/docker-orchestrator";

// 1. Create a Docker client (auto-detects socket)
const { docker } = await createClient();

// 2. Initialize the orchestrator
const orch = createOrchestrator(docker);

// 3. Deploy a container
const result = await orch.deploy({
  image: "nginx",
  name: "my-webserver",
  portMappings: ["8080:80"],
});

console.log(`Container ${result.name} is running (${result.containerId})`);
console.log(`Ports:`, result.ports);

// 4. Destroy the container
await orch.destroy(result.containerId);
```

---

## Usage Examples

### 1. Container Lifecycle

#### Create and start a container

```typescript
import { createClient, createOrchestrator } from "@pruefertit/docker-orchestrator";

const { docker } = await createClient();
const orch = createOrchestrator(docker);

const result = await orch.deploy({
  image: "nginx",
  tag: "alpine",
  name: "web",
  env: { NODE_ENV: "production" },
  portMappings: ["8080:80"],
});

console.log(`Status: ${result.status}`); // "running" or "healthy"
```

#### Stop a container with timeout

```typescript
// Graceful stop with 30-second timeout
await orch.destroy(containerId, { timeout: 30 });
```

#### Remove a container (normal and force)

```typescript
// Normal: graceful stop, then remove
await orch.destroy(containerId);

// Force: immediate kill + remove + delete volumes
await orch.destroy(containerId, { force: true, removeVolumes: true });
```

#### Inspect container state

```typescript
import { inspectContainer } from "@pruefertit/docker-orchestrator";

const info = await inspectContainer(docker, containerId);
console.log(`State: ${info.state.status}`);    // running, exited, paused, ...
console.log(`Image: ${info.image}`);
console.log(`Created: ${info.created}`);
```

#### List all running containers

```typescript
import { listContainers } from "@pruefertit/docker-orchestrator";

// Running containers only
const running = await listContainers(docker);

// All containers (including stopped)
const all = await listContainers(docker, { all: true });

for (const c of all) {
  console.log(`${c.name} (${c.id.substring(0, 12)}) — ${c.state}`);
}
```

---

### 2. Configuration

#### Minimal config (image only)

```typescript
await orch.deploy({ image: "alpine" });
```

#### Set environment variables

```typescript
await orch.deploy({
  image: "node",
  tag: "20-alpine",
  env: {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://db:5432/app",
    LOG_LEVEL: "info",
  },
});
```

#### Port mapping (all variants)

```typescript
await orch.deploy({
  image: "nginx",
  portMappings: [
    8080,                        // Same host and container port: 0.0.0.0:8080:8080/tcp
    "8080:80",                   // Host:Container
    "127.0.0.1:8080:80",        // With interface binding
    "8080:80/udp",               // UDP protocol
    {                            // Object syntax
      host: 9090,
      container: 80,
      protocol: "tcp",
      ip: "0.0.0.0",
    },
  ],
});
```

Port availability is automatically checked:

```typescript
import { checkPortAvailable } from "@pruefertit/docker-orchestrator";

const available = await checkPortAvailable(8080);
console.log(`Port 8080 available: ${available}`);
```

#### Volume mounts (all variants)

```typescript
await orch.deploy({
  image: "postgres",
  mounts: [
    "/host/data:/var/lib/postgresql/data",         // Bind mount
    "pgdata:/var/lib/postgresql/data",             // Named volume
    "/host/config:/etc/config:ro",                 // Read-only
    {                                              // Object syntax
      type: "bind",
      source: "/host/logs",
      target: "/var/log/app",
      readOnly: false,
    },
    {                                              // tmpfs
      type: "tmpfs",
      source: "",
      target: "/tmp",
      tmpfsSize: 100 * 1024 * 1024,               // 100 MB
    },
  ],
});
```

#### Labels, working directory, and entrypoint

```typescript
await orch.deploy({
  image: "node",
  tag: "20-alpine",
  labels: {
    "app.name": "my-service",
    "app.version": "2.1.0",
    "app.team": "backend",
  },
  workingDir: "/app",
  entrypoint: ["node"],
  cmd: ["server.js"],
});
```

---

### 3. Monitoring

#### Fetch logs (last N lines)

```typescript
import { tailLogs } from "@pruefertit/docker-orchestrator";

const entries = await tailLogs(docker, containerId, 100);
for (const entry of entries) {
  console.log(`[${entry.stream}] ${entry.message}`);
}
```

#### Start and stop a live log stream

```typescript
import { streamLogs } from "@pruefertit/docker-orchestrator";

const logStream = await streamLogs(docker, containerId, (entry) => {
  const prefix = entry.stream === "stderr" ? "ERR" : "OUT";
  console.log(`[${prefix}] ${entry.message}`);
});

// Stop the stream after 60 seconds
setTimeout(() => logStream.stop(), 60_000);
```

#### Handle stdout and stderr separately

```typescript
import { getContainerLogs } from "@pruefertit/docker-orchestrator";

const stream = await getContainerLogs(docker, containerId, {
  follow: true,
  stdout: true,
  stderr: true,
});

if ("on" in stream) {
  stream.on("data", (entry) => {
    if (entry.stream === "stderr") {
      process.stderr.write(entry.message + "\n");
    } else {
      process.stdout.write(entry.message + "\n");
    }
  });
}
```

#### Filter logs since a point in time

```typescript
import { getContainerLogs } from "@pruefertit/docker-orchestrator";

const entries = await getContainerLogs(docker, containerId, {
  since: new Date("2025-01-01T00:00:00Z"),
  timestamps: true,
  tail: 500,
});
```

#### Fetch one-time metrics

```typescript
import { getMetrics } from "@pruefertit/docker-orchestrator";

const metrics = await getMetrics(docker, containerId);

console.log(`CPU: ${metrics.cpu.percent.toFixed(2)}% (${metrics.cpu.cores} cores)`);
console.log(`RAM: ${(metrics.memory.usedBytes / 1024 / 1024).toFixed(1)} MB / ${(metrics.memory.limitBytes / 1024 / 1024).toFixed(1)} MB (${metrics.memory.percent.toFixed(1)}%)`);
console.log(`Net RX: ${metrics.network.rxBytes} bytes, TX: ${metrics.network.txBytes} bytes`);
console.log(`Disk Read: ${metrics.blockIO.readBytes} bytes, Write: ${metrics.blockIO.writeBytes} bytes`);
```

#### Start a continuous metrics stream

```typescript
import { streamMetrics } from "@pruefertit/docker-orchestrator";

const metricsStream = await streamMetrics(docker, containerId, 5000); // Every 5 seconds

metricsStream.on("data", (metrics) => {
  console.log(`CPU: ${metrics.cpu.percent.toFixed(1)}% | RAM: ${metrics.memory.percent.toFixed(1)}%`);
});

metricsStream.on("error", (err) => console.error("Metrics error:", err));

// Stop later
metricsStream.stop();
```

#### Subscribe to and filter Docker events

```typescript
import { subscribeEvents } from "@pruefertit/docker-orchestrator";

const subscription = await subscribeEvents(docker, {
  type: "container",
  action: ["start", "stop", "die"],
});

subscription.on("container.start", (event) => {
  console.log(`Container started: ${event.actor.name}`);
});

subscription.on("container.die", (event) => {
  console.log(`Container died: ${event.actor.name} (Exit: ${event.actor.attributes.exitCode})`);
});

// All events
subscription.on("event", (event) => {
  console.log(`${event.type}.${event.action}: ${event.actor.id.substring(0, 12)}`);
});

// Unsubscribe
subscription.unsubscribe();
```

---

### 4. Exec & Files

#### Run a simple command and read output

```typescript
import { executeCommand } from "@pruefertit/docker-orchestrator";

const result = await executeCommand(docker, containerId, "ls -la /app");
console.log("stdout:", result.stdout);
console.log("stderr:", result.stderr);
console.log("Exit code:", result.exitCode);
```

#### Evaluate exit code

```typescript
const result = await executeCommand(docker, containerId, "test -f /app/config.json");

if (result.exitCode === 0) {
  console.log("Config file exists");
} else {
  console.log("Config file missing");
}
```

#### Command with env vars and working directory

```typescript
const result = await executeCommand(docker, containerId, "node migrate.js", {
  env: ["DATABASE_URL=postgres://localhost:5432/app"],
  workingDir: "/app",
  user: "node",
  timeout: 60_000,
});
```

#### Interactive shell session

```typescript
import { executeInteractive } from "@pruefertit/docker-orchestrator";

const handle = await executeInteractive(docker, containerId, "/bin/bash", {
  tty: true,
});

handle.stdout.on("data", (chunk) => process.stdout.write(chunk));
process.stdin.pipe(handle.stdin);

// Resize terminal
await handle.resize(120, 40);
```

#### Run a script inside a container

```typescript
import { executeScript } from "@pruefertit/docker-orchestrator";

// Run a local script inside the container
const result = await executeScript(docker, containerId, "/local/scripts/setup.sh");
console.log("Output:", result.stdout);
```

#### Copy a file from host to container

```typescript
import { copyToContainer } from "@pruefertit/docker-orchestrator";

await copyToContainer(docker, containerId, {
  sourcePath: "/local/app/config.json",
  destPath: "/app/config.json",
});
```

#### Copy a file from container to host

```typescript
import { copyFromContainer } from "@pruefertit/docker-orchestrator";

await copyFromContainer(docker, containerId, {
  sourcePath: "/app/data/export.csv",
  destPath: "/local/exports/export.csv",
});
```

#### Write a config file as a string into a container

```typescript
import { copyBufferToContainer } from "@pruefertit/docker-orchestrator";

const configContent = JSON.stringify({
  database: { host: "db", port: 5432 },
  redis: { host: "cache", port: 6379 },
}, null, 2);

await copyBufferToContainer(
  docker,
  containerId,
  "/app/config.json",
  Buffer.from(configContent),
);
```

---

### 5. Networking

#### Create a custom network

```typescript
import { createNetwork, removeNetwork } from "@pruefertit/docker-orchestrator";

const network = await createNetwork(docker, {
  name: "app-network",
  driver: "bridge",
  subnet: "172.20.0.0/16",
  gateway: "172.20.0.1",
  labels: { environment: "production" },
});

console.log(`Network created: ${network.id}`);
```

#### Connect a container to a network with a DNS alias

```typescript
import { connectContainer } from "@pruefertit/docker-orchestrator";

await connectContainer(docker, "app-network", containerId, {
  aliases: ["web", "frontend"],
});
```

#### Two containers communicating over a network

```typescript
const network = await createNetwork(docker, {
  name: "backend-net",
  driver: "bridge",
});

const db = await orch.deploy({
  image: "postgres",
  tag: "16-alpine",
  name: "db",
  networks: {
    "backend-net": { aliases: ["database"] },
  },
  env: { POSTGRES_PASSWORD: "secret" },
});

const app = await orch.deploy({
  image: "node",
  tag: "20-alpine",
  name: "app",
  networks: {
    "backend-net": { aliases: ["app"] },
  },
  env: { DATABASE_URL: "postgres://postgres:secret@database:5432/postgres" },
});

// 'app' can reach 'db' via the DNS alias "database"
```

#### Container with a fixed IP

```typescript
await orch.deploy({
  image: "nginx",
  name: "web-fixed-ip",
  networks: {
    "app-network": {
      ipv4Address: "172.20.0.100",
      aliases: ["web"],
    },
  },
});
```

#### Clean up networks

```typescript
import { pruneNetworks, disconnectContainer, removeNetwork } from "@pruefertit/docker-orchestrator";

// Remove a single network (containers must be disconnected first)
await disconnectContainer(docker, "app-network", containerId);
await removeNetwork(docker, "app-network");

// Remove all unused networks
const pruned = await pruneNetworks(docker);
```

---

### 6. Volumes

#### Create a named volume

```typescript
import { createVolume, inspectVolume } from "@pruefertit/docker-orchestrator";

const volume = await createVolume(docker, {
  name: "app-data",
  labels: { app: "my-service" },
});

console.log(`Volume: ${volume.name}, Mountpoint: ${volume.mountpoint}`);
```

#### Mount a volume into a container

```typescript
await orch.deploy({
  image: "postgres",
  name: "db",
  mounts: ["app-data:/var/lib/postgresql/data"],
});
```

#### Data persistence across container restarts

```typescript
// Deploy container with volume
const result = await orch.deploy({
  image: "postgres",
  name: "db-persistent",
  mounts: ["pgdata:/var/lib/postgresql/data"],
  env: { POSTGRES_PASSWORD: "secret" },
});

// Destroy the container (volume is preserved)
await orch.destroy(result.containerId);

// Start a new container with the same volume — data is still there
await orch.deploy({
  image: "postgres",
  name: "db-persistent-new",
  mounts: ["pgdata:/var/lib/postgresql/data"],
  env: { POSTGRES_PASSWORD: "secret" },
});
```

#### List and prune volumes

```typescript
import { listVolumes, pruneVolumes } from "@pruefertit/docker-orchestrator";

const volumes = await listVolumes(docker);
for (const vol of volumes) {
  console.log(`${vol.name} (Driver: ${vol.driver})`);
}

// Remove unused volumes
const pruned = await pruneVolumes(docker);
console.log(`Removed: ${pruned.volumesDeleted.length} volumes, ${pruned.spaceReclaimed} bytes freed`);
```

---

### 7. Resource Limits

#### Set memory limits (hard + soft)

```typescript
await orch.deploy({
  image: "node",
  tag: "20-alpine",
  name: "app-limited",
  resources: {
    memory: {
      limit: "512m",         // Hard limit: 512 MB
      reservation: "256m",   // Soft limit: 256 MB
      swap: "1g",            // Swap limit: 1 GB
      swappiness: 60,        // Swap tendency (0-100)
    },
  },
});
```

#### Set CPU limits

```typescript
await orch.deploy({
  image: "python",
  name: "worker",
  resources: {
    cpu: {
      nanoCpus: "1.5",      // 1.5 CPU cores
      shares: 512,           // Relative weight (default: 1024)
      cpusetCpus: "0,1",    // Use only cores 0 and 1
    },
  },
});
```

#### Set PID limit

```typescript
await orch.deploy({
  image: "nginx",
  name: "web-safe",
  resources: {
    pids: {
      limit: 200,            // Max 200 processes (fork bomb protection)
    },
  },
});
```

#### Monitor limits with metrics

```typescript
import { getMetrics } from "@pruefertit/docker-orchestrator";

const metrics = await getMetrics(docker, containerId);
const memPercent = metrics.memory.percent;

if (memPercent > 80) {
  console.warn(`Container is using ${memPercent.toFixed(1)}% of its memory limit!`);
}
```

---

### 8. Security

#### Use the `hardened` security preset

```typescript
await orch.deploy({
  image: "nginx",
  name: "secure-web",
  securityProfile: "hardened",
  // Automatically sets:
  // - user: "1000:1000"
  // - readonlyRootfs: true
  // - autoTmpfs: true (for /tmp, /var/run, etc.)
  // - capDrop: ["ALL"]
  // - noNewPrivileges: true
  // - seccomp: "default"
});
```

#### Set a non-root user

```typescript
await orch.deploy({
  image: "node",
  name: "app",
  security: {
    user: "1000:1000",
    groupAdd: ["audio", "video"],
  },
});
```

#### Drop and add capabilities

```typescript
await orch.deploy({
  image: "nginx",
  name: "web",
  security: {
    capDrop: ["ALL"],
    capAdd: ["NET_BIND_SERVICE"],   // Allow binding to ports below 1024 only
    noNewPrivileges: true,
  },
});
```

#### Read-only root filesystem with tmpfs for writable paths

```typescript
await orch.deploy({
  image: "nginx",
  name: "readonly-web",
  security: {
    readonlyRootfs: true,
    tmpfsMounts: {
      "/tmp": "size=64m",
      "/var/run": "size=16m",
      "/var/cache/nginx": "size=128m",
    },
  },
});
```

#### Load a custom seccomp profile

```typescript
await orch.deploy({
  image: "app",
  name: "custom-seccomp",
  security: {
    seccomp: { profilePath: "/path/to/seccomp-profile.json" },
    noNewPrivileges: true,
  },
});
```

#### Combine a preset with individual overrides

```typescript
// Use the hardened preset as a base, but allow NET_BIND_SERVICE
await orch.deploy({
  image: "nginx",
  name: "hardened-web",
  securityProfile: "hardened",
  security: {
    capAdd: ["NET_BIND_SERVICE"],
    user: "nginx:nginx",           // Override 1000:1000
  },
});
```

---

### 9. Health Checks

#### HTTP health check

```typescript
await orch.deploy({
  image: "nginx",
  name: "web-healthy",
  portMappings: ["8080:80"],
  healthCheck: {
    type: "http",
    httpGet: {
      path: "/health",
      port: 80,
      expectedStatus: 200,
    },
    interval: 10,       // Check every 10 seconds
    timeout: 5,          // 5-second timeout per check
    retries: 3,          // 3 failures = unhealthy
    startPeriod: 15,     // 15-second grace period after start
  },
});
```

#### TCP health check

```typescript
await orch.deploy({
  image: "postgres",
  name: "db",
  healthCheck: {
    type: "tcp",
    tcpSocket: { port: 5432 },
    interval: 5,
    timeout: 3,
    retries: 5,
  },
});
```

#### Exec health check

```typescript
await orch.deploy({
  image: "redis",
  name: "cache",
  healthCheck: {
    type: "exec",
    exec: { command: ["redis-cli", "ping"] },
    interval: 10,
    timeout: 5,
    retries: 3,
  },
});
```

#### Wait for healthy status after deploy

```typescript
import { waitForHealthy } from "@pruefertit/docker-orchestrator";

const hcResult = await waitForHealthy(docker, containerId, {
  type: "http",
  httpGet: { path: "/ready", port: 8080 },
  interval: 2,
  timeout: 5,
  retries: 10,
  startPeriod: 5,
});

if (hcResult.status === "healthy") {
  console.log(`Container healthy after ${hcResult.checks} checks (${hcResult.elapsed}ms)`);
} else {
  console.error(`Health check failed: ${hcResult.lastError}`);
}
```

#### Timeout handling on health check failure

```typescript
try {
  const result = await orch.deploy({
    image: "broken-app",
    name: "will-fail",
    healthCheck: {
      type: "http",
      httpGet: { path: "/health", port: 8080 },
      interval: 2,
      timeout: 3,
      retries: 3,
    },
  });
} catch (err) {
  if (err instanceof DeploymentFailedError && err.step === "healthcheck") {
    console.error("Container failed health check — was automatically removed");
  }
}
```

---

### 10. Container Updates

#### Update a container with a new config (env var change)

```typescript
const updateResult = await orch.update(containerId, {
  env: { LOG_LEVEL: "debug", FEATURE_FLAG: "true" },
});

console.log(`Changes: ${updateResult.changes.length}`);
console.log(`Restart required: ${updateResult.restarted}`);
for (const change of updateResult.changes) {
  console.log(`  ${change.field}: ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)}`);
}
```

#### Image update with recreation

```typescript
// Image changes automatically require a container restart
const updateResult = await orch.update(containerId, {
  image: "nginx",
  tag: "1.27-alpine",
});

console.log(`New container: ${updateResult.containerId}`);
console.log(`Restarted: ${updateResult.restarted}`); // true
```

#### Show config diff before updating

```typescript
import { diffConfigs } from "@pruefertit/docker-orchestrator";

const currentConfig = { image: "nginx", tag: "1.25", env: { A: "1" } };
const newConfig = { image: "nginx", tag: "1.27", env: { A: "2", B: "3" } };

const changes = diffConfigs(currentConfig, newConfig);
for (const change of changes) {
  console.log(`${change.field}: ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)}`);
}
```

---

### 11. Batch Operations

#### Deploy multiple containers in parallel

```typescript
const batchResult = await orch.deployMany(
  [
    { image: "nginx", name: "web-1", portMappings: ["8081:80"] },
    { image: "nginx", name: "web-2", portMappings: ["8082:80"] },
    { image: "nginx", name: "web-3", portMappings: ["8083:80"] },
  ],
  {
    concurrency: 3,
    onProgress: (step, detail) => console.log(`${step}: ${detail}`),
  },
);

console.log(`Succeeded: ${batchResult.succeeded}, Failed: ${batchResult.failed}`);
```

#### Evaluate partial results

```typescript
for (const item of batchResult.results) {
  if (item.status === "fulfilled") {
    console.log(`[${item.index}] Deployed: ${item.value.containerId}`);
  } else {
    console.error(`[${item.index}] Error: ${item.reason.message}`);
  }
}
```

#### Destroy multiple containers in parallel

```typescript
const destroyResult = await orch.destroyMany(
  [container1Id, container2Id, container3Id],
  { force: true, concurrency: 5 },
);
```

#### Configure concurrency limit

```typescript
// Deploy at most 2 containers simultaneously (conserves resources)
const result = await orch.deployMany(configs, { concurrency: 2 });
```

---

### 12. Stack Deployment

#### Define a multi-container stack (app + DB)

```typescript
import { deployStack, destroyStack } from "@pruefertit/docker-orchestrator";

const stackResult = await deployStack(docker, {
  name: "my-app",
  containers: {
    db: {
      image: "postgres",
      tag: "16-alpine",
      env: { POSTGRES_PASSWORD: "secret", POSTGRES_DB: "app" },
      mounts: ["db-data:/var/lib/postgresql/data"],
      healthCheck: {
        type: "tcp",
        tcpSocket: { port: 5432 },
        interval: 5,
        timeout: 3,
        retries: 5,
      },
    },
    app: {
      image: "myapp",
      tag: "latest",
      dependsOn: ["db"],          // DB starts first
      env: { DATABASE_URL: "postgres://postgres:secret@db:5432/app" },
      portMappings: ["3000:3000"],
      healthCheck: {
        type: "http",
        httpGet: { path: "/health", port: 3000 },
        interval: 10,
        timeout: 5,
        retries: 3,
        startPeriod: 10,
      },
    },
  },
  networks: {
    default: { driver: "bridge" },
  },
  volumes: {
    "db-data": {},
  },
});

console.log(`Stack "${stackResult.stackName}" deployed`);
for (const svc of stackResult.services) {
  console.log(`  ${svc.serviceName}: ${svc.deployResults.length} instance(s)`);
}
```

#### Destroy a stack

```typescript
await destroyStack(docker, "my-app");
```

---

### 13. Resilience & Error Handling

#### Catch errors and check error type

```typescript
import {
  isDockerOrchestratorError,
  isTransientError,
  ContainerNotFoundError,
  PortAlreadyInUseError,
} from "@pruefertit/docker-orchestrator";

try {
  await orch.deploy({ image: "nginx", portMappings: ["80:80"] });
} catch (err) {
  if (isDockerOrchestratorError(err)) {
    console.error(`Code: ${err.code}, Message: ${err.message}`);
    console.error(`Timestamp: ${err.timestamp}`);
    console.error(`Context:`, err.context);

    if (err instanceof PortAlreadyInUseError) {
      console.error(`Port ${err.port} in use. Suggestion: ${err.suggestedPort}`);
    }

    if (isTransientError(err)) {
      console.log("Transient error — retry possible");
    }
  }
}
```

#### Customize retry policy

```typescript
const orch = createOrchestrator(docker, {
  retryPolicy: {
    imagePull: { maxRetries: 5, initialDelay: 3000 },
    containerStart: { maxRetries: 3, initialDelay: 2000 },
  },
});
```

Or use the `retry` function directly:

```typescript
import { retry } from "@pruefertit/docker-orchestrator";

const result = await retry(
  () => executeCommand(docker, containerId, "curl http://service/api"),
  {
    maxRetries: 5,
    initialDelay: 1000,
    maxDelay: 30_000,
    backoffMultiplier: 2,
    jitter: true,
    retryOn: (err) => isTransientError(err),
    onRetry: (attempt, err, nextDelay) => {
      console.log(`Retry ${attempt}, next attempt in ${nextDelay}ms`);
    },
  },
);
```

#### Query circuit breaker status

```typescript
const health = orch.health();
console.log(`Daemon: ${health.daemon}`);           // "connected" | "disconnected" | "reconnecting"
console.log(`Circuit: ${health.circuit}`);          // "closed" | "open" | "half-open"
console.log(`Pending Ops: ${health.pendingOperations}`);
```

Standalone circuit breaker:

```typescript
import { CircuitBreaker } from "@pruefertit/docker-orchestrator";

const breaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30_000,
  halfOpenMaxAttempts: 1,
});

breaker.on("circuit.open", () => console.warn("Circuit opened!"));
breaker.on("circuit.closed", () => console.log("Circuit closed"));

const result = await breaker.execute(() => fetch("http://service/api"));
```

#### Handle daemon disconnect/reconnect events

```typescript
import { DaemonMonitor } from "@pruefertit/docker-orchestrator";

const monitor = new DaemonMonitor(docker, {
  pingInterval: 10_000,
  failureThreshold: 3,
});

monitor.onDaemonDisconnect(() => {
  console.error("Docker daemon unreachable!");
});

monitor.onDaemonReconnect(() => {
  console.log("Docker daemon reconnected");
});

await monitor.start();

// Clean up
monitor.destroy();
```

#### Implement graceful shutdown

```typescript
import { ShutdownManager } from "@pruefertit/docker-orchestrator";

const shutdown = new ShutdownManager({ timeout: 15_000 });

// Register cleanup callbacks
shutdown.register("stop-containers", async () => {
  await orch.destroyMany(containerIds);
});

shutdown.register("close-connections", () => {
  // Close DB connections
});

// Install signal handlers (SIGINT, SIGTERM)
shutdown.installSignalHandlers();

// Or trigger manually
await shutdown.shutdown();
```

#### Check orchestrator health

```typescript
const status = orch.health();

if (status.daemon === "disconnected") {
  console.error("Docker daemon offline");
}

if (status.circuit === "open") {
  console.warn("Circuit breaker open — operations will be rejected");
}
```

#### Inject a custom logger

```typescript
import { createLogger, createOrchestrator } from "@pruefertit/docker-orchestrator";

const logger = createLogger({ level: "debug", json: true });

const orch = createOrchestrator(docker, { logger });
```

Or implement your own logger:

```typescript
import type { Logger } from "@pruefertit/docker-orchestrator";

const customLogger: Logger = {
  error: (msg, ctx) => myLoggingSystem.error(msg, ctx),
  warn: (msg, ctx) => myLoggingSystem.warn(msg, ctx),
  info: (msg, ctx) => myLoggingSystem.info(msg, ctx),
  debug: (msg, ctx) => myLoggingSystem.debug(msg, ctx),
  trace: (msg, ctx) => myLoggingSystem.trace(msg, ctx),
};

const orch = createOrchestrator(docker, { logger: customLogger });
```

---

### 14. Advanced Patterns

#### Run a container as a short-lived job

```typescript
const job = await orch.deploy({
  image: "node",
  tag: "20-alpine",
  name: "migration-job",
  cmd: ["node", "migrate.js"],
  restartPolicy: "no",
});

// Wait for completion
const container = docker.getContainer(job.containerId);
await container.wait();

// Read output
const logs = await tailLogs(docker, job.containerId, 1000);
console.log(logs.map((e) => e.message).join("\n"));

// Clean up
await orch.destroy(job.containerId, { removeVolumes: true });
```

#### Sidecar pattern: main container + log collector

```typescript
const network = await createNetwork(docker, { name: "sidecar-net", driver: "bridge" });

const app = await orch.deploy({
  image: "myapp",
  name: "app-main",
  networks: { "sidecar-net": { aliases: ["app"] } },
  mounts: ["shared-logs:/var/log/app"],
});

const logCollector = await orch.deploy({
  image: "fluentd",
  name: "log-collector",
  networks: { "sidecar-net": { aliases: ["logs"] } },
  mounts: ["shared-logs:/var/log/app:ro"],
});
```

#### Blue-green deployment

```typescript
// Start the new container (green)
const green = await orch.deploy({
  image: "myapp",
  tag: "v2.0.0",
  name: "app-green",
  portMappings: ["8081:8080"],
  healthCheck: {
    type: "http",
    httpGet: { path: "/health", port: 8080 },
    interval: 2,
    timeout: 5,
    retries: 5,
  },
});

if (green.status === "healthy") {
  // Redirect traffic (update load balancer config)
  console.log("Green is healthy — redirecting traffic");

  // Remove the old container (blue)
  await orch.destroy(blueContainerId);
  console.log("Blue removed — deployment complete");
} else {
  // Rollback: remove green
  await orch.destroy(green.containerId);
  console.error("Green health check failed — rolling back");
}
```

#### Periodic task: container for cron-like jobs

```typescript
async function runPeriodicJob() {
  const job = await orch.deploy({
    image: "myapp",
    tag: "latest",
    name: `cleanup-job-${Date.now()}`,
    cmd: ["node", "cleanup.js"],
    restartPolicy: "no",
    resources: { memory: { limit: "256m" }, cpu: { nanoCpus: "0.5" } },
  });

  const container = docker.getContainer(job.containerId);
  const { StatusCode } = await container.wait();

  if (StatusCode !== 0) {
    const logs = await tailLogs(docker, job.containerId, 50);
    console.error(`Job failed (Exit ${StatusCode}):`, logs.map((e) => e.message).join("\n"));
  }

  await orch.destroy(job.containerId, { removeVolumes: true });
}

// Run every 60 minutes
setInterval(runPeriodicJob, 60 * 60 * 1000);
```

---

### 15. Attach/STDIN & Console

#### Deploy a container with interactive STDIN

```typescript
const result = await orch.deploy({
  image: "alpine",
  name: "interactive-shell",
  cmd: ["cat"],
  interactive: true,  // Enables OpenStdin + AttachStdin
});

// Console is automatically available for interactive containers
const cons = result.console;
```

#### Low-level attach to a container

```typescript
import { attachContainer } from "@pruefertit/docker-orchestrator";

const { stream, demuxed, tty } = await attachContainer(docker, containerId);

// Send data
stream.write("hello\n");

// Receive output (non-TTY: demuxed stdout/stderr)
demuxed!.stdout.on("data", (chunk: Buffer) => {
  console.log("stdout:", chunk.toString());
});

demuxed!.stderr.on("data", (chunk: Buffer) => {
  console.error("stderr:", chunk.toString());
});

// Close stream
stream.end();
```

#### Send fire-and-forget commands

```typescript
import { sendCommand, sendCommands } from "@pruefertit/docker-orchestrator";

// Send a single command (no output returned)
await sendCommand(docker, containerId, "start-process");

// Send multiple commands sequentially
await sendCommands(docker, containerId, [
  "config set maxmemory 256mb",
  "config set maxmemory-policy allkeys-lru",
  "save",
], 100); // 100ms pause between commands
```

#### Via the orchestrator

```typescript
// Single command
await orch.attach.send(containerId, "reload-config");

// Multiple commands
await orch.attach.sendMany(containerId, ["cmd1", "cmd2"]);
```

#### Create a persistent console

```typescript
import { createConsole } from "@pruefertit/docker-orchestrator";

const console = await createConsole(docker, containerId, {
  reconnect: true,           // Auto-reconnect on connection loss
  reconnectMaxRetries: 10,   // Max 10 reconnect attempts
  outputBufferSize: 1000,    // Buffer last 1000 lines
  queueCommands: false,      // Queue commands when disconnected
});

// Or via the orchestrator
const console2 = await orch.attach.console(containerId);
```

#### Send a command and wait for a response

```typescript
const result = await console.sendAndWait("status", {
  matchOutput: "Server is running",  // Wait until this text appears
  timeout: 5000,                     // Wait max 5 seconds
});

console.log(`Output: ${result.output}`);
console.log(`Duration: ${result.duration}ms`);
```

#### Output buffer and events

```typescript
// Listen to all events
console.on("output", (line) => {
  console.log(`[${line.stream}] ${line.message}`);
});

console.on("connected", () => console.log("Connected"));
console.on("disconnected", () => console.log("Disconnected"));
console.on("reconnecting", (attempt) => console.log(`Reconnect #${attempt}`));

// Retrieve buffer
const buffer = console.getBuffer();
for (const line of buffer) {
  console.log(`[${line.timestamp.toISOString()}] ${line.message}`);
}

// Clear buffer
console.clearBuffer();

// Query uptime
console.log(`Connected for ${console.uptime}ms`);

// Disconnect
console.disconnect();
```

#### Enable TTY mode

```typescript
await orch.deploy({
  image: "alpine",
  name: "tty-container",
  cmd: ["/bin/sh"],
  interactive: true,
  tty: true,  // Enable TTY (pseudo-terminal)
});
```

---

### 16. Preset System

#### Define and register a preset

```typescript
import { definePreset } from "@pruefertit/docker-orchestrator";

const minecraftPreset = definePreset({
  name: "minecraft-server",
  config: {
    image: "itzg/minecraft-server",
    env: {
      EULA: "TRUE",
      TYPE: "PAPER",
      MEMORY: "2G",
    },
    portMappings: ["25565:25565"],
    mounts: ["mc-data:/data"],
    resources: { memory: { limit: "3g" } },
  },
  gracefulStop: {
    command: "stop",         // Command for clean shutdown
    waitForExit: true,       // Wait until container exits
    timeout: 30000,          // Wait max 30 seconds
  },
  readyCheck: {
    logMatch: /Done.*For help/,  // RegExp match on log output
    timeout: 120000,             // Wait max 2 minutes for ready
  },
  metadata: {
    description: "Minecraft Paper Server",
    version: "1.0.0",
  },
});

// Register with the orchestrator
orch.presets.register(minecraftPreset);
```

#### Register multiple presets

```typescript
orch.presets.registerMany([
  definePreset({ name: "redis", config: { image: "redis:alpine", cmd: ["redis-server"] } }),
  definePreset({ name: "postgres", config: { image: "postgres:16-alpine", env: { POSTGRES_PASSWORD: "secret" } } }),
]);
```

#### Deploy a container from a preset

```typescript
const result = await orch.deploy({
  image: "itzg/minecraft-server",
  preset: "minecraft-server",
  name: "mc-survival",
  env: { DIFFICULTY: "hard", MODE: "survival" },  // Merged with preset env
});

// Preset env + user env are merged:
// EULA=TRUE, TYPE=PAPER, MEMORY=2G (from preset)
// DIFFICULTY=hard, MODE=survival (user overrides)
```

#### Merge logic for preset + user config

```typescript
// Preset defines base config
const preset = definePreset({
  name: "web-app",
  config: {
    image: "node:20-alpine",
    env: { PORT: "3000", NODE_ENV: "production" },
    portMappings: ["3000:3000"],
    mounts: ["app-logs:/var/log"],
    labels: { "app.type": "web" },
  },
});

orch.presets.register(preset);

// User deploy merges intelligently:
await orch.deploy({
  image: "node:20-alpine",
  preset: "web-app",
  env: { NODE_ENV: "staging", DEBUG: "true" },      // Key-based: NODE_ENV is overridden, DEBUG is added
  portMappings: ["8080:3000"],                       // User ports override preset ports
  mounts: ["app-data:/data"],                        // Additive: both mounts are active
  labels: { "app.version": "2.0" },                  // Key-based: app.type remains, app.version is added
});
```

#### Graceful stop on destroy

```typescript
// On destroy, the gracefulStop command is sent automatically
await orch.destroy(result.containerId, { timeout: 60 });
// → Sends "stop" to the Minecraft server
// → Waits until container exits cleanly
// → Falls back to force-stop after timeout
```

#### Ready check on deploy

```typescript
// Container is not reported as "running" until the ready check passes
const result = await orch.deploy({
  image: "itzg/minecraft-server",
  preset: "minecraft-server",
  name: "mc-creative",
});

// result.status === "running" only once "Done.*For help" appears in the log
```

#### Manage presets

```typescript
// List all registered presets
const names = orch.presets.list();  // ["minecraft-server", "redis", "postgres"]

// Get a preset
const preset = orch.presets.get("minecraft-server");
console.log(preset.config.image);  // "itzg/minecraft-server"

// Check if preset exists
orch.presets.has("minecraft-server");  // true

// Remove a preset
orch.presets.remove("minecraft-server");

// Remove all presets
orch.presets.clear();
```

#### Serialize and load presets (JSON)

```typescript
import { serializePreset, deserializePreset } from "@pruefertit/docker-orchestrator";

// Serialize preset to JSON (with RegExp support)
const json = serializePreset(minecraftPreset);
// RegExp is stored as "__REGEXP__Done.*For help__FLAGS__"

// Load preset from JSON
const restored = deserializePreset(json);
orch.presets.register(restored);
```

#### Overwrite a preset

```typescript
// By default, register() throws an error on duplicates
try {
  orch.presets.register(definePreset({ name: "redis", config: { image: "redis:7" } }));
} catch (err) {
  // PresetAlreadyExistsError
}

// Allowed with overwrite option
orch.presets.register(
  definePreset({ name: "redis", config: { image: "redis:7" } }),
  { overwrite: true },
);
```

---

## API Quick Reference

### Orchestrator

| Method | Description | Return Type |
|---|---|---|
| `createOrchestrator(docker, options?)` | Factory function | `Orchestrator` |
| `orch.deploy(config, onProgress?)` | Deploy a container | `Promise<DeployResult>` |
| `orch.update(containerId, config, onProgress?)` | Update a container | `Promise<UpdateResult>` |
| `orch.destroy(containerId, options?)` | Destroy a container | `Promise<void>` |
| `orch.deployMany(configs, options?)` | Batch deploy | `Promise<BatchResult<DeployResult>>` |
| `orch.destroyMany(ids, options?)` | Batch destroy | `Promise<BatchResult<void>>` |
| `orch.updateMany(updates, options?)` | Batch update | `Promise<BatchResult<UpdateResult>>` |
| `orch.listManagedContainers()` | List managed containers | `Promise<Array<{ containerId, name, status, deployedAt }>>` |
| `orch.syncState()` | Sync state with Docker | `Promise<{ synced: number, orphans: string[] }>` |
| `orch.health()` | Query health status | `OrchestratorHealthStatus` |
| `orch.shutdown()` | Graceful shutdown | `Promise<void>` |
| `orch.presets` | Access preset registry | `PresetRegistry` |
| `orch.attach.send(id, cmd)` | Send fire-and-forget command | `Promise<void>` |
| `orch.attach.sendMany(id, cmds, delay?)` | Send multiple commands | `Promise<void>` |
| `orch.attach.console(id, options?)` | Create persistent console | `Promise<ContainerConsole>` |

### Client & Container

| Method | Description | Return Type |
|---|---|---|
| `createClient(options?)` | Create Docker client | `Promise<CreateClientResult>` |
| `createContainer(docker, config)` | Create container | `Promise<{ id }>` |
| `startContainer(docker, id)` | Start container | `Promise<void>` |
| `stopContainer(docker, id, timeout?)` | Stop container | `Promise<void>` |
| `removeContainer(docker, id, options?)` | Remove container | `Promise<void>` |
| `inspectContainer(docker, id)` | Inspect container | `Promise<ContainerInspectResult>` |
| `listContainers(docker, options?)` | List containers | `Promise<ContainerInfo[]>` |

### Image

| Method | Description | Return Type |
|---|---|---|
| `imageExists(docker, imageRef)` | Check if image exists | `Promise<boolean>` |
| `pullImage(docker, imageRef, onProgress?)` | Pull image | `Promise<void>` |
| `listImages(docker)` | List images | `Promise<ImageInfo[]>` |
| `removeImage(docker, imageRef)` | Remove image | `Promise<void>` |

### Logs & Metrics

| Method | Description | Return Type |
|---|---|---|
| `getContainerLogs(docker, id, options?)` | Fetch logs | `Promise<LogEntry[] \| LogStream>` |
| `tailLogs(docker, id, lines)` | Last N log lines | `Promise<LogEntry[]>` |
| `streamLogs(docker, id, onEntry)` | Live log stream | `Promise<LogStream>` |
| `getMetrics(docker, id)` | One-time metrics | `Promise<ContainerMetrics>` |
| `streamMetrics(docker, id, intervalMs?)` | Metrics stream | `Promise<MetricsStream>` |

### Events

| Method | Description | Return Type |
|---|---|---|
| `subscribeEvents(docker, filter?)` | Subscribe to Docker events | `Promise<EventSubscription>` |

### Exec & Files

| Method | Description | Return Type |
|---|---|---|
| `executeCommand(docker, id, cmd, options?)` | Execute command | `Promise<ExecResult>` |
| `executeInteractive(docker, id, cmd, options?)` | Interactive session | `Promise<InteractiveExecHandle>` |
| `executeScript(docker, id, scriptPath, options?)` | Execute script | `Promise<ExecResult>` |
| `copyToContainer(docker, id, options)` | Host → Container | `Promise<void>` |
| `copyFromContainer(docker, id, options)` | Container → Host | `Promise<void>` |
| `copyBufferToContainer(docker, id, destPath, buffer)` | Buffer → Container | `Promise<void>` |
| `readFileFromContainer(docker, id, filePath)` | Read file from container | `Promise<Buffer>` |

### Networking

| Method | Description | Return Type |
|---|---|---|
| `createNetwork(docker, options)` | Create network | `Promise<NetworkInfo>` |
| `removeNetwork(docker, name)` | Remove network | `Promise<void>` |
| `inspectNetwork(docker, name)` | Inspect network | `Promise<NetworkInfo>` |
| `listNetworks(docker, filter?)` | List networks | `Promise<NetworkInfo[]>` |
| `connectContainer(docker, network, id, options?)` | Connect container | `Promise<void>` |
| `disconnectContainer(docker, network, id)` | Disconnect container | `Promise<void>` |
| `pruneNetworks(docker)` | Remove unused networks | `Promise<string[]>` |

### Volume

| Method | Description | Return Type |
|---|---|---|
| `createVolume(docker, options)` | Create volume | `Promise<VolumeInfo>` |
| `removeVolume(docker, name, force?)` | Remove volume | `Promise<void>` |
| `inspectVolume(docker, name)` | Inspect volume | `Promise<VolumeInfo>` |
| `listVolumes(docker, filter?)` | List volumes | `Promise<VolumeInfo[]>` |
| `pruneVolumes(docker)` | Remove unused volumes | `Promise<PruneVolumesResult>` |
| `volumeExists(docker, name)` | Check if volume exists | `Promise<boolean>` |

### Stack

| Method | Description | Return Type |
|---|---|---|
| `deployStack(docker, config, onProgress?)` | Deploy stack | `Promise<StackDeployResult>` |
| `destroyStack(docker, stackName)` | Destroy stack | `Promise<void>` |
| `resolveDependencyOrder(containers)` | Resolve dependency order | `string[]` |

### Attach & Console

| Method / Class | Description | Return Type |
|---|---|---|
| `attachContainer(docker, id, options?)` | Low-level container attach | `Promise<AttachResult>` |
| `sendCommand(docker, id, command, timeout?)` | Send single command | `Promise<void>` |
| `sendCommands(docker, id, commands, delay?, timeout?)` | Send multiple commands | `Promise<void>` |
| `createConsole(docker, id, options?)` | Create persistent console | `Promise<ContainerConsole>` |
| `ContainerConsole` | Interactive container console | Class |
| `console.connect()` | Connect console | `Promise<void>` |
| `console.disconnect()` | Disconnect console | `void` |
| `console.send(command)` | Send command | `void` |
| `console.sendAndWait(command, options?)` | Send command and wait for response | `Promise<SendAndWaitResult>` |
| `console.getBuffer()` | Get output buffer | `ConsoleOutputLine[]` |
| `console.clearBuffer()` | Clear output buffer | `void` |

### Presets

| Method / Class | Description | Return Type |
|---|---|---|
| `definePreset(input)` | Define preset with validation | `ContainerPreset` |
| `serializePreset(preset)` | Serialize preset to JSON | `string` |
| `deserializePreset(json)` | Load preset from JSON | `ContainerPreset` |
| `mergePresetConfig(presetConfig, userOverrides)` | Merge preset and user config | `Partial<ContainerConfig>` |
| `PresetRegistry` | Registry for container presets | Class |
| `registry.register(preset, options?)` | Register preset | `void` |
| `registry.registerMany(presets, options?)` | Register multiple presets | `void` |
| `registry.get(name)` | Get preset | `ContainerPreset` |
| `registry.has(name)` | Check if preset exists | `boolean` |
| `registry.list()` | List all preset names | `string[]` |
| `registry.remove(name)` | Remove preset | `boolean` |
| `registry.clear()` | Remove all presets | `void` |

### Config & Validation

| Method | Description | Return Type |
|---|---|---|
| `buildContainerConfig(config)` | ContainerConfig → Docker config | `BuildContainerConfigResult` |
| `diffConfigs(oldConfig, newConfig)` | Calculate config diff | `ConfigDiff[]` |
| `validateResourceLimits(config)` | Validate resource config | `ConfigWarning[]` |
| `validateSecurityConfig(config)` | Validate security config | `ConfigWarning[]` |
| `validateProductionConfig(resources, security)` | Production validation | `ConfigWarning[]` |

### Resilience

| Method / Class | Description | Return Type |
|---|---|---|
| `retry(fn, options)` | Execute function with retry | `Promise<T>` |
| `CircuitBreaker` | Circuit breaker pattern | Class |
| `withTimeout(promise, ms, message?)` | Timeout wrapper | `Promise<T>` |
| `DaemonMonitor` | Docker daemon monitoring | Class |
| `ShutdownManager` | Graceful shutdown manager | Class |
| `ResilientStream` | Stream with auto-reconnect | Class |

Full API documentation: [`docs/api.md`](docs/api.md)

---

## Configuration Reference

### ContainerConfig

```typescript
interface ContainerConfig {
  // === Base ===
  image: string;                     // Docker image (required)
  name?: string;                     // Container name
  tag?: string;                      // Image tag (default: "latest")
  cmd?: string[];                    // CMD override
  entrypoint?: string[];             // Entrypoint override
  env?: Record<string, string>;      // Environment variables
  labels?: Record<string, string>;   // Container labels
  workingDir?: string;               // Working directory

  // === Network ===
  portMappings?: PortMappingInput[]; // Port mappings (string/number/object)
  networks?: Record<string, {        // Custom networks
    aliases?: string[];
    ipv4Address?: string;
  }>;
  hostname?: string;                 // Container hostname
  domainName?: string;               // Domain name
  dns?: string[];                    // DNS servers

  // === Storage ===
  mounts?: MountInput[];             // Mounts (string/object)
  tmpfs?: Record<string, string>;    // Tmpfs mounts

  // === Resources ===
  resources?: ResourceConfig;        // CPU, memory, I/O limits

  // === Security ===
  security?: SecurityConfig;         // Detailed security config
  securityProfile?:                  // Security preset
    | "hardened"
    | "standard"
    | "permissive";

  // === Interactive / TTY ===
  interactive?: boolean;             // Enable OpenStdin + AttachStdin (default: false)
  tty?: boolean;                     // Enable pseudo-terminal (default: false)
  preset?: string;                   // Name of a registered preset

  // === Lifecycle ===
  restartPolicy?:                    // Restart policy
    | "no"
    | "always"
    | "unless-stopped"               // (default)
    | "on-failure";
  stopTimeout?: number;              // Graceful stop timeout in seconds (default: 10)
  healthCheck?: HealthCheckConfig;   // Health check configuration

  // === Meta ===
  production?: boolean;              // Enable strict warnings
  suppressWarnings?: string[];       // Suppress specific warnings
}
```

### Defaults

| Field | Default | Description |
|---|---|---|
| `tag` | `"latest"` | Image tag |
| `restartPolicy` | `"unless-stopped"` | Restart behavior |
| `stopTimeout` | `10` | Seconds until force-kill |
| `securityProfile` | `"standard"` | Security preset |

### Security Presets

| Preset | User | ReadOnly FS | Capabilities | No New Privileges | Seccomp |
|---|---|---|---|---|---|
| **`hardened`** | `1000:1000` | `true` | Drop ALL | `true` | `default` |
| **`standard`** | — | — | Docker default | `true` | `default` |
| **`permissive`** | — | — | Docker default | — | — |

### Orchestrator Options

```typescript
interface OrchestratorOptions {
  defaultNetwork?: string;           // Default network for all containers
  defaultSecurityProfile?:           // Default security preset
    | "hardened" | "standard" | "permissive";
  defaultLabels?: Record<string, string>; // Labels applied to all containers
  retryPolicy?: Partial<RetryPolicies>;   // Retry configuration
  circuitBreaker?:                   // Circuit breaker (false = disabled)
    | Partial<CircuitBreakerOptions>
    | false;
  timeouts?: Partial<TimeoutConfig>; // Timeout configuration
  logger?: Logger;                   // Custom logger
  daemonMonitor?:                    // Daemon monitoring
    | boolean
    | Partial<DaemonMonitorOptions>;
}
```

---

## Error Handling Reference

### Error Classes

All errors extend `DockerOrchestratorError` and include `code`, `cause`, `context`, and `timestamp`.

| Class | Code | Description |
|---|---|---|
| **Connection** | | |
| `ConnectionError` | `CONNECTION_ERROR` | Failed to connect to Docker socket |
| `DockerDaemonNotRunningError` | `DOCKER_DAEMON_NOT_RUNNING` | Docker daemon not running |
| `DockerApiVersionError` | `DOCKER_API_VERSION_ERROR` | Incompatible API version |
| **Container** | | |
| `ContainerNotFoundError` | `CONTAINER_NOT_FOUND` | Container does not exist |
| `ContainerNotRunningError` | `CONTAINER_NOT_RUNNING` | Container is stopped |
| `ContainerAlreadyRunningError` | `CONTAINER_ALREADY_RUNNING` | Container is already running |
| `ContainerAlreadyStoppedError` | `CONTAINER_ALREADY_STOPPED` | Container is already stopped |
| `ContainerAlreadyExistsError` | `CONTAINER_ALREADY_EXISTS` | Name already taken |
| **Image** | | |
| `ImageNotFoundError` | `IMAGE_NOT_FOUND` | Image not found |
| `ImagePullError` | `IMAGE_PULL_ERROR` | Image download failed |
| **Resource** | | |
| `PortAlreadyInUseError` | `PORT_ALREADY_IN_USE` | Port in use |
| `InsufficientResourcesError` | `INSUFFICIENT_RESOURCES` | Not enough resources |
| `OOMKilledError` | `OOM_KILLED` | Out-of-memory kill |
| `VolumeInUseError` | `VOLUME_IN_USE` | Volume still in use |
| **Operation** | | |
| `CommandFailedError` | `COMMAND_FAILED` | Exec command failed |
| `CommandTimeoutError` | `COMMAND_TIMEOUT` | Command timed out |
| `HealthCheckTimeoutError` | `HEALTH_CHECK_TIMEOUT` | Health check timed out |
| `DeploymentFailedError` | `DEPLOYMENT_FAILED` | Deployment failed |
| `RecreationFailedError` | `RECREATION_FAILED` | Container recreation failed |
| `CriticalRecreationError` | `CRITICAL_RECREATION_ERROR` | Recreation + rollback failed |
| `UpdateFailedError` | `UPDATE_FAILED` | Update failed |
| `BatchOperationError` | `BATCH_OPERATION_ERROR` | Batch partially failed |
| `TimeoutError` | `TIMEOUT` | General timeout |
| `CircuitOpenError` | `CIRCUIT_OPEN` | Circuit breaker is open |
| **Config** | | |
| `ValidationError` | `VALIDATION_ERROR` | Config validation failed |
| `InvalidResourceConfigError` | `INVALID_RESOURCE_CONFIG` | Invalid resource config |
| `InvalidSecurityConfigError` | `INVALID_SECURITY_CONFIG` | Invalid security config |
| `InvalidMountError` | `INVALID_MOUNT` | Invalid mount specification |
| `InvalidSubnetError` | `INVALID_SUBNET` | IP not in subnet |
| **Network** | | |
| `NetworkNotFoundError` | `NETWORK_NOT_FOUND` | Network not found |
| `NetworkAlreadyExistsError` | `NETWORK_ALREADY_EXISTS` | Network already exists |
| `ContainerStillConnectedError` | `CONTAINER_STILL_CONNECTED` | Container still in network |
| **Volume** | | |
| `VolumeNotFoundError` | `VOLUME_NOT_FOUND` | Volume not found |
| `VolumeAlreadyExistsError` | `VOLUME_ALREADY_EXISTS` | Volume already exists |
| **Attach / Console** | | |
| `StdinNotAvailableError` | `STDIN_NOT_AVAILABLE` | Container does not have OpenStdin enabled |
| `ConsoleDisconnectedError` | `CONSOLE_DISCONNECTED` | Console is not connected |
| `ConsoleCommandTimeoutError` | `CONSOLE_COMMAND_TIMEOUT` | sendAndWait timeout exceeded |
| `GracefulStopTimeoutError` | `GRACEFUL_STOP_TIMEOUT` | Graceful stop timeout exceeded |
| **Preset** | | |
| `PresetNotFoundError` | `PRESET_NOT_FOUND` | Preset not found in registry |
| `PresetAlreadyExistsError` | `PRESET_ALREADY_EXISTS` | Preset already exists (without overwrite) |
| `PresetValidationError` | `PRESET_VALIDATION_ERROR` | Preset validation failed |
| `ReadyCheckTimeoutError` | `READY_CHECK_TIMEOUT` | Ready check timeout exceeded |
| **Other** | | |
| `FileNotFoundError` | `FILE_NOT_FOUND` | File not found |
| `PermissionError` | `PERMISSION_DENIED` | Access denied |
| `SeccompProfileNotFoundError` | `SECCOMP_PROFILE_NOT_FOUND` | Seccomp profile missing |
| `DependencyResolutionError` | `DEPENDENCY_RESOLUTION_ERROR` | Circular dependency |
| `DockerInternalError` | `DOCKER_INTERNAL_ERROR` | Internal Docker error |

### Transient vs. Permanent Errors

**Transient errors** (automatic retry possible):
- `CONNECTION_ERROR`, `DOCKER_DAEMON_NOT_RUNNING`, `TIMEOUT`, `COMMAND_TIMEOUT`, `DOCKER_INTERNAL_ERROR`
- Network errors: `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `socket hang up`

**Permanent errors** (no retry useful):
- `CONTAINER_NOT_FOUND`, `IMAGE_NOT_FOUND`, `VALIDATION_ERROR`, `PORT_ALREADY_IN_USE`, etc.

Check with `isTransientError(err)`:

```typescript
import { isTransientError } from "@pruefertit/docker-orchestrator";

try {
  await someOperation();
} catch (err) {
  if (isTransientError(err)) {
    // Retry logic
  } else {
    // Permanent error — do not retry
    throw err;
  }
}
```

### Retry Behavior per Operation

| Operation | Max Retries | Initial Delay | Description |
|---|---|---|---|
| `imagePull` | 3 | 2000 ms | Image download |
| `containerStart` | 2 | 1000 ms | Container start |
| `healthCheck` | 0 | — | No retry (own logic) |
| `exec` | 0 | — | No retry |
| `dockerPing` | 5 | 500 ms | Daemon connectivity |

---

## Troubleshooting

### Docker socket permission denied

```
Error: connect EACCES /var/run/docker.sock
```

**Solution:**
```bash
# Add current user to the docker group
sudo usermod -aG docker $USER
# Re-login or:
newgrp docker

# Alternative: adjust socket permissions (less secure)
sudo chmod 666 /var/run/docker.sock
```

### Cannot connect to Docker daemon

```
Error: DOCKER_DAEMON_NOT_RUNNING
```

**Solution:**
```bash
# Start Docker service
sudo systemctl start docker

# Check status
sudo systemctl status docker

# Check socket path
ls -la /var/run/docker.sock

# Use a custom socket path
const { docker } = await createClient({ socketPath: "/custom/path/docker.sock" });
```

### Port already in use

```
Error: PORT_ALREADY_IN_USE - Port 8080 is already in use
```

**Solution:**
```bash
# Find process on port
lsof -i :8080
# or
ss -tlnp | grep 8080

# Kill the process or use a different port
```

```typescript
// Programmatically: check port availability
import { checkPortAvailable } from "@pruefertit/docker-orchestrator";
const free = await checkPortAvailable(8080);
```

### Image not found

```
Error: IMAGE_NOT_FOUND - Image not found: myapp:v1.0
```

**Solution:**
- Check image name and tag: `docker pull myapp:v1.0`
- Private registry: login required (`docker login`)
- Check network connectivity to the registry

### OOM Killed

```
Error: OOM_KILLED - Container was killed by OOM killer
```

**Solution:**
```typescript
// Increase memory limit
await orch.deploy({
  image: "myapp",
  resources: {
    memory: {
      limit: "1g",           // Increase from 512m to 1g
      reservation: "512m",
    },
  },
});

// Monitor memory usage
const metrics = await getMetrics(docker, containerId);
console.log(`RAM: ${metrics.memory.percent}%`);
```

### Health check timeout

```
Error: HEALTH_CHECK_TIMEOUT - Health check timed out
```

**Solution:**
```typescript
await orch.deploy({
  image: "myapp",
  healthCheck: {
    type: "http",
    httpGet: { path: "/health", port: 8080 },
    interval: 15,        // Longer interval
    timeout: 10,         // More time per check
    retries: 10,         // More attempts
    startPeriod: 30,     // Longer warm-up period
  },
});
```

Also check:
- Is the health endpoint reachable? (`curl http://localhost:PORT/health`)
- Is the application starting correctly inside the container? (check logs)
- Does the port in the health check match the container port?

### Permission denied in container

```
Error: EACCES: permission denied
```

**Solution:**
```typescript
// Set user/UID explicitly
await orch.deploy({
  image: "myapp",
  security: {
    user: "1000:1000",    // UID:GID matching the files
  },
});
```

```bash
# Fix volume permissions on the host
sudo chown -R 1000:1000 /host/data

# Or set USER instruction in your Dockerfile
```

---

## License

MIT License — see [LICENSE](LICENSE) for details.

## Links

- [Repository](https://github.com/jaameypr/docker-orchestrator)
- [Issues & Bug Reports](https://github.com/jaameypr/docker-orchestrator/issues)
- [NPM](https://www.npmjs.com/package/@pruefertit/docker-orchestrator)

Maintained by me.
