import { MessageBus } from "../bus/messageBus.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";
import { registry } from "../observability/metrics.js";

type StreamDeps = {
  bus: MessageBus;
  orchestrator: Orchestrator;
};

export const registerStream = ({ bus, orchestrator }: StreamDeps) => (app: import("fastify").FastifyInstance) => {
  app.get("/events/stream", async (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    const sendSnapshot = async () => {
      const metrics = await registry.metrics();
      const payload = {
        activeRun: orchestrator.active,
        state: orchestrator.state,
        history: orchestrator.history,
        metrics
      };
      reply.raw.write(`event: snapshot\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    await sendSnapshot();

    const subscription = await bus.subscribe("*", async (event) => {
      const payload = {
        event,
        activeRun: orchestrator.active,
        state: orchestrator.state,
        history: orchestrator.history
      };
      reply.raw.write(`event: bus\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    });

    req.raw.on("close", async () => {
      await bus.unsubscribe(subscription.handlerId);
    });
  });
};
