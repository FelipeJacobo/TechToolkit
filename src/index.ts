import { InMemoryBus } from "./bus/inMemoryBus.js";
import { NatsBus } from "./bus/natsBus.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { PlannerAgent } from "./agents/plannerAgent.js";
import { ExecutorAgent } from "./agents/executorAgent.js";
import { CriticAgent } from "./agents/criticAgent.js";
import { buildServer } from "./api/server.js";
import { logError, logInfo } from "./core/logging.js";
import { config } from "./config.js";
import { randomUUID } from "crypto";
import { InMemoryStore, DefaultMemoryEngine } from "./memory/inMemoryMemory.js";
import { PostgresMemoryStore, PostgresMemoryEngine } from "./memory/postgresMemory.js";
import { VectorMemoryStore } from "./memory/vectorMemory.js";
import { OpenAIEmbeddingProvider } from "./memory/embeddings.js";
import { ContextEngine } from "./memory/contextEngine.js";
import { Replanner } from "./replanner/replanner.js";
import "./core/trace.js";

const bus = config.bus.driver === "nats" ? new NatsBus({
  servers: config.bus.natsServers,
  requestTimeoutMs: config.bus.requestTimeoutMs,
  jetstreamEnabled: config.bus.jetstreamEnabled,
  jetstreamStream: config.bus.jetstreamStream,
  maxRetries: config.bus.maxRetries,
  backoffMs: config.bus.backoffMs,
  retryJitterFactor: config.bus.retryJitterFactor,
  dlqTopic: config.bus.dlqTopic,
  idempotencyTtlSeconds: config.idempotency.ttlSeconds
}) : new InMemoryBus({
  maxRetries: config.bus.maxRetries,
  backoffMs: config.bus.backoffMs,
  retryJitterFactor: config.bus.retryJitterFactor,
  dlqTopic: config.bus.dlqTopic,
  idempotencyTtlSeconds: config.idempotency.ttlSeconds
});

const { MemoryIdempotencyStore, RedisIdempotencyStore } = await import("./core/idempotency.js");
const idempotencyStore = config.idempotency.driver === "redis"
  ? new RedisIdempotencyStore(config.idempotency.redisUrl)
  : new MemoryIdempotencyStore();

if (bus instanceof NatsBus || bus instanceof InMemoryBus) {
  bus.setIdempotency(idempotencyStore, config.idempotency.ttlSeconds);
}

if (bus instanceof NatsBus) {
  await bus.connect();
}

const memoryEngine = (() => {
  if (config.memory.driver === "vector") {
    const apiKey = config.memory.openaiApiKey;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY required for vector memory");
    }
    const embeddings = new OpenAIEmbeddingProvider({
      apiKey,
      model: config.memory.openaiModel
    });
    const store = new VectorMemoryStore({ connectionString: config.memory.databaseUrl }, embeddings);
    return new DefaultMemoryEngine(store);
  }
  if (config.memory.driver === "postgres") {
    const store = new PostgresMemoryStore({ connectionString: config.memory.databaseUrl });
    return new PostgresMemoryEngine(store);
  }
  const store = new InMemoryStore();
  return new DefaultMemoryEngine(store);
})();

const contextEngine = new ContextEngine(memoryEngine);

const orchestrator = new Orchestrator(bus, idempotencyStore, config.idempotency.ttlSeconds);
const replanner = new Replanner(bus);

const costController = new (await import("./cost/costController.js")).CostController({
  limits: { maxRunUsd: config.cost.maxRunUsd, maxStepUsd: config.cost.maxStepUsd },
  rates: config.cost.modelRates,
  defaultModel: config.cost.defaultModel
});

const planner = new PlannerAgent(
  bus,
  contextEngine,
  costController,
  config.cost.defaultModel,
  config.tools.defaultTool
);
const toolEnforcer = new (await import("./tools/permissions.js")).ToolPermissionEnforcer(
  config.tools.permissions
);
const toolRegistry = new (await import("./tools/registry.js")).ToolRegistry();
const { default: defaultTool } = await import("./tools/defaultTool.js");

toolRegistry.register({
  name: config.tools.defaultTool.name,
  namespace: config.tools.defaultTool.namespace,
  version: { name: config.tools.defaultTool.name, version: config.tools.defaultTool.version },
  permissions: config.tools.permissions,
  handler: defaultTool
});

// Register analyze_code tool
const analyzeCodeHandler = await import("./tools/analyzeCode.js");
toolRegistry.register({
  name: "analyze_code",
  namespace: "analysis",
  version: { name: "analyze_code", version: "1.0.0" },
  permissions: [
    { tool: "analyze_code", allow: true },
  ],
  handler: analyzeCodeHandler.default
});

// Register fix_code tool
const fixCodeHandler = await import("./tools/fixCode.js");
toolRegistry.register({
  name: "fix_code",
  namespace: "analysis",
  version: { name: "fix_code", version: "1.0.0" },
  permissions: [
    { tool: "fix_code", allow: true },
  ],
  handler: fixCodeHandler.default
});

const executor = new ExecutorAgent(
  bus,
  costController,
  config.cost.defaultModel,
  toolEnforcer,
  toolRegistry,
  idempotencyStore,
  config.idempotency.ttlSeconds,
  new (await import("./core/retryPolicy.js")).RetryPolicy(
    config.bus.maxRetries,
    config.bus.backoffMs,
    config.bus.retryJitterFactor
  )
);
const critic = new CriticAgent(bus, contextEngine);

