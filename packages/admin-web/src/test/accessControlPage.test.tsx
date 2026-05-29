// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessPolicyPreview, AccessPolicyWorkspace } from "../accessPolicyTypes";
import { ApiClientError } from "../api";
import { AccessControl } from "../pages/AccessControl";
import type { MicrosoftIdentityReview, SessionUser } from "../types";

const getAccessPolicyWorkspaceMock = vi.fn();
const createAccessPolicyAssignmentMock = vi.fn();
const expireAccessPolicyAssignmentMock = vi.fn();
const createAccessPolicyOverrideMock = vi.fn();
const expireAccessPolicyOverrideMock = vi.fn();
const createAccessPolicyDelegationMock = vi.fn();
const revokeAccessPolicyDelegationMock = vi.fn();
const updateAccessFieldRuleMock = vi.fn();
const updateAccessSectionRuleMock = vi.fn();
const previewAccessPolicyMock = vi.fn();
const getMicrosoftIdentityReviewsMock = vi.fn();
const linkMicrosoftIdentityReviewRecordMock = vi.fn();
const rejectMicrosoftIdentityReviewRecordMock = vi.fn();

vi.mock("../services/accessPolicyApi", () => ({
  getAccessPolicyWorkspace: (...args: unknown[]) => getAccessPolicyWorkspaceMock(...args),
  createAccessPolicyAssignment: (...args: unknown[]) => createAccessPolicyAssignmentMock(...args),
  expireAccessPolicyAssignment: (...args: unknown[]) => expireAccessPolicyAssignmentMock(...args),
  createAccessPolicyOverride: (...args: unknown[]) => createAccessPolicyOverrideMock(...args),
  expireAccessPolicyOverride: (...args: unknown[]) => expireAccessPolicyOverrideMock(...args),
  createAccessPolicyDelegation: (...args: unknown[]) => createAccessPolicyDelegationMock(...args),
  revokeAccessPolicyDelegation: (...args: unknown[]) => revokeAccessPolicyDelegationMock(...args),
  updateAccessFieldRule: (...args: unknown[]) => updateAccessFieldRuleMock(...args),
  updateAccessSectionRule: (...args: unknown[]) => updateAccessSectionRuleMock(...args),
  previewAccessPolicy: (...args: unknown[]) => previewAccessPolicyMock(...args),
  getMicrosoftIdentityReviews: (...args: unknown[]) => getMicrosoftIdentityReviewsMock(...args),
  linkMicrosoftIdentityReviewRecord: (...args: unknown[]) => linkMicrosoftIdentityReviewRecordMock(...args),
  rejectMicrosoftIdentityReviewRecord: (...args: unknown[]) => rejectMicrosoftIdentityReviewRecordMock(...args)
}));

const sessionTrust = {
  identityProvider: "local_password" as const,
  sessionAssurance: "standard" as const,
  requestTransport: "bearer" as const,
  elevatedUntil: null,
  privilegedModeUntil: null,
  breakGlassStartedAt: null,
  breakGlassUntil: null,
  breakGlassReason: null,
  breakGlassScopeType: null,
  breakGlassScopeId: null,
  elevatedSessionActive: false,
  privilegedModeActive: false,
  breakGlassModeActive: false
};

const adminUser: SessionUser = {
  id: "user-admin",
  tenantId: "tenant-demo",
  accountId: "account-admin",
  sessionId: "session-admin",
  email: "admin@example.com",
  fullName: "Admin User",
  status: "active",
  department: "operations",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["admin"],
  permissions: [
    "settings.permissions.read",
    "settings.roles.manage",
    "settings.permissions.manage",
    "settings.delegations.manage",
    "settings.field_policies.manage",
    "user.approve",
    "access_preview.use",
    "auditlog.read"
  ],
  authorityTier: "super_admin",
  primaryJobFunctionProfile: "leadership_team_member",
  jobFunctionProfiles: ["leadership_team_member"],
  permissionGrants: [],
  policyRoles: [],
  policyGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust
};

const observerUser: SessionUser = {
  ...adminUser,
  id: "user-observer",
  email: "observer@example.com",
  fullName: "Observer",
  roles: ["department_observer"],
  permissions: ["dashboard.read"],
  authorityTier: "standard_employee",
  effectiveScopes: ["department_scope"]
};

