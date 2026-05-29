DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'resource_library_upload_source'
  ) THEN
    CREATE TYPE resource_library_upload_source AS ENUM (
      'mobile_camera',
      'mobile_library',
      'mobile_document',
      'web_upload',
      'system_migration'
    );
  END IF;
END $$;

ALTER TABLE resource_library_item
  ADD COLUMN IF NOT EXISTS upload_source resource_library_upload_source,
  ADD COLUMN IF NOT EXISTS gps_lat double precision,
  ADD COLUMN IF NOT EXISTS gps_lng double precision;

UPDATE resource_library_item
SET upload_source = 'system_migration'
WHERE upload_source IS NULL;
