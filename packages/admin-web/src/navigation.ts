export type TabKey =
  | "my-work"
  | "dashboard"
  | "reports"
  | "profitability"
  | "sales"
  | "customer-service"
  | "training"
  | "outlook"
  | "organizations"
  | "contacts"
  | "gear"
  | "locations"
  | "calendar"
  | "shoots"
  | "projects"
  | "alerts"
  | "labor"
  | "payroll"
  | "time"
  | "compliance"
  | "approvals"
  | "status-board"
  | "status-board-display"
  | "access"
  | "admin-config"
  | "security"
  | "account";

// Internal admin-web note:
// `projects` remains the Graphics workspace tab inside the hash-based shell.
// The external account-facing portal route plan also uses `/projects/...`, but that
// path lives outside this shell and is owned by the Microsoft client portal service.

export type ShellSectionKey =
  | "home"
  | "my-work"
  | "schools"
  | "sports"
  | "photography"
  | "production"
  | "project-tracking"
  | "jobs"
  | "contacts"
  | "schedule"
  | "hr-admin"
  | "leadership"
  | "settings"
  | "departments"
  | "operations"
  | "admin"
  | "studios"
  | "graphics"
  | "dashboard"
  | "directory"
  | "employees"
  | "reports";

export type ShellRouteId = string;

export type ShellSection = {
  key: ShellSectionKey;
  label: string;
  routeId: ShellRouteId;
  tabs: TabKey[];
  childRouteIds: ShellRouteId[];
  description: string;
};

type RouteRender =
  | { kind: "dashboard-root" }
  | { kind: "dashboard-my-tasks" }
  | { kind: "teams-home" }
  | { kind: "teams-communications" }
  | { kind: "tab"; tab: TabKey }
  | { kind: "employees-workspace" }
  | { kind: "admin-workspace" }
  | { kind: "shared-jobs-list"; department: "schools" | "sports" | null; routeBase: string }
  | { kind: "shared-job-detail"; department: "schools" | "sports" | null; routeBase: string }
  | { kind: "shared-job-editor"; department: "schools" | "sports" | null; routeBase: string; mode: "create" | "edit" }
  | { kind: "shared-task-page"; mode: "create" | "detail" }
  | {
      kind: "central-job-import";
      department: "schools" | "sports";
      contextLabel: string;
      routeHash: string;
      returnHash: string;
    }
  | { kind: "operations-control-room" }
  | { kind: "operations-exceptions" }
  | { kind: "project-tracking-command-center" }
  | { kind: "prep-readiness-queue" }
  | { kind: "production-workflow-queue" }
  | { kind: "workflow-template-builder" }
  | { kind: "client-command-center" }
  | { kind: "job-closeout-v1" }
  | { kind: "shared-exceptions"; department: "schools" | "sports" | null }
  | { kind: "executive-dashboard" }
  | { kind: "operations-today"; department: "schools" | "sports" | null }
  | { kind: "studios-workspace"; focus?: "overview" | "today" | "travel" | "pre_service" | "readiness" | "workload" }
  | { kind: "global-search" }
  | { kind: "scheduling-workspace"; area?: "calendar" | "staffing" | "exceptions" | "outlook" }
  | { kind: "schedule-workspace" }
  | { kind: "schools-hub" }
  | { kind: "sports-overview" }
  | { kind: "sports-shoots" }
  | { kind: "sports-shoot-detail" }
  | { kind: "sports-accounts" }
  | { kind: "sports-contacts" }
  | { kind: "sports-graphics" }
  | { kind: "sports-peer-qa" }
  | { kind: "sports-reports" }
  | { kind: "sports-settings" }
  | { kind: "files-workspace" }
  | { kind: "checklist-templates" }
  | { kind: "directory"; entryView: "organizations" | "contacts"; defaultContactAudience?: "all" | "company" }
  | {
      kind: "admin-system";
      view: "overview" | "foundation" | "communications" | "diagnostics" | "audit" | "sync" | "repairs" | "access-debug" | "imports" | "exports" | "trace";
    }
  | { kind: "hidden-redirect"; targetHash: string; summary: string };

type RouteDefinition = {
  id: ShellRouteId;
  label: string;
  sectionKey: ShellSectionKey | null;
  description: string;
  canonicalHash: string;
  visibleTabs?: TabKey[];
  visibleForEmployeeOnly?: boolean;
  visibleForFullShell?: boolean;
  showInSectionNav?: boolean;
  utility?: boolean;
  render: RouteRender;
};

const SECTION_DEFINITIONS: Array<{ key: ShellSectionKey; label: string; description: string; routeId: ShellRouteId }> = [
  {
    key: "home",
    label: "Home",
    description: "Calm command overview for priorities, today's risks, recent activity, and quick links.",
    routeId: "dashboard"
  },
  {
    key: "my-work",
    label: "My Work",
    description: "Personal execution surface for assigned work, approvals, follow-ups, and completed work.",
    routeId: "dashboard-my-day"
  },
  {
    key: "schools",
    label: "Schools",
    description: "Focused school work lens for active jobs, tasks, contacts, risks, and project tracking.",
    routeId: "operations-schools"
  },
  {
    key: "sports",
    label: "Sports",
    description: "Focused sports work lens for active jobs, accounts, contacts, risks, and production handoffs.",
    routeId: "sports"
  },
  {
    key: "photography",
    label: "Photography",
    description: "Shoot readiness, today's shoots, field workflow, post-shoot closeout, staffing, and travel.",
    routeId: "studios"
  },
  {
    key: "production",
    label: "Production",
    description: "Downstream production queue, active production work, QA, release, handoff, and files.",
    routeId: "graphics"
  },
  {
    key: "project-tracking",
    label: "Project Tracking",
    description: "Master workflow, owner, status, current step, deadline, waiting-on, and risk view.",
    routeId: "project-tracking"
  },
  {
    key: "jobs",
    label: "Jobs",
    description: "Canonical job records, details, documents, tasks, history, and notes.",
    routeId: "jobs"
  },
  {
    key: "contacts",
    label: "Contacts",
    description: "People, organizations, schools, sports organizations, districts, roles, and relationship notes.",
    routeId: "directory-accounts"
  },
  {
    key: "schedule",
    label: "Schedule",
    description: "Calendar, events, shifts, job schedule, team schedule, staffing, and resource schedule.",
    routeId: "operations-schedule"
  },
  {
    key: "hr-admin",
    label: "HR / Administrative",
    description: "Employees, profiles, training, certifications, attendance, approvals, payroll, review tools, and assets.",
    routeId: "people-ops"
  },
  {
    key: "leadership",
    label: "Leadership",
    description: "Leadership dashboard, reports, sales, KPIs, risks, performance, and strategic views.",
    routeId: "executive"
  },
  {
    key: "settings",
    label: "Settings",
    description: "System settings, workflow templates, integrations, roles, permissions, diagnostics, and configuration.",
    routeId: "admin"
  }
];

