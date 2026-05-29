ALTER TABLE activity_log_entries
  ADD COLUMN IF NOT EXISTS resource_type text,
  ADD COLUMN IF NOT EXISTS resource_id text,
  ADD COLUMN IF NOT EXISTS parent_resource_type text,
  ADD COLUMN IF NOT EXISTS parent_resource_id text,
  ADD COLUMN IF NOT EXISTS department_type job_department_type,
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS old_values_json jsonb,
  ADD COLUMN IF NOT EXISTS new_values_json jsonb,
  ADD COLUMN IF NOT EXISTS metadata_json jsonb,
  ADD COLUMN IF NOT EXISTS visibility_level text NOT NULL DEFAULT 'standard_internal';

UPDATE activity_log_entries activity
SET resource_type = COALESCE(
      activity.resource_type,
      CASE
        WHEN activity.production_item_id IS NOT NULL THEN 'production_item'
        WHEN activity.watch_flag_id IS NOT NULL THEN 'job_watch_flag'
        WHEN activity.job_day_id IS NOT NULL THEN 'job_day'
        WHEN activity.job_id IS NOT NULL THEN 'job'
        ELSE 'record'
      END
    ),
    resource_id = COALESCE(
      activity.resource_id,
      COALESCE(
        activity.production_item_id::text,
        activity.watch_flag_id::text,
        activity.job_day_id::text,
        activity.job_id::text
      )
    ),
    parent_resource_type = COALESCE(
      activity.parent_resource_type,
      CASE
        WHEN activity.job_id IS NOT NULL
         AND (
           activity.production_item_id IS NOT NULL
           OR activity.watch_flag_id IS NOT NULL
           OR activity.job_day_id IS NOT NULL
         )
        THEN 'job'
        ELSE NULL
      END
    ),
    parent_resource_id = COALESCE(
      activity.parent_resource_id,
      CASE
        WHEN activity.job_id IS NOT NULL
         AND (
           activity.production_item_id IS NOT NULL
           OR activity.watch_flag_id IS NOT NULL
           OR activity.job_day_id IS NOT NULL
         )
        THEN activity.job_id::text
        ELSE NULL
      END
    ),
    department_type = COALESCE(
      activity.department_type,
      job.department_type
    ),
    message = COALESCE(activity.message, activity.summary),
    metadata_json = COALESCE(activity.metadata_json, activity.metadata)
FROM jobs job
WHERE job.id = activity.job_id
  AND job.tenant_id = activity.tenant_id;

UPDATE activity_log_entries
SET resource_type = COALESCE(
      resource_type,
      CASE
        WHEN production_item_id IS NOT NULL THEN 'production_item'
        WHEN watch_flag_id IS NOT NULL THEN 'job_watch_flag'
        WHEN job_day_id IS NOT NULL THEN 'job_day'
        WHEN job_id IS NOT NULL THEN 'job'
        ELSE 'record'
      END
    ),
    resource_id = COALESCE(
      resource_id,
      COALESCE(
        production_item_id::text,
        watch_flag_id::text,
        job_day_id::text,
        job_id::text
      )
    ),
    message = COALESCE(message, summary),
    metadata_json = COALESCE(metadata_json, metadata)
WHERE resource_type IS NULL
   OR resource_id IS NULL
   OR message IS NULL
   OR metadata_json IS NULL;

CREATE INDEX IF NOT EXISTS activity_log_entries_tenant_resource_idx
  ON activity_log_entries (tenant_id, resource_type, resource_id, created_at DESC);

