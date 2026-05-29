import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type { Microsoft365GovernanceValidationIssue } from "../types/microsoft365Governance.js";
import { getMicrosoft365GovernanceValidationIssues } from "./microsoft365Governance.js";

export type MicrosoftSecurityTruthStatus = "healthy" | "at_risk" | "blocked";

export type MicrosoftSecurityEvidenceItem = {
  kind: "screenshot" | "file" | "link" | "note";
  label: string;
  href?: string | null;
  note?: string | null;
};

type MicrosoftSecurityEvidenceRow = {
  control_key: string;
  status: MicrosoftSecurityTruthStatus;
  what_text: string | null;
  why_text: string | null;
  fix_text: string | null;
  owner: string | null;
  retest_text: string | null;
  evidence_items: MicrosoftSecurityEvidenceItem[];
  checked_by_user_id: string | null;
  checked_at: string | null;
  expires_at: string | null;
  updated_at: string;
};

type MicrosoftSecurityControlDefinition = {
  key: string;
  title: string;
  owner: string;
  what: string;
  why: string;
  fix: string;
  retest: string;
  blocking: boolean;
  issueAreas: string[];
  issueCodes?: string[];
};

const MICROSOFT_SECURITY_CONTROLS: MicrosoftSecurityControlDefinition[] = [
  {
    key: "mfa_authentication_strength",
    title: "MFA / Authentication Strength",
    owner: "Security admin",
    what: "Admins and high-risk Microsoft sign-ins must use the required MFA strength and the app must reflect that assurance.",
    why: "Phase 2 cannot safely depend on Entra-backed admin access if the app cannot prove strong sign-in happened.",
    fix: "Publish MFA-strength requirements, validate them in the tenant, and verify Mission Control sessions store the resulting assurance.",
    retest: "Sign in with an Entra admin, confirm MFA strength in Entra and confirm Mission Control shows the expected session assurance.",
    blocking: true,
    issueAreas: ["auth"],
    issueCodes: ["auth.local_password_enabled_with_entra"]
  },
  {
    key: "conditional_access",
    title: "Conditional Access",
    owner: "Security admin",
    what: "Privileged Microsoft access paths should be governed by explicit Conditional Access policies with rollback-ready rollout.",
    why: "Without verified Conditional Access, privileged admin access is policy-by-assumption instead of policy-by-enforcement.",
    fix: "Export or document the live Conditional Access baseline and validate admin, device, and location behavior in test cases.",
    retest: "Run compliant, non-compliant, and off-policy sign-in tests and capture the resulting policy evaluation evidence.",
    blocking: true,
    issueAreas: ["auth"]
  },
  {
    key: "intune_device_compliance",
    title: "Intune / Device Compliance",
    owner: "Security admin",
    what: "Managed-device expectations must be enforced for privileged Microsoft access and aligned to BYOD/mobile posture.",
    why: "Conditional Access device checks are meaningless if no real compliance baseline exists behind them.",
    fix: "Publish Intune compliance rules, define BYOD/mobile posture, and validate that admin access actually respects them.",
    retest: "Test compliant and non-compliant devices against the intended admin access paths.",
    blocking: true,
    issueAreas: ["power_automate"]
  },
  {
    key: "phishing_resistant_authentication",
    title: "Phishing-Resistant Authentication",
    owner: "Security admin",
    what: "Admin, SecurityAdmin, Finance, and other elevated Microsoft actions should require phishing-resistant authentication where policy calls for it.",
    why: "Higher-impact admin and finance workflows should not rely on baseline MFA alone when the business explicitly expects stronger auth.",
    fix: "Publish authentication-strength policy for elevated users, validate passkey or FIDO2-capable admin paths, and capture evidence per access tier.",
    retest: "Run elevated sign-ins on Windows Hello and iPhone passkey-capable flows, then capture proof that the stronger requirement applies.",
    blocking: true,
    issueAreas: ["auth"]
  },
  {
    key: "byod_app_protection",
    title: "BYOD / App Protection",
    owner: "Security admin",
    what: "Personal mobile access should be governed by Intune app protection and approved-app expectations instead of pretending unmanaged phones equal managed admin devices.",
    why: "The product must support iPhone and Android, but elevated access still needs differentiated control.",
    fix: "Document approved mobile app posture, app protection expectations, and elevated-device requirements in a verifiable tenant baseline.",
    retest: "Validate standard BYOD access, elevated BYOD restrictions, and admin device expectations with screenshots or policy exports.",
    blocking: true,
    issueAreas: ["power_automate", "auth"]
  },
  {
    key: "external_sharing_restrictions",
    title: "External Sharing Restrictions",
    owner: "SharePoint admin",
    what: "SharePoint and OneDrive external sharing must be locked to the intended posture before project workspaces expand.",
    why: "Unsafe defaults here will leak directly into the Phase 2 document and collaboration rollout.",
    fix: "Apply the tenant/site sharing posture, verify upload-only paths, and capture proof of the effective setting.",
    retest: "Run allowed-domain and unrelated-recipient sharing tests and confirm only the intended upload path works.",
    blocking: true,
    issueAreas: ["sharepoint", "tenant"]
  },
  {
    key: "internal_collaboration_posture",
    title: "Internal Collaboration Posture",
    owner: "SharePoint admin",
    what: "Employee Teams, SharePoint, and OneDrive collaboration should stay separate from guest or client submission flows.",
    why: "If internal collaboration and external submission use the same posture, broad employee sharing defaults will leak into client-facing workflows.",
    fix: "Document and validate the internal employee collaboration baseline separately from guest submission paths before workspace rollout expands.",
    retest: "Review the effective SharePoint and Teams collaboration settings for employee workspaces and confirm they do not double as guest drop-off paths.",
    blocking: true,
    issueAreas: ["sharepoint", "tenant"]
  },
  {
    key: "client_submission_posture",
    title: "Client Submission Posture",
    owner: "Ops lead",
    what: "Client file submission should stay guided, form-based, and traceable instead of relying on open folder drops or ad hoc guest collaboration.",
    why: "Ungoverned drop-offs create traceability gaps and make Phase 5 client submission rework much more likely.",
    fix: "Capture evidence that the secure client intake pattern is distinct from internal collaboration and that submission requests stay structured and reviewable.",
    retest: "Walk through a client submission request, confirm required guidance is present, and verify uploads land in the governed intake path rather than a generic folder.",
    blocking: true,
    issueAreas: ["sharepoint", "tenant"]
  },
  {
    key: "unified_audit_logging",
    title: "Unified Audit Logging",
    owner: "Security admin",
    what: "Microsoft workload audit logs and retention must be searchable for investigation and admin review.",
    why: "If audit is assumed instead of proven, the foundation is not supportable or defensible.",
    fix: "Enable the audit workload coverage you need, set retention, and document the incident-review search path.",
    retest: "Generate representative admin and sharing events, then prove they are searchable inside the retained window.",
    blocking: true,
    issueAreas: ["tenant"]
  },
  {
    key: "entra_assignment_validation",
    title: "Entra Assignment Validation",
    owner: "App engineer",
    what: "Mission Control must resolve Entra app roles and group assignments into the intended app authority, groups, and permissions.",
    why: "If this contract is unclear or drifting, app authorization is not enforceable even if Microsoft auth succeeds.",
    fix: "Bind app roles or group IDs to the app contract, validate mappings, and capture evidence for success and fail-closed cases.",
    retest: "Run positive and negative sign-in tests and confirm diagnostics show raw inputs, resolved roles, and denied cases clearly.",
    blocking: true,
    issueAreas: ["entra_access_model", "auth"]
  },
  {
    key: "sign_in_validation",
    title: "Sign-In Validation",
    owner: "App engineer",
    what: "Mission Control should show the real Microsoft sign-in result, including the effective assurance level, mapped app role contract, and any fail-closed denial reason.",
    why: "Without sign-in validation evidence, it is too easy to assume Microsoft auth worked correctly while the app is still resolving the wrong access.",
    fix: "Capture positive and negative sign-in evidence through Security Center and confirm the resolved role and overlays match policy.",
    retest: "Run a normal user, elevated user, and denied user through sign-in and confirm the diagnostics explain each outcome clearly.",
    blocking: true,
    issueAreas: ["auth", "entra_access_model"]
  },
  {
    key: "privileged_step_up_validation",
    title: "Privileged Step-Up Validation",
    owner: "App engineer",
    what: "Sensitive in-app actions should require the expected Microsoft auth context, recent reauthentication, and privileged window timing.",
    why: "Phase 1 is not enforceable if the app still has a dead-end or generic privileged step-up flow.",
    fix: "Validate action-to-auth-context mapping, recent reauth windows, and session refresh behavior with real Entra step-up evidence.",
    retest: "Exercise satisfied, missing, and expired step-up flows plus break-glass interaction and capture the challenge/output evidence.",
    blocking: true,
    issueAreas: ["auth"]
  },
  {
    key: "break_glass_review",
    title: "Break-Glass Review",
    owner: "Security admin",
    what: "Emergency-access paths must stay isolated, auditable, and reviewed after use.",
    why: "Break-glass accounts or sessions that are not reviewed become a quiet bypass channel instead of a controlled emergency mechanism.",
    fix: "Document emergency-account ownership, validate exclusion from lockout-causing CA rules, and review every break-glass event in Security Center.",
    retest: "Run a controlled emergency-access drill, close the review, and attach evidence of the after-action record.",
    blocking: true,
    issueAreas: ["auth"]
  }
];

