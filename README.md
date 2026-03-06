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

## Features

- **Container-Lifecycle-Management** — Create, Start, Stop, Remove, Recreate with automatic rollback
- **Echtzeit-Log-Streaming** — stdout/stderr separation, follow mode, tail, time-range filtering
- **Container-Metriken** — CPU, Memory, Network I/O, Block I/O with continuous streaming
- **Docker-Event-System** — Subscribe to typed events with filtering and auto-reconnect
- **Command-Execution** — Run commands in containers: simple exec, interactive TTY, script execution
- **Attach/STDIN-Streaming** — Low-level container attach with stdin/stdout/stderr, fire-and-forget commands
- **Persistent Console** — Interactive container console with reconnect, output buffering, sendAndWait, and command queue
- **Preset-System** — Reusable container configurations with merge logic, graceful stop hooks, and ready-check integration
- **Bidirektionaler Datei-Transfer** — Copy files and buffers between host and container
- **Netzwerk-Management** — Custom bridge/overlay/macvlan networks, DNS aliases, fixed IPs
- **Volume-Management** — Named volumes, bind mounts, tmpfs with automatic creation
- **Flexibles Port-Mapping** — String/number/object syntax, ranges, UDP, auto-assign with availability checks
- **Resource-Limits** — Memory (hard/soft), CPU (cores/shares), PID limits, Block I/O weights
- **Security-Profile** — Presets (hardened/standard/permissive), capabilities, read-only FS, seccomp
- **Health-Checks** — HTTP, TCP, and exec-based checks with configurable intervals and timeouts
- **Batch-Operationen** — Parallel deploy/destroy/update with concurrency control and partial-failure handling
- **Resilienz** — Retry with exponential backoff, circuit breaker, stream recovery, graceful shutdown
- **Stack-Deployment** — Multi-container stacks with dependency ordering and service scaling
- **Vollständig typisiert** — TypeScript-first with Zod schema validation, 200+ exported types

---

## Voraussetzungen

| Voraussetzung | Version |
|---|---|
| **Node.js** | ≥ 18 (empfohlen: 20) |
| **Docker Engine** | ≥ 20.10 (API v1.41+) |
| **Plattform** | Linux (primär unterstützt) |

Docker-Socket-Zugriff (`/var/run/docker.sock`) muss verfügbar sein. Die Library erkennt den Standard-Socket automatisch.

> **Sicherheitshinweis:** Zugriff auf den Docker-Socket ist funktional äquivalent zu Root-Rechten auf dem Host-System. Stellen Sie sicher, dass nur vertrauenswürdige Prozesse Zugriff erhalten.

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

Die Library hat folgende Runtime-Dependencies:
- `dockerode` — Docker Engine API Client
- `eventemitter3` — Event Emitter
- `tar-stream` — TAR Streaming für Datei-Transfer
- `zod` — Schema-Validierung

---

## Quick-Start

```typescript
import { createClient, createOrchestrator } from "@pruefertit/docker-orchestrator";

// 1. Docker-Client erstellen (erkennt Socket automatisch)
const { docker } = await createClient();

// 2. Orchestrator initialisieren
const orch = createOrchestrator(docker);

// 3. Container deployen
const result = await orch.deploy({
  image: "nginx",
  name: "my-webserver",
  portMappings: ["8080:80"],
});

console.log(`Container ${result.name} läuft (${result.containerId})`);
console.log(`Ports:`, result.ports);

// 4. Container zerstören
await orch.destroy(result.containerId);
```

---

## Verwendungsbeispiele

### 6.1 Container-Lifecycle

#### Container erstellen und starten

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

console.log(`Status: ${result.status}`); // "running" oder "healthy"
```

#### Container stoppen mit Timeout

```typescript
// Graceful stop mit 30 Sekunden Timeout
await orch.destroy(containerId, { timeout: 30 });
```

#### Container löschen (normal und force)

```typescript
// Normal: Graceful stop, dann remove
await orch.destroy(containerId);

// Force: Sofortiges Kill + Remove + Volumes löschen
await orch.destroy(containerId, { force: true, removeVolumes: true });
```

#### Container-Status inspizieren

```typescript
import { inspectContainer } from "@pruefertit/docker-orchestrator";

const info = await inspectContainer(docker, containerId);
console.log(`State: ${info.state.status}`);    // running, exited, paused, ...
console.log(`Image: ${info.image}`);
console.log(`Created: ${info.created}`);
```

#### Alle laufenden Container auflisten

```typescript
import { listContainers } from "@pruefertit/docker-orchestrator";

// Nur laufende Container
const running = await listContainers(docker);

// Alle Container (inkl. gestoppte)
const all = await listContainers(docker, { all: true });

for (const c of all) {
  console.log(`${c.name} (${c.id.substring(0, 12)}) — ${c.state}`);
}
```

---

### 6.2 Konfiguration

#### Minimale Config (nur Image)

```typescript
await orch.deploy({ image: "alpine" });
```

#### Env-Vars setzen

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

#### Port-Mapping (alle Varianten)

```typescript
await orch.deploy({
  image: "nginx",
  portMappings: [
    8080,                        // Container + Host Port gleich: 0.0.0.0:8080:8080/tcp
    "8080:80",                   // Host:Container
    "127.0.0.1:8080:80",        // Mit Interface-Binding
    "8080:80/udp",               // UDP-Protokoll
    {                            // Objekt-Syntax
      host: 9090,
      container: 80,
      protocol: "tcp",
      ip: "0.0.0.0",
    },
  ],
});
```

Port-Verfügbarkeit wird automatisch geprüft:

```typescript
import { checkPortAvailable } from "@pruefertit/docker-orchestrator";

