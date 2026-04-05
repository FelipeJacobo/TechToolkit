import Fastify from "fastify";
import { Orchestrator } from "../orchestrator/orchestrator.js";
import { MessageBus } from "../bus/messageBus.js";
import { registerStream } from "./stream.js";

export type ApiDeps = {
  orchestrator: Orchestrator;
  bus: MessageBus;
};

export const buildServer = ({ orchestrator, bus }: ApiDeps) => {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ ok: true }));

  app.get("/metrics", async (_req, reply) => {
    const { registry } = await import("../observability/metrics.js");
    reply.header("Content-Type", registry.contentType);
    return registry.metrics();
  });

  app.get("/state", async () => ({ state: orchestrator.state, history: orchestrator.history }));

  app.post("/runs", async (req, reply) => {
    const schema = await import("zod");
    const bodySchema = schema.z.object({
      goal: schema.z.string().min(1),
      timeoutMs: schema.z.number().int().positive().optional()
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_body" });
    }
    const run = await orchestrator.start(parsed.data.goal, parsed.data.timeoutMs ?? 60000);
    return reply.status(201).send(run);
  });

  app.get("/events", async (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    const subscription = await bus.subscribe("*", async (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    req.raw.on("close", async () => {
      await bus.unsubscribe(subscription.handlerId);
    });
  });

  registerStream({ bus, orchestrator })(app);

  return app;
};
