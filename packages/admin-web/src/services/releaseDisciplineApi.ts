import { apiFetch } from "../api";
import type { HealthStatusPayload } from "../releaseDisciplineTypes";

export async function getReleaseDisciplineHealth(token?: string) {
  return apiFetch<HealthStatusPayload>(`/health?ts=${Date.now()}`, token, { cache: "no-store" });
}
