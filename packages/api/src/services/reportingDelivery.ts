import PDFDocument from "pdfkit";
import { Buffer } from "node:buffer";
import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import { canExportLeadershipReports, canViewLeadershipReports } from "../authz/authority.js";
import type { AuthUser, AuthorityTier } from "../types/auth.js";
import { createAuditLog } from "./audit.js";
import {
  CANONICAL_LEADERSHIP_REPORT_IDS,
  exportLeadershipReportCsv,
  exportLeadershipReportPdf,
  getLeadershipReport,
  type CanonicalLeadershipReportId,
  type LeadershipReportDetail,
  type LeadershipReportFilters,
  type LeadershipReportFreshness,
  type LeadershipReportMetric,
  type LeadershipSavedView
} from "./leadershipReports.js";
import { createAppEvent } from "./outbox.js";

export const REPORTING_SAVED_VIEW_SOURCE_MODULES = [
  "reporting_dashboard",
  "schedule",
  "staffing",
  "attendance_review",
  "production_tracker",
  "relationship_follow_through",
  "directory_review"
] as const;

export const REPORTING_SAVED_VIEW_VISIBILITIES = [
  "private",
  "team_role_shared",
  "department_shared",
  "leadership_shared",
  "company_shared"
] as const;

export const REPORTING_EXPORT_FORMATS = ["csv", "pdf", "link"] as const;
export const REPORTING_EXPORT_STATUSES = ["requested", "completed", "failed"] as const;
export const LEADERSHIP_PACKET_SOURCE_TYPES = ["packet_template", "saved_view"] as const;
export const LEADERSHIP_PACKET_RUN_STATUSES = ["completed", "failed"] as const;
export const LEADERSHIP_DELIVERY_CADENCES = ["weekly", "daily", "monthly"] as const;
export const LEADERSHIP_DELIVERY_CHANNELS = ["in_app_summary", "email_link"] as const;

export type ReportingSavedViewSourceModule = (typeof REPORTING_SAVED_VIEW_SOURCE_MODULES)[number];
export type ReportingSavedViewVisibility = (typeof REPORTING_SAVED_VIEW_VISIBILITIES)[number];
export type ReportingExportFormat = (typeof REPORTING_EXPORT_FORMATS)[number];
export type ReportingExportStatus = (typeof REPORTING_EXPORT_STATUSES)[number];
export type LeadershipPacketSourceType = (typeof LEADERSHIP_PACKET_SOURCE_TYPES)[number];
export type LeadershipPacketRunStatus = (typeof LEADERSHIP_PACKET_RUN_STATUSES)[number];
export type LeadershipDeliveryCadence = (typeof LEADERSHIP_DELIVERY_CADENCES)[number];
export type LeadershipDeliveryChannel = (typeof LEADERSHIP_DELIVERY_CHANNELS)[number];

export type ReportingWindow =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "last_90_days"
  | "season_to_date"
  | "year_to_date"
  | "custom";

export type ReportingSavedViewRecord = LeadershipSavedView & {
  source_module: ReportingSavedViewSourceModule;
  visibility: ReportingSavedViewVisibility;
  owner_user_id: string | null;
  owner_name: string | null;
  department_code: string | null;
  is_default: boolean;
  is_pinned: boolean;
  system_defined: boolean;
  share_hash: string;
  grouping_state: string[];
  sort_state: string[];
  column_state: string[];
  scope_state: Record<string, unknown>;
  updated_at: string;
};

export type LeadershipPacketSectionConfig = {
  report_id: CanonicalLeadershipReportId;
  enabled: boolean;
  title?: string | null;
};

export type LeadershipPacketTemplateRecord = {
  id: string;
  name: string;
  audience: string;
  description: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  visibility: ReportingSavedViewVisibility;
  default_window: ReportingWindow;
  department_code: string | null;
  section_config: LeadershipPacketSectionConfig[];
  system_defined: boolean;
  is_pinned: boolean;
  updated_at: string;
};

export type LeadershipPacketNarrativeObservation = {
  id: string;
  tone: "steady" | "watch" | "risk";
  text: string;
};

export type LeadershipPacketActionItem = {
  id: string;
  title: string;
  detail: string;
  action_hash: string | null;
};

export type LeadershipPacketPayloadSection = {
  report_id: CanonicalLeadershipReportId;
  title: string;
  summary_line: string;
  filter_summary: Array<{ label: string; value: string }>;
  freshness: LeadershipReportFreshness | null;
  top_metrics: LeadershipReportMetric[];
  observations: LeadershipPacketNarrativeObservation[];
  exception_rows: Array<{
    id: string;
    primary: string;
    secondary: string | null;
    chips: Array<{ label: string; tone?: string }>;
    next_action: string | null;
    action_hash: string | null;
  }>;
};

export type LeadershipPacketPayload = {
  title: string;
  audience: string;
  date_range_label: string;
  run_timestamp: string;
  freshness_note: string;
  summary_strip: LeadershipReportMetric[];
  observations: LeadershipPacketNarrativeObservation[];
  sections: LeadershipPacketPayloadSection[];
  action_sections: Array<{
    id: string;
    title: string;
    items: LeadershipPacketActionItem[];
  }>;
};

export type LeadershipPacketRunRecord = {
  id: string;
  run_label: string;
  source_type: LeadershipPacketSourceType;
  template_id: string | null;
  template_name: string | null;
  saved_view_id: string | null;
  saved_view_name: string | null;
  schedule_id: string | null;
  anchor_date: string;
  date_from: string | null;
  date_to: string | null;
  summary_snapshot: LeadershipReportMetric[];
  freshness_snapshot: LeadershipReportFreshness | null;
  recipient_snapshot: Array<{ user_id: string; name: string | null; email: string | null }>;
  delivery_result: Record<string, unknown>;
  record_count: number | null;
  status: LeadershipPacketRunStatus;
  pdf_reference: string | null;
  created_at: string;
  completed_at: string;
  packet_payload: LeadershipPacketPayload | null;
};

export type ReportingExportJobRecord = {
  id: string;
  export_name: string;
  source_module: ReportingSavedViewSourceModule;
  report_id: string | null;
  format: ReportingExportFormat;
  status: ReportingExportStatus;
  requested_by_user_id: string | null;
  requested_by_name: string | null;
  requested_at: string;
  completed_at: string | null;
  record_count: number | null;
  file_reference: string | null;
  error_message: string | null;
  freshness_snapshot: LeadershipReportFreshness | null;
  filter_summary: Array<{ label: string; value: string }>;
};

export type LeadershipDeliveryRecipientOption = {
  id: string;
  full_name: string;
  email: string;
  department: string;
  authority_tier: string | null;
};

export type LeadershipDeliveryScheduleRecord = {
  id: string;
  label: string;
  source_type: LeadershipPacketSourceType;
  template_id: string | null;
  template_name: string | null;
  saved_view_id: string | null;
  saved_view_name: string | null;
  cadence: LeadershipDeliveryCadence;
  day_of_week: number;
  hour_local: number;
  minute_local: number;
  timezone: string;
  delivery_channel: LeadershipDeliveryChannel;
  active_status: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  recipient_snapshot: Array<{ user_id: string; name: string | null; email: string | null }>;
  updated_at: string;
};

export type ReportingDeliveryCenter = {
  generated_at: string;
  anchor_date: string;
  saved_views: ReportingSavedViewRecord[];
  packet_templates: LeadershipPacketTemplateRecord[];
  recent_packet_runs: LeadershipPacketRunRecord[];
  export_history: ReportingExportJobRecord[];
  delivery_schedules: LeadershipDeliveryScheduleRecord[];
  recipient_options: LeadershipDeliveryRecipientOption[];
};

export type SavedViewInput = {
  source_module: ReportingSavedViewSourceModule;
  report_id?: CanonicalLeadershipReportId | null;
  name: string;
  description?: string | null;
  visibility: ReportingSavedViewVisibility;
  window: ReportingWindow;
  date_from?: string | null;
  date_to?: string | null;
  department?: string | null;
  is_default?: boolean;
  is_pinned?: boolean;
  grouping_state?: string[];
  sort_state?: string[];
  column_state?: string[];
  scope_state?: Record<string, unknown>;
};

export type PacketTemplateInput = {
  name: string;
  audience: string;
  description?: string | null;
  visibility: ReportingSavedViewVisibility;
  default_window: ReportingWindow;
  department?: string | null;
  is_pinned?: boolean;
  section_config: LeadershipPacketSectionConfig[];
};

export type DeliveryScheduleInput = {
  label: string;
  source_type: LeadershipPacketSourceType;
  template_id?: string | null;
  saved_view_id?: string | null;
  cadence: LeadershipDeliveryCadence;
  day_of_week?: number;
  hour_local: number;
  minute_local: number;
  timezone: string;
  delivery_channel: LeadershipDeliveryChannel;
  recipient_user_ids: string[];
  active_status?: boolean;
};

type ReportSavedViewRow = {
  id: string;
  source_module: ReportingSavedViewSourceModule;
  report_id: string | null;
  name: string;
  description: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_department: string | null;
  visibility: ReportingSavedViewVisibility;
  department_code: string | null;
  is_default: boolean;
  is_pinned: boolean;
  system_defined: boolean;
  filter_state: Record<string, unknown>;
  grouping_state: unknown[];
  sort_state: unknown[];
  column_state: unknown[];
  scope_state: Record<string, unknown>;
  updated_at: string;
};

type PacketTemplateRow = {
  id: string;
  name: string;
  audience: string;
  description: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  visibility: ReportingSavedViewVisibility;
  default_window: ReportingWindow;
  department_code: string | null;
  section_config: unknown[];
  system_defined: boolean;
  is_pinned: boolean;
  updated_at: string;
};

type DeliveryScheduleRow = {
  id: string;
  label: string;
  source_type: LeadershipPacketSourceType;
  template_id: string | null;
  template_name: string | null;
  saved_view_id: string | null;
  saved_view_name: string | null;
  cadence: LeadershipDeliveryCadence;
  day_of_week: number;
  hour_local: number;
  minute_local: number;
  timezone: string;
  delivery_channel: LeadershipDeliveryChannel;
  recipient_user_ids: string[];
  active_status: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  updated_at: string;
};

const SUPERVISOR_TIERS: AuthorityTier[] = ["super_admin", "leadership", "director_admin", "supervisor"];
const LEADERSHIP_LIKE_TIERS: AuthorityTier[] = ["super_admin", "leadership", "director_admin"];

