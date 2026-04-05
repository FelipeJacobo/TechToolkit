import { MessageBus } from "../bus/messageBus.js";
import { EventEnvelope } from "../core/types.js";

export type ErrorType = "tool_error" | "llm_error" | "timeout" | "invalid_plan";

export type ReplanDecision = {
  runId: string;
  strategy: "retry" | "switch_tool" | "simplify_plan" | "abort";
  reason: string;
  backoffMs?: number;
};

export class Replanner {
  constructor(private bus: MessageBus) {}

  async start(): Promise<void> {
    await this.bus.subscribe("orchestrator.replan.request", (event) => this.handle(event));
  }

  private classify(errorType: string): ErrorType {
    if (errorType === "timeout") return "timeout";
    if (errorType === "llm_error") return "llm_error";
    if (errorType === "invalid_plan") return "invalid_plan";
    return "tool_error";
  }

  private decide(type: ErrorType): ReplanDecision["strategy"] {
    switch (type) {
      case "timeout":
        return "retry";
      case "llm_error":
        return "switch_tool";
      case "invalid_plan":
        return "simplify_plan";
      default:
        return "retry";
    }
  }

  async handle(event: EventEnvelope<unknown>): Promise<void> {
    const payload = event.payload as { runId: string; errorType: string };
    const classification = this.classify(payload.errorType);
    const strategy = this.decide(classification);
    const decision: ReplanDecision = {
      runId: payload.runId,
      strategy,
      reason: `classified:${classification}`,
      backoffMs: strategy === "retry" ? 500 : undefined
    };

    const { logInfo } = await import("../core/logging.js");
    logInfo({ traceId: payload.runId, step: "replanner" }, `Replanner decision: ${strategy}`);
    await this.bus.publish("orchestrator.replan.decided", decision, { traceId: event.trace.traceId });
  }
}
