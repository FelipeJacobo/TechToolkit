import { describe, it, expect } from "vitest";
import { InMemoryBus } from "../../src/bus/inMemoryBus.js";
import { PlannerAgent } from "../../src/agents/plannerAgent.js";
import { ExecutorAgent } from "../../src/agents/executorAgent.js";
import { CriticAgent } from "../../src/agents/criticAgent.js";
import { InMemoryStore, DefaultMemoryEngine } from "../../src/memory/inMemoryMemory.js";
import { ContextEngine } from "../../src/memory/contextEngine.js";

describe("Agents", () => {
  it("planner emits plan.created", async () => {
    const bus = new InMemoryBus();
    const memory = new DefaultMemoryEngine(new InMemoryStore());
    const context = new ContextEngine(memory);
    const planner = new PlannerAgent(bus, context, undefined, undefined, {
      namespace: "tool",
      name: "default",
      version: "1.0.0"
    });
    await planner.start();

    const planCreated = new Promise((resolve) => {
      bus.subscribe("agent.plan.created", async (event) => resolve(event.payload));
    });

    await bus.publish("orchestrator.plan.request", { runId: "run-1", goal: "test" });

    const payload = (await planCreated) as { runId: string };
    expect(payload.runId).toBe("run-1");
  });

  it("executor + critic complete review", async () => {
    const bus = new InMemoryBus();
    const memory = new DefaultMemoryEngine(new InMemoryStore());
    const context = new ContextEngine(memory);
    const { ToolPermissionEnforcer } = await import("../../src/tools/permissions.js");
    const { ToolRegistry } = await import("../../src/tools/registry.js");
    const toolRegistry = new ToolRegistry();
    toolRegistry.register({
      name: "default",
      namespace: "tool",
      version: { name: "default", version: "1.0.0" },
      permissions: [{ tool: "tool:default", allow: true }],
      handler: async () => ({ ok: true })
    });
    const enforcer = new ToolPermissionEnforcer([{ tool: "tool:default", allow: true }]);

    const executor = new ExecutorAgent(bus, undefined, undefined, enforcer, toolRegistry);
    const critic = new CriticAgent(bus, context);
    await executor.start();
    await critic.start();

    const review = new Promise((resolve) => {
      bus.subscribe("orchestrator.review.completed", async (event) => resolve(event.payload));
    });

    await bus.publish("agent.plan.created", {
      runId: "run-2",
      tool: { namespace: "tool", name: "default", version: "1.0.0" }
    });
    await bus.publish("agent.execution.completed", {
      runId: "run-2",
      result: { ok: true },
      tool: { namespace: "tool", name: "default", version: "1.0.0" }
    });

    const payload = (await review) as { runId: string; status: string };
    expect(payload.status).toBe("approved");
  });
});
