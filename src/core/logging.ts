import { logger } from "./logger.js";

export type LogContext = {
  traceId?: string;
  spanId?: string;
  agent?: string;
  step?: string;
  durationMs?: number;
  errorType?: string;
  runId?: string;
  score?: number;
  remainingIssues?: number;
  status?: string;
  steps?: unknown;
  retries?: number;
  deadLetterTopic?: string;
  retryCount?: number;
  eventId?: string;
  topic?: string;
  event?: unknown;
  priority?: string;
  maxRetries?: number;
  severity?: string;
  file?: string;
  line?: number;
  endLine?: number;
  files?: unknown;
  language?: string;
  focus?: string;
  maxIssues?: number;
  framework?: string;
  description?: string;
  error?: unknown;
};

const normalize = (ctx: LogContext) => ({
  traceId: ctx.traceId ?? null,
  spanId: ctx.spanId ?? null,
  agent: ctx.agent ?? null,
  step: ctx.step ?? null,
  durationMs: ctx.durationMs ?? null,
  errorType: ctx.errorType ?? null
});

export const logInfo = (ctx: LogContext, message: string) => {
  logger.info({ ...normalize(ctx), message });
};

export const logWarn = (ctx: LogContext, message: string) => {
  logger.warn({ ...normalize(ctx), message });
};

export const logError = (ctx: LogContext, message: string, err?: unknown) => {
  logger.error({ ...normalize(ctx), message, err });
};
