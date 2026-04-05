/**
 * plannerAgent.ts — Planificación inteligente con contexto de embeddings
 *
 * Mejoras vs v1:
 * - Búsqueda semántica del repo via EmbeddingStore (archivos relevantes al goal)
 * - Contexto histórico de runs anteriores (qué funcionó, qué falló)
 * - Plan multi-herramienta (analyze_code → fix_code → re-check)
 * - Validación del plan antes de ejecutar
 */
import { Agent } from "./types.js";
import { MessageBus } from "../bus/messageBus.js";
import { EventEnvelope } from "../core/types.js";
import { runWithSpan } from "../core/trace.js";
import { agentErrorCounter, agentLatencyHistogram } from "../observability/metrics.js";

// ============================================================
// Types
// ============================================================

export type PlanStep = {
  stepId: string;
  toolNamespace: string;
  toolName: string;
  description: string;
  input: Record<string, unknown>;
  dependsOn?: string[];
  timeoutMs: number;
  onSuccess?: string;  // stepId a ejecutar si este paso funciona
  onFailure?: string;  // stepId alternativo si falla (e.g. "fallback-analyze")
};

export type Plan = {
  runId: string;
  goal: string;
  steps: PlanStep[];
  relevantFiles: Array<{ path: string; relevance: number }>;
  contextSnippets: string[];
  estimatedCostUsd: number;
  estimatedDurationMs: number;
};

type PlanRequest = {
  runId: string;
  goal: string;
  projectId?: string;
  context?: string[];
  availableTools?: string[];
};

type EmbeddingStore = {
  search(query: string, projectId: string, limit?: number): Promise<Array<{
    filePath: string;
    content: string;
    similarity: number;
  }>>;
};

type ContextEngine = {
  buildContext(query: string, limit?: number): Promise<string[]>;
};

// ============================================================
// Prompt Engineering (mejorado)
// ============================================================

const PLANNER_SYSTEM = `You are a Staff Engineer planning code analysis tasks.

Available tools:
- analysis:analyze_code → Analyzes code files, returns issues with severity, line numbers, and concrete fixes
  Input: { files: [{path, content}], language, focus?, maxIssues? }
  Output: { score, issues[], suggestions[], summary }

- analysis:fix_code → Applies fixes from analyze_code results
  Input: { files: [{path, content}], issues: [{file, line, fix: {original, replacement}}] }
  Output: { fixedFiles[], applied[], skipped[] }

Planning rules:
1. ALWAYS start with analyze_code on relevant files
2. If issues are found (score < 80), add a fix_code step that depends on analyze
3. After fix_code, add a verification step (analyze_code again on the fixed files)
4. Maximum 6 steps total
5. Each step must have valid input — no placeholders
6. Always set dependsOn for steps that need previous results
7. Return ONLY valid JSON`;

function buildPlannerPrompt(goal: string, files: Array<{ path: string; content: string; relevance: number }>, history: string[], tools: string[]): string {
  const historyBlock = history.length > 0
    ? `## Historical context from previous runs\n${history.map(h => `- ${h}`).join("\n")}`
    : "";

  const filesBlock = files.length > 0
    ? `## Relevant files found via semantic search (ordered by relevance)\n` +
      files.map(f => `\n### ${f.path} (relevance: ${(f.relevance * 100).toFixed(0)}%)\n\`\`\`\n${f.content}\n\`\`\``).join("\n")
    : "";

  const toolsBlock = tools.length > 0
    ? `## Available tools\n${tools.map(t => `- ${t}`).join("\n")}`
    : "";

  return `## Objective
${goal}

${filesBlock}

${historyBlock}

${toolsBlock}

## Expected output format

Return ONLY this JSON:

{
  "steps": [
    {
      "stepId": "step-1",
      "toolNamespace": "analysis",
      "toolName": "analyze_code",
      "description": "What this step does",
      "input": {
        "files": [{"path": "file.ts", "content": "content..."}],
        "language": "typescript",
        "focus": "vulnerabilities"
      },
      "dependsOn": [],
      "timeoutMs": 60000
    }
  ],
  "estimatedCostUsd": 0.01,
  "estimatedDurationMs": 15000
}

IMPORTANT: Include ACTUAL file content in the input for analyze_code.
Do NOT use placeholders like "file.ts" — use the file paths from the relevant files list.`;
}

// ============================================================
// Planner Agent
// ============================================================

export class PlannerAgent implements Agent {
  id = "planner";
  lifecycle: "init" | "ready" | "stopped" = "init";
  private stepId = 0;

