import { apiFetch } from "../api";
import type { OperationsControlRoomResponse } from "../types";

export async function getOperationsControlRoom(token: string, input?: { date?: string | null }) {
  const params = new URLSearchParams();
  if (input?.date) {
    params.set("date", input.date);
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  return apiFetch<OperationsControlRoomResponse>(`/api/dashboard/operations/control-room${suffix}`, token);
}
