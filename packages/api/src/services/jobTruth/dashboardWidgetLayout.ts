import { hasAuthorityTier } from "../../authz/authority.js";
import type { JobDepartmentType } from "../../domain/jobTruth/index.js";
import type { AuthUser } from "../../types/auth.js";
import type {
  DashboardResponse,
  DashboardWidgetLayout,
  DashboardWidgetLayoutItem,
  DashboardWidgetRoleKey,
  DashboardWidgetSummary
} from "../../types/jobTruth.js";
import { canAccessExecutiveCommandLayer } from "./sharedCommandAccess.js";

type DashboardScope = DashboardResponse["scope"];
type DashboardSummary = DashboardResponse["summary"];
type DashboardWidgetKey =
  | "blocked_jobs"
  | "blocked_production"
  | "checklist_approvals"
  | "delivery_risks"
  | "jobs_next_7_days"
  | "jobs_today"
  | "missing_ready_confirmations"
  | "missing_staffing"
  | "my_open_flags"
  | "overdue_approvals"
  | "overdue_checklists"
  | "qa_rework_queue"
  | "rejected_checklists"
  | "urgent_watch_next_24h"
  | "waiting_on_client";

type DashboardWidgetTemplate = {
  widget_key: DashboardWidgetKey;
  title: string;
  description: string;
  count: (summary: DashboardSummary) => number;
  routeHash: (departmentType: JobDepartmentType | null) => string;
  tone: (summary: DashboardSummary) => DashboardWidgetSummary["tone"];
  required: boolean;
  default_visible: boolean;
  reason: string;
};

type WidgetPreferenceInput = {
  widget_key: string;
  position_index: number;
  is_visible: boolean;
  settings_json?: Record<string, unknown> | null;
};

const PHOTOGRAPHY_PROFILES = [
  "associate_photographer",
  "seasonal_photographer",
  "part_time_photographer",
  "senior_photographer",
  "lead_photographer",
  "director_of_photography",
  "director_of_school_photography",
  "director_of_sports_photography"
] as const;

const PRODUCTION_PROFILES = ["graphic_artist", "director_of_digital_production", "production_artist"] as const;

function hasProfile(auth: AuthUser, profiles: readonly string[]) {
  return profiles.some(
    (profile) =>
      String(auth.primaryJobFunctionProfile) === profile || auth.jobFunctionProfiles?.some((currentProfile) => String(currentProfile) === profile)
  );
}

function isProductionRole(auth: AuthUser) {
  return String(auth.department) === "production" || hasProfile(auth, PRODUCTION_PROFILES);
}

function isPhotographerRole(auth: AuthUser) {
  return String(auth.department) === "photography" || hasProfile(auth, PHOTOGRAPHY_PROFILES);
}

function baseDepartmentHash(departmentType: JobDepartmentType | null) {
  return departmentType === "schools" ? "#schools" : departmentType === "sports" ? "#sports" : "#dashboard";
}

function productionHash(departmentType: JobDepartmentType | null) {
  return departmentType === "schools" ? "#schools/production" : departmentType === "sports" ? "#sports/production" : "#production";
}

function toScope(value: string): DashboardScope {
  return value === "executive" || value === "today" || value === "department" ? value : "home";
}

function widgetTemplate(
  widget_key: DashboardWidgetKey,
  title: string,
  description: string,
  count: (summary: DashboardSummary) => number,
  routeHash: (departmentType: JobDepartmentType | null) => string,
  tone: (summary: DashboardSummary) => DashboardWidgetSummary["tone"],
  options: { required?: boolean; default_visible?: boolean; reason: string }
): DashboardWidgetTemplate {
  return {
    widget_key,
    title,
    description,
    count,
    routeHash,
    tone,
    required: options.required ?? false,
    default_visible: options.default_visible ?? true,
    reason: options.reason
  };
}

