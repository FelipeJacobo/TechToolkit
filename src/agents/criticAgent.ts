/**
 * criticAgent.ts — Evaluador inteligente de calidad
 *
 * Mejoras vs v1:
 * - Valida resultados REALES de analyze_code (score, issues, fixes aplicados)
 * - Re-planning automático si el fix no resolvió el problema
 * - Criterios de calidad por tipo de issue (critical no puede quedar sin fix)
 * - Evaluación IA profunda del resultado final
 * - Memory store de decisiones de revisión para feedback loop
 */
import { Agent } from "./types.js";
import { MessageBus } from "../bus/messageBus.js";
import { EventEnvelope } from "../core/types.js";
import { runWithSpan } from "../core/trace.js";
import { agentErrorCounter, agentLatencyHistogram } from "../observability/metrics.js";
import { RetryPolicy } from "../core/retryPolicy.js";

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
  stepOutputs?: Map<string, unknown>;
};

type AnalysisToolResult = {
  ok: boolean;
  result?: {
    score: number;
    scoreBreakdown?: Record<string, number>;
    issues?: Array<{
      file: string;
      line?: number;
      type: string;
      severity: string;
      title: string;
      fix?: { original: string; replacement: string };
    }>;
    suggestions?: Array<{ description: string; impact: string }>;
    summary: string;
  };
};

type FixToolResult = {
  ok: boolean;
  result?: {
    fixedFiles: Array<{ path: string; originalContent: string; fixedContent: string }>;
    applied: Array<{ title: string; file: string; status: string; reason: string }>;
    skipped: Array<{ title: string; file: string; reason: string }>;
    totalIssues: number;
    appliedCount: number;
    skippedCount: number;
    summary: string;
  };
};

type ReviewResult = {
  runId: string;
  verdict: "approved" | "rejected" | "needs_fix";
  score: number;
  reasoning: string;
  failedSteps: string[];
  criticalIssuesRemaining: number;
  recommendedAction: "complete" | "fix_again" | "replan" | "abort";
};

type ContextEngine = {
  buildContext(query: string, limit?: number): Promise<string[]>;
  storeIfNeeded(content: string, kind: string, tags: string[]): Promise<void>;
};

// ============================================================
// Critic Agent
// ============================================================

export class CriticAgent implements Agent {
  id = "critic";
  lifecycle: "init" | "ready" | "stopped" = "init";

  // Quality thresholds
  private readonly MIN_SCORE_TO_APPROVE = 75;
  private readonly MIN_FIX_RATE = 0.7;           // 70% of issues must be fixed
  private readonly MAX_ALLOWED_CRITICAL = 0;      // 0 critical issues allowed
  private readonly MIN_SECURITY_SCORE = 60;

  constructor(
    private bus: MessageBus,
    private contextEngine: ContextEngine,
    private retryPolicy = new RetryPolicy(3, 200, 0.3),
    private openAIApiKey?: string,
    private model?: string
  ) {}

  async start(): Promise<void> {
    this.lifecycle = "ready";
    await this.bus.subscribe("agent.execution.completed", async (event) => this.handleResult(event));
    await this.bus.subscribe("agent.execution.failed", async (event) => this.handleFailure(event));
    await this.bus.subscribe("agent.execution.partial", async (event) => this.handlePartial(event));
  }

  async stop(): Promise<void> {
    this.lifecycle = "stopped";
  }

  async handle(_event: EventEnvelope<unknown>): Promise<void> {
    // Events handled via bus subscriptions in start()
  }

  // =========================================================================
  // Handler: execution completed — deep quality review
  // =========================================================================

