ALTER TABLE user_account
  ADD COLUMN IF NOT EXISTS microsoft_user_id text,
  ADD COLUMN IF NOT EXISTS microsoft_tenant_id text,
  ADD COLUMN IF NOT EXISTS auth_provider text NOT NULL DEFAULT 'local_password',
  ADD COLUMN IF NOT EXISTS linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

UPDATE user_account
SET auth_provider = CASE
    WHEN coalesce(password_hash, '') <> '' THEN 'local_password'
    ELSE auth_provider
  END
WHERE auth_provider IS NULL
   OR auth_provider = '';

UPDATE user_account account
SET last_login_at = membership.last_login_at
FROM app_user membership
WHERE membership.account_id = account.id
  AND membership.last_login_at IS NOT NULL
  AND account.last_login_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_account_microsoft_identity_uidx
  ON user_account (microsoft_tenant_id, microsoft_user_id)
  WHERE microsoft_tenant_id IS NOT NULL
    AND microsoft_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS microsoft_auth_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  return_hash text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS microsoft_auth_state_active_idx
  ON microsoft_auth_state (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS microsoft_tenant_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  microsoft_tenant_id text NOT NULL UNIQUE,
  last_linked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS microsoft_tenant_mapping_tenant_idx
  ON microsoft_tenant_mapping (tenant_id, microsoft_tenant_id);

CREATE TABLE IF NOT EXISTS microsoft_identity_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenant(id) ON DELETE SET NULL,
  email text NOT NULL,
  full_name text NOT NULL,
  microsoft_user_id text NOT NULL,
  microsoft_tenant_id text NOT NULL,
  auth_provider text NOT NULL DEFAULT 'microsoft_entra',
  review_status text NOT NULL DEFAULT 'pending_review'
    CHECK (review_status IN ('pending_review', 'linked', 'rejected')),
  reason_code text NOT NULL DEFAULT 'unmatched_email',
  matched_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  matched_account_id uuid REFERENCES user_account(id) ON DELETE SET NULL,
  reviewed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  linked_at timestamptz,
  last_login_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS microsoft_identity_review_tenant_status_idx
  ON microsoft_identity_review (tenant_id, review_status, created_at DESC);

CREATE INDEX IF NOT EXISTS microsoft_identity_review_email_idx
  ON microsoft_identity_review (lower(email), created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS microsoft_identity_review_pending_uidx
  ON microsoft_identity_review (microsoft_tenant_id, microsoft_user_id)
  WHERE review_status = 'pending_review';

ALTER TABLE microsoft_tenant_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE microsoft_identity_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE microsoft_tenant_mapping FORCE ROW LEVEL SECURITY;
ALTER TABLE microsoft_identity_review FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'microsoft_tenant_mapping'
      AND policyname = 'tenant_isolation_microsoft_tenant_mapping'
  ) THEN
    CREATE POLICY tenant_isolation_microsoft_tenant_mapping ON microsoft_tenant_mapping
      USING (tenant_id = app.current_tenant_id())
      WITH CHECK (tenant_id = app.current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'microsoft_identity_review'
      AND policyname = 'tenant_isolation_microsoft_identity_review'
  ) THEN
    CREATE POLICY tenant_isolation_microsoft_identity_review ON microsoft_identity_review
      USING (tenant_id = app.current_tenant_id() OR tenant_id IS NULL)
      WITH CHECK (tenant_id = app.current_tenant_id() OR tenant_id IS NULL);
  END IF;
END $$;
