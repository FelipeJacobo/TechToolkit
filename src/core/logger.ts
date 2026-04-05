// @ts-expect-error pino CJS default export compatibility
import pino, { Logger } from "pino";

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined,
  formatters: {
    level(label: string) {
      return { level: label };
    }
  }
});
