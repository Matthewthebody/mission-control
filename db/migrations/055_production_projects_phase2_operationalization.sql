ALTER TABLE production_project_task
  ADD COLUMN IF NOT EXISTS latest_note text;

