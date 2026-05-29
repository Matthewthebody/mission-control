import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireAction } from "../middleware/rbac.js";
import { requireElevatedSession } from "../middleware/security.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { withClientTransaction } from "../db/tx.js";
import {
  ALL_DEPARTMENTS,
  ALL_AUTHORITY_TIERS,
  ALL_JOB_FUNCTION_PROFILES,
  ALL_ROLE_CODES,
  approveMembership,
  inviteUser,
  listAuditLogs,
  listUsers,
  reactivateMembership,
  resendInvite,
  revokeMembership,
  suspendMembership,
  updateMembershipDepartment,
  updateMembershipRole
} from "../services/access.js";
import {
  linkMicrosoftIdentityReview,
  listMicrosoftIdentityReviews,
  rejectMicrosoftIdentityReview
} from "../services/microsoftEntra.js";
import {
  createDelegationRecord,
  createPermissionOverrideRecord,
  createUserRoleAssignment,
  expirePermissionOverrideRecord,
  expireUserRoleAssignment,
  getAccessPolicyWorkspace,
  previewAccessPolicy,
  revokeDelegationRecord,
  updateFieldVisibilityRule,
  updateSectionVisibilityRule
} from "../services/policy/index.js";
import { getConfiguredOperatingSystemAccessProfile } from "../services/operatingSystemAccess.js";
import type { AuthRole, AuthorityTier, DepartmentCode, JobFunctionProfile, MembershipStatus } from "../types/auth.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();
const roleEnum = z.enum(ALL_ROLE_CODES as [string, ...string[]]);
const authorityTierEnum = z.enum(ALL_AUTHORITY_TIERS as [string, ...string[]]);
const profileEnum = z.enum(ALL_JOB_FUNCTION_PROFILES as [string, ...string[]]);
const departmentEnum = z.enum(ALL_DEPARTMENTS as [string, ...string[]]);
const statusEnum = z.enum(["invited", "pending_approval", "active", "suspended", "revoked"]);
const policyScopeEnum = z.enum(["global", "department", "organization", "location", "owned", "assigned", "self", "team", "custom"]);
const policyEffectEnum = z.enum(["allow", "deny"]);
const visibilityStateEnum = z.enum(["hidden", "masked", "readonly", "editable"]);
const maskingStrategyEnum = z.enum(["partial_email", "partial_phone", "money_summary_only", "initials_only", "redacted_text", "none"]);

const authorityBodySchema = z
  .object({
    role: roleEnum.optional(),
    authority_tier: authorityTierEnum.optional(),
    primary_profile: profileEnum.optional(),
    job_function_profiles: z.array(profileEnum).optional(),
    reason: z.string().max(500).optional()
  })
  .refine((value) => Boolean(value.role || (value.authority_tier && value.primary_profile)), {
    message: "Provide a compatibility role or an authority tier plus primary profile"
  });

const policyAssignmentSchema = z.object({
  user_id: z.string().uuid(),
  role_code: z.string().trim().min(1).max(120),
  scope_type: policyScopeEnum,
  scope_value: z.string().trim().max(120).nullable().optional(),
  starts_at: z.string().trim().max(64).nullable().optional(),
  ends_at: z.string().trim().max(64).nullable().optional(),
  reason: z.string().trim().max(1000).nullable().optional()
});

const policyOverrideSchema = z.object({
  user_id: z.string().uuid(),
  permission_code: z.string().trim().min(1).max(160),
  scope_type: policyScopeEnum,
  scope_value: z.string().trim().max(120).nullable().optional(),
  effect: policyEffectEnum,
  starts_at: z.string().trim().max(64).nullable().optional(),
  ends_at: z.string().trim().max(64).nullable().optional(),
  reason: z.string().trim().min(1).max(1000)
});

const delegationSchema = z.object({
  from_user_id: z.string().uuid(),
  to_user_id: z.string().uuid(),
  role_code: z.string().trim().max(120).nullable().optional(),
  permission_bundle_key: z.string().trim().max(120).nullable().optional(),
  scope_type: policyScopeEnum,
  scope_value: z.string().trim().max(120).nullable().optional(),
  starts_at: z.string().trim().min(1).max(64),
  ends_at: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(1).max(1000)
});

