import type Docker from "dockerode";
import EventEmitter from "eventemitter3";
import { mapDockerError } from "../errors/mapping.js";
import {
  EventFilterSchema,
  type EventFilter,
  type DockerEvent,
  type DockerEventType,
  type EventSubscription,
  type DockerEventStreamEvents,
} from "../types/events.js";

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000];

/**
 * Converts a Date or Unix timestamp to seconds since epoch.
 */
function toUnixSeconds(value: Date | number): number {
  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }
  return value;
}

/**
 * Maps a raw Docker engine event to a structured DockerEvent.
 */
function mapRawEvent(raw: Record<string, unknown>): DockerEvent | null {
  const type = raw.Type as string | undefined;
  const action = raw.Action as string | undefined;
  const actor = raw.Actor as { ID?: string; Attributes?: Record<string, string> } | undefined;
  const time = raw.time as number | undefined;

  if (!type || !action) return null;

  const validTypes = new Set(["container", "image", "volume", "network"]);
  if (!validTypes.has(type)) return null;

  return {
    type: type as DockerEventType,
    action,
    actor: {
      id: actor?.ID ?? "",
      name: actor?.Attributes?.name,
      attributes: actor?.Attributes ?? {},
    },
    timestamp: time ? new Date(time * 1000) : new Date(),
    raw,
  };
}

/**
 * Checks if a Docker event matches the provided filter.
 */
function matchesFilter(event: DockerEvent, filter: EventFilter): boolean {
  if (filter.type && event.type !== filter.type) return false;
  if (filter.action && filter.action.length > 0 && !filter.action.includes(event.action)) return false;
  if (filter.containerId && event.actor.id !== filter.containerId) return false;
  return true;
}

/**
 * Subscribes to Docker engine events with optional filtering.
 * Returns an EventSubscription that emits typed events and supports unsubscribe.
 *
 * Features:
 * - Auto-reconnect with exponential backoff on stream failure
 * - Uses `since` parameter to avoid losing events during reconnect
 * - Supports wildcard and specific event listeners
 */
export async function subscribeEvents(
  docker: Docker,
  options?: EventFilter,
): Promise<EventSubscription> {
  const filter = EventFilterSchema.parse(options ?? {});
  const emitter = new EventEmitter<DockerEventStreamEvents>() as EventSubscription;
  let stopped = false;
  let currentStream: NodeJS.ReadableStream | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEventTime: number | undefined;

  async function connect(): Promise<void> {
    if (stopped) return;

    const getEventsOpts: Record<string, unknown> = {};

    if (filter.type) {
      getEventsOpts.filters = JSON.stringify({ type: [filter.type] });
    }

    const since = lastEventTime
      ? lastEventTime
      : filter.since !== undefined
        ? toUnixSeconds(filter.since)
        : undefined;

    if (since !== undefined) {
      getEventsOpts.since = since;
    }

    if (filter.until !== undefined) {
      getEventsOpts.until = toUnixSeconds(filter.until);
    }

    try {
      currentStream = (await docker.getEvents(getEventsOpts)) as unknown as NodeJS.ReadableStream;
    } catch (err) {
      if (stopped) return;
      emitter.emit("error", mapDockerError(err));
      scheduleReconnect();
      return;
    }

    reconnectAttempt = 0;
    let buffer = "";

    currentStream.on("data", (chunk: Buffer) => {
      if (stopped) return;

      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim().length === 0) continue;

        let rawEvent: Record<string, unknown>;
        try {
          rawEvent = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }

        const event = mapRawEvent(rawEvent);
        if (!event) continue;

        // Track last event time for reconnect
        lastEventTime = Math.floor(event.timestamp.getTime() / 1000);

        // Apply client-side filtering
        if (!matchesFilter(event, filter)) continue;

        // Emit wildcard event
        emitter.emit("event", event);

        // Emit specific typed event (e.g. "container.start")
        const specificKey = `${event.type}.${event.action}` as keyof DockerEventStreamEvents;
        emitter.emit(specificKey, event);
      }
    });

    currentStream.on("end", () => {
      if (!stopped) {
        scheduleReconnect();
      }
    });

    currentStream.on("error", (err: Error) => {
      if (!stopped) {
        emitter.emit("error", err);
        scheduleReconnect();
      }
    });
  }

  function scheduleReconnect(): void {
    if (stopped) return;

    const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    reconnectAttempt++;

    reconnectTimer = setTimeout(() => {
      if (!stopped) {
        connect().catch(() => {
          if (!stopped) scheduleReconnect();
        });
      }
    }, delay);
  }

  emitter.unsubscribe = function unsubscribe(): void {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (currentStream) {
      const s = currentStream as unknown as { destroy?: () => void };
      if (typeof s.destroy === "function") {
        s.destroy();
      }
    }
    emitter.emit("end");
    emitter.removeAllListeners();
  };

  await connect();
  return emitter;
}
