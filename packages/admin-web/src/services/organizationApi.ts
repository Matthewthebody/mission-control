import { apiFetch } from "../api";
import type {
  AgreementExternalProviderName,
  AgreementFileType,
  DirectoryContactRoleCategory,
  DirectoryContactStatus,
  AgreementReminderChannel,
  AgreementReminderType,
  AgreementSignerStatus,
  AgreementSignerType,
  AgreementStatus,
  AgreementType,
  AgreementVersionStage,
  DirectoryCommunicationOutcome,
  DirectoryDecisionInfluence,
  DirectoryContactRelationshipRole,
  DirectoryDuplicateReviewDecision,
  DirectoryDuplicateReviewListResponse,
  DirectoryDuplicateReviewRecord,
  DirectoryDuplicateReviewStatus,
  DirectoryImportColumnMapping,
  DirectoryImportRowAction,
  DirectoryImportSessionListResponse,
  DirectoryImportSessionRecord,
  DirectoryContactDetailResponse,
  DirectoryContactListResponse,
  DirectoryActiveStatus,
  DirectoryLocationListResponse,
  DirectoryOperationalImportance,
  DirectoryOwnerOption,
  DirectoryRelationshipContinuityBundle,
  DirectoryRelationshipFollowUpRecord,
  DirectoryRelationshipMemoryRecord,
  DirectoryRelationshipMemoryStatus,
  DirectoryRelationshipMemoryType,
  DirectoryRelationshipMemoryVisibility,
  DirectoryRelationshipOwnershipState,
  DirectoryRelationshipStrength,
  SchoolContactCategory,
  SchoolRelationshipHealthState,
  SchoolRuleType,
  DirectoryTouchpointCategory,
  DirectoryTouchpointChannel,
  DirectoryTouchpointListResponse,
  DirectoryTouchpointPlan,
  DirectoryTouchpointPlanStatus,
  DirectoryTouchpointRecord,
  CanonicalContactListResponse,
  CanonicalContactRecord,
  CanonicalContactRelationshipsResponse,
  CanonicalDistrictListResponse,
  OrganizationAccountType,
  OrganizationDetail,
  OrganizationOperationsHub,
  OrganizationListResponse,
  OrganizationLogoHistoryResponse,
  SchoolServiceTermListResponse,
  SchoolServiceTermPeriodType,
  SchoolServiceTermRecord,
  ShootDirectoryContactLinkResponse
} from "../types";

export type OrganizationCreateInput = {
  canonical_name: string;
  display_name?: string | null;
  logo_url?: string | null;
  account_type: OrganizationAccountType;
  active_status?: DirectoryActiveStatus;
  aliases?: string[];
  notes?: string | null;
  // Phase 4 canonical hierarchy + client fields.
  parent_organization_id?: string | null;
  client_entity_kind?: "account" | "parent_organization" | null;
  client_organization_type?: string | null;
  website?: string | null;
  main_phone?: string | null;
};

export type OrganizationContactCreateInput = {
  first_name: string;
  last_name: string;
  preferred_name?: string | null;
  title?: string | null;
  department_program?: string | null;
  phone?: string | null;
  email?: string | null;
  photo_url?: string | null;
  active_status?: DirectoryActiveStatus;
  contact_status?: DirectoryContactStatus;
  role_category?: DirectoryContactRoleCategory;
  operational_importance?: DirectoryOperationalImportance;
  decision_influence?: DirectoryDecisionInfluence;
  primary_internal_owner_user_id?: string | null;
  backup_internal_owner_user_id?: string | null;
  relationship_strength?: DirectoryRelationshipStrength;
  handoff_ready?: boolean | null;
  last_confirmed_at?: string | null;
  uncertainty_flag?: boolean | null;
  notes?: string | null;
};

export type OrganizationUpdateInput = Partial<OrganizationCreateInput>;
export type OrganizationContactUpdateInput = Partial<Omit<OrganizationContactCreateInput, "active_status">>;

export type SchoolProfileUpdateInput = {
  district_name?: string | null;
  school_type?: string | null;
  school_year_label?: string | null;
  primary_internal_owner_user_id?: string | null;
  backup_internal_owner_user_id?: string | null;
  relationship_health_state?: SchoolRelationshipHealthState | null;
  relationship_summary?: string | null;
  primary_location_id?: string | null;
  tags?: string[];
  notes?: string | null;
};

export type SchoolContactCategoriesUpdateInput = {
  school_contact_categories: SchoolContactCategory[];
};

export type SchoolRuleCreateInput = {
  rule_type: SchoolRuleType;
  title?: string | null;
  summary?: string | null;
  active_status?: DirectoryActiveStatus;
  structured_value?: Record<string, unknown> | null;
  sort_order?: number | null;
};

