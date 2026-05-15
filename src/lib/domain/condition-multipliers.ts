/**
 * Condition multiplier helpers — driven by JSON, never hard-coded.
 */
import multipliersJson from "@/lib/data/cars-ml/condition-multipliers.json";
import type { ConditionGrade, Segment } from "@/lib/types/cars";

interface MultipliersFile {
  default: Record<string, number>;
  bySegment: Partial<Record<Segment, Record<string, number>>>;
}

const data = multipliersJson as unknown as MultipliersFile;

export function multiplierFor(grade: ConditionGrade, segment?: Segment): number {
  const segMap = segment ? data.bySegment[segment] : undefined;
  const map = segMap ?? data.default;
  return map[String(grade)] ?? data.default[String(grade)] ?? 1;
}

export function applyCondition(baseValueUsd: number, grade: ConditionGrade, segment?: Segment): number {
  return Math.round(baseValueUsd * multiplierFor(grade, segment));
}

export const ALL_GRADES: ConditionGrade[] = [1, 2, 3, 4];

export const GRADE_LABEL: Record<ConditionGrade, string> = {
  1: "#1 Concours",
  2: "#2 Excellent",
  3: "#3 Good (base)",
  4: "#4 Fair",
};
