/**
 * Structured logging via pino — Day 1 bake-in (§18.5.2).
 * Use named child loggers per feature so logs are filterable.
 */
import pino from "pino";

const isProd = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss" },
        },
      }),
});

export function loggerFor(feature: string) {
  return logger.child({ feature });
}