const DEFAULT_SAVED_VIEWS: Array<{
  template_key: string;
  name: string;
  description: string;
  report_id: CanonicalLeadershipReportId;
  window: ReportingWindow;
  department_code?: string | null;
}> = [
  {
    template_key: "today_next_7_days_risk",
    name: "Today and Next 7 Days Risk",
    description: "Cross-functional risk view for what needs action today and what is coming into the next week.",
    report_id: "executive_overview",
    window: "last_7_days"
  },
  {
    template_key: "under_minimum_shoots",
    name: "Under Minimum Shoots",
    description: "Quick path into shoots that are falling below minimum staffing thresholds.",
    report_id: "shoot_operations_health",
    window: "last_30_days"
  },
  {
    template_key: "missing_clock_ins_today",
    name: "Missing Clock-Ins Today",
    description: "Attendance-focused view for missing clock-ins, lateness, and same-day staffing exposure.",
    report_id: "staffing_attendance",
    window: "today"
  },
  {
    template_key: "production_blockers",
    name: "Production Blockers",
    description: "Blocked work, overdue jobs, and release-risk items inside the production tracker.",
    report_id: "production_qa_health",
    window: "last_7_days"
  },
  {
    template_key: "overdue_customer_followups",
    name: "Overdue Customer Follow-Ups",
    description: "Follow-through work that still owes a customer answer, confirmation, or next step.",
    report_id: "customer_relationship_follow_through",
    window: "last_30_days"
  },
  {
    template_key: "stale_critical_contacts",
    name: "Stale Critical Contacts",
    description: "Critical relationship owners and contact records that need review before upcoming work.",
    report_id: "customer_relationship_follow_through",
    window: "last_30_days"
  },
  {
    template_key: "repeat_issue_locations",
    name: "Repeat Issue Locations",
    description: "Locations with repeated setup, roster, staffing, or memory freshness risk.",
    report_id: "location_intelligence_repeat_issues",
    window: "last_90_days"
  },
  {
    template_key: "setup_photo_compliance",
    name: "Setup Photo Compliance",
    description: "Required setup-photo completion and stale-memory exposure before future shoots.",
    report_id: "workflow_compliance_data_quality",
    window: "last_30_days"
  },
  {
    template_key: "post_shoot_eval_compliance",
    name: "Post-Shoot Eval Compliance",
    description: "Required post-shoot evals that are missing, late, or trending below expectation.",
    report_id: "workflow_compliance_data_quality",
    window: "last_30_days"
  },
  {
    template_key: "qa_correction_queue",
    name: "QA Correction Queue",
    description: "Jobs that fell back into correction and need ownership before release risk grows.",
    report_id: "production_qa_health",
    window: "last_30_days"
  }
];

const DEFAULT_PACKET_TEMPLATES: Array<{
  template_key: string;
  name: string;
  audience: string;
  description: string;
  default_window: ReportingWindow;
  sections: CanonicalLeadershipReportId[];
}> = [
  {
    template_key: "executive_weekly_review",
    name: "Executive Weekly Review",
    audience: "Leadership weekly operating review",
    description: "Curated weekly packet covering operational risk, production exposure, relationship follow-through, and location intelligence.",
    default_window: "last_7_days",
    sections: [
      "executive_overview",
      "shoot_operations_health",
      "staffing_attendance",
      "production_qa_health",
      "customer_relationship_follow_through",
      "location_intelligence_repeat_issues"
    ]
  },
  {
    template_key: "operations_weekly_review",
    name: "Operations Weekly Review",
    audience: "Managers and coordinators",
    description: "Operational readiness, staffing fragility, attendance drift, and compliance follow-through for the week ahead.",
    default_window: "last_7_days",
    sections: [
      "shoot_operations_health",
      "staffing_attendance",
      "workflow_compliance_data_quality",
      "location_intelligence_repeat_issues"
    ]
  },
  {
    template_key: "production_health_review",
    name: "Production Health Review",
    audience: "Production leads and leadership",
    description: "Production load, blocker aging, QA drift, and release readiness in one packet.",
    default_window: "last_7_days",
    sections: ["production_qa_health", "workflow_compliance_data_quality"]
  },
  {
    template_key: "relationship_attention_review",
    name: "Relationship Attention Review",
    audience: "Account owners and leadership",
    description: "Touchpoint cadence, stale contacts, fragile accounts, and open customer promises.",
    default_window: "last_30_days",
    sections: ["customer_relationship_follow_through", "workflow_compliance_data_quality"]
  },
  {
    template_key: "location_issues_review",
    name: "Location Issues Review",
    audience: "Operations and leadership",
    description: "First-time locations, stale memory, repeat issue patterns, and location follow-through risk.",
    default_window: "last_30_days",
    sections: ["location_intelligence_repeat_issues", "shoot_operations_health", "workflow_compliance_data_quality"]
  }
];

function assertCanViewDecisionDelivery(auth: AuthUser) {
  if (!canViewLeadershipReports(auth)) {
    throw new ApiError(403, "Forbidden");
  }
}

function assertCanExportDecisionDelivery(auth: AuthUser) {
  if (!canExportLeadershipReports(auth)) {
    throw new ApiError(403, "Forbidden");
  }
}

function isSupervisorLike(auth: Pick<AuthUser, "authorityTier">) {
  return SUPERVISOR_TIERS.includes(auth.authorityTier);
}

function isLeadershipLike(auth: Pick<AuthUser, "authorityTier">) {
  return LEADERSHIP_LIKE_TIERS.includes(auth.authorityTier);
}

function assertCanManageTemplates(auth: AuthUser) {
  assertCanViewDecisionDelivery(auth);
  if (!isSupervisorLike(auth)) {
    throw new ApiError(403, "Manager-level reporting delivery access is required");
  }
}

