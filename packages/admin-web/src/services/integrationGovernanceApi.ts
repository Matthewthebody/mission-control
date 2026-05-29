import { apiFetch } from "../api";
import type { IntegrationGovernancePayload } from "../types";

export async function getIntegrationGovernance(token: string) {
  return apiFetch<IntegrationGovernancePayload>("/api/integrations/governance", token);
}
