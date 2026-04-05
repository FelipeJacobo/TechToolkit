import { describe, it, expect } from "vitest";
import { InMemoryBus } from "../../src/bus/inMemoryBus.js";

// Basic retry+DLQ test for in-memory bus

describe("Bus retries + DLQ", () => {
  it("routes to DLQ after retries", async () => {
    const bus = new InMemoryBus({ backoffMs: 10, maxRetries: 1 });
    let attempts = 0;
    let dlqHit = false;

    const { RetryableError } = await import("../../src/core/errorHandler.js");
    await bus.subscribe("work", async () => {
      attempts += 1;
      throw new RetryableError("retry");
    });

    await bus.subscribe("bus.dlq", async () => {
      dlqHit = true;
    });

    await bus.publish("work", { ok: true }, { retries: 1, deadLetterTopic: "bus.dlq" });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(attempts).toBe(2);
    expect(dlqHit).toBe(true);
  });
});
