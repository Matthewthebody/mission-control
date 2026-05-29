ALTER TABLE sports_job_profiles
  ADD COLUMN IF NOT EXISTS estimated_team_count integer
  CHECK (estimated_team_count IS NULL OR estimated_team_count >= 0);