const ROLE_WIDGET_TEMPLATES: Record<DashboardWidgetRoleKey, DashboardWidgetTemplate[]> = {
  leadership: [
    widgetTemplate(
      "urgent_watch_next_24h",
      "Exceptions Next 24h",
      "The highest-priority unresolved work inside the next 24 hours.",
      (summary) => summary.urgent_count,
      () => "#exceptions?next_24_hours=yes",
      (summary) => (summary.urgent_count ? "danger" : "success"),
      { required: true, reason: "Leadership needs exceptions visibility on every homepage." }
    ),
    widgetTemplate(
      "missing_staffing",
      "Missing Staffing",
      "Coverage gaps, missing leads, and day-of staffing risk.",
      (summary) => summary.staffing_gap_count,
      () => "#exceptions?flag_type=staffing_gap",
      (summary) => (summary.staffing_gap_count ? "warning" : "success"),
      { required: true, reason: "Staffing gaps stay pinned for leadership oversight." }
    ),
    widgetTemplate(
      "blocked_production",
      "Blocked Production",
      "Downstream work currently blocked or stopped.",
      (summary) => summary.blocked_production_count,
      () => "#production?blocked=yes",
      (summary) => (summary.blocked_production_count ? "danger" : "success"),
      { required: true, reason: "Blocked production is part of the default leadership operating picture." }
    ),
    widgetTemplate(
      "jobs_today",
      "Jobs Today",
      "Active field execution happening today.",
      (summary) => summary.jobs_today,
      () => "#operations/today",
      (summary) => (summary.jobs_today ? "info" : "neutral"),
      { required: true, reason: "Leadership needs same-day execution context by default." }
    ),
    widgetTemplate(
      "overdue_approvals",
      "Overdue Approvals",
      "Approval work that is overdue or slipping.",
      (summary) => summary.overdue_approval_count,
      () => "#production?approval_status=overdue",
      (summary) => (summary.overdue_approval_count ? "warning" : "success"),
      { default_visible: true, reason: "Approval drag is visible by default for leadership review." }
    ),
    widgetTemplate(
      "blocked_jobs",
      "Blocked Jobs",
      "Jobs or production records held up by checklist gaps.",
      (summary) => summary.blocked_job_count,
      () => "#operations/today",
      (summary) => (summary.blocked_job_count ? "danger" : "success"),
      { default_visible: true, reason: "Blocked jobs are part of the core weekly leadership scan." }
    ),
    widgetTemplate(
      "overdue_checklists",
      "Overdue Checklists",
      "Workflow checklists already late or past due.",
      (summary) => summary.overdue_checklist_count,
      () => "#production?checklist_state=overdue",
      (summary) => (summary.overdue_checklist_count ? "danger" : "success"),
      { default_visible: false, reason: "Available when leadership wants a deeper checklist view." }
    ),
    widgetTemplate(
      "checklist_approvals",
      "Checklist Approvals",
      "Submitted checklists still waiting on approval.",
      (summary) => summary.awaiting_checklist_approval_count,
      () => "#production?checklist_state=awaiting_approval",
      (summary) => (summary.awaiting_checklist_approval_count ? "warning" : "success"),
      { default_visible: false, reason: "Optional deeper view into the approval backlog." }
    ),
    widgetTemplate(
      "rejected_checklists",
      "Rejected Checklists",
      "Checklist work sent back and blocking progress.",
      (summary) => summary.rejected_checklist_count,
      () => "#production?checklist_state=rejected",
      (summary) => (summary.rejected_checklist_count ? "warning" : "success"),
      { default_visible: false, reason: "Optional quality correction view for leadership." }
    ),
    widgetTemplate(
      "delivery_risks",
      "Delivery Risks",
      "Deliverables that need intervention before release.",
      (summary) => summary.delivery_risk_count,
      () => "#production?delivery_status=issue_flagged",
      (summary) => (summary.delivery_risk_count ? "warning" : "success"),
      { default_visible: false, reason: "Optional downstream risk widget for deeper review." }
    )
  ],
  production: [
    widgetTemplate(
      "blocked_production",
      "Blocked Production",
      "Production items stopped by issues, files, or dependencies.",
      (summary) => summary.blocked_production_count,
      (departmentType) => productionHash(departmentType),
      (summary) => (summary.blocked_production_count ? "danger" : "success"),
      { required: true, reason: "Blocked production stays pinned for production staff." }
    ),
    widgetTemplate(
      "overdue_checklists",
      "Overdue Checklists",
      "Checklist gates already past due.",
      (summary) => summary.overdue_checklist_count,
      (departmentType) => `${productionHash(departmentType)}?checklist_state=overdue`,
      (summary) => (summary.overdue_checklist_count ? "danger" : "success"),
      { required: true, reason: "Overdue checklist gates are part of the production default." }
    ),
    widgetTemplate(
      "checklist_approvals",
      "Checklist Approvals",
      "Submitted checklists still waiting for sign-off.",
      (summary) => summary.awaiting_checklist_approval_count,
      (departmentType) => `${productionHash(departmentType)}?checklist_state=awaiting_approval`,
      (summary) => (summary.awaiting_checklist_approval_count ? "warning" : "success"),
      { required: true, reason: "Approval queues stay visible for production leads." }
    ),
    widgetTemplate(
      "delivery_risks",
      "Delivery Risks",
      "Delivery commitments now at risk.",
      (summary) => summary.delivery_risk_count,
      (departmentType) => `${productionHash(departmentType)}?delivery_status=issue_flagged`,
      (summary) => (summary.delivery_risk_count ? "warning" : "success"),
      { required: true, reason: "Release and delivery pressure stays visible by default." }
    ),
    widgetTemplate(
      "overdue_approvals",
      "Overdue Approvals",
      "Approvals holding production or release work back.",
      (summary) => summary.overdue_approval_count,
      (departmentType) => `${productionHash(departmentType)}?approval_status=overdue`,
      (summary) => (summary.overdue_approval_count ? "warning" : "success"),
      { default_visible: true, reason: "Approval backlog is visible by default for production teams." }
    ),
    widgetTemplate(
      "qa_rework_queue",
      "QA / Rework",
      "Items needing QA follow-through or rework.",
      (summary) => summary.blocked_production_count + summary.overdue_approval_count,
      (departmentType) => productionHash(departmentType),
      (summary) => (summary.blocked_production_count ? "danger" : "info"),
      { default_visible: false, reason: "Optional queue for deeper QA and rework monitoring." }
    )
  ],
  photographer: [
    widgetTemplate(
      "jobs_today",
      "My Jobs Today",
      "Assigned jobs and same-day readiness work.",
      (summary) => summary.jobs_today,
      () => "#operations/today",
      (summary) => (summary.jobs_today ? "info" : "neutral"),
      { required: true, reason: "Field crews need today's assigned work pinned by default." }
    ),
    widgetTemplate(
      "missing_ready_confirmations",
      "Missing Ready Confirmations",
      "Jobs that still need lead-ready confirmation.",
      (summary) => summary.missing_ready_confirmation_count,
      () => "#exceptions?flag_type=ready_confirmation_missing",
      (summary) => (summary.missing_ready_confirmation_count ? "warning" : "success"),
      { required: true, reason: "Readiness gaps remain pinned for photographers." }
    ),
    widgetTemplate(
      "my_open_flags",
      "My Open Exceptions",
      "Urgent work already assigned to you.",
      (summary) => summary.high_watch_count + summary.critical_watch_count,
      () => "#exceptions?only_mine=yes",
      (summary) => (summary.high_watch_count + summary.critical_watch_count ? "danger" : "success"),
      { required: true, reason: "Assigned exceptions stay visible in the photographer default." }
    )
  ],
  schools: [
    widgetTemplate(
      "urgent_watch_next_24h",
      "Exceptions",
      "Operational work that needs attention first.",
      (summary) => summary.urgent_count,
      () => "#schools/exceptions?next_24_hours=yes",
      (summary) => (summary.urgent_count ? "danger" : "success"),
      { required: true, reason: "School teams need a pinned exceptions view." }
    ),
    widgetTemplate(
      "jobs_next_7_days",
      "Jobs Next 7 Days",
      "Upcoming school execution load in the near-term window.",
      (summary) => summary.jobs_next_7_days,
      () => "#schools/jobs",
      (summary) => (summary.jobs_next_7_days ? "info" : "neutral"),
      { required: true, reason: "Near-term school workload stays pinned." }
    ),
    widgetTemplate(
      "missing_staffing",
      "Missing Staffing",
      "Open staffing coverage or lead assignment gaps.",
      (summary) => summary.staffing_gap_count,
      () => "#schools/exceptions?flag_type=staffing_gap",
      (summary) => (summary.staffing_gap_count ? "warning" : "success"),
      { required: true, reason: "Coverage gaps stay visible for school coordination." }
    ),
    widgetTemplate(
      "waiting_on_client",
      "Waiting on Client",
      "Client or approval follow-up blocking progress.",
      (summary) => summary.overdue_approval_count,
      () => "#schools/exceptions?flag_type=approval_delay",
      (summary) => (summary.overdue_approval_count ? "warning" : "success"),
      { default_visible: true, reason: "Client follow-up is visible by default for school staff." }
    ),
    widgetTemplate(
      "overdue_checklists",
      "Overdue Checklists",
      "Checklist work already drifting late.",
      (summary) => summary.overdue_checklist_count,
      () => "#production?checklist_state=overdue",
      (summary) => (summary.overdue_checklist_count ? "warning" : "success"),
      { default_visible: false, reason: "Optional checklist detail for school leaders." }
    ),
    widgetTemplate(
      "delivery_risks",
      "Delivery Risks",
      "Downstream delivery commitments at risk.",
      (summary) => summary.delivery_risk_count,
      () => "#production?delivery_status=issue_flagged",
      (summary) => (summary.delivery_risk_count ? "warning" : "success"),
      { default_visible: false, reason: "Optional downstream production visibility for school teams." }
    )
  ],
  sports: [
    widgetTemplate(
      "urgent_watch_next_24h",
      "Exceptions",
      "Operational work that needs attention first.",
      (summary) => summary.urgent_count,
      () => "#sports/exceptions?next_24_hours=yes",
      (summary) => (summary.urgent_count ? "danger" : "success"),
      { required: true, reason: "Sports teams need exceptions visibility pinned by default." }
    ),
    widgetTemplate(
      "jobs_next_7_days",
      "Jobs Next 7 Days",
      "Upcoming sports execution load in the near-term window.",
      (summary) => summary.jobs_next_7_days,
      () => "#sports/jobs",
      (summary) => (summary.jobs_next_7_days ? "info" : "neutral"),
      { required: true, reason: "Near-term sports workload stays pinned." }
    ),
    widgetTemplate(
      "missing_staffing",
      "Missing Staffing",
      "Open staffing coverage or lead assignment gaps.",
      (summary) => summary.staffing_gap_count,
      () => "#sports/exceptions?flag_type=staffing_gap",
      (summary) => (summary.staffing_gap_count ? "warning" : "success"),
      { required: true, reason: "Coverage gaps stay visible for sports coordination." }
    ),
    widgetTemplate(
      "waiting_on_client",
      "Waiting on Client",
      "Client or approval follow-up blocking progress.",
      (summary) => summary.overdue_approval_count,
      () => "#sports/exceptions?flag_type=approval_delay",
      (summary) => (summary.overdue_approval_count ? "warning" : "success"),
      { default_visible: true, reason: "Client follow-up is visible by default for sports staff." }
    ),
    widgetTemplate(
      "overdue_checklists",
      "Overdue Checklists",
      "Checklist work already drifting late.",
      (summary) => summary.overdue_checklist_count,
      () => "#production?checklist_state=overdue",
      (summary) => (summary.overdue_checklist_count ? "warning" : "success"),
      { default_visible: false, reason: "Optional checklist detail for sports leaders." }
    ),
    widgetTemplate(
      "delivery_risks",
      "Delivery Risks",
      "Downstream delivery commitments at risk.",
      (summary) => summary.delivery_risk_count,
      () => "#production?delivery_status=issue_flagged",
      (summary) => (summary.delivery_risk_count ? "warning" : "success"),
      { default_visible: false, reason: "Optional downstream production visibility for sports teams." }
    )
  ],
  default: [
    widgetTemplate(
      "urgent_watch_next_24h",
      "Exceptions",
      "Operational work that needs attention first.",
      (summary) => summary.urgent_count,
      () => "#exceptions?next_24_hours=yes",
      (summary) => (summary.urgent_count ? "danger" : "success"),
      { required: true, reason: "Exception work stays pinned in the default homepage." }
    ),
    widgetTemplate(
      "jobs_next_7_days",
      "Jobs Next 7 Days",
      "Upcoming execution load in the near-term window.",
      (summary) => summary.jobs_next_7_days,
      (departmentType) => baseDepartmentHash(departmentType),
      (summary) => (summary.jobs_next_7_days ? "info" : "neutral"),
      { required: true, reason: "Near-term workload stays visible in the default homepage." }
    ),
    widgetTemplate(
      "missing_staffing",
      "Missing Staffing",
      "Open staffing coverage or lead assignment gaps.",
      (summary) => summary.staffing_gap_count,
      () => "#exceptions?flag_type=staffing_gap",
      (summary) => (summary.staffing_gap_count ? "warning" : "success"),
      { default_visible: true, reason: "Staffing gaps are visible by default in the shared layout." }
    ),
    widgetTemplate(
      "delivery_risks",
      "Delivery Risks",
      "Downstream delivery commitments at risk.",
      (summary) => summary.delivery_risk_count,
      () => "#production?delivery_status=issue_flagged",
      (summary) => (summary.delivery_risk_count ? "warning" : "success"),
      { default_visible: false, reason: "Optional downstream detail in the shared layout." }
    )
  ]
};

