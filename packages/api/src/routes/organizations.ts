import { Router } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { applyContactImportSessionAction } from "../application/directory/apply-contact-import-session.action.js";
import { createContactImportSessionAction } from "../application/directory/create-contact-import-session.action.js";
import { getContactImportSessionAction } from "../application/directory/get-contact-import-session.action.js";
import { listContactImportSessionsAction } from "../application/directory/list-contact-import-sessions.action.js";
import { updateContactImportRowAction } from "../application/directory/update-contact-import-row.action.js";
import { loadOrganizationOperationsHub } from "../application/organizations/load-organization-operations-hub.action.js";
import {
  requireCanonicalDirectoryManageAccess,
  requireCanonicalDirectoryReadAccess,
  requireSchoolFoundationManageAccess
} from "../middleware/directoryAccess.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  attachContactToLocation,
  attachContactToOrganization,
  attachContactToShoot,
  createOrganization,
  createOrganizationContact,
  createOrganizationLocation,
  createDirectoryDuplicateReview,
  detachContactFromLocation,
  detachContactFromShoot,
  createSchoolNote,
  createSchoolRule,
  getDirectoryContactDetail,
  getOrganizationDetail,
  listContactTouchpoints,
  listDirectoryDuplicateReviews,
  listDirectoryContacts,
  listDirectoryLocations,
  listCanonicalDistricts,
  listDirectoryOwnerOptions,
  listOrganizationTouchpoints,
  listOrganizations,
  setOrganizationContactActiveStatus,
  setOrganizationLocationActiveStatus,
  updateSchoolContactCategories,
  updateSchoolProfile,
  updateSchoolRule,
  updateDirectoryDuplicateReview,
  updateOrganization,
  updateOrganizationContact,
  updateOrganizationLocation
} from "../services/organizations.js";
import {
  listSchoolServiceTerms,
  createSchoolServiceTerm,
  rolloverSchoolServiceTerm,
  setCurrentSchoolServiceTerm,
  updateSchoolServiceTerm
} from "../services/schoolServiceTerm.js";
import {
  createCanonicalContact,
  linkContactToOrganization,
  getContactRelationships,
  backfillContactIdentities
} from "../services/canonicalContacts.js";
import { updateOrganizationBrand, getLogoHistory, restoreOrganizationLogo } from "../services/organizationBrand.js";
import { reconcileDistricts } from "../services/directoryReconciliation.js";
import {
  createDirectoryCommunicationLog,
  createDirectoryRelationshipFollowUp,
  createDirectoryRelationshipMemory,
  createDirectoryTouchpointPlan,
  getContactRelationshipContinuity,
  getOrganizationRelationshipContinuity,
  updateDirectoryRelationshipFollowUp,
  updateDirectoryRelationshipMemory,
  updateDirectoryTouchpointPlan
} from "../services/relationshipContinuity.js";
import {
  createAgreement,
  createAgreementFromTemplate,
  createAgreementRenewalDraft,
  createAgreementTemplate,
  registerAgreementFile,
  sendAgreementForSignature,
  sendAgreementReminder,
  syncAgreementProviderStatus,
  updateAgreement
} from "../services/agreements.js";
import type {
  DirectoryActiveStatus,
  DirectoryCommunicationOutcome,
  DirectoryContactRoleCategory,
  DirectoryContactStatus,
  DirectoryDecisionInfluence,
  DirectoryOperationalImportance,
  DirectoryRelationshipMemoryType,
  DirectoryRelationshipMemoryVisibility,
  DirectoryRelationshipOwnershipState,
  DirectoryRelationshipStrength,
  DirectoryTouchpointCategory,
  OrganizationAccountType
} from "../types/organizations.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();

const accountTypeSchema = z.enum([
  "schools_underclass_portraits",
  "schools_events",
  "sports",
  "events",
  "studio",
  "headshots",
  "commercial",
  "internal"
]);

const activeStatusSchema = z.enum(["active", "inactive"]);
const contactStatusSchema = z.enum(["active", "needs_review", "inactive", "archived"]);
const contactRoleCategorySchema = z.enum([
  "district_leadership",
  "school_leadership",
  "school_administration",
  "yearbook_publications",
  "athletics_activities",
  "day_of_logistics",
  "data_roster",
  "finance_billing",
  "technology_systems",
  "front_office_secretary",
  "facilities_building_access",
  "vendor_external_partner",
  "other"
]);
const decisionInfluenceSchema = z.enum([
  "decision_maker",
  "approver",
  "recommender",
  "gatekeeper",
  "day_to_day_operator",
  "logistics_owner",
  "billing_owner",
  "informational_only"
]);
const operationalImportanceSchema = z.enum(["critical", "high", "normal", "low"]);
const relationshipStrengthSchema = z.enum([
  "introduced",
  "working_relationship",
  "strong_relationship",
  "trusted_relationship",
  "unknown"
]);
const relationshipOwnershipStateSchema = z.enum(["owned", "shared", "unassigned", "needs_reassignment"]);
const relationshipRoleSchema = z.enum(["general", "planning", "billing", "decision_maker", "day_of", "operations", "other"]);
const touchpointChannelSchema = z.enum([
  "call",
  "email",
  "text",
  "meeting",
  "onsite",
  "note",
  "picture_day_conversation",
  "internal_debrief",
  "portal_message",
  "other"
]);
const touchpointCategorySchema = z.enum([
  "planning",
  "pre_shoot_confirmation",
  "day_of_readiness",
  "post_shoot_follow_up",
  "yearbook_deliverables",
  "customer_issue_resolution",
  "relationship_maintenance",
  "renewal_contract",
  "billing_finance",
  "operational_change",
  "thank_you_appreciation",
  "executive_leadership_checkin"
]);
const communicationOutcomeSchema = z.enum([
  "informational_only",
  "confirmed",
  "waiting_on_customer",
  "waiting_on_internal_team",
  "follow_up_needed",
  "resolved",
  "escalated",
  "relationship_building",
  "problem_identified"
]);
const touchpointPlanStatusSchema = z.enum(["planned", "completed", "skipped", "cancelled"]);
const relationshipMemoryTypeSchema = z.enum([
  "communication_preference",
  "operational_expectation",
  "cadence_timing_preference",
  "escalation_preference",
  "day_of_coordination_preference",
  "yearbook_deliverable_preference",
  "relationship_sensitivity",
  "appreciation_hospitality_note",
  "other"
]);
const relationshipMemoryVisibilitySchema = z.enum(["assignment_relevant", "manager_plus", "leadership_only"]);
const relationshipMemoryStatusSchema = z.enum(["active", "needs_review", "archived"]);
const relationshipFollowUpStatusSchema = z.enum(["open", "in_progress", "completed", "cancelled"]);
const duplicateReviewStatusSchema = z.enum(["open", "resolved", "dismissed"]);
const duplicateReviewDecisionSchema = z.enum(["pending", "keep_separate", "merge_candidate", "merged_later"]);
const schoolRelationshipHealthStateSchema = z.enum(["healthy", "needs_attention", "fragile", "at_risk", "unknown"]);
const schoolContactCategorySchema = z.enum([
  "principal",
  "secretary",
  "district_contact",
  "photo_day_contact",
  "yearbook_contact",
  "billing_contact",
  "athletics_contact",
  "graduation_contact",
  "other"
]);
const schoolRuleTypeSchema = z.enum([
  "additional_language_needs",
  "qr_organization_rules",
  "hat_policy",
  "additional_shoot_rules",
  "punch_id_rules",
  "sticker_counts",
  "subject_directory_requirements",
  "subject_directory_counts",
  "yearbook_participation",
  "delivery_preferences",
  "mailing_preferences",
  "special_handling"
]);
const agreementTypeSchema = z.enum(["schools", "sports", "events", "studio_client", "nda", "image_release"]);
const agreementStatusSchema = z.enum([
  "draft",
  "sent",
  "viewed",
  "partially_signed",
  "signed",
  "countersigned",
  "active",
  "expiring_soon",
  "expired",
  "replaced",
  "cancelled"
]);
const agreementFileTypeSchema = z.enum(["pdf", "image", "document", "other"]);
const agreementSignerTypeSchema = z.enum(["external", "internal", "countersigner"]);
const agreementSignerStatusSchema = z.enum(["pending", "viewed", "signed", "replaced", "cancelled"]);
const agreementVersionStageSchema = z.enum(["draft", "revised", "signed", "countersigned_final", "legacy_import"]);
const agreementReminderTypeSchema = z.enum([
  "unsigned_3_day",
  "unsigned_7_day",
  "unsigned_30_day",
  "expiration_6_month",
  "expiration_90_day",
  "expiration_30_day",
  "manual_follow_up"
]);
const agreementReminderChannelSchema = z.enum(["email", "internal_notice"]);
const agreementProviderNameSchema = z.enum(["provider_stub", "dropbox_sign"]);
const dateStringSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
const dateTimeStringSchema = z.string().trim().datetime();
const agreementSignerSchema = z.object({
  contact_id: z.string().uuid().optional().nullable(),
  signer_name: z.string().trim().min(1).max(180),
  signer_email: z.string().trim().email().max(180).optional().nullable(),
  signer_role: z.string().trim().max(160).optional().nullable(),
  signer_order: z.number().int().min(1).max(24).optional().nullable(),
  signer_type: agreementSignerTypeSchema,
  status: agreementSignerStatusSchema.optional(),
  viewed_at: dateTimeStringSchema.optional().nullable(),
  signed_at: dateTimeStringSchema.optional().nullable()
});

const listQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  account_type: accountTypeSchema.optional(),
  active_status: activeStatusSchema.optional()
});

const contactListQuerySchema = listQuerySchema.extend({
  organization_id: z.string().uuid().optional(),
  location_id: z.string().uuid().optional(),
  contact_status: contactStatusSchema.optional(),
  role_category: contactRoleCategorySchema.optional(),
  operational_importance: operationalImportanceSchema.optional(),
  decision_influence: decisionInfluenceSchema.optional(),
  primary_internal_owner_user_id: z.string().uuid().optional(),
  relationship_ownership_state: relationshipOwnershipStateSchema.optional(),
  has_photo: z.enum(["true", "false"]).optional(),
  has_logo: z.enum(["true", "false"]).optional(),
  needs_review: z.enum(["true", "false"]).optional(),
  my_contacts_only: z.enum(["true", "false"]).optional()
});

const clientEntityKindSchema = z.enum(["account", "parent_organization"]);
const clientOrganizationTypeSchema = z.enum([
  "school_district",
  "elementary_school",
  "middle_school",
  "high_school",
  "school",
  "league",
  "sports_association",
  "company",
  "nonprofit",
  "studio_client",
  "corporate_client",
  "other"
]);

const createOrganizationSchema = z.object({
  canonical_name: z.string().trim().min(2).max(180),
  display_name: z.string().trim().min(2).max(180).optional().nullable(),
  logo_url: z.string().trim().url().max(500).optional().nullable(),
  account_type: accountTypeSchema,
  active_status: activeStatusSchema.optional(),
  aliases: z.array(z.string().trim().min(2).max(160)).max(12).optional(),
  notes: z.string().trim().max(4000).optional().nullable(),
  // Phase 4 canonical hierarchy + client fields. website is stored as entered here;
  // full website normalization arrives in the brand slice.
  parent_organization_id: z.string().uuid().optional().nullable(),
  client_entity_kind: clientEntityKindSchema.optional().nullable(),
  client_organization_type: clientOrganizationTypeSchema.optional().nullable(),
  website: z.string().trim().max(500).optional().nullable(),
  main_phone: z.string().trim().max(40).optional().nullable()
});

const createContactSchema = z.object({
  first_name: z.string().trim().min(1).max(120),
  last_name: z.string().trim().min(1).max(120),
  preferred_name: z.string().trim().max(120).optional().nullable(),
  title: z.string().trim().max(160).optional().nullable(),
  department_program: z.string().trim().max(160).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().max(180).optional().nullable(),
  photo_url: z.string().trim().url().max(500).optional().nullable(),
  active_status: activeStatusSchema.optional(),
  contact_status: contactStatusSchema.optional(),
  role_category: contactRoleCategorySchema.optional(),
  operational_importance: operationalImportanceSchema.optional(),
  decision_influence: decisionInfluenceSchema.optional(),
  primary_internal_owner_user_id: z.string().uuid().optional().nullable(),
  backup_internal_owner_user_id: z.string().uuid().optional().nullable(),
  relationship_strength: relationshipStrengthSchema.optional(),
  handoff_ready: z.boolean().optional().nullable(),
  last_confirmed_at: dateStringSchema.optional().nullable(),
  uncertainty_flag: z.boolean().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable()
});

const createLocationSchema = z.object({
  location_name: z.string().trim().min(2).max(180),
  address_line_1: z.string().trim().min(2).max(180),
  address_line_2: z.string().trim().max(180).optional().nullable(),
  city: z.string().trim().min(2).max(120),
  state: z.string().trim().min(2).max(20),
  zip: z.string().trim().min(3).max(20),
  maps_label: z.string().trim().max(240).optional().nullable(),
  active_status: activeStatusSchema.optional(),
  notes: z.string().trim().max(3000).optional().nullable()
});

const updateOrganizationSchema = createOrganizationSchema.partial().refine(
  (value) => Object.values(value).some((item) => item !== undefined),
  "Provide at least one Organization field to update"
);

const updateContactSchema = createContactSchema
  .omit({ active_status: true })
  .partial()
  .refine((value) => Object.values(value).some((item) => item !== undefined), "Provide at least one Contact field to update");

const updateLocationSchema = createLocationSchema
  .omit({ active_status: true })
  .partial()
  .refine((value) => Object.values(value).some((item) => item !== undefined), "Provide at least one Location field to update");

const structuredValueSchema = z.record(z.string(), z.unknown());

const updateSchoolProfileSchema = z
  .object({
    district_name: z.string().trim().max(180).optional().nullable(),
    school_type: z.string().trim().max(120).optional().nullable(),
    school_year_label: z.string().trim().max(60).optional().nullable(),
    primary_internal_owner_user_id: z.string().uuid().optional().nullable(),
    backup_internal_owner_user_id: z.string().uuid().optional().nullable(),
    relationship_health_state: schoolRelationshipHealthStateSchema.optional().nullable(),
    relationship_summary: z.string().trim().max(1200).optional().nullable(),
    primary_location_id: z.string().uuid().optional().nullable(),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    notes: z.string().trim().max(4000).optional().nullable()
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), "Provide at least one school field to update");

const updateSchoolContactCategoriesSchema = z.object({
  school_contact_categories: z.array(schoolContactCategorySchema).max(8)
});

const createSchoolRuleSchema = z.object({
  rule_type: schoolRuleTypeSchema,
  title: z.string().trim().max(180).optional().nullable(),
  summary: z.string().trim().max(2000).optional().nullable(),
  active_status: activeStatusSchema.optional(),
  structured_value: structuredValueSchema.optional().nullable(),
  sort_order: z.number().int().min(0).max(999).optional().nullable()
});

const updateSchoolRuleSchema = z
  .object({
    title: z.string().trim().max(180).optional().nullable(),
    summary: z.string().trim().max(2000).optional().nullable(),
    active_status: activeStatusSchema.optional().nullable(),
    structured_value: structuredValueSchema.optional().nullable(),
    sort_order: z.number().int().min(0).max(999).optional().nullable()
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), "Provide at least one rule field to update");

const createSchoolNoteSchema = z.object({
  summary: z.string().trim().min(1).max(180),
  detail: z.string().trim().max(4000).optional().nullable()
});

const relationshipAttachSchema = z.object({
  contact_id: z.string().uuid(),
  relationship_role: relationshipRoleSchema.optional(),
  is_primary: z.boolean().optional(),
  start_date: dateStringSchema.optional().nullable(),
  end_date: dateStringSchema.optional().nullable(),
  is_current: z.boolean().optional()
});

