export function normalizeRouteBase(routeBase: string) {
  return routeBase.startsWith("#") ? routeBase : `#${routeBase}`;
}

export function buildSharedJobHash(routeBase: string, suffix = "", query: Record<string, string | null | undefined> = {}) {
  const normalizedBase = normalizeRouteBase(routeBase).replace(/\/$/, "");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (!value) {
      continue;
    }
    params.set(key, value);
  }
  const queryString = params.toString();
  const nextHash = `${normalizedBase}${suffix ? `/${suffix.replace(/^\//, "")}` : ""}`;
  return queryString ? `${nextHash}?${queryString}` : nextHash;
}

export function navigateToSharedJobHash(routeBase: string, suffix = "", query: Record<string, string | null | undefined> = {}) {
  window.location.hash = buildSharedJobHash(routeBase, suffix, query);
}

export function parseSharedJobIdFromPath(path: string) {
  const segments = path.split("/").filter(Boolean);
  if (!segments.length) {
    return null;
  }
  const last = segments[segments.length - 1];
  if (last === "edit") {
    return segments[segments.length - 2] ?? null;
  }
  // "detail" is the registered canonical-hash segment (#jobs/detail, #schools/jobs/detail, ...), never
  // a job id — treating it as one produced GET /api/jobs/detail -> 500. The id arrives via query params
  // on those hashes (see parseSharedJobIdFromParams).
  if (last === "new" || last === "jobs" || last === "shoots" || last === "detail") {
    return null;
  }
  return last;
}

// Companion for the canonical "#…/jobs/detail" hashes, where the record id travels in the query
// string (?job= from deep-links, ?preview= from the production workflow queue) instead of the path.
export function parseSharedJobIdFromParams(params: URLSearchParams) {
  return params.get("job") ?? params.get("preview");
}
