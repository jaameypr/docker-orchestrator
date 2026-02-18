// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  error(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  trace(message: string, context?: LogContext): void;
}

// ---------------------------------------------------------------------------
// Log level ordering
// ---------------------------------------------------------------------------

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

// ---------------------------------------------------------------------------
// Sensitive data redaction
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS = /secret|password|key|token|auth|credential/i;

export function redactSensitiveData(context: LogContext): LogContext {
  const result: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_PATTERNS.test(key)) {
      result[key] = "***";
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = redactSensitiveData(value as LogContext);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Console Logger (default implementation)
// ---------------------------------------------------------------------------

export interface ConsoleLoggerOptions {
  level?: LogLevel;
  json?: boolean;
}

export class ConsoleLogger implements Logger {
  private readonly level: number;
  private readonly json: boolean;

  constructor(options?: ConsoleLoggerOptions) {
    this.level = LOG_LEVELS[options?.level ?? "info"];
    this.json = options?.json ?? false;
  }

  error(message: string, context?: LogContext): void {
    this.log("error", message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log("warn", message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log("info", message, context);
  }

  debug(message: string, context?: LogContext): void {
    this.log("debug", message, context);
  }

  trace(message: string, context?: LogContext): void {
    this.log("trace", message, context);
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (LOG_LEVELS[level] > this.level) return;

    const redacted = context ? redactSensitiveData(context) : undefined;

    if (this.json) {
      const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...redacted,
      };
      const consoleFn =
        level === "error"
          ? console.error
          : level === "warn"
            ? console.warn
            : level === "debug" || level === "trace"
              ? console.debug
              : console.log;
      consoleFn(JSON.stringify(entry));
    } else {
      const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
      const contextStr = redacted ? ` ${JSON.stringify(redacted)}` : "";
      const consoleFn =
        level === "error"
          ? console.error
          : level === "warn"
            ? console.warn
            : level === "debug" || level === "trace"
              ? console.debug
              : console.log;
      consoleFn(`${prefix} ${message}${contextStr}`);
    }
  }
}

// ---------------------------------------------------------------------------
// No-op Logger
// ---------------------------------------------------------------------------

export class NoopLogger implements Logger {
  error(): void {}
  warn(): void {}
  info(): void {}
  debug(): void {}
  trace(): void {}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createLogger(options?: ConsoleLoggerOptions): Logger {
  return new ConsoleLogger(options);
}
