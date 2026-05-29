import { apiFetch } from "../api";
import type {
  EvaluationSubmitInput,
  LocationCatalogResponse,
  LocationPhotographerPerformanceRow,
  LocationTopRatedRow,
  ShootLocationDetail,
  ShootLocationIntelligence,
  SetupPhotoUploadInput
} from "../types";

const LOCATION_CACHE_KEY = "pmc-shoot-locations-cache-v1";
const LOCATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CachedLocationEnvelope = {
  stored_at: string;
  payload: LocationCatalogResponse;
};

export type CachedLocationCatalog = {
  payload: LocationCatalogResponse;
  isExpired: boolean;
};

export function readCachedLocationCatalog(): CachedLocationCatalog | null {
  try {
    const raw = window.localStorage.getItem(LOCATION_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as CachedLocationEnvelope;
    if (!parsed?.payload?.locations || !parsed?.stored_at) {
      return null;
    }
    const storedAt = new Date(parsed.stored_at).getTime();
    return {
      payload: parsed.payload,
      isExpired: !Number.isFinite(storedAt) || Date.now() - storedAt > LOCATION_CACHE_TTL_MS
    };
  } catch {
    return null;
  }
}

export function writeCachedLocationCatalog(payload: LocationCatalogResponse) {
  const envelope: CachedLocationEnvelope = {
    stored_at: new Date().toISOString(),
    payload
  };
  window.localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(envelope));
}

export async function fetchShootLocations(token: string) {
  const payload = await apiFetch<LocationCatalogResponse>("/api/locations", token);
  writeCachedLocationCatalog(payload);
  return payload;
}

export async function getShootLocationDetail(token: string, locationId: string) {
  return apiFetch<ShootLocationDetail>(`/api/locations/${encodeURIComponent(locationId)}`, token);
}

export async function getTopRatedShootLocations(token: string) {
  return apiFetch<LocationTopRatedRow[]>("/api/locations/top-rated", token);
}

export async function getLocationPhotographerPerformance(token: string) {
  return apiFetch<LocationPhotographerPerformanceRow[]>("/api/locations/photographers", token);
}

export async function getShootLocationIntelligence(
  token: string,
  input: {
    shootId?: string | null;
    outlookEventId?: string | null;
    outlookCalendarId?: string | null;
    shootCode?: string | null;
    eventSubject?: string | null;
    eventLocation?: string | null;
    shootLocationName?: string | null;
    shootLocationAddress?: string | null;
  }
) {
  const params = new URLSearchParams();
  if (input.shootId) {
    params.set("shoot_id", input.shootId);
  }
  if (input.outlookEventId) {
    params.set("outlook_event_id", input.outlookEventId);
  }
  if (input.outlookCalendarId) {
    params.set("outlook_calendar_id", input.outlookCalendarId);
  }
  if (input.shootCode) {
    params.set("shoot_code", input.shootCode);
  }
  if (input.eventSubject) {
    params.set("event_subject", input.eventSubject);
  }
  if (input.eventLocation) {
    params.set("event_location", input.eventLocation);
  }
  if (input.shootLocationName) {
    params.set("shoot_location_name", input.shootLocationName);
  }
  if (input.shootLocationAddress) {
    params.set("shoot_location_address", input.shootLocationAddress);
  }
  return apiFetch<ShootLocationIntelligence>(`/api/locations/intelligence?${params.toString()}`, token);
}

export async function linkShootLocation(
  token: string,
  input: {
    location_id: string;
    shoot_id?: string | null;
    outlook_event_id?: string | null;
    outlook_calendar_id?: string | null;
    shoot_code?: string | null;
    event_subject?: string | null;
    event_location?: string | null;
    confidence?: number | null;
  }
) {
  return apiFetch<ShootLocationIntelligence>("/api/locations/links", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function submitShootLocationEvaluation(token: string, input: EvaluationSubmitInput) {
  return apiFetch<ShootLocationDetail>(`/api/locations/${encodeURIComponent(input.location_id)}/evaluations`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function uploadShootLocationPhoto(token: string, input: SetupPhotoUploadInput) {
  return apiFetch<ShootLocationDetail>(`/api/locations/${encodeURIComponent(input.location_id)}/setup-photos`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function reviewShootLocationEvaluation(
  token: string,
  evaluationId: string,
  input: {
    eval_status: "reviewed" | "closed";
    note?: string | null;
  }
) {
  return apiFetch<ShootLocationDetail>(`/api/locations/evaluations/${encodeURIComponent(evaluationId)}/review`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function reviewShootLocationPhoto(
  token: string,
  photoId: string,
  input: {
    memory_state: "reviewed" | "added_to_memory";
    note?: string | null;
  }
) {
  return apiFetch<ShootLocationDetail>(`/api/locations/setup-photos/${encodeURIComponent(photoId)}/review`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function overrideLocationAlert(token: string, alertId: string, reason: string) {
  return apiFetch(`/api/locations/alerts/${encodeURIComponent(alertId)}/override`, token, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

export function buildLocationHash(
  locationId: string,
  context: {
    view?: "guide" | "top-rated" | "photographers";
    shootId?: string | null;
    outlookEventId?: string | null;
    outlookCalendarId?: string | null;
    shootCode?: string | null;
    shootName?: string | null;
    shootDate?: string | null;
    eventSubject?: string | null;
    eventLocation?: string | null;
  } = {}
) {
  const params = new URLSearchParams();
  params.set("location", locationId);
  if (context.view && context.view !== "guide") {
    params.set("view", context.view);
  }
  if (context.shootId) {
    params.set("shoot", context.shootId);
  }
  if (context.outlookEventId) {
    params.set("event", context.outlookEventId);
  }
  if (context.outlookCalendarId) {
    params.set("calendar", context.outlookCalendarId);
  }
  if (context.shootCode) {
    params.set("shootCode", context.shootCode);
  }
  if (context.shootName) {
    params.set("shootName", context.shootName);
  }
  if (context.shootDate) {
    params.set("shootDate", context.shootDate);
  }
  if (context.eventSubject) {
    params.set("subject", context.eventSubject);
  }
  if (context.eventLocation) {
    params.set("eventLocation", context.eventLocation);
  }
  return `#locations?${params.toString()}`;
}

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("We couldn't read that photo for upload."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}
