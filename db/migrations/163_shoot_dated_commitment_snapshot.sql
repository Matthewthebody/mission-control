-- Phase 4.2 Part 2 — historical Job-truth: the smallest additive dated-commitment snapshot.
-- The shoot row already snapshots the dated location_name + location_address + the contact name
-- (unresolved_primary_contact_name, captured at publish) + the schedule (shoot_date/times) +
-- room/area (special_instructions). The schema could NOT preserve three dated values the canonical
-- model lets change later: the contextual relationship ROLE used for this Job, the Contact's
-- phone/preferred method at commitment, and the service-term id/label committed for this Job.
-- This adds ONE additive jsonb column that captures exactly those, populated at publish and never
-- auto-updated. Live canonical references (organization_id/location_id/primary_contact_id + the
-- live-joined display) continue to reflect current truth; this column preserves the dated
-- commitment. Purely additive + reversible; existing readers unaffected.

ALTER TABLE shoot
  ADD COLUMN IF NOT EXISTS dated_commitment jsonb;

COMMENT ON COLUMN shoot.dated_commitment IS
  'Phase 4.2 dated-commitment snapshot captured at publish: contextual contact role, contact phone/preferred, service-term id/label, room/area, confirmed_at/by. Never auto-updated; preserves the dated Job commitment while FK references stay live.';
