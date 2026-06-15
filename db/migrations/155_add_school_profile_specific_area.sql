-- Adds an optional free-text "specific area" detail to the school job profile
-- (e.g. "Gym", "Auditorium", "West entrance"). Captured on intake alongside the
-- approved school location. Location Intelligence keys off the approved location,
-- never this free text. Nullable and additive: existing rows stay valid.
ALTER TABLE school_job_profiles
  ADD COLUMN IF NOT EXISTS specific_area text;
