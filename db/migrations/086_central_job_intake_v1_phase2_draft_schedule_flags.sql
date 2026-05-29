ALTER TABLE shoot
  ADD COLUMN IF NOT EXISTS schedule_date_placeholder boolean NOT NULL DEFAULT false;

ALTER TABLE shoot_day
  ADD COLUMN IF NOT EXISTS date_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS start_time_confirmed boolean NOT NULL DEFAULT false;

UPDATE shoot
SET schedule_date_placeholder = false
WHERE schedule_date_placeholder IS NULL;

UPDATE shoot_day
SET start_time_confirmed = CASE
  WHEN COALESCE(date_only, false) THEN false
  WHEN start_time IS NOT NULL THEN true
  ELSE false
END
WHERE start_time_confirmed IS NULL
   OR (start_time_confirmed = false AND start_time IS NOT NULL AND COALESCE(date_only, false) = false);