export type SchoolRuleUpdateInput = Partial<Omit<SchoolRuleCreateInput, "rule_type">>;

export type SchoolNoteCreateInput = {
  summary: string;
  detail?: string | null;
};

export type OrganizationLocationCreateInput = {
  location_name: string;
  address_line_1: string;
  address_line_2?: string | null;
  city: string;
  state: string;
  zip: string;
  maps_label?: string | null;
  active_status?: DirectoryActiveStatus;
  notes?: string | null;
};

export type OrganizationLocationUpdateInput = Partial<Omit<OrganizationLocationCreateInput, "active_status">>;

export type DirectoryRelationshipAttachInput = {
  contact_id: string;
  relationship_role?: DirectoryContactRelationshipRole;
  is_primary?: boolean;
};

export type DirectoryTouchpointCreateInput = {
  contact_id?: string | null;
  location_id?: string | null;
  shoot_id?: string | null;
  channel: DirectoryTouchpointChannel;
  category?: DirectoryTouchpointCategory | null;
  subject?: string | null;
  summary: string;
  outcome?: string | null;
  outcome_state?: DirectoryCommunicationOutcome | null;
  owner_user_id?: string | null;
  occurred_at?: string | null;
  follow_up_date?: string | null;
  follow_up_needed?: boolean;
  follow_up_owner_user_id?: string | null;
  relationship_memory_suggested?: boolean;
  attachment_reference?: string | null;
  touchpoint_plan_id?: string | null;
  memory_type?: DirectoryRelationshipMemoryType | null;
  memory_summary?: string | null;
  memory_why_it_matters?: string | null;
  memory_visibility?: DirectoryRelationshipMemoryVisibility | null;
};

export type DirectoryTouchpointPlanCreateInput = {
  template_id?: string | null;
  contact_id?: string | null;
  location_id?: string | null;
  linked_shoot_id?: string | null;
  category: DirectoryTouchpointCategory;
  title: string;
  summary?: string | null;
  owner_user_id?: string | null;
  backup_owner_user_id?: string | null;
  due_at: string;
};

export type DirectoryTouchpointPlanUpdateInput = {
  status?: Exclude<DirectoryTouchpointPlanStatus, "due_soon" | "overdue">;
  completion_note?: string | null;
  skipped_reason?: string | null;
  cancelled_reason?: string | null;
};

export type DirectoryRelationshipMemoryCreateInput = {
  contact_id?: string | null;
  location_id?: string | null;
  source_touchpoint_id?: string | null;
  memory_type: DirectoryRelationshipMemoryType;
  summary: string;
  why_it_matters: string;
  source_label?: string | null;
  visibility?: DirectoryRelationshipMemoryVisibility;
  last_confirmed_at?: string | null;
};

export type DirectoryRelationshipMemoryUpdateInput = {
  status?: DirectoryRelationshipMemoryStatus;
  last_confirmed_at?: string | null;
};

export type DirectoryRelationshipFollowUpCreateInput = {
  contact_id?: string | null;
  location_id?: string | null;
  linked_shoot_id?: string | null;
  source_touchpoint_id?: string | null;
  source_touchpoint_plan_id?: string | null;
  title: string;
  summary?: string | null;
  owner_user_id?: string | null;
  backup_owner_user_id?: string | null;
  due_at: string;
};

export type DirectoryRelationshipFollowUpUpdateInput = {
  status?: "open" | "in_progress" | "completed" | "cancelled";
  resolution_note?: string | null;
};

export type DirectoryDuplicateReviewCreateInput = {
  primary_contact_id: string;
  suspected_duplicate_contact_id: string;
  summary: string;
  notes?: string | null;
};

export type DirectoryDuplicateReviewUpdateInput = {
  status?: DirectoryDuplicateReviewStatus;
  decision?: DirectoryDuplicateReviewDecision;
  notes?: string | null;
};

export type DirectoryContactImportSessionCreateInput = {
  source_file_name: string;
  csv_text: string;
  default_organization_id?: string | null;
  column_mapping?: DirectoryImportColumnMapping;
  has_header_row?: boolean;
};

export type DirectoryContactImportRowUpdateInput = {
  selected_action?: DirectoryImportRowAction;
  selected_contact_id?: string | null;
  resolved_organization_id?: string | null;
  review_note?: string | null;
};

export type AgreementCreateInput = {
  agreement_title: string;
  agreement_type: AgreementType;
  status?: AgreementStatus;
  primary_contact_id?: string | null;
  description?: string | null;
  contract_value?: number | null;
  revenue_share_terms?: string | null;
  effective_date?: string | null;
  expiration_date?: string | null;
  renewal_date?: string | null;
  notice_deadline?: string | null;
  auto_renew?: boolean | null;
  sent_at?: string | null;
  viewed_at?: string | null;
  signed_at?: string | null;
  countersigned_at?: string | null;
  prior_agreement_id?: string | null;
  replaced_by_agreement_id?: string | null;
  source_template_id?: string | null;
  signers?: AgreementSignerInput[];
  linked_contact_ids?: string[];
  linked_location_ids?: string[];
};