export function resolveDashboardWidgetRole(auth: AuthUser, scope: DashboardScope, departmentType?: JobDepartmentType | null): DashboardWidgetRoleKey {
  if (scope === "executive" || canAccessExecutiveCommandLayer(auth)) {
    return "leadership";
  }
  if (departmentType === "schools") {
    return "schools";
  }
  if (departmentType === "sports") {
    return "sports";
  }
  if (auth.department === "schools") {
    return "schools";
  }
  if (auth.department === "sports") {
    return "sports";
  }
  if (isProductionRole(auth)) {
    return "production";
  }
  if (isPhotographerRole(auth)) {
    return "photographer";
  }
  if (hasAuthorityTier(auth, ["supervisor", "director_admin", "leadership", "super_admin"])) {
    return "leadership";
  }
  return "default";
}

export function buildDashboardWidgets(
  auth: AuthUser,
  summary: DashboardSummary,
  departmentType: JobDepartmentType | null,
  scope: DashboardScope
): DashboardWidgetSummary[] {
  const roleKey = resolveDashboardWidgetRole(auth, scope, departmentType);
  return ROLE_WIDGET_TEMPLATES[roleKey].map((template) => {
    const count = template.count(summary);
    return {
      widget_key: template.widget_key,
      title: template.title,
      description: template.description,
      metric: `${count}`,
      tone: template.tone(summary),
      count,
      route_hash: template.routeHash(departmentType)
    };
  });
}

