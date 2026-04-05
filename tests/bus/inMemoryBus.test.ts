import { describe, it, expect } from "vitest";
import { InMemoryBus } from "../../src/bus/inMemoryBus.js";

describe("InMemoryBus", () => {
  it("delivers published events to subscribers", async () => {
    const bus = new InMemoryBus();
    let received = 0;

    await bus.subscribe("test.topic", async (event) => {
      if (event.payload === "ping") received += 1;
    });

    await bus.publish("test.topic", "ping");

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received).toBe(1);
  });
});
