-- 157: manual acknowledgment reminders for current pending staffing recipients.
-- A manager can resend an acknowledgment reminder for a current pending recipient, subject to a cooldown.
-- These columns track the last reminder + count so the API can return last/next-allowed times and enforce
-- the cooldown server-side. Republishing an unchanged plan is NOT a reminder mechanism (a distinct
-- staffing.plan.recipient_reminder event drives delivery).
ALTER TABLE staffing_plan_recipient
  ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0;
