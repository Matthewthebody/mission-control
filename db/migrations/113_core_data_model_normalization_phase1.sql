CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.apply_standard_audit_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_user_id uuid := app.current_user_id();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by_user_id IS NULL THEN
      NEW.created_by_user_id = current_user_id;
    END IF;
    IF NEW.updated_by_user_id IS NULL THEN
      NEW.updated_by_user_id = COALESCE(current_user_id, NEW.created_by_user_id);
    END IF;
    IF NEW.created_at IS NULL THEN
      NEW.created_at = now();
    END IF;
    IF NEW.updated_at IS NULL THEN
      NEW.updated_at = now();
    END IF;
  ELSE
    IF current_user_id IS NOT NULL THEN
      NEW.updated_by_user_id = current_user_id;
    END IF;
    NEW.updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE organization
  ADD COLUMN IF NOT EXISTS primary_location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS primary_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;

ALTER TABLE job_days
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;

ALTER TABLE job_staff_assignments
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;

ALTER TABLE production_items
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;

ALTER TABLE post_shoot_evaluation
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_day_id uuid REFERENCES job_days(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;

ALTER TABLE operational_note
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES work_shift(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_day_id uuid REFERENCES job_days(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL;

ALTER TABLE activity_log_entries
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL;

UPDATE app_user
SET updated_at = GREATEST(
  COALESCE(updated_at, created_at),
  COALESCE(last_login_at, created_at),
  COALESCE(approved_at, created_at),
  COALESCE(invited_at, created_at),
  COALESCE(suspended_at, created_at),
  COALESCE(revoked_at, created_at)
)
WHERE updated_at IS NULL
   OR updated_at = created_at;

UPDATE organization org
SET
  primary_location_id = COALESCE(org.primary_location_id, sp.primary_location_id),
  account_owner_user_id = COALESCE(org.account_owner_user_id, sp.primary_internal_owner_user_id)
FROM school_profile sp
WHERE sp.organization_id = org.id
  AND (
    org.primary_location_id IS NULL
    OR org.account_owner_user_id IS NULL
  );

WITH organizations_with_one_active_contact AS (
  SELECT
    tenant_id,
    organization_id,
    min(id::text)::uuid AS contact_id
  FROM organization_contact
  WHERE active_status = 'active'
  GROUP BY tenant_id, organization_id
  HAVING count(*) = 1
)
UPDATE organization org
SET primary_contact_id = single_contact.contact_id
FROM organizations_with_one_active_contact single_contact
WHERE org.tenant_id = single_contact.tenant_id
  AND org.id = single_contact.organization_id
  AND org.primary_contact_id IS NULL;

UPDATE job_days job_day
SET
  created_by_user_id = COALESCE(job_day.created_by_user_id, job.created_by_user_id),
  updated_by_user_id = COALESCE(job_day.updated_by_user_id, job.updated_by_user_id, job.created_by_user_id)
FROM jobs job
WHERE job.id = job_day.job_id
  AND job.tenant_id = job_day.tenant_id
  AND (
    job_day.created_by_user_id IS NULL
    OR job_day.updated_by_user_id IS NULL
  );

WITH assignment_audit_context AS (
  SELECT
    assignment.id,
    assignment.tenant_id,
    COALESCE(shift.created_by_user_id, shift.published_by_user_id) AS shift_actor_user_id,
    job.created_by_user_id AS job_created_by_user_id,
    job.updated_by_user_id AS job_updated_by_user_id
  FROM job_staff_assignments assignment
  JOIN jobs job
    ON job.id = assignment.job_id
   AND job.tenant_id = assignment.tenant_id
  LEFT JOIN work_shift shift
    ON shift.tenant_id = assignment.tenant_id
   AND shift.id = assignment.legacy_work_shift_id
)
UPDATE job_staff_assignments assignment
SET
  created_by_user_id = COALESCE(
    assignment.created_by_user_id,
    context.shift_actor_user_id,
    context.job_created_by_user_id
  ),
  updated_by_user_id = COALESCE(
    assignment.updated_by_user_id,
    context.shift_actor_user_id,
    context.job_updated_by_user_id,
    context.job_created_by_user_id
  )
FROM assignment_audit_context context
WHERE context.tenant_id = assignment.tenant_id
  AND context.id = assignment.id
  AND (
    assignment.created_by_user_id IS NULL
    OR assignment.updated_by_user_id IS NULL
  );

UPDATE production_items item
SET
  created_by_user_id = COALESCE(item.created_by_user_id, job.created_by_user_id),
  updated_by_user_id = COALESCE(item.updated_by_user_id, job.updated_by_user_id, job.created_by_user_id)
FROM jobs job
WHERE job.id = item.job_id
  AND job.tenant_id = item.tenant_id
  AND (
    item.created_by_user_id IS NULL
    OR item.updated_by_user_id IS NULL
  );

WITH evaluation_job_context AS (
  SELECT
    pse.id,
    COALESCE(primary_job.id, linked_job.id) AS resolved_job_id,
    (
      SELECT jd.id
      FROM job_days jd
      WHERE jd.tenant_id = pse.tenant_id
        AND jd.job_id = COALESCE(primary_job.id, linked_job.id)
      ORDER BY
        CASE
          WHEN pse.shoot_date IS NOT NULL AND jd.date = pse.shoot_date THEN 0
          WHEN pse.shift_id IS NOT NULL AND EXISTS (
            SELECT 1
            FROM work_shift ws
            WHERE ws.tenant_id = pse.tenant_id
              AND ws.id = pse.shift_id
              AND ws.starts_at::date = jd.date
          ) THEN 1
          ELSE 2
        END,
        jd.date ASC,
        jd.created_at ASC
      LIMIT 1
    ) AS resolved_job_day_id,
    COALESCE(pse.submitted_by_user_id, pse.photographer_user_id) AS resolved_created_by_user_id,
    COALESCE(pse.reviewed_by_user_id, pse.closed_by_user_id, pse.submitted_by_user_id, pse.photographer_user_id) AS resolved_updated_by_user_id
  FROM post_shoot_evaluation pse
  LEFT JOIN jobs primary_job
    ON primary_job.tenant_id = pse.tenant_id
   AND primary_job.legacy_shoot_id = pse.shoot_id
  LEFT JOIN LATERAL (
    SELECT jsl.job_id
    FROM job_shoot_links jsl
    WHERE jsl.tenant_id = pse.tenant_id
      AND jsl.shoot_id = pse.shoot_id
    ORDER BY jsl.created_at ASC
    LIMIT 1
  ) linked_job_ref ON true
  LEFT JOIN jobs linked_job
    ON linked_job.id = linked_job_ref.job_id
)
UPDATE post_shoot_evaluation pse
SET
  job_id = COALESCE(pse.job_id, context.resolved_job_id),
  job_day_id = COALESCE(pse.job_day_id, context.resolved_job_day_id),
  created_by_user_id = COALESCE(pse.created_by_user_id, context.resolved_created_by_user_id),
  updated_by_user_id = COALESCE(pse.updated_by_user_id, context.resolved_updated_by_user_id),
  organization_id = COALESCE(pse.organization_id, job.organization_id),
  location_id = COALESCE(pse.location_id, job_day.location_id, job.primary_location_id)
FROM evaluation_job_context context
LEFT JOIN jobs job
  ON job.id = context.resolved_job_id
LEFT JOIN job_days job_day
  ON job_day.id = context.resolved_job_day_id
WHERE pse.id = context.id
  AND (
    pse.job_id IS NULL
    OR pse.job_day_id IS NULL
    OR pse.created_by_user_id IS NULL
    OR pse.updated_by_user_id IS NULL
    OR pse.organization_id IS NULL
    OR pse.location_id IS NULL
  );

WITH note_context AS (
  SELECT
    note.id,
    CASE
      WHEN note.object_type = 'shift' THEN note.object_id
      ELSE NULL
    END AS resolved_shift_id,
    COALESCE(
      shift_job.id,
      shoot_job.id,
      alert_job.id,
      existing_job.id
    ) AS resolved_job_id,
    COALESCE(
      shift_job_day.id,
      shoot_job_day.id,
      alert_job_day.id,
      existing_job_day.id
    ) AS resolved_job_day_id,
    COALESCE(
      shift_org.id,
      shoot_org.id,
      alert_org.id,
      location_org.id,
      existing_org.id
    ) AS resolved_organization_id,
    COALESCE(
      shift_location.id,
      shoot_location.id,
      alert_location.id,
      direct_location.id,
      existing_location.id
    ) AS resolved_location_id,
    COALESCE(
      shift_contact.id,
      shoot_contact.id,
      alert_contact.id,
      existing_contact.id
    ) AS resolved_contact_id
  FROM operational_note note
  LEFT JOIN work_shift shift
    ON note.object_type = 'shift'
   AND shift.tenant_id = note.tenant_id
   AND shift.id = note.object_id
  LEFT JOIN jobs shift_job
    ON shift_job.tenant_id = note.tenant_id
   AND shift_job.legacy_shoot_id = shift.shoot_id
  LEFT JOIN LATERAL (
    SELECT jd.id, jd.location_id
    FROM job_days jd
    WHERE jd.tenant_id = note.tenant_id
      AND jd.job_id = shift_job.id
    ORDER BY
      CASE
        WHEN shift.starts_at::date = jd.date THEN 0
        ELSE 1
      END,
      jd.date ASC,
      jd.created_at ASC
    LIMIT 1
  ) shift_job_day ON true
  LEFT JOIN organization shift_org
    ON shift_org.id = shift_job.organization_id
  LEFT JOIN shoot_location shift_location
    ON shift_location.id = COALESCE(shift_job_day.location_id, shift_job.primary_location_id)
  LEFT JOIN organization_contact shift_contact
    ON shift_contact.id = shift_job.primary_contact_id
  LEFT JOIN jobs shoot_job
    ON note.object_type = 'shoot'
   AND shoot_job.tenant_id = note.tenant_id
   AND shoot_job.legacy_shoot_id = note.object_id
  LEFT JOIN LATERAL (
    SELECT jd.id, jd.location_id
    FROM job_days jd
    WHERE jd.tenant_id = note.tenant_id
      AND jd.job_id = shoot_job.id
    ORDER BY jd.date ASC, jd.created_at ASC
    LIMIT 1
  ) shoot_job_day ON true
  LEFT JOIN organization shoot_org
    ON shoot_org.id = shoot_job.organization_id
  LEFT JOIN shoot_location shoot_location
    ON shoot_location.id = COALESCE(shoot_job_day.location_id, shoot_job.primary_location_id)
  LEFT JOIN organization_contact shoot_contact
    ON shoot_contact.id = shoot_job.primary_contact_id
  LEFT JOIN alert legacy_alert
    ON note.object_type = 'alert'
   AND legacy_alert.tenant_id = note.tenant_id
   AND legacy_alert.id = note.object_id
  LEFT JOIN jobs alert_job
    ON alert_job.tenant_id = note.tenant_id
   AND alert_job.legacy_shoot_id = legacy_alert.shoot_id
  LEFT JOIN LATERAL (
    SELECT jd.id, jd.location_id
    FROM job_days jd
    WHERE jd.tenant_id = note.tenant_id
      AND jd.job_id = alert_job.id
    ORDER BY jd.date ASC, jd.created_at ASC
    LIMIT 1
  ) alert_job_day ON true
  LEFT JOIN organization alert_org
    ON alert_org.id = alert_job.organization_id
  LEFT JOIN shoot_location alert_location
    ON alert_location.id = COALESCE(alert_job_day.location_id, alert_job.primary_location_id)
  LEFT JOIN organization_contact alert_contact
    ON alert_contact.id = alert_job.primary_contact_id
  LEFT JOIN shoot_location direct_location
    ON note.object_type = 'location'
   AND direct_location.tenant_id = note.tenant_id
   AND direct_location.id = note.object_id
  LEFT JOIN organization location_org
    ON location_org.id = direct_location.organization_id
  LEFT JOIN jobs existing_job
    ON existing_job.id = note.job_id
  LEFT JOIN job_days existing_job_day
    ON existing_job_day.id = note.job_day_id
  LEFT JOIN organization existing_org
    ON existing_org.id = note.organization_id
  LEFT JOIN shoot_location existing_location
    ON existing_location.id = note.location_id
  LEFT JOIN organization_contact existing_contact
    ON existing_contact.id = note.contact_id
)
UPDATE operational_note note
SET
  shift_id = COALESCE(note.shift_id, context.resolved_shift_id),
  job_id = COALESCE(note.job_id, context.resolved_job_id),
  job_day_id = COALESCE(note.job_day_id, context.resolved_job_day_id),
  organization_id = COALESCE(note.organization_id, context.resolved_organization_id),
  location_id = COALESCE(note.location_id, context.resolved_location_id),
  contact_id = COALESCE(note.contact_id, context.resolved_contact_id)
FROM note_context context
WHERE note.id = context.id
  AND (
    note.shift_id IS NULL
    OR note.job_id IS NULL
    OR note.job_day_id IS NULL
    OR note.organization_id IS NULL
    OR note.location_id IS NULL
    OR note.contact_id IS NULL
  );

WITH activity_context AS (
  SELECT
    activity.id,
    COALESCE(
      direct_job.organization_id,
      item_job.organization_id
    ) AS resolved_organization_id,
    COALESCE(
      direct_job_day.location_id,
      direct_job.primary_location_id,
      item_job_day.location_id,
      item_job.primary_location_id
    ) AS resolved_location_id,
    COALESCE(
      direct_job.primary_contact_id,
      item_job.primary_contact_id
    ) AS resolved_contact_id
  FROM activity_log_entries activity
  LEFT JOIN jobs direct_job
    ON direct_job.id = activity.job_id
  LEFT JOIN job_days direct_job_day
    ON direct_job_day.id = activity.job_day_id
  LEFT JOIN production_items item
    ON item.id = activity.production_item_id
  LEFT JOIN jobs item_job
    ON item_job.id = item.job_id
  LEFT JOIN job_days item_job_day
    ON item_job_day.id = item.job_day_id
)
UPDATE activity_log_entries activity
SET
  organization_id = COALESCE(activity.organization_id, context.resolved_organization_id),
  location_id = COALESCE(activity.location_id, context.resolved_location_id),
  contact_id = COALESCE(activity.contact_id, context.resolved_contact_id)
FROM activity_context context
WHERE activity.id = context.id
  AND (
    activity.organization_id IS NULL
    OR activity.location_id IS NULL
    OR activity.contact_id IS NULL
  );

CREATE INDEX IF NOT EXISTS organization_tenant_owner_idx
  ON organization (tenant_id, account_owner_user_id)
  WHERE account_owner_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS organization_tenant_primary_location_idx
  ON organization (tenant_id, primary_location_id)
  WHERE primary_location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS organization_tenant_primary_contact_idx
  ON organization (tenant_id, primary_contact_id)
  WHERE primary_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS post_shoot_evaluation_tenant_job_idx
  ON post_shoot_evaluation (tenant_id, job_id, shoot_date DESC)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS post_shoot_evaluation_tenant_job_day_idx
  ON post_shoot_evaluation (tenant_id, job_day_id, created_at DESC)
  WHERE job_day_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS operational_note_tenant_job_idx
  ON operational_note (tenant_id, job_id, created_at DESC)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS operational_note_tenant_location_idx
  ON operational_note (tenant_id, location_id, created_at DESC)
  WHERE location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS operational_note_tenant_organization_idx
  ON operational_note (tenant_id, organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS activity_log_entries_tenant_organization_idx
  ON activity_log_entries (tenant_id, organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS activity_log_entries_tenant_location_idx
  ON activity_log_entries (tenant_id, location_id, created_at DESC)
  WHERE location_id IS NOT NULL;

CREATE OR REPLACE FUNCTION app.sync_post_shoot_evaluation_core_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_user_id uuid := app.current_user_id();
  resolved_job_id uuid := NEW.job_id;
  resolved_job_day_id uuid := NEW.job_day_id;
  resolved_organization_id uuid := NEW.organization_id;
  resolved_location_id uuid := NEW.location_id;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by_user_id IS NULL THEN
      NEW.created_by_user_id = COALESCE(current_user_id, NEW.submitted_by_user_id, NEW.photographer_user_id);
    END IF;
    IF NEW.updated_by_user_id IS NULL THEN
      NEW.updated_by_user_id = COALESCE(current_user_id, NEW.reviewed_by_user_id, NEW.closed_by_user_id, NEW.created_by_user_id);
    END IF;
  ELSE
    IF current_user_id IS NOT NULL THEN
      NEW.updated_by_user_id = current_user_id;
    ELSIF NEW.closed_by_user_id IS NOT NULL THEN
      NEW.updated_by_user_id = NEW.closed_by_user_id;
    ELSIF NEW.reviewed_by_user_id IS NOT NULL THEN
      NEW.updated_by_user_id = NEW.reviewed_by_user_id;
    END IF;
  END IF;

  IF resolved_job_id IS NULL AND NEW.shoot_id IS NOT NULL THEN
    SELECT COALESCE(primary_job.id, linked_job.job_id)
    INTO resolved_job_id
    FROM (
      SELECT j.id
      FROM jobs j
      WHERE j.tenant_id = NEW.tenant_id
        AND j.legacy_shoot_id = NEW.shoot_id
      ORDER BY j.created_at ASC
      LIMIT 1
    ) primary_job
    FULL OUTER JOIN (
      SELECT jsl.job_id
      FROM job_shoot_links jsl
      WHERE jsl.tenant_id = NEW.tenant_id
        AND jsl.shoot_id = NEW.shoot_id
      ORDER BY jsl.created_at ASC
      LIMIT 1
    ) linked_job ON true;
  END IF;

  IF resolved_job_day_id IS NULL AND resolved_job_id IS NOT NULL THEN
    SELECT jd.id
    INTO resolved_job_day_id
    FROM job_days jd
    WHERE jd.tenant_id = NEW.tenant_id
      AND jd.job_id = resolved_job_id
    ORDER BY
      CASE
        WHEN NEW.shoot_date IS NOT NULL AND jd.date = NEW.shoot_date THEN 0
        WHEN NEW.shift_id IS NOT NULL AND EXISTS (
          SELECT 1
          FROM work_shift ws
          WHERE ws.tenant_id = NEW.tenant_id
            AND ws.id = NEW.shift_id
            AND ws.starts_at::date = jd.date
        ) THEN 1
        ELSE 2
      END,
      jd.date ASC,
      jd.created_at ASC
    LIMIT 1;
  END IF;

  IF resolved_organization_id IS NULL AND resolved_job_id IS NOT NULL THEN
    SELECT j.organization_id
    INTO resolved_organization_id
    FROM jobs j
    WHERE j.tenant_id = NEW.tenant_id
      AND j.id = resolved_job_id
    LIMIT 1;
  END IF;

  IF resolved_location_id IS NULL AND resolved_job_day_id IS NOT NULL THEN
    SELECT jd.location_id
    INTO resolved_location_id
    FROM job_days jd
    WHERE jd.tenant_id = NEW.tenant_id
      AND jd.id = resolved_job_day_id
    LIMIT 1;
  END IF;

  IF resolved_location_id IS NULL AND resolved_job_id IS NOT NULL THEN
    SELECT j.primary_location_id
    INTO resolved_location_id
    FROM jobs j
    WHERE j.tenant_id = NEW.tenant_id
      AND j.id = resolved_job_id
    LIMIT 1;
  END IF;

  NEW.job_id = COALESCE(NEW.job_id, resolved_job_id);
  NEW.job_day_id = COALESCE(NEW.job_day_id, resolved_job_day_id);
  NEW.organization_id = COALESCE(NEW.organization_id, resolved_organization_id);
  NEW.location_id = COALESCE(NEW.location_id, resolved_location_id);
  NEW.updated_at = now();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.sync_operational_note_core_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  resolved_shift_id uuid := NEW.shift_id;
  resolved_job_id uuid := NEW.job_id;
  resolved_job_day_id uuid := NEW.job_day_id;
  resolved_organization_id uuid := NEW.organization_id;
  resolved_location_id uuid := NEW.location_id;
  resolved_contact_id uuid := NEW.contact_id;
BEGIN
  IF NEW.object_type = 'shift' THEN
    resolved_shift_id := COALESCE(resolved_shift_id, NEW.object_id);
  END IF;

  IF NEW.object_type = 'shoot' AND resolved_job_id IS NULL THEN
    SELECT j.id, j.organization_id, j.primary_location_id, j.primary_contact_id
    INTO resolved_job_id, resolved_organization_id, resolved_location_id, resolved_contact_id
    FROM jobs j
    WHERE j.tenant_id = NEW.tenant_id
      AND j.legacy_shoot_id = NEW.object_id
    ORDER BY j.created_at ASC
    LIMIT 1;
  ELSIF NEW.object_type = 'shift' THEN
    SELECT
      j.id,
      jd.id,
      j.organization_id,
      COALESCE(jd.location_id, j.primary_location_id),
      j.primary_contact_id
    INTO
      resolved_job_id,
      resolved_job_day_id,
      resolved_organization_id,
      resolved_location_id,
      resolved_contact_id
    FROM work_shift ws
    LEFT JOIN jobs j
      ON j.tenant_id = ws.tenant_id
     AND j.legacy_shoot_id = ws.shoot_id
    LEFT JOIN LATERAL (
      SELECT day_row.id, day_row.location_id
      FROM job_days day_row
      WHERE day_row.tenant_id = ws.tenant_id
        AND day_row.job_id = j.id
      ORDER BY
        CASE
          WHEN ws.starts_at::date = day_row.date THEN 0
          ELSE 1
        END,
        day_row.date ASC,
        day_row.created_at ASC
      LIMIT 1
    ) jd ON true
    WHERE ws.tenant_id = NEW.tenant_id
      AND ws.id = NEW.object_id
    LIMIT 1;
  ELSIF NEW.object_type = 'location' THEN
    SELECT sl.organization_id, sl.id
    INTO resolved_organization_id, resolved_location_id
    FROM shoot_location sl
    WHERE sl.tenant_id = NEW.tenant_id
      AND sl.id = NEW.object_id
    LIMIT 1;
  ELSIF NEW.object_type = 'alert' THEN
    SELECT
      j.id,
      jd.id,
      j.organization_id,
      COALESCE(jd.location_id, j.primary_location_id),
      j.primary_contact_id
    INTO
      resolved_job_id,
      resolved_job_day_id,
      resolved_organization_id,
      resolved_location_id,
      resolved_contact_id
    FROM alert legacy_alert
    LEFT JOIN jobs j
      ON j.tenant_id = legacy_alert.tenant_id
     AND j.legacy_shoot_id = legacy_alert.shoot_id
    LEFT JOIN LATERAL (
      SELECT day_row.id, day_row.location_id
      FROM job_days day_row
      WHERE day_row.tenant_id = legacy_alert.tenant_id
        AND day_row.job_id = j.id
      ORDER BY day_row.date ASC, day_row.created_at ASC
      LIMIT 1
    ) jd ON true
    WHERE legacy_alert.tenant_id = NEW.tenant_id
      AND legacy_alert.id = NEW.object_id
    LIMIT 1;
  END IF;

  NEW.shift_id = COALESCE(NEW.shift_id, resolved_shift_id);
  NEW.job_id = COALESCE(NEW.job_id, resolved_job_id);
  NEW.job_day_id = COALESCE(NEW.job_day_id, resolved_job_day_id);
  NEW.organization_id = COALESCE(NEW.organization_id, resolved_organization_id);
  NEW.location_id = COALESCE(NEW.location_id, resolved_location_id);
  NEW.contact_id = COALESCE(NEW.contact_id, resolved_contact_id);

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.populate_activity_log_context()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  resolved_job_id uuid := NEW.job_id;
  resolved_organization_id uuid := NEW.organization_id;
  resolved_location_id uuid := NEW.location_id;
  resolved_contact_id uuid := NEW.contact_id;
BEGIN
  IF resolved_job_id IS NULL AND NEW.production_item_id IS NOT NULL THEN
    SELECT item.job_id, item.location_id
    INTO resolved_job_id, resolved_location_id
    FROM production_items item
    WHERE item.tenant_id = NEW.tenant_id
      AND item.id = NEW.production_item_id
    LIMIT 1;
  END IF;

  IF resolved_job_id IS NOT NULL THEN
    SELECT j.organization_id, COALESCE(resolved_location_id, j.primary_location_id), j.primary_contact_id
    INTO resolved_organization_id, resolved_location_id, resolved_contact_id
    FROM jobs j
    WHERE j.tenant_id = NEW.tenant_id
      AND j.id = resolved_job_id
    LIMIT 1;
  END IF;

  IF NEW.job_day_id IS NOT NULL THEN
    SELECT COALESCE(jd.location_id, resolved_location_id)
    INTO resolved_location_id
    FROM job_days jd
    WHERE jd.tenant_id = NEW.tenant_id
      AND jd.id = NEW.job_day_id
    LIMIT 1;
  END IF;

  NEW.organization_id = COALESCE(NEW.organization_id, resolved_organization_id);
  NEW.location_id = COALESCE(NEW.location_id, resolved_location_id);
  NEW.contact_id = COALESCE(NEW.contact_id, resolved_contact_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_user_touch_updated_at ON app_user;
CREATE TRIGGER trg_app_user_touch_updated_at
BEFORE UPDATE ON app_user
FOR EACH ROW
EXECUTE FUNCTION app.touch_updated_at();

DROP TRIGGER IF EXISTS trg_organization_standard_audit_fields ON organization;
CREATE TRIGGER trg_organization_standard_audit_fields
BEFORE INSERT OR UPDATE ON organization
FOR EACH ROW
EXECUTE FUNCTION app.apply_standard_audit_fields();

DROP TRIGGER IF EXISTS trg_organization_contact_standard_audit_fields ON organization_contact;
CREATE TRIGGER trg_organization_contact_standard_audit_fields
BEFORE INSERT OR UPDATE ON organization_contact
FOR EACH ROW
EXECUTE FUNCTION app.apply_standard_audit_fields();

DROP TRIGGER IF EXISTS trg_shoot_location_standard_audit_fields ON shoot_location;
CREATE TRIGGER trg_shoot_location_standard_audit_fields
BEFORE INSERT OR UPDATE ON shoot_location
FOR EACH ROW
EXECUTE FUNCTION app.apply_standard_audit_fields();

DROP TRIGGER IF EXISTS trg_jobs_standard_audit_fields ON jobs;
CREATE TRIGGER trg_jobs_standard_audit_fields
BEFORE INSERT OR UPDATE ON jobs
FOR EACH ROW
EXECUTE FUNCTION app.apply_standard_audit_fields();

DROP TRIGGER IF EXISTS trg_job_days_standard_audit_fields ON job_days;
CREATE TRIGGER trg_job_days_standard_audit_fields
BEFORE INSERT OR UPDATE ON job_days
FOR EACH ROW
EXECUTE FUNCTION app.apply_standard_audit_fields();

DROP TRIGGER IF EXISTS trg_job_staff_assignments_standard_audit_fields ON job_staff_assignments;
CREATE TRIGGER trg_job_staff_assignments_standard_audit_fields
BEFORE INSERT OR UPDATE ON job_staff_assignments
FOR EACH ROW
EXECUTE FUNCTION app.apply_standard_audit_fields();

DROP TRIGGER IF EXISTS trg_production_items_standard_audit_fields ON production_items;
CREATE TRIGGER trg_production_items_standard_audit_fields
BEFORE INSERT OR UPDATE ON production_items
FOR EACH ROW
EXECUTE FUNCTION app.apply_standard_audit_fields();

DROP TRIGGER IF EXISTS trg_work_task_standard_audit_fields ON work_task;
CREATE TRIGGER trg_work_task_standard_audit_fields
BEFORE INSERT OR UPDATE ON work_task
FOR EACH ROW
EXECUTE FUNCTION app.apply_standard_audit_fields();

DROP TRIGGER IF EXISTS trg_post_shoot_evaluation_core_links ON post_shoot_evaluation;
CREATE TRIGGER trg_post_shoot_evaluation_core_links
BEFORE INSERT OR UPDATE OF shoot_id, shift_id, shoot_date, submitted_by_user_id, reviewed_by_user_id, closed_by_user_id ON post_shoot_evaluation
FOR EACH ROW
EXECUTE FUNCTION app.sync_post_shoot_evaluation_core_links();

DROP TRIGGER IF EXISTS trg_operational_note_core_links ON operational_note;
CREATE TRIGGER trg_operational_note_core_links
BEFORE INSERT OR UPDATE OF object_type, object_id ON operational_note
FOR EACH ROW
EXECUTE FUNCTION app.sync_operational_note_core_links();

DROP TRIGGER IF EXISTS trg_activity_log_entries_context ON activity_log_entries;
CREATE TRIGGER trg_activity_log_entries_context
BEFORE INSERT OR UPDATE OF job_id, job_day_id, production_item_id ON activity_log_entries
FOR EACH ROW
EXECUTE FUNCTION app.populate_activity_log_context();
