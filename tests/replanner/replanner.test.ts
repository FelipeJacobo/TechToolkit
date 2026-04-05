import { describe, it, expect } from "vitest";
import { InMemoryBus } from "../../src/bus/inMemoryBus.js";
import { Replanner } from "../../src/replanner/replanner.js";

describe("Replanner", () => {
  it("emits replan decision", async () => {
    const bus = new InMemoryBus();
    const replanner = new Replanner(bus);
    await replanner.start();

    const decision = new Promise((resolve) => {
      bus.subscribe("orchestrator.replan.decided", async (event) => resolve(event.payload));
    });

    await bus.publish("orchestrator.replan.request", { runId: "run-1", errorType: "timeout" });

    const payload = (await decision) as { strategy: string };
    expect(payload.strategy).toBe("retry");
  });
});
