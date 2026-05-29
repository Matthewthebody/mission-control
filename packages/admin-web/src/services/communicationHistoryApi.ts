import { apiFetch } from "../api";
import type { CommunicationHistoryRecordView } from "../communicationHistoryTypes";
import type { TeamsCommunicationLinkedObjectType } from "../teamsCommunicationTypes";

const BASE = "/api/communications";

export function getCommunicationHistoryRecordView(token: string, objectType: TeamsCommunicationLinkedObjectType, objectId: string) {
  return apiFetch<CommunicationHistoryRecordView>(`${BASE}/records/${objectType}/${objectId}/history`, token);
}
