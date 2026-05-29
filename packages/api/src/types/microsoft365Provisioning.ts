export type Microsoft365ProvisioningEnvironment = "development" | "staging" | "production";
export type Microsoft365ProvisioningFindingState = "existing" | "partial" | "missing" | "conflict";
export type Microsoft365ProvisioningIssueSeverity = "warning" | "error";
export type Microsoft365ProvisioningRiskSeverity = "low" | "medium" | "high";
export type Microsoft365ProvisioningGoNoGo = "go" | "conditional_go" | "no_go";

export type Microsoft365CanonicalEntityFamily =
  | "client"
  | "project"
  | "required_item"
  | "submission"
  | "task"
  | "communication_event";

export type Microsoft365DashboardEntityType =
  | "organization"
  | "job"
  | "job_readiness_item"
  | "post_shoot_evaluation"
  | "work_task"
  | "communication_event";

export type Microsoft365ProvisioningObjectType =
  | "team"
  | "channel"
  | "sharepoint_site"
  | "sharepoint_library"
  | "sharepoint_folder"
  | "microsoft_list"
  | "microsoft_list_item"
  | "planner_plan"
  | "planner_bucket"
  | "planner_task"
  | "shared_mailbox";

export type Microsoft365LinkSyncStatus = "pending" | "linked" | "failed" | "drifted" | "archived";