  constructor(
    private bus: MessageBus,
    private contextEngine: ContextEngine,
    private embeddingStore?: EmbeddingStore,
    private availableTools: string[] = [],
    private openAIApiKey?: string,
    private model?: string
  ) {}

  async start(): Promise<void> {
    this.lifecycle = "ready";
    await this.bus.subscribe("orchestrator.plan.request", async (event) => this.handle(event));
  }

  async stop(): Promise<void> {
    this.lifecycle = "stopped";
  }

  async handle(event: EventEnvelope<unknown>): Promise<void> {
    const payload = event.payload as PlanRequest;
    const start = Date.now();
    const { logInfo } = await import("../core/logging.js");

    logInfo({ traceId: event.trace.traceId, agent: this.id, runId: payload.runId }, "Planning started");

    try {
      await runWithSpan("agent.planner", { agent: this.id, step: "plan", traceId: event.trace.traceId }, async () => {
        // 1. Semantic search for relevant repo files
        const relevantFiles = await this.findRelevantFiles(payload);

        // 2. Build context from memory
        const memories = await this.contextEngine.buildContext(payload.goal, 5);

        // 3. Generate plan
        let plan: PlanStep[];
        let estimatedCost = 0.01;
        let estimatedDuration = 10000;

        if (this.openAIApiKey) {
          const result = await this.generatePlan(payload.goal, relevantFiles, memories, payload.availableTools || this.availableTools);
          plan = result.steps;
          estimatedCost = result.estimatedCostUsd ?? estimateCost(plan);
          estimatedDuration = result.estimatedDurationMs ?? estimateDuration(plan);
        } else {
          plan = this.fallbackPlan(payload, relevantFiles);
        }

        // 4. Validate
        this.validatePlan(plan);

        const planObj: Plan = {
          runId: payload.runId,
          goal: payload.goal,
          steps: plan,
          relevantFiles: relevantFiles.map(f => ({ path: f.path, relevance: f.relevance })),
          contextSnippets: memories,
          estimatedCostUsd: estimatedCost,
          estimatedDurationMs: estimatedDuration,
        };

        logInfo({ traceId: event.trace.traceId, agent: this.id, steps: plan.length, files: relevantFiles.length }, "Plan created");

        await this.bus.publish("agent.plan.created", planObj, {
          traceId: event.trace.traceId,
          retries: 3,
        });
      });
    } catch (err) {
      const errorType = err instanceof Error && err.message === "cost_limit" ? "cost_limit" : "planner_error";
      agentErrorCounter.inc({ agent: this.id, errorType });
      const { handleError } = await import("../core/errorHandler.js");
      handleError(err, { traceId: event.trace.traceId, agent: this.id });

      if (errorType === "cost_limit") {
        await this.bus.publish("orchestrator.plan.failed", { runId: payload.runId, errorType }, { traceId: event.trace.traceId });
        return;
      }
      throw err;
    } finally {
      agentLatencyHistogram.observe({ agent: this.id, step: "plan" }, Date.now() - start);
    }
  }

  // --- Semantic search for relevant files ---
  private async findRelevantFiles(payload: PlanRequest): Promise<Array<{ path: string; content: string; relevance: number }>> {
    if (!this.embeddingStore || !payload.projectId) return [];

    try {
      const results = await this.embeddingStore.search(payload.goal, payload.projectId, 5);
      return results.map(r => ({ path: r.filePath, content: r.content, relevance: r.similarity }));
    } catch (err) {
      // Fallback: no semantic search, plan without file context
      return [];
    }
  }

