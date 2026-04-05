import { logError } from "./logging.js";

export class ValidationError extends Error {
  readonly type = "validation";
}

export class RetryableError extends Error {
  readonly type = "retryable";
}

export class FatalError extends Error {
  readonly type = "fatal";
}

export type ErrorContext = {
  traceId?: string;
  spanId?: string;
  agent?: string;
  step?: string;
};

export const isRetryable = (err: unknown): boolean => err instanceof RetryableError;

export const handleError = (err: unknown, ctx: ErrorContext) => {
  const error = err instanceof Error ? err : new Error("unknown_error");
  const errorType =
    error instanceof ValidationError
      ? "validation"
      : error instanceof RetryableError
      ? "retryable"
      : error instanceof FatalError
      ? "fatal"
      : "unknown";

  logError(
    {
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      agent: ctx.agent,
      step: ctx.step,
      errorType
    },
    error.message,
    error
  );

  return { errorType, error };
};
