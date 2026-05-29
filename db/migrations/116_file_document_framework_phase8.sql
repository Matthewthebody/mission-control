DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum enum
    JOIN pg_type type ON type.oid = enum.enumtypid
    WHERE type.typname = 'resource_library_category'
      AND enum.enumlabel = 'sop_reference'
  ) THEN
    ALTER TYPE resource_library_category ADD VALUE 'sop_reference';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum enum
    JOIN pg_type type ON type.oid = enum.enumtypid
    WHERE type.typname = 'resource_library_category'
      AND enum.enumlabel = 'contract_document'
  ) THEN
    ALTER TYPE resource_library_category ADD VALUE 'contract_document';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum enum
    JOIN pg_type type ON type.oid = enum.enumtypid
    WHERE type.typname = 'resource_library_category'
      AND enum.enumlabel = 'proof_document'
  ) THEN
    ALTER TYPE resource_library_category ADD VALUE 'proof_document';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum enum
    JOIN pg_type type ON type.oid = enum.enumtypid
    WHERE type.typname = 'resource_library_category'
      AND enum.enumlabel = 'support_document'
  ) THEN
    ALTER TYPE resource_library_category ADD VALUE 'support_document';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource_reference_kind') THEN
    CREATE TYPE resource_reference_kind AS ENUM ('uploaded_file', 'external_link');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource_external_provider') THEN
    CREATE TYPE resource_external_provider AS ENUM ('internal_upload', 'direct_url', 'sharepoint', 'onedrive');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource_record_object_type') THEN
    CREATE TYPE resource_record_object_type AS ENUM ('organization', 'location', 'shoot', 'job', 'production_item');
  END IF;
END $$;

ALTER TABLE resource_library_item
  ADD COLUMN IF NOT EXISTS reference_kind resource_reference_kind NOT NULL DEFAULT 'uploaded_file',
  ADD COLUMN IF NOT EXISTS external_provider resource_external_provider;

UPDATE resource_library_item
SET
  reference_kind = CASE
    WHEN storage_key IS NOT NULL AND btrim(storage_key) <> '' THEN 'uploaded_file'::resource_reference_kind
    ELSE 'external_link'::resource_reference_kind
  END,
  external_provider = CASE
    WHEN storage_key IS NOT NULL AND btrim(storage_key) <> '' THEN 'internal_upload'::resource_external_provider
    WHEN lower(coalesce(file_url, '')) LIKE '%sharepoint.com%' THEN 'sharepoint'::resource_external_provider
    WHEN lower(coalesce(file_url, '')) LIKE '%onedrive%' OR lower(coalesce(file_url, '')) LIKE '%1drv.ms%' THEN 'onedrive'::resource_external_provider
    WHEN file_url IS NOT NULL AND btrim(file_url) <> '' THEN 'direct_url'::resource_external_provider
    ELSE NULL
  END
WHERE external_provider IS NULL;

CREATE TABLE IF NOT EXISTS resource_library_item_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  resource_library_item_id uuid NOT NULL REFERENCES resource_library_item(id) ON DELETE CASCADE,
  object_type resource_record_object_type NOT NULL,
  object_id uuid NOT NULL,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, resource_library_item_id, object_type, object_id)
);

CREATE INDEX IF NOT EXISTS resource_library_item_link_tenant_object_idx
  ON resource_library_item_link (tenant_id, object_type, object_id, created_at DESC);

CREATE INDEX IF NOT EXISTS resource_library_item_link_tenant_item_idx
  ON resource_library_item_link (tenant_id, resource_library_item_id, created_at DESC);

INSERT INTO resource_library_item_link (tenant_id, resource_library_item_id, object_type, object_id, created_at)
SELECT tenant_id, id, 'organization'::resource_record_object_type, organization_id, created_at
FROM resource_library_item
WHERE organization_id IS NOT NULL
ON CONFLICT (tenant_id, resource_library_item_id, object_type, object_id) DO NOTHING;

INSERT INTO resource_library_item_link (tenant_id, resource_library_item_id, object_type, object_id, created_at)
SELECT tenant_id, id, 'location'::resource_record_object_type, location_id, created_at
FROM resource_library_item
WHERE location_id IS NOT NULL
ON CONFLICT (tenant_id, resource_library_item_id, object_type, object_id) DO NOTHING;

INSERT INTO resource_library_item_link (tenant_id, resource_library_item_id, object_type, object_id, created_at)
SELECT tenant_id, id, 'shoot'::resource_record_object_type, shoot_id, created_at
FROM resource_library_item
WHERE shoot_id IS NOT NULL
ON CONFLICT (tenant_id, resource_library_item_id, object_type, object_id) DO NOTHING;

