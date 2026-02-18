import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShutdownOptions {
  timeout: number;
  logger?: Logger;
}

export type CleanupCallback = () => void | Promise<void>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: ShutdownOptions = {
  timeout: 10000,
};

// ---------------------------------------------------------------------------
// ShutdownManager
// ---------------------------------------------------------------------------

export class ShutdownManager {
  private readonly callbacks: Array<{ name: string; fn: CleanupCallback }> = [];
  private readonly options: ShutdownOptions;
  private shutdownInProgress = false;
  private signalHandlers: Array<{ signal: string; handler: () => void }> = [];

  constructor(options?: Partial<ShutdownOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  register(name: string, callback: CleanupCallback): void {
    this.callbacks.push({ name, fn: callback });
  }

  unregister(name: string): void {
    const idx = this.callbacks.findIndex((c) => c.name === name);
    if (idx !== -1) {
      this.callbacks.splice(idx, 1);
    }
  }

  installSignalHandlers(): void {
    const handler = () => {
      this.shutdown().catch((err) => {
        this.options.logger?.error("Shutdown error", {
          error: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
      });
    };

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const wrappedHandler = () => handler();
      process.on(signal, wrappedHandler);
      this.signalHandlers.push({ signal, handler: wrappedHandler });
    }
  }

  removeSignalHandlers(): void {
    for (const { signal, handler } of this.signalHandlers) {
      process.removeListener(signal, handler);
    }
    this.signalHandlers = [];
  }

  async shutdown(): Promise<void> {
    if (this.shutdownInProgress) return;
    this.shutdownInProgress = true;

    this.options.logger?.info("Graceful shutdown started");

    const timeoutPromise = new Promise<"timeout">((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), this.options.timeout);
      if (timer && typeof timer === "object" && "unref" in timer) {
        timer.unref();
      }
    });

    const cleanupPromise = this.runCleanup();

    const result = await Promise.race([cleanupPromise, timeoutPromise]);

    if (result === "timeout") {
      this.options.logger?.warn(
        `Shutdown timeout (${this.options.timeout}ms) exceeded, forcing exit`,
      );
    } else {
      this.options.logger?.info("Graceful shutdown completed");
    }

    this.shutdownInProgress = false;
  }

  isShuttingDown(): boolean {
    return this.shutdownInProgress;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async runCleanup(): Promise<void> {
    // Execute callbacks in reverse order (LIFO)
    const reversedCallbacks = [...this.callbacks].reverse();

    for (const { name, fn } of reversedCallbacks) {
      try {
        this.options.logger?.debug(`Running cleanup: ${name}`);
        await fn();
        this.options.logger?.debug(`Cleanup completed: ${name}`);
      } catch (err) {
        this.options.logger?.error(`Cleanup failed: ${name}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
