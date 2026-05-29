-- migrate: no-transaction
-- Fresh installs need this migration to run outside a single transaction because
-- the new job_production_status_type enum value is referenced later in the file.
-- Rollback guidance: prefer a forward-fix migration; this file is safe to rerun
-- because every schema/data change remains idempotent.
ALTER TYPE job_production_status_type ADD VALUE IF NOT EXISTS 'proof_sent';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_board_workflow_status_type') THEN
    CREATE TYPE production_board_workflow_status_type AS ENUM (
      'DRAFT',
      'WAITING_ON_INTAKE',
      'WAITING_ON_FILES',
      'INTAKE_REVIEW',
      'READY_FOR_PRODUCTION',
      'IN_PRODUCTION',
      'READY_FOR_QA',
      'IN_PEER_REVIEW',
      'REWORK_REQUIRED',
      'READY_FOR_UPLOAD',
      'UPLOADING',
      'UPLOADED',
      'READY_FOR_RELEASE',
      'RELEASED',
      'SENT_TO_VENDOR',
      'DELIVERED_CLOSED',
      'ON_HOLD',
      'BLOCKED',
      'CANCELLED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_board_health_state_type') THEN
    CREATE TYPE production_board_health_state_type AS ENUM (
      'ON_TRACK',
      'WATCH',
      'AT_RISK',
      'OVERDUE',
      'BLOCKED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_board_sync_state_type') THEN
    CREATE TYPE production_board_sync_state_type AS ENUM (
      'CLEAN',
      'PENDING_SYNC',
      'SYNCED',
      'PARTIAL_ERROR',
      'SYNC_ERROR',
      'STALE'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_board_file_match_status_type') THEN
    CREATE TYPE production_board_file_match_status_type AS ENUM (
      'UNKNOWN',
      'NOT_APPLICABLE',
      'MISSING',
      'PARTIAL',
      'MATCHED',
      'MISMATCH',
      'EXTRA_FILES'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_board_upload_status_type') THEN
    CREATE TYPE production_board_upload_status_type AS ENUM (
      'NOT_STARTED',
      'READY',
      'UPLOADING',
      'UPLOADED',
      'VERIFIED',
      'FAILED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_board_release_status_type') THEN
    CREATE TYPE production_board_release_status_type AS ENUM (
      'NOT_STARTED',
      'PENDING_REVIEW',
      'READY_FOR_RELEASE',
      'RELEASED',
      'SENT_TO_VENDOR',
      'DELIVERED',
      'CLOSED',
      'FAILED'
    );
  END IF;
END $$;

ALTER TABLE production_items
  ADD COLUMN IF NOT EXISTS job_type text,
  ADD COLUMN IF NOT EXISTS created_from_source text NOT NULL DEFAULT 'job_publish',
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS primary_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS department_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_peer_reviewer_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_release_reviewer_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escalation_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shoot_date_start date,
  ADD COLUMN IF NOT EXISTS shoot_date_end date,
  ADD COLUMN IF NOT EXISTS production_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS release_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS workflow_status production_board_workflow_status_type NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS health_state production_board_health_state_type NOT NULL DEFAULT 'ON_TRACK',
  ADD COLUMN IF NOT EXISTS sync_state production_board_sync_state_type NOT NULL DEFAULT 'CLEAN',
  ADD COLUMN IF NOT EXISTS readiness_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocker_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rework_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS file_match_status production_board_file_match_status_type NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS roster_received boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS naming_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS folder_structure_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tags_or_flags_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS handoff_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS upload_status production_board_upload_status_type NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS release_status production_board_release_status_type NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS release_target text,
  ADD COLUMN IF NOT EXISTS gallery_or_output_reference text,
  ADD COLUMN IF NOT EXISTS vendor_reference text,
  ADD COLUMN IF NOT EXISTS creator_review_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS peer_review_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS final_release_review_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qa_fail_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_pass_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS internal_notes text,
  ADD COLUMN IF NOT EXISTS production_notes text,
  ADD COLUMN IF NOT EXISTS post_shoot_eval_summary text,
  ADD COLUMN IF NOT EXISTS risk_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS legacy_source_reference text,
  ADD COLUMN IF NOT EXISTS hold_reason text,
  ADD COLUMN IF NOT EXISTS hold_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hold_review_at timestamptz,
  ADD COLUMN IF NOT EXISTS merged_into_production_item_id uuid REFERENCES production_items(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_items_readiness_score_range_chk'
  ) THEN
    ALTER TABLE production_items
      ADD CONSTRAINT production_items_readiness_score_range_chk
      CHECK (readiness_score >= 0 AND readiness_score <= 100)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_items_blocker_count_nonnegative_chk'
  ) THEN
    ALTER TABLE production_items
      ADD CONSTRAINT production_items_blocker_count_nonnegative_chk
      CHECK (blocker_count >= 0)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_items_rework_count_nonnegative_chk'
  ) THEN
    ALTER TABLE production_items
      ADD CONSTRAINT production_items_rework_count_nonnegative_chk
      CHECK (rework_count >= 0)
      NOT VALID;
  END IF;
