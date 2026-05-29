import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AccessUserControlsPanel } from "../components/access/AccessUserControlsPanel";
import type {
  AccessFieldVisibilityRule,
  AccessPolicyAssignmentInput,
  AccessPolicyDelegationInput,
  AccessPolicyOverrideInput,
  AccessPolicyPreview,
  AccessPolicyPreviewInput,
  AccessPolicyScopeType,
  AccessPolicyWorkspace,
  AccessSectionVisibilityRule
} from "../accessPolicyTypes";
import { canManageUserAccessOverlay, canModerateCommunications, canReadAuditLogs, canViewAccessDirectory, hasPermission } from "../permissions";
import {
  createAccessPolicyAssignment,
  createAccessPolicyDelegation,
  createAccessPolicyOverride,
  expireAccessPolicyAssignment,
  expireAccessPolicyOverride,
  getAccessPolicyWorkspace,
  getMicrosoftIdentityReviews,
  linkMicrosoftIdentityReviewRecord,
  previewAccessPolicy,
  rejectMicrosoftIdentityReviewRecord,
  revokeAccessPolicyDelegation,
  updateAccessFieldRule,
  updateAccessSectionRule
} from "../services/accessPolicyApi";
import type { MicrosoftIdentityReview, SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type AccessTab =
  | "roles"
  | "user_access"
  | "microsoft_auth"
  | "delegations"
  | "field_policies"
  | "section_policies"
  | "overrides"
  | "policy_audit"
  | "access_preview";

type RuleDraftMap = Record<
  string,
  {
    required_permission_code: string;
    default_visibility: "hidden" | "masked" | "readonly" | "editable";
    masking_strategy: "partial_email" | "partial_phone" | "money_summary_only" | "initials_only" | "redacted_text" | "none";
  }
>;

type SectionRuleDraftMap = Record<
  string,
  {
    required_permission_code: string;
    default_visibility: "hidden" | "masked" | "readonly" | "editable";
  }
>;

type AssignmentDraft = AccessPolicyAssignmentInput;
type DelegationDraft = AccessPolicyDelegationInput;
type OverrideDraft = AccessPolicyOverrideInput;
type PreviewDraft = AccessPolicyPreviewInput & {
  permission_key_text: string;
  department_type: string;
  organization_id: string;
  location_id: string;
};

const ACCESS_TABS: Array<{ key: AccessTab; label: string; permission?: (user: SessionUser) => boolean }> = [
  { key: "roles", label: "Roles" },
  { key: "user_access", label: "User Access" },
  { key: "microsoft_auth", label: "Microsoft Auth", permission: (user) => hasPermission(user, "user.approve") },
  { key: "delegations", label: "Delegations", permission: (user) => hasPermission(user, "settings.delegations.manage") },
  { key: "field_policies", label: "Field Policies", permission: (user) => hasPermission(user, "settings.field_policies.manage") },
  { key: "section_policies", label: "Section Policies", permission: (user) => hasPermission(user, "settings.field_policies.manage") },
  { key: "overrides", label: "Overrides", permission: (user) => hasPermission(user, "settings.permissions.manage") },
  { key: "policy_audit", label: "Policy Audit Log", permission: (user) => canReadAuditLogs(user) },
  { key: "access_preview", label: "Access Preview", permission: (user) => hasPermission(user, "access_preview.use") }
];

const SCOPE_OPTIONS: AccessPolicyScopeType[] = [
  "global",
  "department",
  "organization",
  "location",
  "owned",
  "assigned",
  "self",
  "team",
  "custom"
];

const PREVIEW_ROUTE_OPTIONS = [
  "",
  "dashboard",
  "watchlist",
  "executive",
  "operations/today",
  "jobs",
  "schools",
  "sports",
  "production",
  "reports",
  "settings/access",
  "profitability"
];

const PREVIEW_RESOURCE_OPTIONS = [
  "",
  "shared_job",
  "shared_watch_flag",
  "shared_production_item",
  "shared_approval_request",
  "shared_qa_review",
  "shared_deliverable_item",
  "settings",
  "dashboard",
  "profitability"
];

function createAssignmentDraft(workspace: AccessPolicyWorkspace | null): AssignmentDraft {
  return {
    user_id: workspace?.users[0]?.user_id ?? "",
    role_code: workspace?.roles.find((role) => role.is_assignable)?.code ?? workspace?.roles[0]?.code ?? "",
    scope_type: "department",
    scope_value: workspace?.users[0]?.department ?? "schools",
    starts_at: null,
    ends_at: null,
    reason: ""
  };
}

function createDelegationDraft(workspace: AccessPolicyWorkspace | null): DelegationDraft {
  return {
    from_user_id: workspace?.users[0]?.user_id ?? "",
    to_user_id: workspace?.users[1]?.user_id ?? workspace?.users[0]?.user_id ?? "",
    role_code: workspace?.roles.find((role) => role.is_assignable)?.code ?? "",
    permission_bundle_key: null,
    scope_type: "department",
    scope_value: "schools",
    starts_at: toDateTimeLocalValue(new Date()),
    ends_at: toDateTimeLocalValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    reason: ""
  };
}

function createOverrideDraft(workspace: AccessPolicyWorkspace | null): OverrideDraft {
  return {
    user_id: workspace?.users[0]?.user_id ?? "",
    permission_code: workspace?.permissions[0]?.code ?? "dashboard.read",
    scope_type: "department",
    scope_value: workspace?.users[0]?.department ?? "schools",
    effect: "allow",
    starts_at: null,
    ends_at: null,
    reason: ""
  };
}

function createPreviewDraft(workspace: AccessPolicyWorkspace | null): PreviewDraft {
  return {
    target_user_id: workspace?.users[0]?.user_id ?? "",
    route_id: "dashboard",
    resource_type: "shared_job",
    resource_id: null,
    permission_keys: ["job.read", "job.update"],
    permission_key_text: "job.read, job.update",
    department_type: "schools",
    organization_id: "",
    location_id: "",
    context: {
      departmentType: "schools",
      ownerUserIds: [],
      assignedUserIds: []
    }
  };
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not set";
}

function humanize(value: string | null | undefined) {
  return (value ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .trim();
}

function getCommunicationStatusTone(status: "linked_ready" | "disabled" | "incomplete" | "unlinked") {
  switch (status) {
    case "linked_ready":
      return "success";
    case "disabled":
      return "warning";
    case "incomplete":
      return "danger";
    default:
      return "neutral";
  }
}

function normalizeReason(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null;
}

function toDateTimeLocalValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIsoOrNull(value: string | null | undefined) {
  if (!value?.trim()) {
    return null;
  }
  return new Date(value).toISOString();
}

function deriveAssignmentState(startsAt: string | null, endsAt: string | null) {
  const now = Date.now();
  if (startsAt && new Date(startsAt).getTime() > now) {
    return "Upcoming";
  }
  if (endsAt && new Date(endsAt).getTime() < now) {
    return "Expired";
  }
  return "Active";
}

function buildFieldRuleDrafts(workspace: AccessPolicyWorkspace | null): RuleDraftMap {
  return Object.fromEntries(
    (workspace?.field_rules ?? []).map((rule) => [
      rule.id,
      {
        required_permission_code: rule.required_permission_code ?? "",
        default_visibility: rule.default_visibility,
        masking_strategy: rule.masking_strategy ?? "none"
      }
    ])
  );
}

function buildSectionRuleDrafts(workspace: AccessPolicyWorkspace | null): SectionRuleDraftMap {
  return Object.fromEntries(
    (workspace?.section_rules ?? []).map((rule) => [
      rule.id,
      {
        required_permission_code: rule.required_permission_code ?? "",
        default_visibility: rule.default_visibility
      }
    ])
  );
}

function PreviewSummary({ preview }: { preview: AccessPolicyPreview }) {
  return (
    <div className="access-policy-preview">
      <div className="access-policy-preview__headline">
        <strong>{preview.allowed ? "Allowed" : "Denied"}</strong>
        <span className={`badge-pill status-chip status-chip--${preview.allowed ? "success" : "danger"}`}>
          {preview.allowed ? "Allowed" : "Denied"}
        </span>
      </div>
      <div className="access-policy-grid">
        <article className="access-policy-card">
          <h4>Requested Permissions</h4>
          <div className="access-policy-kv">
            {preview.permissions.map((permission) => (
              <span key={permission}>{permission}</span>
            ))}
          </div>
        </article>
        <article className="access-policy-card">
          <h4>Action Availability</h4>
          <div className="access-policy-kv">
            {Object.entries(preview.actions).map(([key, value]) => (
              <span key={key}>
                {humanize(key)}: {value ? "Allowed" : "Denied"}
              </span>
            ))}
          </div>
        </article>
        <article className="access-policy-card">
          <h4>Field Visibility</h4>
          <div className="access-policy-kv">
            {!Object.keys(preview.fields).length ? <span>No field rules in scope.</span> : null}
            {Object.entries(preview.fields).map(([key, value]) => (
              <span key={key}>
                {key}: {humanize(value)}
              </span>
            ))}
          </div>
        </article>
        <article className="access-policy-card">
          <h4>Section Visibility</h4>
          <div className="access-policy-kv">
            {!Object.keys(preview.sections).length ? <span>No section rules in scope.</span> : null}
            {Object.entries(preview.sections).map(([key, value]) => (
              <span key={key}>
                {key}: {humanize(value)}
              </span>
            ))}
          </div>
        </article>
      </div>
      <article className="access-policy-card">
        <h4>Why</h4>
        <ul className="access-policy-list">
          {preview.explanation.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </article>
    </div>
  );
}

export function AccessControl({ token, currentUser }: Props) {
  const [workspace, setWorkspace] = useState<AccessPolicyWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [activeTab, setActiveTab] = useState<AccessTab>("roles");
  const [assignmentDraft, setAssignmentDraft] = useState<AssignmentDraft>(() => createAssignmentDraft(null));
  const [delegationDraft, setDelegationDraft] = useState<DelegationDraft>(() => createDelegationDraft(null));
  const [overrideDraft, setOverrideDraft] = useState<OverrideDraft>(() => createOverrideDraft(null));
  const [previewDraft, setPreviewDraft] = useState<PreviewDraft>(() => createPreviewDraft(null));
  const [previewResult, setPreviewResult] = useState<AccessPolicyPreview | null>(null);
  const [fieldRuleDrafts, setFieldRuleDrafts] = useState<RuleDraftMap>({});
  const [sectionRuleDrafts, setSectionRuleDrafts] = useState<SectionRuleDraftMap>({});
  const [microsoftReviews, setMicrosoftReviews] = useState<MicrosoftIdentityReview[]>([]);
  const [microsoftReviewSelections, setMicrosoftReviewSelections] = useState<Record<string, string>>({});

  const canReadWorkspace = canViewAccessDirectory(currentUser);
  const canManageRoles = hasPermission(currentUser, "settings.roles.manage");
  const canManageMicrosoftAuth = hasPermission(currentUser, "user.approve");
  const canManageDelegations = hasPermission(currentUser, "settings.delegations.manage");
  const canManageOverrides = hasPermission(currentUser, "settings.permissions.manage");
  const canManageFieldPolicies = hasPermission(currentUser, "settings.field_policies.manage");
  const canPreview = hasPermission(currentUser, "access_preview.use");
  const canReadPolicyAudit = canReadAuditLogs(currentUser);
  const canModerateCommunicationAccess =
    canModerateCommunications(currentUser) ||
    hasPermission(currentUser, "communication.moderate") ||
    hasPermission(currentUser, "communication.revoke_access");
  const canManageMembershipAccess =
    canManageUserAccessOverlay(currentUser) ||
    hasPermission(currentUser, "user.suspend") ||
    hasPermission(currentUser, "user.reactivate") ||
    hasPermission(currentUser, "user.revoke");

  const visibleTabs = useMemo(
    () => ACCESS_TABS.filter((tab) => !tab.permission || tab.permission(currentUser)),
    [currentUser]
  );

  const roleGrantCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const grant of workspace?.role_grants ?? []) {
      counts.set(grant.role_id, (counts.get(grant.role_id) ?? 0) + 1);
    }
    return counts;
  }, [workspace?.role_grants]);

  const communicationCoverage = useMemo(() => {
    const summary = {
      linked_ready: 0,
      disabled: 0,
      incomplete: 0,
      unlinked: 0
    };
    const users = workspace?.users ?? [];
    for (const user of users) {
      summary[user.communication_identity_status] += 1;
    }
    return {
      summary,
      usersNeedingAttention: users.filter((user) => user.communication_identity_status !== "linked_ready")
    };
  }, [workspace?.users]);

  async function loadWorkspace() {
    if (!canReadWorkspace) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const next = await getAccessPolicyWorkspace(token);
      setWorkspace(next);
      setFieldRuleDrafts(buildFieldRuleDrafts(next));
      setSectionRuleDrafts(buildSectionRuleDrafts(next));
      setAssignmentDraft((current) => (current.user_id ? current : createAssignmentDraft(next)));
      setDelegationDraft((current) => (current.from_user_id ? current : createDelegationDraft(next)));
      setOverrideDraft((current) => (current.user_id ? current : createOverrideDraft(next)));
      setPreviewDraft((current) => (current.target_user_id ? current : createPreviewDraft(next)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load access settings.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMicrosoftReviews() {
    if (!canManageMicrosoftAuth) {
      setMicrosoftReviews([]);
      return;
    }
    try {
      const reviews = await getMicrosoftIdentityReviews(token);
      setMicrosoftReviews(reviews);
      setMicrosoftReviewSelections((current) => {
        const next = { ...current };
        for (const review of reviews) {
          if (!next[review.id]) {
            const exactEmailMatch = workspace?.users.find((user) => user.email.toLowerCase() === review.email.toLowerCase());
            if (exactEmailMatch) {
              next[review.id] = exactEmailMatch.user_id;
            }
          }
        }
        return next;
      });
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "We couldn't load Microsoft identity reviews.");
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, [token, canReadWorkspace]);

  useEffect(() => {
    void loadMicrosoftReviews();
  }, [token, canManageMicrosoftAuth, workspace]);

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(visibleTabs[0]?.key ?? "roles");
    }
  }, [activeTab, visibleTabs]);

  async function runAction(key: string, action: () => Promise<unknown>, successMessage: string) {
    setBusyKey(key);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
      await loadWorkspace();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "We couldn't complete that policy action.");
    } finally {
      setBusyKey("");
    }
  }

  async function handleLinkMicrosoftReview(reviewId: string) {
    const targetUserId = microsoftReviewSelections[reviewId];
    if (!targetUserId) {
      setError("Choose an employee record before linking the Microsoft identity.");
      return;
    }
    await runAction(
      `microsoft-review:link:${reviewId}`,
      async () => {
        await linkMicrosoftIdentityReviewRecord(token, reviewId, { user_id: targetUserId });
        await loadMicrosoftReviews();
      },
      "Microsoft identity linked."
    );
  }

  async function handleRejectMicrosoftReview(reviewId: string, email: string) {
    await runAction(
      `microsoft-review:reject:${reviewId}`,
      async () => {
        await rejectMicrosoftIdentityReviewRecord(token, reviewId, {
          reason: `Rejected Microsoft identity review for ${email}.`
        });
        await loadMicrosoftReviews();
      },
      "Microsoft identity review rejected."
    );
  }

  async function handleCreateAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(
      "assignment:create",
      () =>
        createAccessPolicyAssignment(token, {
          ...assignmentDraft,
          scope_value: normalizeReason(assignmentDraft.scope_value),
          starts_at: toIsoOrNull(assignmentDraft.starts_at ?? null),
          ends_at: toIsoOrNull(assignmentDraft.ends_at ?? null),
          reason: normalizeReason(assignmentDraft.reason)
        }),
      "Role assignment created."
    );
  }

  async function handleCreateDelegation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(
      "delegation:create",
      () =>
        createAccessPolicyDelegation(token, {
          ...delegationDraft,
          role_code: normalizeReason(delegationDraft.role_code),
          permission_bundle_key: normalizeReason(delegationDraft.permission_bundle_key),
          scope_value: normalizeReason(delegationDraft.scope_value),
          starts_at: new Date(delegationDraft.starts_at).toISOString(),
          ends_at: new Date(delegationDraft.ends_at).toISOString(),
          reason: delegationDraft.reason.trim()
        }),
      "Delegation created."
    );
  }

  async function handleCreateOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(
      "override:create",
      () =>
        createAccessPolicyOverride(token, {
          ...overrideDraft,
          scope_value: normalizeReason(overrideDraft.scope_value),
          starts_at: toIsoOrNull(overrideDraft.starts_at ?? null),
          ends_at: toIsoOrNull(overrideDraft.ends_at ?? null),
          reason: overrideDraft.reason.trim()
        }),
      "Permission override created."
    );
  }

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyKey("preview");
    setError("");
    setNotice("");
    try {
      const permissionKeys = previewDraft.permission_key_text
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const payload: AccessPolicyPreviewInput = {
        target_user_id: previewDraft.target_user_id,
        route_id: normalizeReason(previewDraft.route_id ?? null),
        resource_type: normalizeReason(previewDraft.resource_type ?? null),
        resource_id: normalizeReason(previewDraft.resource_id ?? null),
        permission_keys: permissionKeys.length ? permissionKeys : undefined,
        context: {
          departmentType: normalizeReason(previewDraft.department_type),
          organizationId: normalizeReason(previewDraft.organization_id) as string | null,
          locationId: normalizeReason(previewDraft.location_id) as string | null,
          ownerUserIds: [],
          assignedUserIds: [],
          targetUserId: previewDraft.target_user_id
        }
      };
      const result = await previewAccessPolicy(token, payload);
      setPreviewResult(result);
      setNotice("Access preview updated.");
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "We couldn't preview that access decision.");
    } finally {
      setBusyKey("");
    }
  }

  if (!canReadWorkspace) {
    return (
      <>
        <section className="page-intro">
          <div>
            <div className="eyebrow">Access Policy</div>
            <h2>Access Settings</h2>
            <p>The shared policy engine protects roles, scoped access, field visibility, and admin-only tooling from one place.</p>
          </div>
        </section>
        <section className="panel feedback-strip feedback-strip--danger">You do not have access to this area.</section>
      </>
    );
  }

  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">Access Policy</div>
          <h2>Settings / Access</h2>
          <p>One shared policy workspace for route access, scoped role grants, temporary coverage, field visibility, overrides, and auditability.</p>
        </div>
        <div className="page-intro-actions">
          <div className="metric-pill">Roles: {workspace?.summary.role_count ?? 0}</div>
          <div className="metric-pill">Assignments: {workspace?.summary.assignment_count ?? 0}</div>
          <div className="metric-pill">Delegations: {workspace?.summary.delegation_count ?? 0}</div>
          <div className={`metric-pill metric-pill--${canManageOverrides || canManageRoles ? "success" : "warning"}`}>
            Mode: {canManageOverrides || canManageRoles ? "Manage" : "Read Only"}
          </div>
        </div>
      </section>

      {notice ? <section className="panel feedback-strip feedback-strip--success">{notice}</section> : null}
      {error ? <section className="panel feedback-strip feedback-strip--danger">{error}</section> : null}

      <section className="metrics-grid">
        <article className="stat-card panel">
          <div className="eyebrow">Active Delegations</div>
          <strong>{(workspace?.delegations ?? []).filter((item) => item.status === "active").length}</strong>
          <span className="muted">Temporary coverage that is live right now.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Overrides</div>
          <strong>{workspace?.summary.override_count ?? 0}</strong>
          <span className="muted">Exceptional access grants or denials that should stay rare.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Field Rules</div>
          <strong>{workspace?.field_rules.length ?? 0}</strong>
          <span className="muted">Server-side field visibility and masking controls.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Policy Audit</div>
          <strong>{workspace?.summary.audit_event_count ?? 0}</strong>
          <span className="muted">Recent role, delegation, override, preview, and policy changes.</span>
        </article>
      </section>

      <section className="panel access-panel">
        <div className="section-title">Access Settings Areas</div>
        <div className="access-policy-tabs">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`access-policy-tab ${activeTab === tab.key ? "is-active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {loading ? <section className="panel access-panel"><div className="empty-state">Loading access policy workspace...</div></section> : null}

      {!loading && workspace ? (
        <section className="access-layout">
          <div className="access-column">
            {activeTab === "roles" ? (
              <section className="panel access-panel">
                <div className="section-title">Roles</div>
                <div className="access-policy-grid">
                  {workspace.roles.map((role) => (
                    <article key={role.id} className="access-policy-card">
                      <div className="access-policy-card__head">
                        <strong>{role.name}</strong>
                        <span className="badge-pill status-chip status-chip--neutral">{role.department_type ? humanize(role.department_type) : "Global"}</span>
                      </div>
                      <div className="muted">{role.description ?? "No description yet."}</div>
                      <div className="access-policy-kv">
                        <span>Code: {role.code}</span>
                        <span>Assignable: {role.is_assignable ? "Yes" : "No"}</span>
                        <span>Grant count: {roleGrantCounts.get(role.id) ?? 0}</span>
                      </div>
                      <ul className="access-policy-list">
                        {(workspace.role_grants ?? [])
                          .filter((grant) => grant.role_id === role.id)
                          .slice(0, 6)
                          .map((grant) => (
                            <li key={grant.id}>
                              {grant.permission_code} | {humanize(grant.scope_type)} | {humanize(grant.effect)}
                            </li>
                          ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {activeTab === "user_access" ? (
              <>
                <section className="panel access-panel">
                  <div className="section-title">User Access</div>
                  {!canManageRoles ? <div className="empty-state">This area is read-only for your access level.</div> : null}
                  {canManageRoles ? (
                    <form className="access-form" onSubmit={(event) => void handleCreateAssignment(event)}>
                      <div className="access-form__row">
                        <label>
                          <span className="field-label">User</span>
                          <select value={assignmentDraft.user_id} onChange={(event) => setAssignmentDraft((current) => ({ ...current, user_id: event.target.value }))}>
                            {workspace.users.map((user) => (
                              <option key={user.user_id} value={user.user_id}>
                                {user.full_name} ({user.department})
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className="field-label">Role</span>
                          <select value={assignmentDraft.role_code} onChange={(event) => setAssignmentDraft((current) => ({ ...current, role_code: event.target.value }))}>
                            {workspace.roles
                              .filter((role) => role.is_assignable)
                              .map((role) => (
                                <option key={role.id} value={role.code}>
                                  {role.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          <span className="field-label">Scope Type</span>
                          <select value={assignmentDraft.scope_type} onChange={(event) => setAssignmentDraft((current) => ({ ...current, scope_type: event.target.value as AccessPolicyScopeType }))}>
                            {SCOPE_OPTIONS.map((scope) => (
                              <option key={scope} value={scope}>
                                {humanize(scope)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="access-form__row">
                        <label>
                          <span className="field-label">Scope Value</span>
                          <input value={assignmentDraft.scope_value ?? ""} onChange={(event) => setAssignmentDraft((current) => ({ ...current, scope_value: event.target.value }))} placeholder="schools, sports, organization id, or leave blank" />
                        </label>
                        <label>
                          <span className="field-label">Starts At</span>
                          <input type="datetime-local" value={assignmentDraft.starts_at ?? ""} onChange={(event) => setAssignmentDraft((current) => ({ ...current, starts_at: event.target.value }))} />
                        </label>
                        <label>
                          <span className="field-label">Ends At</span>
                          <input type="datetime-local" value={assignmentDraft.ends_at ?? ""} onChange={(event) => setAssignmentDraft((current) => ({ ...current, ends_at: event.target.value }))} />
                        </label>
                      </div>
                      <label>
                        <span className="field-label">Reason</span>
                        <textarea rows={3} value={assignmentDraft.reason ?? ""} onChange={(event) => setAssignmentDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="Why is this role assignment needed?" />
                      </label>
                      <div className="access-actions">
                        <button type="submit" disabled={busyKey === "assignment:create"}>{busyKey === "assignment:create" ? "Saving..." : "Assign Role"}</button>
                      </div>
                    </form>
                  ) : null}
                </section>

                <AccessUserControlsPanel
                  token={token}
                  users={workspace.users}
                  canModerateCommunications={canModerateCommunicationAccess}
                  canManageMembership={canManageMembershipAccess}
                  onChanged={loadWorkspace}
                  onNotice={setNotice}
                  onError={setError}
                />

                <section className="panel access-panel">
                  <div className="section-title">Current Assignments</div>
                  <div className="access-policy-grid">
                    {workspace.assignments.map((assignment) => {
                      const state = deriveAssignmentState(assignment.starts_at, assignment.ends_at);
                      return (
                        <article key={assignment.id} className="access-policy-card">
                          <div className="access-policy-card__head">
                            <strong>{assignment.user_name ?? assignment.user_email ?? "Unknown user"}</strong>
                            <span className={`badge-pill status-chip status-chip--${state === "Active" ? "success" : state === "Upcoming" ? "warning" : "neutral"}`}>{state}</span>
                          </div>
                          <div className="access-policy-kv">
                            <span>Role: {assignment.role_name}</span>
                            <span>Scope: {humanize(assignment.scope_type)}{assignment.scope_value ? ` / ${assignment.scope_value}` : ""}</span>
                            <span>Start: {formatDateTime(assignment.starts_at)}</span>
                            <span>End: {formatDateTime(assignment.ends_at)}</span>
                          </div>
                          <div className="muted">{assignment.reason ?? "No assignment reason recorded."}</div>
                          {canManageRoles && state !== "Expired" ? (
                            <div className="access-actions">
                              <button
                                type="button"
                                className="secondary-button"
                                disabled={busyKey === `expire-assignment:${assignment.id}`}
                                onClick={() =>
                                  void runAction(
                                    `expire-assignment:${assignment.id}`,
                                    () => expireAccessPolicyAssignment(token, assignment.id, "Expired from access workspace."),
                                    "Role assignment expired."
                                  )
                                }
                              >
                                {busyKey === `expire-assignment:${assignment.id}` ? "Expiring..." : "Expire Assignment"}
                              </button>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </section>
              </>
            ) : null}

            {activeTab === "microsoft_auth" ? (
              <>
                <section className="panel access-panel">
                  <div className="section-title">Communication Link Coverage</div>
                  <p className="section-subtitle">
                    Internal communication actions should only target employees whose Microsoft identity is fully linked and verified.
                  </p>
                  <div className="metrics-grid">
                    <article className="stat-card panel">
                      <div className="eyebrow">Ready</div>
                      <strong>{communicationCoverage.summary.linked_ready}</strong>
                      <span className="muted">Employees ready for Teams communication actions.</span>
                    </article>
                    <article className="stat-card panel">
                      <div className="eyebrow">Disabled</div>
                      <strong>{communicationCoverage.summary.disabled}</strong>
                      <span className="muted">Linked identities that are not enabled for communication actions.</span>
                    </article>
                    <article className="stat-card panel">
                      <div className="eyebrow">Incomplete</div>
                      <strong>{communicationCoverage.summary.incomplete}</strong>
                      <span className="muted">Partially linked employee accounts that need cleanup before use.</span>
                    </article>
                    <article className="stat-card panel">
                      <div className="eyebrow">Unlinked</div>
                      <strong>{communicationCoverage.summary.unlinked}</strong>
                      <span className="muted">Employees with no Microsoft communication identity linked yet.</span>
                    </article>
                  </div>
                  {!communicationCoverage.usersNeedingAttention.length ? (
                    <div className="empty-state">All scoped employees are fully linked for future Teams communication actions.</div>
                  ) : (
                    <div className="access-policy-grid">
                      {communicationCoverage.usersNeedingAttention.map((user) => (
                        <article key={user.user_id} className="access-policy-card">
                          <div className="access-policy-card__head">
                            <strong>{user.full_name}</strong>
                            <span
                              className={`badge-pill status-chip status-chip--${getCommunicationStatusTone(
                                user.communication_identity_status
                              )}`}
                            >
                              {humanize(user.communication_identity_status)}
                            </span>
                          </div>
                          <div className="access-policy-kv">
                            <span>Email: {user.email}</span>
                            <span>Department: {humanize(user.department)}</span>
                            <span>Provider: {user.auth_provider ? humanize(user.auth_provider) : "Not linked"}</span>
                            <span>Linked At: {formatDateTime(user.linked_at)}</span>
                            <span>Last Verified: {formatDateTime(user.last_verified_at)}</span>
                            <span>Default Chat Target: {user.teams_chat_default_target ?? "Not set"}</span>
                          </div>
                          <div className="muted">
                            {user.communication_identity_status === "disabled"
                              ? "The Microsoft identity exists, but communication actions are disabled."
                              : user.communication_identity_status === "incomplete"
                                ? "This employee has a partial Microsoft link that should be completed before messaging or calling."
                                : "This employee still needs a Microsoft identity linked before Teams communication can be offered."}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>

                <section className="panel access-panel">
                  <div className="section-title">Microsoft Identity Review</div>
                  <p className="section-subtitle">
                    Review Microsoft Entra accounts that signed in successfully but did not map cleanly to an internal employee record.
                  </p>
                  {!canManageMicrosoftAuth ? <div className="empty-state">This area is restricted.</div> : null}
                  {canManageMicrosoftAuth && !microsoftReviews.length ? (
                    <div className="empty-state">No Microsoft sign-in reviews are waiting right now.</div>
                  ) : null}
                  {canManageMicrosoftAuth && microsoftReviews.length ? (
                    <div className="access-policy-grid">
                      {microsoftReviews.map((review) => {
                        const suggestedUserId = microsoftReviewSelections[review.id] ?? "";
                        const matchedUser = workspace.users.find((user) => user.user_id === suggestedUserId);
                        return (
                          <article key={review.id} className="access-policy-card">
                            <div className="access-policy-card__head">
                              <strong>{review.full_name}</strong>
                              <span className="badge-pill status-chip status-chip--warning">Pending Review</span>
                            </div>
                            <div className="access-policy-kv">
                              <span>Email: {review.email}</span>
                              <span>Microsoft Tenant: {review.microsoft_tenant_id}</span>
                              <span>Last Attempt: {formatDateTime(review.last_login_at)}</span>
                              <span>Reason: {humanize(review.reason_code)}</span>
                              <span>Tenant: {review.tenant_name ?? "Unscoped review"}</span>
                            </div>
                            {review.notes ? <div className="muted">{review.notes}</div> : null}
                            <label>
                              <span className="field-label">Link To Employee</span>
                              <select
                                value={suggestedUserId}
                                onChange={(event) =>
                                  setMicrosoftReviewSelections((current) => ({ ...current, [review.id]: event.target.value }))
                                }
                              >
                                <option value="">Choose an employee record</option>
                                {workspace.users.map((user) => (
                                  <option key={user.user_id} value={user.user_id}>
                                    {user.full_name} ({user.email})
                                  </option>
                                ))}
                              </select>
                            </label>
                            {matchedUser ? (
                              <div className="muted">
                                {matchedUser.department}
                                {matchedUser.authority_tier ? ` | ${humanize(matchedUser.authority_tier)}` : ""}
                              </div>
                            ) : null}
                            <div className="access-actions">
                              <button
                                type="button"
                                disabled={busyKey === `microsoft-review:link:${review.id}` || !suggestedUserId}
                                onClick={() => void handleLinkMicrosoftReview(review.id)}
                              >
                                {busyKey === `microsoft-review:link:${review.id}` ? "Linking..." : "Link Identity"}
                              </button>
                              <button
                                type="button"
                                className="secondary-button"
                                disabled={busyKey === `microsoft-review:reject:${review.id}`}
                                onClick={() => void handleRejectMicrosoftReview(review.id, review.email)}
                              >
                                {busyKey === `microsoft-review:reject:${review.id}` ? "Rejecting..." : "Reject"}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              </>
            ) : null}

            {activeTab === "delegations" ? (
              <>
                <section className="panel access-panel">
                  <div className="section-title">Create Delegation</div>
                  {!canManageDelegations ? <div className="empty-state">This area is read-only for your access level.</div> : null}
                  {canManageDelegations ? (
                    <form className="access-form" onSubmit={(event) => void handleCreateDelegation(event)}>
                      <div className="access-form__row">
                        <label>
                          <span className="field-label">From User</span>
                          <select value={delegationDraft.from_user_id} onChange={(event) => setDelegationDraft((current) => ({ ...current, from_user_id: event.target.value }))}>
                            {workspace.users.map((user) => (
                              <option key={user.user_id} value={user.user_id}>
                                {user.full_name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className="field-label">To User</span>
                          <select value={delegationDraft.to_user_id} onChange={(event) => setDelegationDraft((current) => ({ ...current, to_user_id: event.target.value }))}>
                            {workspace.users.map((user) => (
                              <option key={user.user_id} value={user.user_id}>
                                {user.full_name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className="field-label">Role</span>
                          <select value={delegationDraft.role_code ?? ""} onChange={(event) => setDelegationDraft((current) => ({ ...current, role_code: event.target.value || null }))}>
                            <option value="">No role bundle</option>
                            {workspace.roles.map((role) => (
                              <option key={role.id} value={role.code}>
                                {role.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="access-form__row">
                        <label>
                          <span className="field-label">Scope Type</span>
                          <select value={delegationDraft.scope_type} onChange={(event) => setDelegationDraft((current) => ({ ...current, scope_type: event.target.value as AccessPolicyScopeType }))}>
                            {SCOPE_OPTIONS.map((scope) => (
                              <option key={scope} value={scope}>
                                {humanize(scope)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className="field-label">Scope Value</span>
                          <input value={delegationDraft.scope_value ?? ""} onChange={(event) => setDelegationDraft((current) => ({ ...current, scope_value: event.target.value }))} placeholder="schools, sports, organization id, or leave blank" />
                        </label>
                        <label>
                          <span className="field-label">Starts At</span>
                          <input type="datetime-local" value={delegationDraft.starts_at} onChange={(event) => setDelegationDraft((current) => ({ ...current, starts_at: event.target.value }))} />
                        </label>
                        <label>
                          <span className="field-label">Ends At</span>
                          <input type="datetime-local" value={delegationDraft.ends_at} onChange={(event) => setDelegationDraft((current) => ({ ...current, ends_at: event.target.value }))} />
                        </label>
                      </div>
                      <label>
                        <span className="field-label">Reason</span>
                        <textarea rows={3} value={delegationDraft.reason} onChange={(event) => setDelegationDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="Coverage reason, PTO backfill, or short-term ownership transfer." />
                      </label>
                      <div className="access-actions">
                        <button type="submit" disabled={busyKey === "delegation:create"}>{busyKey === "delegation:create" ? "Creating..." : "Create Delegation"}</button>
                      </div>
                    </form>
                  ) : null}
                </section>

                <section className="panel access-panel">
                  <div className="section-title">Delegations</div>
                  <div className="access-policy-grid">
                    {workspace.delegations.map((delegation) => (
                      <article key={delegation.id} className="access-policy-card">
                        <div className="access-policy-card__head">
                          <strong>{delegation.from_user_name ?? "Unknown"} → {delegation.to_user_name ?? "Unknown"}</strong>
                          <span className={`badge-pill status-chip status-chip--${delegation.status === "active" ? "success" : delegation.status === "pending" ? "warning" : "neutral"}`}>{humanize(delegation.status)}</span>
                        </div>
                        <div className="access-policy-kv">
                          <span>Role: {delegation.role_name ?? delegation.permission_bundle_key ?? "Custom scope"}</span>
                          <span>Scope: {humanize(delegation.scope_type)}{delegation.scope_value ? ` / ${delegation.scope_value}` : ""}</span>
                          <span>Start: {formatDateTime(delegation.starts_at)}</span>
                          <span>End: {formatDateTime(delegation.ends_at)}</span>
                        </div>
                        <div className="muted">{delegation.reason}</div>
                        {canManageDelegations && (delegation.status === "active" || delegation.status === "pending") ? (
                          <div className="access-actions">
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={busyKey === `revoke-delegation:${delegation.id}`}
                              onClick={() =>
                                void runAction(
                                  `revoke-delegation:${delegation.id}`,
                                  () => revokeAccessPolicyDelegation(token, delegation.id, "Revoked from access workspace."),
                                  "Delegation revoked."
                                )
                              }
                            >
                              {busyKey === `revoke-delegation:${delegation.id}` ? "Revoking..." : "Revoke Delegation"}
                            </button>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </section>
              </>
            ) : null}
            {activeTab === "field_policies" ? (
              <section className="panel access-panel">
                <div className="section-title">Field Policies</div>
                <div className="access-policy-grid">
                  {workspace.field_rules.map((rule) => (
                    <FieldRuleCard
                      key={rule.id}
                      rule={rule}
                      draft={fieldRuleDrafts[rule.id]}
                      canManage={canManageFieldPolicies}
                      busy={busyKey === `field-rule:${rule.id}`}
                      onDraftChange={(next) => setFieldRuleDrafts((current) => ({ ...current, [rule.id]: next }))}
                      onSave={() =>
                        void runAction(
                          `field-rule:${rule.id}`,
                          () =>
                            updateAccessFieldRule(token, rule.id, {
                              required_permission_code: normalizeReason((fieldRuleDrafts[rule.id] ?? defaultFieldRuleDraft(rule)).required_permission_code),
                              default_visibility: (fieldRuleDrafts[rule.id] ?? defaultFieldRuleDraft(rule)).default_visibility,
                              masking_strategy:
                                (fieldRuleDrafts[rule.id] ?? defaultFieldRuleDraft(rule)).masking_strategy === "none"
                                  ? null
                                  : (fieldRuleDrafts[rule.id] ?? defaultFieldRuleDraft(rule)).masking_strategy
                            }),
                          "Field rule updated."
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {activeTab === "section_policies" ? (
              <section className="panel access-panel">
                <div className="section-title">Section Policies</div>
                <div className="access-policy-grid">
                  {workspace.section_rules.map((rule) => (
                    <SectionRuleCard
                      key={rule.id}
                      rule={rule}
                      draft={sectionRuleDrafts[rule.id]}
                      canManage={canManageFieldPolicies}
                      busy={busyKey === `section-rule:${rule.id}`}
                      onDraftChange={(next) => setSectionRuleDrafts((current) => ({ ...current, [rule.id]: next }))}
                      onSave={() =>
                        void runAction(
                          `section-rule:${rule.id}`,
                          () =>
                            updateAccessSectionRule(token, rule.id, {
                              required_permission_code: normalizeReason((sectionRuleDrafts[rule.id] ?? defaultSectionRuleDraft(rule)).required_permission_code),
                              default_visibility: (sectionRuleDrafts[rule.id] ?? defaultSectionRuleDraft(rule)).default_visibility
                            }),
                          "Section rule updated."
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {activeTab === "overrides" ? (
              <>
                <section className="panel access-panel">
                  <div className="section-title">Create Override</div>
                  {!canManageOverrides ? <div className="empty-state">This area is read-only for your access level.</div> : null}
                  {canManageOverrides ? (
                    <form className="access-form" onSubmit={(event) => void handleCreateOverride(event)}>
                      <div className="access-form__row">
                        <label>
                          <span className="field-label">User</span>
                          <select value={overrideDraft.user_id} onChange={(event) => setOverrideDraft((current) => ({ ...current, user_id: event.target.value }))}>
                            {workspace.users.map((user) => (
                              <option key={user.user_id} value={user.user_id}>
                                {user.full_name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className="field-label">Permission</span>
                          <select value={overrideDraft.permission_code} onChange={(event) => setOverrideDraft((current) => ({ ...current, permission_code: event.target.value }))}>
                            {workspace.permissions.map((permission) => (
                              <option key={permission.id} value={permission.code}>
                                {permission.code}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className="field-label">Effect</span>
                          <select value={overrideDraft.effect} onChange={(event) => setOverrideDraft((current) => ({ ...current, effect: event.target.value as OverrideDraft["effect"] }))}>
                            <option value="allow">Allow</option>
                            <option value="deny">Deny</option>
                          </select>
                        </label>
                      </div>
                      <div className="access-form__row">
                        <label>
                          <span className="field-label">Scope Type</span>
                          <select value={overrideDraft.scope_type} onChange={(event) => setOverrideDraft((current) => ({ ...current, scope_type: event.target.value as AccessPolicyScopeType }))}>
                            {SCOPE_OPTIONS.map((scope) => (
                              <option key={scope} value={scope}>
                                {humanize(scope)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className="field-label">Scope Value</span>
                          <input value={overrideDraft.scope_value ?? ""} onChange={(event) => setOverrideDraft((current) => ({ ...current, scope_value: event.target.value }))} />
                        </label>
                        <label>
                          <span className="field-label">Starts At</span>
                          <input type="datetime-local" value={overrideDraft.starts_at ?? ""} onChange={(event) => setOverrideDraft((current) => ({ ...current, starts_at: event.target.value }))} />
                        </label>
                        <label>
                          <span className="field-label">Ends At</span>
                          <input type="datetime-local" value={overrideDraft.ends_at ?? ""} onChange={(event) => setOverrideDraft((current) => ({ ...current, ends_at: event.target.value }))} />
                        </label>
                      </div>
                      <label>
                        <span className="field-label">Reason</span>
                        <textarea rows={3} value={overrideDraft.reason} onChange={(event) => setOverrideDraft((current) => ({ ...current, reason: event.target.value }))} />
                      </label>
                      <div className="access-actions">
                        <button type="submit" disabled={busyKey === "override:create"}>{busyKey === "override:create" ? "Saving..." : "Create Override"}</button>
                      </div>
                    </form>
                  ) : null}
                </section>

                <section className="panel access-panel">
                  <div className="section-title">Overrides</div>
                  <div className="access-policy-grid">
                    {workspace.overrides.map((override) => (
                      <article key={override.id} className="access-policy-card">
                        <div className="access-policy-card__head">
                          <strong>{override.user_name ?? override.user_email ?? "Unknown user"}</strong>
                          <span className={`badge-pill status-chip status-chip--${override.effect === "allow" ? "success" : "danger"}`}>{humanize(override.effect)}</span>
                        </div>
                        <div className="access-policy-kv">
                          <span>Permission: {override.permission_code}</span>
                          <span>Scope: {humanize(override.scope_type)}{override.scope_value ? ` / ${override.scope_value}` : ""}</span>
                          <span>Start: {formatDateTime(override.starts_at)}</span>
                          <span>End: {formatDateTime(override.ends_at)}</span>
                        </div>
                        <div className="muted">{override.reason}</div>
                        {canManageOverrides ? (
                          <div className="access-actions">
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={busyKey === `expire-override:${override.id}`}
                              onClick={() =>
                                void runAction(
                                  `expire-override:${override.id}`,
                                  () => expireAccessPolicyOverride(token, override.id, "Expired from access workspace."),
                                  "Override expired."
                                )
                              }
                            >
                              {busyKey === `expire-override:${override.id}` ? "Expiring..." : "Expire Override"}
                            </button>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </section>
              </>
            ) : null}

            {activeTab === "policy_audit" ? (
              <section className="panel access-panel">
                <div className="section-title">Policy Audit Log</div>
                {!canReadPolicyAudit ? <div className="empty-state">This section is restricted.</div> : null}
                {canReadPolicyAudit ? (
                  <div className="audit-list">
                    {workspace.audit_events.map((event) => (
                      <article key={event.id} className="audit-card">
                        <div className="audit-card__head">
                          <strong>{humanize(event.policy_event_type)}</strong>
                          <span className="muted">{formatDateTime(event.created_at)}</span>
                        </div>
                        <div className="audit-card__line">Actor: {event.actor_name ?? "System"}</div>
                        <div className="audit-card__line">Target: {event.target_name ?? "n/a"}</div>
                        <div className="audit-card__line">Permission: {event.permission_code ?? "n/a"}</div>
                        <div className="audit-card__line">Result: {humanize(event.result)}</div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {activeTab === "access_preview" ? (
              <>
                <section className="panel access-panel">
                  <div className="section-title">Access Preview</div>
                  {!canPreview ? <div className="empty-state">This section is restricted.</div> : null}
                  {canPreview ? (
                    <form className="access-form" onSubmit={(event) => void handlePreview(event)}>
                      <div className="access-form__row">
                        <label>
                          <span className="field-label">Target User</span>
                          <select value={previewDraft.target_user_id} onChange={(event) => setPreviewDraft((current) => ({ ...current, target_user_id: event.target.value }))}>
                            {workspace.users.map((user) => (
                              <option key={user.user_id} value={user.user_id}>
                                {user.full_name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className="field-label">Route</span>
                          <select value={previewDraft.route_id ?? ""} onChange={(event) => setPreviewDraft((current) => ({ ...current, route_id: event.target.value || null }))}>
                            {PREVIEW_ROUTE_OPTIONS.map((option) => (
                              <option key={option || "none"} value={option}>
                                {option || "No route"}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className="field-label">Resource Type</span>
                          <select value={previewDraft.resource_type ?? ""} onChange={(event) => setPreviewDraft((current) => ({ ...current, resource_type: event.target.value || null }))}>
                            {PREVIEW_RESOURCE_OPTIONS.map((option) => (
                              <option key={option || "none"} value={option}>
                                {option || "No resource"}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="access-form__row">
                        <label>
                          <span className="field-label">Resource Id</span>
                          <input value={previewDraft.resource_id ?? ""} onChange={(event) => setPreviewDraft((current) => ({ ...current, resource_id: event.target.value || null }))} />
                        </label>
                        <label>
                          <span className="field-label">Department</span>
                          <input value={previewDraft.department_type} onChange={(event) => setPreviewDraft((current) => ({ ...current, department_type: event.target.value }))} placeholder="schools or sports" />
                        </label>
                        <label>
                          <span className="field-label">Permissions</span>
                          <input value={previewDraft.permission_key_text} onChange={(event) => setPreviewDraft((current) => ({ ...current, permission_key_text: event.target.value }))} placeholder="job.read, job.update" />
                        </label>
                      </div>
                      <div className="access-actions">
                        <button type="submit" disabled={busyKey === "preview"}>{busyKey === "preview" ? "Previewing..." : "Preview Access"}</button>
                      </div>
                    </form>
                  ) : null}
                </section>
                {previewResult ? (
                  <section className="panel access-panel">
                    <div className="section-title">Preview Result</div>
                    <PreviewSummary preview={previewResult} />
                  </section>
                ) : null}
              </>
            ) : null}
          </div>

          <aside className="access-column access-column--narrow">
            <section className="panel access-panel">
              <div className="section-title">Access Summary</div>
              <div className="access-policy-kv">
                <span>Visible roles: {workspace.roles.length}</span>
                <span>Users in scope: {workspace.users.length}</span>
                <span>Field rules: {workspace.field_rules.length}</span>
                <span>Section rules: {workspace.section_rules.length}</span>
              </div>
            </section>

            <section className="panel access-panel">
              <div className="section-title">Users and Active Roles</div>
              <div className="audit-list">
                {workspace.users.slice(0, 20).map((user) => (
                  <article key={user.user_id} className="audit-card">
                    <div className="audit-card__head">
                      <strong>{user.full_name}</strong>
                      <span className="muted">{humanize(user.department)}</span>
                    </div>
                    <div className="audit-card__line">{user.email}</div>
                    <div className="audit-card__line">Authority: {humanize(user.authority_tier ?? "unknown")}</div>
                    <div className="audit-card__line">Roles: {user.active_role_codes.length ? user.active_role_codes.join(", ") : "None"}</div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel access-panel">
              <div className="section-title">Guardrails</div>
              <ul className="access-policy-list">
                <li>Backend policy enforcement is the source of truth.</li>
                <li>Delegations expire automatically and stay auditable.</li>
                <li>Field and section visibility rules control serializers and UI surfaces together.</li>
                <li>Overrides are exceptional and should stay sparse.</li>
              </ul>
            </section>
          </aside>
        </section>
      ) : null}
    </>
  );
}

function defaultFieldRuleDraft(rule: AccessFieldVisibilityRule) {
  return {
    required_permission_code: rule.required_permission_code ?? "",
    default_visibility: rule.default_visibility,
    masking_strategy: rule.masking_strategy ?? "none"
  } satisfies RuleDraftMap[string];
}

function defaultSectionRuleDraft(rule: AccessSectionVisibilityRule) {
  return {
    required_permission_code: rule.required_permission_code ?? "",
    default_visibility: rule.default_visibility
  } satisfies SectionRuleDraftMap[string];
}

function FieldRuleCard({
  rule,
  draft,
  canManage,
  busy,
  onDraftChange,
  onSave
}: {
  rule: AccessFieldVisibilityRule;
  draft: RuleDraftMap[string] | undefined;
  canManage: boolean;
  busy: boolean;
  onDraftChange: (draft: RuleDraftMap[string]) => void;
  onSave: () => void;
}) {
  const current = draft ?? defaultFieldRuleDraft(rule);
  return (
    <article className="access-policy-card">
      <div className="access-policy-card__head">
        <strong>{rule.field_key}</strong>
        <span className="badge-pill status-chip status-chip--neutral">{humanize(rule.sensitivity_category)}</span>
      </div>
      <div className="muted">
        {rule.resource_type}
        {rule.department_type ? ` / ${rule.department_type}` : ""}
      </div>
      <div className="access-policy-form-row">
        <label>
          <span className="field-label">Permission</span>
          <input value={current.required_permission_code} disabled={!canManage} onChange={(event) => onDraftChange({ ...current, required_permission_code: event.target.value })} />
        </label>
        <label>
          <span className="field-label">Visibility</span>
          <select value={current.default_visibility} disabled={!canManage} onChange={(event) => onDraftChange({ ...current, default_visibility: event.target.value as RuleDraftMap[string]["default_visibility"] })}>
            <option value="hidden">Hidden</option>
            <option value="masked">Masked</option>
            <option value="readonly">Read-only</option>
            <option value="editable">Editable</option>
          </select>
        </label>
        <label>
          <span className="field-label">Masking</span>
          <select value={current.masking_strategy} disabled={!canManage} onChange={(event) => onDraftChange({ ...current, masking_strategy: event.target.value as RuleDraftMap[string]["masking_strategy"] })}>
            <option value="none">None</option>
            <option value="partial_email">Partial email</option>
            <option value="partial_phone">Partial phone</option>
            <option value="money_summary_only">Money summary only</option>
            <option value="initials_only">Initials only</option>
            <option value="redacted_text">Redacted text</option>
          </select>
        </label>
      </div>
      {canManage ? (
        <div className="access-actions">
          <button type="button" disabled={busy} onClick={onSave}>
            {busy ? "Saving..." : "Save Field Rule"}
          </button>
        </div>
      ) : null}
    </article>
  );
}

function SectionRuleCard({
  rule,
  draft,
  canManage,
  busy,
  onDraftChange,
  onSave
}: {
  rule: AccessSectionVisibilityRule;
  draft: SectionRuleDraftMap[string] | undefined;
  canManage: boolean;
  busy: boolean;
  onDraftChange: (draft: SectionRuleDraftMap[string]) => void;
  onSave: () => void;
}) {
  const current = draft ?? defaultSectionRuleDraft(rule);
  return (
    <article className="access-policy-card">
      <div className="access-policy-card__head">
        <strong>{rule.section_key}</strong>
        <span className="badge-pill status-chip status-chip--neutral">{rule.sensitivity_category ? humanize(rule.sensitivity_category) : "Standard"}</span>
      </div>
      <div className="muted">
        {rule.resource_type}
        {rule.department_type ? ` / ${rule.department_type}` : ""}
      </div>
      <div className="access-policy-form-row">
        <label>
          <span className="field-label">Permission</span>
          <input value={current.required_permission_code} disabled={!canManage} onChange={(event) => onDraftChange({ ...current, required_permission_code: event.target.value })} />
        </label>
        <label>
          <span className="field-label">Visibility</span>
          <select value={current.default_visibility} disabled={!canManage} onChange={(event) => onDraftChange({ ...current, default_visibility: event.target.value as SectionRuleDraftMap[string]["default_visibility"] })}>
            <option value="hidden">Hidden</option>
            <option value="masked">Masked</option>
            <option value="readonly">Read-only</option>
            <option value="editable">Editable</option>
          </select>
        </label>
      </div>
      {canManage ? (
        <div className="access-actions">
          <button type="button" disabled={busy} onClick={onSave}>
            {busy ? "Saving..." : "Save Section Rule"}
          </button>
        </div>
      ) : null}
    </article>
  );
}
