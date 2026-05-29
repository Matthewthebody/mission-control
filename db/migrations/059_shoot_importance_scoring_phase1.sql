DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_importance_tier') THEN
    CREATE TYPE shoot_importance_tier AS ENUM ('standard', 'elevated', 'big_shoot', 'critical_shoot');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_structure_code') THEN
    CREATE TYPE shoot_structure_code AS ENUM ('standard', 'open_house');
  END IF;
END $$;

ALTER TABLE shoot
  ADD COLUMN IF NOT EXISTS camera_station_count integer NOT NULL DEFAULT 1 CHECK (camera_station_count >= 0),
  ADD COLUMN IF NOT EXISTS shoot_structure shoot_structure_code NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS first_year_customer_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flagship_priority_account_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS weather_travel_risk_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_leadership_boost integer NOT NULL DEFAULT 0 CHECK (manual_leadership_boost BETWEEN 0 AND 15),
  ADD COLUMN IF NOT EXISTS importance_override_tier shoot_importance_tier,
  ADD COLUMN IF NOT EXISTS importance_override_reason text,
  ADD COLUMN IF NOT EXISTS importance_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS importance_override_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;

UPDATE shoot
SET
  importance_override_tier = 'big_shoot',
  importance_override_reason = COALESCE(
    NULLIF(trim(importance_override_reason), ''),
    'Legacy big-shoot override imported from earlier scheduling controls.'
  ),
  importance_override_at = COALESCE(importance_override_at, now())
WHERE big_shoot_manual_override = true
  AND importance_override_tier IS NULL;

CREATE INDEX IF NOT EXISTS shoot_importance_override_by_user_id_idx
  ON shoot (importance_override_by_user_id);
