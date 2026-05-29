-- migrate: no-transaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS workflow_step_command_center_open_idx
  ON workflow_step (tenant_id, status, last_transition_at, sort_order)
  WHERE status NOT IN ('COMPLETE'::workflow_step_status_type, 'SKIPPED'::workflow_step_status_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS workflow_step_open_sla_idx
  ON workflow_step (tenant_id, started_at, expected_duration_minutes)
  WHERE started_at IS NOT NULL
    AND status NOT IN ('COMPLETE'::workflow_step_status_type, 'SKIPPED'::workflow_step_status_type);