ALTER TABLE resource_library_item_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_library_item_link FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_resource_library_item_link ON resource_library_item_link;
CREATE POLICY tenant_isolation_resource_library_item_link ON resource_library_item_link
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

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
  WITH primary_link AS (
    SELECT
      link.object_type,
      link.object_id
    FROM resource_library_item_link link
    WHERE link.tenant_id = p_tenant_id
      AND link.resource_library_item_id = p_item_id
    ORDER BY CASE link.object_type
      WHEN 'job' THEN 1
      WHEN 'production_item' THEN 2
      WHEN 'shoot' THEN 3
      WHEN 'location' THEN 4
      WHEN 'organization' THEN 5
      ELSE 99
    END,
    link.created_at ASC
    LIMIT 1
  )
  SELECT
    r.tenant_id,
    'resource_library_item',
    r.id,
    r.file_name,
    concat_ws(
      ' | ',
      COALESCE(
        CASE
          WHEN primary_link.object_type = 'job' THEN concat_ws(' | ', j.job_number, j.title)
          WHEN primary_link.object_type = 'production_item' THEN pi.title
          WHEN primary_link.object_type = 'shoot' THEN coalesce(s.shoot_code, s.title)
          WHEN primary_link.object_type = 'location' THEN sl.name
          WHEN primary_link.object_type = 'organization' THEN o.display_name
          ELSE NULL
        END,
        coalesce(s.shoot_code, s.title, sl.name, o.display_name, 'Linked file')
      ),
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
      r.reference_kind::text,
      r.external_provider::text,
      o.display_name,
      sl.name,
      s.shoot_code,
      s.title,
      j.job_number,
      j.title,
      pi.title,
      coalesce(r.uploader_name, uploader.full_name)
    ),
    r.approval_status::text,
    COALESCE(j.department_type::text, pi.department_type::text, s.department::text),
    COALESCE(r.organization_id, j.organization_id, pi.organization_id),
    o.display_name,
    r.uploader_user_id,
    ARRAY[]::uuid[],
    array_remove(
      ARRAY[
        COALESCE(r.organization_id, j.organization_id, pi.organization_id),
        COALESCE(r.location_id, j.primary_location_id, pi.location_id),
        r.shoot_id,
        CASE WHEN primary_link.object_type = 'job' THEN primary_link.object_id ELSE NULL END,
        CASE WHEN primary_link.object_type = 'production_item' THEN primary_link.object_id ELSE NULL END
      ]::uuid[],
      null::uuid
    ),
    coalesce(r.captured_at, s.shoot_date::timestamptz, r.created_at),
    CASE
      WHEN r.approval_status::text IN ('pending_review', 'leadership_only') THEN 'warning'
      WHEN r.category::text = 'issue_concern' THEN 'high'
      ELSE null
    END,
    jsonb_build_object(
      'access_model', 'resource_library_item',
      'linked_scope', CASE
        WHEN primary_link.object_type = 'job' THEN 'job'
        WHEN primary_link.object_type = 'production_item' THEN 'production_item'
        WHEN r.shoot_id IS NOT NULL OR primary_link.object_type = 'shoot' THEN 'shoot'
        WHEN r.location_id IS NOT NULL OR primary_link.object_type = 'location' THEN 'location'
        ELSE 'organization'
      END,
      'department', COALESCE(j.department_type::text, pi.department_type::text, s.department::text),
      'visibility_scope', r.visibility_scope::text,
      'approval_status', r.approval_status::text,
      'is_best_reference', r.is_best_reference,
      'uploader_user_id', r.uploader_user_id
    ),
    CASE
      WHEN primary_link.object_type = 'job' THEN '#jobs/' || primary_link.object_id::text
      WHEN primary_link.object_type = 'production_item' THEN '#production?item=' || primary_link.object_id::text
      WHEN r.shoot_id IS NOT NULL OR primary_link.object_type = 'shoot' THEN '#photography/shoots?shoot=' || coalesce(r.shoot_id, primary_link.object_id)::text
      WHEN r.location_id IS NOT NULL OR primary_link.object_type = 'location' THEN '#directory/locations?location=' || coalesce(r.location_id, primary_link.object_id)::text
      WHEN r.organization_id IS NOT NULL OR primary_link.object_type = 'organization' THEN '#directory/organizations?organization=' || coalesce(r.organization_id, primary_link.object_id)::text
      ELSE '#directory/locations'
    END,
    r.updated_at,
    coalesce(r.captured_at, r.updated_at),
    coalesce(nullif(btrim(coalesce(r.note, '')), ''), null) IS NOT NULL,
    false,
    false
  FROM resource_library_item r
  LEFT JOIN primary_link ON true
  LEFT JOIN jobs j
    ON primary_link.object_type = 'job'
   AND j.tenant_id = r.tenant_id
   AND j.id = primary_link.object_id
  LEFT JOIN production_items pi
    ON primary_link.object_type = 'production_item'
   AND pi.tenant_id = r.tenant_id
   AND pi.id = primary_link.object_id
  LEFT JOIN organization o
    ON o.tenant_id = r.tenant_id
   AND o.id = COALESCE(r.organization_id, j.organization_id, pi.organization_id)
  LEFT JOIN shoot_location sl
    ON sl.tenant_id = r.tenant_id
   AND sl.id = COALESCE(r.location_id, j.primary_location_id, pi.location_id)
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

CREATE OR REPLACE FUNCTION handle_global_search_index_resource_library_item_link_refresh()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_global_search_index_resource_library_item(
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    COALESCE(NEW.resource_library_item_id, OLD.resource_library_item_id)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trigger_global_search_index_resource_library_item_link_refresh ON resource_library_item_link;
CREATE TRIGGER trigger_global_search_index_resource_library_item_link_refresh
AFTER INSERT OR UPDATE OR DELETE ON resource_library_item_link
FOR EACH ROW
EXECUTE FUNCTION handle_global_search_index_resource_library_item_link_refresh();
