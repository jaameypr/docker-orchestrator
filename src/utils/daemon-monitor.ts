import EventEmitter from "eventemitter3";
import type Docker from "dockerode";
import type { Logger } from "./logger.js";
import { retry } from "./retry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DaemonState = "connected" | "disconnected" | "reconnecting";

export interface DaemonMonitorOptions {
  pingInterval: number;
  failureThreshold: number;
  logger?: Logger;
}

export interface DaemonMonitorEvents {
  "daemon.connected": () => void;
  "daemon.disconnected": () => void;
  "daemon.reconnecting": () => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: DaemonMonitorOptions = {
  pingInterval: 10000,
  failureThreshold: 3,
};

// ---------------------------------------------------------------------------
// DaemonMonitor
// ---------------------------------------------------------------------------

export class DaemonMonitor extends EventEmitter<DaemonMonitorEvents> {
  private state: DaemonState = "disconnected";
  private consecutiveFailures = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly docker: Docker;
  private readonly options: DaemonMonitorOptions;
  private destroyed = false;

  private disconnectCallbacks: Array<() => void> = [];
  private reconnectCallbacks: Array<() => void> = [];

  constructor(
    docker: Docker,
    options?: Partial<DaemonMonitorOptions>,
  ) {
    super();
    this.docker = docker;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  getState(): DaemonState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.destroyed) return;

    // Initial ping
    await this.checkDaemon();

    // Start periodic ping
    this.pingTimer = setInterval(() => {
      this.checkDaemon().catch(() => {
        // Errors are handled in checkDaemon
      });
    }, this.options.pingInterval);

    if (this.pingTimer && typeof this.pingTimer === "object" && "unref" in this.pingTimer) {
      this.pingTimer.unref();
    }
  }

  stop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.stop();
    this.disconnectCallbacks = [];
    this.reconnectCallbacks = [];
    this.removeAllListeners();
  }

  onDaemonDisconnect(callback: () => void): void {
    this.disconnectCallbacks.push(callback);
  }

  onDaemonReconnect(callback: () => void): void {
    this.reconnectCallbacks.push(callback);
  }

  async reconnect(): Promise<void> {
    if (this.destroyed) return;

    this.transitionTo("reconnecting");

    try {
      await retry(
        () => this.docker.ping(),
        {
          maxRetries: 10,
          initialDelay: 1000,
          maxDelay: 30000,
          backoffMultiplier: 2,
          jitter: true,
          retryOn: () => !this.destroyed,
          logger: this.options.logger,
        },
      );
      this.onPingSuccess();
    } catch {
      if (!this.destroyed) {
        this.transitionTo("disconnected");
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async checkDaemon(): Promise<void> {
    if (this.destroyed) return;

    try {
      await this.docker.ping();
      this.onPingSuccess();
    } catch {
      this.onPingFailure();
    }
  }

  private onPingSuccess(): void {
    this.consecutiveFailures = 0;
    const wasDisconnected =
      this.state === "disconnected" || this.state === "reconnecting";
    this.transitionTo("connected");

    if (wasDisconnected) {
      this.options.logger?.info("Docker daemon reconnected");
      for (const cb of this.reconnectCallbacks) {
        try {
          cb();
        } catch (err) {
          this.options.logger?.error("Reconnect callback failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  private onPingFailure(): void {
    this.consecutiveFailures++;
    this.options.logger?.debug(
      `Docker daemon ping failed (${this.consecutiveFailures}/${this.options.failureThreshold})`,
    );

    if (this.consecutiveFailures >= this.options.failureThreshold) {
      const wasConnected = this.state === "connected";
      this.transitionTo("disconnected");

      if (wasConnected) {
        this.options.logger?.warn("Docker daemon disconnected");
        for (const cb of this.disconnectCallbacks) {
          try {
            cb();
          } catch (err) {
            this.options.logger?.error("Disconnect callback failed", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }
  }

  private transitionTo(newState: DaemonState): void {
    if (this.state === newState) return;
    this.state = newState;
    this.emit(`daemon.${newState}` as keyof DaemonMonitorEvents);
  }
}
