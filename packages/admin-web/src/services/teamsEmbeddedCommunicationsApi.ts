import { apiFetch } from "../api";
import type { TeamsEmbeddedCommunicationHub } from "../teamsEmbeddedCommunicationTypes";

export function getTeamsEmbeddedCommunicationHub(token: string) {
  return apiFetch<TeamsEmbeddedCommunicationHub>("/api/communications/teams/entry-points", token);
}
