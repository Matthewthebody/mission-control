export type SchoolJobType =
  | "fall_portraits"
  | "retakes"
  | "spring_portraits"
  | "sports"
  | "graduation"
  | "yearbook"
  | "ids"
  | "admin_fulfillment"
  | "delivery"
  | "other";

export type SchoolJobStatus = "planned" | "active" | "waiting" | "on_hold" | "completed" | "cancelled";

export type SchoolWorkType =
  | "pre_shoot_coordination"
  | "gallery_release"
  | "id_production"
  | "admin_item"
  | "yearbook"
  | "graduation"
  | "delivery"
  | "invoicing"
  | "follow_up"
  | "exception_handling";

export type SchoolWorkStatus = "open" | "in_progress" | "waiting" | "blocked" | "completed" | "cancelled";

export type SchoolWorkStage =
  | "intake"
  | "planning"
  | "active"
  | "waiting_on_school"
  | "waiting_on_internal"
  | "ready_for_delivery"
  | "done";

export type SchoolWorkPriority = "low" | "normal" | "high" | "critical";

export type SchoolWorkWaitingOn =
  | "none"
  | "school"
  | "internal_production"
  | "internal_ops"
  | "shipping_vendor"
  | "billing"
  | "other";

export type SchoolWorkSourceSystem = "mission_control" | "monday" | "manual_import" | "zendesk" | "outlook" | "other";

export type SchoolDeliverableType = "gallery" | "ids" | "yearbook" | "graduation" | "admin_items" | "shipment" | "other";

export type SchoolDeliverableStatus = "planned" | "in_progress" | "blocked" | "ready" | "delivered" | "cancelled";

export type SchoolDeliveryMethod = "pickup" | "mail" | "courier" | "digital" | "field_drop" | "other";

export type SchoolsHubTone = "neutral" | "info" | "success" | "warning" | "critical";

export type SchoolExternalSyncState =
  | "never_synced"
  | "sync_pending"
  | "synced"
  | "partially_synced"
  | "conflict_detected"
  | "sync_failed"
  | "disabled"
  | "archived_link";

export type SchoolExternalSyncRecord = {
  provider: "monday";
  external_record_id: string | null;
  external_record_url: string | null;
  external_record_name: string | null;
  board_id: string | null;
  board_name: string | null;
  group_id: string | null;
  group_title: string | null;
  last_synced_at: string | null;
  sync_state: SchoolExternalSyncState;
  sync_state_label: string;
  last_error: string | null;
  last_operation_id: string | null;
  last_operation_status: "pending" | "processing" | "succeeded" | "failed" | "conflict" | null;
  can_reimport: boolean;
};

export type SchoolsHubFlag = {
  label: string;
  tone: SchoolsHubTone;
};

