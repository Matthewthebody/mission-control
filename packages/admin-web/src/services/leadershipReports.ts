import { apiFetch, apiUrl } from "../api";
import type {
  LeadershipDeliveryScheduleRecord,
  LeadershipPacketRunRecord,
  LeadershipPacketTemplateRecord,
  LeadershipReportDetail,
  LeadershipReportId,
  LeadershipReportsIndex,
  LeadershipSavedView,
  ReportingDeliveryCenter
} from "../types";

export type LeadershipReportFilters = {
  date: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  department?: string | null;
};

export async function getLeadershipReportsIndex(token: string, filters: LeadershipReportFilters) {
  return apiFetch<LeadershipReportsIndex>(`/api/dashboard/reports?${buildQuery(filters)}`, token);
}

export async function getLeadershipReport(token: string, reportId: LeadershipReportId, filters: LeadershipReportFilters) {
  return apiFetch<LeadershipReportDetail>(`/api/dashboard/reports/${reportId}?${buildQuery(filters)}`, token);
}

export async function getReportingDeliveryCenter(token: string, filters: LeadershipReportFilters) {
  return apiFetch<ReportingDeliveryCenter>(`/api/dashboard/reports/delivery-center?${buildQuery(filters)}`, token);
}

export async function createReportingSavedView(
  token: string,
  payload: {
    source_module: NonNullable<LeadershipSavedView["source_module"]>;
    report_id: LeadershipSavedView["report_id"] | null;
    name: string;
    description?: string | null;
    visibility: NonNullable<LeadershipSavedView["visibility"]>;
    window: LeadershipSavedView["window"];
    date_from?: string | null;
    date_to?: string | null;
    department?: string | null;
    is_default?: boolean;
    is_pinned?: boolean;
  }
) {
  return apiFetch<LeadershipSavedView>("/api/dashboard/reports/saved-views", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateReportingSavedView(
  token: string,
  savedViewId: string,
  payload: Partial<{
    name: string;
    description: string | null;
    visibility: NonNullable<LeadershipSavedView["visibility"]>;
    window: LeadershipSavedView["window"];
    date_from: string | null;
    date_to: string | null;
    department: string | null;
    is_default: boolean;
    is_pinned: boolean;
  }>
) {
  return apiFetch<LeadershipSavedView>(`/api/dashboard/reports/saved-views/${savedViewId}`, token, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function duplicateReportingSavedView(token: string, savedViewId: string) {
  return apiFetch<LeadershipSavedView>(`/api/dashboard/reports/saved-views/${savedViewId}/duplicate`, token, {
    method: "POST"
  });
}

export async function deleteReportingSavedView(token: string, savedViewId: string) {
  return apiFetch<void>(`/api/dashboard/reports/saved-views/${savedViewId}`, token, {
    method: "DELETE"
  });
}

export async function createLeadershipPacketTemplate(
  token: string,
  payload: {
    name: string;
    audience: string;
    description?: string | null;
    visibility: LeadershipPacketTemplateRecord["visibility"];
    default_window: LeadershipPacketTemplateRecord["default_window"];
    department?: string | null;
    is_pinned?: boolean;
    section_config: LeadershipPacketTemplateRecord["section_config"];
  }
) {
  return apiFetch<LeadershipPacketTemplateRecord>("/api/dashboard/reports/packet-templates", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateLeadershipPacketTemplate(
  token: string,
  templateId: string,
  payload: Partial<{
    name: string;
    audience: string;
    description: string | null;
    visibility: LeadershipPacketTemplateRecord["visibility"];
    default_window: LeadershipPacketTemplateRecord["default_window"];
    department: string | null;
    is_pinned: boolean;
    section_config: LeadershipPacketTemplateRecord["section_config"];
  }>
) {
  return apiFetch<LeadershipPacketTemplateRecord>(`/api/dashboard/reports/packet-templates/${templateId}`, token, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function duplicateLeadershipPacketTemplate(token: string, templateId: string) {
  return apiFetch<LeadershipPacketTemplateRecord>(`/api/dashboard/reports/packet-templates/${templateId}/duplicate`, token, {
    method: "POST"
  });
}

export async function deleteLeadershipPacketTemplate(token: string, templateId: string) {
  return apiFetch<void>(`/api/dashboard/reports/packet-templates/${templateId}`, token, {
    method: "DELETE"
  });
}

export async function runLeadershipPacketTemplate(token: string, templateId: string, payload: {
  anchor_date?: string;
  date_from?: string | null;
  date_to?: string | null;
  recipients?: string[];
  channel?: LeadershipDeliveryScheduleRecord["delivery_channel"] | null;
}) {
  return apiFetch<LeadershipPacketRunRecord>(`/api/dashboard/reports/packet-templates/${templateId}/run`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function runLeadershipSavedView(token: string, savedViewId: string, payload: {
  anchor_date?: string;
  recipients?: string[];
  channel?: LeadershipDeliveryScheduleRecord["delivery_channel"] | null;
}) {
  return apiFetch<LeadershipPacketRunRecord>(`/api/dashboard/reports/saved-views/${savedViewId}/run`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function createLeadershipDeliverySchedule(
  token: string,
  payload: {
    label: string;
    source_type: LeadershipDeliveryScheduleRecord["source_type"];
    template_id?: string | null;
    saved_view_id?: string | null;
    cadence: LeadershipDeliveryScheduleRecord["cadence"];
    day_of_week?: number;
    hour_local: number;
    minute_local: number;
    timezone: string;
    delivery_channel: LeadershipDeliveryScheduleRecord["delivery_channel"];
    recipient_user_ids: string[];
    active_status?: boolean;
  }
) {
  return apiFetch<LeadershipDeliveryScheduleRecord>("/api/dashboard/reports/delivery-schedules", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateLeadershipDeliverySchedule(
  token: string,
  scheduleId: string,
  payload: Partial<{
    label: string;
    source_type: LeadershipDeliveryScheduleRecord["source_type"];
    template_id: string | null;
    saved_view_id: string | null;
    cadence: LeadershipDeliveryScheduleRecord["cadence"];
    day_of_week: number;
    hour_local: number;
    minute_local: number;
    timezone: string;
    delivery_channel: LeadershipDeliveryScheduleRecord["delivery_channel"];
    recipient_user_ids: string[];
    active_status: boolean;
  }>
) {
  return apiFetch<LeadershipDeliveryScheduleRecord>(`/api/dashboard/reports/delivery-schedules/${scheduleId}`, token, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function runLeadershipDeliverySchedule(token: string, scheduleId: string) {
  return apiFetch<LeadershipPacketRunRecord>(`/api/dashboard/reports/delivery-schedules/${scheduleId}/run`, token, {
    method: "POST"
  });
}

export async function downloadLeadershipPacketRunPdf(token: string, packetRunId: string) {
  const response = await fetch(`${apiUrl}/api/dashboard/reports/packet-runs/${packetRunId}/export.pdf`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Leadership packet PDF export failed");
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `leadership-packet-${packetRunId}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

export async function downloadLeadershipReport(
  token: string,
  reportId: LeadershipReportId,
  format: "csv" | "pdf",
  filters: LeadershipReportFilters,
  savedViewId?: string | null
) {
  const response = await fetch(
    `${apiUrl}/api/dashboard/reports/${reportId}/export.${format}?${buildQuery(filters, savedViewId ?? null)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Leadership report ${format.toUpperCase()} export failed`);
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `${reportId}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function buildQuery(filters: LeadershipReportFilters, savedViewId?: string | null) {
  const params = new URLSearchParams({
    date: filters.date
  });
  if (filters.dateFrom) {
    params.set("date_from", filters.dateFrom);
  }
  if (filters.dateTo) {
    params.set("date_to", filters.dateTo);
  }
  if (filters.department) {
    params.set("department", filters.department);
  }
  if (savedViewId) {
    params.set("saved_view_id", savedViewId);
  }
  return params.toString();
}
