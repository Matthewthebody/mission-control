DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_setting_category') THEN
    CREATE TYPE admin_setting_category AS ENUM (
      'attendance_time_rules',
      'schedule_staffing_rules',
      'readiness_workflow_rules',
      'production_qa_rules',
      'relationship_directory_rules',
      'notification_summary_rules',
      'reporting_packet_rules',
      'branding_foundation',
      'integration_sync_rules',
      'roles_access_rules'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_setting_scope_type') THEN
    CREATE TYPE admin_setting_scope_type AS ENUM (
      'global',
      'department',
      'workflow_type',
      'shoot_type',
      'job_type',
      'account',
      'location',
      'role'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_setting_status') THEN
    CREATE TYPE admin_setting_status AS ENUM (
      'approved',
      'pending_approval',
      'rejected',
      'superseded',
      'archived'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS admin_setting_value (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  setting_key text NOT NULL,
  setting_category admin_setting_category NOT NULL,
  scope_type admin_setting_scope_type NOT NULL DEFAULT 'global',
  scope_id text,
  scope_label text,
  value jsonb NOT NULL DEFAULT 'null'::jsonb,
  value_type text NOT NULL,
  status admin_setting_status NOT NULL DEFAULT 'approved',
  requires_approval boolean NOT NULL DEFAULT false,
  is_override boolean NOT NULL DEFAULT false,
  effective_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  requested_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approved_at timestamptz,
  reason text NOT NULL,
  impact_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_setting_scope_chk CHECK (
    (scope_type = 'global' AND scope_id IS NULL)
    OR (scope_type <> 'global' AND scope_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS admin_setting_value_lookup_idx
  ON admin_setting_value (tenant_id, setting_key, scope_type, scope_id, status, effective_at DESC);

CREATE INDEX IF NOT EXISTS admin_setting_value_category_idx
  ON admin_setting_value (tenant_id, setting_category, status, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_setting_value_pending_idx
  ON admin_setting_value (tenant_id, status, requires_approval, created_at DESC)
  WHERE status = 'pending_approval';

ALTER TABLE admin_setting_value ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_setting_value FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_admin_setting_value ON admin_setting_value
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