const expireReasonSchema = z.object({
  reason: z.string().trim().max(1000).nullable().optional()
});

const fieldRuleUpdateSchema = z.object({
  required_permission_code: z.string().trim().max(160).nullable().optional(),
  default_visibility: visibilityStateEnum,
  masking_strategy: maskingStrategyEnum.nullable().optional()
});

const sectionRuleUpdateSchema = z.object({
  required_permission_code: z.string().trim().max(160).nullable().optional(),
  default_visibility: visibilityStateEnum
});

const microsoftReviewLinkSchema = z.object({
  user_id: z.string().uuid(),
  note: z.string().trim().max(1000).optional()
});

const microsoftReviewRejectSchema = z.object({
  reason: z.string().trim().min(1).max(1000)
});

const previewSchema = z.object({
  target_user_id: z.string().uuid(),
  route_id: z.string().trim().max(120).nullable().optional(),
  resource_type: z.string().trim().max(120).nullable().optional(),
  resource_id: z.string().trim().max(120).nullable().optional(),
  permission_keys: z.array(z.string().trim().min(1).max(160)).optional(),
  context: z
    .object({
      departmentType: z.string().trim().max(40).nullable().optional(),
      organizationId: z.string().uuid().nullable().optional(),
      locationId: z.string().uuid().nullable().optional(),
      ownerUserIds: z.array(z.string().uuid()).optional(),
      assignedUserIds: z.array(z.string().uuid()).optional(),
      targetUserId: z.string().uuid().nullable().optional(),
      customScopeValues: z.array(z.string().trim().max(120)).optional()
    })
    .optional()
});

