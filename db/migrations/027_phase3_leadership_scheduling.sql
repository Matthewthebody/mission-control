DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_category_code') THEN
    CREATE TYPE shoot_category_code AS ENUM ('sports', 'schools', 'events', 'studio');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operations_priority_code') THEN
    CREATE TYPE operations_priority_code AS ENUM ('standard', 'elevated', 'high_priority');
  END IF;
END $$;

ALTER TABLE shoot
  ADD COLUMN IF NOT EXISTS shoot_category shoot_category_code NOT NULL DEFAULT 'events',
  ADD COLUMN IF NOT EXISTS showtime timestamptz,
  ADD COLUMN IF NOT EXISTS primary_contact_name text,
  ADD COLUMN IF NOT EXISTS primary_contact_phone text,
  ADD COLUMN IF NOT EXISTS primary_contact_email text,
  ADD COLUMN IF NOT EXISTS secondary_contact_name text,
  ADD COLUMN IF NOT EXISTS secondary_contact_phone text,
  ADD COLUMN IF NOT EXISTS secondary_contact_email text,
  ADD COLUMN IF NOT EXISTS special_instructions text,
  ADD COLUMN IF NOT EXISTS access_notes text,
  ADD COLUMN IF NOT EXISTS additional_products text,
  ADD COLUMN IF NOT EXISTS special_equipment text,
  ADD COLUMN IF NOT EXISTS setup_notes text,
  ADD COLUMN IF NOT EXISTS day_of_notes text,
  ADD COLUMN IF NOT EXISTS operations_priority operations_priority_code NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS big_shoot_manual_override boolean NOT NULL DEFAULT false;

UPDATE shoot
SET
  shoot_category = CASE
    WHEN department = 'sports' THEN 'sports'::shoot_category_code
    WHEN department = 'schools' THEN 'schools'::shoot_category_code
    WHEN department = 'production' THEN 'studio'::shoot_category_code
    ELSE 'events'::shoot_category_code
  END,
  showtime = COALESCE(showtime, arrival_time, start_time)
WHERE
  shoot_category = 'events'::shoot_category_code
  OR showtime IS NULL;
