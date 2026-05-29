UPDATE shift_trade_request
SET status = CASE
    WHEN status::text = 'pending' THEN 'pending_recipient'::trade_request_status
    WHEN status::text = 'rejected' THEN 'denied'::trade_request_status
    WHEN status::text = 'cancelled' THEN 'canceled'::trade_request_status
    ELSE status
  END,
  manager_decided_by_user_id = COALESCE(manager_decided_by_user_id, decided_by_user_id),
  manager_decided_at = COALESCE(manager_decided_at, decided_at),
  manager_notes = COALESCE(manager_notes, notes);

UPDATE pto_request
SET status = CASE
    WHEN status::text = 'pending' THEN 'submitted'::pto_request_status
    WHEN status::text = 'rejected' THEN 'denied'::pto_request_status
    WHEN status::text = 'cancelled' THEN 'canceled'::pto_request_status
    ELSE status
  END,
  requested_on = COALESCE(requested_on, starts_on),
  request_unit = CASE
    WHEN partial_day THEN 'half_day'
    ELSE 'full_day'
  END,
  requested_hours = CASE
    WHEN partial_day THEN 4.0
    ELSE 7.5
  END;
