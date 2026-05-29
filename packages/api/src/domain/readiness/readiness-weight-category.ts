export const READINESS_WEIGHT_CATEGORY_REGISTRY = [
  "critical",
  "high",
  "standard",
  "low"
] as const;

export type ReadinessWeightCategory = (typeof READINESS_WEIGHT_CATEGORY_REGISTRY)[number];

const READINESS_WEIGHT_CATEGORY_SET = new Set<string>(READINESS_WEIGHT_CATEGORY_REGISTRY);

export function isReadinessWeightCategory(value: string): value is ReadinessWeightCategory {
  return READINESS_WEIGHT_CATEGORY_SET.has(value);
}