export interface Microsoft365ProvisioningValidationIssue {
  area: string;
  severity: Microsoft365ProvisioningIssueSeverity;
  code: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface Microsoft365ProvisioningCurrentStateFinding {
  key: string;
  state: Microsoft365ProvisioningFindingState;
  summary: string;
  evidence: string[];
  recommended_refactor?: string | null;
}

export interface Microsoft365ProvisioningRefactorItem {
  key: string;
  severity: Microsoft365ProvisioningRiskSeverity;
  summary: string;
  consequence: string;
}

export interface Microsoft365ProvisioningExecutionStep {
  order: number;
  title: string;
  owner: string;
  requires_tenant_admin: boolean;
  rollback: string;
}

export interface Microsoft365ProvisioningManualChecklistItem {
  order: number;
  step: string;
  portal: string | null;
  requires_tenant_admin: boolean;
  owner: string;
}

export interface Microsoft365ProvisioningDocReference {
  key: string;
  title: string;
  path: string;
  summary: string;
}

export interface Microsoft365ProvisioningArtifact {
  kind: "baseline" | "script" | "doc" | "api";
  path: string;
  summary: string;
  tenant_admin_action: boolean;
}

export interface Microsoft365CanonicalEntityContract {
  entity_family: Microsoft365CanonicalEntityFamily;
  dashboard_entity_type: Microsoft365DashboardEntityType;
  canonical_id_prefix: string;
  canonical_id_pattern: string;
  dashboard_route_hash: string | null;
  source_of_truth_rule: string;
  mirror_scope_rule: string;
  microsoft_targets: Microsoft365ProvisioningObjectType[];
  notes?: string | null;
}

export interface Microsoft365FieldOwnershipDefinition {
  dashboard_field: string;
  microsoft_field: string;
  owner: "dashboard" | "microsoft_read_only_mirror" | "microsoft_computed";
  sync_behavior: "mirror_on_change" | "backlink_only" | "manual_reference";
  notes: string;
}

export interface Microsoft365FieldMappingDefinition {
  entity_family: Microsoft365CanonicalEntityFamily;
  microsoft_target: Microsoft365ProvisioningObjectType;
  container_name: string;
  fields: Microsoft365FieldOwnershipDefinition[];
}

export interface Microsoft365ProvisioningTargetObject {
  microsoft_object_type: Microsoft365ProvisioningObjectType;
  logical_name: string;
  naming_pattern: string;
  backlink_field: string | null;
  microsoft_url_field: string | null;
  notes: string;
}

export interface Microsoft365ProvisioningFlowDefinition {
  key: string;
  dashboard_entity_type: Microsoft365DashboardEntityType;
  operation_type: string;
  source_trigger: string;
  target_objects: Microsoft365ProvisioningTargetObject[];
  notes: string;
}

export interface Microsoft365SyncArchitectureDefinition {
  provider: string;
  outbound_queue: string;
  sync_mode: string;
  idempotency_rule: string;
  retry_rule: string;
  reconciliation_rule: string;
  failure_queue_rule: string;
}

export interface Microsoft365RetryAndReconciliationDefinition {
  queue_of_record: string;
  replay_entrypoint: string;
  reconciliation_jobs: string[];
  failure_states: string[];
  operator_recovery: string[];
}

export interface Microsoft365ProvisioningBaseline {
  phase: "phase3_dashboard_integration_contract_and_provisioning";
  baseline_version: string;
  environment: Microsoft365ProvisioningEnvironment;
  tenant_tier: "sandbox" | "preproduction" | "production";
  sync_architecture: Microsoft365SyncArchitectureDefinition;
  canonical_entities: Microsoft365CanonicalEntityContract[];
  field_mappings: Microsoft365FieldMappingDefinition[];
  provisioning_flows: Microsoft365ProvisioningFlowDefinition[];
  retry_and_reconciliation: Microsoft365RetryAndReconciliationDefinition;
  execution_order: Microsoft365ProvisioningExecutionStep[];
  manual_admin_checklist: Microsoft365ProvisioningManualChecklistItem[];
  validation_checklist: string[];
  rollback_principles: string[];
}

export interface Microsoft365ProvisioningDiagnosticsResponse {
  generated_at: string;
  baseline_environment: Microsoft365ProvisioningEnvironment;
  startup_validation: {
    valid: boolean;
    issues: Microsoft365ProvisioningValidationIssue[];
  };
  phase_audit_summary: {
    implementation_status: string;
    current_state: string;
    recommendation: Microsoft365ProvisioningGoNoGo;
  };
  current_state_findings: Microsoft365ProvisioningCurrentStateFinding[];
  refactor_first: Microsoft365ProvisioningRefactorItem[];
  canonical_entity_contract: Microsoft365CanonicalEntityContract[];
  sync_architecture: Microsoft365SyncArchitectureDefinition;
  data_ownership: Microsoft365FieldMappingDefinition[];
  provisioning_flows: Microsoft365ProvisioningFlowDefinition[];
  retry_and_reconciliation: Microsoft365RetryAndReconciliationDefinition;
  execution_order: Microsoft365ProvisioningExecutionStep[];
  configuration_artifacts: Microsoft365ProvisioningArtifact[];
  governance_docs: Microsoft365ProvisioningDocReference[];
  manual_admin_checklist: Microsoft365ProvisioningManualChecklistItem[];
  validation_checklist: string[];
  rollback_principles: string[];
}

export interface Microsoft365ProvisioningPlanItem {
  microsoft_object_type: Microsoft365ProvisioningObjectType;
  logical_name: string;
  naming_pattern: string;
  backlink_field: string | null;
  microsoft_url_field: string | null;
  notes: string;
}

export interface Microsoft365ProvisioningPlan {
  canonical_dashboard_id: string;
  dashboard_entity_type: Microsoft365DashboardEntityType;
  dashboard_entity_id: string;
  entity_family: Microsoft365CanonicalEntityFamily;
  dashboard_url: string | null;
  operation_type: string;
  source_trigger: string;
  target_objects: Microsoft365ProvisioningPlanItem[];
}

export interface Microsoft365ProvisioningLinkRecord {
  id: string;
  tenant_id: string;
  provider: string;
  dashboard_entity_type: Microsoft365DashboardEntityType;
  dashboard_entity_id: string;
  canonical_dashboard_id: string;
  microsoft_object_type: Microsoft365ProvisioningObjectType;
  microsoft_object_id: string;
  microsoft_object_label: string | null;
  microsoft_parent_object_id: string | null;
  microsoft_url: string | null;
  dashboard_url: string | null;
  mirror_scope: string;
  sync_status: Microsoft365LinkSyncStatus;
  last_sync_operation_id: string | null;
  last_sync_error: string | null;
  last_synced_at: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface QueueMicrosoft365ProvisioningInput {
  dashboard_entity_type: Microsoft365DashboardEntityType;
  dashboard_entity_id: string;
  source_change_key?: string | null;
}

export interface UpsertMicrosoft365ProvisioningLinkInput {
  dashboard_entity_type: Microsoft365DashboardEntityType;
  dashboard_entity_id: string;
  operation_id?: string | null;
  dashboard_url?: string | null;
  resolved_objects: Array<{
    microsoft_object_type: Microsoft365ProvisioningObjectType;
    microsoft_object_id: string;
    microsoft_object_label?: string | null;
    microsoft_parent_object_id?: string | null;
    microsoft_url?: string | null;
    sync_status?: Microsoft365LinkSyncStatus;
    metadata?: Record<string, unknown>;
  }>;
}
