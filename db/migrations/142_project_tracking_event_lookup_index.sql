-- migrate: no-transaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS app_event_tenant_aggregate_type_created_idx
  ON app_event (tenant_id, aggregate_id, event_type, created_at DESC)
  WHERE aggregate_id IS NOT NULL;
