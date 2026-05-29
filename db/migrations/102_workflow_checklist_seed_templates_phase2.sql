ALTER TABLE checklist_template_versions
  ADD COLUMN IF NOT EXISTS assignment_defaults_json jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE checklist_template_versions
SET assignment_defaults_json = '{}'::jsonb
WHERE assignment_defaults_json IS NULL;

ALTER TABLE checklist_template_versions
  DROP CONSTRAINT IF EXISTS checklist_template_versions_assignment_defaults_object_chk;

ALTER TABLE checklist_template_versions
  ADD CONSTRAINT checklist_template_versions_assignment_defaults_object_chk
  CHECK (jsonb_typeof(assignment_defaults_json) = 'object');
