/**
 * Error code enumeration (Day 1 bake-in §18.7.4).
 * Use these in API responses and structured logs so downstream alerting can
 * group by code rather than free-text message.
 */
export const ERROR_CODES = {
  E001_CAR_SEARCH_FAILED: "E001_CAR_SEARCH_FAILED",
  E002_CAR_NOT_FOUND: "E002_CAR_NOT_FOUND",
  E003_FORECAST_FAILED: "E003_FORECAST_FAILED",
  E004_INSUFFICIENT_DATA: "E004_INSUFFICIENT_DATA",
  E005_BAT_RESOLVE_FAILED: "E005_BAT_RESOLVE_FAILED",
  E006_VIN_DECODE_FAILED: "E006_VIN_DECODE_FAILED",
  E007_DYNAMO_UNAVAILABLE: "E007_DYNAMO_UNAVAILABLE",
  E008_INVALID_REQUEST: "E008_INVALID_REQUEST",
  E009_RATE_LIMITED: "E009_RATE_LIMITED",
  E010_MARKET_INDEX_FAILED: "E010_MARKET_INDEX_FAILED",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export function apiError(code: ErrorCode, message: string, details?: Record<string, unknown>): ApiError {
  return { code, message, ...(details ? { details } : {}) };
}
