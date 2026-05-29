DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_project_category') THEN
    CREATE TYPE production_project_category AS ENUM (
      'production_follow_up',
      'photography_production',
      'digital_production',
      'qa_peer_review',
      'remediation'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_project_stage') THEN
    CREATE TYPE production_project_stage AS ENUM (
      'not_started',
      'in_production',
      'needs_peer_review',
      'changes_requested',
      'qa_approved',
      'ready_for_release',
      'released'
    );
  END IF;
END $$;

ALTER TABLE production_project_template
  ADD COLUMN IF NOT EXISTS category production_project_category,
  ADD COLUMN IF NOT EXISTS default_stage production_project_stage,
  ADD COLUMN IF NOT EXISTS peer_review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS final_qc_required boolean NOT NULL DEFAULT false;

ALTER TABLE production_project
  ADD COLUMN IF NOT EXISTS category production_project_category,
  ADD COLUMN IF NOT EXISTS stage production_project_stage,
  ADD COLUMN IF NOT EXISTS peer_review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS final_qc_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS peer_reviewer_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS final_qc_reviewer_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;

ALTER TABLE production_project_template
  ALTER COLUMN category SET DEFAULT 'production_follow_up',
  ALTER COLUMN default_stage SET DEFAULT 'not_started';

ALTER TABLE production_project
  ALTER COLUMN category SET DEFAULT 'production_follow_up',
  ALTER COLUMN stage SET DEFAULT 'not_started';

UPDATE production_project_template
SET
  category = CASE template_key
    WHEN 'manual_production_follow_up' THEN 'production_follow_up'::production_project_category
    WHEN 'post_shoot_production_wrap' THEN 'photography_production'::production_project_category
    WHEN 'post_shoot_issue_remediation' THEN 'remediation'::production_project_category
    WHEN 'resource_issue_follow_up' THEN 'qa_peer_review'::production_project_category
    WHEN 'digital_production_delivery' THEN 'digital_production'::production_project_category
    ELSE COALESCE(category, 'production_follow_up'::production_project_category)
  END,
  default_stage = CASE template_key
    WHEN 'post_shoot_production_wrap' THEN 'in_production'::production_project_stage
    WHEN 'post_shoot_issue_remediation' THEN 'changes_requested'::production_project_stage
    WHEN 'resource_issue_follow_up' THEN 'needs_peer_review'::production_project_stage
    WHEN 'digital_production_delivery' THEN 'in_production'::production_project_stage
    ELSE COALESCE(default_stage, 'not_started'::production_project_stage)
  END,
  peer_review_required = CASE template_key
    WHEN 'post_shoot_production_wrap' THEN true
    WHEN 'resource_issue_follow_up' THEN true
    WHEN 'digital_production_delivery' THEN true
    ELSE peer_review_required
  END,
  final_qc_required = CASE template_key
    WHEN 'post_shoot_production_wrap' THEN true
    WHEN 'resource_issue_follow_up' THEN true
    WHEN 'digital_production_delivery' THEN true
    ELSE final_qc_required
  END
WHERE tenant_id IS NOT NULL;

INSERT INTO production_project_template (
  tenant_id,
  template_key,
  name,
  description,
  default_priority,
  category,
  default_stage,
  peer_review_required,
  final_qc_required
)
SELECT
  tenant.id,
  seeded.template_key,
  seeded.name,
  seeded.description,
  seeded.default_priority::production_project_priority,
  seeded.category::production_project_category,
  seeded.default_stage::production_project_stage,
  seeded.peer_review_required,
  seeded.final_qc_required
FROM tenant
CROSS JOIN (
  VALUES
    (
      'digital_production_delivery',
      'Digital Production Delivery',
      'Track the digital edit, peer review, final QC, and release path for a delivery package.',
      'high',
      'digital_production',
      'in_production',
      true,
      true
    )
) AS seeded(template_key, name, description, default_priority, category, default_stage, peer_review_required, final_qc_required)
WHERE NOT EXISTS (
  SELECT 1
  FROM production_project_template existing
  WHERE existing.tenant_id = tenant.id
    AND existing.template_key = seeded.template_key
);

INSERT INTO production_project_template_task (
  tenant_id,
  template_id,
  task_key,
  title,
  summary,
  due_offset_days,
  required,
  sort_order
)
SELECT
  template.tenant_id,
  template.id,
  seeded.task_key,
  seeded.title,
  seeded.summary,
  seeded.due_offset_days,
  seeded.required,
  seeded.sort_order
FROM production_project_template template
JOIN (
  VALUES
    ('post_shoot_production_wrap', 'prepare_delivery', 'Prepare delivery package', 'Build the production package and confirm the handoff scope before review.', 1, true, 2),
    ('post_shoot_production_wrap', 'peer_review', 'Peer review the package', 'Assign a peer review pass before final QC or release.', 2, true, 3),
    ('post_shoot_production_wrap', 'final_qc', 'Final QC before release', 'Confirm final QC signoff before the package is released.', 3, true, 4),
    ('resource_issue_follow_up', 'peer_review_issue', 'Peer review the concern', 'Have another production teammate review the issue evidence and recommendation.', 0, true, 2),
    ('resource_issue_follow_up', 'final_qc_issue', 'Final QC decision', 'Capture the final QC decision before closing the issue follow-up.', 1, true, 3),
    ('digital_production_delivery', 'confirm_scope', 'Confirm edit scope and delivery spec', 'Make sure the requested output, turnaround, and deliverable are locked before editing starts.', 0, true, 0),
    ('digital_production_delivery', 'build_package', 'Build the digital production package', 'Complete the retouching, export prep, and package assembly work.', 1, true, 1),
    ('digital_production_delivery', 'peer_review_pass', 'Peer review the package', 'Send the package through a peer review pass before final QC.', 2, true, 2),
    ('digital_production_delivery', 'final_qc_signoff', 'Final QC signoff', 'Clear the package through final QC before release.', 3, true, 3),
    ('digital_production_delivery', 'release_assets', 'Release the final assets', 'Deliver the approved package and record the release note.', 4, true, 4)
) AS seeded(template_key, task_key, title, summary, due_offset_days, required, sort_order)
  ON seeded.template_key = template.template_key
WHERE NOT EXISTS (
  SELECT 1
  FROM production_project_template_task existing
  WHERE existing.tenant_id = template.tenant_id
    AND existing.template_id = template.id
    AND existing.task_key = seeded.task_key
);

UPDATE production_project project
SET
  category = COALESCE(
    project.category,
    template.category,
    CASE
      WHEN project.source_trigger_key = 'shoot_completed_post_production' THEN 'photography_production'::production_project_category
      WHEN project.source_trigger_key = 'post_shoot_issue_flagged' THEN 'remediation'::production_project_category
      WHEN project.source_trigger_key = 'resource_issue_follow_up' THEN 'qa_peer_review'::production_project_category
      ELSE 'production_follow_up'::production_project_category
    END
  ),
  stage = COALESCE(
    project.stage,
    CASE
      WHEN project.status IN ('completed', 'canceled') THEN 'released'::production_project_stage
      WHEN template.default_stage IS NOT NULL THEN template.default_stage
      WHEN project.status = 'new' THEN 'not_started'::production_project_stage
      ELSE 'in_production'::production_project_stage
    END
  ),
  peer_review_required = COALESCE(template.peer_review_required, false),
  final_qc_required = COALESCE(template.final_qc_required, false)
FROM production_project_template template
WHERE template.tenant_id = project.tenant_id
  AND template.id = project.template_id;

UPDATE production_project project
SET
  category = COALESCE(
    project.category,
    CASE
      WHEN project.source_trigger_key = 'shoot_completed_post_production' THEN 'photography_production'::production_project_category
      WHEN project.source_trigger_key = 'post_shoot_issue_flagged' THEN 'remediation'::production_project_category
      WHEN project.source_trigger_key = 'resource_issue_follow_up' THEN 'qa_peer_review'::production_project_category
      ELSE 'production_follow_up'::production_project_category
    END
  ),
  stage = COALESCE(
    project.stage,
    CASE
      WHEN project.status IN ('completed', 'canceled') THEN 'released'::production_project_stage
      WHEN project.source_trigger_key = 'resource_issue_follow_up' THEN 'needs_peer_review'::production_project_stage
      WHEN project.source_trigger_key = 'post_shoot_issue_flagged' THEN 'changes_requested'::production_project_stage
      WHEN project.status = 'new' THEN 'not_started'::production_project_stage
      ELSE 'in_production'::production_project_stage
    END
  )
WHERE project.category IS NULL
   OR project.stage IS NULL;

UPDATE production_project
SET stage = 'released'::production_project_stage
WHERE status IN ('completed', 'canceled');

ALTER TABLE production_project_template
  ALTER COLUMN category SET NOT NULL,
  ALTER COLUMN default_stage SET NOT NULL;

ALTER TABLE production_project
  ALTER COLUMN category SET NOT NULL,
  ALTER COLUMN stage SET NOT NULL;

CREATE INDEX IF NOT EXISTS production_project_tenant_stage_idx
  ON production_project (tenant_id, stage, status, due_date, created_at DESC);

CREATE INDEX IF NOT EXISTS production_project_tenant_category_idx
  ON production_project (tenant_id, category, status, due_date, created_at DESC);