function assertCanUseVisibility(auth: AuthUser, visibility: ReportingSavedViewVisibility) {
  if (visibility === "private") {
    return;
  }
  if (!isSupervisorLike(auth)) {
    throw new ApiError(403, "Shared reporting views require manager-level access");
  }
  if ((visibility === "leadership_shared" || visibility === "company_shared") && !isLeadershipLike(auth)) {
    throw new ApiError(403, "Leadership-level access is required for that shared visibility");
  }
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number) {
  const next = new Date(base.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfSeason(anchorDate: string) {
  const anchor = parseDateOnly(anchorDate);
  const year = anchor.getUTCMonth() >= 6 ? anchor.getUTCFullYear() : anchor.getUTCFullYear() - 1;
  return `${year}-08-01`;
}

function resolveWindowRange(anchorDate: string, window: ReportingWindow, dateFrom?: string | null, dateTo?: string | null) {
  if (window === "custom") {
    return {
      dateFrom: dateFrom ?? anchorDate,
      dateTo: dateTo ?? anchorDate
    };
  }
  const anchor = parseDateOnly(anchorDate);
  switch (window) {
    case "today":
      return { dateFrom: anchorDate, dateTo: anchorDate };
    case "yesterday": {
      const yesterday = formatDateOnly(addDays(anchor, -1));
      return { dateFrom: yesterday, dateTo: yesterday };
    }
    case "last_7_days":
      return { dateFrom: formatDateOnly(addDays(anchor, -6)), dateTo: anchorDate };
    case "last_30_days":
      return { dateFrom: formatDateOnly(addDays(anchor, -29)), dateTo: anchorDate };
    case "last_90_days":
      return { dateFrom: formatDateOnly(addDays(anchor, -89)), dateTo: anchorDate };
    case "season_to_date":
      return { dateFrom: startOfSeason(anchorDate), dateTo: anchorDate };
    case "year_to_date":
      return { dateFrom: `${anchorDate.slice(0, 4)}-01-01`, dateTo: anchorDate };
    default:
      return { dateFrom: anchorDate, dateTo: anchorDate };
  }
}

function formatWindowLabel(window: ReportingWindow) {
  switch (window) {
    case "today":
      return "Today";
    case "yesterday":
      return "Yesterday";
    case "last_7_days":
      return "Last 7 Days";
    case "last_30_days":
      return "Last 30 Days";
    case "last_90_days":
      return "Last 90 Days";
    case "season_to_date":
      return "Season To Date";
    case "year_to_date":
      return "Year To Date";
    default:
      return "Custom";
  }
}

function formatDateRangeLabel(dateFrom: string | null, dateTo: string | null, window?: ReportingWindow | null) {
  if (window && window !== "custom") {
    return formatWindowLabel(window);
  }
  if (dateFrom && dateTo && dateFrom === dateTo) {
    return dateFrom;
  }
  return `${dateFrom ?? "start"} to ${dateTo ?? "end"}`;
}

function buildSavedViewHash(view: {
  id: string;
  source_module: ReportingSavedViewSourceModule;
}) {
  switch (view.source_module) {
    case "schedule":
      return `#operations/schedule?saved_view_id=${view.id}`;
    case "staffing":
      return `#operations/staffing?saved_view_id=${view.id}`;
    case "attendance_review":
      return `#operations/attendance?saved_view_id=${view.id}`;
    case "production_tracker":
      return `#production?saved_view_id=${view.id}`;
    case "relationship_follow_through":
      return `#directory/accounts?saved_view_id=${view.id}`;
    case "directory_review":
      return `#directory/contacts?saved_view_id=${view.id}`;
    default:
  return `#reports?saved_view_id=${view.id}`;
  }
}

function jsonArrayOfStrings(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function jsonObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function buildFilterState(input: {
  window: ReportingWindow;
  dateFrom?: string | null;
  dateTo?: string | null;
}) {
  return {
    window: input.window,
    date_from: input.dateFrom ?? null,
    date_to: input.dateTo ?? null
  };
}

function canAccessSharedVisibility(auth: AuthUser, row: {
  visibility: ReportingSavedViewVisibility;
  owner_user_id: string | null;
  owner_department: string | null;
  department_code: string | null;
}) {
  if (row.owner_user_id === auth.id) {
    return true;
  }
  switch (row.visibility) {
    case "private":
      return false;
    case "team_role_shared":
    case "department_shared":
      return (row.department_code ?? row.owner_department ?? null) === auth.department;
    case "leadership_shared":
      return isLeadershipLike(auth) || auth.authorityTier === "read_only_viewer";
    case "company_shared":
      return canViewLeadershipReports(auth);
    default:
      return false;
  }
}

function canEditSavedView(auth: AuthUser, row: ReportSavedViewRow) {
  if (row.owner_user_id === auth.id) {
    return true;
  }
  if (row.system_defined) {
    return isLeadershipLike(auth);
  }
  return isLeadershipLike(auth);
}

function canEditPacketTemplate(auth: AuthUser, row: PacketTemplateRow) {
  if (row.owner_user_id === auth.id) {
    return true;
  }
  if (row.system_defined) {
    return isLeadershipLike(auth);
  }
  return isLeadershipLike(auth);
}

function mapSavedViewRow(row: ReportSavedViewRow): ReportingSavedViewRecord {
  const filterState = jsonObject(row.filter_state);
  const window = (String(filterState.window ?? "last_7_days") as ReportingWindow) ?? "last_7_days";
  return {
    id: row.id,
    label: row.name,
    summary: row.description ?? "Saved reporting view",
    report_id: ((row.report_id as CanonicalLeadershipReportId | null) ?? "executive_overview") as CanonicalLeadershipReportId,
    window,
    date_from: typeof filterState.date_from === "string" ? filterState.date_from : null,
    date_to: typeof filterState.date_to === "string" ? filterState.date_to : null,
    department: row.department_code,
    source_module: row.source_module,
    visibility: row.visibility,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    department_code: row.department_code,
    is_default: row.is_default,
    is_pinned: row.is_pinned,
    system_defined: row.system_defined,
    share_hash: buildSavedViewHash(row),
    grouping_state: jsonArrayOfStrings(row.grouping_state),
    sort_state: jsonArrayOfStrings(row.sort_state),
    column_state: jsonArrayOfStrings(row.column_state),
    scope_state: jsonObject(row.scope_state),
    updated_at: row.updated_at
  };
}

function mapPacketTemplateRow(row: PacketTemplateRow): LeadershipPacketTemplateRecord {
  const sectionConfig: LeadershipPacketSectionConfig[] = [];
  if (Array.isArray(row.section_config)) {
    for (const entry of row.section_config) {
      const value = jsonObject(entry);
      const reportId = String(value.report_id ?? "") as CanonicalLeadershipReportId;
      if (!CANONICAL_LEADERSHIP_REPORT_IDS.includes(reportId)) {
        continue;
      }
      sectionConfig.push({
        report_id: reportId,
        enabled: value.enabled !== false,
        title: typeof value.title === "string" ? value.title : null
      });
    }
  }

  return {
    id: row.id,
    name: row.name,
    audience: row.audience,
    description: row.description,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    visibility: row.visibility,
    default_window: row.default_window,
    department_code: row.department_code,
    section_config: sectionConfig,
    system_defined: row.system_defined,
    is_pinned: row.is_pinned,
    updated_at: row.updated_at
  };
}

async function ensureDeliveryDefaults(client: PoolClient, tenantId: string) {
  for (const view of DEFAULT_SAVED_VIEWS) {
    await client.query(
      `
        INSERT INTO report_saved_view (
          tenant_id,
          template_key,
          source_module,
          report_id,
          name,
          description,
          visibility,
          department_code,
          system_defined,
          is_pinned,
          filter_state
        )
        SELECT $1,$2,'reporting_dashboard',$3,$4,$5,'leadership_shared',$6,true,true,$7::jsonb
        WHERE NOT EXISTS (
          SELECT 1
          FROM report_saved_view existing
          WHERE existing.tenant_id = $1
            AND existing.template_key = $2
        )
      `,
      [
        tenantId,
        view.template_key,
        view.report_id,
        view.name,
        view.description,
        view.department_code ?? null,
        JSON.stringify(buildFilterState({ window: view.window }))
      ]
    );
  }

  for (const template of DEFAULT_PACKET_TEMPLATES) {
    await client.query(
      `
        INSERT INTO leadership_packet_template (
          tenant_id,
          template_key,
          name,
          audience,
          description,
          visibility,
          default_window,
          section_config,
          system_defined,
          is_pinned
        )
        SELECT $1,$2,$3,$4,$5,'leadership_shared',$6,$7::jsonb,true,true
        WHERE NOT EXISTS (
          SELECT 1
          FROM leadership_packet_template existing
          WHERE existing.tenant_id = $1
            AND existing.template_key = $2
        )
      `,
      [
        tenantId,
        template.template_key,
        template.name,
        template.audience,
        template.description,
        template.default_window,
        JSON.stringify(template.sections.map((reportId) => ({ report_id: reportId, enabled: true })))
      ]
    );
  }
}

function buildDefaultSavedViewRows(): ReportSavedViewRow[] {
  const now = new Date(0).toISOString();
  return DEFAULT_SAVED_VIEWS.map((view) => ({
    id: `default:${view.template_key}`,
    source_module: "reporting_dashboard",
    report_id: view.report_id,
    name: view.name,
    description: view.description,
    owner_user_id: null,
    owner_name: null,
    owner_department: null,
    visibility: "leadership_shared",
    department_code: view.department_code ?? null,
    is_default: false,
    is_pinned: true,
    system_defined: true,
    filter_state: buildFilterState({ window: view.window }),
    grouping_state: [],
    sort_state: [],
    column_state: [],
    scope_state: {},
    updated_at: now
  }));
}

function buildDefaultPacketTemplateRows(): PacketTemplateRow[] {
  const now = new Date(0).toISOString();
  return DEFAULT_PACKET_TEMPLATES.map((template) => ({
    id: `default:${template.template_key}`,
    name: template.name,
    audience: template.audience,
    description: template.description,
    owner_user_id: null,
    owner_name: null,
    visibility: "leadership_shared",
    default_window: template.default_window,
    department_code: null,
    section_config: template.sections.map((reportId) => ({ report_id: reportId, enabled: true })),
    system_defined: true,
    is_pinned: true,
    updated_at: now
  }));
}

function mergeDefaultSavedViewRows(rows: ReportSavedViewRow[]) {
  const merged = [...rows];
  const existingTemplateKeys = new Set(
    rows
      .filter((row) => row.system_defined && !row.owner_user_id)
      .map((row) => `${row.report_id ?? ""}|${row.name}|${row.department_code ?? ""}`)
  );
  for (const row of buildDefaultSavedViewRows()) {
    const identity = `${row.report_id ?? ""}|${row.name}|${row.department_code ?? ""}`;
    if (!existingTemplateKeys.has(identity)) {
      merged.push(row);
    }
  }
  return merged;
}

function mergeDefaultPacketTemplateRows(rows: PacketTemplateRow[]) {
  const merged = [...rows];
  const existingTemplateNames = new Set(rows.filter((row) => row.system_defined && !row.owner_user_id).map((row) => row.name));
  for (const row of buildDefaultPacketTemplateRows()) {
    if (!existingTemplateNames.has(row.name)) {
      merged.push(row);
    }
  }
  return merged;
}

async function listSavedViewRows(client: PoolClient, auth: AuthUser) {
  const { rows } = await client.query<ReportSavedViewRow>(
    `
      SELECT
        rsv.id,
        rsv.source_module::text AS source_module,
        rsv.report_id,
        rsv.name,
        rsv.description,
        rsv.owner_user_id,
        au.full_name AS owner_name,
        au.department::text AS owner_department,
        rsv.visibility::text AS visibility,
        rsv.department_code,
        rsv.is_default,
        rsv.is_pinned,
        rsv.system_defined,
        rsv.filter_state,
        rsv.grouping_state,
        rsv.sort_state,
        rsv.column_state,
        rsv.scope_state,
        rsv.updated_at::text AS updated_at
      FROM report_saved_view rsv
      LEFT JOIN app_user au
        ON au.tenant_id = rsv.tenant_id
       AND au.id = rsv.owner_user_id
      WHERE rsv.tenant_id = $1
        AND rsv.active_status = true
      ORDER BY rsv.is_pinned DESC, rsv.system_defined DESC, rsv.updated_at DESC
    `,
    [auth.tenantId]
  );
  return mergeDefaultSavedViewRows(rows).filter((row) => canAccessSharedVisibility(auth, row));
}

async function getSavedViewRow(client: PoolClient, auth: AuthUser, savedViewId: string) {
  const rows = await listSavedViewRows(client, auth);
  const row = rows.find((candidate) => candidate.id === savedViewId) ?? null;
  if (!row) {
    throw new ApiError(404, "Saved view not found");
  }
  return row;
}

async function listPacketTemplateRows(client: PoolClient, auth: AuthUser) {
  const { rows } = await client.query<PacketTemplateRow>(
    `
      SELECT
        lpt.id,
        lpt.name,
        lpt.audience,
        lpt.description,
        lpt.owner_user_id,
        au.full_name AS owner_name,
        lpt.visibility::text AS visibility,
        lpt.default_window,
        lpt.department_code,
        lpt.section_config,
        lpt.system_defined,
        lpt.is_pinned,
        lpt.updated_at::text AS updated_at
      FROM leadership_packet_template lpt
      LEFT JOIN app_user au
        ON au.tenant_id = lpt.tenant_id
       AND au.id = lpt.owner_user_id
      WHERE lpt.tenant_id = $1
        AND lpt.active_status = true
      ORDER BY lpt.is_pinned DESC, lpt.system_defined DESC, lpt.updated_at DESC
    `,
    [auth.tenantId]
  );

  return mergeDefaultPacketTemplateRows(rows).filter((row) =>
    canAccessSharedVisibility(auth, {
      visibility: row.visibility,
      owner_user_id: row.owner_user_id,
      owner_department: row.department_code,
      department_code: row.department_code
    })
  );
}

async function getPacketTemplateRow(client: PoolClient, auth: AuthUser, templateId: string) {
  const row = (await listPacketTemplateRows(client, auth)).find((candidate) => candidate.id === templateId) ?? null;
  if (!row) {
    throw new ApiError(404, "Leadership packet template not found");
  }
  return row;
}

async function listRecipientOptions(client: PoolClient, auth: AuthUser) {
  const { rows } = await client.query<LeadershipDeliveryRecipientOption>(
    `
      SELECT DISTINCT
        au.id,
        au.full_name,
        au.email,
        au.department::text AS department,
        uaa.authority_tier::text AS authority_tier
      FROM app_user au
      LEFT JOIN user_authority_assignment uaa
        ON uaa.tenant_id = au.tenant_id
       AND uaa.user_id = au.id
      WHERE au.tenant_id = $1
        AND au.status = 'active'
        AND (
          uaa.authority_tier IN ('super_admin', 'leadership', 'director_admin', 'supervisor', 'read_only_viewer')
          OR au.id = $2
        )
      ORDER BY au.full_name ASC
    `,
    [auth.tenantId, auth.id]
  );

  return rows;
}

async function loadRecipientSnapshot(client: PoolClient, tenantId: string, userIds: string[]) {
  if (!userIds.length) {
    return [];
  }
  const { rows } = await client.query<{ id: string; full_name: string | null; email: string | null }>(
    `
      SELECT id, full_name, email
      FROM app_user
      WHERE tenant_id = $1
        AND id = ANY($2::uuid[])
    `,
    [tenantId, userIds]
  );
  return rows.map((row) => ({
    user_id: row.id,
    name: row.full_name ?? null,
    email: row.email ?? null
  }));
}

async function buildPacketFromReports(input: {
  title: string;
  audience: string;
  dateRangeLabel: string;
  runTimestamp: string;
  details: LeadershipReportDetail[];
}) {
  const flattenedExceptions = input.details.flatMap((detail) =>
    (detail.exception_sections ?? []).flatMap((section) =>
      (section.rows ?? []).map((row) => ({
        id: `${detail.id}-${row.id}`,
        title: row.primary,
        detail: row.next_action ?? row.secondary ?? detail.summary_line,
        action_hash: row.action_hash ?? null,
        chips: row.chips ?? []
      }))
    )
  );

  const summaryStrip = input.details
    .flatMap((detail) => detail.top_summary ?? detail.metrics ?? [])
    .slice(0, 8);

  const observations = input.details
    .slice(0, 4)
    .map((detail, index) => ({
      id: `obs-${detail.id}-${index}`,
      tone: detail.tone === "action_needed" ? "risk" : detail.tone === "heads_up" ? "watch" : "steady",
      text: detail.summary_line
    } satisfies LeadershipPacketNarrativeObservation));

  const sections: LeadershipPacketPayloadSection[] = input.details.map((detail) => ({
    report_id: detail.id as CanonicalLeadershipReportId,
    title: detail.title,
    summary_line: detail.summary_line,
    filter_summary: detail.filter_summary ?? [],
    freshness: detail.freshness ?? null,
    top_metrics: (detail.top_summary ?? detail.metrics ?? []).slice(0, 5),
    observations: [
      {
        id: `${detail.id}-obs`,
        tone: detail.tone === "action_needed" ? "risk" : detail.tone === "heads_up" ? "watch" : "steady",
        text: detail.summary_line
      }
    ],
    exception_rows: (detail.exception_sections ?? [])
      .flatMap((section) => section.rows ?? [])
      .slice(0, 5)
      .map((row) => ({
        id: row.id,
        primary: row.primary,
        secondary: row.secondary ?? null,
        chips: (row.chips ?? []).map((chip) => ({ label: chip.label, tone: chip.tone ?? "neutral" })),
        next_action: row.next_action ?? null,
        action_hash: row.action_hash ?? null
      }))
  }));

  const actionSections = [
    {
      id: "needs_leadership_decision",
      title: "Needs Leadership Decision",
      items: flattenedExceptions
        .filter((item) => item.chips.some((chip) => /critical|escalated|leadership/i.test(String(chip.label))))
        .slice(0, 5)
    },
    {
      id: "needs_manager_follow_up",
      title: "Needs Manager Follow-Up",
      items: flattenedExceptions
        .filter((item) => !item.chips.some((chip) => /critical|escalated|leadership/i.test(String(chip.label))))
        .slice(0, 6)
    },
    {
      id: "unresolved_critical_items",
      title: "Unresolved Critical Items",
      items: flattenedExceptions
        .filter((item) => /blocked|overdue|at risk|fragile|ownerless|stale/i.test(`${item.title} ${item.detail}`))
        .slice(0, 6)
    },
    {
      id: "ownership_gaps",
      title: "Ownership Gaps",
      items: flattenedExceptions
        .filter((item) => /ownerless|unassigned|stale contact|no owner|backup/i.test(`${item.title} ${item.detail}`))
        .slice(0, 6)
    }
  ].filter((section) => section.items.length);

  const freshnessNote = input.details.find((detail) => detail.freshness)?.freshness?.label ?? "Recently Updated";

  return {
    title: input.title,
    audience: input.audience,
    date_range_label: input.dateRangeLabel,
    run_timestamp: input.runTimestamp,
    freshness_note: freshnessNote,
    summary_strip: summaryStrip,
    observations,
    sections,
    action_sections: actionSections
  } satisfies LeadershipPacketPayload;
}

function buildPacketPdfBuffer(packet: LeadershipPacketPayload) {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({
      size: "LETTER",
      margin: 40
    });
    const buffers: Buffer[] = [];
    document.on("data", (chunk) => buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    document.on("end", () => resolve(Buffer.concat(buffers)));
    document.on("error", reject);

    document.fontSize(20).text(packet.title);
    document.moveDown(0.4);
    document.fontSize(10).fillColor("#4b5563").text(`${packet.date_range_label} | Run ${packet.run_timestamp} | ${packet.freshness_note}`);
    document.moveDown(0.8);

    document.fillColor("#111827").fontSize(12).text("Summary Strip");
    document.moveDown(0.2);
    for (const metric of packet.summary_strip.slice(0, 8)) {
      document.fontSize(10).text(`${metric.label}: ${metric.value}${metric.detail ? ` (${metric.detail})` : ""}`);
    }
    document.moveDown(0.8);

    if (packet.observations.length) {
      document.fontSize(12).text("Grounded Observations");
      document.moveDown(0.2);
      for (const observation of packet.observations) {
        document.fontSize(10).text(`- ${observation.text}`);
      }
      document.moveDown(0.8);
    }

    for (const section of packet.sections) {
      document.fontSize(12).text(section.title);
      document.moveDown(0.1);
      document.fontSize(10).text(section.summary_line);
      document.moveDown(0.2);
      for (const metric of section.top_metrics.slice(0, 4)) {
        document.text(`${metric.label}: ${metric.value}`);
      }
      if (section.exception_rows.length) {
        document.moveDown(0.2);
        document.text("Top exceptions:");
        for (const row of section.exception_rows.slice(0, 4)) {
          document.text(`- ${row.primary}${row.next_action ? ` | ${row.next_action}` : ""}`);
        }
      }
      document.moveDown(0.8);
    }

    if (packet.action_sections.length) {
      document.fontSize(12).text("Action Blocks");
      document.moveDown(0.2);
      for (const actionSection of packet.action_sections) {
        document.fontSize(11).text(actionSection.title);
        for (const item of actionSection.items.slice(0, 5)) {
          document.fontSize(10).text(`- ${item.title}: ${item.detail}`);
        }
        document.moveDown(0.5);
      }
    }

    document.end();
  });
}

function getLocalParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short"
  });
  const mapped = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  return {
    year: Number(mapped.year),
    month: Number(mapped.month),
    day: Number(mapped.day),
    hour: Number(mapped.hour),
    minute: Number(mapped.minute),
    second: Number(mapped.second),
    weekday: weekdayMap[String(mapped.weekday)] ?? 0
  };
}

