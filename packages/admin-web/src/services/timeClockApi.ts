import { apiFetch } from "../api";

export const TIME_CLOCK_STATE_CHANGED_EVENT = "pmc:timeclock-changed";

export type TimeClockShellShiftPreview = {
  id: string;
  shoot_id: string | null;
  title: string;
  shift_kind: string;
  starts_at: string;
  ends_at: string;
  location_name: string | null;
  actionable_now: boolean;
  starts_in_minutes: number | null;
  late_by_minutes: number | null;
};

export type TimeClockShellControlState = {
  generated_at: string;
  state: "action_needed" | "active" | "ended_today" | "needs_review" | "off_shift";
  emphasis: "red" | "green" | "amber" | "neutral";
  label: string;
  helper_text: string;
  time_clock_state: {
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
  active_shift: TimeClockShellShiftPreview | null;
  next_shift: TimeClockShellShiftPreview | null;
  latest_session: {
    session_id: string;
    session_status: "open" | "closed" | "needs_end_of_day_confirmation" | "approved" | "payroll_exported";
    work_date: string;
    last_changed_at: string;
    ended_at: string | null;
  } | null;
  review: {
    has_open_review: boolean;
    open_request_count: number;
    label: string | null;
  };
  action: {
    direction: "in" | "out" | null;
    label: string | null;
    enabled: boolean;
    shift_id: string | null;
    shoot_id: string | null;
    work_state: "office_drive" | "photography" | null;
  };
};

export function emitTimeClockStateChanged() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(TIME_CLOCK_STATE_CHANGED_EVENT));
}

export async function getGlobalTimeClockState(token: string) {
  return apiFetch<TimeClockShellControlState>("/api/attendance/time-clock/state", token);
}