const available = await checkPortAvailable(8080);
console.log(`Port 8080 verfügbar: ${available}`);
```

#### Volume-Mounts (alle Varianten)

```typescript
await orch.deploy({
  image: "postgres",
  mounts: [
    "/host/data:/var/lib/postgresql/data",         // Bind-Mount
    "pgdata:/var/lib/postgresql/data",             // Named Volume
    "/host/config:/etc/config:ro",                 // Read-Only
    {                                              // Objekt-Syntax
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

#### Labels, Working-Directory und Entrypoint

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

### 6.3 Monitoring

#### Logs abrufen (letzte N Zeilen)

```typescript
import { tailLogs } from "@pruefertit/docker-orchestrator";

const entries = await tailLogs(docker, containerId, 100);
for (const entry of entries) {
  console.log(`[${entry.stream}] ${entry.message}`);
}
```

#### Live-Log-Stream starten und beenden

```typescript
import { streamLogs } from "@pruefertit/docker-orchestrator";

const logStream = await streamLogs(docker, containerId, (entry) => {
  const prefix = entry.stream === "stderr" ? "ERR" : "OUT";
  console.log(`[${prefix}] ${entry.message}`);
});

// Stream nach 60 Sekunden beenden
setTimeout(() => logStream.stop(), 60_000);
```

#### Stdout vs. Stderr getrennt verarbeiten

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

#### Logs seit Zeitpunkt filtern

```typescript
import { getContainerLogs } from "@pruefertit/docker-orchestrator";

const entries = await getContainerLogs(docker, containerId, {
  since: new Date("2025-01-01T00:00:00Z"),
  timestamps: true,
  tail: 500,
});
```

#### Einmalige Metriken abfragen

```typescript
import { getMetrics } from "@pruefertit/docker-orchestrator";

const metrics = await getMetrics(docker, containerId);

console.log(`CPU: ${metrics.cpu.percent.toFixed(2)}% (${metrics.cpu.cores} Kerne)`);
console.log(`RAM: ${(metrics.memory.usedBytes / 1024 / 1024).toFixed(1)} MB / ${(metrics.memory.limitBytes / 1024 / 1024).toFixed(1)} MB (${metrics.memory.percent.toFixed(1)}%)`);
console.log(`Net RX: ${metrics.network.rxBytes} bytes, TX: ${metrics.network.txBytes} bytes`);
console.log(`Disk Read: ${metrics.blockIO.readBytes} bytes, Write: ${metrics.blockIO.writeBytes} bytes`);
```

#### Kontinuierlichen Metriken-Stream starten

```typescript
import { streamMetrics } from "@pruefertit/docker-orchestrator";

const metricsStream = await streamMetrics(docker, containerId, 5000); // Alle 5 Sekunden

metricsStream.on("data", (metrics) => {
  console.log(`CPU: ${metrics.cpu.percent.toFixed(1)}% | RAM: ${metrics.memory.percent.toFixed(1)}%`);
});

metricsStream.on("error", (err) => console.error("Metriken-Fehler:", err));

// Später stoppen
metricsStream.stop();
```

#### Docker-Events abonnieren und filtern

```typescript
import { subscribeEvents } from "@pruefertit/docker-orchestrator";

const subscription = await subscribeEvents(docker, {
  type: "container",
  action: ["start", "stop", "die"],
});

subscription.on("container.start", (event) => {
  console.log(`Container gestartet: ${event.actor.name}`);
});

subscription.on("container.die", (event) => {
  console.log(`Container gestorben: ${event.actor.name} (Exit: ${event.actor.attributes.exitCode})`);
});

// Alle Events
subscription.on("event", (event) => {
  console.log(`${event.type}.${event.action}: ${event.actor.id.substring(0, 12)}`);
});

// Abonnement beenden
subscription.unsubscribe();
```

---

### 6.4 Exec & Dateien

#### Einfachen Command ausführen und Output lesen

```typescript
import { executeCommand } from "@pruefertit/docker-orchestrator";

const result = await executeCommand(docker, containerId, "ls -la /app");
console.log("stdout:", result.stdout);
console.log("stderr:", result.stderr);
console.log("Exit-Code:", result.exitCode);
```

#### Exit-Code auswerten

```typescript
const result = await executeCommand(docker, containerId, "test -f /app/config.json");

if (result.exitCode === 0) {
  console.log("Config-Datei existiert");
} else {
  console.log("Config-Datei fehlt");
}
```

#### Command mit Env-Vars und Working-Directory

```typescript
const result = await executeCommand(docker, containerId, "node migrate.js", {
  env: ["DATABASE_URL=postgres://localhost:5432/app"],
  workingDir: "/app",
  user: "node",
  timeout: 60_000,
});
```

#### Interaktive Shell-Session

```typescript
import { executeInteractive } from "@pruefertit/docker-orchestrator";

const handle = await executeInteractive(docker, containerId, "/bin/bash", {
  tty: true,
});

handle.stdout.on("data", (chunk) => process.stdout.write(chunk));
process.stdin.pipe(handle.stdin);

// Terminal-Größe anpassen
await handle.resize(120, 40);
```

#### Script im Container ausführen

```typescript
import { executeScript } from "@pruefertit/docker-orchestrator";

// Lokales Script im Container ausführen
const result = await executeScript(docker, containerId, "/local/scripts/setup.sh");
console.log("Output:", result.stdout);
```

#### Datei von Host in Container kopieren

```typescript
import { copyToContainer } from "@pruefertit/docker-orchestrator";

await copyToContainer(docker, containerId, {
  sourcePath: "/local/app/config.json",
  destPath: "/app/config.json",
});
```

#### Datei aus Container auf Host kopieren

```typescript
import { copyFromContainer } from "@pruefertit/docker-orchestrator";

await copyFromContainer(docker, containerId, {
  sourcePath: "/app/data/export.csv",
  destPath: "/local/exports/export.csv",
});
```

#### Config-Datei als String in Container schreiben

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

### 6.5 Netzwerk

#### Custom-Network erstellen

```typescript
import { createNetwork, removeNetwork } from "@pruefertit/docker-orchestrator";

const network = await createNetwork(docker, {
  name: "app-network",
  driver: "bridge",
  subnet: "172.20.0.0/16",
  gateway: "172.20.0.1",
  labels: { environment: "production" },
});

console.log(`Network erstellt: ${network.id}`);
```

#### Container in Network verbinden mit DNS-Alias

```typescript
import { connectContainer } from "@pruefertit/docker-orchestrator";

await connectContainer(docker, "app-network", containerId, {
  aliases: ["web", "frontend"],
});
```

#### Zwei Container kommunizieren über Network

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

// 'app' kann 'db' über den DNS-Alias "database" erreichen
```

#### Container mit fester IP

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

#### Network aufräumen

```typescript
import { pruneNetworks, disconnectContainer, removeNetwork } from "@pruefertit/docker-orchestrator";

// Einzelnes Network entfernen (Container müssen vorher disconnected werden)
await disconnectContainer(docker, "app-network", containerId);
await removeNetwork(docker, "app-network");

// Alle ungenutzten Networks aufräumen
const pruned = await pruneNetworks(docker);
```

---

### 6.6 Volumes

#### Named Volume erstellen

```typescript
import { createVolume, inspectVolume } from "@pruefertit/docker-orchestrator";

const volume = await createVolume(docker, {
  name: "app-data",
  labels: { app: "my-service" },
});

console.log(`Volume: ${volume.name}, Mountpoint: ${volume.mountpoint}`);
```

#### Volume an Container mounten

```typescript
await orch.deploy({
  image: "postgres",
  name: "db",
  mounts: ["app-data:/var/lib/postgresql/data"],
});
```

#### Daten-Persistenz über Container-Neustarts

```typescript
// Container deployen mit Volume
const result = await orch.deploy({
  image: "postgres",
  name: "db-persistent",
  mounts: ["pgdata:/var/lib/postgresql/data"],
  env: { POSTGRES_PASSWORD: "secret" },
});

// Container zerstören (Volume bleibt erhalten)
await orch.destroy(result.containerId);

// Neuen Container mit gleichem Volume starten — Daten sind noch da
await orch.deploy({
  image: "postgres",
  name: "db-persistent-new",
  mounts: ["pgdata:/var/lib/postgresql/data"],
  env: { POSTGRES_PASSWORD: "secret" },
});
```

#### Volumes auflisten und aufräumen

```typescript
import { listVolumes, pruneVolumes } from "@pruefertit/docker-orchestrator";

const volumes = await listVolumes(docker);
for (const vol of volumes) {
  console.log(`${vol.name} (Driver: ${vol.driver})`);
}

// Ungenutzte Volumes entfernen
const pruned = await pruneVolumes(docker);
console.log(`Entfernt: ${pruned.volumesDeleted.length} Volumes, ${pruned.spaceReclaimed} Bytes frei`);
```

---

### 6.7 Resource-Limits

#### Memory-Limit setzen (Hard + Soft)

```typescript
await orch.deploy({
  image: "node",
  tag: "20-alpine",
  name: "app-limited",
  resources: {
    memory: {
      limit: "512m",         // Hard-Limit: 512 MB
      reservation: "256m",   // Soft-Limit: 256 MB
      swap: "1g",            // Swap-Limit: 1 GB
      swappiness: 60,        // Swap-Neigung (0-100)
    },
  },
});
```

#### CPU-Limit setzen

```typescript
await orch.deploy({
  image: "python",
  name: "worker",
  resources: {
    cpu: {
      nanoCpus: "1.5",      // 1.5 CPU-Kerne
      shares: 512,           // Relative Gewichtung (Standard: 1024)
      cpusetCpus: "0,1",    // Nur Kerne 0 und 1 nutzen
    },
  },
});
```

#### PID-Limit setzen

```typescript
await orch.deploy({
  image: "nginx",
  name: "web-safe",
  resources: {
    pids: {
      limit: 200,            // Max. 200 Prozesse (Fork-Bomb-Schutz)
    },
  },
});
```

#### Limits mit Metriken überwachen

```typescript
import { getMetrics } from "@pruefertit/docker-orchestrator";

const metrics = await getMetrics(docker, containerId);
const memPercent = metrics.memory.percent;

if (memPercent > 80) {
  console.warn(`Container nutzt ${memPercent.toFixed(1)}% des Memory-Limits!`);
}
```

---

### 6.8 Security

#### Security-Preset `hardened` verwenden

```typescript
await orch.deploy({
  image: "nginx",
  name: "secure-web",
  securityProfile: "hardened",
  // Setzt automatisch:
  // - user: "1000:1000"
  // - readonlyRootfs: true
  // - autoTmpfs: true (für /tmp, /var/run, etc.)
  // - capDrop: ["ALL"]
  // - noNewPrivileges: true
  // - seccomp: "default"
});
```

#### Non-Root-User setzen

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

#### Capabilities droppen/adden

```typescript
await orch.deploy({
  image: "nginx",
  name: "web",
  security: {
    capDrop: ["ALL"],
    capAdd: ["NET_BIND_SERVICE"],   // Nur Port < 1024 binden erlauben
    noNewPrivileges: true,
  },
});
```

#### Read-Only Root-Filesystem mit tmpfs für beschreibbare Pfade

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

#### Custom-Seccomp-Profil laden

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

#### Preset mit einzelnen Overrides kombinieren

```typescript
// Hardened-Preset als Basis, aber NET_BIND_SERVICE erlauben
await orch.deploy({
  image: "nginx",
  name: "hardened-web",
  securityProfile: "hardened",
  security: {
    capAdd: ["NET_BIND_SERVICE"],
    user: "nginx:nginx",           // Statt 1000:1000
  },
});
```

---

### 6.9 Health-Checks

#### HTTP-Health-Check

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
    interval: 10,       // Alle 10 Sekunden prüfen
    timeout: 5,          // 5 Sekunden Timeout pro Prüfung
    retries: 3,          // 3 Fehlversuche = unhealthy
    startPeriod: 15,     // 15 Sekunden Wartezeit nach Start
  },
});
```

#### TCP-Health-Check

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

#### Exec-Health-Check

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

#### Auf Healthy-Status warten nach Deploy

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
  console.log(`Container healthy nach ${hcResult.checks} Checks (${hcResult.elapsed}ms)`);
} else {
  console.error(`Health-Check fehlgeschlagen: ${hcResult.lastError}`);
}
```

#### Timeout-Handling bei Health-Check-Failure

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
    console.error("Container hat Health-Check nicht bestanden — wurde automatisch entfernt");
  }
}
```

---

### 6.10 Container-Updates

#### Container mit neuer Config updaten (Env-Var-Änderung)

```typescript
const updateResult = await orch.update(containerId, {
  env: { LOG_LEVEL: "debug", FEATURE_FLAG: "true" },
});

console.log(`Änderungen: ${updateResult.changes.length}`);
console.log(`Neustart nötig: ${updateResult.restarted}`);
for (const change of updateResult.changes) {
  console.log(`  ${change.field}: ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)}`);
}
```

#### Image-Update mit Recreation

```typescript
// Image-Änderung erfordert automatisch Container-Neustart
const updateResult = await orch.update(containerId, {
  image: "nginx",
  tag: "1.27-alpine",
});

console.log(`Neuer Container: ${updateResult.containerId}`);
console.log(`Neugestartet: ${updateResult.restarted}`); // true
```

#### Config-Diff anzeigen vor Update

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

### 6.11 Batch-Operationen

#### Mehrere Container parallel deployen

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

console.log(`Erfolgreich: ${batchResult.succeeded}, Fehlgeschlagen: ${batchResult.failed}`);
```

#### Teilerfolge auswerten

```typescript
for (const item of batchResult.results) {
  if (item.status === "fulfilled") {
    console.log(`[${item.index}] Deployed: ${item.value.containerId}`);
  } else {
    console.error(`[${item.index}] Fehler: ${item.reason.message}`);
  }
}
```

#### Mehrere Container parallel zerstören

```typescript
const destroyResult = await orch.destroyMany(
  [container1Id, container2Id, container3Id],
  { force: true, concurrency: 5 },
);
```

#### Concurrency-Limit konfigurieren

```typescript
// Maximal 2 Container gleichzeitig deployen (schont Ressourcen)
const result = await orch.deployMany(configs, { concurrency: 2 });
```

---

### 6.12 Stack-Deployment

#### Multi-Container-Stack definieren (App + DB)

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
      dependsOn: ["db"],          // DB startet zuerst
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
  console.log(`  ${svc.serviceName}: ${svc.deployResults.length} Instanz(en)`);
}
```

#### Stack zerstören

```typescript
await destroyStack(docker, "my-app");
```

---

### 6.13 Resilienz & Error-Handling

#### Fehler abfangen und Error-Typ prüfen

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
      console.error(`Port ${err.port} belegt. Vorschlag: ${err.suggestedPort}`);
    }

    if (isTransientError(err)) {
      console.log("Transienter Fehler — Retry möglich");
    }
  }
}
```

#### Retry-Policy anpassen

```typescript
const orch = createOrchestrator(docker, {
  retryPolicy: {
    imagePull: { maxRetries: 5, initialDelay: 3000 },
    containerStart: { maxRetries: 3, initialDelay: 2000 },
  },
});
```

Oder direkt mit der `retry`-Funktion:

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
      console.log(`Retry ${attempt}, nächster Versuch in ${nextDelay}ms`);
    },
  },
);
```

