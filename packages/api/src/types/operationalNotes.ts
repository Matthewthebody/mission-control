export type OperationalNoteObjectType = "shoot" | "shift" | "location" | "alert";

export type OperationalNoteType =
  | "operational_update"
  | "temporary_note"
  | "permanent_note"
  | "location_memory"
  | "post_shoot_follow_up";

export type OperationalNotePermanence = "temporary" | "permanent" | "persistent_memory" | "follow_up";

export type OperationalNoteVisibilityScope =
  | "object_viewers"
  | "assigned_staff_and_managers"
  | "managers_and_leadership"
  | "leadership_only";

export type OperationalNotePublicationState = "active" | "proposed";

export type OperationalNoteFilter =
  | "all"
  | "important"
  | "temporary"
  | "permanent"
  | "location_memory"
  | "post_shoot_follow_up";
