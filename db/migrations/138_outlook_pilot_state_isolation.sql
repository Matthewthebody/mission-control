ALTER TABLE outlook_connection
  DROP CONSTRAINT IF EXISTS outlook_connection_tenant_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS outlook_connection_tenant_provider_uidx
  ON outlook_connection (tenant_id, provider_mode);

UPDATE outlook_connection
SET connected_account_email = NULL,
    provider_tenant_id = NULL,
    encrypted_access_token = NULL,
    encrypted_refresh_token = NULL,
    access_token_expires_at = NULL,
    scopes = '{}'::text[]
WHERE provider_mode = 'mock'::outlook_provider_mode;

CREATE TABLE IF NOT EXISTS outlook_tenant_state (
  tenant_id uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  active_provider_mode outlook_provider_mode NOT NULL DEFAULT 'mock',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO outlook_tenant_state (tenant_id, active_provider_mode)
SELECT tenant_id, provider_mode
FROM outlook_connection
ON CONFLICT (tenant_id) DO UPDATE SET
  active_provider_mode = EXCLUDED.active_provider_mode,
  updated_at = now();

ALTER TABLE outlook_tenant_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE outlook_tenant_state FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_outlook_tenant_state ON outlook_tenant_state;
CREATE POLICY tenant_isolation_outlook_tenant_state ON outlook_tenant_state
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE outlook_calendar_visibility_preference
  ADD COLUMN IF NOT EXISTS provider_mode outlook_provider_mode;

UPDATE outlook_calendar_visibility_preference preference
SET provider_mode = COALESCE(connection.provider_mode, 'mock'::outlook_provider_mode)
FROM (
  SELECT tenant_id, provider_mode
  FROM outlook_connection
) connection
WHERE preference.tenant_id = connection.tenant_id
  AND preference.provider_mode IS NULL;

UPDATE outlook_calendar_visibility_preference
SET provider_mode = 'mock'::outlook_provider_mode
WHERE provider_mode IS NULL;

ALTER TABLE outlook_calendar_visibility_preference
  ALTER COLUMN provider_mode SET DEFAULT 'mock'::outlook_provider_mode;

ALTER TABLE outlook_calendar_visibility_preference
  ALTER COLUMN provider_mode SET NOT NULL;

ALTER TABLE outlook_calendar_visibility_preference
  DROP CONSTRAINT IF EXISTS outlook_calendar_visibility_preference_tenant_id_user_id_calendar_id_key;

ALTER TABLE outlook_calendar_visibility_preference
  ADD CONSTRAINT outlook_calendar_visibility_preference_tenant_user_provider_calendar_key
  UNIQUE (tenant_id, user_id, provider_mode, calendar_id);

DROP INDEX IF EXISTS outlook_calendar_visibility_tenant_user_idx;

CREATE INDEX IF NOT EXISTS outlook_calendar_visibility_tenant_user_provider_idx
  ON outlook_calendar_visibility_preference (tenant_id, user_id, provider_mode, updated_at DESC);
