import { z } from "zod";

export const TraceContextSchema = z.object({
  traceId: z.string().min(8),
  spanId: z.string().min(8).optional()
});

export type TraceContext = z.infer<typeof TraceContextSchema>;

export const PrioritySchema = z.enum(["low", "normal", "high", "critical"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const EventEnvelopeSchema = z.object({
  id: z.string().min(8),
  type: z.string().min(3),
  createdAt: z.string().datetime(),
  trace: TraceContextSchema,
  priority: PrioritySchema.default("normal"),
  retryCount: z.number().int().min(0).default(0),
  maxRetries: z.number().int().min(0).optional(),
  deadLetterTopic: z.string().min(3).optional(),
  payload: z.unknown()
});

export type EventEnvelope<TPayload = unknown> = Omit<
  z.infer<typeof EventEnvelopeSchema>,
  "payload"
> & { payload: TPayload };

export const AgentIdSchema = z.string().min(3);
export type AgentId = z.infer<typeof AgentIdSchema>;

export const ToolPermissionSchema = z.object({
  tool: z.string().min(3),
  allow: z.boolean()
});
export type ToolPermission = z.infer<typeof ToolPermissionSchema>;

export const ToolVersionSchema = z.object({
  name: z.string().min(3),
  version: z.string().regex(/^\d+\.\d+\.\d+$/)
});
export type ToolVersion = z.infer<typeof ToolVersionSchema>;

export const CostRecordSchema = z.object({
  runId: z.string().min(8),
  stepId: z.string().min(3),
  model: z.string().min(2),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative()
});
export type CostRecord = z.infer<typeof CostRecordSchema>;
