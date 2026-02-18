import EventEmitter from "eventemitter3";
import { CircuitOpenError } from "../errors/base.js";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  halfOpenMaxAttempts: number;
  monitorInterval: number;
  logger?: Logger;
}

export interface CircuitBreakerEvents {
  "circuit.open": () => void;
  "circuit.half-open": () => void;
  "circuit.closed": () => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  resetTimeout: 30000,
  halfOpenMaxAttempts: 1,
  monitorInterval: 60000,
};

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

export class CircuitBreaker extends EventEmitter<CircuitBreakerEvents> {
  private state: CircuitState = "closed";
  private failures: number[] = [];
  private halfOpenAttempts = 0;
  private lastFailureTime = 0;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly options: CircuitBreakerOptions;

  constructor(options?: Partial<CircuitBreakerOptions>) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  getState(): CircuitState {
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      // Check if resetTimeout has passed → move to half-open
      if (Date.now() - this.lastFailureTime >= this.options.resetTimeout) {
        this.transitionTo("half-open");
      } else {
        throw new CircuitOpenError();
      }
    }

    if (this.state === "half-open") {
      if (this.halfOpenAttempts >= this.options.halfOpenMaxAttempts) {
        throw new CircuitOpenError("Circuit breaker is half-open – max attempts reached");
      }
      this.halfOpenAttempts++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  forceReset(): void {
    this.clearResetTimer();
    this.failures = [];
    this.halfOpenAttempts = 0;
    this.lastFailureTime = 0;
    this.transitionTo("closed");
  }

  destroy(): void {
    this.clearResetTimer();
    this.removeAllListeners();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private onSuccess(): void {
    if (this.state === "half-open") {
      this.failures = [];
      this.halfOpenAttempts = 0;
      this.transitionTo("closed");
    } else if (this.state === "closed") {
      // Reset failures on success in closed state
      // We only count failures within the monitor interval
    }
  }

  private onFailure(): void {
    const now = Date.now();
    this.lastFailureTime = now;

    if (this.state === "half-open") {
      this.halfOpenAttempts = 0;
      this.transitionTo("open");
      return;
    }

    if (this.state === "closed") {
      // Prune old failures outside the monitor window
      const cutoff = now - this.options.monitorInterval;
      this.failures = this.failures.filter((t) => t >= cutoff);
      this.failures.push(now);

      if (this.failures.length >= this.options.failureThreshold) {
        this.transitionTo("open");
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;

    this.options.logger?.info(`Circuit breaker: ${oldState} → ${newState}`);

    this.clearResetTimer();

    if (newState === "open") {
      // Schedule transition to half-open
      this.resetTimer = setTimeout(() => {
        this.transitionTo("half-open");
      }, this.options.resetTimeout);
      // Don't let the timer prevent process exit
      if (this.resetTimer && typeof this.resetTimer === "object" && "unref" in this.resetTimer) {
        this.resetTimer.unref();
      }
    }

    if (newState === "half-open") {
      this.halfOpenAttempts = 0;
    }

    this.emit(`circuit.${newState}` as keyof CircuitBreakerEvents);
  }

  private clearResetTimer(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }
}
