ALTER TABLE production_project_template
  ADD COLUMN IF NOT EXISTS workflow_family text,
  ADD COLUMN IF NOT EXISTS workflow_mode text,
  ADD COLUMN IF NOT EXISTS season_key text;

UPDATE production_project_template
SET
  workflow_family = CASE template_key
    WHEN 'manual_production_follow_up' THEN 'general'
    WHEN 'post_shoot_production_wrap' THEN 'general'
    WHEN 'post_shoot_issue_remediation' THEN 'general'
    WHEN 'resource_issue_follow_up' THEN 'general'
    WHEN 'digital_production_delivery' THEN 'schools'
    ELSE COALESCE(workflow_family, 'general')
  END,
  workflow_mode = CASE template_key
    WHEN 'manual_production_follow_up' THEN 'manual_follow_up'
    WHEN 'post_shoot_production_wrap' THEN 'post_shoot_wrap'
    WHEN 'post_shoot_issue_remediation' THEN 'issue_remediation'
    WHEN 'resource_issue_follow_up' THEN 'resource_follow_up'
    WHEN 'digital_production_delivery' THEN 'digital_delivery'
    ELSE COALESCE(workflow_mode, 'manual_follow_up')
  END,
  season_key = CASE template_key
    WHEN 'manual_production_follow_up' THEN 'all_year'
    WHEN 'post_shoot_production_wrap' THEN 'all_year'
    WHEN 'post_shoot_issue_remediation' THEN 'all_year'
    WHEN 'resource_issue_follow_up' THEN 'all_year'
    WHEN 'digital_production_delivery' THEN 'all_year'
    ELSE COALESCE(season_key, 'all_year')
  END
WHERE tenant_id IS NOT NULL;

ALTER TABLE production_project_template
  ALTER COLUMN workflow_family SET NOT NULL,
  ALTER COLUMN workflow_mode SET NOT NULL,
  ALTER COLUMN season_key SET NOT NULL;

CREATE INDEX IF NOT EXISTS production_project_template_workflow_lookup_idx
  ON production_project_template (tenant_id, workflow_family, workflow_mode, season_key, active_status);

INSERT INTO production_project_template (
  tenant_id,
  template_key,
  name,
  description,
  default_priority,
  category,
  default_stage,
  peer_review_required,
  final_qc_required,
  job_type,
  workflow_family,
  workflow_mode,
  season_key
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
  seeded.final_qc_required,
  seeded.job_type::production_project_job_type,
  seeded.workflow_family,
  seeded.workflow_mode,
  seeded.season_key
FROM tenant
CROSS JOIN (
  VALUES
    (
      'school_spring_production_wrap',
      'School Spring Production Wrap',
      'Season-aware spring production wrap for school work entering post-production.',
      'high',
      'photography_production',
      'in_production',
      true,
      true,
      'standard_school_production',
      'schools',
      'post_shoot_wrap',
      'spring'
    ),
    (
      'school_fall_production_wrap',
      'School Fall Production Wrap',
      'Season-aware fall production wrap for school work entering post-production.',
      'high',
      'photography_production',
      'in_production',
      true,
      true,
      'standard_school_production',
      'schools',
      'post_shoot_wrap',
      'fall'
    ),
    (
      'sports_post_production_wrap',
      'Sports Production Wrap',
      'Sports-specific production wrap for event work entering post-production.',
      'high',
      'photography_production',
      'in_production',
      true,
      true,
      'sports_production',
      'sports',
      'post_shoot_wrap',
      'all_year'
    )
) AS seeded(
  template_key,
  name,
  description,
  default_priority,
  category,
  default_stage,
  peer_review_required,
  final_qc_required,
  job_type,
  workflow_family,
  workflow_mode,
  season_key
)
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
  sort_order,
  task_type,
  handoff_required,
  blocks_release
)
SELECT
  template.tenant_id,
  template.id,
  seeded.task_key,
  seeded.title,
  seeded.summary,
  seeded.due_offset_days,
  seeded.required,
  seeded.sort_order,
  seeded.task_type::production_project_task_type,
  seeded.handoff_required,
  seeded.blocks_release
