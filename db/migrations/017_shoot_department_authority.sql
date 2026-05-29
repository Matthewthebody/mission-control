ALTER TABLE shoot
  ADD COLUMN IF NOT EXISTS department department_code NOT NULL DEFAULT 'operations';

WITH inferred_department AS (
  SELECT
    s.id,
    COALESCE(
      (
        SELECT ws.department
        FROM work_shift ws
        WHERE ws.shoot_id = s.id
          AND ws.cancelled_at IS NULL
        ORDER BY
          CASE ws.department
            WHEN 'schools' THEN 0
            WHEN 'sports' THEN 0
            ELSE 1
          END,
          ws.created_at ASC
        LIMIT 1
      ),
      CASE
        WHEN s.shoot_code ILIKE '%SPORT%' OR s.title ILIKE '%sport%' OR s.location_name ILIKE '%stadium%' THEN 'sports'::department_code
        WHEN s.shoot_code ILIKE '%SCHOOL%' OR s.title ILIKE '%school%' OR s.title ILIKE '%portrait%' THEN 'schools'::department_code
        ELSE 'operations'::department_code
      END
    ) AS department
  FROM shoot s
)
UPDATE shoot s
SET department = inferred_department.department
FROM inferred_department
WHERE inferred_department.id = s.id;

CREATE INDEX IF NOT EXISTS shoot_tenant_department_idx ON shoot (tenant_id, department, shoot_date);
