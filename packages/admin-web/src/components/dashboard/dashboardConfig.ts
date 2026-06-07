import type { AppCapability, BusinessRole } from "../../permissions";

export type DashboardWidgetCategory =
  | "personal_summary"
  | "schedule"
  | "assignments"
  | "alerts"
  | "quick_actions"
  | "readiness"
  | "travel_location"
  | "gear_assets"
  | "requests_approvals"
  | "queue_workload"
  | "qa_release"
  | "review_desk"
  | "recent_activity"
  | "metrics_snapshot"
  | "trend_summary"
  | "pipeline_summary"
  | "executive_health"
  | "system_health";

export type DashboardInventoryCategory = "core" | "field" | "production" | "people_ops" | "growth" | "business_health" | "admin" | "shared";
export type DashboardInventoryStatus = "implemented" | "reused" | "merged" | "deferred";

export type DashboardWidgetInventoryItem = {
  id: string;
  label: string;
  category: DashboardInventoryCategory;
  status: DashboardInventoryStatus;
  widgetIds: DashboardWidgetId[];
  notes?: string;
};

export type DashboardWidgetSize = "hero" | "large" | "medium" | "small" | "row" | "full";
export type DashboardWidgetPresentation = "card" | "surface";
export type DashboardScopeId = "me" | "department" | "company";
export type DashboardWidgetDataSourceKey =
  | "employee"
  | "production"
  | "sales"
  | "service"
  | "security"
  | "workflow"
  | "cockpit"
  | "home_pulse"
  | "leadership_reports"
  | "staffing";

export type DashboardWidgetId =
  | "employee-day"
  | "employee-schedule"
  | "employee-alerts"
  | "employee-follow-through"
  | "employee-gear"
  | "field-readiness"
  | "field-travel"
  | "field-exceptions"
  | "production-queue"
  | "production-qa-release"
  | "service-summary"
  | "service-metrics"
  | "sales-pipeline"
  | "sales-deadlines"
  | "manager-workflow"
  | "manager-cockpit"
  | "leadership-home-pulse"
  | "leadership-workflow"
  | "leadership-cockpit"
  | "leadership-readiness"
  | "leadership-staffing"
  | "admin-system-health"
  | "admin-audit-watch"
  | "quick-actions"
  | "recent-activity";

export type DashboardQuickActionId =
  | "open-my-day"
  | "view-my-schedule"
  | "submit-request"
  | "check-training"
  | "open-next-shoot"
  | "view-location-details"
  | "check-readiness"
  | "view-assigned-gear"
  | "open-staffing"
  | "resolve-readiness-issue"
  | "open-team-attendance"
  | "view-field-exceptions"
  | "open-my-queue"
  | "view-qa-blockers"
  | "open-release-list"
  | "review-flagged-job"
  | "open-priority-issues"
  | "view-service-metrics"
  | "open-account-contact"
  | "review-escalations"
  | "open-pipeline"
  | "review-renewals"
  | "open-proposal-deadlines"
  | "view-account-contacts"
  | "review-approvals"
  | "open-team-schedule"
  | "resolve-exception"
  | "check-team-workload"
  | "open-executive-summary"
  | "review-company-alerts"
  | "view-business-health"
  | "check-major-exceptions"
  | "review-automation-failures"
  | "open-integrations"
  | "check-audit-controls"
  | "manage-permissions";

export type DashboardWidgetDefinition = {
  id: DashboardWidgetId;
  title: string;
  subtitle?: string;
  category: DashboardWidgetCategory;
  sizeHint: DashboardWidgetSize;
  presentation: DashboardWidgetPresentation;
  supportedRoles: BusinessRole[];
  requiredCapabilities?: AppCapability[];
  defaultPriorityRank: number;
  aboveFoldEligible: boolean;
  mobilePriority: number;
  defaultCollapsed: boolean;
  collapsedPreview?: string;
  emptyState: string;
  destinationHash?: string;
  dataDependencies: string[];
  analyticsId: string;
  dataSourceKey?: DashboardWidgetDataSourceKey;
  freshnessWindowMinutes?: number;
  supportedScopes?: DashboardScopeId[];
};

type DashboardWidgetDefinitionInput = Omit<
  DashboardWidgetDefinition,
  "defaultPriorityRank" | "aboveFoldEligible" | "mobilePriority" | "defaultCollapsed" | "analyticsId"
> &
  Partial<
    Pick<
      DashboardWidgetDefinition,
      "defaultPriorityRank" | "aboveFoldEligible" | "mobilePriority" | "defaultCollapsed" | "collapsedPreview" | "analyticsId"
    >
  >;

export type DashboardQuickActionDefinition = {
  id: DashboardQuickActionId;
  label: string;
  description: string;
  hash: string;
  supportedRoles: BusinessRole[];
  requiredCapabilities?: AppCapability[];
};

export type DashboardLayoutWidgetPlacement = {
  widgetId: DashboardWidgetId;
  title?: string;
  subtitle?: string;
  sizeHint?: DashboardWidgetSize;
  priorityRank?: number;
  defaultCollapsed?: boolean;
  hideWhenEmpty?: boolean;
};

export type DashboardLayoutSection = {
  id: "hero" | "primary" | "secondary";
  label: string;
  aboveFold: boolean;
  widgets: DashboardLayoutWidgetPlacement[];
};

export type DashboardRoleLayout = {
  role: BusinessRole;
  eyebrow: string;
  title: string;
  summary: string;
  sections: DashboardLayoutSection[];
  quickActionIds: DashboardQuickActionId[];
  scopeSelectorSupport?: DashboardScopeId[];
};

const DEFAULT_WIDGET_META = {
  defaultPriorityRank: 50,
  aboveFoldEligible: true,
  mobilePriority: 50,
  defaultCollapsed: false,
  analyticsId: ""
} as const;

function defineWidget(definition: DashboardWidgetDefinitionInput): DashboardWidgetDefinition {
  return {
    ...DEFAULT_WIDGET_META,
    ...definition,
    analyticsId: definition.analyticsId || definition.id
  };
}

function placeWidget(widgetId: DashboardWidgetId, overrides: Omit<DashboardLayoutWidgetPlacement, "widgetId"> = {}): DashboardLayoutWidgetPlacement {
  return {
    widgetId,
    ...overrides
  };
}

