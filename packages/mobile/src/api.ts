import { NativeModules, Platform } from "react-native";

type ProcessLike = {
  env?: Record<string, string | undefined>;
};

function normalizeApiUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function getEnvApiUrl() {
  const processLike = (globalThis as { process?: ProcessLike }).process;
  const value = processLike?.env?.EXPO_PUBLIC_API_URL?.trim();
  return value ? normalizeApiUrl(value) : null;
}

function getMetroDerivedApiUrl() {
  const scriptUrl = (NativeModules.SourceCode as { scriptURL?: string } | undefined)?.scriptURL;
  if (!scriptUrl) {
    return null;
  }

  try {
    const metroUrl = new URL(scriptUrl);
    const protocol = metroUrl.protocol === "https:" ? "https:" : "http:";
    return normalizeApiUrl(`${protocol}//${metroUrl.hostname}:4000`);
  } catch {
    return null;
  }
}

function getFallbackApiUrl() {
  if (Platform.OS === "android") {
    // Android emulators cannot reach the host machine on localhost.
    return "http://10.0.2.2:4000";
  }

  return "http://localhost:4000";
}

const API_URL = getEnvApiUrl() ?? getMetroDerivedApiUrl() ?? getFallbackApiUrl();

export async function mobileFetch<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}
