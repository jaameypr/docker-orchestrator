import { TimeoutError } from "../errors/base.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimeoutConfig {
  containerStart: number;
  containerStop: number;
  imagePull: number;
  exec: number;
  healthCheck: number;
  apiCall: number;
  streamConnect: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_TIMEOUTS: TimeoutConfig = {
  containerStart: 30000,
  containerStop: 30000,
  imagePull: 300000,
  exec: 30000,
  healthCheck: 60000,
  apiCall: 10000,
  streamConnect: 5000,
};

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operation?: string,
): Promise<T> {
  if (ms <= 0 || !Number.isFinite(ms)) {
    return promise;
  }

  const op = operation ?? "unknown";
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(op, ms));
    }, ms);
    // Don't let the timer prevent process exit
    if (timer && typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
