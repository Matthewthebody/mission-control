-- Phase 3C — additive Jobs lifecycle / archival fields.
-- Reuses the existing jobs.archived_at / cancelled_at / completed_at columns; this
-- migration only adds the archival audit trail (who/why/restore) and an explicit
-- demo/test origin marker so synthetic records can be labeled and excluded
-- deterministically. Every new column is nullable with no default, so existing rows
-- are unchanged and behavior is identical until a value is set. No data is rewritten.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS archived_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason text,
  ADD COLUMN IF NOT EXISTS restored_at timestamptz,
  ADD COLUMN IF NOT EXISTS restored_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  -- data_origin: NULL = ordinary operational record. Labeled values let demo/test/
  -- import rows be excluded from active counts and targeted by the cleanup dry-run.
  ADD COLUMN IF NOT EXISTS data_origin text;

ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_data_origin_check;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_data_origin_check
  CHECK (data_origin IS NULL OR data_origin IN ('seed_demo', 'test_fixture', 'import', 'manual'));

-- Supports the default operating-view filter (active = archived_at IS NULL) and the
-- archived-retrieval filter without scanning the whole table.
CREATE INDEX IF NOT EXISTS jobs_tenant_archived_idx ON jobs (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS jobs_tenant_data_origin_idx ON jobs (tenant_id, data_origin) WHERE data_origin IS NOT NULL;
