-- Phase 3C.1 — preserve a Job's lifecycle state across archive/restore.
-- Adds a single additive, nullable JSONB snapshot captured at archive time so that
-- restore can return the Job to its recorded prior status (reconciled against current
-- child data) instead of blindly forcing pending_confirmation. Existing rows are
-- unchanged (NULL = no recorded pre-archive state) and behavior is identical until a
-- value is set. No data is rewritten.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS pre_archive_state jsonb;

COMMENT ON COLUMN jobs.pre_archive_state IS
  'Snapshot of lifecycle statuses (job_status/production_status/readiness_status/risk_status/staffing_status) captured at archive time; consumed and cleared by restore. Phase 3C.1.';
