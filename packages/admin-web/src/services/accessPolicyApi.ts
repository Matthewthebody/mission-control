import { apiFetch } from "../api";
import type {
  AccessPolicyAssignmentInput,
  AccessPolicyDelegationInput,
  AccessPolicyPreview,
  AccessPolicyPreviewInput,
  AccessPolicyOverrideInput,
  AccessPolicyWorkspace,
  AccessPolicyRuleUpdateInput,
  AccessSectionRuleUpdateInput
} from "../accessPolicyTypes";
import type { MicrosoftIdentityReview } from "../types";

const ACCESS_POLICY_BASE = "/api/access/policy";

export async function getAccessPolicyWorkspace(token: string) {
  return apiFetch<AccessPolicyWorkspace>(`${ACCESS_POLICY_BASE}/workspace`, token);
}

export async function createAccessPolicyAssignment(token: string, input: AccessPolicyAssignmentInput) {
  return apiFetch<{ ok: true }>(`${ACCESS_POLICY_BASE}/assignments`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function expireAccessPolicyAssignment(token: string, assignmentId: string, reason?: string | null) {
  return apiFetch<{ ok: true }>(`${ACCESS_POLICY_BASE}/assignments/${assignmentId}/expire`, token, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? null })
  });
}

export async function createAccessPolicyOverride(token: string, input: AccessPolicyOverrideInput) {
  return apiFetch<{ ok: true }>(`${ACCESS_POLICY_BASE}/overrides`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function expireAccessPolicyOverride(token: string, overrideId: string, reason?: string | null) {
  return apiFetch<{ ok: true }>(`${ACCESS_POLICY_BASE}/overrides/${overrideId}/expire`, token, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? null })
  });
}

export async function createAccessPolicyDelegation(token: string, input: AccessPolicyDelegationInput) {
  return apiFetch<{ ok: true }>(`${ACCESS_POLICY_BASE}/delegations`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function revokeAccessPolicyDelegation(token: string, delegationId: string, reason?: string | null) {
  return apiFetch<{ ok: true }>(`${ACCESS_POLICY_BASE}/delegations/${delegationId}/revoke`, token, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? null })
  });
}

export async function updateAccessFieldRule(token: string, ruleId: string, input: AccessPolicyRuleUpdateInput) {
  return apiFetch<{ ok: true }>(`${ACCESS_POLICY_BASE}/field-rules/${ruleId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function updateAccessSectionRule(token: string, ruleId: string, input: AccessSectionRuleUpdateInput) {
  return apiFetch<{ ok: true }>(`${ACCESS_POLICY_BASE}/section-rules/${ruleId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function previewAccessPolicy(token: string, input: AccessPolicyPreviewInput) {
  return apiFetch<AccessPolicyPreview>(`${ACCESS_POLICY_BASE}/preview`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getMicrosoftIdentityReviews(token: string) {
  return apiFetch<MicrosoftIdentityReview[]>("/api/access/microsoft-identities/reviews", token);
}

export async function linkMicrosoftIdentityReviewRecord(
  token: string,
  reviewId: string,
  input: { user_id: string; note?: string }
) {
  return apiFetch<{ ok: true }>(`/api/access/microsoft-identities/reviews/${reviewId}/link`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function rejectMicrosoftIdentityReviewRecord(
  token: string,
  reviewId: string,
  input: { reason: string }
) {
  return apiFetch<{ ok: true }>(`/api/access/microsoft-identities/reviews/${reviewId}/reject`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function suspendMembershipAccess(token: string, membershipId: string) {
  return apiFetch<{ ok: true }>(`/api/access/memberships/${membershipId}/suspend`, token, {
    method: "POST"
  });
}

export async function reactivateMembershipAccess(token: string, membershipId: string) {
  return apiFetch<{ ok: true }>(`/api/access/memberships/${membershipId}/reactivate`, token, {
    method: "POST"
  });
}

export async function revokeMembershipAccess(token: string, membershipId: string) {
  return apiFetch<{ ok: true }>(`/api/access/memberships/${membershipId}/revoke`, token, {
    method: "POST"
  });
}