export type AgreementUpdateInput = AgreementCreateInput & {
  note?: string | null;
};

export type AgreementFileCreateInput = {
  file_type: AgreementFileType;
  file_name: string;
  storage_reference: string;
  file_url?: string | null;
  content_type?: string | null;
  file_size_bytes?: number | null;
  version_label?: string | null;
  agreement_version_id?: string | null;
  version_stage?: AgreementVersionStage | null;
  create_version?: boolean;
  is_current?: boolean;
  activity_note?: string | null;
  legacy_upload?: boolean;
};

export type AgreementSignerInput = {
  contact_id?: string | null;
  signer_name: string;
  signer_email?: string | null;
  signer_role?: string | null;
  signer_order?: number | null;
  signer_type: AgreementSignerType;
  status?: AgreementSignerStatus;
  viewed_at?: string | null;
  signed_at?: string | null;
};

export type AgreementTemplateCreateInput = {
  template_name: string;
  agreement_type: AgreementType;
  active_status?: boolean;
  template_body?: string | null;
  template_file_reference?: string | null;
  merge_fields?: string[];
};

export type AgreementCreateFromTemplateInput = {
  template_id: string;
  agreement_title?: string | null;
  primary_contact_id?: string | null;
  description?: string | null;
  contract_value?: number | null;
  revenue_share_terms?: string | null;
  effective_date?: string | null;
  expiration_date?: string | null;
  renewal_date?: string | null;
  notice_deadline?: string | null;
  auto_renew?: boolean | null;
  signers?: AgreementSignerInput[];
  linked_contact_ids?: string[];
  linked_location_ids?: string[];
  note?: string | null;
};

export type AgreementSendReminderInput = {
  reminder_type: AgreementReminderType;
  channels?: AgreementReminderChannel[];
  note?: string | null;
};

export type AgreementRenewalDraftInput = {
  agreement_title?: string | null;
  effective_date?: string | null;
  expiration_date?: string | null;
  renewal_date?: string | null;
  notice_deadline?: string | null;
  auto_renew?: boolean | null;
  signers?: AgreementSignerInput[];
  note?: string | null;
};

export type AgreementSendForSignatureInput = {
  agreement_version_id?: string | null;
  provider_name?: AgreementExternalProviderName | null;
  note?: string | null;
};

export type AgreementProviderSyncInput = {
  note?: string | null;
};

type UploadPresignResponse = {
  url: string;
  fields: Record<string, string>;
  storage_key: string;
  object_url: string;
};

async function uploadDirectoryImage(
  token: string,
  file: File,
  resourceType: string,
  resourceId: string | null
) {
  const presign = await apiFetch<UploadPresignResponse>("/api/uploads/presign", token, {
    method: "POST",
    body: JSON.stringify({
      content_type: file.type || "image/jpeg",
      resource_type: resourceType,
      resource_id: resourceId ?? undefined
    })
  });

  const form = new FormData();
  for (const [key, value] of Object.entries(presign.fields)) {
    form.append(key, value);
  }
  form.append("file", file);

  const uploadResponse = await fetch(presign.url, {
    method: "POST",
    body: form
  });
  if (!uploadResponse.ok) {
    throw new Error("We couldn't upload that image right now.");
  }

  return presign.object_url;
}

export async function listOrganizations(
  token: string,
  filters: {
    search?: string;
    accountType?: OrganizationAccountType | "all";
    activeStatus?: DirectoryActiveStatus | "all";
    parentOrganizationId?: string | null;
  } = {}
) {
  const params = new URLSearchParams();
  if (filters.search?.trim()) {
    params.set("search", filters.search.trim());
  }
  if (filters.accountType && filters.accountType !== "all") {
    params.set("account_type", filters.accountType);
  }
  if (filters.activeStatus && filters.activeStatus !== "all") {
    params.set("active_status", filters.activeStatus);
  }
  if (filters.parentOrganizationId) {
    params.set("parent_organization_id", filters.parentOrganizationId);
  }
  const query = params.toString();
  return apiFetch<OrganizationListResponse>(`/api/organizations${query ? `?${query}` : ""}`, token);
}

