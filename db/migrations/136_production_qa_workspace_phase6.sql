DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'qa_hold'
      AND enumtypid = 'production_project_stage'::regtype
  ) THEN
    ALTER TYPE production_project_stage ADD VALUE 'qa_hold';
  END IF;
END $$;

ALTER TABLE production_project_review
  ADD COLUMN IF NOT EXISTS qa_checks jsonb,
  ADD COLUMN IF NOT EXISTS qa_checklist_complete boolean NOT NULL DEFAULT false;
