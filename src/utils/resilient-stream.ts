import { Readable } from "node:stream";
import EventEmitter from "eventemitter3";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResilientStreamOptions {
  maxReconnectAttempts: number;
  initialReconnectDelay: number;
  maxReconnectDelay: number;
  backoffMultiplier: number;
  heartbeatTimeout: number;
  bufferSize: number;
  logger?: Logger;
}

export interface StreamHealthMetrics {
  reconnectCount: number;
  droppedMessages: number;
  uptimeSinceLastReconnect: number;
  isActive: boolean;
}

export interface ResilientStreamEvents {
  data: (chunk: unknown) => void;
  error: (error: Error) => void;
  reconnect: (attempt: number) => void;
  close: () => void;
  warning: (message: string) => void;
}

type StreamFactory = (since?: string) => Promise<Readable>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: ResilientStreamOptions = {
  maxReconnectAttempts: 10,
  initialReconnectDelay: 1000,
  maxReconnectDelay: 30000,
  backoffMultiplier: 2,
  heartbeatTimeout: 0, // disabled by default
  bufferSize: 1000,
  logger: undefined,
};

// ---------------------------------------------------------------------------
// ResilientStream
// ---------------------------------------------------------------------------

export class ResilientStream extends EventEmitter<ResilientStreamEvents> {
  private stream: Readable | null = null;
  private readonly factory: StreamFactory;
  private readonly options: ResilientStreamOptions;
  private destroyed = false;
  private reconnecting = false;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDataTime = Date.now();
  private lastReconnectTime = Date.now();

  // Metrics
  private _reconnectCount = 0;
  private _droppedMessages = 0;

  // Buffer for backpressure
  private buffer: unknown[] = [];

  constructor(
    factory: StreamFactory,
    options?: Partial<ResilientStreamOptions>,
  ) {
    super();
    this.factory = factory;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async start(): Promise<void> {
    if (this.destroyed) return;
    await this.connect();
  }

  getHealthMetrics(): StreamHealthMetrics {
    return {
      reconnectCount: this._reconnectCount,
      droppedMessages: this._droppedMessages,
      uptimeSinceLastReconnect: Date.now() - this.lastReconnectTime,
      isActive: this.stream !== null && !this.destroyed,
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.reconnecting = false;
    this.clearHeartbeat();
    if (this.stream) {
      this.stream.destroy();
      this.stream = null;
    }
    this.buffer = [];
    this.emit("close");
    this.removeAllListeners();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async connect(since?: string): Promise<void> {
    if (this.destroyed) return;

    try {
      this.stream = await this.factory(since);
      this.lastReconnectTime = Date.now();
      this.lastDataTime = Date.now();
      this.startHeartbeat();

      this.stream.on("data", (chunk: unknown) => {
        this.lastDataTime = Date.now();
        this.handleData(chunk);
      });

      this.stream.on("error", (err: Error) => {
        this.options.logger?.warn("Stream error", {
          error: err.message,
        });
        this.handleStreamEnd(true);
      });

      this.stream.on("end", () => {
        this.handleStreamEnd(false);
      });

      this.stream.on("close", () => {
        this.handleStreamEnd(false);
      });
    } catch (err) {
      this.options.logger?.error("Failed to connect stream", {
        error: err instanceof Error ? err.message : String(err),
      });
      await this.attemptReconnect();
    }
  }

  private handleData(chunk: unknown): void {
    if (this.destroyed) return;

    // Buffer management (backpressure)
    if (this.buffer.length >= this.options.bufferSize) {
      this._droppedMessages++;
      this.buffer.shift(); // drop oldest
      if (this._droppedMessages % 100 === 1) {
        const msg = `Buffer full, dropping messages (total dropped: ${this._droppedMessages})`;
        this.options.logger?.warn(msg);
        this.emit("warning", msg);
      }
    }

    this.buffer.push(chunk);
    this.emit("data", chunk);
  }

  private handleStreamEnd(wasError: boolean): void {
    if (this.destroyed) return;
    this.clearHeartbeat();

    if (wasError) {
      this.attemptReconnect().catch(() => {
        // Reconnect errors are handled internally
      });
    } else {
      // Normal end – no reconnect (container stopped etc.)
      this.emit("close");
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.destroyed || this.reconnecting) return;
    this.reconnecting = true;

    for (
      let attempt = 0;
      attempt < this.options.maxReconnectAttempts;
      attempt++
    ) {
      if (this.destroyed) break;

      const delay = Math.min(
        this.options.initialReconnectDelay *
          Math.pow(this.options.backoffMultiplier, attempt),
        this.options.maxReconnectDelay,
      );

      this.options.logger?.debug(
        `Stream reconnect attempt ${attempt + 1}/${this.options.maxReconnectAttempts} in ${delay}ms`,
      );

      await new Promise<void>((resolve) => setTimeout(resolve, delay));

      if (this.destroyed) break;

      try {
        this._reconnectCount++;
        this.emit("reconnect", attempt + 1);

        // Build 'since' timestamp from last data
        const since = new Date(this.lastDataTime).toISOString();
        await this.connect(since);
        this.reconnecting = false;
        return;
      } catch {
        // continue to next attempt
      }
    }

    this.reconnecting = false;
    if (!this.destroyed) {
      const err = new Error(
        `Failed to reconnect after ${this.options.maxReconnectAttempts} attempts`,
      );
      this.emit("error", err);
    }
  }

  private startHeartbeat(): void {
    if (this.options.heartbeatTimeout <= 0) return;
    this.clearHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      const elapsed = Date.now() - this.lastDataTime;
      if (elapsed > this.options.heartbeatTimeout) {
        this.options.logger?.warn(
          `No data for ${elapsed}ms (timeout: ${this.options.heartbeatTimeout}ms)`,
        );
        // Force reconnect
        if (this.stream) {
          this.stream.destroy();
          this.stream = null;
        }
        this.handleStreamEnd(true);
      }
    }, this.options.heartbeatTimeout);

    if (this.heartbeatTimer && typeof this.heartbeatTimer === "object" && "unref" in this.heartbeatTimer) {
      this.heartbeatTimer.unref();
    }
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