END $$;

UPDATE production_items item
SET
  job_type = COALESCE(item.job_type, job.job_category::text),
  organization_id = COALESCE(item.organization_id, job.organization_id),
  location_id = COALESCE(item.location_id, job.primary_location_id),
  primary_contact_id = COALESCE(item.primary_contact_id, job.primary_contact_id),
  account_owner_user_id = COALESCE(item.account_owner_user_id, job.account_owner_user_id),
  shoot_date_start = COALESCE(item.shoot_date_start, job.scheduled_start_at::date),
  shoot_date_end = COALESCE(item.shoot_date_end, job.scheduled_end_at::date, job.scheduled_start_at::date),
  release_due_at = COALESCE(item.release_due_at, item.delivery_deadline_at, job.client_deadline_at),
  workflow_status = CASE item.status
    WHEN 'blocked'::job_production_status_type THEN 'BLOCKED'::production_board_workflow_status_type
    WHEN 'cancelled'::job_production_status_type THEN 'CANCELLED'::production_board_workflow_status_type
    WHEN 'complete'::job_production_status_type THEN 'DELIVERED_CLOSED'::production_board_workflow_status_type
    WHEN 'delivered'::job_production_status_type THEN 'READY_FOR_RELEASE'::production_board_workflow_status_type
    WHEN 'packaged'::job_production_status_type THEN 'READY_FOR_RELEASE'::production_board_workflow_status_type
    WHEN 'ordered_or_sent'::job_production_status_type THEN 'SENT_TO_VENDOR'::production_board_workflow_status_type
    WHEN 'ordered_or_printed'::job_production_status_type THEN 'SENT_TO_VENDOR'::production_board_workflow_status_type
    WHEN 'in_final_production'::job_production_status_type THEN 'UPLOADING'::production_board_workflow_status_type
    WHEN 'approved_for_final'::job_production_status_type THEN 'READY_FOR_UPLOAD'::production_board_workflow_status_type
    WHEN 'approved_for_production'::job_production_status_type THEN 'READY_FOR_PRODUCTION'::production_board_workflow_status_type
    WHEN 'revisions_requested'::job_production_status_type THEN 'REWORK_REQUIRED'::production_board_workflow_status_type
    WHEN 'awaiting_approval'::job_production_status_type THEN 'READY_FOR_RELEASE'::production_board_workflow_status_type
    WHEN 'proof_sent'::job_production_status_type THEN 'UPLOADED'::production_board_workflow_status_type
    WHEN 'proof_build'::job_production_status_type THEN 'READY_FOR_UPLOAD'::production_board_workflow_status_type
    WHEN 'awaiting_internal_review'::job_production_status_type THEN 'READY_FOR_QA'::production_board_workflow_status_type
    WHEN 'editing'::job_production_status_type THEN 'IN_PRODUCTION'::production_board_workflow_status_type
    WHEN 'ingest_complete'::job_production_status_type THEN 'READY_FOR_PRODUCTION'::production_board_workflow_status_type
    WHEN 'awaiting_ingest'::job_production_status_type THEN 'WAITING_ON_FILES'::production_board_workflow_status_type
    ELSE 'DRAFT'::production_board_workflow_status_type
  END,
  health_state = CASE
    WHEN item.status = 'blocked'::job_production_status_type OR item.blocked_reason IS NOT NULL
      THEN 'BLOCKED'::production_board_health_state_type
    WHEN item.due_at IS NOT NULL AND item.closed_at IS NULL AND item.due_at < now()
      THEN 'OVERDUE'::production_board_health_state_type
    ELSE 'ON_TRACK'::production_board_health_state_type
  END,
  sync_state = COALESCE(item.sync_state, 'CLEAN'::production_board_sync_state_type),
  file_match_status = CASE
    WHEN item.file_count_expected IS NULL THEN 'UNKNOWN'::production_board_file_match_status_type
    WHEN COALESCE(item.file_count_received, 0) = 0 THEN 'MISSING'::production_board_file_match_status_type
    WHEN item.file_count_received = item.file_count_expected THEN 'MATCHED'::production_board_file_match_status_type
    WHEN item.file_count_received > item.file_count_expected THEN 'EXTRA_FILES'::production_board_file_match_status_type
    ELSE 'MISMATCH'::production_board_file_match_status_type
  END,
  upload_status = CASE
    WHEN item.status IN ('proof_sent'::job_production_status_type, 'delivered'::job_production_status_type, 'complete'::job_production_status_type)
      THEN 'UPLOADED'::production_board_upload_status_type
    WHEN item.status IN ('proof_build'::job_production_status_type, 'in_final_production'::job_production_status_type)
      THEN 'UPLOADING'::production_board_upload_status_type
    ELSE 'NOT_STARTED'::production_board_upload_status_type
  END,
  release_status = CASE
    WHEN item.status = 'complete'::job_production_status_type THEN 'CLOSED'::production_board_release_status_type
    WHEN item.status = 'delivered'::job_production_status_type THEN 'DELIVERED'::production_board_release_status_type
    WHEN item.status IN ('ordered_or_sent'::job_production_status_type, 'ordered_or_printed'::job_production_status_type)
      THEN 'SENT_TO_VENDOR'::production_board_release_status_type
    WHEN item.status IN ('approved_for_final'::job_production_status_type, 'packaged'::job_production_status_type)
      THEN 'READY_FOR_RELEASE'::production_board_release_status_type
    ELSE 'NOT_STARTED'::production_board_release_status_type
  END,
  risk_flag = COALESCE(item.risk_flag, item.blocked_reason IS NOT NULL),
  legacy_source_reference = COALESCE(item.legacy_source_reference, job.legacy_shoot_id::text)
