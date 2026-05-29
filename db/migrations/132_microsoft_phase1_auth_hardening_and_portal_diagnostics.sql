ALTER TABLE auth_session
  ADD COLUMN IF NOT EXISTS active_auth_context_ids text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS identity_claims jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS identity_authorization jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE microsoft_auth_state
  ADD COLUMN IF NOT EXISTS flow_purpose text NOT NULL DEFAULT 'sign_in',
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES auth_session(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS requested_action_key text,
  ADD COLUMN IF NOT EXISTS requested_auth_context_id text,
  ADD COLUMN IF NOT EXISTS requested_assurance text,
  ADD COLUMN IF NOT EXISTS state_context jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS microsoft_auth_state_session_idx
  ON microsoft_auth_state (session_id, expires_at DESC)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS microsoft_security_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  control_key text NOT NULL,
  status text NOT NULL DEFAULT 'at_risk'
    CHECK (status IN ('healthy', 'at_risk', 'blocked')),
  what_text text NOT NULL,
  why_text text NOT NULL,
  fix_text text NOT NULL,
  owner text NOT NULL,
  retest_text text NOT NULL,
  evidence_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  checked_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  checked_at timestamptz,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, control_key)
);

CREATE INDEX IF NOT EXISTS microsoft_security_evidence_tenant_status_idx
  ON microsoft_security_evidence (tenant_id, status, updated_at DESC);

ALTER TABLE microsoft_security_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE microsoft_security_evidence FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'microsoft_security_evidence'
      AND policyname = 'tenant_isolation_microsoft_security_evidence'
  ) THEN
    CREATE POLICY tenant_isolation_microsoft_security_evidence ON microsoft_security_evidence
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;
END $$;
