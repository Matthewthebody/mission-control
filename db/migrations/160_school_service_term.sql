-- Phase 4 Slice 4 — time-bound (Organization x school-year/season) service truth.
-- The audit's #1 gap: school-year/season service configuration had no canonical home
-- and was re-entered on every Job (school_job_profiles / sports_job_profiles, PK job_id).
-- This adds the missing MIDDLE layer between static account truth (organization /
-- account_service) and dated Job/Shoot truth. Purely additive, RLS-forced, tenant-safe,
-- reversible (DROP TABLE). The permanent `account_service` catalog is unchanged. No
-- existing reader is affected. See docs/phase4-directory-schools-canonical-audit.md.

CREATE TABLE IF NOT EXISTS school_service_term (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  -- which kind of period this configuration covers
  period_type text NOT NULL DEFAULT 'school_year', -- school_year | season | custom
  period_label text NOT NULL,                        -- e.g. '2026-2027' or 'Spring 2026'
  start_date date,
  end_date date,
  -- lifecycle: a term is a draft until activated; exactly one 'current' per (org, period_type)
  status text NOT NULL DEFAULT 'draft',              -- draft | current | closed
  -- inherited values must never silently become confirmed current truth
  confirmation_state text NOT NULL DEFAULT 'unconfirmed', -- unconfirmed | confirmed
  internal_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual',             -- manual | rollover | import
  -- the time-bound service configuration (additive, free-form per year/season)
  service_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- rollover provenance
  copied_from_term_id uuid REFERENCES school_service_term(id) ON DELETE SET NULL,
  inherited_field_keys text[] NOT NULL DEFAULT '{}'::text[],
  confirmed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  notes text,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_service_term_status_check CHECK (status IN ('draft', 'current', 'closed')),
  CONSTRAINT school_service_term_confirmation_check CHECK (confirmation_state IN ('unconfirmed', 'confirmed')),
  CONSTRAINT school_service_term_period_type_check CHECK (period_type IN ('school_year', 'season', 'custom')),
  CONSTRAINT school_service_term_no_self_copy CHECK (copied_from_term_id IS NULL OR copied_from_term_id <> id),
  -- one term per (org, period_type, period_label)
  CONSTRAINT school_service_term_unique UNIQUE (tenant_id, organization_id, period_type, period_label)
);

-- At most one CURRENT term per (organization, period_type) — current is explicit, not "newest".
CREATE UNIQUE INDEX IF NOT EXISTS school_service_term_current_unique_idx
  ON school_service_term (tenant_id, organization_id, period_type)
  WHERE status = 'current';

CREATE INDEX IF NOT EXISTS school_service_term_org_idx
  ON school_service_term (tenant_id, organization_id, status);

DO $$
BEGIN
  EXECUTE 'ALTER TABLE school_service_term ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE school_service_term FORCE ROW LEVEL SECURITY';
  DROP POLICY IF EXISTS tenant_isolation_school_service_term ON school_service_term;
  CREATE POLICY tenant_isolation_school_service_term
    ON school_service_term
    USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
END $$;
