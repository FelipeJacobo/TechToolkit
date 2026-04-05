/**
 * orchestrator.ts — Orquestador de agente multi-etapa
 *
 * Pipeline: Planner → Executor → Critic → (replan si es necesario)
 *
 * Arquitectura:
 * - Los agentes se comunican VÍA EVENTOS (no llamadas directas)
 * - El orquestador emite event.start → agentes escuchan → pipeline fluye
 * - Soporta: replan, cancel, timeout, observabilidad completa
 *
 * Flujo de eventos:
 *   orchestrator.run.start
 *   → planner: agent.plan.created / agent.plan.failed
 *   → executor: agent.execution.completed / agent.execution.failed
 *   → critic: orchestrator.review.completed / orchestrator.review.failed
 *   → si replan: agents.replan → (vuelve a planner)
 */
import { MessageBus } from "../bus/messageBus.js";
import { EventEnvelope } from "../core/types.js";
import { runWithSpan } from "../core/trace.js";
import { RetryPolicy } from "../core/retryPolicy.js";

// ============================================================
// Types
// ============================================================

export type RunState =
  | "pending"
  | "planning"
  | "executing"
  | "reviewing"
  | "replanning"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

type RunContext = {
  goal: string;
  runId: string;
  traceId: string;
  projectId?: string;
  state: RunState;
  attempts: number;
  maxAttempts: number;
  startTime: number;
  deadline: number;
  planVersion: number;
  results: unknown[];
};

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

// ============================================================
// Orchestrator
// ============================================================

export class Orchestrator {
  private runs = new Map<string, RunContext>();
  private handlers: ((state: RunState, payload: any) => void)[] = [];

  // Public accessors for API/stream/integration layer
  get state(): ReadonlyMap<string, RunContext> { return this.runs; }
  get history(): ReadonlyMap<string, RunContext> { return this.runs; }
  get active(): string[] {
    return Array.from(this.runs.entries())
      .filter(([, ctx]) => !["completed", "failed", "cancelled", "timed_out"].includes(ctx.state))
      .map(([id]) => id);
  }

  // Alias methods expected by src/index.ts
  fail = this.handlePlanFailed.bind(this);
  complete = this.handleReviewCompleted.bind(this);
  requestReplan = this.handleReplan.bind(this);
  onPlanCreated = this.handlePlanCreated.bind(this);
  onExecutionCompleted = this.handleExecutionCompleted.bind(this);

