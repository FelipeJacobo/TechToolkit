import { describe, it, expect } from "vitest";
import { InMemoryBus } from "../../src/bus/inMemoryBus.js";

// Ensure duplicate events are ignored

describe("Idempotency", () => {
  it("skips duplicate event ids", async () => {
    const bus = new InMemoryBus();
    let count = 0;

    await bus.subscribe("dup", async () => {
      count += 1;
    });

    await bus.publish("dup", { ok: true }, { traceId: "trace-1", eventId: "evt-1" });
    await bus.publish("dup", { ok: true }, { traceId: "trace-1", eventId: "evt-1" });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(count).toBe(1);
  });
});
