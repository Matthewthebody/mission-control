CREATE TYPE shoot_status AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETE', 'CANCELLED');
CREATE TYPE status_event_type AS ENUM ('ARRIVED', 'SETUP_COMPLETE', 'SHOOTING_STARTED', 'WRAPPED', 'CLOCK_IN', 'CLOCK_OUT');
CREATE TYPE geofence_status AS ENUM ('inside', 'outside', 'unknown');
CREATE TYPE alert_status AS ENUM ('open', 'resolved');

CREATE TABLE shoot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  studio_id uuid NOT NULL REFERENCES studio(id) ON DELETE RESTRICT,
  shoot_code text NOT NULL,
  title text NOT NULL,
  shoot_date date NOT NULL,
  location_name text NOT NULL,
  location_lat double precision NOT NULL,
  location_lng double precision NOT NULL,
  geofence_radius_meters integer NOT NULL DEFAULT 200,
  arrival_time timestamptz NOT NULL,
  start_time timestamptz NOT NULL,
  end_time_est timestamptz NOT NULL,
  status shoot_status NOT NULL DEFAULT 'SCHEDULED',
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, shoot_code)
);

CREATE TABLE shoot_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, shoot_id, user_id)
);

CREATE TABLE status_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  type status_event_type NOT NULL,
  captured_at timestamptz NOT NULL,
  location_lat double precision,
  location_lng double precision,
  geofence_status geofence_status NOT NULL DEFAULT 'unknown',
  client_event_id uuid,
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX status_event_tenant_client_event_id_uq
  ON status_event (tenant_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

CREATE TABLE time_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  clock_in_event_id uuid REFERENCES status_event(id),
  clock_out_event_id uuid REFERENCES status_event(id),
  clock_in_at timestamptz NOT NULL,
  clock_out_at timestamptz,
  minutes_worked integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mileage_zone (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  code text NOT NULL,
  min_miles numeric(10,2) NOT NULL,
  max_miles numeric(10,2) NOT NULL,
  reimbursement_amount numeric(10,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE mileage_claim (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  miles numeric(10,2) NOT NULL,
  mileage_zone_id uuid NOT NULL REFERENCES mileage_zone(id),
  reimbursement_amount numeric(10,2) NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, shoot_id, user_id)
);

CREATE TABLE media_asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  storage_key text NOT NULL,
  url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alert_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  code text NOT NULL,
  minutes_after integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE alert (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  status alert_status NOT NULL DEFAULT 'open',
  message text NOT NULL,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX alert_open_unique_idx
  ON alert (tenant_id, shoot_id, alert_type)
  WHERE status = 'open';

CREATE TABLE app_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX app_event_tenant_dedupe_key_uq
  ON app_event (tenant_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  platform text NOT NULL,
  device_identifier text NOT NULL,
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, device_identifier)
);

CREATE TABLE push_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  device_id uuid REFERENCES device(id) ON DELETE SET NULL,
  token text NOT NULL,
  platform text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, token)
);

CREATE TABLE notification_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  push_token_id uuid REFERENCES push_token(id) ON DELETE SET NULL,
  app_event_id uuid REFERENCES app_event(id) ON DELETE SET NULL,
  status text NOT NULL,
  response_body jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE external_object_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_id text NOT NULL,
  object_type text NOT NULL,
  object_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, external_id, object_type)
);

ALTER TABLE shoot ENABLE ROW LEVEL SECURITY;
ALTER TABLE shoot_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE mileage_zone ENABLE ROW LEVEL SECURITY;
ALTER TABLE mileage_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE device ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_object_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE shoot FORCE ROW LEVEL SECURITY;
ALTER TABLE shoot_assignment FORCE ROW LEVEL SECURITY;
ALTER TABLE status_event FORCE ROW LEVEL SECURITY;
ALTER TABLE time_entry FORCE ROW LEVEL SECURITY;
ALTER TABLE mileage_zone FORCE ROW LEVEL SECURITY;
ALTER TABLE mileage_claim FORCE ROW LEVEL SECURITY;
ALTER TABLE media_asset FORCE ROW LEVEL SECURITY;
ALTER TABLE alert_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE alert FORCE ROW LEVEL SECURITY;
ALTER TABLE app_event FORCE ROW LEVEL SECURITY;
ALTER TABLE device FORCE ROW LEVEL SECURITY;
ALTER TABLE push_token FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_delivery FORCE ROW LEVEL SECURITY;
ALTER TABLE external_object_map FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_shoot ON shoot
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation_shoot_assignment ON shoot_assignment
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation_status_event ON status_event
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation_time_entry ON time_entry
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation_mileage_zone ON mileage_zone
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation_mileage_claim ON mileage_claim
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation_media_asset ON media_asset
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation_alert_rule ON alert_rule
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation_alert ON alert
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation_app_event ON app_event
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation_device ON device
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation_push_token ON push_token
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation_notification_delivery ON notification_delivery
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation_external_object_map ON external_object_map
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
