import { apiFetch } from "../api";
import type {
  ZendeskLeadershipSummary,
  ZendeskLeadershipTicketList,
  ZendeskLeadershipTrends,
  ZendeskStatusPayload,
  ZendeskTestPayload
} from "../types";

export async function getZendeskStatus(token: string) {
  return apiFetch<ZendeskStatusPayload>("/api/integrations/zendesk/status", token);
}

export async function testZendeskConnection(token: string) {
  return apiFetch<ZendeskTestPayload>("/api/integrations/zendesk/test", token, {
    method: "POST"
  });
}

export async function syncZendesk(token: string) {
  return apiFetch<{ connection: ZendeskStatusPayload["connection"]; sync_run: ZendeskStatusPayload["sync_runs"][number] }>(
    "/api/zendesk/sync",
    token,
    { method: "POST" }
  );
}

export async function getZendeskLeadershipSummary(token: string) {
  return apiFetch<ZendeskLeadershipSummary>("/api/zendesk/leadership-summary", token);
}

export async function getZendeskLeadershipTrends(
  token: string,
  range: ZendeskLeadershipTrends["range"]
) {
  return apiFetch<ZendeskLeadershipTrends>(`/api/zendesk/leadership-trends?range=${range}`, token);
}

export async function getZendeskLeadershipTicketList(
  token: string,
  options: { status?: "open" | "all"; limit?: number } = {}
) {
  const params = new URLSearchParams();
  params.set("status", options.status ?? "open");
  if (options.limit) {
    params.set("limit", String(options.limit));
  }
  return apiFetch<ZendeskLeadershipTicketList>(`/api/zendesk/leadership-ticket-list?${params.toString()}`, token);
}
