import { Registry, Counter, Histogram, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const eventCounter = new Counter({
  name: "agent_events_total",
  help: "Total number of events processed",
  labelNames: ["topic"] as const,
  registers: [registry]
});

export const runCounter = new Counter({
  name: "orchestrator_runs_total",
  help: "Total number of orchestrator runs",
  labelNames: ["status"] as const,
  registers: [registry]
});

export const busPublishHistogram = new Histogram({
  name: "bus_publish_duration_ms",
  help: "Bus publish latency in ms",
  labelNames: ["topic"] as const,
  buckets: [1, 5, 10, 50, 100, 250, 500, 1000],
  registers: [registry]
});

export const agentLatencyHistogram = new Histogram({
  name: "agent_handler_latency_ms",
  help: "Agent handler latency in ms",
  labelNames: ["agent", "step"] as const,
  buckets: [1, 5, 10, 50, 100, 250, 500, 1000, 2000],
  registers: [registry]
});

export const agentErrorCounter = new Counter({
  name: "agent_errors_total",
  help: "Total agent errors",
  labelNames: ["agent", "errorType"] as const,
  registers: [registry]
});

export const busRetryCounter = new Counter({
  name: "bus_retries_total",
  help: "Total bus retries",
  labelNames: ["topic"] as const,
  registers: [registry]
});

export const busDlqCounter = new Counter({
  name: "bus_dlq_total",
  help: "Total dead-lettered messages",
  labelNames: ["topic"] as const,
  registers: [registry]
});