const workspace: AccessPolicyWorkspace = {
  summary: {
    role_count: 2,
    assignment_count: 1,
    delegation_count: 1,
    override_count: 1,
    audit_event_count: 1
  },
  roles: [
    {
      id: "role-admin",
      code: "admin",
      name: "Admin",
      description: "Full system access",
      department_type: null,
      is_system_role: true,
      is_assignable: true,
      created_at: "2026-04-02T10:00:00.000Z",
      updated_at: "2026-04-02T10:00:00.000Z"
    },
    {
      id: "role-sports-manager",
      code: "sports_manager",
      name: "Sports Manager",
      description: "Sports-scoped operational management",
      department_type: "sports",
      is_system_role: true,
      is_assignable: true,
      created_at: "2026-04-02T10:00:00.000Z",
      updated_at: "2026-04-02T10:00:00.000Z"
    }
  ],
  permissions: [
    {
      id: "perm-job-read",
      code: "job.read",
      name: "Read jobs",
      description: "Read shared jobs",
      resource_type: "shared_job",
      action_group: "jobs",
      created_at: "2026-04-02T10:00:00.000Z",
      updated_at: "2026-04-02T10:00:00.000Z"
    },
    {
      id: "perm-settings-read",
      code: "settings.permissions.read",
      name: "Read access settings",
      description: "Read access settings workspace",
      resource_type: "settings",
      action_group: "settings",
      created_at: "2026-04-02T10:00:00.000Z",
      updated_at: "2026-04-02T10:00:00.000Z"
    }
  ],
  role_grants: [
    {
      id: "grant-1",
      role_id: "role-admin",
      permission_id: "perm-settings-read",
      permission_code: "settings.permissions.read",
      scope_type: "global",
      scope_value: null,
      effect: "allow",
      created_at: "2026-04-02T10:00:00.000Z",
      updated_at: "2026-04-02T10:00:00.000Z"
    }
  ],
  users: [
    {
      user_id: "user-admin",
      full_name: "Admin User",
      email: "admin@example.com",
      department: "operations",
      membership_status: "active",
      authority_tier: "super_admin",
      primary_job_function_profile: "leadership_team_member",
      active_role_codes: ["admin"],
      microsoft_user_id: "ms-admin",
      microsoft_tenant_id: "tenant-demo",
      auth_provider: "microsoft_entra",
      communication_enabled: true,
      communication_posting_disabled_at: null,
      communication_posting_disabled_reason: null,
      teams_chat_default_target: null,
      linked_at: "2026-04-01T08:00:00.000Z",
      last_verified_at: "2026-04-02T08:00:00.000Z",
      communication_identity_status: "linked_ready"
    },
    {
      user_id: "user-sports",
      full_name: "Sports Manager",
      email: "sports@example.com",
      department: "sports",
      membership_status: "active",
      authority_tier: "supervisor",
      primary_job_function_profile: "sports_client_success",
      active_role_codes: ["sports_manager"],
      microsoft_user_id: "ms-sports",
      microsoft_tenant_id: null,
      auth_provider: "microsoft_entra",
      communication_enabled: false,
      communication_posting_disabled_at: null,
      communication_posting_disabled_reason: null,
      teams_chat_default_target: null,
      linked_at: "2026-04-01T09:00:00.000Z",
      last_verified_at: null,
      communication_identity_status: "incomplete"
    }
  ],
  assignments: [
    {
      id: "assignment-1",
      tenant_id: "tenant-demo",
      user_id: "user-sports",
      user_name: "Sports Manager",
      user_email: "sports@example.com",
      role_id: "role-sports-manager",
      role_code: "sports_manager",
      role_name: "Sports Manager",
      scope_type: "department",
      scope_value: "sports",
      starts_at: null,
      ends_at: null,
      assigned_by_user_id: "user-admin",
      assigned_by_name: "Admin User",
      reason: "Default assignment",
      created_at: "2026-04-02T10:00:00.000Z",
      updated_at: "2026-04-02T10:00:00.000Z"
    }
  ],
  delegations: [
    {
      id: "delegation-1",
      tenant_id: "tenant-demo",
      from_user_id: "user-admin",
      from_user_name: "Admin User",
      to_user_id: "user-sports",
      to_user_name: "Sports Manager",
      role_id: "role-sports-manager",
      role_code: "sports_manager",
      role_name: "Sports Manager",
      permission_bundle_key: null,
      scope_type: "department",
      scope_value: "sports",
      starts_at: "2026-04-02T10:00:00.000Z",
      ends_at: "2026-04-03T10:00:00.000Z",
      status: "active",
      reason: "PTO coverage",
      approved_by_user_id: "user-admin",
      approved_by_name: "Admin User",
      created_at: "2026-04-02T10:00:00.000Z",
      updated_at: "2026-04-02T10:00:00.000Z"
    }
  ],
  overrides: [
    {
      id: "override-1",
      tenant_id: "tenant-demo",
      user_id: "user-sports",
      user_name: "Sports Manager",
      user_email: "sports@example.com",
      permission_id: "perm-job-read",
      permission_code: "job.read",
      scope_type: "department",
      scope_value: "sports",
      effect: "allow",
      starts_at: null,
      ends_at: null,
      reason: "Coverage override",
      approved_by_user_id: "user-admin",
      approved_by_name: "Admin User",
      created_at: "2026-04-02T10:00:00.000Z",
      updated_at: "2026-04-02T10:00:00.000Z"
    }
  ],
  field_rules: [
    {
      id: "field-rule-1",
      resource_type: "shared_job",
      field_key: "shared_job.sports_profile.revenue_share_terms_summary",
      sensitivity_category: "financial_restricted",
      required_permission_code: "finance.view_summary",
      default_visibility: "masked",
      masking_strategy: "money_summary_only",
      department_type: "sports",
      created_at: "2026-04-02T10:00:00.000Z",
      updated_at: "2026-04-02T10:00:00.000Z"
    }
  ],
  section_rules: [
    {
      id: "section-rule-1",
      resource_type: "shared_job",
      section_key: "financial",
      required_permission_code: "finance.view_summary",
      sensitivity_category: "financial_restricted",
      default_visibility: "hidden",
      department_type: "sports",
      created_at: "2026-04-02T10:00:00.000Z",
      updated_at: "2026-04-02T10:00:00.000Z"
    }
  ],
  audit_events: [
    {
      id: "audit-1",
      tenant_id: "tenant-demo",
      actor_user_id: "user-admin",
      actor_name: "Admin User",
      target_user_id: "user-sports",
      target_name: "Sports Manager",
      policy_event_type: "role_assignment_created",
      resource_type: "user_role_assignment",
      resource_id: "assignment-1",
      permission_code: "settings.roles.manage",
      result: "allowed",
      details_json: null,
      created_at: "2026-04-02T10:05:00.000Z"
    }
  ]
};

