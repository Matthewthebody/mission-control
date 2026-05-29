ALTER TYPE job_watch_flag_status_type ADD VALUE IF NOT EXISTS 'snoozed';
ALTER TYPE job_watch_flag_severity_type ADD VALUE IF NOT EXISTS 'info';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_delivery_channel_type') THEN
    CREATE TYPE alert_delivery_channel_type AS ENUM ('in_app', 'push', 'email', 'sms');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_delivery_status_type') THEN
    CREATE TYPE alert_delivery_status_type AS ENUM ('queued', 'delivered', 'failed', 'read', 'acted_on');
  END IF;
END $$;

ALTER TABLE job_watch_flags
  ADD COLUMN IF NOT EXISTS approval_request_id uuid REFERENCES approval_requests(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS qa_review_record_id uuid REFERENCES qa_review_records(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS deliverable_item_id uuid REFERENCES deliverable_items(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source_entity_type text,
  ADD COLUMN IF NOT EXISTS source_entity_id uuid,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS snooze_until timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_to_role text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE job_watch_flags
SET source_entity_type = COALESCE(
      source_entity_type,
      CASE
        WHEN deliverable_item_id IS NOT NULL THEN 'deliverable_item'
        WHEN qa_review_record_id IS NOT NULL THEN 'qa_review_record'
        WHEN approval_request_id IS NOT NULL THEN 'approval_request'
        WHEN production_item_id IS NOT NULL THEN 'production_item'
        WHEN job_day_id IS NOT NULL THEN 'job_day'
        ELSE 'job'
      END
    ),
    source_entity_id = COALESCE(
      source_entity_id,
      deliverable_item_id,
      qa_review_record_id,
      approval_request_id,
      production_item_id,
      job_day_id,
      job_id
    ),
    updated_at = COALESCE(updated_at, resolved_at, created_at)
WHERE source_entity_type IS NULL
   OR source_entity_id IS NULL
   OR updated_at IS NULL;

CREATE INDEX IF NOT EXISTS job_watch_flags_tenant_owner_idx
  ON job_watch_flags (tenant_id, owner_user_id, status, severity, due_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS job_watch_flags_tenant_source_idx
  ON job_watch_flags (tenant_id, source_entity_type, source_entity_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  watch_flag_id uuid REFERENCES job_watch_flags(id) ON DELETE SET NULL,
  source_entity_type text NOT NULL,
  source_entity_id uuid,
  alert_type text NOT NULL,
  severity job_watch_flag_severity_type NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  triggered_at timestamptz NOT NULL DEFAULT now(),
  dedupe_key text NOT NULL,
  payload_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_events_tenant_triggered_idx
  ON alert_events (tenant_id, triggered_at DESC, severity, status);

CREATE INDEX IF NOT EXISTS alert_events_tenant_dedupe_idx
  ON alert_events (tenant_id, dedupe_key, triggered_at DESC);

CREATE TABLE IF NOT EXISTS alert_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  alert_event_id uuid NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  delivery_channel alert_delivery_channel_type NOT NULL DEFAULT 'in_app',
  delivery_status alert_delivery_status_type NOT NULL DEFAULT 'queued',
  delivered_at timestamptz,
  read_at timestamptz,
  acted_at timestamptz,
  action_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_deliveries_tenant_recipient_idx
  ON alert_deliveries (tenant_id, recipient_user_id, delivery_status, created_at DESC);

CREATE INDEX IF NOT EXISTS alert_deliveries_tenant_event_idx
  ON alert_deliveries (tenant_id, alert_event_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dashboard_widget_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  dashboard_scope text NOT NULL,
  widget_key text NOT NULL,
  position_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  settings_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, dashboard_scope, widget_key)
);

CREATE INDEX IF NOT EXISTS dashboard_widget_preferences_tenant_user_idx
  ON dashboard_widget_preferences (tenant_id, user_id, dashboard_scope, position_index);

CREATE TABLE IF NOT EXISTS watchlist_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES app_user(id) ON DELETE CASCADE,
  scope_type text NOT NULL,
  department_type job_department_type,
  name text NOT NULL,
  filters_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  is_shared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS watchlist_saved_views_tenant_scope_idx
  ON watchlist_saved_views (tenant_id, scope_type, department_type, is_shared, is_default, updated_at DESC);

CREATE TABLE IF NOT EXISTS escalation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  department_type job_department_type,
  flag_type text NOT NULL,
  severity job_watch_flag_severity_type NOT NULL,
  threshold_minutes integer,
  threshold_hours integer,
  threshold_days integer,
  escalate_to_role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rule_key)
);

CREATE INDEX IF NOT EXISTS escalation_rules_tenant_scope_idx
  ON escalation_rules (tenant_id, department_type, flag_type, severity, is_active);

INSERT INTO watchlist_saved_views (
  tenant_id,
  owner_user_id,
  scope_type,
  department_type,
  name,
  filters_json,
  is_default,
  is_shared
)
SELECT
  tenant.id,
  NULL,
  preset.scope_type,
  preset.department_type::job_department_type,
  preset.name,
  preset.filters_json::jsonb,
  preset.is_default,
  true
FROM tenant
CROSS JOIN (
  VALUES
    ('global', NULL, 'Next 24 Hours', '{"window":"next-24-hours","status":"active"}', true),
    ('global', NULL, 'Missing Staffing', '{"flag_type":"staffing_gap","status":"active"}', false),
    ('global', NULL, 'Missing Ready Confirmation', '{"flag_type":"ready_confirmation_missing","status":"active"}', false),
    ('global', NULL, 'Blocked Production', '{"flag_type":"production_blocked","status":"active"}', false),
    ('global', NULL, 'Overdue Approvals', '{"flag_type":"approval_delay","status":"active"}', false),
    ('global', NULL, 'Delivery Risks', '{"flag_type":"delivery_issue","status":"active"}', false),
    ('global', NULL, 'Critical Only', '{"severity":"critical","status":"active"}', false),
    ('global', NULL, 'Snoozed', '{"status":"snoozed"}', false),
    ('global', NULL, 'Recently Escalated', '{"only_escalated":"yes","status":"active"}', false),
    ('department', 'schools', 'Schools Next 24 Hours', '{"window":"next-24-hours","status":"active"}', true),
    ('department', 'sports', 'Sports Next 24 Hours', '{"window":"next-24-hours","status":"active"}', true)
) AS preset(scope_type, department_type, name, filters_json, is_default)
WHERE NOT EXISTS (
  SELECT 1
  FROM watchlist_saved_views existing
  WHERE existing.tenant_id = tenant.id
    AND existing.owner_user_id IS NULL
    AND existing.scope_type = preset.scope_type
    AND existing.department_type IS NOT DISTINCT FROM preset.department_type::job_department_type
    AND existing.name = preset.name
);

INSERT INTO escalation_rules (
  tenant_id,
  rule_key,
  department_type,
  flag_type,
  severity,
  threshold_hours,
  escalate_to_role,
  is_active
)
SELECT
  tenant.id,
  preset.rule_key,
  preset.department_type::job_department_type,
  preset.flag_type,
  preset.severity::job_watch_flag_severity_type,
  preset.threshold_hours,
  preset.escalate_to_role,
  true
FROM tenant
CROSS JOIN (
  VALUES
    ('critical_default_2h', NULL, 'production_blocked', 'critical', 2, 'leadership'),
    ('high_default_6h', NULL, 'approval_delay', 'high', 6, 'department_manager'),
    ('today_ready_1h', NULL, 'ready_confirmation_missing', 'high', 1, 'department_manager'),
    ('staffing_gap_4h', NULL, 'staffing_gap', 'high', 4, 'department_manager'),
    ('sports_specialty_6h', 'sports', 'production_issue', 'high', 6, 'production_manager'),
    ('schools_data_6h', 'schools', 'missing_linked_record', 'high', 6, 'department_manager')
) AS preset(rule_key, department_type, flag_type, severity, threshold_hours, escalate_to_role)
WHERE NOT EXISTS (
  SELECT 1
  FROM escalation_rules existing
  WHERE existing.tenant_id = tenant.id
    AND existing.rule_key = preset.rule_key
);

DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'alert_events',
    'alert_deliveries',
    'dashboard_widget_preferences',
    'watchlist_saved_views',
    'escalation_rules'
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
