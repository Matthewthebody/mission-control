import { apiFetch } from "../api";

// SSA-5 Record Threads V1: one conversation per record (job, organization).

export type RecordThreadObjectType = "job" | "organization";

export type RecordThreadMessage = {
  id: string;
  thread_id: string;
  message_kind: "user_message" | "system_event";
  body: string | null;
  event_type: string | null;
  author_user_id: string | null;
  author_name: string | null;
  mention_user_ids: string[];
  attachment_refs: unknown[];
  metadata: Record<string, unknown>;
  created_at: string;
};

export type RecordThreadView = {
  entity_type: RecordThreadObjectType;
  entity_id: string;
  entity_label: string;
  thread_id: string | null;
  messages: RecordThreadMessage[];
};

export async function getRecordThread(token: string, objectType: RecordThreadObjectType, objectId: string) {
  return apiFetch<RecordThreadView>(`/api/record-threads/${objectType}/${objectId}`, token);
}

export async function postRecordThreadMessage(
  token: string,
  objectType: RecordThreadObjectType,
  objectId: string,
  input: { body: string; mention_user_ids?: string[] }
) {
  return apiFetch<RecordThreadView>(`/api/record-threads/${objectType}/${objectId}/messages`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}