export const DASHBOARD_WIDGET_INVENTORY: DashboardWidgetInventoryItem[] = [
  { id: "my_day", label: "My Day", category: "core", status: "implemented", widgetIds: ["employee-day"] },
  { id: "todays_schedule", label: "Today's Schedule", category: "core", status: "implemented", widgetIds: ["employee-schedule"] },
  { id: "next_assignment", label: "Next Assignment", category: "core", status: "merged", widgetIds: ["employee-day", "field-travel"], notes: "Next assignment is carried by My Day and Travel & Location instead of a duplicate card." },
  { id: "todays_shoots", label: "Today's Shoots", category: "field", status: "merged", widgetIds: ["employee-day"], notes: "Photographers and shoot leads reuse My Day with role-specific labeling." },
  { id: "my_tasks", label: "My Tasks", category: "core", status: "merged", widgetIds: ["employee-follow-through"], notes: "Personal tasks are currently merged with requests and follow-through." },
  { id: "my_alerts", label: "My Alerts", category: "core", status: "implemented", widgetIds: ["employee-alerts"] },
  { id: "quick_actions", label: "Quick Actions", category: "shared", status: "implemented", widgetIds: ["quick-actions"] },
  { id: "recent_activity", label: "Recent Activity", category: "shared", status: "implemented", widgetIds: ["recent-activity"] },
  { id: "shoot_readiness", label: "Shoot Readiness", category: "field", status: "implemented", widgetIds: ["field-readiness"] },
  { id: "travel_location", label: "Travel & Location", category: "field", status: "implemented", widgetIds: ["field-travel"] },
  { id: "location_notes", label: "Location Notes", category: "field", status: "deferred", widgetIds: [], notes: "Location note density still lives in owned detail views instead of a standalone dashboard card." },
  { id: "staffing_risks", label: "Staffing Risks", category: "field", status: "merged", widgetIds: ["leadership-staffing", "manager-workflow"], notes: "Leadership and manager staffing risk remains part of the staffing command and workflow surfaces." },
  { id: "attendance_issues", label: "Attendance Issues", category: "field", status: "merged", widgetIds: ["manager-workflow"], notes: "Attendance risk is part of the shared assignment-to-completion workflow surface." },
  { id: "field_exceptions", label: "Field Exceptions", category: "field", status: "implemented", widgetIds: ["field-exceptions"] },
  { id: "assigned_gear", label: "Assigned Gear", category: "field", status: "implemented", widgetIds: ["employee-gear"] },
  { id: "team_assignments", label: "Team Assignments", category: "field", status: "merged", widgetIds: ["employee-day"], notes: "Shoot leads reuse the field day hero widget for team assignment context." },
  { id: "pre_service_notes", label: "Pre-Service Notes", category: "field", status: "merged", widgetIds: ["field-readiness"], notes: "Pre-service notes stay folded into readiness instead of becoming a duplicate card." },
  { id: "my_queue", label: "My Queue", category: "production", status: "implemented", widgetIds: ["production-queue"] },
  { id: "priority_jobs_due_today", label: "Priority Jobs Due Today", category: "production", status: "merged", widgetIds: ["production-queue"], notes: "Priority jobs due today are summarized inside My Queue to avoid another top-row production card." },
  { id: "qa_blockers", label: "QA Blockers", category: "production", status: "merged", widgetIds: ["production-qa-release"], notes: "QA blockers and release pressure share one compact card." },
  { id: "release_holds", label: "Release Holds", category: "production", status: "merged", widgetIds: ["production-qa-release"], notes: "Release holds stay combined with QA blockers in phase 1." },
  { id: "post_shoot_review_flags", label: "Post-Shoot Review Flags", category: "production", status: "merged", widgetIds: ["production-qa-release"], notes: "Post-shoot review flags surface through the QA and release card until dedicated data is deeper." },
  { id: "workload_snapshot", label: "Workload Snapshot", category: "production", status: "merged", widgetIds: ["production-queue"], notes: "Workload is summarized in the queue hero instead of a second production metric card." },
  { id: "recently_completed_jobs", label: "Recently Completed Jobs", category: "production", status: "deferred", widgetIds: [], notes: "Recently completed jobs need a more reliable production feed before they become a top-level widget." },
  { id: "my_requests", label: "My Requests", category: "people_ops", status: "merged", widgetIds: ["employee-follow-through"], notes: "Requests are currently combined with closeout and mileage follow-through." },
  { id: "pending_approvals", label: "Pending Approvals", category: "people_ops", status: "merged", widgetIds: ["manager-cockpit", "manager-workflow"], notes: "Pending approvals stay inside the manager oversight surfaces." },
  { id: "training_reminders", label: "Training Reminders", category: "people_ops", status: "deferred", widgetIds: [], notes: "Training reminders still rely on route drill-ins instead of a dedicated dashboard card." },
  { id: "certification_reminders", label: "Certification Reminders", category: "people_ops", status: "deferred", widgetIds: [], notes: "Certification reminders need a stronger Employees feed before they become a card." },
  { id: "team_readiness", label: "Team Readiness", category: "people_ops", status: "merged", widgetIds: ["leadership-readiness", "manager-workflow"], notes: "Readiness remains part of leadership and manager command views." },
  { id: "pipeline_snapshot", label: "Pipeline Snapshot", category: "growth", status: "implemented", widgetIds: ["sales-pipeline"] },
  { id: "opportunities_needing_action", label: "Opportunities Needing Action", category: "growth", status: "merged", widgetIds: ["sales-pipeline"], notes: "The pipeline hero is the action-oriented opportunities card for phase 1." },
  { id: "renewals_at_risk", label: "Renewals At Risk", category: "growth", status: "merged", widgetIds: ["sales-deadlines"], notes: "Renewal risk shares a card with proposal deadlines." },
  { id: "proposal_deadlines", label: "Proposal Deadlines", category: "growth", status: "merged", widgetIds: ["sales-deadlines"], notes: "Proposal deadlines stay paired with renewal risk." },
  { id: "rfp_deadlines", label: "RFP Deadlines", category: "growth", status: "deferred", widgetIds: [], notes: "RFP deadlines still need stronger source data before they become their own widget." },
  { id: "recent_account_activity", label: "Recent Account Activity", category: "growth", status: "deferred", widgetIds: [], notes: "Account activity is still better handled through Growth and Directory detail views." },
  { id: "contact_follow_ups", label: "Contact Follow-Ups", category: "growth", status: "merged", widgetIds: ["sales-deadlines"], notes: "Contact follow-up pressure is represented by the shared deadlines and follow-up card." },
  { id: "labor_health_snapshot", label: "Labor Health Snapshot", category: "business_health", status: "merged", widgetIds: ["leadership-home-pulse"], notes: "Labor pressure is summarized in the leadership home pulse." },
  { id: "customer_service_metrics_snapshot", label: "Customer Service Metrics Snapshot", category: "business_health", status: "implemented", widgetIds: ["service-metrics"] },
  { id: "operational_health", label: "Operational Health", category: "business_health", status: "merged", widgetIds: ["leadership-workflow"], notes: "Operational health is carried by the assignment-to-completion surface for leadership." },
  { id: "trend_highlights", label: "Trend Highlights", category: "business_health", status: "deferred", widgetIds: [], notes: "Trend cards stay below the dashboard until the high-signal operational layer is stronger." },
  { id: "department_performance", label: "Department Performance", category: "business_health", status: "deferred", widgetIds: [], notes: "Department performance needs cleaner source metrics before it joins the dashboard." },
  { id: "executive_summary", label: "Executive Summary", category: "business_health", status: "merged", widgetIds: ["leadership-cockpit"], notes: "Executive summary is represented by the leadership cockpit summary surface." },
  { id: "system_alerts", label: "System Alerts", category: "admin", status: "merged", widgetIds: ["admin-system-health"], notes: "System alerts live in the integration and security health hero." },
  { id: "integration_health", label: "Integration Health", category: "admin", status: "implemented", widgetIds: ["admin-system-health"] },
  { id: "automation_failures", label: "Automation Failures", category: "admin", status: "merged", widgetIds: ["admin-system-health"], notes: "Automation failures stay summarized with system health in phase 1." },
  { id: "audit_issues", label: "Audit Issues", category: "admin", status: "implemented", widgetIds: ["admin-audit-watch"] },
  { id: "permission_anomalies", label: "Permission Anomalies", category: "admin", status: "merged", widgetIds: ["admin-audit-watch"], notes: "Permission anomalies stay grouped with the audit watch list." },
  { id: "recent_config_changes", label: "Recent Config Changes", category: "admin", status: "deferred", widgetIds: [], notes: "Recent config changes need a cleaner feed before they belong on the front page." },
  { id: "review_desk_summary", label: "Review Desk Summary", category: "shared", status: "merged", widgetIds: ["field-exceptions", "leadership-cockpit", "manager-workflow"], notes: "Review Desk pressure is role-aware and folded into the owning oversight widgets." },
  { id: "company_alerts", label: "Company Alerts", category: "shared", status: "merged", widgetIds: ["leadership-home-pulse", "employee-alerts"], notes: "Alert surfaces stay role-aware instead of using one universal alerts card." },
  { id: "top_priorities_today", label: "Top Priorities Today", category: "shared", status: "merged", widgetIds: ["leadership-home-pulse", "manager-workflow"], notes: "Top priorities are represented by leadership and manager command widgets." },
  { id: "helpful_shortcuts", label: "Helpful Shortcuts", category: "shared", status: "merged", widgetIds: ["quick-actions"], notes: "Quick Actions is the shared shortcuts system." }
];