CREATE INDEX IF NOT EXISTS activity_log_entries_tenant_parent_idx
  ON activity_log_entries (tenant_id, parent_resource_type, parent_resource_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'diagnostic_severity_type') THEN
    CREATE TYPE diagnostic_severity_type AS ENUM ('info', 'low', 'medium', 'high', 'critical');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'diagnostic_finding_status_type') THEN
    CREATE TYPE diagnostic_finding_status_type AS ENUM ('open', 'acknowledged', 'in_review', 'resolved', 'dismissed');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'repair_action_status_type') THEN
    CREATE TYPE repair_action_status_type AS ENUM (
      'queued',
      'awaiting_approval',
      'dry_run_complete',
      'executing',
      'completed',
      'failed',
      'rolled_back',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_health_status_type') THEN
    CREATE TYPE sync_health_status_type AS ENUM ('healthy', 'warning', 'error', 'disabled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'system_health_status_type') THEN
    CREATE TYPE system_health_status_type AS ENUM ('healthy', 'watch', 'at_risk', 'critical');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  event_category text NOT NULL,
  event_type text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  target_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  department_type job_department_type,
  request_id text,
  trace_id text,
  old_values_json jsonb,
  new_values_json jsonb,
  context_json jsonb,
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_tenant_created_idx
  ON audit_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_tenant_resource_idx
  ON audit_events (tenant_id, resource_type, resource_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_tenant_request_idx
  ON audit_events (tenant_id, request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS diagnostic_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  finding_type text NOT NULL,
  severity diagnostic_severity_type NOT NULL,
  status diagnostic_finding_status_type NOT NULL DEFAULT 'open',
  resource_type text,
  resource_id text,
  related_resource_type text,
  related_resource_id text,
  department_type job_department_type,
  title text NOT NULL,
  description text NOT NULL,
  rule_key text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  recommended_action text,
  repairable boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS diagnostic_findings_tenant_status_idx
  ON diagnostic_findings (tenant_id, status, severity, detected_at DESC);

CREATE INDEX IF NOT EXISTS diagnostic_findings_tenant_rule_idx
  ON diagnostic_findings (tenant_id, rule_key, resource_type, resource_id, detected_at DESC);

CREATE TABLE IF NOT EXISTS diagnostic_rule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  scope_type text NOT NULL,
  scope_value text,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  result_summary_json jsonb,
  trigger_type text NOT NULL,
  triggered_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS diagnostic_rule_runs_tenant_started_idx
  ON diagnostic_rule_runs (tenant_id, started_at DESC);

CREATE TABLE IF NOT EXISTS repair_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  action_key text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  requested_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE SET NULL,
  approved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  executed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  status repair_action_status_type NOT NULL DEFAULT 'queued',
  dry_run boolean NOT NULL DEFAULT true,
  input_json jsonb,
  before_snapshot_json jsonb,
  after_snapshot_json jsonb,
  result_summary_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  rolled_back_at timestamptz
);

CREATE INDEX IF NOT EXISTS repair_actions_tenant_status_idx
  ON repair_actions (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS repair_actions_tenant_resource_idx
  ON repair_actions (tenant_id, resource_type, resource_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sync_health_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  sync_key text NOT NULL,
  resource_type text,
  resource_id text,
  status sync_health_status_type NOT NULL DEFAULT 'healthy',
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  last_error_message text,
  metadata_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_health_records_tenant_status_idx
  ON sync_health_records (tenant_id, status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS sync_health_records_scope_unique_idx
  ON sync_health_records (tenant_id, sync_key, COALESCE(resource_type, ''), COALESCE(resource_id, ''));

CREATE TABLE IF NOT EXISTS policy_decision_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  resource_type text,
  resource_id text,
  scope_context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision text NOT NULL,
  decision_reason text NOT NULL,
  matched_rules_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS policy_decision_traces_tenant_actor_idx
  ON policy_decision_traces (tenant_id, actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS policy_decision_traces_tenant_resource_idx
  ON policy_decision_traces (tenant_id, resource_type, resource_id, created_at DESC);

CREATE TABLE IF NOT EXISTS system_health_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  check_key text NOT NULL,
  scope_type text NOT NULL,
  scope_value text,
  status system_health_status_type NOT NULL,
  summary text NOT NULL,
  details_json jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_health_checks_tenant_checked_idx
  ON system_health_checks (tenant_id, checked_at DESC, check_key);

CREATE TABLE IF NOT EXISTS import_audit_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  import_type text NOT NULL,
  started_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE SET NULL,
  status text NOT NULL,
  source_reference text,
  row_count_total integer,
  row_count_created integer,
  row_count_updated integer,
  row_count_rejected integer,
  errors_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS import_audit_records_tenant_created_idx
  ON import_audit_records (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS export_audit_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  export_type text NOT NULL,
  requested_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE SET NULL,
  status text NOT NULL,
  scope_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer,
  column_keys_json jsonb,
  file_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS export_audit_records_tenant_created_idx
  ON export_audit_records (tenant_id, created_at DESC);

DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'audit_events',
    'diagnostic_findings',
    'diagnostic_rule_runs',
    'repair_actions',
    'sync_health_records',
    'policy_decision_traces',
    'system_health_checks',
    'import_audit_records',
    'export_audit_records'
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

INSERT INTO permission (code, name, description, resource_type, action_group, created_at, updated_at)
VALUES
  ('system.diagnostics.read', 'Read system diagnostics', 'Read admin system diagnostics findings and health summaries.', 'admin_system', 'diagnostics', now(), now()),
  ('system.audit.read', 'Read audit traces', 'Read audit timelines, diffs, and global mutation history.', 'admin_system', 'audit', now(), now()),
  ('system.sync.read', 'Read sync health', 'Read sync health and system health board data.', 'admin_system', 'sync', now(), now()),
  ('system.repairs.manage', 'Manage repair actions', 'Dry-run and execute controlled system repair actions.', 'admin_system', 'repairs', now(), now()),
  ('system.trace.read', 'Read entity traces', 'Open admin trace views for entities and linked records.', 'admin_system', 'trace', now(), now()),
  ('system.policy_trace.read', 'Read policy traces', 'Preview and inspect policy decision traces.', 'admin_system', 'policy_trace', now(), now()),
  ('system.import_audit.read', 'Read import audits', 'Read import audit records and failures.', 'admin_system', 'imports', now(), now()),
  ('system.export_audit.read', 'Read export audits', 'Read export audit records and permission filter summaries.', 'admin_system', 'exports', now(), now())
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  resource_type = EXCLUDED.resource_type,
  action_group = EXCLUDED.action_group,
  updated_at = now();

INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect, created_at, updated_at)
SELECT
  role.id,
  permission.id,
  'global'::policy_scope_type,
  NULL,
  'allow'::policy_effect_type,
  now(),
  now()
FROM role
JOIN permission ON permission.code IN (
  'system.diagnostics.read',
  'system.audit.read',
  'system.sync.read',
  'system.repairs.manage',
  'system.trace.read',
  'system.policy_trace.read',
  'system.import_audit.read',
  'system.export_audit.read'
)
WHERE role.code = 'admin'
  AND NOT EXISTS (
    SELECT 1
    FROM role_permission_grant existing
    WHERE existing.role_id = role.id
      AND existing.permission_id = permission.id
      AND existing.scope_type = 'global'::policy_scope_type
      AND existing.scope_value IS NULL
      AND existing.effect = 'allow'::policy_effect_type
  );