const previewResult: AccessPolicyPreview = {
  user_id: "user-sports",
  route_id: "dashboard",
  resource_type: "shared_job",
  resource_id: "job-1",
  allowed: true,
  permissions: ["job.read", "job.update"],
  fields: {
    "shared_job.sports_profile.revenue_share_terms_summary": "masked"
  },
  sections: {
    financial: "hidden"
  },
  actions: {
    update: true,
    publish: false
  },
  explanation: ["Allowed by sports department role assignment."],
  trace_id: "trace-preview-1"
};

const microsoftReviews: MicrosoftIdentityReview[] = [
  {
    id: "review-1",
    tenant_id: "tenant-demo",
    tenant_name: "Demo Studio",
    email: "pending@example.com",
    full_name: "Pending Employee",
    microsoft_user_id: "ms-pending",
    microsoft_tenant_id: "tenant-demo",
    auth_provider: "microsoft_entra",
    review_status: "pending_review",
    reason_code: "unmatched_email",
    matched_user_id: null,
    matched_account_id: null,
    matched_user_email: null,
    matched_user_name: null,
    matched_user_status: null,
    matched_user_department: null,
    matched_user_authority_tier: null,
    matched_user_primary_job_function_profile: null,
    matched_user_job_function_profiles: [],
    matched_user_internal_role_groups: [],
    reviewed_by_user_id: null,
    reviewed_by_name: null,
    reviewed_at: null,
    linked_at: null,
    last_login_at: "2026-04-02T11:00:00.000Z",
    notes: null,
    metadata: {},
    created_at: "2026-04-02T10:55:00.000Z",
    updated_at: "2026-04-02T11:00:00.000Z"
  }
];

