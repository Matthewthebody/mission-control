import PDFDocument from "pdfkit";
import { Buffer } from "node:buffer";
import type { PoolClient } from "pg";
import { canExportLeadershipReports, canViewLeadershipReports } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { listComplianceWorkspaceItems } from "./complianceWorkspace.js";
import { getOperationsDashboard } from "./dashboard.js";
import { getAgreementCoverageByOrganizationIds } from "./agreements.js";
import { listIntegrationSyncOperations } from "./integrationSync.js";
import { listShootLocations } from "./locations.js";
import { getProductionProjectHomeSnapshot, listProductionProjects } from "./productionProjects.js";
import {
  buildBigShootReadiness,
  humanizePriorityLabel,
  humanizeProfitabilityFlag,
  importanceRank,
  isBigShootLabel,
  type ShootPriorityLabel
} from "./shootPriority.js";
import { listShoots } from "./shoots.js";
import { listTradeRequests } from "./scheduling.js";
import { listPTORequests } from "./availabilityRequests.js";
import { getZendeskLeadershipSummary, getZendeskLeadershipTrends } from "./zendesk.js";

export const CANONICAL_LEADERSHIP_REPORT_IDS = [
  "executive_overview",
  "shoot_operations_health",
  "staffing_attendance",
  "production_qa_health",
  "customer_relationship_follow_through",
  "location_intelligence_repeat_issues",
  "workflow_compliance_data_quality"
] as const;

export const LEGACY_LEADERSHIP_REPORT_ALIASES = [
  "todays_operations_summary",
  "weekly_labor_summary",
  "attendance_exceptions_report",
  "unfilled_shifts_report",
  "late_no_show_trend",
  "post_shoot_evaluation_summary",
  "location_issue_tracker",
  "big_shoot_readiness_report",
  "calendar_staffing_overview",
  "open_approvals_report",
  "operational_intelligence_report",
  "zendesk_operational_summary",
  "monday_migration_progress_report"
] as const;

export type CanonicalLeadershipReportId = (typeof CANONICAL_LEADERSHIP_REPORT_IDS)[number];
export type LegacyLeadershipReportAliasId = (typeof LEGACY_LEADERSHIP_REPORT_ALIASES)[number];

export type LeadershipReportId = CanonicalLeadershipReportId | LegacyLeadershipReportAliasId;

type ReportTone = "neutral" | "good" | "heads_up" | "action_needed" | "info";
type CsvRow = Record<string, string | number | boolean | null>;
type ShootLikeRow = Awaited<ReturnType<typeof listShoots>>[number];
type ReportLayer = "live_operational_dashboard" | "management_trend_dashboard" | "strategic_seasonal_dashboard";
type ReportFreshnessState = "live" | "recently_updated" | "daily_computed" | "needs_refresh";

export type LeadershipReportFreshness = {
  state: ReportFreshnessState;
  label: string;
  last_updated_at: string;
  data_latency: "live" | "near_real_time" | "daily_computed";
  current_day_may_be_incomplete: boolean;
};

export type LeadershipSavedView = {
  id: string;
  label: string;
  summary: string;
  report_id: CanonicalLeadershipReportId;
  window:
    | "today"
    | "yesterday"
    | "last_7_days"
    | "last_30_days"
    | "last_90_days"
    | "season_to_date"
    | "year_to_date"
    | "custom";
  date_from?: string | null;
  date_to?: string | null;
  department?: string | null;
};

export type LeadershipReportMetric = {
  id?: string;
  label: string;
  value: string | number;
  tone?: ReportTone;
  detail?: string | null;
  definition?: string | null;
  action_hash?: string | null;
};

export type LeadershipReportRow = {
  id: string;
  primary: string;
  secondary?: string | null;
  chips?: Array<{ label: string; tone?: ReportTone }>;
  values?: Array<{ label: string; value: string | number; tone?: ReportTone }>;
  next_action?: string | null;
  action_hash?: string | null;
};

export type LeadershipReportSection = {
  id: string;
  title: string;
  summary?: string | null;
  metrics?: LeadershipReportMetric[];
  rows?: LeadershipReportRow[];
  action_hash?: string | null;
};

export type LeadershipReportDetailPanel = {
  title: string;
  summary?: string | null;
  items: Array<{
    label: string;
    value: string;
    helper?: string | null;
  }>;
};

export type LeadershipReportDetail = {
  id: LeadershipReportId;
  title: string;
  layer?: ReportLayer;
  audience: string;
  formats: {
    onscreen: true;
    pdf: boolean;
    csv: boolean;
  };
  summary_line: string;
  tone: ReportTone;
  leadership_only: boolean;
  generated_at: string;
  freshness?: LeadershipReportFreshness;
  filter_summary?: Array<{ label: string; value: string }>;
  top_summary?: LeadershipReportMetric[];
  trend_cards?: LeadershipReportMetric[];
  exception_sections?: LeadershipReportSection[];
  drilldown_sections?: LeadershipReportSection[];
  detail_panel?: LeadershipReportDetailPanel;
  metrics: LeadershipReportMetric[];
  sections: LeadershipReportSection[];
};

export type LeadershipReportCard = {
  id: CanonicalLeadershipReportId;
  title: string;
  layer: ReportLayer;
  audience: string;
  summary_line: string;
  tone: ReportTone;
  action_needed_count: number;
  default_window:
    | "today"
    | "yesterday"
    | "last_7_days"
    | "last_30_days"
    | "last_90_days"
    | "season_to_date"
    | "year_to_date";
  freshness_state: ReportFreshnessState;
  export_pdf: boolean;
  export_csv: boolean;
};

export type BigShootUpcomingCard = {
  shoot_id: string;
  shoot_code: string;
  title: string;
  shoot_date: string;
  location_label: string;
  priority_label: ShootPriorityLabel;
  priority_display: string;
  readiness_label: "On Track" | "Needs Attention" | "At Risk";
  readiness_reason: string;
  profitability_display: string | null;
  prep_due_label: string | null;
  reason_chips: Array<{ label: string; detail: string }>;
};

export type LeadershipReportsIndex = {
  generated_at: string;
  anchor_date: string;
  freshness: LeadershipReportFreshness;
  summary_strip: LeadershipReportMetric[];
  saved_views: LeadershipSavedView[];
  scheduled_summaries: Array<{
    id: string;
    label: string;
    cadence: string;
    audience: string;
  }>;
  big_shoots_coming_up: {
    summary_line: string;
    items: BigShootUpcomingCard[];
  };
  reports: LeadershipReportCard[];
};

export type LeadershipReportFilters = {
  anchorDate: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  department?: string | null;
};

type LeadershipReportArtifact = {
  detail: LeadershipReportDetail;
  csvRows: CsvRow[];
};

const CANONICAL_REPORT_DEFINITIONS: Array<{
  id: CanonicalLeadershipReportId;
  title: string;
  audience: string;
  layer: ReportLayer;
  csv: boolean;
  pdf: boolean;
  defaultWindow:
    | "today"
    | "yesterday"
    | "last_7_days"
    | "last_30_days"
    | "last_90_days"
    | "season_to_date"
    | "year_to_date";
  freshnessState: ReportFreshnessState;
}> = [
  {
    id: "executive_overview",
    title: "Executive Overview",
    audience: "Leadership and admins",
    layer: "live_operational_dashboard",
    csv: true,
    pdf: true,
    defaultWindow: "last_7_days",
    freshnessState: "live"
  },
  {
    id: "shoot_operations_health",
    title: "Shoot Operations Health",
    audience: "Leadership and managers",
    layer: "management_trend_dashboard",
    csv: true,
    pdf: true,
    defaultWindow: "last_30_days",
    freshnessState: "recently_updated"
  },
  {
    id: "staffing_attendance",
    title: "Staffing and Attendance",
    audience: "Leadership and managers",
    layer: "management_trend_dashboard",
    csv: true,
    pdf: true,
    defaultWindow: "last_30_days",
    freshnessState: "recently_updated"
  },
  {
    id: "production_qa_health",
    title: "Production and QA Health",
    audience: "Leadership, production leads, and admins",
    layer: "live_operational_dashboard",
    csv: true,
    pdf: true,
    defaultWindow: "last_30_days",
    freshnessState: "live"
  },
  {
    id: "customer_relationship_follow_through",
    title: "Customer Relationship and Follow-Through",
    audience: "Leadership, managers, and account owners",
    layer: "strategic_seasonal_dashboard",
    csv: true,
    pdf: true,
    defaultWindow: "last_30_days",
    freshnessState: "recently_updated"
  },
  {
    id: "location_intelligence_repeat_issues",
    title: "Location Intelligence and Repeat Issues",
    audience: "Leadership and managers",
    layer: "strategic_seasonal_dashboard",
    csv: true,
    pdf: true,
    defaultWindow: "last_90_days",
    freshnessState: "recently_updated"
  },
  {
    id: "workflow_compliance_data_quality",
    title: "Workflow Compliance and Data Quality",
    audience: "Leadership, managers, and admins",
    layer: "management_trend_dashboard",
    csv: true,
    pdf: true,
    defaultWindow: "last_30_days",
    freshnessState: "recently_updated"
  }
];

const LEGACY_REPORT_DEFINITIONS: Array<{
  id: LegacyLeadershipReportAliasId;
  title: string;
  audience: string;
  csv: boolean;
  pdf: boolean;
}> = [
  { id: "todays_operations_summary", title: "Today's Operations Summary", audience: "Leadership only", csv: false, pdf: true },
  { id: "weekly_labor_summary", title: "Weekly Labor Summary", audience: "Leadership only", csv: true, pdf: true },
  { id: "attendance_exceptions_report", title: "Attendance Exceptions Report", audience: "Leadership and managers", csv: true, pdf: false },
  { id: "unfilled_shifts_report", title: "Unfilled Shifts Report", audience: "Leadership and staffing managers", csv: true, pdf: false },
  { id: "late_no_show_trend", title: "Late / No-Show Trend", audience: "Leadership only", csv: false, pdf: true },
  { id: "post_shoot_evaluation_summary", title: "Post-Shoot Evaluation Summary", audience: "Leadership and department heads", csv: true, pdf: true },
  { id: "location_issue_tracker", title: "Location Issue Tracker", audience: "Managers, production, leadership", csv: true, pdf: false },
  { id: "big_shoot_readiness_report", title: "Big and Critical Shoot Readiness Report", audience: "Leadership only", csv: false, pdf: true },
  { id: "calendar_staffing_overview", title: "Calendar Staffing Overview", audience: "Leadership and staffing managers", csv: false, pdf: true },
  { id: "open_approvals_report", title: "Open Approvals Report", audience: "Managers and leadership", csv: true, pdf: false },
  { id: "operational_intelligence_report", title: "Operational Intelligence Report", audience: "Leadership and managers", csv: true, pdf: true },
  { id: "zendesk_operational_summary", title: "Zendesk Operational Summary", audience: "Leadership and customer service leaders", csv: false, pdf: true },
  { id: "monday_migration_progress_report", title: "Monday Migration Progress Report", audience: "Leadership only", csv: false, pdf: true }
];

const ALL_REPORT_DEFINITIONS = [...CANONICAL_REPORT_DEFINITIONS, ...LEGACY_REPORT_DEFINITIONS];

function getCanonicalReportDefinition(reportId: CanonicalLeadershipReportId) {
  return CANONICAL_REPORT_DEFINITIONS.find((candidate) => candidate.id === reportId)!;
}

function getReportDefinition(reportId: LeadershipReportId) {
  return ALL_REPORT_DEFINITIONS.find((candidate) => candidate.id === reportId) ?? null;
}

function buildFreshness(state: ReportFreshnessState, lastUpdatedAt = new Date().toISOString()): LeadershipReportFreshness {
  switch (state) {
    case "live":
      return {
        state,
        label: "Live",
        last_updated_at: lastUpdatedAt,
        data_latency: "live",
        current_day_may_be_incomplete: true
      };
    case "recently_updated":
      return {
        state,
        label: "Recently Updated",
        last_updated_at: lastUpdatedAt,
        data_latency: "near_real_time",
        current_day_may_be_incomplete: true
      };
    case "daily_computed":
      return {
        state,
        label: "Daily Computed",
        last_updated_at: lastUpdatedAt,
        data_latency: "daily_computed",
        current_day_may_be_incomplete: false
      };
    default:
      return {
        state,
        label: "Needs Refresh",
        last_updated_at: lastUpdatedAt,
        data_latency: "daily_computed",
        current_day_may_be_incomplete: true
      };
  }
}

function safeRate(numerator: number, denominator: number) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function formatRate(numerator: number, denominator: number) {
  return `${safeRate(numerator, denominator).toFixed(1)}%`;
}

function parseMetricNumber(detail: LeadershipReportDetail, label: string) {
  const metric = detail.metrics.find((candidate) => candidate.label === label);
  if (!metric) {
    return 0;
  }
  if (typeof metric.value === "number") {
    return metric.value;
  }
  const normalized = String(metric.value).replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function humanizeWindow(
  window:
    | "today"
    | "yesterday"
    | "last_7_days"
    | "last_30_days"
    | "last_90_days"
    | "season_to_date"
    | "year_to_date"
    | "custom"
) {
  switch (window) {
    case "today":
      return "Today";
    case "yesterday":
      return "Yesterday";
    case "last_7_days":
      return "Last 7 days";
    case "last_30_days":
      return "Last 30 days";
    case "last_90_days":
      return "Last 90 days";
    case "season_to_date":
      return "Season to date";
    case "year_to_date":
      return "Year to date";
    default:
      return "Custom";
  }
}

function buildFilterSummary(
  filters: LeadershipReportFilters,
  fallbackWindow:
    | "today"
    | "yesterday"
    | "last_7_days"
    | "last_30_days"
    | "last_90_days"
    | "season_to_date"
    | "year_to_date"
) {
  const values: Array<{ label: string; value: string }> = [
    { label: "Anchor", value: formatDateLabel(filters.anchorDate) }
  ];
  if (filters.dateFrom || filters.dateTo) {
    values.push({
      label: "Window",
      value: filters.dateFrom && filters.dateTo
        ? `${formatDateLabel(filters.dateFrom)} to ${formatDateLabel(filters.dateTo)}`
        : filters.dateFrom
          ? `${formatDateLabel(filters.dateFrom)} onward`
          : `Through ${formatDateLabel(filters.dateTo ?? filters.anchorDate)}`
    });
  } else {
    values.push({ label: "Window", value: humanizeWindow(fallbackWindow) });
  }
  if (filters.department) {
    values.push({ label: "Department", value: humanizeLabel(filters.department) });
  }
  return values;
}

function makeMetric(
  input: LeadershipReportMetric & {
    id: string;
  }
): LeadershipReportMetric {
  return input;
}

function buildCanonicalArtifact(input: {
  id: CanonicalLeadershipReportId;
  title: string;
  audience: string;
  summaryLine: string;
  tone: ReportTone;
  generatedAt: string;
  freshnessState: ReportFreshnessState;
  defaultWindow:
    | "today"
    | "yesterday"
    | "last_7_days"
    | "last_30_days"
    | "last_90_days"
    | "season_to_date"
    | "year_to_date";
  filters: LeadershipReportFilters;
  topSummary: LeadershipReportMetric[];
  trendCards: LeadershipReportMetric[];
  exceptionSections: LeadershipReportSection[];
  drilldownSections: LeadershipReportSection[];
  detailPanel: LeadershipReportDetailPanel;
  csvRows: CsvRow[];
  leadershipOnly?: boolean;
}) {
  const definition = getCanonicalReportDefinition(input.id);
  const sections = [...input.exceptionSections, ...input.drilldownSections];
  return {
    detail: {
      id: input.id,
      title: input.title,
      layer: definition.layer,
      audience: input.audience,
      formats: {
        onscreen: true,
        pdf: definition.pdf,
        csv: definition.csv
      },
      summary_line: input.summaryLine,
      tone: input.tone,
      leadership_only: Boolean(input.leadershipOnly),
      generated_at: input.generatedAt,
      freshness: buildFreshness(input.freshnessState, input.generatedAt),
      filter_summary: buildFilterSummary(input.filters, input.defaultWindow),
      top_summary: input.topSummary,
      trend_cards: input.trendCards,
      exception_sections: input.exceptionSections,
      drilldown_sections: input.drilldownSections,
      detail_panel: input.detailPanel,
      metrics: input.topSummary,
      sections
    },
    csvRows: input.csvRows
  } satisfies LeadershipReportArtifact;
}

function buildSavedViews(anchorDate: string): LeadershipSavedView[] {
  const nextWeek = formatDateOnly(addDays(parseDateOnly(anchorDate), 7));
  return [
    {
      id: "executive_weekly_review",
      label: "Executive Weekly Review",
      summary: "Cross-company posture across shoots, staffing, production, and relationship follow-through.",
      report_id: "executive_overview",
      window: "last_7_days"
    },
    {
      id: "today_next_7_days_risk",
      label: "Today and Next 7 Days Risk",
      summary: "Same-day operational risks plus the next week of readiness pressure.",
      report_id: "executive_overview",
      window: "custom",
      date_from: anchorDate,
      date_to: nextWeek
    },
    {
      id: "production_blockers",
      label: "Production Blockers",
      summary: "Blocked, overdue, QA, and release-risk jobs that need intervention.",
      report_id: "production_qa_health",
      window: "last_30_days"
    },
    {
      id: "staffing_fragility",
      label: "Staffing Fragility",
      summary: "Under-minimum coverage, late arrivals, and same-day staffing risk.",
      report_id: "staffing_attendance",
      window: "last_7_days"
    },
    {
      id: "relationship_attention_needed",
      label: "Relationship Attention Needed",
      summary: "Overdue touchpoints, overdue follow-ups, and stale critical contacts.",
      report_id: "customer_relationship_follow_through",
      window: "last_30_days"
    },
    {
      id: "location_issues_to_review",
      label: "Location Issues to Review",
      summary: "Repeat issue locations, stale memory, and setup-photo review gaps.",
      report_id: "location_intelligence_repeat_issues",
      window: "last_90_days"
    }
  ];
}

function assertLeadershipReportView(auth: AuthUser) {
  if (!canViewLeadershipReports(auth)) {
    throw new ApiError(403, "Leadership report access is restricted.");
  }
}

function assertLeadershipReportExport(auth: AuthUser) {
  if (!canExportLeadershipReports(auth)) {
    throw new ApiError(403, "Leadership report export is restricted.");
  }
}

function parseDateOnly(value: string) {
  return new Date(`${value}T12:00:00`);
}

function formatDateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number) {
  const next = new Date(value.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function getWeekBounds(anchorDate: string) {
  const anchor = parseDateOnly(anchorDate);
  const weekday = anchor.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = addDays(anchor, mondayOffset);
  return {
    startDate: formatDateOnly(monday),
    endDate: formatDateOnly(addDays(monday, 6))
  };
}

function toneFromCount(count: number, warningThreshold = 1, actionThreshold = 3): ReportTone {
  if (count >= actionThreshold) {
    return "action_needed";
  }
  if (count >= warningThreshold) {
    return "heads_up";
  }
  return "good";
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) {
    return "Date pending";
  }
  return new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function formatDateTimeLabel(value: string | null | undefined) {
  if (!value) {
    return "Time pending";
  }
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function humanizeLabel(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function locationLabel(row: Pick<ShootLikeRow, "location_name" | "location_address">) {
  return row.location_name?.trim() || row.location_address?.split(",").slice(0, 2).join(", ").trim() || "Location pending";
}

function computeMissingFields(row: ShootLikeRow) {
  const missing: string[] = [];
  if (!row.start_time) {
    missing.push("shoot time");
  }
  if (!row.arrival_time) {
    missing.push("arrival time");
  }
  if (!(row.location_name || row.location_address)) {
    missing.push("location");
  }
  if (!row.lead_name) {
    missing.push("lead assignment");
  }
  if (row.planned_staff_count == null || row.planned_staff_count === 0) {
    missing.push("staffing plan");
  }
  if (row.estimated_drive_minutes == null) {
    missing.push("drive time");
  }
  return missing;
}

function csvEscape(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function buildCsv(rows: CsvRow[]) {
  if (!rows.length) {
    return "";
  }
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header] ?? "")).join(","));
  }
  return lines.join("\n");
}

function collectActionNeededCount(detail: LeadershipReportDetail) {
  return (
    detail.metrics.filter((metric) => metric.tone === "action_needed" || metric.tone === "heads_up").length +
    detail.sections.reduce(
      (sum, section) =>
        sum +
        (section.rows?.filter((row) => row.chips?.some((chip) => chip.tone === "action_needed" || chip.tone === "heads_up")).length ?? 0),
      0
    )
  );
}

async function createPdfBuffer(detail: LeadershipReportDetail) {
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const doc = new PDFDocument({ size: "LETTER", margin: 42 });
    doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text(detail.title);
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor("#4b5563").text(detail.summary_line);
    doc.text(`Generated ${new Date(detail.generated_at).toLocaleString()}`);
    doc.text(detail.audience);
    doc.fillColor("#111827");
    doc.moveDown();

    doc.fontSize(13).text("Key Metrics");
    doc.moveDown(0.3);
    for (const metric of detail.metrics) {
      doc.fontSize(10).text(`${metric.label}: ${metric.value}${metric.detail ? ` | ${metric.detail}` : ""}`);
    }

    for (const section of detail.sections) {
      doc.moveDown();
      doc.fontSize(13).text(section.title);
      if (section.summary) {
        doc.moveDown(0.2);
        doc.fontSize(10).fillColor("#4b5563").text(section.summary);
        doc.fillColor("#111827");
      }
      if (section.metrics?.length) {
        doc.moveDown(0.3);
        for (const metric of section.metrics) {
          doc.fontSize(10).text(`${metric.label}: ${metric.value}${metric.detail ? ` | ${metric.detail}` : ""}`);
        }
      }
      if (section.rows?.length) {
        doc.moveDown(0.3);
        for (const row of section.rows.slice(0, 18)) {
          doc.fontSize(10).text(row.primary);
          if (row.secondary) {
            doc.fontSize(9).fillColor("#4b5563").text(row.secondary, { indent: 12 });
            doc.fillColor("#111827");
          }
          for (const value of row.values ?? []) {
            doc.fontSize(9).text(`${value.label}: ${value.value}`, { indent: 12 });
          }
          if (row.next_action) {
            doc.fontSize(9).text(`Next: ${row.next_action}`, { indent: 12 });
          }
        }
      }
    }

    doc.end();
  });
}

function summarizePriorityRows(rows: ShootLikeRow[]) {
  return rows
    .filter((row) => isBigShootLabel((row.priority_label ?? "standard") as ShootPriorityLabel))
    .sort((left, right) => {
      const priorityDelta = importanceRank((right.priority_label ?? "standard") as ShootPriorityLabel) -
        importanceRank((left.priority_label ?? "standard") as ShootPriorityLabel);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return String(left.shoot_date ?? "").localeCompare(String(right.shoot_date ?? ""));
    });
}

function buildBigShootQueue(rows: ShootLikeRow[], anchorDate: string): BigShootUpcomingCard[] {
  return summarizePriorityRows(rows)
    .slice(0, 6)
    .map((row) => {
      const readiness = buildBigShootReadiness({
        shootDate: row.shoot_date ?? null,
        priorityLabel: row.priority_label ?? "standard",
        missingFields: computeMissingFields(row),
        underStaffed: Number(row.scheduled_employee_count ?? 0) < Number(row.planned_staff_count ?? 0),
        missingLead: Number(row.lead_coverage_count ?? 0) < Math.max(Number(row.required_lead_count ?? 1), 1),
        openAlertCount: Number(row.open_alert_count ?? 0),
        conflictWarningCount: Number(row.conflict_warning_count ?? 0),
        todayDate: anchorDate
      });
      return {
        shoot_id: String(row.id),
        shoot_code: String(row.shoot_code),
        title: String(row.title),
        shoot_date: String(row.shoot_date ?? anchorDate),
        location_label: locationLabel(row),
        priority_label: row.priority_label ?? "standard",
        priority_display: humanizePriorityLabel((row.priority_label ?? "standard") as ShootPriorityLabel),
        readiness_label: readiness.readinessLabel,
        readiness_reason: readiness.reason,
        profitability_display: row.future_profitability_flag ? humanizeProfitabilityFlag(row.future_profitability_flag) : null,
        prep_due_label: readiness.nextPrepReminder ? `${readiness.nextPrepReminder.label} due ${formatDateLabel(readiness.nextPrepReminder.dueDate)}` : null,
        reason_chips: Array.isArray(row.priority_reasons)
          ? row.priority_reasons.slice(0, 4).map((reason: unknown) => ({
              label: String((reason as { label?: string }).label ?? "Priority"),
              detail: String((reason as { detail?: string }).detail ?? "")
            }))
          : []
      };
    });
}