FROM production_project_template template
JOIN (
  VALUES
    (
      'school_spring_production_wrap',
      'confirm_spring_scope',
      'Confirm spring volume scope and comments',
      'Carry forward shoot comments, account context, and spring delivery expectations before production starts.',
      0,
      true,
      0,
      'production',
      false,
      false
    ),
    (
      'school_spring_production_wrap',
      'prepare_spring_package',
      'Build spring package and correction path',
      'Finish the spring production package, check correction needs, and prepare the handoff for review.',
      1,
      true,
      1,
      'production',
      false,
      false
    ),
    (
      'school_spring_production_wrap',
      'peer_review_pass',
      'Peer review the spring package',
      'Run the spring package through peer review before final QC.',
      2,
      true,
      2,
      'peer_review',
      true,
      true
    ),
    (
      'school_spring_production_wrap',
      'final_qc_signoff',
      'Final QC signoff',
      'Clear final QC before the spring package is marked ready to send.',
      3,
      true,
      3,
      'final_qc',
      true,
      true
    ),
    (
      'school_spring_production_wrap',
      'release_assets',
      'Release spring assets',
      'Send the approved spring package and capture the release note.',
      4,
      true,
      4,
      'release',
      true,
      false
    ),
    (
      'school_fall_production_wrap',
      'confirm_fall_scope',
      'Confirm fall volume scope and comments',
      'Carry forward fall shoot comments, photographer notes, and account context before production starts.',
      0,
      true,
      0,
      'production',
      false,
      false
    ),
    (
      'school_fall_production_wrap',
      'prepare_fall_package',
      'Build fall package and correction path',
      'Complete the fall package, confirm any corrections, and stage it for peer review.',
      1,
      true,
      1,
      'production',
      false,
      false
    ),
    (
      'school_fall_production_wrap',
      'peer_review_pass',
      'Peer review the fall package',
      'Run the fall package through peer review before final QC.',
      2,
      true,
      2,
      'peer_review',
      true,
      true
    ),
    (
      'school_fall_production_wrap',
      'final_qc_signoff',
      'Final QC signoff',
      'Clear final QC before the fall package is marked ready to send.',
      3,
      true,
      3,
      'final_qc',
      true,
      true
    ),
    (
      'school_fall_production_wrap',
      'release_assets',
      'Release fall assets',
      'Send the approved fall package and record the release note.',
      4,
      true,
      4,
      'release',
      true,
      false
    ),
    (
      'sports_post_production_wrap',
      'confirm_event_scope',
      'Confirm event scope and comments',
      'Carry forward sports-event notes, account context, and output expectations before production starts.',
      0,
      true,
      0,
      'production',
      false,
      false
    ),
    (
      'sports_post_production_wrap',
      'build_sports_package',
      'Build sports package and select path',
      'Prepare the sports package, capture any corrections, and get it ready for review.',
      1,
      true,
      1,
      'production',
      false,
      false
    ),
    (
      'sports_post_production_wrap',
      'peer_review_pass',
      'Peer review the sports package',
      'Run the sports package through peer review before final QC.',
      2,
      true,
      2,
      'peer_review',
      true,
      true
    ),
    (
      'sports_post_production_wrap',
      'final_qc_signoff',
      'Final QC signoff',
      'Clear final QC before the sports package is marked ready to send.',
      3,
      true,
      3,
      'final_qc',
      true,
      true
    ),
    (
      'sports_post_production_wrap',
      'release_assets',
      'Release sports assets',
      'Send the approved sports package and record the release note.',
      4,
      true,
      4,
      'release',
      true,
      false
    )
) AS seeded(
  template_key,
  task_key,
  title,
  summary,
  due_offset_days,
  required,
  sort_order,
  task_type,
  handoff_required,
  blocks_release
)
  ON seeded.template_key = template.template_key
