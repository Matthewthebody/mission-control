/**
 * These types support Microsoft 365 client-portal diagnostics and later-phase planning.
 *
 * The phase-one contract is intentionally narrow:
 * - schedule
 * - status
 * - files
 * - change history
 *
 * Mission Control remains the operational system of record.
 * The account-facing portal stays outside the internal admin shell.
 */
export type Microsoft365ClientPortalPhaseOneMvpRouteKey = "projects" | "status" | "schedule" | "files" | "history";
export type Microsoft365ClientPortalEnvironment = "development" | "staging" | "production";
export type Microsoft365ClientPortalFindingState = "existing" | "partial" | "missing" | "conflict";
export type Microsoft365ClientPortalIssueSeverity = "warning" | "error";
export type Microsoft365ClientPortalRiskSeverity = "low" | "medium" | "high";
export type Microsoft365ClientPortalGoNoGo = "go" | "conditional_go" | "no_go";
export type Microsoft365ClientPortalAuthProvider = "entra_external_id";
export type Microsoft365ClientPortalAccessScope = "organization" | "job";
export type Microsoft365ClientPortalAccessStatus = "invited" | "active" | "disabled" | "revoked";
export type Microsoft365ClientPortalLinkStatus = "planned" | "linked" | "drifted" | "archived";

