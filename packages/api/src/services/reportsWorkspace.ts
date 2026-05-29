import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { getOperationalModelReport } from "./operationalReporting.js";
import { getOperationalHistorySection } from "./operationalHistory.js";
import { getOperatingSystemQueryScope } from "./operatingSystemAccess.js";
import { getReportingDeliveryCenter } from "./reportingDelivery.js";
import type {
  ReportsWorkspaceHistoryFocus,
  ReportsWorkspaceDeliveryScheduleRecord,
  ReportsWorkspaceExportRecord,
  ReportsWorkspacePacketRunRecord,
  ReportsWorkspacePacketTemplateRecord,
  ReportsWorkspaceResponse,
  ReportsWorkspaceSavedViewRecord
} from "../types/reportsWorkspace.js";
import { OPERATIONAL_REPORTING_PERIODS } from "../types/operationalReporting.js";

export async function getReportsWorkspace(
  client: PoolClient,
  auth: AuthUser,
  input: {
    anchorDate: string;
    period: (typeof OPERATIONAL_REPORTING_PERIODS)[number];
    department?: string | null;
    historyFocus?: ReportsWorkspaceHistoryFocus | null;
  }
): Promise<ReportsWorkspaceResponse> {
  const scope = getOperatingSystemQueryScope(auth, "reports");
  if (scope.level === "none") {
    throw new ApiError(403, "You do not have access to view reports.");
  }

  const scopedDepartment = resolveScopedDepartment(auth, scope.level, input.department ?? null);
  const operationalModel = await getOperationalModelReport(client, auth, {
    anchorDate: input.anchorDate,
    period: input.period,
    department: scopedDepartment
  });

  const dateFrom = operationalModel.date_range.starts_at.slice(0, 10);
  const dateTo = exclusiveEndToInclusiveDate(operationalModel.date_range.ends_before);

  const deliveryCenter = await getReportingDeliveryCenter(client, auth, {
    anchorDate: input.anchorDate,
    dateFrom,
    dateTo,
    department: scopedDepartment
  });
  const history = await getOperationalHistorySection(client, auth, {
    department: scopedDepartment,
    focus: input.historyFocus ?? "all"
  });

  const deliveryUpdatedAt = maxTimestamp([
    ...deliveryCenter.saved_views.map((item) => item.updated_at),
    ...deliveryCenter.packet_templates.map((item) => item.updated_at),
    ...deliveryCenter.recent_packet_runs.map((item) => item.completed_at || item.created_at),
    ...deliveryCenter.export_history.map((item) => item.completed_at || item.requested_at),
    ...deliveryCenter.delivery_schedules.map((item) => item.updated_at)
  ]);
  const historyUpdatedAt = history.items[0]?.created_at ?? null;

  return {
    generated_at: new Date().toISOString(),
    anchor_date: input.anchorDate,
    period: input.period,
    period_options: [...OPERATIONAL_REPORTING_PERIODS],
    scope_department: scopedDepartment,
    refresh_interval_seconds: 300,
    freshness: {
      summary_line: "Reports is intentionally slower and calmer than Home or Operations. Freshness reflects the last server-backed reporting, delivery, and history reads instead of a fake live clock.",
      sources: [
        {
          id: "operational_model",
          label: "Trend Model",
          detail: `${operationalModel.period_label} reporting window anchored to ${input.anchorDate}.`,
          updated_at: operationalModel.generated_at,
          tone: "info"
        },
        {
          id: "delivery_center",
          label: "Saved Views & Packets",
          detail: `${deliveryCenter.saved_views.length} saved views, ${deliveryCenter.packet_templates.length} packet templates, ${deliveryCenter.delivery_schedules.filter((item) => item.active_status).length} active schedules.`,
          updated_at: deliveryUpdatedAt,
          tone: deliveryCenter.delivery_schedules.some((item) => item.last_status === "failed" || item.last_error) ? "action_needed" : "neutral"
        },
        {
          id: "history",
          label: "Operational History",
          detail: history.summary_line,
          updated_at: historyUpdatedAt,
          tone: history.items.length ? "neutral" : "heads_up"
        }
      ]
    },
    operational_model: operationalModel,
    delivery_summary: {
      saved_view_count: deliveryCenter.saved_views.length,
      packet_template_count: deliveryCenter.packet_templates.length,
      active_schedule_count: deliveryCenter.delivery_schedules.filter((item) => item.active_status).length,
      failed_schedule_count: deliveryCenter.delivery_schedules.filter((item) => item.last_status === "failed" || item.last_error).length,
      recent_run_count: deliveryCenter.recent_packet_runs.length,
      failed_export_count: deliveryCenter.export_history.filter((item) => item.status === "failed").length
    },
    saved_views: deliveryCenter.saved_views.map(mapSavedView),
    packet_templates: deliveryCenter.packet_templates.map(mapPacketTemplate),
    recent_packet_runs: deliveryCenter.recent_packet_runs.map(mapPacketRun),
    export_history: deliveryCenter.export_history.map(mapExportHistory),
    delivery_schedules: deliveryCenter.delivery_schedules.map(mapDeliverySchedule),
    history
  };
}