function summarizeStatus(rows: MicrosoftSecurityTruthStatus[]) {
  return {
    healthy: rows.filter((status) => status === "healthy").length,
    at_risk: rows.filter((status) => status === "at_risk").length,
    blocked: rows.filter((status) => status === "blocked").length
  };
}

function deriveStatus(
  definition: MicrosoftSecurityControlDefinition,
  evidence: MicrosoftSecurityEvidenceRow | null,
  issues: Microsoft365GovernanceValidationIssue[]
): MicrosoftSecurityTruthStatus {
  const relevantIssues = issues.filter((issue) => {
    if (definition.issueCodes?.includes(issue.code)) {
      return true;
    }
    return definition.issueAreas.includes(issue.area);
  });
  if (relevantIssues.some((issue) => issue.severity === "error")) {
    return "blocked";
  }
  if (!evidence) {
    return definition.blocking ? "blocked" : "at_risk";
  }
  if (evidence.expires_at && new Date(evidence.expires_at).getTime() <= Date.now()) {
    return "at_risk";
  }
  if (evidence.status === "healthy" && relevantIssues.length === 0) {
    return "healthy";
  }
  if (evidence.status === "healthy" && relevantIssues.length > 0) {
    return "at_risk";
  }
  return evidence.status;
}

async function loadEvidenceRows(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<MicrosoftSecurityEvidenceRow>(
    `
      SELECT
        control_key,
        status,
        what_text,
        why_text,
        fix_text,
        owner,
        retest_text,
        COALESCE(evidence_items, '[]'::jsonb) AS evidence_items,
        checked_by_user_id,
        checked_at::text,
        expires_at::text,
        updated_at::text
      FROM microsoft_security_evidence
      WHERE tenant_id = $1
    `,
    [tenantId]
  );
  return new Map(rows.map((row) => [row.control_key, row]));
}

