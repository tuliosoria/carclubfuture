/**
 * Runtime loader for the cars-ml model artifacts.
 *
 * Source order is controlled by CARS_ML_MODEL_SOURCE:
 *   - "auto" (default): try DynamoDB chunks first, fall back to bundled JSON.
 *   - "bundled": always use the repo-bundled JSON (rollback path).
 *
 * When the loaded model is `kind: "baseline"`, callers should fall back
 * to the deterministic forecast in `car-forecast.ts`.
 */
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamo, getTableName } from "@/lib/db/dynamo";
import { loggerFor } from "@/lib/logger";
import baseline1 from "@/lib/data/cars-ml/model-1yr.json";
import baseline3 from "@/lib/data/cars-ml/model-3yr.json";
import baseline5 from "@/lib/data/cars-ml/model-5yr.json";

const log = loggerFor("models.cars-ml");

export type ModelHorizon = 1 | 3 | 5;

export interface CarsMlModel {
  kind: "baseline" | "xgboost";
  horizon: ModelHorizon;
  features: string[];
  segmentBaselines?: Record<string, number>;
  trainedAt: string | null;
  notes?: string;
}

const BUNDLED: Record<ModelHorizon, CarsMlModel> = {
  1: baseline1 as CarsMlModel,
  3: baseline3 as CarsMlModel,
  5: baseline5 as CarsMlModel,
};

const memoryCache = new Map<ModelHorizon, CarsMlModel>();

export async function loadCarsMlModel(horizon: ModelHorizon): Promise<CarsMlModel> {
  const cached = memoryCache.get(horizon);
  if (cached) return cached;

  const source = (process.env.CARS_ML_MODEL_SOURCE ?? "auto").toLowerCase();
  if (source === "bundled") {
    memoryCache.set(horizon, BUNDLED[horizon]);
    return BUNDLED[horizon];
  }

  const dynamo = getDynamo();
  const table = getTableName();
  if (dynamo && table) {
    try {
      const item = await dynamo.send(
        new GetCommand({
          TableName: table,
          Key: { pk: `model#cars-ml#model-${horizon}yr`, sk: "v1" },
        })
      );
      const body = item?.Item?.body;
      if (typeof body === "string") {
        const parsed = JSON.parse(body) as CarsMlModel;
        memoryCache.set(horizon, parsed);
        log.info({ horizon, kind: parsed.kind }, "loaded model from DynamoDB");
        return parsed;
      }
    } catch (err) {
      log.warn({ err: String(err), horizon }, "DynamoDB load failed; falling back to bundled");
    }
  }

  memoryCache.set(horizon, BUNDLED[horizon]);
  return BUNDLED[horizon];
}

export async function loadAllCarsMlModels(): Promise<Record<ModelHorizon, CarsMlModel>> {
  const [m1, m3, m5] = await Promise.all([
    loadCarsMlModel(1),
    loadCarsMlModel(3),
    loadCarsMlModel(5),
  ]);
  return { 1: m1, 3: m3, 5: m5 };
}

export function clearModelCache(): void {
  memoryCache.clear();
}