await replanner.start();
await planner.start();
await executor.start();
await critic.start();

const runIndex = new Map<string, { projectId: string; traceId: string }>();

const emitTenantEvent = async (projectId: string, traceId: string, state: string, payload: unknown) => {
  await bus.publish(`tenant.${projectId}.events`, { traceId, state, payload }, { traceId });
};

await bus.subscribe("agent.run.request", async (event) => {
  const payload = event.payload as { projectId: string; goal: string; traceId?: string; runId?: string };
  const traceId = payload.traceId ?? randomUUID();
  const run = await orchestrator.start(payload.goal, 60000);
  runIndex.set(run.runId, { projectId: payload.projectId, traceId });
  await emitTenantEvent(payload.projectId, traceId, "planning", { runId: run.runId, goal: payload.goal });
});

await bus.subscribe("tenant.*.chat", async (event) => {
  const payload = event.payload as { projectId: string; message: string; traceId?: string };
  const traceId = payload.traceId ?? randomUUID();
  const run = await orchestrator.start(payload.message, 60000);
  runIndex.set(run.runId, { projectId: payload.projectId, traceId });
  await emitTenantEvent(payload.projectId, traceId, "planning", { runId: run.runId, goal: payload.message });
});

await bus.subscribe("agent.plan.created", async (event) => {
  orchestrator.onPlanCreated();
  const payload = event.payload as { runId: string; plan: unknown };
  const runMeta = runIndex.get(payload.runId);
  if (runMeta) {
    await emitTenantEvent(runMeta.projectId, runMeta.traceId, "plan_created", payload);
  }
});

await bus.subscribe("agent.execution.completed", async (event) => {
  orchestrator.onExecutionCompleted();
  const payload = event.payload as { runId: string; result: unknown };
  const runMeta = runIndex.get(payload.runId);
  if (runMeta) {
    await emitTenantEvent(runMeta.projectId, runMeta.traceId, "execution_completed", payload);
  }
});

await bus.subscribe("agent.execution.failed", async (event) => {
  const payload = event.payload as { runId: string; errorType: string };
  const runMeta = runIndex.get(payload.runId);
  if (runMeta) {
    await emitTenantEvent(runMeta.projectId, runMeta.traceId, "execution_failed", payload);
  }
  if (payload.errorType === "cost_limit") {
    await orchestrator.fail(payload.runId, "cost_limit");
    return;
  }
  await orchestrator.requestReplan(payload.runId, payload.errorType);
});

await bus.subscribe("orchestrator.plan.failed", async (event) => {
  const payload = event.payload as { runId: string; errorType: string };
  const runMeta = runIndex.get(payload.runId);
  if (runMeta) {
    await emitTenantEvent(runMeta.projectId, runMeta.traceId, "plan_failed", payload);
  }
  await orchestrator.fail(payload.runId, payload.errorType);
});

await bus.subscribe("orchestrator.replan.decided", async (event) => {
  const payload = event.payload as { runId: string; strategy: string; backoffMs?: number };
  const runMeta = runIndex.get(payload.runId);
  if (runMeta) {
    await emitTenantEvent(runMeta.projectId, runMeta.traceId, "replan_decided", payload);
  }
  if (payload.strategy === "abort") {
    await orchestrator.fail(payload.runId, "replanner_abort");
    return;
  }
  if (payload.backoffMs) {
    setTimeout(async () => {
      await bus.publish("orchestrator.plan.request", {
        runId: payload.runId,
        goal: "replan"
      }, { traceId: event.trace.traceId });
    }, payload.backoffMs);
    return;
  }
  await bus.publish("orchestrator.plan.request", {
    runId: payload.runId,
    goal: "replan"
  }, { traceId: event.trace.traceId });
});

await bus.subscribe("orchestrator.review.completed", async (event) => {
  const payload = event.payload as { runId: string; status: string };
  const runMeta = runIndex.get(payload.runId);
  if (payload.status === "approved") {
    await orchestrator.complete(payload.runId);
    if (runMeta) {
      await emitTenantEvent(runMeta.projectId, runMeta.traceId, "completed", payload);
    }
  } else {
    await orchestrator.fail(payload.runId, "critic-rejected");
    if (runMeta) {
      await emitTenantEvent(runMeta.projectId, runMeta.traceId, "failed", payload);
    }
  }
});

const server = buildServer({ orchestrator, bus });
const port = Number(process.env.PORT ?? 8080);

server.listen({ port, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    logError({ step: "server.listen" }, "server failed", err);
    process.exit(1);
  }
  logInfo({ step: "server.listen" }, `server listening ${address}`);
});

process.on("SIGINT", async () => {
  console.log("[agent-core] Received SIGINT — shutting down gracefully...");
  await shutdown();
});

process.on("SIGTERM", async () => {
  console.log("[agent-core] Received SIGTERM — shutting down gracefully...");
  await shutdown();
});

async function shutdown() {
  if (bus instanceof NatsBus) {
    logInfo({ step: "shutdown" }, "Closing NATS connection...");
    await bus.close();
  }
  process.exit(0);
}