export function buildDashboardWidgetLayout(
  auth: AuthUser,
  widgets: DashboardWidgetSummary[],
  scope: DashboardScope,
  departmentType: JobDepartmentType | null
): DashboardWidgetLayout {
  const roleKey = resolveDashboardWidgetRole(auth, scope, departmentType);
  const availableKeys = new Set(widgets.map((widget) => widget.widget_key));
  const items: DashboardWidgetLayoutItem[] = ROLE_WIDGET_TEMPLATES[roleKey]
    .filter((template) => availableKeys.has(template.widget_key))
    .map((template, index) => ({
      widget_key: template.widget_key,
      required: template.required,
      default_visible: template.default_visible || template.required,
      default_position: index,
      reason: template.reason
    }));

  return {
    role_key: roleKey,
    supports_personalization: scope === "home" && departmentType == null,
    items
  };
}

export function normalizeDashboardWidgetPreferences(
  auth: AuthUser,
  dashboardScope: string,
  preferences: WidgetPreferenceInput[]
): WidgetPreferenceInput[] {
  const scope = toScope(dashboardScope);
  const roleKey = resolveDashboardWidgetRole(auth, scope, null);
  const layout = ROLE_WIDGET_TEMPLATES[roleKey];
  const layoutMap = new Map(layout.map((template, index) => [template.widget_key, { template, index }]));
  const submitted = new Map<DashboardWidgetKey, WidgetPreferenceInput>();

  for (const preference of [...preferences].sort((left, right) => left.position_index - right.position_index)) {
    if (!layoutMap.has(preference.widget_key as DashboardWidgetKey) || submitted.has(preference.widget_key as DashboardWidgetKey)) {
      continue;
    }
    submitted.set(preference.widget_key as DashboardWidgetKey, preference);
  }

  const orderedKeys: DashboardWidgetKey[] = [...submitted.keys()];
  for (const template of layout) {
    if (!submitted.has(template.widget_key)) {
      orderedKeys.push(template.widget_key);
    }
  }

  return orderedKeys.map((widget_key, position_index) => {
    const seed = layoutMap.get(widget_key)?.template;
    const current = submitted.get(widget_key);
    return {
      widget_key,
      position_index,
      is_visible: seed?.required ? true : current?.is_visible ?? seed?.default_visible ?? true,
      settings_json: current?.settings_json ?? null
    };
  });
}
