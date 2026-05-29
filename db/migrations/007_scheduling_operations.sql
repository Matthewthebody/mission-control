CREATE TYPE work_shift_kind AS ENUM ('shoot', 'studio', 'office', 'training');
CREATE TYPE work_shift_status AS ENUM ('draft', 'published', 'cancelled', 'completed');
CREATE TYPE shift_segment_kind AS ENUM ('studio_prep', 'travel', 'shoot', 'studio_wrap', 'office', 'training', 'break', 'other');
CREATE TYPE punch_direction AS ENUM ('in', 'out');
CREATE TYPE punch_approval_state AS ENUM ('not_required', 'pending', 'approved', 'rejected');
CREATE TYPE gps_confidence AS ENUM ('normal', 'low_confidence', 'outside');
CREATE TYPE attendance_exception_status AS ENUM ('open', 'approved', 'rejected', 'resolved');
CREATE TYPE attendance_exception_severity AS ENUM ('normal', 'high', 'critical');
CREATE TYPE trade_request_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE pto_request_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE notification_channel AS ENUM ('in_app', 'push', 'sms', 'email');
CREATE TYPE notification_priority AS ENUM ('normal', 'high', 'critical');
CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'failed', 'dismissed', 'skipped');

ALTER TABLE shoot
  ADD COLUMN IF NOT EXISTS location_address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS navigation_url text,
  ADD COLUMN IF NOT EXISTS projected_students integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_drive_minutes integer;

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS phone_number text;

ALTER TABLE shoot ALTER COLUMN geofence_radius_meters SET DEFAULT 1609;

CREATE TABLE work_shift (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  studio_id uuid REFERENCES studio(id) ON DELETE SET NULL,
  assigned_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  manager_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  published_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  shift_kind work_shift_kind NOT NULL,
  status work_shift_status NOT NULL DEFAULT 'draft',
  department department_code NOT NULL DEFAULT 'unassigned',
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  location_name text NOT NULL,
  location_address text NOT NULL DEFAULT '',
  location_lat double precision,
  location_lng double precision,
  geofence_radius_meters integer NOT NULL DEFAULT 1609,
  navigation_url text,
  notes text,
  published_at timestamptz,
  calendar_sync_required boolean NOT NULL DEFAULT false,
  calendar_last_synced_at timestamptz,
  calendar_last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CHECK (ends_at > starts_at)
);

CREATE INDEX work_shift_tenant_starts_at_idx ON work_shift (tenant_id, starts_at);
CREATE INDEX work_shift_tenant_assigned_user_idx ON work_shift (tenant_id, assigned_user_id, starts_at);
CREATE INDEX work_shift_tenant_shoot_idx ON work_shift (tenant_id, shoot_id);

CREATE TABLE shift_segment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES work_shift(id) ON DELETE CASCADE,
  segment_kind shift_segment_kind NOT NULL,
  label text NOT NULL,
  scheduled_start_at timestamptz NOT NULL,
  scheduled_end_at timestamptz NOT NULL,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  rate_code text NOT NULL,
  hourly_rate_cents integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (scheduled_end_at > scheduled_start_at)
);

CREATE INDEX shift_segment_tenant_shift_idx ON shift_segment (tenant_id, shift_id, sort_order);

CREATE TABLE shift_punch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shift_id uuid REFERENCES work_shift(id) ON DELETE SET NULL,
  shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  direction punch_direction NOT NULL,
  source text NOT NULL DEFAULT 'mobile',
  status_event_id uuid REFERENCES status_event(id) ON DELETE SET NULL,
  client_event_id uuid,
  idempotency_key text,
  client_timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  latitude double precision,
  longitude double precision,
  accuracy_meters numeric(10,2),
  geofence_status geofence_status NOT NULL DEFAULT 'unknown',
  gps_confidence gps_confidence NOT NULL DEFAULT 'normal',
  early_minutes integer,
  unscheduled boolean NOT NULL DEFAULT false,
  requires_approval boolean NOT NULL DEFAULT false,
  attested_approved boolean NOT NULL DEFAULT false,
  approver_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approval_state punch_approval_state NOT NULL DEFAULT 'not_required',
  reason_code text,
  notes text,
  high_priority boolean NOT NULL DEFAULT false,
  auto_closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shift_punch_tenant_shift_idx ON shift_punch (tenant_id, shift_id, client_timestamp);