export interface Microsoft365ClientPortalValidationIssue {
  area: string;
  severity: Microsoft365ClientPortalIssueSeverity;
  code: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface Microsoft365ClientPortalCurrentStateFinding {
  key: string;
  state: Microsoft365ClientPortalFindingState;
  summary: string;
  evidence: string[];
  recommended_refactor?: string | null;
}

export interface Microsoft365ClientPortalRefactorItem {
  key: string;
  severity: Microsoft365ClientPortalRiskSeverity;
  summary: string;
  consequence: string;
}

export interface Microsoft365ClientPortalExecutionStep {
  order: number;
  title: string;
  owner: string;
  requires_tenant_admin: boolean;
  rollback: string;
}

export interface Microsoft365ClientPortalManualChecklistItem {
  order: number;
  step: string;
  portal: string | null;
  requires_tenant_admin: boolean;
  owner: string;
}

export interface Microsoft365ClientPortalDocReference {
  key: string;
  title: string;
  path: string;
  summary: string;
}

export interface Microsoft365ClientPortalArtifact {
  kind: "baseline" | "script" | "doc" | "api";
  path: string;
  summary: string;
  tenant_admin_action: boolean;
}

export interface Microsoft365ClientPortalPhaseOneMvpRuntimeOwner {
  owner_key: "microsoft365_client_portal";
  owner_service_path: string;
  access_grant_record: "microsoft_client_portal_access_grant";
  project_link_record: "microsoft_client_portal_project_link";
  diagnostics_route: string;
  project_links_route: string;
  access_grants_route: string;
  source_of_truth_rule: string;
  internal_workspace_rule: string;
}

export interface Microsoft365ClientPortalPhaseOneMvpAuthBoundary {
  provider: Microsoft365ClientPortalAuthProvider;
  account_access_rule: string;
  project_access_rule: string;
  revocation_rule: string;
}

export interface Microsoft365ClientPortalPhaseOneMvpShellBoundary {
  admin_shell_rule: string;
  internal_projects_route_rule: string;
}

export interface Microsoft365ClientPortalPhaseOneMvpRuntimeModules {
  backend: string[];
  frontend: string[];
}

export interface Microsoft365ClientPortalPhaseOneMvpRouteDefinition {
  key: Microsoft365ClientPortalPhaseOneMvpRouteKey;
  scope: "account" | "job";
  route: string;
  full_url_template: string | null;
  purpose: string;
  source_records: string[];
}

export interface Microsoft365ClientPortalPhaseOneMvpCompatibilityAlias {
  route: string;
  resolves_to: string;
  purpose: string;
}

export interface Microsoft365ClientPortalPhaseOneMvpDefinition {
  runtime_owner: Microsoft365ClientPortalPhaseOneMvpRuntimeOwner;
  auth_boundary: Microsoft365ClientPortalPhaseOneMvpAuthBoundary;
  shell_boundary: Microsoft365ClientPortalPhaseOneMvpShellBoundary;
  required_runtime_modules: Microsoft365ClientPortalPhaseOneMvpRuntimeModules;
  route_base: string;
  default_entry_route: string;
  routes: Microsoft365ClientPortalPhaseOneMvpRouteDefinition[];
  compatibility_aliases: Microsoft365ClientPortalPhaseOneMvpCompatibilityAlias[];
  phase_one_now: string[];
  deferred: string[];
}

export interface Microsoft365ClientPortalPageDefinition {
  key: "project_overview" | "required_items" | "upload" | "submission_history" | "help";
  title: string;
  route: string;
  purpose: string;
  security_rule: string;
  components: string[];
}

export interface Microsoft365ClientPortalInformationArchitecture {
  site_strategy: string;
  home_route: string;
  page_map: Microsoft365ClientPortalPageDefinition[];
}

export interface Microsoft365ClientPortalAuthenticationModel {
  provider: Microsoft365ClientPortalAuthProvider;
  invitation_rule: string;
  identity_binding_rule: string;
  mfa_rule: string;
  session_rule: string;
  least_privilege_rule: string;
}

export interface Microsoft365ClientPortalScopingRules {
  organization_scope_rule: string;
  project_scope_rule: string;
  upload_scope_rule: string;
  hidden_internal_data_rule: string;
  shareable_content_rule: string;
  revocation_rule: string;
}

export interface Microsoft365ClientPortalUiSpecification {
  project_overview_cards: string[];
  required_item_status_fields: string[];
  upload_page_fields: string[];
  submission_history_fields: string[];
  help_page_sections: string[];
}

export interface Microsoft365ClientPortalDataIntegrationDefinition {
  dashboard_source_of_truth_rule: string;
  portal_mirror_rule: string;
  upload_handling_rule: string;
  dashboard_id_traceability_rule: string;
  approval_status_rule: string;
}

export interface Microsoft365ClientPortalSupportModel {
  support_mailbox_key: string;
  help_page_rule: string;
  escalation_rule: string;
  maintenance_rule: string;
  audit_rule: string;
}

export interface Microsoft365ClientPortalBaseline {
  phase: "phase7_power_pages_client_portal";
  baseline_version: string;
  environment: Microsoft365ClientPortalEnvironment;
  tenant_tier: "sandbox" | "preproduction" | "production";
  portal_information_architecture: Microsoft365ClientPortalInformationArchitecture;
  authentication_model: Microsoft365ClientPortalAuthenticationModel;
  scoping_rules: Microsoft365ClientPortalScopingRules;
  ui_specification: Microsoft365ClientPortalUiSpecification;
  data_integration: Microsoft365ClientPortalDataIntegrationDefinition;
  support_model: Microsoft365ClientPortalSupportModel;
  execution_order: Microsoft365ClientPortalExecutionStep[];
  manual_admin_checklist: Microsoft365ClientPortalManualChecklistItem[];
  validation_checklist: string[];
  rollback_principles: string[];
}

export interface Microsoft365ClientPortalAccessGrantRecord {
  id: string;
  tenant_id: string;
  organization_id: string;
  organization_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  job_id: string | null;
  job_number: string | null;
  job_title: string | null;
  access_scope: Microsoft365ClientPortalAccessScope;
  access_status: Microsoft365ClientPortalAccessStatus;
  external_email: string;
  external_identity_provider: Microsoft365ClientPortalAuthProvider;
  external_identity_subject: string | null;
  power_pages_contact_id: string | null;
  power_pages_web_role_keys: string[];
  invited_by_user_id: string | null;
  last_sign_in_at: string | null;
  last_notified_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Microsoft365ClientPortalProjectLinkRecord {
  id: string;
  tenant_id: string;
  organization_id: string;
  organization_name: string | null;
  job_id: string;
  job_number: string | null;
  job_title: string | null;
  canonical_dashboard_id: string;
  power_pages_site_key: string;
  portal_project_key: string;
  overview_page_url: string | null;
  required_items_page_url: string | null;
  upload_page_url: string | null;
  submission_history_page_url: string | null;
  help_page_url: string | null;
  link_status: Microsoft365ClientPortalLinkStatus;
  metadata: Record<string, unknown>;
  last_synced_at: string | null;
  last_sync_error: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Microsoft365ClientPortalProjectSummary {
  job_id: string;
  organization_id: string | null;
  organization_name: string | null;
  job_number: string | null;
  title: string | null;
  job_status: string | null;
  client_deadline_at: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  owner_name: string | null;
  dashboard_url: string | null;
  portal_links: {
    overview_page_url: string | null;
    required_items_page_url: string | null;
    upload_page_url: string | null;
    submission_history_page_url: string | null;
    help_page_url: string | null;
  };
  required_item_summary: {
    total_count: number;
    complete_count: number;
    open_count: number;
    overdue_count: number;
  };
  submission_summary: {
    total_count: number;
    latest_submitted_at: string | null;
    approved_count: number;
    under_review_count: number;
    revision_requested_count: number;
  };
}

export interface Microsoft365ClientPortalRequiredItemView {
  id: string;
  label: string;
  is_complete: boolean;
  is_blocker: boolean;
  due_at: string | null;
  upload_url: string | null;
  latest_submission_at: string | null;
  latest_submission_status: string | null;
}

export interface Microsoft365ClientPortalSubmissionHistoryItem {
  id: string;
  mapping_id: string | null;
  required_item_id: string | null;
  required_item_label: string | null;
  file_name: string;
  file_url: string | null;
  submitted_at: string;
  matching_status: string;
  uploader_name: string | null;
}

export interface Microsoft365ClientPortalProjectView {
  project: Microsoft365ClientPortalProjectSummary;
  required_items: Microsoft365ClientPortalRequiredItemView[];
  submission_history: Microsoft365ClientPortalSubmissionHistoryItem[];
  access_grants: Microsoft365ClientPortalAccessGrantRecord[];
  help_contact: {
    support_mailbox_key: string;
    help_page_url: string | null;
    guidance: string;
  };
}

export interface Microsoft365ClientPortalWorkspace {
  generated_at: string;
  summary: {
    active_grant_count: number;
    invited_grant_count: number;
    active_project_count: number;
    drifted_project_count: number;
    projects_missing_portal_links_count: number;
  };
  access_grants: Microsoft365ClientPortalAccessGrantRecord[];
  project_links: Microsoft365ClientPortalProjectLinkRecord[];
  project_views: Microsoft365ClientPortalProjectView[];
}

export interface Microsoft365ClientPortalDiagnosticsResponse {
  generated_at: string;
  baseline_environment: Microsoft365ClientPortalEnvironment;
  phase_one_portal_mvp: Microsoft365ClientPortalPhaseOneMvpDefinition;
  startup_validation: {
    valid: boolean;
    issues: Microsoft365ClientPortalValidationIssue[];
  };
  phase_audit_summary: {
    implementation_status: string;
    current_state: string;
    recommendation: Microsoft365ClientPortalGoNoGo;
  };
  current_state_findings: Microsoft365ClientPortalCurrentStateFinding[];
  refactor_first: Microsoft365ClientPortalRefactorItem[];
  portal_information_architecture: Microsoft365ClientPortalInformationArchitecture;
  authentication_model: Microsoft365ClientPortalAuthenticationModel;
  scoping_rules: Microsoft365ClientPortalScopingRules;
  ui_specification: Microsoft365ClientPortalUiSpecification;
  data_integration: Microsoft365ClientPortalDataIntegrationDefinition;
  support_model: Microsoft365ClientPortalSupportModel;
  execution_order: Microsoft365ClientPortalExecutionStep[];
  configuration_artifacts: Microsoft365ClientPortalArtifact[];
  governance_docs: Microsoft365ClientPortalDocReference[];
  manual_admin_checklist: Microsoft365ClientPortalManualChecklistItem[];
  validation_checklist: string[];
  rollback_principles: string[];
  workspace: Microsoft365ClientPortalWorkspace;
}

export interface UpsertMicrosoft365ClientPortalAccessGrantInput {
  organization_id?: string | null;
  contact_id?: string | null;
  job_id?: string | null;
  access_scope: Microsoft365ClientPortalAccessScope;
  access_status?: Microsoft365ClientPortalAccessStatus;
  external_email: string;
  external_identity_provider?: Microsoft365ClientPortalAuthProvider;
  external_identity_subject?: string | null;
  power_pages_contact_id?: string | null;
  power_pages_web_role_keys?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpsertMicrosoft365ClientPortalProjectLinkInput {
  job_id: string;
  power_pages_site_key?: string | null;
  portal_project_key: string;
  overview_page_url?: string | null;
  required_items_page_url?: string | null;
  upload_page_url?: string | null;
  submission_history_page_url?: string | null;
  help_page_url?: string | null;
  link_status?: Microsoft365ClientPortalLinkStatus;
  metadata?: Record<string, unknown>;
}
