BEGIN;

ALTER TYPE teams_communication_link_object_type ADD VALUE IF NOT EXISTS 'task';

ALTER TYPE teams_meeting_link_object_type ADD VALUE IF NOT EXISTS 'task';

COMMIT;