export async function getOrganizationDetail(token: string, organizationId: string) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}`, token);
}

// Phase 4 Slice 5 — searchable canonical parent Districts for the Parent-District selector.
export async function listCanonicalDistricts(token: string, search?: string) {
  const params = new URLSearchParams();
  if (search?.trim()) {
    params.set("search", search.trim());
  }
  const query = params.toString();
  return apiFetch<CanonicalDistrictListResponse>(`/api/organizations/districts${query ? `?${query}` : ""}`, token);
}

export async function getOrganizationOperationsHub(token: string, organizationId: string) {
  return apiFetch<OrganizationOperationsHub>(`/api/organizations/${organizationId}/operations-hub`, token);
}

// ── Phase 4 Slice 4 — school-year / season service terms ─────────────────────
export type ServiceTermCreateInput = {
  period_type?: SchoolServiceTermPeriodType;
  period_label: string;
  start_date?: string | null;
  end_date?: string | null;
  internal_owner_user_id?: string | null;
  service_config?: Record<string, unknown>;
  notes?: string | null;
};

export type ServiceTermUpdateInput = {
  start_date?: string | null;
  end_date?: string | null;
  internal_owner_user_id?: string | null;
  service_config?: Record<string, unknown>;
  notes?: string | null;
  // Setting confirm=true marks an inherited (rolled-over) draft reviewed/confirmed.
  confirm?: boolean;
};

export async function listSchoolServiceTerms(token: string, organizationId: string) {
  return apiFetch<SchoolServiceTermListResponse>(`/api/organizations/${organizationId}/service-terms`, token);
}

export async function createSchoolServiceTermRecord(token: string, organizationId: string, input: ServiceTermCreateInput) {
  return apiFetch<{ service_term: SchoolServiceTermRecord }>(`/api/organizations/${organizationId}/service-terms`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function rolloverSchoolServiceTermRecord(token: string, termId: string, newPeriodLabel: string) {
  return apiFetch<{ service_term: SchoolServiceTermRecord }>(`/api/organizations/service-terms/${termId}/rollover`, token, {
    method: "POST",
    body: JSON.stringify({ new_period_label: newPeriodLabel })
  });
}

export async function activateSchoolServiceTermRecord(token: string, termId: string) {
  return apiFetch<{ service_term: SchoolServiceTermRecord }>(`/api/organizations/service-terms/${termId}/activate`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function updateSchoolServiceTermRecord(token: string, termId: string, input: ServiceTermUpdateInput) {
  return apiFetch<{ service_term: SchoolServiceTermRecord }>(`/api/organizations/service-terms/${termId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

// ── Phase 4 Slice 3/6 — canonical organization brand (real columns, not notes) ───
export type OrganizationBrandInput = {
  brand_primary_color?: string | null;
  brand_secondary_color?: string | null;
  mascot?: string | null;
  brand_status?: "known" | "unknown" | "not_available" | "not_applicable" | null;
  website?: string | null;
  logo_url?: string | null;
  logo_status?: "current" | "outdated" | "pending_review" | "unavailable" | null;
  logo_note?: string | null;
  logo_source?: string | null;
};

export async function updateOrganizationBrandRecord(token: string, organizationId: string, input: OrganizationBrandInput) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}/brand`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

// ── Phase 4.2 Part 2 — reusable canonical Contact identities ─────────────────
export async function listCanonicalContacts(
  token: string,
  filters: { search?: string; organizationId?: string | null; activeStatus?: string | null; role?: string | null; limit?: number; offset?: number } = {}
) {
  const params = new URLSearchParams();
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.organizationId) params.set("organization_id", filters.organizationId);
  if (filters.activeStatus) params.set("active_status", filters.activeStatus);
  if (filters.role) params.set("role", filters.role);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));
  const query = params.toString();
  return apiFetch<CanonicalContactListResponse>(`/api/organizations/contact-identities${query ? `?${query}` : ""}`, token);
}

export type CanonicalContactCreateInput = {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  preferred_contact_method?: string | null;
};

export async function createCanonicalContactRecord(token: string, input: CanonicalContactCreateInput) {
  return apiFetch<{ contact: CanonicalContactRecord }>("/api/organizations/contact-identities", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

// Phase 4.2 Bundle 1 — edit the canonical person identity (propagates to linked org rows).
export async function updateCanonicalContactRecord(token: string, contactId: string, input: CanonicalContactCreateInput) {
  return apiFetch<{ contact: CanonicalContactRecord }>(`/api/organizations/contact-identities/${contactId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function getCanonicalContactRelationships(token: string, contactId: string) {
  return apiFetch<CanonicalContactRelationshipsResponse>(`/api/organizations/contact-identities/${contactId}/relationships`, token);
}

// Phase 4.2 Bundle close — archive (soft) or restore a canonical Contact identity.
export async function setCanonicalContactArchivedRecord(token: string, contactId: string, archived: boolean) {
  return apiFetch<{ contact: CanonicalContactRecord }>(`/api/organizations/contact-identities/${contactId}/archive`, token, {
    method: "POST",
    body: JSON.stringify({ archived })
  });
}

export async function linkCanonicalContactToOrganizationRecord(
  token: string,
  contactId: string,
  input: { organization_id: string; relationship_role?: string; client_roles?: string[]; is_primary?: boolean }
) {
  return apiFetch<{ organization_contact_id: string }>(`/api/organizations/contact-identities/${contactId}/links`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

// Phase 4.2 — edit ONE relationship (role/primary/title/notes) in isolation.
export async function updateCanonicalContactRelationshipRecord(
  token: string,
  contactId: string,
  organizationContactId: string,
  input: { relationship_role?: string; client_roles?: string[]; is_primary?: boolean; title?: string | null; notes?: string | null }
) {
  return apiFetch<{ updated: boolean }>(`/api/organizations/contact-identities/${contactId}/links/${organizationContactId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

// Phase 4.2 Slice A — unlink one organization relationship (soft; identity + other links kept).
export async function unlinkCanonicalContactRelationshipRecord(token: string, contactId: string, organizationContactId: string) {
  return apiFetch<{ unlinked: boolean }>(`/api/organizations/contact-identities/${contactId}/links/${organizationContactId}`, token, {
    method: "DELETE"
  });
}

// Phase 4.1 — organization logo history + restore (migration-162 backend).
export async function getOrganizationLogoHistory(token: string, organizationId: string) {
  return apiFetch<OrganizationLogoHistoryResponse>(`/api/organizations/${organizationId}/logo-history`, token);
}

export async function restoreOrganizationLogoRecord(token: string, organizationId: string, historyId: string) {
  return apiFetch<OrganizationLogoHistoryResponse>(`/api/organizations/${organizationId}/logo-restore`, token, {
    method: "POST",
    body: JSON.stringify({ history_id: historyId })
  });
}

export async function listDirectoryContacts(
  token: string,
  filters: {
    search?: string;
    accountType?: OrganizationAccountType | "all";
    activeStatus?: DirectoryActiveStatus | "all";
    organizationId?: string | null;
    locationId?: string | null;
    contactStatus?: DirectoryContactStatus | "all";
    roleCategory?: DirectoryContactRoleCategory | "all";
    operationalImportance?: DirectoryOperationalImportance | "all";
    decisionInfluence?: DirectoryDecisionInfluence | "all";
    primaryInternalOwnerUserId?: string | null;
    relationshipOwnershipState?: DirectoryRelationshipOwnershipState | "all";
    hasPhoto?: boolean;
    hasLogo?: boolean;
    needsReview?: boolean;
    myContactsOnly?: boolean;
  } = {}
) {
  const params = new URLSearchParams();
  if (filters.search?.trim()) {
    params.set("search", filters.search.trim());
  }
  if (filters.accountType && filters.accountType !== "all") {
    params.set("account_type", filters.accountType);
  }
  if (filters.activeStatus && filters.activeStatus !== "all") {
    params.set("active_status", filters.activeStatus);
  }
  if (filters.organizationId) {
    params.set("organization_id", filters.organizationId);
  }
  if (filters.locationId) {
    params.set("location_id", filters.locationId);
  }
  if (filters.contactStatus && filters.contactStatus !== "all") {
    params.set("contact_status", filters.contactStatus);
  }
  if (filters.roleCategory && filters.roleCategory !== "all") {
    params.set("role_category", filters.roleCategory);
  }
  if (filters.operationalImportance && filters.operationalImportance !== "all") {
    params.set("operational_importance", filters.operationalImportance);
  }
  if (filters.decisionInfluence && filters.decisionInfluence !== "all") {
    params.set("decision_influence", filters.decisionInfluence);
  }
  if (filters.primaryInternalOwnerUserId) {
    params.set("primary_internal_owner_user_id", filters.primaryInternalOwnerUserId);
  }
  if (filters.relationshipOwnershipState && filters.relationshipOwnershipState !== "all") {
    params.set("relationship_ownership_state", filters.relationshipOwnershipState);
  }
  if (filters.hasPhoto) {
    params.set("has_photo", "true");
  }
  if (filters.hasLogo) {
    params.set("has_logo", "true");
  }
  if (filters.needsReview) {
    params.set("needs_review", "true");
  }
  if (filters.myContactsOnly) {
    params.set("my_contacts_only", "true");
  }
  const query = params.toString();
  return apiFetch<DirectoryContactListResponse>(`/api/organizations/contacts${query ? `?${query}` : ""}`, token);
}

export async function listDirectoryOwnerOptions(token: string) {
  return apiFetch<{ owners: DirectoryOwnerOption[] }>("/api/organizations/internal-owners", token);
}

export async function getOrganizationRelationshipContinuity(token: string, organizationId: string) {
  return apiFetch<DirectoryRelationshipContinuityBundle>(`/api/organizations/${organizationId}/continuity`, token);
}

export async function getContactRelationshipContinuity(token: string, contactId: string) {
  return apiFetch<DirectoryRelationshipContinuityBundle>(`/api/organizations/contacts/${contactId}/continuity`, token);
}

export async function getDirectoryContactDetail(token: string, contactId: string) {
  return apiFetch<DirectoryContactDetailResponse>(`/api/organizations/contacts/${contactId}`, token);
}

export async function listDirectoryLocations(
  token: string,
  filters: {
    search?: string;
    accountType?: OrganizationAccountType | "all";
    activeStatus?: DirectoryActiveStatus | "all";
  } = {}
) {
  const params = new URLSearchParams();
  if (filters.search?.trim()) {
    params.set("search", filters.search.trim());
  }
  if (filters.accountType && filters.accountType !== "all") {
    params.set("account_type", filters.accountType);
  }
  if (filters.activeStatus && filters.activeStatus !== "all") {
    params.set("active_status", filters.activeStatus);
  }
  const query = params.toString();
  return apiFetch<DirectoryLocationListResponse>(`/api/organizations/locations${query ? `?${query}` : ""}`, token);
}

export async function createOrganizationRecord(token: string, input: OrganizationCreateInput) {
  return apiFetch<OrganizationDetail>("/api/organizations", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

// Phase 4.2 Part 3 — atomic create: organization + contacts + locations + brand + first term
// in one transaction (no orphans on failure). The org fields reuse OrganizationCreateInput.
export type AtomicCreateContactInput = {
  existing_contact_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  relationship_role?: string;
  client_roles?: string[];
  is_primary?: boolean;
};
export type AtomicCreateLocationInput = {
  location_name: string;
  address_line_1: string;
  address_line_2?: string | null;
  city: string;
  state: string;
  zip: string;
  notes?: string | null;
  is_primary?: boolean;
};
export type AtomicCreateOrganizationInput = {
  organization: OrganizationCreateInput;
  contacts?: AtomicCreateContactInput[];
  locations?: AtomicCreateLocationInput[];
  brand?: OrganizationBrandInput | null;
  initial_service_term?: { period_type?: SchoolServiceTermPeriodType; period_label: string; start_date?: string | null; end_date?: string | null } | null;
};

export async function createOrganizationAtomicRecord(token: string, input: AtomicCreateOrganizationInput) {
  return apiFetch<{ organization_id: string; created_contact_ids: string[]; linked_contact_ids: string[]; created_location_count: number }>(
    "/api/organizations/atomic",
    token,
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function updateOrganizationRecord(token: string, organizationId: string, input: OrganizationUpdateInput) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function updateSchoolProfileRecord(token: string, organizationId: string, input: SchoolProfileUpdateInput) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}/school-profile`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function uploadOrganizationLogoFile(token: string, organizationId: string | null, file: File) {
  return uploadDirectoryImage(token, file, "organization_logo", organizationId);
}

export async function createOrganizationContactRecord(token: string, organizationId: string, input: OrganizationContactCreateInput) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}/contacts`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateOrganizationContactRecord(token: string, contactId: string, input: OrganizationContactUpdateInput) {
  return apiFetch<OrganizationDetail>(`/api/organizations/contacts/${contactId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function updateSchoolContactCategoriesRecord(
  token: string,
  organizationId: string,
  contactId: string,
  input: SchoolContactCategoriesUpdateInput
) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}/contacts/${contactId}/school-categories`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function uploadOrganizationContactPhotoFile(token: string, contactId: string | null, file: File) {
  return uploadDirectoryImage(token, file, "directory_contact_photo", contactId);
}

export async function archiveOrganizationContactRecord(token: string, contactId: string) {
  return apiFetch<OrganizationDetail>(`/api/organizations/contacts/${contactId}/archive`, token, {
    method: "POST"
  });
}

export async function reactivateOrganizationContactRecord(token: string, contactId: string) {
  return apiFetch<OrganizationDetail>(`/api/organizations/contacts/${contactId}/reactivate`, token, {
    method: "POST"
  });
}

export async function createSchoolRuleRecord(token: string, organizationId: string, input: SchoolRuleCreateInput) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}/school-rules`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateSchoolRuleRecord(
  token: string,
  organizationId: string,
  ruleId: string,
  input: SchoolRuleUpdateInput
) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}/school-rules/${ruleId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function createSchoolNoteRecord(token: string, organizationId: string, input: SchoolNoteCreateInput) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}/school-notes`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function listContactTouchpoints(token: string, contactId: string) {
  return apiFetch<DirectoryTouchpointListResponse>(`/api/organizations/contacts/${contactId}/touchpoints`, token);
}

export async function createOrganizationLocationRecord(token: string, organizationId: string, input: OrganizationLocationCreateInput) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}/locations`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateOrganizationLocationRecord(token: string, locationId: string, input: OrganizationLocationUpdateInput) {
  return apiFetch<OrganizationDetail>(`/api/organizations/locations/${locationId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function archiveOrganizationLocationRecord(token: string, locationId: string) {
  return apiFetch<OrganizationDetail>(`/api/organizations/locations/${locationId}/archive`, token, {
    method: "POST"
  });
}

export async function reactivateOrganizationLocationRecord(token: string, locationId: string) {
  return apiFetch<OrganizationDetail>(`/api/organizations/locations/${locationId}/reactivate`, token, {
    method: "POST"
  });
}

export async function attachContactToOrganizationRecord(
  token: string,
  organizationId: string,
  input: DirectoryRelationshipAttachInput
) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}/contact-links`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function attachContactToLocationRecord(token: string, locationId: string, input: DirectoryRelationshipAttachInput) {
  return apiFetch<OrganizationDetail>(`/api/organizations/locations/${locationId}/contacts`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function detachContactFromLocationRecord(token: string, locationId: string, contactId: string) {
  return apiFetch<OrganizationDetail>(`/api/organizations/locations/${locationId}/contacts/${contactId}`, token, {
    method: "DELETE"
  });
}

export async function attachContactToShootRecord(token: string, shootId: string, input: DirectoryRelationshipAttachInput) {
  return apiFetch<ShootDirectoryContactLinkResponse>(`/api/organizations/shoots/${shootId}/contacts`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function detachContactFromShootRecord(token: string, shootId: string, contactId: string) {
  return apiFetch<ShootDirectoryContactLinkResponse>(`/api/organizations/shoots/${shootId}/contacts/${contactId}`, token, {
    method: "DELETE"
  });
}

export async function listOrganizationTouchpoints(token: string, organizationId: string) {
  return apiFetch<DirectoryTouchpointListResponse>(`/api/organizations/${organizationId}/touchpoints`, token);
}

export async function createOrganizationTouchpointRecord(
  token: string,
  organizationId: string,
  input: DirectoryTouchpointCreateInput
) {
  return apiFetch<DirectoryTouchpointRecord>(`/api/organizations/${organizationId}/touchpoints`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function createDirectoryTouchpointPlanRecord(
  token: string,
  organizationId: string,
  input: DirectoryTouchpointPlanCreateInput
) {
  return apiFetch<DirectoryTouchpointPlan>(`/api/organizations/${organizationId}/touchpoint-plans`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateDirectoryTouchpointPlanRecord(
  token: string,
  touchpointPlanId: string,
  input: DirectoryTouchpointPlanUpdateInput
) {
  return apiFetch<DirectoryTouchpointPlan>(`/api/organizations/touchpoint-plans/${touchpointPlanId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function createDirectoryRelationshipMemoryRecord(
  token: string,
  organizationId: string,
  input: DirectoryRelationshipMemoryCreateInput
) {
  return apiFetch<DirectoryRelationshipMemoryRecord>(`/api/organizations/${organizationId}/relationship-memory`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateDirectoryRelationshipMemoryRecord(
  token: string,
  memoryId: string,
  input: DirectoryRelationshipMemoryUpdateInput
) {
  return apiFetch<DirectoryRelationshipMemoryRecord>(`/api/organizations/relationship-memory/${memoryId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function createDirectoryRelationshipFollowUpRecord(
  token: string,
  organizationId: string,
  input: DirectoryRelationshipFollowUpCreateInput
) {
  return apiFetch<DirectoryRelationshipFollowUpRecord>(`/api/organizations/${organizationId}/follow-ups`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateDirectoryRelationshipFollowUpRecord(
  token: string,
  followUpId: string,
  input: DirectoryRelationshipFollowUpUpdateInput
) {
  return apiFetch<DirectoryRelationshipFollowUpRecord>(`/api/organizations/follow-ups/${followUpId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function listDirectoryDuplicateReviews(token: string) {
  return apiFetch<DirectoryDuplicateReviewListResponse>("/api/organizations/duplicate-reviews", token);
}

export async function createDirectoryDuplicateReviewRecord(token: string, input: DirectoryDuplicateReviewCreateInput) {
  return apiFetch<DirectoryDuplicateReviewRecord>("/api/organizations/duplicate-reviews", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function createContactImportSessionRecord(token: string, input: DirectoryContactImportSessionCreateInput) {
  return apiFetch<DirectoryImportSessionRecord>("/api/organizations/contact-import-sessions", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function listContactImportSessionsRecord(token: string) {
  return apiFetch<DirectoryImportSessionListResponse>("/api/organizations/contact-import-sessions", token);
}

export async function getContactImportSessionRecord(token: string, sessionId: string) {
  return apiFetch<DirectoryImportSessionRecord>(`/api/organizations/contact-import-sessions/${sessionId}`, token);
}

export async function updateContactImportRowRecord(
  token: string,
  sessionId: string,
  rowId: string,
  input: DirectoryContactImportRowUpdateInput
) {
  return apiFetch<DirectoryImportSessionRecord>(`/api/organizations/contact-import-sessions/${sessionId}/rows/${rowId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function applyContactImportSessionRecord(token: string, sessionId: string) {
  return apiFetch<DirectoryImportSessionRecord>(`/api/organizations/contact-import-sessions/${sessionId}/apply`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function updateDirectoryDuplicateReviewRecord(
  token: string,
  reviewId: string,
  input: DirectoryDuplicateReviewUpdateInput
) {
  return apiFetch<DirectoryDuplicateReviewRecord>(`/api/organizations/duplicate-reviews/${reviewId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function createOrganizationAgreementRecord(token: string, organizationId: string, input: AgreementCreateInput) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}/agreements`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateOrganizationAgreementRecord(
  token: string,
  organizationId: string,
  agreementId: string,
  input: AgreementUpdateInput
) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}/agreements/${agreementId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function registerOrganizationAgreementFileRecord(
  token: string,
  organizationId: string,
  agreementId: string,
  input: AgreementFileCreateInput
) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}/agreements/${agreementId}/files`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function createOrganizationAgreementTemplateRecord(
  token: string,
  organizationId: string,
  input: AgreementTemplateCreateInput
) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}/agreement-templates`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function createOrganizationAgreementFromTemplateRecord(
  token: string,
  organizationId: string,
  input: AgreementCreateFromTemplateInput
) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}/agreements/from-template`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function sendOrganizationAgreementReminder(
  token: string,
  organizationId: string,
  agreementId: string,
  input: AgreementSendReminderInput
) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}/agreements/${agreementId}/reminders`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function sendOrganizationAgreementForSignature(
  token: string,
  organizationId: string,
  agreementId: string,
  input: AgreementSendForSignatureInput
) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}/agreements/${agreementId}/send`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function syncOrganizationAgreementProviderStatus(
  token: string,
  organizationId: string,
  agreementId: string,
  input: AgreementProviderSyncInput = {}
) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}/agreements/${agreementId}/provider-sync`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function createOrganizationAgreementRenewalDraft(
  token: string,
  organizationId: string,
  agreementId: string,
  input: AgreementRenewalDraftInput
) {
  return apiFetch<OrganizationDetail>(`/api/organizations/${organizationId}/agreements/${agreementId}/renewal`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function uploadOrganizationAgreementFile(
  token: string,
  organizationId: string,
  agreementId: string,
  file: File,
  options: {
    version_label?: string | null;
    version_stage?: AgreementVersionStage | null;
    is_current?: boolean;
    activity_note?: string | null;
    legacy_upload?: boolean;
  } = {}
) {
  const presign = await apiFetch<UploadPresignResponse>("/api/uploads/presign", token, {
    method: "POST",
    body: JSON.stringify({
      content_type: file.type || "application/pdf",
      resource_type: "agreement_file",
      resource_id: agreementId
    })
  });

  const form = new FormData();
  for (const [key, value] of Object.entries(presign.fields)) {
    form.append(key, value);
  }
  form.append("file", file);

  const uploadResponse = await fetch(presign.url, {
    method: "POST",
    body: form
  });
  if (!uploadResponse.ok) {
    throw new Error("We couldn't upload that Agreement file right now.");
  }

  return registerOrganizationAgreementFileRecord(token, organizationId, agreementId, {
    file_type: guessAgreementFileType(file),
    file_name: file.name,
    storage_reference: presign.storage_key,
    file_url: presign.object_url,
    content_type: file.type || null,
    file_size_bytes: file.size,
    version_label: options.version_label ?? null,
    version_stage: options.version_stage ?? (options.legacy_upload ? "legacy_import" : "revised"),
    create_version: true,
    is_current: options.is_current ?? true,
    activity_note: options.activity_note ?? null,
    legacy_upload: options.legacy_upload ?? false
  });
}

function guessAgreementFileType(file: File): AgreementFileType {
  const contentType = file.type.toLowerCase();
  if (contentType === "application/pdf") {
    return "pdf";
  }
  if (contentType.startsWith("image/")) {
    return "image";
  }
  if (
    contentType.includes("word") ||
    contentType.includes("document") ||
    file.name.toLowerCase().endsWith(".doc") ||
    file.name.toLowerCase().endsWith(".docx")
  ) {
    return "document";
  }
  return "other";
}
