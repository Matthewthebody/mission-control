import { apiFetch } from "../api";
import type { CommunicationIdentity } from "../types";

const BASE = "/api/communications/moderation";

export function hideCommunicationDelivery(token: string, deliveryId: string, reason: string) {
  return apiFetch<{ ok: true; delivery_id: string; visibility_status: "moderated_hidden"; moderation_reason: string }>(
    `${BASE}/deliveries/${deliveryId}/hide`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ reason })
    }
  );
}

export function restoreCommunicationDelivery(token: string, deliveryId: string, reason?: string | null) {
  return apiFetch<{ ok: true; delivery_id: string; visibility_status: "visible" }>(
    `${BASE}/deliveries/${deliveryId}/restore`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? null })
    }
  );
}

export function updateCommunicationPostingState(token: string, userId: string, disabled: boolean, reason?: string | null) {
  return apiFetch<{ ok: true; user_id: string; posting_disabled: boolean; communication_identity: CommunicationIdentity | null }>(
    `${BASE}/users/${userId}/posting`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ disabled, reason: reason ?? null })
    }
  );
}

export function updateCommunicationAccessState(token: string, userId: string, enabled: boolean, reason?: string | null) {
  return apiFetch<{ ok: true; user_id: string; communication_enabled: boolean; communication_identity: CommunicationIdentity | null }>(
    `${BASE}/users/${userId}/access`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ enabled, reason: reason ?? null })
    }
  );
}