const rawDashboardWidgetDefinitions: Record<DashboardWidgetId, DashboardWidgetDefinitionInput> = {
  "employee-day": {
    id: "employee-day",
    title: "My Day",
    subtitle: "What needs your attention first today.",
    category: "personal_summary",
    sizeHint: "hero",
    presentation: "card",
    supportedRoles: ["employee", "photographer", "shoot_lead"],
    requiredCapabilities: ["dashboard.view"],
    defaultPriorityRank: 10,
    mobilePriority: 10,
    emptyState: "No work is assigned yet. Start with your schedule and requests.",
    destinationHash: "#dashboard/my-day",
    dataDependencies: ["employee.my_work"],
    dataSourceKey: "employee",
    freshnessWindowMinutes: 10
  },
  "employee-schedule": {
    id: "employee-schedule",
    title: "Today's Schedule",
    subtitle: "Published timing and assignment context.",
    category: "schedule",
    sizeHint: "large",
    presentation: "card",
    supportedRoles: ["employee", "photographer", "shoot_lead"],
    requiredCapabilities: ["schedule.view"],
    defaultPriorityRank: 20,
    mobilePriority: 20,
    emptyState: "Nothing is scheduled yet for this day.",
    destinationHash: "#dashboard/my-schedule",
    dataDependencies: ["employee.my_work"],
    dataSourceKey: "employee",
    freshnessWindowMinutes: 10
  },
  "employee-alerts": {
    id: "employee-alerts",
    title: "My Alerts",
    subtitle: "Timing changes, missing notes, and personal follow-through.",
    category: "alerts",
    sizeHint: "medium",
    presentation: "card",
    supportedRoles: ["employee", "photographer", "shoot_lead"],
    requiredCapabilities: ["dashboard.view"],
    defaultPriorityRank: 5,
    mobilePriority: 5,
    emptyState: "No personal alerts are open right now.",
    destinationHash: "#dashboard/alerts",
    dataDependencies: ["employee.my_work"],
    dataSourceKey: "employee",
    freshnessWindowMinutes: 5
  },
  "employee-follow-through": {
    id: "employee-follow-through",
    title: "My Tasks & Requests",
    subtitle: "Trade, mileage, and closeout work that still needs attention.",
    category: "requests_approvals",
    sizeHint: "medium",
    presentation: "card",
    supportedRoles: ["employee", "photographer", "shoot_lead"],
    requiredCapabilities: ["requests.view"],
    defaultPriorityRank: 35,
    mobilePriority: 35,
    emptyState: "Requests and closeout follow-through are clear right now.",
    destinationHash: "#employees/requests",
    dataDependencies: ["employee.my_work"],
    dataSourceKey: "employee",
    freshnessWindowMinutes: 10
  },
  "employee-gear": {
    id: "employee-gear",
    title: "Assigned Gear",
    subtitle: "The gear and custody context tied to your day.",
    category: "gear_assets",
    sizeHint: "small",
    presentation: "card",
    supportedRoles: ["photographer", "shoot_lead"],
    requiredCapabilities: ["assets.view"],
    defaultPriorityRank: 45,
    mobilePriority: 45,
    defaultCollapsed: true,
    collapsedPreview: "Assigned gear stays tucked away until you need the custody detail.",
    emptyState: "Assigned gear will show here once custody data is linked to your work.",
    destinationHash: "#assets/gear",
    dataDependencies: [],
    freshnessWindowMinutes: 60
  },
  "field-readiness": {
    id: "field-readiness",
    title: "Shoot Readiness",
    subtitle: "Notes, prep issues, and field follow-through.",
    category: "readiness",
    sizeHint: "medium",
    presentation: "card",
    supportedRoles: ["photographer", "shoot_lead"],
    requiredCapabilities: ["readiness.view"],
    defaultPriorityRank: 25,
    mobilePriority: 25,
    emptyState: "Your assigned shoots are not showing readiness issues right now.",
    destinationHash: "#operations/readiness",
    dataDependencies: ["employee.my_work"],
    dataSourceKey: "employee",
    freshnessWindowMinutes: 10
  },
  "field-travel": {
    id: "field-travel",
    title: "Travel & Location",
    subtitle: "Where to go next and what changed.",
    category: "travel_location",
    sizeHint: "medium",
    presentation: "card",
    supportedRoles: ["photographer", "shoot_lead"],
    requiredCapabilities: ["travel_logistics.view"],
    defaultPriorityRank: 20,
    mobilePriority: 15,
    emptyState: "Travel details will appear as soon as your next assignment is set.",
    destinationHash: "#dashboard/my-day",
    dataDependencies: ["employee.my_work"],
    dataSourceKey: "employee",
    freshnessWindowMinutes: 10
  },
  "field-exceptions": {
    id: "field-exceptions",
    title: "Field Exceptions",
    subtitle: "Same-day follow-through that can break execution.",
    category: "review_desk",
    sizeHint: "full",
    presentation: "surface",
    supportedRoles: ["shoot_lead"],
    requiredCapabilities: ["review_desk.view"],
    defaultPriorityRank: 30,
    mobilePriority: 40,
    aboveFoldEligible: false,
    emptyState: "No field exceptions are open right now.",
    destinationHash: "#studios/pre-service",
    dataDependencies: ["operations.dashboard", "review_desk.queue"],
    dataSourceKey: "workflow",
    freshnessWindowMinutes: 5
  },
  "production-queue": {
    id: "production-queue",
    title: "My Queue",
    subtitle: "Assigned production work due now.",
    category: "queue_workload",
    sizeHint: "hero",
    presentation: "card",
    supportedRoles: ["production_staff"],
    requiredCapabilities: ["production.view"],
    defaultPriorityRank: 10,
    mobilePriority: 10,
    emptyState: "Your queue is clear right now.",
    destinationHash: "#production/job-queue",
    dataDependencies: ["production.board"],
    dataSourceKey: "production",
    freshnessWindowMinutes: 10
  },
  "production-qa-release": {
    id: "production-qa-release",
    title: "QA Blockers & Release Holds",
    subtitle: "Review blockers and release pressure waiting on you.",
    category: "qa_release",
    sizeHint: "large",
    presentation: "card",
    supportedRoles: ["production_staff"],
    requiredCapabilities: ["qa.view"],
    defaultPriorityRank: 20,
    mobilePriority: 20,
    emptyState: "No QA or release blockers are open right now.",
    destinationHash: "#production/qa",
    dataDependencies: ["production.board"],
    dataSourceKey: "production",
    freshnessWindowMinutes: 10
  },
  "service-summary": {
    id: "service-summary",
    title: "Service Queue & Priority Issues",
    subtitle: "Urgent support work and backlog pressure.",
    category: "queue_workload",
    sizeHint: "hero",
    presentation: "card",
    supportedRoles: ["customer_service_staff"],
    requiredCapabilities: ["customer_service_metrics.view"],
    defaultPriorityRank: 10,
    mobilePriority: 10,
    emptyState: "No urgent service issues are open right now.",
    destinationHash: "#reports/customer-service",
    dataDependencies: ["customer_service.summary"],
    dataSourceKey: "service",
    freshnessWindowMinutes: 15
  },
  "service-metrics": {
    id: "service-metrics",
    title: "Customer Service Metrics",
    subtitle: "Reply time, backlog aging, and support trend signal.",
    category: "metrics_snapshot",
    sizeHint: "medium",
    presentation: "card",
    supportedRoles: ["customer_service_staff"],
    requiredCapabilities: ["customer_service_metrics.view"],
    defaultPriorityRank: 30,
    mobilePriority: 35,
    emptyState: "Service metrics will appear here once support data is available.",
    destinationHash: "#reports/customer-service",
    dataDependencies: ["customer_service.summary"],
    dataSourceKey: "service",
    freshnessWindowMinutes: 15
  },
  "sales-pipeline": {
    id: "sales-pipeline",
    title: "Opportunities Needing Action",
    subtitle: "What needs commercial movement today.",
    category: "pipeline_summary",
    sizeHint: "hero",
    presentation: "card",
    supportedRoles: ["sales_growth_staff"],
    requiredCapabilities: ["pipeline.view"],
    defaultPriorityRank: 10,
    mobilePriority: 10,
    emptyState: "No active opportunities are assigned right now.",
    destinationHash: "#growth/pipeline",
    dataDependencies: ["sales.pipeline"],
    dataSourceKey: "sales",
    freshnessWindowMinutes: 20,
    supportedScopes: ["me", "company"]
  },
  "sales-deadlines": {
    id: "sales-deadlines",
    title: "Renewals & Proposal Deadlines",
    subtitle: "Renewals, proposals, and contact momentum at risk.",
    category: "alerts",
    sizeHint: "large",
    presentation: "card",
    supportedRoles: ["sales_growth_staff"],
    requiredCapabilities: ["growth.view"],
    defaultPriorityRank: 20,
    mobilePriority: 20,
    emptyState: "No proposal or renewal deadlines are pressuring today.",
    destinationHash: "#growth/renewals",
    dataDependencies: ["sales.pipeline"],
    dataSourceKey: "sales",
    freshnessWindowMinutes: 20,
    supportedScopes: ["me", "company"]
  },
  "manager-workflow": {
    id: "manager-workflow",
    title: "Team Priorities Today",
    subtitle: "Attendance risk, staffing pressure, and workflow follow-through that need intervention.",
    category: "queue_workload",
    sizeHint: "large",
    presentation: "surface",
    supportedRoles: ["manager", "leadership", "admin", "shoot_lead"],
    requiredCapabilities: ["operations.view"],
    defaultPriorityRank: 10,
    mobilePriority: 10,
    emptyState: "Workflow pressure is clear right now.",
    destinationHash: "#operations",
    dataDependencies: ["operations.dashboard", "review_desk.queue"],
    dataSourceKey: "workflow",
    freshnessWindowMinutes: 5
  },
  "manager-cockpit": {
    id: "manager-cockpit",
    title: "Pending Approvals & Queue Health",
    subtitle: "Approvals, workload balancing, and follow-through managers need to clear.",
    category: "requests_approvals",
    sizeHint: "large",
    presentation: "surface",
    supportedRoles: ["manager", "leadership", "admin"],
    requiredCapabilities: ["approvals.view"],
    defaultPriorityRank: 20,
    mobilePriority: 25,
    emptyState: "No manager queues are open right now.",
    destinationHash: "#approvals",
    dataDependencies: ["manager.cockpit"],
    dataSourceKey: "cockpit",
    freshnessWindowMinutes: 15
  },
    "leadership-home-pulse": {
      id: "leadership-home-pulse",
      title: "Top Priorities Today",
      subtitle: "Mission control for attention, today, attendance, and production pressure.",
      category: "executive_health",
      sizeHint: "full",
      presentation: "surface",
      supportedRoles: ["manager", "leadership", "admin"],
    requiredCapabilities: ["operations.view"],
    defaultPriorityRank: 10,
    mobilePriority: 10,
    emptyState: "Home pulse is still loading.",
    destinationHash: "#dashboard",
    dataDependencies: ["home.dashboard"],
    dataSourceKey: "home_pulse",
    freshnessWindowMinutes: 5
  },
  "leadership-workflow": {
    id: "leadership-workflow",
    title: "Operational Health",
    subtitle: "Schedule, attendance, closeout, and payroll pressure.",
    category: "queue_workload",
    sizeHint: "large",
    presentation: "surface",
    supportedRoles: ["leadership", "admin"],
    requiredCapabilities: ["operations.view"],
    defaultPriorityRank: 20,
    mobilePriority: 20,
    emptyState: "Workflow pressure is clear right now.",
    destinationHash: "#operations",
    dataDependencies: ["operations.dashboard", "review_desk.queue"],
    dataSourceKey: "workflow",
    freshnessWindowMinutes: 5
  },
  "leadership-cockpit": {
    id: "leadership-cockpit",
    title: "Executive Summary",
    subtitle: "Cross-functional queues that need intervention.",
    category: "review_desk",
    sizeHint: "large",
    presentation: "surface",
    supportedRoles: ["leadership", "admin"],
    requiredCapabilities: ["approvals.view"],
    defaultPriorityRank: 25,
    mobilePriority: 30,
    emptyState: "Manager cockpit queues are clear.",
    destinationHash: "#dashboard",
    dataDependencies: ["manager.cockpit"],
    dataSourceKey: "cockpit",
    freshnessWindowMinutes: 15
  },
  "leadership-readiness": {
    id: "leadership-readiness",
    title: "Team Readiness",
    subtitle: "Big-shoot prep and report rhythm without cluttering the front line.",
    category: "trend_summary",
    sizeHint: "full",
    presentation: "surface",
    supportedRoles: ["leadership", "admin"],
    requiredCapabilities: ["reports.view"],
    defaultPriorityRank: 60,
    mobilePriority: 60,
    aboveFoldEligible: false,
    emptyState: "Leadership readiness will show here when report data is available.",
    destinationHash: "#reports",
    dataDependencies: ["leadership.reports"],
    dataSourceKey: "leadership_reports",
    freshnessWindowMinutes: 20
  },
  "leadership-staffing": {
    id: "leadership-staffing",
    title: "Staffing Command",
    subtitle: "Coverage gaps and staffing pressure stay available below the main dashboard flow.",
    category: "queue_workload",
    sizeHint: "full",
    presentation: "surface",
    supportedRoles: ["manager", "leadership", "admin"],
    requiredCapabilities: ["staffing.view"],
    defaultPriorityRank: 55,
    mobilePriority: 55,
    aboveFoldEligible: false,
    emptyState: "Staffing command is clear right now.",
    destinationHash: "#operations/staffing",
    dataDependencies: ["staffing.dashboard"],
    dataSourceKey: "staffing",
    freshnessWindowMinutes: 5
  },
  "admin-system-health": {
    id: "admin-system-health",
    title: "Integration Health",
    subtitle: "Integration, break-glass, and admin issues that need intervention.",
    category: "system_health",
    sizeHint: "hero",
    presentation: "card",
    supportedRoles: ["admin"],
    requiredCapabilities: ["admin.view"],
    defaultPriorityRank: 10,
    mobilePriority: 10,
    emptyState: "No urgent system issues are open right now.",
    destinationHash: "#admin/audit",
    dataDependencies: ["admin.security"],
    dataSourceKey: "security",
    freshnessWindowMinutes: 10
  },
  "admin-audit-watch": {
    id: "admin-audit-watch",
    title: "Audit Issues & Permission Anomalies",
    subtitle: "Recent dangerous actions and pending approval work.",
    category: "system_health",
    sizeHint: "large",
    presentation: "card",
    supportedRoles: ["admin"],
    requiredCapabilities: ["audit_controls.view"],
    defaultPriorityRank: 20,
    mobilePriority: 20,
    emptyState: "Recent admin actions will appear here when the audit queue is active.",
    destinationHash: "#admin/audit",
    dataDependencies: ["admin.security"],
    dataSourceKey: "security",
    freshnessWindowMinutes: 10
  },
  "quick-actions": {
    id: "quick-actions",
    title: "Quick Actions",
    subtitle: "The fastest paths back to the work you actually use.",
    category: "quick_actions",
    sizeHint: "row",
    presentation: "card",
    supportedRoles: ["employee", "photographer", "shoot_lead", "production_staff", "customer_service_staff", "sales_growth_staff", "manager", "leadership", "admin"],
    requiredCapabilities: ["dashboard.view"],
    defaultPriorityRank: 30,
    mobilePriority: 30,
    emptyState: "No quick actions are configured for this role yet.",
    destinationHash: "#dashboard",
    dataDependencies: [],
    freshnessWindowMinutes: 60
  },
  "recent-activity": {
    id: "recent-activity",
    title: "Recent Activity",
    subtitle: "The latest changes and completions tied to your work.",
    category: "recent_activity",
    sizeHint: "medium",
    presentation: "card",
    supportedRoles: ["employee", "photographer", "shoot_lead", "production_staff", "customer_service_staff", "sales_growth_staff", "manager", "leadership", "admin"],
    requiredCapabilities: ["dashboard.view"],
    defaultPriorityRank: 80,
    mobilePriority: 70,
    aboveFoldEligible: false,
    defaultCollapsed: true,
    collapsedPreview: "Recent changes stay tucked away until you need the detail.",
    emptyState: "Recent changes will appear here as activity starts to flow through your workspace.",
    destinationHash: "#dashboard/alerts",
    dataDependencies: ["employee.my_work", "production.board", "sales.pipeline", "customer_service.summary", "admin.security"],
    freshnessWindowMinutes: 20
  }
};

