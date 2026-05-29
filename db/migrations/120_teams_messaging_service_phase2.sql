BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'teams_communication_reference_type') THEN
    CREATE TYPE teams_communication_reference_type AS ENUM ('chat', 'channel');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'teams_communication_reference_status') THEN
    CREATE TYPE teams_communication_reference_status AS ENUM ('active', 'disabled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'teams_communication_link_object_type') THEN
    CREATE TYPE teams_communication_link_object_type AS ENUM ('job', 'production_item', 'organization', 'location');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'teams_communication_delivery_status') THEN
    CREATE TYPE teams_communication_delivery_status AS ENUM ('queued', 'sending', 'sent', 'failed', 'throttled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'teams_communication_delivery_event_type') THEN
    CREATE TYPE teams_communication_delivery_event_type AS ENUM ('queued', 'sending', 'sent', 'failed', 'throttled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS teams_communication_reference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  reference_type teams_communication_reference_type NOT NULL,
  status teams_communication_reference_status NOT NULL DEFAULT 'active',
  label text NOT NULL,
  description text,
  teams_web_url text NOT NULL,
  team_id text,
  channel_id text,
  chat_id text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  last_verified_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teams_communication_reference_destination_check CHECK (
    (reference_type = 'chat'::teams_communication_reference_type AND chat_id IS NOT NULL AND team_id IS NULL AND channel_id IS NULL)
    OR
    (reference_type = 'channel'::teams_communication_reference_type AND chat_id IS NULL AND team_id IS NOT NULL AND channel_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS teams_communication_reference_chat_uidx
  ON teams_communication_reference (tenant_id, chat_id)
  WHERE chat_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS teams_communication_reference_channel_uidx
  ON teams_communication_reference (tenant_id, team_id, channel_id)
  WHERE team_id IS NOT NULL AND channel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS teams_communication_reference_tenant_status_idx
  ON teams_communication_reference (tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS teams_communication_reference_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  reference_id uuid NOT NULL REFERENCES teams_communication_reference(id) ON DELETE CASCADE,
  object_type teams_communication_link_object_type NOT NULL,
  object_id uuid NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, reference_id, object_type, object_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS teams_communication_reference_link_primary_uidx
  ON teams_communication_reference_link (tenant_id, object_type, object_id)
  WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS teams_communication_reference_link_object_idx
  ON teams_communication_reference_link (tenant_id, object_type, object_id, created_at DESC);

CREATE TABLE IF NOT EXISTS teams_communication_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  reference_id uuid NOT NULL REFERENCES teams_communication_reference(id) ON DELETE RESTRICT,
  reference_link_id uuid REFERENCES teams_communication_reference_link(id) ON DELETE SET NULL,
  object_type teams_communication_link_object_type,
  object_id uuid,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  status teams_communication_delivery_status NOT NULL DEFAULT 'queued',
  message_text text NOT NULL,
  app_deep_link text,
  teams_destination_url text NOT NULL,
  throttle_key text,
  app_event_id uuid REFERENCES app_event(id) ON DELETE SET NULL,
  external_message_id text,
  attempt_count integer NOT NULL DEFAULT 0,
  first_attempted_at timestamptz,
  last_attempted_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  last_error text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teams_communication_delivery_tenant_status_idx
  ON teams_communication_delivery (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS teams_communication_delivery_record_idx
  ON teams_communication_delivery (tenant_id, object_type, object_id, created_at DESC)
  WHERE object_type IS NOT NULL AND object_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS teams_communication_delivery_reference_idx
  ON teams_communication_delivery (tenant_id, reference_id, created_at DESC);

CREATE INDEX IF NOT EXISTS teams_communication_delivery_throttle_idx
  ON teams_communication_delivery (tenant_id, throttle_key, created_at DESC)
  WHERE throttle_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS teams_communication_delivery_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  delivery_id uuid NOT NULL REFERENCES teams_communication_delivery(id) ON DELETE CASCADE,
  event_type teams_communication_delivery_event_type NOT NULL,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  timestamp timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teams_communication_delivery_event_delivery_idx
  ON teams_communication_delivery_event (tenant_id, delivery_id, timestamp DESC);

ALTER TABLE teams_communication_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams_communication_reference FORCE ROW LEVEL SECURITY;

ALTER TABLE teams_communication_reference_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams_communication_reference_link FORCE ROW LEVEL SECURITY;

ALTER TABLE teams_communication_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams_communication_delivery FORCE ROW LEVEL SECURITY;

ALTER TABLE teams_communication_delivery_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams_communication_delivery_event FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'teams_communication_reference'
      AND policyname = 'tenant_isolation_teams_communication_reference'
  ) THEN
    CREATE POLICY tenant_isolation_teams_communication_reference ON teams_communication_reference
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'teams_communication_reference_link'
      AND policyname = 'tenant_isolation_teams_communication_reference_link'
  ) THEN
    CREATE POLICY tenant_isolation_teams_communication_reference_link ON teams_communication_reference_link
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'teams_communication_delivery'
      AND policyname = 'tenant_isolation_teams_communication_delivery'
  ) THEN
    CREATE POLICY tenant_isolation_teams_communication_delivery ON teams_communication_delivery
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'teams_communication_delivery_event'
      AND policyname = 'tenant_isolation_teams_communication_delivery_event'
  ) THEN
    CREATE POLICY tenant_isolation_teams_communication_delivery_event ON teams_communication_delivery_event
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

INSERT INTO permission (code, name, description, resource_type, action_group)
VALUES
  (
    'communication.send',
    'Send Internal Teams Messages',
    'Send app-orchestrated internal Teams chat and channel messages to known existing destinations.',
    'communication',
    'send'
  ),
  (
    'communication.configure',
    'Configure Communication Destinations',
    'Manage known Teams chat and channel destinations linked to operational records.',
    'communication',
    'configure'
  )
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  resource_type = EXCLUDED.resource_type,
  action_group = EXCLUDED.action_group,
  updated_at = now();

WITH seeded(role_code, scope_type, scope_value, permission_codes) AS (
  VALUES
    ('admin', 'global', NULL, ARRAY['communication.send', 'communication.configure']::text[]),
    ('leadership', 'global', NULL, ARRAY['communication.send', 'communication.configure']::text[]),
    ('system_admin', 'global', NULL, ARRAY['communication.send', 'communication.configure']::text[]),
    ('schools', 'department', 'schools', ARRAY['communication.send']::text[]),
    ('sports', 'department', 'sports', ARRAY['communication.send']::text[]),
    ('account_reps', 'global', NULL, ARRAY['communication.send']::text[]),
    ('senior_photographers', 'assigned', NULL, ARRAY['communication.send']::text[]),
    ('graphics_production', 'department', 'production', ARRAY['communication.send']::text[]),
    ('customer_service', 'department', 'customer_service', ARRAY['communication.send']::text[])
)
INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect)
SELECT
  role.id,
  permission.id,
  seeded.scope_type::policy_scope_type,
  seeded.scope_value,
  'allow'::policy_effect_type
FROM seeded
JOIN role
  ON role.code = seeded.role_code
JOIN LATERAL unnest(seeded.permission_codes) AS permission_code(code)
  ON true
JOIN permission
  ON permission.code = permission_code.code
ON CONFLICT DO NOTHING;

COMMIT;
