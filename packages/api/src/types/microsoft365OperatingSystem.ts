export type Microsoft365OperatingSystemEnvironment = "development" | "staging" | "production";
export type Microsoft365OperatingSystemFindingState = "existing" | "partial" | "missing" | "conflict";
export type Microsoft365OperatingSystemIssueSeverity = "warning" | "error";
export type Microsoft365OperatingSystemRiskSeverity = "low" | "medium" | "high";
export type Microsoft365OperatingSystemGoNoGo = "go" | "conditional_go" | "no_go";
export type Microsoft365OperatingSystemDepartmentKey =
  | "schools"
  | "sports"
  | "production"
  | "customer_service"
  | "sales"
  | "leadership"
  | "it_systems";
export type Microsoft365OperatingSystemChannelKey =
  | "general"
  | "active_projects"
  | "escalations"
  | "templates_sops"
  | "automation_alerts"
  | "approvals";

export interface Microsoft365OperatingSystemValidationIssue {
  area: string;
  severity: Microsoft365OperatingSystemIssueSeverity;
  code: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface Microsoft365OperatingSystemCurrentStateFinding {
  key: string;
  state: Microsoft365OperatingSystemFindingState;
  summary: string;
  evidence: string[];
  recommended_refactor?: string | null;
}

export interface Microsoft365OperatingSystemRefactorItem {
  key: string;
  severity: Microsoft365OperatingSystemRiskSeverity;
  summary: string;
  consequence: string;
}

export interface Microsoft365OperatingSystemExecutionStep {
  order: number;
  title: string;
  owner: string;
  requires_tenant_admin: boolean;
  rollback: string;
}

export interface Microsoft365OperatingSystemManualChecklistItem {
  order: number;
  step: string;
  portal: string | null;
  requires_tenant_admin: boolean;
  owner: string;
}

export interface Microsoft365OperatingSystemDocReference {
  key: string;
  title: string;
  path: string;
  summary: string;
}

export interface Microsoft365OperatingSystemArtifact {
  kind: "baseline" | "script" | "doc" | "api";
  path: string;
  summary: string;
  tenant_admin_action: boolean;
}

export interface Microsoft365OperatingSystemChannelDefinition {
  key: Microsoft365OperatingSystemChannelKey;
  name: string;
  membership_type: "standard";
  purpose: string;
}

export interface Microsoft365OperatingSystemDepartmentWorkspace {
  department_key: Microsoft365OperatingSystemDepartmentKey;
  department_label: string;
  team_name: string;
  mail_nickname: string;
  sharepoint_site_path: string;
  planner_plan_name: string;
  owner_groups: string[];
  member_groups: string[];
  channels: Microsoft365OperatingSystemChannelDefinition[];
}

export interface Microsoft365OperatingSystemMetadataColumn {
  internal_name: string;
  display_name: string;
  field_type: string;
  required: boolean;
  dashboard_source_field: string;
  notes: string;
}

export interface Microsoft365OperatingSystemDocumentLibrary {
  key: string;
  name: string;
  purpose: string;
  default_folder_pattern: string;
  metadata_columns: Microsoft365OperatingSystemMetadataColumn[];
}

export interface Microsoft365OperatingSystemListField {
  internal_name: string;
  display_name: string;
  field_type: string;
  required: boolean;
  dashboard_source_field: string;
  read_only_mirror: boolean;
  notes: string;
}

export interface Microsoft365OperatingSystemListDefinition {
  key: string;
  name: string;
  purpose: string;
  read_only_mirror: boolean;
  fields: Microsoft365OperatingSystemListField[];
}

export interface Microsoft365OperatingSystemPlannerBucket {
  key: string;
  name: string;
  purpose: string;
}

export interface Microsoft365OperatingSystemPlannerStructure {
  plan_strategy: string;
  task_source_rule: string;
  ownership_rule: string;
  completion_rule: string;
  buckets: Microsoft365OperatingSystemPlannerBucket[];
}

export interface Microsoft365OperatingSystemTabDefinition {
  title: string;
  tab_type: "website" | "document_library" | "list" | "planner" | "files";
  target: string;
  dashboard_deep_link?: string | null;
  notes: string;
}

export interface Microsoft365OperatingSystemChannelTabs {
  channel_key: Microsoft365OperatingSystemChannelKey;
  channel_name: string;
  tabs: Microsoft365OperatingSystemTabDefinition[];
}

export interface Microsoft365OperatingSystemDashboardDeepLink {
  label: string;
  route_hash: string;
  usage: string;
}

export interface Microsoft365OperatingSystemBaseline {
  phase: "phase2_internal_microsoft_operating_system";
  baseline_version: string;
  environment: Microsoft365OperatingSystemEnvironment;
  tenant_tier: "sandbox" | "preproduction" | "production";
  supported_departments: Microsoft365OperatingSystemDepartmentKey[];
  workspace_settings: {
    workspace_name_prefix: string;
    team_name_pattern: string;
    sharepoint_site_path_pattern: string;
    planner_plan_name_pattern: string;
    default_team_visibility: "private";
    dashboard_source_of_truth_rule: string;
    read_only_mirror_fields_rule: string;
  };
  department_workspaces: Microsoft365OperatingSystemDepartmentWorkspace[];
  sharepoint_architecture: {
    site_strategy: string;
    hub_site_url: string;
    libraries: Microsoft365OperatingSystemDocumentLibrary[];
  };
  lists: Microsoft365OperatingSystemListDefinition[];
  planner: Microsoft365OperatingSystemPlannerStructure;
  teams_tabs: {
    channel_defaults: Microsoft365OperatingSystemChannelTabs[];
    dashboard_deep_links: Microsoft365OperatingSystemDashboardDeepLink[];
  };
  execution_order: Microsoft365OperatingSystemExecutionStep[];
  manual_admin_checklist: Microsoft365OperatingSystemManualChecklistItem[];
  validation_checklist: string[];
  rollback_principles: string[];
}

export interface Microsoft365OperatingSystemDiagnosticsResponse {
  generated_at: string;
  baseline_environment: Microsoft365OperatingSystemEnvironment;
  startup_validation: {
    valid: boolean;
    issues: Microsoft365OperatingSystemValidationIssue[];
  };
  phase_audit_summary: {
    implementation_status: string;
    current_state: string;
    recommendation: Microsoft365OperatingSystemGoNoGo;
  };
  current_state_findings: Microsoft365OperatingSystemCurrentStateFinding[];
  refactor_first: Microsoft365OperatingSystemRefactorItem[];
  teams_information_architecture: {
    supported_departments: Microsoft365OperatingSystemDepartmentWorkspace[];
    standard_channel_layout: Microsoft365OperatingSystemChannelDefinition[];
  };
  sharepoint_information_architecture: Microsoft365OperatingSystemBaseline["sharepoint_architecture"];
  lists_schema: Microsoft365OperatingSystemListDefinition[];
  planner_structure: Microsoft365OperatingSystemPlannerStructure;
  teams_tabs_and_navigation: Microsoft365OperatingSystemBaseline["teams_tabs"];
  naming_conventions: Microsoft365OperatingSystemBaseline["workspace_settings"];
  execution_order: Microsoft365OperatingSystemExecutionStep[];
  configuration_artifacts: Microsoft365OperatingSystemArtifact[];
  governance_docs: Microsoft365OperatingSystemDocReference[];
  manual_admin_checklist: Microsoft365OperatingSystemManualChecklistItem[];
  validation_checklist: string[];
  rollback_principles: string[];
}