export async function getMicrosoftSecurityTruthWorkspace(client: PoolClient, auth: AuthUser) {
  const evidenceRows = await loadEvidenceRows(client, auth.tenantId);
  const issues = getMicrosoft365GovernanceValidationIssues();
  const controls = MICROSOFT_SECURITY_CONTROLS.map((definition) => {
    const evidence = evidenceRows.get(definition.key) ?? null;
    const liveIssues = issues.filter((issue) => {
      if (definition.issueCodes?.includes(issue.code)) {
        return true;
      }
      return definition.issueAreas.includes(issue.area);
    });
    return {
      control_key: definition.key,
      title: definition.title,
      status: deriveStatus(definition, evidence, issues),
      what: evidence?.what_text ?? definition.what,
      why: evidence?.why_text ?? definition.why,
      fix: evidence?.fix_text ?? definition.fix,
      owner: evidence?.owner ?? definition.owner,
      retest: evidence?.retest_text ?? definition.retest,
      evidence: evidence?.evidence_items ?? [],
      checked_at: evidence?.checked_at ?? null,
      expires_at: evidence?.expires_at ?? null,
      updated_at: evidence?.updated_at ?? null,
      live_issues: liveIssues,
      blocking: definition.blocking
    };
  }).sort((left, right) => statusRank(right.status) - statusRank(left.status));

  const summary = summarizeStatus(controls.map((control) => control.status));
  return {
    generated_at: new Date().toISOString(),
    overall_status: summary.blocked > 0 ? "blocked" : summary.at_risk > 0 ? "at_risk" : "healthy",
    summary,
    controls,
    re_audit_checklist: controls.map((control) => ({
      control_key: control.control_key,
      title: control.title,
      status: control.status,
      pass_criteria: control.what,
      retest_action: control.retest,
      blocking: control.blocking
    }))
  };
}

