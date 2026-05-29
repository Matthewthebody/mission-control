ALTER TABLE shoot_location
  ADD COLUMN IF NOT EXISTS location_type text DEFAULT 'main_building',
  ADD COLUMN IF NOT EXISTS parking_instructions text,
  ADD COLUMN IF NOT EXISTS entrance_instructions text,
  ADD COLUMN IF NOT EXISTS unloading_instructions text,
  ADD COLUMN IF NOT EXISTS setup_area text,
  ADD COLUMN IF NOT EXISTS backup_indoor_location text,
  ADD COLUMN IF NOT EXISTS accessibility_notes text,
  ADD COLUMN IF NOT EXISTS power_availability_notes text,
  ADD COLUMN IF NOT EXISTS wifi_cell_notes text,
  ADD COLUMN IF NOT EXISTS security_checkin_requirements text,
  ADD COLUMN IF NOT EXISTS weather_contingency_notes text,
  ADD COLUMN IF NOT EXISTS client_facing_notes text,
  ADD COLUMN IF NOT EXISTS employee_facing_notes text,
  ADD COLUMN IF NOT EXISTS internal_only_notes text;

UPDATE shoot_location
SET location_type = 'main_building'
WHERE location_type IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shoot_location_type_check'
  ) THEN
    ALTER TABLE shoot_location
      ADD CONSTRAINT shoot_location_type_check CHECK (
        location_type IN (
          'main_building',
          'gym',
          'stadium_field',
          'district_office',
          'offsite',
          'school_main_entrance',
          'school_media_center',
          'sports_fieldhouse',
          'other'
        )
      );
  END IF;
END $$;

ALTER TABLE shoot_location
  ALTER COLUMN location_type SET DEFAULT 'main_building',
  ALTER COLUMN location_type SET NOT NULL;

CREATE INDEX IF NOT EXISTS shoot_location_communication_ready_idx
  ON shoot_location (tenant_id, organization_id, active_status, location_type);