#### Circuit-Breaker-Status abfragen

```typescript
const health = orch.health();
console.log(`Daemon: ${health.daemon}`);           // "connected" | "disconnected" | "reconnecting"
console.log(`Circuit: ${health.circuit}`);          // "closed" | "open" | "half-open"
console.log(`Pending Ops: ${health.pendingOperations}`);
```

Standalone Circuit-Breaker:

```typescript
import { CircuitBreaker } from "@pruefertit/docker-orchestrator";

const breaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30_000,
  halfOpenMaxAttempts: 1,
});

breaker.on("circuit.open", () => console.warn("Circuit geöffnet!"));
breaker.on("circuit.closed", () => console.log("Circuit geschlossen"));

const result = await breaker.execute(() => fetch("http://service/api"));
```

#### Daemon-Disconnect/Reconnect-Events behandeln

```typescript
import { DaemonMonitor } from "@pruefertit/docker-orchestrator";

const monitor = new DaemonMonitor(docker, {
  pingInterval: 10_000,
  failureThreshold: 3,
});

monitor.onDaemonDisconnect(() => {
  console.error("Docker-Daemon nicht erreichbar!");
});

monitor.onDaemonReconnect(() => {
  console.log("Docker-Daemon wieder verbunden");
});

await monitor.start();

// Aufräumen
monitor.destroy();
```

