BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'proactive_communication_route_kind') THEN
    CREATE TYPE proactive_communication_route_kind AS ENUM (
      'direct_teams_message',
      'channel_alert',
      'in_app_notification',
      'open_teams_recommendation'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'proactive_communication_route_status') THEN
    CREATE TYPE proactive_communication_route_status AS ENUM (
      'queued',
      'notified',
      'recommended',
      'throttled',
      'suppressed',
      'failed'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS proactive_communication_decision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  trigger_type text NOT NULL,
  source_module text NOT NULL,
  source_object_type text NOT NULL,
  source_object_id text NOT NULL,
  source_object_label text,
  communication_object_type text NOT NULL,
  communication_object_id text NOT NULL,
  route_kind proactive_communication_route_kind NOT NULL,
  route_status proactive_communication_route_status NOT NULL,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  recipient_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  teams_reference_id uuid REFERENCES teams_communication_reference(id) ON DELETE SET NULL,
  teams_delivery_id uuid REFERENCES teams_communication_delivery(id) ON DELETE SET NULL,
  operational_event_id uuid REFERENCES operational_event(id) ON DELETE SET NULL,
  title text NOT NULL,
  summary text NOT NULL,
  throttle_key text,
  throttle_window_minutes integer NOT NULL DEFAULT 0,
  throttled_by_decision_id uuid REFERENCES proactive_communication_decision(id) ON DELETE SET NULL,
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proactive_communication_decision_status_idx
  ON proactive_communication_decision (tenant_id, route_status, created_at DESC);

CREATE INDEX IF NOT EXISTS proactive_communication_decision_source_idx
  ON proactive_communication_decision (tenant_id, source_object_type, source_object_id, created_at DESC);

CREATE INDEX IF NOT EXISTS proactive_communication_decision_record_idx
  ON proactive_communication_decision (tenant_id, communication_object_type, communication_object_id, created_at DESC);

CREATE INDEX IF NOT EXISTS proactive_communication_decision_trigger_idx
  ON proactive_communication_decision (tenant_id, trigger_type, created_at DESC);

CREATE INDEX IF NOT EXISTS proactive_communication_decision_throttle_idx
  ON proactive_communication_decision (tenant_id, throttle_key, created_at DESC)
  WHERE throttle_key IS NOT NULL;

ALTER TABLE proactive_communication_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE proactive_communication_decision FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'proactive_communication_decision'
      AND policyname = 'tenant_isolation_proactive_communication_decision'
  ) THEN
    CREATE POLICY tenant_isolation_proactive_communication_decision ON proactive_communication_decision
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

COMMIT;
