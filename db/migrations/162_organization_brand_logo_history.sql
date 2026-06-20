-- Phase 4 Slice 3 — canonical brand, website normalization, and logo history.
-- The audit found brand color/mascot/website were packed into organization.notes and
-- there was no logo history. This adds the smallest canonical structure: explicit brand
-- columns (with state values, not blank-as-unknown), a normalized website column, a logo
-- status, and an organization_logo_history table. Purely additive + reversible; existing
-- readers unaffected. See docs/phase4-directory-schools-canonical-audit.md.

ALTER TABLE organization
  ADD COLUMN IF NOT EXISTS brand_primary_color text,
  ADD COLUMN IF NOT EXISTS brand_secondary_color text,
  ADD COLUMN IF NOT EXISTS mascot text,
  ADD COLUMN IF NOT EXISTS brand_status text,   -- known | unknown | not_available | not_applicable
  ADD COLUMN IF NOT EXISTS normalized_website text,
  ADD COLUMN IF NOT EXISTS logo_status text;    -- current | outdated | pending_review | unavailable

CREATE TABLE IF NOT EXISTS organization_logo_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  logo_url text,
  source text NOT NULL DEFAULT 'manual',        -- manual | upload | resource_library | import
  status text NOT NULL DEFAULT 'current',       -- current | outdated | pending_review | unavailable
  note text,
  set_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organization_logo_history_org_idx
  ON organization_logo_history (tenant_id, organization_id, created_at DESC);

DO $$
BEGIN
  EXECUTE 'ALTER TABLE organization_logo_history ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE organization_logo_history FORCE ROW LEVEL SECURITY';
  DROP POLICY IF EXISTS tenant_isolation_organization_logo_history ON organization_logo_history;
  CREATE POLICY tenant_isolation_organization_logo_history
    ON organization_logo_history
    USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
END $$;
