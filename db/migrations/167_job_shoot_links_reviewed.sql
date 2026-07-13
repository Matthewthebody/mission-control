-- Job ↔ Shoot convergence, slice 1 (audit MC-AUDIT-001 / prompt 6; owner-ratified
-- 2026-07-13 in docs/decisions/2026-07-13-owner-decision-memo.md §A):
--   Job  = the client package/engagement.
--   Shoot = a dated operational occurrence. One Job → many Shoots.
-- The bridge is a REVIEWED relationship (Option B, docs/jobs-shoot-convergence-audit.md §7):
-- a matching script may PROPOSE links, but only a human confirms them — the
-- 2026-06-19 dry run proved auto-linking unsafe (0 deterministic org+date matches,
-- 46 ambiguous). Only the explicit jobs.legacy_shoot_id FK is deterministic.
-- Additive and reversible by inspection; text + CHECK style throughout.

-- ---------------------------------------------------------------------------
-- 1. Review/provenance columns on the existing (097) link table.
-- ---------------------------------------------------------------------------
ALTER TABLE job_shoot_links
  ADD COLUMN IF NOT EXISTS relationship_type text NOT NULL DEFAULT 'primary';
ALTER TABLE job_shoot_links
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
-- Existing rows predate review states; they were created only by the 097
-- deterministic legacy_shoot_id backfill, so 'confirmed' is the honest default.
ALTER TABLE job_shoot_links
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'confirmed';
ALTER TABLE job_shoot_links
  ADD COLUMN IF NOT EXISTS confidence numeric(4,3);
ALTER TABLE job_shoot_links
  ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE job_shoot_links
  ADD COLUMN IF NOT EXISTS linked_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;
ALTER TABLE job_shoot_links
  ADD COLUMN IF NOT EXISTS linked_at timestamptz;
ALTER TABLE job_shoot_links
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;
ALTER TABLE job_shoot_links
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE job_shoot_links
  ADD COLUMN IF NOT EXISTS legacy_source_identifier text;
ALTER TABLE job_shoot_links
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE job_shoot_links DROP CONSTRAINT IF EXISTS job_shoot_links_relationship_type_check;
ALTER TABLE job_shoot_links ADD CONSTRAINT job_shoot_links_relationship_type_check CHECK (relationship_type IN (
  'primary', 'makeup', 'retake', 'additional_day', 'production_only', 'other'
));

ALTER TABLE job_shoot_links DROP CONSTRAINT IF EXISTS job_shoot_links_source_check;
ALTER TABLE job_shoot_links ADD CONSTRAINT job_shoot_links_source_check CHECK (source IN (
  'legacy_backfill', 'intake', 'manual', 'suggested'
));

ALTER TABLE job_shoot_links DROP CONSTRAINT IF EXISTS job_shoot_links_status_check;
ALTER TABLE job_shoot_links ADD CONSTRAINT job_shoot_links_status_check CHECK (status IN (
  'proposed', 'confirmed', 'rejected'
));

-- A confirmed link must say when and (where known) by whom it was confirmed.
UPDATE job_shoot_links
SET linked_at = COALESCE(linked_at, created_at)
WHERE status = 'confirmed' AND linked_at IS NULL;

-- Honest provenance for the 097 backfill rows (link_reason 'legacy_primary').
UPDATE job_shoot_links
SET source = 'legacy_backfill',
    reason = COALESCE(reason, 'Deterministic jobs.legacy_shoot_id FK (097 backfill)'),
    legacy_source_identifier = COALESCE(legacy_source_identifier, 'jobs.legacy_shoot_id')
WHERE link_reason = 'legacy_primary' AND source = 'manual';

-- ---------------------------------------------------------------------------
-- 2. Cardinality: a Shoot belongs to at most ONE confirmed Job. (One Job → many
--    Shoots is the ratified model; Shoot → many Jobs stays an open question, so
--    the conservative constraint holds until the owner says otherwise.)
--    Proposals/rejections do not occupy the slot.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS job_shoot_links_confirmed_shoot_uq
  ON job_shoot_links (tenant_id, shoot_id)
  WHERE status = 'confirmed';

-- The review queue reads by status.
CREATE INDEX IF NOT EXISTS job_shoot_links_tenant_status_idx
  ON job_shoot_links (tenant_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Audit history — every propose/confirm/reject is recorded, never rewritten.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_shoot_link_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  link_id uuid NOT NULL REFERENCES job_shoot_links(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_shoot_link_event_type_check CHECK (event_type IN (
    'created', 'proposed', 'confirmed', 'rejected', 'reproposed'
  ))
);

CREATE INDEX IF NOT EXISTS job_shoot_link_event_tenant_link_idx
  ON job_shoot_link_event (tenant_id, link_id, created_at DESC);

DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'job_shoot_link_event'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    policy_name := 'tenant_isolation_' || table_name;
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      policy_name,
      table_name
    );
  END LOOP;
END $$;
