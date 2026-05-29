ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE work_task
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE OR REPLACE FUNCTION app.sync_job_completed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.job_status = 'execution_complete'::job_status_type THEN
    IF NEW.completed_at IS NULL THEN
      NEW.completed_at = now();
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.job_status = 'execution_complete'::job_status_type THEN
    NEW.completed_at = NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_sync_completed_at ON jobs;
CREATE TRIGGER jobs_sync_completed_at
  BEFORE INSERT OR UPDATE OF job_status, completed_at
  ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION app.sync_job_completed_at();

CREATE OR REPLACE FUNCTION app.sync_work_task_completed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'completed'::work_task_status_type THEN
    IF NEW.completed_at IS NULL THEN
      NEW.completed_at = now();
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'completed'::work_task_status_type THEN
    NEW.completed_at = NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_task_sync_completed_at ON work_task;
CREATE TRIGGER work_task_sync_completed_at
  BEFORE INSERT OR UPDATE OF status, completed_at
  ON work_task
  FOR EACH ROW
  EXECUTE FUNCTION app.sync_work_task_completed_at();

CREATE INDEX IF NOT EXISTS jobs_tenant_completed_at_idx
  ON jobs (tenant_id, completed_at DESC)
  WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS work_task_tenant_completed_at_idx
  ON work_task (tenant_id, completed_at DESC)
  WHERE completed_at IS NOT NULL;
