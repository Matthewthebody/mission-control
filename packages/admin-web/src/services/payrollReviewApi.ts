import { apiFetch, apiUrl } from "../api";
import type { PayrollExportPayload, PayrollReviewDetailPayload, PayrollReviewPayload } from "../payrollReviewTypes";

type PayrollReviewFilters = {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  department?: string;
  userId?: string;
};

function buildQuery(filters: PayrollReviewFilters) {
  const params = new URLSearchParams();
  if (filters.date) {
    params.set("date", filters.date);
  }
  if (filters.dateFrom) {
    params.set("date_from", filters.dateFrom);
  }
  if (filters.dateTo) {
    params.set("date_to", filters.dateTo);
  }
  if (filters.department && filters.department !== "all") {
    params.set("department", filters.department);
  }
  if (filters.userId) {
    params.set("user_id", filters.userId);
  }
  return params.toString();
}

export async function getPayrollReview(token: string, filters: PayrollReviewFilters) {
  return apiFetch<PayrollReviewPayload>(`/api/attendance/payroll-review?${buildQuery(filters)}`, token);
}

export async function getPayrollReviewDetail(
  token: string,
  employeeId: string,
  filters: PayrollReviewFilters
) {
  return apiFetch<PayrollReviewDetailPayload>(
    `/api/attendance/payroll-review/${employeeId}?${buildQuery(filters)}`,
    token
  );
}

export async function getPayrollExportPayload(token: string, filters: PayrollReviewFilters) {
  return apiFetch<PayrollExportPayload>(`/api/attendance/payroll-review/export-payload?${buildQuery(filters)}`, token);
}

export async function downloadPayrollExportCsv(token: string, filters: PayrollReviewFilters) {
  const response = await fetch(`${apiUrl}/api/attendance/payroll-review/export.csv?${buildQuery(filters)}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Payroll export failed with ${response.status}`);
  }

  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = "mission-control-payroll-export.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}