FROM jobs job
WHERE item.job_id = job.id
  AND (
    item.job_type IS NULL
    OR item.organization_id IS NULL
    OR item.location_id IS NULL
    OR item.primary_contact_id IS NULL
    OR item.account_owner_user_id IS NULL
    OR item.shoot_date_start IS NULL
    OR item.shoot_date_end IS NULL
    OR item.release_due_at IS NULL
    OR item.legacy_source_reference IS NULL
  );

CREATE TABLE IF NOT EXISTS job_shoot_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  link_reason text NOT NULL DEFAULT 'primary',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, job_id, shoot_id)
);

CREATE INDEX IF NOT EXISTS job_shoot_links_tenant_job_idx
  ON job_shoot_links (tenant_id, job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_shoot_links_tenant_shoot_idx
  ON job_shoot_links (tenant_id, shoot_id, created_at DESC);

CREATE TABLE IF NOT EXISTS production_item_shoot_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  production_item_id uuid NOT NULL REFERENCES production_items(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, production_item_id, shoot_id)
);

CREATE INDEX IF NOT EXISTS production_item_shoot_links_tenant_item_idx
  ON production_item_shoot_links (tenant_id, production_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS production_item_shoot_links_tenant_shoot_idx
  ON production_item_shoot_links (tenant_id, shoot_id, created_at DESC);

INSERT INTO job_shoot_links (tenant_id, job_id, shoot_id, link_reason)
SELECT job.tenant_id, job.id, job.legacy_shoot_id, 'legacy_primary'
FROM jobs job
WHERE job.legacy_shoot_id IS NOT NULL
ON CONFLICT (tenant_id, job_id, shoot_id) DO NOTHING;

INSERT INTO production_item_shoot_links (tenant_id, production_item_id, shoot_id)
SELECT item.tenant_id, item.id, job.legacy_shoot_id
FROM production_items item
JOIN jobs job
  ON job.id = item.job_id
 AND job.tenant_id = item.tenant_id
WHERE job.legacy_shoot_id IS NOT NULL
ON CONFLICT (tenant_id, production_item_id, shoot_id) DO NOTHING;

ALTER TABLE production_issue_records
  ADD COLUMN IF NOT EXISTS is_blocking boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_key text,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS production_issue_records_tenant_blocking_idx
  ON production_issue_records (tenant_id, production_item_id, is_blocking, status, updated_at DESC);

INSERT INTO permission (code, name, description, resource_type, action_group)
VALUES
  ('production.group', 'Group Production Items', 'Group compatible production items under one shared board item.', 'production', 'manage'),
  ('production.split', 'Split Production Items', 'Split one production item into multiple downstream work items.', 'production', 'manage'),
  ('production.merge', 'Merge Production Items', 'Merge production items and consolidate linked downstream records.', 'production', 'manage'),
  ('production.reopen', 'Reopen Production Item', 'Reopen a closed production item within the allowed recovery window.', 'production', 'manage'),
  ('production.cancel', 'Cancel Production Item', 'Cancel a production item and close its downstream workflow.', 'production', 'manage'),
  ('production.override_dates', 'Override Production Dates', 'Override production due and release deadlines.', 'production', 'manage'),
  ('production.release_approve', 'Approve Production Release', 'Approve final release or vendor handoff for a production item.', 'production', 'approve')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  resource_type = EXCLUDED.resource_type,
  action_group = EXCLUDED.action_group,
  updated_at = now();

WITH target_role AS (SELECT id FROM role WHERE code = 'admin')
INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect)
SELECT target_role.id, permission.id, 'global'::policy_scope_type, NULL, 'allow'::policy_effect_type
FROM target_role
JOIN permission ON permission.code = ANY (ARRAY[
  'production.group',
  'production.split',
  'production.merge',
  'production.reopen',
  'production.cancel',
  'production.override_dates',
  'production.release_approve'
])
ON CONFLICT DO NOTHING;

