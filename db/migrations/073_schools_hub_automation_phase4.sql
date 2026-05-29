ALTER TYPE school_activity_type ADD VALUE IF NOT EXISTS 'automation_generated';
ALTER TYPE school_activity_type ADD VALUE IF NOT EXISTS 'automation_escalated';
ALTER TYPE school_activity_type ADD VALUE IF NOT EXISTS 'automation_trigger_received';

ALTER TABLE school_work_item
  ADD COLUMN IF NOT EXISTS automation_key text,
  ADD COLUMN IF NOT EXISTS automation_last_evaluated_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_level integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS school_work_item_tenant_automation_key_idx
  ON school_work_item (tenant_id, automation_key);

CREATE INDEX IF NOT EXISTS school_work_item_generated_lookup_idx
  ON school_work_item (
    tenant_id,
    generated_by_rule,
    status,
    stage,
    waiting_on,
    due_date,
    automation_last_evaluated_at DESC
  );
