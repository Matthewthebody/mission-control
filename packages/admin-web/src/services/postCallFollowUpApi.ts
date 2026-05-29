import { apiFetch } from "../api";
import type { CreatePostCallOutcomeInput, CreatePostCallOutcomeResponse, PostCallFollowUpView } from "../postCallFollowUpTypes";
import type { TeamsMeetingLinkedObjectType } from "../teamsMeetingTypes";

const BASE = "/api/communications";

export function getPostCallFollowUpView(token: string, objectType: TeamsMeetingLinkedObjectType, objectId: string) {
  return apiFetch<PostCallFollowUpView>(`${BASE}/records/${objectType}/${objectId}/post-call`, token);
}

export function createPostCallOutcome(
  token: string,
  objectType: TeamsMeetingLinkedObjectType,
  objectId: string,
  input: CreatePostCallOutcomeInput
) {
  return apiFetch<CreatePostCallOutcomeResponse>(`${BASE}/records/${objectType}/${objectId}/post-call`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}
