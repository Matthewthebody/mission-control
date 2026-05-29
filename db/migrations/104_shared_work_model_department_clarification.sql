DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_department_type') THEN
    CREATE TYPE work_department_type AS ENUM ('schools', 'sports', 'production', 'photography', 'operations', 'other');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'work_task'
      AND column_name = 'department_type'
      AND udt_name = 'job_department_type'
  ) THEN
    ALTER TABLE work_task
      ALTER COLUMN department_type DROP DEFAULT;

    ALTER TABLE work_task
      ALTER COLUMN department_type TYPE work_department_type
      USING (
        CASE department_type::text
          WHEN 'schools' THEN 'schools'
          WHEN 'sports' THEN 'sports'
          ELSE 'other'
        END
      )::work_department_type;
  END IF;
END $$;

WITH seeded(role_code, scope_type, scope_value, permission_codes) AS (
  VALUES
    ('photographer_lead', 'department', 'photography', ARRAY['task.create','task.read','task.update','task.assign']::text[])
)
INSERT INTO role_permission_grant (role_id, permission_id, scope_type, scope_value, effect)
SELECT role.id, permission.id, seeded.scope_type::policy_scope_type, seeded.scope_value, 'allow'::policy_effect_type
FROM seeded
JOIN role ON role.code = seeded.role_code
JOIN permission ON permission.code = ANY (seeded.permission_codes)
ON CONFLICT DO NOTHING;