#### Graceful-Shutdown implementieren

```typescript
import { ShutdownManager } from "@pruefertit/docker-orchestrator";

const shutdown = new ShutdownManager({ timeout: 15_000 });

// Cleanup-Callbacks registrieren
shutdown.register("stop-containers", async () => {
  await orch.destroyMany(containerIds);
});

shutdown.register("close-connections", () => {
  // DB-Verbindungen schließen
});

// Signal-Handler installieren (SIGINT, SIGTERM)
shutdown.installSignalHandlers();

// Oder manuell auslösen
await shutdown.shutdown();
```

#### Orchestrator-Health prüfen

```typescript
const status = orch.health();

if (status.daemon === "disconnected") {
  console.error("Docker-Daemon offline");
}

if (status.circuit === "open") {
  console.warn("Circuit-Breaker offen — Operationen werden abgelehnt");
}
```

#### Custom-Logger injizieren

```typescript
import { createLogger, createOrchestrator } from "@pruefertit/docker-orchestrator";

const logger = createLogger({ level: "debug", json: true });

const orch = createOrchestrator(docker, { logger });
```

Oder eigenen Logger implementieren:

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

### 6.14 Fortgeschrittene Patterns

#### Container als kurzlebigen Job ausführen

```typescript
const job = await orch.deploy({
  image: "node",
  tag: "20-alpine",
  name: "migration-job",
  cmd: ["node", "migrate.js"],
  restartPolicy: "no",
});

// Auf Beendigung warten
const container = docker.getContainer(job.containerId);
await container.wait();

// Output lesen
const logs = await tailLogs(docker, job.containerId, 1000);
console.log(logs.map((e) => e.message).join("\n"));

// Aufräumen
await orch.destroy(job.containerId, { removeVolumes: true });
```

#### Sidecar-Pattern: Haupt-Container + Log-Collector

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

#### Blue-Green-Deployment

```typescript
// Neuen Container starten (Green)
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
  // Traffic umleiten (Load-Balancer-Config anpassen)
  console.log("Green ist healthy — Traffic umleiten");

  // Alten Container entfernen (Blue)
  await orch.destroy(blueContainerId);
  console.log("Blue entfernt — Deployment abgeschlossen");
} else {
  // Rollback: Green entfernen
  await orch.destroy(green.containerId);
  console.error("Green Health-Check fehlgeschlagen — Rollback");
}
```

#### Periodic-Task: Container für Cron-ähnliche Jobs

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
    console.error(`Job fehlgeschlagen (Exit ${StatusCode}):`, logs.map((e) => e.message).join("\n"));
  }

  await orch.destroy(job.containerId, { removeVolumes: true });
}

// Alle 60 Minuten ausführen
setInterval(runPeriodicJob, 60 * 60 * 1000);
```

---

### 6.15 Attach/STDIN & Console

#### Container mit interaktivem STDIN deployen

```typescript
const result = await orch.deploy({
  image: "alpine",
  name: "interactive-shell",
  cmd: ["cat"],
  interactive: true,  // Aktiviert OpenStdin + AttachStdin
});

// Console ist automatisch verfügbar für interaktive Container
const cons = result.console;
```

#### Low-Level Attach an Container

```typescript
import { attachContainer } from "@pruefertit/docker-orchestrator";

const { stream, demuxed, tty } = await attachContainer(docker, containerId);

// Daten senden
stream.write("hello\n");

// Output empfangen (non-TTY: demuxed stdout/stderr)
demuxed!.stdout.on("data", (chunk: Buffer) => {
  console.log("stdout:", chunk.toString());
});

demuxed!.stderr.on("data", (chunk: Buffer) => {
  console.error("stderr:", chunk.toString());
});

// Stream schließen
stream.end();
```

#### Fire-and-Forget-Command senden

```typescript
import { sendCommand, sendCommands } from "@pruefertit/docker-orchestrator";

// Einzelnen Command senden (kein Output zurück)
await sendCommand(docker, containerId, "start-process");

// Mehrere Commands nacheinander senden
await sendCommands(docker, containerId, [
  "config set maxmemory 256mb",
  "config set maxmemory-policy allkeys-lru",
  "save",
], 100); // 100ms Pause zwischen Commands
```

#### Auch über den Orchestrator

```typescript
// Einzelner Command
await orch.attach.send(containerId, "reload-config");

// Mehrere Commands
await orch.attach.sendMany(containerId, ["cmd1", "cmd2"]);
```

#### Persistent Console erstellen

```typescript
import { createConsole } from "@pruefertit/docker-orchestrator";

const console = await createConsole(docker, containerId, {
  reconnect: true,           // Auto-Reconnect bei Verbindungsverlust
  reconnectMaxRetries: 10,   // Max. 10 Reconnect-Versuche
  outputBufferSize: 1000,    // Letzte 1000 Zeilen buffern
  queueCommands: false,      // Commands queuen wenn disconnected
});

// Oder über den Orchestrator
const console2 = await orch.attach.console(containerId);
```

#### Command senden und auf Antwort warten

```typescript
const result = await console.sendAndWait("status", {
  matchOutput: "Server is running",  // Warten bis dieser Text erscheint
  timeout: 5000,                     // Max. 5 Sekunden warten
});

console.log(`Output: ${result.output}`);
console.log(`Dauer: ${result.duration}ms`);
```

#### Output-Buffer und Events

```typescript
// Alle Events abhören
console.on("output", (line) => {
  console.log(`[${line.stream}] ${line.message}`);
});

console.on("connected", () => console.log("Verbunden"));
console.on("disconnected", () => console.log("Getrennt"));
console.on("reconnecting", (attempt) => console.log(`Reconnect #${attempt}`));

// Buffer abrufen
const buffer = console.getBuffer();
for (const line of buffer) {
  console.log(`[${line.timestamp.toISOString()}] ${line.message}`);
}

// Buffer leeren
console.clearBuffer();

// Uptime abfragen
console.log(`Verbunden seit ${console.uptime}ms`);

// Disconnect
console.disconnect();
```

#### TTY-Modus aktivieren

```typescript
await orch.deploy({
  image: "alpine",
  name: "tty-container",
  cmd: ["/bin/sh"],
  interactive: true,
  tty: true,  // Aktiviert TTY (Pseudo-Terminal)
});
```

---

### 6.16 Preset-System

#### Preset definieren und registrieren

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
    command: "stop",         // Command für sauberes Herunterfahren
    waitForExit: true,       // Warten bis Container beendet ist
    timeout: 30000,          // Max. 30 Sekunden warten
  },
  readyCheck: {
    logMatch: /Done.*For help/,  // RegExp-Match auf Log-Output
    timeout: 120000,             // Max. 2 Minuten auf Ready warten
  },
  metadata: {
    description: "Minecraft Paper Server",
    version: "1.0.0",
  },
});

// Beim Orchestrator registrieren
orch.presets.register(minecraftPreset);
```