describe("AccessControl", () => {
  beforeEach(() => {
    getAccessPolicyWorkspaceMock.mockReset();
    createAccessPolicyAssignmentMock.mockReset();
    expireAccessPolicyAssignmentMock.mockReset();
    createAccessPolicyOverrideMock.mockReset();
    expireAccessPolicyOverrideMock.mockReset();
    createAccessPolicyDelegationMock.mockReset();
    revokeAccessPolicyDelegationMock.mockReset();
    updateAccessFieldRuleMock.mockReset();
    updateAccessSectionRuleMock.mockReset();
    previewAccessPolicyMock.mockReset();
    getMicrosoftIdentityReviewsMock.mockReset();
    linkMicrosoftIdentityReviewRecordMock.mockReset();
    rejectMicrosoftIdentityReviewRecordMock.mockReset();

    getAccessPolicyWorkspaceMock.mockResolvedValue(workspace);
    createAccessPolicyAssignmentMock.mockResolvedValue({ ok: true });
    expireAccessPolicyAssignmentMock.mockResolvedValue({ ok: true });
    createAccessPolicyOverrideMock.mockResolvedValue({ ok: true });
    expireAccessPolicyOverrideMock.mockResolvedValue({ ok: true });
    createAccessPolicyDelegationMock.mockResolvedValue({ ok: true });
    revokeAccessPolicyDelegationMock.mockResolvedValue({ ok: true });
    updateAccessFieldRuleMock.mockResolvedValue({ ok: true });
    updateAccessSectionRuleMock.mockResolvedValue({ ok: true });
    previewAccessPolicyMock.mockResolvedValue(previewResult);
    getMicrosoftIdentityReviewsMock.mockResolvedValue(microsoftReviews);
    linkMicrosoftIdentityReviewRecordMock.mockResolvedValue({ ok: true });
    rejectMicrosoftIdentityReviewRecordMock.mockResolvedValue({ ok: true });
  });

  it("loads the shared access workspace for admins", async () => {
    render(<AccessControl token="token" currentUser={adminUser} />);

    expect(await screen.findByText("Settings / Access")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Roles" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "User Access" })).toBeInTheDocument();
    expect(screen.getByText("Temporary coverage that is live right now.")).toBeInTheDocument();
    expect(getAccessPolicyWorkspaceMock).toHaveBeenCalledWith("token");
  });

  it("shows a safe restricted state for users without access-policy read permission", async () => {
    render(<AccessControl token="token" currentUser={observerUser} />);

    expect(await screen.findByText("You do not have access to this area.")).toBeInTheDocument();
    expect(getAccessPolicyWorkspaceMock).not.toHaveBeenCalled();
  });

  it("respects backend access denials even when the frontend user shape looks allowed", async () => {
    getAccessPolicyWorkspaceMock.mockRejectedValueOnce(new ApiClientError(403, "Forbidden"));

    render(<AccessControl token="token" currentUser={adminUser} />);

    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
    expect(screen.queryByText("Users and Active Roles")).not.toBeInTheDocument();
    expect(getAccessPolicyWorkspaceMock).toHaveBeenCalledWith("token");
  });

  it("saves field and section rule updates through the shared API", async () => {
    render(<AccessControl token="token" currentUser={adminUser} />);

    expect(await screen.findByText("Settings / Access")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Field Policies" }));
    fireEvent.change(screen.getByDisplayValue("finance.view_summary"), {
      target: { value: "finance.view_costs" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Field Rule" }));

    await waitFor(() => {
      expect(updateAccessFieldRuleMock).toHaveBeenCalledWith("token", "field-rule-1", {
        required_permission_code: "finance.view_costs",
        default_visibility: "masked",
        masking_strategy: "money_summary_only"
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Section Policies" }));
    fireEvent.change(screen.getByDisplayValue("finance.view_summary"), {
      target: { value: "finance.view_margin" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Section Rule" }));

    await waitFor(() => {
      expect(updateAccessSectionRuleMock).toHaveBeenCalledWith("token", "section-rule-1", {
        required_permission_code: "finance.view_margin",
        default_visibility: "hidden"
      });
    });
  });

  it("runs access preview and renders the decision summary", async () => {
    render(<AccessControl token="token" currentUser={adminUser} />);

    expect(await screen.findByText("Settings / Access")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Access Preview" }));
    fireEvent.change(screen.getByLabelText("Permissions"), {
      target: { value: "job.read, job.update" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview Access" }));

    await waitFor(() => {
      expect(previewAccessPolicyMock).toHaveBeenCalledWith("token", expect.objectContaining({
        target_user_id: "user-admin",
        permission_keys: ["job.read", "job.update"]
      }));
    });

    expect(await screen.findByText("Preview Result")).toBeInTheDocument();
    expect(screen.getAllByText("Allowed").length).toBeGreaterThan(0);
    expect(screen.getByText("Allowed by sports department role assignment.")).toBeInTheDocument();
  });

  it("shows communication link coverage and pending Microsoft identity reviews for approvers", async () => {
    render(<AccessControl token="token" currentUser={adminUser} />);

    expect(await screen.findByText("Settings / Access")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Microsoft Auth" }));

    expect(await screen.findByText("Communication Link Coverage")).toBeInTheDocument();
    expect(screen.getByText("Partially linked employee accounts that need cleanup before use.")).toBeInTheDocument();
    expect(screen.getAllByText("Sports Manager").length).toBeGreaterThan(0);
    expect(screen.getByText("Pending Employee")).toBeInTheDocument();
    expect(getMicrosoftIdentityReviewsMock).toHaveBeenCalledWith("token");
  });
});
