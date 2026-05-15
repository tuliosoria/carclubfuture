/**
 * Lazy, null-safe DynamoDB client. Returns null when AWS env vars are not
 * configured, so the site boots without DynamoDB. All call sites must handle
 * the null case and fall back to bundled JSON.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { loggerFor } from "@/lib/logger";

const log = loggerFor("dynamo");

let cached: DynamoDBDocumentClient | null | undefined;

export function getDynamo(): DynamoDBDocumentClient | null {
  if (cached !== undefined) return cached;
  const region = process.env.AWS_REGION;
  const table = process.env.DYNAMODB_TABLE;
  if (!region || !table) {
    log.debug({ region, table }, "DynamoDB not configured — running in bundled-only mode");
    cached = null;
    return cached;
  }
  const raw = new DynamoDBClient({ region });
  cached = DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return cached;
}

export function getTableName(): string | null {
  return process.env.DYNAMODB_TABLE ?? null;
}
