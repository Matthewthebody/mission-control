-- Convergence A1 semantics (ratified 2026-07-13): one engagement Job → many
-- Shoots. Jobs gain the engagement key the intake needs to REUSE an existing
-- Job when a second shoot (makeup/retake/additional day) is published for the
-- same organization + service term + department, instead of minting a new
-- per-shoot 1:1 Job. Nullable + additive; existing rows are untouched (their
-- term can be backfilled from dated_commitment later if ever needed).

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS service_term_id uuid REFERENCES school_service_term(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jobs_engagement_term_idx
  ON jobs (tenant_id, organization_id, service_term_id, department_type)
  WHERE service_term_id IS NOT NULL;

COMMENT ON COLUMN jobs.service_term_id IS
  'Engagement key (with organization_id + department_type): central intake reuses the Job for additional shoots published in the same service term. NULL = pre-convergence row or no term context.';