function getTimeZoneOffsetMillis(date: Date, timeZone: string) {
  const parts = getLocalParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
  timeZone: string;
}) {
  const guess = new Date(Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, input.second ?? 0));
  const offset = getTimeZoneOffsetMillis(guess, input.timeZone);
  return new Date(guess.getTime() - offset);
}

function computeNextRunAt(input: {
  cadence: LeadershipDeliveryCadence;
  dayOfWeek: number;
  hourLocal: number;
  minuteLocal: number;
  timeZone: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const local = getLocalParts(now, input.timeZone);
  const makeCandidate = (year: number, month: number, day: number) =>
    zonedDateTimeToUtc({
      year,
      month,
      day,
      hour: input.hourLocal,
      minute: input.minuteLocal,
      second: 0,
      timeZone: input.timeZone
    });

  if (input.cadence === "daily") {
    const todayCandidate = makeCandidate(local.year, local.month, local.day);
    if (todayCandidate.getTime() > now.getTime()) {
      return todayCandidate.toISOString();
    }
    const nextDay = addDays(new Date(Date.UTC(local.year, local.month - 1, local.day)), 1);
    return makeCandidate(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate()).toISOString();
  }

  if (input.cadence === "monthly") {
    const todayCandidate = makeCandidate(local.year, local.month, local.day);
    if (todayCandidate.getTime() > now.getTime()) {
      return todayCandidate.toISOString();
    }
    const nextMonthDate = new Date(Date.UTC(local.year, local.month, local.day));
    return makeCandidate(nextMonthDate.getUTCFullYear(), nextMonthDate.getUTCMonth() + 1, nextMonthDate.getUTCDate()).toISOString();
  }

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidateDate = addDays(new Date(Date.UTC(local.year, local.month - 1, local.day)), offset);
    const candidateLocal = getLocalParts(candidateDate, input.timeZone);
    if (candidateLocal.weekday !== input.dayOfWeek) {
      continue;
    }
    const candidate = makeCandidate(candidateLocal.year, candidateLocal.month, candidateLocal.day);
    if (candidate.getTime() > now.getTime()) {
      return candidate.toISOString();
    }
  }

  const nextWeek = addDays(new Date(Date.UTC(local.year, local.month - 1, local.day)), 7);
  return makeCandidate(nextWeek.getUTCFullYear(), nextWeek.getUTCMonth() + 1, nextWeek.getUTCDate()).toISOString();
}

function mapPacketRunRow(row: any): LeadershipPacketRunRecord {
  return {
    id: row.id,
    run_label: row.run_label,
    source_type: row.source_type,
    template_id: row.template_id,
    template_name: row.template_name ?? null,
    saved_view_id: row.saved_view_id,
    saved_view_name: row.saved_view_name ?? null,
    schedule_id: row.schedule_id,
    anchor_date: row.anchor_date,
    date_from: row.date_from,
    date_to: row.date_to,
    summary_snapshot: Array.isArray(row.summary_snapshot) ? row.summary_snapshot : [],
    freshness_snapshot: row.freshness_snapshot ?? null,
    recipient_snapshot: Array.isArray(row.recipient_snapshot) ? row.recipient_snapshot : [],
    delivery_result: row.delivery_result ?? {},
    record_count: row.record_count,
    status: row.status,
    pdf_reference: row.pdf_reference,
    created_at: row.created_at,
    completed_at: row.completed_at,
    packet_payload: row.packet_payload ?? null
  };
}