  constructor(
    private bus: MessageBus,
    private maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
    private defaultTimeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {}

  // ---- Subscribe to agent pipeline events ----
  async init(): Promise<void> {
    // Planner output
    await this.bus.subscribe(
      "agent.plan.created",
      async (event) => this.handlePlanCreated(event)
    );
    await this.bus.subscribe(
      "agent.plan.failed",
      async (event) => this.handlePlanFailed(event)
    );

    // Executor output
    await this.bus.subscribe(
      "agent.execution.completed",
      async (event) => this.handleExecutionCompleted(event)
    );
    await this.bus.subscribe(
      "agent.execution.failed",
      async (event) => this.handleExecutionFailed(event)
    );
    await this.bus.subscribe(
      "agent.execution.retries_exhausted",
      async (event) => this.handleExecutionFailed(event)
    );

    // Critic output
    await this.bus.subscribe(
      "orchestrator.review.completed",
      async (event) => this.handleReviewCompleted(event)
    );
    await this.bus.subscribe(
      "agents.replan",
      async (event) => this.handleReplan(event)
    );

    // State observer
    await this.bus.subscribe(
      "agent.state",
      async (event) => {
        const payload = event.payload as { state: string; runId: string };
        const ctx = this.runs.get(payload.runId);
        if (ctx) {
          ctx.state = payload.state as RunState;
          this.notifyObservers(ctx.state, payload);
        }
      }
    );
  }

  // ---- Start a new run ----
  async start(goal: string, timeoutMs?: number): Promise<{ runId: string; traceId: string }> {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const traceId = crypto.randomUUID().slice(0, 24);

    const ctx: RunContext = {
      goal,
      runId: id,
      traceId,
      state: "pending",
      attempts: 0,
      maxAttempts: this.maxAttempts,
      startTime: Date.now(),
      deadline: Date.now() + (timeoutMs ?? this.defaultTimeoutMs),
      planVersion: 0,
      results: [],
    };
    this.runs.set(id, ctx);

    // Emit start event → PlannerAgent escucha y genera plan
    await this.bus.publish(
      "orchestrator.run.start",
      { runId: id, goal, traceId },
      {
        retries: 3,
        traceId,
      }
    );

    ctx.state = "planning";
    this.notifyObservers(ctx.state, ctx);
    return { runId: id, traceId };
  }

  // ---- Get run state ----
  getRunState(runId: string): RunContext | undefined {
    return this.runs.get(runId);
  }

  // ---- Cancel a run ----
  async cancel(runId: string): Promise<void> {
    const ctx = this.runs.get(runId);
    if (!ctx) return;
    ctx.state = "cancelled";
    this.notifyObservers("cancelled", ctx);
    await this.bus.publish(
      "agent.cancel",
      { runId, reason: "cancelled_by_user" },
      { traceId: ctx.traceId }
    );
  }

  // ---- Observer pattern for state changes ----
  onStateChange(handler: (state: RunState, payload: any) => void): void {
    this.handlers.push(handler);
  }

  // ---- Cleanup old runs ----
  cleanup(maxAgeMs: number = 3600 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, ctx] of this.runs) {
      if (ctx.state === "completed" || ctx.state === "failed" || ctx.state === "cancelled") {
        if (ctx.startTime < cutoff) {
          this.runs.delete(id);
        }
      }
    }
  }

  // ============================================================
  // Event Handlers
  // ============================================================

  private async handlePlanCreated(event: EventEnvelope<unknown>): Promise<void> {
    const payload = event.payload as { runId: string; plan: unknown };
    const ctx = this.runs.get(payload.runId);
    if (!ctx) return;

    ctx.state = "executing";
    ctx.planVersion++;
    this.notifyObservers("executing", ctx);

    await runWithSpan("orchestrator.plan_to_execution", {
      runId: payload.runId,
      traceId: event.trace.traceId,
    }, async () => {
      await this.bus.publish(
        "agent.execute",
        { runId: payload.runId, plan: payload.plan, traceId: event.trace.traceId },
        { traceId: event.trace.traceId, retries: 3 }
      );
    });
  }

  private async handlePlanFailed(event: EventEnvelope<unknown>): Promise<void> {
    const payload = event.payload as { runId: string; error?: string };
    const ctx = this.runs.get(payload.runId);
    if (!ctx) return;

    ctx.state = "failed";
    this.notifyObservers("failed", ctx);

    await this.bus.publish(
      "agent.failed",
      { runId: payload.runId, error: payload.error ?? "planning_failed" },
      { traceId: event.trace.traceId }
    );
  }

  private async handleExecutionCompleted(event: EventEnvelope<unknown>): Promise<void> {
    const payload = event.payload as { runId: string; steps?: unknown[] };
    const ctx = this.runs.get(payload.runId);
    if (!ctx) return;

    if (payload.steps) ctx.results.push(...payload.steps);
    ctx.state = "reviewing";
    this.notifyObservers("reviewing", ctx);

    await this.bus.publish(
      "agent.review",
      { runId: payload.runId, traceId: event.trace.traceId },
      { traceId: event.trace.traceId, retries: 3 }
    );
  }

  private async handleExecutionFailed(event: EventEnvelope<unknown>): Promise<void> {
    const payload = event.payload as { runId: string; error?: string; errorType?: string };
    const ctx = this.runs.get(payload.runId);
    if (!ctx) return;

    if (ctx.attempts < ctx.maxAttempts) {
      // Replan
      ctx.state = "replanning";
      ctx.attempts++;
      ctx.planVersion++;
      this.notifyObservers("replanning", ctx);

      await this.bus.publish(
        "agents.replan",
        {
          runId: payload.runId,
          goal: ctx.goal,
          previousPlan: null,
          reason: payload.error ?? "execution_failed",
          traceId: event.trace.traceId,
        },
        { traceId: event.trace.traceId, retries: 3 }
      );
    } else {
      ctx.state = "failed";
      this.notifyObservers("failed", ctx);

      await this.bus.publish(
        "agent.failed",
        { runId: payload.runId, error: payload.error, errorType: payload.errorType },
        { traceId: event.trace.traceId }
      );
    }
  }

  private async handleReviewCompleted(event: EventEnvelope<unknown>): Promise<void> {
    const payload = event.payload as { runId: string; verdict?: string };
    const ctx = this.runs.get(payload.runId);
    if (!ctx) return;

    ctx.state = "completed";
    this.notifyObservers("completed", ctx);

    await this.bus.publish(
      "agent.completed",
      { runId: payload.runId, results: ctx.results },
      { traceId: event.trace.traceId }
    );
  }

  private async handleReplan(event: EventEnvelope<unknown>): Promise<void> {
    const payload = event.payload as { runId: string };
    const ctx = this.runs.get(payload.runId);
    if (!ctx) return;

    if (ctx.planVersion >= ctx.maxAttempts) {
      ctx.state = "failed";
      this.notifyObservers("failed", ctx);

      await this.bus.publish(
        "agent.failed",
        { runId: payload.runId, error: `max replan attempts (${ctx.maxAttempts}) reached` },
        { traceId: event.trace.traceId }
      );
      return;
    }

    ctx.state = "planning";
    ctx.attempts++;
    ctx.planVersion++;
    this.notifyObservers("planning", ctx);

    await this.bus.publish(
      "orchestrator.replan",
      { runId: payload.runId, goal: ctx.goal, attempt: ctx.attempts, traceId: event.trace.traceId },
      { traceId: event.trace.traceId, retries: 3 }
    );
  }

  // ---- Observer notification ----
  private notifyObservers(state: RunState, payload: any): void {
    for (const handler of this.handlers) {
      try {
        handler(state, payload);
      } catch (err) {
        // Observer errors are swallowed to protect the pipeline
      }
    }
  }
}