export const DASHBOARD_WIDGET_DEFINITIONS: Record<DashboardWidgetId, DashboardWidgetDefinition> = Object.fromEntries(
  Object.entries(rawDashboardWidgetDefinitions).map(([widgetId, definition]) => [widgetId, defineWidget(definition)])
) as Record<DashboardWidgetId, DashboardWidgetDefinition>;

export const DASHBOARD_QUICK_ACTIONS: Record<DashboardQuickActionId, DashboardQuickActionDefinition> = {
  "open-my-day": { id: "open-my-day", label: "View My Day", description: "Open today's assignments, attendance, and closeout flow.", hash: "#dashboard/my-day", supportedRoles: ["employee", "photographer", "shoot_lead"] },
  "view-my-schedule": { id: "view-my-schedule", label: "View My Schedule", description: "See published timing and upcoming work.", hash: "#dashboard/my-schedule", supportedRoles: ["employee", "photographer", "shoot_lead"], requiredCapabilities: ["schedule.view"] },
  "submit-request": { id: "submit-request", label: "Submit Request", description: "Open personal requests and PTO routing.", hash: "#employees/requests", supportedRoles: ["employee", "photographer", "shoot_lead"], requiredCapabilities: ["requests.view"] },
  "check-training": { id: "check-training", label: "Check Training", description: "Open training and certification status.", hash: "#employees/training", supportedRoles: ["employee", "photographer", "shoot_lead"], requiredCapabilities: ["training.view"] },
  "open-next-shoot": { id: "open-next-shoot", label: "Open Next Shoot", description: "Jump into the next field assignment.", hash: "#dashboard/my-day", supportedRoles: ["photographer", "shoot_lead"], requiredCapabilities: ["shoots.view"] },
  "view-location-details": { id: "view-location-details", label: "View Location", description: "Open the linked location details for your work.", hash: "#directory/locations", supportedRoles: ["photographer", "shoot_lead"], requiredCapabilities: ["directory_locations.view"] },
  "check-readiness": { id: "check-readiness", label: "Check Readiness", description: "Review pre-service notes and field prep.", hash: "#operations/readiness", supportedRoles: ["photographer", "shoot_lead"], requiredCapabilities: ["readiness.view"] },
  "view-assigned-gear": { id: "view-assigned-gear", label: "View Assigned Gear", description: "Open your asset and custody context.", hash: "#assets/gear", supportedRoles: ["photographer", "shoot_lead"], requiredCapabilities: ["assets.view"] },
  "open-staffing": { id: "open-staffing", label: "Open Staffing", description: "Open staffing context for active field work.", hash: "#operations/staffing", supportedRoles: ["shoot_lead"], requiredCapabilities: ["staffing.view"] },
  "resolve-readiness-issue": { id: "resolve-readiness-issue", label: "Resolve Readiness", description: "Open the readiness lane for missing info and prep gaps.", hash: "#operations/readiness", supportedRoles: ["shoot_lead"], requiredCapabilities: ["readiness.view"] },
  "open-team-attendance": { id: "open-team-attendance", label: "Team Attendance", description: "Review attendance issues affecting the field day.", hash: "#operations/attendance", supportedRoles: ["shoot_lead", "manager"], requiredCapabilities: ["attendance.view"] },
  "view-field-exceptions": { id: "view-field-exceptions", label: "Review Field Exceptions", description: "Open field prep and execution problems in the Photography hub.", hash: "#studios/pre-service", supportedRoles: ["shoot_lead"], requiredCapabilities: ["review_desk.view"] },
  "open-my-queue": { id: "open-my-queue", label: "Open My Queue", description: "Jump into assigned production work.", hash: "#production/workload", supportedRoles: ["production_staff"], requiredCapabilities: ["production.view"] },
  "view-qa-blockers": { id: "view-qa-blockers", label: "View QA Blockers", description: "Open review and QA pressure needing action.", hash: "#production/qa", supportedRoles: ["production_staff"], requiredCapabilities: ["qa.view"] },
  "open-release-list": { id: "open-release-list", label: "Open Release List", description: "Go straight to release-ready work.", hash: "#production/release", supportedRoles: ["production_staff"], requiredCapabilities: ["release.view"] },
  "review-flagged-job": { id: "review-flagged-job", label: "Review Flagged Job", description: "Open the job queue for flagged production work.", hash: "#production/job-queue", supportedRoles: ["production_staff"], requiredCapabilities: ["production.view"] },
  "open-priority-issues": { id: "open-priority-issues", label: "Open Priority Issues", description: "Jump into the support queue and escalation work.", hash: "#reports/customer-service", supportedRoles: ["customer_service_staff"], requiredCapabilities: ["customer_service_metrics.view"] },
  "view-service-metrics": { id: "view-service-metrics", label: "View Service Metrics", description: "Open service health and support trend metrics.", hash: "#reports/customer-service", supportedRoles: ["customer_service_staff"], requiredCapabilities: ["customer_service_metrics.view"] },
  "open-account-contact": { id: "open-account-contact", label: "Open Account Contact", description: "Move quickly into linked account and contact records.", hash: "#directory/accounts", supportedRoles: ["customer_service_staff"], requiredCapabilities: ["directory_accounts.view"] },
  "review-escalations": { id: "review-escalations", label: "Review Escalations", description: "Open follow-up and escalation context tied to support work.", hash: "#project-tracking", supportedRoles: ["customer_service_staff"], requiredCapabilities: ["review_desk.view"] },
  "open-pipeline": { id: "open-pipeline", label: "Open Pipeline", description: "Jump into the active sales pipeline.", hash: "#growth/pipeline", supportedRoles: ["sales_growth_staff"], requiredCapabilities: ["pipeline.view"] },
  "review-renewals": { id: "review-renewals", label: "Review Renewals", description: "Open renewal work at risk.", hash: "#growth/renewals", supportedRoles: ["sales_growth_staff"], requiredCapabilities: ["renewals.view"] },
  "open-proposal-deadlines": { id: "open-proposal-deadlines", label: "Proposal Deadlines", description: "Open proposal and RFP follow-through.", hash: "#growth/proposals", supportedRoles: ["sales_growth_staff"], requiredCapabilities: ["proposals.view"] },
  "view-account-contacts": { id: "view-account-contacts", label: "View Account Contacts", description: "Open account and contact relationship context.", hash: "#directory/contacts", supportedRoles: ["sales_growth_staff"], requiredCapabilities: ["directory_contacts.view"] },
  "review-approvals": { id: "review-approvals", label: "Review Approvals", description: "Open the approvals queue and act on pending work.", hash: "#approvals", supportedRoles: ["manager", "leadership"], requiredCapabilities: ["approvals.view"] },
  "open-team-schedule": { id: "open-team-schedule", label: "Open Team Schedule", description: "Jump into staffing and schedule control.", hash: "#operations/schedule", supportedRoles: ["manager", "leadership"], requiredCapabilities: ["schedule.view"] },
  "resolve-exception": { id: "resolve-exception", label: "Review At-Risk Work", description: "Open Project Tracking for items needing leadership follow-up.", hash: "#project-tracking", supportedRoles: ["manager", "leadership"], requiredCapabilities: ["review_desk.view"] },
  "check-team-workload": { id: "check-team-workload", label: "Check Team Workload", description: "Open production and operational workload pressure.", hash: "#production/workload", supportedRoles: ["manager", "leadership"], requiredCapabilities: ["production.view"] },
  "open-executive-summary": { id: "open-executive-summary", label: "Open Executive Summary", description: "Jump into the broadest reports view.", hash: "#reports/executive", supportedRoles: ["leadership"], requiredCapabilities: ["executive_metrics.view"] },
  "review-company-alerts": { id: "review-company-alerts", label: "Review Alerts", description: "Open the dashboard alert lane and critical watch items.", hash: "#dashboard/alerts", supportedRoles: ["leadership"], requiredCapabilities: ["dashboard.view"] },
  "view-business-health": { id: "view-business-health", label: "View Reports", description: "Open profitability, labor, and reporting context.", hash: "#reports", supportedRoles: ["leadership"], requiredCapabilities: ["business_health.view"] },
  "check-major-exceptions": { id: "check-major-exceptions", label: "Check At-Risk Work", description: "Open major workflow pressure and review-required items in Project Tracking.", hash: "#project-tracking", supportedRoles: ["leadership"], requiredCapabilities: ["review_desk.view"] },
  "review-automation-failures": { id: "review-automation-failures", label: "Automation Failures", description: "Check system and automation issues first.", hash: "#admin/system", supportedRoles: ["admin"], requiredCapabilities: ["automations.view"] },
  "open-integrations": { id: "open-integrations", label: "Open Integrations", description: "Open integration health and sync controls.", hash: "#admin/integrations", supportedRoles: ["admin"], requiredCapabilities: ["integrations.view"] },
  "check-audit-controls": { id: "check-audit-controls", label: "Check Audit Controls", description: "Review audit posture and dangerous actions.", hash: "#admin/audit", supportedRoles: ["admin"], requiredCapabilities: ["audit_controls.view"] },
  "manage-permissions": { id: "manage-permissions", label: "Manage Permissions", description: "Open roles and permissions management.", hash: "#admin/roles", supportedRoles: ["admin"], requiredCapabilities: ["roles_permissions.view"] }
};

