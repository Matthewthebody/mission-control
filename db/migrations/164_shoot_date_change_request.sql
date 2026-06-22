-- Phase 6 (June 18 feedback) — auditable Shoot date-change workflow. The "Osseo-style" date change
-- discussion had no canonical home: rescheduling a Picture Day meant overwriting the booked date with
-- no request, no feasibility record, no alternatives, no approval, and no history. This adds the
-- smallest additive, RLS-forced, reversible model: a request row (lifecycle + structured feasibility
-- + decision) and an append-only event log (every transition). Creating a request NEVER mutates the
-- shoot; the booked date is immutable history; the requested date is not final until an authorized
-- approval applies the change through the canonical scheduling path. Purely additive (DROP TABLE
-- reverses); no existing reader is affected.

CREATE TABLE IF NOT EXISTS shoot_date_change_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  shoot_id uuid NOT NULL REFERENCES shoot(id) ON DELETE CASCADE,
  -- the canonical Job id where the shoot is a published central-intake job (else null).
  job_id uuid REFERENCES shoot(id) ON DELETE SET NULL,
  -- IMMUTABLE booked date captured at request time; never overwritten.
  original_shoot_date date NOT NULL,
  requested_shoot_date date NOT NULL,
  -- who asked (a canonical contact and/or an internal user) + how it arrived.
  requested_by_contact_id uuid REFERENCES organization_contact(id) ON DELETE SET NULL,
  requested_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  request_source text NOT NULL DEFAULT 'manual', -- manual | email | phone | client_portal | import
  request_reason text,
  received_at timestamptz NOT NULL DEFAULT now(),
  -- lifecycle
  current_status text NOT NULL DEFAULT 'requested',
  -- structured feasibility results (never a notes blob); each: ok | warning | conflict | unavailable | review_required | unknown
  capacity_result text NOT NULL DEFAULT 'unknown',
  staffing_result text NOT NULL DEFAULT 'unknown',
  equipment_result text NOT NULL DEFAULT 'unknown',
  schedule_conflict_result text NOT NULL DEFAULT 'unknown',
  affected_bookings jsonb NOT NULL DEFAULT '[]'::jsonb,
  alternatives_offered jsonb NOT NULL DEFAULT '[]'::jsonb,
  selected_alternative jsonb,
  -- honest communication reference: a string/record pointer; NEVER implies a message was sent.
  client_communication_reference text,
  internal_notes text,
  -- decision
  decision text, -- approved | declined | canceled | null
  approved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  decided_at timestamptz,
  final_shoot_date date,
  -- retry-safe idempotency: a caller-supplied key dedupes identical submits.
  idempotency_key text,
  source_batch_id uuid,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shoot_date_change_status_check CHECK (current_status IN (
    'requested', 'feasibility_review', 'alternatives_required', 'awaiting_client',
    'approved', 'declined', 'canceled', 'completed'
  )),
  CONSTRAINT shoot_date_change_decision_check CHECK (decision IS NULL OR decision IN ('approved', 'declined', 'canceled')),
  CONSTRAINT shoot_date_change_feasibility_check CHECK (
    capacity_result IN ('unknown','ok','warning','conflict','unavailable','review_required') AND
    staffing_result IN ('unknown','ok','warning','conflict','unavailable','review_required') AND
    equipment_result IN ('unknown','ok','warning','conflict','unavailable','review_required') AND
    schedule_conflict_result IN ('unknown','ok','warning','conflict','unavailable','review_required')
  )
);

-- Retry-safe: an idempotency key is unique per tenant (partial — only when supplied).
CREATE UNIQUE INDEX IF NOT EXISTS shoot_date_change_idempotency_idx
  ON shoot_date_change_request (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS shoot_date_change_shoot_idx
  ON shoot_date_change_request (tenant_id, shoot_id, current_status);

-- Append-only transition log (audit history): every status change records actor + before/after.
CREATE TABLE IF NOT EXISTS shoot_date_change_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES shoot_date_change_request(id) ON DELETE CASCADE,
  event_type text NOT NULL, -- created | transition | feasibility | alternative | communication | decision
  from_status text,
  to_status text,
  reason text,
  communication_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shoot_date_change_event_request_idx
  ON shoot_date_change_event (tenant_id, request_id, created_at);

DO $$
BEGIN
  EXECUTE 'ALTER TABLE shoot_date_change_request ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE shoot_date_change_request FORCE ROW LEVEL SECURITY';
  DROP POLICY IF EXISTS tenant_isolation_shoot_date_change_request ON shoot_date_change_request;
  CREATE POLICY tenant_isolation_shoot_date_change_request
    ON shoot_date_change_request
    USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());

  EXECUTE 'ALTER TABLE shoot_date_change_event ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE shoot_date_change_event FORCE ROW LEVEL SECURITY';
  DROP POLICY IF EXISTS tenant_isolation_shoot_date_change_event ON shoot_date_change_event;
  CREATE POLICY tenant_isolation_shoot_date_change_event
    ON shoot_date_change_event
    USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
END $$;
