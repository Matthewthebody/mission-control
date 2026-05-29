import { apiFetch } from "../api";
import type {
  OperationalAlertAdminPayload,
  OperationalAlertDeliveryRecord,
  OperationalAlertDeliveryStatus,
  OperationalAlertRouteRecord,
  OperationalAlertRouteWriteInput
} from "../operationalAlertsTypes";

export async function getTeamsOperationalAlerts(token: string) {
  return apiFetch<OperationalAlertAdminPayload>("/api/integrations/teams/operational-alerts", token);
}

export async function listTeamsOperationalAlertDeliveries(
  token: string,
  options: {
    status?: OperationalAlertDeliveryStatus | null;
    limit?: number;
  } = {}
) {
  const params = new URLSearchParams();
  if (options.status) {
    params.set("status", options.status);
  }
  if (typeof options.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  return apiFetch<OperationalAlertDeliveryRecord[]>(
    `/api/integrations/teams/operational-alerts/deliveries${query ? `?${query}` : ""}`,
    token
  );
}

export async function createTeamsOperationalAlertRoute(token: string, input: OperationalAlertRouteWriteInput) {
  return apiFetch<OperationalAlertRouteRecord>("/api/integrations/teams/operational-alerts/routes", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateTeamsOperationalAlertRoute(
  token: string,
  routeId: string,
  input: Partial<OperationalAlertRouteWriteInput>
) {
  return apiFetch<OperationalAlertRouteRecord>(`/api/integrations/teams/operational-alerts/routes/${encodeURIComponent(routeId)}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}
