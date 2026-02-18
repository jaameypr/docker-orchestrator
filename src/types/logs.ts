import { z } from "zod";
import type { EventEmitter } from "eventemitter3";

/**
 * Options for retrieving container logs.
 */
export const LogOptionsSchema = z.object({
  follow: z.boolean().default(false),
  stdout: z.boolean().default(true),
  stderr: z.boolean().default(true),
  timestamps: z.boolean().default(false),
  tail: z.union([z.number().int().nonnegative(), z.literal("all")]).default("all"),
  since: z.union([z.date(), z.number()]).optional(),
  until: z.union([z.date(), z.number()]).optional(),
});

export type LogOptions = z.input<typeof LogOptionsSchema>;

/**
 * A single structured log entry from a container.
 */
export interface LogEntry {
  stream: "stdout" | "stderr";
  timestamp: Date | null;
  message: string;
}

/**
 * Events emitted by a log stream.
 */
export interface LogStreamEvents {
  data: (entry: LogEntry) => void;
  error: (err: Error) => void;
  end: () => void;
}

/**
 * A controllable log stream that can be stopped.
 */
export interface LogStream extends EventEmitter<LogStreamEvents> {
  stop(): void;
}
