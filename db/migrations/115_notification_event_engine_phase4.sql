DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'operational_event_delivery_status'
  ) THEN
    CREATE TYPE operational_event_delivery_status AS ENUM (
      'queued',
      'dispatched',
      'throttled',
      'suppressed'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS operational_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  source_module text NOT NULL,
  source_object_type text NOT NULL,
  source_object_id text NOT NULL,
  source_object_label text,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  category notification_category NOT NULL DEFAULT 'informational_summary',
  severity notification_severity NOT NULL DEFAULT 'medium',
  title text NOT NULL,
  summary text NOT NULL,
  deep_link text,
  action_required boolean NOT NULL DEFAULT false,
  digest_eligible boolean NOT NULL DEFAULT false,
  throttle_window_minutes integer NOT NULL DEFAULT 60,
  recipient_user_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  delivery_channels jsonb NOT NULL DEFAULT '["in_app"]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (throttle_window_minutes >= 0)
);

CREATE TABLE IF NOT EXISTS operational_event_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  operational_event_id uuid NOT NULL REFERENCES operational_event(id) ON DELETE CASCADE,
  recipient_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  notification_group_key text NOT NULL,
  delivery_channels jsonb NOT NULL DEFAULT '["in_app"]'::jsonb,
  dispatch_status operational_event_delivery_status NOT NULL DEFAULT 'queued',
  notification_app_event_id uuid REFERENCES app_event(id) ON DELETE SET NULL,
  notification_id uuid REFERENCES ops_notification(id) ON DELETE SET NULL,
  throttled_by_delivery_id uuid REFERENCES operational_event_delivery(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operational_event_tenant_type_occurred_idx
  ON operational_event (tenant_id, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS operational_event_tenant_source_idx
  ON operational_event (tenant_id, source_object_type, source_object_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS operational_event_tenant_actor_idx
  ON operational_event (tenant_id, actor_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS operational_event_tenant_dedupe_idx
  ON operational_event (tenant_id, dedupe_key, occurred_at DESC)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS operational_event_delivery_tenant_event_idx
  ON operational_event_delivery (tenant_id, operational_event_id, created_at ASC);

CREATE INDEX IF NOT EXISTS operational_event_delivery_tenant_recipient_status_idx
  ON operational_event_delivery (tenant_id, recipient_user_id, dispatch_status, created_at DESC);

CREATE INDEX IF NOT EXISTS operational_event_delivery_tenant_recipient_group_idx
  ON operational_event_delivery (tenant_id, recipient_user_id, notification_group_key, created_at DESC);

ALTER TABLE operational_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_event_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_event FORCE ROW LEVEL SECURITY;
ALTER TABLE operational_event_delivery FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_operational_event ON operational_event;
CREATE POLICY tenant_isolation_operational_event ON operational_event
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_operational_event_delivery ON operational_event_delivery;
CREATE POLICY tenant_isolation_operational_event_delivery ON operational_event_delivery
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