const importColumnMappingSchema = z
  .object({
    first_name: z.string().trim().min(1).max(120).optional().nullable(),
    last_name: z.string().trim().min(1).max(120).optional().nullable(),
    preferred_name: z.string().trim().min(1).max(120).optional().nullable(),
    title: z.string().trim().min(1).max(120).optional().nullable(),
    email: z.string().trim().min(1).max(120).optional().nullable(),
    phone: z.string().trim().min(1).max(120).optional().nullable(),
    organization_name: z.string().trim().min(1).max(120).optional().nullable(),
    organization_type: z.string().trim().min(1).max(120).optional().nullable(),
    relationship_role: z.string().trim().min(1).max(120).optional().nullable(),
    notes: z.string().trim().min(1).max(120).optional().nullable(),
    start_date: z.string().trim().min(1).max(120).optional().nullable(),
    end_date: z.string().trim().min(1).max(120).optional().nullable(),
    current_flag: z.string().trim().min(1).max(120).optional().nullable()
  })
  .partial();

const createContactImportSessionSchema = z.object({
  source_file_name: z.string().trim().min(1).max(260),
  csv_text: z.string().min(1).max(2_000_000),
  has_header_row: z.boolean().optional(),
  default_organization_id: z.string().uuid().optional().nullable(),
  column_mapping: importColumnMappingSchema.optional()
});

const updateContactImportRowSchema = z
  .object({
    selected_action: z.enum(["create_contact", "link_existing", "skip", "needs_review"]).optional().nullable(),
    selected_contact_id: z.string().uuid().optional().nullable(),
    resolved_organization_id: z.string().uuid().optional().nullable(),
    review_note: z.string().trim().max(1000).optional().nullable()
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), "Provide at least one import row decision to update");

const applyContactImportSessionSchema = z.object({
  rows: z
    .array(
      z.object({
        row_id: z.string().uuid(),
        selected_action: z.enum(["create_contact", "link_existing", "skip", "needs_review"]).optional().nullable(),
        selected_contact_id: z.string().uuid().optional().nullable(),
        resolved_organization_id: z.string().uuid().optional().nullable(),
        review_note: z.string().trim().max(1000).optional().nullable()
      })
    )
    .max(500)
    .optional()
});

const touchpointCreateSchema = z.object({
  contact_id: z.string().uuid().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  shoot_id: z.string().uuid().optional().nullable(),
  channel: touchpointChannelSchema,
  category: touchpointCategorySchema.optional().nullable(),
  subject: z.string().trim().max(200).optional().nullable(),
  summary: z.string().trim().min(1).max(2000),
  outcome: z.string().trim().max(2000).optional().nullable(),
  outcome_state: communicationOutcomeSchema.optional().nullable(),
  owner_user_id: z.string().uuid().optional().nullable(),
  occurred_at: dateTimeStringSchema.optional().nullable(),
  follow_up_date: dateStringSchema.optional().nullable(),
  follow_up_needed: z.boolean().optional(),
  follow_up_owner_user_id: z.string().uuid().optional().nullable(),
  relationship_memory_suggested: z.boolean().optional(),
  attachment_reference: z.string().trim().max(1000).optional().nullable(),
  touchpoint_plan_id: z.string().uuid().optional().nullable(),
  memory_type: relationshipMemoryTypeSchema.optional().nullable(),
  memory_summary: z.string().trim().max(400).optional().nullable(),
  memory_why_it_matters: z.string().trim().max(2000).optional().nullable(),
  memory_visibility: relationshipMemoryVisibilitySchema.optional().nullable()
});

const touchpointPlanCreateSchema = z.object({
  template_id: z.string().uuid().optional().nullable(),
  contact_id: z.string().uuid().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  linked_shoot_id: z.string().uuid().optional().nullable(),
  category: touchpointCategorySchema,
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(2000).optional().nullable(),
  owner_user_id: z.string().uuid().optional().nullable(),
  backup_owner_user_id: z.string().uuid().optional().nullable(),
  due_at: dateTimeStringSchema
});

const touchpointPlanUpdateSchema = z
  .object({
    status: touchpointPlanStatusSchema.optional(),
    completion_note: z.string().trim().max(2000).optional().nullable(),
    skipped_reason: z.string().trim().max(500).optional().nullable(),
    cancelled_reason: z.string().trim().max(500).optional().nullable()
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), "Provide at least one touchpoint plan field to update");

const relationshipMemoryCreateSchema = z.object({
  contact_id: z.string().uuid().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  source_touchpoint_id: z.string().uuid().optional().nullable(),
  memory_type: relationshipMemoryTypeSchema,
  summary: z.string().trim().min(1).max(400),
  why_it_matters: z.string().trim().min(1).max(2000),
  source_label: z.string().trim().max(200).optional().nullable(),
  visibility: relationshipMemoryVisibilitySchema.optional().nullable(),
  last_confirmed_at: dateStringSchema.optional().nullable()
});

const relationshipMemoryUpdateSchema = z
  .object({
    status: relationshipMemoryStatusSchema.optional(),
    last_confirmed_at: dateStringSchema.optional().nullable()
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), "Provide at least one relationship memory field to update");

const relationshipFollowUpCreateSchema = z.object({
  contact_id: z.string().uuid().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  linked_shoot_id: z.string().uuid().optional().nullable(),
  source_touchpoint_id: z.string().uuid().optional().nullable(),
  source_touchpoint_plan_id: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(2000).optional().nullable(),
  owner_user_id: z.string().uuid().optional().nullable(),
  backup_owner_user_id: z.string().uuid().optional().nullable(),
  due_at: dateTimeStringSchema
});

const relationshipFollowUpUpdateSchema = z
  .object({
    status: relationshipFollowUpStatusSchema.optional(),
    resolution_note: z.string().trim().max(2000).optional().nullable()
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), "Provide at least one follow-up field to update");

const duplicateReviewCreateSchema = z.object({
  primary_contact_id: z.string().uuid(),
  suspected_duplicate_contact_id: z.string().uuid(),
  summary: z.string().trim().min(1).max(1000),
  notes: z.string().trim().max(2000).optional().nullable()
});

const duplicateReviewUpdateSchema = z
  .object({
    status: duplicateReviewStatusSchema.optional(),
    decision: duplicateReviewDecisionSchema.optional(),
    notes: z.string().trim().max(2000).optional().nullable()
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), "Provide at least one duplicate review field to update");

const createAgreementSchema = z.object({
  agreement_title: z.string().trim().min(2).max(240),
  agreement_type: agreementTypeSchema,
  status: agreementStatusSchema.optional(),
  primary_contact_id: z.string().uuid().optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  contract_value: z.number().min(0).max(100000000).optional().nullable(),
  revenue_share_terms: z.string().trim().max(4000).optional().nullable(),
  effective_date: dateStringSchema.optional().nullable(),
  expiration_date: dateStringSchema.optional().nullable(),
  renewal_date: dateStringSchema.optional().nullable(),
  notice_deadline: dateStringSchema.optional().nullable(),
  auto_renew: z.boolean().optional().nullable(),
  sent_at: dateTimeStringSchema.optional().nullable(),
  viewed_at: dateTimeStringSchema.optional().nullable(),
  signed_at: dateTimeStringSchema.optional().nullable(),
  countersigned_at: dateTimeStringSchema.optional().nullable(),
  prior_agreement_id: z.string().uuid().optional().nullable(),
  replaced_by_agreement_id: z.string().uuid().optional().nullable(),
  source_template_id: z.string().uuid().optional().nullable(),
  signers: z.array(agreementSignerSchema).max(12).optional(),
  linked_contact_ids: z.array(z.string().uuid()).max(24).optional(),
  linked_location_ids: z.array(z.string().uuid()).max(24).optional()
});

const updateAgreementSchema = createAgreementSchema.extend({
  note: z.string().trim().max(2000).optional().nullable()
});

const createAgreementFileSchema = z.object({
  file_type: agreementFileTypeSchema,
  file_name: z.string().trim().min(1).max(255),
  storage_reference: z.string().trim().min(1).max(1000),
  file_url: z.string().trim().url().max(1000).optional().nullable(),
  content_type: z.string().trim().max(200).optional().nullable(),
  file_size_bytes: z.number().int().min(0).max(100000000).optional().nullable(),
  version_label: z.string().trim().max(80).optional().nullable(),
  agreement_version_id: z.string().uuid().optional().nullable(),
  version_stage: agreementVersionStageSchema.optional().nullable(),
  create_version: z.boolean().optional(),
  is_current: z.boolean().optional(),
  activity_note: z.string().trim().max(1000).optional().nullable(),
  legacy_upload: z.boolean().optional()
});