function mapExportJobRow(row: any): ReportingExportJobRecord {
  return {
    id: row.id,
    export_name: row.export_name,
    source_module: row.source_module,
    report_id: row.report_id,
    format: row.format,
    status: row.status,
    requested_by_user_id: row.requested_by_user_id,
    requested_by_name: row.requested_by_name ?? null,
    requested_at: row.requested_at,
    completed_at: row.completed_at,
    record_count: row.record_count,
    file_reference: row.file_reference,
    error_message: row.error_message,
    freshness_snapshot: row.freshness_snapshot ?? null,
    filter_summary: Array.isArray(row.filter_summary) ? row.filter_summary : []
  };
}

function mapDeliveryScheduleRow(row: DeliveryScheduleRow, recipients: Array<{ user_id: string; name: string | null; email: string | null }>) {
  return {
    id: row.id,
    label: row.label,
    source_type: row.source_type,
    template_id: row.template_id,
    template_name: row.template_name,
    saved_view_id: row.saved_view_id,
    saved_view_name: row.saved_view_name,
    cadence: row.cadence,
    day_of_week: row.day_of_week,
    hour_local: row.hour_local,
    minute_local: row.minute_local,
    timezone: row.timezone,
    delivery_channel: row.delivery_channel,
    active_status: row.active_status,
    last_run_at: row.last_run_at,
    next_run_at: row.next_run_at,
    last_status: row.last_status,
    last_error: row.last_error,
    recipient_snapshot: recipients,
    updated_at: row.updated_at
  } satisfies LeadershipDeliveryScheduleRecord;
}

async function listPacketRunRows(client: PoolClient, auth: AuthUser) {
  const { rows } = await client.query(
    `
      SELECT
        lpr.*,
        lpt.name AS template_name,
        rsv.name AS saved_view_name
      FROM leadership_packet_run lpr
      LEFT JOIN leadership_packet_template lpt
        ON lpt.tenant_id = lpr.tenant_id
       AND lpt.id = lpr.template_id
      LEFT JOIN report_saved_view rsv
        ON rsv.tenant_id = lpr.tenant_id
       AND rsv.id = lpr.saved_view_id
      WHERE lpr.tenant_id = $1
      ORDER BY lpr.created_at DESC
      LIMIT 12
    `,
    [auth.tenantId]
  );
  return rows.map(mapPacketRunRow);
}

async function listExportJobRows(client: PoolClient, auth: AuthUser) {
  const { rows } = await client.query(
    `
      SELECT
        rej.*,
        au.full_name AS requested_by_name,
        rej.freshness_snapshot,
        COALESCE(
          jsonb_build_array(
            jsonb_build_object('label', 'Date range', 'value', rej.filter_state ->> 'date_range_label'),
            jsonb_build_object('label', 'Department', 'value', rej.filter_state ->> 'department')
          ),
          '[]'::jsonb
        ) AS filter_summary
      FROM report_export_job rej
      LEFT JOIN app_user au
        ON au.tenant_id = rej.tenant_id
       AND au.id = rej.requested_by_user_id
      WHERE rej.tenant_id = $1
      ORDER BY rej.requested_at DESC
      LIMIT 12
    `,
    [auth.tenantId]
  );
  return rows.map(mapExportJobRow);
}

async function listDeliveryScheduleRows(client: PoolClient, auth: AuthUser) {
  const { rows } = await client.query<DeliveryScheduleRow>(
    `
      SELECT
        lds.id,
        lds.label,
        lds.source_type::text AS source_type,
        lds.template_id,
        lpt.name AS template_name,
        lds.saved_view_id,
        rsv.name AS saved_view_name,
        lds.cadence::text AS cadence,
        lds.day_of_week,
        lds.hour_local,
        lds.minute_local,
        lds.timezone,
        lds.delivery_channel::text AS delivery_channel,
        ARRAY(
          SELECT jsonb_array_elements_text(lds.recipient_user_ids)
        )::text[] AS recipient_user_ids,
        lds.active_status,
        lds.last_run_at::text AS last_run_at,
        lds.next_run_at::text AS next_run_at,
        lds.last_status,
        lds.last_error,
        lds.updated_at::text AS updated_at
      FROM leadership_delivery_schedule lds
      LEFT JOIN leadership_packet_template lpt
        ON lpt.tenant_id = lds.tenant_id
       AND lpt.id = lds.template_id
      LEFT JOIN report_saved_view rsv
        ON rsv.tenant_id = lds.tenant_id
       AND rsv.id = lds.saved_view_id
      WHERE lds.tenant_id = $1
      ORDER BY lds.updated_at DESC
    `,
    [auth.tenantId]
  );

  const visibleRows = rows.filter((row) => row.source_type === "packet_template" || row.saved_view_id !== null);
  const recipientIds = [...new Set(visibleRows.flatMap((row) => row.recipient_user_ids ?? []))];
  const recipients = await loadRecipientSnapshot(client, auth.tenantId, recipientIds);
  const recipientMap = new Map(recipients.map((recipient) => [recipient.user_id, recipient]));
  return visibleRows.map((row) =>
    mapDeliveryScheduleRow(
      row,
      (row.recipient_user_ids ?? []).map((userId) => recipientMap.get(userId) ?? { user_id: userId, name: null, email: null })
    )
  );
}

