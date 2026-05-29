CREATE TYPE outlook_provider_mode AS ENUM ('mock', 'graph_live');
CREATE TYPE outlook_connection_status AS ENUM ('connected', 'disconnected', 'attention');
CREATE TYPE outlook_health_state AS ENUM (
  'mock',
  'disconnected',
  'connected_pending_sync',
  'connected_healthy',
  'connected_warning',
  'connected_error'
);
CREATE TYPE outlook_sync_status AS ENUM ('success', 'warning', 'error');

CREATE TABLE outlook_connection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenant(id) ON DELETE CASCADE,
  connected_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  auth_session_id uuid REFERENCES auth_session(id) ON DELETE SET NULL,
  provider_mode outlook_provider_mode NOT NULL DEFAULT 'mock',
  connection_status outlook_connection_status NOT NULL DEFAULT 'disconnected',
  health_state outlook_health_state NOT NULL DEFAULT 'disconnected',
  connected_account_email text,
  provider_tenant_id text,
  encrypted_access_token text,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  records_synced integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  last_successful_sync_at timestamptz,
  last_failed_sync_at timestamptz,
  last_error_message text,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outlook_sync_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES outlook_connection(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  provider_mode outlook_provider_mode NOT NULL DEFAULT 'mock',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status outlook_sync_status NOT NULL DEFAULT 'success',
  records_synced integer NOT NULL DEFAULT 0,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outlook_oauth_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  auth_session_id uuid NOT NULL REFERENCES auth_session(id) ON DELETE CASCADE,
  state_hash text NOT NULL UNIQUE,
  redirect_path text NOT NULL DEFAULT '#outlook',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outlook_sync_run_tenant_created_idx ON outlook_sync_run (tenant_id, created_at DESC);
CREATE INDEX outlook_oauth_state_tenant_expires_idx ON outlook_oauth_state (tenant_id, expires_at DESC);

ALTER TABLE outlook_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE outlook_sync_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE outlook_oauth_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE outlook_connection FORCE ROW LEVEL SECURITY;
ALTER TABLE outlook_sync_run FORCE ROW LEVEL SECURITY;
ALTER TABLE outlook_oauth_state FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_outlook_connection ON outlook_connection
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_outlook_sync_run ON outlook_sync_run
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_outlook_oauth_state ON outlook_oauth_state
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
