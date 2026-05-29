DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_status')
     AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_status_legacy') THEN
    ALTER TYPE shoot_status RENAME TO shoot_status_legacy;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_status') THEN
    CREATE TYPE shoot_status AS ENUM (
      'DRAFT',
      'TENTATIVE',
      'CONFIRMED',
      'READY',
      'LIVE',
      'SHOOT_COMPLETE',
      'POST_PRODUCTION',
      'COMPLETE',
      'ON_HOLD',
      'CANCELLED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_post_production_substage') THEN
    CREATE TYPE shoot_post_production_substage AS ENUM (
      'INTAKE_PENDING',
      'ASSETS_RECEIVED',
      'EDITING_PROCESSING',
      'GRAPHICS_PACKAGING',
      'UPLOAD_DELIVERY_PREP',
      'QA_REVIEW',
      'CORRECTION_NEEDED',
      'READY_TO_RELEASE'
    );
  END IF;
END $$;

ALTER TABLE shoot
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS on_hold_return_status shoot_status,
  ADD COLUMN IF NOT EXISTS post_production_substage shoot_post_production_substage,
  ADD COLUMN IF NOT EXISTS pre_service_notes_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS special_deliverables_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gear_requirements_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS roster_data_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS roster_data_ready boolean NOT NULL DEFAULT false;

ALTER TABLE shoot
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE shoot
  ALTER COLUMN status TYPE shoot_status
  USING (
    CASE status::text
      WHEN 'SCHEDULED' THEN 'CONFIRMED'
      WHEN 'IN_PROGRESS' THEN 'LIVE'
      WHEN 'COMPLETE' THEN 'COMPLETE'
      WHEN 'CANCELLED' THEN 'CANCELLED'
      ELSE 'DRAFT'
    END
  )::shoot_status;

ALTER TABLE shoot
  ALTER COLUMN status SET DEFAULT 'DRAFT';

UPDATE shoot
SET
  status_changed_at = COALESCE(status_changed_at, updated_at, created_at, now()),
  pre_service_notes_complete = CASE
    WHEN COALESCE(
      NULLIF(trim(setup_notes), ''),
      NULLIF(trim(day_of_notes), ''),
      NULLIF(trim(access_notes), ''),
      NULLIF(trim(special_instructions), '')
    ) IS NOT NULL THEN true
    ELSE pre_service_notes_complete
  END,
  special_deliverables_ready = CASE
    WHEN COALESCE(additional_products_flag, false) = false AND NULLIF(trim(additional_products), '') IS NULL THEN true
    WHEN NULLIF(trim(additional_products), '') IS NOT NULL THEN true
    ELSE special_deliverables_ready
  END,
  gear_requirements_ready = CASE
    WHEN COALESCE(special_equipment_flag, false) = false AND NULLIF(trim(special_equipment), '') IS NULL THEN true
    WHEN NULLIF(trim(special_equipment), '') IS NOT NULL THEN true
    ELSE gear_requirements_ready
  END,
  roster_data_required = CASE
    WHEN shoot_type IN ('schools_underclass_portraits', 'schools_events') THEN true
    ELSE roster_data_required
  END,
  roster_data_ready = CASE
    WHEN shoot_type IN ('schools_underclass_portraits', 'schools_events') THEN roster_data_ready
    ELSE true
  END,
  post_production_substage = CASE
    WHEN status = 'COMPLETE' AND post_production_substage IS NULL THEN 'READY_TO_RELEASE'::shoot_post_production_substage
    ELSE post_production_substage
  END;

CREATE INDEX IF NOT EXISTS shoot_status_changed_by_user_id_idx
  ON shoot (status_changed_by_user_id);

CREATE INDEX IF NOT EXISTS shoot_on_hold_return_status_idx
  ON shoot (on_hold_return_status);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shoot_status_legacy') THEN
    DROP TYPE shoot_status_legacy;
  END IF;
END $$;
