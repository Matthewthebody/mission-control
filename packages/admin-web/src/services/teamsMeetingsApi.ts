import { apiFetch } from "../api";
import type {
  TeamsMeetingLinkedObjectType,
  TeamsMeetingRecord,
  TeamsMeetingRecordView,
  UpsertTeamsMeetingInput
} from "../teamsMeetingTypes";

const BASE = "/api/communications";

export function getTeamsMeetingRecordView(token: string, objectType: TeamsMeetingLinkedObjectType, objectId: string) {
  return apiFetch<TeamsMeetingRecordView>(`${BASE}/records/${objectType}/${objectId}/meeting`, token);
}

export function upsertTeamsMeeting(token: string, input: UpsertTeamsMeetingInput) {
  return apiFetch<TeamsMeetingRecord>(`${BASE}/meetings`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function cancelTeamsMeeting(token: string, meetingId: string, reason?: string | null) {
  return apiFetch<TeamsMeetingRecord>(`${BASE}/meetings/${meetingId}/cancel`, token, {
    method: "POST",
    body: JSON.stringify({
      reason: reason ?? null
    })
  });
}
