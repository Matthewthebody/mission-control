export type StatusEventType =
  | "ARRIVED"
  | "SETUP_COMPLETE"
  | "SHOOTING_STARTED"
  | "WRAPPED"
  | "CLOCK_IN"
  | "CLOCK_OUT";

export type AlertType =
  | "LATE_CLOCK_IN"
  | "MISSING_SETUP_COMPLETE"
  | "MISSING_SHOOTING_STARTED"
  | "MISSING_SETUP_PHOTO"
  | "MISSING_POST_SHOOT_EVALUATION"
  | "OUTSIDE_GEOFENCE";

export type WorkShiftKind = "shoot" | "studio" | "office" | "training";
export type WorkShiftStatus = "draft" | "published" | "cancelled" | "completed";
export type ShiftSegmentKind =
  | "studio_prep"
  | "travel"
  | "shoot"
  | "studio_wrap"
  | "office"
  | "training"
  | "break"
  | "other";
export type PunchDirection = "in" | "out";
export type PunchApprovalState = "not_required" | "pending" | "approved" | "rejected";
export type PunchTimingStatus =
  | "normal"
  | "early"
  | "early_exception"
  | "grace_window"
  | "late"
  | "critically_late"
  | "missed_punch_required";
export type GpsConfidence = "normal" | "low_confidence" | "outside";
export type AttendanceExceptionStatus = "open" | "approved" | "rejected" | "resolved";
export type AttendanceExceptionSeverity = "normal" | "high" | "critical";
export type AttendanceState =
  | "pending"
  | "clocked_in"
  | "clocked_out"
  | "late_warning"
  | "late"
  | "missed_clock_in"
  | "missed_clock_out"
  | "no_show_suspected"
  | "resolved"
  | "corrected";
export type TradeRequestStatus =
  | "pending_recipient"
  | "recipient_declined"
  | "pending_manager"
  | "approved"
  | "denied"
  | "canceled";
export type PTORequestStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled_by_employee"
  | "cancelled_by_manager_admin"
  | "expired"
  | "needs_review";
export type NotificationChannel = "in_app" | "push" | "sms" | "email";
export type NotificationPriority = "normal" | "high" | "critical";
export type NotificationStatus = "pending" | "sent" | "failed" | "dismissed" | "skipped";
export type NotificationCategory =
  | "urgent_operational_risk"
  | "staffing"
  | "attendance_time"
  | "schedule_change"
  | "pto_availability"
  | "production"
  | "approval_needed"
  | "follow_up_task"
  | "assignment_update"
  | "system_confirmation"
  | "informational_summary";
export type NotificationSeverity = "low" | "medium" | "high" | "critical";
export type NotificationCenterState = "new" | "seen" | "acknowledged" | "snoozed" | "resolved" | "expired" | "escalated";
export type NotificationEventType =
  | "created"
  | "delivered"
  | "delivery_failed"
  | "seen"
  | "acknowledged"
  | "snoozed"
  | "escalated"
  | "resolved"
  | "expired";
