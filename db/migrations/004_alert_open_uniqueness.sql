ALTER TABLE alert
  DROP CONSTRAINT IF EXISTS alert_tenant_id_shoot_id_alert_type_status_key;

DROP INDEX IF EXISTS alert_open_unique_idx;

CREATE UNIQUE INDEX alert_open_unique_idx
  ON alert (tenant_id, shoot_id, alert_type)
  WHERE status = 'open';
