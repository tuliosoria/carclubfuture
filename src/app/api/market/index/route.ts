import { loadSegmentIndexes } from "@/lib/db/market-index";
import { ok } from "@/lib/api/envelope";

export const runtime = "nodejs";

export function GET() {
  return ok({ segments: loadSegmentIndexes() });
}