router.get("/operating-system", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getConfiguredOperatingSystemAccessProfile(client, auth)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/policy/workspace", requireAuth, requirePermission("settings.permissions.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const workspace = await withClientTransaction(auth.tenantId, auth.id, (client) => getAccessPolicyWorkspace(client, auth));
    return res.json(workspace);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/policy/assignments",
  requireAuth,
  requirePermission("settings.roles.manage"),
  requireElevatedSession,
  validateBody(policyAssignmentSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createUserRoleAssignment(client, auth, {
          userId: req.body.user_id,
          roleCode: req.body.role_code,
          scopeType: req.body.scope_type,
          scopeValue: req.body.scope_value ?? null,
          startsAt: req.body.starts_at ?? null,
          endsAt: req.body.ends_at ?? null,
          reason: req.body.reason ?? null
        })
      );
      return res.status(201).json({ ok: true });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/policy/assignments/:assignmentId/expire",
  requireAuth,
  requirePermission("settings.roles.manage"),
  requireElevatedSession,
  validateBody(expireReasonSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      await withClientTransaction(auth.tenantId, auth.id, (client) =>
        expireUserRoleAssignment(client, auth, String(req.params.assignmentId), req.body.reason ?? null)
      );
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/policy/overrides",
  requireAuth,
  requirePermission("settings.permissions.manage"),
  requireElevatedSession,
  validateBody(policyOverrideSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createPermissionOverrideRecord(client, auth, {
          userId: req.body.user_id,
          permissionCode: req.body.permission_code,
          scopeType: req.body.scope_type,
          scopeValue: req.body.scope_value ?? null,
          effect: req.body.effect,
          startsAt: req.body.starts_at ?? null,
          endsAt: req.body.ends_at ?? null,
          reason: req.body.reason
        })
      );
      return res.status(201).json({ ok: true });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/policy/overrides/:overrideId/expire",
  requireAuth,
  requirePermission("settings.permissions.manage"),
  requireElevatedSession,
  validateBody(expireReasonSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      await withClientTransaction(auth.tenantId, auth.id, (client) =>
        expirePermissionOverrideRecord(client, auth, String(req.params.overrideId), req.body.reason ?? null)
      );
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/policy/delegations",
  requireAuth,
  requirePermission("settings.delegations.manage"),
  requireElevatedSession,
  validateBody(delegationSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createDelegationRecord(client, auth, {
          fromUserId: req.body.from_user_id,
          toUserId: req.body.to_user_id,
          roleCode: req.body.role_code ?? null,
          permissionBundleKey: req.body.permission_bundle_key ?? null,
          scopeType: req.body.scope_type,
          scopeValue: req.body.scope_value ?? null,
          startsAt: req.body.starts_at,
          endsAt: req.body.ends_at,
          reason: req.body.reason
        })
      );
      return res.status(201).json({ ok: true });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/policy/delegations/:delegationId/revoke",
  requireAuth,
  requirePermission("settings.delegations.manage"),
  requireElevatedSession,
  validateBody(expireReasonSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      await withClientTransaction(auth.tenantId, auth.id, (client) =>
        revokeDelegationRecord(client, auth, String(req.params.delegationId), req.body.reason ?? null)
      );
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/policy/field-rules/:ruleId",
  requireAuth,
  requirePermission("settings.field_policies.manage"),
  requireElevatedSession,
  validateBody(fieldRuleUpdateSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateFieldVisibilityRule(client, auth, String(req.params.ruleId), {
          requiredPermissionCode: req.body.required_permission_code ?? null,
          defaultVisibility: req.body.default_visibility,
          maskingStrategy: req.body.masking_strategy ?? null
        })
      );
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/policy/section-rules/:ruleId",
  requireAuth,
  requirePermission("settings.field_policies.manage"),
  requireElevatedSession,
  validateBody(sectionRuleUpdateSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateSectionVisibilityRule(client, auth, String(req.params.ruleId), {
          requiredPermissionCode: req.body.required_permission_code ?? null,
          defaultVisibility: req.body.default_visibility
        })
      );
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/policy/preview",
  requireAuth,
  requirePermission("access_preview.use"),
  validateBody(previewSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const preview = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        previewAccessPolicy(client, auth, {
          targetUserId: req.body.target_user_id,
          routeId: req.body.route_id ?? null,
          resourceType: req.body.resource_type ?? null,
          resourceId: req.body.resource_id ?? null,
          permissionKeys: req.body.permission_keys,
          context: req.body.context
        })
      );
      return res.json(preview);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/users",
  requireAuth,
  requireAction("user.read"),
  validateQuery(
    z.object({
      status: statusEnum.optional(),
      role: roleEnum.optional(),
      authority_tier: authorityTierEnum.optional(),
      profile: profileEnum.optional(),
      department: departmentEnum.optional(),
      search: z.string().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const users = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listUsers(client, auth.tenantId, {
          status: req.query.status as MembershipStatus | undefined,
          role: req.query.role as AuthRole | undefined,
          authorityTier: req.query.authority_tier ? (String(req.query.authority_tier) as AuthorityTier) : undefined,
          profile: req.query.profile ? (String(req.query.profile) as JobFunctionProfile) : undefined,
          department: req.query.department as DepartmentCode | undefined,
          search: req.query.search ? String(req.query.search) : undefined
        })
      );
      return res.json(users);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/microsoft-identities/reviews", requireAuth, requireAction("user.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const reviews = await withClientTransaction(auth.tenantId, auth.id, (client) => listMicrosoftIdentityReviews(client, auth));
    return res.json(reviews);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/microsoft-identities/reviews/:id/link",
  requireAuth,
  requireAction("user.approve"),
  requireElevatedSession,
  validateBody(microsoftReviewLinkSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      await withClientTransaction(auth.tenantId, auth.id, (client) =>
        linkMicrosoftIdentityReview(
          client,
          auth,
          {
            reviewId: String(req.params.id),
            targetUserId: req.body.user_id,
            note: req.body.note ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/microsoft-identities/reviews/:id/reject",
  requireAuth,
  requireAction("user.approve"),
  requireElevatedSession,
  validateBody(microsoftReviewRejectSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      await withClientTransaction(auth.tenantId, auth.id, (client) =>
        rejectMicrosoftIdentityReview(
          client,
          auth,
          {
            reviewId: String(req.params.id),
            reason: req.body.reason
          },
          getRequestMeta(req)
        )
      );
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/invites",
  requireAuth,
  requireAction("user.invite"),
  requireElevatedSession,
  validateBody(
    z.object({
      email: z.string().email(),
      full_name: z.string().optional(),
      role: roleEnum.optional(),
      authority_tier: authorityTierEnum.optional(),
      primary_profile: profileEnum.optional(),
      job_function_profiles: z.array(profileEnum).optional(),
      department: departmentEnum
    }).refine((value) => Boolean(value.role || (value.authority_tier && value.primary_profile)), {
      message: "Provide a compatibility role or an authority tier plus primary profile"
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        inviteUser(
          client,
          auth,
          {
            email: req.body.email,
            fullName: req.body.full_name,
            role: req.body.role,
            authorityTier: req.body.authority_tier,
            primaryProfile: req.body.primary_profile,
            jobFunctionProfiles: req.body.job_function_profiles,
            department: req.body.department
          },
          getRequestMeta(req)
        )
      );
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/:inviteId/resend", requireAuth, requireAction("user.invite"), requireElevatedSession, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      resendInvite(client, auth, String(req.params.inviteId), getRequestMeta(req))
    );
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/memberships/:id/approve",
  requireAuth,
  requireAction("user.approve"),
  requireElevatedSession,
  validateBody(
    z
      .object({
        role: roleEnum.optional(),
        authority_tier: authorityTierEnum.optional(),
        primary_profile: profileEnum.optional(),
        job_function_profiles: z.array(profileEnum).optional(),
        department: departmentEnum
      })
      .refine((value) => Boolean(value.role || (value.authority_tier && value.primary_profile)), {
        message: "Provide a compatibility role or an authority tier plus primary profile"
      })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      await withClientTransaction(auth.tenantId, auth.id, (client) =>
        approveMembership(
          client,
          auth,
          String(req.params.id),
          {
            role: req.body.role,
            authorityTier: req.body.authority_tier,
            primaryProfile: req.body.primary_profile,
            jobFunctionProfiles: req.body.job_function_profiles,
            department: req.body.department
          },
          getRequestMeta(req)
        )
      );
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/memberships/:id/role",
  requireAuth,
  requireAction("user.role.update"),
  requireElevatedSession,
  validateBody(authorityBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateMembershipRole(
          client,
          auth,
          String(req.params.id),
          {
            role: req.body.role,
            authorityTier: req.body.authority_tier,
            primaryProfile: req.body.primary_profile,
            jobFunctionProfiles: req.body.job_function_profiles,
            reason: req.body.reason
          },
          getRequestMeta(req)
        )
      );
      if (result.outcome === "pending_approval") {
        return res.status(202).json({
          ok: true,
          status: "pending_approval",
          approval_request_id: result.approvalRequestId,
          required_approver_tier: result.requiredApproverTier
        });
      }
      return res.json({ ok: true, status: "updated" });
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/memberships/:id/department",
  requireAuth,
  requireAction("user.department.update"),
  requireElevatedSession,
  validateBody(z.object({ department: departmentEnum })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateMembershipDepartment(client, auth, String(req.params.id), req.body.department, getRequestMeta(req))
      );
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/memberships/:id/suspend", requireAuth, requireAction("user.suspend"), requireElevatedSession, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    await withClientTransaction(auth.tenantId, auth.id, (client) =>
      suspendMembership(client, auth, String(req.params.id), getRequestMeta(req))
    );
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/memberships/:id/reactivate", requireAuth, requireAction("user.reactivate"), requireElevatedSession, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    await withClientTransaction(auth.tenantId, auth.id, (client) =>
      reactivateMembership(client, auth, String(req.params.id), getRequestMeta(req))
    );
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/memberships/:id/revoke", requireAuth, requireAction("user.revoke"), requireElevatedSession, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    await withClientTransaction(auth.tenantId, auth.id, (client) =>
      revokeMembership(client, auth, String(req.params.id), getRequestMeta(req))
    );
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/audit-logs",
  requireAuth,
  requireAction("audit.read"),
  validateQuery(
    z.object({
      actor_user_id: z.string().uuid().optional(),
      target_user_id: z.string().uuid().optional(),
      action: z.string().optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const rows = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listAuditLogs(client, auth.tenantId, {
          actorUserId: req.query.actor_user_id ? String(req.query.actor_user_id) : undefined,
          targetUserId: req.query.target_user_id ? String(req.query.target_user_id) : undefined,
          action: req.query.action ? String(req.query.action) : undefined,
          dateFrom: req.query.date_from ? String(req.query.date_from) : undefined,
          dateTo: req.query.date_to ? String(req.query.date_to) : undefined
        })
      );
      return res.json(rows);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
