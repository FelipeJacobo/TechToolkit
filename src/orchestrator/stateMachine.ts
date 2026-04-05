import { z } from "zod";
import { ValidationError } from "../core/errors.js";

export const OrchestratorStateSchema = z.enum([
  "idle",
  "planning",
  "executing",
  "reviewing",
  "replanning",
  "completed",
  "failed",
  "cancelled"
]);

export type OrchestratorState = z.infer<typeof OrchestratorStateSchema>;

export type StateTransition = {
  from: OrchestratorState;
  to: OrchestratorState;
  reason: string;
  at: string;
};

export class StateMachine {
  private state: OrchestratorState;
  private history: StateTransition[] = [];

  constructor(initial: OrchestratorState) {
    this.state = initial;
  }

  get current(): OrchestratorState {
    return this.state;
  }

  get transitions(): StateTransition[] {
    return [...this.history];
  }

  transition(to: OrchestratorState, reason: string): void {
    const allowed = this.isAllowed(this.state, to);
    if (!allowed) {
      throw new ValidationError([`Invalid transition ${this.state} -> ${to}`]);
    }
    this.history.push({
      from: this.state,
      to,
      reason,
      at: new Date().toISOString()
    });
    this.state = to;
  }

  private isAllowed(from: OrchestratorState, to: OrchestratorState): boolean {
    const map: Record<OrchestratorState, OrchestratorState[]> = {
      idle: ["planning", "cancelled"],
      planning: ["executing", "failed", "cancelled"],
      executing: ["reviewing", "failed", "replanning", "cancelled"],
      reviewing: ["completed", "replanning", "failed", "cancelled"],
      replanning: ["executing", "failed", "cancelled"],
      completed: [],
      failed: [],
      cancelled: []
    };
    return map[from].includes(to);
  }
}
