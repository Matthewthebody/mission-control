-- SSA-5 Record Threads V1 (design: docs/session-reports/2026-07-08-school-season-autopilot-sprint1.md §5).
-- One conversation thread per record (Job, Organization) carrying user messages
-- and system events (e.g. meeting_created when a Teams meeting is launched from
-- the record). Mirrors the operational_note polymorphic pattern (object-type
-- enum + uuid, no cross-table FK); mentions/attachments are stored references
-- like operational_note.mention_metadata/attachment_refs. No Graph message
-- sync in V1 — Teams involvement is limited to the meeting-link system event.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'record_thread_object_type') THEN
    CREATE TYPE record_thread_object_type AS ENUM ('job', 'organization');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'record_thread_message_kind') THEN
    CREATE TYPE record_thread_message_kind AS ENUM ('user_message', 'system_event');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS record_thread (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  entity_type record_thread_object_type NOT NULL,
  entity_id uuid NOT NULL,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS record_thread_message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES record_thread(id) ON DELETE CASCADE,
  message_kind record_thread_message_kind NOT NULL,
  body text,
  event_type text,
  author_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  mention_user_ids uuid[] NOT NULL DEFAULT '{}',
  attachment_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A user message must say something; a system event must say what happened.
  CONSTRAINT record_thread_message_body_check CHECK (
    (message_kind = 'user_message' AND body IS NOT NULL AND length(btrim(body)) > 0)
    OR (message_kind = 'system_event' AND event_type IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS record_thread_tenant_entity_idx
  ON record_thread (tenant_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS record_thread_message_tenant_thread_idx
  ON record_thread_message (tenant_id, thread_id, created_at DESC);

DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'record_thread',
    'record_thread_message'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    policy_name := 'tenant_isolation_' || table_name;
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      policy_name,
      table_name
    );
  END LOOP;
END $$;

COMMIT;
