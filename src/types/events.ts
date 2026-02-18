import { z } from "zod";
import type { EventEmitter } from "eventemitter3";

/**
 * Docker event resource types.
 */
export type DockerEventType = "container" | "image" | "volume" | "network";

/**
 * Filter options for subscribing to Docker events.
 */
export const EventFilterSchema = z.object({
  type: z.enum(["container", "image", "volume", "network"]).optional(),
  action: z.array(z.string()).optional(),
  containerId: z.string().optional(),
  since: z.union([z.date(), z.number()]).optional(),
  until: z.union([z.date(), z.number()]).optional(),
});

export type EventFilter = z.input<typeof EventFilterSchema>;

/**
 * Actor information from a Docker event.
 */
export interface DockerEventActor {
  id: string;
  name?: string;
  attributes: Record<string, string>;
}

/**
 * A structured Docker engine event.
 */
export interface DockerEvent {
  type: DockerEventType;
  action: string;
  actor: DockerEventActor;
  timestamp: Date;
  raw: Record<string, unknown>;
}

/**
 * Events emitted by the Docker event subscription.
 */
export interface DockerEventStreamEvents {
  /** Wildcard: all events */
  event: (event: DockerEvent) => void;
  /** Container events */
  "container.create": (event: DockerEvent) => void;
  "container.start": (event: DockerEvent) => void;
  "container.stop": (event: DockerEvent) => void;
  "container.die": (event: DockerEvent) => void;
  "container.kill": (event: DockerEvent) => void;
  "container.pause": (event: DockerEvent) => void;
  "container.unpause": (event: DockerEvent) => void;
  "container.destroy": (event: DockerEvent) => void;
  "container.health_status": (event: DockerEvent) => void;
  /** Image events */
  "image.pull": (event: DockerEvent) => void;
  "image.delete": (event: DockerEvent) => void;
  "image.tag": (event: DockerEvent) => void;
  "image.untag": (event: DockerEvent) => void;
  /** Volume events */
  "volume.create": (event: DockerEvent) => void;
  "volume.destroy": (event: DockerEvent) => void;
  "volume.mount": (event: DockerEvent) => void;
  "volume.unmount": (event: DockerEvent) => void;
  /** Network events */
  "network.create": (event: DockerEvent) => void;
  "network.destroy": (event: DockerEvent) => void;
  "network.connect": (event: DockerEvent) => void;
  "network.disconnect": (event: DockerEvent) => void;
  /** Error / end */
  error: (err: Error) => void;
  end: () => void;
}

/**
 * A controllable Docker event subscription.
 */
export interface EventSubscription extends EventEmitter<DockerEventStreamEvents> {
  unsubscribe(): void;
}