const createAgreementTemplateSchema = z.object({
  template_name: z.string().trim().min(2).max(180),
  agreement_type: agreementTypeSchema,
  active_status: z.boolean().optional(),
  template_body: z.string().trim().max(40000).optional().nullable(),
  template_file_reference: z.string().trim().max(1000).optional().nullable(),
  merge_fields: z.array(z.string().trim().min(1).max(80)).max(40).optional()
});

const createAgreementFromTemplateSchema = z.object({
  template_id: z.string().uuid(),
  agreement_title: z.string().trim().min(2).max(240).optional().nullable(),
  primary_contact_id: z.string().uuid().optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  contract_value: z.number().min(0).max(100000000).optional().nullable(),
  revenue_share_terms: z.string().trim().max(4000).optional().nullable(),
  effective_date: dateStringSchema.optional().nullable(),
  expiration_date: dateStringSchema.optional().nullable(),
  renewal_date: dateStringSchema.optional().nullable(),
  notice_deadline: dateStringSchema.optional().nullable(),
  auto_renew: z.boolean().optional().nullable(),
  signers: z.array(agreementSignerSchema).max(12).optional(),
  linked_contact_ids: z.array(z.string().uuid()).max(24).optional(),
  linked_location_ids: z.array(z.string().uuid()).max(24).optional(),
  note: z.string().trim().max(2000).optional().nullable()
});

const sendAgreementReminderSchema = z.object({
  reminder_type: agreementReminderTypeSchema,
  channels: z.array(agreementReminderChannelSchema).min(1).max(2).optional(),
  note: z.string().trim().max(1000).optional().nullable()
});

const sendAgreementForSignatureSchema = z.object({
  agreement_version_id: z.string().uuid().optional().nullable(),
  provider_name: agreementProviderNameSchema.optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable()
});

const syncAgreementProviderStatusSchema = z.object({
  note: z.string().trim().max(1000).optional().nullable()
});

const createAgreementRenewalSchema = z.object({
  agreement_title: z.string().trim().min(2).max(240).optional().nullable(),
  effective_date: dateStringSchema.optional().nullable(),
  expiration_date: dateStringSchema.optional().nullable(),
  renewal_date: dateStringSchema.optional().nullable(),
  notice_deadline: dateStringSchema.optional().nullable(),
  auto_renew: z.boolean().optional().nullable(),
  signers: z.array(agreementSignerSchema).max(12).optional(),
  note: z.string().trim().max(2000).optional().nullable()
});

router.use(requireCanonicalDirectoryReadAccess);

router.get("/", validateQuery(listQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listOrganizations(client, auth, {
        search: (req.query.search as string | undefined) ?? null,
        account_type: ((req.query.account_type as OrganizationAccountType | undefined) ?? null) as OrganizationAccountType | null,
        active_status: ((req.query.active_status as DirectoryActiveStatus | undefined) ?? null) as DirectoryActiveStatus | null
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/contacts", validateQuery(contactListQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listDirectoryContacts(client, auth, {
        search: (req.query.search as string | undefined) ?? null,
        account_type: ((req.query.account_type as OrganizationAccountType | undefined) ?? null) as OrganizationAccountType | null,
        active_status: ((req.query.active_status as DirectoryActiveStatus | undefined) ?? null) as DirectoryActiveStatus | null,
        organization_id: (req.query.organization_id as string | undefined) ?? null,
        location_id: (req.query.location_id as string | undefined) ?? null,
        contact_status: ((req.query.contact_status as DirectoryContactStatus | undefined) ?? null) as DirectoryContactStatus | null,
        role_category:
          ((req.query.role_category as DirectoryContactRoleCategory | undefined) ?? null) as DirectoryContactRoleCategory | null,
        operational_importance:
          ((req.query.operational_importance as DirectoryOperationalImportance | undefined) ?? null) as
            | DirectoryOperationalImportance
            | null,
        decision_influence:
          ((req.query.decision_influence as DirectoryDecisionInfluence | undefined) ?? null) as
            | DirectoryDecisionInfluence
            | null,
        primary_internal_owner_user_id: (req.query.primary_internal_owner_user_id as string | undefined) ?? null,
        relationship_ownership_state:
          ((req.query.relationship_ownership_state as DirectoryRelationshipOwnershipState | undefined) ?? null) as
            | DirectoryRelationshipOwnershipState
            | null,
        has_photo: req.query.has_photo !== undefined ? req.query.has_photo === "true" : null,
        has_logo: req.query.has_logo !== undefined ? req.query.has_logo === "true" : null,
        needs_review: req.query.needs_review !== undefined ? req.query.needs_review === "true" : null,
        my_contacts_only: req.query.my_contacts_only !== undefined ? req.query.my_contacts_only === "true" : null
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/internal-owners", requireCanonicalDirectoryManageAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => listDirectoryOwnerOptions(client, auth));
    return res.json({ owners: payload });
  } catch (error) {
    return next(error);
  }
});

// Phase 4 Slice 5 — canonical parent Districts for the searchable Parent-District
// selector. Registered before "/:id" so it is not captured by the detail route.
router.get("/districts", async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const search = typeof req.query.search === "string" ? req.query.search : null;
    const districts = await withClientTransaction(auth.tenantId, auth.id, (client) => listCanonicalDistricts(client, auth, search));
    return res.json({ districts });
  } catch (error) {
    return next(error);
  }
});

