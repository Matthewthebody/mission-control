CREATE TYPE operational_alert_type AS ENUM (
  'shoot_changed_within_48h',
  'job_missing_required_data',
  'staff_assignment_conflict_detected',
  'understaffed_job',
  'red_flag_post_shoot_eval',
  'overdue_production_item',
  'approval_needed',
  'gallery_job_completed'
);

CREATE TYPE operational_alert_delivery_channel AS ENUM (
  'teams_webhook',
  'email',
  'sms',
  'push'
);

CREATE TYPE operational_alert_delivery_status AS ENUM (
  'queued',
  'throttled',
  'sent',
  'failed'
);

CREATE TABLE operational_alert_route (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  alert_type operational_alert_type NOT NULL,
  delivery_channel operational_alert_delivery_channel NOT NULL,
  route_name text NOT NULL,
  destination_label text NOT NULL,
  destination_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity_threshold notification_severity NOT NULL DEFAULT 'high',
  throttle_window_minutes integer NOT NULL DEFAULT 120 CHECK (throttle_window_minutes BETWEEN 1 AND 10080),
  enabled boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX operational_alert_route_tenant_alert_idx
  ON operational_alert_route (tenant_id, alert_type, enabled, delivery_channel);

CREATE INDEX operational_alert_route_tenant_updated_idx
  ON operational_alert_route (tenant_id, updated_at DESC);

CREATE TABLE operational_alert_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES operational_alert_route(id) ON DELETE CASCADE,
  delivery_channel operational_alert_delivery_channel NOT NULL,
  alert_type operational_alert_type NOT NULL,
  source_event_type text,
  source_entity_type text,
  source_entity_id text,
  dedupe_key text NOT NULL,
  status operational_alert_delivery_status NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  severity notification_severity NOT NULL,
  deep_link text,
  app_event_id uuid REFERENCES app_event(id) ON DELETE SET NULL,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0,
  first_attempted_at timestamptz,
  last_attempted_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX operational_alert_delivery_tenant_status_idx
  ON operational_alert_delivery (tenant_id, status, created_at DESC);

CREATE INDEX operational_alert_delivery_tenant_route_idx
  ON operational_alert_delivery (tenant_id, route_id, created_at DESC);

CREATE INDEX operational_alert_delivery_tenant_dedupe_idx
  ON operational_alert_delivery (tenant_id, route_id, dedupe_key, created_at DESC);

CREATE UNIQUE INDEX operational_alert_delivery_app_event_idx
  ON operational_alert_delivery (app_event_id)
  WHERE app_event_id IS NOT NULL;

ALTER TABLE operational_alert_route ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_alert_route FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_operational_alert_route ON operational_alert_route
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE operational_alert_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_alert_delivery FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_operational_alert_delivery ON operational_alert_delivery
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
