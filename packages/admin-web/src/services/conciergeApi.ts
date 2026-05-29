import { apiFetch } from "../api";
import type {
  ConciergeRecentSearchResponse,
  ConciergeResultLookupResponse,
  ConciergeSavedSearchResponse,
  ConciergeSavedSearchUpdateInput,
  ConciergeSavedSearchUpsertInput,
  ConciergeSearchInput,
  ConciergeSearchResponse,
  ConciergeSuggestionResponse
} from "../conciergeTypes";

const CONCIERGE_BASE = "/api/concierge";

function buildQueryString(input: Record<string, string | number | boolean | string[] | null | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (Array.isArray(value)) {
      if (!value.length) {
        continue;
      }
      params.set(key, value.join(","));
      continue;
    }
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function searchConcierge(token: string, input: ConciergeSearchInput) {
  return apiFetch<ConciergeSearchResponse>(
    `${CONCIERGE_BASE}/search${buildQueryString({
      q: input.q,
      limit: input.limit,
      department: input.department,
      type: input.entity_types,
      status: input.status,
      owner: input.owner,
      assignee: input.assignee,
      org: input.org,
      date: input.date,
      risk: input.risk,
      has: input.has_any
    })}`,
    token
  );
}

export async function getConciergeSuggestions(token: string, input: ConciergeSearchInput) {
  return apiFetch<ConciergeSuggestionResponse>(
    `${CONCIERGE_BASE}/suggestions${buildQueryString({
      q: input.q,
      limit: input.limit,
      department: input.department,
      type: input.entity_types,
      status: input.status,
      owner: input.owner,
      assignee: input.assignee,
      org: input.org,
      date: input.date,
      risk: input.risk,
      has: input.has_any
    })}`,
    token
  );
}

export async function getConciergeRecentSearches(token: string) {
  return apiFetch<ConciergeRecentSearchResponse>(`${CONCIERGE_BASE}/recent`, token);
}

export async function recordConciergeRecentSearch(
  token: string,
  input: { query: string; selected_search_index_id?: string | null }
) {
  await apiFetch<void>(`${CONCIERGE_BASE}/recent`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getConciergeSavedSearches(token: string) {
  return apiFetch<ConciergeSavedSearchResponse>(`${CONCIERGE_BASE}/saved`, token);
}

export async function createConciergeSavedSearch(token: string, input: ConciergeSavedSearchUpsertInput) {
  return apiFetch<ConciergeSavedSearchResponse>(`${CONCIERGE_BASE}/saved`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateConciergeSavedSearch(token: string, savedSearchId: string, input: ConciergeSavedSearchUpdateInput) {
  return apiFetch<ConciergeSavedSearchResponse>(`${CONCIERGE_BASE}/saved/${encodeURIComponent(savedSearchId)}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function deleteConciergeSavedSearch(token: string, savedSearchId: string) {
  return apiFetch<ConciergeSavedSearchResponse>(`${CONCIERGE_BASE}/saved/${encodeURIComponent(savedSearchId)}`, token, {
    method: "DELETE"
  });
}

export async function lookupConciergeResult(token: string, searchIndexId: string) {
  return apiFetch<ConciergeResultLookupResponse>(`${CONCIERGE_BASE}/result/${encodeURIComponent(searchIndexId)}`, token);
}