router.get("/contacts/:contactId/continuity", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getContactRelationshipContinuity(client, auth, String(req.params.contactId))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/contacts/:contactId", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getDirectoryContactDetail(client, auth, String(req.params.contactId))
    );
    if (!payload) {
      return res.status(404).json({ error: "Contact not found" });
    }
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/contact-import-sessions", requireCanonicalDirectoryManageAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listContactImportSessionsAction(client, auth)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/contact-import-sessions", requireCanonicalDirectoryManageAccess, validateBody(createContactImportSessionSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createContactImportSessionAction(
        client,
        auth,
        {
          source_file_name: req.body.source_file_name,
          csv_text: req.body.csv_text,
          has_header_row: req.body.has_header_row,
          default_organization_id: req.body.default_organization_id ?? null,
          column_mapping: req.body.column_mapping
        },
        getRequestMeta(req)
      )
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/contact-import-sessions/:sessionId", requireCanonicalDirectoryManageAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getContactImportSessionAction(client, auth, String(req.params.sessionId))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/contact-import-sessions/:sessionId/rows/:rowId",
  requireCanonicalDirectoryManageAccess,
  validateBody(updateContactImportRowSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateContactImportRowAction(client, auth, String(req.params.sessionId), String(req.params.rowId), {
          selected_action: req.body.selected_action,
          selected_contact_id: req.body.selected_contact_id,
          resolved_organization_id: req.body.resolved_organization_id,
          review_note: req.body.review_note
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/contact-import-sessions/:sessionId/apply",
  requireCanonicalDirectoryManageAccess,
  validateBody(applyContactImportSessionSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        applyContactImportSessionAction(
          client,
          auth,
          String(req.params.sessionId),
          {
            rows: req.body.rows ?? []
          },
          getRequestMeta(req)
        )
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/locations", validateQuery(listQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listDirectoryLocations(client, auth, {
        search: (req.query.search as string | undefined) ?? null,
        account_type: ((req.query.account_type as OrganizationAccountType | undefined) ?? null) as OrganizationAccountType | null,
        active_status: ((req.query.active_status as DirectoryActiveStatus | undefined) ?? null) as DirectoryActiveStatus | null
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/", requireCanonicalDirectoryManageAccess, validateBody(createOrganizationSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createOrganization(
        client,
        auth,
        {
          canonical_name: req.body.canonical_name,
          display_name: req.body.display_name ?? null,
          logo_url: req.body.logo_url ?? null,
          account_type: req.body.account_type,
          active_status: req.body.active_status,
          aliases: req.body.aliases ?? [],
          notes: req.body.notes ?? null,
          parent_organization_id: req.body.parent_organization_id ?? null,
          client_entity_kind: req.body.client_entity_kind ?? null,
          client_organization_type: req.body.client_organization_type ?? null,
          website: req.body.website ?? null,
          main_phone: req.body.main_phone ?? null
        },
        getRequestMeta(req)
      )
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/duplicate-reviews", async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listDirectoryDuplicateReviews(client, auth)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/duplicate-reviews", requireCanonicalDirectoryManageAccess, validateBody(duplicateReviewCreateSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createDirectoryDuplicateReview(
        client,
        auth,
        {
          primary_contact_id: req.body.primary_contact_id,
          suspected_duplicate_contact_id: req.body.suspected_duplicate_contact_id,
          summary: req.body.summary,
          notes: req.body.notes ?? null
        },
        getRequestMeta(req)
      )
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.patch("/duplicate-reviews/:reviewId", requireCanonicalDirectoryManageAccess, validateBody(duplicateReviewUpdateSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateDirectoryDuplicateReview(
        client,
        auth,
        String(req.params.reviewId),
        {
          status: req.body.status,
          decision: req.body.decision,
          notes: req.body.notes ?? null
        },
        getRequestMeta(req)
      )
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id", requireCanonicalDirectoryManageAccess, validateBody(updateOrganizationSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateOrganization(
        client,
        auth,
        String(req.params.id),
        {
          canonical_name: req.body.canonical_name,
          display_name: req.body.display_name,
          logo_url: req.body.logo_url ?? null,
          account_type: req.body.account_type,
          active_status: req.body.active_status,
          aliases: req.body.aliases,
          notes: req.body.notes,
          parent_organization_id: req.body.parent_organization_id,
          client_entity_kind: req.body.client_entity_kind,
          client_organization_type: req.body.client_organization_type,
          website: req.body.website,
          main_phone: req.body.main_phone
        },
        getRequestMeta(req)
      )
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id/school-profile", requireSchoolFoundationManageAccess, validateBody(updateSchoolProfileSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateSchoolProfile(
        client,
        auth,
        String(req.params.id),
        {
          district_name: req.body.district_name ?? undefined,
          school_type: req.body.school_type ?? undefined,
          school_year_label: req.body.school_year_label ?? undefined,
          primary_internal_owner_user_id: req.body.primary_internal_owner_user_id ?? undefined,
          backup_internal_owner_user_id: req.body.backup_internal_owner_user_id ?? undefined,
          relationship_health_state: req.body.relationship_health_state ?? undefined,
          relationship_summary: req.body.relationship_summary ?? undefined,
          primary_location_id: req.body.primary_location_id ?? undefined,
          tags: req.body.tags,
          notes: req.body.notes ?? undefined
        },
        getRequestMeta(req)
      )
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/:id/contacts/:contactId/school-categories",
  requireSchoolFoundationManageAccess,
  validateBody(updateSchoolContactCategoriesSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateSchoolContactCategories(
          client,
          auth,
          String(req.params.id),
          String(req.params.contactId),
          {
            school_contact_categories: req.body.school_contact_categories
          },
          getRequestMeta(req)
        )
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch("/contacts/:contactId", requireCanonicalDirectoryManageAccess, validateBody(updateContactSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateOrganizationContact(
        client,
        auth,
        String(req.params.contactId),
        {
          first_name: req.body.first_name,
          last_name: req.body.last_name,
          preferred_name: req.body.preferred_name,
          title: req.body.title,
          department_program: req.body.department_program,
          phone: req.body.phone,
          email: req.body.email,
          photo_url: req.body.photo_url,
          contact_status: req.body.contact_status,
          role_category: req.body.role_category,
          operational_importance: req.body.operational_importance,
          decision_influence: req.body.decision_influence,
          primary_internal_owner_user_id: req.body.primary_internal_owner_user_id,
          backup_internal_owner_user_id: req.body.backup_internal_owner_user_id,
          relationship_strength: req.body.relationship_strength,
          handoff_ready: req.body.handoff_ready,
          last_confirmed_at: req.body.last_confirmed_at,
          uncertainty_flag: req.body.uncertainty_flag,
          notes: req.body.notes
        },
        getRequestMeta(req)
      )
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/contacts/:contactId/archive", requireCanonicalDirectoryManageAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      setOrganizationContactActiveStatus(client, auth, String(req.params.contactId), "inactive", getRequestMeta(req))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/contacts/:contactId/reactivate", requireCanonicalDirectoryManageAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      setOrganizationContactActiveStatus(client, auth, String(req.params.contactId), "active", getRequestMeta(req))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/contacts/:contactId/touchpoints", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listContactTouchpoints(client, auth, String(req.params.contactId))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.patch("/locations/:locationId", requireCanonicalDirectoryManageAccess, validateBody(updateLocationSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateOrganizationLocation(
        client,
        auth,
        String(req.params.locationId),
        {
          location_name: req.body.location_name,
          address_line_1: req.body.address_line_1,
          address_line_2: req.body.address_line_2 ?? null,
          city: req.body.city,
          state: req.body.state,
          zip: req.body.zip,
          maps_label: req.body.maps_label ?? null,
          notes: req.body.notes ?? null
        },
        getRequestMeta(req)
      )
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/locations/:locationId/archive", requireCanonicalDirectoryManageAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      setOrganizationLocationActiveStatus(client, auth, String(req.params.locationId), "inactive", getRequestMeta(req))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/locations/:locationId/reactivate", requireCanonicalDirectoryManageAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      setOrganizationLocationActiveStatus(client, auth, String(req.params.locationId), "active", getRequestMeta(req))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/locations/:locationId/contacts", requireCanonicalDirectoryManageAccess, validateBody(relationshipAttachSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      attachContactToLocation(
        client,
        auth,
        String(req.params.locationId),
        {
          contact_id: req.body.contact_id,
          relationship_role: req.body.relationship_role,
          is_primary: req.body.is_primary
        },
        getRequestMeta(req)
      )
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.delete("/locations/:locationId/contacts/:contactId", requireCanonicalDirectoryManageAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      detachContactFromLocation(client, auth, String(req.params.locationId), String(req.params.contactId), getRequestMeta(req))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/shoots/:shootId/contacts", requireCanonicalDirectoryManageAccess, validateBody(relationshipAttachSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      attachContactToShoot(
        client,
        auth,
        String(req.params.shootId),
        {
          contact_id: req.body.contact_id,
          relationship_role: req.body.relationship_role,
          is_primary: req.body.is_primary
        },
        getRequestMeta(req)
      )
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.delete("/shoots/:shootId/contacts/:contactId", requireCanonicalDirectoryManageAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      detachContactFromShoot(client, auth, String(req.params.shootId), String(req.params.contactId), getRequestMeta(req))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/:id/operations-hub", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      loadOrganizationOperationsHub(client, auth, String(req.params.id))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/:id/continuity", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getOrganizationRelationshipContinuity(client, auth, String(req.params.id))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/school-rules", requireSchoolFoundationManageAccess, validateBody(createSchoolRuleSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createSchoolRule(
        client,
        auth,
        String(req.params.id),
        {
          rule_type: req.body.rule_type,
          title: req.body.title ?? null,
          summary: req.body.summary ?? null,
          active_status: req.body.active_status,
          structured_value: req.body.structured_value ?? {},
          sort_order: req.body.sort_order ?? null
        },
        getRequestMeta(req)
      )
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/:id/school-rules/:ruleId",
  requireSchoolFoundationManageAccess,
  validateBody(updateSchoolRuleSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateSchoolRule(
          client,
          auth,
          String(req.params.id),
          String(req.params.ruleId),
          {
            title: req.body.title ?? undefined,
            summary: req.body.summary ?? undefined,
            active_status: req.body.active_status ?? undefined,
            structured_value: req.body.structured_value ?? undefined,
            sort_order: req.body.sort_order ?? undefined
          },
          getRequestMeta(req)
        )
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/:id/school-notes", requireSchoolFoundationManageAccess, validateBody(createSchoolNoteSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createSchoolNote(
        client,
        auth,
        String(req.params.id),
        {
          summary: req.body.summary,
          detail: req.body.detail ?? null
        },
        getRequestMeta(req)
      )
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

// ── School-year / season service terms (Phase 4 Slice 4) ─────────────────────
const serviceTermPeriodTypeSchema = z.enum(["school_year", "season", "custom"]);
const createServiceTermSchema = z.object({
  period_type: serviceTermPeriodTypeSchema.optional(),
  period_label: z.string().trim().min(1).max(120),
  start_date: z.string().trim().max(40).optional().nullable(),
  end_date: z.string().trim().max(40).optional().nullable(),
  internal_owner_user_id: z.string().uuid().optional().nullable(),
  service_config: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().trim().max(4000).optional().nullable()
});
const updateServiceTermSchema = z
  .object({
    start_date: z.string().trim().max(40).optional().nullable(),
    end_date: z.string().trim().max(40).optional().nullable(),
    internal_owner_user_id: z.string().uuid().optional().nullable(),
    service_config: z.record(z.string(), z.unknown()).optional(),
    notes: z.string().trim().max(4000).optional().nullable(),
    confirm: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");
const rolloverServiceTermSchema = z.object({ new_period_label: z.string().trim().min(1).max(120) });

// ── Legacy directory reconciliation (Phase 4 Slice 7) ────────────────────────
// Dry-run by default; ?apply=true links Schools to canonical Districts on deterministic
// exact name match only (never overwrites a parent, never merges). Admin-gated for apply.
router.post("/reconcile/districts", requireCanonicalDirectoryManageAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const apply = String(req.query.apply ?? "") === "true";
    const report = await withClientTransaction(auth.tenantId, auth.id, (client) => reconcileDistricts(client, auth, { dryRun: !apply }));
    return res.json(report);
  } catch (error) {
    return next(error);
  }
});

// ── Organization brand / logo history (Phase 4 Slice 3) ──────────────────────
const brandPatchSchema = z
  .object({
    brand_primary_color: z.string().trim().max(60).optional().nullable(),
    brand_secondary_color: z.string().trim().max(60).optional().nullable(),
    mascot: z.string().trim().max(120).optional().nullable(),
    brand_status: z.enum(["known", "unknown", "not_available", "not_applicable"]).optional().nullable(),
    website: z.string().trim().max(500).optional().nullable(),
    logo_url: z.string().trim().max(1000).optional().nullable(),
    logo_status: z.enum(["current", "outdated", "pending_review", "unavailable"]).optional().nullable(),
    logo_note: z.string().trim().max(2000).optional().nullable(),
    logo_source: z.string().trim().max(60).optional().nullable()
  })
  .refine((v) => Object.keys(v).length > 0, "Provide at least one brand field");

router.patch("/:id/brand", requireCanonicalDirectoryManageAccess, validateBody(brandPatchSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => updateOrganizationBrand(client, auth, String(req.params.id), req.body));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/:id/logo-history", requireCanonicalDirectoryReadAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getLogoHistory(client, auth, String(req.params.id)));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/logo-restore", requireCanonicalDirectoryManageAccess, validateBody(z.object({ history_id: z.string().uuid() })), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => restoreOrganizationLogo(client, auth, String(req.params.id), req.body.history_id));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

// ── Reusable canonical Contact identities (Phase 4 Slice 2) ──────────────────
const createContactIdentitySchema = z.object({
  first_name: z.string().trim().max(120).optional().nullable(),
  last_name: z.string().trim().max(120).optional().nullable(),
  full_name: z.string().trim().max(240).optional().nullable(),
  display_name: z.string().trim().max(240).optional().nullable(),
  email: z.string().trim().max(180).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  preferred_contact_method: z.string().trim().max(80).optional().nullable()
});
const linkContactSchema = z.object({
  organization_id: z.string().uuid(),
  relationship_role: z.string().trim().max(80).optional(),
  client_roles: z.array(z.string().trim().max(80)).max(20).optional(),
  is_primary: z.boolean().optional()
});

router.post("/contact-identities", requireCanonicalDirectoryManageAccess, validateBody(createContactIdentitySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const contact = await withClientTransaction(auth.tenantId, auth.id, (client) => createCanonicalContact(client, auth, req.body));
    return res.status(201).json({ contact });
  } catch (error) {
    return next(error);
  }
});

router.post("/contact-identities/:contactId/links", requireCanonicalDirectoryManageAccess, validateBody(linkContactSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      linkContactToOrganization(client, auth, String(req.params.contactId), req.body.organization_id, { relationship_role: req.body.relationship_role, client_roles: req.body.client_roles, is_primary: req.body.is_primary })
    );
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

router.get("/contact-identities/:contactId/relationships", requireCanonicalDirectoryReadAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getContactRelationships(client, auth, String(req.params.contactId)));
    if (!payload) return res.status(404).json({ error: "Contact not found" });
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

// Identity backfill: dry-run by default; ?apply=true creates one identity per unlinked
// org contact (one-to-one, never merges). Admin-gated for apply.
router.post("/contact-identities/backfill", requireCanonicalDirectoryManageAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const apply = String(req.query.apply ?? "") === "true";
    const report = await withClientTransaction(auth.tenantId, auth.id, (client) => backfillContactIdentities(client, auth, { dryRun: !apply }));
    return res.json(report);
  } catch (error) {
    return next(error);
  }
});

router.get("/:id/service-terms", requireCanonicalDirectoryReadAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const terms = await withClientTransaction(auth.tenantId, auth.id, (client) => listSchoolServiceTerms(client, auth, String(req.params.id)));
    return res.json({ service_terms: terms });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/service-terms", requireSchoolFoundationManageAccess, validateBody(createServiceTermSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const term = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createSchoolServiceTerm(client, auth, String(req.params.id), {
        period_type: req.body.period_type,
        period_label: req.body.period_label,
        start_date: req.body.start_date ?? null,
        end_date: req.body.end_date ?? null,
        internal_owner_user_id: req.body.internal_owner_user_id ?? null,
        service_config: req.body.service_config,
        notes: req.body.notes ?? null
      })
    );
    return res.status(201).json({ service_term: term });
  } catch (error) {
    return next(error);
  }
});

