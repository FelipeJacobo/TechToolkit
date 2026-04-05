import { EventEnvelope } from "../core/types.js";

export type AgentLifecycle = "init" | "ready" | "stopped";

export interface Agent {
  id: string;
  lifecycle: AgentLifecycle;
  start(): Promise<void>;
  stop(): Promise<void>;
  // handle can be public or private — interface permits either
  handle(event: EventEnvelope<unknown>): Promise<void>;
}
