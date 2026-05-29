import { apiFetch } from "../api";
import type {
  SportsAccountDetailResponse,
  SportsAccountSummary,
  SportsContactsResponse,
  SportsFinancialSummaryInput,
  SportsOverviewResponse,
  SportsProductionResponse,
  SportsProofCycleInput,
  SportsProductItemInput,
  SportsReadinessUpdateInput,
  SportsReportsResponse,
  SportsSettingsResponse,
  SportsShootDetailResponse,
  SportsShootListFilters,
  SportsShootListResponse,
  SportsTeamUnitInput,
  SportsWatchFlagInput,
  SportsWatchlistResponse
} from "../sportsTypes";

export async function getSportsOverview(token: string, savedView?: string | null) {
  const params = new URLSearchParams();
  if (savedView) {
    params.set("saved_view", savedView);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<SportsOverviewResponse>(`/api/sports${suffix}`, token);
}

export async function listSportsShoots(token: string, filters: SportsShootListFilters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    params.set(key, typeof value === "boolean" ? String(value) : String(value));
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<SportsShootListResponse>(`/api/sports/shoots${suffix}`, token);
}

export async function getSportsShootDetail(token: string, shootId: string) {
  return apiFetch<SportsShootDetailResponse>(`/api/sports/shoots/${shootId}`, token);
}

export async function updateSportsReadinessItemRecord(
  token: string,
  shootId: string,
  itemId: string,
  input: SportsReadinessUpdateInput
) {
  return apiFetch<SportsShootDetailResponse>(`/api/sports/shoots/${shootId}/readiness/${itemId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function createSportsTeamUnitRecord(token: string, shootId: string, input: SportsTeamUnitInput) {
  return apiFetch<SportsShootDetailResponse>(`/api/sports/shoots/${shootId}/teams`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateSportsTeamUnitRecord(token: string, shootId: string, teamUnitId: string, input: SportsTeamUnitInput) {
  return apiFetch<SportsShootDetailResponse>(`/api/sports/shoots/${shootId}/teams/${teamUnitId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function deleteSportsTeamUnitRecord(token: string, shootId: string, teamUnitId: string) {
  return apiFetch<SportsShootDetailResponse>(`/api/sports/shoots/${shootId}/teams/${teamUnitId}`, token, {
    method: "DELETE"
  });
}

export async function createSportsWatchFlagRecord(token: string, shootId: string, input: SportsWatchFlagInput) {
  return apiFetch<SportsShootDetailResponse>(`/api/sports/shoots/${shootId}/watch-flags`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateSportsWatchFlagRecord(token: string, shootId: string, flagId: string, input: SportsWatchFlagInput) {
  return apiFetch<SportsShootDetailResponse>(`/api/sports/shoots/${shootId}/watch-flags/${flagId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function createSportsProofCycleRecord(token: string, shootId: string, input: SportsProofCycleInput) {
  return apiFetch<SportsShootDetailResponse>(`/api/sports/shoots/${shootId}/proof-cycles`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateSportsProofCycleRecord(token: string, shootId: string, proofCycleId: string, input: SportsProofCycleInput) {
  return apiFetch<SportsShootDetailResponse>(`/api/sports/shoots/${shootId}/proof-cycles/${proofCycleId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function createSportsProductItemRecord(token: string, shootId: string, input: SportsProductItemInput) {
  return apiFetch<SportsShootDetailResponse>(`/api/sports/shoots/${shootId}/products`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateSportsProductItemRecord(token: string, shootId: string, productItemId: string, input: SportsProductItemInput) {
  return apiFetch<SportsShootDetailResponse>(`/api/sports/shoots/${shootId}/products/${productItemId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function updateSportsFinancialSummaryRecord(token: string, shootId: string, input: SportsFinancialSummaryInput) {
  return apiFetch<SportsShootDetailResponse>(`/api/sports/shoots/${shootId}/financial-summary`, token, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function listSportsAccounts(token: string) {
  return apiFetch<{ items: SportsAccountSummary[] }>(`/api/sports/accounts`, token);
}

export async function getSportsAccountDetail(token: string, organizationId: string) {
  return apiFetch<SportsAccountDetailResponse>(`/api/sports/accounts/${organizationId}`, token);
}

export async function listSportsContacts(token: string) {
  return apiFetch<SportsContactsResponse>("/api/sports/contacts", token);
}

export async function listSportsProduction(token: string) {
  return apiFetch<SportsProductionResponse>("/api/sports/production", token);
}

export async function listSportsWatchlist(token: string) {
  return apiFetch<SportsWatchlistResponse>("/api/sports/watchlist", token);
}

export async function getSportsReports(token: string) {
  return apiFetch<SportsReportsResponse>("/api/sports/reports", token);
}

export async function getSportsSettings(token: string) {
  return apiFetch<SportsSettingsResponse>("/api/sports/settings", token);
}
