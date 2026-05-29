BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'teams_meeting_link_object_type') THEN
    CREATE TYPE teams_meeting_link_object_type AS ENUM ('job', 'production_item', 'organization', 'location');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'teams_meeting_mode') THEN
    CREATE TYPE teams_meeting_mode AS ENUM ('calendar_event', 'standalone_online_meeting');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'teams_meeting_status') THEN
    CREATE TYPE teams_meeting_status AS ENUM (
      'pending_create',
      'scheduled',
      'pending_update',
      'pending_cancel',
      'cancelled',
      'sync_error'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'teams_meeting_sync_operation_type') THEN
    CREATE TYPE teams_meeting_sync_operation_type AS ENUM ('create', 'update', 'cancel');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'teams_meeting_sync_operation_status') THEN
    CREATE TYPE teams_meeting_sync_operation_status AS ENUM ('queued', 'processing', 'succeeded', 'failed', 'throttled', 'skipped');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS teams_meeting_reference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  linked_record_type teams_meeting_link_object_type NOT NULL,
  linked_record_id uuid NOT NULL,
  meeting_provider text NOT NULL DEFAULT 'microsoft_teams',
  meeting_mode teams_meeting_mode NOT NULL DEFAULT 'calendar_event',
  meeting_status teams_meeting_status NOT NULL DEFAULT 'pending_create',
  title text NOT NULL,
  description text,
  meeting_join_url text,
  meeting_web_url text,
  external_meeting_id text,
  external_calendar_event_id text,
  organizer_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  organizer_email text,
  organizer_microsoft_user_id text,
  participant_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  app_deep_link text,
  scheduled_start_at timestamptz NOT NULL,
  scheduled_end_at timestamptz NOT NULL,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  last_sync_attempt_at timestamptz,
  last_synced_at timestamptz,
  sync_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teams_meeting_schedule_check CHECK (scheduled_end_at > scheduled_start_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS teams_meeting_reference_active_record_uidx
  ON teams_meeting_reference (tenant_id, linked_record_type, linked_record_id)
  WHERE cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS teams_meeting_reference_tenant_status_idx
  ON teams_meeting_reference (tenant_id, meeting_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS teams_meeting_reference_record_idx
  ON teams_meeting_reference (tenant_id, linked_record_type, linked_record_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS teams_meeting_sync_operation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES teams_meeting_reference(id) ON DELETE CASCADE,
  operation_type teams_meeting_sync_operation_type NOT NULL,
  trigger_source text NOT NULL,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  status teams_meeting_sync_operation_status NOT NULL DEFAULT 'queued',
  throttle_key text,
  app_event_id uuid REFERENCES app_event(id) ON DELETE SET NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  first_attempted_at timestamptz,
  last_attempted_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  last_error text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teams_meeting_sync_operation_meeting_idx
  ON teams_meeting_sync_operation (tenant_id, meeting_id, created_at DESC);

CREATE INDEX IF NOT EXISTS teams_meeting_sync_operation_status_idx
  ON teams_meeting_sync_operation (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS teams_meeting_sync_operation_throttle_idx
  ON teams_meeting_sync_operation (tenant_id, throttle_key, created_at DESC)
  WHERE throttle_key IS NOT NULL;

ALTER TABLE teams_meeting_reference
  ADD COLUMN IF NOT EXISTS last_sync_operation_id uuid REFERENCES teams_meeting_sync_operation(id) ON DELETE SET NULL;

ALTER TABLE teams_meeting_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams_meeting_reference FORCE ROW LEVEL SECURITY;

ALTER TABLE teams_meeting_sync_operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams_meeting_sync_operation FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'teams_meeting_reference'
      AND policyname = 'tenant_isolation_teams_meeting_reference'
  ) THEN
    CREATE POLICY tenant_isolation_teams_meeting_reference ON teams_meeting_reference
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
      AND tablename = 'teams_meeting_sync_operation'
      AND policyname = 'tenant_isolation_teams_meeting_sync_operation'
  ) THEN
    CREATE POLICY tenant_isolation_teams_meeting_sync_operation ON teams_meeting_sync_operation
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

INSERT INTO permission (code, name, description, resource_type, action_group)
VALUES (
  'communication.meeting.manage',
  'Manage Internal Teams Meetings',
  'Create, update, cancel, and resync app-orchestrated internal Teams meetings linked to operational records.',
  'communication',
  'manage'
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
    ('admin', 'global', NULL, ARRAY['communication.meeting.manage']::text[]),
    ('leadership', 'global', NULL, ARRAY['communication.meeting.manage']::text[]),
    ('system_admin', 'global', NULL, ARRAY['communication.meeting.manage']::text[]),
    ('schools', 'department', 'schools', ARRAY['communication.meeting.manage']::text[]),
    ('sports', 'department', 'sports', ARRAY['communication.meeting.manage']::text[]),
    ('account_reps', 'global', NULL, ARRAY['communication.meeting.manage']::text[]),
    ('graphics_production', 'department', 'production', ARRAY['communication.meeting.manage']::text[])
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
