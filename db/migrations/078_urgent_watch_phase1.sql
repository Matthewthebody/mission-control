DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'urgent_watch_status') THEN
    CREATE TYPE urgent_watch_status AS ENUM (
      'active',
      'snoozed',
      'handled',
      'resolved'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'urgent_watch_severity') THEN
    CREATE TYPE urgent_watch_severity AS ENUM (
      'red',
      'yellow'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS urgent_watch_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  source_module text NOT NULL,
  source_entity_type text NOT NULL,
  source_entity_id text NOT NULL,
  source_entity_label text,
  scope_department text,
  watch_type text NOT NULL,
  status urgent_watch_status NOT NULL DEFAULT 'active',
  severity urgent_watch_severity NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  due_at timestamptz,
  next_action_label text NOT NULL,
  action_hash text NOT NULL,
  operational_impact_score integer NOT NULL DEFAULT 0,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_fingerprint text NOT NULL,
  snoozed_until timestamptz,
  snooze_reason text,
  handled_at timestamptz,
  handled_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  handled_reason text,
  resolved_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_module, source_entity_type, source_entity_id, watch_type)
);

CREATE TABLE IF NOT EXISTS urgent_watch_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  urgent_watch_item_id uuid NOT NULL REFERENCES urgent_watch_item(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  summary text NOT NULL,
  note text,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS urgent_watch_item_status_idx
  ON urgent_watch_item (tenant_id, status, severity, due_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS urgent_watch_item_scope_idx
  ON urgent_watch_item (tenant_id, scope_department, status, due_at);

CREATE INDEX IF NOT EXISTS urgent_watch_item_owner_idx
  ON urgent_watch_item (tenant_id, owner_user_id, status, due_at);

CREATE INDEX IF NOT EXISTS urgent_watch_item_source_idx
  ON urgent_watch_item (tenant_id, source_module, source_entity_type, source_entity_id);

CREATE INDEX IF NOT EXISTS urgent_watch_event_item_idx
  ON urgent_watch_event (tenant_id, urgent_watch_item_id, created_at DESC);

ALTER TABLE urgent_watch_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE urgent_watch_event ENABLE ROW LEVEL SECURITY;

ALTER TABLE urgent_watch_item FORCE ROW LEVEL SECURITY;
ALTER TABLE urgent_watch_event FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'urgent_watch_item'
      AND policyname = 'tenant_isolation_urgent_watch_item'
  ) THEN
    CREATE POLICY tenant_isolation_urgent_watch_item ON urgent_watch_item
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'urgent_watch_event'
      AND policyname = 'tenant_isolation_urgent_watch_event'
  ) THEN
    CREATE POLICY tenant_isolation_urgent_watch_event ON urgent_watch_event
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
