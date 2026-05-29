DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_request_source') THEN
    CREATE TYPE shoot_request_source AS ENUM (
      'manual',
      'smart_paste',
      'bulk_import',
      'api',
      'converted_from_inquiry',
      'internal_request'
    );
  END IF;
END $$;

ALTER TABLE shoot
  ADD COLUMN IF NOT EXISTS request_source shoot_request_source;

UPDATE shoot
SET request_source = 'manual'::shoot_request_source
WHERE request_source IS NULL;

ALTER TABLE shoot
  ALTER COLUMN request_source SET DEFAULT 'manual'::shoot_request_source,
  ALTER COLUMN request_source SET NOT NULL;
