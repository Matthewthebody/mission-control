-- migrate: no-transaction
-- Production Board integrity hardening
-- Notes:
-- - This migration is idempotent and safe to rerun after a partial apply.
-- - It runs outside an explicit transaction so the new indexes can be created
--   concurrently without blocking normal writes longer than necessary.
-- Rollback guidance:
-- - Prefer a forward-fix migration if data repair is needed later.
-- - To roll back schema-only additions, drop the indexes and constraints added
--   here after confirming no newer code depends on them.

WITH resolved_template AS (
  SELECT
    item.id,
    CASE
      WHEN lower(coalesce(item.title, '')) LIKE '%photos over time%'
        OR lower(coalesce(item.title, '')) LIKE '%preload%'
        OR lower(coalesce(item.production_type, '')) LIKE '%photos_over_time%'
        OR lower(coalesce(item.production_type, '')) LIKE '%preload%'
        THEN 'photos_over_time'
      WHEN item.department_type = 'schools'::job_department_type
        THEN 'schools_workflow'
      WHEN item.department_type = 'sports'::job_department_type
        AND (
          item.job_type IN ('specialty', 'banner_day')
          OR lower(coalesce(item.production_type, '')) ~ '(banner|specialty|poster|memory|trader|vendor|print)'
          OR coalesce(item.vendor_name, '') <> ''
          OR (
            coalesce(item.release_target, '') <> ''
            AND lower(coalesce(item.release_target, '')) NOT IN ('gallery', 'standard_gallery', 'team_gallery', 'portal', 'admin_portal')
          )
        )
        THEN 'specialty_workflow'
      WHEN item.department_type = 'sports'::job_department_type
        THEN 'sports_workflow'
      WHEN item.job_type IN ('specialty', 'banner_day')
        THEN 'specialty_workflow'
      ELSE 'specialty_workflow'
    END AS template_key
  FROM production_items item
)
UPDATE production_items item
SET
  production_template_key = COALESCE(item.production_template_key, resolved_template.template_key),
  completion_rule_key = COALESCE(
    item.completion_rule_key,
    CASE resolved_template.template_key
      WHEN 'schools_workflow' THEN 'schools_gallery_or_email'
      WHEN 'sports_workflow' THEN 'sports_release_date_or_legacy_finished'
      WHEN 'photos_over_time' THEN 'photos_over_time_event'
      ELSE 'specialty_template_marker'
    END
  )
FROM resolved_template
WHERE resolved_template.id = item.id
  AND (
    item.production_template_key IS NULL
    OR item.completion_rule_key IS NULL
  );

UPDATE production_items
SET created_from_source = 'repair'
WHERE created_from_source = 'job_publish'
  AND production_group_key LIKE '%:repair';

UPDATE production_items item
SET
  hold_reason = COALESCE(item.hold_reason, item.blocked_reason, 'Legacy hold pending review'),
  hold_owner_user_id = COALESCE(
    item.hold_owner_user_id,
    item.assigned_to_user_id,
    item.assigned_peer_reviewer_user_id,
    item.assigned_release_reviewer_user_id,
    item.department_owner_user_id,
    item.account_owner_user_id,
    item.escalation_owner_user_id,
    job.account_owner_user_id,
    job.updated_by_user_id,
    job.created_by_user_id
  ),
  hold_review_at = COALESCE(
    item.hold_review_at,
    item.release_due_at,
    item.due_at,
    item.delivery_deadline_at,
    job.client_deadline_at,
    job.production_deadline_at,
    item.updated_at + interval '3 days',
    item.created_at + interval '3 days',
    now() + interval '3 days'
  )
FROM jobs job
WHERE item.job_id = job.id
  AND item.workflow_status = 'ON_HOLD'::production_board_workflow_status_type
  AND (
    item.hold_reason IS NULL
    OR item.hold_owner_user_id IS NULL
    OR item.hold_review_at IS NULL
  );

UPDATE production_items
SET
  workflow_status = 'BLOCKED'::production_board_workflow_status_type,
  health_state = 'BLOCKED'::production_board_health_state_type,
  blocked_reason = COALESCE(blocked_reason, hold_reason, 'Legacy hold missing owner; manual review required.'),
  hold_reason = COALESCE(hold_reason, blocked_reason, 'Legacy hold missing owner; manual review required.')
WHERE workflow_status = 'ON_HOLD'::production_board_workflow_status_type
  AND hold_owner_user_id IS NULL;

