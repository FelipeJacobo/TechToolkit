import { RetryableError } from "./errorHandler.js";

export class RetryPolicy {
  readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly jitterFactor: number;
  constructor(
    maxRetries: number,
    baseBackoffMs: number,
    jitterFactor = 0
  ) { this.maxRetries = maxRetries; this.baseBackoffMs = baseBackoffMs; this.jitterFactor = jitterFactor; }

  shouldRetry(error: unknown, attempt: number): boolean {
    if (!(error instanceof RetryableError)) return false;
    return attempt < this.maxRetries;
  }

  getBackoff(attempt: number): number {
    const exp = this.baseBackoffMs * Math.pow(2, attempt);
    if (this.jitterFactor <= 0) return exp;
    const jitter = exp * this.jitterFactor * Math.random();
    return exp + jitter;
  }
}