#### Mehrere Presets registrieren

```typescript
orch.presets.registerMany([
  definePreset({ name: "redis", config: { image: "redis:alpine", cmd: ["redis-server"] } }),
  definePreset({ name: "postgres", config: { image: "postgres:16-alpine", env: { POSTGRES_PASSWORD: "secret" } } }),
]);
```

#### Container aus Preset deployen

```typescript
const result = await orch.deploy({
  image: "itzg/minecraft-server",
  preset: "minecraft-server",
  name: "mc-survival",
  env: { DIFFICULTY: "hard", MODE: "survival" },  // Wird mit Preset-Env gemerged
});

// Preset-Env + User-Env werden zusammengeführt:
// EULA=TRUE, TYPE=PAPER, MEMORY=2G (aus Preset)
// DIFFICULTY=hard, MODE=survival (User-Override)
```

#### Merge-Logik für Preset + User-Config

```typescript
// Preset definiert Basis-Config
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

// User-Deploy merged intelligent:
await orch.deploy({
  image: "node:20-alpine",
  preset: "web-app",
  env: { NODE_ENV: "staging", DEBUG: "true" },      // Key-basiert: NODE_ENV wird überschrieben, DEBUG hinzugefügt
  portMappings: ["8080:3000"],                       // User-Ports überschreiben Preset-Ports
  mounts: ["app-data:/data"],                        // Additiv: beide Mounts aktiv
  labels: { "app.version": "2.0" },                  // Key-basiert: app.type bleibt, app.version wird hinzugefügt
});
```

#### Graceful Stop bei Destroy

```typescript
// Beim Destroy wird automatisch der gracefulStop-Command gesendet
await orch.destroy(result.containerId, { timeout: 60 });
// → Sendet "stop" an den Minecraft-Server
// → Wartet bis Container sauber beendet
// → Fallback auf Force-Stop nach Timeout
```

#### Ready-Check bei Deploy

```typescript
// Container wird erst als "running" gemeldet wenn Ready-Check bestanden
const result = await orch.deploy({
  image: "itzg/minecraft-server",
  preset: "minecraft-server",
  name: "mc-creative",
});

// result.status === "running" erst wenn "Done.*For help" im Log erscheint
```

#### Presets verwalten

```typescript
// Alle registrierten Presets auflisten
const names = orch.presets.list();  // ["minecraft-server", "redis", "postgres"]

// Preset abrufen
const preset = orch.presets.get("minecraft-server");
console.log(preset.config.image);  // "itzg/minecraft-server"

// Preset existiert?
orch.presets.has("minecraft-server");  // true

// Preset entfernen
orch.presets.remove("minecraft-server");

// Alle Presets entfernen
orch.presets.clear();
```

#### Presets serialisieren und laden (JSON)

```typescript
import { serializePreset, deserializePreset } from "@pruefertit/docker-orchestrator";

// Preset zu JSON serialisieren (inkl. RegExp-Support)
const json = serializePreset(minecraftPreset);
// RegExp wird als "__REGEXP__Done.*For help__FLAGS__" gespeichert

// Preset aus JSON laden
const restored = deserializePreset(json);
orch.presets.register(restored);
```

#### Preset überschreiben

```typescript
// Standardmäßig wirft register() einen Fehler bei Duplikaten
try {
  orch.presets.register(definePreset({ name: "redis", config: { image: "redis:7" } }));
} catch (err) {
  // PresetAlreadyExistsError
}

// Mit overwrite-Option erlaubt
orch.presets.register(
  definePreset({ name: "redis", config: { image: "redis:7" } }),
  { overwrite: true },
);
```

---

## API-Kurzreferenz

### Orchestrator

| Methode | Beschreibung | Return-Typ |
|---|---|---|
| `createOrchestrator(docker, options?)` | Factory-Funktion | `Orchestrator` |
| `orch.deploy(config, onProgress?)` | Container deployen | `Promise<DeployResult>` |
| `orch.update(containerId, config, onProgress?)` | Container updaten | `Promise<UpdateResult>` |
| `orch.destroy(containerId, options?)` | Container zerstören | `Promise<void>` |
| `orch.deployMany(configs, options?)` | Batch-Deploy | `Promise<BatchResult<DeployResult>>` |
| `orch.destroyMany(ids, options?)` | Batch-Destroy | `Promise<BatchResult<void>>` |
| `orch.updateMany(updates, options?)` | Batch-Update | `Promise<BatchResult<UpdateResult>>` |
| `orch.listManagedContainers()` | Verwaltete Container auflisten | `Promise<Array<{ containerId, name, status, deployedAt }>>` |
| `orch.syncState()` | State mit Docker synchronisieren | `Promise<{ synced: number, orphans: string[] }>` |
| `orch.health()` | Health-Status abfragen | `OrchestratorHealthStatus` |
| `orch.shutdown()` | Graceful Shutdown | `Promise<void>` |
| `orch.presets` | Zugriff auf PresetRegistry | `PresetRegistry` |
| `orch.attach.send(id, cmd)` | Fire-and-Forget-Command senden | `Promise<void>` |
| `orch.attach.sendMany(id, cmds, delay?)` | Mehrere Commands senden | `Promise<void>` |
| `orch.attach.console(id, options?)` | Persistent Console erstellen | `Promise<ContainerConsole>` |

### Client & Container

| Methode | Beschreibung | Return-Typ |
|---|---|---|
| `createClient(options?)` | Docker-Client erstellen | `Promise<CreateClientResult>` |
| `createContainer(docker, config)` | Container erstellen | `Promise<{ id }>` |
| `startContainer(docker, id)` | Container starten | `Promise<void>` |
| `stopContainer(docker, id, timeout?)` | Container stoppen | `Promise<void>` |
| `removeContainer(docker, id, options?)` | Container entfernen | `Promise<void>` |
| `inspectContainer(docker, id)` | Container inspizieren | `Promise<ContainerInspectResult>` |
| `listContainers(docker, options?)` | Container auflisten | `Promise<ContainerInfo[]>` |

### Image

| Methode | Beschreibung | Return-Typ |
|---|---|---|
| `imageExists(docker, imageRef)` | Prüfen ob Image vorhanden | `Promise<boolean>` |
| `pullImage(docker, imageRef, onProgress?)` | Image herunterladen | `Promise<void>` |
| `listImages(docker)` | Images auflisten | `Promise<ImageInfo[]>` |
| `removeImage(docker, imageRef)` | Image entfernen | `Promise<void>` |

### Logs & Metrics

| Methode | Beschreibung | Return-Typ |
|---|---|---|
| `getContainerLogs(docker, id, options?)` | Logs abrufen | `Promise<LogEntry[] \| LogStream>` |
| `tailLogs(docker, id, lines)` | Letzte N Log-Zeilen | `Promise<LogEntry[]>` |
| `streamLogs(docker, id, onEntry)` | Live-Log-Stream | `Promise<LogStream>` |
| `getMetrics(docker, id)` | Einmalige Metriken | `Promise<ContainerMetrics>` |
| `streamMetrics(docker, id, intervalMs?)` | Metriken-Stream | `Promise<MetricsStream>` |

