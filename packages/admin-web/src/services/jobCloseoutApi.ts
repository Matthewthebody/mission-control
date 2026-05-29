import { apiFetch } from "../api";
import type { JobCloseoutReportSnapshot, JobCloseoutWorkspace, SubmitJobCloseoutPayload } from "../jobCloseoutTypes";

export function getJobCloseoutWorkspace(token: string, jobId: string) {
  return apiFetch<JobCloseoutWorkspace>(`/api/job-closeout/jobs/${jobId}`, token);
}

export function submitJobCloseoutEvaluation(token: string, jobId: string, payload: SubmitJobCloseoutPayload) {
  return apiFetch<{
    evaluation: {
      id: string;
      job_id: string;
      eval_status: string;
      submitter_role: string;
      overall_status: string;
      image_confidence_score: number;
      mileage_qualified: boolean;
    };
    flag_ids: string[];
    late_staff_entry_ids: string[];
    attachment_ids: string[];
    mileage_review: { id: string; status: string } | null;
  }>(`/api/job-closeout/jobs/${jobId}/evaluations`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function createShootCheckInRequests(token: string, jobId: string) {
  return apiFetch<{ check_ins: Array<{ id: string; due_at: string; status: string }> }>(`/api/job-closeout/jobs/${jobId}/check-ins`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function respondToShootCheckIn(token: string, jobId: string, checkInId: string, payload: { status: "good" | "issue"; issue_note?: string | null }) {
  return apiFetch<{ check_in: { id: string; status: string; issue_note: string | null }; flag_id: string | null }>(
    `/api/job-closeout/jobs/${jobId}/check-ins/${checkInId}/respond`,
    token,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function generateOperationsReportSnapshot(
  token: string,
  type: "daily" | "weekly",
  params: { period_start?: string; period_end?: string } = {}
) {
  const query = new URLSearchParams();
  if (params.period_start) {
    query.set("period_start", params.period_start);
  }
  if (params.period_end) {
    query.set("period_end", params.period_end);
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<{ snapshot: JobCloseoutReportSnapshot }>(`/api/job-closeout/reports/${type}/generate${suffix}`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function listOperationsReportSnapshots(token: string, type: "daily" | "weekly") {
  return apiFetch<{ snapshots: JobCloseoutReportSnapshot[] }>(`/api/job-closeout/reports/${type}`, token);
}

export function listJobCloseoutEvaluations(token: string) {
  return apiFetch<{ evaluations: unknown[] }>("/api/job-closeout/evaluations", token);
}