router.post("/service-terms/:termId/rollover", requireSchoolFoundationManageAccess, validateBody(rolloverServiceTermSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const term = await withClientTransaction(auth.tenantId, auth.id, (client) => rolloverSchoolServiceTerm(client, auth, String(req.params.termId), req.body.new_period_label));
    return res.status(201).json({ service_term: term });
  } catch (error) {
    return next(error);
  }
});

router.post("/service-terms/:termId/activate", requireSchoolFoundationManageAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const term = await withClientTransaction(auth.tenantId, auth.id, (client) => setCurrentSchoolServiceTerm(client, auth, String(req.params.termId)));
    return res.json({ service_term: term });
  } catch (error) {
    return next(error);
  }
});

router.patch("/service-terms/:termId", requireSchoolFoundationManageAccess, validateBody(updateServiceTermSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const term = await withClientTransaction(auth.tenantId, auth.id, (client) => updateSchoolServiceTerm(client, auth, String(req.params.termId), req.body));
    return res.json({ service_term: term });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getOrganizationDetail(client, auth, String(req.params.id))
    );
    if (!payload) {
      return res.status(404).json({ error: "Organization not found" });
    }
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/:id/touchpoint-plans",
  requireCanonicalDirectoryManageAccess,
  validateBody(touchpointPlanCreateSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createDirectoryTouchpointPlan(
          client,
          auth,
          String(req.params.id),
          {
            template_id: req.body.template_id ?? null,
            contact_id: req.body.contact_id ?? null,
            location_id: req.body.location_id ?? null,
            linked_shoot_id: req.body.linked_shoot_id ?? null,
            category: req.body.category as DirectoryTouchpointCategory,
            title: req.body.title,
            summary: req.body.summary ?? null,
            owner_user_id: req.body.owner_user_id ?? null,
            backup_owner_user_id: req.body.backup_owner_user_id ?? null,
            due_at: req.body.due_at
          },
          getRequestMeta(req)
        )
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/touchpoint-plans/:touchpointPlanId",
  requireCanonicalDirectoryManageAccess,
  validateBody(touchpointPlanUpdateSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateDirectoryTouchpointPlan(
          client,
          auth,
          String(req.params.touchpointPlanId),
          {
            status: req.body.status,
            completion_note: req.body.completion_note ?? null,
            skipped_reason: req.body.skipped_reason ?? null,
            cancelled_reason: req.body.cancelled_reason ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/:id/communications",
  requireCanonicalDirectoryManageAccess,
  validateBody(touchpointCreateSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createDirectoryCommunicationLog(
          client,
          auth,
          String(req.params.id),
          {
            contact_id: req.body.contact_id ?? null,
            location_id: req.body.location_id ?? null,
            shoot_id: req.body.shoot_id ?? null,
            channel: req.body.channel,
            category: (req.body.category ?? null) as DirectoryTouchpointCategory | null,
            subject: req.body.subject ?? null,
            summary: req.body.summary,
            outcome: req.body.outcome ?? null,
            outcome_state: (req.body.outcome_state ?? null) as DirectoryCommunicationOutcome | null,
            owner_user_id: req.body.owner_user_id ?? null,
            occurred_at: req.body.occurred_at ?? null,
            follow_up_date: req.body.follow_up_date ?? null,
            follow_up_needed: req.body.follow_up_needed ?? false,
            follow_up_owner_user_id: req.body.follow_up_owner_user_id ?? null,
            relationship_memory_suggested: req.body.relationship_memory_suggested ?? false,
            attachment_reference: req.body.attachment_reference ?? null,
            touchpoint_plan_id: req.body.touchpoint_plan_id ?? null,
            memory_type: (req.body.memory_type ?? null) as DirectoryRelationshipMemoryType | null,
            memory_summary: req.body.memory_summary ?? null,
            memory_why_it_matters: req.body.memory_why_it_matters ?? null,
            memory_visibility: (req.body.memory_visibility ?? null) as DirectoryRelationshipMemoryVisibility | null
          },
          getRequestMeta(req)
        )
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/:id/relationship-memory",
  requireCanonicalDirectoryManageAccess,
  validateBody(relationshipMemoryCreateSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createDirectoryRelationshipMemory(
          client,
          auth,
          String(req.params.id),
          {
            contact_id: req.body.contact_id ?? null,
            location_id: req.body.location_id ?? null,
            source_touchpoint_id: req.body.source_touchpoint_id ?? null,
            memory_type: req.body.memory_type as DirectoryRelationshipMemoryType,
            summary: req.body.summary,
            why_it_matters: req.body.why_it_matters,
            source_label: req.body.source_label ?? null,
            visibility: (req.body.visibility ?? undefined) as DirectoryRelationshipMemoryVisibility | undefined,
            last_confirmed_at: req.body.last_confirmed_at ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/relationship-memory/:memoryId",
  requireCanonicalDirectoryManageAccess,
  validateBody(relationshipMemoryUpdateSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateDirectoryRelationshipMemory(
          client,
          auth,
          String(req.params.memoryId),
          {
            status: req.body.status,
            last_confirmed_at: req.body.last_confirmed_at ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/:id/follow-ups",
  requireCanonicalDirectoryManageAccess,
  validateBody(relationshipFollowUpCreateSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createDirectoryRelationshipFollowUp(
          client,
          auth,
          String(req.params.id),
          {
            contact_id: req.body.contact_id ?? null,
            location_id: req.body.location_id ?? null,
            linked_shoot_id: req.body.linked_shoot_id ?? null,
            source_touchpoint_id: req.body.source_touchpoint_id ?? null,
            source_touchpoint_plan_id: req.body.source_touchpoint_plan_id ?? null,
            title: req.body.title,
            summary: req.body.summary ?? null,
            owner_user_id: req.body.owner_user_id ?? null,
            backup_owner_user_id: req.body.backup_owner_user_id ?? null,
            due_at: req.body.due_at
          },
          getRequestMeta(req)
        )
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/follow-ups/:followUpId",
  requireCanonicalDirectoryManageAccess,
  validateBody(relationshipFollowUpUpdateSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateDirectoryRelationshipFollowUp(
          client,
          auth,
          String(req.params.followUpId),
          {
            status: req.body.status,
            resolution_note: req.body.resolution_note ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/:id/contacts", requireCanonicalDirectoryManageAccess, validateBody(createContactSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createOrganizationContact(
        client,
        auth,
        String(req.params.id),
        {
          first_name: req.body.first_name,
          last_name: req.body.last_name,
          preferred_name: req.body.preferred_name ?? null,
          title: req.body.title ?? null,
          department_program: req.body.department_program ?? null,
          phone: req.body.phone ?? null,
          email: req.body.email ?? null,
          photo_url: req.body.photo_url ?? null,
          active_status: req.body.active_status,
          contact_status: req.body.contact_status,
          role_category: req.body.role_category,
          operational_importance: req.body.operational_importance,
          decision_influence: req.body.decision_influence,
          primary_internal_owner_user_id: req.body.primary_internal_owner_user_id ?? null,
          backup_internal_owner_user_id: req.body.backup_internal_owner_user_id ?? null,
          relationship_strength: req.body.relationship_strength,
          handoff_ready: req.body.handoff_ready ?? null,
          last_confirmed_at: req.body.last_confirmed_at ?? null,
          uncertainty_flag: req.body.uncertainty_flag ?? null,
          notes: req.body.notes ?? null
        },
        getRequestMeta(req)
      )
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/contact-links", requireCanonicalDirectoryManageAccess, validateBody(relationshipAttachSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      attachContactToOrganization(
        client,
        auth,
        String(req.params.id),
        {
          contact_id: req.body.contact_id,
          relationship_role: req.body.relationship_role,
          is_primary: req.body.is_primary,
          start_date: req.body.start_date ?? null,
          end_date: req.body.end_date ?? null,
          is_current: req.body.is_current
        },
        getRequestMeta(req)
      )
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/locations", requireCanonicalDirectoryManageAccess, validateBody(createLocationSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createOrganizationLocation(
        client,
        auth,
        String(req.params.id),
        {
          location_name: req.body.location_name,
          address_line_1: req.body.address_line_1,
          address_line_2: req.body.address_line_2 ?? null,
          city: req.body.city,
          state: req.body.state,
          zip: req.body.zip,
          maps_label: req.body.maps_label ?? null,
          active_status: req.body.active_status,
          notes: req.body.notes ?? null
        },
        getRequestMeta(req)
      )
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/:id/touchpoints", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listOrganizationTouchpoints(client, auth, String(req.params.id))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/touchpoints", requireCanonicalDirectoryManageAccess, validateBody(touchpointCreateSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createDirectoryCommunicationLog(
        client,
        auth,
        String(req.params.id),
        {
          contact_id: req.body.contact_id ?? null,
          location_id: req.body.location_id ?? null,
          shoot_id: req.body.shoot_id ?? null,
          channel: req.body.channel,
          category: (req.body.category ?? null) as DirectoryTouchpointCategory | null,
          subject: req.body.subject ?? null,
          summary: req.body.summary,
          outcome: req.body.outcome ?? null,
          outcome_state: (req.body.outcome_state ?? null) as DirectoryCommunicationOutcome | null,
          owner_user_id: req.body.owner_user_id ?? null,
          occurred_at: req.body.occurred_at ?? null,
          follow_up_date: req.body.follow_up_date ?? null,
          follow_up_needed: req.body.follow_up_needed ?? false,
          follow_up_owner_user_id: req.body.follow_up_owner_user_id ?? null,
          relationship_memory_suggested: req.body.relationship_memory_suggested ?? false,
          attachment_reference: req.body.attachment_reference ?? null,
          touchpoint_plan_id: req.body.touchpoint_plan_id ?? null,
          memory_type: (req.body.memory_type ?? null) as DirectoryRelationshipMemoryType | null,
          memory_summary: req.body.memory_summary ?? null,
          memory_why_it_matters: req.body.memory_why_it_matters ?? null,
          memory_visibility: (req.body.memory_visibility ?? null) as DirectoryRelationshipMemoryVisibility | null
        },
        getRequestMeta(req)
      )
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/agreements", requireCanonicalDirectoryManageAccess, validateBody(createAgreementSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    await withClientTransaction(auth.tenantId, auth.id, async (client) => {
      await createAgreement(
        client,
        auth,
        String(req.params.id),
        {
          agreement_title: req.body.agreement_title,
          agreement_type: req.body.agreement_type,
          status: req.body.status,
          primary_contact_id: req.body.primary_contact_id ?? null,
          description: req.body.description ?? null,
          contract_value: req.body.contract_value ?? null,
          revenue_share_terms: req.body.revenue_share_terms ?? null,
          effective_date: req.body.effective_date ?? null,
          expiration_date: req.body.expiration_date ?? null,
          renewal_date: req.body.renewal_date ?? null,
          notice_deadline: req.body.notice_deadline ?? null,
          auto_renew: req.body.auto_renew ?? null,
          sent_at: req.body.sent_at ?? null,
          viewed_at: req.body.viewed_at ?? null,
          signed_at: req.body.signed_at ?? null,
          countersigned_at: req.body.countersigned_at ?? null,
          prior_agreement_id: req.body.prior_agreement_id ?? null,
          replaced_by_agreement_id: req.body.replaced_by_agreement_id ?? null,
          source_template_id: req.body.source_template_id ?? null,
          signers: req.body.signers ?? [],
          linked_contact_ids: req.body.linked_contact_ids ?? [],
          linked_location_ids: req.body.linked_location_ids ?? []
        },
        getRequestMeta(req)
      );
    });
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getOrganizationDetail(client, auth, String(req.params.id))
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/:id/agreements/:agreementId",
  requireCanonicalDirectoryManageAccess,
  validateBody(updateAgreementSchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    await withClientTransaction(auth.tenantId, auth.id, async (client) => {
      await updateAgreement(
        client,
        auth,
        String(req.params.id),
        String(req.params.agreementId),
        {
          agreement_title: req.body.agreement_title,
          agreement_type: req.body.agreement_type,
          status: req.body.status,
          primary_contact_id: req.body.primary_contact_id ?? null,
          description: req.body.description ?? null,
          contract_value: req.body.contract_value ?? null,
          revenue_share_terms: req.body.revenue_share_terms ?? null,
          effective_date: req.body.effective_date ?? null,
          expiration_date: req.body.expiration_date ?? null,
          renewal_date: req.body.renewal_date ?? null,
          notice_deadline: req.body.notice_deadline ?? null,
          auto_renew: req.body.auto_renew ?? null,
          sent_at: req.body.sent_at ?? null,
          viewed_at: req.body.viewed_at ?? null,
          signed_at: req.body.signed_at ?? null,
          countersigned_at: req.body.countersigned_at ?? null,
          prior_agreement_id: req.body.prior_agreement_id ?? null,
          replaced_by_agreement_id: req.body.replaced_by_agreement_id ?? null,
          source_template_id: req.body.source_template_id ?? null,
          signers: req.body.signers ?? [],
          linked_contact_ids: req.body.linked_contact_ids ?? [],
          linked_location_ids: req.body.linked_location_ids ?? [],
          note: req.body.note ?? null
        },
        getRequestMeta(req)
      );
    });
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getOrganizationDetail(client, auth, String(req.params.id))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.post(
  "/:id/agreements/:agreementId/files",
  requireCanonicalDirectoryManageAccess,
  validateBody(createAgreementFileSchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    await withClientTransaction(auth.tenantId, auth.id, async (client) => {
      await registerAgreementFile(
        client,
        auth,
        String(req.params.id),
        String(req.params.agreementId),
        {
          file_type: req.body.file_type,
          file_name: req.body.file_name,
          storage_reference: req.body.storage_reference,
          file_url: req.body.file_url ?? null,
          content_type: req.body.content_type ?? null,
          file_size_bytes: req.body.file_size_bytes ?? null,
          version_label: req.body.version_label ?? null,
          agreement_version_id: req.body.agreement_version_id ?? null,
          version_stage: req.body.version_stage ?? null,
          create_version: req.body.create_version ?? false,
          is_current: req.body.is_current,
          activity_note: req.body.activity_note ?? null,
          legacy_upload: req.body.legacy_upload ?? false
        },
        getRequestMeta(req)
      );
    });
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getOrganizationDetail(client, auth, String(req.params.id))
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.post(
  "/:id/agreement-templates",
  requireCanonicalDirectoryManageAccess,
  validateBody(createAgreementTemplateSchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    await withClientTransaction(auth.tenantId, auth.id, async (client) => {
      await createAgreementTemplate(
        client,
        auth,
        {
          template_name: req.body.template_name,
          agreement_type: req.body.agreement_type,
          active_status: req.body.active_status,
          template_body: req.body.template_body ?? null,
          template_file_reference: req.body.template_file_reference ?? null,
          merge_fields: req.body.merge_fields ?? []
        },
        getRequestMeta(req)
      );
    });
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getOrganizationDetail(client, auth, String(req.params.id))
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.post(
  "/:id/agreements/from-template",
  requireCanonicalDirectoryManageAccess,
  validateBody(createAgreementFromTemplateSchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    await withClientTransaction(auth.tenantId, auth.id, async (client) => {
      await createAgreementFromTemplate(
        client,
        auth,
        String(req.params.id),
        {
          template_id: req.body.template_id,
          agreement_title: req.body.agreement_title ?? null,
          primary_contact_id: req.body.primary_contact_id ?? null,
          description: req.body.description ?? null,
          contract_value: req.body.contract_value ?? null,
          revenue_share_terms: req.body.revenue_share_terms ?? null,
          effective_date: req.body.effective_date ?? null,
          expiration_date: req.body.expiration_date ?? null,
          renewal_date: req.body.renewal_date ?? null,
          notice_deadline: req.body.notice_deadline ?? null,
          auto_renew: req.body.auto_renew ?? null,
          signers: req.body.signers ?? [],
          linked_contact_ids: req.body.linked_contact_ids ?? [],
          linked_location_ids: req.body.linked_location_ids ?? [],
          note: req.body.note ?? null
        },
        getRequestMeta(req)
      );
    });
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getOrganizationDetail(client, auth, String(req.params.id))
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.post(
  "/:id/agreements/:agreementId/reminders",
  requireCanonicalDirectoryManageAccess,
  validateBody(sendAgreementReminderSchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    await withClientTransaction(auth.tenantId, auth.id, async (client) => {
      await sendAgreementReminder(
        client,
        auth,
        String(req.params.id),
        String(req.params.agreementId),
        {
          reminder_type: req.body.reminder_type,
          channels: req.body.channels ?? ["email", "internal_notice"],
          note: req.body.note ?? null
        },
        getRequestMeta(req)
      );
    });
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getOrganizationDetail(client, auth, String(req.params.id))
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.post(
  "/:id/agreements/:agreementId/send",
  requireCanonicalDirectoryManageAccess,
  validateBody(sendAgreementForSignatureSchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    await withClientTransaction(auth.tenantId, auth.id, async (client) => {
      await sendAgreementForSignature(
        client,
        auth,
        String(req.params.id),
        String(req.params.agreementId),
        {
          agreement_version_id: req.body.agreement_version_id ?? null,
          provider_name: req.body.provider_name ?? null,
          note: req.body.note ?? null
        },
        getRequestMeta(req)
      );
    });
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getOrganizationDetail(client, auth, String(req.params.id))
    );
    return res.status(202).json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.post(
  "/:id/agreements/:agreementId/provider-sync",
  requireCanonicalDirectoryManageAccess,
  validateBody(syncAgreementProviderStatusSchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    await withClientTransaction(auth.tenantId, auth.id, async (client) => {
      await syncAgreementProviderStatus(
        client,
        auth,
        String(req.params.id),
        String(req.params.agreementId),
        {
          note: req.body.note ?? null
        },
        getRequestMeta(req)
      );
    });
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getOrganizationDetail(client, auth, String(req.params.id))
    );
    return res.status(202).json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.post(
  "/:id/agreements/:agreementId/renewal",
  requireCanonicalDirectoryManageAccess,
  validateBody(createAgreementRenewalSchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    await withClientTransaction(auth.tenantId, auth.id, async (client) => {
      await createAgreementRenewalDraft(
        client,
        auth,
        String(req.params.id),
        String(req.params.agreementId),
        {
          agreement_title: req.body.agreement_title ?? null,
          effective_date: req.body.effective_date ?? null,
          expiration_date: req.body.expiration_date ?? null,
          renewal_date: req.body.renewal_date ?? null,
          notice_deadline: req.body.notice_deadline ?? null,
          auto_renew: req.body.auto_renew ?? null,
          signers: req.body.signers ?? [],
          note: req.body.note ?? null
        },
        getRequestMeta(req)
      );
    });
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getOrganizationDetail(client, auth, String(req.params.id))
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

export default router;