### Events

| Methode | Beschreibung | Return-Typ |
|---|---|---|
| `subscribeEvents(docker, filter?)` | Docker-Events abonnieren | `Promise<EventSubscription>` |

### Exec & Dateien

| Methode | Beschreibung | Return-Typ |
|---|---|---|
| `executeCommand(docker, id, cmd, options?)` | Command ausführen | `Promise<ExecResult>` |
| `executeInteractive(docker, id, cmd, options?)` | Interaktive Session | `Promise<InteractiveExecHandle>` |
| `executeScript(docker, id, scriptPath, options?)` | Script ausführen | `Promise<ExecResult>` |
| `copyToContainer(docker, id, options)` | Host → Container | `Promise<void>` |
| `copyFromContainer(docker, id, options)` | Container → Host | `Promise<void>` |
| `copyBufferToContainer(docker, id, destPath, buffer)` | Buffer → Container | `Promise<void>` |
| `readFileFromContainer(docker, id, filePath)` | Datei aus Container lesen | `Promise<Buffer>` |

### Netzwerk

| Methode | Beschreibung | Return-Typ |
|---|---|---|
| `createNetwork(docker, options)` | Netzwerk erstellen | `Promise<NetworkInfo>` |
| `removeNetwork(docker, name)` | Netzwerk entfernen | `Promise<void>` |
| `inspectNetwork(docker, name)` | Netzwerk inspizieren | `Promise<NetworkInfo>` |
| `listNetworks(docker, filter?)` | Netzwerke auflisten | `Promise<NetworkInfo[]>` |
| `connectContainer(docker, network, id, options?)` | Container verbinden | `Promise<void>` |
| `disconnectContainer(docker, network, id)` | Container trennen | `Promise<void>` |
| `pruneNetworks(docker)` | Ungenutzte entfernen | `Promise<string[]>` |

### Volume

| Methode | Beschreibung | Return-Typ |
|---|---|---|
| `createVolume(docker, options)` | Volume erstellen | `Promise<VolumeInfo>` |
| `removeVolume(docker, name, force?)` | Volume entfernen | `Promise<void>` |
| `inspectVolume(docker, name)` | Volume inspizieren | `Promise<VolumeInfo>` |
| `listVolumes(docker, filter?)` | Volumes auflisten | `Promise<VolumeInfo[]>` |
| `pruneVolumes(docker)` | Ungenutzte entfernen | `Promise<PruneVolumesResult>` |
| `volumeExists(docker, name)` | Existenz prüfen | `Promise<boolean>` |

### Stack

| Methode | Beschreibung | Return-Typ |
|---|---|---|
| `deployStack(docker, config, onProgress?)` | Stack deployen | `Promise<StackDeployResult>` |
| `destroyStack(docker, stackName)` | Stack zerstören | `Promise<void>` |
| `resolveDependencyOrder(containers)` | Abhängigkeiten auflösen | `string[]` |

### Attach & Console

| Methode / Klasse | Beschreibung | Return-Typ |
|---|---|---|
| `attachContainer(docker, id, options?)` | Low-Level-Attach an Container | `Promise<AttachResult>` |
| `sendCommand(docker, id, command, timeout?)` | Einzelnen Command senden | `Promise<void>` |
| `sendCommands(docker, id, commands, delay?, timeout?)` | Mehrere Commands senden | `Promise<void>` |
| `createConsole(docker, id, options?)` | Persistent Console erstellen | `Promise<ContainerConsole>` |
| `ContainerConsole` | Interaktive Container-Console | Klasse |
| `console.connect()` | Console verbinden | `Promise<void>` |
| `console.disconnect()` | Console trennen | `void` |
| `console.send(command)` | Command senden | `void` |
| `console.sendAndWait(command, options?)` | Command senden und auf Antwort warten | `Promise<SendAndWaitResult>` |
| `console.getBuffer()` | Output-Buffer abrufen | `ConsoleOutputLine[]` |
| `console.clearBuffer()` | Output-Buffer leeren | `void` |

### Presets

| Methode / Klasse | Beschreibung | Return-Typ |
|---|---|---|
| `definePreset(input)` | Preset mit Validierung definieren | `ContainerPreset` |
| `serializePreset(preset)` | Preset zu JSON serialisieren | `string` |
| `deserializePreset(json)` | Preset aus JSON laden | `ContainerPreset` |
| `mergePresetConfig(presetConfig, userOverrides)` | Preset- und User-Config mergen | `Partial<ContainerConfig>` |
| `PresetRegistry` | Registry für Container-Presets | Klasse |
| `registry.register(preset, options?)` | Preset registrieren | `void` |
| `registry.registerMany(presets, options?)` | Mehrere Presets registrieren | `void` |
| `registry.get(name)` | Preset abrufen | `ContainerPreset` |
| `registry.has(name)` | Prüfen ob Preset existiert | `boolean` |
| `registry.list()` | Alle Preset-Namen auflisten | `string[]` |
| `registry.remove(name)` | Preset entfernen | `boolean` |
| `registry.clear()` | Alle Presets entfernen | `void` |

### Config & Validation

| Methode | Beschreibung | Return-Typ |
|---|---|---|
| `buildContainerConfig(config)` | ContainerConfig → Docker-Config | `BuildContainerConfigResult` |
| `diffConfigs(oldConfig, newConfig)` | Config-Differenz berechnen | `ConfigDiff[]` |
| `validateResourceLimits(config)` | Resource-Config validieren | `ConfigWarning[]` |
| `validateSecurityConfig(config)` | Security-Config validieren | `ConfigWarning[]` |
| `validateProductionConfig(resources, security)` | Produktions-Validierung | `ConfigWarning[]` |

### Resilienz

| Methode / Klasse | Beschreibung | Return-Typ |
|---|---|---|
| `retry(fn, options)` | Funktion mit Retry ausführen | `Promise<T>` |
| `CircuitBreaker` | Circuit-Breaker-Pattern | Klasse |
| `withTimeout(promise, ms, message?)` | Timeout-Wrapper | `Promise<T>` |
| `DaemonMonitor` | Docker-Daemon-Überwachung | Klasse |
| `ShutdownManager` | Graceful-Shutdown-Manager | Klasse |
| `ResilientStream` | Stream mit Auto-Reconnect | Klasse |

Vollständige API-Dokumentation: [`docs/api.md`](docs/api.md)

---

## Konfigurationsreferenz

### ContainerConfig

