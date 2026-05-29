BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_dashboard_entity_type') THEN
    CREATE TYPE microsoft_dashboard_entity_type AS ENUM (
      'organization',
      'job',
      'job_readiness_item',
      'post_shoot_evaluation',
      'work_task',
      'communication_event'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_workspace_object_type') THEN
    CREATE TYPE microsoft_workspace_object_type AS ENUM (
      'team',
      'channel',
      'sharepoint_site',
      'sharepoint_library',
      'sharepoint_folder',
      'microsoft_list',
      'microsoft_list_item',
      'planner_plan',
      'planner_bucket',
      'planner_task',
      'shared_mailbox'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'microsoft_workspace_link_status') THEN
    CREATE TYPE microsoft_workspace_link_status AS ENUM (
      'pending',
      'linked',
      'failed',
      'drifted',
      'archived'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS microsoft_workspace_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'microsoft365_workspace',
  dashboard_entity_type microsoft_dashboard_entity_type NOT NULL,
  dashboard_entity_id text NOT NULL,
  canonical_dashboard_id text NOT NULL,
  microsoft_object_type microsoft_workspace_object_type NOT NULL,
  microsoft_object_id text NOT NULL,
  microsoft_object_label text,
  microsoft_parent_object_id text,
  microsoft_url text,
  dashboard_url text,
  mirror_scope text NOT NULL DEFAULT 'dashboard_read_only_mirror',
  sync_status microsoft_workspace_link_status NOT NULL DEFAULT 'pending',
  last_sync_operation_id uuid REFERENCES integration_sync_operation(id) ON DELETE SET NULL,
  last_sync_error text,
  last_synced_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS microsoft_workspace_link_dashboard_object_uidx
  ON microsoft_workspace_link (tenant_id, canonical_dashboard_id, microsoft_object_type);

CREATE UNIQUE INDEX IF NOT EXISTS microsoft_workspace_link_external_object_uidx
  ON microsoft_workspace_link (tenant_id, provider, microsoft_object_type, microsoft_object_id);

CREATE INDEX IF NOT EXISTS microsoft_workspace_link_dashboard_lookup_idx
  ON microsoft_workspace_link (tenant_id, dashboard_entity_type, dashboard_entity_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_workspace_link_status_idx
  ON microsoft_workspace_link (tenant_id, sync_status, updated_at DESC);

ALTER TABLE microsoft_workspace_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE microsoft_workspace_link FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'microsoft_workspace_link'
      AND policyname = 'tenant_isolation_microsoft_workspace_link'
  ) THEN
    CREATE POLICY tenant_isolation_microsoft_workspace_link ON microsoft_workspace_link
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;

COMMIT;