  private async handleResult(event: EventEnvelope<unknown>): Promise<void> {
    const result = event.payload as ExecutionResult;
    const start = Date.now();
    const { logInfo } = await import("../core/logging.js");

    logInfo({ traceId: event.trace.traceId, agent: this.id, runId: result.runId }, "Critic review started");

    try {
      await runWithSpan("agent.critic", { agent: this.id, step: "review", traceId: event.trace.traceId }, async () => {
        const review = await this.evaluateWithRetries(event.payload as ExecutionResult, event.trace.traceId);

        // Store review decision for memory/feedback
        await this.contextEngine.storeIfNeeded(
          JSON.stringify({
            runId: result.runId,
            verdict: review.verdict,
            score: review.score,
            action: review.recommendedAction,
            criticalRemaining: review.criticalIssuesRemaining,
          }),
          "ephemeral",
          ["review", review.verdict],
        );

        // Route based on verdict
        if (review.verdict === "approved") {
          await this.bus.publish("orchestrator.review.completed", {
            runId: result.runId,
            status: "approved",
            review,
          }, { traceId: event.trace.traceId, retries: 3 });

          logInfo({ traceId: event.trace.traceId, agent: this.id, score: review.score }, "Review approved");
        } else if (review.verdict === "needs_fix") {
          // Issues remain but they're fixable — request another fix cycle
          await this.bus.publish("orchestrator.review.fix_required", {
            runId: result.runId,
            status: "needs_fix",
            review,
            remainingIssues: review.criticalIssuesRemaining,
          }, { traceId: event.trace.traceId, retries: 3 });

          logInfo({
            traceId: event.trace.traceId,
            agent: this.id,
            remainingIssues: review.criticalIssuesRemaining,
          }, "Review: fixes needed");
        } else {
          // Rejected — replan
          await this.bus.publish("orchestrator.review.rejected", {
            runId: result.runId,
            status: "rejected",
            review,
          }, { traceId: event.trace.traceId, retries: 3 });

          logInfo({ traceId: event.trace.traceId, agent: this.id }, "Review rejected — replanning");
        }
      });
    } catch (err) {
      agentErrorCounter.inc({ agent: this.id, errorType: "critic_error" });
      const { handleError } = await import("../core/errorHandler.js");
      handleError(err, { traceId: event.trace.traceId, agent: this.id });
      throw err;
    } finally {
      agentLatencyHistogram.observe({ agent: this.id, step: "review" }, Date.now() - start);
    }
  }

  // =========================================================================
  // Handler: execution failed — trigger replan
  // =========================================================================

  private async handleFailure(event: EventEnvelope<unknown>): Promise<void> {
    const payload = event.payload as { runId: string; errorType?: string; error?: string };
    const { logInfo } = await import("../core/logging.js");
    logInfo({ traceId: event.trace.traceId, agent: this.id, errorType: payload.errorType }, "Execution failed — replan");

    await this.bus.publish("orchestrator.review.rejected", {
      runId: payload.runId,
      status: "rejected",
      review: {
        runId: payload.runId,
        verdict: "rejected" as const,
        score: 0,
        reasoning: `Execution failed: ${payload.errorType}: ${payload.error}`,
        failedSteps: [],
        criticalIssuesRemaining: 0,
        recommendedAction: "replan" as const,
      },
    }, { traceId: event.trace.traceId, retries: 3 });
  }

  // =========================================================================
  // Handler: partial — evaluate what succeeded
  // =========================================================================

  private async handlePartial(event: EventEnvelope<unknown>): Promise<void> {
    await this.handleResult(event); // Same logic, just evaluates partial results
  }

  // =========================================================================
  // Evaluation with retries
  // =========================================================================