```typescript
interface ContainerConfig {
  // === Basis ===
  image: string;                     // Docker-Image (erforderlich)
  name?: string;                     // Container-Name
  tag?: string;                      // Image-Tag (default: "latest")
  cmd?: string[];                    // CMD Override
  entrypoint?: string[];             // Entrypoint Override
  env?: Record<string, string>;      // Umgebungsvariablen
  labels?: Record<string, string>;   // Container-Labels
  workingDir?: string;               // Arbeitsverzeichnis

  // === Netzwerk ===
  portMappings?: PortMappingInput[]; // Port-Mappings (String/Number/Objekt)
  networks?: Record<string, {        // Custom-Netzwerke
    aliases?: string[];
    ipv4Address?: string;
  }>;
  hostname?: string;                 // Container-Hostname
  domainName?: string;               // Domain-Name
  dns?: string[];                    // DNS-Server

  // === Storage ===
  mounts?: MountInput[];             // Mounts (String/Objekt)
  tmpfs?: Record<string, string>;    // Tmpfs-Mounts

  // === Resources ===
  resources?: ResourceConfig;        // CPU, Memory, I/O Limits

  // === Security ===
  security?: SecurityConfig;         // Detaillierte Security-Config
  securityProfile?:                  // Security-Preset
    | "hardened"
    | "standard"
    | "permissive";

  // === Interactive / TTY ===
  interactive?: boolean;             // OpenStdin + AttachStdin aktivieren (default: false)
  tty?: boolean;                     // Pseudo-Terminal aktivieren (default: false)
  preset?: string;                   // Name eines registrierten Presets

  // === Lifecycle ===
  restartPolicy?:                    // Neustart-Policy
    | "no"
    | "always"
    | "unless-stopped"               // (Default)
    | "on-failure";
  stopTimeout?: number;              // Graceful-Stop Timeout in Sek. (default: 10)
  healthCheck?: HealthCheckConfig;   // Health-Check-Konfiguration

  // === Meta ===
  production?: boolean;              // Strikte Warnungen aktivieren
  suppressWarnings?: string[];       // Bestimmte Warnungen unterdrücken
}
```

### Defaults

| Feld | Default | Beschreibung |
|---|---|---|
| `tag` | `"latest"` | Image-Tag |
| `restartPolicy` | `"unless-stopped"` | Neustart-Verhalten |
| `stopTimeout` | `10` | Sekunden bis Force-Kill |
| `securityProfile` | `"standard"` | Security-Preset |

### Security-Presets

| Preset | User | ReadOnly FS | Capabilities | No New Privileges | Seccomp |
|---|---|---|---|---|---|
| **`hardened`** | `1000:1000` | `true` | Drop ALL | `true` | `default` |
| **`standard`** | — | — | Docker Default | `true` | `default` |
| **`permissive`** | — | — | Docker Default | — | — |

### Orchestrator-Optionen

```typescript
interface OrchestratorOptions {
  defaultNetwork?: string;           // Standard-Netzwerk für alle Container
  defaultSecurityProfile?:           // Standard Security-Preset
    | "hardened" | "standard" | "permissive";
  defaultLabels?: Record<string, string>; // Labels für alle Container
  retryPolicy?: Partial<RetryPolicies>;   // Retry-Konfiguration
  circuitBreaker?:                   // Circuit-Breaker (false = deaktiviert)
    | Partial<CircuitBreakerOptions>
    | false;
  timeouts?: Partial<TimeoutConfig>; // Timeout-Konfiguration
  logger?: Logger;                   // Custom Logger
  daemonMonitor?:                    // Daemon-Überwachung
    | boolean
    | Partial<DaemonMonitorOptions>;
}
```

---

## Error-Handling-Referenz

### Error-Klassen

Alle Fehler erben von `DockerOrchestratorError` und enthalten `code`, `cause`, `context`, und `timestamp`.

| Klasse | Code | Beschreibung |
|---|---|---|
| **Connection** | | |
| `ConnectionError` | `CONNECTION_ERROR` | Verbindung zum Docker-Socket fehlgeschlagen |
| `DockerDaemonNotRunningError` | `DOCKER_DAEMON_NOT_RUNNING` | Docker-Daemon nicht gestartet |
| `DockerApiVersionError` | `DOCKER_API_VERSION_ERROR` | Inkompatible API-Version |
| **Container** | | |
| `ContainerNotFoundError` | `CONTAINER_NOT_FOUND` | Container existiert nicht |
| `ContainerNotRunningError` | `CONTAINER_NOT_RUNNING` | Container ist gestoppt |
| `ContainerAlreadyRunningError` | `CONTAINER_ALREADY_RUNNING` | Container läuft bereits |
| `ContainerAlreadyStoppedError` | `CONTAINER_ALREADY_STOPPED` | Container bereits gestoppt |
| `ContainerAlreadyExistsError` | `CONTAINER_ALREADY_EXISTS` | Name bereits vergeben |
| **Image** | | |
| `ImageNotFoundError` | `IMAGE_NOT_FOUND` | Image nicht gefunden |
| `ImagePullError` | `IMAGE_PULL_ERROR` | Image-Download fehlgeschlagen |
| **Resource** | | |
| `PortAlreadyInUseError` | `PORT_ALREADY_IN_USE` | Port belegt |
| `InsufficientResourcesError` | `INSUFFICIENT_RESOURCES` | Nicht genug Ressourcen |
| `OOMKilledError` | `OOM_KILLED` | Out-of-Memory Kill |
| `VolumeInUseError` | `VOLUME_IN_USE` | Volume wird noch genutzt |
| **Operation** | | |
| `CommandFailedError` | `COMMAND_FAILED` | Exec-Command fehlgeschlagen |
| `CommandTimeoutError` | `COMMAND_TIMEOUT` | Command-Timeout |
| `HealthCheckTimeoutError` | `HEALTH_CHECK_TIMEOUT` | Health-Check-Timeout |
| `DeploymentFailedError` | `DEPLOYMENT_FAILED` | Deployment fehlgeschlagen |
| `RecreationFailedError` | `RECREATION_FAILED` | Container-Recreation fehlgeschlagen |
| `CriticalRecreationError` | `CRITICAL_RECREATION_ERROR` | Recreation + Rollback fehlgeschlagen |
| `UpdateFailedError` | `UPDATE_FAILED` | Update fehlgeschlagen |
| `BatchOperationError` | `BATCH_OPERATION_ERROR` | Batch teilweise fehlgeschlagen |
| `TimeoutError` | `TIMEOUT` | Allgemeiner Timeout |
| `CircuitOpenError` | `CIRCUIT_OPEN` | Circuit-Breaker offen |
| **Config** | | |
| `ValidationError` | `VALIDATION_ERROR` | Config-Validierung fehlgeschlagen |
| `InvalidResourceConfigError` | `INVALID_RESOURCE_CONFIG` | Ungültige Resource-Config |
| `InvalidSecurityConfigError` | `INVALID_SECURITY_CONFIG` | Ungültige Security-Config |
| `InvalidMountError` | `INVALID_MOUNT` | Ungültige Mount-Spezifikation |
| `InvalidSubnetError` | `INVALID_SUBNET` | IP nicht im Subnet |
| **Network** | | |
| `NetworkNotFoundError` | `NETWORK_NOT_FOUND` | Netzwerk nicht gefunden |
| `NetworkAlreadyExistsError` | `NETWORK_ALREADY_EXISTS` | Netzwerk existiert bereits |
| `ContainerStillConnectedError` | `CONTAINER_STILL_CONNECTED` | Container noch im Netzwerk |
| **Volume** | | |
| `VolumeNotFoundError` | `VOLUME_NOT_FOUND` | Volume nicht gefunden |
| `VolumeAlreadyExistsError` | `VOLUME_ALREADY_EXISTS` | Volume existiert bereits |
| **Attach / Console** | | |
| `StdinNotAvailableError` | `STDIN_NOT_AVAILABLE` | Container hat OpenStdin nicht aktiviert |
| `ConsoleDisconnectedError` | `CONSOLE_DISCONNECTED` | Console ist nicht verbunden |
| `ConsoleCommandTimeoutError` | `CONSOLE_COMMAND_TIMEOUT` | sendAndWait-Timeout überschritten |
| `GracefulStopTimeoutError` | `GRACEFUL_STOP_TIMEOUT` | Graceful-Stop-Timeout überschritten |
| **Preset** | | |
| `PresetNotFoundError` | `PRESET_NOT_FOUND` | Preset nicht in Registry gefunden |
| `PresetAlreadyExistsError` | `PRESET_ALREADY_EXISTS` | Preset existiert bereits (ohne overwrite) |
| `PresetValidationError` | `PRESET_VALIDATION_ERROR` | Preset-Validierung fehlgeschlagen |
| `ReadyCheckTimeoutError` | `READY_CHECK_TIMEOUT` | Ready-Check-Timeout überschritten |
| **Other** | | |
| `FileNotFoundError` | `FILE_NOT_FOUND` | Datei nicht gefunden |
| `PermissionError` | `PERMISSION_DENIED` | Zugriff verweigert |
| `SeccompProfileNotFoundError` | `SECCOMP_PROFILE_NOT_FOUND` | Seccomp-Profil fehlt |
| `DependencyResolutionError` | `DEPENDENCY_RESOLUTION_ERROR` | Zirkuläre Abhängigkeit |
| `DockerInternalError` | `DOCKER_INTERNAL_ERROR` | Interner Docker-Fehler |

