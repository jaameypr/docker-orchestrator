import { z } from "zod";
import type { Readable, Writable } from "node:stream";

/**
 * Zod schema for exec creation options.
 */
export const ExecOptionsSchema = z.object({
  cmd: z.array(z.string()).min(1),
  attachStdout: z.boolean().default(true),
  attachStderr: z.boolean().default(true),
  attachStdin: z.boolean().default(false),
  tty: z.boolean().default(false),
  env: z.array(z.string()).optional(),
  workingDir: z.string().optional(),
  user: z.string().optional(),
  privileged: z.boolean().default(false),
});

export type ExecOptions = z.infer<typeof ExecOptionsSchema>;

/**
 * Result of a completed exec command.
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Status returned by exec inspect.
 */
export interface ExecInspectResult {
  exitCode: number;
  running: boolean;
  pid: number;
}

/**
 * Handle for an interactive exec session.
 */
export interface InteractiveExecHandle {
  /** Write data to the container's stdin. */
  stdin: Writable;
  /** Read data from the container's stdout (or combined stdout+stderr in TTY mode). */
  stdout: Readable;
  /** Read data from the container's stderr. Null in TTY mode. */
  stderr: Readable | null;
  /** Resize the TTY (only works when tty=true). */
  resize: (width: number, height: number) => Promise<void>;
  /** Inspect the exec instance to get exit code. */
  inspect: () => Promise<ExecInspectResult>;
}

/**
 * Options for simple executeCommand.
 */
export const SimpleExecOptionsSchema = z.object({
  timeout: z.number().positive().default(30000),
  env: z.array(z.string()).optional(),
  workingDir: z.string().optional(),
  user: z.string().optional(),
});

export type SimpleExecOptions = z.infer<typeof SimpleExecOptionsSchema>;

/**
 * Options for interactive exec.
 */
export const InteractiveExecOptionsSchema = z.object({
  tty: z.boolean().default(true),
  env: z.array(z.string()).optional(),
  workingDir: z.string().optional(),
  user: z.string().optional(),
});

export type InteractiveExecOptions = z.infer<typeof InteractiveExecOptionsSchema>;
