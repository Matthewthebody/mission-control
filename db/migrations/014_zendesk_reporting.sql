CREATE TYPE zendesk_provider_mode AS ENUM ('mock', 'zendesk_live');
CREATE TYPE zendesk_connection_status AS ENUM ('connected', 'disconnected', 'attention');
CREATE TYPE zendesk_health_state AS ENUM ('mock', 'disabled', 'connected_pending_sync', 'connected_healthy', 'connected_warning', 'connected_error');
CREATE TYPE zendesk_sync_status AS ENUM ('success', 'warning', 'error');
CREATE TYPE zendesk_ticket_category AS ENUM ('schools', 'sports', 'other');

CREATE TABLE zendesk_connection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenant(id) ON DELETE CASCADE,
  provider_mode zendesk_provider_mode NOT NULL DEFAULT 'mock',
  connection_status zendesk_connection_status NOT NULL DEFAULT 'disconnected',
  health_state zendesk_health_state NOT NULL DEFAULT 'disabled',
  connected_account_email text,
  sync_cursor text,
  records_synced integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  last_sync_at timestamptz,
  last_successful_sync_at timestamptz,
  last_failed_sync_at timestamptz,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE zendesk_sync_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  provider_mode zendesk_provider_mode NOT NULL DEFAULT 'mock',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status zendesk_sync_status NOT NULL DEFAULT 'success',
  records_synced integer NOT NULL DEFAULT 0,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE zendesk_category_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  category zendesk_ticket_category NOT NULL,
  rule_type text NOT NULL,
  field_key text,
  match_value text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zendesk_category_rule_type_chk CHECK (rule_type IN ('tag', 'group', 'form', 'organization', 'custom_field', 'keyword'))
);

CREATE TABLE zendesk_ticket_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  zendesk_ticket_id text NOT NULL,
  subject text NOT NULL,
  requester_name text,
  requester_email text,
  assignee_name text,
  assignee_id text,
  organization_name text,
  group_name text,
  form_name text,
  status text NOT NULL,
  priority text,
  category zendesk_ticket_category NOT NULL DEFAULT 'other',
  ticket_created_at timestamptz NOT NULL,
  ticket_updated_at timestamptz NOT NULL,
  ticket_solved_at timestamptz,
  first_reply_minutes integer,
  resolution_minutes integer,
  is_unassigned boolean NOT NULL DEFAULT false,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  external_url text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_deleted boolean NOT NULL DEFAULT false,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, zendesk_ticket_id)
);

CREATE TABLE zendesk_daily_metric (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  category zendesk_ticket_category NOT NULL,
  new_ticket_count integer NOT NULL DEFAULT 0,
  resolved_ticket_count integer NOT NULL DEFAULT 0,
  open_backlog_count integer NOT NULL DEFAULT 0,
  oldest_open_ticket_count integer NOT NULL DEFAULT 0,
  median_first_reply_minutes integer,
  median_resolution_minutes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, metric_date, category)
);

CREATE INDEX zendesk_sync_run_tenant_created_idx ON zendesk_sync_run (tenant_id, created_at DESC);
CREATE INDEX zendesk_category_rule_tenant_priority_idx ON zendesk_category_rule (tenant_id, priority ASC, created_at ASC);
CREATE UNIQUE INDEX zendesk_category_rule_tenant_unique_match_idx
  ON zendesk_category_rule (tenant_id, category, rule_type, COALESCE(field_key, ''), lower(match_value));
CREATE INDEX zendesk_ticket_cache_tenant_status_idx ON zendesk_ticket_cache (tenant_id, status, ticket_updated_at DESC);
CREATE INDEX zendesk_ticket_cache_tenant_category_idx ON zendesk_ticket_cache (tenant_id, category, ticket_created_at DESC);
CREATE INDEX zendesk_ticket_cache_tenant_solved_idx ON zendesk_ticket_cache (tenant_id, ticket_solved_at DESC);
CREATE INDEX zendesk_daily_metric_tenant_date_idx ON zendesk_daily_metric (tenant_id, metric_date DESC, category);

ALTER TABLE zendesk_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE zendesk_sync_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE zendesk_category_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE zendesk_ticket_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE zendesk_daily_metric ENABLE ROW LEVEL SECURITY;

ALTER TABLE zendesk_connection FORCE ROW LEVEL SECURITY;
ALTER TABLE zendesk_sync_run FORCE ROW LEVEL SECURITY;
ALTER TABLE zendesk_category_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE zendesk_ticket_cache FORCE ROW LEVEL SECURITY;
ALTER TABLE zendesk_daily_metric FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_zendesk_connection ON zendesk_connection
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_zendesk_sync_run ON zendesk_sync_run
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_zendesk_category_rule ON zendesk_category_rule
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_zendesk_ticket_cache ON zendesk_ticket_cache
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_zendesk_daily_metric ON zendesk_daily_metric
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

INSERT INTO zendesk_category_rule (tenant_id, category, rule_type, match_value, priority)
SELECT id, 'schools', 'tag', 'schools', 10 FROM tenant
ON CONFLICT DO NOTHING;

INSERT INTO zendesk_category_rule (tenant_id, category, rule_type, match_value, priority)
SELECT id, 'schools', 'tag', 'school', 10 FROM tenant
ON CONFLICT DO NOTHING;

INSERT INTO zendesk_category_rule (tenant_id, category, rule_type, match_value, priority)
SELECT id, 'schools', 'keyword', 'picture day', 20 FROM tenant
ON CONFLICT DO NOTHING;

INSERT INTO zendesk_category_rule (tenant_id, category, rule_type, match_value, priority)
SELECT id, 'schools', 'keyword', 'portrait', 20 FROM tenant
ON CONFLICT DO NOTHING;

INSERT INTO zendesk_category_rule (tenant_id, category, rule_type, match_value, priority)
SELECT id, 'schools', 'keyword', 'yearbook', 20 FROM tenant
ON CONFLICT DO NOTHING;

INSERT INTO zendesk_category_rule (tenant_id, category, rule_type, match_value, priority)
SELECT id, 'sports', 'tag', 'sports', 10 FROM tenant
ON CONFLICT DO NOTHING;

INSERT INTO zendesk_category_rule (tenant_id, category, rule_type, match_value, priority)
SELECT id, 'sports', 'tag', 'sport', 10 FROM tenant
ON CONFLICT DO NOTHING;

INSERT INTO zendesk_category_rule (tenant_id, category, rule_type, match_value, priority)
SELECT id, 'sports', 'keyword', 'athletic', 20 FROM tenant
ON CONFLICT DO NOTHING;

INSERT INTO zendesk_category_rule (tenant_id, category, rule_type, match_value, priority)
SELECT id, 'sports', 'keyword', 'stadium', 20 FROM tenant
ON CONFLICT DO NOTHING;

INSERT INTO zendesk_category_rule (tenant_id, category, rule_type, match_value, priority)
SELECT id, 'sports', 'keyword', 'team', 20 FROM tenant
ON CONFLICT DO NOTHING;