export async function exportReportsWorkspaceCsv(
  client: PoolClient,
  auth: AuthUser,
  input: {
    anchorDate: string;
    period: (typeof OPERATIONAL_REPORTING_PERIODS)[number];
    department?: string | null;
  }
) {
  const scope = getOperatingSystemQueryScope(auth, "reports");
  if (scope.level === "none") {
    throw new ApiError(403, "You do not have access to export reports.");
  }

  const scopedDepartment = resolveScopedDepartment(auth, scope.level, input.department ?? null);
  const model = await getOperationalModelReport(client, auth, {
    anchorDate: input.anchorDate,
    period: input.period,
    department: scopedDepartment
  });

  const rows: Array<Record<string, string | number | null>> = [
    ...model.summary_strip.map((card) => ({
      section: "summary_strip",
      label: card.label,
      primary_value: card.value,
      secondary_value: card.detail,
      tone: card.tone,
      action_hash: card.action_hash
    })),
    ...model.watch.trend.flatMap((point) =>
      point.metrics.map((metric) => ({
        section: "watch_trend",
        label: `${point.bucket.label} - ${metric.label}`,
        primary_value: metric.value,
        secondary_value: model.watch.summary_line,
        tone: null,
        action_hash: model.watch.action_hash
      }))
    ),
    ...model.attendance.trend.flatMap((point) =>
      point.metrics.map((metric) => ({
        section: "attendance_trend",
        label: `${point.bucket.label} - ${metric.label}`,
        primary_value: metric.value,
        secondary_value: model.attendance.summary_line,
        tone: null,
        action_hash: model.attendance.action_hash
      }))
    ),
    ...model.production.trend.flatMap((point) =>
      point.metrics.map((metric) => ({
        section: "production_trend",
        label: `${point.bucket.label} - ${metric.label}`,
        primary_value: metric.value,
        secondary_value: model.production.summary_line,
        tone: null,
        action_hash: model.production.action_hash
      }))
    ),
    ...model.approvals.trend.flatMap((point) =>
      point.metrics.map((metric) => ({
        section: "approvals_trend",
        label: `${point.bucket.label} - ${metric.label}`,
        primary_value: metric.value,
        secondary_value: model.approvals.summary_line,
        tone: null,
        action_hash: model.approvals.action_hash
      }))
    )
  ];

  return buildCsv(rows);
}

function mapSavedView(item: Awaited<ReturnType<typeof getReportingDeliveryCenter>>["saved_views"][number]): ReportsWorkspaceSavedViewRecord {
  return {
    id: item.id,
    label: item.label,
    summary: item.summary,
    report_id: item.report_id,
    window: item.window,
    visibility: item.visibility,
    department: item.department ?? null,
    is_default: item.is_default,
    is_pinned: item.is_pinned,
    updated_at: item.updated_at,
    share_hash: item.share_hash
  };
}

function mapPacketTemplate(item: Awaited<ReturnType<typeof getReportingDeliveryCenter>>["packet_templates"][number]): ReportsWorkspacePacketTemplateRecord {
  return {
    id: item.id,
    name: item.name,
    audience: item.audience,
    description: item.description ?? null,
    visibility: item.visibility,
    default_window: item.default_window,
    is_pinned: item.is_pinned,
    updated_at: item.updated_at
  };
}

function mapPacketRun(item: Awaited<ReturnType<typeof getReportingDeliveryCenter>>["recent_packet_runs"][number]): ReportsWorkspacePacketRunRecord {
  return {
    id: item.id,
    run_label: item.run_label,
    source_type: item.source_type,
    template_name: item.template_name ?? null,
    saved_view_name: item.saved_view_name ?? null,
    status: item.status,
    anchor_date: item.anchor_date,
    created_at: item.created_at,
    completed_at: item.completed_at,
    pdf_available: Boolean(item.pdf_reference)
  };
}

function mapExportHistory(item: Awaited<ReturnType<typeof getReportingDeliveryCenter>>["export_history"][number]): ReportsWorkspaceExportRecord {
  return {
    id: item.id,
    export_name: item.export_name,
    format: item.format,
    status: item.status,
    requested_by_name: item.requested_by_name ?? null,
    requested_at: item.requested_at,
    completed_at: item.completed_at,
    record_count: item.record_count
  };
}

function mapDeliverySchedule(item: Awaited<ReturnType<typeof getReportingDeliveryCenter>>["delivery_schedules"][number]): ReportsWorkspaceDeliveryScheduleRecord {
  return {
    id: item.id,
    label: item.label,
    source_type: item.source_type,
    template_name: item.template_name ?? null,
    saved_view_name: item.saved_view_name ?? null,
    cadence: item.cadence,
    delivery_channel: item.delivery_channel,
    active_status: item.active_status,
    last_run_at: item.last_run_at,
    next_run_at: item.next_run_at,
    last_status: item.last_status,
    last_error: item.last_error
  };
}

function resolveScopedDepartment(auth: AuthUser, scopeLevel: "none" | "own" | "department" | "all", requestedDepartment: string | null) {
  if (scopeLevel === "department") {
    if (requestedDepartment && requestedDepartment !== auth.department) {
      throw new ApiError(403, "You can only report on your scoped department.");
    }
    return auth.department;
  }
  return requestedDepartment;
}

function exclusiveEndToInclusiveDate(endsBefore: string) {
  const date = new Date(endsBefore);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function maxTimestamp(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .map((value) => String(value))
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
}

function buildCsv(rows: Array<Record<string, string | number | null>>) {
  if (!rows.length) {
    return "section,label,primary_value,secondary_value,tone,action_hash\n";
  }
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => escapeCsvValue(row[header] ?? ""))
        .join(",")
    )
  ];
  return `${lines.join("\n")}\n`;
}

function escapeCsvValue(value: string | number) {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}
