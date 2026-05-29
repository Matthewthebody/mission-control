import { apiFetch } from "../api";
import type {
  CreateTeamsCommunicationReferenceInput,
  QueueTeamsCommunicationMessageInput,
  TeamsCommunicationLinkedObjectType,
  TeamsCommunicationRecordView,
  TeamsCommunicationReferenceRecord,
  TeamsCommunicationDeliveryRecord
} from "../teamsCommunicationTypes";

const BASE = "/api/communications";

export function getTeamsCommunicationRecordView(token: string, objectType: TeamsCommunicationLinkedObjectType, objectId: string) {
  return apiFetch<TeamsCommunicationRecordView>(`${BASE}/records/${objectType}/${objectId}`, token);
}

export function createTeamsCommunicationReference(
  token: string,
  objectType: TeamsCommunicationLinkedObjectType,
  objectId: string,
  input: CreateTeamsCommunicationReferenceInput
) {
  return apiFetch<TeamsCommunicationReferenceRecord>(`${BASE}/records/${objectType}/${objectId}/references`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function queueTeamsCommunicationMessage(token: string, input: QueueTeamsCommunicationMessageInput) {
  return apiFetch<TeamsCommunicationDeliveryRecord>(`${BASE}/send`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}