export async function getReportingDeliveryCenter(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<ReportingDeliveryCenter> {
  assertCanViewDecisionDelivery(auth);

  const savedViews = (await listSavedViewRows(client, auth)).map(mapSavedViewRow);
  const packetTemplates = (await listPacketTemplateRows(client, auth)).map(mapPacketTemplateRow);
  const recentPacketRuns = await listPacketRunRows(client, auth);
  const exportHistory = await listExportJobRows(client, auth);
  const deliverySchedules = await listDeliveryScheduleRows(client, auth);
  const recipientOptions = await listRecipientOptions(client, auth);

  return {
    generated_at: new Date().toISOString(),
    anchor_date: filters.anchorDate,
    saved_views: savedViews,
    packet_templates: packetTemplates,
    recent_packet_runs: recentPacketRuns,
    export_history: exportHistory,
    delivery_schedules: deliverySchedules,
    recipient_options: recipientOptions
  };
}

export async function listReportingSavedViews(client: PoolClient, auth: AuthUser) {
  assertCanViewDecisionDelivery(auth);
  return (await listSavedViewRows(client, auth)).map(mapSavedViewRow);
}

export async function createReportingSavedView(client: PoolClient, auth: AuthUser, input: SavedViewInput) {
  assertCanViewDecisionDelivery(auth);
  assertCanUseVisibility(auth, input.visibility);
  if (input.report_id && !CANONICAL_LEADERSHIP_REPORT_IDS.includes(input.report_id)) {
    throw new ApiError(400, "Unknown report id");
  }
  const filterState = buildFilterState({
    window: input.window,
    dateFrom: input.date_from ?? null,
    dateTo: input.date_to ?? null
  });

  if (input.is_default) {
    await client.query(
      `
        UPDATE report_saved_view
        SET is_default = false,
            updated_at = now()
        WHERE tenant_id = $1
          AND owner_user_id = $2
          AND source_module = $3::report_saved_view_source_module
      `,
      [auth.tenantId, auth.id, input.source_module]
    );
  }

  const { rows } = await client.query<ReportSavedViewRow>(
    `
      INSERT INTO report_saved_view (
        tenant_id,
        source_module,
        report_id,
        name,
        description,
        owner_user_id,
        visibility,
        department_code,
        is_default,
        is_pinned,
        filter_state,
        grouping_state,
        sort_state,
        column_state,
        scope_state,
        updated_at
      )
      VALUES (
        $1,$2::report_saved_view_source_module,$3,$4,$5,$6,$7::report_saved_view_visibility,$8,$9,$10,
        $11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,now()
      )
      RETURNING
        id,
        source_module::text AS source_module,
        report_id,
        name,
        description,
        owner_user_id,
        $16::text AS owner_name,
        $17::text AS owner_department,
        visibility::text AS visibility,
        department_code,
        is_default,
        is_pinned,
        system_defined,
        filter_state,
        grouping_state,
        sort_state,
        column_state,
        scope_state,
        updated_at::text AS updated_at
    `,
    [
      auth.tenantId,
      input.source_module,
      input.report_id ?? null,
      input.name.trim(),
      input.description?.trim() || null,
      auth.id,
      input.visibility,
      input.department ?? (input.visibility === "department_shared" || input.visibility === "team_role_shared" ? auth.department : null),
      Boolean(input.is_default),
      Boolean(input.is_pinned),
      JSON.stringify(filterState),
      JSON.stringify(input.grouping_state ?? []),
      JSON.stringify(input.sort_state ?? []),
      JSON.stringify(input.column_state ?? []),
      JSON.stringify(input.scope_state ?? {}),
      auth.fullName,
      auth.department
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "reporting.saved_view.created",
    entityType: "report_saved_view",
    entityId: rows[0].id,
    metadata: {
      source_module: input.source_module,
      report_id: input.report_id ?? null,
      visibility: input.visibility
    }
  });

  return mapSavedViewRow(rows[0]);
}

export async function updateReportingSavedView(client: PoolClient, auth: AuthUser, savedViewId: string, input: Partial<SavedViewInput>) {
  assertCanViewDecisionDelivery(auth);
  const current = await getSavedViewRow(client, auth, savedViewId);
  if (!canEditSavedView(auth, current)) {
    throw new ApiError(403, "You do not have permission to update that saved view");
  }
  const nextVisibility = input.visibility ?? current.visibility;
  assertCanUseVisibility(auth, nextVisibility);
  const currentWindow = (String(jsonObject(current.filter_state).window ?? "last_7_days") as ReportingWindow) ?? "last_7_days";
  const nextWindow = input.window ?? currentWindow;
  const currentFilterState = jsonObject(current.filter_state);
  const filterState = buildFilterState({
    window: nextWindow,
    dateFrom: input.date_from ?? (typeof currentFilterState.date_from === "string" ? currentFilterState.date_from : null),
    dateTo: input.date_to ?? (typeof currentFilterState.date_to === "string" ? currentFilterState.date_to : null)
  });

  if (input.is_default) {
    await client.query(
      `
        UPDATE report_saved_view
        SET is_default = false,
            updated_at = now()
        WHERE tenant_id = $1
          AND owner_user_id = $2
          AND source_module = $3::report_saved_view_source_module
          AND id <> $4
      `,
      [auth.tenantId, current.owner_user_id ?? auth.id, input.source_module ?? current.source_module, current.id]
    );
  }

  const { rows } = await client.query<ReportSavedViewRow>(
    `
      UPDATE report_saved_view
      SET report_id = $2,
          name = $3,
          description = $4,
          visibility = $5::report_saved_view_visibility,
          department_code = $6,
          is_default = $7,
          is_pinned = $8,
          filter_state = $9::jsonb,
          grouping_state = $10::jsonb,
          sort_state = $11::jsonb,
          column_state = $12::jsonb,
          scope_state = $13::jsonb,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $14
      RETURNING
        id,
        source_module::text AS source_module,
        report_id,
        name,
        description,
        owner_user_id,
        $15::text AS owner_name,
        $16::text AS owner_department,
        visibility::text AS visibility,
        department_code,
        is_default,
        is_pinned,
        system_defined,
        filter_state,
        grouping_state,
        sort_state,
        column_state,
        scope_state,
        updated_at::text AS updated_at
    `,
    [
      auth.tenantId,
      input.report_id ?? current.report_id,
      input.name?.trim() ?? current.name,
      input.description?.trim() ?? current.description,
      nextVisibility,
      input.department ?? current.department_code,
      input.is_default ?? current.is_default,
      input.is_pinned ?? current.is_pinned,
      JSON.stringify(filterState),
      JSON.stringify(input.grouping_state ?? current.grouping_state ?? []),
      JSON.stringify(input.sort_state ?? current.sort_state ?? []),
      JSON.stringify(input.column_state ?? current.column_state ?? []),
      JSON.stringify(input.scope_state ?? current.scope_state ?? {}),
      savedViewId,
      auth.fullName,
      auth.department
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "reporting.saved_view.updated",
    entityType: "report_saved_view",
    entityId: savedViewId,
    previousValues: {
      name: current.name,
      visibility: current.visibility
    },
    newValues: {
      name: rows[0].name,
      visibility: rows[0].visibility
    }
  });

  return mapSavedViewRow(rows[0]);
}

export async function duplicateReportingSavedView(client: PoolClient, auth: AuthUser, savedViewId: string) {
  const current = await getSavedViewRow(client, auth, savedViewId);
  return createReportingSavedView(client, auth, {
    source_module: current.source_module,
    report_id: current.report_id as CanonicalLeadershipReportId | null,
    name: `${current.name} Copy`,
    description: current.description ?? null,
    visibility: "private",
    window: (String(jsonObject(current.filter_state).window ?? "last_7_days") as ReportingWindow) ?? "last_7_days",
    date_from: typeof jsonObject(current.filter_state).date_from === "string" ? String(jsonObject(current.filter_state).date_from) : null,
    date_to: typeof jsonObject(current.filter_state).date_to === "string" ? String(jsonObject(current.filter_state).date_to) : null,
    department: current.department_code,
    is_default: false,
    is_pinned: current.is_pinned,
    grouping_state: jsonArrayOfStrings(current.grouping_state),
    sort_state: jsonArrayOfStrings(current.sort_state),
    column_state: jsonArrayOfStrings(current.column_state),
    scope_state: jsonObject(current.scope_state)
  });
}

export async function deleteReportingSavedView(client: PoolClient, auth: AuthUser, savedViewId: string) {
  assertCanViewDecisionDelivery(auth);
  const current = await getSavedViewRow(client, auth, savedViewId);
  if (!canEditSavedView(auth, current)) {
    throw new ApiError(403, "You do not have permission to delete that saved view");
  }
  if (current.system_defined) {
    throw new ApiError(409, "Duplicate the default saved view if you need a custom variant");
  }
  await client.query(
    `
      DELETE FROM report_saved_view
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, savedViewId]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "reporting.saved_view.deleted",
    entityType: "report_saved_view",
    entityId: savedViewId
  });
}

export async function listLeadershipPacketTemplates(client: PoolClient, auth: AuthUser) {
  assertCanViewDecisionDelivery(auth);
  return (await listPacketTemplateRows(client, auth)).map(mapPacketTemplateRow);
}

export async function createLeadershipPacketTemplate(client: PoolClient, auth: AuthUser, input: PacketTemplateInput) {
  assertCanManageTemplates(auth);
  assertCanUseVisibility(auth, input.visibility);
  if (!input.section_config.filter((section) => section.enabled !== false).length) {
    throw new ApiError(400, "At least one packet section must stay enabled");
  }
  const { rows } = await client.query<PacketTemplateRow>(
    `
      INSERT INTO leadership_packet_template (
        tenant_id,
        name,
        audience,
        description,
        owner_user_id,
        visibility,
        default_window,
        department_code,
        section_config,
        is_pinned,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6::report_saved_view_visibility,$7,$8,$9::jsonb,$10,now()
      )
      RETURNING
        id,
        name,
        audience,
        description,
        owner_user_id,
        $11::text AS owner_name,
        visibility::text AS visibility,
        default_window,
        department_code,
        section_config,
        system_defined,
        is_pinned,
        updated_at::text AS updated_at
    `,
    [
      auth.tenantId,
      input.name.trim(),
      input.audience.trim(),
      input.description?.trim() || null,
      auth.id,
      input.visibility,
      input.default_window,
      input.department ?? (input.visibility === "department_shared" || input.visibility === "team_role_shared" ? auth.department : null),
      JSON.stringify(input.section_config),
      Boolean(input.is_pinned),
      auth.fullName
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "reporting.packet_template.created",
    entityType: "leadership_packet_template",
    entityId: rows[0].id
  });

  return mapPacketTemplateRow(rows[0]);
}

export async function updateLeadershipPacketTemplate(client: PoolClient, auth: AuthUser, templateId: string, input: Partial<PacketTemplateInput>) {
  assertCanManageTemplates(auth);
  const current = await getPacketTemplateRow(client, auth, templateId);
  if (!canEditPacketTemplate(auth, current)) {
    throw new ApiError(403, "You do not have permission to update that packet template");
  }
  if (current.system_defined && !isLeadershipLike(auth)) {
    throw new ApiError(409, "Duplicate the default packet template to customize it");
  }
  const nextVisibility = input.visibility ?? current.visibility;
  assertCanUseVisibility(auth, nextVisibility);
  const sectionConfig = input.section_config ?? mapPacketTemplateRow(current).section_config;
  if (!sectionConfig.filter((section) => section.enabled !== false).length) {
    throw new ApiError(400, "At least one packet section must stay enabled");
  }

  const { rows } = await client.query<PacketTemplateRow>(
    `
      UPDATE leadership_packet_template
      SET name = $2,
          audience = $3,
          description = $4,
          visibility = $5::report_saved_view_visibility,
          default_window = $6,
          department_code = $7,
          section_config = $8::jsonb,
          is_pinned = $9,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $10
      RETURNING
        id,
        name,
        audience,
        description,
        owner_user_id,
        $11::text AS owner_name,
        visibility::text AS visibility,
        default_window,
        department_code,
        section_config,
        system_defined,
        is_pinned,
        updated_at::text AS updated_at
    `,
    [
      auth.tenantId,
      input.name?.trim() ?? current.name,
      input.audience?.trim() ?? current.audience,
      input.description?.trim() ?? current.description,
      nextVisibility,
      input.default_window ?? current.default_window,
      input.department ?? current.department_code,
      JSON.stringify(sectionConfig),
      input.is_pinned ?? current.is_pinned,
      templateId,
      auth.fullName
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "reporting.packet_template.updated",
    entityType: "leadership_packet_template",
    entityId: templateId
  });

  return mapPacketTemplateRow(rows[0]);
}

export async function duplicateLeadershipPacketTemplate(client: PoolClient, auth: AuthUser, templateId: string) {
  const current = mapPacketTemplateRow(await getPacketTemplateRow(client, auth, templateId));
  return createLeadershipPacketTemplate(client, auth, {
    name: `${current.name} Copy`,
    audience: current.audience,
    description: current.description,
    visibility: "private",
    default_window: current.default_window,
    department: current.department_code,
    is_pinned: current.is_pinned,
    section_config: current.section_config
  });
}

export async function deleteLeadershipPacketTemplate(client: PoolClient, auth: AuthUser, templateId: string) {
  assertCanManageTemplates(auth);
  const current = await getPacketTemplateRow(client, auth, templateId);
  if (!canEditPacketTemplate(auth, current)) {
    throw new ApiError(403, "You do not have permission to delete that packet template");
  }
  if (current.system_defined) {
    throw new ApiError(409, "Duplicate the default packet template if you need a custom variant");
  }
  await client.query(
    `
      DELETE FROM leadership_packet_template
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, templateId]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "reporting.packet_template.deleted",
    entityType: "leadership_packet_template",
    entityId: templateId
  });
}

async function createPacketRunRecord(
  client: PoolClient,
  auth: AuthUser,
  input: {
    sourceType: LeadershipPacketSourceType;
    templateId?: string | null;
    savedViewId?: string | null;
    scheduleId?: string | null;
    runLabel: string;
    filters: LeadershipReportFilters;
    packetPayload: LeadershipPacketPayload;
    freshness: LeadershipReportFreshness | null;
    recipients: Array<{ user_id: string; name: string | null; email: string | null }>;
  }
) {
  const { rows } = await client.query<{
    id: string;
  }>(
    `
      INSERT INTO leadership_packet_run (
        tenant_id,
        source_type,
        template_id,
        saved_view_id,
        schedule_id,
        run_label,
        requested_by_user_id,
        anchor_date,
        date_from,
        date_to,
        filter_state,
        freshness_snapshot,
        summary_snapshot,
        packet_payload,
        record_count,
        status,
        pdf_reference,
        recipient_snapshot,
        delivery_result
      )
      VALUES (
        $1,$2::leadership_packet_source_type,$3,$4,$5,$6,$7,$8,$9,$10,
        $11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,'completed',NULL,$16::jsonb,$17::jsonb
      )
      RETURNING id
    `,
    [
      auth.tenantId,
      input.sourceType,
      input.templateId ?? null,
      input.savedViewId ?? null,
      input.scheduleId ?? null,
      input.runLabel,
      auth.id,
      input.filters.anchorDate,
      input.filters.dateFrom ?? null,
      input.filters.dateTo ?? null,
      JSON.stringify({
        date: input.filters.anchorDate,
        date_from: input.filters.dateFrom ?? null,
        date_to: input.filters.dateTo ?? null,
        department: input.filters.department ?? null
      }),
      JSON.stringify(input.freshness ?? {}),
      JSON.stringify(input.packetPayload.summary_strip),
      JSON.stringify(input.packetPayload),
      input.packetPayload.sections.reduce((count, section) => count + section.exception_rows.length, 0),
      JSON.stringify(input.recipients),
      JSON.stringify({ delivered: false })
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "reporting.packet_run.created",
    entityType: "leadership_packet_run",
    entityId: rows[0].id,
    metadata: {
      source_type: input.sourceType,
      template_id: input.templateId ?? null,
      saved_view_id: input.savedViewId ?? null,
      schedule_id: input.scheduleId ?? null
    }
  });

  return rows[0].id;
}

