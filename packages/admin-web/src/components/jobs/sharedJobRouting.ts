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
  if (last === "new" || last === "jobs" || last === "shoots") {
    return null;
  }
  return last;
}