const ROUTES: RouteDefinition[] = [
  {
    id: "dashboard",
    label: "Home",
    sectionKey: "home",
    description: "Role-aware launchpad for personalized work, schedule access, alerts, and quick operational links.",
    canonicalHash: "#home",
    visibleTabs: ["dashboard", "my-work", "calendar", "alerts"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "dashboard-root" }
  },
  {
    id: "teams-home",
    label: "Teams Home",
    sectionKey: null,
    description: "Focused Teams front door for daily assignments, schedule, follow-through, staffing alerts, search, and recent updates.",
    canonicalHash: "#teams/home",
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: false,
    utility: true,
    render: { kind: "teams-home" }
  },
  {
    id: "teams-communications",
    label: "Communication Actions",
    sectionKey: null,
    description: "Focused record-linked communication actions for assigned work, linked meetings, urgent delivery issues, and fast jumps back into the owning record.",
    canonicalHash: "#teams/communications",
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: false,
    utility: true,
    render: { kind: "teams-communications" }
  },
  {
    id: "communications",
    label: "Communications (Legacy Alias)",
    sectionKey: null,
    description: "Hidden compatibility alias for the record-linked communication actions utility.",
    canonicalHash: "#communications",
    visibleTabs: ["dashboard"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "teams-communications" }
  },
  {
    id: "dashboard-my-day",
    label: "My Work",
    sectionKey: "my-work",
    description: "Personal execution surface for assigned jobs, tasks, events, acknowledgements, and follow-through.",
    canonicalHash: "#my-work",
    visibleTabs: ["my-work"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: false,
    utility: true,
    render: { kind: "tab", tab: "my-work" }
  },
  {
    id: "dashboard-my-schedule",
    label: "My Schedule",
    sectionKey: "schedule",
    description: "Shift timing, schedule clarity, and day-of calendar context.",
    canonicalHash: "#my-schedule",
    visibleTabs: ["calendar"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: false,
    utility: true,
    render: { kind: "schedule-workspace" }
  },
  {
    id: "dashboard-my-tasks",
    label: "Tasks",
    sectionKey: "my-work",
    description: "Shared execution queue for task-owned follow-through across departments.",
    canonicalHash: "#tasks",
    visibleTabs: ["my-work", "approvals", "training"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "dashboard-my-tasks" }
  },
  {
    id: "dashboard-alerts",
    label: "Notifications",
    sectionKey: "home",
    description: "Alert queue and notification-driven work that needs attention.",
    canonicalHash: "#notifications",
    visibleTabs: ["alerts"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    utility: true,
    render: { kind: "tab", tab: "alerts" }
  },
  {
    id: "search",
    label: "Search",
    sectionKey: null,
    description: "Fast launch point for shared jobs, directory records, and internal work lookup.",
    canonicalHash: "#search",
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: false,
    utility: true,
    render: { kind: "global-search" }
  },
  {
    id: "exceptions",
    label: "Risk / Exceptions",
    sectionKey: "leadership",
    description: "Shared operational exception queue for unresolved readiness, staffing, production, approval, delivery, and same-day execution risk.",
    canonicalHash: "#exceptions",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "shared-exceptions", department: null }
  },
  {
    id: "executive",
    label: "Leadership Dashboard",
    sectionKey: "leadership",
    description: "Cross-department executive command surface for urgent risk, blocked work, staffing pressure, and operational health.",
    canonicalHash: "#executive",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "executive-dashboard" }
  },
  {
    id: "operations",
    label: "Operations (Legacy)",
    sectionKey: null,
    description: "Cross-functional oversight for exceptions, today, shared scheduling oversight, assets, and global admin tools.",
    canonicalHash: "#operations",
    visibleTabs: ["calendar", "status-board", "gear"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "operations-control-room" }
  },
  {
    id: "operations-exceptions",
    label: "Exceptions",
    sectionKey: "leadership",
    description: "Escalation-first exception queue for staffing, readiness, approvals, sync failures, and delivery risk that cannot wait.",
    canonicalHash: "#operations/exceptions",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "operations-exceptions" }
  },
  {
    id: "operations-today",
    label: "Today",
    sectionKey: "home",
    description: "Shared same-day control view for readiness, staffing gaps, lead confirmations, live issues, and downstream risk that affects today.",
    canonicalHash: "#operations/today",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "operations-today", department: null }
  },
  {
    id: "operations-scheduling",
    label: "Scheduling",
    sectionKey: "schedule",
    description: "Shared scheduling oversight for job calendar, staffing coverage, conflicts, and publishing control.",
    canonicalHash: "#operations/scheduling",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "scheduling-workspace", area: "calendar" }
  },
  {
    id: "studios-shoots",
    label: "Today's Shoots",
    sectionKey: "photography",
    description: "Shoot execution queue for field readiness, travel, pre-service, and same-day studios work.",
    canonicalHash: "#studios/shoots",
    visibleTabs: ["shoots"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "studios-workspace", focus: "today" }
  },
  {
    id: "operations-schedule",
    label: "Schedule",
    sectionKey: "schedule",
    description: "Readable assignment calendar, shift timing, and linked shoot visibility.",
    canonicalHash: "#schedule",
    visibleTabs: ["calendar"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "schedule-workspace" }
  },
  {
    id: "operations-staffing",
    label: "Staff Assignment Board",
    sectionKey: "leadership",
    description: "Leadership-owned coverage gaps, staffing control, and lead assignment inside the shared schedule workspace.",
    canonicalHash: "#operations/staffing?area=staffing",
    visibleTabs: ["calendar"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "scheduling-workspace", area: "staffing" }
  },
  {
    id: "operations-attendance",
    label: "Attendance",
    sectionKey: "hr-admin",
    description: "Attendance exceptions, presence visibility, and correction workflows that belong with employee accountability.",
    canonicalHash: "#employees/attendance",
    visibleTabs: ["time"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "time" }
  },
  {
    id: "operations-status-board",
    label: "Status Board",
    sectionKey: null,
    description: "Operational wallboard and live status visibility.",
    canonicalHash: "#operations/status-board",
    visibleTabs: ["status-board"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "tab", tab: "status-board" }
  },
  {
    id: "studios-travel",
    label: "Travel & Logistics",
    sectionKey: "photography",
    description: "Travel blocks, routing context, field logistics, and pre-day movement planning for shoot crews.",
    canonicalHash: "#studios/travel",
    visibleTabs: ["calendar", "shoots"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "studios-workspace", focus: "travel" }
  },
  {
    id: "people-exceptions",
    label: "Exceptions",
    sectionKey: "hr-admin",
    description: "Attendance, schedule, and planning exceptions that need people-side review and follow-through.",
    canonicalHash: "#employees/exceptions",
    visibleTabs: ["calendar", "alerts"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "scheduling-workspace", area: "exceptions" }
  },
  {
    id: "studios-readiness",
    label: "Readiness (Pre-Service)",
    sectionKey: "photography",
    description: "Compatibility route for readiness pressure now consolidated into the Pre-Service job prep desk.",
    canonicalHash: "#studios/readiness",
    visibleTabs: ["shoots", "calendar"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "studios-workspace", focus: "readiness" }
  },
  {
    id: "studios",
    label: "Photography",
    sectionKey: "photography",
    description: "Calendar-first workspace for field execution, pre-service readiness, travel logistics, and senior photographer workload clarity.",
    canonicalHash: "#studios",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "studios-workspace", focus: "overview" }
  },
  {
    id: "studios-pre-service",
    label: "Pre-Service",
    sectionKey: "photography",
    description: "Pre-service coordination, field briefings, and the last operational checks before crews go live.",
    canonicalHash: "#studios/pre-service",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "studios-workspace", focus: "pre_service" }
  },
  {
    id: "studios-staffing",
    label: "Staffing",
    sectionKey: "photography",
    description: "Hidden compatibility alias. Staffing ownership now lives in Leadership on the Staff Assignment Board.",
    canonicalHash: "#studios/staffing",
    visibleTabs: ["calendar"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "scheduling-workspace", area: "staffing" }
  },
  {
    id: "studios-calendar",
    label: "30-Day Calendar",
    sectionKey: "photography",
    description: "Calendar-first Photography view over the shared master schedule.",
    canonicalHash: "#studios/calendar",
    visibleTabs: ["calendar"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "schedule-workspace" }
  },
  {
    id: "studios-workload",
    label: "Senior Photographer View",
    sectionKey: "photography",
    description: "Compact workload view for crews, readiness owners, and lead photographers across active shoot work.",
    canonicalHash: "#studios/workload",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "studios-workspace", focus: "workload" }
  },
  {
    id: "operations-job-admin",
    label: "Job Admin",
    sectionKey: null,
    description: "Global job administration view into the shared job truth layer without turning Operations into a second jobs owner.",
    canonicalHash: "#operations/job-admin",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "shared-jobs-list", department: null, routeBase: "#jobs" }
  },
  {
    id: "jobs",
    label: "Jobs",
    sectionKey: "jobs",
    description: "Shared cross-department jobs list powered by the central job truth layer.",
    canonicalHash: "#jobs",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "shared-jobs-list", department: null, routeBase: "#jobs" }
  },
  {
    id: "project-tracking",
    label: "Project Tracking",
    sectionKey: "project-tracking",
    description: "Company-wide overview of live jobs, current workflow step, deadlines, and risk.",
    canonicalHash: "#project-tracking",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "project-tracking-command-center" }
  },
  {
    id: "prep-readiness-queue",
    label: "Prep Readiness",
    sectionKey: "project-tracking",
    description: "Non-sending cleanup queue for jobs missing prep communication data.",
    canonicalHash: "#prep-readiness",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "prep-readiness-queue" }
  },
  {
    id: "production-workflow-queue",
    label: "Production Queue",
    sectionKey: "production",
    description: "Focused V1 queue of live workflow handoffs sent from Schools to Production.",
    canonicalHash: "#production-queue",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "production-workflow-queue" }
  },
  {
    id: "workflow-template-builder",
    label: "Workflow Templates",
    sectionKey: "settings",
    description: "Leadership-only builder for reusable workflow templates, milestones, controlled steps, owners, SLAs, and dependencies.",
    canonicalHash: "#project-tracking/workflow-templates",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "workflow-template-builder" }
  },
  {
    id: "client-command-center",
    label: "Client Command Center",
    sectionKey: "contacts",
    description: "Customer brain for organizations, accounts, contacts, services, ownership, readiness, notes, tasks, and future Outlook/Teams context.",
    canonicalHash: "#client-command-center",
    visibleTabs: ["organizations", "contacts"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "client-command-center" }
  },
  {
    id: "job-closeout-v1",
    label: "Job Closeout",
    sectionKey: "photography",
    description: "Mobile closeout, shoot check-ins, mileage review, auto-flagging, and daily/weekly operations reporting tied to canonical jobs.",
    canonicalHash: "#job-closeout",
    visibleTabs: ["shoots", "reports", "alerts", "payroll"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "job-closeout-v1" }
  },
  {
    id: "job-new",
    label: "New Job",
    sectionKey: null,
    description: "Shared job create shell for global job operations.",
    canonicalHash: "#jobs/new",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    utility: true,
    render: { kind: "shared-job-editor", department: null, routeBase: "#jobs", mode: "create" }
  },
  {
    id: "job-detail",
    label: "Job Detail",
    sectionKey: null,
    description: "Shared job detail shell for cross-department job operations.",
    canonicalHash: "#jobs/detail",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    utility: true,
    render: { kind: "shared-job-detail", department: null, routeBase: "#jobs" }
  },
  {
    id: "job-edit",
    label: "Edit Job",
    sectionKey: null,
    description: "Shared job edit shell for cross-department job operations.",
    canonicalHash: "#jobs/edit",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    utility: true,
    render: { kind: "shared-job-editor", department: null, routeBase: "#jobs", mode: "edit" }
  },
  {
    id: "task-new",
    label: "New Task",
    sectionKey: null,
    description: "Shared task create shell for internal execution work.",
    canonicalHash: "#tasks/new",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    utility: true,
    render: { kind: "shared-task-page", mode: "create" }
  },
  {
    id: "task-detail",
    label: "Task Detail",
    sectionKey: null,
    description: "Shared task detail shell for internal execution work.",
    canonicalHash: "#tasks/detail",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    utility: true,
    render: { kind: "shared-task-page", mode: "detail" }
  },
  {
    id: "operations-schools",
    label: "Schools",
    sectionKey: "schools",
    description: "Department overview for school jobs, task ownership, overdue work, and exception risk.",
    canonicalHash: "#schools",
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "schools-hub" }
  },
  {
    id: "schools-jobs",
    label: "Jobs",
    sectionKey: "schools",
    description: "All school jobs across the company with ownership, status, and milestone visibility.",
    canonicalHash: "#schools/jobs",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "schools-hub" }
  },
  {
    id: "schools-job-new",
    label: "New School Job",
    sectionKey: "schools",
    description: "Shared create shell for school jobs.",
    canonicalHash: "#schools/jobs/new",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "shared-job-editor", department: "schools", routeBase: "#schools/jobs", mode: "create" }
  },
  {
    id: "schools-job-detail",
    label: "School Job Detail",
    sectionKey: "schools",
    description: "Shared detail shell for school jobs with school-specific summary panels and tabs.",
    canonicalHash: "#schools/jobs/detail",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "shared-job-detail", department: "schools", routeBase: "#schools/jobs" }
  },
  {
    id: "schools-job-edit",
    label: "Edit School Job",
    sectionKey: "schools",
    description: "Shared edit shell for school jobs.",
    canonicalHash: "#schools/jobs/edit",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "shared-job-editor", department: "schools", routeBase: "#schools/jobs", mode: "edit" }
  },
  {
    id: "operations-schools-import",
    label: "Import Jobs",
    sectionKey: "schools",
    description: "Bulk import school jobs into the canonical intake backend with row-level validation, duplicate review, and safe commit options.",
    canonicalHash: "#schools/import",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: {
      kind: "central-job-import",
      department: "schools",
      contextLabel: "Schools",
      routeHash: "#schools/import",
      returnHash: "#schools"
    }
  },
  {
    id: "schools-tasks",
    label: "Tasks",
    sectionKey: "schools",
    description: "Task views for the Schools department by person, role, due date, and overdue work.",
    canonicalHash: "#schools/tasks",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "schools-hub" }
  },
  {
    id: "schools-exceptions",
    label: "Exceptions",
    sectionKey: "schools",
    description: "Direct view of stalled jobs, missing data, gallery risks, yearbook risks, delivery risks, and ID issues.",
    canonicalHash: "#schools/exceptions",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "schools-hub" }
  },
  {
    id: "sports",
    label: "Sports",
    sectionKey: "sports",
    description: "Sports mission control for shoots, staffing volatility, proof approvals, specialty products, account health, and escalations.",
    canonicalHash: "#sports",
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "sports-overview" }
  },
  {
    id: "sports-shoots",
    label: "Jobs",
    sectionKey: "sports",
    description: "Operational master board for sports jobs with list, calendar, workload, and downstream visibility tied back to the same canonical job record.",
    canonicalHash: "#sports/jobs",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "shared-jobs-list", department: "sports", routeBase: "#sports/jobs" }
  },
  {
    id: "sports-shoot-new",
    label: "New Job",
    sectionKey: "sports",
    description: "Shared create shell for sports shoots.",
    canonicalHash: "#sports/jobs/new",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "shared-job-editor", department: "sports", routeBase: "#sports/jobs", mode: "create" }
  },
  {
    id: "sports-shoot-detail",
    label: "Job Detail",
    sectionKey: "sports",
    description: "Sports job command center with readiness, staffing, teams, production, proofs, products, and activity history.",
    canonicalHash: "#sports/jobs/detail",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "shared-job-detail", department: "sports", routeBase: "#sports/jobs" }
  },
  {
    id: "sports-shoot-edit",
    label: "Edit Job",
    sectionKey: "sports",
    description: "Shared edit shell for sports shoots.",
    canonicalHash: "#sports/jobs/edit",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "shared-job-editor", department: "sports", routeBase: "#sports/jobs", mode: "edit" }
  },
  {
    id: "sports-shoots-import",
    label: "Import Jobs",
    sectionKey: "sports",
    description: "Bulk import sports jobs into the canonical intake backend with row-level validation, duplicate review, and safe commit options.",
    canonicalHash: "#sports/jobs/import",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: {
      kind: "central-job-import",
      department: "sports",
      contextLabel: "Sports",
      routeHash: "#sports/jobs/import",
      returnHash: "#sports/jobs"
    }
  },
  {
    id: "sports-accounts",
    label: "Accounts",
    sectionKey: "sports",
    description: "Sports-filtered account management built on shared organizations with account health, active seasons, shoot history, and escalations.",
    canonicalHash: "#sports/accounts",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "sports-accounts" }
  },
  {
    id: "sports-contacts",
    label: "Contacts",
    sectionKey: "sports",
    description: "Sports-filtered wrapper around shared contacts for approval owners, billing contacts, and active job relationships.",
    canonicalHash: "#sports/contacts",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "sports-contacts" }
  },
  {
    id: "sports-graphics",
    label: "Production",
    sectionKey: "sports",
    description: "Sports graphics queue for proofs, specialty products, QA, and blocked downstream work tied to the same canonical jobs.",
    canonicalHash: "#sports/graphics",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "sports-graphics" }
  },
  {
    id: "sports-peer-qa",
    label: "Peer QA",
    sectionKey: "sports",
    description: "Sports production QA and release-confidence board for owner checks, peer review, corrections, blockers, and Spencer review.",
    canonicalHash: "#sports/peer-qa",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "sports-peer-qa" }
  },
  {
    id: "sports-exceptions",
    label: "Exceptions",
    sectionKey: "sports",
    description: "All unresolved sports risk in one place, grouped by timing, staffing, client approvals, blocked production, and escalations.",
    canonicalHash: "#sports/exceptions",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "shared-exceptions", department: "sports" }
  },
  {
    id: "sports-reports",
    label: "Sports Reports",
    sectionKey: "leadership",
    description: "Sports-specific reporting for readiness, staffing gaps, proof delays, specialty volume, and season-level performance.",
    canonicalHash: "#sports/reports",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "sports-reports" }
  },
  {
    id: "sports-settings",
    label: "Sports Settings",
    sectionKey: "settings",
    description: "Leadership and admin controls for sports checklist templates, product presets, thresholds, and saved view governance.",
    canonicalHash: "#sports/settings",
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "sports-settings" }
  },
  {
    id: "graphics",
    label: "Production",
    sectionKey: "production",
    description: "Internal graphics and downstream production board for intake, queue management, QA, release readiness, blockers, and workload.",
    canonicalHash: "#graphics",
    visibleTabs: ["projects"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "tab", tab: "projects" }
  },
  {
    id: "files",
    label: "Files",
    sectionKey: "production",
    description: "Temporary shared files compatibility surface backed by the existing production asset manager until a dedicated files workspace lands.",
    canonicalHash: "#files",
    visibleTabs: ["projects"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "files-workspace" }
  },
  {
    id: "graphics-queue",
    label: "Queue",
    sectionKey: "production",
    description: "Newly funneled or unowned graphics work that still needs kickoff and ownership.",
    canonicalHash: "#graphics/queue?queue=team_queue&stage=ready_for_production",
    visibleTabs: ["projects"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "projects" }
  },
  {
    id: "graphics-legacy-alias",
    label: "Production Workspace (Legacy Alias)",
    sectionKey: "production",
    description: "Legacy alias for the canonical Graphics workspace. Keep it working, but do not treat it as the owner route.",
    canonicalHash: "#graphics",
    visibleTabs: ["projects"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "tab", tab: "projects" }
  },
  {
    id: "graphics-qa",
    label: "QA",
    sectionKey: "production",
    description: "Peer review, correction, and final QC pressure inside the canonical production workflow.",
    canonicalHash: "#graphics/qa?queue=qa_queue&stage=ready_for_qa",
    visibleTabs: ["projects"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "projects" }
  },
  {
    id: "graphics-release",
    label: "Release",
    sectionKey: "production",
    description: "Final QC, ready-to-send, and controlled release work that is close to delivery.",
    canonicalHash: "#graphics/release?queue=ready_to_release_queue&stage=ready_to_release",
    visibleTabs: ["projects"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "projects" }
  },
  {
    id: "graphics-workload",
    label: "Workload View",
    sectionKey: "production",
    description: "Ownership and workload pressure across active production work.",
    canonicalHash: "#graphics/workload?queue=active",
    visibleTabs: ["projects"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "projects" }
  },
  {
    id: "directory",
    label: "Directory",
    sectionKey: null,
    description: "Master records for external contacts, internal people, locations, and accounts.",
    canonicalHash: "#directory",
    visibleTabs: ["organizations", "contacts", "locations"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: {
      kind: "hidden-redirect",
      targetHash: "#accounts",
      summary: "Opening the canonical Accounts workspace instead of the legacy Directory landing route."
    }
  },
  {
    id: "directory-contacts",
    label: "Contacts",
    sectionKey: "contacts",
    description: "External contacts and relationship context owned by Directory.",
    canonicalHash: "#directory/contacts",
    visibleTabs: ["contacts"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "directory", entryView: "contacts", defaultContactAudience: "all" }
  },
  {
    id: "directory-internal",
    label: "Internal Directory",
    sectionKey: "hr-admin",
    description: "Internal staff lookup using the same person records without creating a second directory system.",
    canonicalHash: "#directory/internal",
    visibleTabs: ["contacts"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "directory", entryView: "contacts", defaultContactAudience: "company" }
  },
  {
    id: "directory-locations",
    label: "Locations",
    sectionKey: "contacts",
    description: "Master location records and field-ready guide content.",
    canonicalHash: "#directory/locations",
    visibleTabs: ["locations"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "locations" }
  },
  {
    id: "directory-accounts",
    label: "Organizations",
    sectionKey: "contacts",
    description: "Accounts, schools, organizations, and account-level relationship context.",
    canonicalHash: "#accounts",
    visibleTabs: ["organizations"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "directory", entryView: "organizations" }
  },
  {
    id: "assets",
    label: "Gear & Assets",
    sectionKey: "hr-admin",
    description: "Gear ownership, custody, maintenance, and repair history.",
    canonicalHash: "#operations/assets",
    visibleTabs: ["gear"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "gear" }
  },
  {
    id: "assets-gear",
    label: "Asset Inventory",
    sectionKey: "hr-admin",
    description: "Primary gear inventory and custody owner workspace.",
    canonicalHash: "#operations/assets/gear",
    visibleTabs: ["gear"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "tab", tab: "gear" }
  },
  {
    id: "assets-kits",
    label: "Kits",
    sectionKey: "hr-admin",
    description: "Kit composition and bundle-level asset readiness.",
    canonicalHash: "#operations/assets/kits",
    visibleTabs: ["gear"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: {
      kind: "hidden-redirect",
      targetHash: "#operations/assets/gear",
      summary: "Opening the shared gear workspace instead of a separate kit placeholder route."
    }
  },
  {
    id: "assets-custody",
    label: "Custody",
    sectionKey: "hr-admin",
    description: "Who has what, where it is, and what needs to come back.",
    canonicalHash: "#operations/assets/custody",
    visibleTabs: ["gear"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: {
      kind: "hidden-redirect",
      targetHash: "#operations/assets/gear",
      summary: "Opening the shared gear workspace instead of a custody placeholder route."
    }
  },
  {
    id: "assets-repairs",
    label: "Repairs",
    sectionKey: "hr-admin",
    description: "Open repairs, downtime risk, and service follow-through.",
    canonicalHash: "#operations/assets/repairs",
    visibleTabs: ["gear"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: {
      kind: "hidden-redirect",
      targetHash: "#operations/assets/gear",
      summary: "Opening the shared gear workspace instead of a repairs placeholder route."
    }
  },
  {
    id: "assets-maintenance",
    label: "Maintenance",
    sectionKey: "hr-admin",
    description: "Preventive maintenance and readiness planning for shared gear.",
    canonicalHash: "#operations/assets/maintenance",
    visibleTabs: ["gear"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: {
      kind: "hidden-redirect",
      targetHash: "#operations/assets/gear",
      summary: "Opening the shared gear workspace instead of a maintenance placeholder route."
    }
  },
  {
    id: "assets-history",
    label: "Asset History",
    sectionKey: "hr-admin",
    description: "Asset-level service, custody, and operational history.",
    canonicalHash: "#operations/assets/history",
    visibleTabs: ["gear"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: {
      kind: "hidden-redirect",
      targetHash: "#operations/assets/gear",
      summary: "Opening the shared gear workspace instead of an asset-history placeholder route."
    }
  },
  {
    id: "people-ops",
    label: "Employees",
    sectionKey: "hr-admin",
    description: "People-side work for requests, approvals, training, readiness, and employee administration.",
    canonicalHash: "#people",
    visibleTabs: ["approvals", "training", "payroll", "account"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "employees-workspace" }
  },
  {
    id: "people-ops-requests",
    label: "Requests",
    sectionKey: "hr-admin",
    description: "Employee requests and manager queue work.",
    canonicalHash: "#employees/requests",
    visibleTabs: ["approvals"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "approvals" }
  },
  {
    id: "people-ops-pto",
    label: "PTO",
    sectionKey: "hr-admin",
    description: "Time-off request routing and review.",
    canonicalHash: "#employees/pto",
    visibleTabs: ["approvals"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "approvals" }
  },
  {
    id: "people-ops-approvals",
    label: "Approvals",
    sectionKey: "hr-admin",
    description: "Central approvals queue for trades, PTO, and review actions.",
    canonicalHash: "#approvals",
    visibleTabs: ["approvals"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "approvals" }
  },
  {
    id: "people-ops-compliance",
    label: "Compliance",
    sectionKey: "hr-admin",
    description: "Leadership-side compliance review for payroll blockers, mileage blockers, closeout drift, and unresolved presence exceptions.",
    canonicalHash: "#employees/compliance",
    visibleTabs: ["compliance"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "compliance" }
  },
  {
    id: "people-ops-availability",
    label: "Availability",
    sectionKey: "hr-admin",
    description: "Availability and staffing readiness for people, not shoot ownership.",
    canonicalHash: "#employees/availability",
    visibleTabs: ["approvals"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "approvals" }
  },
  {
    id: "people-ops-training",
    label: "Training",
    sectionKey: "hr-admin",
    description: "Training progress, readiness, and workbook detail.",
    canonicalHash: "#employees/training",
    visibleTabs: ["training"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "training" }
  },
  {
    id: "people-ops-certifications",
    label: "Certifications",
    sectionKey: "hr-admin",
    description: "Required readiness and certification visibility.",
    canonicalHash: "#employees/certifications",
    visibleTabs: ["training"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "training" }
  },
  {
    id: "people-ops-performance",
    label: "Performance / Coaching",
    sectionKey: "hr-admin",
    description: "Coaching and performance workflows should stay under Employees, not leak into operations records.",
    canonicalHash: "#employees/performance",
    visibleTabs: ["training"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: {
      kind: "hidden-redirect",
      targetHash: "#employees/training",
      summary: "Opening the shared training workspace instead of a performance placeholder route."
    }
  },
  {
    id: "people-ops-readiness",
    label: "Readiness",
    sectionKey: "hr-admin",
    description: "Readiness, signoff, and certification-adjacent progress that belongs with training instead of being buried under compliance review.",
    canonicalHash: "#employees/readiness",
    visibleTabs: ["training"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "training" }
  },
  {
    id: "people-ops-payroll",
    label: "Payroll Review",
    sectionKey: "hr-admin",
    description: "Existing payroll review workspace kept available through Employees without promoting it to a primary child route.",
    canonicalHash: "#employees/payroll",
    visibleTabs: ["payroll"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "payroll" }
  },
  {
    id: "growth",
    label: "Sales",
    sectionKey: "leadership",
    description: "New business and revenue growth tied back to shared accounts, schools, and contact records.",
    canonicalHash: "#directory/pipeline",
    visibleTabs: ["sales", "organizations"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "sales" }
  },
  {
    id: "growth-pipeline",
    label: "Sales Pipeline",
    sectionKey: "leadership",
    description: "Primary growth workspace for schools and sports opportunity work.",
    canonicalHash: "#growth/pipeline",
    visibleTabs: ["sales"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "tab", tab: "sales" }
  },
  {
    id: "growth-proposals",
    label: "Proposals",
    sectionKey: "leadership",
    description: "Proposal stage entry point inside the Sales Pipeline source of truth.",
    canonicalHash: "#growth/proposals",
    visibleTabs: ["sales"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "tab", tab: "sales" }
  },
  {
    id: "growth-rfps",
    label: "RFPs",
    sectionKey: "leadership",
    description: "RFP and bid work should stay connected to the same pipeline records.",
    canonicalHash: "#growth/rfps",
    visibleTabs: ["sales"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "tab", tab: "sales" }
  },
  {
    id: "growth-renewals",
    label: "Renewals",
    sectionKey: "leadership",
    description: "Renewal work owned by Growth and tied back to active accounts.",
    canonicalHash: "#growth/renewals",
    visibleTabs: ["sales"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "tab", tab: "sales" }
  },
  {
    id: "growth-accounts",
    label: "New Accounts",
    sectionKey: "leadership",
    description: "New-account growth work that should write back to Directory accounts instead of duplicating them.",
    canonicalHash: "#growth/accounts",
    visibleTabs: ["sales", "organizations"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: {
      kind: "hidden-redirect",
      targetHash: "#growth/pipeline",
      summary: "Opening the sales pipeline instead of a duplicate new-account placeholder route."
    }
  },
  {
    id: "growth-opportunities",
    label: "Opportunity Tracker",
    sectionKey: "leadership",
    description: "Opportunity tracking stays inside the pipeline source of truth.",
    canonicalHash: "#growth/opportunities",
    visibleTabs: ["sales"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "tab", tab: "sales" }
  },
  {
    id: "business-health",
    label: "Reports",
    sectionKey: "leadership",
    description: "Trend, performance, audit, and delivery reporting for leadership and scoped managers.",
    canonicalHash: "#business-health",
    visibleTabs: ["reports", "profitability", "labor", "customer-service", "status-board"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "tab", tab: "reports" }
  },
  {
    id: "business-health-reports",
    label: "Reports",
    sectionKey: "leadership",
    description: "Trend, performance, audit, and delivery reporting without duplicating live control surfaces.",
    canonicalHash: "#reports",
    visibleTabs: ["reports"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "reports" }
  },
  {
    id: "business-health-kpis",
    label: "KPIs",
    sectionKey: "leadership",
    description: "KPI view powered by the same reporting source of truth.",
    canonicalHash: "#reports/kpis",
    visibleTabs: ["reports"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "reports" }
  },
  {
    id: "business-health-labor",
    label: "Labor",
    sectionKey: "leadership",
    description: "Labor variance, reliability, and staffing drift for leadership review.",
    canonicalHash: "#reports/labor",
    visibleTabs: ["labor"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "labor" }
  },
  {
    id: "business-health-profitability",
    label: "Finance",
    sectionKey: "leadership",
    description: "Plain-language profitability workspace with operational burden and watch signals.",
    canonicalHash: "#reports/finance",
    visibleTabs: ["profitability"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "profitability" }
  },
  {
    id: "business-health-customer-service",
    label: "Customer Service",
    sectionKey: "leadership",
    description: "Support health, trend pressure, and customer service reporting.",
    canonicalHash: "#reports/customer-service",
    visibleTabs: ["customer-service"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "customer-service" }
  },
  {
    id: "business-health-trends",
    label: "Trends",
    sectionKey: "leadership",
    description: "Trend analysis backed by the shared reporting surface.",
    canonicalHash: "#reports/trends",
    visibleTabs: ["reports"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "reports" }
  },
  {
    id: "business-health-operations",
    label: "Operations",
    sectionKey: "leadership",
    description: "Operational performance rollups and system-level status visibility.",
    canonicalHash: "#reports/operations",
    visibleTabs: ["reports", "status-board"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "reports" }
  },
  {
    id: "business-health-executive-summary",
    label: "Executive Summary",
    sectionKey: "leadership",
    description: "Leadership summary entry point for the broadest reports view.",
    canonicalHash: "#reports/executive",
    visibleTabs: ["reports", "profitability"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "reports" }
  },
  {
    id: "admin",
    label: "Settings",
    sectionKey: "settings",
    description: "System controls, integrations, audit posture, reference data, and admin-only review work.",
    canonicalHash: "#admin",
    visibleTabs: ["access", "outlook", "admin-config", "security", "payroll"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "admin-workspace" }
  },
  {
    id: "account",
    label: "My Account",
    sectionKey: null,
    description: "Personal profile, session, and sign-in settings.",
    canonicalHash: "#account",
    visibleTabs: ["account"],
    visibleForEmployeeOnly: true,
    visibleForFullShell: true,
    showInSectionNav: false,
    utility: true,
    render: { kind: "tab", tab: "account" }
  },
  {
    id: "admin-roles",
    label: "Roles & Permissions",
    sectionKey: "settings",
    description: "User directory, role posture, and access controls.",
    canonicalHash: "#admin/roles",
    visibleTabs: ["access"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "access" }
  },
  {
    id: "admin-integrations",
    label: "Integrations",
    sectionKey: "settings",
    description: "Calendar and external system integration health.",
    canonicalHash: "#admin/integrations",
    visibleTabs: ["outlook"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "outlook" }
  },
  {
    id: "admin-automations",
    label: "Automations",
    sectionKey: "settings",
    description: "Background retry pressure, sync conflicts, and automation health belong in Admin instead of scattered operational pages.",
    canonicalHash: "#admin/automations",
    visibleTabs: ["outlook", "security", "admin-config"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "admin-workspace" }
  },
  {
    id: "admin-checklists",
    label: "Checklist Templates",
    sectionKey: "settings",
    description: "Reusable workflow checklist templates, version publishing, and stage-blocking rules for shoots and production.",
    canonicalHash: "#admin/templates",
    visibleTabs: ["admin-config"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "checklist-templates" }
  },
  {
    id: "admin-settings",
    label: "Settings",
    sectionKey: "settings",
    description: "Stable system configuration and business rules with versioned change control.",
    canonicalHash: "#admin/settings",
    visibleTabs: ["admin-config"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "admin-config" }
  },
  {
    id: "admin-audit",
    label: "Audit Controls",
    sectionKey: "settings",
    description: "Security review, audit posture, and controlled admin actions.",
    canonicalHash: "#admin/audit",
    visibleTabs: ["security"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "tab", tab: "security" }
  },
  {
    id: "admin-reference-data",
    label: "Reference Data",
    sectionKey: "settings",
    description: "Reference data should stay centralized under Admin instead of leaking into multiple modules.",
    canonicalHash: "#admin/reference-data",
    visibleTabs: ["admin-config"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "admin-config" }
  },
  {
    id: "admin-system",
    label: "System Diagnostics",
    sectionKey: "settings",
    description: "Shared audit, diagnostics, sync, repair, and debug command surface for admins and tightly scoped maintainers.",
    canonicalHash: "#admin/system",
    visibleTabs: ["admin-config"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "admin-system", view: "overview" }
  },
  {
    id: "admin-system-foundation",
    label: "Foundation",
    sectionKey: "settings",
    description: "Feature flags, startup validation, health checks, and reliability signals for the shared core platform.",
    canonicalHash: "#admin/system/foundation",
    visibleTabs: ["admin-config"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "admin-system", view: "foundation" }
  },
  {
    id: "admin-system-communications",
    label: "Communications",
    sectionKey: "settings",
    description: "Hardening, diagnostics, and rollout controls for internal communications, Teams delivery, and embedded communication entry points.",
    canonicalHash: "#admin/system/communications",
    visibleTabs: ["admin-config"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "admin-system", view: "communications" }
  },
  {
    id: "admin-system-diagnostics",
    label: "Diagnostics",
    sectionKey: "settings",
    description: "Integrity findings, workflow drift, orphaned records, and targeted scans.",
    canonicalHash: "#admin/system/diagnostics",
    visibleTabs: ["admin-config"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "admin-system", view: "diagnostics" }
  },
  {
    id: "admin-system-audit-log",
    label: "Audit",
    sectionKey: "settings",
    description: "Formal mutation history and system audit trails.",
    canonicalHash: "#admin/system/audit",
    visibleTabs: ["admin-config"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "admin-system", view: "audit" }
  },
  {
    id: "admin-system-sync",
    label: "Sync Health",
    sectionKey: "settings",
    description: "Pipeline health, failed deliveries, stale syncs, and queue integrity.",
    canonicalHash: "#admin/system/sync",
    visibleTabs: ["admin-config"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "admin-system", view: "sync" }
  },
  {
    id: "admin-system-repairs",
    label: "Repairs",
    sectionKey: "settings",
    description: "Dry-run-first repair actions for common recoverable system failures.",
    canonicalHash: "#admin/system/repairs",
    visibleTabs: ["admin-config"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "admin-system", view: "repairs" }
  },
  {
    id: "admin-system-access-debug",
    label: "Access Debug",
    sectionKey: "settings",
    description: "Permission decision traces, visibility debugging, and access previews.",
    canonicalHash: "#admin/system/access-debug",
    visibleTabs: ["admin-config"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "admin-system", view: "access-debug" }
  },
  {
    id: "admin-system-imports",
    label: "Imports",
    sectionKey: "settings",
    description: "Import audit records, rejection counts, and failure summaries.",
    canonicalHash: "#admin/system/imports",
    visibleTabs: ["admin-config"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "admin-system", view: "imports" }
  },
  {
    id: "admin-system-exports",
    label: "Exports",
    sectionKey: "settings",
    description: "Export audit records, scope summaries, and selected column traces.",
    canonicalHash: "#admin/system/exports",
    visibleTabs: ["admin-config"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "admin-system", view: "exports" }
  },
  {
    id: "admin-system-trace",
    label: "Entity Trace",
    sectionKey: null,
    description: "Unified trace view for an individual resource.",
    canonicalHash: "#admin/trace",
    visibleTabs: ["admin-config"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "admin-system", view: "trace" }
  },
  {
    id: "admin-review-tools",
    label: "Review Tools",
    sectionKey: "hr-admin",
    description: "Payroll review, export readiness, mileage review, and admin-only reconciliation tools.",
    canonicalHash: "#admin/review-tools",
    visibleTabs: ["payroll"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: true,
    render: { kind: "tab", tab: "payroll" }
  },
  {
    id: "review-desk",
    label: "Review Desk (Legacy Alias)",
    sectionKey: "hr-admin",
    description: "Legacy alias for the Compliance workspace. Keep it working for backward compatibility, but do not treat it as the owner route.",
    canonicalHash: "#employees/compliance",
    visibleTabs: ["compliance"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "tab", tab: "compliance" }
  },
  {
    id: "status-board-display",
    label: "Status Board Display",
    sectionKey: null,
    description: "Presentation mode for the live status board.",
    canonicalHash: "#status-board-display",
    visibleTabs: ["status-board"],
    visibleForEmployeeOnly: false,
    visibleForFullShell: true,
    showInSectionNav: false,
    render: { kind: "tab", tab: "status-board-display" }
  }
];

const ROUTE_BY_ID = new Map(ROUTES.map((route) => [route.id, route]));
const SECTION_CHILD_ORDER: Partial<Record<ShellSectionKey, ShellRouteId[]>> = {
  home: [],
  "my-work": ["dashboard-my-day", "dashboard-my-tasks"],
  schools: ["schools-jobs", "schools-tasks", "schools-exceptions"],
  sports: ["sports-shoots", "sports-accounts", "sports-contacts", "sports-graphics", "sports-exceptions"],
  photography: [
    "studios-calendar",
    "studios-shoots",
    "studios-pre-service",
    "job-closeout-v1",
    "studios-travel",
    "studios-workload"
  ],
  production: ["production-workflow-queue", "graphics-queue", "graphics-workload", "graphics-qa", "graphics-release", "files"],
  "project-tracking": ["prep-readiness-queue"],
  jobs: [],
  contacts: ["directory-accounts", "directory-contacts", "client-command-center", "directory-locations"],
  schedule: ["operations-schedule", "operations-scheduling"],
  "hr-admin": [
    "people-ops",
    "operations-attendance",
    "people-ops-requests",
    "people-ops-pto",
    "people-ops-approvals",
    "people-ops-compliance",
    "people-ops-availability",
    "people-ops-training",
    "people-ops-certifications",
    "people-ops-readiness",
    "people-ops-payroll",
    "admin-review-tools",
    "assets"
  ],
  leadership: [
    "operations-staffing",
    "business-health-reports",
    "business-health-kpis",
    "business-health-labor",
    "business-health-profitability",
    "business-health-customer-service",
    "business-health-trends",
    "business-health-operations",
    "business-health-executive-summary",
    "growth",
    "sports-reports",
    "exceptions"
  ],
  settings: ["workflow-template-builder", "admin-checklists", "admin-integrations", "admin-roles", "admin-settings", "admin-reference-data", "sports-settings"]
};

export function getRouteById(routeId: ShellRouteId) {
  return ROUTE_BY_ID.get(routeId) ?? ROUTE_BY_ID.get("dashboard")!;
}

export function buildShellRouteHash(routeId: ShellRouteId) {
  return getRouteById(routeId).canonicalHash;
}

export function getPrimarySections(availableTabs: TabKey[], employeeOnlyMode: boolean): ShellSection[] {
  return SECTION_DEFINITIONS.map((section) => {
    const childRoutes = getVisibleChildRoutes(section.key, availableTabs, employeeOnlyMode);
    const tabs: TabKey[] = childRoutes.flatMap((route) => collectRouteTabs(route));
    const sectionRoute = getRouteById(section.routeId);
    return {
      key: section.key,
      label: section.label,
      routeId: section.routeId,
      tabs: [...new Set(tabs)],
      childRouteIds: childRoutes.map((route) => route.id),
      description: section.description
    };
  }).filter((section) => {
    const routeVisible = isRouteVisible(getRouteById(section.routeId), availableTabs, employeeOnlyMode);
    return routeVisible || section.childRouteIds.length > 0;
  });
}

export function getVisibleChildRoutes(sectionKey: ShellSectionKey, availableTabs: TabKey[], employeeOnlyMode: boolean) {
  const visibleRoutes = ROUTES.filter(
    (route) =>
      route.sectionKey === sectionKey &&
      route.showInSectionNav &&
      isRouteVisible(route, availableTabs, employeeOnlyMode)
  );
  const orderedIds = SECTION_CHILD_ORDER[sectionKey];
  if (!orderedIds?.length) {
    return visibleRoutes;
  }
  const orderMap = new Map(orderedIds.map((routeId, index) => [routeId, index]));
  return [...visibleRoutes].sort((left, right) => {
    const leftOrder = orderMap.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderMap.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.label.localeCompare(right.label);
  });
}

export function getVisibleUtilityRoutes(availableTabs: TabKey[], employeeOnlyMode: boolean) {
  return ROUTES.filter((route) => route.utility && isRouteVisible(route, availableTabs, employeeOnlyMode));
}

export function getDefaultRouteId(availableTabs: TabKey[], employeeOnlyMode: boolean): ShellRouteId {
  if (employeeOnlyMode && availableTabs.includes("my-work")) {
    return "dashboard-my-day";
  }
  if (availableTabs.includes("dashboard")) {
    return "dashboard";
  }
  const firstSection = getPrimarySections(availableTabs, employeeOnlyMode)[0];
  if (firstSection) {
    return firstSection.routeId;
  }
  return "dashboard";
}

export function resolveRouteId(hashValue: string, availableTabs: TabKey[], employeeOnlyMode: boolean): ShellRouteId {
  const [rawPath = "", query = ""] = hashValue.replace(/^#/, "").split("?");
  const path = rawPath.toLowerCase();
  const params = new URLSearchParams(query);

  if (!path || path === "home" || path === "dashboard") {
    return pickVisibleRoute("dashboard", availableTabs, employeeOnlyMode);
  }
  if (path === "teams" || path === "teams/home") {
    return pickVisibleRoute("teams-home", availableTabs, employeeOnlyMode);
  }
  if (path === "teams/communications") {
    return pickVisibleRoute("teams-communications", availableTabs, employeeOnlyMode);
  }
  if (path === "communications") {
    return pickVisibleRoute("communications", availableTabs, employeeOnlyMode);
  }
  if (path === "dashboard/my-day" || path === "my-work" || path === "work" || path === "my-shifts") {
    return pickVisibleRoute("dashboard-my-day", availableTabs, employeeOnlyMode);
  }
  if (path === "dashboard/my-schedule" || path === "my-schedule") {
    return pickVisibleRoute("dashboard-my-schedule", availableTabs, employeeOnlyMode);
  }
  if (path === "dashboard/my-tasks") {
    return pickVisibleRoute("dashboard-my-tasks", availableTabs, employeeOnlyMode);
  }
  if (path === "tasks") {
    return pickVisibleRoute("dashboard-my-tasks", availableTabs, employeeOnlyMode);
  }
  if (path === "dashboard/alerts" || path === "alerts" || path === "notifications") {
    return pickVisibleRoute("dashboard-alerts", availableTabs, employeeOnlyMode);
  }
  if (path === "search") {
    return pickVisibleRoute("search", availableTabs, employeeOnlyMode);
  }
  if (path === "watchlist") {
    return pickVisibleRoute("exceptions", availableTabs, employeeOnlyMode);
  }
  if (path === "exceptions") {
    return pickVisibleRoute("exceptions", availableTabs, employeeOnlyMode);
  }
  if (path === "executive") {
    return pickVisibleRoute("executive", availableTabs, employeeOnlyMode);
  }
  if (path === "operations" || path === "operations/overview") {
    return pickVisibleRoute("operations", availableTabs, employeeOnlyMode);
  }
  if (path === "operations/watch" || path === "operations/urgent-watch" || path === "operations/exceptions" || path === "watch") {
    return pickVisibleRoute("operations-exceptions", availableTabs, employeeOnlyMode);
  }
  if (path === "operations/today") {
    return pickVisibleRoute("operations-today", availableTabs, employeeOnlyMode);
  }
  if (path === "scheduling" || path === "operations/scheduling") {
    return pickVisibleRoute("operations-scheduling", availableTabs, employeeOnlyMode);
  }
  if (path === "operations/job-admin") {
    return pickVisibleRoute("operations-job-admin", availableTabs, employeeOnlyMode);
  }
  if (path === "operations/shoots/import") {
    return pickVisibleRoute("studios-shoots", availableTabs, employeeOnlyMode);
  }
  if (path === "operations/shoots" || path === "photography/shoots" || path === "studios/shoots" || path === "shoots") {
    return pickVisibleRoute("studios-shoots", availableTabs, employeeOnlyMode);
  }
  if (/^photography\/shoots\/[^/]+$/i.test(path)) {
    return pickVisibleRoute("job-detail", availableTabs, employeeOnlyMode);
  }
  if (path === "schedule/jobs") {
    return pickVisibleRoute("operations-schedule", availableTabs, employeeOnlyMode);
  }
  if (path === "schedule/staffing" || path === "schedule/assignment-board") {
    return pickVisibleRoute("operations-staffing", availableTabs, employeeOnlyMode);
  }
  if (path === "operations/schedule" || path === "schedule" || path === "calendar") {
    return resolveScheduleAlias(params, availableTabs, employeeOnlyMode);
  }
  if (path === "operations/staffing") {
    return pickVisibleRoute("operations-staffing", availableTabs, employeeOnlyMode);
  }
  if (path === "photography") {
    return pickVisibleRoute("studios", availableTabs, employeeOnlyMode);
  }
  if (path === "photography/pre-service") {
    return pickVisibleRoute("studios-pre-service", availableTabs, employeeOnlyMode);
  }
  if (path === "photography/staffing") {
    return pickVisibleRoute("studios-staffing", availableTabs, employeeOnlyMode);
  }
  if (path === "photography/calendar") {
    return pickVisibleRoute("studios-calendar", availableTabs, employeeOnlyMode);
  }
  if (path === "photography/travel") {
    return pickVisibleRoute("studios-travel", availableTabs, employeeOnlyMode);
  }
  if (path === "photography/readiness") {
    return pickVisibleRoute("studios-readiness", availableTabs, employeeOnlyMode);
  }
  if (path === "photography/workload") {
    return pickVisibleRoute("studios-workload", availableTabs, employeeOnlyMode);
  }
  if (path === "operations/attendance" || path === "employees/attendance" || path === "attendance" || path === "time") {
    return pickVisibleRoute("operations-attendance", availableTabs, employeeOnlyMode);
  }
  if (path === "operations/status-board" || path === "status-board") {
    return pickVisibleRoute("operations-status-board", availableTabs, employeeOnlyMode);
  }
  if (path === "status-board-display") {
    return pickVisibleRoute("status-board-display", availableTabs, employeeOnlyMode);
  }
  if (path === "operations/travel") {
    return pickVisibleRoute("operations-travel", availableTabs, employeeOnlyMode);
  }
  if (path === "employees/exceptions") {
    return pickVisibleRoute("people-exceptions", availableTabs, employeeOnlyMode);
  }
  if (path === "studios") {
    return pickVisibleRoute("studios", availableTabs, employeeOnlyMode);
  }
  if (path === "studios/pre-service") {
    return pickVisibleRoute("studios-pre-service", availableTabs, employeeOnlyMode);
  }
  if (path === "studios/staffing") {
    return pickVisibleRoute("studios-staffing", availableTabs, employeeOnlyMode);
  }
  if (path === "studios/calendar") {
    return pickVisibleRoute("studios-calendar", availableTabs, employeeOnlyMode);
  }
  if (path === "studios/travel") {
    return pickVisibleRoute("studios-travel", availableTabs, employeeOnlyMode);
  }
  if (path === "studios/readiness") {
    return pickVisibleRoute("studios-readiness", availableTabs, employeeOnlyMode);
  }
  if (path === "studios/workload") {
    return pickVisibleRoute("studios-workload", availableTabs, employeeOnlyMode);
  }
  if (path === "operations/readiness") {
    return pickVisibleRoute("studios-readiness", availableTabs, employeeOnlyMode);
  }
  if (path === "project-tracking" || path === "project-tracking/command-center" || /^project-tracking\/workflows\/[^/]+$/i.test(path)) {
    return pickVisibleRoute("project-tracking", availableTabs, employeeOnlyMode);
  }
  if (path === "prep-readiness" || path === "project-tracking/prep-readiness") {
    return pickVisibleRoute("prep-readiness-queue", availableTabs, employeeOnlyMode);
  }
  if (path === "project-tracking/workflow-templates" || path === "project-tracking/templates" || path === "workflow-templates") {
    return pickVisibleRoute("workflow-template-builder", availableTabs, employeeOnlyMode);
  }
  if (path === "client-command-center" || /^client-command-center\/accounts\/[^/]+$/i.test(path)) {
    return pickVisibleRoute("client-command-center", availableTabs, employeeOnlyMode);
  }
  if (path === "job-closeout" || /^job-closeout\/jobs\/[^/]+$/i.test(path)) {
    return pickVisibleRoute("job-closeout-v1", availableTabs, employeeOnlyMode);
  }
  if (path === "jobs") {
    return pickVisibleRoute("jobs", availableTabs, employeeOnlyMode);
  }
  if (path === "jobs/new") {
    return pickVisibleRoute("job-new", availableTabs, employeeOnlyMode);
  }
  if (path === "tasks/new") {
    return pickVisibleRoute("task-new", availableTabs, employeeOnlyMode);
  }
  if (/^jobs\/[^/]+\/edit$/i.test(path)) {
    return pickVisibleRoute("job-edit", availableTabs, employeeOnlyMode);
  }
  if (/^jobs\/[^/]+$/i.test(path)) {
    return pickVisibleRoute("job-detail", availableTabs, employeeOnlyMode);
  }
  if (/^tasks\/[^/]+$/i.test(path)) {
    return pickVisibleRoute("task-detail", availableTabs, employeeOnlyMode);
  }
  if (path === "schools/import" || path === "operations/schools/import") {
    return pickVisibleRoute("operations-schools-import", availableTabs, employeeOnlyMode);
  }
  if (path === "schools/jobs") {
    return pickVisibleRoute("schools-jobs", availableTabs, employeeOnlyMode);
  }
  if (path === "schools/tasks" || path === "schools/workload") {
    return pickVisibleRoute("schools-tasks", availableTabs, employeeOnlyMode);
  }
  if (path === "schools/calendar") {
    return pickVisibleRoute("operations-schedule", availableTabs, employeeOnlyMode);
  }
  if (path === "schools/accounts") {
    return pickVisibleRoute("directory-accounts", availableTabs, employeeOnlyMode);
  }
  if (path === "schools/production") {
    return pickVisibleRoute("schools-tasks", availableTabs, employeeOnlyMode);
  }
  if (path === "schools/watchlist") {
    return pickVisibleRoute("schools-exceptions", availableTabs, employeeOnlyMode);
  }
  if (path === "schools/exceptions") {
    return pickVisibleRoute("schools-exceptions", availableTabs, employeeOnlyMode);
  }
  if (path === "schools/jobs/new") {
    return pickVisibleRoute("schools-job-new", availableTabs, employeeOnlyMode);
  }
  if (/^schools\/jobs\/[^/]+\/edit$/i.test(path)) {
    return pickVisibleRoute("schools-job-edit", availableTabs, employeeOnlyMode);
  }
  if (/^schools\/jobs\/[^/]+$/i.test(path)) {
    return pickVisibleRoute("schools-job-detail", availableTabs, employeeOnlyMode);
  }
  if (path === "operations/schools" || path === "schools") {
    return pickVisibleRoute("operations-schools", availableTabs, employeeOnlyMode);
  }
  if (path === "sports" || path === "sports/overview") {
    return pickVisibleRoute("sports", availableTabs, employeeOnlyMode);
  }
  if (path === "sports/jobs") {
    return pickVisibleRoute("sports-shoots", availableTabs, employeeOnlyMode);
  }
  if (path === "sports/jobs/new") {
    return pickVisibleRoute("sports-shoot-new", availableTabs, employeeOnlyMode);
  }
  if (/^sports\/jobs\/[^/]+\/edit$/i.test(path)) {
    return pickVisibleRoute("sports-shoot-edit", availableTabs, employeeOnlyMode);
  }
  if (/^sports\/jobs\/[^/]+$/i.test(path)) {
    return pickVisibleRoute("sports-shoot-detail", availableTabs, employeeOnlyMode);
  }
  if (path === "sports/jobs/import") {
    return pickVisibleRoute("sports-shoots-import", availableTabs, employeeOnlyMode);
  }
  if (path === "sports/shoots/import") {
    return pickVisibleRoute("sports-shoots-import", availableTabs, employeeOnlyMode);
  }
  if (path === "sports/shoots") {
    return pickVisibleRoute("sports-shoots", availableTabs, employeeOnlyMode);
  }
  if (path === "sports/shoots/new") {
    return pickVisibleRoute("sports-shoot-new", availableTabs, employeeOnlyMode);
  }
  if (/^sports\/shoots\/[^/]+\/edit$/i.test(path)) {
    return pickVisibleRoute("sports-shoot-edit", availableTabs, employeeOnlyMode);
  }
  if (path.startsWith("sports/shoots/")) {
    return pickVisibleRoute("sports-shoot-detail", availableTabs, employeeOnlyMode);
  }
  if (path === "sports/accounts") {
    return pickVisibleRoute("sports-accounts", availableTabs, employeeOnlyMode);
  }
  if (path === "sports/tasks" || path === "sports/workload") {
    return pickVisibleRoute("sports", availableTabs, employeeOnlyMode);
  }
  if (path === "sports/calendar") {
    return pickVisibleRoute("operations-schedule", availableTabs, employeeOnlyMode);
  }
  if (path === "sports/contacts") {
    return pickVisibleRoute("sports-contacts", availableTabs, employeeOnlyMode);
  }
  if (path === "sports/production") {
    return pickVisibleRoute("sports-graphics", availableTabs, employeeOnlyMode);
  }
  if (path === "sports/graphics") {
    return pickVisibleRoute("sports-graphics", availableTabs, employeeOnlyMode);
  }
  if (path === "sports/peer-qa" || path === "sports/qa") {
    return pickVisibleRoute("sports-peer-qa", availableTabs, employeeOnlyMode);
  }
  if (path === "sports/watchlist") {
    return pickVisibleRoute("sports-exceptions", availableTabs, employeeOnlyMode);
  }
  if (path === "sports/exceptions") {
    return pickVisibleRoute("sports-exceptions", availableTabs, employeeOnlyMode);
  }
  if (path === "sports/reports") {
    return pickVisibleRoute("sports-reports", availableTabs, employeeOnlyMode);
  }
  if (path === "sports/settings") {
    return pickVisibleRoute("sports-settings", availableTabs, employeeOnlyMode);
  }
  if (path === "operations/assets") {
    return pickVisibleRoute("assets", availableTabs, employeeOnlyMode);
  }
  if (path === "operations/assets/gear") {
    return pickVisibleRoute("assets-gear", availableTabs, employeeOnlyMode);
  }
  if (path === "operations/assets/kits") {
    return pickVisibleRoute("assets-kits", availableTabs, employeeOnlyMode);
  }
  if (path === "operations/assets/custody") {
    return pickVisibleRoute("assets-custody", availableTabs, employeeOnlyMode);
  }
  if (path === "operations/assets/repairs") {
    return pickVisibleRoute("assets-repairs", availableTabs, employeeOnlyMode);
  }
  if (path === "operations/assets/maintenance") {
    return pickVisibleRoute("assets-maintenance", availableTabs, employeeOnlyMode);
  }
  if (path === "operations/assets/history") {
    return pickVisibleRoute("assets-history", availableTabs, employeeOnlyMode);
  }
  if (path === "production/assets") {
    return pickVisibleRoute("files", availableTabs, employeeOnlyMode);
  }
  if (path === "files" || path === "graphics/files") {
    return pickVisibleRoute("files", availableTabs, employeeOnlyMode);
  }
  if (path === "production-queue" || path === "production/workflow-queue" || path === "production/handoffs") {
    return pickVisibleRoute("production-workflow-queue", availableTabs, employeeOnlyMode);
  }
  if (path === "production" || path === "projects") {
    // Hash-based `#projects` is a Graphics compatibility route inside the admin shell.
    // It is intentionally separate from the external `/projects/{portal_project_key}` portal.
    return resolveGraphicsAlias(params, availableTabs, employeeOnlyMode);
  }
  if (path === "graphics") {
    return resolveGraphicsAlias(params, availableTabs, employeeOnlyMode);
  }
  if (path === "production/job-queue" || path === "production/queue") {
    return pickVisibleRoute("graphics-queue", availableTabs, employeeOnlyMode);
  }
  if (path === "graphics/queue") {
    return pickVisibleRoute("graphics-queue", availableTabs, employeeOnlyMode);
  }
  if (path === "production/jobs") {
    return pickVisibleRoute("graphics", availableTabs, employeeOnlyMode);
  }
  if (/^production\/jobs\/[^/]+$/i.test(path)) {
    return pickVisibleRoute("job-detail", availableTabs, employeeOnlyMode);
  }
  if (path === "production/tasks") {
    return pickVisibleRoute("graphics-workload", availableTabs, employeeOnlyMode);
  }
  if (path === "graphics/tasks" || path === "graphics/workload") {
    return pickVisibleRoute("graphics-workload", availableTabs, employeeOnlyMode);
  }
  if (path === "production/calendar") {
    return pickVisibleRoute("operations-schedule", availableTabs, employeeOnlyMode);
  }
  if (path === "production/digital") {
    return resolveGraphicsAlias(params, availableTabs, employeeOnlyMode);
  }
  if (path === "production/qa") {
    return pickVisibleRoute("graphics-qa", availableTabs, employeeOnlyMode);
  }
  if (path === "graphics/qa") {
    return pickVisibleRoute("graphics-qa", availableTabs, employeeOnlyMode);
  }
  if (path === "production/release") {
    return pickVisibleRoute("graphics-release", availableTabs, employeeOnlyMode);
  }
  if (path === "graphics/release") {
    return pickVisibleRoute("graphics-release", availableTabs, employeeOnlyMode);
  }
  if (path === "production/post-shoot-review" || path === "production/review") {
    return pickVisibleRoute("people-ops-compliance", availableTabs, employeeOnlyMode);
  }
  if (path === "production/workload") {
    return pickVisibleRoute("graphics-workload", availableTabs, employeeOnlyMode);
  }
  if (path === "directory") {
    return pickVisibleRoute("directory", availableTabs, employeeOnlyMode);
  }
  if (path === "directory/contacts" || path === "contacts") {
    return params.get("audience") === "company"
      ? pickVisibleRoute("directory-internal", availableTabs, employeeOnlyMode)
      : pickVisibleRoute("directory-contacts", availableTabs, employeeOnlyMode);
  }
  if (path === "directory/internal") {
    return pickVisibleRoute("directory-internal", availableTabs, employeeOnlyMode);
  }
  if (path === "directory/locations" || path === "locations") {
    return pickVisibleRoute("directory-locations", availableTabs, employeeOnlyMode);
  }
  if (path === "directory/accounts" || path === "directory/organizations" || path === "organizations") {
    return resolveDirectoryAlias(params, availableTabs, employeeOnlyMode);
  }
  if (path === "accounts") {
    return pickVisibleRoute("directory-accounts", availableTabs, employeeOnlyMode);
  }
  if (path === "gear") {
    return pickVisibleRoute("assets-gear", availableTabs, employeeOnlyMode);
  }
  if (path === "assets") {
    return pickVisibleRoute("assets", availableTabs, employeeOnlyMode);
  }
  if (path.startsWith("assets/")) {
    return resolveSimpleChildPath(path, "operations", availableTabs, employeeOnlyMode);
  }
  if (path === "employees" || path === "people-ops") {
    return pickVisibleRoute("people-ops", availableTabs, employeeOnlyMode);
  }
  if (path === "people") {
    return pickVisibleRoute("people-ops", availableTabs, employeeOnlyMode);
  }
  if (path === "approvals") {
    return pickVisibleRoute("people-ops-approvals", availableTabs, employeeOnlyMode);
  }
  if (path === "employees/approvals" || path === "people-ops/approvals") {
    return pickVisibleRoute("people-ops-approvals", availableTabs, employeeOnlyMode);
  }
  if (path === "employees/requests") {
    return pickVisibleRoute("people-ops-requests", availableTabs, employeeOnlyMode);
  }
  if (path === "employees/pto") {
    return pickVisibleRoute("people-ops-pto", availableTabs, employeeOnlyMode);
  }
  if (path === "employees/availability") {
    return pickVisibleRoute("people-ops-availability", availableTabs, employeeOnlyMode);
  }
  if (path === "employees/training") {
    return pickVisibleRoute("people-ops-training", availableTabs, employeeOnlyMode);
  }
  if (path === "employees/directory") {
    return pickVisibleRoute("directory-internal", availableTabs, employeeOnlyMode);
  }
  if (path === "employees/certifications") {
    return pickVisibleRoute("people-ops-certifications", availableTabs, employeeOnlyMode);
  }
  if (path === "employees/performance") {
    return pickVisibleRoute("people-ops-performance", availableTabs, employeeOnlyMode);
  }
  if (path === "employees/readiness") {
    return pickVisibleRoute("people-ops-readiness", availableTabs, employeeOnlyMode);
  }
  if (path === "employees/payroll") {
    return pickVisibleRoute("people-ops-payroll", availableTabs, employeeOnlyMode);
  }
  if (path === "training") {
    return pickVisibleRoute("people-ops-training", availableTabs, employeeOnlyMode);
  }
  if (path === "payroll") {
    return pickVisibleRoute("people-ops-payroll", availableTabs, employeeOnlyMode);
  }
  if (path.startsWith("people-ops/")) {
    return resolveSimpleChildPath(path, "employees", availableTabs, employeeOnlyMode);
  }
  if (path === "directory/pipeline") {
    return pickVisibleRoute("growth", availableTabs, employeeOnlyMode);
  }
  if (path === "growth" || path === "sales") {
    return pickVisibleRoute(path === "sales" ? "growth-pipeline" : "growth", availableTabs, employeeOnlyMode);
  }
  if (path.startsWith("growth/")) {
    return resolveSimpleChildPath(path, "directory", availableTabs, employeeOnlyMode);
  }
  if (path === "business-health") {
    return pickVisibleRoute("business-health", availableTabs, employeeOnlyMode);
  }
  if (
    path === "business-health/reports" ||
    path === "reports" ||
    path === "reports/overview" ||
    path === "reports/departments" ||
    path === "reports/employees" ||
    path === "reports/production" ||
    path === "reports/custom"
  ) {
    return pickVisibleRoute("business-health-reports", availableTabs, employeeOnlyMode);
  }
  if (path === "reports/kpis") {
    return pickVisibleRoute("business-health-kpis", availableTabs, employeeOnlyMode);
  }
  if (path === "reports/labor") {
    return pickVisibleRoute("business-health-labor", availableTabs, employeeOnlyMode);
  }
  if (path === "reports/finance") {
    return pickVisibleRoute("business-health-profitability", availableTabs, employeeOnlyMode);
  }
  if (path === "reports/customer-service") {
    return pickVisibleRoute("business-health-customer-service", availableTabs, employeeOnlyMode);
  }
  if (path === "reports/trends") {
    return pickVisibleRoute("business-health-trends", availableTabs, employeeOnlyMode);
  }
  if (path === "reports/operations") {
    return pickVisibleRoute("business-health-operations", availableTabs, employeeOnlyMode);
  }
  if (path === "reports/executive") {
    return pickVisibleRoute("business-health-executive-summary", availableTabs, employeeOnlyMode);
  }
  if (path.startsWith("business-health/")) {
    return resolveSimpleChildPath(path, "reports", availableTabs, employeeOnlyMode);
  }
  if (path === "profitability") {
    return pickVisibleRoute("business-health-profitability", availableTabs, employeeOnlyMode);
  }
  if (path === "labor") {
    return pickVisibleRoute("business-health-labor", availableTabs, employeeOnlyMode);
  }
  if (path === "customer-service" || path === "support") {
    return pickVisibleRoute("business-health-customer-service", availableTabs, employeeOnlyMode);
  }
  if (path === "admin") {
    return pickVisibleRoute("admin", availableTabs, employeeOnlyMode);
  }
  if (path === "settings/access") {
    return pickVisibleRoute("admin-roles", availableTabs, employeeOnlyMode);
  }
  if (path === "admin/checklists") {
    return pickVisibleRoute("admin-checklists", availableTabs, employeeOnlyMode);
  }
  if (path === "admin/templates") {
    return pickVisibleRoute("admin-checklists", availableTabs, employeeOnlyMode);
  }
  if (path === "admin/system") {
    return pickVisibleRoute("admin-system", availableTabs, employeeOnlyMode);
  }
  if (path === "admin/system/diagnostics") {
    return pickVisibleRoute("admin-system-diagnostics", availableTabs, employeeOnlyMode);
  }
  if (path === "admin/system/foundation") {
    return pickVisibleRoute("admin-system-foundation", availableTabs, employeeOnlyMode);
  }
  if (path === "admin/system/communications") {
    return pickVisibleRoute("admin-system-communications", availableTabs, employeeOnlyMode);
  }
  if (path === "admin/system/audit") {
    return pickVisibleRoute("admin-system-audit-log", availableTabs, employeeOnlyMode);
  }
  if (path === "admin/system/sync") {
    return pickVisibleRoute("admin-system-sync", availableTabs, employeeOnlyMode);
  }
  if (path === "admin/system/repairs") {
    return pickVisibleRoute("admin-system-repairs", availableTabs, employeeOnlyMode);
  }
  if (path === "admin/system/access-debug") {
    return pickVisibleRoute("admin-system-access-debug", availableTabs, employeeOnlyMode);
  }
  if (path === "admin/system/imports") {
    return pickVisibleRoute("admin-system-imports", availableTabs, employeeOnlyMode);
  }
  if (path === "admin/system/exports") {
    return pickVisibleRoute("admin-system-exports", availableTabs, employeeOnlyMode);
  }
  if (/^admin\/trace\/[^/]+\/[^/]+$/i.test(path)) {
    return pickVisibleRoute("admin-system-trace", availableTabs, employeeOnlyMode);
  }
  if (path.startsWith("admin/")) {
    return resolveSimpleChildPath(path, "admin", availableTabs, employeeOnlyMode);
  }
  if (path === "outlook") {
    return pickVisibleRoute("admin-integrations", availableTabs, employeeOnlyMode);
  }
  if (path === "access") {
    return pickVisibleRoute("admin-roles", availableTabs, employeeOnlyMode);
  }
  if (path === "security") {
    return pickVisibleRoute("admin-audit", availableTabs, employeeOnlyMode);
  }
  if (path === "account") {
    return pickVisibleRoute("account", availableTabs, employeeOnlyMode);
  }
  if (path === "employees/compliance" || path === "compliance") {
    return pickVisibleRoute("people-ops-compliance", availableTabs, employeeOnlyMode);
  }
  if (path === "review-desk") {
    return pickVisibleRoute("people-ops-compliance", availableTabs, employeeOnlyMode);
  }

  return getDefaultRouteId(availableTabs, employeeOnlyMode);
}

export function collectRouteTabs(route: RouteDefinition): TabKey[] {
  if (route.render.kind === "tab") {
    return [route.render.tab];
  }
  if (route.render.kind === "dashboard-root") {
    return ["dashboard", "my-work"];
  }
  if (route.render.kind === "directory") {
    return route.render.entryView === "organizations" ? ["organizations"] : ["contacts"];
  }
  if (route.render.kind === "schools-hub") {
    return [];
  }
  return route.visibleTabs ?? [];
}

export function getSectionDefinition(sectionKey: ShellSectionKey) {
  return SECTION_DEFINITIONS.find((section) => section.key === sectionKey);
}

export function getSectionChildrenForLanding(sectionKey: ShellSectionKey, availableTabs: TabKey[], employeeOnlyMode: boolean) {
  return getVisibleChildRoutes(sectionKey, availableTabs, employeeOnlyMode).map((route) => ({
    id: route.id,
    label: route.label,
    description: route.description,
    hash: route.canonicalHash
  }));
}

function isRouteVisible(route: RouteDefinition, availableTabs: TabKey[], employeeOnlyMode: boolean) {
  if (employeeOnlyMode && route.visibleForEmployeeOnly === false) {
    return false;
  }
  if (!employeeOnlyMode && route.visibleForFullShell === false) {
    return false;
  }
  if (!route.visibleTabs?.length) {
    return true;
  }
  return route.visibleTabs.some((tab) => availableTabs.includes(tab));
}

function pickVisibleRoute(routeId: ShellRouteId, availableTabs: TabKey[], employeeOnlyMode: boolean): ShellRouteId {
  const route = getRouteById(routeId);
  if (isRouteVisible(route, availableTabs, employeeOnlyMode)) {
    return routeId;
  }
  if (route.sectionKey) {
    const sibling = getVisibleChildRoutes(route.sectionKey, availableTabs, employeeOnlyMode)[0];
    if (sibling) {
      return sibling.id;
    }
    const sectionRoute = SECTION_DEFINITIONS.find((section) => section.key === route.sectionKey);
    if (sectionRoute) {
      const parent = getRouteById(sectionRoute.routeId);
      if (isRouteVisible(parent, availableTabs, employeeOnlyMode)) {
        return sectionRoute.routeId;
      }
    }
  }
  return getDefaultRouteId(availableTabs, employeeOnlyMode);
}

function resolveScheduleAlias(params: URLSearchParams, availableTabs: TabKey[], employeeOnlyMode: boolean): ShellRouteId {
  const area = params.get("area");
  if (area === "staffing") {
    return pickVisibleRoute("operations-staffing", availableTabs, employeeOnlyMode);
  }
  if (area === "exceptions") {
    return pickVisibleRoute("operations-exceptions", availableTabs, employeeOnlyMode);
  }
  return pickVisibleRoute("operations-schedule", availableTabs, employeeOnlyMode);
}

function resolveGraphicsAlias(params: URLSearchParams, availableTabs: TabKey[], employeeOnlyMode: boolean): ShellRouteId {
  const stage = params.get("stage");
  const queue = params.get("queue");
  const ownerUserId = params.get("owner_user_id");
  const legacyQaStages = new Set(["needs_peer_review", "changes_requested", "qa_approved"]);
  const legacyReleaseStages = new Set(["ready_for_release", "released"]);
  if (
    stage === "ready_for_qa" ||
    stage === "in_qa_review" ||
    stage === "correction_needed" ||
    legacyQaStages.has(stage ?? "")
  ) {
    return pickVisibleRoute("graphics-qa", availableTabs, employeeOnlyMode);
  }
  if (stage === "ready_to_release" || stage === "released_complete" || legacyReleaseStages.has(stage ?? "")) {
    return pickVisibleRoute("graphics-release", availableTabs, employeeOnlyMode);
  }
  if (stage === "intake_pending" || stage === "ready_for_production") {
    return pickVisibleRoute("graphics-queue", availableTabs, employeeOnlyMode);
  }
  if (ownerUserId && !params.get("project")) {
    return pickVisibleRoute("graphics-workload", availableTabs, employeeOnlyMode);
  }
  if (queue === "blocked_queue" || queue === "qa_queue") {
    return pickVisibleRoute("graphics-qa", availableTabs, employeeOnlyMode);
  }
  if (queue === "ready_to_release_queue") {
    return pickVisibleRoute("graphics-release", availableTabs, employeeOnlyMode);
  }
  if (queue === "needs_setup" || (queue === "team_queue" && !ownerUserId)) {
    return pickVisibleRoute("graphics-queue", availableTabs, employeeOnlyMode);
  }
  if (queue === "my_queue" || queue === "active" || queue === "completed_recently") {
    return pickVisibleRoute("graphics-workload", availableTabs, employeeOnlyMode);
  }
  return pickVisibleRoute("graphics", availableTabs, employeeOnlyMode);
}

function resolveDirectoryAlias(params: URLSearchParams, availableTabs: TabKey[], employeeOnlyMode: boolean): ShellRouteId {
  const view = params.get("view");
  if (view === "contacts") {
    return params.get("audience") === "company"
      ? pickVisibleRoute("directory-internal", availableTabs, employeeOnlyMode)
      : pickVisibleRoute("directory-contacts", availableTabs, employeeOnlyMode);
  }
  if (view === "locations") {
    return pickVisibleRoute("directory-locations", availableTabs, employeeOnlyMode);
  }
  return pickVisibleRoute("directory-accounts", availableTabs, employeeOnlyMode);
}

function resolveSimpleChildPath(path: string, sectionKey: ShellSectionKey, availableTabs: TabKey[], employeeOnlyMode: boolean): ShellRouteId {
  const route = ROUTES.find((entry) => entry.sectionKey === sectionKey && entry.canonicalHash.replace(/^#/, "").split("?")[0] === path);
  if (!route) {
    return getDefaultRouteId(availableTabs, employeeOnlyMode);
  }
  return pickVisibleRoute(route.id, availableTabs, employeeOnlyMode);
}
