DO $$
DECLARE
  max_job_sequence bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relkind = 'S'
      AND relname = 'central_job_number_seq'
  ) THEN
    CREATE SEQUENCE central_job_number_seq START WITH 1;
  END IF;

  SELECT COALESCE(
           MAX((regexp_match(job_number, '^(?:SCH|SPT)-[0-9]{4}-(\d+)$'))[1]::bigint),
           0
         )
    INTO max_job_sequence
  FROM shoot
  WHERE job_number ~ '^(?:SCH|SPT)-[0-9]{4}-\d+$';

  IF max_job_sequence > 0 THEN
    PERFORM setval('central_job_number_seq', max_job_sequence, true);
  ELSE
    PERFORM setval('central_job_number_seq', 1, false);
  END IF;
END $$;

ALTER TABLE shoot
  ADD COLUMN IF NOT EXISTS duplicate_check_completed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duplicate_override_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;
