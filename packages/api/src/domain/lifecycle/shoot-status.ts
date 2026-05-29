export const SHOOT_STATUS_REGISTRY = [
  "DRAFT",
  "TENTATIVE",
  "CONFIRMED",
  "READY",
  "LIVE",
  "SHOOT_COMPLETE",
  "POST_PRODUCTION",
  "COMPLETE",
  "ON_HOLD",
  "CANCELLED"
] as const;

export type ShootStatus = (typeof SHOOT_STATUS_REGISTRY)[number];

const SHOOT_STATUS_SET = new Set<string>(SHOOT_STATUS_REGISTRY);

export function isShootStatus(value: string): value is ShootStatus {
  return SHOOT_STATUS_SET.has(value);
}
