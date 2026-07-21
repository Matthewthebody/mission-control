-- Owner ratification 2026-07-20 (decision memo 2026-07-13, items B1 + B4).
-- B1: bi-weekly payroll periods anchored Monday 2026-06-29 CONFIRMED. The period
--     (Mon–Sun × 2) closes for employee/manager review on the MONDAY after it
--     ends and is locked/exported for the QuickBooks run on WEDNESDAY 12:00
--     local (= Monday 00:00 + close_offset_hours 60 — the prior comment calling
--     60h "Tuesday 12:00" was miscounted; the value was already correct). The
--     self-check/review window therefore opens Monday 00:00: 60 hours before
--     lock, replacing the unverified 24h default.
-- B4: payroll blockers/overtime warnings stay OWNER-ONLY in-app; by decision no
--     payroll_alert Teams route is configured (the pipeline stays honest and
--     silent about Teams until a route ever exists).
-- Additive and reversible by inspection.

ALTER TABLE payroll_calendar_config ALTER COLUMN self_check_window_hours SET DEFAULT 60;

-- Move rows still on the unverified default pair onto the ratified window.
UPDATE payroll_calendar_config
SET self_check_window_hours = 60, updated_at = now()
WHERE self_check_window_hours = 24
  AND close_offset_hours = 60;

COMMENT ON COLUMN payroll_calendar_config.reference_period_start IS
  'Anchor date a real period started on (owner-ratified 2026-07-20: Monday 2026-06-29). Every period boundary derives from this by modular arithmetic.';
COMMENT ON COLUMN payroll_calendar_config.close_offset_hours IS
  'Payroll lock/export = day-after-period-end 00:00 local + this many hours. Owner-ratified 2026-07-20: 60h = Wednesday 12:00 after a Sunday period end.';
COMMENT ON COLUMN payroll_calendar_config.self_check_window_hours IS
  'Self-check/review window opens this many hours before lock. Owner-ratified 2026-07-20: 60h = Monday 00:00, so review closes Monday.';