  // --- AI plan generation ---
  private async generatePlan(
    goal: string,
    files: Array<{ path: string; content: string; relevance: number }>,
    memories: string[],
    tools: string[]
  ): Promise<{ steps: PlanStep[]; estimatedCostUsd?: number; estimatedDurationMs?: number }> {
    const prompt = buildPlannerPrompt(goal, files, memories, tools);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.openAIApiKey}`,
      },
      body: JSON.stringify({
        model: this.model ?? "gpt-4o",
        response_format: { type: "json_object" },
        temperature: 0.15,
        max_tokens: 4096,
        messages: [
          { role: "system", content: PLANNER_SYSTEM },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from OpenAI");

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in OpenAI response");

    const parsed = JSON.parse(jsonMatch[0]);

    if (!parsed.steps || !Array.isArray(parsed.steps)) {
      throw new Error("Invalid plan: missing steps array");
    }

    // Normalize: fill in defaults for incomplete steps
    const fileMap = new Map(files.map(f => [f.path, f]));

    return {
      steps: parsed.steps.map((step: any, i: number) => {
        // If input references a file path but doesn't include content, inject it
        if (step.input?.files && Array.isArray(step.input.files)) {
          step.input.files = step.input.files.map((f: any) => {
            const existing = fileMap.get(f.path);
            if (existing && !f.content) {
              return { ...f, content: existing.content };
            }
            return f;
          });
        }

        return {
          stepId: step.stepId || `step-${i + 1}`,
          toolNamespace: step.toolNamespace || "analysis",
          toolName: step.toolName || "analyze_code",
          description: step.description || `Step ${i + 1}`,
          input: step.input || {},
          dependsOn: step.dependsOn || [],
          timeoutMs: step.timeoutMs || 60000,
          onSuccess: step.onSuccess,
          onFailure: step.onFailure,
        };
      }),
      estimatedCostUsd: parsed.estimatedCostUsd,
      estimatedDurationMs: parsed.estimatedDurationMs,
    };
  }

  // --- Fallback: heuristic plan builder ---
  private fallbackPlan(payload: PlanRequest, files: Array<{ path: string; content: string; relevance: number }>): PlanStep[] {
    this.stepId++;

    // If we have files, plan analyze → (if issues) fix
    if (files.length > 0) {
      const analyzeStep: PlanStep = {
        stepId: `step-${this.stepId}-analyze`,
        toolNamespace: "analysis",
        toolName: "analyze_code",
        description: `Analyze ${files.length} files for the goal: ${payload.goal}`,
        input: {
          files: files.map(f => ({ path: f.path, content: f.content })),
          language: detectLanguage(files),
          focus: payload.goal,
          maxIssues: 30,
        },
        dependsOn: [],
        timeoutMs: 60000,
      };

      const fixStep: PlanStep = {
        stepId: `step-${this.stepId}-fix`,
        toolNamespace: "analysis",
        toolName: "fix_code",
        description: "Apply fixes from analysis results",
        input: {
          // Will be populated by executor from analyze_code output
          files: files.map(f => ({ path: f.path, content: f.content })),
          _fromPreviousStep: analyzeStep.stepId,
        },
        dependsOn: [analyzeStep.stepId],
        timeoutMs: 60000,
      };

      return [analyzeStep, fixStep];
    }

    // No files — simple echo/reflect plan
    return [{
      stepId: `step-${this.stepId}-analyze`,
      toolNamespace: "analysis",
      toolName: "analyze_code",
      description: payload.goal,
      input: { goal: payload.goal },
      dependsOn: [],
      timeoutMs: 30000,
    }];
  }

  // --- Validate plan ---
  private validatePlan(steps: PlanStep[]): void {
    if (steps.length === 0) throw new Error("Empty plan");
    if (steps.length > 6) throw new Error("Too many steps (max 6)");

    const ids = new Set(steps.map(s => s.stepId));
    for (const step of steps) {
      if (!step.toolName) throw new Error(`Step ${step.stepId}: missing toolName`);
      for (const dep of (step.dependsOn ?? [])) {
        if (!ids.has(dep)) throw new Error(`Step ${step.stepId}: depends on non-existent step ${dep}`);
      }
    }

    // Check for circular dependencies
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const checkCycle = (id: string): boolean => {
      if (inStack.has(id)) return true;
      if (visited.has(id)) return false;
      inStack.add(id);
      const step = steps.find(s => s.stepId === id);
      for (const dep of (step?.dependsOn ?? [])) {
        if (checkCycle(dep)) return true;
      }
      inStack.delete(id);
      visited.add(id);
      return false;
    };
    for (const step of steps) {
      if (checkCycle(step.stepId)) throw new Error(`Circular dependency detected at step ${step.stepId}`);
    }
  }
}

// ============================================================
// Helpers
// ============================================================

function detectLanguage(files: Array<{ path: string }>): string {
  const ext = files[0]?.path?.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    py: "python", rb: "ruby", go: "go", rs: "rust",
    java: "java", sql: "sql", sh: "shell", md: "markdown",
  };
  return map[ext] || "plaintext";
}

function estimateCost(steps: PlanStep[]): number {
  // Rough estimate: $0.01 per analyze step, $0.005 per fix step
  return steps.reduce((cost, s) => {
    if (s.toolName === "analyze_code") return cost + 0.01;
    if (s.toolName === "fix_code") return cost + 0.005;
    return cost + 0.002;
  }, 0);
}

function estimateDuration(steps: PlanStep[]): number {
  return steps.reduce((ms, s) => ms + (s.timeoutMs || 30000), 0);
}
