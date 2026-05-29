import { Router } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  assignClientOwner,
  attachClientContactRelationship,
  createClientAccount,
  createClientAccountNote,
  createClientAccountTask,
  createClientContact,
  createClientOrganization,
  getAccountCommunicationReadiness,
  getClientAccountDetail,
  listClientCommandCenter,
  upsertAccountService
} from "../services/clientCommandCenter.js";
import type { AuthenticatedRequest } from "../types/http.js";

const router = Router();

const nullableString = (max: number) => z.string().trim().max(max).nullable().optional();
const nullableUuid = z.string().uuid().nullable().optional();

const clientOrganizationTypeSchema = z.enum([
  "school_district",
  "league",
  "sports_association",
  "company",
  "nonprofit",
  "elementary_school",
  "middle_school",
  "high_school",
  "school",
  "studio_client",
  "corporate_client",
  "other"
]);

const lifecycleStatusSchema = z.enum(["active", "inactive", "prospect", "former_client", "archived"]);
const preferredContactMethodSchema = z.enum(["email", "phone", "text", "unknown"]);
const clientContactRoleSchema = z.enum([
  "primary_decision_maker",
  "principal",
  "head_secretary",
  "secretary_admin_assistant",
  "administrative_assistant",
  "athletic_director",
  "activities_director",
  "coach",
  "yearbook_contact",
  "picture_day_contact",
  "picture_day_prep_recipient",
  "day_before_reminder_recipient",
  "billing_contact",
  "gallery_recipient",
  "approval_contact",
  "contract_signer",
  "contract_recipient",
  "emergency_day_of_contact",
  "district_contact",
  "internal_employee",
  "photographer",
  "production_contact",
  "csr_account_owner",
  "primary_contact",
  "other"
]);
const smsConsentStatusSchema = z.enum(["unknown", "opted_in", "opted_out", "not_eligible"]);
const ownerTypeSchema = z.enum([
  "studio_bestie",
  "csr_owner",
  "department_owner",
  "sales_owner",
  "escalation_owner",
  "production_owner",
  "support_owner"
]);
const accountServiceTypeSchema = z.enum([
  "fall_pictures",
  "retakes",
  "spring_pictures",
  "graduation",
  "yearbook",
  "id_cards",
  "sports",
  "groups",
  "staff_photos",
  "studio_work",
  "corporate_headshots",
  "other"
]);
const accountServiceStatusSchema = z.enum(["active", "inactive", "seasonal", "unknown"]);
const communicationTypeSchema = z.enum([
  "new_client_onboarding",
  "picture_day_confirmation",
  "picture_day_prep",
  "reminder_email",
  "yearbook_deadline",
  "gallery_live",
  "retake_reminder",
  "missing_approval_followup",
  "post_shoot_thank_you",
  "issue_escalation"
]);
const workDepartmentSchema = z.enum(["schools", "sports", "photography", "production", "operations", "other"]);
const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);

const organizationCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(240),
    organization_type: clientOrganizationTypeSchema,
    status: lifecycleStatusSchema.optional(),
    phone: nullableString(80),
    website: nullableString(240),
    notes: nullableString(4000),
    external_code: nullableString(120)
  })
  .strict();

const accountCreateSchema = z
  .object({
    organization_id: nullableUuid,
    name: z.string().trim().min(1).max(240),
    account_type: clientOrganizationTypeSchema,
    status: lifecycleStatusSchema.optional(),
    main_phone: nullableString(80),
    office_phone: nullableString(80),
    website: nullableString(240),
    notes: nullableString(4000),
    external_code: nullableString(120)
  })
  .strict();

