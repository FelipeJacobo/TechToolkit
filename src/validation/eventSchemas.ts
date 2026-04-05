import { z } from "zod";

export const PlanRequestSchema = z.object({
  runId: z.string().min(3),
  goal: z.string().min(1)
});

export const PlanCreatedSchema = z.object({
  runId: z.string().min(3),
  plan: z.array(z.object({
    stepId: z.string().min(3),
    action: z.string().min(1),
    status: z.string().min(1)
  })),
  context: z.array(z.object({
    id: z.string(),
    kind: z.string(),
    content: z.string(),
    createdAt: z.string(),
    tags: z.array(z.string())
  })).optional(),
  tool: z.object({ name: z.string().min(3), namespace: z.string().min(2), version: z.string().min(1) })
});

export const ExecutionCompletedSchema = z.object({
  runId: z.string().min(3),
  result: z.object({ ok: z.boolean(), errorType: z.string().optional() }),
  tool: z.object({ name: z.string().min(3), namespace: z.string().min(2), version: z.string().min(1) })
});

export const ExecutionFailedSchema = z.object({
  runId: z.string().min(3),
  errorType: z.string().min(3)
});

export const ReviewCompletedSchema = z.object({
  runId: z.string().min(3),
  status: z.string().min(2)
});

export const ReplanRequestSchema = z.object({
  runId: z.string().min(3),
  errorType: z.string().min(3)
});

export const ReplanDecidedSchema = z.object({
  runId: z.string().min(3),
  strategy: z.string().min(3),
  reason: z.string().min(3),
  backoffMs: z.number().int().nonnegative().optional()
});

export const PlanFailedSchema = z.object({
  runId: z.string().min(3),
  errorType: z.string().min(3)
});

export const EventPayloadSchemas: Record<string, z.ZodTypeAny> = {
  "orchestrator.plan.request": PlanRequestSchema,
  "agent.plan.created": PlanCreatedSchema,
  "agent.execution.completed": ExecutionCompletedSchema,
  "agent.execution.failed": ExecutionFailedSchema,
  "orchestrator.review.completed": ReviewCompletedSchema,
  "orchestrator.replan.request": ReplanRequestSchema,
  "orchestrator.replan.decided": ReplanDecidedSchema,
  "orchestrator.plan.failed": PlanFailedSchema
};
