export const READINESS_CHECK_SEVERITY_REGISTRY = [
  "advisory",
  "warning",
  "blocking"
] as const;

export type ReadinessCheckSeverity = (typeof READINESS_CHECK_SEVERITY_REGISTRY)[number];

const READINESS_CHECK_SEVERITY_SET = new Set<string>(READINESS_CHECK_SEVERITY_REGISTRY);

export function isReadinessCheckSeverity(value: string): value is ReadinessCheckSeverity {
  return READINESS_CHECK_SEVERITY_SET.has(value);
}
