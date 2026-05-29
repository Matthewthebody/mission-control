import type { PoolClient } from "pg";

export type SharedTimeClockStateSummary = {
  session_id: string | null;
  session_status: "open" | "closed" | "needs_end_of_day_confirmation" | "approved" | "payroll_exported" | "off_clock";
  current_state: "off_clock" | "office_drive" | "photography";
  current_segment_id: string | null;
  current_segment_review_status: "not_required" | "pending_review" | "approved" | "rejected" | null;
  current_linked_shoot_id: string | null;
  current_linked_location_id: string | null;
  current_segment_started_at: string | null;
  needs_end_of_day_confirmation: boolean;
  last_clock_event_at: string | null;
};

export type AutoCloseTimeClockSessionInput = {
  tenantId: string;
  employeeId: string;
  shiftId: string;
  shootId?: string | null;
  locationId?: string | null;
  capturedAt: string;
};

export type AutoCloseTimeClockSessionResult = {
  sessionId: string;
  segmentId: string | null;
  timeClockState: SharedTimeClockStateSummary;
} | null;

export const TIME_CLOCK_SOFT_WARNING_RADIUS_METERS: number;

export function isWithinTimeClockSoftWarningRadius(input: {
  distanceMiles: number;
  accuracyMeters?: number | null;
}): boolean;

export function buildOffClockTimeClockSummary(): SharedTimeClockStateSummary;

export async function autoCloseTimeClockSessionForShift(
  client: PoolClient,
  input: AutoCloseTimeClockSessionInput
): Promise<AutoCloseTimeClockSessionResult>;