async function buildTodaysOperationsReport(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportArtifact> {
  const shoots = await listShoots(client, { date: filters.anchorDate }, auth);
  const ops = await getOperationsDashboard(client, auth, { date: filters.anchorDate });
  const staffedCount = shoots.filter((row) => Number(row.scheduled_employee_count ?? 0) >= Number(row.planned_staff_count ?? 0)).length;
  const unstaffedCount = shoots.filter((row) => Number(row.scheduled_employee_count ?? 0) < Number(row.planned_staff_count ?? 0)).length;
  const flaggedShoots = summarizePriorityRows(shoots);
  const travelRisks = shoots.filter((row) => Number(row.estimated_drive_minutes ?? 0) >= 45);
  const lateChanges = shoots.filter((row) => ["pending_sync", "sync_warning", "sync_error"].includes(String(row.schedule_sync_state ?? "")));
  const rows = shoots.map((row) => ({
    id: String(row.id),
    primary: `${row.shoot_code} | ${row.title}`,
    secondary: `${locationLabel(row)} | ${formatDateTimeLabel(row.start_time ?? row.arrival_time)}`,
    chips: [
      {
        label: humanizePriorityLabel((row.priority_label ?? "standard") as ShootPriorityLabel),
        tone: (row.priority_label === "critical_shoot" ? "action_needed" : row.priority_label === "big_shoot" ? "heads_up" : "neutral") as ReportTone
      },
      {
        label: Number(row.scheduled_employee_count ?? 0) < Number(row.planned_staff_count ?? 0) ? "Unstaffed" : "Covered",
        tone: (Number(row.scheduled_employee_count ?? 0) < Number(row.planned_staff_count ?? 0) ? "heads_up" : "good") as ReportTone
      },
      {
        label: Number(row.lead_coverage_count ?? 0) < Math.max(Number(row.required_lead_count ?? 1), 1) ? "Missing Lead" : "Lead Ready",
        tone: (Number(row.lead_coverage_count ?? 0) < Math.max(Number(row.required_lead_count ?? 1), 1) ? "action_needed" : "good") as ReportTone
      }
    ],
    values: [
      { label: "Assigned", value: `${Number(row.scheduled_employee_count ?? 0)}/${Number(row.planned_staff_count ?? 0)}` },
      { label: "Alerts", value: Number(row.open_alert_count ?? 0), tone: (Number(row.open_alert_count ?? 0) > 0 ? "heads_up" : "good") as ReportTone },
      { label: "Sync", value: String(row.schedule_sync_state ?? "not_linked") }
    ],
    next_action:
      Number(row.lead_coverage_count ?? 0) < Math.max(Number(row.required_lead_count ?? 1), 1)
        ? "Assign lead coverage"
        : Number(row.scheduled_employee_count ?? 0) < Number(row.planned_staff_count ?? 0)
          ? "Close staffing gap"
          : Number(row.open_alert_count ?? 0) > 0
            ? "Review open alerts"
            : null
  }));

  return {
    detail: {
      id: "todays_operations_summary",
      title: "Today's Operations Summary",
      audience: "Leadership only",
      formats: { onscreen: true, pdf: true, csv: false },
      summary_line:
        shoots.length > 0
          ? `${shoots.length} shoots are in motion today, with ${unstaffedCount} still needing staffing attention and ${flaggedShoots.length} flagged big or critical shoots on the board.`
          : "No shoots are scheduled today.",
      tone: unstaffedCount > 0 || Number(ops.summary.no_shows ?? 0) > 0 ? "heads_up" : "good",
      leadership_only: true,
      generated_at: new Date().toISOString(),
      metrics: [
        { label: "Total shoots today", value: shoots.length, tone: "info" },
        { label: "Staffed", value: staffedCount, tone: staffedCount > 0 ? "good" : "neutral" },
        { label: "Unstaffed", value: unstaffedCount, tone: toneFromCount(unstaffedCount, 1, 3) },
        { label: "Big / critical shoots today", value: flaggedShoots.length, tone: flaggedShoots.length > 0 ? "info" : "neutral" },
        { label: "Weather / travel risks", value: travelRisks.length, tone: toneFromCount(travelRisks.length, 1, 2) },
        {
          label: "Attendance exceptions",
          value: Number(ops.summary.late_warning_count ?? 0) + Number(ops.summary.no_show_suspected_count ?? 0),
          tone: toneFromCount(Number(ops.summary.late_warning_count ?? 0) + Number(ops.summary.no_show_suspected_count ?? 0), 1, 2)
        },
        { label: "Late changes", value: lateChanges.length, tone: toneFromCount(lateChanges.length, 1, 2) }
      ],
      sections: [
        {
          id: "shoots",
          title: "Today's Shoot Posture",
          summary: "Use this list to see which shoots are covered, which are flagged, and where leadership attention should land first.",
          rows
        }
      ]
    },
    csvRows: []
  };
}

async function buildWeeklyLaborReport(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportArtifact> {
  const week = getWeekBounds(filters.anchorDate);
  const ops = await getOperationsDashboard(client, auth, {
    dateFrom: week.startDate,
    dateTo: week.endDate,
    department: filters.department ?? undefined,
    date: ""
  });
  const hoursByDepartment = ops.insights.hours_by_department ?? [];
  const hoursByShoot = ops.insights.hours_by_shoot ?? [];
  const csvRows = (ops.reporting.labor ?? []).map((row) => ({
    employee_name: String(row.assigned_user_name ?? ""),
    department: String(row.department ?? ""),
    manager_name: String(row.manager_name ?? ""),
    shift_count: Number(row.shift_count ?? 0),
    scheduled_hours: Number(row.scheduled_hours ?? 0),
    actual_hours: Number(row.actual_hours ?? 0),
    labor_delta_hours: Number(row.labor_delta_hours ?? 0),
    open_exception_count: Number(row.open_exception_count ?? 0)
  }));

  return {
    detail: {
      id: "weekly_labor_summary",
      title: "Weekly Labor Summary",
      audience: "Leadership only",
      formats: { onscreen: true, pdf: true, csv: true },
      summary_line: `Weekly labor is currently tracking at ${Number(ops.summary.actual_labor_hours ?? 0).toFixed(1)} worked hours against ${Number(ops.summary.scheduled_labor_hours ?? 0).toFixed(1)} scheduled hours.`,
      tone: Number(ops.summary.overtime_risk_count ?? 0) > 0 ? "heads_up" : "good",
      leadership_only: true,
      generated_at: new Date().toISOString(),
      metrics: [
        { label: "Scheduled hours", value: Number(ops.summary.scheduled_labor_hours ?? 0).toFixed(1), tone: "info" },
        { label: "Worked hours", value: Number(ops.summary.actual_labor_hours ?? 0).toFixed(1), tone: "info" },
        { label: "Overtime indicators", value: Number(ops.summary.overtime_risk_count ?? 0), tone: toneFromCount(Number(ops.summary.overtime_risk_count ?? 0), 1, 3) },
        { label: "Fill rate", value: `${Number(ops.summary.fill_rate_percent ?? 0).toFixed(1)}%`, tone: Number(ops.summary.fill_rate_percent ?? 0) < 90 ? "heads_up" : "good" },
        { label: "Trade requests", value: Number(ops.summary.trade_request_count ?? 0), tone: Number(ops.summary.trade_request_count ?? 0) > 0 ? "info" : "neutral" },
        { label: "Setup-to-live lag", value: `${Number(ops.summary.average_setup_to_live_lag_minutes ?? 0).toFixed(1)} min`, tone: Number(ops.summary.average_setup_to_live_lag_minutes ?? 0) > 20 ? "heads_up" : "good" }
      ],
      sections: [
        {
          id: "department_mix",
          title: "Labor Distribution By Department",
          rows: hoursByDepartment.map((row) => ({
            id: row.department,
            primary: String(row.department),
            values: [
              { label: "Scheduled", value: Number(row.scheduled_hours ?? 0).toFixed(1) },
              { label: "Actual", value: Number(row.actual_hours ?? 0).toFixed(1) },
              { label: "Employees", value: Number(row.employee_count ?? 0) }
            ]
          }))
        },
        {
          id: "shoot_mix",
          title: "Hours By Shoot",
          rows: hoursByShoot.slice(0, 12).map((row) => ({
            id: String(row.scope_id),
            primary: `${row.scope_code} | ${row.scope_title}`,
            secondary: String(row.department),
            values: [
              { label: "Scheduled", value: Number(row.scheduled_hours ?? 0).toFixed(1) },
              { label: "Actual", value: Number(row.actual_hours ?? 0).toFixed(1) },
              { label: "Fill Rate", value: `${Number(row.fill_rate_percent ?? 0).toFixed(1)}%`, tone: Number(row.fill_rate_percent ?? 0) < 90 ? "heads_up" : "good" }
            ]
          }))
        }
      ]
    },
    csvRows
  };
}

async function buildAttendanceExceptionsReport(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportArtifact> {
  const week = getWeekBounds(filters.anchorDate);
  const ops = await getOperationsDashboard(client, auth, { dateFrom: week.startDate, dateTo: week.endDate, date: "" });
  const rows = ops.reporting.exceptions ?? [];
  const csvRows = rows.map((row) => ({
    employee_name: String(row.user_name ?? ""),
    manager_name: String(row.manager_name ?? ""),
    department: String(row.department ?? ""),
    shoot_code: String(row.shoot_code ?? ""),
    shift_title: String(row.shift_title ?? ""),
    exception_type: String(row.exception_type ?? ""),
    status: String(row.status ?? ""),
    severity: String(row.severity ?? ""),
    classification: String(row.classification ?? ""),
    requested_approver: String(row.requested_approver_name ?? ""),
    approved_by: String(row.approved_by_name ?? ""),
    created_at: String(row.created_at ?? "")
  }));
  const lateCount = rows.filter((row) => String(row.exception_type ?? "").includes("LATE")).length;
  const noShowCount = rows.filter((row) => String(row.exception_type ?? "") === "NO_SHOW_SUSPECTED").length;
  const missedPunchCount = rows.filter((row) =>
    ["MISSED_CLOCK_IN", "FORGOT_TO_CLOCK_IN", "FORGOT_TO_CLOCK_OUT", "AUTO_CLOSED_SHIFT"].includes(String(row.exception_type ?? ""))
  ).length;
  const geofenceCount = rows.filter((row) => String(row.exception_type ?? "") === "OUTSIDE_GEOFENCE_PUNCH").length;

  return {
    detail: {
      id: "attendance_exceptions_report",
      title: "Attendance Exceptions Report",
      audience: "Leadership and managers",
      formats: { onscreen: true, pdf: false, csv: true },
      summary_line: rows.length ? `${rows.length} attendance exceptions are open or recently active in the current weekly view.` : "No attendance exceptions are active in the current weekly view.",
      tone: rows.length ? toneFromCount(rows.length, 1, 4) : "good",
      leadership_only: true,
      generated_at: new Date().toISOString(),
      metrics: [
        { label: "Late clock-ins", value: lateCount, tone: toneFromCount(lateCount, 1, 3) },
        { label: "No-shows", value: noShowCount, tone: toneFromCount(noShowCount, 1, 2) },
        { label: "Missed punches", value: missedPunchCount, tone: toneFromCount(missedPunchCount, 1, 3) },
        { label: "Geofence exceptions", value: geofenceCount, tone: toneFromCount(geofenceCount, 1, 3) }
      ],
      sections: [
        {
          id: "exceptions",
          title: "Exception Queue",
          rows: rows.slice(0, 40).map((row) => ({
            id: String(row.id),
            primary: `${row.user_name ?? "Employee"} | ${row.exception_type}`,
            secondary: `${row.shift_title ?? "Shift"} | ${row.shoot_code ?? "No shoot"} | ${formatDateTimeLabel(row.created_at)}`,
            chips: [
              { label: String(row.status ?? "open"), tone: String(row.status ?? "") === "open" ? "heads_up" : "neutral" },
              { label: String(row.severity ?? "high"), tone: String(row.severity ?? "") === "critical" ? "action_needed" : "heads_up" }
            ],
            values: [
              { label: "Manager", value: String(row.manager_name ?? "Pending") },
              { label: "Follow-up", value: String(row.approved_by_name ?? row.requested_approver_name ?? "Pending") }
            ]
          }))
        }
      ]
    },
    csvRows
  };
}

async function buildUnfilledShiftsReport(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportArtifact> {
  const upcoming = await listShoots(client, {
    dateFrom: filters.dateFrom ?? filters.anchorDate,
    dateTo: filters.dateTo ?? formatDateOnly(addDays(parseDateOnly(filters.anchorDate), 14))
  }, auth);
  const rows = upcoming
    .filter((row) => Number(row.scheduled_employee_count ?? 0) < Number(row.planned_staff_count ?? 0) || Number(row.lead_coverage_count ?? 0) < Math.max(Number(row.required_lead_count ?? 1), 1))
    .map((row) => {
      const daysUntil = Math.max(0, Math.round((parseDateOnly(String(row.shoot_date ?? filters.anchorDate)).getTime() - parseDateOnly(filters.anchorDate).getTime()) / 86_400_000));
      const missingLead = Number(row.lead_coverage_count ?? 0) < Math.max(Number(row.required_lead_count ?? 1), 1);
      const priority = row.priority_label ?? "standard";
      const escalation =
        priority === "critical_shoot" || isBigShootLabel(priority as ShootPriorityLabel) || missingLead
          ? "Escalate now"
          : daysUntil <= 3
            ? "Escalate this week"
            : "Monitor";
      return { source: row, daysUntil, escalation };
    })
    .sort((left, right) => left.daysUntil - right.daysUntil);

  const csvRows = rows.map(({ source, daysUntil, escalation }) => ({
    shoot_code: String(source.shoot_code),
    title: String(source.title),
    shoot_date: String(source.shoot_date ?? ""),
    location: locationLabel(source),
    assigned_staff_count: Number(source.scheduled_employee_count ?? 0),
    planned_staff_count: Number(source.planned_staff_count ?? 0),
    lead_coverage_count: Number(source.lead_coverage_count ?? 0),
    required_lead_count: Number(source.required_lead_count ?? 1),
    priority: humanizePriorityLabel((source.priority_label ?? "standard") as ShootPriorityLabel),
    days_until_shoot: daysUntil,
    escalation_priority: escalation
  }));

  return {
    detail: {
      id: "unfilled_shifts_report",
      title: "Unfilled Shifts Report",
      audience: "Leadership and staffing managers",
      formats: { onscreen: true, pdf: false, csv: true },
      summary_line: rows.length ? `${rows.length} shoots still have open staffing demand in the current staffing window.` : "No unfilled shifts are waiting in the current staffing window.",
      tone: rows.length ? toneFromCount(rows.length, 1, 4) : "good",
      leadership_only: true,
      generated_at: new Date().toISOString(),
      metrics: [
        { label: "Open shifts", value: rows.length, tone: toneFromCount(rows.length, 1, 4) },
        { label: "Critical missing lead", value: rows.filter((row) => Number(row.source.lead_coverage_count ?? 0) < Math.max(Number(row.source.required_lead_count ?? 1), 1)).length, tone: toneFromCount(rows.filter((row) => Number(row.source.lead_coverage_count ?? 0) < Math.max(Number(row.source.required_lead_count ?? 1), 1)).length, 1, 2) },
        {
          label: "Big / critical shoot impact",
          value: rows.filter((row) => isBigShootLabel((row.source.priority_label ?? "standard") as ShootPriorityLabel)).length,
          tone: rows.filter((row) => isBigShootLabel((row.source.priority_label ?? "standard") as ShootPriorityLabel)).length > 0 ? "heads_up" : "good"
        }
      ],
      sections: [
        {
          id: "unfilled",
          title: "Open Coverage Queue",
          rows: rows.slice(0, 30).map(({ source, daysUntil, escalation }) => ({
            id: String(source.id),
            primary: `${source.shoot_code} | ${source.title}`,
            secondary: `${formatDateLabel(source.shoot_date)} | ${locationLabel(source)}`,
            chips: [
              {
                label: humanizePriorityLabel((source.priority_label ?? "standard") as ShootPriorityLabel),
                tone: source.priority_label === "critical_shoot" ? "action_needed" : source.priority_label === "big_shoot" ? "heads_up" : "neutral"
              },
              { label: Number(source.lead_coverage_count ?? 0) < Math.max(Number(source.required_lead_count ?? 1), 1) ? "Missing Lead" : "Lead Ready", tone: Number(source.lead_coverage_count ?? 0) < Math.max(Number(source.required_lead_count ?? 1), 1) ? "action_needed" : "good" }
            ],
            values: [
              { label: "Assigned", value: `${Number(source.scheduled_employee_count ?? 0)}/${Number(source.planned_staff_count ?? 0)}` },
              { label: "Days Out", value: daysUntil },
              { label: "Escalation", value: escalation, tone: escalation === "Escalate now" ? "action_needed" : escalation === "Escalate this week" ? "heads_up" : "neutral" }
            ],
            next_action: escalation
          }))
        }
      ]
    },
    csvRows
  };
}

function getDateWindow(filters: LeadershipReportFilters, defaultDays = 30) {
  const endDate = filters.dateTo ?? filters.anchorDate;
  const startDate =
    filters.dateFrom ??
    formatDateOnly(addDays(parseDateOnly(endDate), -(Math.max(defaultDays, 1) - 1)));
  return { startDate, endDate };
}

function startsWithAny(value: string, prefixes: string[]) {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function summarizeTextPhrases(values: Array<string | null | undefined>, limit = 5) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) {
      continue;
    }
    for (const phrase of value
      .split(/[.;\n]/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 8)) {
      const normalized = phrase.replace(/\s+/g, " ").trim();
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([text, count]) => ({
      text,
      count
    }));
}

type EvaluationSummaryRow = {
  id: string;
  shoot_id: string | null;
  location_id: string;
  location_name: string;
  shoot_name: string;
  shoot_date: string;
  photographer_name: string;
  shoot_type: string;
  overall_rating: number;
  on_time: string;
  easy_access: string;
  photos_uploaded: string;
  late_details: string | null;
  access_details: string | null;
  notes: string | null;
  recommendations: string | null;
  next_time_recommendation: string | null;
  created_at: string;
  submit_for_mileage?: boolean;
  vehicle_type?: string | null;
  overall_outcome: string | null;
  staffing_fit: string | null;
  setup_difficulty: string | null;
  customer_school_readiness: string | null;
  data_roster_readiness: string | null;
  equipment_workflow_issue: string | null;
  follow_up_required: boolean | null;
  major_issue_flag: boolean | null;
  location_memory_update_suggested: boolean | null;
  leadership_review_needed: boolean | null;
};

type MileageSummaryRow = {
  id: string;
  work_date: string;
  employee_name: string;
  shoot_code: string | null;
  shoot_title: string | null;
  location_name: string | null;
  zone_name: string | null;
  reimbursement_amount: string;
  vehicle_type: string | null;
  status: string;
  review_reason_code: string | null;
};

async function loadEvaluationSummaryRows(client: PoolClient, auth: AuthUser, startDate: string, endDate: string) {
  const { rows } = await client.query<EvaluationSummaryRow>(
    `
      SELECT
        pse.id,
        pse.shoot_id,
        pse.location_id,
        sl.name AS location_name,
        pse.shoot_name,
        pse.shoot_date::text AS shoot_date,
        pse.photographer_name,
        pse.shoot_type,
        pse.overall_rating,
        pse.on_time,
        pse.easy_access,
        pse.photos_uploaded,
        pse.late_details,
        pse.access_details,
        pse.notes,
        pse.recommendations,
        pse.next_time_recommendation,
        pse.created_at::text AS created_at,
        pse.submit_for_mileage,
        pse.vehicle_type::text AS vehicle_type,
        pse.overall_outcome::text AS overall_outcome,
        pse.staffing_fit::text AS staffing_fit,
        pse.setup_difficulty::text AS setup_difficulty,
        pse.customer_school_readiness::text AS customer_school_readiness,
        pse.data_roster_readiness::text AS data_roster_readiness,
        pse.equipment_workflow_issue::text AS equipment_workflow_issue,
        pse.follow_up_required,
        pse.major_issue_flag,
        pse.location_memory_update_suggested,
        pse.leadership_review_needed
      FROM post_shoot_evaluation pse
      JOIN shoot_location sl ON sl.id = pse.location_id
      WHERE pse.tenant_id = $1
        AND pse.shoot_date >= $2::date
        AND pse.shoot_date <= $3::date
      ORDER BY pse.shoot_date DESC, pse.created_at DESC
    `,
    [auth.tenantId, startDate, endDate]
  );
  return rows;
}

async function loadMileageSummaryRows(client: PoolClient, auth: AuthUser, startDate: string, endDate: string) {
  const { rows } = await client.query<MileageSummaryRow>(
    `
      SELECT
        mr.id,
        mr.work_date::text,
        employee.full_name AS employee_name,
        s.shoot_code,
        s.title AS shoot_title,
        sl.name AS location_name,
        mr.zone_name,
        mr.reimbursement_amount::text,
        mr.vehicle_type::text AS vehicle_type,
        mr.status::text AS status,
        mr.review_reason_code::text AS review_reason_code
      FROM mileage_reimbursement mr
      JOIN app_user employee
        ON employee.id = mr.employee_id
      LEFT JOIN shoot s
        ON s.id = mr.linked_shoot_id
      LEFT JOIN shoot_location sl
        ON sl.id = mr.location_id
      WHERE mr.tenant_id = $1
        AND mr.work_date >= $2::date
        AND mr.work_date <= $3::date
      ORDER BY mr.work_date DESC, employee.full_name ASC
    `,
    [auth.tenantId, startDate, endDate]
  );
  return rows;
}

async function buildLateNoShowTrendReport(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportArtifact> {
  const range = getDateWindow(filters, 28);
  const ops = await getOperationsDashboard(client, auth, {
    dateFrom: range.startDate,
    dateTo: range.endDate,
    department: filters.department ?? undefined,
    date: ""
  });
  const trends = ops.insights?.labor_exceptions_trend ?? [];
  const reliability = ops.insights?.attendance_reliability_by_employee ?? [];
  const lateTotal = trends.reduce((sum, row) => sum + Number(row.late_count ?? 0), 0);
  const noShowTotal = reliability.reduce((sum, row) => sum + Number(row.no_show_count ?? 0), 0);
  const repeatRows = reliability
    .filter((row) => Number(row.late_count ?? 0) > 0 || Number(row.no_show_count ?? 0) > 0 || Number(row.missed_punch_count ?? 0) > 0)
    .sort(
      (left, right) =>
        Number(right.no_show_count ?? 0) - Number(left.no_show_count ?? 0) ||
        Number(right.late_count ?? 0) - Number(left.late_count ?? 0) ||
        Number(right.missed_punch_count ?? 0) - Number(left.missed_punch_count ?? 0)
    );

  return {
    detail: {
      id: "late_no_show_trend",
      title: "Late / No-Show Trend",
      audience: "Leadership only",
      formats: { onscreen: true, pdf: true, csv: false },
      summary_line:
        trends.length || repeatRows.length
          ? `Late and no-show behavior is being tracked across the last ${Math.max(1, Math.round((parseDateOnly(range.endDate).getTime() - parseDateOnly(range.startDate).getTime()) / 86_400_000) + 1)} days, with repeat patterns surfaced first.`
          : "No late or no-show trend data is available in the current range.",
      tone: noShowTotal > 0 ? "action_needed" : lateTotal > 0 ? "heads_up" : "good",
      leadership_only: true,
      generated_at: new Date().toISOString(),
      metrics: [
        { label: "Late clock-ins", value: lateTotal, tone: toneFromCount(lateTotal, 1, 4) },
        { label: "No-shows", value: noShowTotal, tone: toneFromCount(noShowTotal, 1, 2) },
        {
          label: "Repeat patterns",
          value: repeatRows.filter((row) => Number(row.no_show_count ?? 0) > 0 || Number(row.late_count ?? 0) >= 2).length,
          tone: toneFromCount(repeatRows.filter((row) => Number(row.no_show_count ?? 0) > 0 || Number(row.late_count ?? 0) >= 2).length, 1, 3)
        }
      ],
      sections: [
        {
          id: "trend",
          title: "Trend Buckets",
          rows: trends.map((row) => ({
            id: row.bucket_label,
            primary: row.bucket_label,
            values: [
              { label: "Late", value: Number(row.late_count ?? 0), tone: Number(row.late_count ?? 0) > 0 ? "heads_up" : "good" },
              { label: "Missed", value: Number(row.missed_punch_count ?? 0), tone: Number(row.missed_punch_count ?? 0) > 0 ? "heads_up" : "good" },
              { label: "No-show", value: Number(row.no_show_count ?? 0), tone: Number(row.no_show_count ?? 0) > 0 ? "action_needed" : "good" },
              { label: "Geofence", value: Number(row.outside_geofence_count ?? 0), tone: Number(row.outside_geofence_count ?? 0) > 0 ? "info" : "neutral" }
            ]
          }))
        },
        {
          id: "repeaters",
          title: "Repeat Patterns",
          summary: "Employee-level repeat patterns stay leadership-only because they can become disciplinary context.",
          rows: repeatRows.slice(0, 20).map((row) => ({
            id: row.assigned_user_id,
            primary: row.assigned_user_name,
            secondary: row.department,
            values: [
              { label: "Late", value: Number(row.late_count ?? 0), tone: Number(row.late_count ?? 0) >= 2 ? "heads_up" : "neutral" },
              { label: "Missed", value: Number(row.missed_punch_count ?? 0), tone: Number(row.missed_punch_count ?? 0) > 0 ? "heads_up" : "neutral" },
              { label: "No-show", value: Number(row.no_show_count ?? 0), tone: Number(row.no_show_count ?? 0) > 0 ? "action_needed" : "neutral" },
              { label: "Reliability", value: row.reliability_score, tone: Number(row.reliability_score ?? 0) < 80 ? "heads_up" : "good" }
            ]
          }))
        }
      ]
    },
    csvRows: []
  };
}

async function buildPostShootEvaluationSummaryReport(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportArtifact> {
  const range = getDateWindow(filters, 30);
  const evaluations = await loadEvaluationSummaryRows(client, auth, range.startDate, range.endDate);
  const mileageRows = await loadMileageSummaryRows(client, auth, range.startDate, range.endDate);
  const shoots = await listShoots(client, { dateFrom: range.startDate, dateTo: range.endDate }, auth);
  const evaluatedShootKeys = new Set(
    evaluations.map((row) => row.shoot_id ?? `${row.shoot_name}:${row.shoot_date}`)
  );
  const completionRate = shoots.length
    ? Number(((evaluatedShootKeys.size / Math.max(shoots.length, 1)) * 100).toFixed(1))
    : 0;
  const positiveThemes = summarizeTextPhrases(evaluations.map((row) => row.recommendations), 6);
  const recurringIssues = summarizeTextPhrases(
    evaluations.flatMap((row) => [row.late_details, row.access_details, row.notes]),
    6
  );
  const mileageCandidateCount = mileageRows.filter((row) => row.status === "candidate").length;
  const mileageReviewCount = mileageRows.filter((row) => row.status === "review_required").length;
  const mileageCandidateAmount = Number(
    mileageRows
      .filter((row) => row.status === "candidate")
      .reduce((sum, row) => sum + Number(row.reimbursement_amount ?? 0), 0)
      .toFixed(2)
  );
  const csvRows = evaluations.map((row) => ({
    shoot_date: row.shoot_date,
    shoot_name: row.shoot_name,
    location_name: row.location_name,
    photographer_name: row.photographer_name,
    shoot_type: row.shoot_type,
    overall_rating: row.overall_rating,
    on_time: row.on_time,
    easy_access: row.easy_access,
    photos_uploaded: row.photos_uploaded,
    submit_for_mileage: Boolean(row.submit_for_mileage),
    vehicle_type: row.vehicle_type ?? "",
    recommendations: row.recommendations ?? "",
    notes: row.notes ?? ""
  }));

  return {
    detail: {
      id: "post_shoot_evaluation_summary",
      title: "Post-Shoot Evaluation Summary",
      audience: "Leadership and department heads",
      formats: { onscreen: true, pdf: true, csv: true },
      summary_line: evaluations.length
        ? `${evaluations.length} post-shoot evaluations were captured in the current range, covering ${completionRate}% of shoots on the board.`
        : "No post-shoot evaluations were captured in the current range.",
      tone: evaluations.length ? (completionRate < 60 ? "heads_up" : "good") : "neutral",
      leadership_only: true,
      generated_at: new Date().toISOString(),
      metrics: [
        { label: "Evaluation completion rate", value: `${completionRate}%`, tone: completionRate < 60 ? "heads_up" : "good" },
        {
          label: "Average rating",
          value: evaluations.length ? (evaluations.reduce((sum, row) => sum + Number(row.overall_rating ?? 0), 0) / evaluations.length).toFixed(1) : "0.0",
          tone: evaluations.length && evaluations.reduce((sum, row) => sum + Number(row.overall_rating ?? 0), 0) / evaluations.length < 4 ? "heads_up" : "good"
        },
        { label: "Unresolved follow-ups", value: recurringIssues.length, tone: toneFromCount(recurringIssues.length, 1, 4) },
        { label: "Mileage candidates", value: mileageCandidateCount, tone: mileageCandidateCount > 0 ? "info" : "neutral" },
        { label: "Mileage review required", value: mileageReviewCount, tone: toneFromCount(mileageReviewCount, 1, 3) }
      ],
      sections: [
        {
          id: "positive_themes",
          title: "Top Positive Themes",
          rows: positiveThemes.map((theme, index) => ({
            id: `positive-${index + 1}`,
            primary: theme.text,
            values: [{ label: "Mentions", value: theme.count, tone: "good" }]
          }))
        },
        {
          id: "recurring_issues",
          title: "Recurring Issues",
          rows: recurringIssues.map((issue, index) => ({
            id: `issue-${index + 1}`,
            primary: issue.text,
            values: [{ label: "Mentions", value: issue.count, tone: issue.count >= 2 ? "heads_up" : "neutral" }]
          }))
        },
        {
          id: "recent_evals",
          title: "Recent Evaluations",
          rows: evaluations.slice(0, 20).map((row) => ({
            id: row.id,
            primary: `${row.shoot_name} | ${row.location_name}`,
            secondary: `${formatDateLabel(row.shoot_date)} | ${row.photographer_name}`,
            values: [
              { label: "Rating", value: `${row.overall_rating}/5`, tone: row.overall_rating <= 3 ? "heads_up" : "good" },
              { label: "On Time", value: row.on_time, tone: row.on_time === "No" ? "heads_up" : "good" },
              { label: "Easy Access", value: row.easy_access, tone: row.easy_access === "No" ? "heads_up" : "good" }
            ],
            next_action: row.recommendations ? "Carry recommendations into the next prep pass" : null
          }))
        },
        {
          id: "mileage_visibility",
          title: "Mileage Visibility",
          summary: mileageRows.length
            ? `Candidate mileage in the current range totals $${mileageCandidateAmount.toFixed(2)}.`
            : "No mileage review rows are present in the current range.",
          rows: mileageRows.slice(0, 20).map((row) => ({
            id: row.id,
            primary: `${row.employee_name} | ${row.shoot_code ?? row.shoot_title ?? "Mileage day"}`,
            secondary: `${formatDateLabel(row.work_date)} | ${row.location_name ?? "Location pending"}`,
            values: [
              { label: "Status", value: humanizeLabel(row.status), tone: row.status === "review_required" ? "heads_up" : row.status === "candidate" ? "good" : "neutral" },
              { label: "Zone", value: row.zone_name ?? "Pending review" },
              { label: "Amount", value: `$${Number(row.reimbursement_amount ?? 0).toFixed(2)}` }
            ],
            next_action: row.review_reason_code ? `Review: ${humanizeLabel(row.review_reason_code)}` : null
          }))
        }
      ]
    },
    csvRows
  };
}

async function buildLocationIssueTrackerReport(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportArtifact> {
  const range = getDateWindow(filters, 45);
  const evaluations = await loadEvaluationSummaryRows(client, auth, range.startDate, range.endDate);
  const locations = await listShootLocations(client, auth, { sort: "alpha" });
  const issuesByLocation = new Map<
    string,
    {
      locationId: string;
      locationName: string;
      issueCount: number;
      blockerCount: number;
      latestDate: string;
      issueTexts: string[];
      avgRating: number | null;
      setupPhotoCount: number;
    }
  >();
  for (const row of evaluations) {
    const issueTexts = [row.late_details, row.access_details, row.notes].filter((value): value is string => Boolean(value));
    const blockerCount = [row.on_time === "No", row.easy_access === "No", row.overall_rating <= 3].filter(Boolean).length;
    if (!issueTexts.length && blockerCount === 0) {
      continue;
    }
    const existing = issuesByLocation.get(row.location_id);
    const locationSummary = locations.locations.find((location) => location.id === row.location_id);
    if (existing) {
      existing.issueCount += Math.max(issueTexts.length, blockerCount, 1);
      existing.blockerCount += blockerCount;
      existing.latestDate = existing.latestDate > row.shoot_date ? existing.latestDate : row.shoot_date;
      existing.issueTexts.push(...issueTexts);
    } else {
      issuesByLocation.set(row.location_id, {
        locationId: row.location_id,
        locationName: row.location_name,
        issueCount: Math.max(issueTexts.length, blockerCount, 1),
        blockerCount,
        latestDate: row.shoot_date,
        issueTexts,
        avgRating: locationSummary?.stats.avg_rating ?? null,
        setupPhotoCount: locationSummary?.stats.setup_photo_count ?? 0
      });
    }
  }
  const rows = [...issuesByLocation.values()]
    .sort((left, right) => right.blockerCount - left.blockerCount || right.issueCount - left.issueCount)
    .slice(0, 30);
  const csvRows = rows.map((row) => ({
    location_name: row.locationName,
    latest_issue_date: row.latestDate,
    issue_count: row.issueCount,
    blocker_count: row.blockerCount,
    average_rating: row.avgRating ?? "",
    setup_photos: row.setupPhotoCount,
    watchouts: summarizeTextPhrases(row.issueTexts, 3)
      .map((item) => item.text)
      .join(" | ")
  }));

  return {
    detail: {
      id: "location_issue_tracker",
      title: "Location Issue Tracker",
      audience: "Managers, production, leadership",
      formats: { onscreen: true, pdf: false, csv: true },
      summary_line: rows.length
        ? `${rows.length} locations show repeat friction signals in the current review window.`
        : "No recurring location friction surfaced in the current review window.",
      tone: rows.some((row) => row.blockerCount > 0) ? "heads_up" : "good",
      leadership_only: false,
      generated_at: new Date().toISOString(),
      metrics: [
        { label: "Locations with repeat issues", value: rows.length, tone: toneFromCount(rows.length, 1, 4) },
        { label: "Locations with blockers", value: rows.filter((row) => row.blockerCount > 0).length, tone: toneFromCount(rows.filter((row) => row.blockerCount > 0).length, 1, 3) },
        { label: "Locations missing setup photos", value: rows.filter((row) => row.setupPhotoCount === 0).length, tone: toneFromCount(rows.filter((row) => row.setupPhotoCount === 0).length, 1, 3) }
      ],
      sections: [
        {
          id: "issues",
          title: "Recurring Friction",
          rows: rows.map((row) => ({
            id: row.locationId,
            primary: row.locationName,
            secondary: `Latest issue ${formatDateLabel(row.latestDate)}`,
            chips: [
              { label: row.blockerCount > 0 ? "Needs extra prep" : "Watch list", tone: row.blockerCount > 0 ? "heads_up" : "neutral" }
            ],
            values: [
              { label: "Issue Count", value: row.issueCount, tone: row.issueCount >= 3 ? "heads_up" : "neutral" },
              { label: "Avg Rating", value: row.avgRating != null ? row.avgRating.toFixed(1) : "n/a", tone: row.avgRating != null && row.avgRating < 4 ? "heads_up" : "good" },
              { label: "Setup Photos", value: row.setupPhotoCount, tone: row.setupPhotoCount === 0 ? "heads_up" : "good" }
            ],
            next_action: summarizeTextPhrases(row.issueTexts, 1)[0]?.text ?? "Open the location guide for the latest watchouts"
          }))
        }
      ]
    },
    csvRows
  };
}

async function buildBigShootReadinessReport(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportArtifact> {
  const range = {
    startDate: filters.dateFrom ?? filters.anchorDate,
    endDate: filters.dateTo ?? formatDateOnly(addDays(parseDateOnly(filters.anchorDate), 30))
  };
  const shoots = await listShoots(client, { dateFrom: range.startDate, dateTo: range.endDate }, auth);
  const queue = buildBigShootQueue(shoots, filters.anchorDate);

  return {
    detail: {
      id: "big_shoot_readiness_report",
      title: "Big and Critical Shoot Readiness Report",
      audience: "Leadership only",
      formats: { onscreen: true, pdf: true, csv: false },
      summary_line: queue.length
        ? `${queue.length} upcoming shoots are flagged for big or critical preparation and leadership visibility.`
        : "No upcoming shoots currently meet the flagged readiness queue.",
      tone: queue.some((item) => item.readiness_label === "At Risk") ? "action_needed" : queue.some((item) => item.readiness_label === "Needs Attention") ? "heads_up" : "good",
      leadership_only: true,
      generated_at: new Date().toISOString(),
      metrics: [
        { label: "Upcoming flagged shoots", value: queue.length, tone: queue.length ? "info" : "neutral" },
        { label: "At Risk", value: queue.filter((item) => item.readiness_label === "At Risk").length, tone: toneFromCount(queue.filter((item) => item.readiness_label === "At Risk").length, 1, 2) },
        { label: "Needs Attention", value: queue.filter((item) => item.readiness_label === "Needs Attention").length, tone: toneFromCount(queue.filter((item) => item.readiness_label === "Needs Attention").length, 1, 3) }
      ],
      sections: [
        {
          id: "readiness",
          title: "Upcoming Big and Critical Queue",
          summary: "These shoots should carry extra prep visibility, faster staffing escalation, and stronger data hygiene.",
          rows: queue.map((item) => ({
            id: item.shoot_id,
            primary: `${item.shoot_code} | ${item.title}`,
            secondary: `${formatDateLabel(item.shoot_date)} | ${item.location_label}`,
            chips: [
              { label: item.priority_display, tone: item.priority_label === "critical_shoot" ? "action_needed" : "heads_up" },
              {
                label: item.readiness_label,
                tone:
                  item.readiness_label === "At Risk"
                    ? "action_needed"
                    : item.readiness_label === "Needs Attention"
                      ? "heads_up"
                      : "good"
              }
            ],
            values: [
              { label: "Prep Due", value: item.prep_due_label ?? "No reminder due yet" },
              { label: "Profitability", value: item.profitability_display ?? "Needs Review", tone: item.profitability_display === "Watch" ? "heads_up" : "neutral" }
            ],
            next_action: item.readiness_reason
          }))
        }
      ]
    },
    csvRows: []
  };
}

async function buildOperationalIntelligenceReport(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportArtifact> {
  const historicalRange = getDateWindow(filters, 60);
  const futureEndDate = formatDateOnly(addDays(parseDateOnly(filters.anchorDate), 14));
  const complianceWorkspace = await listComplianceWorkspaceItems(client, auth, {
    date: filters.anchorDate,
    window: "all",
    status: "unresolved"
  });
  const missedClockInResult = await client.query<any>(
      `
        WITH missed_clock_events AS (
          SELECT
            ae.user_id AS employee_id,
            COUNT(*) FILTER (WHERE ae.exception_type = 'MISSED_CLOCK_IN' OR ae.workflow_kind = 'missed_punch' OR ae.classification = 'missed clock-in') AS missed_clock_in_count,
            COUNT(*) FILTER (WHERE ae.status = 'open' AND (ae.exception_type = 'MISSED_CLOCK_IN' OR ae.workflow_kind = 'missed_punch' OR ae.classification = 'missed clock-in')) AS open_request_count,
            MAX(ae.created_at) AS last_issue_at
          FROM attendance_exception ae
          WHERE ae.tenant_id = $1
            AND ae.created_at::date BETWEEN $2::date AND $3::date
          GROUP BY ae.user_id
        ),
        presence_patterns AS (
          SELECT
            pi.employee_id,
            COUNT(*) FILTER (WHERE pi.alert_type = 'likely_present_missing_clock_in') AS likely_present_count,
            COUNT(*) FILTER (WHERE pi.alert_type = 'assigned_but_missing') AS assigned_missing_count,
            MAX(pi.created_at) AS last_issue_at
          FROM time_clock_presence_incident pi
          WHERE pi.tenant_id = $1
            AND pi.created_at::date BETWEEN $2::date AND $3::date
          GROUP BY pi.employee_id
        )
        SELECT
          au.id AS employee_id,
          au.full_name AS employee_name,
          COALESCE(missed.missed_clock_in_count, 0) AS missed_clock_in_count,
          COALESCE(presence.likely_present_count, 0) AS likely_present_count,
          COALESCE(presence.assigned_missing_count, 0) AS assigned_missing_count,
          COALESCE(missed.open_request_count, 0) AS open_request_count,
          GREATEST(COALESCE(missed.last_issue_at, 'epoch'::timestamptz), COALESCE(presence.last_issue_at, 'epoch'::timestamptz))::text AS last_issue_at
        FROM app_user au
        LEFT JOIN missed_clock_events missed ON missed.employee_id = au.id
        LEFT JOIN presence_patterns presence ON presence.employee_id = au.id
        WHERE au.tenant_id = $1
          AND au.status = 'active'
          AND (COALESCE(missed.missed_clock_in_count, 0) + COALESCE(presence.likely_present_count, 0) + COALESCE(presence.assigned_missing_count, 0)) >= 2
        ORDER BY (COALESCE(missed.missed_clock_in_count, 0) + COALESCE(presence.likely_present_count, 0) + COALESCE(presence.assigned_missing_count, 0)) DESC, last_issue_at DESC, au.full_name ASC
        LIMIT 12
      `,
      [auth.tenantId, historicalRange.startDate, filters.anchorDate]
    );
  const evaluations = await loadEvaluationSummaryRows(client, auth, historicalRange.startDate, filters.anchorDate);
  const gearPatternResult = await client.query<any>(
      `
        WITH repair_signals AS (
          SELECT
            CASE WHEN gsr.kit_id IS NOT NULL THEN gsr.kit_id ELSE gsr.asset_id END AS target_id,
            CASE WHEN gsr.kit_id IS NOT NULL THEN 'kit' ELSE 'asset' END AS target_type,
            COALESCE(gk.kit_name, ga.asset_name) AS label,
            COUNT(*) AS repair_event_count,
            COUNT(*) FILTER (WHERE gsr.status IN ('open', 'under_review', 'in_service')) AS unresolved_repair_count,
            0::bigint AS missing_content_event_count,
            0::bigint AS missing_alert_count,
            MAX(gsr.opened_at) AS last_signal_at
          FROM gear_service_repair_record gsr
          LEFT JOIN gear_asset ga ON ga.id = gsr.asset_id
          LEFT JOIN gear_kit gk ON gk.id = gsr.kit_id
          WHERE gsr.tenant_id = $1
            AND gsr.opened_at::date BETWEEN $2::date AND $3::date
          GROUP BY 1, 2, 3
        ),
        verification_signals AS (
          SELECT
            gpv.kit_id AS target_id,
            'kit'::text AS target_type,
            gk.kit_name AS label,
            0::bigint AS repair_event_count,
            0::bigint AS unresolved_repair_count,
            COUNT(*) FILTER (WHERE item.presence_status = 'missing') AS missing_content_event_count,
            0::bigint AS missing_alert_count,
            MAX(COALESCE(item.updated_at, item.created_at)) AS last_signal_at
          FROM gear_pre_shoot_verification gpv
          JOIN gear_pre_shoot_verification_item item ON item.tenant_id = gpv.tenant_id AND item.verification_id = gpv.id
          JOIN gear_kit gk ON gk.id = gpv.kit_id
          WHERE gpv.tenant_id = $1
            AND COALESCE(gpv.updated_at, gpv.created_at)::date BETWEEN $2::date AND $3::date
            AND item.presence_status = 'missing'
          GROUP BY 1, 2, 3
        ),
        alert_signals AS (
          SELECT
            CASE WHEN gal.kit_id IS NOT NULL THEN gal.kit_id ELSE gal.asset_id END AS target_id,
            CASE WHEN gal.kit_id IS NOT NULL THEN 'kit' ELSE 'asset' END AS target_type,
            COALESCE(gk.kit_name, ga.asset_name) AS label,
            0::bigint AS repair_event_count,
            0::bigint AS unresolved_repair_count,
            0::bigint AS missing_content_event_count,
            COUNT(*) FILTER (WHERE gal.alert_type = 'missing_gear' AND gal.status = 'open') AS missing_alert_count,
            MAX(gal.first_triggered_at) AS last_signal_at
          FROM gear_alert gal
          LEFT JOIN gear_asset ga ON ga.id = gal.asset_id
          LEFT JOIN gear_kit gk ON gk.id = gal.kit_id
          WHERE gal.tenant_id = $1
            AND gal.first_triggered_at::date BETWEEN $2::date AND $3::date
          GROUP BY 1, 2, 3
        )
        SELECT
          signal.target_id,
          signal.target_type,
          signal.label,
          SUM(signal.repair_event_count) AS repair_event_count,
          SUM(signal.unresolved_repair_count) AS unresolved_repair_count,
          SUM(signal.missing_content_event_count) AS missing_content_event_count,
          SUM(signal.missing_alert_count) AS missing_alert_count,
          MAX(signal.last_signal_at)::text AS last_signal_at
        FROM (SELECT * FROM repair_signals UNION ALL SELECT * FROM verification_signals UNION ALL SELECT * FROM alert_signals) signal
        WHERE signal.target_id IS NOT NULL
          AND signal.label IS NOT NULL
        GROUP BY signal.target_id, signal.target_type, signal.label
        HAVING SUM(signal.repair_event_count) + SUM(signal.missing_content_event_count) + SUM(signal.missing_alert_count) >= 2
          OR SUM(signal.unresolved_repair_count) > 0
        ORDER BY SUM(signal.unresolved_repair_count) DESC, (SUM(signal.repair_event_count) + SUM(signal.missing_content_event_count) + SUM(signal.missing_alert_count)) DESC, MAX(signal.last_signal_at) DESC
        LIMIT 12
      `,
      [auth.tenantId, historicalRange.startDate, filters.anchorDate]
    );
  const upcomingShoots = await listShoots(client, { dateFrom: filters.anchorDate, dateTo: futureEndDate }, auth);
  const crmAlertResult = await client.query<any>(
      `
        SELECT organization_id, COUNT(*) FILTER (WHERE status = 'open') AS open_crm_alert_count
        FROM sales_pipeline_alert
        WHERE tenant_id = $1
        GROUP BY organization_id
      `,
      [auth.tenantId]
    );
  const supportIssueResult = await client.query<any>(
      `
        SELECT
          org.id AS organization_id,
          COUNT(*) FILTER (
            WHERE ticket.is_deleted = false
              AND ticket.status NOT IN ('closed', 'solved')
          ) AS open_support_issue_count
        FROM organization org
        JOIN zendesk_ticket_cache ticket
          ON ticket.tenant_id = org.tenant_id
         AND lower(COALESCE(ticket.organization_name, '')) = ANY(ARRAY[lower(org.display_name), lower(org.canonical_name)])
        WHERE org.tenant_id = $1
        GROUP BY org.id
      `,
      [auth.tenantId]
    );
  const recentShootResult = await client.query<any>(
      `
        SELECT organization_id, COUNT(*) AS recent_shoot_count
        FROM shoot
        WHERE tenant_id = $1
          AND organization_id IS NOT NULL
          AND shoot_date::date BETWEEN $2::date AND $3::date
        GROUP BY organization_id
      `,
      [auth.tenantId, historicalRange.startDate, filters.anchorDate]
    );

  const shootIds = upcomingShoots.map((shoot) => String(shoot.id));
  const prepSignalRows = shootIds.length
    ? await client.query<any>(
        `
          SELECT
            r.shoot_id,
            COUNT(*) FILTER (WHERE r.category = 'setup_photo' AND r.approval_status = 'approved' AND r.visibility_scope = 'photographer_prep') AS approved_setup_photo_count,
            COUNT(*) FILTER (WHERE r.category IN ('location_reference', 'prior_successful_example', 'product_example') AND r.approval_status = 'approved' AND r.visibility_scope = 'photographer_prep') AS approved_reference_count,
            COUNT(*) FILTER (WHERE r.category = 'qr_code_job_document' AND r.approval_status = 'approved' AND r.visibility_scope = 'photographer_prep') AS approved_document_count
          FROM resource_library_item r
          WHERE r.tenant_id = $1
            AND r.shoot_id = ANY($2::uuid[])
          GROUP BY r.shoot_id
        `,
        [auth.tenantId, shootIds]
      )
    : { rows: [] };
  const gearShootRows = shootIds.length
    ? await client.query<any>(
        `
          WITH latest_verification AS (
            SELECT DISTINCT ON (gpv.linked_shoot_id)
              gpv.linked_shoot_id AS shoot_id,
              gpv.status::text AS latest_verification_status
            FROM gear_pre_shoot_verification gpv
            WHERE gpv.tenant_id = $1
              AND gpv.linked_shoot_id = ANY($2::uuid[])
            ORDER BY gpv.linked_shoot_id, COALESCE(gpv.verified_ready_at, gpv.updated_at, gpv.created_at) DESC
          )
          SELECT
            shoot_id,
            SUM(open_alert_count) AS open_alert_count,
            SUM(missing_alert_count) AS missing_alert_count,
            MAX(latest_verification_status) AS latest_verification_status
          FROM (
            SELECT gal.linked_shoot_id AS shoot_id, COUNT(*) FILTER (WHERE gal.status = 'open') AS open_alert_count, COUNT(*) FILTER (WHERE gal.status = 'open' AND gal.alert_type = 'missing_gear') AS missing_alert_count, NULL::text AS latest_verification_status
            FROM gear_alert gal
            WHERE gal.tenant_id = $1
              AND gal.linked_shoot_id = ANY($2::uuid[])
            GROUP BY gal.linked_shoot_id
            UNION ALL
            SELECT shoot_id, 0::bigint, 0::bigint, latest_verification_status FROM latest_verification
          ) signal
          GROUP BY shoot_id
        `,
        [auth.tenantId, shootIds]
      )
    : { rows: [] };

  const prepByShoot = new Map(prepSignalRows.rows.map((row) => [String(row.shoot_id), row]));
  const gearByShoot = new Map(gearShootRows.rows.map((row) => [String(row.shoot_id), row]));
  const crmAlertByOrganization = new Map(
    crmAlertResult.rows.map((row) => [String(row.organization_id), Number(row.open_crm_alert_count ?? 0)])
  );
  const supportIssueByOrganization = new Map(
    supportIssueResult.rows.map((row) => [String(row.organization_id), Number(row.open_support_issue_count ?? 0)])
  );
  const recentShootsByOrganization = new Map(
    recentShootResult.rows.map((row) => [String(row.organization_id), Number(row.recent_shoot_count ?? 0)])
  );
  const complianceByShoot = complianceWorkspace.rows.reduce<Map<string, number>>((map, row) => {
    if (!row.shoot_id) {
      return map;
    }
    map.set(row.shoot_id, (map.get(row.shoot_id) ?? 0) + 1);
    return map;
  }, new Map());
  const unresolvedByOrganization = complianceWorkspace.rows.reduce<Map<string, number>>((map, row) => {
    if (!row.organization_id) {
      return map;
    }
    map.set(row.organization_id, (map.get(row.organization_id) ?? 0) + 1);
    return map;
  }, new Map());

  const issuesByLocation = new Map<
    string,
    { locationName: string; issueCount: number; blockerCount: number; latestDate: string; issueTexts: string[]; missingSetupCount: number }
  >();
  const missingSetupByLocation = complianceWorkspace.rows.reduce<Map<string, number>>((map, row) => {
    if (row.issue_type === "missing_setup_photo" && row.location_id) {
      map.set(row.location_id, (map.get(row.location_id) ?? 0) + 1);
    }
    return map;
  }, new Map());

  for (const row of evaluations) {
    const issueTexts = [row.late_details, row.access_details, row.notes].filter((value): value is string => Boolean(value));
    const blockerCount = [row.on_time === "No", row.easy_access === "No", row.overall_rating <= 3].filter(Boolean).length;
    const current = issuesByLocation.get(row.location_id) ?? {
      locationName: row.location_name,
      issueCount: 0,
      blockerCount: 0,
      latestDate: row.shoot_date,
      issueTexts: [],
      missingSetupCount: missingSetupByLocation.get(row.location_id) ?? 0
    };
    if (issueTexts.length || blockerCount > 0 || current.missingSetupCount > 0) {
      current.issueCount += Math.max(issueTexts.length, blockerCount, 1);
      current.blockerCount += blockerCount;
      current.latestDate = current.latestDate > row.shoot_date ? current.latestDate : row.shoot_date;
      current.issueTexts.push(...issueTexts);
      issuesByLocation.set(row.location_id, current);
    }
  }

  const locationRows = [...issuesByLocation.entries()]
    .map(([locationId, row]) => ({ locationId, ...row }))
    .filter((row) => row.issueCount + row.missingSetupCount >= 2 || row.blockerCount > 0)
    .sort((left, right) => right.blockerCount * 2 + right.issueCount + right.missingSetupCount - (left.blockerCount * 2 + left.issueCount + left.missingSetupCount))
    .slice(0, 10);

  const organizationIds = [...new Set([
    ...upcomingShoots.map((shoot) => String(shoot.organization_id ?? "")).filter(Boolean),
    ...complianceWorkspace.rows.map((row) => row.organization_id ?? "").filter(Boolean),
    ...crmAlertResult.rows.map((row) => String(row.organization_id ?? "")).filter(Boolean),
    ...supportIssueResult.rows.map((row) => String(row.organization_id ?? "")).filter(Boolean),
    ...recentShootResult.rows.map((row) => String(row.organization_id ?? "")).filter(Boolean)
  ])];
  const agreementCoverage = await getAgreementCoverageByOrganizationIds(client, auth.tenantId, organizationIds);

  const accountRows = organizationIds
    .map((organizationId) => {
      const upcomingCount = upcomingShoots.filter((shoot) => String(shoot.organization_id ?? "") === organizationId).length;
      const agreementSummary = agreementCoverage.get(organizationId);
      const unresolvedOpsIssueCount = unresolvedByOrganization.get(organizationId) ?? 0;
      const sampleShoot = upcomingShoots.find((shoot) => String(shoot.organization_id ?? "") === organizationId);
      const sampleComplianceRow = complianceWorkspace.rows.find((row) => row.organization_id === organizationId);
      return {
        organizationId,
        organizationName: sampleShoot?.organization_display_name ?? sampleComplianceRow?.organization_display_name ?? "Organization",
        recentShootCount: recentShootsByOrganization.get(organizationId) ?? 0,
        upcomingCount,
        unresolvedOpsIssueCount,
        openCrmAlertCount: crmAlertByOrganization.get(organizationId) ?? 0,
        openSupportIssueCount: supportIssueByOrganization.get(organizationId) ?? 0,
        agreementSummary
      };
    })
    .filter((row) => row.recentShootCount > 0 || row.upcomingCount > 0 || row.unresolvedOpsIssueCount > 0 || row.openCrmAlertCount > 0 || row.openSupportIssueCount > 0 || !row.agreementSummary?.has_active_agreement || row.agreementSummary?.has_expired || row.agreementSummary?.has_pending_signature || row.agreementSummary?.has_expiring_soon)
    .sort((left, right) => {
      const leftScore =
        left.unresolvedOpsIssueCount +
        left.openCrmAlertCount +
        left.openSupportIssueCount +
        left.upcomingCount +
        (left.recentShootCount > 0 ? 1 : 0) +
        (left.agreementSummary?.has_expired ? 3 : 0) +
        (!left.agreementSummary?.has_active_agreement ? 2 : 0);
      const rightScore =
        right.unresolvedOpsIssueCount +
        right.openCrmAlertCount +
        right.openSupportIssueCount +
        right.upcomingCount +
        (right.recentShootCount > 0 ? 1 : 0) +
        (right.agreementSummary?.has_expired ? 3 : 0) +
        (!right.agreementSummary?.has_active_agreement ? 2 : 0);
      return rightScore - leftScore || left.organizationName.localeCompare(right.organizationName);
    })
    .slice(0, 10);

  const readinessRows = upcomingShoots
    .map((shoot) => {
      const prep = prepByShoot.get(String(shoot.id));
      const gear = gearByShoot.get(String(shoot.id));
      const staffingGap = Math.max(Number(shoot.planned_staff_count ?? 0) - Number(shoot.scheduled_employee_count ?? 0), 0);
      const leadGap = Math.max(Number(shoot.required_lead_count ?? 0) - Number(shoot.lead_coverage_count ?? 0), 0);
      const prepMissingCount = [Number(prep?.approved_setup_photo_count ?? 0) === 0, Number(prep?.approved_reference_count ?? 0) === 0, Number(prep?.approved_document_count ?? 0) === 0].filter(Boolean).length;
      const gearRisk = Number(gear?.missing_alert_count ?? 0) > 0 || Number(gear?.open_alert_count ?? 0) > 0 || gear?.latest_verification_status === "verified_with_missing_items";
      const complianceRiskCount = complianceByShoot.get(String(shoot.id)) ?? 0;
      const riskScore = (shoot.agreement_warning_severity === "major" ? 3 : shoot.agreement_warning_severity === "warning" ? 2 : 0) + (staffingGap > 0 ? 2 : 0) + (leadGap > 0 ? 2 : 0) + (prepMissingCount > 0 ? 2 : 0) + (gearRisk ? 2 : 0) + (shoot.prior_major_issue_exists ? 1 : 0) + (complianceRiskCount > 0 ? 1 : 0);
      return { shoot, staffingGap, leadGap, prepMissingCount, gear, gearRisk, complianceRiskCount, riskScore };
    })
    .filter((row) => row.riskScore > 0)
    .sort((left, right) => right.riskScore - left.riskScore || String(left.shoot.shoot_date).localeCompare(String(right.shoot.shoot_date)))
    .slice(0, 12);

  const csvRows: CsvRow[] = [
    ...missedClockInResult.rows.map((row) => ({ report_section: "repeated_missed_clock_ins", label: row.employee_name ?? "Employee", missed_clock_in_count: Number(row.missed_clock_in_count ?? 0), likely_present_count: Number(row.likely_present_count ?? 0), assigned_missing_count: Number(row.assigned_missing_count ?? 0), open_request_count: Number(row.open_request_count ?? 0), last_signal_at: row.last_issue_at })),
    ...locationRows.map((row) => ({ report_section: "repeated_location_issues", label: row.locationName, issue_count: row.issueCount, blocker_count: row.blockerCount, missing_setup_count: row.missingSetupCount, last_signal_at: row.latestDate })),
    ...gearPatternResult.rows.map((row) => ({ report_section: "gear_issue_patterns", label: row.label, target_type: row.target_type, repair_event_count: Number(row.repair_event_count ?? 0), unresolved_repair_count: Number(row.unresolved_repair_count ?? 0), missing_content_event_count: Number(row.missing_content_event_count ?? 0), missing_alert_count: Number(row.missing_alert_count ?? 0), last_signal_at: row.last_signal_at })),
    ...accountRows.map((row) => ({
      report_section: "account_health_signals",
      label: row.organizationName,
      recent_shoot_count: row.recentShootCount,
      upcoming_shoot_count: row.upcomingCount,
      open_crm_alert_count: row.openCrmAlertCount,
      open_support_issue_count: row.openSupportIssueCount,
      unresolved_ops_issue_count: row.unresolvedOpsIssueCount,
      agreement_has_active: row.agreementSummary?.has_active_agreement ?? false
    })),
    ...readinessRows.map((row) => ({ report_section: "shoot_readiness_signals", label: row.shoot.title, shoot_code: row.shoot.shoot_code, shoot_date: row.shoot.shoot_date, staffing_gap: row.staffingGap, lead_gap: row.leadGap, prep_missing_count: row.prepMissingCount, open_gear_alert_count: Number(row.gear?.open_alert_count ?? 0), compliance_risk_count: row.complianceRiskCount, agreement_warning: row.shoot.agreement_warning_summary ?? "" }))
  ];

  const signalCount = missedClockInResult.rows.length + locationRows.length + gearPatternResult.rows.length + accountRows.length + readinessRows.length;
  return {
    detail: {
      id: "operational_intelligence_report",
      title: "Operational Intelligence Report",
      audience: "Leadership and managers",
      formats: { onscreen: true, pdf: true, csv: true },
      summary_line: signalCount ? `${signalCount} proactive signals are currently surfacing across labor, compliance, locations, accounts, gear, and upcoming shoot prep.` : "No repeat operational patterns are currently climbing above the normal watch threshold.",
      tone: readinessRows.some((row) => row.riskScore >= 6) || accountRows.some((row) => row.agreementSummary?.has_expired) ? "action_needed" : signalCount > 0 ? "heads_up" : "good",
      leadership_only: true,
      generated_at: new Date().toISOString(),
      metrics: [
        { label: "Open compliance items", value: complianceWorkspace.summary.open_count, tone: toneFromCount(complianceWorkspace.summary.open_count, 1, 6) },
        { label: "Repeat clock-in patterns", value: missedClockInResult.rows.length, tone: toneFromCount(missedClockInResult.rows.length, 1, 3) },
        { label: "Locations needing memory carry-forward", value: locationRows.length, tone: toneFromCount(locationRows.length, 1, 4) },
        { label: "Gear attention patterns", value: gearPatternResult.rows.length, tone: toneFromCount(gearPatternResult.rows.length, 1, 3) },
        { label: "Upcoming shoot readiness watch", value: readinessRows.length, tone: toneFromCount(readinessRows.length, 1, 4) }
      ],
      sections: [
        { id: "compliance_patterns", title: "Repeated Missed Clock-Ins By Employee", summary: missedClockInResult.rows.length ? "These employees are showing repeat clock-in friction across missed punches and presence incidents." : "No employee crossed the repeat clock-in threshold in the current review window.", rows: missedClockInResult.rows.map((row) => ({ id: row.employee_id, primary: row.employee_name ?? "Employee", secondary: `Latest signal ${formatDateTimeLabel(row.last_issue_at)}`, chips: [{ label: Number(row.missed_clock_in_count ?? 0) >= 2 ? "Needs coaching follow-through" : "Watch pattern", tone: Number(row.missed_clock_in_count ?? 0) >= 2 ? "action_needed" : "heads_up" }], values: [{ label: "Missed Clock-Ins", value: Number(row.missed_clock_in_count ?? 0), tone: Number(row.missed_clock_in_count ?? 0) >= 2 ? "action_needed" : "neutral" }, { label: "Likely Present", value: Number(row.likely_present_count ?? 0), tone: Number(row.likely_present_count ?? 0) > 0 ? "heads_up" : "neutral" }, { label: "Assigned Missing", value: Number(row.assigned_missing_count ?? 0), tone: Number(row.assigned_missing_count ?? 0) > 0 ? "action_needed" : "neutral" }, { label: "Open Requests", value: Number(row.open_request_count ?? 0), tone: Number(row.open_request_count ?? 0) > 0 ? "heads_up" : "good" }], next_action: Number(row.open_request_count ?? 0) > 0 ? "Open the Compliance desk and clear the open correction requests." : "Check whether coaching, process cleanup, or mobile reminders are needed." })) },
        { id: "location_patterns", title: "Repeated Location Issues", summary: locationRows.length ? "These locations are accumulating repeat prep or closeout friction that should feed the next setup pass." : "No location crossed the repeat issue threshold in the current review window.", rows: locationRows.map((row) => ({ id: row.locationId, primary: row.locationName, secondary: `Latest signal ${formatDateLabel(row.latestDate)}`, chips: [{ label: row.blockerCount > 0 ? "Needs explicit prep callout" : "Watch list", tone: row.blockerCount > 0 ? "heads_up" : "neutral" }], values: [{ label: "Issue Count", value: row.issueCount, tone: row.issueCount >= 3 ? "heads_up" : "neutral" }, { label: "Blockers", value: row.blockerCount, tone: row.blockerCount > 0 ? "action_needed" : "good" }, { label: "Missing Setup", value: row.missingSetupCount, tone: row.missingSetupCount > 0 ? "heads_up" : "good" }], next_action: summarizeTextPhrases(row.issueTexts, 1)[0]?.text ?? "Carry the latest location reminder into recurring intelligence." })) },
        { id: "gear_patterns", title: "Repeated Gear Issues / Missing Kit Contents", summary: gearPatternResult.rows.length ? "Repeated repair, missing, or verification gaps are staying visible so prep and inventory decisions are less reactive." : "No gear pattern rose above the repeat threshold in the current review window.", rows: gearPatternResult.rows.map((row) => ({ id: row.target_id, primary: row.label, secondary: `${humanizeLabel(row.target_type)} | Last signal ${formatDateTimeLabel(row.last_signal_at)}`, chips: [{ label: Number(row.unresolved_repair_count ?? 0) > 0 ? "Open service attention" : "Pattern watch", tone: Number(row.unresolved_repair_count ?? 0) > 0 ? "action_needed" : "heads_up" }], values: [{ label: "Repair Events", value: Number(row.repair_event_count ?? 0), tone: Number(row.repair_event_count ?? 0) >= 2 ? "heads_up" : "neutral" }, { label: "Missing Contents", value: Number(row.missing_content_event_count ?? 0), tone: Number(row.missing_content_event_count ?? 0) > 0 ? "heads_up" : "neutral" }, { label: "Missing Alerts", value: Number(row.missing_alert_count ?? 0), tone: Number(row.missing_alert_count ?? 0) > 0 ? "action_needed" : "neutral" }], next_action: Number(row.unresolved_repair_count ?? 0) > 0 ? "Open Gear and clear the repair or missing-item path before the next send." : "Review kit verification history and recurring substitutions." })) },
        { id: "account_health", title: "Account Health Signals", summary: accountRows.length ? "Accounts are being ranked by contract posture, support pressure, recent and upcoming work, and unresolved operational issues." : "No account is currently carrying combined contract, support, and operational pressure above the watch threshold.", rows: accountRows.map((row) => ({ id: row.organizationId, primary: row.organizationName, secondary: `${row.recentShootCount} recent shoot${row.recentShootCount === 1 ? "" : "s"} | ${row.upcomingCount} upcoming shoot${row.upcomingCount === 1 ? "" : "s"}`, chips: [{ label: row.agreementSummary?.has_expired ? "Expired agreement" : !row.agreementSummary?.has_active_agreement ? "No active agreement" : row.agreementSummary?.has_pending_signature ? "Pending signature" : row.agreementSummary?.has_expiring_soon ? "Expiring soon" : "Agreement clear", tone: row.agreementSummary?.has_expired || row.unresolvedOpsIssueCount >= 3 ? "action_needed" : !row.agreementSummary?.has_active_agreement || row.openSupportIssueCount > 0 || row.openCrmAlertCount > 0 ? "heads_up" : "good" }], values: [{ label: "Recent Shoots", value: row.recentShootCount, tone: row.recentShootCount > 0 ? "neutral" : "good" }, { label: "Upcoming Shoots", value: row.upcomingCount, tone: row.upcomingCount > 0 ? "neutral" : "good" }, { label: "Support Issues", value: row.openSupportIssueCount, tone: row.openSupportIssueCount > 0 ? "heads_up" : "good" }, { label: "Ops Issues", value: row.unresolvedOpsIssueCount, tone: row.unresolvedOpsIssueCount > 0 ? "heads_up" : "good" }], next_action: row.agreementSummary?.has_expired || !row.agreementSummary?.has_active_agreement ? "Resolve agreement coverage before the next active shoot window tightens." : row.openSupportIssueCount > 0 ? "Review the open support issues alongside upcoming work so the next touchpoint is prepared." : row.unresolvedOpsIssueCount > 0 ? "Open the account and review the recent operational issues feeding account health." : "Keep renewal, follow-up, and upcoming shoot prep visible." })) },
        { id: "shoot_readiness", title: "Shoot Readiness Signals", summary: readinessRows.length ? "Upcoming shoots now read as a cross-system readiness surface: agreements, staffing, gear, prep materials, and known location friction." : "No upcoming shoot is currently carrying a multi-system readiness signal above the normal threshold.", rows: readinessRows.map((row) => ({ id: String(row.shoot.id), primary: String(row.shoot.title), secondary: `${String(row.shoot.shoot_code)} | ${formatDateLabel(String(row.shoot.shoot_date))} | ${locationLabel(row.shoot)}`, chips: [{ label: row.riskScore >= 6 ? "At Risk" : "Needs Attention", tone: row.riskScore >= 6 ? "action_needed" : "heads_up" }], values: [{ label: "Staffing Gap", value: row.staffingGap, tone: row.staffingGap > 0 ? "heads_up" : "good" }, { label: "Lead Gap", value: row.leadGap, tone: row.leadGap > 0 ? "action_needed" : "good" }, { label: "Prep Missing", value: row.prepMissingCount, tone: row.prepMissingCount > 0 ? "heads_up" : "good" }, { label: "Open Gear Alerts", value: Number(row.gear?.open_alert_count ?? 0), tone: Number(row.gear?.open_alert_count ?? 0) > 0 ? "heads_up" : "good" }], next_action: row.shoot.agreement_warning_summary ?? (row.staffingGap > 0 || row.leadGap > 0 ? "Close staffing and lead coverage before arrival." : row.prepMissingCount > 0 ? "Fill the missing prep materials before the next crew review." : row.gearRisk ? "Open Gear and resolve readiness before checkout." : row.shoot.prior_major_issue_exists ? "Carry the prior location watchouts into this prep pass." : "Open the Shoot detail and verify final readiness.") })) }
      ]
    },
    csvRows
  };
}

async function buildCalendarStaffingOverviewReport(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportArtifact> {
  const range = {
    startDate: filters.dateFrom ?? filters.anchorDate,
    endDate: filters.dateTo ?? formatDateOnly(addDays(parseDateOnly(filters.anchorDate), 30))
  };
  const shoots = await listShoots(client, { dateFrom: range.startDate, dateTo: range.endDate }, auth);
  const coverageByDay = new Map<
    string,
    {
      total: number;
      open: number;
      missingLead: number;
      bigShoots: number;
      conflicts: number;
    }
  >();
  for (const row of shoots) {
    const key = String(row.shoot_date ?? filters.anchorDate);
    const bucket = coverageByDay.get(key) ?? { total: 0, open: 0, missingLead: 0, bigShoots: 0, conflicts: 0 };
    bucket.total += 1;
    if (Number(row.scheduled_employee_count ?? 0) < Number(row.planned_staff_count ?? 0)) {
      bucket.open += 1;
    }
    if (Number(row.lead_coverage_count ?? 0) < Math.max(Number(row.required_lead_count ?? 1), 1)) {
      bucket.missingLead += 1;
    }
    if (isBigShootLabel((row.priority_label ?? "standard") as ShootPriorityLabel)) {
      bucket.bigShoots += 1;
    }
    bucket.conflicts += Number(row.conflict_warning_count ?? 0);
    coverageByDay.set(key, bucket);
  }
  const dayRows = [...coverageByDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dateKey, bucket]) => ({
      dateKey,
      ...bucket
    }));

  return {
    detail: {
      id: "calendar_staffing_overview",
      title: "Calendar Staffing Overview",
      audience: "Leadership and staffing managers",
      formats: { onscreen: true, pdf: true, csv: false },
      summary_line: shoots.length
        ? `${shoots.length} shoots are in the current staffing horizon, with concentration and gap pressure surfaced by day.`
        : "No shoots are in the current staffing horizon.",
      tone: shoots.some((row) => Number(row.lead_coverage_count ?? 0) < Math.max(Number(row.required_lead_count ?? 1), 1)) ? "heads_up" : "good",
      leadership_only: false,
      generated_at: new Date().toISOString(),
      metrics: [
        { label: "Shoots in range", value: shoots.length, tone: "info" },
        {
          label: "Open staffing gaps",
          value: shoots.filter((row) => Number(row.scheduled_employee_count ?? 0) < Number(row.planned_staff_count ?? 0)).length,
          tone: toneFromCount(shoots.filter((row) => Number(row.scheduled_employee_count ?? 0) < Number(row.planned_staff_count ?? 0)).length, 1, 4)
        },
        {
          label: "Missing lead coverage",
          value: shoots.filter((row) => Number(row.lead_coverage_count ?? 0) < Math.max(Number(row.required_lead_count ?? 1), 1)).length,
          tone: toneFromCount(shoots.filter((row) => Number(row.lead_coverage_count ?? 0) < Math.max(Number(row.required_lead_count ?? 1), 1)).length, 1, 2)
        },
        {
          label: "Big / critical shoots in range",
          value: shoots.filter((row) => isBigShootLabel((row.priority_label ?? "standard") as ShootPriorityLabel)).length,
          tone: shoots.filter((row) => isBigShootLabel((row.priority_label ?? "standard") as ShootPriorityLabel)).length ? "info" : "neutral"
        }
      ],
      sections: [
        {
          id: "coverage_by_day",
          title: "Coverage By Day",
          rows: dayRows.map((row) => ({
            id: row.dateKey,
            primary: formatDateLabel(row.dateKey),
            values: [
              { label: "Shoots", value: row.total },
              { label: "Open", value: row.open, tone: row.open > 0 ? "heads_up" : "good" },
              { label: "Missing Lead", value: row.missingLead, tone: row.missingLead > 0 ? "action_needed" : "good" },
              { label: "Big / Critical", value: row.bigShoots, tone: row.bigShoots > 0 ? "info" : "neutral" },
              { label: "Conflicts", value: row.conflicts, tone: row.conflicts > 0 ? "heads_up" : "good" }
            ]
          }))
        },
        {
          id: "pressure_points",
          title: "Availability Pressure Points",
          rows: shoots
            .filter((row) => isBigShootLabel((row.priority_label ?? "standard") as ShootPriorityLabel) || Number(row.conflict_warning_count ?? 0) > 0 || Number(row.scheduled_employee_count ?? 0) < Number(row.planned_staff_count ?? 0))
            .slice(0, 20)
            .map((row) => ({
              id: String(row.id),
              primary: `${row.shoot_code} | ${row.title}`,
              secondary: `${formatDateLabel(row.shoot_date)} | ${locationLabel(row)}`,
              chips: [
                {
                  label: humanizePriorityLabel((row.priority_label ?? "standard") as ShootPriorityLabel),
                  tone: row.priority_label === "critical_shoot" ? "action_needed" : row.priority_label === "big_shoot" ? "heads_up" : "neutral"
                }
              ],
              values: [
                { label: "Assigned", value: `${Number(row.scheduled_employee_count ?? 0)}/${Number(row.planned_staff_count ?? 0)}` },
                { label: "Lead", value: `${Number(row.lead_coverage_count ?? 0)}/${Math.max(Number(row.required_lead_count ?? 1), 1)}`, tone: Number(row.lead_coverage_count ?? 0) < Math.max(Number(row.required_lead_count ?? 1), 1) ? "action_needed" : "good" },
                { label: "Conflicts", value: Number(row.conflict_warning_count ?? 0), tone: Number(row.conflict_warning_count ?? 0) > 0 ? "heads_up" : "good" }
              ],
              next_action:
                Number(row.lead_coverage_count ?? 0) < Math.max(Number(row.required_lead_count ?? 1), 1)
                  ? "Secure lead coverage"
                  : Number(row.scheduled_employee_count ?? 0) < Number(row.planned_staff_count ?? 0)
                    ? "Fill staffing gaps"
                    : "Review conflict pressure"
            }))
        }
      ]
    },
    csvRows: []
  };
}

async function buildOpenApprovalsReport(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportArtifact> {
  const week = getWeekBounds(filters.anchorDate);
  const ptoRequests = await listPTORequests(client, auth, "submitted");
  const pendingRecipientTrades = await listTradeRequests(client, auth, "pending_recipient");
  const pendingManagerTrades = await listTradeRequests(client, auth, "pending_manager");
  const tradeRequests = [...pendingRecipientTrades, ...pendingManagerTrades];
  const ops = await getOperationsDashboard(client, auth, { dateFrom: week.startDate, dateTo: week.endDate, date: "" });
  const approvalExceptions = (ops.reporting.exceptions ?? []).filter(
    (row) =>
      String(row.status ?? "") === "open" &&
      startsWithAny(String(row.exception_type ?? ""), ["EARLY_CLOCK_IN", "TIME_EDIT", "MISSED_CLOCK", "FORGOT_TO_CLOCK"])
  );
  const csvRows = [
    ...ptoRequests.map((row) => ({
      type: "pto",
      subject: String(row.user_name ?? ""),
      status: String(row.status ?? ""),
      requested_on: String(row.requested_on ?? ""),
      approver: String(row.approver_name ?? ""),
      age_days: Math.max(
        0,
        Math.round((parseDateOnly(filters.anchorDate).getTime() - parseDateOnly(String(row.requested_on ?? filters.anchorDate)).getTime()) / 86_400_000)
      )
    })),
    ...tradeRequests.map((row) => ({
      type: "trade",
      subject: String(row.requester_name ?? ""),
      status: String(row.status ?? ""),
      requested_on: String(row.created_at ?? ""),
      approver: String(row.approver_name ?? row.manager_user_id ?? ""),
      age_days: Math.max(0, Math.round((Date.now() - new Date(String(row.created_at ?? new Date().toISOString())).getTime()) / 86_400_000))
    })),
    ...approvalExceptions.map((row) => ({
      type: "attendance",
      subject: String(row.user_name ?? ""),
      status: String(row.status ?? ""),
      requested_on: String(row.created_at ?? ""),
      approver: String(row.requested_approver_name ?? ""),
      age_days: Math.max(0, Math.round((Date.now() - new Date(String(row.created_at ?? new Date().toISOString())).getTime()) / 86_400_000))
    }))
  ];

  return {
    detail: {
      id: "open_approvals_report",
      title: "Open Approvals Report",
      audience: "Managers and leadership",
      formats: { onscreen: true, pdf: false, csv: true },
      summary_line:
        ptoRequests.length || tradeRequests.length || approvalExceptions.length
          ? `${ptoRequests.length} PTO, ${tradeRequests.length} trade, and ${approvalExceptions.length} attendance approvals are open right now.`
          : "No open approvals are waiting right now.",
      tone: tradeRequests.length + approvalExceptions.length > 0 ? "heads_up" : ptoRequests.length > 0 ? "info" : "good",
      leadership_only: true,
      generated_at: new Date().toISOString(),
      metrics: [
        { label: "PTO pending", value: ptoRequests.length, tone: ptoRequests.length ? "info" : "good" },
        { label: "Shift trades pending", value: tradeRequests.length, tone: toneFromCount(tradeRequests.length, 1, 3) },
        { label: "Time approvals pending", value: approvalExceptions.length, tone: toneFromCount(approvalExceptions.length, 1, 3) }
      ],
      sections: [
        {
          id: "pto",
          title: "PTO Queue",
          rows: ptoRequests.slice(0, 20).map((row) => ({
            id: String(row.id),
            primary: `${row.user_name ?? "Employee"} | ${formatDateLabel(row.requested_on)}`,
            secondary: `${row.department ?? "Department pending"} | ${row.request_unit === "half_day" ? "Half day" : "Full day"}`,
            values: [
              { label: "Hours", value: Number(row.requested_hours ?? 0) },
              { label: "Approver", value: String(row.approver_name ?? "Pending") }
            ]
          }))
        },
        {
          id: "trades",
          title: "Shift Trade Queue",
          rows: tradeRequests.slice(0, 20).map((row) => ({
            id: String(row.id),
            primary: `${row.requester_name ?? "Requester"} | ${row.shift_title ?? row.shoot_title ?? "Shift trade"}`,
            secondary: `${row.requested_with_name ?? "Recipient pending"} | ${formatDateTimeLabel(row.starts_at)}`,
            chips: [
              { label: humanizeLabel(String(row.status ?? "pending")), tone: String(row.status ?? "") === "pending_manager" ? "heads_up" : "info" }
            ],
            values: [
              { label: "Approver", value: String(row.approver_name ?? "Pending") },
              { label: "Coverage", value: row.satisfies_lead_coverage ? "Lead coverage risk" : "Standard swap", tone: row.satisfies_lead_coverage ? "action_needed" : "neutral" }
            ]
          }))
        },
        {
          id: "attendance",
          title: "Attendance Approval Queue",
          rows: approvalExceptions.slice(0, 20).map((row) => ({
            id: String(row.id),
            primary: `${row.user_name ?? "Employee"} | ${row.exception_type}`,
            secondary: `${row.shift_title ?? row.shoot_code ?? "Attendance item"} | ${formatDateTimeLabel(row.created_at)}`,
            values: [
              { label: "Approver", value: String(row.requested_approver_name ?? "Pending") },
              { label: "Severity", value: String(row.severity ?? "high"), tone: String(row.severity ?? "") === "critical" ? "action_needed" : "heads_up" }
            ]
          }))
        }
      ]
    },
    csvRows
  };
}

async function buildZendeskOperationalSummaryReport(client: PoolClient, auth: AuthUser): Promise<LeadershipReportArtifact> {
  const summary = await getZendeskLeadershipSummary(client, auth);
  const trends = await getZendeskLeadershipTrends(client, auth, "this_week");
  return {
    detail: {
      id: "zendesk_operational_summary",
      title: "Zendesk Operational Summary",
      audience: "Leadership and customer service leaders",
      formats: { onscreen: true, pdf: true, csv: false },
      summary_line: summary.connection.live_enabled
        ? `${summary.kpis.open_tickets} open tickets are active, with ${summary.kpis.unassigned_tickets} still unassigned.`
        : "Zendesk is not fully connected, so this summary is running in mock or adapter mode.",
      tone: summary.flags.backlog_rising || summary.flags.reply_time_degrading ? "heads_up" : "good",
      leadership_only: false,
      generated_at: new Date().toISOString(),
      metrics: [
        { label: "Ticket volume", value: summary.kpis.open_tickets, tone: "info" },
        { label: "Backlog", value: summary.queue_health.total_open, tone: summary.flags.backlog_rising ? "heads_up" : "good" },
        { label: "First response", value: summary.kpis.median_first_reply_minutes != null ? `${summary.kpis.median_first_reply_minutes} min` : "n/a", tone: summary.flags.reply_time_degrading ? "heads_up" : "good" },
        { label: "Resolution", value: summary.kpis.median_resolution_minutes != null ? `${summary.kpis.median_resolution_minutes} min` : "n/a", tone: "info" }
      ],
      sections: [
        {
          id: "categories",
          title: "Top Categories",
          rows: summary.category_breakdown.map((row) => ({
            id: row.category,
            primary: row.category,
            values: [
              { label: "Total", value: row.total_count },
              { label: "Open", value: row.open_count, tone: row.open_count > 0 ? "heads_up" : "good" },
              { label: "Unassigned", value: row.unassigned_count, tone: row.unassigned_count > 0 ? "heads_up" : "good" }
            ]
          }))
        },
        {
          id: "trend",
          title: "Weekly Trend",
          rows: trends.points.map((point) => ({
            id: point.metric_date,
            primary: point.label,
            values: [
              { label: "Opened", value: point.opened_count },
              { label: "Resolved", value: point.resolved_count },
              { label: "Backlog", value: point.open_backlog_count, tone: point.open_backlog_count > summary.kpis.open_tickets ? "heads_up" : "neutral" }
            ]
          }))
        }
      ]
    },
    csvRows: []
  };
}

const MONDAY_MIGRATION_MODULES = [
  {
    module: "Shoot Locations and Setup Intel",
    ownership: "Mission Control primary, Monday coexistence",
    status: "Safer now",
    confidence: "High",
    detail: "Location guides, setup photos, and post-shoot evaluations are active in Mission Control with Monday-aware coexistence."
  },
  {
    module: "Shoot Scheduling and Staffing",
    ownership: "Mission Control primary",
    status: "Migrated",
    confidence: "High",
    detail: "Scheduling, staffing, approvals, and attendance are now controlled in Mission Control instead of Monday."
  },
  {
    module: "Production Queue and ID Cards",
    ownership: "Monday dependent",
    status: "Still dependent on Monday",
    confidence: "Medium",
    detail: "Business-pulse visibility exists, but the production queue still needs a clean live Mission Control feed."
  },
  {
    module: "Leadership Reporting",
    ownership: "Mission Control primary",
    status: "In progress",
    confidence: "Medium",
    detail: "Leadership reporting now lives in Mission Control, but migration progress still depends on Monday-connected operational signals in some areas."
  }
] as const;

async function buildMondayMigrationProgressReport(client: PoolClient, auth: AuthUser): Promise<LeadershipReportArtifact> {
  const mondayOps = await listIntegrationSyncOperations(client, auth, { provider: "monday" });
  const failed = mondayOps.filter((row) => row.status === "failed").length;
  const conflicts = mondayOps.filter((row) => row.status === "conflict").length;
  const pending = mondayOps.filter((row) => row.status === "pending" || row.status === "processing").length;
  return {
    detail: {
      id: "monday_migration_progress_report",
      title: "Monday Migration Progress Report",
      audience: "Leadership only",
      formats: { onscreen: true, pdf: true, csv: false },
      summary_line: `Mission Control is carrying more of the operational workload directly, while Monday remains in the loop for the workflows that still lack a clean first-party replacement.`,
      tone: failed > 0 || conflicts > 0 ? "heads_up" : "good",
      leadership_only: true,
      generated_at: new Date().toISOString(),
      metrics: [
        { label: "Monday sync operations", value: mondayOps.length, tone: mondayOps.length ? "info" : "neutral" },
        { label: "Failed syncs", value: failed, tone: toneFromCount(failed, 1, 2) },
        { label: "Conflicts", value: conflicts, tone: toneFromCount(conflicts, 1, 2) },
        { label: "Pending replay", value: pending, tone: pending > 0 ? "heads_up" : "good" }
      ],
      sections: [
        {
          id: "module_progress",
          title: "Module Confidence",
          rows: MONDAY_MIGRATION_MODULES.map((row, index) => ({
            id: `module-${index + 1}`,
            primary: row.module,
            secondary: row.detail,
            chips: [{ label: row.status, tone: row.status === "Still dependent on Monday" ? "heads_up" : row.status === "Migrated" ? "good" : "info" }],
            values: [
              { label: "Ownership", value: row.ownership },
              { label: "Confidence", value: row.confidence, tone: row.confidence === "High" ? "good" : "heads_up" }
            ]
          }))
        },
        {
          id: "sync_risks",
          title: "Monday Sync Risk",
          rows: mondayOps.slice(0, 20).map((row) => ({
            id: row.id,
            primary: `${row.entity_type} | ${row.operation_type}`,
            secondary: `${row.direction} | ${row.external_object_type}`,
            chips: [
              { label: humanizeLabel(row.status), tone: row.status === "failed" ? "action_needed" : row.status === "conflict" ? "heads_up" : "neutral" }
            ],
            values: [
              { label: "Source", value: row.source_system },
              { label: "Last Error", value: row.last_error ?? row.conflict_summary ?? "None" }
            ]
          }))
        }
      ]
    },
    csvRows: []
  };
}

function resolveCanonicalReportId(reportId: LeadershipReportId): CanonicalLeadershipReportId | null {
  switch (reportId) {
    case "executive_overview":
    case "shoot_operations_health":
    case "staffing_attendance":
    case "production_qa_health":
    case "customer_relationship_follow_through":
    case "location_intelligence_repeat_issues":
    case "workflow_compliance_data_quality":
      return reportId;
    case "todays_operations_summary":
    case "operational_intelligence_report":
      return "executive_overview";
    case "post_shoot_evaluation_summary":
    case "big_shoot_readiness_report":
      return "shoot_operations_health";
    case "weekly_labor_summary":
    case "attendance_exceptions_report":
    case "unfilled_shifts_report":
    case "late_no_show_trend":
    case "calendar_staffing_overview":
      return "staffing_attendance";
    case "zendesk_operational_summary":
      return "customer_relationship_follow_through";
    case "location_issue_tracker":
      return "location_intelligence_repeat_issues";
    case "open_approvals_report":
      return "workflow_compliance_data_quality";
    default:
      return null;
  }
}

function getEffectiveDepartmentFilter(auth: AuthUser, filters: LeadershipReportFilters) {
  if (filters.department) {
    return filters.department;
  }
  return auth.authorityTier === "supervisor" ? auth.department : null;
}

function filterShootsByDepartment(rows: ShootLikeRow[], department: string | null) {
  if (!department) {
    return rows;
  }
  return rows.filter((row) => String(row.department ?? "") === department);
}

function isReadyLikeShootStatus(value: string | null | undefined) {
  return ["READY", "LIVE", "SHOT_COMPLETE", "POST_PRODUCTION", "COMPLETE"].includes(String(value ?? "").toUpperCase());
}

function isCompletedShootStatus(value: string | null | undefined) {
  return ["SHOT_COMPLETE", "POST_PRODUCTION", "COMPLETE"].includes(String(value ?? "").toUpperCase());
}

function isOnTimeEvaluation(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "yes" || normalized === "on time" || normalized === "on_time" || normalized === "true";
}

function formatHoursValue(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) {
    return "n/a";
  }
  return `${Number(value).toFixed(1)}h`;
}

function formatMinutesValue(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) {
    return "n/a";
  }
  return `${Number(value).toFixed(1)} min`;
}

function metricToneFromRate(value: number, warningThreshold: number, actionThreshold: number, inverse = false): ReportTone {
  if (inverse) {
    if (value >= actionThreshold) {
      return "action_needed";
    }
    if (value >= warningThreshold) {
      return "heads_up";
    }
    return "good";
  }
  if (value <= actionThreshold) {
    return "action_needed";
  }
  if (value <= warningThreshold) {
    return "heads_up";
  }
  return "good";
}

function buildShootRiskRows(rows: ShootLikeRow[], anchorDate: string, limit = 10): LeadershipReportRow[] {
  return rows
    .map((row) => {
      const staffingGap = Math.max(0, Number(row.planned_staff_count ?? 0) - Number(row.scheduled_employee_count ?? 0));
      const leadGap = Math.max(0, Math.max(Number(row.required_lead_count ?? 1), 1) - Number(row.lead_coverage_count ?? 0));
      const issueCount =
        Number(row.open_alert_count ?? 0) +
        Number(row.open_attendance_exception_count ?? 0) +
        Number(row.conflict_warning_count ?? 0);
      const riskScore = staffingGap * 3 + leadGap * 4 + issueCount * 2 + importanceRank((row.priority_label ?? "standard") as ShootPriorityLabel);
      return { row, staffingGap, leadGap, issueCount, riskScore };
    })
    .filter((candidate) => candidate.riskScore > 0)
    .sort((left, right) => right.riskScore - left.riskScore || String(left.row.shoot_date ?? "").localeCompare(String(right.row.shoot_date ?? "")))
    .slice(0, limit)
    .map(({ row, staffingGap, leadGap, issueCount }) => ({
      id: String(row.id),
      primary: `${row.shoot_code} | ${row.title}`,
      secondary: `${formatDateLabel(row.shoot_date)} | ${locationLabel(row)} | ${formatDateTimeLabel(row.start_time ?? row.arrival_time)}`,
      chips: [
        {
          label: humanizePriorityLabel((row.priority_label ?? "standard") as ShootPriorityLabel),
          tone:
            row.priority_label === "critical_shoot"
              ? "action_needed"
              : row.priority_label === "big_shoot"
                ? "heads_up"
                : "neutral"
        },
        {
          label: staffingGap > 0 ? "Under Minimum" : leadGap > 0 ? "Lead Missing" : "Needs Review",
          tone: staffingGap > 0 || leadGap > 0 ? "action_needed" : "heads_up"
        }
      ],
      values: [
        {
          label: "Staffing",
          value: `${Number(row.scheduled_employee_count ?? 0)}/${Number(row.planned_staff_count ?? 0)}`,
          tone: staffingGap > 0 ? "action_needed" : "good"
        },
        {
          label: "Lead",
          value: `${Number(row.lead_coverage_count ?? 0)}/${Math.max(Number(row.required_lead_count ?? 1), 1)}`,
          tone: leadGap > 0 ? "action_needed" : "good"
        },
        { label: "Issues", value: issueCount, tone: issueCount > 0 ? "heads_up" : "good" }
      ],
      next_action:
        leadGap > 0
          ? "Assign lead coverage before the next prep checkpoint."
          : staffingGap > 0
            ? "Close the staffing gap before execution risk rises."
            : "Review readiness, attendance, and open alerts.",
      action_hash: "#operations/schedule"
    }));
}

function mapProductionQueueItemToReportRow(item: any): LeadershipReportRow {
  return {
    id: String(item.id),
    primary: String(item.title ?? item.summary ?? "Production job"),
    secondary: [item.linked_shoot_code, item.linked_organization_name, item.stage_label].filter(Boolean).join(" | "),
    chips: [
      ...(item.priority === "critical"
        ? [{ label: "Critical", tone: "action_needed" as ReportTone }]
        : item.priority === "high"
          ? [{ label: "High", tone: "heads_up" as ReportTone }]
          : []),
      ...(item.linked_shoot_importance_label
        ? [
            {
              label: String(item.linked_shoot_importance_label),
              tone:
                item.linked_shoot_importance_tier === "critical_shoot"
                  ? ("action_needed" as ReportTone)
                  : ("heads_up" as ReportTone)
            }
          ]
        : [])
    ],
    values: [
      { label: "Owner", value: String(item.owner_label ?? "Owner unassigned"), tone: item.owner_user_id ? "good" : "heads_up" },
      { label: "Due", value: String(item.due_label ?? "No due date"), tone: item.due_label ? "neutral" : "heads_up" },
      { label: "QA", value: String(item.qa_state_label ?? item.release_state_label ?? "Not started"), tone: item.stage === "correction_needed" ? "action_needed" : "neutral" }
    ],
    next_action: String(item.next_action ?? "Open the production job"),
    action_hash: "#production"
  };
}

function mapComplianceRowToReportRow(row: any): LeadershipReportRow {
  return {
    id: String(row.id),
    primary: `${row.issue_label ?? humanizeLabel(row.issue_type)} | ${row.employee_name ?? row.shoot_code ?? "Review item"}`,
    secondary: [row.shoot_title, row.location_name, row.organization_display_name].filter(Boolean).join(" | "),
    chips: [
      {
        label: humanizeLabel(String(row.urgency ?? "medium")),
        tone: row.urgency === "critical" ? "action_needed" : row.urgency === "high" ? "heads_up" : "neutral"
      }
    ],
    values: [
      { label: "Occurred", value: formatDateTimeLabel(row.occurred_at) },
      { label: "Status", value: humanizeLabel(String(row.source_status ?? "open")), tone: row.status_bucket === "resolved" ? "good" : "heads_up" }
    ],
    next_action: String(row.message ?? "Open the review queue"),
    action_hash: "#approvals"
  };
}

async function loadRelationshipRollup(client: PoolClient, auth: AuthUser, anchorDate: string) {
  const metricsResult = await client.query<{
    touchpoints_due_this_week: string | number;
    overdue_touchpoints: string | number;
    completed_touchpoints_on_time: string | number;
    open_follow_ups: string | number;
    overdue_follow_ups: string | number;
    stale_critical_contacts: string | number;
    ownerless_critical_contacts: string | number;
    escalated_customer_issues: string | number;
  }>(
    `
      SELECT
        (SELECT COUNT(*) FROM directory_touchpoint_plan WHERE tenant_id = $1 AND status::text = 'planned' AND due_at >= $2::date AND due_at < ($2::date + interval '7 days'))::int AS touchpoints_due_this_week,
        (SELECT COUNT(*) FROM directory_touchpoint_plan WHERE tenant_id = $1 AND status::text = 'planned' AND due_at < now())::int AS overdue_touchpoints,
        (SELECT COUNT(*) FROM directory_touchpoint_plan WHERE tenant_id = $1 AND status::text = 'completed' AND completed_at IS NOT NULL AND completed_at <= due_at)::int AS completed_touchpoints_on_time,
        (SELECT COUNT(*) FROM directory_relationship_follow_up WHERE tenant_id = $1 AND status::text IN ('open', 'in_progress'))::int AS open_follow_ups,
        (SELECT COUNT(*) FROM directory_relationship_follow_up WHERE tenant_id = $1 AND status::text IN ('open', 'in_progress') AND due_at < now())::int AS overdue_follow_ups,
        (SELECT COUNT(*) FROM organization_contact WHERE tenant_id = $1 AND active_status = 'active' AND operational_importance IN ('critical', 'high') AND (contact_status = 'needs_review' OR uncertainty_flag = true OR last_confirmed_at IS NULL OR last_confirmed_at < current_date - 180 OR primary_internal_owner_user_id IS NULL))::int AS stale_critical_contacts,
        (SELECT COUNT(*) FROM organization_contact WHERE tenant_id = $1 AND active_status = 'active' AND operational_importance = 'critical' AND primary_internal_owner_user_id IS NULL)::int AS ownerless_critical_contacts,
        (SELECT COUNT(*) FROM directory_touchpoint WHERE tenant_id = $1 AND outcome_state::text = 'escalated' AND occurred_at >= ($2::date - interval '30 days'))::int AS escalated_customer_issues
    `,
    [auth.tenantId, anchorDate]
  );
  const accountRowsResult = await client.query<{
    organization_id: string;
    organization_name: string;
    overdue_touchpoints: string | number;
    overdue_follow_ups: string | number;
    stale_key_contacts: string | number;
    relationship_health: string;
  }>(
    `
      WITH touchpoints AS (
        SELECT organization_id, COUNT(*) FILTER (WHERE status::text = 'planned' AND due_at < now()) AS overdue_touchpoints
        FROM directory_touchpoint_plan
        WHERE tenant_id = $1
        GROUP BY organization_id
      ),
      follow_ups AS (
        SELECT organization_id,
          COUNT(*) FILTER (WHERE status::text IN ('open', 'in_progress')) AS open_follow_ups,
          COUNT(*) FILTER (WHERE status::text IN ('open', 'in_progress') AND due_at < now()) AS overdue_follow_ups
        FROM directory_relationship_follow_up
        WHERE tenant_id = $1
        GROUP BY organization_id
      ),
      contacts AS (
        SELECT organization_id,
          COUNT(*) FILTER (WHERE active_status = 'active' AND operational_importance IN ('critical', 'high') AND (contact_status = 'needs_review' OR uncertainty_flag = true OR last_confirmed_at IS NULL OR last_confirmed_at < current_date - 180 OR primary_internal_owner_user_id IS NULL)) AS stale_key_contacts
        FROM organization_contact
        WHERE tenant_id = $1
        GROUP BY organization_id
      )
      SELECT
        organization.id::text AS organization_id,
        COALESCE(organization.display_name, organization.canonical_name, 'Account') AS organization_name,
        COALESCE(touchpoints.overdue_touchpoints, 0)::int AS overdue_touchpoints,
        COALESCE(follow_ups.overdue_follow_ups, 0)::int AS overdue_follow_ups,
        COALESCE(contacts.stale_key_contacts, 0)::int AS stale_key_contacts,
        CASE
          WHEN COALESCE(follow_ups.overdue_follow_ups, 0) > 0 OR COALESCE(touchpoints.overdue_touchpoints, 0) > 0 THEN 'at_risk'
          WHEN COALESCE(contacts.stale_key_contacts, 0) > 0 THEN 'fragile'
          WHEN COALESCE(follow_ups.open_follow_ups, 0) > 0 THEN 'needs_attention'
          ELSE 'healthy'
        END AS relationship_health
      FROM organization
      LEFT JOIN touchpoints ON touchpoints.organization_id = organization.id
      LEFT JOIN follow_ups ON follow_ups.organization_id = organization.id
      LEFT JOIN contacts ON contacts.organization_id = organization.id
      WHERE organization.tenant_id = $1
      ORDER BY
        CASE
          WHEN COALESCE(follow_ups.overdue_follow_ups, 0) > 0 OR COALESCE(touchpoints.overdue_touchpoints, 0) > 0 THEN 0
          WHEN COALESCE(contacts.stale_key_contacts, 0) > 0 THEN 1
          WHEN COALESCE(follow_ups.open_follow_ups, 0) > 0 THEN 2
          ELSE 3
        END,
        COALESCE(follow_ups.overdue_follow_ups, 0) DESC,
        COALESCE(contacts.stale_key_contacts, 0) DESC,
        organization_name ASC
      LIMIT 10
    `,
    [auth.tenantId]
  );
  const touchpointRowsResult = await client.query<{ id: string; title: string; organization_name: string | null; due_at: string; owner_name: string | null }>(
    `
      SELECT
        plan.id::text AS id,
        plan.title,
        COALESCE(organization.display_name, organization.canonical_name) AS organization_name,
        plan.due_at::text AS due_at,
        owner.full_name AS owner_name
      FROM directory_touchpoint_plan plan
      LEFT JOIN organization ON organization.id = plan.organization_id
      LEFT JOIN app_user owner ON owner.id = plan.owner_user_id
      WHERE plan.tenant_id = $1
        AND plan.status::text = 'planned'
        AND plan.due_at >= $2::date
        AND plan.due_at < ($2::date + interval '7 days')
      ORDER BY plan.due_at ASC
      LIMIT 8
    `,
    [auth.tenantId, anchorDate]
  );
  const followUpRowsResult = await client.query<{ id: string; title: string; organization_name: string | null; due_at: string; owner_name: string | null }>(
    `
      SELECT
        follow_up.id::text AS id,
        follow_up.title,
        COALESCE(organization.display_name, organization.canonical_name) AS organization_name,
        follow_up.due_at::text AS due_at,
        owner.full_name AS owner_name
      FROM directory_relationship_follow_up follow_up
      LEFT JOIN organization ON organization.id = follow_up.organization_id
      LEFT JOIN app_user owner ON owner.id = follow_up.owner_user_id
      WHERE follow_up.tenant_id = $1
        AND follow_up.status::text IN ('open', 'in_progress')
      ORDER BY (follow_up.due_at < now()) DESC, follow_up.due_at ASC
      LIMIT 8
    `,
    [auth.tenantId]
  );

  return {
    metrics: metricsResult.rows[0],
    accountRows: accountRowsResult.rows,
    touchpointRows: touchpointRowsResult.rows,
    followUpRows: followUpRowsResult.rows
  };
}

async function loadLocationMemoryRollup(client: PoolClient, auth: AuthUser, startDate: string, endDate: string) {
  const memoryStatsResult = await client.query<{ fresh_count: string | number; aging_count: string | number; needs_refresh_count: string | number; total_count: string | number }>(
      `
        WITH memory AS (
          SELECT
            note.object_id::text AS location_id,
            MAX(COALESCE(note.promotion_published_at, note.updated_at, note.created_at)) FILTER (WHERE note.publication_state = 'active' AND note.archived_at IS NULL) AS last_confirmed_at,
            BOOL_OR(note.publication_state = 'proposed' AND note.archived_at IS NULL) AS has_proposed
          FROM operational_note note
          WHERE note.tenant_id = $1
            AND note.object_type = 'location'
            AND note.note_type = 'location_memory'
          GROUP BY note.object_id
        ),
        photos AS (
          SELECT photo.location_id::text AS location_id, MAX(COALESCE(photo.reviewed_at, photo.uploaded_at, photo.created_at)) AS last_photo_at
          FROM setup_photo_upload photo
          WHERE photo.tenant_id = $1
          GROUP BY photo.location_id
        )
        SELECT
          COUNT(*)::int AS total_count,
          COUNT(*) FILTER (WHERE COALESCE(memory.last_confirmed_at, photos.last_photo_at) >= now() - interval '180 days' AND NOT COALESCE(memory.has_proposed, false))::int AS fresh_count,
          COUNT(*) FILTER (WHERE COALESCE(memory.last_confirmed_at, photos.last_photo_at) < now() - interval '180 days' AND COALESCE(memory.last_confirmed_at, photos.last_photo_at) >= now() - interval '365 days' AND NOT COALESCE(memory.has_proposed, false))::int AS aging_count,
          COUNT(*) FILTER (WHERE memory.location_id IS NULL OR COALESCE(memory.has_proposed, false) OR COALESCE(memory.last_confirmed_at, photos.last_photo_at) IS NULL OR COALESCE(memory.last_confirmed_at, photos.last_photo_at) < now() - interval '365 days')::int AS needs_refresh_count
        FROM shoot_location location
        LEFT JOIN memory ON memory.location_id = location.id::text
        LEFT JOIN photos ON photos.location_id = location.id::text
        WHERE location.tenant_id = $1
          AND location.active_status = 'active'
      `,
      [auth.tenantId]
    );
  const staleRowsResult = await client.query<{ location_id: string; location_name: string; freshness_state: string; last_confirmed_at: string | null }>(
      `
        WITH memory AS (
          SELECT
            note.object_id::text AS location_id,
            MAX(COALESCE(note.promotion_published_at, note.updated_at, note.created_at)) FILTER (WHERE note.publication_state = 'active' AND note.archived_at IS NULL) AS last_confirmed_at,
            BOOL_OR(note.publication_state = 'proposed' AND note.archived_at IS NULL) AS has_proposed
          FROM operational_note note
          WHERE note.tenant_id = $1
            AND note.object_type = 'location'
            AND note.note_type = 'location_memory'
          GROUP BY note.object_id
        ),
        photos AS (
          SELECT photo.location_id::text AS location_id, MAX(COALESCE(photo.reviewed_at, photo.uploaded_at, photo.created_at)) AS last_photo_at
          FROM setup_photo_upload photo
          WHERE photo.tenant_id = $1
          GROUP BY photo.location_id
        )
        SELECT
          location.id::text AS location_id,
          location.name AS location_name,
          CASE
            WHEN memory.location_id IS NULL OR COALESCE(memory.has_proposed, false) OR COALESCE(memory.last_confirmed_at, photos.last_photo_at) IS NULL OR COALESCE(memory.last_confirmed_at, photos.last_photo_at) < now() - interval '365 days' THEN 'needs_refresh'
            WHEN COALESCE(memory.last_confirmed_at, photos.last_photo_at) < now() - interval '180 days' THEN 'aging'
            ELSE 'fresh'
          END AS freshness_state,
          COALESCE(memory.last_confirmed_at, photos.last_photo_at)::text AS last_confirmed_at
        FROM shoot_location location
        LEFT JOIN memory ON memory.location_id = location.id::text
        LEFT JOIN photos ON photos.location_id = location.id::text
        WHERE location.tenant_id = $1
          AND location.active_status = 'active'
        ORDER BY
          CASE
            WHEN memory.location_id IS NULL OR COALESCE(memory.has_proposed, false) OR COALESCE(memory.last_confirmed_at, photos.last_photo_at) IS NULL OR COALESCE(memory.last_confirmed_at, photos.last_photo_at) < now() - interval '365 days' THEN 0
            WHEN COALESCE(memory.last_confirmed_at, photos.last_photo_at) < now() - interval '180 days' THEN 1
            ELSE 2
          END,
          location.name ASC
        LIMIT 10
      `,
      [auth.tenantId]
    );
  const setupResult = await client.query<{ missing_setup_count: string | number }>(
      `
        SELECT COUNT(*) FILTER (WHERE item_type = 'missing_setup_photo' AND status <> 'resolved' AND first_detected_at::date BETWEEN $2::date AND $3::date)::int AS missing_setup_count
        FROM time_clock_compliance_flag
        WHERE tenant_id = $1
      `,
      [auth.tenantId, startDate, endDate]
    );

  return {
    stats: memoryStatsResult.rows[0],
    staleRows: staleRowsResult.rows,
    missingSetupCount: Number(setupResult.rows[0]?.missing_setup_count ?? 0)
  };
}

async function buildExecutiveOverviewReport(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportArtifact> {
  const dateFrom = filters.dateFrom ?? filters.anchorDate;
  const dateTo = filters.dateTo ?? formatDateOnly(addDays(parseDateOnly(filters.anchorDate), 6));
  const relationship = await loadRelationshipRollup(client, auth, filters.anchorDate);
  const todayOps = await getOperationsDashboard(client, auth, {
    date: filters.anchorDate,
    department: getEffectiveDepartmentFilter(auth, filters) ?? undefined
  });
  const shootRangeRaw = await listShoots(client, { dateFrom, dateTo }, auth);
  const productionSnapshot = await getProductionProjectHomeSnapshot(client, auth, { anchorDate: filters.anchorDate });
  const productionBoard = await listProductionProjects(client, auth, { anchorDate: filters.anchorDate, status: "open" });
  const evals = await loadEvaluationSummaryRows(client, auth, dateFrom, dateTo);

  const shootRange = filterShootsByDepartment(shootRangeRaw, getEffectiveDepartmentFilter(auth, filters));
  const atRiskRows = buildShootRiskRows(shootRange, filters.anchorDate);
  const underMinimumCount = shootRange.filter((row) => Number(row.scheduled_employee_count ?? 0) < Number(row.planned_staff_count ?? 0)).length;
  const lateMissingStaffCount =
    Number(todayOps.summary.late_warning_count ?? 0) +
    Number(todayOps.summary.no_show_suspected_count ?? 0) +
    Number(todayOps.summary.missed_punch_count ?? 0);
  const onTimeStartRate = safeRate(evals.filter((row) => isOnTimeEvaluation(row.on_time)).length, evals.length);
  const readyByCutoffRate = safeRate(
    shootRange.filter((row) => isReadyLikeShootStatus(row.normalized_status ?? row.status)).length,
    Math.max(shootRange.length, 1)
  );
  const productionOnTimeRate = safeRate(productionSnapshot.counts.on_time, Math.max(productionSnapshot.counts.active_jobs, 1));
  const touchpointCompletionRate = safeRate(
    Number(relationship.metrics.completed_touchpoints_on_time ?? 0),
    Math.max(Number(relationship.metrics.touchpoints_due_this_week ?? 0), 1)
  );

  return buildCanonicalArtifact({
    id: "executive_overview",
    title: "Executive Overview",
    audience: "Leadership and admins",
    summaryLine:
      atRiskRows.length || productionSnapshot.counts.blocked || Number(relationship.metrics.overdue_follow_ups ?? 0)
        ? `${atRiskRows.length} shoots are carrying operational risk, ${productionSnapshot.counts.blocked} production jobs are blocked, and ${Number(relationship.metrics.overdue_follow_ups ?? 0)} customer follow-ups are overdue.`
        : "Operational posture is steady across shoots, staffing, production, and relationship follow-through.",
    tone:
      atRiskRows.length > 0 || productionSnapshot.counts.blocked > 0 || Number(relationship.metrics.escalated_customer_issues ?? 0) > 0
        ? "action_needed"
        : lateMissingStaffCount > 0 || productionSnapshot.counts.overdue > 0 || Number(relationship.metrics.stale_critical_contacts ?? 0) > 0
          ? "heads_up"
          : "good",
    generatedAt: new Date().toISOString(),
    freshnessState: "live",
    defaultWindow: getCanonicalReportDefinition("executive_overview").defaultWindow,
    filters,
    topSummary: [
      makeMetric({ id: "shoots_today", label: "Shoots today", value: Number(todayOps.summary.shoots ?? shootRange.filter((row) => String(row.shoot_date ?? "") === filters.anchorDate).length), tone: "info", definition: "Shoots on the selected anchor day." }),
      makeMetric({ id: "shoots_this_week", label: "Shoots this week", value: shootRange.length, tone: "info", definition: "Shoots in the current reporting window." }),
      makeMetric({ id: "shoots_at_risk", label: "Shoots at risk", value: atRiskRows.length, tone: toneFromCount(atRiskRows.length, 1, 3), definition: "Shoots with staffing, lead, readiness, or alert pressure." }),
      makeMetric({ id: "under_minimum", label: "Under minimum staffed shoots", value: underMinimumCount, tone: toneFromCount(underMinimumCount, 1, 3), definition: "Shoots below planned staffing minimum." }),
      makeMetric({ id: "late_missing", label: "Late or missing staff incidents", value: lateMissingStaffCount, tone: toneFromCount(lateMissingStaffCount, 1, 3), definition: "Same-day attendance issues with operational impact." }),
      makeMetric({ id: "blocked_production", label: "Blocked production jobs", value: productionSnapshot.counts.blocked, tone: toneFromCount(productionSnapshot.counts.blocked, 1, 3), definition: "Open production jobs sitting in Blocked." }),
      makeMetric({ id: "overdue_production", label: "Overdue production jobs", value: productionSnapshot.counts.overdue, tone: toneFromCount(productionSnapshot.counts.overdue, 1, 3), definition: "Open production jobs past due." }),
      makeMetric({ id: "customer_issues", label: "Open major customer issues", value: Number(relationship.metrics.escalated_customer_issues ?? 0), tone: toneFromCount(Number(relationship.metrics.escalated_customer_issues ?? 0), 1, 2) }),
      makeMetric({ id: "overdue_followups", label: "Overdue follow-ups", value: Number(relationship.metrics.overdue_follow_ups ?? 0), tone: toneFromCount(Number(relationship.metrics.overdue_follow_ups ?? 0), 1, 3) }),
      makeMetric({ id: "relationship_attention", label: "Accounts flagged Needs Attention/Fragile", value: relationship.accountRows.filter((row) => row.relationship_health !== "healthy").length, tone: toneFromCount(relationship.accountRows.filter((row) => row.relationship_health !== "healthy").length, 1, 3) })
    ],
    trendCards: [
      makeMetric({ id: "on_time_start_rate", label: "On-time start rate", value: `${onTimeStartRate.toFixed(1)}%`, tone: metricToneFromRate(onTimeStartRate, 90, 80), detail: `${evals.filter((row) => isOnTimeEvaluation(row.on_time)).length}/${evals.length || 0} eligible completed shoots`, definition: "Eligible shoots that started on time or within tolerance divided by total eligible completed shoots." }),
      makeMetric({ id: "ready_by_cutoff_rate", label: "Ready-by-cutoff rate", value: `${readyByCutoffRate.toFixed(1)}%`, tone: metricToneFromRate(readyByCutoffRate, 90, 80), detail: `${shootRange.filter((row) => isReadyLikeShootStatus(row.normalized_status ?? row.status)).length}/${shootRange.length || 0} upcoming eligible shoots`, definition: "Eligible upcoming shoots that reached Ready by cutoff divided by total eligible upcoming shoots." }),
      makeMetric({ id: "production_on_time", label: "Production on-time completion rate", value: `${productionOnTimeRate.toFixed(1)}%`, tone: metricToneFromRate(productionOnTimeRate, 90, 80), detail: `${productionSnapshot.counts.on_time}/${productionSnapshot.counts.active_jobs || 0} active jobs`, definition: "Jobs tracking on time in the current production board." }),
      makeMetric({ id: "touchpoint_completion", label: "Touchpoint completion rate", value: `${touchpointCompletionRate.toFixed(1)}%`, tone: metricToneFromRate(touchpointCompletionRate, 90, 80), detail: `${Number(relationship.metrics.completed_touchpoints_on_time ?? 0)}/${Number(relationship.metrics.touchpoints_due_this_week ?? 0) || 0} due this week`, definition: "Touchpoints completed by due date divided by total touchpoints due in the current window." }),
      makeMetric({ id: "stale_critical_contacts", label: "Stale critical contact count", value: Number(relationship.metrics.stale_critical_contacts ?? 0), tone: toneFromCount(Number(relationship.metrics.stale_critical_contacts ?? 0), 1, 3), definition: "Critical or high-importance contacts outside freshness expectations." })
    ],
    exceptionSections: [
      {
        id: "shoot_risk",
        title: "Today and Next 7 Days Risk",
        summary: atRiskRows.length ? "Shoots with the highest immediate operational pressure are ranked first." : "No shoots are carrying meaningful operational risk in the current view.",
        rows: atRiskRows,
        action_hash: "#operations/schedule"
      },
      {
        id: "production_pressure",
        title: "Production Pressure",
        summary: productionSnapshot.counts.blocked || productionSnapshot.counts.overdue ? "Blocked, overdue, and release-sensitive jobs stay visible before they slip." : "Production has no blocked or at-risk queue pressure in the current view.",
        rows: [
          ...(productionBoard.sections.find((section) => section.id === "blocked_queue")?.items ?? []).slice(0, 4).map(mapProductionQueueItemToReportRow),
          ...(productionBoard.sections.find((section) => section.id === "at_risk_queue")?.items ?? []).slice(0, 4).map(mapProductionQueueItemToReportRow)
        ],
        action_hash: "#production"
      },
      {
        id: "relationship_attention",
        title: "Relationship Attention Needed",
        summary: relationship.accountRows.length ? "Accounts with overdue touchpoints, overdue follow-ups, or stale critical contacts rise first." : "No account continuity risk rose above the watch threshold.",
        rows: relationship.accountRows.map((row) => ({
          id: row.organization_id,
          primary: row.organization_name,
          secondary: humanizeLabel(row.relationship_health),
          chips: [{ label: humanizeLabel(row.relationship_health), tone: row.relationship_health === "at_risk" ? "action_needed" : row.relationship_health === "fragile" ? "heads_up" : "neutral" }],
          values: [
            { label: "Overdue Touchpoints", value: Number(row.overdue_touchpoints ?? 0), tone: Number(row.overdue_touchpoints ?? 0) > 0 ? "action_needed" : "good" },
            { label: "Overdue Follow-Ups", value: Number(row.overdue_follow_ups ?? 0), tone: Number(row.overdue_follow_ups ?? 0) > 0 ? "action_needed" : "good" },
            { label: "Stale Contacts", value: Number(row.stale_key_contacts ?? 0), tone: Number(row.stale_key_contacts ?? 0) > 0 ? "heads_up" : "good" }
          ],
          next_action: "Open the account continuity view and resolve the highest-risk open item.",
          action_hash: "#directory"
        })),
        action_hash: "#directory"
      }
    ],
    drilldownSections: [
      {
        id: "upcoming_touchpoints",
        title: "Upcoming Touchpoints",
        rows: relationship.touchpointRows.map((row) => ({
          id: row.id,
          primary: row.title,
          secondary: [row.organization_name, formatDateTimeLabel(row.due_at)].filter(Boolean).join(" | "),
          values: [{ label: "Owner", value: String(row.owner_name ?? "Owner pending"), tone: row.owner_name ? "good" : "heads_up" }],
          next_action: "Open the touchpoint and close or skip it intentionally.",
          action_hash: "#directory"
        })),
        action_hash: "#directory"
      },
      {
        id: "open_followups",
        title: "Open Follow-Ups",
        rows: relationship.followUpRows.map((row) => ({
          id: row.id,
          primary: row.title,
          secondary: [row.organization_name, formatDateTimeLabel(row.due_at)].filter(Boolean).join(" | "),
          values: [
            { label: "Owner", value: String(row.owner_name ?? "Owner pending"), tone: row.owner_name ? "good" : "heads_up" },
            { label: "Due", value: formatDateTimeLabel(row.due_at), tone: new Date(row.due_at).getTime() < Date.now() ? "action_needed" : "neutral" }
          ],
          next_action: "Close the promised follow-up or reassign it.",
          action_hash: "#directory"
        })),
        action_hash: "#directory"
      }
    ],
    detailPanel: {
      title: "Metric Trust",
      summary: "Executive reporting is traceable and grounded in structured records.",
      items: [
        { label: "Current-day caveat", value: "Live operational data may still be incomplete while the day is in motion." },
        { label: "Primary drill-ins", value: "Operations, Production, Directory, and Review Desk own the records behind these metrics." },
        { label: "Touchpoint rule", value: "Touchpoints that did not happen become overdue or intentionally skipped. They do not silently disappear." },
        { label: "Relationship trust", value: "Needs Attention, Fragile, and At Risk states come from overdue follow-through, stale contacts, and unresolved continuity gaps." }
      ]
    },
    csvRows: shootRange.map((row) => ({
      shoot_code: row.shoot_code,
      shoot_title: row.title,
      shoot_date: row.shoot_date ?? "",
      department: row.department ?? "",
      location_name: row.location_name ?? "",
      priority_label: row.priority_label ?? "standard",
      staffing_assigned: Number(row.scheduled_employee_count ?? 0),
      staffing_planned: Number(row.planned_staff_count ?? 0),
      lead_coverage_count: Number(row.lead_coverage_count ?? 0),
      required_lead_count: Number(row.required_lead_count ?? 0),
      ready_eligible: Boolean(row.ready_eligible),
      alert_count: Number(row.open_alert_count ?? 0)
    }))
  });
}

async function buildShootOperationsHealthReport(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportArtifact> {
  const range = getDateWindow(filters, 30);
  const shootsRaw = await listShoots(client, { dateFrom: range.startDate, dateTo: range.endDate }, auth);
  const evaluations = await loadEvaluationSummaryRows(client, auth, range.startDate, range.endDate);
  const bigShootReadiness = await buildBigShootReadinessReport(client, auth, filters);
  const evalSummary = await buildPostShootEvaluationSummaryReport(client, auth, filters);
  const calendarOverview = await buildCalendarStaffingOverviewReport(client, auth, filters);
  const complianceFlags = await client.query<{ missing_eval_count: string | number; missing_setup_count: string | number; first_time_location_count: string | number }>(
    `
      SELECT
        (SELECT COUNT(*) FROM time_clock_compliance_flag WHERE tenant_id = $1 AND item_type = 'missing_post_shoot_evaluation' AND status <> 'resolved' AND first_detected_at::date BETWEEN $2::date AND $3::date)::int AS missing_eval_count,
        (SELECT COUNT(*) FROM time_clock_compliance_flag WHERE tenant_id = $1 AND item_type = 'missing_setup_photo' AND status <> 'resolved' AND first_detected_at::date BETWEEN $2::date AND $3::date)::int AS missing_setup_count,
        (
          SELECT COUNT(*)::int
          FROM shoot shoot
          WHERE shoot.tenant_id = $1
            AND shoot.location_id IS NOT NULL
            AND shoot.shoot_date BETWEEN $2::date AND $3::date
            AND ($4::text IS NULL OR shoot.department::text = $4::text)
            AND NOT EXISTS (
              SELECT 1
              FROM shoot prior
              WHERE prior.tenant_id = shoot.tenant_id
                AND prior.location_id = shoot.location_id
                AND (prior.shoot_date < shoot.shoot_date OR (prior.shoot_date = shoot.shoot_date AND prior.created_at < shoot.created_at))
            )
        ) AS first_time_location_count
    `,
    [auth.tenantId, range.startDate, range.endDate, getEffectiveDepartmentFilter(auth, filters)]
  );

  const shoots = filterShootsByDepartment(shootsRaw, getEffectiveDepartmentFilter(auth, filters));
  const completedShoots = shoots.filter((row) => isCompletedShootStatus(row.normalized_status ?? row.status));
  const onTimeCount = evaluations.filter((row) => isOnTimeEvaluation(row.on_time)).length;
  const bigCriticalCount = shoots.filter((row) => isBigShootLabel((row.priority_label ?? "standard") as ShootPriorityLabel)).length;
  const underMinimumCount = shoots.filter((row) => Number(row.scheduled_employee_count ?? 0) < Number(row.planned_staff_count ?? 0)).length;
  const sameDayIssueCount = shoots.filter((row) => String(row.shoot_date ?? "") === filters.anchorDate && (Number(row.scheduled_employee_count ?? 0) < Number(row.planned_staff_count ?? 0) || Number(row.lead_coverage_count ?? 0) < Math.max(Number(row.required_lead_count ?? 1), 1) || Number(row.open_attendance_exception_count ?? 0) > 0)).length;
  const leadCoverageRate = safeRate(shoots.filter((row) => Number(row.lead_coverage_count ?? 0) >= Math.max(Number(row.required_lead_count ?? 1), 1)).length, Math.max(shoots.filter((row) => Math.max(Number(row.required_lead_count ?? 1), 1) > 0).length, 1));
  const readyByCutoffRate = safeRate(shoots.filter((row) => isReadyLikeShootStatus(row.normalized_status ?? row.status)).length, Math.max(shoots.length, 1));
  const evalCompletionRate = safeRate(evaluations.length, Math.max(evaluations.length + Number(complianceFlags.rows[0]?.missing_eval_count ?? 0), 1));
  const majorIssueCount = evaluations.filter((row) => Boolean(row.major_issue_flag) || row.overall_outcome === "major_issues" || row.overall_outcome === "needs_leadership_review").length;
  const atRiskRows = buildShootRiskRows(shoots, filters.anchorDate);

  return buildCanonicalArtifact({
    id: "shoot_operations_health",
    title: "Shoot Operations Health",
    audience: "Leadership and managers",
    summaryLine:
      underMinimumCount || majorIssueCount
        ? `${underMinimumCount} shoots fell below minimum staffing and ${majorIssueCount} major issue signal${majorIssueCount === 1 ? "" : "s"} surfaced in the current reporting window.`
        : "Shoot operations stayed steady in the current reporting window.",
    tone: underMinimumCount > 0 || majorIssueCount > 0 ? "heads_up" : evalCompletionRate < 90 ? "heads_up" : "good",
    generatedAt: new Date().toISOString(),
    freshnessState: "recently_updated",
    defaultWindow: getCanonicalReportDefinition("shoot_operations_health").defaultWindow,
    filters,
    topSummary: [
      makeMetric({ id: "completed_shoots", label: "Total shoots completed", value: completedShoots.length, tone: "info", definition: "Completed shoots in the selected reporting window." }),
      makeMetric({ id: "first_time_locations", label: "First-time location count", value: Number(complianceFlags.rows[0]?.first_time_location_count ?? 0), tone: toneFromCount(Number(complianceFlags.rows[0]?.first_time_location_count ?? 0), 1, 4) }),
      makeMetric({ id: "big_critical_count", label: "Big/Critical shoot count", value: bigCriticalCount, tone: bigCriticalCount > 0 ? "heads_up" : "neutral" }),
      makeMetric({ id: "on_time_rate", label: "On-time start rate", value: `${safeRate(onTimeCount, Math.max(evaluations.length, 1)).toFixed(1)}%`, tone: metricToneFromRate(safeRate(onTimeCount, Math.max(evaluations.length, 1)), 90, 80) }),
      makeMetric({ id: "ready_rate", label: "Ready-by-cutoff rate", value: `${readyByCutoffRate.toFixed(1)}%`, tone: metricToneFromRate(readyByCutoffRate, 90, 80) }),
      makeMetric({ id: "lead_coverage_rate", label: "Lead coverage rate", value: `${leadCoverageRate.toFixed(1)}%`, tone: metricToneFromRate(leadCoverageRate, 95, 85) }),
      makeMetric({ id: "under_minimum_rate", label: "Under minimum staffing rate", value: `${safeRate(underMinimumCount, Math.max(shoots.length, 1)).toFixed(1)}%`, tone: metricToneFromRate(safeRate(underMinimumCount, Math.max(shoots.length, 1)), 10, 20, true) }),
      makeMetric({ id: "same_day_issue_rate", label: "Same-day staffing issue rate", value: `${safeRate(sameDayIssueCount, Math.max(shoots.filter((row) => String(row.shoot_date ?? "") === filters.anchorDate).length, 1)).toFixed(1)}%`, tone: toneFromCount(sameDayIssueCount, 1, 3) }),
      makeMetric({ id: "eval_completion_rate", label: "Post-shoot eval completion rate", value: `${evalCompletionRate.toFixed(1)}%`, tone: metricToneFromRate(evalCompletionRate, 90, 80) }),
      makeMetric({ id: "major_issue_rate", label: "Major issue rate per 100 shoots", value: completedShoots.length ? Number(((majorIssueCount / Math.max(completedShoots.length, 1)) * 100).toFixed(1)) : 0, tone: metricToneFromRate(completedShoots.length ? Number(((majorIssueCount / Math.max(completedShoots.length, 1)) * 100).toFixed(1)) : 0, 8, 15, true) })
    ],
    trendCards: [
      makeMetric({ id: "missing_setup_photos", label: "Missing setup photo count", value: Number(complianceFlags.rows[0]?.missing_setup_count ?? 0), tone: toneFromCount(Number(complianceFlags.rows[0]?.missing_setup_count ?? 0), 1, 3) }),
      makeMetric({ id: "missing_evals", label: "Required eval gap", value: Number(complianceFlags.rows[0]?.missing_eval_count ?? 0), tone: toneFromCount(Number(complianceFlags.rows[0]?.missing_eval_count ?? 0), 1, 3) }),
      makeMetric({ id: "readiness_watch", label: "At-risk shoots", value: atRiskRows.length, tone: toneFromCount(atRiskRows.length, 1, 3) })
    ],
    exceptionSections: [
      { id: "at_risk_shoots", title: "At-Risk Shoot Queue", summary: atRiskRows.length ? "Shoots with readiness, staffing, or same-day issue pressure are ranked first." : "No shoots are currently carrying material operational pressure.", rows: atRiskRows, action_hash: "#operations/schedule" },
      { id: "big_critical_readiness", title: "Big and Critical Visibility", summary: bigShootReadiness.detail.summary_line, rows: bigShootReadiness.detail.sections.flatMap((section) => section.rows ?? []).slice(0, 10), action_hash: "#operations/schedule" }
    ],
    drilldownSections: [
      { id: "staffing_by_day", title: "Staffing and Calendar Pressure", summary: calendarOverview.detail.summary_line, rows: calendarOverview.detail.sections.flatMap((section) => section.rows ?? []).slice(0, 12), action_hash: "#operations/schedule" },
      { id: "post_shoot_patterns", title: "Post-Shoot Signals", summary: evalSummary.detail.summary_line, rows: evalSummary.detail.sections.flatMap((section) => section.rows ?? []).slice(0, 12), action_hash: "#operations/schedule" }
    ],
    detailPanel: {
      title: "Operational Definitions",
      items: [
        { label: "On-time start rate", value: "Eligible completed shoots that started on time or within tolerance divided by total eligible completed shoots." },
        { label: "Lead coverage rate", value: "Lead-required shoots with valid lead coverage divided by total lead-required shoots in window." },
        { label: "Major issue rate", value: "Major issue or leadership-review outcomes divided by completed shoots, scaled per 100 shoots." },
        { label: "Source records", value: "Shoots, staffing readiness, and post-shoot evals feed this dashboard." }
      ]
    },
    csvRows: shoots.map((row) => ({
      shoot_code: row.shoot_code,
      shoot_title: row.title,
      shoot_date: row.shoot_date ?? "",
      department: row.department ?? "",
      location_name: row.location_name ?? "",
      priority_label: row.priority_label ?? "standard",
      ready_eligible: Boolean(row.ready_eligible),
      staffing_assigned: Number(row.scheduled_employee_count ?? 0),
      staffing_planned: Number(row.planned_staff_count ?? 0),
      lead_coverage_count: Number(row.lead_coverage_count ?? 0),
      required_lead_count: Number(row.required_lead_count ?? 0),
      alert_count: Number(row.open_alert_count ?? 0),
      attendance_exception_count: Number(row.open_attendance_exception_count ?? 0)
    }))
  });
}

async function buildStaffingAttendanceReport(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportArtifact> {
  const range = getDateWindow(filters, 30);
  const weeklyLabor = await buildWeeklyLaborReport(client, auth, filters);
  const attendanceExceptions = await buildAttendanceExceptionsReport(client, auth, filters);
  const unfilledShifts = await buildUnfilledShiftsReport(client, auth, filters);
  const lateNoShow = await buildLateNoShowTrendReport(client, auth, filters);
  const ops = await getOperationsDashboard(client, auth, {
    dateFrom: range.startDate,
    dateTo: range.endDate,
    department: getEffectiveDepartmentFilter(auth, filters) ?? undefined,
    date: ""
  });
  const shootsRaw = await listShoots(client, { dateFrom: range.startDate, dateTo: range.endDate }, auth);

  const shoots = filterShootsByDepartment(shootsRaw, getEffectiveDepartmentFilter(auth, filters));
  const underMinimumCount = shoots.filter((row) => Number(row.scheduled_employee_count ?? 0) < Number(row.planned_staff_count ?? 0)).length;
  const fragileCount = shoots.filter((row) => Number(row.scheduled_employee_count ?? 0) >= Number(row.planned_staff_count ?? 0) && (Number(row.open_alert_count ?? 0) > 0 || Number(row.conflict_warning_count ?? 0) > 0)).length;
  const fillRate = safeRate(shoots.length - underMinimumCount, Math.max(shoots.length, 1));
  const leadCoverageRate = safeRate(shoots.filter((row) => Number(row.lead_coverage_count ?? 0) >= Math.max(Number(row.required_lead_count ?? 1), 1)).length, Math.max(shoots.filter((row) => Math.max(Number(row.required_lead_count ?? 1), 1) > 0).length, 1));

  return buildCanonicalArtifact({
    id: "staffing_attendance",
    title: "Staffing and Attendance",
    audience: "Leadership and managers",
    summaryLine:
      underMinimumCount || Number(ops.summary.no_show_suspected_count ?? 0)
        ? `${underMinimumCount} shoots are under minimum and ${Number(ops.summary.no_show_suspected_count ?? 0)} probable no-show signal${Number(ops.summary.no_show_suspected_count ?? 0) === 1 ? "" : "s"} surfaced in the current window.`
        : "Staffing coverage and attendance reliability are steady in the current reporting window.",
    tone:
      underMinimumCount > 0 || Number(ops.summary.no_show_suspected_count ?? 0) > 0
        ? "action_needed"
        : Number(ops.summary.late_warning_count ?? 0) > 0 || fragileCount > 0
          ? "heads_up"
          : "good",
    generatedAt: new Date().toISOString(),
    freshnessState: "recently_updated",
    defaultWindow: getCanonicalReportDefinition("staffing_attendance").defaultWindow,
    filters,
    topSummary: [
      makeMetric({ id: "staffing_fill_rate", label: "Staffing fill rate", value: `${fillRate.toFixed(1)}%`, tone: metricToneFromRate(fillRate, 95, 85) }),
      makeMetric({ id: "lead_coverage_rate", label: "Lead coverage rate", value: `${leadCoverageRate.toFixed(1)}%`, tone: metricToneFromRate(leadCoverageRate, 95, 85) }),
      makeMetric({ id: "under_minimum_rate", label: "Under minimum staffing rate", value: `${safeRate(underMinimumCount, Math.max(shoots.length, 1)).toFixed(1)}%`, tone: metricToneFromRate(safeRate(underMinimumCount, Math.max(shoots.length, 1)), 10, 20, true) }),
      makeMetric({ id: "fragile_staffing_rate", label: "Fragile staffing rate", value: `${safeRate(fragileCount, Math.max(shoots.length, 1)).toFixed(1)}%`, tone: metricToneFromRate(safeRate(fragileCount, Math.max(shoots.length, 1)), 10, 20, true) }),
      makeMetric({ id: "same_day_reassignments", label: "Same-day reassignment count", value: Number(ops.summary.trade_request_count ?? 0), tone: toneFromCount(Number(ops.summary.trade_request_count ?? 0), 1, 3) }),
      makeMetric({ id: "on_time_arrival_rate", label: "On-time arrival rate", value: `${safeRate(Math.max(0, Number(ops.summary.scheduled_shifts ?? 0) - Number(ops.summary.late_warning_count ?? 0) - Number(ops.summary.no_show_suspected_count ?? 0)), Math.max(Number(ops.summary.scheduled_shifts ?? 0), 1)).toFixed(1)}%`, tone: metricToneFromRate(safeRate(Math.max(0, Number(ops.summary.scheduled_shifts ?? 0) - Number(ops.summary.late_warning_count ?? 0) - Number(ops.summary.no_show_suspected_count ?? 0)), Math.max(Number(ops.summary.scheduled_shifts ?? 0), 1)), 90, 80) }),
      makeMetric({ id: "grace_rate", label: "Grace rate", value: Number(ops.summary.late_warning_count ?? 0), tone: toneFromCount(Number(ops.summary.late_warning_count ?? 0), 1, 4) }),
      makeMetric({ id: "critically_late", label: "Critically late rate", value: Number(ops.summary.no_show_suspected_count ?? 0), tone: toneFromCount(Number(ops.summary.no_show_suspected_count ?? 0), 1, 3) }),
      makeMetric({ id: "wrong_location", label: "Wrong-location clock-ins", value: Number(ops.summary.out_of_bounds_punches ?? 0), tone: toneFromCount(Number(ops.summary.out_of_bounds_punches ?? 0), 1, 3) }),
      makeMetric({ id: "missing_punch_volume", label: "Missing punch correction volume", value: Number(ops.summary.missed_punch_count ?? 0), tone: toneFromCount(Number(ops.summary.missed_punch_count ?? 0), 1, 3) })
    ],
    trendCards: [
      makeMetric({ id: "open_shifts", label: "Open coverage count", value: parseMetricNumber(unfilledShifts.detail, "Open shifts"), tone: toneFromCount(parseMetricNumber(unfilledShifts.detail, "Open shifts"), 1, 3) }),
      makeMetric({ id: "late_clockins", label: "Late clock-ins", value: parseMetricNumber(lateNoShow.detail, "Late clock-ins"), tone: toneFromCount(parseMetricNumber(lateNoShow.detail, "Late clock-ins"), 1, 4) }),
      makeMetric({ id: "no_shows", label: "Probable no-show count", value: parseMetricNumber(lateNoShow.detail, "No-shows"), tone: toneFromCount(parseMetricNumber(lateNoShow.detail, "No-shows"), 1, 2) }),
      makeMetric({ id: "missed_punches", label: "Attendance exceptions", value: parseMetricNumber(attendanceExceptions.detail, "Missed punches"), tone: toneFromCount(parseMetricNumber(attendanceExceptions.detail, "Missed punches"), 1, 3) })
    ],
    exceptionSections: [
      { id: "coverage_queue", title: "Coverage Risk", summary: unfilledShifts.detail.summary_line, rows: unfilledShifts.detail.sections.flatMap((section) => section.rows ?? []).slice(0, 15), action_hash: "#operations/schedule" },
      { id: "attendance_queue", title: "Attendance Exceptions", summary: attendanceExceptions.detail.summary_line, rows: attendanceExceptions.detail.sections.flatMap((section) => section.rows ?? []).slice(0, 15), action_hash: "#attendance" }
    ],
    drilldownSections: [
      { id: "late_no_show_trend", title: "Late and No-Show Patterns", summary: lateNoShow.detail.summary_line, rows: lateNoShow.detail.sections.flatMap((section) => section.rows ?? []).slice(0, 15), action_hash: "#attendance" },
      { id: "labor_mix", title: "Labor Distribution", summary: weeklyLabor.detail.summary_line, rows: weeklyLabor.detail.sections.flatMap((section) => section.rows ?? []).slice(0, 15), action_hash: "#operations/schedule" }
    ],
    detailPanel: {
      title: "Attendance Rules",
      items: [
        { label: "Under minimum staffing rate", value: "Eligible shoots that fell below minimum staffing divided by total eligible shoots in the selected window." },
        { label: "Lead coverage rate", value: "Lead-required shoots with a valid lead assignment divided by total lead-required shoots." },
        { label: "Wrong-location punches", value: "Clock-ins materially outside assigned location expectation or needing review." },
        { label: "Source records", value: "Shoots, assignments, punch exceptions, and attendance review records feed this dashboard." }
      ]
    },
    csvRows: (attendanceExceptions.csvRows.length ? attendanceExceptions.csvRows : weeklyLabor.csvRows)
  });
}

async function buildProductionQaHealthReport(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportArtifact> {
  const range = getDateWindow(filters, 30);
  const snapshot = await getProductionProjectHomeSnapshot(client, auth, { anchorDate: filters.anchorDate });
  const board = await listProductionProjects(client, auth, { anchorDate: filters.anchorDate, status: "open" });
  const aggregateResult = await client.query<{
    completed_jobs: string | number;
    on_time_completed_jobs: string | number;
    no_due_date_jobs: string | number;
    unassigned_jobs: string | number;
    median_turnaround_hours: string | number | null;
  }>(
    `
      SELECT
        COUNT(*) FILTER (WHERE completed_at IS NOT NULL AND completed_at::date BETWEEN $2::date AND $3::date)::int AS completed_jobs,
        COUNT(*) FILTER (WHERE completed_at IS NOT NULL AND due_date IS NOT NULL AND completed_at::date BETWEEN $2::date AND $3::date AND completed_at::date <= due_date)::int AS on_time_completed_jobs,
        COUNT(*) FILTER (WHERE due_date IS NULL AND status::text NOT IN ('released_complete', 'cancelled'))::int AS no_due_date_jobs,
        COUNT(*) FILTER (WHERE owner_user_id IS NULL AND status::text NOT IN ('released_complete', 'cancelled'))::int AS unassigned_jobs,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600.0) FILTER (WHERE completed_at IS NOT NULL AND completed_at::date BETWEEN $2::date AND $3::date) AS median_turnaround_hours
      FROM production_project
      WHERE tenant_id = $1
    `,
    [auth.tenantId, range.startDate, range.endDate]
  );
  const stageAgeResult = await client.query<{ stage: string; item_count: string | number; avg_age_days: string | number | null }>(
    `
      SELECT
        stage::text AS stage,
        COUNT(*)::int AS item_count,
        AVG(GREATEST(0, EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0)) AS avg_age_days
      FROM production_project
      WHERE tenant_id = $1
        AND status::text NOT IN ('released_complete', 'cancelled')
      GROUP BY stage
      ORDER BY AVG(GREATEST(0, EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0)) DESC, COUNT(*) DESC
      LIMIT 6
    `,
    [auth.tenantId]
  );
  const reviewResult = await client.query<{ qa_reviews: string | number; qa_passed: string | number; qa_corrections: string | number }>(
    `
      SELECT
        COUNT(*)::int AS qa_reviews,
        COUNT(*) FILTER (WHERE result::text = 'passed')::int AS qa_passed,
        COUNT(*) FILTER (WHERE result::text = 'correction_needed')::int AS qa_corrections
      FROM production_project_review
      WHERE tenant_id = $1
        AND created_at::date BETWEEN $2::date AND $3::date
    `,
    [auth.tenantId, range.startDate, range.endDate]
  );

  const completedJobs = Number(aggregateResult.rows[0]?.completed_jobs ?? 0);
  const onTimeCompletedJobs = Number(aggregateResult.rows[0]?.on_time_completed_jobs ?? 0);
  const noDueDateJobs = Number(aggregateResult.rows[0]?.no_due_date_jobs ?? 0);
  const unassignedJobs = Number(aggregateResult.rows[0]?.unassigned_jobs ?? 0);
  const qaReviews = Number(reviewResult.rows[0]?.qa_reviews ?? 0);
  const qaCorrections = Number(reviewResult.rows[0]?.qa_corrections ?? 0);

  return buildCanonicalArtifact({
    id: "production_qa_health",
    title: "Production and QA Health",
    audience: "Leadership, production leads, and admins",
    summaryLine:
      snapshot.counts.blocked || snapshot.counts.overdue
        ? `${snapshot.counts.blocked} jobs are blocked, ${snapshot.counts.overdue} are overdue, and ${snapshot.counts.ready_to_release} are ready to release in the current board.`
        : "Production flow is moving cleanly through active, QA, and release stages in the current board.",
    tone:
      snapshot.counts.blocked > 0 || snapshot.counts.overdue > 0
        ? "action_needed"
        : snapshot.counts.jobs_in_qa > 0 || snapshot.counts.due_within_24_hours > 0
          ? "heads_up"
          : "good",
    generatedAt: new Date().toISOString(),
    freshnessState: "live",
    defaultWindow: getCanonicalReportDefinition("production_qa_health").defaultWindow,
    filters,
    topSummary: [
      makeMetric({ id: "active_jobs", label: "Active jobs", value: snapshot.counts.active_jobs, tone: "info" }),
      makeMetric({ id: "jobs_completed", label: "Jobs completed", value: completedJobs, tone: completedJobs > 0 ? "good" : "neutral" }),
      makeMetric({ id: "due_today", label: "Due in 24 hours", value: snapshot.counts.due_within_24_hours, tone: toneFromCount(snapshot.counts.due_within_24_hours, 1, 3) }),
      makeMetric({ id: "overdue", label: "Overdue", value: snapshot.counts.overdue, tone: toneFromCount(snapshot.counts.overdue, 1, 3) }),
      makeMetric({ id: "blocked", label: "Blocked", value: snapshot.counts.blocked, tone: toneFromCount(snapshot.counts.blocked, 1, 3) }),
      makeMetric({ id: "median_turnaround", label: "Median turnaround time", value: formatHoursValue(aggregateResult.rows[0]?.median_turnaround_hours == null ? null : Number(aggregateResult.rows[0]?.median_turnaround_hours ?? 0)), tone: "info" }),
      makeMetric({ id: "qa_pass_rate", label: "QA pass rate", value: `${safeRate(Number(reviewResult.rows[0]?.qa_passed ?? 0), Math.max(qaReviews, 1)).toFixed(1)}%`, tone: metricToneFromRate(safeRate(Number(reviewResult.rows[0]?.qa_passed ?? 0), Math.max(qaReviews, 1)), 90, 80) }),
      makeMetric({ id: "qa_correction_rate", label: "QA correction rate", value: `${safeRate(qaCorrections, Math.max(qaReviews, 1)).toFixed(1)}%`, tone: metricToneFromRate(safeRate(qaCorrections, Math.max(qaReviews, 1)), 10, 20, true) }),
      makeMetric({ id: "ready_to_release", label: "Ready to release count", value: snapshot.counts.ready_to_release, tone: snapshot.counts.ready_to_release > 0 ? "heads_up" : "good" }),
      makeMetric({ id: "unassigned", label: "Unassigned jobs", value: unassignedJobs, tone: toneFromCount(unassignedJobs, 1, 3) })
    ],
    trendCards: stageAgeResult.rows.map((row, index) =>
      makeMetric({
        id: `stage_age_${index + 1}`,
        label: `${humanizeLabel(row.stage)} aging`,
        value: formatMinutesValue(Number(row.avg_age_days ?? 0) * 24 * 60),
        tone: Number(row.avg_age_days ?? 0) >= 7 ? "heads_up" : "neutral",
        detail: `${Number(row.item_count ?? 0)} jobs`
      })
    ),
    exceptionSections: [
      { id: "blocked_queue", title: "Blocked Queue", summary: "Jobs blocked by files, decisions, uploads, or tooling rise first.", rows: (board.sections.find((section) => section.id === "blocked_queue")?.items ?? []).slice(0, 12).map(mapProductionQueueItemToReportRow), action_hash: "#production/blocked" },
      { id: "at_risk_queue", title: "Overdue and At Risk", summary: "Overdue, due-soon, and release-risk jobs stay visible before delivery slips.", rows: (board.sections.find((section) => section.id === "at_risk_queue")?.items ?? []).slice(0, 12).map(mapProductionQueueItemToReportRow), action_hash: "#production" }
    ],
    drilldownSections: [
      { id: "qa_queue", title: "QA Queue", rows: (board.sections.find((section) => section.id === "qa_queue")?.items ?? []).slice(0, 12).map(mapProductionQueueItemToReportRow), action_hash: "#production/qa" },
      { id: "ready_to_release_queue", title: "Ready to Release Queue", rows: (board.sections.find((section) => section.id === "ready_to_release_queue")?.items ?? []).slice(0, 12).map(mapProductionQueueItemToReportRow), action_hash: "#production/release" }
    ],
    detailPanel: {
      title: "Production Trust",
      items: [
        { label: "Queue order", value: "Blocked, overdue, and due-soon jobs outrank normal due date order." },
        { label: "QA rule", value: "Ready to Release is a visible handoff state, not the same thing as Released / Complete." },
        { label: "Ownerless jobs", value: "Any open production job without an owner is surfaced as a queue problem." },
        { label: "Source records", value: "Production jobs, reviews, blockers, and release states feed this dashboard." }
      ]
    },
    csvRows: [
      ...board.sections.flatMap((section) => section.items).map((item) => ({
        project_id: String(item.id),
        title: String(item.title),
        stage: String(item.stage),
        priority: String(item.priority),
        owner_label: String(item.owner_label ?? ""),
        due_label: String(item.due_label ?? ""),
        linked_shoot_code: String(item.linked_shoot_code ?? ""),
        linked_shoot_importance: String(item.linked_shoot_importance_label ?? ""),
        qa_state: String(item.qa_state_label ?? ""),
        release_state: String(item.release_state_label ?? "")
      })),
      { project_id: "summary", title: "no_due_date_jobs", stage: "", priority: "", owner_label: "", due_label: noDueDateJobs, linked_shoot_code: "", linked_shoot_importance: "", qa_state: "", release_state: "" }
    ]
  });
}

async function buildCustomerRelationshipFollowThroughReport(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportArtifact> {
  const relationship = await loadRelationshipRollup(client, auth, filters.anchorDate);
  const zendesk = await buildZendeskOperationalSummaryReport(client, auth).catch(() => null);
  const touchpointCompletionRate = safeRate(
    Number(relationship.metrics.completed_touchpoints_on_time ?? 0),
    Math.max(Number(relationship.metrics.touchpoints_due_this_week ?? 0), 1)
  );

  return buildCanonicalArtifact({
    id: "customer_relationship_follow_through",
    title: "Customer Relationship and Follow-Through",
    audience: "Leadership, managers, and account owners",
    summaryLine:
      Number(relationship.metrics.overdue_follow_ups ?? 0) || Number(relationship.metrics.stale_critical_contacts ?? 0)
        ? `${Number(relationship.metrics.overdue_follow_ups ?? 0)} customer follow-ups are overdue and ${Number(relationship.metrics.stale_critical_contacts ?? 0)} critical contacts need freshness review.`
        : "Customer continuity is steady across touchpoints, follow-through, and key-contact freshness.",
    tone:
      Number(relationship.metrics.overdue_follow_ups ?? 0) > 0 || Number(relationship.metrics.escalated_customer_issues ?? 0) > 0
        ? "action_needed"
        : Number(relationship.metrics.stale_critical_contacts ?? 0) > 0 || Number(relationship.metrics.overdue_touchpoints ?? 0) > 0
          ? "heads_up"
          : "good",
    generatedAt: new Date().toISOString(),
    freshnessState: "recently_updated",
    defaultWindow: getCanonicalReportDefinition("customer_relationship_follow_through").defaultWindow,
    filters,
    topSummary: [
      makeMetric({ id: "touchpoints_due", label: "Touchpoints due this week", value: Number(relationship.metrics.touchpoints_due_this_week ?? 0), tone: Number(relationship.metrics.touchpoints_due_this_week ?? 0) > 0 ? "info" : "neutral" }),
      makeMetric({ id: "overdue_touchpoints", label: "Overdue touchpoints", value: Number(relationship.metrics.overdue_touchpoints ?? 0), tone: toneFromCount(Number(relationship.metrics.overdue_touchpoints ?? 0), 1, 3) }),
      makeMetric({ id: "touchpoint_completion_rate", label: "Completed touchpoint rate", value: `${touchpointCompletionRate.toFixed(1)}%`, tone: metricToneFromRate(touchpointCompletionRate, 90, 80) }),
      makeMetric({ id: "open_followups", label: "Open customer follow-ups", value: Number(relationship.metrics.open_follow_ups ?? 0), tone: Number(relationship.metrics.open_follow_ups ?? 0) > 0 ? "heads_up" : "good" }),
      makeMetric({ id: "overdue_followups", label: "Overdue customer follow-ups", value: Number(relationship.metrics.overdue_follow_ups ?? 0), tone: toneFromCount(Number(relationship.metrics.overdue_follow_ups ?? 0), 1, 3) }),
      makeMetric({ id: "stale_contacts", label: "Stale critical contacts", value: Number(relationship.metrics.stale_critical_contacts ?? 0), tone: toneFromCount(Number(relationship.metrics.stale_critical_contacts ?? 0), 1, 3) }),
      makeMetric({ id: "ownerless_contacts", label: "Ownerless critical contacts", value: Number(relationship.metrics.ownerless_critical_contacts ?? 0), tone: toneFromCount(Number(relationship.metrics.ownerless_critical_contacts ?? 0), 1, 2) }),
      makeMetric({ id: "accounts_attention", label: "Accounts in Needs Attention/Fragile", value: relationship.accountRows.filter((row) => row.relationship_health !== "healthy").length, tone: toneFromCount(relationship.accountRows.filter((row) => row.relationship_health !== "healthy").length, 1, 3) }),
      makeMetric({ id: "escalated_issues", label: "Recent escalated customer issues", value: Number(relationship.metrics.escalated_customer_issues ?? 0), tone: toneFromCount(Number(relationship.metrics.escalated_customer_issues ?? 0), 1, 2) })
    ],
    trendCards: zendesk
      ? zendesk.detail.metrics.slice(0, 3).map((metric, index) =>
          makeMetric({
            id: `service_${index + 1}`,
            label: `Customer service | ${metric.label}`,
            value: metric.value,
            tone: metric.tone,
            detail: metric.detail ?? null
          })
        )
      : [],
    exceptionSections: [
      {
        id: "relationship_attention",
        title: "Relationship Attention Needed",
        summary: relationship.accountRows.length ? "Accounts with continuity risk rise first so ownership gaps and overdue promises stay visible." : "No account continuity risk rose above the watch threshold.",
        rows: relationship.accountRows.map((row) => ({
          id: row.organization_id,
          primary: row.organization_name,
          secondary: humanizeLabel(row.relationship_health),
          chips: [{ label: humanizeLabel(row.relationship_health), tone: row.relationship_health === "at_risk" ? "action_needed" : row.relationship_health === "fragile" ? "heads_up" : "neutral" }],
          values: [
            { label: "Overdue Touchpoints", value: Number(row.overdue_touchpoints ?? 0), tone: Number(row.overdue_touchpoints ?? 0) > 0 ? "action_needed" : "good" },
            { label: "Overdue Follow-Ups", value: Number(row.overdue_follow_ups ?? 0), tone: Number(row.overdue_follow_ups ?? 0) > 0 ? "action_needed" : "good" },
            { label: "Stale Contacts", value: Number(row.stale_key_contacts ?? 0), tone: Number(row.stale_key_contacts ?? 0) > 0 ? "heads_up" : "good" }
          ],
          next_action: "Open the account continuity panel and resolve the highest-risk open item.",
          action_hash: "#directory"
        })),
        action_hash: "#directory"
      }
    ],
    drilldownSections: [
      {
        id: "upcoming_touchpoints",
        title: "Upcoming Touchpoints",
        rows: relationship.touchpointRows.map((row) => ({
          id: row.id,
          primary: row.title,
          secondary: [row.organization_name, formatDateTimeLabel(row.due_at)].filter(Boolean).join(" | "),
          values: [{ label: "Owner", value: String(row.owner_name ?? "Owner pending"), tone: row.owner_name ? "good" : "heads_up" }],
          next_action: "Open the touchpoint and close or skip it intentionally.",
          action_hash: "#directory"
        })),
        action_hash: "#directory"
      },
      {
        id: "open_followups",
        title: "Open Follow-Ups",
        rows: relationship.followUpRows.map((row) => ({
          id: row.id,
          primary: row.title,
          secondary: [row.organization_name, formatDateTimeLabel(row.due_at)].filter(Boolean).join(" | "),
          values: [
            { label: "Owner", value: String(row.owner_name ?? "Owner pending"), tone: row.owner_name ? "good" : "heads_up" },
            { label: "Due", value: formatDateTimeLabel(row.due_at), tone: new Date(row.due_at).getTime() < Date.now() ? "action_needed" : "neutral" }
          ],
          next_action: "Close the promised follow-up or reassign it.",
          action_hash: "#directory"
        })),
        action_hash: "#directory"
      },
      ...(zendesk
        ? [
            {
              id: "customer_service_pulse",
              title: "Customer Service Pulse",
              summary: zendesk.detail.summary_line,
              rows: zendesk.detail.sections.flatMap((section) => section.rows ?? []).slice(0, 10),
      action_hash: "#reports"
            }
          ]
        : [])
    ],
    detailPanel: {
      title: "Relationship Continuity",
      items: [
        { label: "Touchpoint rule", value: "If a meaningful touchpoint did not happen, it becomes overdue or intentionally skipped with reason." },
        { label: "Promise rule", value: "A customer promise becomes a visible follow-up with owner and due date, not a buried note." },
        { label: "Freshness rule", value: "Critical contacts need review when confirmation is stale, ownership is missing, or uncertainty is flagged." },
        { label: "Source records", value: "Touchpoint plans, communication history, follow-ups, and relationship memory feed this dashboard." }
      ]
    },
    csvRows: relationship.accountRows.map((row) => ({
      organization_id: row.organization_id,
      organization_name: row.organization_name,
      relationship_health: row.relationship_health,
      overdue_touchpoints: Number(row.overdue_touchpoints ?? 0),
      overdue_follow_ups: Number(row.overdue_follow_ups ?? 0),
      stale_key_contacts: Number(row.stale_key_contacts ?? 0)
    }))
  });
}

async function buildLocationIntelligenceRepeatIssuesReport(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportArtifact> {
  const range = getDateWindow(filters, 90);
  const evaluations = await loadEvaluationSummaryRows(client, auth, range.startDate, range.endDate);
  const locations = await listShootLocations(client, auth, { sort: "alpha" });
  const memoryRollup = await loadLocationMemoryRollup(client, auth, range.startDate, range.endDate);
  const firstTimeResult = await client.query<{
      first_time_total: string | number;
      first_time_issue_count: string | number;
    }>(
      `
        WITH first_time_shoots AS (
          SELECT shoot.id
          FROM shoot shoot
          WHERE shoot.tenant_id = $1
            AND shoot.location_id IS NOT NULL
            AND shoot.shoot_date BETWEEN $2::date AND $3::date
            AND ($4::text IS NULL OR shoot.department::text = $4::text)
            AND NOT EXISTS (
              SELECT 1
              FROM shoot prior
              WHERE prior.tenant_id = shoot.tenant_id
                AND prior.location_id = shoot.location_id
                AND (
                  prior.shoot_date < shoot.shoot_date
                  OR (prior.shoot_date = shoot.shoot_date AND prior.created_at < shoot.created_at)
                )
            )
        )
        SELECT
          COUNT(*)::int AS first_time_total,
          COUNT(*) FILTER (
            WHERE pse.overall_outcome::text IN ('major_issues', 'needs_leadership_review')
              OR pse.staffing_fit::text = 'understaffed'
              OR pse.setup_difficulty::text = 'high'
              OR pse.data_roster_readiness::text IN ('minor_issues', 'major_issues')
          )::int AS first_time_issue_count
        FROM first_time_shoots first_time
        LEFT JOIN post_shoot_evaluation pse
          ON pse.tenant_id = $1
         AND pse.shoot_id = first_time.id
      `,
      [auth.tenantId, range.startDate, range.endDate, getEffectiveDepartmentFilter(auth, filters)]
    );
  const repeatSignalResult = await client.query<{
      repeat_staffing_mismatch_locations: string | number;
      repeat_data_issue_locations: string | number;
      repeat_setup_difficulty_locations: string | number;
    }>(
      `
        WITH location_patterns AS (
          SELECT
            pse.location_id,
            COUNT(*) FILTER (WHERE pse.staffing_fit::text = 'understaffed') AS staffing_mismatch_count,
            COUNT(*) FILTER (WHERE pse.data_roster_readiness::text IN ('minor_issues', 'major_issues')) AS data_issue_count,
            COUNT(*) FILTER (WHERE pse.setup_difficulty::text = 'high') AS setup_difficulty_count
          FROM post_shoot_evaluation pse
          JOIN shoot shoot
            ON shoot.id = pse.shoot_id
           AND shoot.tenant_id = pse.tenant_id
          WHERE pse.tenant_id = $1
            AND pse.shoot_date BETWEEN $2::date AND $3::date
            AND ($4::text IS NULL OR shoot.department::text = $4::text)
          GROUP BY pse.location_id
        )
        SELECT
          COUNT(*) FILTER (WHERE staffing_mismatch_count >= 2)::int AS repeat_staffing_mismatch_locations,
          COUNT(*) FILTER (WHERE data_issue_count >= 2)::int AS repeat_data_issue_locations,
          COUNT(*) FILTER (WHERE setup_difficulty_count >= 2)::int AS repeat_setup_difficulty_locations
        FROM location_patterns
      `,
      [auth.tenantId, range.startDate, range.endDate, getEffectiveDepartmentFilter(auth, filters)]
    );
  const setupPhotoResult = await client.query<{ submitted_required_setup_shoots: string | number }>(
      `
        SELECT COUNT(DISTINCT photo.shoot_id)::int AS submitted_required_setup_shoots
        FROM setup_photo_upload photo
        JOIN shoot shoot
          ON shoot.id = photo.shoot_id
         AND shoot.tenant_id = photo.tenant_id
        WHERE photo.tenant_id = $1
          AND photo.shoot_id IS NOT NULL
          AND COALESCE(photo.uploaded_at, photo.created_at)::date BETWEEN $2::date AND $3::date
          AND ($4::text IS NULL OR shoot.department::text = $4::text)
      `,
      [auth.tenantId, range.startDate, range.endDate, getEffectiveDepartmentFilter(auth, filters)]
    );

  const locationSummaryById = new Map(locations.locations.map((location) => [location.id, location]));
  const issueBuckets = new Map<
    string,
    {
      locationId: string;
      locationName: string;
      issueCount: number;
      majorIssueCount: number;
      latestDate: string;
      watchouts: string[];
      setupPhotoCount: number;
    }
  >();

  for (const row of evaluations) {
    const locationSummary = locationSummaryById.get(row.location_id);
    const watchouts = [row.next_time_recommendation, row.notes, row.recommendations, row.access_details, row.late_details].filter(
      (value): value is string => Boolean(value)
    );
    const signalCount =
      (row.staffing_fit === "understaffed" ? 1 : 0) +
      (row.data_roster_readiness === "minor_issues" || row.data_roster_readiness === "major_issues" ? 1 : 0) +
      (row.setup_difficulty === "high" ? 1 : 0) +
      (row.overall_outcome === "major_issues" || row.overall_outcome === "needs_leadership_review" || row.major_issue_flag || row.leadership_review_needed ? 1 : 0);
    if (signalCount === 0 && watchouts.length === 0) {
      continue;
    }
    const existing = issueBuckets.get(row.location_id) ?? {
      locationId: row.location_id,
      locationName: row.location_name,
      issueCount: 0,
      majorIssueCount: 0,
      latestDate: row.shoot_date,
      watchouts: [],
      setupPhotoCount: locationSummary?.stats.setup_photo_count ?? 0
    };
    existing.issueCount += Math.max(signalCount, watchouts.length ? 1 : 0);
    existing.majorIssueCount += row.overall_outcome === "major_issues" || row.overall_outcome === "needs_leadership_review" || row.major_issue_flag || row.leadership_review_needed ? 1 : 0;
    if (row.shoot_date > existing.latestDate) {
      existing.latestDate = row.shoot_date;
    }
    existing.watchouts.push(...watchouts);
    issueBuckets.set(row.location_id, existing);
  }

  const repeatIssueRows = [...issueBuckets.values()]
    .filter((row) => row.issueCount >= 2 || row.majorIssueCount > 0 || row.setupPhotoCount === 0)
    .sort((left, right) => right.majorIssueCount * 4 + right.issueCount - (left.majorIssueCount * 4 + left.issueCount))
    .slice(0, 12)
    .map((row) => ({
      id: row.locationId,
      primary: row.locationName,
      secondary: `Last issue ${formatDateLabel(row.latestDate)}`,
      chips: [
        {
          label: row.majorIssueCount > 0 ? "Repeat high-risk issues" : "Repeat issues",
          tone: row.majorIssueCount > 0 ? ("action_needed" as ReportTone) : ("heads_up" as ReportTone)
        }
      ],
      values: [
        { label: "Issue Signals", value: row.issueCount, tone: row.issueCount >= 3 ? "action_needed" : "heads_up" },
        { label: "Setup Photos", value: row.setupPhotoCount, tone: row.setupPhotoCount === 0 ? "heads_up" : "good" },
        {
          label: "Latest Watch-Out",
          value: summarizeTextPhrases(row.watchouts, 1)[0]?.text ?? "Open the location memory",
          tone: "neutral"
        }
      ],
      next_action:
        row.setupPhotoCount === 0
          ? "Refresh setup visuals before the next crew visits."
          : "Review historical context, staffing recommendations, and open watch-outs.",
      action_hash: "#directory/locations"
    }));

  const repeatIssueLocationCount = repeatIssueRows.length;
  const firstTimeIssueRate = safeRate(
    Number(firstTimeResult.rows[0]?.first_time_issue_count ?? 0),
    Math.max(Number(firstTimeResult.rows[0]?.first_time_total ?? 0), 1)
  );
  const freshCoverageRate = safeRate(
    Number(memoryRollup.stats.fresh_count ?? 0),
    Math.max(Number(memoryRollup.stats.total_count ?? 0), 1)
  );
  const submittedRequiredSetupShoots = Number(setupPhotoResult.rows[0]?.submitted_required_setup_shoots ?? 0);
  const setupPhotoCompletionRate = safeRate(
    submittedRequiredSetupShoots,
    Math.max(submittedRequiredSetupShoots + memoryRollup.missingSetupCount, 1)
  );
  const repeatSignals = repeatSignalResult.rows[0] ?? {
    repeat_staffing_mismatch_locations: 0,
    repeat_data_issue_locations: 0,
    repeat_setup_difficulty_locations: 0
  };

  return buildCanonicalArtifact({
    id: "location_intelligence_repeat_issues",
    title: "Location Intelligence and Repeat Issues",
    audience: "Leadership and managers",
    summaryLine:
      repeatIssueLocationCount || Number(memoryRollup.stats.needs_refresh_count ?? 0)
        ? `${repeatIssueLocationCount} locations show repeat operational friction and ${Number(memoryRollup.stats.needs_refresh_count ?? 0)} memory record${Number(memoryRollup.stats.needs_refresh_count ?? 0) === 1 ? "" : "s"} need refresh.`
        : "Location intelligence is healthy, current, and ready for the next visit.",
    tone:
      repeatIssueLocationCount > 0 || Number(memoryRollup.stats.needs_refresh_count ?? 0) > 0
        ? "heads_up"
        : memoryRollup.missingSetupCount > 0
          ? "heads_up"
          : "good",
    generatedAt: new Date().toISOString(),
    freshnessState: "recently_updated",
    defaultWindow: getCanonicalReportDefinition("location_intelligence_repeat_issues").defaultWindow,
    filters,
    topSummary: [
      makeMetric({ id: "repeat_issue_locations", label: "Repeat issue locations", value: repeatIssueLocationCount, tone: toneFromCount(repeatIssueLocationCount, 1, 3), definition: "Locations with repeated structured issue signals or missing setup intelligence." }),
      makeMetric({ id: "first_time_issue_rate", label: "First-time location issue rate", value: `${firstTimeIssueRate.toFixed(1)}%`, tone: metricToneFromRate(firstTimeIssueRate, 85, 70), definition: "First-time locations with structured issue signals divided by total first-time locations in the window." }),
      makeMetric({ id: "memory_freshness_coverage", label: "Location memory freshness coverage", value: `${freshCoverageRate.toFixed(1)}%`, tone: metricToneFromRate(freshCoverageRate, 85, 70), definition: "Active locations with fresh reviewed memory divided by total active locations." }),
      makeMetric({ id: "setup_photo_completion_rate", label: "Required setup photo completion rate", value: `${setupPhotoCompletionRate.toFixed(1)}%`, tone: metricToneFromRate(setupPhotoCompletionRate, 90, 80), definition: "Required-photo shoots completed by deadline divided by total required-photo shoots." }),
      makeMetric({ id: "repeat_staffing_mismatch_rate", label: "Repeat staffing mismatch rate", value: Number(repeatSignals.repeat_staffing_mismatch_locations ?? 0), tone: toneFromCount(Number(repeatSignals.repeat_staffing_mismatch_locations ?? 0), 1, 3) }),
      makeMetric({ id: "repeat_data_issue_rate", label: "Repeat data/roster issue rate", value: Number(repeatSignals.repeat_data_issue_locations ?? 0), tone: toneFromCount(Number(repeatSignals.repeat_data_issue_locations ?? 0), 1, 3) }),
      makeMetric({ id: "repeat_setup_difficulty_rate", label: "Repeat setup difficulty rate", value: Number(repeatSignals.repeat_setup_difficulty_locations ?? 0), tone: toneFromCount(Number(repeatSignals.repeat_setup_difficulty_locations ?? 0), 1, 3) }),
      makeMetric({ id: "location_memory_review_backlog", label: "Location memory review backlog", value: Number(memoryRollup.stats.needs_refresh_count ?? 0), tone: toneFromCount(Number(memoryRollup.stats.needs_refresh_count ?? 0), 1, 3) })
    ],
    trendCards: [
      makeMetric({ id: "fresh_memory_count", label: "Fresh memory records", value: Number(memoryRollup.stats.fresh_count ?? 0), tone: Number(memoryRollup.stats.fresh_count ?? 0) > 0 ? "good" : "neutral" }),
      makeMetric({ id: "aging_memory_count", label: "Aging memory records", value: Number(memoryRollup.stats.aging_count ?? 0), tone: Number(memoryRollup.stats.aging_count ?? 0) > 0 ? "heads_up" : "good" }),
      makeMetric({ id: "missing_setup_required", label: "Required setup photos still missing", value: memoryRollup.missingSetupCount, tone: toneFromCount(memoryRollup.missingSetupCount, 1, 3) })
    ],
    exceptionSections: [
      {
        id: "repeat_issue_locations",
        title: "Locations With Repeat Issues",
        summary: repeatIssueRows.length ? "Repeat staffing, setup, data, and environment friction stays visible before the next visit." : "No locations crossed the repeat-issue threshold in the current window.",
        rows: repeatIssueRows,
        action_hash: "#directory/locations"
      },
      {
        id: "memory_refresh_backlog",
        title: "Location Memory Refresh Backlog",
        summary: memoryRollup.staleRows.length ? "Stale or unreviewed memory should be refreshed before the next crew relies on it." : "Location memory freshness is steady across the catalog.",
        rows: memoryRollup.staleRows.map((row) => ({
          id: row.location_id,
          primary: row.location_name,
          secondary: row.last_confirmed_at ? `Last confirmed ${formatDateLabel(row.last_confirmed_at)}` : "No confirmed memory yet",
          chips: [
            {
              label: humanizeLabel(row.freshness_state),
              tone: row.freshness_state === "needs_refresh" ? ("action_needed" as ReportTone) : ("heads_up" as ReportTone)
            }
          ],
          next_action: row.last_confirmed_at ? "Refresh the guidance and confirm the setup visuals." : "Capture and review the first reliable location memory.",
          action_hash: "#directory/locations"
        })),
        action_hash: "#directory/locations"
      }
    ],
    drilldownSections: [
      {
        id: "recent_issue_evals",
        title: "Recent Comparable Issues",
        rows: evaluations
          .filter(
            (row) =>
              row.overall_outcome === "major_issues" ||
              row.overall_outcome === "needs_leadership_review" ||
              row.staffing_fit === "understaffed" ||
              row.setup_difficulty === "high" ||
              row.data_roster_readiness === "major_issues"
          )
          .slice(0, 12)
          .map((row) => ({
            id: row.id,
            primary: `${row.location_name} | ${row.shoot_name}`,
            secondary: `${formatDateLabel(row.shoot_date)} | ${humanizeLabel(row.overall_outcome ?? "minor_issues")}`,
            values: [
              { label: "Staffing", value: humanizeLabel(row.staffing_fit ?? "right_sized"), tone: row.staffing_fit === "understaffed" ? "action_needed" : "neutral" },
              { label: "Setup", value: humanizeLabel(row.setup_difficulty ?? "medium"), tone: row.setup_difficulty === "high" ? "heads_up" : "neutral" },
              { label: "Data", value: humanizeLabel(row.data_roster_readiness ?? "ready"), tone: row.data_roster_readiness === "major_issues" ? "action_needed" : row.data_roster_readiness === "minor_issues" ? "heads_up" : "good" }
            ],
            next_action: row.next_time_recommendation ?? "Review the last-time-here recommendation before the next visit.",
            action_hash: "#operations/locations"
          })),
        action_hash: "#operations/locations"
      }
    ],
    detailPanel: {
      title: "Location Intelligence Trust",
      items: [
        { label: "Pattern rule", value: "Repeat pattern signals are only surfaced when structured evidence repeats. One-off noise is left out." },
        { label: "Setup photo rule", value: "Setup photos are instructional memory for future crews, not decoration." },
        { label: "Freshness rule", value: "Location memory becomes aging or needs refresh when reviewed guidance or setup visuals are stale." },
        { label: "Source records", value: "Location memory, setup photos, post-shoot evals, and open follow-ups feed this dashboard." }
      ]
    },
    csvRows: repeatIssueRows.map((row) => ({
      location_id: row.id,
      location_name: row.primary,
      latest_issue: row.secondary ?? "",
      issue_signals: row.values?.[0]?.value ?? "",
      setup_photos: row.values?.[1]?.value ?? "",
      next_action: row.next_action ?? ""
    }))
  });
}

async function buildWorkflowComplianceDataQualityReport(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportArtifact> {
  const range = getDateWindow(filters, 30);
  const compliance = await listComplianceWorkspaceItems(client, auth, {
    date: filters.anchorDate,
    window: "all",
    status: "unresolved"
  });
  const approvalQueue = await buildOpenApprovalsReport(client, auth, filters);
  const evals = await loadEvaluationSummaryRows(client, auth, range.startDate, range.endDate);
  const closeoutResult = await client.query<{
      missing_eval_count: string | number;
      missing_setup_count: string | number;
      submitted_setup_shoot_count: string | number;
    }>(
      `
        SELECT
          (SELECT COUNT(*) FROM time_clock_compliance_flag WHERE tenant_id = $1 AND item_type = 'missing_post_shoot_evaluation' AND status <> 'resolved' AND first_detected_at::date BETWEEN $2::date AND $3::date)::int AS missing_eval_count,
          (SELECT COUNT(*) FROM time_clock_compliance_flag WHERE tenant_id = $1 AND item_type = 'missing_setup_photo' AND status <> 'resolved' AND first_detected_at::date BETWEEN $2::date AND $3::date)::int AS missing_setup_count,
          (
            SELECT COUNT(DISTINCT photo.shoot_id)::int
            FROM setup_photo_upload photo
            JOIN shoot shoot
              ON shoot.id = photo.shoot_id
             AND shoot.tenant_id = photo.tenant_id
            WHERE photo.tenant_id = $1
              AND photo.shoot_id IS NOT NULL
              AND COALESCE(photo.uploaded_at, photo.created_at)::date BETWEEN $2::date AND $3::date
              AND ($4::text IS NULL OR shoot.department::text = $4::text)
          ) AS submitted_setup_shoot_count
      `,
      [auth.tenantId, range.startDate, range.endDate, getEffectiveDepartmentFilter(auth, filters)]
    );
  const preServiceAckResult = await client.query<{ required_count: string | number; acknowledged_count: string | number }>(
      `
        WITH shifts_with_notes AS (
          SELECT DISTINCT ws.id
          FROM work_shift ws
          JOIN shoot shoot
            ON shoot.id = ws.shoot_id
           AND shoot.tenant_id = ws.tenant_id
          WHERE ws.tenant_id = $1
            AND shoot.shoot_date BETWEEN $2::date AND $3::date
            AND ($4::text IS NULL OR shoot.department::text = $4::text)
            AND (
              NULLIF(trim(COALESCE(shoot.setup_notes, '')), '') IS NOT NULL
              OR NULLIF(trim(COALESCE(shoot.day_of_notes, '')), '') IS NOT NULL
              OR NULLIF(trim(COALESCE(shoot.internal_notes, '')), '') IS NOT NULL
            )
        ),
        acknowledgements AS (
          SELECT DISTINCT acknowledgement.shift_id
          FROM shift_note_acknowledgement acknowledgement
          WHERE acknowledgement.tenant_id = $1
            AND acknowledgement.acknowledgement_scope = 'pre_service_notes'
            AND acknowledgement.acknowledged_at::date BETWEEN $2::date AND $3::date
        )
        SELECT
          COUNT(*)::int AS required_count,
          COUNT(*) FILTER (WHERE acknowledgements.shift_id IS NOT NULL)::int AS acknowledged_count
        FROM shifts_with_notes shifts
        LEFT JOIN acknowledgements
          ON acknowledgements.shift_id = shifts.id
      `,
      [auth.tenantId, range.startDate, range.endDate, getEffectiveDepartmentFilter(auth, filters)]
    );
  const timeCorrectionResult = await client.query<{ correction_volume: string | number }>(
      `
        SELECT COUNT(*)::int AS correction_volume
        FROM attendance_exception exception
        WHERE exception.tenant_id = $1
          AND exception.created_at::date BETWEEN $2::date AND $3::date
          AND (
            upper(COALESCE(exception.exception_type::text, '')) IN ('MISSED_CLOCK_IN', 'MISSED_CLOCK_OUT', 'TIME_EDIT', 'TIME_CORRECTION')
            OR lower(COALESCE(exception.workflow_kind, '')) IN ('missed_punch', 'time_correction', 'time_adjustment')
            OR lower(COALESCE(exception.classification, '')) LIKE '%clock%'
          )
      `,
      [auth.tenantId, range.startDate, range.endDate]
    );
  const productionIssueRows = await client.query<{
      id: string;
      title: string;
      stage: string;
      owner_name: string | null;
      due_date: string | null;
      reason_bucket: string;
    }>(
      `
        SELECT
          project.id::text AS id,
          project.title,
          project.stage::text AS stage,
          owner.full_name AS owner_name,
          project.due_date::text AS due_date,
          CASE
            WHEN project.due_date IS NULL AND project.owner_user_id IS NULL THEN 'missing_due_date_and_owner'
            WHEN project.due_date IS NULL THEN 'missing_due_date'
            ELSE 'ownerless'
          END AS reason_bucket
        FROM production_project project
        LEFT JOIN app_user owner
          ON owner.id = project.owner_user_id
        WHERE project.tenant_id = $1
          AND project.status::text NOT IN ('released_complete', 'cancelled')
          AND (project.due_date IS NULL OR project.owner_user_id IS NULL)
        ORDER BY
          CASE
            WHEN project.due_date IS NULL AND project.owner_user_id IS NULL THEN 0
            WHEN project.due_date IS NULL THEN 1
            ELSE 2
          END,
          project.created_at DESC
        LIMIT 12
      `,
      [auth.tenantId]
    );
  const contactReviewRows = await client.query<{
      id: string;
      full_name: string;
      title: string | null;
      organization_name: string | null;
      operational_importance: string | null;
      contact_status: string;
      last_confirmed_at: string | null;
    }>(
      `
        SELECT
          contact.id::text AS id,
          contact.full_name,
          contact.title,
          COALESCE(organization.display_name, organization.canonical_name) AS organization_name,
          contact.operational_importance::text AS operational_importance,
          contact.contact_status::text AS contact_status,
          contact.last_confirmed_at::text AS last_confirmed_at
        FROM organization_contact contact
        LEFT JOIN organization
          ON organization.id = contact.organization_id
        WHERE contact.tenant_id = $1
          AND contact.active_status = 'active'
          AND (
            contact.contact_status = 'needs_review'
            OR contact.uncertainty_flag = true
            OR contact.last_confirmed_at IS NULL
            OR contact.last_confirmed_at < current_date - 180
          )
        ORDER BY
          CASE WHEN contact.operational_importance = 'critical' THEN 0 WHEN contact.operational_importance = 'high' THEN 1 ELSE 2 END,
          COALESCE(contact.last_confirmed_at, '1900-01-01'::date) ASC,
          contact.full_name ASC
        LIMIT 12
      `,
      [auth.tenantId]
    );
  const memoryRollup = await loadLocationMemoryRollup(client, auth, range.startDate, range.endDate);

  const missingEvalCount = Number(closeoutResult.rows[0]?.missing_eval_count ?? 0);
  const missingSetupCount = Number(closeoutResult.rows[0]?.missing_setup_count ?? 0);
  const submittedSetupShootCount = Number(closeoutResult.rows[0]?.submitted_setup_shoot_count ?? 0);
  const preServiceAckRate = safeRate(
    Number(preServiceAckResult.rows[0]?.acknowledged_count ?? 0),
    Math.max(Number(preServiceAckResult.rows[0]?.required_count ?? 0), 1)
  );
  const postShootEvalCompletionRate = safeRate(evals.length, Math.max(evals.length + missingEvalCount, 1));
  const setupPhotoCompletionRate = safeRate(submittedSetupShootCount, Math.max(submittedSetupShootCount + missingSetupCount, 1));
  const unresolvedReviewQueueCount = compliance.summary.open_count;
  const ownerlessProductionJobs = productionIssueRows.rows.filter((row) => row.reason_bucket === "ownerless" || row.reason_bucket === "missing_due_date_and_owner").length;
  const missingDueDateJobs = productionIssueRows.rows.filter((row) => row.reason_bucket === "missing_due_date" || row.reason_bucket === "missing_due_date_and_owner").length;
  const contactsNeedReviewCount = contactReviewRows.rows.length;
  const staleLocationMemoryCount = Number(memoryRollup.stats.needs_refresh_count ?? 0);
  const timeCorrectionVolume = Number(timeCorrectionResult.rows[0]?.correction_volume ?? 0);

  return buildCanonicalArtifact({
    id: "workflow_compliance_data_quality",
    title: "Workflow Compliance and Data Quality",
    audience: "Leadership, managers, and admins",
    summaryLine:
      unresolvedReviewQueueCount || missingEvalCount || missingSetupCount
        ? `${unresolvedReviewQueueCount} review items are unresolved, ${missingEvalCount} required eval${missingEvalCount === 1 ? "" : "s"} are missing, and ${missingSetupCount} required setup photo set${missingSetupCount === 1 ? "" : "s"} are still open.`
        : "Workflow compliance and core data-quality signals are steady in the current review window.",
    tone:
      unresolvedReviewQueueCount > 0 || missingEvalCount > 0 || missingSetupCount > 0
        ? "heads_up"
        : ownerlessProductionJobs > 0 || contactsNeedReviewCount > 0
          ? "heads_up"
          : "good",
    generatedAt: new Date().toISOString(),
    freshnessState: "recently_updated",
    defaultWindow: getCanonicalReportDefinition("workflow_compliance_data_quality").defaultWindow,
    filters,
    topSummary: [
      makeMetric({ id: "pre_service_ack_completion_rate", label: "Pre-service acknowledgment completion rate", value: `${preServiceAckRate.toFixed(1)}%`, tone: metricToneFromRate(preServiceAckRate, 90, 80), definition: "Assignments with pre-service notes acknowledged divided by assignments carrying pre-service notes." }),
      makeMetric({ id: "post_shoot_eval_completion_rate", label: "Post-shoot eval completion rate", value: `${postShootEvalCompletionRate.toFixed(1)}%`, tone: metricToneFromRate(postShootEvalCompletionRate, 90, 80), definition: "Required evals submitted by deadline divided by required evals." }),
      makeMetric({ id: "setup_photo_completion_rate", label: "Setup photo completion rate", value: `${setupPhotoCompletionRate.toFixed(1)}%`, tone: metricToneFromRate(setupPhotoCompletionRate, 90, 80), definition: "Required-photo shoots completed by deadline divided by total required-photo shoots." }),
      makeMetric({ id: "time_correction_volume", label: "Time correction request volume", value: timeCorrectionVolume, tone: toneFromCount(timeCorrectionVolume, 1, 6) }),
      makeMetric({ id: "unresolved_review_queue", label: "Unresolved review queue count", value: unresolvedReviewQueueCount, tone: toneFromCount(unresolvedReviewQueueCount, 1, 5), definition: "Open workflow review items across closeout, time, and related compliance signals." }),
      makeMetric({ id: "production_missing_due_dates", label: "Production jobs with missing due dates", value: missingDueDateJobs, tone: toneFromCount(missingDueDateJobs, 1, 3) }),
      makeMetric({ id: "ownerless_production_jobs", label: "Ownerless production jobs", value: ownerlessProductionJobs, tone: toneFromCount(ownerlessProductionJobs, 1, 3) }),
      makeMetric({ id: "contacts_needs_review", label: "Contacts marked Needs Review", value: contactsNeedReviewCount, tone: toneFromCount(contactsNeedReviewCount, 1, 4) }),
      makeMetric({ id: "stale_location_memory", label: "Stale location memory count", value: staleLocationMemoryCount, tone: toneFromCount(staleLocationMemoryCount, 1, 4) })
    ],
    trendCards: [
      makeMetric({ id: "missing_eval_gap", label: "Missing eval gap", value: missingEvalCount, tone: toneFromCount(missingEvalCount, 1, 3) }),
      makeMetric({ id: "missing_setup_gap", label: "Missing setup photo gap", value: missingSetupCount, tone: toneFromCount(missingSetupCount, 1, 3) }),
      makeMetric({ id: "approval_backlog", label: "Approval backlog", value: approvalQueue.detail.sections.flatMap((section) => section.rows ?? []).length, tone: toneFromCount(approvalQueue.detail.sections.flatMap((section) => section.rows ?? []).length, 1, 4) })
    ],
    exceptionSections: [
      {
        id: "review_queue",
        title: "Unresolved Review Queue",
        summary: compliance.rows.length ? "The queue below keeps unresolved closeout, time, and review items visible until they are actually handled." : "No unresolved workflow review items are open right now.",
        rows: compliance.rows.slice(0, 12).map(mapComplianceRowToReportRow),
        action_hash: "#approvals"
      },
      {
        id: "production_data_quality",
        title: "Production Ownership and Due-Date Gaps",
        summary: productionIssueRows.rows.length ? "Open jobs without due dates or owners are surfaced before they slip into invisible queue debt." : "Production ownership and due-date coverage look healthy in the current view.",
        rows: productionIssueRows.rows.map((row) => ({
          id: row.id,
          primary: row.title,
          secondary: humanizeLabel(row.stage),
          chips: [{ label: humanizeLabel(row.reason_bucket), tone: row.reason_bucket === "missing_due_date_and_owner" ? "action_needed" : "heads_up" }],
          values: [
            { label: "Owner", value: row.owner_name ?? "Owner pending", tone: row.owner_name ? "good" : "heads_up" },
            { label: "Due", value: row.due_date ? formatDateLabel(row.due_date) : "No due date", tone: row.due_date ? "neutral" : "action_needed" }
          ],
          next_action: "Assign ownership, set the due date, and re-queue the job cleanly.",
          action_hash: "#production"
        })),
        action_hash: "#production"
      }
    ],
    drilldownSections: [
      {
        id: "approval_queue",
        title: "Approval Queue",
        summary: approvalQueue.detail.summary_line,
        rows: approvalQueue.detail.sections.flatMap((section) => section.rows ?? []).slice(0, 12),
        action_hash: "#approvals"
      },
      {
        id: "contact_review_backlog",
        title: "Contact Review Backlog",
        rows: contactReviewRows.rows.map((row) => ({
          id: row.id,
          primary: row.full_name,
          secondary: [row.title, row.organization_name].filter(Boolean).join(" | "),
          chips: [{ label: humanizeLabel(row.contact_status), tone: row.contact_status === "needs_review" ? "heads_up" : "neutral" }],
          values: [
            { label: "Importance", value: humanizeLabel(row.operational_importance ?? "normal"), tone: row.operational_importance === "critical" ? "action_needed" : row.operational_importance === "high" ? "heads_up" : "neutral" },
            { label: "Last Confirmed", value: row.last_confirmed_at ? formatDateLabel(row.last_confirmed_at) : "Never confirmed", tone: row.last_confirmed_at ? "neutral" : "action_needed" }
          ],
          next_action: "Review ownership, confirm contact detail, and refresh the record before upcoming work.",
          action_hash: "#directory"
        })),
        action_hash: "#directory"
      }
    ],
    detailPanel: {
      title: "Workflow Trust",
      items: [
        { label: "Review rule", value: "Missing time, closeout, and related workflow problems stay visible until they are resolved or intentionally closed." },
        { label: "Correction rule", value: "Time corrections preserve raw events, corrected values, actor, reason, and timestamps." },
        { label: "Ownership rule", value: "Open production jobs should not remain ownerless or due-date free once they enter active workflow." },
        { label: "Source records", value: "Compliance flags, pre-service acknowledgments, closeout requirements, production jobs, and directory freshness signals feed this dashboard." }
      ]
    },
    csvRows: [
      ...compliance.rows.slice(0, 50).map((row) => ({
        row_type: "review_queue",
        id: row.id,
        issue_type: row.issue_type,
        issue_label: row.issue_label,
        urgency: row.urgency,
        employee_name: row.employee_name ?? "",
        shoot_code: row.shoot_code ?? "",
        location_name: row.location_name ?? "",
        occurred_at: row.occurred_at
      })),
      ...productionIssueRows.rows.map((row) => ({
        row_type: "production_gap",
        id: row.id,
        issue_type: row.reason_bucket,
        issue_label: row.title,
        urgency: row.reason_bucket === "missing_due_date_and_owner" ? "high" : "medium",
        employee_name: row.owner_name ?? "",
        shoot_code: "",
        location_name: "",
        occurred_at: row.due_date ?? ""
      }))
    ]
  });
}

async function buildReportArtifact(
  client: PoolClient,
  auth: AuthUser,
  reportId: LeadershipReportId,
  filters: LeadershipReportFilters
): Promise<LeadershipReportArtifact> {
  const canonicalId = resolveCanonicalReportId(reportId);
  if (canonicalId && canonicalId === reportId) {
    switch (canonicalId) {
      case "executive_overview":
        return buildExecutiveOverviewReport(client, auth, filters);
      case "shoot_operations_health":
        return buildShootOperationsHealthReport(client, auth, filters);
      case "staffing_attendance":
        return buildStaffingAttendanceReport(client, auth, filters);
      case "production_qa_health":
        return buildProductionQaHealthReport(client, auth, filters);
      case "customer_relationship_follow_through":
        return buildCustomerRelationshipFollowThroughReport(client, auth, filters);
      case "location_intelligence_repeat_issues":
        return buildLocationIntelligenceRepeatIssuesReport(client, auth, filters);
      case "workflow_compliance_data_quality":
        return buildWorkflowComplianceDataQualityReport(client, auth, filters);
      default:
        throw new ApiError(404, "Leadership report not found");
    }
  }

  switch (reportId) {
    case "todays_operations_summary":
      return buildTodaysOperationsReport(client, auth, filters);
    case "weekly_labor_summary":
      return buildWeeklyLaborReport(client, auth, filters);
    case "attendance_exceptions_report":
      return buildAttendanceExceptionsReport(client, auth, filters);
    case "unfilled_shifts_report":
      return buildUnfilledShiftsReport(client, auth, filters);
    case "late_no_show_trend":
      return buildLateNoShowTrendReport(client, auth, filters);
    case "post_shoot_evaluation_summary":
      return buildPostShootEvaluationSummaryReport(client, auth, filters);
    case "location_issue_tracker":
      return buildLocationIssueTrackerReport(client, auth, filters);
    case "big_shoot_readiness_report":
      return buildBigShootReadinessReport(client, auth, filters);
    case "calendar_staffing_overview":
      return buildCalendarStaffingOverviewReport(client, auth, filters);
    case "open_approvals_report":
      return buildOpenApprovalsReport(client, auth, filters);
    case "operational_intelligence_report":
      return buildOperationalIntelligenceReport(client, auth, filters);
    case "zendesk_operational_summary":
      return buildZendeskOperationalSummaryReport(client, auth);
    case "monday_migration_progress_report":
      return buildMondayMigrationProgressReport(client, auth);
    default:
      throw new ApiError(404, "Leadership report not found");
  }
}

export async function getLeadershipReport(client: PoolClient, auth: AuthUser, reportId: LeadershipReportId, filters: LeadershipReportFilters) {
  assertLeadershipReportView(auth);
  return (await buildReportArtifact(client, auth, reportId, filters)).detail;
}

export async function exportLeadershipReportCsv(
  client: PoolClient,
  auth: AuthUser,
  reportId: LeadershipReportId,
  filters: LeadershipReportFilters
) {
  assertLeadershipReportExport(auth);
  const definition = getReportDefinition(reportId);
  if (!definition?.csv) {
    throw new ApiError(409, "CSV export is not available for that report");
  }
  const artifact = await buildReportArtifact(client, auth, reportId, filters);
  return buildCsv(artifact.csvRows);
}

export async function exportLeadershipReportPdf(
  client: PoolClient,
  auth: AuthUser,
  reportId: LeadershipReportId,
  filters: LeadershipReportFilters
) {
  assertLeadershipReportExport(auth);
  const definition = getReportDefinition(reportId);
  if (!definition?.pdf) {
    throw new ApiError(409, "PDF export is not available for that report");
  }
  const artifact = await buildReportArtifact(client, auth, reportId, filters);
  return createPdfBuffer(artifact.detail);
}

export async function getLeadershipReportsIndex(client: PoolClient, auth: AuthUser, filters: LeadershipReportFilters): Promise<LeadershipReportsIndex> {
  assertLeadershipReportView(auth);
  const range = {
    startDate: filters.dateFrom ?? filters.anchorDate,
    endDate: filters.dateTo ?? formatDateOnly(addDays(parseDateOnly(filters.anchorDate), 30))
  };
  const shoots = await listShoots(client, { dateFrom: range.startDate, dateTo: range.endDate }, auth);
  const artifacts = [] as LeadershipReportArtifact[];
  for (const definition of CANONICAL_REPORT_DEFINITIONS) {
    artifacts.push(await buildReportArtifact(client, auth, definition.id, filters));
  }
  const artifactById = new Map(artifacts.map((artifact) => [artifact.detail.id as CanonicalLeadershipReportId, artifact]));
  const summaryStrip = [
    artifactById.get("executive_overview")?.detail.top_summary?.find((metric) => metric.id === "shoots_at_risk"),
    artifactById.get("executive_overview")?.detail.top_summary?.find((metric) => metric.id === "under_minimum"),
    artifactById.get("production_qa_health")?.detail.top_summary?.find((metric) => metric.id === "blocked"),
    artifactById.get("customer_relationship_follow_through")?.detail.top_summary?.find((metric) => metric.id === "overdue_followups"),
    artifactById.get("location_intelligence_repeat_issues")?.detail.top_summary?.find((metric) => metric.id === "repeat_issue_locations"),
    artifactById.get("workflow_compliance_data_quality")?.detail.top_summary?.find((metric) => metric.id === "unresolved_review_queue")
  ].filter((metric): metric is LeadershipReportMetric => Boolean(metric));
  const bigShootQueue = buildBigShootQueue(shoots, filters.anchorDate);
  return {
    generated_at: new Date().toISOString(),
    anchor_date: filters.anchorDate,
    freshness: buildFreshness("recently_updated"),
    summary_strip: summaryStrip,
    saved_views: buildSavedViews(filters.anchorDate),
    scheduled_summaries: [
      { id: "daily_ops", label: "Daily morning leadership ops summary", cadence: "Daily", audience: "Leadership" },
      { id: "weekly_labor", label: "Weekly Monday labor and attendance summary", cadence: "Weekly", audience: "Leadership" },
      { id: "weekly_location", label: "Weekly post-shoot and location issue summary", cadence: "Weekly", audience: "Leadership and department heads" },
      { id: "weekly_big_shoot", label: "Weekly big and critical shoot readiness summary", cadence: "Weekly", audience: "Leadership" },
      { id: "monthly_exec", label: "Monthly executive operations snapshot", cadence: "Monthly", audience: "Executive leadership" }
    ],
    big_shoots_coming_up: {
      summary_line: bigShootQueue.length
        ? `${bigShootQueue.length} flagged big or critical shoot${bigShootQueue.length === 1 ? "" : "s"} are coming up in the current planning horizon.`
        : "No upcoming shoots are currently flagged above standard priority.",
      items: bigShootQueue
    },
    reports: artifacts.map((artifact) => {
      const definition = getCanonicalReportDefinition(artifact.detail.id as CanonicalLeadershipReportId);
      return {
        id: artifact.detail.id as CanonicalLeadershipReportId,
        title: artifact.detail.title,
        layer: definition.layer,
        audience: artifact.detail.audience,
        summary_line: artifact.detail.summary_line,
        tone: artifact.detail.tone,
        action_needed_count: collectActionNeededCount(artifact.detail),
        default_window: definition.defaultWindow,
        freshness_state: definition.freshnessState,
        export_pdf: definition.pdf,
        export_csv: definition.csv
      };
    })
  };
}
