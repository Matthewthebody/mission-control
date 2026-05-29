import type { LayerNamingRecommendation } from "./types.js";

export const NAMING_RECOMMENDATIONS_BY_LAYER: LayerNamingRecommendation[] = [
  {
    systemLayer: "database_schema",
    recommendation:
      "Use singular snake_case canonical nouns and subsystem-owned state names for tables and columns.",
    preferredPattern: "organization, shoot, shift, assignment_status, approval_status, organization_id",
    examples: ["shoot_status", "organization_id", "post_shoot_evaluation"],
    avoid: ["job", "event", "client_id", "status", "note_text"]
  },
  {
    systemLayer: "backend_types",
    recommendation:
      "Use PascalCase canonical nouns and subsystem-qualified enum names for state concepts.",
    preferredPattern: "Shoot, Shift, Assignment, ShootStatus, ApprovalStatus",
    examples: ["ReadinessState", "AttendanceStatus", "AuthorizationDecision"],
    avoid: ["Status", "EventType", "JobInfo", "ProblemState"]
  },
  {
    systemLayer: "api_contracts",
    recommendation:
      "Use camelCase DTO fields that preserve canonical backend nouns and avoid UI-only aliases as structural names.",
    preferredPattern: "organizationId, shootStatus, readinessState, approvalStatus",
    examples: ["postShootEvaluation", "assignmentStatus", "alertSeverity"],
    avoid: ["accountId", "clientId", "status", "note"]
  },
  {
    systemLayer: "frontend_ui",
    recommendation:
      "Use human-readable labels, but tie every label back to one canonical backend concept and do not invent new model names.",
    preferredPattern: "Shoot Status, Readiness, Lead Photographer, Setup Photo",
    examples: ["Account Overview as UI copy for Organization context", "Post-Shoot Evaluation"],
    avoid: ["Job", "Event", "Problem", "Admin"]
  },
  {
    systemLayer: "filters_and_dashboards",
    recommendation:
      "Name filters and widgets by subsystem-owned concepts so operators know which system produced the truth.",
    preferredPattern: "Shoot Status filter, Assignment Status filter, Attendance Status board",
    examples: ["Readiness Summary", "Approval Queue", "Alert Severity"],
    avoid: ["Status filter", "Problem board", "Warnings"]
  },
  {
    systemLayer: "audit_logs",
    recommendation:
      "Use canonical object names and explicit action names so audit history remains reconstructable across systems.",
    preferredPattern: "shoot.transitioned, assignment.published, approval.approved",
    examples: ["readiness.override_requested", "time_clock_entry.corrected"],
    avoid: ["status changed", "job updated", "problem fixed"]
  },
  {
    systemLayer: "permissions",
    recommendation:
      "Use explicit resource and action names with scoped authorization language that maps directly to domain concepts.",
    preferredPattern: "shoot.transition, assignment.publish, approval.approve",
    examples: ["readiness.evaluate", "organization.view"],
    avoid: ["manage_jobs", "admin_access", "status_edit"]
  },
  {
    systemLayer: "alerts_and_notifications",
    recommendation:
      "Separate the underlying business record name from the signal and the delivery artifact.",
    preferredPattern: "Alert -> Notification",
    examples: ["Missing Setup Photo Alert", "Assigned But Missing Alert", "Notification Delivery"],
    avoid: ["problem email", "warning message", "issue alert notification"]
  },
  {
    systemLayer: "integrations",
    recommendation:
      "Map external words into canonical internal nouns at the boundary and never persist external vocabulary as core truth.",
    preferredPattern: "external payload -> mapped canonical DTO -> application action",
    examples: ["Monday item -> Shoot sync candidate", "Outlook event -> Shift sync candidate"],
    avoid: ["Monday job", "Outlook event status", "Zendesk problem state"]
  },
  {
    systemLayer: "prompts_and_docs",
    recommendation:
      "Use glossary-approved nouns and state phrases exactly so prompts, specs, and docs reinforce the same model as code.",
    preferredPattern: "Shoot, Shift, Assignment, Readiness State, Approval Status",
    examples: ["Lead Photographer", "Post-Shoot Evaluation", "Exception Request"],
    avoid: ["job", "event", "problem", "status", "note"]
  }
];
