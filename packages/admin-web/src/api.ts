import { getApiSurfaceHeader } from "./teamsHost";

export class ApiClientError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.details = details;
  }
}

const API_URL = resolveApiUrl();

export async function apiFetch<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("X-PMC-Surface", getApiSurfaceHeader());
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const method = (init?.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrfToken = readCookie("pmc_csrf");
    if (csrfToken && !headers.has("X-PMC-CSRF")) {
      headers.set("X-PMC-CSRF", csrfToken);
    }
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      headers
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network request failed";
    throw new ApiClientError(0, message);
  }

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const errorBody = (await response.json()) as { error?: string; message?: string; details?: unknown };
      throw new ApiClientError(response.status, errorBody.error ?? errorBody.message ?? `Request failed with ${response.status}`, errorBody.details);
    }
    throw new ApiClientError(response.status, await response.text());
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const apiUrl = API_URL;

function resolveApiUrl() {
  const configured = import.meta.env.VITE_API_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  if (typeof window === "undefined" || !window.location) {
    return "http://localhost:4000";
  }
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:4000`;
}

function readCookie(name: string) {
  if (typeof document === "undefined") {
    return "";
  }
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("=");
      return separator > 0 ? [entry.slice(0, separator), decodeURIComponent(entry.slice(separator + 1))] : null;
    })
    .find((entry) => entry?.[0] === name)?.[1] ?? "";
}
