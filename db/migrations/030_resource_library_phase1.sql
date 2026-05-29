DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource_library_type') THEN
    CREATE TYPE resource_library_type AS ENUM ('image', 'document', 'qr_code', 'video');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource_library_category') THEN
    CREATE TYPE resource_library_category AS ENUM (
      'setup_photo',
      'location_reference',
      'prior_successful_example',
      'product_example',
      'issue_concern',
      'equipment_setup_need',
      'qr_code_job_document',
      'misc_internal_reference'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource_library_approval_status') THEN
    CREATE TYPE resource_library_approval_status AS ENUM ('pending_review', 'approved', 'leadership_only');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource_library_visibility_scope') THEN
    CREATE TYPE resource_library_visibility_scope AS ENUM ('leadership_only', 'photographer_prep');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS resource_library_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  location_id uuid REFERENCES shoot_location(id) ON DELETE SET NULL,
  shoot_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  uploader_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  uploader_name text,
  resource_type resource_library_type NOT NULL,
  category resource_library_category NOT NULL,
  note text,
  issue_type text,
  approval_status resource_library_approval_status NOT NULL DEFAULT 'approved',
  visibility_scope resource_library_visibility_scope NOT NULL DEFAULT 'photographer_prep',
  is_best_reference boolean NOT NULL DEFAULT false,
  file_name text NOT NULL,
  content_type text,
  file_size_bytes integer,
  storage_key text,
  file_url text,
  captured_at timestamptz,
  source_record_type text,
  source_record_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resource_library_item_tenant_shoot_idx
  ON resource_library_item (tenant_id, shoot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS resource_library_item_tenant_org_idx
  ON resource_library_item (tenant_id, organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS resource_library_item_tenant_location_idx
  ON resource_library_item (tenant_id, location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS resource_library_item_tenant_category_idx
  ON resource_library_item (tenant_id, category, created_at DESC);
CREATE INDEX IF NOT EXISTS resource_library_item_tenant_visibility_idx
  ON resource_library_item (tenant_id, approval_status, visibility_scope, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS resource_library_item_source_uq
  ON resource_library_item (tenant_id, source_record_type, source_record_id);

INSERT INTO resource_library_item (
  tenant_id,
  organization_id,
  location_id,
  shoot_id,
  uploader_user_id,
  uploader_name,
  resource_type,
  category,
  approval_status,
  visibility_scope,
  is_best_reference,
  file_name,
  content_type,
  storage_key,
  file_url,
  captured_at,
  source_record_type,
  source_record_id,
  created_at,
  updated_at
)
SELECT
  ma.tenant_id,
  s.organization_id,
  s.location_id,
  ma.shoot_id,
  ma.user_id,
  COALESCE(au.full_name, 'Mission Control'),
  CASE
    WHEN lower(COALESCE(ma.url, '')) ~ '\.(mp4|mov|m4v)$' OR lower(COALESCE(ma.storage_key, '')) ~ '\.(mp4|mov|m4v)$' THEN 'video'::resource_library_type
    WHEN lower(COALESCE(ma.url, '')) ~ '\.pdf$' OR lower(COALESCE(ma.storage_key, '')) ~ '\.pdf$' THEN 'document'::resource_library_type
    ELSE 'image'::resource_library_type
  END,
  CASE
    WHEN lower(ma.kind) = 'setup_photo' THEN 'setup_photo'::resource_library_category
    ELSE 'misc_internal_reference'::resource_library_category
  END,
  'approved'::resource_library_approval_status,
  'photographer_prep'::resource_library_visibility_scope,
  false,
  COALESCE(NULLIF(regexp_replace(COALESCE(ma.storage_key, ma.url, ''), '^.*/', ''), ''), 'resource-upload'),
  NULL,
  ma.storage_key,
  ma.url,
  ma.created_at,
  'media_asset',
  ma.id,
  ma.created_at,
  ma.created_at
FROM media_asset ma
JOIN shoot s
  ON s.tenant_id = ma.tenant_id
 AND s.id = ma.shoot_id
LEFT JOIN app_user au
  ON au.tenant_id = ma.tenant_id
 AND au.id = ma.user_id
ON CONFLICT (tenant_id, source_record_type, source_record_id) DO NOTHING;

INSERT INTO resource_library_item (
  tenant_id,
  organization_id,
  location_id,
  shoot_id,
  uploader_user_id,
  uploader_name,
  resource_type,
  category,
  approval_status,
  visibility_scope,
  is_best_reference,
  file_name,
  content_type,
  file_url,
  captured_at,
  source_record_type,
  source_record_id,
  created_at,
  updated_at
)
SELECT
  spu.tenant_id,
  sl.organization_id,
  spu.location_id,
  spu.shoot_id,
  spu.uploader_user_id,
  spu.uploader_name,
  CASE
    WHEN lower(COALESCE(spu.content_type, '')) LIKE 'video/%' THEN 'video'::resource_library_type
    ELSE 'image'::resource_library_type
  END,
  'setup_photo'::resource_library_category,
  'approved'::resource_library_approval_status,
  'photographer_prep'::resource_library_visibility_scope,
  false,
  spu.file_name,
  spu.content_type,
  spu.image_url,
  spu.uploaded_at,
  'setup_photo_upload',
  spu.id,
  spu.created_at,
  spu.updated_at
FROM setup_photo_upload spu
JOIN shoot_location sl
  ON sl.tenant_id = spu.tenant_id
 AND sl.id = spu.location_id
ON CONFLICT (tenant_id, source_record_type, source_record_id) DO NOTHING;

ALTER TABLE resource_library_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_library_item FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_resource_library_item ON resource_library_item;
CREATE POLICY tenant_isolation_resource_library_item ON resource_library_item
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
