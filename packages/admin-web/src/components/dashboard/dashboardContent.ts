import type { BusinessRole } from "../../permissions";
import type { DashboardWidgetId, DashboardWidgetSize } from "./dashboardConfig";

export type DashboardWidgetActionSpec = {
  label: string;
  hash?: string;
};

export type DashboardWidgetStateSpec = {
  message: string;
  detail?: string;
  action?: DashboardWidgetActionSpec;
  secondaryAction?: DashboardWidgetActionSpec;
};

export type DashboardWidgetLoadingVariant = "hero" | "list" | "summary" | "actions";

export type DashboardWidgetLoadingSpec = {
  variant: DashboardWidgetLoadingVariant;
  message: string;
  rowCount: number;
};

export type DashboardWidgetContentSpec = {
  widgetId: DashboardWidgetId;
  inventoryIds: string[];
  title: string;
  subtitle?: string;
  purpose: string;
  primaryAudience: BusinessRole[];
  defaultSize: DashboardWidgetSize;
  aboveTheFoldEligible: boolean;
  primaryDataInputs: string[];
  contentStructure: string[];
  primaryCta?: DashboardWidgetActionSpec;
  secondaryCta?: DashboardWidgetActionSpec;
  emptyState: DashboardWidgetStateSpec;
  loadingState: DashboardWidgetLoadingSpec;
  errorState: DashboardWidgetStateSpec & {
    action: DashboardWidgetActionSpec;
  };
  mobileVariant: string;
  conditionalVisibility?: string;
  implementationNote?: string;
  roleOverrides?: Partial<Record<BusinessRole, DashboardWidgetContentSpecOverride>>;
};

export type DashboardWidgetContentSpecOverride = Partial<
  Omit<DashboardWidgetContentSpec, "widgetId" | "inventoryIds" | "roleOverrides">
>;

