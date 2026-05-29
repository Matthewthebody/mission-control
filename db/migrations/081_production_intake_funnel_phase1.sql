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
      'digital_production_delivery',
      'school_gallery_release_intake',
      'School gallery release intake',
      'Create a canonical production job when gallery-release work is active in the school operations engine.',
      0,
      1
    ),
    (
      'digital_production_delivery',
      'school_id_production_intake',
      'School ID production intake',
      'Create a canonical production job when school ID work is active in the school operations engine.',
      0,
      1
    ),
    (
      'digital_production_delivery',
      'school_yearbook_intake',
      'School yearbook intake',
      'Create a canonical production job when yearbook work is active in the school operations engine.',
      0,
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
