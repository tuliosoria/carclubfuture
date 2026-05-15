import type { Scenario } from "@/lib/types/cars";

export const SCENARIO_LABEL: Record<Scenario, string> = {
  pessimist: "Pessimist",
  moderate: "Moderate",
  optimist: "Optimist",
};

export const SCENARIO_COLOR: Record<Scenario, string> = {
  pessimist: "#f87171",
  moderate: "#f59e0b",
  optimist: "#22c55e",
};
