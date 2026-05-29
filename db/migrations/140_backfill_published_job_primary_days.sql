INSERT INTO job_days (
  tenant_id,
  job_id,
  day_label,
  date,
  start_time,
  end_time,
  timezone,
  location_id,
  day_status,
  created_by_user_id,
  updated_by_user_id
)
SELECT
  job.tenant_id,
  job.id,
  'Primary day',
  (job.scheduled_start_at AT TIME ZONE COALESCE(NULLIF(trim(job.timezone), ''), 'America/Chicago'))::date,
  (job.scheduled_start_at AT TIME ZONE COALESCE(NULLIF(trim(job.timezone), ''), 'America/Chicago'))::time,
  CASE
    WHEN job.scheduled_end_at IS NULL THEN NULL::time
    WHEN (job.scheduled_end_at AT TIME ZONE COALESCE(NULLIF(trim(job.timezone), ''), 'America/Chicago'))::date
       <> (job.scheduled_start_at AT TIME ZONE COALESCE(NULLIF(trim(job.timezone), ''), 'America/Chicago'))::date THEN NULL::time
    WHEN (job.scheduled_end_at AT TIME ZONE COALESCE(NULLIF(trim(job.timezone), ''), 'America/Chicago'))::time
       <= (job.scheduled_start_at AT TIME ZONE COALESCE(NULLIF(trim(job.timezone), ''), 'America/Chicago'))::time THEN NULL::time
    ELSE (job.scheduled_end_at AT TIME ZONE COALESCE(NULLIF(trim(job.timezone), ''), 'America/Chicago'))::time
  END,
  COALESCE(NULLIF(trim(job.timezone), ''), 'America/Chicago'),
  job.primary_location_id,
  CASE
    WHEN job.job_status = 'cancelled'::job_status_type THEN 'cancelled'::job_day_status_type
    WHEN job.job_status = 'execution_complete'::job_status_type THEN 'complete'::job_day_status_type
    WHEN job.job_status = 'in_progress'::job_status_type THEN 'in_progress'::job_day_status_type
    WHEN job.job_status = 'ready_to_execute'::job_status_type THEN 'ready'::job_day_status_type
    ELSE 'scheduled'::job_day_status_type
  END,
  job.created_by_user_id,
  COALESCE(job.updated_by_user_id, job.created_by_user_id)
FROM jobs job
WHERE job.published_at IS NOT NULL
  AND job.archived_at IS NULL
  AND job.cancelled_at IS NULL
  AND job.completed_at IS NULL
  AND job.scheduled_start_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM job_days day
    WHERE day.tenant_id = job.tenant_id
      AND day.job_id = job.id
  );