WHERE NOT EXISTS (
  SELECT 1
  FROM production_project_template_task existing
  WHERE existing.tenant_id = template.tenant_id
    AND existing.template_id = template.id
    AND existing.task_key = seeded.task_key
);

INSERT INTO production_project_template_task_dependency (
  tenant_id,
  template_id,
  task_template_id,
  depends_on_template_task_id
)
SELECT
  template.tenant_id,
  template.id,
  child.id,
  parent.id
FROM production_project_template template
JOIN (
  VALUES
    ('school_spring_production_wrap', 'prepare_spring_package', 'confirm_spring_scope'),
    ('school_spring_production_wrap', 'peer_review_pass', 'prepare_spring_package'),
    ('school_spring_production_wrap', 'final_qc_signoff', 'peer_review_pass'),
    ('school_spring_production_wrap', 'release_assets', 'final_qc_signoff'),
    ('school_fall_production_wrap', 'prepare_fall_package', 'confirm_fall_scope'),
    ('school_fall_production_wrap', 'peer_review_pass', 'prepare_fall_package'),
    ('school_fall_production_wrap', 'final_qc_signoff', 'peer_review_pass'),
    ('school_fall_production_wrap', 'release_assets', 'final_qc_signoff'),
    ('sports_post_production_wrap', 'build_sports_package', 'confirm_event_scope'),
    ('sports_post_production_wrap', 'peer_review_pass', 'build_sports_package'),
    ('sports_post_production_wrap', 'final_qc_signoff', 'peer_review_pass'),
    ('sports_post_production_wrap', 'release_assets', 'final_qc_signoff')
) AS dep(template_key, child_task_key, parent_task_key)
  ON dep.template_key = template.template_key
JOIN production_project_template_task child
  ON child.tenant_id = template.tenant_id
 AND child.template_id = template.id
 AND child.task_key = dep.child_task_key
JOIN production_project_template_task parent
  ON parent.tenant_id = template.tenant_id
 AND parent.template_id = template.id
 AND parent.task_key = dep.parent_task_key
WHERE NOT EXISTS (
  SELECT 1
  FROM production_project_template_task_dependency existing
  WHERE existing.tenant_id = template.tenant_id
    AND existing.template_id = template.id
    AND existing.task_template_id = child.id
    AND existing.depends_on_template_task_id = parent.id
);

INSERT INTO production_project_trigger_rule (
  tenant_id,
  trigger_key,
  template_id,
  name,
  description,
  default_due_offset_days,
  default_follow_up_offset_days
)
SELECT
  template.tenant_id,
  seeded.trigger_key,
  template.id,
  seeded.name,
  seeded.description,
  seeded.default_due_offset_days,
  seeded.default_follow_up_offset_days
FROM production_project_template template
JOIN (
  VALUES
    (
      'school_spring_production_wrap',
      'shoot_completed_post_production_schools_spring',
      'School spring post-production intake',
      'Create a spring school production job when a school shoot moves into post-production.',
      2,
      1
    ),
    (
      'school_fall_production_wrap',
      'shoot_completed_post_production_schools_fall',
      'School fall post-production intake',
      'Create a fall school production job when a school shoot moves into post-production.',
      2,
      1
    ),
    (
      'sports_post_production_wrap',
      'shoot_completed_post_production_sports',
      'Sports post-production intake',
      'Create a sports production job when a sports shoot moves into post-production.',
      2,
      1
    )
) AS seeded(template_key, trigger_key, name, description, default_due_offset_days, default_follow_up_offset_days)
  ON seeded.template_key = template.template_key
WHERE NOT EXISTS (
  SELECT 1
  FROM production_project_trigger_rule existing
  WHERE existing.tenant_id = template.tenant_id
    AND existing.trigger_key = seeded.trigger_key
);
