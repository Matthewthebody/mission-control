DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'resource_library_approval_status'
      AND e.enumlabel = 'rejected_not_useful'
  ) THEN
    -- already added
  ELSE
    ALTER TYPE resource_library_approval_status ADD VALUE 'rejected_not_useful';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource_library_best_reference_category') THEN
    CREATE TYPE resource_library_best_reference_category AS ENUM (
      'best_setup_example',
      'best_team_photo_example',
      'best_entrance_location_example',
      'best_product_poster_example',
      'best_logistics_example'
    );
  END IF;
END $$;

ALTER TABLE resource_library_item
  ADD COLUMN IF NOT EXISTS best_reference_candidate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS best_reference_category resource_library_best_reference_category,
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_note text;

UPDATE resource_library_item
SET best_reference_category = CASE
      WHEN category = 'setup_photo' THEN 'best_setup_example'::resource_library_best_reference_category
      WHEN category = 'product_example' THEN 'best_product_poster_example'::resource_library_best_reference_category
      WHEN category = 'location_reference' THEN 'best_entrance_location_example'::resource_library_best_reference_category
      WHEN category = 'prior_successful_example' THEN 'best_team_photo_example'::resource_library_best_reference_category
      ELSE 'best_logistics_example'::resource_library_best_reference_category
    END
WHERE is_best_reference = true
  AND best_reference_category IS NULL;

CREATE INDEX IF NOT EXISTS resource_library_item_tenant_review_idx
  ON resource_library_item (tenant_id, approval_status, reviewed_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS resource_library_item_tenant_best_reference_idx
  ON resource_library_item (tenant_id, best_reference_category, is_best_reference, created_at DESC);