export async function upsertMicrosoftSecurityEvidence(
  client: PoolClient,
  auth: AuthUser,
  input: {
    controlKey: string;
    status: MicrosoftSecurityTruthStatus;
    what?: string | null;
    why?: string | null;
    fix?: string | null;
    owner?: string | null;
    retest?: string | null;
    evidenceItems?: MicrosoftSecurityEvidenceItem[];
    expiresAt?: string | null;
  }
) {
  const definition = MICROSOFT_SECURITY_CONTROLS.find((control) => control.key === input.controlKey);
  if (!definition) {
    throw new ApiError(400, `Unknown Microsoft security truth control: ${input.controlKey}`);
  }
  await client.query(
    `
      INSERT INTO microsoft_security_evidence (
        tenant_id,
        control_key,
        status,
        what_text,
        why_text,
        fix_text,
        owner,
        retest_text,
        evidence_items,
        checked_by_user_id,
        checked_at,
        expires_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now(),$11::timestamptz)
      ON CONFLICT (tenant_id, control_key)
      DO UPDATE
      SET
        status = EXCLUDED.status,
        what_text = EXCLUDED.what_text,
        why_text = EXCLUDED.why_text,
        fix_text = EXCLUDED.fix_text,
        owner = EXCLUDED.owner,
        retest_text = EXCLUDED.retest_text,
        evidence_items = EXCLUDED.evidence_items,
        checked_by_user_id = EXCLUDED.checked_by_user_id,
        checked_at = now(),
        expires_at = EXCLUDED.expires_at,
        updated_at = now()
    `,
    [
      auth.tenantId,
      input.controlKey,
      input.status,
      input.what ?? definition.what,
      input.why ?? definition.why,
      input.fix ?? definition.fix,
      input.owner ?? definition.owner,
      input.retest ?? definition.retest,
      JSON.stringify(input.evidenceItems ?? []),
      auth.id,
      input.expiresAt ?? null
    ]
  );

  return getMicrosoftSecurityTruthWorkspace(client, auth);
}

function statusRank(status: MicrosoftSecurityTruthStatus) {
  switch (status) {
    case "blocked":
      return 3;
    case "at_risk":
      return 2;
    default:
      return 1;
  }
}
