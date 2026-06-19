-- Staffing publish + acknowledgment lifecycle (Phase 2, Slice 2 — additive schema).
-- Adds a per-shoot immutable published-version ledger and a per-recipient state table.
-- Design: docs/staffing-publish-ack-lifecycle-design.md. No parallel staffing store —
-- work_shift / shoot_staffing_requirement remain the assignment source of truth; these
-- tables record what was published, to whom, and each employee's confirmation state.

CREATE TABLE IF NOT EXISTS staffing_plan_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  version integer NOT NULL,
  plan_hash text NOT NULL,
  -- hash_version: normalization-algorithm version for plan_hash (digest compatibility).
  -- snapshot_schema_version: interpretation version for the immutable plan_snapshot JSON.
  -- Hash equality is meaningful only when hash_version matches; a future hash or snapshot upgrade
  -- bumps the relevant version so historical plans are read under their own rules rather than
  -- appearing newly changed.
  hash_version integer NOT NULL DEFAULT 1 CHECK (hash_version > 0),
  snapshot_schema_version integer NOT NULL DEFAULT 1 CHECK (snapshot_schema_version > 0),
  published_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  plan_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, shoot_id, version),
  -- Supports the composite tenant-consistency FK from staffing_plan_recipient.
  UNIQUE (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS staffing_plan_version_current_idx
  ON staffing_plan_version (tenant_id, shoot_id, version DESC);

CREATE INDEX IF NOT EXISTS staffing_plan_version_plan_hash_idx
  ON staffing_plan_version (tenant_id, shoot_id, plan_hash);

CREATE TABLE IF NOT EXISTS staffing_plan_recipient (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  staffing_plan_version_id uuid NOT NULL,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  employee_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  recipient_hash text NOT NULL,
  -- See staffing_plan_version.hash_version / snapshot_schema_version. hash_version governs
  -- recipient_hash equality; snapshot_schema_version governs assignment_snapshot interpretation.
  hash_version integer NOT NULL DEFAULT 1 CHECK (hash_version > 0),
  snapshot_schema_version integer NOT NULL DEFAULT 1 CHECK (snapshot_schema_version > 0),
  assignment_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_status text NOT NULL DEFAULT 'pending',
  acknowledgment_due_at timestamptz,
  responded_at timestamptz,
  responded_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  decline_reason text,
  carried_forward_from_recipient_id uuid REFERENCES staffing_plan_recipient(id) ON DELETE SET NULL,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staffing_plan_recipient_response_status_check
    CHECK (response_status IN ('pending', 'acknowledged', 'declined', 'canceled')),
  -- Tenant consistency: a recipient must belong to a version in the same tenant.
  CONSTRAINT staffing_plan_recipient_version_fk
    FOREIGN KEY (staffing_plan_version_id, tenant_id)
    REFERENCES staffing_plan_version (id, tenant_id) ON DELETE CASCADE,
  -- One normalized recipient package per employee per published version.
  UNIQUE (staffing_plan_version_id, employee_user_id)
);

CREATE INDEX IF NOT EXISTS staffing_plan_recipient_version_idx
  ON staffing_plan_recipient (tenant_id, staffing_plan_version_id);

CREATE INDEX IF NOT EXISTS staffing_plan_recipient_employee_idx
  ON staffing_plan_recipient (tenant_id, employee_user_id, response_status);

-- Current recipients for a shoot are those with superseded_at IS NULL; this index
-- backs the readiness/candidate "is this employee currently declined?" lookups.
CREATE INDEX IF NOT EXISTS staffing_plan_recipient_current_idx
  ON staffing_plan_recipient (tenant_id, shoot_id, superseded_at, response_status);

-- Partial index for the pending-acknowledgment sweep (current pending recipients by deadline).
CREATE INDEX IF NOT EXISTS staffing_plan_recipient_pending_due_idx
  ON staffing_plan_recipient (tenant_id, shoot_id, acknowledgment_due_at)
  WHERE response_status = 'pending' AND superseded_at IS NULL;

DO $$
BEGIN
  EXECUTE 'ALTER TABLE staffing_plan_version ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE staffing_plan_version FORCE ROW LEVEL SECURITY';
  DROP POLICY IF EXISTS tenant_isolation_staffing_plan_version ON staffing_plan_version;
  CREATE POLICY tenant_isolation_staffing_plan_version
    ON staffing_plan_version
    USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());

  EXECUTE 'ALTER TABLE staffing_plan_recipient ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE staffing_plan_recipient FORCE ROW LEVEL SECURITY';
  DROP POLICY IF EXISTS tenant_isolation_staffing_plan_recipient ON staffing_plan_recipient;
  CREATE POLICY tenant_isolation_staffing_plan_recipient
    ON staffing_plan_recipient
    USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
END $$;
