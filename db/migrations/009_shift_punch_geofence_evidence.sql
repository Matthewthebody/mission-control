ALTER TABLE shift_punch
  ADD COLUMN IF NOT EXISTS distance_from_expected_meters numeric(10,2),
  ADD COLUMN IF NOT EXISTS expected_geofence_radius_meters integer;