export type SchoolJobRecord = {
  id: string;
  organization_id: string;
  school_name: string;
  school_logo_url: string | null;
  linked_shoot_id: string | null;
  linked_shoot_code: string | null;
  linked_shoot_title: string | null;
  linked_location_id: string | null;
  linked_location_name: string | null;
  job_type: SchoolJobType;
  status: SchoolJobStatus;
  title: string;
  event_date: string | null;
  due_date: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  source_system: SchoolWorkSourceSystem;
  source_reference: string | null;
  external_sync: SchoolExternalSyncRecord | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SchoolWorkItemRecord = {
  id: string;
  organization_id: string;
  school_name: string;
  school_logo_url: string | null;
  school_job_id: string | null;
  school_job_title: string | null;
  school_job_type: SchoolJobType | null;
  linked_shoot_id: string | null;
  linked_shoot_code: string | null;
  linked_shoot_title: string | null;
  linked_location_id: string | null;
  linked_location_name: string | null;
  linked_contact_id: string | null;
  linked_contact_name: string | null;
  linked_follow_up_id: string | null;
  linked_follow_up_title: string | null;
  linked_production_project_id: string | null;
  linked_production_project_title: string | null;
  work_type: SchoolWorkType;
  title: string;
  description: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  status: SchoolWorkStatus;
  stage: SchoolWorkStage;
  priority: SchoolWorkPriority;
  due_date: string | null;
  sla_date: string | null;
  blocker_reason: string | null;
  waiting_on: SchoolWorkWaitingOn;
  source_system: SchoolWorkSourceSystem;
  source_reference: string | null;
  external_sync: SchoolExternalSyncRecord | null;
  generated_by_rule: boolean;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  status_label: string;
  status_tone: SchoolsHubTone;
  due_state: "overdue" | "due_today" | "due_soon" | "scheduled" | "completed" | "none";
  due_label: string;
  waiting_on_label: string;
  source_label: string;
  flags: SchoolsHubFlag[];
};

export type SchoolDeliverableRecord = {
  id: string;
  organization_id: string;
  school_name: string;
  school_job_id: string | null;
  school_job_title: string | null;
  school_work_item_id: string | null;
  school_work_item_title: string | null;
  linked_shoot_id: string | null;
  linked_shoot_code: string | null;
  linked_shoot_title: string | null;
  linked_production_project_id: string | null;
  linked_production_project_title: string | null;
  linked_location_id: string | null;
  linked_location_name: string | null;
  deliverable_type: SchoolDeliverableType;
  deliverable_type_label: string;
  status: SchoolDeliverableStatus;
  status_label: string;
  owner_user_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  ready_date: string | null;
  delivered_date: string | null;
  delivery_method: SchoolDeliveryMethod | null;
  delivery_method_label: string | null;
  tracking_reference: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SchoolWorkTimelineEvent = {
  id: string;
  source: "audit_log" | "school_activity_log" | "deliverable";
  event_type: string;
  label: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};

export type SchoolsHubSection = {
  id:
    | "due_today"
    | "overdue"
    | "upcoming_shoots_needing_prep"
    | "waiting_on_school"
    | "waiting_on_internal_production"
    | "id_work_queue"
    | "gallery_due_soon"
    | "yearbook_deadlines_approaching"
    | "deliveries_ready"
    | "recently_completed";
  title: string;
  summary: string;
  count: number;
  items: SchoolWorkItemRecord[];
};

export type SchoolsHubSummary = {
  due_today: number;
  overdue: number;
  upcoming_shoots_needing_prep: number;
  waiting_on_school: number;
  waiting_on_internal_production: number;
  id_work_queue: number;
  gallery_due_soon: number;
  yearbook_deadlines_approaching: number;
  deliveries_ready: number;
  recently_completed: number;
  open_total: number;
};

export type SchoolsHubWorkspaceResponse = {
  anchor_date: string;
  generated_at: string;
  scope: "all" | "own";
  summary: SchoolsHubSummary;
  sections: SchoolsHubSection[];
  queue_total_count: number;
  queue_page: number;
  queue_page_size: number;
  queue_has_more: boolean;
  queue_items: SchoolWorkItemRecord[];
};

export type SchoolWorkItemDetailResponse = {
  item: SchoolWorkItemRecord;
  timeline: SchoolWorkTimelineEvent[];
  related_deliverables: SchoolDeliverableRecord[];
  available_actions: {
    can_complete: boolean;
    can_reassign: boolean;
    can_mark_waiting_on_school: boolean;
    can_mark_waiting_on_internal: boolean;
    can_add_blocker: boolean;
    can_remove_blocker: boolean;
    can_convert_to_deliverable: boolean;
  };
};

export type SchoolsHubReferenceOption = {
  id: string;
  label: string;
  helper: string | null;
};

export type SchoolsHubReferenceData = {
  owners: SchoolsHubReferenceOption[];
  schools: SchoolsHubReferenceOption[];
  jobs: SchoolsHubReferenceOption[];
  locations: SchoolsHubReferenceOption[];
  contacts: SchoolsHubReferenceOption[];
};

export type SchoolsHubFilters = {
  anchor_date: string;
  search: string;
  owner_user_id: string | null;
  school_id: string | null;
  job_id: string | null;
  work_type: SchoolWorkType | "all";
  priority: SchoolWorkPriority | "all";
  waiting_on: SchoolWorkWaitingOn | "all";
  page?: number;
  page_size?: number;
};

export type SchoolWorkItemUpdateInput = {
  school_job_id?: string | null;
  linked_shoot_id?: string | null;
  linked_location_id?: string | null;
  linked_contact_id?: string | null;
  linked_follow_up_id?: string | null;
  linked_production_project_id?: string | null;
  title?: string | null;
  description?: string | null;
  owner_user_id?: string | null;
  status?: SchoolWorkStatus | null;
  stage?: SchoolWorkStage | null;
  priority?: SchoolWorkPriority | null;
  due_date?: string | null;
  sla_date?: string | null;
  blocker_reason?: string | null;
  waiting_on?: SchoolWorkWaitingOn | null;
  expected_updated_at?: string | null;
  notes?: string | null;
};

export type SchoolWorkItemBulkUpdateInput = {
  ids: string[];
  owner_user_id?: string | null;
  status?: SchoolWorkStatus | null;
  stage?: SchoolWorkStage | null;
  priority?: SchoolWorkPriority | null;
  due_date?: string | null;
  blocker_reason?: string | null;
  waiting_on?: SchoolWorkWaitingOn | null;
};

export type MondayImportMode = "job" | "work_item" | "job_and_work_item";

export type MondaySchoolJobImportInput = {
  job_type: SchoolJobType;
  title: string;
  event_date?: string | null;
  due_date?: string | null;
  owner_user_id?: string | null;
  status?: SchoolJobStatus;
  notes?: string | null;
};

export type MondaySchoolWorkItemImportInput = {
  work_type: SchoolWorkType;
  title: string;
  description?: string | null;
  owner_user_id?: string | null;
  status?: SchoolWorkStatus;
  stage?: SchoolWorkStage | null;
  priority?: SchoolWorkPriority;
  due_date?: string | null;
  sla_date?: string | null;
  blocker_reason?: string | null;
  waiting_on?: SchoolWorkWaitingOn;
  generated_by_rule?: boolean;
  notes?: string | null;
};

export type MondaySchoolImportInput = {
  organization_id: string;
  import_mode: MondayImportMode;
  external_record_id: string;
  external_record_name: string;
  external_board_id?: string | null;
  external_board_name?: string | null;
  external_group_id?: string | null;
  external_group_title?: string | null;
  external_record_url?: string | null;
  linked_shoot_id?: string | null;
  linked_location_id?: string | null;
  linked_contact_id?: string | null;
  linked_production_project_id?: string | null;
  existing_school_job_id?: string | null;
  raw_snapshot?: Record<string, unknown> | null;
  mapped_job?: MondaySchoolJobImportInput | null;
  mapped_work_item?: MondaySchoolWorkItemImportInput | null;
};

export type MondayImportSyncOperationSummary = {
  entity_type: "school_job" | "school_work_item";
  entity_id: string | null;
  operation_id: string;
  status: "pending" | "processing" | "succeeded" | "failed" | "conflict";
};

export type MondaySchoolImportResult = {
  imported_job: SchoolJobRecord | null;
  imported_work_item: SchoolWorkItemRecord | null;
  sync_operations: MondayImportSyncOperationSummary[];
};

export type CreateSchoolDeliverableInput = {
  school_work_item_id: string;
  deliverable_type?: SchoolDeliverableType | null;
  due_date?: string | null;
  delivery_method?: SchoolDeliveryMethod | null;
  notes?: string | null;
};