WITH target_role AS (SELECT id FROM role WHERE code = 'leadership')
INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect)
SELECT target_role.id, permission.id, 'global'::policy_scope_type, NULL, 'allow'::policy_effect_type
FROM target_role
JOIN permission ON permission.code = ANY (ARRAY[
  'production.group',
  'production.split',
  'production.merge',
  'production.reopen',
  'production.cancel',
  'production.override_dates',
  'production.release_approve'
])
ON CONFLICT DO NOTHING;

WITH seeded(role_code, scope_type, scope_value, permission_codes) AS (
  VALUES
    ('schools_manager', 'department', 'schools', ARRAY[
      'production.group',
      'production.split',
      'production.reopen',
      'production.release_approve'
    ]::text[]),
    ('sports_manager', 'department', 'sports', ARRAY[
      'production.group',
      'production.split',
      'production.reopen',
      'production.release_approve'
    ]::text[]),
    ('production_manager', 'global', NULL, ARRAY[
      'production.group',
      'production.split',
      'production.merge',
      'production.reopen',
      'production.override_dates',
      'production.release_approve'
    ]::text[])
)
INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect)
SELECT role.id, permission.id, seeded.scope_type::policy_scope_type, seeded.scope_value, 'allow'::policy_effect_type
FROM seeded
JOIN role ON role.code = seeded.role_code
JOIN permission ON permission.code = ANY (seeded.permission_codes)
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'job_shoot_links',
    'production_item_shoot_links'
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
