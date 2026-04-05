/**
 * executorAgent.ts — Ejecutor inteligente con multi-tool chaining
 *
 * Mejoras vs v1:
 * - Paso de resultados entre tools (output de analyze_code → input de fix_code)
 * - Tool chaining dinámico: puede elegir tool diferente según resultado
 * - Paralelismo real para steps independientes (hasta maxConcurrentSteps)
 * - Timeout granular por paso + circuit breaker por tool
 */
import { Agent } from "./types.js";
import { MessageBus } from "../bus/messageBus.js";
import { EventEnvelope } from "../core/types.js";
import { runWithSpan } from "../core/trace.js";
import { agentErrorCounter, agentLatencyHistogram } from "../observability/metrics.js";
import { RetryPolicy } from "../core/retryPolicy.js";
import type { Plan, PlanStep } from "./plannerAgent.js";

// ============================================================
// Types
// ============================================================

type StepResult = {
  stepId: string;
  tool: string;
  status: "completed" | "failed" | "timeout" | "skipped";
  result?: unknown;
  error?: string;
  attempts: number;
  durationMs: number;
};

type ExecutionResult = {
  runId: string;
  status: "completed" | "failed" | "partial";
  steps: StepResult[];
  totalDurationMs: number;
  // Data flow: step results keyed by stepId for passing between steps
  stepOutputs: Map<string, unknown>;
};

type ToolRegistry = {
  execute(
    name: string,
    namespace: string,
    version: string | undefined,
    input: unknown,
    enforcer: ToolPermissionEnforcer
  ): Promise<unknown>;
};

type ToolPermissionEnforcer = {
  check(tool: string): boolean;
};

type IdempotencyStore = {
  acquire(key: string, ttlSeconds: number): Promise<boolean>;
};

type CostController = {
  recordUsage(runId: string, costUsd: number, tokensIn: number, tokensOut: number): void;
  isOverLimit(runId: string): boolean;
};

// ============================================================
// Executor Config
// ============================================================

type ExecutorConfig = {
  maxRetries: number;
  backoffMs: number;
  retryJitter: number;
  stepTimeoutMs: number;
  maxConcurrentSteps: number;
};

const DEFAULT_CONFIG: ExecutorConfig = {
  maxRetries: 3,
  backoffMs: 500,
  retryJitter: 0.2,
  stepTimeoutMs: 60000,
  maxConcurrentSteps: 3,
};

// ============================================================
// Executor Agent
// ============================================================

export class ExecutorAgent implements Agent {
  id = "executor";
  lifecycle: "init" | "ready" | "stopped" = "init";
  private retryPolicy: RetryPolicy;
  private circuitBreakers = new Map<string, { failures: number; lastFailure: number }>();
  private readonly CIRCUIT_THRESHOLD = 5;
  private readonly CIRCUIT_RESET_MS = 60_000;