async function deliverPacketRun(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string | null;
    packetRunId: string;
    title: string;
    dateRangeLabel: string;
    channel: LeadershipDeliveryChannel;
    recipients: Array<{ user_id: string; name: string | null; email: string | null }>;
  }
) {
  const channels = input.channel === "email_link" ? ["in_app", "email"] : ["in_app"];
  for (const recipient of input.recipients) {
    await createAppEvent(client, {
      tenantId: input.tenantId,
      eventType: "notification.dispatch",
      aggregateType: "leadership_packet_run",
      aggregateId: input.packetRunId,
      dedupeKey: `packet-delivery:${input.packetRunId}:${recipient.user_id}:${input.channel}`,
      payload: {
        tenant_id: input.tenantId,
        recipient_user_id: recipient.user_id,
        actor_user_id: input.actorUserId,
        notification_type: "leadership_packet_delivery",
        category: "informational_summary",
        severity: "medium",
        priority: "normal",
        title: input.title,
        body: `${input.dateRangeLabel} packet is ready to review.`,
        deep_link: `#reports?packet_run_id=${input.packetRunId}`,
        action_required: false,
        source_event: "leadership_packet_delivery",
        digest_eligible: false,
        channels
      }
    });
  }

  await client.query(
    `
      UPDATE leadership_packet_run
      SET delivery_result = $2::jsonb
      WHERE id = $1
    `,
    [
      input.packetRunId,
      JSON.stringify({
        delivered: true,
        channel: input.channel,
        recipient_count: input.recipients.length,
        delivered_at: new Date().toISOString()
      })
    ]
  );
}

async function buildReportFiltersFromSavedView(anchorDate: string, view: ReportingSavedViewRecord): Promise<LeadershipReportFilters> {
  const range = resolveWindowRange(anchorDate, view.window, view.date_from, view.date_to);
  return {
    anchorDate,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    department: view.department ?? null
  };
}

export async function runLeadershipPacketTemplateNow(
  client: PoolClient,
  auth: AuthUser,
  templateId: string,
  input: {
    anchorDate: string;
    dateFrom?: string | null;
    dateTo?: string | null;
    scheduleId?: string | null;
    recipients?: string[];
    channel?: LeadershipDeliveryChannel | null;
  }
) {
  assertCanViewDecisionDelivery(auth);
  const template = mapPacketTemplateRow(await getPacketTemplateRow(client, auth, templateId));
  const range = resolveWindowRange(input.anchorDate, template.default_window, input.dateFrom ?? null, input.dateTo ?? null);
  const filters: LeadershipReportFilters = {
    anchorDate: input.anchorDate,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    department: template.department_code ?? null
  };
  const details = [] as LeadershipReportDetail[];
  for (const section of template.section_config.filter((candidate) => candidate.enabled !== false)) {
    details.push(await getLeadershipReport(client, auth, section.report_id, filters));
  }
  const packetPayload = await buildPacketFromReports({
    title: template.name,
    audience: template.audience,
    dateRangeLabel: formatDateRangeLabel(filters.dateFrom ?? null, filters.dateTo ?? null, template.default_window),
    runTimestamp: new Date().toISOString(),
    details
  });
  const recipients = await loadRecipientSnapshot(client, auth.tenantId, input.recipients ?? [auth.id]);
  const runId = await createPacketRunRecord(client, auth, {
    sourceType: "packet_template",
    templateId: template.id,
    scheduleId: input.scheduleId ?? null,
    runLabel: template.name,
    filters,
    packetPayload,
    freshness: details.find((detail) => detail.freshness)?.freshness ?? details[0]?.freshness ?? null,
    recipients
  });
  if (input.channel) {
    await deliverPacketRun(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      packetRunId: runId,
      title: template.name,
      dateRangeLabel: packetPayload.date_range_label,
      channel: input.channel,
      recipients
    });
  }
  return getLeadershipPacketRun(client, auth, runId);
}

export async function runLeadershipSavedViewPacketNow(
  client: PoolClient,
  auth: AuthUser,
  savedViewId: string,
  input: {
    anchorDate: string;
    scheduleId?: string | null;
    recipients?: string[];
    channel?: LeadershipDeliveryChannel | null;
  }
) {
  assertCanViewDecisionDelivery(auth);
  const savedView = mapSavedViewRow(await getSavedViewRow(client, auth, savedViewId));
  if (savedView.source_module !== "reporting_dashboard" || !savedView.report_id) {
    throw new ApiError(409, "Only reporting-dashboard saved views can be turned into leadership packets right now");
  }
  const filters = await buildReportFiltersFromSavedView(input.anchorDate, savedView);
  const detail = await getLeadershipReport(client, auth, savedView.report_id, filters);
  const packetPayload = await buildPacketFromReports({
    title: savedView.label,
    audience: "Saved summary view",
    dateRangeLabel: formatDateRangeLabel(filters.dateFrom ?? null, filters.dateTo ?? null, savedView.window),
    runTimestamp: new Date().toISOString(),
    details: [detail]
  });
  const recipients = await loadRecipientSnapshot(client, auth.tenantId, input.recipients ?? [auth.id]);
  const runId = await createPacketRunRecord(client, auth, {
    sourceType: "saved_view",
    savedViewId: savedView.id,
    scheduleId: input.scheduleId ?? null,
    runLabel: savedView.label,
    filters,
    packetPayload,
    freshness: detail.freshness ?? null,
    recipients
  });
  if (input.channel) {
    await deliverPacketRun(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      packetRunId: runId,
      title: savedView.label,
      dateRangeLabel: packetPayload.date_range_label,
      channel: input.channel,
      recipients
    });
  }
  return getLeadershipPacketRun(client, auth, runId);
}

export async function listLeadershipPacketRuns(client: PoolClient, auth: AuthUser) {
  assertCanViewDecisionDelivery(auth);
  return listPacketRunRows(client, auth);
}

export async function getLeadershipPacketRun(client: PoolClient, auth: AuthUser, packetRunId: string) {
  assertCanViewDecisionDelivery(auth);
  const runs = await listPacketRunRows(client, auth);
  const run = runs.find((candidate) => candidate.id === packetRunId) ?? null;
  if (!run) {
    throw new ApiError(404, "Leadership packet run not found");
  }
  return run;
}

export async function exportLeadershipPacketRunPdf(client: PoolClient, auth: AuthUser, packetRunId: string) {
  assertCanExportDecisionDelivery(auth);
  const run = await getLeadershipPacketRun(client, auth, packetRunId);
  if (!run.packet_payload) {
    throw new ApiError(409, "That packet run does not contain a printable payload");
  }
  return buildPacketPdfBuffer(run.packet_payload);
}

export async function listReportingExportJobs(client: PoolClient, auth: AuthUser) {
  assertCanViewDecisionDelivery(auth);
  return listExportJobRows(client, auth);
}

export async function runTrackedLeadershipReportExport(
  client: PoolClient,
  auth: AuthUser,
  input: {
    reportId: CanonicalLeadershipReportId | string;
    format: "csv" | "pdf";
    filters: LeadershipReportFilters;
    savedViewId?: string | null;
  }
) {
  assertCanExportDecisionDelivery(auth);
  const detail = await getLeadershipReport(client, auth, input.reportId as CanonicalLeadershipReportId, input.filters);
  const exportName = `${detail.title} ${input.format.toUpperCase()}`;
  const insert = await client.query<{ id: string }>(
    `
      INSERT INTO report_export_job (
        tenant_id,
        source_module,
        report_id,
        saved_view_id,
        requested_by_user_id,
        export_name,
        format,
        status,
        filter_state,
        freshness_snapshot,
        requested_at
      )
      VALUES ($1,'reporting_dashboard',$2,$3,$4,$5,$6::report_export_format,'requested',$7::jsonb,$8::jsonb,now())
      RETURNING id
    `,
    [
      auth.tenantId,
      input.reportId,
      input.savedViewId ?? null,
      auth.id,
      exportName,
      input.format,
      JSON.stringify({
        date_range_label: formatDateRangeLabel(input.filters.dateFrom ?? null, input.filters.dateTo ?? null, null),
        department: input.filters.department ?? "All Departments"
      }),
      JSON.stringify(detail.freshness ?? {})
    ]
  );
  const exportJobId = insert.rows[0].id;

  try {
    const payload =
      input.format === "csv"
        ? await exportLeadershipReportCsv(client, auth, input.reportId as CanonicalLeadershipReportId, input.filters)
        : await exportLeadershipReportPdf(client, auth, input.reportId as CanonicalLeadershipReportId, input.filters);

    await client.query(
      `
        UPDATE report_export_job
        SET status = 'completed',
            record_count = $2,
            file_reference = $3,
            completed_at = now()
        WHERE id = $1
      `,
      [
        exportJobId,
        (detail.drilldown_sections ?? detail.sections ?? []).reduce((count, section) => count + (section.rows?.length ?? 0), 0),
        input.format === "csv" ? `/api/dashboard/reports/${input.reportId}/export.csv` : `/api/dashboard/reports/${input.reportId}/export.pdf`
      ]
    );

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: "reporting.export.completed",
      entityType: "report_export_job",
      entityId: exportJobId,
      metadata: {
        report_id: input.reportId,
        format: input.format
      }
    });

    return {
      exportJobId,
      payload
    };
  } catch (error) {
    await client.query(
      `
        UPDATE report_export_job
        SET status = 'failed',
            error_message = $2,
            completed_at = now()
        WHERE id = $1
      `,
      [exportJobId, error instanceof Error ? error.message : "Export failed"]
    );
    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: "reporting.export.failed",
      entityType: "report_export_job",
      entityId: exportJobId,
      metadata: {
        report_id: input.reportId,
        format: input.format
      },
      resultStatus: "failed"
    });
    throw error;
  }
}

