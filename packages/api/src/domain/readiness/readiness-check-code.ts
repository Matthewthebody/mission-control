export const READINESS_CHECK_CODE_REGISTRY = [
  "staffing_complete",
  "lead_assigned",
  "schedule_timing_confirmed",
  "location_ready",
  "equipment_ready",
  "setup_photo_received",
  "pre_service_note_present",
  "approval_clearance",
  "open_issue_reviewed"
] as const;

export type ReadinessCheckCode = (typeof READINESS_CHECK_CODE_REGISTRY)[number];

const READINESS_CHECK_CODE_SET = new Set<string>(READINESS_CHECK_CODE_REGISTRY);

export function isReadinessCheckCode(value: string): value is ReadinessCheckCode {
  return READINESS_CHECK_CODE_SET.has(value);
}
