export class OrchestratorError extends Error {
  readonly errCode: string;
  readonly errCause?: Error;

  constructor(code: string, message: string, cause?: Error) {
    super(message);
    this.errCode = code;
    this.errCause = cause;
  }
}

export class ValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Validation error: ${issues.join(", ")}`);
    this.issues = issues;
  }
}