UPDATE production_items
SET shoot_date_end = shoot_date_start
WHERE shoot_date_start IS NOT NULL
  AND shoot_date_end IS NOT NULL
  AND shoot_date_end < shoot_date_start;

UPDATE production_items
SET closed_at = completed_at
WHERE completed_at IS NOT NULL
  AND closed_at IS NOT NULL
  AND closed_at < completed_at;

UPDATE production_items
SET merged_into_production_item_id = NULL
WHERE merged_into_production_item_id = id;

UPDATE deliverable_items
SET parent_deliverable_item_id = NULL
WHERE parent_deliverable_item_id = id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_items_template_key_required_chk'
  ) THEN
    ALTER TABLE production_items
      ADD CONSTRAINT production_items_template_key_required_chk
      CHECK (production_template_key IS NOT NULL)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_items_completion_rule_key_required_chk'
  ) THEN
    ALTER TABLE production_items
      ADD CONSTRAINT production_items_completion_rule_key_required_chk
      CHECK (completion_rule_key IS NOT NULL)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_items_hold_fields_chk'
  ) THEN
    ALTER TABLE production_items
      ADD CONSTRAINT production_items_hold_fields_chk
      CHECK (
        workflow_status <> 'ON_HOLD'::production_board_workflow_status_type
        OR (
          hold_reason IS NOT NULL
          AND hold_owner_user_id IS NOT NULL
          AND hold_review_at IS NOT NULL
        )
      )
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_items_shoot_date_range_chk'
  ) THEN
    ALTER TABLE production_items
      ADD CONSTRAINT production_items_shoot_date_range_chk
      CHECK (
        shoot_date_start IS NULL
        OR shoot_date_end IS NULL
        OR shoot_date_end >= shoot_date_start
      )
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_items_closed_after_completed_chk'
  ) THEN
    ALTER TABLE production_items
      ADD CONSTRAINT production_items_closed_after_completed_chk
      CHECK (
        completed_at IS NULL
        OR closed_at IS NULL
        OR closed_at >= completed_at
      )
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_items_not_merged_into_self_chk'
  ) THEN
    ALTER TABLE production_items
      ADD CONSTRAINT production_items_not_merged_into_self_chk
      CHECK (
        merged_into_production_item_id IS NULL
        OR merged_into_production_item_id <> id
      )
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'deliverable_items_not_parent_self_chk'
  ) THEN
    ALTER TABLE deliverable_items
      ADD CONSTRAINT deliverable_items_not_parent_self_chk
      CHECK (
        parent_deliverable_item_id IS NULL
        OR parent_deliverable_item_id <> id
      )
      NOT VALID;
  END IF;
END $$;

ALTER TABLE production_items VALIDATE CONSTRAINT production_items_readiness_score_range_chk;
ALTER TABLE production_items VALIDATE CONSTRAINT production_items_blocker_count_nonnegative_chk;
ALTER TABLE production_items VALIDATE CONSTRAINT production_items_rework_count_nonnegative_chk;
ALTER TABLE production_items VALIDATE CONSTRAINT production_items_template_key_required_chk;
ALTER TABLE production_items VALIDATE CONSTRAINT production_items_completion_rule_key_required_chk;
ALTER TABLE production_items VALIDATE CONSTRAINT production_items_hold_fields_chk;
ALTER TABLE production_items VALIDATE CONSTRAINT production_items_shoot_date_range_chk;
ALTER TABLE production_items VALIDATE CONSTRAINT production_items_closed_after_completed_chk;
ALTER TABLE production_items VALIDATE CONSTRAINT production_items_not_merged_into_self_chk;
ALTER TABLE deliverable_items VALIDATE CONSTRAINT deliverable_items_not_parent_self_chk;

CREATE INDEX CONCURRENTLY IF NOT EXISTS production_items_tenant_job_open_created_idx
  ON production_items (tenant_id, job_id, created_at)
  WHERE merged_into_production_item_id IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS production_items_tenant_department_queue_idx
  ON production_items (tenant_id, department_type, workflow_status, health_state, due_at, updated_at DESC)
  WHERE merged_into_production_item_id IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS production_items_tenant_legacy_source_idx
  ON production_items (tenant_id, legacy_source_reference)
  WHERE legacy_source_reference IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS deliverable_items_tenant_legacy_source_idx
  ON deliverable_items (tenant_id, legacy_source_reference)
  WHERE legacy_source_reference IS NOT NULL;
