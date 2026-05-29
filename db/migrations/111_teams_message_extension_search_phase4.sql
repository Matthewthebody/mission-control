ALTER TABLE global_search_index
  DROP CONSTRAINT IF EXISTS global_search_index_entity_type_check;

ALTER TABLE global_search_index
  ADD CONSTRAINT global_search_index_entity_type_check
  CHECK (
    entity_type IN (
      'organization',
      'contact',
      'location',
      'shoot',
      'production_item',
      'task',
      'resource_library_item',
      'note',
      'comment',
      'staffing_assignment',
      'urgent_watch_alert',
      'post_shoot_evaluation'
    )
  );

CREATE OR REPLACE FUNCTION refresh_global_search_index_resource_library_item(p_tenant_id uuid, p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM global_search_index
  WHERE tenant_id = p_tenant_id
    AND entity_type = 'resource_library_item'
    AND entity_id = p_item_id
    AND NOT EXISTS (
      SELECT 1
      FROM resource_library_item r
      WHERE r.tenant_id = p_tenant_id
        AND r.id = p_item_id
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
    activity_at,
    has_notes,
    has_alerts,
    has_staffing_gap
  )
  SELECT
    r.tenant_id,
    'resource_library_item',
    r.id,
    r.file_name,
    concat_ws(
      ' | ',
      coalesce(s.shoot_code, s.title, sl.name, o.display_name, 'Linked file'),
      initcap(replace(r.category::text, '_', ' '))
    ),
    concat_ws(
      ' ',
      r.file_name,
      r.note,
      r.issue_type,
      r.resource_type::text,
      r.category::text,
      r.upload_source::text,
      r.best_reference_category::text,
      o.display_name,
      sl.name,
      s.shoot_code,
      s.title,
      coalesce(r.uploader_name, uploader.full_name)
    ),
    r.approval_status::text,
    s.department::text,
    r.organization_id,
    o.display_name,
    r.uploader_user_id,
    ARRAY[]::uuid[],
    array_remove(ARRAY[r.organization_id, r.location_id, r.shoot_id]::uuid[], null::uuid),
    coalesce(r.captured_at, s.shoot_date::timestamptz, r.created_at),
    CASE
      WHEN r.approval_status::text IN ('pending_review', 'leadership_only') THEN 'warning'
      WHEN r.category::text = 'issue_concern' THEN 'high'
      ELSE null
    END,
    jsonb_build_object(
      'access_model', 'resource_library_item',
      'linked_scope', CASE
        WHEN r.shoot_id IS NOT NULL THEN 'shoot'
        WHEN r.location_id IS NOT NULL THEN 'location'
        ELSE 'organization'
      END,
      'department', s.department::text,
      'visibility_scope', r.visibility_scope::text,
      'approval_status', r.approval_status::text,
      'is_best_reference', r.is_best_reference,
      'uploader_user_id', r.uploader_user_id
    ),
    CASE
      WHEN r.shoot_id IS NOT NULL THEN '#photography/shoots?shoot=' || r.shoot_id::text
      WHEN r.location_id IS NOT NULL THEN '#directory/locations?location=' || r.location_id::text
      WHEN r.organization_id IS NOT NULL THEN '#directory/organizations?organization=' || r.organization_id::text
      ELSE '#directory/locations'
    END,
    r.updated_at,
    coalesce(r.captured_at, r.updated_at),
    coalesce(nullif(btrim(coalesce(r.note, '')), ''), null) IS NOT NULL,
    false,
    false
  FROM resource_library_item r
  LEFT JOIN organization o
    ON o.tenant_id = r.tenant_id
   AND o.id = r.organization_id
  LEFT JOIN shoot_location sl
    ON sl.tenant_id = r.tenant_id
   AND sl.id = r.location_id
  LEFT JOIN shoot s
    ON s.tenant_id = r.tenant_id
   AND s.id = r.shoot_id
  LEFT JOIN app_user uploader
    ON uploader.tenant_id = r.tenant_id
   AND uploader.id = r.uploader_user_id
  WHERE r.tenant_id = p_tenant_id
    AND r.id = p_item_id
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
    activity_at = EXCLUDED.activity_at,
    has_notes = EXCLUDED.has_notes,
    has_alerts = EXCLUDED.has_alerts,
    has_staffing_gap = EXCLUDED.has_staffing_gap;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_global_search_index_resource_library_items_by_organization(p_tenant_id uuid, p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  item_row record;
BEGIN
  FOR item_row IN
    SELECT id
    FROM resource_library_item
    WHERE tenant_id = p_tenant_id
      AND organization_id = p_organization_id
  LOOP
    PERFORM refresh_global_search_index_resource_library_item(p_tenant_id, item_row.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_global_search_index_resource_library_items_by_location(p_tenant_id uuid, p_location_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  item_row record;
BEGIN
  FOR item_row IN
    SELECT id
    FROM resource_library_item
    WHERE tenant_id = p_tenant_id
      AND location_id = p_location_id
  LOOP
    PERFORM refresh_global_search_index_resource_library_item(p_tenant_id, item_row.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_global_search_index_resource_library_items_by_shoot(p_tenant_id uuid, p_shoot_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  item_row record;
BEGIN
  FOR item_row IN
    SELECT id
    FROM resource_library_item
    WHERE tenant_id = p_tenant_id
      AND shoot_id = p_shoot_id
  LOOP
    PERFORM refresh_global_search_index_resource_library_item(p_tenant_id, item_row.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION handle_global_search_index_resource_library_item_refresh()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_resource_library_item(
    coalesce(NEW.tenant_id, OLD.tenant_id),
    coalesce(NEW.id, OLD.id)
  );
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION handle_global_search_index_resource_library_organization_refresh()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_resource_library_items_by_organization(
    coalesce(NEW.tenant_id, OLD.tenant_id),
    coalesce(NEW.id, OLD.id)
  );
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION handle_global_search_index_resource_library_location_refresh()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_resource_library_items_by_location(
    coalesce(NEW.tenant_id, OLD.tenant_id),
    coalesce(NEW.id, OLD.id)
  );
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION handle_global_search_index_resource_library_shoot_refresh()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_resource_library_items_by_shoot(
    coalesce(NEW.tenant_id, OLD.tenant_id),
    coalesce(NEW.id, OLD.id)
  );
  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_global_search_index_resource_library_item_refresh ON resource_library_item;
CREATE TRIGGER trg_global_search_index_resource_library_item_refresh
AFTER INSERT OR UPDATE OR DELETE ON resource_library_item
FOR EACH ROW
EXECUTE FUNCTION handle_global_search_index_resource_library_item_refresh();

DROP TRIGGER IF EXISTS trg_global_search_index_resource_library_org_refresh ON organization;
CREATE TRIGGER trg_global_search_index_resource_library_org_refresh
AFTER UPDATE OF display_name ON organization
FOR EACH ROW
WHEN (OLD.display_name IS DISTINCT FROM NEW.display_name)
EXECUTE FUNCTION handle_global_search_index_resource_library_organization_refresh();

DROP TRIGGER IF EXISTS trg_global_search_index_resource_library_location_refresh ON shoot_location;
CREATE TRIGGER trg_global_search_index_resource_library_location_refresh
AFTER UPDATE OF name ON shoot_location
FOR EACH ROW
WHEN (OLD.name IS DISTINCT FROM NEW.name)
EXECUTE FUNCTION handle_global_search_index_resource_library_location_refresh();

DROP TRIGGER IF EXISTS trg_global_search_index_resource_library_shoot_refresh ON shoot;
CREATE TRIGGER trg_global_search_index_resource_library_shoot_refresh
AFTER UPDATE OF shoot_code, title, shoot_date, department ON shoot
FOR EACH ROW
WHEN (
  OLD.shoot_code IS DISTINCT FROM NEW.shoot_code
  OR OLD.title IS DISTINCT FROM NEW.title
  OR OLD.shoot_date IS DISTINCT FROM NEW.shoot_date
  OR OLD.department IS DISTINCT FROM NEW.department
)
EXECUTE FUNCTION handle_global_search_index_resource_library_shoot_refresh();

DO $$
DECLARE
  item_row record;
BEGIN
  FOR item_row IN
    SELECT tenant_id, id
    FROM resource_library_item
  LOOP
    PERFORM refresh_global_search_index_resource_library_item(item_row.tenant_id, item_row.id);
  END LOOP;
END;
$$;
