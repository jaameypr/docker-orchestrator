import type Docker from "dockerode";
import EventEmitter from "eventemitter3";
import { attachContainer, type AttachResult } from "./attach.js";
import {
  ConsoleDisconnectedError,
  ConsoleCommandTimeoutError,
  ContainerNotFoundError,
  ContainerNotRunningError,
} from "../errors/base.js";
import type {
  ConsoleOptions,
  ConsoleOutputLine,
  ConsoleStatus,
  SendAndWaitResult,
  ContainerConsoleEvents,
} from "../types/attach.js";

// ---------------------------------------------------------------------------
// ContainerConsole
// ---------------------------------------------------------------------------

export class ContainerConsole extends EventEmitter<ContainerConsoleEvents> {
  public readonly containerId: string;

  private readonly docker: Docker;
  private readonly options: Required<ConsoleOptions>;
  private _status: ConsoleStatus = "disconnected";
  private _connectTime: number | null = null;
  private attachResult: AttachResult | null = null;
  private destroyed = false;
  private reconnectAttempt = 0;

  // Output buffer (ring buffer)
  private outputBuffer: ConsoleOutputLine[] = [];

  // Command queue
  private commandQueue: string[] = [];

  constructor(docker: Docker, containerId: string, options?: Partial<ConsoleOptions>) {
    super();
    this.docker = docker;
    this.containerId = containerId;
    this.options = {
      reconnect: options?.reconnect ?? true,
      reconnectMaxRetries: options?.reconnectMaxRetries ?? 10,
      outputBufferSize: options?.outputBufferSize ?? 1000,
      queueCommands: options?.queueCommands ?? false,
      maxQueueSize: options?.maxQueueSize ?? 100,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  get status(): ConsoleStatus {
    return this._status;
  }

  get uptime(): number {
    if (!this._connectTime) return 0;
    return Date.now() - this._connectTime;
  }

  /**
   * Start the console connection (attach to the container).
   */
  async connect(): Promise<void> {
    if (this.destroyed) return;
    await this.doConnect();
  }

  /**
   * Disconnect from the container. No auto-reconnect.
   */
  disconnect(): void {
    this.destroyed = true;
    this.cleanup();
    this.setStatus("disconnected");
  }

  /**
   * Manually trigger a reconnect.
   */
  async reconnect(): Promise<void> {
    this.cleanup();
    this.destroyed = false;
    this.reconnectAttempt = 0;
    await this.doConnect();
  }

  /**
   * Send a command to the container's stdin.
   * Appends a newline automatically.
   */
  send(command: string): void {
    if (this._status !== "connected" || !this.attachResult) {
      if (this.options.queueCommands) {
        this.enqueueCommand(command);
        return;
      }
      throw new ConsoleDisconnectedError(this.containerId);
    }

    this.attachResult.stream.write(command + "\n");
  }

  /**
   * Send a command and wait for matching output.
   */
  async sendAndWait(
    command: string,
    options?: {
      timeout?: number;
      matchOutput?: RegExp | string;
      lines?: number;
    },
  ): Promise<SendAndWaitResult> {
    const timeout = options?.timeout ?? 5000;
    const startTime = Date.now();

    if (this._status !== "connected" || !this.attachResult) {
      throw new ConsoleDisconnectedError(this.containerId);
    }

    return new Promise<SendAndWaitResult>((resolve, reject) => {
      const collectedOutput: string[] = [];
      let timer: ReturnType<typeof setTimeout> | null = null;

      const onOutput = (line: ConsoleOutputLine) => {
        collectedOutput.push(line.message);

        // Check match conditions
        if (options?.matchOutput) {
          const pattern =
            options.matchOutput instanceof RegExp
              ? options.matchOutput
              : new RegExp(options.matchOutput);
          if (pattern.test(line.message)) {
            done();
            return;
          }
        }

        if (options?.lines && collectedOutput.length >= options.lines) {
          done();
          return;
        }
      };

      const done = () => {
        if (timer) clearTimeout(timer);
        this.off("output", onOutput);
        resolve({
          output: collectedOutput,
          duration: Date.now() - startTime,
        });
      };

      const onTimeout = () => {
        this.off("output", onOutput);
        reject(new ConsoleCommandTimeoutError(this.containerId, timeout));
      };

      timer = setTimeout(onTimeout, timeout);
      this.on("output", onOutput);

      // Send the command
      this.attachResult!.stream.write(command + "\n");
    });
  }

  /**
   * Get the output buffer contents.
   */
  getBuffer(): ConsoleOutputLine[] {
    return [...this.outputBuffer];
  }

  /**
   * Clear the output buffer.
   */
  clearBuffer(): void {
    this.outputBuffer = [];
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private setStatus(status: ConsoleStatus): void {
    this._status = status;
    if (status === "connected") {
      this._connectTime = Date.now();
      this.emit("connected");
    } else if (status === "disconnected") {
      this._connectTime = null;
      this.emit("disconnected");
    } else if (status === "reconnecting") {
      this.emit("reconnecting", this.reconnectAttempt);
    }
  }

  private async doConnect(): Promise<void> {
    if (this.destroyed) return;

    try {
      this.attachResult = await attachContainer(this.docker, this.containerId, {
        stdin: true,
        stdout: true,
        stderr: true,
      });

      this.reconnectAttempt = 0;
      this.setStatus("connected");
      this.setupStreamListeners();

      // Flush command queue
      if (this.options.queueCommands && this.commandQueue.length > 0) {
        this.flushQueue();
      }
    } catch (err) {
      if (err instanceof ContainerNotFoundError || err instanceof ContainerNotRunningError) {
        this.setStatus("disconnected");
        this.emit("error", err);
        return;
      }
      // Attempt reconnect on other errors
      if (this.options.reconnect && !this.destroyed) {
        await this.attemptReconnect();
      } else {
        this.setStatus("disconnected");
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private setupStreamListeners(): void {
    if (!this.attachResult) return;

    const processLine = (stream: "stdout" | "stderr", data: Buffer | string) => {
      const text = typeof data === "string" ? data : data.toString("utf-8");
      // Split by newlines and process each line
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (line.length === 0) continue;
        const outputLine: ConsoleOutputLine = {
          stream,
          message: line,
          timestamp: new Date(),
        };
        this.pushToBuffer(outputLine);
        this.emit("output", outputLine);
      }
    };

    if (this.attachResult.tty) {
      // TTY mode: single stream, no demux
      this.attachResult.stream.on("data", (chunk: Buffer) => {
        processLine("stdout", chunk);
      });
    } else if (this.attachResult.demuxed) {
      // Non-TTY: use demuxed streams
      this.attachResult.demuxed.stdout.on("data", (chunk: Buffer) => {
        processLine("stdout", chunk);
      });
      this.attachResult.demuxed.stderr.on("data", (chunk: Buffer) => {
        processLine("stderr", chunk);
      });
    }

    // Handle stream end/error
    const handleEnd = () => {
      if (this.destroyed) return;
      this.attachResult = null;

      if (this.options.reconnect) {
        this.attemptReconnect().catch(() => {
          // Reconnect errors are handled internally
        });
      } else {
        this.setStatus("disconnected");
      }
    };

    const handleError = (err: Error) => {
      this.emit("error", err);
      handleEnd();
    };

    this.attachResult.stream.on("end", handleEnd);
    this.attachResult.stream.on("close", handleEnd);
    this.attachResult.stream.on("error", handleError);
  }

  private async attemptReconnect(): Promise<void> {
    if (this.destroyed) return;

    for (let attempt = 0; attempt < this.options.reconnectMaxRetries; attempt++) {
      if (this.destroyed) return;

      this.reconnectAttempt = attempt + 1;
      this.setStatus("reconnecting");

      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);

      await new Promise<void>((resolve) => setTimeout(resolve, delay));

      if (this.destroyed) return;

      try {
        // Check if container is still running
        const container = this.docker.getContainer(this.containerId);
        const data = (await container.inspect()) as unknown as Record<string, unknown>;
        const state = data.State as { Running?: boolean } | undefined;

        if (!state?.Running) {
          // Container is not running, no reconnect
          this.setStatus("disconnected");
          return;
        }

        await this.doConnect();
        return;
      } catch {
        // continue trying
      }
    }

    // All retries exhausted
    this.setStatus("disconnected");
  }

  private cleanup(): void {
    if (this.attachResult) {
      try {
        this.attachResult.stream.end();
        this.attachResult.stream.destroy();
      } catch {
        // Best effort
      }
      this.attachResult = null;
    }
  }

  private pushToBuffer(line: ConsoleOutputLine): void {
    if (this.outputBuffer.length >= this.options.outputBufferSize) {
      this.outputBuffer.shift();
    }
    this.outputBuffer.push(line);
  }

  private enqueueCommand(command: string): void {
    if (this.commandQueue.length >= this.options.maxQueueSize) {
      // Drop oldest
      this.commandQueue.shift();
    }
    this.commandQueue.push(command);
  }

  private flushQueue(): void {
    if (this._status !== "connected" || !this.attachResult) return;

    while (this.commandQueue.length > 0) {
      const cmd = this.commandQueue.shift()!;
      this.attachResult.stream.write(cmd + "\n");
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a ContainerConsole and connects it to the container.
 */
export async function createConsole(
  docker: Docker,
  containerId: string,
  options?: Partial<ConsoleOptions>,
): Promise<ContainerConsole> {
  const console = new ContainerConsole(docker, containerId, options);
  await console.connect();
  return console;
}