export const DASHBOARD_WIDGET_CONTENT_SPECS: Record<DashboardWidgetId, DashboardWidgetContentSpec> = {
  "employee-day": {
    widgetId: "employee-day",
    inventoryIds: ["my_day", "todays_shoots", "team_assignments"],
    title: "My Day",
    subtitle: "Plain-English context for what today looks like.",
    purpose: "Give the user a fast read on today's work, what is next, and what needs attention first.",
    primaryAudience: ["employee", "photographer", "shoot_lead"],
    defaultSize: "hero",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["employee.my_work.summary", "employee.my_work.shifts"],
    contentStructure: [
      "Primary line: one sentence summarizing today's workload and first call time or next due work.",
      "Secondary rows: next item, after that, and one risk note when the day is not clean."
    ],
    primaryCta: { label: "Open My Schedule", hash: "#dashboard/my-schedule" },
    secondaryCta: { label: "View My Tasks", hash: "#dashboard/my-tasks" },
    emptyState: {
      message: "Nothing scheduled today.",
      detail: "Check your tasks, requests, or upcoming assignments.",
      action: { label: "Open My Schedule", hash: "#dashboard/my-schedule" }
    },
    loadingState: { variant: "hero", message: "Loading your day...", rowCount: 3 },
    errorState: {
      message: "We couldn't load your day right now.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Schedule", hash: "#dashboard/my-schedule" }
    },
    mobileVariant: "Keep the title, primary line, next item, and the main CTA. Drop the third row first.",
    conditionalVisibility: "Always visible for employee-facing roles. Risk copy only appears when something needs action.",
    roleOverrides: {
      photographer: {
        title: "Today's Shoots",
        subtitle: "Your next shoot, call time, and location.",
        purpose: "Give photographers a fast read on today's assigned shoots, what is next, and what changed.",
        primaryCta: { label: "Open Today's Shoots", hash: "#operations/shoots" },
        secondaryCta: { label: "Open Next Shoot", hash: "#dashboard/my-day" },
        emptyState: {
          message: "No shoots assigned today.",
          detail: "Check your schedule for upcoming field work.",
          action: { label: "Open Schedule", hash: "#dashboard/my-schedule" }
        },
        loadingState: { variant: "hero", message: "Loading today's shoots...", rowCount: 3 },
        errorState: {
          message: "We couldn't load today's shoots.",
          action: { label: "Retry" },
          secondaryAction: { label: "Open Schedule", hash: "#dashboard/my-schedule" }
        },
        mobileVariant: "Keep the next shoot, call time, location, and the main CTA."
      },
      shoot_lead: {
        title: "Today's Shoots & Team Assignments",
        subtitle: "Your field day, team coverage, and the next issue that can break execution.",
        purpose: "Give leads a combined read on today's shoots, the team assigned to them, and the next risk to resolve.",
        primaryCta: { label: "View Full Team", hash: "#operations/staffing" },
        secondaryCta: { label: "Open Today's Shoots", hash: "#operations/shoots" },
        emptyState: {
          message: "No field assignments are linked right now.",
          detail: "Open staffing to review today's team coverage.",
          action: { label: "Open Staffing", hash: "#operations/staffing" }
        },
        loadingState: { variant: "hero", message: "Loading field assignments...", rowCount: 3 },
        errorState: {
          message: "We couldn't load today's team assignments.",
          action: { label: "Retry" },
          secondaryAction: { label: "Open Staffing", hash: "#operations/staffing" }
        },
        mobileVariant: "Keep the next shoot, top risk, and the main staffing CTA."
      }
    }
  },
  "employee-schedule": {
    widgetId: "employee-schedule",
    inventoryIds: ["todays_schedule"],
    title: "Today's Schedule",
    subtitle: "Time-based commitments in a compact list.",
    purpose: "Show today's schedule in time order so the next commitment is obvious.",
    primaryAudience: ["employee", "photographer", "shoot_lead"],
    defaultSize: "large",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["employee.my_work.shifts"],
    contentStructure: [
      "Primary line: the next scheduled item with time.",
      "Secondary rows: up to three schedule rows with time, label, and location or status."
    ],
    primaryCta: { label: "Open Full Schedule", hash: "#dashboard/my-schedule" },
    emptyState: {
      message: "No schedule items for today.",
      detail: "You can still check future assignments and published timing.",
      action: { label: "Open Schedule", hash: "#dashboard/my-schedule" }
    },
    loadingState: { variant: "list", message: "Loading today's schedule...", rowCount: 3 },
    errorState: {
      message: "We couldn't load today's schedule.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Schedule", hash: "#dashboard/my-schedule" }
    },
    mobileVariant: "Show the next item and one or two rows after it.",
    conditionalVisibility: "Visible when employee schedule access is allowed."
  },
  "employee-alerts": {
    widgetId: "employee-alerts",
    inventoryIds: ["my_alerts", "company_alerts"],
    title: "My Alerts",
    subtitle: "Actionable alerts only.",
    purpose: "Surface the few alerts that need direct action from the user right now.",
    primaryAudience: ["employee", "photographer", "shoot_lead"],
    defaultSize: "medium",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["employee.my_work.notifications", "employee.my_work.shifts"],
    contentStructure: [
      "Primary line: count of items needing attention when the queue is not empty.",
      "Secondary rows: up to three alerts with severity and a short action phrase."
    ],
    primaryCta: { label: "Review Alerts", hash: "#dashboard/alerts" },
    emptyState: {
      message: "You're all caught up.",
      detail: "No alerts need action right now."
    },
    loadingState: { variant: "list", message: "Loading your alerts...", rowCount: 3 },
    errorState: {
      message: "We couldn't load your alerts.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Alerts", hash: "#dashboard/alerts" }
    },
    mobileVariant: "Keep the count line and the top two alerts.",
    conditionalVisibility: "Hidden when the alert queue is empty unless the card is still loading or failed."
  },
  "employee-follow-through": {
    widgetId: "employee-follow-through",
    inventoryIds: ["my_tasks", "my_requests"],
    title: "My Tasks & Requests",
    subtitle: "Follow-through that still needs action.",
    purpose: "Combine task, request, mileage, and closeout pressure into one clear follow-through card until the feeds split cleanly.",
    primaryAudience: ["employee", "photographer", "shoot_lead"],
    defaultSize: "medium",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["employee.my_work.summary"],
    contentStructure: [
      "Primary line: total items due with overdue wording when pressure exists.",
      "Secondary rows: trade requests, mileage review, and closeout due."
    ],
    primaryCta: { label: "Open My Tasks", hash: "#dashboard/my-tasks" },
    secondaryCta: { label: "View My Requests", hash: "#employees/requests" },
    emptyState: {
      message: "No tasks or requests need attention right now.",
      detail: "Check upcoming items if you want a fuller view."
    },
    loadingState: { variant: "summary", message: "Loading follow-through...", rowCount: 3 },
    errorState: {
      message: "We couldn't load your tasks and requests.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Employees", hash: "#employees/requests" }
    },
    mobileVariant: "Show the total due line and the top two rows first.",
    implementationNote: "This card intentionally merges My Tasks and My Requests until a dedicated task feed exists."
  },
  "employee-gear": {
    widgetId: "employee-gear",
    inventoryIds: ["assigned_gear"],
    title: "Assigned Gear",
    subtitle: "Custody context tied to your day.",
    purpose: "Keep assigned gear visible without stealing top-row space from schedule and alerts.",
    primaryAudience: ["photographer", "shoot_lead"],
    defaultSize: "small",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["assets.custody"],
    contentStructure: [
      "Primary line: assigned gear status.",
      "Secondary rows: key kit or custody notes when the feed is available."
    ],
    primaryCta: { label: "Open Assets", hash: "#assets/gear" },
    emptyState: {
      message: "No assigned gear is linked right now.",
      detail: "Your asset view will fill in once custody data is wired to assignments."
    },
    loadingState: { variant: "summary", message: "Loading assigned gear...", rowCount: 2 },
    errorState: {
      message: "We couldn't load assigned gear.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Assets", hash: "#assets/gear" }
    },
    mobileVariant: "Keep this compact and collapsed by default on narrow screens.",
    implementationNote: "Still largely an empty-state scaffold until assignment-linked custody is available."
  },
  "field-readiness": {
    widgetId: "field-readiness",
    inventoryIds: ["shoot_readiness", "pre_service_notes"],
    title: "Shoot Readiness",
    subtitle: "A fast check on whether today's work is actually ready to run.",
    purpose: "Tell field users whether the next shoot is ready and which readiness areas need attention.",
    primaryAudience: ["photographer", "shoot_lead"],
    defaultSize: "large",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["employee.my_work.shifts"],
    contentStructure: [
      "Primary line: Ready, Needs attention, or Missing critical info.",
      "Secondary rows: notes, location, follow-through, and closeout status with short status chips."
    ],
    primaryCta: { label: "Review Readiness", hash: "#operations/readiness" },
    emptyState: {
      message: "No readiness issues are open right now.",
      detail: "Open today's shoots if you want the full field checklist."
    },
    loadingState: { variant: "summary", message: "Loading readiness...", rowCount: 4 },
    errorState: {
      message: "We couldn't load readiness details.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Today's Shoots", hash: "#operations/shoots" }
    },
    mobileVariant: "Show the top readiness status and two key rows.",
    implementationNote: "Roster and equipment rows still depend on broader field-readiness data not yet exposed here."
  },
  "field-travel": {
    widgetId: "field-travel",
    inventoryIds: ["travel_location"],
    title: "Travel & Location",
    subtitle: "Exact next-location context for the field day.",
    purpose: "Give photographers and leads the next location, arrival time, and one travel note without opening the full shoot detail.",
    primaryAudience: ["photographer", "shoot_lead"],
    defaultSize: "large",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["employee.my_work.shifts"],
    contentStructure: [
      "Primary line: next location name.",
      "Secondary rows: address, call time, and one travel note or risk line."
    ],
    primaryCta: { label: "Open Location Details", hash: "#directory/locations" },
    secondaryCta: { label: "Open Next Shoot", hash: "#dashboard/my-day" },
    emptyState: {
      message: "No location details are needed right now.",
      detail: "Check your schedule if you need the next assignment."
    },
    loadingState: { variant: "summary", message: "Loading travel details...", rowCount: 3 },
    errorState: {
      message: "We couldn't load travel details.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Schedule", hash: "#dashboard/my-schedule" }
    },
    mobileVariant: "Keep the location, call time, and one travel note.",
    conditionalVisibility: "Show the secondary directions action only when a navigation URL exists."
  },
  "field-exceptions": {
    widgetId: "field-exceptions",
    inventoryIds: ["field_exceptions", "review_desk_summary"],
    title: "Field Exceptions",
    subtitle: "Same-day issues that can break execution.",
    purpose: "Give shoot leads a direct lane into review and exception work tied to the field day.",
    primaryAudience: ["shoot_lead"],
    defaultSize: "full",
    aboveTheFoldEligible: false,
    primaryDataInputs: ["review_desk"],
    contentStructure: [
      "Primary line: exception pressure for the day.",
      "Secondary rows: exception queue items owned by the existing review workflow surface."
    ],
    primaryCta: { label: "Open Compliance", hash: "#employees/compliance" },
    emptyState: {
      message: "No field exceptions need review right now."
    },
    loadingState: { variant: "list", message: "Loading field exceptions...", rowCount: 3 },
    errorState: {
      message: "We couldn't load field exceptions.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Compliance", hash: "#employees/compliance" }
    },
    mobileVariant: "Keep the surface collapsed behind the lower queue section for narrow screens.",
    implementationNote: "This widget reuses the shared workflow surface instead of creating a second field-exception model."
  },
  "production-queue": {
    widgetId: "production-queue",
    inventoryIds: ["my_queue", "priority_jobs_due_today", "workload_snapshot"],
    title: "My Queue",
    subtitle: "Assigned production work ordered by urgency.",
    purpose: "Show production staff the active jobs they own, what is due today, and which job should be opened next.",
    primaryAudience: ["production_staff"],
    defaultSize: "hero",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["production.board.summary", "production.board.items"],
    contentStructure: [
      "Primary line: active jobs count and due-today count.",
      "Secondary rows: up to three jobs with due indicator, stage, and next action."
    ],
    primaryCta: { label: "Open My Queue", hash: "#production/workload" },
    emptyState: {
      message: "No jobs are assigned right now.",
      detail: "Open Production if you need the broader board."
    },
    loadingState: { variant: "list", message: "Loading your queue...", rowCount: 4 },
    errorState: {
      message: "We couldn't load your queue.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Production", hash: "#production" }
    },
    mobileVariant: "Keep the primary line and top two jobs.",
    implementationNote: "Priority jobs due today are intentionally folded into the queue hero instead of a separate card."
  },
  "production-qa-release": {
    widgetId: "production-qa-release",
    inventoryIds: ["qa_blockers", "release_holds", "post_shoot_review_flags"],
    title: "QA Blockers & Release Holds",
    subtitle: "The jobs waiting on review, correction, or release.",
    purpose: "Keep production review pressure visible without requiring separate QA and release cards in phase 1.",
    primaryAudience: ["production_staff"],
    defaultSize: "large",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["production.board.summary", "production.board.items"],
    contentStructure: [
      "Primary line: count of jobs waiting on QA, release, or corrections.",
      "Secondary rows: up to three jobs with blocker reason or next step."
    ],
    primaryCta: { label: "Review QA Blockers", hash: "#production/qa" },
    secondaryCta: { label: "Open Release", hash: "#production/release" },
    emptyState: {
      message: "No QA blockers or release holds right now.",
      detail: "Open QA if you need the full review lane."
    },
    loadingState: { variant: "list", message: "Loading QA pressure...", rowCount: 4 },
    errorState: {
      message: "We couldn't load QA blockers.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open QA", hash: "#production/qa" }
    },
    mobileVariant: "Keep the count line and top two blocked jobs.",
    implementationNote: "Post-shoot review flags are merged into this card until the review feed is stronger."
  },
  "service-summary": {
    widgetId: "service-summary",
    inventoryIds: ["customer_service_metrics_snapshot"],
    title: "Service Queue & Priority Issues",
    subtitle: "Urgent support work and open queue pressure.",
    purpose: "Show customer service staff where support pain is building and what needs follow-through now.",
    primaryAudience: ["customer_service_staff"],
    defaultSize: "hero",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["customer_service.summary.kpis", "customer_service.summary.flags"],
    contentStructure: [
      "Primary line: open ticket count and the main queue pressure phrase.",
      "Secondary rows: unassigned tickets, oldest open age, and new volume."
    ],
    primaryCta: { label: "Open Priority Issues", hash: "#reports/customer-service" },
    emptyState: {
      message: "No priority issues are open right now.",
      detail: "Open service metrics if you want the full support picture."
    },
    loadingState: { variant: "summary", message: "Loading service queue...", rowCount: 3 },
    errorState: {
      message: "We couldn't load service issues.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Service Metrics", hash: "#reports/customer-service" }
    },
    mobileVariant: "Keep the open-ticket line and the two most urgent summary rows."
  },
  "service-metrics": {
    widgetId: "service-metrics",
    inventoryIds: ["customer_service_metrics_snapshot"],
    title: "Customer Service Metrics",
    subtitle: "A compact support-performance readout.",
    purpose: "Show the service performance numbers that matter without turning the dashboard into a report.",
    primaryAudience: ["customer_service_staff"],
    defaultSize: "medium",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["customer_service.summary.kpis", "customer_service.summary.comparisons"],
    contentStructure: [
      "Primary line: the top service status phrase or leading metric.",
      "Secondary rows: first reply time, resolution time, and backlog change."
    ],
    primaryCta: { label: "Open Customer Service Metrics", hash: "#reports/customer-service" },
    emptyState: {
      message: "No service metrics are available yet.",
      detail: "Open Reports for the broader reporting surface."
    },
    loadingState: { variant: "summary", message: "Loading service metrics...", rowCount: 3 },
    errorState: {
      message: "We couldn't load customer service metrics.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Reports", hash: "#reports/customer-service" }
    },
    mobileVariant: "Keep the primary metric line and top two secondary rows."
  },
  "sales-pipeline": {
    widgetId: "sales-pipeline",
    inventoryIds: ["pipeline_snapshot", "opportunities_needing_action"],
    title: "Opportunities Needing Action",
    subtitle: "The deals that need movement today.",
    purpose: "Give growth users a compact pipeline action card instead of a passive totals box.",
    primaryAudience: ["sales_growth_staff"],
    defaultSize: "hero",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["sales.pipeline.summary", "sales.pipeline.opportunities", "sales.pipeline.alerts"],
    contentStructure: [
      "Primary line: count of opportunities needing action and the top pressure note.",
      "Secondary rows: up to three opportunities with account, next step, and due indicator."
    ],
    primaryCta: { label: "Review Opportunities", hash: "#growth/pipeline" },
    emptyState: {
      message: "No opportunities need action right now.",
      detail: "Open Pipeline for the full commercial board."
    },
    loadingState: { variant: "list", message: "Loading pipeline action...", rowCount: 4 },
    errorState: {
      message: "We couldn't load pipeline data.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Pipeline", hash: "#growth/pipeline" }
    },
    mobileVariant: "Keep the primary line and top two opportunities.",
    implementationNote: "This hero intentionally merges Pipeline Snapshot and Opportunities Needing Action."
  },
  "sales-deadlines": {
    widgetId: "sales-deadlines",
    inventoryIds: ["renewals_at_risk", "proposal_deadlines", "contact_follow_ups"],
    title: "Renewals & Proposal Deadlines",
    subtitle: "Deadlines and follow-up pressure that could slip revenue work.",
    purpose: "Show the deadlines and follow-up alerts that growth users need to clear next.",
    primaryAudience: ["sales_growth_staff"],
    defaultSize: "large",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["sales.pipeline.alerts"],
    contentStructure: [
      "Primary line: count of renewals or proposals needing attention.",
      "Secondary rows: up to three alert rows with account, due date, and risk phrase."
    ],
    primaryCta: { label: "View Proposal Deadlines", hash: "#growth/proposals" },
    secondaryCta: { label: "Review Renewals", hash: "#growth/renewals" },
    emptyState: {
      message: "No renewals or proposal deadlines are at risk right now.",
      detail: "Open Growth if you need the full pipeline."
    },
    loadingState: { variant: "list", message: "Loading growth deadlines...", rowCount: 3 },
    errorState: {
      message: "We couldn't load proposal and renewal deadlines.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Growth", hash: "#growth" }
    },
    mobileVariant: "Keep the count line and the top two deadline rows."
  },
  "manager-workflow": {
    widgetId: "manager-workflow",
    inventoryIds: ["top_priorities_today", "attendance_issues", "staffing_risks", "operational_health"],
    title: "Team Priorities Today",
    subtitle: "What is slipping, who needs help, and where to intervene first.",
    purpose: "Give managers the live assignment-to-completion surface for team risk and operational follow-through.",
    primaryAudience: ["manager"],
    defaultSize: "large",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["operations.workflow"],
    contentStructure: [
      "Primary line: today-first team pressure.",
      "Secondary rows: staffing, attendance, approvals, and follow-through through the shared workflow surface."
    ],
    primaryCta: { label: "Open Team Schedule", hash: "#operations/schedule" },
    secondaryCta: { label: "Resolve Exception", hash: "#employees/compliance" },
    emptyState: {
      message: "No team issues need intervention right now."
    },
    loadingState: { variant: "list", message: "Loading team workflow...", rowCount: 4 },
    errorState: {
      message: "We couldn't load team workflow.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Operations", hash: "#operations" }
    },
    mobileVariant: "Keep this as the first expanded manager surface and demote secondary queues below it.",
    implementationNote: "This widget reuses the shared assignment-to-completion surface instead of a separate manager-only model."
  },
  "manager-cockpit": {
    widgetId: "manager-cockpit",
    inventoryIds: ["pending_approvals"],
    title: "Pending Approvals & Queue Health",
    subtitle: "Approvals, workload balance, and follow-through that need a manager decision.",
    purpose: "Keep approval pressure and queue health visible without forcing managers into separate summary tools.",
    primaryAudience: ["manager"],
    defaultSize: "large",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["manager.cockpit"],
    contentStructure: [
      "Primary line: approvals or queue pressure needing action.",
      "Secondary rows: managed approval and workload sections from the cockpit surface."
    ],
    primaryCta: { label: "Review Approvals", hash: "#approvals" },
    secondaryCta: { label: "Review Workload", hash: "#production/workload" },
    emptyState: {
      message: "No approvals or queue issues need attention right now."
    },
    loadingState: { variant: "list", message: "Loading manager oversight...", rowCount: 4 },
    errorState: {
      message: "We couldn't load manager oversight.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Employees", hash: "#approvals" }
    },
    mobileVariant: "Keep the manager workflow surface first and let this one collapse below it on smaller screens."
  },
  "leadership-home-pulse": {
    widgetId: "leadership-home-pulse",
    inventoryIds: ["top_priorities_today", "company_alerts", "labor_health_snapshot"],
    title: "Top Priorities Today",
    subtitle: "Company-wide pressure, blockers, and daily rhythm.",
    purpose: "Give leadership the most important business pressure first, not a stack of equal-weight reports.",
    primaryAudience: ["leadership", "admin"],
    defaultSize: "full",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["home.pulse"],
    contentStructure: [
      "Primary line: the top company watch item or daily leadership headline.",
      "Secondary rows: priority watch items, same-day production pressure, and labor signals in the shared pulse surface."
    ],
    primaryCta: { label: "Review Alerts", hash: "#dashboard/alerts" },
    secondaryCta: { label: "Open Executive Summary", hash: "#reports/executive" },
    emptyState: {
      message: "No major company alerts are open right now."
    },
    loadingState: { variant: "hero", message: "Loading top priorities...", rowCount: 3 },
    errorState: {
      message: "We couldn't load top priorities today.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Reports", hash: "#reports" }
    },
    mobileVariant: "Keep this first but trim it to the top watch items and primary CTA.",
    implementationNote: "This widget reuses the existing Home pulse surface instead of building a second executive watch system."
  },
  "leadership-workflow": {
    widgetId: "leadership-workflow",
    inventoryIds: ["operational_health"],
    title: "Operational Health",
    subtitle: "Cross-functional execution pressure in one place.",
    purpose: "Give leadership the compact operational health readout without moving the source of truth out of Operations or Production.",
    primaryAudience: ["leadership", "admin"],
    defaultSize: "large",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["operations.workflow"],
    contentStructure: [
      "Primary line: stable, needs attention, or high risk.",
      "Secondary rows: staffing, production flow, schedule risk, and support health inside the shared workflow surface."
    ],
    primaryCta: { label: "Open Operational Performance", hash: "#reports/operations" },
    secondaryCta: { label: "Open Operations", hash: "#operations" },
    emptyState: {
      message: "Operational health is not available right now."
    },
    loadingState: { variant: "list", message: "Loading operational health...", rowCount: 4 },
    errorState: {
      message: "We couldn't load operational health.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Reports", hash: "#reports/operations" }
    },
    mobileVariant: "Keep the top health surface and push deeper queues lower."
  },
  "leadership-cockpit": {
    widgetId: "leadership-cockpit",
    inventoryIds: ["executive_summary", "review_desk_summary"],
    title: "Executive Summary",
    subtitle: "Cross-functional queues that need executive attention.",
    purpose: "Give leadership a compact view of the queue and approval areas that still need intervention.",
    primaryAudience: ["leadership", "admin"],
    defaultSize: "large",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["manager.cockpit"],
    contentStructure: [
      "Primary line: the current business-state summary or queue pressure headline.",
      "Secondary rows: operations, production, support, and growth status through the shared cockpit surface."
    ],
    primaryCta: { label: "Open Executive Summary", hash: "#reports/executive" },
    secondaryCta: { label: "Open Compliance", hash: "#employees/compliance" },
    emptyState: {
      message: "No executive queue issues need review right now."
    },
    loadingState: { variant: "list", message: "Loading executive summary...", rowCount: 4 },
    errorState: {
      message: "We couldn't load the executive summary.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Reports", hash: "#reports/executive" }
    },
    mobileVariant: "Keep this below the primary leadership watch and operational health surfaces."
  },
  "leadership-readiness": {
    widgetId: "leadership-readiness",
    inventoryIds: ["team_readiness"],
    title: "Team Readiness",
    subtitle: "Readiness gaps that leadership may need to escalate.",
    purpose: "Keep team-readiness detail available without competing with the main leadership intervention layer.",
    primaryAudience: ["leadership", "admin"],
    defaultSize: "large",
    aboveTheFoldEligible: false,
    primaryDataInputs: ["leadership.readiness"],
    contentStructure: [
      "Primary line: readiness pressure for teams or departments.",
      "Secondary rows: readiness gaps from the existing leadership readiness surface."
    ],
    primaryCta: { label: "Open Employees", hash: "#employees/readiness" },
    emptyState: {
      message: "No readiness issues are elevated right now."
    },
    loadingState: { variant: "list", message: "Loading readiness detail...", rowCount: 3 },
    errorState: {
      message: "We couldn't load team readiness.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Employees", hash: "#employees/readiness" }
    },
    mobileVariant: "Keep readiness below the fold by default."
  },
  "leadership-staffing": {
    widgetId: "leadership-staffing",
    inventoryIds: ["staffing_risks"],
    title: "Staffing Command",
    subtitle: "Coverage gaps and assignment pressure.",
    purpose: "Keep staffing risk available as a secondary queue instead of another top-row hero.",
    primaryAudience: ["manager", "leadership", "admin"],
    defaultSize: "full",
    aboveTheFoldEligible: false,
    primaryDataInputs: ["staffing.command"],
    contentStructure: [
      "Primary line: staffing risk summary.",
      "Secondary rows: coverage gaps and availability issues through the existing staffing command surface."
    ],
    primaryCta: { label: "Resolve Staffing Issues", hash: "#operations/staffing" },
    emptyState: {
      message: "No staffing risks are open right now."
    },
    loadingState: { variant: "list", message: "Loading staffing command...", rowCount: 3 },
    errorState: {
      message: "We couldn't load staffing risks.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Staffing", hash: "#operations/staffing" }
    },
    mobileVariant: "Keep this collapsed below the main manager and leadership workflow surfaces."
  },
  "admin-system-health": {
    widgetId: "admin-system-health",
    inventoryIds: ["system_alerts", "integration_health", "automation_failures"],
    title: "System Health & Integrations",
    subtitle: "What is broken, degraded, or risky in the platform layer.",
    purpose: "Give admins a compact first look at system health without pretending unrelated audit data is integration telemetry.",
    primaryAudience: ["admin"],
    defaultSize: "hero",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["admin.security"],
    contentStructure: [
      "Primary line: healthy, needs attention, or active failure state.",
      "Secondary rows: pending approvals, active break-glass sessions, and recent dangerous activity."
    ],
    primaryCta: { label: "Open Integrations", hash: "#admin/integrations" },
    secondaryCta: { label: "Review Automations", hash: "#admin/system" },
    emptyState: {
      message: "No urgent system issues are open right now.",
      detail: "Open Admin if you need a deeper system check."
    },
    loadingState: { variant: "summary", message: "Loading system health...", rowCount: 3 },
    errorState: {
      message: "We couldn't load system health.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Admin", hash: "#admin" }
    },
    mobileVariant: "Keep the state line and top two risk rows.",
    implementationNote: "Dedicated integration telemetry is still missing, so this hero stays honest about the admin signals it actually has."
  },
  "admin-audit-watch": {
    widgetId: "admin-audit-watch",
    inventoryIds: ["audit_issues", "permission_anomalies"],
    title: "Audit Issues & Permission Anomalies",
    subtitle: "Dangerous actions and permission changes that need review.",
    purpose: "Surface audit issues without forcing admins to browse the full audit log first.",
    primaryAudience: ["admin"],
    defaultSize: "large",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["admin.security.recent_dangerous_actions"],
    contentStructure: [
      "Primary line: count of items needing review.",
      "Secondary rows: up to four audit items with issue type, source, and age."
    ],
    primaryCta: { label: "Open Audit Controls", hash: "#admin/audit" },
    emptyState: {
      message: "No audit issues need review right now."
    },
    loadingState: { variant: "list", message: "Loading audit issues...", rowCount: 4 },
    errorState: {
      message: "We couldn't load audit issues.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Audit Controls", hash: "#admin/audit" }
    },
    mobileVariant: "Keep the count line and top two items first."
  },
  "quick-actions": {
    widgetId: "quick-actions",
    inventoryIds: ["quick_actions", "helpful_shortcuts"],
    title: "Quick Actions",
    subtitle: "The four fastest paths back to real work.",
    purpose: "Provide a small set of role-specific shortcuts without turning the dashboard into a menu wall.",
    primaryAudience: ["employee", "photographer", "shoot_lead", "production_staff", "customer_service_staff", "sales_growth_staff", "manager", "leadership", "admin"],
    defaultSize: "row",
    aboveTheFoldEligible: true,
    primaryDataInputs: ["dashboard.quick_actions"],
    contentStructure: [
      "Body only: up to four actions on desktop and the highest-value actions first.",
      "No descriptive paragraphs in the card body."
    ],
    emptyState: {
      message: "Quick actions are not available right now.",
      detail: "Use Dashboard or the owning section while shortcuts reload.",
      action: { label: "Open Dashboard", hash: "#dashboard" }
    },
    loadingState: { variant: "actions", message: "Loading your shortcuts...", rowCount: 4 },
    errorState: {
      message: "We couldn't load your shortcuts.",
      action: { label: "Open Dashboard", hash: "#dashboard" }
    },
    mobileVariant: "Show the top three actions first and let the rest fall below.",
    implementationNote: "This widget intentionally uses label-only actions in the UI to keep the card fast to scan."
  },
  "recent-activity": {
    widgetId: "recent-activity",
    inventoryIds: ["recent_activity"],
    title: "Recent Activity",
    subtitle: "The most relevant recent changes tied to your work.",
    purpose: "Show a short recent-activity trail without turning the dashboard into a long activity feed.",
    primaryAudience: ["employee", "photographer", "shoot_lead", "production_staff", "customer_service_staff", "sales_growth_staff", "manager", "leadership", "admin"],
    defaultSize: "medium",
    aboveTheFoldEligible: false,
    primaryDataInputs: ["employee.my_work.notifications", "production.board.items", "sales.pipeline.items", "customer_service.summary", "admin.security"],
    contentStructure: [
      "Rows only: up to four recent actions with action phrase, who or what, and time ago."
    ],
    primaryCta: { label: "View Activity", hash: "#dashboard/alerts" },
    emptyState: {
      message: "No recent activity to show right now."
    },
    loadingState: { variant: "list", message: "Loading recent activity...", rowCount: 4 },
    errorState: {
      message: "We couldn't load recent activity.",
      action: { label: "Retry" },
      secondaryAction: { label: "Open Dashboard", hash: "#dashboard" }
    },
    mobileVariant: "Keep the top three activity rows.",
    conditionalVisibility: "Hidden when no activity items are available."
  }
};

export function getDashboardWidgetContentSpec(widgetId: DashboardWidgetId, role?: BusinessRole) {
  const spec = DASHBOARD_WIDGET_CONTENT_SPECS[widgetId];
  const override = role ? spec.roleOverrides?.[role] : undefined;

  if (!override) {
    return spec;
  }

  return {
    ...spec,
    ...override,
    primaryCta: override.primaryCta ?? spec.primaryCta,
    secondaryCta: override.secondaryCta ?? spec.secondaryCta,
    emptyState: override.emptyState ? { ...spec.emptyState, ...override.emptyState } : spec.emptyState,
    loadingState: override.loadingState ? { ...spec.loadingState, ...override.loadingState } : spec.loadingState,
    errorState: override.errorState
      ? {
          ...spec.errorState,
          ...override.errorState,
          action: override.errorState.action ?? spec.errorState.action,
          secondaryAction: override.errorState.secondaryAction ?? spec.errorState.secondaryAction
        }
      : spec.errorState
  };
}
