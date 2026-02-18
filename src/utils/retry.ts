import { isTransientError } from "../errors/base.js";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetryOptions {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
  retryOn: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown, nextDelay: number) => void;
  signal?: AbortSignal;
  logger?: Logger;
}

export interface RetryPolicy {
  maxRetries: number;
  initialDelay: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  jitter?: boolean;
}

export interface RetryPolicies {
  imagePull: RetryPolicy;
  containerStart: RetryPolicy;
  healthCheck: RetryPolicy;
  exec: RetryPolicy;
  dockerPing: RetryPolicy;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const RETRY_DEFAULTS: RetryOptions = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  jitter: true,
  retryOn: isTransientError,
};

export const DEFAULT_RETRY_POLICIES: RetryPolicies = {
  imagePull: { maxRetries: 3, initialDelay: 2000 },
  containerStart: { maxRetries: 2, initialDelay: 1000 },
  healthCheck: { maxRetries: 0, initialDelay: 0 },
  exec: { maxRetries: 0, initialDelay: 0 },
  dockerPing: { maxRetries: 5, initialDelay: 500 },
};

// ---------------------------------------------------------------------------
// Delay calculation
// ---------------------------------------------------------------------------

export function calculateDelay(
  attempt: number,
  initialDelay: number,
  multiplier: number,
  maxDelay: number,
  jitter: boolean,
): number {
  const base = Math.min(initialDelay * Math.pow(multiplier, attempt), maxDelay);
  if (!jitter) return base;
  // ±25% jitter
  const jitterFactor = 0.75 + Math.random() * 0.5;
  return Math.round(base * jitterFactor);
}

// ---------------------------------------------------------------------------
// Retry function
// ---------------------------------------------------------------------------

export async function retry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  const opts = { ...RETRY_DEFAULTS, ...options };

  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    // Check abort signal
    if (opts.signal?.aborted) {
      throw opts.signal.reason ?? new Error("Retry aborted");
    }

    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Don't retry on last attempt
      if (attempt >= opts.maxRetries) break;

      // Don't retry if error is not retryable
      if (!opts.retryOn(err)) break;

      const delay = calculateDelay(
        attempt,
        opts.initialDelay,
        opts.backoffMultiplier,
        opts.maxDelay,
        opts.jitter,
      );

      opts.logger?.debug(
        `Retry attempt ${attempt + 1}/${opts.maxRetries} after ${delay}ms`,
        {
          attempt: attempt + 1,
          maxRetries: opts.maxRetries,
          delay,
          error: err instanceof Error ? err.message : String(err),
        },
      );

      opts.onRetry?.(attempt + 1, err, delay);

      // Wait with abort signal support
      await sleep(delay, opts.signal);
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Retry aborted"));
      return;
    }

    const timer = setTimeout(resolve, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Retry aborted"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