### Transiente vs. Permanente Fehler

**Transiente Fehler** (automatischer Retry möglich):
- `CONNECTION_ERROR`, `DOCKER_DAEMON_NOT_RUNNING`, `TIMEOUT`, `COMMAND_TIMEOUT`, `DOCKER_INTERNAL_ERROR`
- Netzwerk-Fehler: `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `socket hang up`

**Permanente Fehler** (kein Retry sinnvoll):
- `CONTAINER_NOT_FOUND`, `IMAGE_NOT_FOUND`, `VALIDATION_ERROR`, `PORT_ALREADY_IN_USE`, etc.

Prüfung mit `isTransientError(err)`:

```typescript
import { isTransientError } from "@pruefertit/docker-orchestrator";

try {
  await someOperation();
} catch (err) {
  if (isTransientError(err)) {
    // Retry-Logik
  } else {
    // Permanenter Fehler — nicht retrien
    throw err;
  }
}
```

### Retry-Verhalten pro Operation

| Operation | Max Retries | Initial Delay | Beschreibung |
|---|---|---|---|
| `imagePull` | 3 | 2000 ms | Image-Download |
| `containerStart` | 2 | 1000 ms | Container-Start |
| `healthCheck` | 0 | — | Kein Retry (eigene Logik) |
| `exec` | 0 | — | Kein Retry |
| `dockerPing` | 5 | 500 ms | Daemon-Connectivity |

---

## Troubleshooting

### Docker-Socket permission denied

```
Error: connect EACCES /var/run/docker.sock
```

**Lösung:**
```bash
# Aktuellen User zur docker-Gruppe hinzufügen
sudo usermod -aG docker $USER
# Neu anmelden oder:
newgrp docker

# Alternative: Socket-Berechtigungen anpassen (weniger sicher)
sudo chmod 666 /var/run/docker.sock
```

### Cannot connect to Docker daemon

```
Error: DOCKER_DAEMON_NOT_RUNNING
```

**Lösung:**
```bash
# Docker-Service starten
sudo systemctl start docker

# Status prüfen
sudo systemctl status docker

# Socket-Pfad prüfen
ls -la /var/run/docker.sock

# Custom-Socket-Pfad verwenden
const { docker } = await createClient({ socketPath: "/custom/path/docker.sock" });
```

### Port already in use

```
Error: PORT_ALREADY_IN_USE - Port 8080 is already in use
```

**Lösung:**
```bash
# Prozess auf Port finden
lsof -i :8080
# oder
ss -tlnp | grep 8080

# Prozess beenden oder anderen Port verwenden
```

```typescript
// Programmatisch: Port-Verfügbarkeit prüfen
import { checkPortAvailable } from "@pruefertit/docker-orchestrator";
const free = await checkPortAvailable(8080);
```

### Image not found

```
Error: IMAGE_NOT_FOUND - Image not found: myapp:v1.0
```

**Lösung:**
- Image-Name und Tag prüfen: `docker pull myapp:v1.0`
- Private Registry: Login erforderlich (`docker login`)
- Netzwerk-Verbindung zur Registry prüfen

### OOM Killed

```
Error: OOM_KILLED - Container was killed by OOM killer
```

**Lösung:**
```typescript
// Memory-Limit erhöhen
await orch.deploy({
  image: "myapp",
  resources: {
    memory: {
      limit: "1g",           // Von 512m auf 1g erhöhen
      reservation: "512m",
    },
  },
});

// Memory-Verbrauch überwachen
const metrics = await getMetrics(docker, containerId);
console.log(`RAM: ${metrics.memory.percent}%`);
```

### Health check timeout

```
Error: HEALTH_CHECK_TIMEOUT - Health check timed out
```

**Lösung:**
```typescript
await orch.deploy({
  image: "myapp",
  healthCheck: {
    type: "http",
    httpGet: { path: "/health", port: 8080 },
    interval: 15,        // Längeres Interval
    timeout: 10,         // Mehr Zeit pro Check
    retries: 10,         // Mehr Versuche
    startPeriod: 30,     // Längere Aufwärmzeit
  },
});
```

Prüfen Sie auch:
- Ist der Health-Endpoint erreichbar? (`curl http://localhost:PORT/health`)
- Startet die Anwendung im Container korrekt? (Logs prüfen)
- Stimmt der Port im Health-Check mit dem Container-Port überein?

### Permission denied im Container

```
Error: EACCES: permission denied
```

**Lösung:**
```typescript
// User/UID explizit setzen
await orch.deploy({
  image: "myapp",
  security: {
    user: "1000:1000",    // UID:GID passend zu den Dateien
  },
});
```

```bash
# Volume-Berechtigungen auf dem Host anpassen
sudo chown -R 1000:1000 /host/data

# Oder im Dockerfile: USER-Anweisung setzen
```

---

## Weiterführende Dokumentation

- [Vollständige API-Referenz](docs/api.md) — Alle Methoden, Parameter und Return-Typen im Detail
- [Architektur-Dokumentation](docs/architecture.md) — Internes Design und Modulstruktur
- [Security-Best-Practices](docs/security.md) — Hardening-Guide und Empfehlungen
- [Performance-Tuning](docs/performance.md) — Optimierung für hohe Last und viele Container
- [Migration-Guide](docs/migration.md) — Upgrade-Anleitung zwischen Versionen
- [Contributing-Guidelines](CONTRIBUTING.md) — Beitragen zum Projekt
- [Changelog](CHANGELOG.md) — Versionshistorie

---

## Lizenz

MIT License — siehe [LICENSE](LICENSE) für Details.

## Links

- [Repository](https://github.com/jaameypr/docker-orchestrator)
- [Issues & Bug-Reports](https://github.com/jaameypr/docker-orchestrator/issues)
- [NPM](https://www.npmjs.com/package/@pruefertit/docker-orchestrator)

Maintained by the **pruefertit** Team.
