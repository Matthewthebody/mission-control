ALTER TABLE qa_review_records
  ADD COLUMN IF NOT EXISTS question_answers_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS issue_category text,
  ADD COLUMN IF NOT EXISTS override_same_reviewer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS override_reason text,
  ADD COLUMN IF NOT EXISTS original_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accountability_stage_key text,
  ADD COLUMN IF NOT EXISTS accountable_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accountable_reviewer_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS qa_review_records_stage_idx
  ON qa_review_records (tenant_id, production_item_id, review_stage, created_at DESC);

CREATE INDEX IF NOT EXISTS qa_review_records_accountability_idx
  ON qa_review_records (tenant_id, accountable_reviewer_user_id, accountable_owner_user_id, created_at DESC);

UPDATE qa_review_records review
SET
  question_answers_json = COALESCE(review.question_answers_json, '{}'::jsonb),
  original_owner_user_id = COALESCE(review.original_owner_user_id, item.assigned_to_user_id)
FROM production_items item
WHERE item.id = review.production_item_id
  AND item.tenant_id = review.tenant_id
  AND (
    review.question_answers_json IS NULL
    OR review.original_owner_user_id IS NULL
  );

INSERT INTO permission (code, name, description, resource_type, action_group)
VALUES (
  'qa.self_review_override',
  'Override Peer Self Review',
  'Allow an explicitly audited peer review assignment to the same owner when operational coverage requires it.',
  'qa_review',
  'override'
)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  resource_type = EXCLUDED.resource_type,
  action_group = EXCLUDED.action_group,
  updated_at = now();

WITH seeded(role_code, scope_type, scope_value, permission_codes) AS (
  VALUES
    ('admin', 'global', NULL, ARRAY['qa.self_review_override']::text[]),
    ('leadership', 'global', NULL, ARRAY['qa.self_review_override']::text[]),
    ('production_manager', 'global', NULL, ARRAY['qa.self_review_override']::text[])
)
INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect)
SELECT role.id, permission.id, seeded.scope_type::policy_scope_type, seeded.scope_value, 'allow'::policy_effect_type
FROM seeded
JOIN role ON role.code = seeded.role_code
JOIN permission ON permission.code = ANY (seeded.permission_codes)
ON CONFLICT DO NOTHING;
