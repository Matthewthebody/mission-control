-- C7 (ratified direction, sequenced after G2 — now satisfied): "answer pending"
-- becomes representable. submit_for_mileage defaulted false, making "never
-- asked" indistinguishable from an explicit decline, so unanswered evaluations
-- silently read as declined. post_shoot_evaluation gains an explicit tri-state:
--   pending  = the mileage question has not been answered (honest re-prompt)
--   eligible = photographer answered yes (submit_for_mileage true)
--   declined = photographer explicitly answered no (SSA-3 recorded)
-- Backfill: explicit yes -> eligible. false stays pending BY DESIGN — a false
-- default was never proof of a decline; the recalc turns pending into
-- review_required/answer_pending instead of ineligible/submit_declined.

ALTER TYPE mileage_reimbursement_reason_code ADD VALUE IF NOT EXISTS 'answer_pending';

ALTER TABLE post_shoot_evaluation
  ADD COLUMN IF NOT EXISTS mileage_response text NOT NULL DEFAULT 'pending'
  CHECK (mileage_response IN ('pending', 'eligible', 'declined'));

UPDATE post_shoot_evaluation
SET mileage_response = 'eligible'
WHERE submit_for_mileage = true
  AND mileage_response = 'pending';

COMMENT ON COLUMN post_shoot_evaluation.mileage_response IS
  'C7 tri-state mileage answer: pending (unanswered — recalc yields review_required/answer_pending), eligible, declined. submit_for_mileage=true always reads as eligible regardless, so in-form yes answers need no writer change.';
