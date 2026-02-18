import { z } from "zod";

// ---------------------------------------------------------------------------
// Attach Options
// ---------------------------------------------------------------------------

export const AttachOptionsSchema = z.object({
  stdin: z.boolean().default(true),
  stdout: z.boolean().default(true),
  stderr: z.boolean().default(true),
});

export type AttachOptions = z.infer<typeof AttachOptionsSchema>;

// ---------------------------------------------------------------------------
// Console Options
// ---------------------------------------------------------------------------

export const ConsoleOptionsSchema = z.object({
  reconnect: z.boolean().default(true),
  reconnectMaxRetries: z.number().int().nonnegative().default(10),
  outputBufferSize: z.number().int().positive().default(1000),
  queueCommands: z.boolean().default(false),
  maxQueueSize: z.number().int().positive().default(100),
});

export type ConsoleOptions = z.infer<typeof ConsoleOptionsSchema>;

// ---------------------------------------------------------------------------
// Console Output Line
// ---------------------------------------------------------------------------

export interface ConsoleOutputLine {
  stream: "stdout" | "stderr";
  message: string;
  timestamp: Date;
}

// ---------------------------------------------------------------------------
// Console Status
// ---------------------------------------------------------------------------

export type ConsoleStatus = "connected" | "disconnected" | "reconnecting";

// ---------------------------------------------------------------------------
// SendAndWait Options / Result
// ---------------------------------------------------------------------------

export const SendAndWaitOptionsSchema = z.object({
  timeout: z.number().int().positive().default(5000),
  matchOutput: z.union([z.string(), z.instanceof(RegExp)]).optional(),
  lines: z.number().int().positive().optional(),
});

export type SendAndWaitOptions = z.infer<typeof SendAndWaitOptionsSchema>;

export interface SendAndWaitResult {
  output: string[];
  duration: number;
}

// ---------------------------------------------------------------------------
// Command Queue Options
// ---------------------------------------------------------------------------

export interface CommandQueueOptions {
  enabled: boolean;
  maxSize: number;
}

// ---------------------------------------------------------------------------
// Console Events
// ---------------------------------------------------------------------------

export interface ContainerConsoleEvents {
  output: (line: ConsoleOutputLine) => void;
  error: (err: Error) => void;
  connected: () => void;
  disconnected: () => void;
  reconnecting: (attempt: number) => void;
}
