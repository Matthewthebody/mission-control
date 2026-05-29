import { apiFetch } from "../api";
import type { OperatingSystemAccessProfile } from "../operatingSystem";

export function fetchOperatingSystemAccessProfile(token: string) {
  return apiFetch<OperatingSystemAccessProfile>("/api/access/operating-system", token);
}
