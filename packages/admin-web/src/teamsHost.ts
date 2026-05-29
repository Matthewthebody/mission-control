const TEAMS_SURFACE_STORAGE_KEY = "pmc_surface_preference";

function readSearchParams() {
  if (typeof window === "undefined") {
    return new URLSearchParams();
  }
  return new URLSearchParams(window.location.search);
}

export function isTeamsRouteHash(hash: string) {
  return /^#teams(?:\/|$)/i.test(hash.trim());
}

export function isEmbeddedBrowserContext() {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function hasTeamsReferrer() {
  if (typeof document === "undefined") {
    return false;
  }
  return /teams\.microsoft\.com|teams\.live\.com/i.test(document.referrer);
}

function readStoredSurfacePreference() {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return window.sessionStorage.getItem(TEAMS_SURFACE_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function detectTeamsMode() {
  if (typeof window === "undefined") {
    return false;
  }
  const params = readSearchParams();
  const explicitSurface = params.get("surface");
  if (params.get("teams") === "1" || explicitSurface === "teams" || explicitSurface === "teams_personal_tab") {
    return true;
  }
  if (isTeamsRouteHash(window.location.hash)) {
    return true;
  }
  if (readStoredSurfacePreference() === "teams") {
    return true;
  }
  return isEmbeddedBrowserContext() && hasTeamsReferrer();
}

export function rememberTeamsMode(enabled: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (enabled) {
      window.sessionStorage.setItem(TEAMS_SURFACE_STORAGE_KEY, "teams");
      return;
    }
    window.sessionStorage.removeItem(TEAMS_SURFACE_STORAGE_KEY);
  } catch {
    // Session storage is a convenience only.
  }
}

export function getApiSurfaceHeader() {
  return detectTeamsMode() ? "teams_personal_tab" : "admin-web";
}

export function buildStandaloneAppUrl(hash = typeof window !== "undefined" ? window.location.hash : "#home") {
  if (typeof window === "undefined") {
    return hash;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("teams");
  url.searchParams.delete("surface");
  url.hash = hash.startsWith("#") ? hash : `#${hash}`;
  return url.toString();
}
