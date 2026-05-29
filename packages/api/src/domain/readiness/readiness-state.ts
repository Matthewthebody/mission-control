export const READINESS_STATE_REGISTRY = [
  "not_evaluated",
  "not_ready",
  "needs_attention",
  "ready"
] as const;

export type ReadinessState = (typeof READINESS_STATE_REGISTRY)[number];

const READINESS_STATE_SET = new Set<string>(READINESS_STATE_REGISTRY);

export function isReadinessState(value: string): value is ReadinessState {
  return READINESS_STATE_SET.has(value);
}
