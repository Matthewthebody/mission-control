-- Phase 4 Slice 2 — reusable canonical Contact identity.
-- The audit found contacts are org-bound (organization_contact.organization_id NOT NULL,
-- 0 cross-org reuse). The SAFE shape (no NOT-NULL relaxation): a canonical `contact`
-- identity table that an org-bound `organization_contact` row references via an additive,
-- nullable `contact_id`. The same person across two orgs = two organization_contact rows
-- pointing at ONE contact identity. Email is NOT unique (shared school inboxes are
-- legitimate). Purely additive + reversible; existing readers unaffected. See
-- docs/phase4-directory-schools-canonical-audit.md.

CREATE TABLE IF NOT EXISTS contact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  first_name text,
  last_name text,
  full_name text,
  normalized_full_name text,
  display_name text,
  email text,
  normalized_email text,
  phone text,
  preferred_contact_method text,
  active_status text NOT NULL DEFAULT 'active', -- active | inactive
  source text NOT NULL DEFAULT 'manual',
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_active_status_check CHECK (active_status IN ('active', 'inactive')),
  -- composite key so dependents can enforce tenant-consistency via FK
  CONSTRAINT contact_id_tenant_unique UNIQUE (id, tenant_id)
);

-- Search indexes (NO unique on email — shared inboxes repeat legitimately).
CREATE INDEX IF NOT EXISTS contact_tenant_name_idx ON contact (tenant_id, normalized_full_name);
CREATE INDEX IF NOT EXISTS contact_tenant_email_idx ON contact (tenant_id, normalized_email);
CREATE INDEX IF NOT EXISTS contact_tenant_active_idx ON contact (tenant_id, active_status);

-- Link the existing org-bound relationship record to its canonical identity. Nullable
-- and additive: organization_contact.organization_id stays NOT NULL; nothing is dropped.
ALTER TABLE organization_contact
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contact(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS organization_contact_contact_id_idx ON organization_contact (tenant_id, contact_id);

DO $$
BEGIN
  EXECUTE 'ALTER TABLE contact ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE contact FORCE ROW LEVEL SECURITY';
  DROP POLICY IF EXISTS tenant_isolation_contact ON contact;
  CREATE POLICY tenant_isolation_contact
    ON contact
    USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
END $$;
