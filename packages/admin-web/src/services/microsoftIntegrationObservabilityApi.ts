import { apiFetch } from "../api";
import type { MicrosoftIntegrationEventRecord, MicrosoftIntegrationHealthPayload } from "../microsoftIntegrationTypes";

export async function getMicrosoftIntegrationHealth(token: string) {
  return apiFetch<MicrosoftIntegrationHealthPayload>("/api/integrations/microsoft/health", token);
}

export async function listMicrosoftIntegrationDiagnostics(
  token: string,
  options: {
    area?: string | null;
    level?: string | null;
    limit?: number;
  } = {}
) {
  const params = new URLSearchParams();
  if (options.area) {
    params.set("area", options.area);
  }
  if (options.level) {
    params.set("level", options.level);
  }
  if (typeof options.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  return apiFetch<MicrosoftIntegrationEventRecord[]>(
    `/api/integrations/microsoft/diagnostics${query ? `?${query}` : ""}`,
    token
  );
}