  constructor(
    private bus: MessageBus,
    private costController?: CostController,
    private model?: string,
    private toolEnforcer?: ToolPermissionEnforcer,
    private toolRegistry?: ToolRegistry,
    private idempotencyStore?: IdempotencyStore,
    private idempotencyTtlSeconds = 3600,
    private retryPolicyConfig?: RetryPolicy,
    config: Partial<ExecutorConfig> = {}
  ) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    this.retryPolicy = retryPolicyConfig ?? new RetryPolicy(cfg.maxRetries, cfg.backoffMs, cfg.retryJitter);
  }

  async start(): Promise<void> {
    this.lifecycle = "ready";
    await this.bus.subscribe("agent.plan.created", async (event) => this.handle(event));
  }

  async stop(): Promise<void> {
    this.lifecycle = "stopped";
  }

  // =========================================================================
  // Main handler: receive plan, execute steps, publish result
  // =========================================================================

  async handle(event: EventEnvelope<unknown>): Promise<void> {
    const plan = event.payload as Plan;
    const start = Date.now();
    const { logInfo, logWarn } = await import("../core/logging.js");

    logInfo(
      { traceId: event.trace.traceId, agent: this.id, runId: plan.runId, steps: plan.steps.length },
      "Execution started"
    );

    // Idempotency check
    if (this.idempotencyStore) {
      const acquired = await this.idempotencyStore.acquire(event.id, this.idempotencyTtlSeconds);
      if (!acquired) {
        logWarn({ traceId: event.trace.traceId, agent: this.id }, "Duplicate plan — skipping");
        return;
      }
    }

    try {
      await runWithSpan("agent.executor", { agent: this.id, step: "execute", traceId: event.trace.traceId }, async () => {
        const results: StepResult[] = [];
        const stepOutputs = new Map<string, unknown>();
        const completed = new Set<string>();
        const failed = new Set<string>();
        const pending = [...plan.steps];

        while (pending.length > 0) {
          // Find executable steps (all dependencies met)
          const readySteps = pending.filter(
            (s) =>
              (s.dependsOn ?? []).every((dep) => completed.has(dep) || failed.has(dep)) &&
              !failed.has(s.stepId) &&
              !completed.has(s.stepId)
          );

          if (readySteps.length === 0) {
            // Unresolvable: remaining steps have unmet deps
            for (const s of pending) {
              results.push({
                stepId: s.stepId,
                tool: `${s.toolNamespace}:${s.toolName}`,
                status: "skipped",
                error: `Unmet dependencies: ${(s.dependsOn ?? []).filter((d) => !completed.has(d)).join(", ")}`,
                attempts: 0,
                durationMs: 0,
              });
            }
            break;
          }

          // Check cost limit
          if (this.costController?.isOverLimit(plan.runId)) {
            for (const s of pending) {
              results.push({
                stepId: s.stepId,
                tool: `${s.toolNamespace}:${s.toolName}`,
                status: "skipped",
                error: "Cost limit exceeded",
                attempts: 0,
                durationMs: 0,
              });
            }
            break;
          }

          // Execute batch (parallel for independent steps)
          const cfg = { ...DEFAULT_CONFIG };
          const batch = readySteps.slice(0, cfg.maxConcurrentSteps);

          const batchResults = await Promise.allSettled(
            batch.map(async (step) => {
              // Enrich input with previous step outputs if needed
              const enrichedInput = this.enrichInput(step.input, stepOutputs, step);

              const result = await this.executeStep(step, enrichedInput, event.trace.traceId);
              return { step, result };
            })
          );

          for (let i = 0; i < batch.length; i++) {
            const settled = batchResults[i];
            if (settled.status === "fulfilled") {
              const { result } = settled.value;
              results.push(result);

              // Store output for downstream steps
              stepOutputs.set(result.stepId, result.result);

              if (result.status === "completed") {
                completed.add(result.stepId);
              } else {
                failed.add(result.stepId);

                // Record cost for failed steps too
                if (this.costController) {
                  this.costController.recordUsage(plan.runId, 0.001, 0, 0);
                }
              }
            } else {
              results.push({
                stepId: batch[i].stepId,
                tool: `${batch[i].toolNamespace}:${batch[i].toolName}`,
                status: "failed",
                error: String(settled.reason),
                attempts: 0,
                durationMs: 0,
              });
              failed.add(batch[i].stepId);
            }
          }

          // Remove processed steps
          for (const step of batch) {
            const idx = pending.findIndex((s) => s.stepId === step.stepId);
            if (idx >= 0) pending.splice(idx, 1);
          }
        }

        // Determine overall status
        const failedSteps = results.filter((r) => r.status === "failed");
        const criticalFailures = plan.steps.filter(
          (s) => failed.has(s.stepId) && s.dependsOn === undefined
        );

        const overallStatus =
          failedSteps.length === 0 ? "completed" : criticalFailures.length > 0 ? "failed" : "partial";

        const execResult: ExecutionResult = {
          runId: plan.runId,
          status: overallStatus,
          steps: results,
          totalDurationMs: Date.now() - start,
          stepOutputs,
        };

        // Publish result
        const topic = overallStatus === "completed" ? "agent.execution.completed" : "agent.execution.failed";
        await this.bus.publish(topic, execResult, {
          traceId: event.trace.traceId,
          retries: 3,
        });

        logInfo(
          {
            traceId: event.trace.traceId,
            agent: this.id,
            status: overallStatus,
            completed: completed.size,
            failed: failed.size,
            durationMs: Date.now() - start,
          },
          "Execution finished"
        );
      });
    } catch (err) {
      const errorType = err instanceof Error && err.message === "cost_limit" ? "cost_limit" : "executor_error";
      agentErrorCounter.inc({ agent: this.id, errorType });
      const { handleError } = await import("../core/errorHandler.js");
      handleError(err, { traceId: event.trace.traceId, agent: this.id });

      await this.bus.publish(
        "agent.execution.failed",
        {
          runId: plan.runId,
          errorType,
          error: err instanceof Error ? err.message : "unknown",
        },
        { traceId: event.trace.traceId }
      );
    } finally {
      agentLatencyHistogram.observe({ agent: this.id, step: "execute" }, Date.now() - start);
    }
  }

  // =========================================================================
  // Execute single step with retries + timeout + circuit breaker
  // =========================================================================

  private async executeStep(
    step: PlanStep,
    input: Record<string, unknown>,
    traceId: string
  ): Promise<StepResult> {
    const stepStart = Date.now();
    const toolId = `${step.toolNamespace}:${step.toolName}`;

    // Circuit breaker check
    if (this.isCircuitOpen(toolId)) {
      return {
        stepId: step.stepId,
        tool: toolId,
        status: "failed",
        error: `Circuit breaker open for ${toolId}`,
        attempts: 0,
        durationMs: Date.now() - stepStart,
      };
    }

    // Permission check
    if (this.toolEnforcer && !this.toolEnforcer.check(toolId)) {
      return {
        stepId: step.stepId,
        tool: toolId,
        status: "failed",
        error: `Tool ${toolId} denied by permissions`,
        attempts: 0,
        durationMs: Date.now() - stepStart,
      };
    }

    if (!this.toolRegistry) {
      return {
        stepId: step.stepId,
        tool: toolId,
        status: "failed",
        error: "Tool registry not available",
        attempts: 0,
        durationMs: Date.now() - stepStart,
      };
    }

    // Retry loop
    let lastError: string | undefined;
    const maxAttempts = 1 + (this.retryPolicy.maxRetries ?? 3);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const delay = this.retryPolicy.getBackoff(attempt - 1);
        await this.sleep(delay);
      }

      try {
        const timeout = step.timeoutMs || DEFAULT_CONFIG.stepTimeoutMs;
        const result = await this.withTimeout(
          this.toolRegistry.execute(step.toolName, step.toolNamespace, "1.0.0", input, this.toolEnforcer!),
          timeout
        );

        // Success — reset circuit breaker
        this.resetCircuit(toolId);

        return {
          stepId: step.stepId,
          tool: toolId,
          status: "completed",
          result,
          attempts: attempt + 1,
          durationMs: Date.now() - stepStart,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        lastError = message;

        // Circuit breaker: record failure
        this.recordCircuitFailure(toolId);

        // Don't retry timeouts
        if ((err as any).code === "TIMEOUT") {
          lastError = `Timeout after ${step.timeoutMs || DEFAULT_CONFIG.stepTimeoutMs}ms`;
          break;
        }

        // Check if should retry
        if (!this.retryPolicy.shouldRetry(err as Error, attempt)) break;
      }
    }

    return {
      stepId: step.stepId,
      tool: toolId,
      status: "failed",
      error: lastError ?? "unknown",
      attempts: maxAttempts,
      durationMs: Date.now() - stepStart,
    };
  }

  // =========================================================================
  // Input enrichment: inject outputs from previous steps
  // =========================================================================

  private enrichInput(
    input: Record<string, unknown>,
    stepOutputs: Map<string, unknown>,
    step: PlanStep
  ): Record<string, unknown> {
    if (!input) return {};

    const enriched = { ...input };

    // If input has _fromPreviousStep, inject that step's result
    if (input._fromPreviousStep && typeof input._fromPreviousStep === "string") {
      const prevResult = stepOutputs.get(input._fromPreviousStep as string);
      if (prevResult) {
        // For fix_code: inject issues and files from analyze_code result
        if (step.toolName === "fix_code" && prevResult && typeof prevResult === "object" && "ok" in prevResult) {
          const analysisResult = prevResult as { ok: boolean; result?: { issues?: unknown } };
          if (analysisResult.ok && analysisResult.result?.issues) {
            enriched.issues = analysisResult.result.issues;
          }
        }
        // For tools that need the raw previous result
        enriched._previousResult = prevResult;
      }
      // Remove the meta-key so the tool doesn't receive it
      delete enriched._fromPreviousStep;
    }

    return enriched;
  }

  // =========================================================================
  // Circuit Breaker
  // =========================================================================

  private isCircuitOpen(toolId: string): boolean {
    const state = this.circuitBreakers.get(toolId);
    if (!state) return false;
    if (state.failures >= this.CIRCUIT_THRESHOLD) {
      // Check if enough time has passed to reset
      if (Date.now() - state.lastFailure > this.CIRCUIT_RESET_MS) {
        this.circuitBreakers.delete(toolId);
        return false;
      }
      return true;
    }
    return false;
  }

  private recordCircuitFailure(toolId: string): void {
    const state = this.circuitBreakers.get(toolId) ?? { failures: 0, lastFailure: 0 };
    state.failures++;
    state.lastFailure = Date.now();
    this.circuitBreakers.set(toolId, state);
  }

  private resetCircuit(toolId: string): void {
    this.circuitBreakers.delete(toolId);
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error(`Timeout after ${ms}ms`);
        (err as any).code = "TIMEOUT";
        reject(err);
      }, ms);

      promise
        .then((v) => {
          clearTimeout(timer);
          resolve(v);
        })
        .catch((e) => {
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
