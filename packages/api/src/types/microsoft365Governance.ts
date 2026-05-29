export type Microsoft365GovernanceEnvironment = "development" | "staging" | "production";
export type Microsoft365GovernanceFindingState = "existing" | "partial" | "missing" | "conflict";
export type Microsoft365GovernanceIssueSeverity = "warning" | "error";
export type Microsoft365GovernanceRiskSeverity = "low" | "medium" | "high";
export type Microsoft365GovernanceGoNoGo = "go" | "conditional_go" | "no_go";
export type Microsoft365GovernancePersona =
  | "platform_admin"
  | "security_admin"
  | "department_lead"
  | "project_owner"
  | "reviewer"
  | "staff"
  | "external_user";

export interface Microsoft365GovernanceValidationIssue {
  area: string;
  severity: Microsoft365GovernanceIssueSeverity;
  code: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface Microsoft365GovernanceExecutionStep {
  order: number;
  title: string;
  owner: string;
  requires_tenant_admin: boolean;
  rollback: string;
}

export interface Microsoft365GovernancePermissionMatrixRow {
  persona: Microsoft365GovernancePersona;
  dashboard_access: string[];
  m365_admin_roles: string[];
  allowed_actions: string[];
  restrictions: string[];
}

export interface Microsoft365GovernanceManualChecklistItem {
  order: number;
  step: string;
  portal: string | null;
  requires_tenant_admin: boolean;
  owner: string;
}

export interface Microsoft365GovernanceDocReference {
  key: string;
  title: string;
  path: string;
  summary: string;
}

export interface Microsoft365GovernanceArtifact {
  kind: "baseline" | "script" | "doc" | "api";
  path: string;
  summary: string;
  tenant_admin_action: boolean;
}

export interface Microsoft365GovernanceCurrentStateFinding {
  key: string;
  state: Microsoft365GovernanceFindingState;
  summary: string;
  evidence: string[];
  recommended_refactor?: string | null;
}

export interface Microsoft365GovernanceSecurityGap {
  key: string;
  severity: Microsoft365GovernanceRiskSeverity;
  summary: string;
  consequence: string;
  refactor_first: boolean;
}

export interface Microsoft365GovernanceBaseline {
  phase: "phase1_security_governance_foundation";
  baseline_version: string;
  environment: Microsoft365GovernanceEnvironment;
  tenant_tier: "sandbox" | "preproduction" | "production";
  principal_settings: {
    group_prefix: string;
    require_managed_devices_for_admin_portals: boolean;
    require_phishing_resistant_mfa_for_admins: boolean;
    sharepoint_external_sharing_mode: string;
    onedrive_external_sharing_mode: string;
    power_automate_managed_environment_required: boolean;
  };
  current_state_targets: {
    enforce_entra_auth_for_admins: boolean;
    permit_local_password_for_break_glass_only: boolean;
    tenant_admin_actions_required: boolean;
  };
  execution_order: Microsoft365GovernanceExecutionStep[];
  permissions_matrix: Microsoft365GovernancePermissionMatrixRow[];
  governance_models: {
    shared_mailboxes: string[];
    external_sharing: string[];
    sensitivity_labels: string[];
    audit_and_retention: string[];
    automation_ownership: string[];
  };
  manual_admin_checklist: Microsoft365GovernanceManualChecklistItem[];
  validation_checklist: string[];
  rollback_principles: string[];
}

export interface Microsoft365GovernanceDiagnosticsResponse {
  generated_at: string;
  baseline_environment: Microsoft365GovernanceEnvironment;
  startup_validation: {
    valid: boolean;
    issues: Microsoft365GovernanceValidationIssue[];
  };
  phase_audit_summary: {
    implementation_status: string;
    current_state: string;
    recommendation: Microsoft365GovernanceGoNoGo;
  };
  current_state_findings: Microsoft365GovernanceCurrentStateFinding[];
  security_gaps: Microsoft365GovernanceSecurityGap[];
  refactor_first: string[];
  execution_order: Microsoft365GovernanceExecutionStep[];
  permissions_matrix: Microsoft365GovernancePermissionMatrixRow[];
  governance_docs: Microsoft365GovernanceDocReference[];
  configuration_artifacts: Microsoft365GovernanceArtifact[];
  manual_admin_checklist: Microsoft365GovernanceManualChecklistItem[];
  validation_checklist: string[];
  rollback_principles: string[];
  baseline_controls: {
    entra_access_model: string[];
    mfa: string[];
    conditional_access: string[];
    intune: string[];
    external_sharing: string[];
    shared_mailboxes: string[];
    sensitivity_labels: string[];
    dlp: string[];
    audit_and_retention: string[];
    power_automate: string[];
  };
}
