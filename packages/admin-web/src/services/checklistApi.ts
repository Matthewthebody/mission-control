import { apiFetch } from "../api";
import type {
  ChecklistAttachmentInput,
  ChecklistCommentInput,
  ChecklistInstanceDetail,
  ChecklistInstancesQuery,
  ChecklistReminderSweepResult,
  ChecklistResponseInput,
  ChecklistSeedDefaultsResult,
  ChecklistTemplateDetail,
  ChecklistTemplateQuery,
  ChecklistTemplateSummary,
  ChecklistTemplateVersionInput,
  ChecklistTransitionValidation,
  ChecklistTransitionValidationInput,
  CreateChecklistInstanceInput,
  ChecklistUploadAsset
} from "../checklistTypes";

type UploadPresignResponse = {
  url: string;
  fields: Record<string, string>;
  storage_key: string;
  object_url: string;
};

const CHECKLISTS_BASE = "/api/checklists";

function buildTemplateSearch(query: ChecklistTemplateQuery = {}) {
  const params = new URLSearchParams();
  if (query.department_type && query.department_type !== "all") {
    params.set("department_type", query.department_type);
  }
  if (query.scope_type) {
    params.set("scope_type", query.scope_type);
  }
  if (query.include_archived) {
    params.set("include_archived", "yes");
  }
  return params.toString();
}

export async function listChecklistTemplates(token: string, query: ChecklistTemplateQuery = {}) {
  const search = buildTemplateSearch(query);
  return apiFetch<{ templates: ChecklistTemplateSummary[] }>(`${CHECKLISTS_BASE}/templates${search ? `?${search}` : ""}`, token);
}

export async function getChecklistTemplateDetail(token: string, templateId: string) {
  return apiFetch<{ template: ChecklistTemplateDetail }>(`${CHECKLISTS_BASE}/templates/${templateId}`, token);
}

export async function createChecklistTemplateDraft(token: string, input: ChecklistTemplateVersionInput) {
  return apiFetch<{ template: ChecklistTemplateDetail }>(`${CHECKLISTS_BASE}/templates`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateChecklistTemplateDraft(token: string, templateId: string, input: ChecklistTemplateVersionInput) {
  return apiFetch<{ template: ChecklistTemplateDetail }>(`${CHECKLISTS_BASE}/templates/${templateId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function publishChecklistTemplateVersion(token: string, templateId: string, versionId: string) {
  return apiFetch<{ template: ChecklistTemplateDetail }>(
    `${CHECKLISTS_BASE}/templates/${templateId}/versions/${versionId}/publish`,
    token,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
}

export async function seedChecklistDefaults(token: string) {
  return apiFetch<{ seeded: ChecklistSeedDefaultsResult }>(`${CHECKLISTS_BASE}/templates/seed-defaults`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function listChecklistInstances(token: string, query: ChecklistInstancesQuery) {
  const params = new URLSearchParams();
  params.set("scope_type", query.scope_type);
  params.set("scope_id", query.scope_id);
  return apiFetch<{ instances: ChecklistInstanceDetail[] }>(`${CHECKLISTS_BASE}/instances?${params.toString()}`, token);
}

export async function createChecklistInstance(token: string, input: CreateChecklistInstanceInput) {
  return apiFetch<{ instance: ChecklistInstanceDetail }>(`${CHECKLISTS_BASE}/instances`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getChecklistInstance(token: string, instanceId: string) {
  return apiFetch<{ instance: ChecklistInstanceDetail }>(`${CHECKLISTS_BASE}/instances/${instanceId}`, token);
}

export async function saveChecklistResponses(token: string, instanceId: string, responses: ChecklistResponseInput[]) {
  return apiFetch<{ instance: ChecklistInstanceDetail }>(`${CHECKLISTS_BASE}/instances/${instanceId}/responses`, token, {
    method: "POST",
    body: JSON.stringify({ responses })
  });
}

export async function addChecklistAttachment(token: string, instanceId: string, input: ChecklistAttachmentInput) {
  return apiFetch<{ instance: ChecklistInstanceDetail }>(`${CHECKLISTS_BASE}/instances/${instanceId}/attachments`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function uploadChecklistAsset(
  token: string,
  file: File,
  resourceId?: string | null
): Promise<ChecklistUploadAsset> {
  const presign = await apiFetch<UploadPresignResponse>("/api/uploads/presign", token, {
    method: "POST",
    body: JSON.stringify({
      content_type: file.type || "application/octet-stream",
      resource_type: "checklist_attachment",
      resource_id: resourceId ?? undefined
    })
  });

  const form = new FormData();
  for (const [key, value] of Object.entries(presign.fields)) {
    form.append(key, value);
  }
  form.append("file", file);

  const uploadResponse = await fetch(presign.url, {
    method: "POST",
    body: form
  });
  if (!uploadResponse.ok) {
    throw new Error("We couldn't upload that checklist proof right now.");
  }

  return {
    file_name: file.name,
    content_type: file.type || "application/octet-stream",
    storage_key: presign.storage_key,
    object_url: presign.object_url
  };
}

export async function addChecklistComment(token: string, instanceId: string, input: ChecklistCommentInput) {
  return apiFetch<{ instance: ChecklistInstanceDetail }>(`${CHECKLISTS_BASE}/instances/${instanceId}/comments`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function submitChecklistInstance(token: string, instanceId: string) {
  return apiFetch<{ instance: ChecklistInstanceDetail }>(`${CHECKLISTS_BASE}/instances/${instanceId}/submit`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function approveChecklistInstance(token: string, instanceId: string, note?: string | null) {
  return apiFetch<{ instance: ChecklistInstanceDetail }>(`${CHECKLISTS_BASE}/instances/${instanceId}/approve`, token, {
    method: "POST",
    body: JSON.stringify(note ? { note } : {})
  });
}

export async function rejectChecklistInstance(token: string, instanceId: string, note: string) {
  return apiFetch<{ instance: ChecklistInstanceDetail }>(`${CHECKLISTS_BASE}/instances/${instanceId}/reject`, token, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}

export async function waiveChecklistInstance(token: string, instanceId: string, note: string) {
  return apiFetch<{ instance: ChecklistInstanceDetail }>(`${CHECKLISTS_BASE}/instances/${instanceId}/waive`, token, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}

export async function validateChecklistTransition(token: string, input: ChecklistTransitionValidationInput) {
  return apiFetch<{ validation: ChecklistTransitionValidation }>(`${CHECKLISTS_BASE}/transitions/validate`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function sweepChecklistReminders(token: string, limit?: number) {
  return apiFetch<{ result: ChecklistReminderSweepResult }>(`${CHECKLISTS_BASE}/reminders/sweep`, token, {
    method: "POST",
    body: JSON.stringify({ limit })
  });
}
