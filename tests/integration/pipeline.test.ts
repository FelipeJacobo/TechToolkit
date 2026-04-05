import { describe, it, expect } from "vitest";
import { InMemoryBus } from "../../src/bus/inMemoryBus.js";
import { Orchestrator } from "../../src/orchestrator/orchestrator.js";
import { PlannerAgent } from "../../src/agents/plannerAgent.js";
import { ExecutorAgent } from "../../src/agents/executorAgent.js";
import { CriticAgent } from "../../src/agents/criticAgent.js";
import { Replanner } from "../../src/replanner/replanner.js";
import { InMemoryStore, DefaultMemoryEngine } from "../../src/memory/inMemoryMemory.js";
import { ContextEngine } from "../../src/memory/contextEngine.js";

describe("Pipeline", () => {
  it("runs a full pipeline", async () => {
    const bus = new InMemoryBus();
    const orchestrator = new Orchestrator(bus);
    const memory = new DefaultMemoryEngine(new InMemoryStore());
    const context = new ContextEngine(memory);

    const planner = new PlannerAgent(bus, context);
    const executor = new ExecutorAgent(bus);
    const critic = new CriticAgent(bus, context);
    const replanner = new Replanner(bus);

    await replanner.start();
    await planner.start();
    await executor.start();
    await critic.start();

    await bus.subscribe("agent.plan.created", async () => {
      orchestrator.onPlanCreated();
    });
    await bus.subscribe("agent.execution.completed", async () => {
      orchestrator.onExecutionCompleted();
    });
    await bus.subscribe("orchestrator.review.completed", async (event) => {
      const payload = event.payload as { runId: string; status: string };
      if (payload.status === "approved") {
        await orchestrator.complete(payload.runId);
      }
    });

    const run = await orchestrator.start("goal", 10000);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(orchestrator.state).toBe("completed");
    expect(run.runId).toBeDefined();
  });
});