export const DASHBOARD_ROLE_LAYOUTS: Record<BusinessRole, DashboardRoleLayout> = {
  employee: {
    role: "employee",
    eyebrow: "Dashboard",
    title: "My Day",
    summary: "Start with your schedule, personal alerts, and the follow-through that affects today.",
    sections: [
      {
        id: "hero",
        label: "Today First",
        aboveFold: true,
        widgets: [
          placeWidget("employee-alerts", { sizeHint: "row", priorityRank: 1, hideWhenEmpty: true }),
          placeWidget("employee-day", { priorityRank: 10 }),
          placeWidget("quick-actions", { priorityRank: 30 })
        ]
      },
      {
        id: "primary",
        label: "Today",
        aboveFold: true,
        widgets: [
          placeWidget("employee-schedule", { priorityRank: 20 }),
          placeWidget("employee-follow-through", { priorityRank: 35 })
        ]
      },
      {
        id: "secondary",
        label: "Later",
        aboveFold: false,
        widgets: [placeWidget("recent-activity", { defaultCollapsed: true, hideWhenEmpty: true })]
      }
    ],
    quickActionIds: ["open-my-day", "view-my-schedule", "submit-request", "check-training"]
  },
  photographer: {
    role: "photographer",
    eyebrow: "Dashboard",
    title: "Field Command",
    summary: "Know where to go, what changed, and what needs prep before you leave for the next shoot.",
    sections: [
      {
        id: "hero",
        label: "Today First",
        aboveFold: true,
        widgets: [
          placeWidget("employee-alerts", { title: "Field Alerts", sizeHint: "row", priorityRank: 1, hideWhenEmpty: true }),
          placeWidget("employee-day", { title: "Today's Shoots", subtitle: "Your next field assignment and the work that matters today.", priorityRank: 10 }),
          placeWidget("quick-actions", { priorityRank: 30 })
        ]
      },
      {
        id: "primary",
        label: "Field Work",
        aboveFold: true,
        widgets: [
          placeWidget("field-travel", { priorityRank: 20 }),
          placeWidget("field-readiness", { priorityRank: 25 }),
          placeWidget("employee-gear", { priorityRank: 45 })
        ]
      },
      {
        id: "secondary",
        label: "Support",
        aboveFold: false,
        widgets: [
          placeWidget("employee-schedule", { sizeHint: "medium", priorityRank: 50 }),
          placeWidget("recent-activity", { defaultCollapsed: true, hideWhenEmpty: true })
        ]
      }
    ],
    quickActionIds: ["open-next-shoot", "view-location-details", "check-readiness", "view-assigned-gear"]
  },
  shoot_lead: {
    role: "shoot_lead",
    eyebrow: "Dashboard",
    title: "Lead Field Command",
    summary: "See what can break the day, where your team is going, and which field issues need escalation.",
    sections: [
      {
        id: "hero",
        label: "Today First",
        aboveFold: true,
        widgets: [
          placeWidget("employee-alerts", { title: "Field Alerts", sizeHint: "row", priorityRank: 1, hideWhenEmpty: true }),
          placeWidget("employee-day", { title: "Today's Shoots & Team Assignments", subtitle: "See the field day, your team context, and the next place that can break.", priorityRank: 10 }),
          placeWidget("quick-actions", { priorityRank: 30 })
        ]
      },
      {
        id: "primary",
        label: "Field Oversight",
        aboveFold: true,
        widgets: [
          placeWidget("field-readiness", { title: "Shoot Readiness & Missing Info", priorityRank: 20 }),
          placeWidget("field-exceptions", { title: "Staffing Risks & Exceptions", sizeHint: "large", priorityRank: 25 })
        ]
      },
      {
        id: "secondary",
        label: "Escalations",
        aboveFold: false,
        widgets: [
          placeWidget("field-travel", { priorityRank: 30 }),
          placeWidget("employee-gear", { priorityRank: 45 }),
          placeWidget("recent-activity", { defaultCollapsed: true, hideWhenEmpty: true })
        ]
      }
    ],
    quickActionIds: ["open-staffing", "resolve-readiness-issue", "open-team-attendance", "view-field-exceptions"]
  },
  production_staff: {
    role: "production_staff",
    eyebrow: "Dashboard",
    title: "Production Dashboard",
    summary: "Your queue, blockers, and release pressure live here so you can move work fast without opening five screens.",
    sections: [
      {
        id: "hero",
        label: "Today First",
        aboveFold: true,
        widgets: [placeWidget("production-queue", { priorityRank: 10 }), placeWidget("quick-actions", { priorityRank: 30 })]
      },
      {
        id: "primary",
        label: "Production",
        aboveFold: true,
        widgets: [placeWidget("production-qa-release", { priorityRank: 20 })]
      },
      {
        id: "secondary",
        label: "Later",
        aboveFold: false,
        widgets: [placeWidget("recent-activity", { defaultCollapsed: true, hideWhenEmpty: true })]
      }
    ],
    quickActionIds: ["open-my-queue", "view-qa-blockers", "open-release-list", "review-flagged-job"]
  },
  customer_service_staff: {
    role: "customer_service_staff",
    eyebrow: "Dashboard",
    title: "Service Dashboard",
    summary: "Urgent follow-up, support pressure, and the linked account context you need are front and center.",
    sections: [
      {
        id: "hero",
        label: "Today First",
        aboveFold: true,
        widgets: [placeWidget("service-summary", { priorityRank: 10 }), placeWidget("quick-actions", { priorityRank: 30 })]
      },
      {
        id: "primary",
        label: "Support",
        aboveFold: true,
        widgets: [placeWidget("service-metrics", { priorityRank: 20 })]
      },
      {
        id: "secondary",
        label: "Later",
        aboveFold: false,
        widgets: [placeWidget("recent-activity", { defaultCollapsed: true, hideWhenEmpty: true })]
      }
    ],
    quickActionIds: ["open-priority-issues", "view-service-metrics", "open-account-contact", "review-escalations"]
  },
  sales_growth_staff: {
    role: "sales_growth_staff",
    eyebrow: "Dashboard",
    title: "Growth Dashboard",
    summary: "Keep pipeline movement, renewals, and proposal deadlines visible without opening the whole commercial stack first.",
    scopeSelectorSupport: ["me", "company"],
    sections: [
      {
        id: "hero",
        label: "Today First",
        aboveFold: true,
        widgets: [placeWidget("sales-pipeline", { priorityRank: 10 }), placeWidget("quick-actions", { priorityRank: 30 })]
      },
      {
        id: "primary",
        label: "Follow-Up",
        aboveFold: true,
        widgets: [placeWidget("sales-deadlines", { priorityRank: 20 })]
      },
      {
        id: "secondary",
        label: "Later",
        aboveFold: false,
        widgets: [placeWidget("recent-activity", { defaultCollapsed: true, hideWhenEmpty: true })]
      }
    ],
    quickActionIds: ["open-pipeline", "review-renewals", "open-proposal-deadlines", "view-account-contacts"]
  },
  manager: {
    role: "manager",
    eyebrow: "Dashboard",
    title: "Manager Dashboard",
    summary: "See team priorities, approvals, staffing risk, and the workflow that needs intervention first.",
    sections: [
      {
        id: "hero",
        label: "Today First",
        aboveFold: true,
        widgets: [placeWidget("leadership-home-pulse", { priorityRank: 10 })]
      },
      {
        id: "primary",
        label: "Oversight",
        aboveFold: false,
        widgets: [
          placeWidget("manager-workflow", { priorityRank: 20 }),
          placeWidget("manager-cockpit", { priorityRank: 25 }),
          placeWidget("quick-actions", { priorityRank: 30 })
        ]
      },
      {
        id: "secondary",
        label: "More Team Queues",
        aboveFold: false,
        widgets: [placeWidget("leadership-staffing", { priorityRank: 50 })]
      }
    ],
    quickActionIds: ["review-approvals", "open-team-schedule", "resolve-exception", "check-team-workload"]
  },
  leadership: {
    role: "leadership",
    eyebrow: "Dashboard",
    title: "Leadership Dashboard",
    summary: "Get the company-level watch, cross-functional risk, and operational flow without digging through every module first.",
    sections: [
      {
        id: "hero",
        label: "Today First",
        aboveFold: true,
        widgets: [placeWidget("leadership-home-pulse", { priorityRank: 10 })]
      },
      {
        id: "primary",
        label: "Intervention",
        aboveFold: false,
        widgets: [
          placeWidget("leadership-workflow", { priorityRank: 20 }),
          placeWidget("leadership-cockpit", { priorityRank: 25 }),
          placeWidget("quick-actions", { priorityRank: 30 })
        ]
      },
      {
        id: "secondary",
        label: "More Operational Queues",
        aboveFold: false,
        widgets: [placeWidget("leadership-readiness", { priorityRank: 60 }), placeWidget("leadership-staffing", { priorityRank: 55 })]
      }
    ],
    quickActionIds: ["open-executive-summary", "review-company-alerts", "view-business-health", "check-major-exceptions"]
  },
  admin: {
    role: "admin",
    eyebrow: "Dashboard",
    title: "Admin Dashboard",
    summary: "Start with the same operational command layer leadership sees, then drop into system health, integrations, and dangerous-action controls.",
    sections: [
      {
        id: "hero",
        label: "Today First",
        aboveFold: true,
        widgets: [placeWidget("leadership-home-pulse", { priorityRank: 10 })]
      },
      {
        id: "primary",
        label: "Control",
        aboveFold: true,
        widgets: [
          placeWidget("admin-system-health", { priorityRank: 20 }),
          placeWidget("admin-audit-watch", { priorityRank: 25 }),
          placeWidget("quick-actions", { priorityRank: 30 })
        ]
      },
      {
        id: "secondary",
        label: "Later",
        aboveFold: false,
        widgets: []
      }
    ],
    quickActionIds: ["review-automation-failures", "open-integrations", "check-audit-controls", "manage-permissions"]
  }
};
