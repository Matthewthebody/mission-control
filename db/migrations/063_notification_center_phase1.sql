CREATE TYPE notification_category AS ENUM (
  'urgent_operational_risk',
  'staffing',
  'attendance_time',
  'schedule_change',
  'pto_availability',
  'production',
  'approval_needed',
  'follow_up_task',
  'assignment_update',
  'system_confirmation',
  'informational_summary'
);

CREATE TYPE notification_severity AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE notification_center_state AS ENUM (
  'new',
  'seen',
  'acknowledged',
  'snoozed',
  'resolved',
  'expired',
  'escalated'
);

CREATE TYPE notification_event_type AS ENUM (
  'created',
  'delivered',
  'delivery_failed',
  'seen',
  'acknowledged',
  'snoozed',
  'escalated',
  'resolved',
  'expired'
);

ALTER TABLE ops_notification
  ADD COLUMN category notification_category NOT NULL DEFAULT 'informational_summary',
  ADD COLUMN severity notification_severity NOT NULL DEFAULT 'medium',
  ADD COLUMN action_required boolean NOT NULL DEFAULT false,
  ADD COLUMN action_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN due_at timestamptz,
  ADD COLUMN source_event text,
  ADD COLUMN state notification_center_state NOT NULL DEFAULT 'new',
  ADD COLUMN seen_at timestamptz,
  ADD COLUMN acknowledged_at timestamptz,
  ADD COLUMN snoozed_until timestamptz,
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN expired_at timestamptz,
  ADD COLUMN escalated_at timestamptz,
  ADD COLUMN escalation_level integer NOT NULL DEFAULT 0,
  ADD COLUMN requires_acknowledgement boolean NOT NULL DEFAULT false,
  ADD COLUMN allow_snooze boolean NOT NULL DEFAULT false,
  ADD COLUMN group_key text,
  ADD COLUMN digest_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN quiet_hours_deferred boolean NOT NULL DEFAULT false,
  ADD COLUMN delivery_channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE ops_notification
SET
  category = CASE
    WHEN notification_type LIKE 'attendance.%' THEN 'attendance_time'::notification_category
    WHEN notification_type LIKE 'schedule.staffing.%' THEN 'staffing'::notification_category
    WHEN notification_type LIKE 'schedule.pto_%' OR notification_type LIKE 'schedule.same_day_absence%' THEN 'pto_availability'::notification_category
    WHEN notification_type LIKE 'schedule.shift_%' OR notification_type LIKE 'schedule.trade_%' THEN 'schedule_change'::notification_category
    WHEN notification_type LIKE 'shoot.closeout_%' THEN 'follow_up_task'::notification_category
    WHEN notification_type LIKE 'gear.%' THEN 'urgent_operational_risk'::notification_category
    WHEN notification_type LIKE 'sales.%' THEN 'follow_up_task'::notification_category
    ELSE 'informational_summary'::notification_category
  END,
  severity = CASE
    WHEN priority = 'critical' THEN 'critical'::notification_severity
    WHEN priority = 'high' THEN 'high'::notification_severity
    ELSE 'medium'::notification_severity
  END,
  source_event = notification_type,
  state = CASE
    WHEN status = 'dismissed' THEN 'resolved'::notification_center_state
    ELSE 'new'::notification_center_state
  END,
  resolved_at = CASE
    WHEN status = 'dismissed' THEN COALESCE(sent_at, created_at)
    ELSE NULL
  END,
  group_key = CONCAT_WS(
    ':',
    notification_type,
    COALESCE(metadata->>'dedupe', id::text),
    COALESCE(shift_id::text, 'none'),
    COALESCE(shoot_id::text, 'none'),
    COALESCE(attendance_exception_id::text, 'none')
  ),
  delivery_channels = jsonb_build_array(channel::text),
  updated_at = created_at;

ALTER TABLE ops_notification
  ALTER COLUMN group_key SET NOT NULL;

CREATE INDEX ops_notification_tenant_inbox_idx
  ON ops_notification (tenant_id, recipient_user_id, state, severity, created_at DESC);

CREATE INDEX ops_notification_tenant_group_idx
  ON ops_notification (tenant_id, recipient_user_id, group_key, created_at DESC);

CREATE TABLE ops_notification_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES ops_notification(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  event_type notification_event_type NOT NULL,
  channel notification_channel,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ops_notification_event_tenant_notification_idx
  ON ops_notification_event (tenant_id, notification_id, created_at DESC);

ALTER TABLE ops_notification_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_notification_event FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_ops_notification_event ON ops_notification_event
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
