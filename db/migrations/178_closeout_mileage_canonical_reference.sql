-- G3 (ratified): job_closeout_mileage_review must REFERENCE canonical mileage,
-- never act as a fourth mileage writer. The closeout row now stores the
-- canonical mileage_reimbursement id it mirrors; amounts/zones read through
-- from canonical when a canonical row exists. Additive and nullable — historic
-- closeout rows keep their cached values with a NULL reference.

ALTER TABLE job_closeout_mileage_review
  ADD COLUMN IF NOT EXISTS reimbursement_id uuid REFERENCES mileage_reimbursement(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS job_closeout_mileage_review_reimbursement_idx
  ON job_closeout_mileage_review (tenant_id, reimbursement_id)
  WHERE reimbursement_id IS NOT NULL;

COMMENT ON COLUMN job_closeout_mileage_review.reimbursement_id IS
  'Canonical mileage_reimbursement this closeout review mirrors (read-through reference; canonical stays the single mileage writer). NULL = pre-G3 row or no canonical row exists for the employee/date.';