export async function createLeadershipDeliverySchedule(client: PoolClient, auth: AuthUser, input: DeliveryScheduleInput) {
  assertCanManageTemplates(auth);
  const nextRunAt = computeNextRunAt({
    cadence: input.cadence,
    dayOfWeek: input.day_of_week ?? 1,
    hourLocal: input.hour_local,
    minuteLocal: input.minute_local,
    timeZone: input.timezone
  });

  if (input.source_type === "packet_template" && !input.template_id) {
    throw new ApiError(400, "Packet template is required for that delivery schedule");
  }
  if (input.source_type === "saved_view" && !input.saved_view_id) {
    throw new ApiError(400, "Saved view is required for that delivery schedule");
  }

  const recipients = [...new Set(input.recipient_user_ids.length ? input.recipient_user_ids : [auth.id])];

  const { rows } = await client.query<DeliveryScheduleRow>(
    `
      INSERT INTO leadership_delivery_schedule (
        tenant_id,
        owner_user_id,
        label,
        source_type,
        template_id,
        saved_view_id,
        cadence,
        day_of_week,
        hour_local,
        minute_local,
        timezone,
        delivery_channel,
        recipient_user_ids,
        active_status,
        next_run_at,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4::leadership_packet_source_type,$5,$6,$7::leadership_delivery_cadence,$8,$9,$10,$11,$12::leadership_delivery_channel,$13::jsonb,$14,$15,now()
      )
      RETURNING
        id,
        label,
        source_type::text AS source_type,
        template_id,
        NULL::text AS template_name,
        saved_view_id,
        NULL::text AS saved_view_name,
        cadence::text AS cadence,
        day_of_week,
        hour_local,
        minute_local,
        timezone,
        delivery_channel::text AS delivery_channel,
        ARRAY(
          SELECT jsonb_array_elements_text(recipient_user_ids)
        )::text[] AS recipient_user_ids,
        active_status,
        last_run_at::text AS last_run_at,
        next_run_at::text AS next_run_at,
        last_status,
        last_error,
        updated_at::text AS updated_at
    `,
    [
      auth.tenantId,
      auth.id,
      input.label.trim(),
      input.source_type,
      input.template_id ?? null,
      input.saved_view_id ?? null,
      input.cadence,
      input.day_of_week ?? 1,
      input.hour_local,
      input.minute_local,
      input.timezone,
      input.delivery_channel,
      JSON.stringify(recipients),
      input.active_status ?? true,
      nextRunAt
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "reporting.delivery_schedule.created",
    entityType: "leadership_delivery_schedule",
    entityId: rows[0].id
  });

  const recipientSnapshot = await loadRecipientSnapshot(client, auth.tenantId, recipients);
  return mapDeliveryScheduleRow(rows[0], recipientSnapshot);
}

export async function updateLeadershipDeliverySchedule(
  client: PoolClient,
  auth: AuthUser,
  scheduleId: string,
  input: Partial<DeliveryScheduleInput>
) {
  assertCanManageTemplates(auth);
  const existing = (
    await client.query<DeliveryScheduleRow>(
      `
        SELECT
          lds.id,
          lds.label,
          lds.source_type::text AS source_type,
          lds.template_id,
          lpt.name AS template_name,
          lds.saved_view_id,
          rsv.name AS saved_view_name,
          lds.cadence::text AS cadence,
          lds.day_of_week,
          lds.hour_local,
          lds.minute_local,
          lds.timezone,
          lds.delivery_channel::text AS delivery_channel,
          ARRAY(
            SELECT jsonb_array_elements_text(lds.recipient_user_ids)
          )::text[] AS recipient_user_ids,
          lds.active_status,
          lds.last_run_at::text AS last_run_at,
          lds.next_run_at::text AS next_run_at,
          lds.last_status,
          lds.last_error,
          lds.updated_at::text AS updated_at
        FROM leadership_delivery_schedule lds
        LEFT JOIN leadership_packet_template lpt
          ON lpt.tenant_id = lds.tenant_id
         AND lpt.id = lds.template_id
        LEFT JOIN report_saved_view rsv
          ON rsv.tenant_id = lds.tenant_id
         AND rsv.id = lds.saved_view_id
        WHERE lds.tenant_id = $1
          AND lds.id = $2
      `,
      [auth.tenantId, scheduleId]
    )
  ).rows[0];

  if (!existing) {
    throw new ApiError(404, "Delivery schedule not found");
  }

  const nextRunAt = computeNextRunAt({
    cadence: input.cadence ?? existing.cadence,
    dayOfWeek: input.day_of_week ?? existing.day_of_week,
    hourLocal: input.hour_local ?? existing.hour_local,
    minuteLocal: input.minute_local ?? existing.minute_local,
    timeZone: input.timezone ?? existing.timezone
  });

  const recipients = [...new Set(input.recipient_user_ids ?? existing.recipient_user_ids ?? [auth.id])];

  const { rows } = await client.query<DeliveryScheduleRow>(
    `
      UPDATE leadership_delivery_schedule
      SET label = $2,
          source_type = $3::leadership_packet_source_type,
          template_id = $4,
          saved_view_id = $5,
          cadence = $6::leadership_delivery_cadence,
          day_of_week = $7,
          hour_local = $8,
          minute_local = $9,
          timezone = $10,
          delivery_channel = $11::leadership_delivery_channel,
          recipient_user_ids = $12::jsonb,
          active_status = $13,
          next_run_at = $14,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $15
      RETURNING
        id,
        label,
        source_type::text AS source_type,
        template_id,
        NULL::text AS template_name,
        saved_view_id,
        NULL::text AS saved_view_name,
        cadence::text AS cadence,
        day_of_week,
        hour_local,
        minute_local,
        timezone,
        delivery_channel::text AS delivery_channel,
        ARRAY(
          SELECT jsonb_array_elements_text(recipient_user_ids)
        )::text[] AS recipient_user_ids,
        active_status,
        last_run_at::text AS last_run_at,
        next_run_at::text AS next_run_at,
        last_status,
        last_error,
        updated_at::text AS updated_at
    `,
    [
      auth.tenantId,
      input.label?.trim() ?? existing.label,
      input.source_type ?? existing.source_type,
      input.template_id ?? existing.template_id,
      input.saved_view_id ?? existing.saved_view_id,
      input.cadence ?? existing.cadence,
      input.day_of_week ?? existing.day_of_week,
      input.hour_local ?? existing.hour_local,
      input.minute_local ?? existing.minute_local,
      input.timezone ?? existing.timezone,
      input.delivery_channel ?? existing.delivery_channel,
      JSON.stringify(recipients),
      input.active_status ?? existing.active_status,
      nextRunAt,
      scheduleId
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "reporting.delivery_schedule.updated",
    entityType: "leadership_delivery_schedule",
    entityId: scheduleId
  });

  const recipientSnapshot = await loadRecipientSnapshot(client, auth.tenantId, recipients);
  return mapDeliveryScheduleRow(rows[0], recipientSnapshot);
}

export async function listLeadershipDeliverySchedules(client: PoolClient, auth: AuthUser) {
  assertCanViewDecisionDelivery(auth);
  return listDeliveryScheduleRows(client, auth);
}

export async function runLeadershipDeliveryScheduleNow(client: PoolClient, auth: AuthUser, scheduleId: string) {
  assertCanManageTemplates(auth);
  const schedules = await listDeliveryScheduleRows(client, auth);
  const schedule = schedules.find((candidate) => candidate.id === scheduleId) ?? null;
  if (!schedule) {
    throw new ApiError(404, "Delivery schedule not found");
  }

  const recipientIds = schedule.recipient_snapshot.map((recipient) => recipient.user_id);
  let run: LeadershipPacketRunRecord;
  if (schedule.source_type === "packet_template" && schedule.template_id) {
    run = await runLeadershipPacketTemplateNow(client, auth, schedule.template_id, {
      anchorDate: formatDateOnly(new Date()),
      scheduleId: schedule.id,
      recipients: recipientIds,
      channel: schedule.delivery_channel
    });
  } else if (schedule.saved_view_id) {
    run = await runLeadershipSavedViewPacketNow(client, auth, schedule.saved_view_id, {
      anchorDate: formatDateOnly(new Date()),
      scheduleId: schedule.id,
      recipients: recipientIds,
      channel: schedule.delivery_channel
    });
  } else {
    throw new ApiError(409, "That delivery schedule is missing its source");
  }

  await client.query(
    `
      UPDATE leadership_delivery_schedule
      SET last_run_at = now(),
          next_run_at = $2,
          last_status = 'completed',
          last_error = NULL,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $3
    `,
    [
      auth.tenantId,
      computeNextRunAt({
        cadence: schedule.cadence,
        dayOfWeek: schedule.day_of_week,
        hourLocal: schedule.hour_local,
        minuteLocal: schedule.minute_local,
        timeZone: schedule.timezone
      }),
      schedule.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "reporting.delivery_schedule.run_now",
    entityType: "leadership_delivery_schedule",
    entityId: schedule.id
  });

  return run;
}

export async function processDueLeadershipDeliverySchedules(client: PoolClient, auth: AuthUser) {
  if (!isSupervisorLike(auth)) {
    return [];
  }
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT id
      FROM leadership_delivery_schedule
      WHERE tenant_id = $1
        AND owner_user_id = $2
        AND active_status = true
        AND next_run_at IS NOT NULL
        AND next_run_at <= now()
      ORDER BY next_run_at ASC
      LIMIT 5
    `,
    [auth.tenantId, auth.id]
  );
  const results: LeadershipPacketRunRecord[] = [];
  for (const row of rows) {
    try {
      const run = await runLeadershipDeliveryScheduleNow(client, auth, row.id);
      results.push(run);
    } catch (error) {
      await client.query(
        `
          UPDATE leadership_delivery_schedule
          SET last_status = 'failed',
              last_error = $2,
              updated_at = now()
          WHERE tenant_id = $1
            AND id = $3
        `,
        [auth.tenantId, error instanceof Error ? error.message : "Recurring delivery failed", row.id]
      );
    }
  }
  return results;
}
