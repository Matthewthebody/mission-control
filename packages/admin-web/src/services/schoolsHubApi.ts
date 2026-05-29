import { apiFetch } from "../api";
import type {
  CreateSchoolDeliverableInput,
  MondaySchoolImportInput,
  MondaySchoolImportResult,
  SchoolsHubFilters,
  SchoolsHubReferenceData,
  SchoolDeliverableRecord,
  SchoolsHubWorkspaceResponse,
  SchoolWorkItemDetailResponse,
  SchoolWorkItemBulkUpdateInput,
  SchoolWorkItemRecord,
  SchoolWorkItemUpdateInput
} from "../schoolsHubTypes";

export async function getSchoolsHubWorkspace(token: string, filters: SchoolsHubFilters) {
  const params = new URLSearchParams();
  params.set("anchor_date", filters.anchor_date);
  if (filters.search.trim()) {
    params.set("search", filters.search.trim());
  }
  if (filters.owner_user_id) {
    params.set("owner_user_id", filters.owner_user_id);
  }
  if (filters.school_id) {
    params.set("school_id", filters.school_id);
  }
  if (filters.job_id) {
    params.set("job_id", filters.job_id);
  }
  if (filters.work_type !== "all") {
    params.set("work_type", filters.work_type);
  }
  if (filters.priority !== "all") {
    params.set("priority", filters.priority);
  }
  if (filters.waiting_on !== "all") {
    params.set("waiting_on", filters.waiting_on);
  }
  if (typeof filters.page === "number" && Number.isFinite(filters.page)) {
    params.set("page", String(filters.page));
  }
  if (typeof filters.page_size === "number" && Number.isFinite(filters.page_size)) {
    params.set("page_size", String(filters.page_size));
  }
  return apiFetch<SchoolsHubWorkspaceResponse>(`/api/schools-hub?${params.toString()}`, token);
}

export async function getSchoolsHubReferenceData(token: string) {
  return apiFetch<SchoolsHubReferenceData>("/api/schools-hub/reference-data", token);
}

export async function updateSchoolWorkItemRecord(token: string, id: string, input: SchoolWorkItemUpdateInput) {
  return apiFetch<SchoolWorkItemRecord>(`/api/schools-hub/work-items/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function getSchoolWorkItemDetailRecord(token: string, id: string) {
  return apiFetch<SchoolWorkItemDetailResponse>(`/api/schools-hub/work-items/${id}/detail`, token);
}

export async function convertSchoolWorkItemToDeliverableRecord(
  token: string,
  id: string,
  input: Partial<CreateSchoolDeliverableInput> = {}
) {
  return apiFetch<{ deliverable: SchoolDeliverableRecord }>(`/api/schools-hub/work-items/${id}/convert-to-deliverable`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function bulkUpdateSchoolWorkItemsRecord(token: string, input: SchoolWorkItemBulkUpdateInput) {
  return apiFetch<{ updated_ids: string[]; updated_count: number }>("/api/schools-hub/work-items/bulk", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function importMondaySchoolSnapshotRecord(token: string, input: MondaySchoolImportInput) {
  return apiFetch<MondaySchoolImportResult>("/api/schools-hub/monday/import", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function reimportMondaySchoolEntityRecord(
  token: string,
  entityType: "school_job" | "school_work_item",
  id: string
) {
  return apiFetch<MondaySchoolImportResult>(`/api/schools-hub/monday/reimport/${entityType}/${id}`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}
