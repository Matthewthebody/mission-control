CREATE TABLE IF NOT EXISTS global_search_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('organization', 'contact', 'location', 'shoot', 'production_item', 'task')),
  entity_id uuid NOT NULL,
  title text NOT NULL,
  subtitle text,
  body_search_text text,
  status text,
  department text,
  org_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  org_name text,
  owner_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  assignee_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  related_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  primary_date timestamptz,
  risk_level text,
  permissions_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  deep_link text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  activity_at timestamptz,
  search_document tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(subtitle, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(org_name, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(body_search_text, '')), 'C')
  ) STORED,
  UNIQUE (tenant_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS global_search_recent_search (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  normalized_query text NOT NULL,
  query_text text NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  use_count integer NOT NULL DEFAULT 1,
  selected_search_index_id uuid REFERENCES global_search_index(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, normalized_query)
);

CREATE INDEX IF NOT EXISTS global_search_index_tenant_entity_idx
  ON global_search_index (tenant_id, entity_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS global_search_index_tenant_org_idx
  ON global_search_index (tenant_id, org_id);

CREATE INDEX IF NOT EXISTS global_search_index_search_document_idx
  ON global_search_index
  USING gin (search_document);

CREATE INDEX IF NOT EXISTS global_search_index_title_trgm_idx
  ON global_search_index
  USING gin (lower(title) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS global_search_index_subtitle_trgm_idx
  ON global_search_index
  USING gin (lower(coalesce(subtitle, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS global_search_index_org_name_trgm_idx
  ON global_search_index
  USING gin (lower(coalesce(org_name, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS global_search_index_body_trgm_idx
  ON global_search_index
  USING gin (lower(coalesce(body_search_text, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS global_search_recent_search_user_idx
  ON global_search_recent_search (tenant_id, user_id, last_used_at DESC);

CREATE OR REPLACE FUNCTION refresh_global_search_index_organization(p_tenant_id uuid, p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM global_search_index
  WHERE tenant_id = p_tenant_id
    AND entity_type = 'organization'
    AND entity_id = p_organization_id
    AND NOT EXISTS (
      SELECT 1
      FROM organization o
      WHERE o.tenant_id = p_tenant_id
        AND o.id = p_organization_id
    );

  INSERT INTO global_search_index (
    tenant_id,
    entity_type,
    entity_id,
    title,
    subtitle,
    body_search_text,
    status,
    department,
    org_id,
    org_name,
    owner_id,
    assignee_ids,
    related_ids,
    primary_date,
    risk_level,
    permissions_payload,
    deep_link,
    updated_at,
    activity_at
  )
  SELECT
    o.tenant_id,
    'organization',
    o.id,
    o.display_name,
    initcap(replace(o.account_type::text, '_', ' ')),
    concat_ws(
      ' ',
      o.canonical_name,
      o.notes,
      alias_snapshot.alias_text
    ),
    o.active_status::text,
    CASE
      WHEN o.account_type::text LIKE 'schools%' THEN 'schools'
      WHEN o.account_type::text = 'sports' THEN 'sports'
      WHEN o.account_type::text = 'headshots' THEN 'headshots'
      ELSE null
    END,
    o.id,
    o.display_name,
    null,
    ARRAY[]::uuid[],
    ARRAY[o.id],
    null,
    CASE WHEN o.active_status::text <> 'active' THEN 'warning' ELSE null END,
    jsonb_build_object('access_model', 'directory'),
    '#directory/organizations?organization=' || o.id::text || '&tab=profile',
    o.updated_at,
    o.updated_at
  FROM organization o
  LEFT JOIN LATERAL (
    SELECT string_agg(alias, ' ' ORDER BY alias) AS alias_text
    FROM organization_alias oa
    WHERE oa.tenant_id = o.tenant_id
      AND oa.organization_id = o.id
  ) alias_snapshot ON true
  WHERE o.tenant_id = p_tenant_id
    AND o.id = p_organization_id
  ON CONFLICT (tenant_id, entity_type, entity_id)
  DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    body_search_text = EXCLUDED.body_search_text,
    status = EXCLUDED.status,
    department = EXCLUDED.department,
    org_id = EXCLUDED.org_id,
    org_name = EXCLUDED.org_name,
    owner_id = EXCLUDED.owner_id,
    assignee_ids = EXCLUDED.assignee_ids,
    related_ids = EXCLUDED.related_ids,
    primary_date = EXCLUDED.primary_date,
    risk_level = EXCLUDED.risk_level,
    permissions_payload = EXCLUDED.permissions_payload,
    deep_link = EXCLUDED.deep_link,
    updated_at = EXCLUDED.updated_at,
    activity_at = EXCLUDED.activity_at;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_global_search_index_contact(p_tenant_id uuid, p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM global_search_index
  WHERE tenant_id = p_tenant_id
    AND entity_type = 'contact'
    AND entity_id = p_contact_id
    AND NOT EXISTS (
      SELECT 1
      FROM organization_contact contact_row
      WHERE contact_row.tenant_id = p_tenant_id
        AND contact_row.id = p_contact_id
    );

  INSERT INTO global_search_index (
    tenant_id,
    entity_type,
    entity_id,
    title,
    subtitle,
    body_search_text,
    status,
    department,
    org_id,
    org_name,
    owner_id,
    assignee_ids,
    related_ids,
    primary_date,
    risk_level,
    permissions_payload,
    deep_link,
    updated_at,
    activity_at
  )
  SELECT
    contact_row.tenant_id,
    'contact',
    contact_row.id,
    contact_row.full_name,
    concat_ws(' | ', org.display_name, contact_row.title),
    concat_ws(
      ' ',
      contact_row.email,
      contact_row.phone,
      contact_row.notes,
      contact_row.role_category::text,
      contact_row.operational_importance::text
    ),
    contact_row.contact_status::text,
    CASE
      WHEN org.account_type::text LIKE 'schools%' THEN 'schools'
      WHEN org.account_type::text = 'sports' THEN 'sports'
      WHEN org.account_type::text = 'headshots' THEN 'headshots'
      ELSE null
    END,
    contact_row.organization_id,
    org.display_name,
    contact_row.primary_internal_owner_user_id,
    array_remove(
      ARRAY[contact_row.primary_internal_owner_user_id, contact_row.backup_internal_owner_user_id]::uuid[],
      null::uuid
    ),
    array_remove(ARRAY[contact_row.organization_id]::uuid[], null::uuid),
    null,
    CASE
      WHEN contact_row.uncertainty_flag OR contact_row.contact_status::text = 'needs_review' THEN 'warning'
      ELSE contact_row.operational_importance::text
    END,
    jsonb_build_object('access_model', 'directory'),
    '#directory/contacts?view=contacts&contact=' || contact_row.id::text || '&tab=relationships',
    contact_row.updated_at,
    contact_row.updated_at
  FROM organization_contact contact_row
  JOIN organization org
    ON org.tenant_id = contact_row.tenant_id
   AND org.id = contact_row.organization_id
  WHERE contact_row.tenant_id = p_tenant_id
    AND contact_row.id = p_contact_id
  ON CONFLICT (tenant_id, entity_type, entity_id)
  DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    body_search_text = EXCLUDED.body_search_text,
    status = EXCLUDED.status,
    department = EXCLUDED.department,
    org_id = EXCLUDED.org_id,
    org_name = EXCLUDED.org_name,
    owner_id = EXCLUDED.owner_id,
    assignee_ids = EXCLUDED.assignee_ids,
    related_ids = EXCLUDED.related_ids,
    primary_date = EXCLUDED.primary_date,
    risk_level = EXCLUDED.risk_level,
    permissions_payload = EXCLUDED.permissions_payload,
    deep_link = EXCLUDED.deep_link,
    updated_at = EXCLUDED.updated_at,
    activity_at = EXCLUDED.activity_at;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_global_search_index_location(p_tenant_id uuid, p_location_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM global_search_index
  WHERE tenant_id = p_tenant_id
    AND entity_type = 'location'
    AND entity_id = p_location_id
    AND NOT EXISTS (
      SELECT 1
      FROM shoot_location location_row
      WHERE location_row.tenant_id = p_tenant_id
        AND location_row.id = p_location_id
        AND location_row.organization_id IS NOT NULL
    );

  INSERT INTO global_search_index (
    tenant_id,
    entity_type,
    entity_id,
    title,
    subtitle,
    body_search_text,
    status,
    department,
    org_id,
    org_name,
    owner_id,
    assignee_ids,
    related_ids,
    primary_date,
    risk_level,
    permissions_payload,
    deep_link,
    updated_at,
    activity_at
  )
  SELECT
    location_row.tenant_id,
    'location',
    location_row.id,
    location_row.name,
    org.display_name,
    concat_ws(
      ' ',
      location_row.address_line_1,
      location_row.address_line_2,
      location_row.city,
      location_row.state,
      location_row.zip,
      location_row.maps_label,
      location_row.location_details,
      location_row.commentary,
      alias_snapshot.alias_text
    ),
    location_row.active_status::text,
    CASE
      WHEN org.account_type::text LIKE 'schools%' THEN 'schools'
      WHEN org.account_type::text = 'sports' THEN 'sports'
      WHEN org.account_type::text = 'headshots' THEN 'headshots'
      ELSE null
    END,
    location_row.organization_id,
    org.display_name,
    null,
    ARRAY[]::uuid[],
    array_remove(ARRAY[location_row.organization_id, location_row.id]::uuid[], null::uuid),
    null,
    CASE WHEN location_row.active_status::text <> 'active' THEN 'warning' ELSE null END,
    jsonb_build_object('access_model', 'directory'),
    '#directory/locations?view=locations&location=' || location_row.id::text || '&tab=relationships',
    location_row.updated_at,
    location_row.updated_at
  FROM shoot_location location_row
  JOIN organization org
    ON org.tenant_id = location_row.tenant_id
   AND org.id = location_row.organization_id
  LEFT JOIN LATERAL (
    SELECT string_agg(alias, ' ' ORDER BY alias) AS alias_text
    FROM shoot_location_alias alias_row
    WHERE alias_row.tenant_id = location_row.tenant_id
      AND alias_row.location_id = location_row.id
  ) alias_snapshot ON true
  WHERE location_row.tenant_id = p_tenant_id
    AND location_row.id = p_location_id
    AND location_row.organization_id IS NOT NULL
  ON CONFLICT (tenant_id, entity_type, entity_id)
  DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    body_search_text = EXCLUDED.body_search_text,
    status = EXCLUDED.status,
    department = EXCLUDED.department,
    org_id = EXCLUDED.org_id,
    org_name = EXCLUDED.org_name,
    owner_id = EXCLUDED.owner_id,
    assignee_ids = EXCLUDED.assignee_ids,
    related_ids = EXCLUDED.related_ids,
    primary_date = EXCLUDED.primary_date,
    risk_level = EXCLUDED.risk_level,
    permissions_payload = EXCLUDED.permissions_payload,
    deep_link = EXCLUDED.deep_link,
    updated_at = EXCLUDED.updated_at,
    activity_at = EXCLUDED.activity_at;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_global_search_index_shoot(p_tenant_id uuid, p_shoot_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM global_search_index
  WHERE tenant_id = p_tenant_id
    AND entity_type = 'shoot'
    AND entity_id = p_shoot_id
    AND NOT EXISTS (
      SELECT 1
      FROM shoot s
      WHERE s.tenant_id = p_tenant_id
        AND s.id = p_shoot_id
        AND s.deleted_at IS NULL
    );

  INSERT INTO global_search_index (
    tenant_id,
    entity_type,
    entity_id,
    title,
    subtitle,
    body_search_text,
    status,
    department,
    org_id,
    org_name,
    owner_id,
    assignee_ids,
    related_ids,
    primary_date,
    risk_level,
    permissions_payload,
    deep_link,
    updated_at,
    activity_at
  )
  SELECT
    s.tenant_id,
    'shoot',
    s.id,
    s.title,
    concat_ws(' | ', s.shoot_code, org.display_name, coalesce(location_row.name, s.location_name)),
    concat_ws(
      ' ',
      s.title,
      s.shoot_code,
      org.display_name,
      coalesce(location_row.name, s.location_name),
      s.special_instructions,
      s.access_notes,
      s.setup_notes,
      s.day_of_notes,
      s.internal_notes
    ),
    s.status::text,
    s.department::text,
    s.organization_id,
    org.display_name,
    coalesce(s.readiness_owner_user_id, s.created_by),
    coalesce(permission_snapshot.assignee_ids, ARRAY[]::uuid[]),
    array_remove(ARRAY[s.organization_id, s.location_id, s.primary_contact_id]::uuid[], null::uuid),
    coalesce(s.showtime, s.start_time, s.arrival_time),
    coalesce(s.operations_priority::text, s.post_production_substage::text),
    jsonb_build_object('access_model', 'shoot', 'department', s.department::text),
    '#photography/shoots?shoot=' || s.id::text,
    s.updated_at,
    greatest(s.updated_at, s.start_time)
  FROM shoot s
  LEFT JOIN organization org
    ON org.tenant_id = s.tenant_id
   AND org.id = s.organization_id
  LEFT JOIN shoot_location location_row
    ON location_row.tenant_id = s.tenant_id
   AND location_row.id = s.location_id
  LEFT JOIN LATERAL (
    SELECT
      array_remove(
        ARRAY(
          SELECT DISTINCT assigned_user_id
          FROM (
            SELECT sa.user_id AS assigned_user_id
            FROM shoot_assignment sa
            WHERE sa.tenant_id = s.tenant_id
              AND sa.shoot_id = s.id
            UNION
            SELECT ws.assigned_user_id
            FROM work_shift ws
            WHERE ws.tenant_id = s.tenant_id
              AND ws.shoot_id = s.id
              AND ws.cancelled_at IS NULL
              AND ws.status = 'published'
          ) scoped_users
        )::uuid[],
        null::uuid
      ) AS assignee_ids
  ) permission_snapshot ON true
  WHERE s.tenant_id = p_tenant_id
    AND s.id = p_shoot_id
    AND s.deleted_at IS NULL
  ON CONFLICT (tenant_id, entity_type, entity_id)
  DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    body_search_text = EXCLUDED.body_search_text,
    status = EXCLUDED.status,
    department = EXCLUDED.department,
    org_id = EXCLUDED.org_id,
    org_name = EXCLUDED.org_name,
    owner_id = EXCLUDED.owner_id,
    assignee_ids = EXCLUDED.assignee_ids,
    related_ids = EXCLUDED.related_ids,
    primary_date = EXCLUDED.primary_date,
    risk_level = EXCLUDED.risk_level,
    permissions_payload = EXCLUDED.permissions_payload,
    deep_link = EXCLUDED.deep_link,
    updated_at = EXCLUDED.updated_at,
    activity_at = EXCLUDED.activity_at;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_global_search_index_production_item(p_tenant_id uuid, p_production_item_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM global_search_index
  WHERE tenant_id = p_tenant_id
    AND entity_type = 'production_item'
    AND entity_id = p_production_item_id
    AND NOT EXISTS (
      SELECT 1
      FROM production_items item
      WHERE item.tenant_id = p_tenant_id
        AND item.id = p_production_item_id
        AND item.merged_into_production_item_id IS NULL
    );

  INSERT INTO global_search_index (
    tenant_id,
    entity_type,
    entity_id,
    title,
    subtitle,
    body_search_text,
    status,
    department,
    org_id,
    org_name,
    owner_id,
    assignee_ids,
    related_ids,
    primary_date,
    risk_level,
    permissions_payload,
    deep_link,
    updated_at,
    activity_at
  )
  SELECT
    item.tenant_id,
    'production_item',
    item.id,
    item.title,
    concat_ws(' | ', item.production_type, job.job_number, org.display_name),
    concat_ws(
      ' ',
      item.title,
      item.production_type,
      job.title,
      job.job_number,
      org.display_name,
      item.blocked_reason
    ),
    coalesce(item.workflow_status::text, item.status::text),
    item.department_type::text,
    job.organization_id,
    org.display_name,
    job.account_owner_user_id,
    coalesce(permission_snapshot.assignee_ids, ARRAY[]::uuid[]),
    array_remove(ARRAY[item.job_id, job.organization_id, job.primary_location_id, job.primary_contact_id]::uuid[], null::uuid),
    coalesce(item.release_due_at, item.due_at),
    item.health_state::text,
    jsonb_build_object('access_model', 'production_item', 'department', item.department_type::text),
    '#production?item=' || item.id::text,
    item.updated_at,
    item.updated_at
  FROM production_items item
  JOIN jobs job
    ON job.tenant_id = item.tenant_id
   AND job.id = item.job_id
  LEFT JOIN organization org
    ON org.tenant_id = job.tenant_id
   AND org.id = job.organization_id
  LEFT JOIN LATERAL (
    SELECT
      array_remove(
        ARRAY(
          SELECT DISTINCT user_id
          FROM (
            SELECT item.assigned_to_user_id AS user_id
            UNION
            SELECT job.account_owner_user_id
            UNION
            SELECT job.created_by_user_id
            UNION
            SELECT assignment.user_id
            FROM job_staff_assignments assignment
            WHERE assignment.tenant_id = item.tenant_id
              AND assignment.job_id = item.job_id
          ) scoped_users
        )::uuid[],
        null::uuid
      ) AS assignee_ids
  ) permission_snapshot ON true
  WHERE item.tenant_id = p_tenant_id
    AND item.id = p_production_item_id
    AND item.merged_into_production_item_id IS NULL
  ON CONFLICT (tenant_id, entity_type, entity_id)
  DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    body_search_text = EXCLUDED.body_search_text,
    status = EXCLUDED.status,
    department = EXCLUDED.department,
    org_id = EXCLUDED.org_id,
    org_name = EXCLUDED.org_name,
    owner_id = EXCLUDED.owner_id,
    assignee_ids = EXCLUDED.assignee_ids,
    related_ids = EXCLUDED.related_ids,
    primary_date = EXCLUDED.primary_date,
    risk_level = EXCLUDED.risk_level,
    permissions_payload = EXCLUDED.permissions_payload,
    deep_link = EXCLUDED.deep_link,
    updated_at = EXCLUDED.updated_at,
    activity_at = EXCLUDED.activity_at;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_global_search_index_task(p_tenant_id uuid, p_task_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM global_search_index
  WHERE tenant_id = p_tenant_id
    AND entity_type = 'task'
    AND entity_id = p_task_id
    AND NOT EXISTS (
      SELECT 1
      FROM work_task task_row
      WHERE task_row.tenant_id = p_tenant_id
        AND task_row.id = p_task_id
    );

  INSERT INTO global_search_index (
    tenant_id,
    entity_type,
    entity_id,
    title,
    subtitle,
    body_search_text,
    status,
    department,
    org_id,
    org_name,
    owner_id,
    assignee_ids,
    related_ids,
    primary_date,
    risk_level,
    permissions_payload,
    deep_link,
    updated_at,
    activity_at
  )
  SELECT
    task_row.tenant_id,
    'task',
    task_row.id,
    task_row.title,
    concat_ws(' | ', task_row.task_number, org.display_name, job.title),
    concat_ws(
      ' ',
      task_row.title,
      task_row.description,
      task_row.task_type,
      task_row.blocked_reason,
      job.job_number,
      job.title,
      org.display_name
    ),
    task_row.status::text,
    task_row.department_type::text,
    job.organization_id,
    org.display_name,
    task_row.created_by_user_id,
    array_remove(ARRAY[task_row.assigned_to_user_id]::uuid[], null::uuid),
    array_remove(ARRAY[task_row.related_job_id, job.organization_id]::uuid[], null::uuid),
    task_row.due_at,
    CASE
      WHEN task_row.status::text = 'blocked' THEN 'blocked'
      WHEN task_row.priority::text IN ('urgent', 'high') THEN task_row.priority::text
      ELSE null
    END,
    jsonb_build_object(
      'access_model',
      'task',
      'department',
      task_row.department_type::text,
      'created_by_user_id',
      task_row.created_by_user_id
    ),
    '#tasks/' || task_row.id::text,
    task_row.updated_at,
    task_row.updated_at
  FROM work_task task_row
  LEFT JOIN jobs job
    ON job.tenant_id = task_row.tenant_id
   AND job.id = task_row.related_job_id
  LEFT JOIN organization org
    ON org.tenant_id = job.tenant_id
   AND org.id = job.organization_id
  WHERE task_row.tenant_id = p_tenant_id
    AND task_row.id = p_task_id
  ON CONFLICT (tenant_id, entity_type, entity_id)
  DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    body_search_text = EXCLUDED.body_search_text,
    status = EXCLUDED.status,
    department = EXCLUDED.department,
    org_id = EXCLUDED.org_id,
    org_name = EXCLUDED.org_name,
    owner_id = EXCLUDED.owner_id,
    assignee_ids = EXCLUDED.assignee_ids,
    related_ids = EXCLUDED.related_ids,
    primary_date = EXCLUDED.primary_date,
    risk_level = EXCLUDED.risk_level,
    permissions_payload = EXCLUDED.permissions_payload,
    deep_link = EXCLUDED.deep_link,
    updated_at = EXCLUDED.updated_at,
    activity_at = EXCLUDED.activity_at;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_global_search_index_job_dependents(p_tenant_id uuid, p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  dependent_row record;
BEGIN
  FOR dependent_row IN
    SELECT id
    FROM production_items
    WHERE tenant_id = p_tenant_id
      AND job_id = p_job_id
      AND merged_into_production_item_id IS NULL
  LOOP
    PERFORM refresh_global_search_index_production_item(p_tenant_id, dependent_row.id);
  END LOOP;

  FOR dependent_row IN
    SELECT id
    FROM work_task
    WHERE tenant_id = p_tenant_id
      AND related_job_id = p_job_id
  LOOP
    PERFORM refresh_global_search_index_task(p_tenant_id, dependent_row.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_global_search_index_organization_dependents(p_tenant_id uuid, p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  dependent_row record;
BEGIN
  PERFORM refresh_global_search_index_organization(p_tenant_id, p_organization_id);

  FOR dependent_row IN
    SELECT id
    FROM organization_contact
    WHERE tenant_id = p_tenant_id
      AND organization_id = p_organization_id
  LOOP
    PERFORM refresh_global_search_index_contact(p_tenant_id, dependent_row.id);
  END LOOP;

  FOR dependent_row IN
    SELECT id
    FROM shoot_location
    WHERE tenant_id = p_tenant_id
      AND organization_id = p_organization_id
  LOOP
    PERFORM refresh_global_search_index_location(p_tenant_id, dependent_row.id);
  END LOOP;

  FOR dependent_row IN
    SELECT id
    FROM shoot
    WHERE tenant_id = p_tenant_id
      AND organization_id = p_organization_id
      AND deleted_at IS NULL
  LOOP
    PERFORM refresh_global_search_index_shoot(p_tenant_id, dependent_row.id);
  END LOOP;

  FOR dependent_row IN
    SELECT id
    FROM jobs
    WHERE tenant_id = p_tenant_id
      AND organization_id = p_organization_id
  LOOP
    PERFORM refresh_global_search_index_job_dependents(p_tenant_id, dependent_row.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_global_search_index_location_dependents(p_tenant_id uuid, p_location_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  dependent_row record;
BEGIN
  PERFORM refresh_global_search_index_location(p_tenant_id, p_location_id);

  FOR dependent_row IN
    SELECT id
    FROM shoot
    WHERE tenant_id = p_tenant_id
      AND location_id = p_location_id
      AND deleted_at IS NULL
  LOOP
    PERFORM refresh_global_search_index_shoot(p_tenant_id, dependent_row.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_global_search_index_from_organization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_organization_dependents(coalesce(NEW.tenant_id, OLD.tenant_id), coalesce(NEW.id, OLD.id));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_global_search_index_from_organization_alias()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_organization(coalesce(NEW.tenant_id, OLD.tenant_id), coalesce(NEW.organization_id, OLD.organization_id));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_global_search_index_from_contact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_contact(coalesce(NEW.tenant_id, OLD.tenant_id), coalesce(NEW.id, OLD.id));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_global_search_index_from_location()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_location_dependents(coalesce(NEW.tenant_id, OLD.tenant_id), coalesce(NEW.id, OLD.id));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_global_search_index_from_location_alias()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_location(coalesce(NEW.tenant_id, OLD.tenant_id), coalesce(NEW.location_id, OLD.location_id));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_global_search_index_from_shoot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_shoot(coalesce(NEW.tenant_id, OLD.tenant_id), coalesce(NEW.id, OLD.id));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_global_search_index_from_shoot_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_shoot(coalesce(NEW.tenant_id, OLD.tenant_id), coalesce(NEW.shoot_id, OLD.shoot_id));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_global_search_index_from_work_shift()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(NEW.shoot_id, OLD.shoot_id) IS NOT NULL THEN
    PERFORM refresh_global_search_index_shoot(coalesce(NEW.tenant_id, OLD.tenant_id), coalesce(NEW.shoot_id, OLD.shoot_id));
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_global_search_index_from_job()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_job_dependents(coalesce(NEW.tenant_id, OLD.tenant_id), coalesce(NEW.id, OLD.id));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_global_search_index_from_job_staff_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_job_dependents(coalesce(NEW.tenant_id, OLD.tenant_id), coalesce(NEW.job_id, OLD.job_id));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_global_search_index_from_production_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_production_item(coalesce(NEW.tenant_id, OLD.tenant_id), coalesce(NEW.id, OLD.id));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_global_search_index_from_task()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_task(coalesce(NEW.tenant_id, OLD.tenant_id), coalesce(NEW.id, OLD.id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS global_search_index_refresh_organization ON organization;
CREATE TRIGGER global_search_index_refresh_organization
AFTER INSERT OR UPDATE OR DELETE ON organization
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_global_search_index_from_organization();

DROP TRIGGER IF EXISTS global_search_index_refresh_organization_alias ON organization_alias;
CREATE TRIGGER global_search_index_refresh_organization_alias
AFTER INSERT OR UPDATE OR DELETE ON organization_alias
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_global_search_index_from_organization_alias();

DROP TRIGGER IF EXISTS global_search_index_refresh_contact ON organization_contact;
CREATE TRIGGER global_search_index_refresh_contact
AFTER INSERT OR UPDATE OR DELETE ON organization_contact
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_global_search_index_from_contact();

DROP TRIGGER IF EXISTS global_search_index_refresh_location ON shoot_location;
CREATE TRIGGER global_search_index_refresh_location
AFTER INSERT OR UPDATE OR DELETE ON shoot_location
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_global_search_index_from_location();

DROP TRIGGER IF EXISTS global_search_index_refresh_location_alias ON shoot_location_alias;
CREATE TRIGGER global_search_index_refresh_location_alias
AFTER INSERT OR UPDATE OR DELETE ON shoot_location_alias
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_global_search_index_from_location_alias();

DROP TRIGGER IF EXISTS global_search_index_refresh_shoot ON shoot;
CREATE TRIGGER global_search_index_refresh_shoot
AFTER INSERT OR UPDATE OR DELETE ON shoot
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_global_search_index_from_shoot();

DROP TRIGGER IF EXISTS global_search_index_refresh_shoot_assignment ON shoot_assignment;
CREATE TRIGGER global_search_index_refresh_shoot_assignment
AFTER INSERT OR UPDATE OR DELETE ON shoot_assignment
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_global_search_index_from_shoot_assignment();

DROP TRIGGER IF EXISTS global_search_index_refresh_work_shift ON work_shift;
CREATE TRIGGER global_search_index_refresh_work_shift
AFTER INSERT OR UPDATE OR DELETE ON work_shift
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_global_search_index_from_work_shift();

DROP TRIGGER IF EXISTS global_search_index_refresh_job ON jobs;
CREATE TRIGGER global_search_index_refresh_job
AFTER INSERT OR UPDATE OR DELETE ON jobs
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_global_search_index_from_job();

DROP TRIGGER IF EXISTS global_search_index_refresh_job_staff_assignment ON job_staff_assignments;
CREATE TRIGGER global_search_index_refresh_job_staff_assignment
AFTER INSERT OR UPDATE OR DELETE ON job_staff_assignments
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_global_search_index_from_job_staff_assignment();

DROP TRIGGER IF EXISTS global_search_index_refresh_production_item ON production_items;
CREATE TRIGGER global_search_index_refresh_production_item
AFTER INSERT OR UPDATE OR DELETE ON production_items
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_global_search_index_from_production_item();

DROP TRIGGER IF EXISTS global_search_index_refresh_task ON work_task;
CREATE TRIGGER global_search_index_refresh_task
AFTER INSERT OR UPDATE OR DELETE ON work_task
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_global_search_index_from_task();

SELECT refresh_global_search_index_organization(tenant_id, id) FROM organization;
SELECT refresh_global_search_index_contact(tenant_id, id) FROM organization_contact;
SELECT refresh_global_search_index_location(tenant_id, id) FROM shoot_location WHERE organization_id IS NOT NULL;
SELECT refresh_global_search_index_shoot(tenant_id, id) FROM shoot WHERE deleted_at IS NULL;
SELECT refresh_global_search_index_production_item(tenant_id, id) FROM production_items WHERE merged_into_production_item_id IS NULL;
SELECT refresh_global_search_index_task(tenant_id, id) FROM work_task;