const contactCreateSchema = z
  .object({
    organization_id: nullableUuid,
    account_id: nullableUuid,
    first_name: z.string().trim().min(1).max(120),
    last_name: z.string().trim().min(1).max(120),
    display_name: nullableString(240),
    email: z.string().trim().email().max(320).nullable().optional(),
    phone: nullableString(80),
    mobile_phone: nullableString(80),
    office_phone: nullableString(80),
    title: nullableString(240),
    preferred_contact_method: preferredContactMethodSchema.optional(),
    allow_email: z.boolean().optional(),
    allow_sms: z.boolean().optional(),
    allow_phone: z.boolean().optional(),
    do_not_contact: z.boolean().optional(),
    sms_consent_status: smsConsentStatusSchema.optional(),
    sms_consent_source: nullableString(160),
    sms_consent_at: nullableString(80),
    sms_opted_out_at: nullableString(80),
    notes: nullableString(4000)
  })
  .strict()
  .refine((value) => Boolean(value.organization_id || value.account_id), {
    message: "organization_id or account_id is required",
    path: ["account_id"]
  });

const relationshipUpsertSchema = z
  .object({
    contact_id: z.string().uuid(),
    organization_id: nullableUuid,
    account_id: nullableUuid,
    roles: z.array(clientContactRoleSchema).min(1).max(12),
    is_primary: z.boolean().optional(),
    receives_picture_day_emails: z.boolean().optional(),
    receives_yearbook_emails: z.boolean().optional(),
    receives_billing_emails: z.boolean().optional(),
    receives_gallery_emails: z.boolean().optional(),
    receives_approval_emails: z.boolean().optional(),
    receives_onboarding_emails: z.boolean().optional(),
    receives_internal_escalations: z.boolean().optional(),
    notes: nullableString(4000)
  })
  .strict()
  .refine((value) => Boolean(value.organization_id || value.account_id), {
    message: "organization_id or account_id is required",
    path: ["account_id"]
  });

const ownerAssignSchema = z
  .object({
    organization_id: nullableUuid,
    account_id: nullableUuid,
    owner_user_id: z.string().uuid(),
    owner_type: ownerTypeSchema,
    notes: nullableString(4000)
  })
  .strict()
  .refine((value) => Boolean(value.organization_id || value.account_id), {
    message: "organization_id or account_id is required",
    path: ["account_id"]
  });

const accountServiceSchema = z
  .object({
    service_type: accountServiceTypeSchema,
    status: accountServiceStatusSchema.optional(),
    notes: nullableString(4000)
  })
  .strict();

const noteCreateSchema = z
  .object({
    summary: z.string().trim().min(1).max(4000),
    contact_id: nullableUuid
  })
  .strict();

const accountTaskCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    description: nullableString(4000),
    assigned_to_user_id: nullableUuid,
    due_at: nullableString(80),
    priority: prioritySchema.optional(),
    service_type: accountServiceTypeSchema.nullable().optional(),
    communication_type: communicationTypeSchema.nullable().optional(),
    contact_id: nullableUuid,
    related_job_id: nullableUuid,
    department_type: workDepartmentSchema.optional()
  })
  .strict();

router.get("/dashboard", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => listClientCommandCenter(client, auth));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/accounts/:accountId", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getClientAccountDetail(client, auth, String(req.params.accountId))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/accounts/:accountId/communication-readiness", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getAccountCommunicationReadiness(client, auth, String(req.params.accountId))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/organizations", requireAuth, validateBody(organizationCreateSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createClientOrganization(client, auth, req.body)
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/accounts", requireAuth, validateBody(accountCreateSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createClientAccount(client, auth, req.body)
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/contacts", requireAuth, validateBody(contactCreateSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => createClientContact(client, auth, req.body));
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/contact-relationships", requireAuth, validateBody(relationshipUpsertSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      attachClientContactRelationship(client, auth, req.body)
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/owners", requireAuth, validateBody(ownerAssignSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => assignClientOwner(client, auth, req.body));
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/accounts/:accountId/services", requireAuth, validateBody(accountServiceSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      upsertAccountService(client, auth, String(req.params.accountId), req.body)
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/accounts/:accountId/notes", requireAuth, validateBody(noteCreateSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createClientAccountNote(client, auth, String(req.params.accountId), req.body)
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/accounts/:accountId/tasks", requireAuth, validateBody(accountTaskCreateSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createClientAccountTask(client, auth, String(req.params.accountId), req.body)
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