  private async evaluateWithRetries(result: ExecutionResult, traceId: string): Promise<ReviewResult> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= this.retryPolicy.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.retryPolicy.getBackoff(attempt - 1);
          await this.sleep(delay);
        }
        return await this.evaluate(result);
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
        if (!this.retryPolicy.shouldRetry(err as Error, attempt)) break;
      }
    }

    // Fallback: reject on evaluation failure
    return {
      runId: result.runId,
      verdict: "rejected",
      score: 0,
      reasoning: lastError ?? "Evaluation failed after retries",
      failedSteps: result.steps.filter((s) => s.status === "failed").map((s) => s.stepId),
      criticalIssuesRemaining: 0,
      recommendedAction: "replan",
    };
  }

  // =========================================================================
  // Core evaluation logic
  // =========================================================================

  private async evaluate(result: ExecutionResult): Promise<ReviewResult> {
    const failedSteps = result.steps.filter((s) => s.status === "failed");
    const completedSteps = result.steps.filter((s) => s.status === "completed");

    // If no steps completed at all → hard reject
    if (completedSteps.length === 0) {
      return {
        runId: result.runId,
        verdict: "rejected",
        score: 0,
        reasoning: `All ${result.steps.length} steps failed. No output to evaluate.`,
        failedSteps: result.steps.map((s) => s.stepId),
        criticalIssuesRemaining: 0,
        recommendedAction: "replan",
      };
    }

    // Extract tool results for deep analysis
    const analysisResult = this.findResult<AnalysisToolResult>(result.steps, "analysis:analyze_code");
    const fixResult = this.findResult<FixToolResult>(result.steps, "analysis:fix_code");

    // --- Rule-based evaluation ---
    const ruleResult = this.ruleBasedEvaluation(result, analysisResult, fixResult);

    // If rule-based says approve but we have AI → do deep review
    if (this.openAIApiKey && ruleResult.recommendedAction === "complete") {
      const aiReview = await this.aiDeepReview(result, analysisResult, fixResult, ruleResult);
      return aiReview;
    }

    return ruleResult;
  }

  // =========================================================================
  // Rule-based evaluation (fast, deterministic)
  // =========================================================================

  private ruleBasedEvaluation(
    result: ExecutionResult,
    analysisResult: AnalysisToolResult | null,
    fixResult: FixToolResult | null
  ): ReviewResult {
    const failedSteps = result.steps.filter((s) => s.status === "failed");
    const completedSteps = result.steps.filter((s) => s.status === "completed");
    const totalSteps = result.steps.length;

    // 1. Check if analysis was run and returned a score
    if (analysisResult?.ok && analysisResult.result) {
      const { score, issues, scoreBreakdown } = analysisResult.result;

      // Count critical/high issues
      const criticalIssues = (issues ?? []).filter((i) => i.severity === "critical");
      const highIssues = (issues ?? []).filter((i) => i.severity === "high");

      const securityScore = scoreBreakdown?.security ?? 100;

      // If fix was applied, check fix effectiveness
      if (fixResult?.ok && fixResult.result) {
        const fixRate = fixResult.result.totalIssues > 0
          ? fixResult.result.appliedCount / fixResult.result.totalIssues
          : 0;

        // Check if critical issues were fixed
        const criticalFixed = criticalIssues.length === 0 || fixResult.result.skippedCount === 0;

        if (fixRate >= this.MIN_FIX_RATE && score >= this.MIN_SCORE_TO_APPROVE && criticalFixed) {
          return {
            runId: result.runId,
            verdict: "approved",
            score,
            reasoning: `Analysis score: ${score}/100. Fix rate: ${(fixRate * 100).toFixed(0)}%. ` +
              `${fixResult.result.appliedCount}/${fixResult.result.totalIssues} issues fixed. ` +
              `Security score: ${securityScore}/100.`,
            failedSteps: failedSteps.map((s) => s.stepId),
            criticalIssuesRemaining: criticalIssues.filter((i) =>
              !fixResult.result!.applied.some((a) => a.title === i.title)
            ).length,
            recommendedAction: "complete",
          };
        }

        // Fix wasn't good enough → needs another fix cycle
        return {
          runId: result.runId,
          verdict: "needs_fix",
          score,
          reasoning: `Fix rate too low: ${(fixRate * 100).toFixed(0)}% ` +
            `(${this.MIN_FIX_RATE * 100}% required). ` +
            `${fixResult.result.skippedCount} issues skipped: ` +
            fixResult.result.skipped.map((s) => s.reason).join("; "),
          failedSteps: failedSteps.map((s) => s.stepId),
          criticalIssuesRemaining: criticalIssues.length,
          recommendedAction: "fix_again",
        };
      }

      // No fix attempted — evaluate analysis-only
      if (score >= this.MIN_SCORE_TO_APPROVE && criticalIssues.length <= this.MAX_ALLOWED_CRITICAL) {
        return {
          runId: result.runId,
          verdict: "approved",
          score,
          reasoning: `Analysis score: ${score}/100. No critical issues. Security: ${securityScore}/100.`,
          failedSteps: failedSteps.map((s) => s.stepId),
          criticalIssuesRemaining: criticalIssues.length,
          recommendedAction: "complete",
        };
      }

      // Score too low or critical issues
      if (criticalIssues.length > 0 || securityScore < this.MIN_SECURITY_SCORE) {
        return {
          runId: result.runId,
          verdict: "needs_fix",
          score,
          reasoning: `${criticalIssues.length} critical issues found. ` +
            `Security score: ${securityScore}/100 (min: ${this.MIN_SECURITY_SCORE}). ` +
            `Issues: ${criticalIssues.map((i) => `${i.title} (${i.file})`).join("; ")}`,
          failedSteps: failedSteps.map((s) => s.stepId),
          criticalIssuesRemaining: criticalIssues.length,
          recommendedAction: "fix_again",
        };
      }
    }

    // 2. No analysis result — evaluate step completion
    const completionRate = completedSteps.length / Math.max(totalSteps, 1);

    if (completionRate >= 0.8 && failedSteps.length === 0) {
      return {
        runId: result.runId,
        verdict: "approved",
        score: Math.round(completionRate * 100),
        reasoning: `${completedSteps.length}/${totalSteps} steps completed successfully.`,
        failedSteps: [],
        criticalIssuesRemaining: 0,
        recommendedAction: "complete",
      };
    }

    // Partial with failures
    if (failedSteps.length > 0) {
      return {
        runId: result.runId,
        verdict: "rejected",
        score: Math.round(completionRate * 50),
        reasoning: `${failedSteps.length}/${totalSteps} steps failed: ` +
          failedSteps.map((s) => `${s.stepId}: ${s.error}`).join("; "),
        failedSteps: failedSteps.map((s) => s.stepId),
        criticalIssuesRemaining: 0,
        recommendedAction: "replan",
      };
    }

    // Default approve for basic completion
    return {
      runId: result.runId,
      verdict: "approved",
      score: 70,
      reasoning: `Partial completion: ${completedSteps.length}/${totalSteps} steps.`,
      failedSteps: failedSteps.map((s) => s.stepId),
      criticalIssuesRemaining: 0,
      recommendedAction: "complete",
    };
  }

  // =========================================================================
  // AI deep review (when we want nuanced assessment)
  // =========================================================================

  private async aiDeepReview(
    result: ExecutionResult,
    analysisResult: AnalysisToolResult | null,
    fixResult: FixToolResult | null,
    baseResult: ReviewResult
  ): Promise<ReviewResult> {
    // Build summary of what happened
    const stepsSummary = result.steps
      .map(
        (s) =>
          `[${s.stepId}] ${s.tool} → ${s.status} (${s.durationMs}ms)${s.error ? ` — ${s.error}` : ""}`
      )
      .join("\n");

    const analysisSummary = analysisResult?.ok
      ? `\n## Analysis Result\nScore: ${analysisResult.result?.score}/100. ` +
        `${analysisResult.result?.issues?.length ?? 0} issues found. ` +
        `Summary: ${analysisResult.result?.summary}`
      : "";

    const fixSummary = fixResult?.ok
      ? `\n## Fix Result\n` +
        `${fixResult.result?.appliedCount}/${fixResult.result?.totalIssues} issues fixed. ` +
        `${fixResult.result?.skippedCount} skipped. ` +
        `${fixResult.result?.summary}`
      : "";

    const prompt = `You are a senior reviewer evaluating an AI code analysis + fix execution.

## Execution Steps
${stepsSummary}
${analysisSummary}
${fixSummary}

## Task
1. Was the analysis thorough? Did it find real issues?
2. Were the fixes actually effective? Or superficial?
3. Is there anything critical that was missed?
4. Would you ship this code as-is?
5. Score 0-100.

Return ONLY JSON:
{
  "verdict": "approved" | "rejected" | "needs_fix",
  "score": 0,
  "reasoning": "Detailed explanation",
  "missedIssues": ["issue 1", "issue 2"],
  "recommendedAction": "complete" | "fix_again" | "replan"
}`;

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.openAIApiKey}`,
        },
        body: JSON.stringify({
          model: this.model ?? "gpt-4o",
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 1024,
          messages: [
            {
              role: "system",
              content: "You are a code reviewer. Return ONLY valid JSON. No markdown, no explanation.",
            },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty OpenAI response");

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in AI review response");

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      return {
        runId: result.runId,
        verdict: (parsed.verdict as ReviewResult["verdict"]) ?? "rejected",
        score: (parsed.score as number) ?? 0,
        reasoning: (parsed.reasoning as string) ?? "AI review completed",
        failedSteps: baseResult.failedSteps,
        criticalIssuesRemaining: baseResult.criticalIssuesRemaining,
        recommendedAction: (parsed.recommendedAction as ReviewResult["recommendedAction"]) ?? "replan",
      };
    } catch (err) {
      // If AI review fails, fall back to rule-based result
      return baseResult;
    }
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private findResult<T>(steps: StepResult[], toolId: string): T | null {
    const step = steps.find((s) => s.tool === toolId && s.status === "completed");
    if (!step || !step.result) return null;
    return step.result as T;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