CREATE INDEX shift_punch_tenant_user_idx ON shift_punch (tenant_id, user_id, client_timestamp);
CREATE UNIQUE INDEX shift_punch_status_event_id_uq
  ON shift_punch (status_event_id)
  WHERE status_event_id IS NOT NULL;
CREATE UNIQUE INDEX shift_punch_tenant_client_event_id_uq
  ON shift_punch (tenant_id, client_event_id)
  WHERE client_event_id IS NOT NULL;
CREATE UNIQUE INDEX shift_punch_tenant_idempotency_key_uq
  ON shift_punch (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE attendance_exception (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shift_id uuid REFERENCES work_shift(id) ON DELETE SET NULL,
  punch_id uuid REFERENCES shift_punch(id) ON DELETE SET NULL,
  shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  exception_type text NOT NULL,
  status attendance_exception_status NOT NULL DEFAULT 'open',
  severity attendance_exception_severity NOT NULL DEFAULT 'normal',
  classification text,
  reason_code text,
  notes text,
  original_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_approver_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attendance_exception_tenant_shift_idx ON attendance_exception (tenant_id, shift_id, created_at DESC);
CREATE INDEX attendance_exception_tenant_status_idx ON attendance_exception (tenant_id, status, created_at DESC);

CREATE TABLE shift_trade_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES work_shift(id) ON DELETE CASCADE,
  requester_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  requested_with_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reason text NOT NULL,
  status trade_request_status NOT NULL DEFAULT 'pending',
  same_day_exception_eligible boolean NOT NULL DEFAULT false,
  decided_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  decided_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pto_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  department department_code NOT NULL DEFAULT 'unassigned',
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  partial_day boolean NOT NULL DEFAULT false,
  reason text,
  status pto_request_status NOT NULL DEFAULT 'pending',
  decided_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE ops_notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  related_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  shift_id uuid REFERENCES work_shift(id) ON DELETE SET NULL,
  shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  attendance_exception_id uuid REFERENCES attendance_exception(id) ON DELETE SET NULL,
  notification_type text NOT NULL,
  channel notification_channel NOT NULL,
  priority notification_priority NOT NULL DEFAULT 'normal',
  status notification_status NOT NULL DEFAULT 'pending',
  title text NOT NULL,
  body text NOT NULL,
  deep_link text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ops_notification_tenant_recipient_idx ON ops_notification (tenant_id, recipient_user_id, created_at DESC);
CREATE INDEX ops_notification_tenant_status_idx ON ops_notification (tenant_id, status, created_at DESC);

CREATE TABLE notification_routing_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  event_code text NOT NULL,
  role_code text NOT NULL,
  department department_code,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_code, role_code, department)
);

ALTER TABLE work_shift ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_segment ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_punch ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_exception ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_trade_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE pto_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_routing_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_shift FORCE ROW LEVEL SECURITY;
ALTER TABLE shift_segment FORCE ROW LEVEL SECURITY;
ALTER TABLE shift_punch FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_exception FORCE ROW LEVEL SECURITY;
ALTER TABLE shift_trade_request FORCE ROW LEVEL SECURITY;
ALTER TABLE pto_request FORCE ROW LEVEL SECURITY;
ALTER TABLE ops_notification FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_routing_rule FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_work_shift ON work_shift
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_shift_segment ON shift_segment
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_shift_punch ON shift_punch
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_attendance_exception ON attendance_exception
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_shift_trade_request ON shift_trade_request
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_pto_request ON pto_request
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_ops_notification ON ops_notification
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_notification_routing_rule ON notification_routing_rule
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
