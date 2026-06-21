import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { canManageCanonicalDirectoryRecords, canManageSchoolFoundation } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  DirectoryContactDetailResponse,
  DirectoryContactListResponse,
  DirectoryContactRoleCategory,
  DirectoryContactStatus,
  DirectoryCommunicationOutcome,
  DirectoryContactSummary,
  DirectoryDecisionInfluence,
  DirectoryContactRelationshipRole,
  DirectoryDuplicateReviewListResponse,
  DirectoryDuplicateReviewRecord,
  DirectoryDuplicateReviewDecision,
  DirectoryDuplicateReviewStatus,
  DirectoryFreshnessState,
  DirectoryInternalOwnerRecord,
  DirectoryLocationListResponse,
  DirectoryLocationSummary,
  DirectoryOperationalImportance,
  DirectoryOwnerOption,
  DirectoryRelationshipMaintenanceSignal,
  DirectoryRelationshipOwnershipState,
  DirectoryRelationshipStrength,
  DirectoryActiveStatus,
  DirectoryTouchpointChannel,
  DirectoryTouchpointCategory,
  DirectoryTouchpointListResponse,
  DirectoryTouchpointRecord,
  LocationContactLinkRecord,
  OrganizationAccountType,
  OrganizationContactRecord,
  OrganizationContactRelationshipHistoryRecord,
  OrganizationDetail,
  OrganizationListResponse,
  OrganizationLocationRecord,
  OrganizationSummary,
  SchoolActivityLogRecord,
  SchoolActivityType,
  SchoolContactCategory,
  SchoolProfileRecord,
  SchoolRelationshipHealthState,
  SchoolRuleRecord,
  SchoolRuleType,
  ShootDirectoryContactLinkRecord,
  ShootDirectoryContactLinkResponse
} from "../types/organizations.js";
import { getOrganizationAgreementsView } from "./agreements.js";
import { createAuditLog } from "./audit.js";
import {
  validateOrganizationParent,
  parseLegacyOrganizationNotes,
  type ClientEntityKind,
  type ClientOrganizationType
} from "./organizationHierarchy.js";
import { normalizeWebsite } from "./organizationBrand.js";
import { buildGoogleMapsLink } from "./maps.js";
import { getOrganizationResourceLibrary } from "./resourceLibrary.js";
import { getOrganizationSalesPipelineView } from "./salesPipeline.js";

type OrganizationListRow = {
  id: string;
  canonical_name: string;
  logo_url: string | null;
  display_name: string;
  account_type: OrganizationAccountType;
  active_status: DirectoryActiveStatus;
  parent_organization_id?: string | null;
  parent_organization_name?: string | null;
  client_entity_kind?: ClientEntityKind | null;
  client_organization_type?: ClientOrganizationType | null;
  website?: string | null;
  main_phone?: string | null;
  child_organization_count?: string | number | null;
  aliases: unknown;
  notes: string | null;
  contact_count: string | number;
  location_count: string | number;
  created_at: string;
  updated_at: string;
};

type OrganizationContactRow = {
  id: string;
  organization_id: string;
  canonical_organization_id?: string;
  first_name: string;
  last_name: string;
  full_name: string;
  preferred_name: string | null;
  title: string | null;
  department_program: string | null;
  phone: string | null;
  email: string | null;
  photo_url: string | null;
  active_status: DirectoryActiveStatus;
  contact_status: DirectoryContactStatus;
  role_category: DirectoryContactRoleCategory;
  decision_influence: DirectoryDecisionInfluence;
  operational_importance: DirectoryOperationalImportance;
  relationship_strength: DirectoryRelationshipStrength;
  primary_internal_owner_user_id: string | null;
  primary_internal_owner_name: string | null;
  primary_internal_owner_email: string | null;
  primary_internal_owner_department: string | null;
  primary_internal_owner_status: string | null;
  backup_internal_owner_user_id: string | null;
  backup_internal_owner_name: string | null;
  backup_internal_owner_email: string | null;
  backup_internal_owner_department: string | null;
  backup_internal_owner_status: string | null;
  last_confirmed_at: string | null;
  last_meaningful_interaction_at: string | null;
  primary_location_id: string | null;
  primary_location_name: string | null;
  handoff_ready: boolean;
  uncertainty_flag: boolean;
  last_updated_by_name: string | null;
  relationship_role?: DirectoryContactRelationshipRole | null;
  is_primary?: boolean;
  school_contact_categories?: unknown;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type OrganizationContactRelationshipHistoryRow = {
  id: string;
  contact_id: string;
  organization_id: string;
  organization_display_name: string;
  organization_account_type: OrganizationAccountType;
  relationship_role: DirectoryContactRelationshipRole;
  is_primary: boolean;
  is_current: boolean;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
};

type DirectoryContactListRow = OrganizationContactRow & {
  organization_display_name: string;
  organization_account_type: OrganizationAccountType;
  organization_logo_url: string | null;
};

type DirectoryInternalOwnerConnectionRow = {
  contact_id: string;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_department: string | null;
  owner_status: string | null;
  touchpoint_count: string | number;
  last_interaction_at: string | null;
};

type DirectoryOwnerOptionRow = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  department: string | null;
  status: string | null;
};

const SCHOOL_ACCOUNT_TYPES: OrganizationAccountType[] = ["schools_underclass_portraits", "schools_events"];

type OrganizationLocationRow = {
  id: string;
  organization_id: string | null;
  location_name: string;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  address_display: string | null;
  maps_label: string | null;
  maps_url: string | null;
  active_status: DirectoryActiveStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type LocationContactLinkRow = {
  location_id: string;
  contact_id: string;
  canonical_organization_id: string;
  full_name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  relationship_role: DirectoryContactRelationshipRole;
  is_primary: boolean;
};

type DirectoryTouchpointRow = {
  id: string;
  organization_id: string | null;
  location_id: string | null;
  shoot_id: string | null;
  contact_id: string | null;
  channel: DirectoryTouchpointChannel;
  category: DirectoryTouchpointCategory | null;
  subject: string | null;
  summary: string;
  outcome: string | null;
  outcome_state: DirectoryCommunicationOutcome | null;
  owner_user_id: string | null;
  owner_name: string | null;
  occurred_at: string;
  follow_up_date: string | null;
  follow_up_needed: boolean;
  follow_up_owner_user_id: string | null;
  follow_up_owner_name: string | null;
  follow_up_owner_email: string | null;
  follow_up_owner_department: string | null;
  follow_up_owner_status: string | null;
  relationship_memory_suggested: boolean;
  attachment_reference: string | null;
  touchpoint_plan_id: string | null;
  created_at: string;
  updated_at: string;
};

type DirectoryDuplicateReviewRow = {
  id: string;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  suspected_duplicate_contact_id: string | null;
  suspected_duplicate_contact_name: string | null;
  status: DirectoryDuplicateReviewStatus;
  decision: DirectoryDuplicateReviewDecision;
  summary: string;
  notes: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  reviewed_by_user_id: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

type SchoolProfileRow = {
  organization_id: string;
  district_name: string | null;
  school_type: string | null;
  school_year_label: string | null;
  relationship_health_state: SchoolRelationshipHealthState;
  relationship_summary: string | null;
  primary_internal_owner_user_id: string | null;
  primary_internal_owner_name: string | null;
  primary_internal_owner_email: string | null;
  primary_internal_owner_department: string | null;
  primary_internal_owner_status: string | null;
  backup_internal_owner_user_id: string | null;
  backup_internal_owner_name: string | null;
  backup_internal_owner_email: string | null;
  backup_internal_owner_department: string | null;
  backup_internal_owner_status: string | null;
  primary_location_id: string | null;
  primary_location_name: string | null;
  primary_location_address: string | null;
  tags: unknown;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type SchoolRuleRow = {
  id: string;
  organization_id: string;
  rule_type: SchoolRuleType;
  active_status: DirectoryActiveStatus;
  title: string;
  summary: string | null;
  structured_value: Record<string, unknown> | null;
  sort_order: number | string;
  created_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type SchoolActivityLogRow = {
  id: string;
  organization_id: string;
  activity_type: SchoolActivityType;
  summary: string;
  detail: string | null;
  metadata: Record<string, unknown> | null;
  related_contact_id: string | null;
  related_contact_name: string | null;
  related_rule_id: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string;
};

type ShootDirectoryContactLinkRow = {
  shoot_id: string;
  organization_id: string | null;
  primary_contact_id: string | null;
  contact_id: string;
  full_name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  contact_role: "primary" | "additional";
  relationship_role: DirectoryContactRelationshipRole;
  is_primary: boolean;
  sort_order: number;
};

type DirectoryLocationListRow = OrganizationLocationRow & {
  organization_display_name: string;
  organization_account_type: OrganizationAccountType;
};

type OrganizationRecentShootRow = {
  id: string;
  shoot_code: string;
  title: string;
  shoot_date: string;
  location_name: string | null;
};

type OrganizationUpcomingShootRow = OrganizationRecentShootRow & {
  showtime: string | null;
  start_time: string | null;
};

export type CreateOrganizationInput = {
  canonical_name: string;
  display_name?: string | null;
  logo_url?: string | null;
  account_type: OrganizationAccountType;
  active_status?: DirectoryActiveStatus;
  aliases?: string[];
  notes?: string | null;
  // Phase 4 canonical hierarchy + client fields (migration 144 columns).
  parent_organization_id?: string | null;
  client_entity_kind?: ClientEntityKind | null;
  client_organization_type?: ClientOrganizationType | null;
  website?: string | null;
  main_phone?: string | null;
};

type UpdateOrganizationInput = {
  canonical_name?: string | null;
  display_name?: string | null;
  logo_url?: string | null;
  account_type?: OrganizationAccountType;
  active_status?: DirectoryActiveStatus;
  aliases?: string[];
  notes?: string | null;
  parent_organization_id?: string | null;
  client_entity_kind?: ClientEntityKind | null;
  client_organization_type?: ClientOrganizationType | null;
  website?: string | null;
  main_phone?: string | null;
};

type UpdateSchoolProfileInput = {
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

type UpdateSchoolContactCategoriesInput = {
  school_contact_categories: SchoolContactCategory[];
};

type CreateSchoolRuleInput = {
  rule_type: SchoolRuleType;
  title?: string | null;
  summary?: string | null;
  active_status?: DirectoryActiveStatus;
  structured_value?: Record<string, unknown> | null;
  sort_order?: number | null;
};

type UpdateSchoolRuleInput = {
  title?: string | null;
  summary?: string | null;
  active_status?: DirectoryActiveStatus | null;
  structured_value?: Record<string, unknown> | null;
  sort_order?: number | null;
};

type CreateSchoolNoteInput = {
  summary: string;
  detail?: string | null;
};

type CreateOrganizationContactInput = {
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

type UpdateOrganizationContactInput = {
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
  title?: string | null;
  department_program?: string | null;
  phone?: string | null;
  email?: string | null;
  photo_url?: string | null;
  contact_status?: DirectoryContactStatus | null;
  role_category?: DirectoryContactRoleCategory | null;
  operational_importance?: DirectoryOperationalImportance | null;
  decision_influence?: DirectoryDecisionInfluence | null;
  primary_internal_owner_user_id?: string | null;
  backup_internal_owner_user_id?: string | null;
  relationship_strength?: DirectoryRelationshipStrength | null;
  handoff_ready?: boolean | null;
  last_confirmed_at?: string | null;
  uncertainty_flag?: boolean | null;
  notes?: string | null;
};

export type CreateOrganizationLocationInput = {
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

type UpdateOrganizationLocationInput = {
  location_name?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  maps_label?: string | null;
  notes?: string | null;
};

type OrganizationContactRelationshipInput = {
  contact_id: string;
  relationship_role?: DirectoryContactRelationshipRole;
  is_primary?: boolean;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean;
};

type LocationContactLinkInput = {
  contact_id: string;
  relationship_role?: DirectoryContactRelationshipRole;
  is_primary?: boolean;
};

type ShootContactLinkInput = {
  contact_id: string;
  relationship_role?: DirectoryContactRelationshipRole;
  is_primary?: boolean;
};

type CreateDirectoryTouchpointInput = {
  contact_id?: string | null;
  location_id?: string | null;
  shoot_id?: string | null;
  channel: DirectoryTouchpointChannel;
  summary: string;
  outcome?: string | null;
  owner_user_id?: string | null;
  occurred_at?: string | null;
  follow_up_date?: string | null;
};

type CreateDirectoryDuplicateReviewInput = {
  primary_contact_id: string;
  suspected_duplicate_contact_id: string;
  summary: string;
  notes?: string | null;
};

type UpdateDirectoryDuplicateReviewInput = {
  status?: DirectoryDuplicateReviewStatus;
  decision?: DirectoryDuplicateReviewDecision;
  notes?: string | null;
};

export async function listOrganizations(
  client: PoolClient,
  auth: AuthUser,
  filters: {
    search?: string | null;
    account_type?: OrganizationAccountType | null;
    active_status?: DirectoryActiveStatus | null;
    // Phase 4.1 — scope to a District's child accounts (Schools) for canonical Job Intake.
    parent_organization_id?: string | null;
  } = {}
): Promise<OrganizationListResponse> {
  const normalizedSearch = normalizeDirectoryText(filters.search);
  const fuzzySearch = normalizedSearch ? `%${normalizedSearch}%` : null;
  const { rows } = await client.query<OrganizationListRow>(
    `
      SELECT
        o.id,
        o.canonical_name,
        o.logo_url,
        o.display_name,
        o.account_type,
        o.active_status,
        COALESCE(
          (
            SELECT json_agg(alias ORDER BY alias)
            FROM organization_alias oa
            WHERE oa.tenant_id = o.tenant_id
              AND oa.organization_id = o.id
          ),
          '[]'::json
        ) AS aliases,
        o.notes,
        (
          SELECT count(*)::text
          FROM organization_contact_relationship ocr
          JOIN organization_contact oc
            ON oc.tenant_id = ocr.tenant_id
           AND oc.id = ocr.contact_id
          WHERE ocr.tenant_id = o.tenant_id
            AND ocr.organization_id = o.id
            AND ocr.is_current = true
            AND oc.active_status IN ('active', 'inactive')
        ) AS contact_count,
        (
          SELECT count(*)::text
          FROM shoot_location sl
          WHERE sl.tenant_id = o.tenant_id
            AND sl.organization_id = o.id
        ) AS location_count,
        o.created_at::text,
        o.updated_at::text
      FROM organization o
      WHERE o.tenant_id = $1
        AND ($2::organization_account_type IS NULL OR o.account_type = $2)
        AND ($3::directory_active_status IS NULL OR o.active_status = $3)
        AND ($5::uuid IS NULL OR o.parent_organization_id = $5)
        AND (
          $4::text IS NULL
          OR o.normalized_canonical_name LIKE $4
          OR lower(regexp_replace(COALESCE(o.display_name, ''), '[^a-zA-Z0-9]+', ' ', 'g')) LIKE $4
          OR EXISTS (
            SELECT 1
            FROM organization_alias oa
            WHERE oa.tenant_id = o.tenant_id
              AND oa.organization_id = o.id
              AND oa.normalized_alias LIKE $4
          )
        )
      ORDER BY lower(o.display_name), lower(o.canonical_name)
      LIMIT 80
    `,
    [auth.tenantId, filters.account_type ?? null, filters.active_status ?? null, fuzzySearch, filters.parent_organization_id ?? null]
  );

  return {
    organizations: rows.map(mapOrganizationSummary),
    search: {
      query: filters.search?.trim() ?? "",
      total: rows.length
    }
  };
}

// Phase 4 Slice 5 — canonical parent Districts for the searchable Parent-District
// selector. Returns only client_entity_kind='parent_organization' organizations
// (the canonical Districts), name-searchable and capped, with their child count so
// the picker can show how many Schools already roll up to each District.
export type CanonicalDistrictOption = {
  id: string;
  display_name: string;
  client_organization_type: string | null;
  child_organization_count: number;
};

export async function listCanonicalDistricts(
  client: PoolClient,
  auth: AuthUser,
  search?: string | null
): Promise<CanonicalDistrictOption[]> {
  const normalizedSearch = normalizeDirectoryText(search);
  const fuzzySearch = normalizedSearch ? `%${normalizedSearch}%` : null;
  const { rows } = await client.query<{ id: string; display_name: string; client_organization_type: string | null; child_organization_count: string | number | null }>(
    `
      SELECT
        o.id::text,
        o.display_name,
        o.client_organization_type,
        (
          SELECT count(*)::int
          FROM organization c
          WHERE c.tenant_id = o.tenant_id
            AND c.parent_organization_id = o.id
        ) AS child_organization_count
      FROM organization o
      WHERE o.tenant_id = $1
        AND o.client_entity_kind = 'parent_organization'
        AND (
          $2::text IS NULL
          OR o.normalized_canonical_name LIKE $2
          OR lower(regexp_replace(COALESCE(o.display_name, ''), '[^a-zA-Z0-9]+', ' ', 'g')) LIKE $2
        )
      ORDER BY lower(o.display_name)
      LIMIT 50
    `,
    [auth.tenantId, fuzzySearch]
  );
  return rows.map((row) => ({
    id: row.id,
    display_name: row.display_name,
    client_organization_type: row.client_organization_type ?? null,
    child_organization_count: Number(row.child_organization_count ?? 0)
  }));
}

export async function listDirectoryContacts(
  client: PoolClient,
  auth: AuthUser,
  filters: {
    search?: string | null;
    account_type?: OrganizationAccountType | null;
    active_status?: DirectoryActiveStatus | null;
    organization_id?: string | null;
    location_id?: string | null;
    contact_status?: DirectoryContactStatus | null;
    role_category?: DirectoryContactRoleCategory | null;
    operational_importance?: DirectoryOperationalImportance | null;
    decision_influence?: DirectoryDecisionInfluence | null;
    primary_internal_owner_user_id?: string | null;
    relationship_ownership_state?: DirectoryRelationshipOwnershipState | null;
    has_photo?: boolean | null;
    has_logo?: boolean | null;
    needs_review?: boolean | null;
    my_contacts_only?: boolean | null;
  } = {}
): Promise<DirectoryContactListResponse> {
  const normalizedSearch = normalizeDirectoryText(filters.search);
  const fuzzySearch = normalizedSearch ? `%${normalizedSearch}%` : null;
  const rawSearch = filters.search?.trim().toLowerCase() ? `%${filters.search.trim().toLowerCase()}%` : null;
  const { rows } = await client.query<DirectoryContactListRow>(
    `
      SELECT
        oc.id,
        oc.organization_id,
        oc.organization_id AS canonical_organization_id,
        oc.first_name,
        oc.last_name,
        oc.full_name,
        oc.preferred_name,
        oc.title,
        oc.department_program,
        oc.phone,
        oc.email,
        oc.photo_url,
        oc.active_status,
        oc.contact_status,
        oc.role_category,
        oc.decision_influence,
        oc.operational_importance,
        oc.relationship_strength,
        primary_owner.id::text AS primary_internal_owner_user_id,
        primary_owner.full_name AS primary_internal_owner_name,
        primary_owner.email AS primary_internal_owner_email,
        primary_owner.department AS primary_internal_owner_department,
        primary_owner.status AS primary_internal_owner_status,
        backup_owner.id::text AS backup_internal_owner_user_id,
        backup_owner.full_name AS backup_internal_owner_name,
        backup_owner.email AS backup_internal_owner_email,
        backup_owner.department AS backup_internal_owner_department,
        backup_owner.status AS backup_internal_owner_status,
        oc.last_confirmed_at::text,
        last_touch.last_occurred_at::text AS last_meaningful_interaction_at,
        primary_location.location_id AS primary_location_id,
        primary_location.location_name AS primary_location_name,
        oc.handoff_ready,
        oc.uncertainty_flag,
        updated_by.full_name AS last_updated_by_name,
        rel.relationship_role,
        rel.is_primary,
        rel.school_contact_categories,
        oc.notes,
        oc.created_at::text,
        oc.updated_at::text,
        o.display_name AS organization_display_name,
        o.account_type AS organization_account_type,
        o.logo_url AS organization_logo_url
      FROM organization_contact oc
      JOIN organization o
        ON o.tenant_id = oc.tenant_id
       AND o.id = oc.organization_id
      LEFT JOIN LATERAL (
        SELECT
          ocr.relationship_role,
          ocr.is_primary,
          ocr.school_contact_categories
        FROM organization_contact_relationship ocr
        WHERE ocr.tenant_id = oc.tenant_id
          AND ocr.contact_id = oc.id
          AND ocr.organization_id = oc.organization_id
          AND ocr.is_current = true
        ORDER BY ocr.is_primary DESC, ocr.created_at DESC
        LIMIT 1
      ) rel ON true
      LEFT JOIN app_user primary_owner
        ON primary_owner.id = oc.primary_internal_owner_user_id
      LEFT JOIN app_user backup_owner
        ON backup_owner.id = oc.backup_internal_owner_user_id
      LEFT JOIN app_user updated_by
        ON updated_by.id = oc.updated_by_user_id
      LEFT JOIN LATERAL (
        SELECT dt.occurred_at AS last_occurred_at
        FROM directory_touchpoint dt
        WHERE dt.tenant_id = oc.tenant_id
          AND dt.contact_id = oc.id
        ORDER BY dt.occurred_at DESC, dt.created_at DESC
        LIMIT 1
      ) last_touch ON true
      LEFT JOIN LATERAL (
        SELECT
          sl.id::text AS location_id,
          sl.name AS location_name
        FROM location_contact_link lcl
        JOIN shoot_location sl
          ON sl.tenant_id = lcl.tenant_id
         AND sl.id = lcl.location_id
        WHERE lcl.tenant_id = oc.tenant_id
          AND lcl.contact_id = oc.id
        ORDER BY lcl.is_primary DESC, lower(sl.name)
        LIMIT 1
      ) primary_location ON true
      WHERE oc.tenant_id = $1
        AND ($2::directory_active_status IS NULL OR oc.active_status = $2)
        AND ($3::organization_account_type IS NULL OR o.account_type = $3)
        AND ($4::uuid IS NULL OR oc.organization_id = $4)
        AND (
          $5::uuid IS NULL
          OR EXISTS (
            SELECT 1
            FROM location_contact_link lcl
            WHERE lcl.tenant_id = oc.tenant_id
              AND lcl.contact_id = oc.id
              AND lcl.location_id = $5
          )
        )
        AND ($6::directory_contact_status IS NULL OR oc.contact_status = $6)
        AND ($7::directory_contact_role_category IS NULL OR oc.role_category = $7)
        AND ($8::directory_operational_importance IS NULL OR oc.operational_importance = $8)
        AND ($9::directory_contact_influence_type IS NULL OR oc.decision_influence = $9)
        AND ($10::uuid IS NULL OR oc.primary_internal_owner_user_id = $10)
        AND (
          $11::text IS NULL
          OR CASE
            WHEN oc.primary_internal_owner_user_id IS NULL THEN 'unassigned'
            WHEN primary_owner.status IS NOT NULL AND primary_owner.status <> 'active' THEN 'needs_reassignment'
            WHEN oc.backup_internal_owner_user_id IS NOT NULL THEN 'shared'
            ELSE 'owned'
          END = $11
        )
        AND ($12::boolean IS NULL OR ($12 = true AND oc.photo_url IS NOT NULL) OR ($12 = false AND oc.photo_url IS NULL))
        AND ($13::boolean IS NULL OR ($13 = true AND o.logo_url IS NOT NULL) OR ($13 = false AND o.logo_url IS NULL))
        AND (
          $14::boolean IS NULL
          OR (
            $14 = true
            AND (
              oc.contact_status = 'needs_review'
              OR oc.uncertainty_flag = true
              OR oc.last_confirmed_at IS NULL
              OR oc.last_confirmed_at < current_date - 180
              OR oc.primary_internal_owner_user_id IS NULL
            )
          )
          OR (
            $14 = false
            AND NOT (
              oc.contact_status = 'needs_review'
              OR oc.uncertainty_flag = true
              OR oc.last_confirmed_at IS NULL
              OR oc.last_confirmed_at < current_date - 180
              OR oc.primary_internal_owner_user_id IS NULL
            )
          )
        )
        AND (
          $15::boolean IS NULL
          OR $15 = false
          OR oc.primary_internal_owner_user_id = $16
          OR oc.backup_internal_owner_user_id = $16
          OR EXISTS (
            SELECT 1
            FROM directory_touchpoint dt
            WHERE dt.tenant_id = oc.tenant_id
              AND dt.contact_id = oc.id
              AND dt.owner_user_id = $16
          )
        )
        AND (
          $17::text IS NULL
          OR oc.normalized_full_name LIKE $17
          OR lower(regexp_replace(COALESCE(o.display_name, ''), '[^a-zA-Z0-9]+', ' ', 'g')) LIKE $17
          OR lower(regexp_replace(COALESCE(oc.department_program, ''), '[^a-zA-Z0-9]+', ' ', 'g')) LIKE $17
          OR lower(regexp_replace(COALESCE(primary_location.location_name, ''), '[^a-zA-Z0-9]+', ' ', 'g')) LIKE $17
          OR ($18::text IS NOT NULL AND lower(COALESCE(oc.email, '')) LIKE $18)
          OR ($18::text IS NOT NULL AND lower(COALESCE(oc.phone, '')) LIKE $18)
          OR ($18::text IS NOT NULL AND lower(COALESCE(oc.title, '')) LIKE $18)
          OR ($18::text IS NOT NULL AND lower(COALESCE(primary_owner.full_name, '')) LIKE $18)
        )
      ORDER BY
        CASE oc.contact_status
          WHEN 'needs_review' THEN 0
          WHEN 'active' THEN 1
          WHEN 'inactive' THEN 2
          ELSE 3
        END,
        CASE oc.operational_importance
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          ELSE 3
        END,
        lower(oc.last_name),
        lower(oc.first_name),
        lower(o.display_name)
      LIMIT 120
    `,
    [
      auth.tenantId,
      filters.active_status ?? null,
      filters.account_type ?? null,
      filters.organization_id ?? null,
      filters.location_id ?? null,
      filters.contact_status ?? null,
      filters.role_category ?? null,
      filters.operational_importance ?? null,
      filters.decision_influence ?? null,
      filters.primary_internal_owner_user_id ?? null,
      filters.relationship_ownership_state ?? null,
      filters.has_photo ?? null,
      filters.has_logo ?? null,
      filters.needs_review ?? null,
      filters.my_contacts_only ?? null,
      auth.id,
      fuzzySearch,
      rawSearch
    ]
  );

  return {
    contacts: rows.map(mapDirectoryContactSummary),
    search: {
      query: filters.search?.trim() ?? "",
      total: rows.length
    }
  };
}

export async function listDirectoryOwnerOptions(
  client: PoolClient,
  auth: AuthUser
): Promise<DirectoryOwnerOption[]> {
  const { rows } = await client.query<DirectoryOwnerOptionRow>(
    `
      SELECT
        au.id::text AS user_id,
        COALESCE(NULLIF(trim(au.full_name), ''), au.email) AS full_name,
        au.email,
        au.department,
        au.status
      FROM app_user au
      WHERE au.tenant_id = $1
        AND au.status <> 'revoked'
      ORDER BY
        au.status = 'active' DESC,
        lower(COALESCE(NULLIF(trim(au.full_name), ''), au.email)),
        lower(au.email)
    `,
    [auth.tenantId]
  );

  return rows
    .filter((row) => row.user_id && (row.full_name || row.email))
    .map((row) => ({
      user_id: row.user_id,
      full_name: row.full_name ?? row.email ?? "",
      email: row.email,
      department: row.department,
      status: row.status
    }));
}

export async function listDirectoryLocations(
  client: PoolClient,
  auth: AuthUser,
  filters: {
    search?: string | null;
    account_type?: OrganizationAccountType | null;
    active_status?: DirectoryActiveStatus | null;
  } = {}
): Promise<DirectoryLocationListResponse> {
  const normalizedSearch = normalizeDirectoryText(filters.search);
  const fuzzySearch = normalizedSearch ? `%${normalizedSearch}%` : null;
  const rawSearch = filters.search?.trim().toLowerCase() ? `%${filters.search.trim().toLowerCase()}%` : null;
  const { rows } = await client.query<DirectoryLocationListRow>(
    `
      SELECT
        sl.id,
        sl.organization_id,
        sl.name AS location_name,
        sl.address_line_1,
        sl.address_line_2,
        sl.city,
        sl.state,
        sl.zip,
        COALESCE(
          NULLIF(sl.address, ''),
          NULLIF(
            trim(
              concat_ws(
                ', ',
                NULLIF(sl.address_line_1, ''),
                NULLIF(sl.address_line_2, ''),
                NULLIF(
                  trim(
                    concat_ws(
                      ' ',
                      NULLIF(concat_ws(', ', NULLIF(sl.city, ''), NULLIF(sl.state, '')), ''),
                      NULLIF(sl.zip, '')
                    )
                  ),
                  ''
                )
              )
            ),
            ''
          )
        ) AS address_display,
        sl.maps_label,
        sl.navigation_url AS maps_url,
        sl.active_status,
        sl.location_details AS notes,
        sl.created_at::text,
        sl.updated_at::text,
        o.display_name AS organization_display_name,
        o.account_type AS organization_account_type
      FROM shoot_location sl
      JOIN organization o
        ON o.tenant_id = sl.tenant_id
       AND o.id = sl.organization_id
      WHERE sl.tenant_id = $1
        AND sl.organization_id IS NOT NULL
        AND ($2::directory_active_status IS NULL OR sl.active_status = $2)
        AND ($3::organization_account_type IS NULL OR o.account_type = $3)
        AND (
          $4::text IS NULL
          OR sl.normalized_name LIKE $4
          OR COALESCE(sl.normalized_address, '') LIKE $4
          OR lower(regexp_replace(COALESCE(o.display_name, ''), '[^a-zA-Z0-9]+', ' ', 'g')) LIKE $4
          OR ($5::text IS NOT NULL AND lower(COALESCE(sl.maps_label, '')) LIKE $5)
        )
      ORDER BY
        sl.active_status = 'active' DESC,
        lower(o.display_name),
        lower(sl.name)
      LIMIT 120
    `,
    [auth.tenantId, filters.active_status ?? null, filters.account_type ?? null, fuzzySearch, rawSearch]
  );

  return {
    locations: rows.map(mapDirectoryLocationSummary),
    search: {
      query: filters.search?.trim() ?? "",
      total: rows.length
    }
  };
}

export async function getOrganizationDetail(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string
): Promise<OrganizationDetail | null> {
  const organization = await loadOrganizationSummary(client, auth.tenantId, organizationId);
  if (!organization) {
    return null;
  }

  const contactsResult = await client.query<OrganizationContactRow>(
    `
      SELECT
        oc.id,
        ocr.organization_id,
        oc.organization_id AS canonical_organization_id,
        oc.first_name,
        oc.last_name,
        oc.full_name,
        oc.preferred_name,
        oc.title,
        oc.department_program,
        oc.phone,
        oc.email,
        oc.photo_url,
        oc.active_status,
        oc.contact_status,
        oc.role_category,
        oc.decision_influence,
        oc.operational_importance,
        oc.relationship_strength,
        primary_owner.id::text AS primary_internal_owner_user_id,
        primary_owner.full_name AS primary_internal_owner_name,
        primary_owner.email AS primary_internal_owner_email,
        primary_owner.department AS primary_internal_owner_department,
        primary_owner.status AS primary_internal_owner_status,
        backup_owner.id::text AS backup_internal_owner_user_id,
        backup_owner.full_name AS backup_internal_owner_name,
        backup_owner.email AS backup_internal_owner_email,
        backup_owner.department AS backup_internal_owner_department,
        backup_owner.status AS backup_internal_owner_status,
        oc.last_confirmed_at::text,
        last_touch.last_occurred_at::text AS last_meaningful_interaction_at,
        primary_location.location_id AS primary_location_id,
        primary_location.location_name AS primary_location_name,
        oc.handoff_ready,
        oc.uncertainty_flag,
        updated_by.full_name AS last_updated_by_name,
        ocr.relationship_role,
        ocr.is_primary,
        ocr.school_contact_categories,
        oc.notes,
        oc.created_at::text,
        oc.updated_at::text
      FROM organization_contact_relationship ocr
      JOIN organization_contact oc
        ON oc.tenant_id = ocr.tenant_id
       AND oc.id = ocr.contact_id
      LEFT JOIN app_user primary_owner
        ON primary_owner.id = oc.primary_internal_owner_user_id
      LEFT JOIN app_user backup_owner
        ON backup_owner.id = oc.backup_internal_owner_user_id
      LEFT JOIN app_user updated_by
        ON updated_by.id = oc.updated_by_user_id
      LEFT JOIN LATERAL (
        SELECT dt.occurred_at AS last_occurred_at
        FROM directory_touchpoint dt
        WHERE dt.tenant_id = oc.tenant_id
          AND dt.contact_id = oc.id
        ORDER BY dt.occurred_at DESC, dt.created_at DESC
        LIMIT 1
      ) last_touch ON true
      LEFT JOIN LATERAL (
        SELECT
          sl.id::text AS location_id,
          sl.name AS location_name
        FROM location_contact_link lcl
        JOIN shoot_location sl
          ON sl.tenant_id = lcl.tenant_id
         AND sl.id = lcl.location_id
        WHERE lcl.tenant_id = oc.tenant_id
          AND lcl.contact_id = oc.id
        ORDER BY lcl.is_primary DESC, lower(sl.name)
        LIMIT 1
      ) primary_location ON true
      WHERE ocr.tenant_id = $1
        AND ocr.organization_id = $2
        AND ocr.is_current = true
      ORDER BY
        CASE oc.contact_status
          WHEN 'needs_review' THEN 0
          WHEN 'active' THEN 1
          WHEN 'inactive' THEN 2
          ELSE 3
        END,
        ocr.is_primary DESC,
        lower(oc.last_name),
        lower(oc.first_name)
    `,
    [auth.tenantId, organizationId]
  );
  const locationsResult = await client.query<OrganizationLocationRow>(
    `
      SELECT
        id,
        organization_id,
        name AS location_name,
        address_line_1,
        address_line_2,
        city,
        state,
        zip,
        COALESCE(
          NULLIF(address, ''),
          NULLIF(
            trim(
              concat_ws(
                ', ',
                NULLIF(address_line_1, ''),
                NULLIF(address_line_2, ''),
                NULLIF(
                  trim(
                    concat_ws(
                      ' ',
                      NULLIF(concat_ws(', ', NULLIF(city, ''), NULLIF(state, '')), ''),
                      NULLIF(zip, '')
                    )
                  ),
                  ''
                )
              )
            ),
            ''
          )
        ) AS address_display,
        maps_label,
        navigation_url AS maps_url,
        active_status,
        location_details AS notes,
        created_at::text,
        updated_at::text
      FROM shoot_location
      WHERE tenant_id = $1
        AND organization_id = $2
      ORDER BY active_status = 'active' DESC, lower(name)
    `,
    [auth.tenantId, organizationId]
  );
  const locationContactLinksResult = await client.query<LocationContactLinkRow>(
    `
      SELECT
        lcl.location_id,
        oc.id AS contact_id,
        oc.organization_id AS canonical_organization_id,
        oc.full_name,
        oc.title,
        oc.phone,
        oc.email,
        lcl.relationship_role,
        lcl.is_primary
      FROM location_contact_link lcl
      JOIN shoot_location sl
        ON sl.tenant_id = lcl.tenant_id
       AND sl.id = lcl.location_id
      JOIN organization_contact oc
        ON oc.tenant_id = lcl.tenant_id
       AND oc.id = lcl.contact_id
      WHERE lcl.tenant_id = $1
        AND sl.organization_id = $2
      ORDER BY lcl.is_primary DESC, lower(oc.full_name)
    `,
    [auth.tenantId, organizationId]
  );
  const touchpointsResult = await client.query<DirectoryTouchpointRow>(
    `
      SELECT
        dt.id,
        dt.organization_id,
        dt.location_id,
        dt.shoot_id,
        dt.contact_id,
        dt.channel,
        dt.category,
        dt.subject,
        dt.summary,
        dt.outcome,
        dt.outcome_state,
        dt.owner_user_id,
        owner.full_name AS owner_name,
        dt.occurred_at::text,
        dt.follow_up_date::text,
        dt.follow_up_needed,
        dt.follow_up_owner_user_id,
        follow_up_owner.full_name AS follow_up_owner_name,
        follow_up_owner.email AS follow_up_owner_email,
        follow_up_owner.department::text AS follow_up_owner_department,
        follow_up_owner.status::text AS follow_up_owner_status,
        dt.relationship_memory_suggested,
        dt.attachment_reference,
        dt.touchpoint_plan_id,
        dt.created_at::text,
        dt.updated_at::text
      FROM directory_touchpoint dt
      LEFT JOIN app_user owner
        ON owner.id = dt.owner_user_id
      LEFT JOIN app_user follow_up_owner
        ON follow_up_owner.id = dt.follow_up_owner_user_id
      WHERE dt.tenant_id = $1
        AND dt.organization_id = $2
      ORDER BY dt.occurred_at DESC, dt.created_at DESC
      LIMIT 12
    `,
    [auth.tenantId, organizationId]
  );
  const recentShootsResult = await client.query<OrganizationRecentShootRow>(
    `
      SELECT
        s.id,
        s.shoot_code,
        s.title,
        s.shoot_date::text,
        COALESCE(sl.name, s.location_name) AS location_name
      FROM shoot s
      LEFT JOIN shoot_location sl
        ON sl.tenant_id = s.tenant_id
       AND sl.id = s.location_id
      WHERE s.tenant_id = $1
        AND s.organization_id = $2
        AND s.deleted_at IS NULL
        AND s.record_state = 'published'::shoot_record_state
        AND s.shoot_date <= current_date
      ORDER BY
        s.shoot_date DESC,
        COALESCE(s.start_time, s.arrival_time, s.showtime) DESC NULLS LAST,
        s.title ASC
      LIMIT 6
    `,
    [auth.tenantId, organizationId]
  );
  const nextShootResult = await client.query<OrganizationUpcomingShootRow>(
    `
      SELECT
        s.id,
        s.shoot_code,
        s.title,
        s.shoot_date::text,
        COALESCE(sl.name, s.location_name) AS location_name,
        s.showtime::text,
        s.start_time::text
      FROM shoot s
      LEFT JOIN shoot_location sl
        ON sl.tenant_id = s.tenant_id
       AND sl.id = s.location_id
      WHERE s.tenant_id = $1
        AND s.organization_id = $2
        AND s.deleted_at IS NULL
        AND s.record_state = 'published'::shoot_record_state
        AND s.shoot_date >= current_date
      ORDER BY
        s.shoot_date ASC,
        COALESCE(s.showtime, s.arrival_time, s.start_time) ASC NULLS LAST,
        s.title ASC
      LIMIT 1
    `,
    [auth.tenantId, organizationId]
  );
  const [agreementsView, salesPipelineView, resourceLibrary] = await Promise.all([
    getOrganizationAgreementsView(client, auth, organizationId),
    getOrganizationSalesPipelineView(client, auth, organizationId),
    getOrganizationResourceLibrary(client, auth, organizationId)
  ]);
  const schoolFoundationEnabled = isSchoolOrganizationAccountType(organization.account_type);
  const [schoolProfile, schoolRules, schoolActivity] = schoolFoundationEnabled
    ? await Promise.all([
        loadSchoolProfile(client, auth.tenantId, organizationId),
        listSchoolRules(client, auth.tenantId, organizationId),
        listSchoolActivity(client, auth.tenantId, organizationId)
      ])
    : [null, [], []];
  const contactIds = contactsResult.rows.map((row) => row.id);
  const [relationshipHistoryByContactId, internalConnectionsByContactId, linkedLocationNamesByContactId] = await Promise.all([
    loadRelationshipHistoryForContacts(client, auth.tenantId, contactIds),
    loadInternalOwnerConnectionsForContacts(client, auth.tenantId, contactIds),
    loadLinkedLocationNamesForContacts(client, auth.tenantId, contactIds)
  ]);
  const contacts = contactsResult.rows.map((row) =>
    mapOrganizationContact(
      row,
      relationshipHistoryByContactId.get(row.id) ?? [],
      internalConnectionsByContactId.get(row.id) ?? [],
      linkedLocationNamesByContactId.get(row.id) ?? []
    )
  );
  const locationLinksByLocationId = new Map<string, LocationContactLinkRecord[]>();
  for (const row of locationContactLinksResult.rows) {
    const entry = mapLocationContactLink(row);
    const list = locationLinksByLocationId.get(row.location_id) ?? [];
    list.push(entry);
    locationLinksByLocationId.set(row.location_id, list);
  }
  const locations = locationsResult.rows.map((row) =>
    mapOrganizationLocation(row, locationLinksByLocationId.get(row.id) ?? [])
  );
  const touchpoints = touchpointsResult.rows.map(mapDirectoryTouchpoint);
  const recentShoots = recentShootsResult.rows.map((row) => ({
    id: row.id,
    shoot_code: row.shoot_code,
    title: row.title,
    shoot_date: row.shoot_date,
    location_name: row.location_name
  }));
  const nextShoot = nextShootResult.rows[0]
    ? {
        id: nextShootResult.rows[0].id,
        shoot_code: nextShootResult.rows[0].shoot_code,
        title: nextShootResult.rows[0].title,
        shoot_date: nextShootResult.rows[0].shoot_date,
        location_name: nextShootResult.rows[0].location_name,
        showtime: nextShootResult.rows[0].showtime,
        start_time: nextShootResult.rows[0].start_time
      }
    : null;
  const accountOverview = buildOrganizationAccountOverview({
    contacts,
    recentShoots,
    nextShoot,
    agreementSummary: agreementsView.agreement_summary,
    agreements: agreementsView.agreements,
    upcomingShootAgreementRisks: agreementsView.upcoming_shoot_agreement_risks,
    salesPipelineSummary: salesPipelineView.summary,
    salesPipelineAlerts: salesPipelineView.alerts
  });

  const childOrganizations = await loadChildOrganizations(client, auth.tenantId, organizationId);

  return {
    organization,
    contacts,
    locations,
    child_organizations: childOrganizations,
    school_profile: schoolProfile,
    school_rules: schoolRules,
    school_activity: schoolActivity,
    touchpoints,
    recent_shoots: recentShoots,
    next_shoot: nextShoot,
    sales_opportunities: salesPipelineView.opportunities.slice(0, 6).map((opportunity) => ({
      id: opportunity.id,
      pipeline_type: opportunity.pipeline_type,
      opportunity_type: opportunity.opportunity_type,
      stage: opportunity.stage,
      status: opportunity.status,
      owner_id: opportunity.owner_id,
      owner_name: opportunity.owner_name,
      primary_contact_id: opportunity.primary_contact_id,
      primary_contact_name: opportunity.primary_contact_name,
      estimated_value: opportunity.estimated_value,
      next_action_date: opportunity.next_action_date,
      last_touch_date: opportunity.last_touch_date,
      follow_up_date: opportunity.follow_up_date,
      attention_state: opportunity.attention_state,
      open_alert_count: opportunity.open_alert_count,
      notes: opportunity.notes
    })),
    account_overview: accountOverview,
    agreements_access: agreementsView.agreements_access,
    agreement_summary: agreementsView.agreement_summary,
    agreements: agreementsView.agreements,
    agreement_templates: agreementsView.agreement_templates,
    upcoming_shoot_agreement_risks: agreementsView.upcoming_shoot_agreement_risks,
    sales_pipeline_summary: salesPipelineView.summary,
    sales_pipeline_alerts: salesPipelineView.alerts,
    sales_email_templates: salesPipelineView.email_templates,
    sales_communications: salesPipelineView.communications,
    resource_library: resourceLibrary,
    placeholders: {
      agreement_summary: agreementsView.agreements_access.can_view
        ? agreementsView.agreement_summary.total
          ? agreementsView.agreement_summary.needs_attention
            ? "Contracts & Agreements has active attention items on this Organization."
            : "Contracts & Agreements is organized here with active coverage and clean version history."
          : "No Agreements are attached to this Organization yet."
        : "Contracts & Agreements is restricted to leadership in this workspace.",
      sales_pipeline_summary: salesPipelineView.can_view
        ? salesPipelineView.summary.linked_opportunities
          ? salesPipelineView.summary.open_alerts
            ? "Schools and Sports opportunity work is linked here with active CRM follow-up pressure."
            : "Schools and Sports opportunity work is attached here with no open CRM hygiene alerts."
          : "No active sales pipeline work is linked to this Organization yet."
        : "Sales pipeline visibility is restricted to leadership and client success roles.",
      recent_shoots_summary: recentShootsResult.rows.length
        ? "Recent linked Shoot history is ready here for fast account review."
        : "Recent Shoot history will populate here as linked Shoot records accumulate on this Organization.",
      resource_library_summary: resourceLibrary.summary.total_items
        ? "Reference media, documents, and historical prep context are attached to this Organization."
        : "No Resource Library items are attached to this Organization yet."
    }
  };
}

export async function createOrganization(
  client: PoolClient,
  auth: AuthUser,
  input: CreateOrganizationInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertOrganizationDirectoryManageAccess(auth);

  const canonicalName = input.canonical_name.trim();
  const displayName = (input.display_name?.trim() || canonicalName).trim();
  const normalizedCanonicalName = normalizeDirectoryText(canonicalName);
  const aliases = dedupeAliasValues(input.aliases ?? []);

  const duplicate = await findConflictingOrganization(client, auth.tenantId, normalizedCanonicalName, aliases);
  if (duplicate) {
    throw new ApiError(
      409,
        `An organization with a matching name or alias already exists: ${duplicate.display_name}`
    );
  }

  // Canonical hierarchy (Phase 4). A District is a top-level parent_organization;
  // a School is an account whose parent_organization_id references its District.
  // Backward-compatible: the parent-District requirement is enforced only when the
  // caller opts into the canonical account flow (client_entity_kind explicitly set);
  // legacy callers that omit it keep creating records as before (column default 'account').
  const explicitKind = input.client_entity_kind ?? null;
  const entityKind: ClientEntityKind = explicitKind ?? "account";
  const parentId = (input.parent_organization_id ?? "").trim() || null;
  if (entityKind === "parent_organization" && parentId) {
    throw new ApiError(400, "A District (parent organization) cannot itself have a parent.");
  }
  if (explicitKind === "account" && isSchoolOrganizationAccountType(input.account_type) && !parentId) {
    throw new ApiError(400, "A School requires a canonical parent District.");
  }
  if (parentId) {
    await validateOrganizationParent(client, auth.tenantId, parentId, null);
  }

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO organization (
        tenant_id,
        canonical_name,
        normalized_canonical_name,
        display_name,
        logo_url,
        account_type,
        active_status,
        notes,
        parent_organization_id,
        client_entity_kind,
        client_organization_type,
        website,
        main_phone,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
      RETURNING id
    `,
    [
      auth.tenantId,
      canonicalName,
      normalizedCanonicalName,
      displayName,
      normalizeOptionalText(input.logo_url),
      input.account_type,
      input.active_status ?? "active",
      normalizeOptionalText(input.notes),
      parentId,
      entityKind,
      input.client_organization_type ?? null,
      normalizeWebsite(input.website),
      normalizeOptionalText(input.main_phone),
      auth.id
    ]
  );
  const organizationId = rows[0].id;

  for (const alias of aliases) {
    await client.query(
      `
        INSERT INTO organization_alias (
          tenant_id,
          organization_id,
          alias,
          normalized_alias,
          created_by_user_id,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,now())
      `,
      [auth.tenantId, organizationId, alias, normalizeDirectoryText(alias), auth.id]
    );
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "organization.created",
    entityType: "organization",
    entityId: organizationId,
    metadata: {
      canonical_name: canonicalName,
      display_name: displayName,
      logo_url: normalizeOptionalText(input.logo_url),
      account_type: input.account_type,
      aliases
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  if (isSchoolOrganizationAccountType(input.account_type)) {
    await ensureSchoolProfileRecord(client, auth.tenantId, organizationId, auth.id);
    await appendSchoolActivityLog(client, {
      tenantId: auth.tenantId,
      organizationId,
      activityType: "profile_created",
      summary: "School foundation profile created.",
      detail: `${displayName} is now tracked as a canonical school record.`,
      actorUserId: auth.id,
      metadata: {
        account_type: input.account_type
      }
    });
  }

  return getOrganizationDetail(client, auth, organizationId);
}

export async function createOrganizationContact(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  input: CreateOrganizationContactInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertOrganizationDirectoryManageAccess(auth);
  const organization = await loadOrganizationSummary(client, auth.tenantId, organizationId);
  if (!organization) {
    throw new ApiError(404, "Organization not found");
  }
  assertSchoolFoundationAccessForOrganization(auth, organization.account_type);

  const firstName = input.first_name.trim();
  const lastName = input.last_name.trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const normalizedFullName = normalizeDirectoryText(fullName);
  const preferredName = normalizeOptionalText(input.preferred_name);
  const departmentProgram = normalizeOptionalText(input.department_program);
  const email = normalizeOptionalText(input.email)?.toLowerCase() ?? null;
  const primaryInternalOwnerUserId = normalizeOptionalUuid(input.primary_internal_owner_user_id);
  const backupInternalOwnerUserId = normalizeOptionalUuid(input.backup_internal_owner_user_id);
  const contactStatus = input.contact_status ?? deriveContactStatusFromActiveStatus(input.active_status ?? "active");
  const activeStatus = deriveActiveStatusFromContactStatus(contactStatus);
  const lastConfirmedAt = normalizeOptionalDate(input.last_confirmed_at);

  if (primaryInternalOwnerUserId && backupInternalOwnerUserId && primaryInternalOwnerUserId === backupInternalOwnerUserId) {
    throw new ApiError(400, "Choose different people for the primary and backup relationship owners");
  }
  await Promise.all([
    assertDirectoryOwnerExists(client, auth.tenantId, primaryInternalOwnerUserId),
    assertDirectoryOwnerExists(client, auth.tenantId, backupInternalOwnerUserId)
  ]);

  const duplicate = await client.query<{ id: string }>(
    `
      SELECT id
      FROM organization_contact
      WHERE tenant_id = $1
        AND organization_id = $2
        AND (
          normalized_full_name = $3
          OR ($4::text IS NOT NULL AND lower(email) = $4)
        )
      LIMIT 1
    `,
    [auth.tenantId, organizationId, normalizedFullName, email]
  );
  if (duplicate.rows[0]) {
    throw new ApiError(409, "A Contact with the same name or email already exists for this Organization");
  }

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO organization_contact (
        tenant_id,
        organization_id,
        first_name,
        last_name,
        full_name,
        normalized_full_name,
        preferred_name,
        title,
        department_program,
        phone,
        email,
        photo_url,
        active_status,
        contact_status,
        role_category,
        operational_importance,
        decision_influence,
        primary_internal_owner_user_id,
        backup_internal_owner_user_id,
        relationship_strength,
        handoff_ready,
        last_confirmed_at,
        uncertainty_flag,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
      RETURNING id
    `,
    [
      auth.tenantId,
      organizationId,
      firstName,
      lastName,
      fullName,
      normalizedFullName,
      preferredName,
      normalizeOptionalText(input.title),
      departmentProgram,
      normalizeOptionalText(input.phone),
      email,
      normalizeOptionalText(input.photo_url),
      activeStatus,
      contactStatus,
      input.role_category ?? "other",
      input.operational_importance ?? "normal",
      input.decision_influence ?? "informational_only",
      primaryInternalOwnerUserId,
      backupInternalOwnerUserId,
      input.relationship_strength ?? "unknown",
      input.handoff_ready ?? false,
      lastConfirmedAt,
      input.uncertainty_flag ?? false,
      normalizeOptionalText(input.notes),
      auth.id,
      auth.id
    ]
  );
  await saveOrganizationContactRelationship(client, {
    tenantId: auth.tenantId,
    organizationId,
    contactId: rows[0].id,
    relationshipRole: "general",
    isPrimary: false,
    startDate: null,
    endDate: null,
    isCurrent: true,
    actorUserId: auth.id
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "contact.created",
    entityType: "organization_contact",
    entityId: rows[0].id,
    metadata: {
      organization_id: organizationId,
      full_name: fullName,
      email,
      contact_status: contactStatus,
      role_category: input.role_category ?? "other",
      operational_importance: input.operational_importance ?? "normal",
      decision_influence: input.decision_influence ?? "informational_only",
      primary_internal_owner_user_id: primaryInternalOwnerUserId,
      backup_internal_owner_user_id: backupInternalOwnerUserId
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  if (isSchoolOrganizationAccountType(organization.account_type)) {
    await ensureSchoolProfileRecord(client, auth.tenantId, organizationId, auth.id);
  }

  return getOrganizationDetail(client, auth, organizationId);
}

export async function createOrganizationLocation(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  input: CreateOrganizationLocationInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertOrganizationDirectoryManageAccess(auth);
  await assertOrganizationExists(client, auth.tenantId, organizationId);

  const locationName = input.location_name.trim();
  const addressLine1 = input.address_line_1.trim();
  const addressLine2 = normalizeOptionalText(input.address_line_2);
  const city = input.city.trim();
  const state = input.state.trim().toUpperCase();
  const zip = input.zip.trim();
  const addressDisplay = buildAddressDisplay({
    address_line_1: addressLine1,
    address_line_2: addressLine2,
    city,
    state,
    zip
  });
  const normalizedName = normalizeDirectoryText(locationName);
  const normalizedAddress = normalizeDirectoryText(addressDisplay);
  const mapsLabel = normalizeOptionalText(input.maps_label) ?? locationName;

  const duplicate = await client.query<{ id: string }>(
    `
      SELECT id
      FROM shoot_location
      WHERE tenant_id = $1
        AND organization_id = $2
        AND normalized_name = $3
        AND COALESCE(normalized_address, '') = COALESCE($4, '')
      LIMIT 1
    `,
    [auth.tenantId, organizationId, normalizedName, normalizedAddress || null]
  );
  if (duplicate.rows[0]) {
    throw new ApiError(409, "A Location with the same name and address already exists on this Organization");
  }

  const mapsUrl = buildGoogleMapsLink({
    address: addressDisplay,
    label: mapsLabel
  });

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO shoot_location (
        tenant_id,
        organization_id,
        external_source,
        external_key,
        name,
        normalized_name,
        address,
        normalized_address,
        address_line_1,
        address_line_2,
        city,
        state,
        zip,
        maps_label,
        location_details,
        active_status,
        navigation_url,
        created_by_user_id,
        updated_by_user_id,
        updated_at
      )
      VALUES (
        $1,$2,'mission_control',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17,now()
      )
      RETURNING id
    `,
    [
      auth.tenantId,
      organizationId,
      `manual:${randomUUID()}`,
      locationName,
      normalizedName,
      addressDisplay,
      normalizedAddress || null,
      addressLine1,
      addressLine2,
      city,
      state,
      zip,
      mapsLabel,
      normalizeOptionalText(input.notes),
      input.active_status ?? "active",
      mapsUrl,
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "location.created",
    entityType: "shoot_location",
    entityId: rows[0].id,
    metadata: {
      organization_id: organizationId,
      location_name: locationName,
      address: addressDisplay
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return getOrganizationDetail(client, auth, organizationId);
}

export async function updateOrganization(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  patch: UpdateOrganizationInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertOrganizationDirectoryManageAccess(auth);

  const currentResult = await client.query<{
    id: string;
    canonical_name: string;
    display_name: string;
    logo_url: string | null;
    account_type: OrganizationAccountType;
    active_status: DirectoryActiveStatus;
    notes: string | null;
    parent_organization_id: string | null;
    client_entity_kind: ClientEntityKind | null;
    client_organization_type: ClientOrganizationType | null;
    website: string | null;
    main_phone: string | null;
    aliases: unknown;
  }>(
    `
      SELECT
        o.id,
        o.canonical_name,
        o.display_name,
        o.logo_url,
        o.account_type,
        o.active_status,
        o.notes,
        o.parent_organization_id::text AS parent_organization_id,
        o.client_entity_kind::text AS client_entity_kind,
        o.client_organization_type::text AS client_organization_type,
        o.website,
        o.main_phone,
        COALESCE(
          (
            SELECT json_agg(alias ORDER BY alias)
            FROM organization_alias oa
            WHERE oa.tenant_id = o.tenant_id
              AND oa.organization_id = o.id
          ),
          '[]'::json
        ) AS aliases
      FROM organization o
      WHERE o.tenant_id = $1
        AND o.id = $2
      LIMIT 1
    `,
    [auth.tenantId, organizationId]
  );
  const current = currentResult.rows[0];
  if (!current) {
    throw new ApiError(404, "Organization not found");
  }

  const canonicalName =
    patch.canonical_name !== undefined ? (patch.canonical_name ?? current.canonical_name).trim() : current.canonical_name;
  const displayName =
    patch.display_name !== undefined
      ? (((patch.display_name ?? canonicalName).trim()) || canonicalName).trim()
      : current.display_name;
  const logoUrl = patch.logo_url !== undefined ? normalizeOptionalText(patch.logo_url) : current.logo_url;
  const accountType = patch.account_type ?? current.account_type;
  const activeStatus = patch.active_status ?? current.active_status;
  const notes = patch.notes !== undefined ? normalizeOptionalText(patch.notes) : current.notes;
  const aliases = patch.aliases !== undefined ? dedupeAliasValues(patch.aliases) : toStringArray(current.aliases);
  const normalizedCanonicalName = normalizeDirectoryText(canonicalName);

  // Canonical hierarchy + client fields (Phase 4). Resolve patch over current, then
  // validate the hierarchy (self/cycle/type) before writing.
  const entityKind: ClientEntityKind = patch.client_entity_kind ?? current.client_entity_kind ?? "account";
  const parentId =
    patch.parent_organization_id !== undefined ? ((patch.parent_organization_id ?? "").trim() || null) : current.parent_organization_id;
  const clientOrganizationType =
    patch.client_organization_type !== undefined ? (patch.client_organization_type ?? null) : current.client_organization_type;
  const website = patch.website !== undefined ? normalizeWebsite(patch.website) : current.website;
  const mainPhone = patch.main_phone !== undefined ? normalizeOptionalText(patch.main_phone) : current.main_phone;
  if (entityKind === "parent_organization" && parentId) {
    throw new ApiError(400, "A District (parent organization) cannot itself have a parent.");
  }
  // Backward-compatible: don't force a parent onto a legacy parentless School during an
  // unrelated edit, but never allow removing the District from a School that has one.
  if (isSchoolOrganizationAccountType(accountType) && entityKind === "account" && !parentId && current.parent_organization_id) {
    throw new ApiError(400, "A School cannot have its parent District removed.");
  }
  if (parentId) {
    await validateOrganizationParent(client, auth.tenantId, parentId, organizationId);
  }

  const duplicate = await findConflictingOrganization(client, auth.tenantId, normalizedCanonicalName, aliases, organizationId);
  if (duplicate) {
      throw new ApiError(409, `An organization with a matching name or alias already exists: ${duplicate.display_name}`);
  }

  await client.query(
    `
      UPDATE organization
      SET
        canonical_name = $3,
        normalized_canonical_name = $4,
        display_name = $5,
        logo_url = $6,
        account_type = $7,
        active_status = $8,
        notes = $9,
        parent_organization_id = $11,
        client_entity_kind = $12,
        client_organization_type = $13,
        website = $14,
        main_phone = $15,
        updated_by_user_id = $10,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, organizationId, canonicalName, normalizedCanonicalName, displayName, logoUrl, accountType, activeStatus, notes, auth.id, parentId, entityKind, clientOrganizationType, website, mainPhone]
  );

  if (patch.aliases !== undefined) {
    await client.query("DELETE FROM organization_alias WHERE tenant_id = $1 AND organization_id = $2", [auth.tenantId, organizationId]);
    for (const alias of aliases) {
      await client.query(
        `
          INSERT INTO organization_alias (
            tenant_id,
            organization_id,
            alias,
            normalized_alias,
            created_by_user_id,
            updated_at
          )
          VALUES ($1,$2,$3,$4,$5,now())
        `,
        [auth.tenantId, organizationId, alias, normalizeDirectoryText(alias), auth.id]
      );
    }
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "organization.updated",
    entityType: "organization",
    entityId: organizationId,
    previousValues: {
      canonical_name: current.canonical_name,
      display_name: current.display_name,
      logo_url: current.logo_url,
      account_type: current.account_type,
      active_status: current.active_status,
      aliases: toStringArray(current.aliases),
      notes: current.notes
    },
    newValues: {
      canonical_name: canonicalName,
      display_name: displayName,
      logo_url: logoUrl,
      account_type: accountType,
      active_status: activeStatus,
      aliases,
      notes
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return getOrganizationDetail(client, auth, organizationId);
}

export async function updateSchoolProfile(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  patch: UpdateSchoolProfileInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertSchoolFoundationManageAccess(auth);
  const organization = await assertSchoolOrganization(client, auth.tenantId, organizationId);
  const current = await loadSchoolProfile(client, auth.tenantId, organizationId);
  await ensureSchoolProfileRecord(client, auth.tenantId, organizationId, auth.id);

  const primaryInternalOwnerUserId =
    patch.primary_internal_owner_user_id !== undefined
      ? normalizeOptionalUuid(patch.primary_internal_owner_user_id)
      : current?.primary_internal_owner?.user_id ?? null;
  const backupInternalOwnerUserId =
    patch.backup_internal_owner_user_id !== undefined
      ? normalizeOptionalUuid(patch.backup_internal_owner_user_id)
      : current?.backup_internal_owner?.user_id ?? null;

  if (primaryInternalOwnerUserId && backupInternalOwnerUserId && primaryInternalOwnerUserId === backupInternalOwnerUserId) {
    throw new ApiError(400, "Choose different people for the primary and backup school owners");
  }

  await assertDirectoryOwnerExists(client, auth.tenantId, primaryInternalOwnerUserId);
  await assertDirectoryOwnerExists(client, auth.tenantId, backupInternalOwnerUserId);

  const primaryLocationId =
    patch.primary_location_id !== undefined
      ? normalizeOptionalUuid(patch.primary_location_id)
      : current?.primary_location_id ?? null;
  if (primaryLocationId) {
    await assertLocationBelongsToOrganization(client, auth.tenantId, organizationId, primaryLocationId);
  }

  const districtName = patch.district_name !== undefined ? normalizeOptionalText(patch.district_name) : current?.district_name ?? null;
  const schoolType = patch.school_type !== undefined ? normalizeOptionalText(patch.school_type) : current?.school_type ?? null;
  const schoolYearLabel =
    patch.school_year_label !== undefined ? normalizeOptionalText(patch.school_year_label) : current?.school_year_label ?? null;
  const relationshipHealthState = patch.relationship_health_state ?? current?.relationship_health_state ?? "unknown";
  const relationshipSummary =
    patch.relationship_summary !== undefined ? normalizeOptionalText(patch.relationship_summary) : current?.relationship_summary ?? null;
  const tags = patch.tags !== undefined ? dedupeAliasValues(patch.tags) : current?.tags ?? [];
  const notes = patch.notes !== undefined ? normalizeOptionalText(patch.notes) : current?.notes ?? null;

  await client.query(
    `
      UPDATE school_profile
      SET
        district_name = $3,
        school_type = $4,
        school_year_label = $5,
        relationship_health_state = $6,
        relationship_summary = $7,
        primary_internal_owner_user_id = $8,
        backup_internal_owner_user_id = $9,
        primary_location_id = $10,
        tags = $11,
        notes = $12,
        updated_by_user_id = $13,
        updated_at = now()
      WHERE tenant_id = $1
        AND organization_id = $2
    `,
    [
      auth.tenantId,
      organizationId,
      districtName,
      schoolType,
      schoolYearLabel,
      relationshipHealthState,
      relationshipSummary,
      primaryInternalOwnerUserId,
      backupInternalOwnerUserId,
      primaryLocationId,
      tags,
      notes,
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "school.profile_updated",
    entityType: "school_profile",
    entityId: organizationId,
    previousValues: current ? ({ ...current } as Record<string, unknown>) : undefined,
    newValues: {
      district_name: districtName,
      school_type: schoolType,
      school_year_label: schoolYearLabel,
      relationship_health_state: relationshipHealthState,
      relationship_summary: relationshipSummary,
      primary_internal_owner_user_id: primaryInternalOwnerUserId,
      backup_internal_owner_user_id: backupInternalOwnerUserId,
      primary_location_id: primaryLocationId,
      tags,
      notes
    },
    metadata: {
      organization_name: organization.display_name
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  await appendSchoolActivityLog(client, {
    tenantId: auth.tenantId,
    organizationId,
    activityType: current ? "profile_updated" : "profile_created",
    summary: "School profile updated.",
    detail: relationshipSummary ?? notes ?? `School foundation details were updated for ${organization.display_name}.`,
    actorUserId: auth.id,
    metadata: {
      district_name: districtName,
      school_type: schoolType,
      school_year_label: schoolYearLabel,
      relationship_health_state: relationshipHealthState,
      tags
    }
  });

  return getOrganizationDetail(client, auth, organizationId);
}

export async function updateSchoolContactCategories(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  contactId: string,
  input: UpdateSchoolContactCategoriesInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertSchoolFoundationManageAccess(auth);
  await assertSchoolOrganization(client, auth.tenantId, organizationId);
  await assertContactLinkedToOrganization(client, auth.tenantId, organizationId, contactId);

  const currentResult = await client.query<{ school_contact_categories: unknown; full_name: string }>(
    `
      SELECT
        ocr.school_contact_categories,
        oc.full_name
      FROM organization_contact_relationship ocr
      JOIN organization_contact oc
        ON oc.tenant_id = ocr.tenant_id
       AND oc.id = ocr.contact_id
      WHERE ocr.tenant_id = $1
        AND ocr.organization_id = $2
        AND ocr.contact_id = $3
        AND ocr.is_current = true
      LIMIT 1
    `,
    [auth.tenantId, organizationId, contactId]
  );
  const current = currentResult.rows[0];
  if (!current) {
    throw new ApiError(404, "School contact link not found");
  }

  const categories = Array.from(new Set(input.school_contact_categories));
  await client.query(
    `
      UPDATE organization_contact_relationship
      SET
        school_contact_categories = $4,
        updated_by_user_id = $5,
        updated_at = now()
      WHERE tenant_id = $1
        AND organization_id = $2
        AND contact_id = $3
        AND is_current = true
    `,
    [auth.tenantId, organizationId, contactId, categories, auth.id]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "school.contact_categories_updated",
    entityType: "organization_contact_relationship",
    entityId: contactId,
    previousValues: {
      school_contact_categories: toStringArray(current.school_contact_categories)
    },
    newValues: {
      school_contact_categories: categories
    },
    metadata: {
      organization_id: organizationId,
      contact_id: contactId,
      contact_name: current.full_name
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  await appendSchoolActivityLog(client, {
    tenantId: auth.tenantId,
    organizationId,
    activityType: "contact_categories_updated",
    summary: `${current.full_name} school contact roles updated.`,
    detail: categories.length ? `Assigned categories: ${categories.join(", ")}.` : "School-specific categories were cleared.",
    actorUserId: auth.id,
    relatedContactId: contactId,
    metadata: {
      school_contact_categories: categories
    }
  });

  return getOrganizationDetail(client, auth, organizationId);
}

export async function createSchoolRule(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  input: CreateSchoolRuleInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertSchoolFoundationManageAccess(auth);
  await assertSchoolOrganization(client, auth.tenantId, organizationId);
  const title = normalizeOptionalText(input.title) ?? labelForSchoolRuleType(input.rule_type);
  const summary = normalizeOptionalText(input.summary);
  const structuredValue = sanitizeStructuredValue(input.structured_value ?? {});
  const sortOrder = input.sort_order ?? 0;

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO school_rule (
        tenant_id,
        organization_id,
        rule_type,
        active_status,
        title,
        summary,
        structured_value,
        sort_order,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
      RETURNING id
    `,
    [auth.tenantId, organizationId, input.rule_type, input.active_status ?? "active", title, summary, structuredValue, sortOrder, auth.id]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "school.rule_created",
    entityType: "school_rule",
    entityId: rows[0].id,
    metadata: {
      organization_id: organizationId,
      rule_type: input.rule_type,
      title,
      structured_value: structuredValue
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  await appendSchoolActivityLog(client, {
    tenantId: auth.tenantId,
    organizationId,
    activityType: "rule_created",
    summary: `${title} rule added.`,
    detail: summary,
    actorUserId: auth.id,
    relatedRuleId: rows[0].id,
    metadata: {
      rule_type: input.rule_type,
      structured_value: structuredValue
    }
  });

  return getOrganizationDetail(client, auth, organizationId);
}

export async function updateSchoolRule(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  ruleId: string,
  patch: UpdateSchoolRuleInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertSchoolFoundationManageAccess(auth);
  await assertSchoolOrganization(client, auth.tenantId, organizationId);
  const current = await loadSchoolRule(client, auth.tenantId, organizationId, ruleId);
  if (!current) {
    throw new ApiError(404, "School rule not found");
  }

  const title = patch.title !== undefined ? normalizeOptionalText(patch.title) ?? current.title : current.title;
  const summary = patch.summary !== undefined ? normalizeOptionalText(patch.summary) : current.summary;
  const activeStatus = patch.active_status ?? current.active_status;
  const structuredValue = patch.structured_value !== undefined ? sanitizeStructuredValue(patch.structured_value ?? {}) : current.structured_value;
  const sortOrder = patch.sort_order ?? current.sort_order;

  await client.query(
    `
      UPDATE school_rule
      SET
        title = $4,
        summary = $5,
        active_status = $6,
        structured_value = $7,
        sort_order = $8,
        updated_by_user_id = $9,
        updated_at = now()
      WHERE tenant_id = $1
        AND organization_id = $2
        AND id = $3
    `,
    [auth.tenantId, organizationId, ruleId, title, summary, activeStatus, structuredValue, sortOrder, auth.id]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "school.rule_updated",
    entityType: "school_rule",
    entityId: ruleId,
    previousValues: { ...current } as Record<string, unknown>,
    newValues: {
      title,
      summary,
      active_status: activeStatus,
      structured_value: structuredValue,
      sort_order: sortOrder
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  await appendSchoolActivityLog(client, {
    tenantId: auth.tenantId,
    organizationId,
    activityType: "rule_updated",
    summary: `${title} rule updated.`,
    detail: summary,
    actorUserId: auth.id,
    relatedRuleId: ruleId,
    metadata: {
      rule_type: current.rule_type,
      structured_value: structuredValue
    }
  });

  return getOrganizationDetail(client, auth, organizationId);
}

export async function createSchoolNote(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  input: CreateSchoolNoteInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertSchoolFoundationManageAccess(auth);
  await assertSchoolOrganization(client, auth.tenantId, organizationId);
  const summary = input.summary.trim();
  const detail = normalizeOptionalText(input.detail);

  const activityId = await appendSchoolActivityLog(client, {
    tenantId: auth.tenantId,
    organizationId,
    activityType: "note_added",
    summary,
    detail,
    actorUserId: auth.id
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "school.note_added",
    entityType: "school_activity_log",
    entityId: activityId,
    metadata: {
      organization_id: organizationId,
      summary,
      detail
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return getOrganizationDetail(client, auth, organizationId);
}

export async function updateOrganizationContact(
  client: PoolClient,
  auth: AuthUser,
  contactId: string,
  patch: UpdateOrganizationContactInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertOrganizationDirectoryManageAccess(auth);
  const current = await loadOrganizationContact(client, auth.tenantId, contactId);
  if (!current) {
    throw new ApiError(404, "Contact not found");
  }
  const organization = await loadOrganizationSummary(client, auth.tenantId, current.organization_id);
  if (!organization) {
    throw new ApiError(404, "Organization not found");
  }
  assertSchoolFoundationAccessForOrganization(auth, organization.account_type);

  const firstName = patch.first_name !== undefined ? (patch.first_name ?? current.first_name).trim() : current.first_name;
  const lastName = patch.last_name !== undefined ? (patch.last_name ?? current.last_name).trim() : current.last_name;
  const fullName = `${firstName} ${lastName}`.trim();
  const normalizedFullName = normalizeDirectoryText(fullName);
  const preferredName = patch.preferred_name !== undefined ? normalizeOptionalText(patch.preferred_name) : current.preferred_name ?? null;
  const title = patch.title !== undefined ? normalizeOptionalText(patch.title) : current.title;
  const departmentProgram =
    patch.department_program !== undefined ? normalizeOptionalText(patch.department_program) : current.department_program ?? null;
  const phone = patch.phone !== undefined ? normalizeOptionalText(patch.phone) : current.phone;
  const email =
    patch.email !== undefined ? normalizeOptionalText(patch.email)?.toLowerCase() ?? null : current.email;
  const photoUrl = patch.photo_url !== undefined ? normalizeOptionalText(patch.photo_url) : current.photo_url;
  const primaryInternalOwnerUserId =
    patch.primary_internal_owner_user_id !== undefined
      ? normalizeOptionalUuid(patch.primary_internal_owner_user_id)
      : current.primary_internal_owner_user_id ?? null;
  const backupInternalOwnerUserId =
    patch.backup_internal_owner_user_id !== undefined
      ? normalizeOptionalUuid(patch.backup_internal_owner_user_id)
      : current.backup_internal_owner_user_id ?? null;
  const contactStatus =
    patch.contact_status !== undefined && patch.contact_status !== null
      ? patch.contact_status
      : current.contact_status ?? deriveContactStatusFromActiveStatus(current.active_status);
  const activeStatus = deriveActiveStatusFromContactStatus(contactStatus);
  const roleCategory =
    patch.role_category !== undefined && patch.role_category !== null ? patch.role_category : current.role_category ?? "other";
  const operationalImportance =
    patch.operational_importance !== undefined && patch.operational_importance !== null
      ? patch.operational_importance
      : current.operational_importance ?? "normal";
  const decisionInfluence =
    patch.decision_influence !== undefined && patch.decision_influence !== null
      ? patch.decision_influence
      : current.decision_influence ?? "informational_only";
  const relationshipStrength =
    patch.relationship_strength !== undefined && patch.relationship_strength !== null
      ? patch.relationship_strength
      : current.relationship_strength ?? "unknown";
  const handoffReady = patch.handoff_ready !== undefined && patch.handoff_ready !== null ? patch.handoff_ready : current.handoff_ready;
  const lastConfirmedAt =
    patch.last_confirmed_at !== undefined ? normalizeOptionalDate(patch.last_confirmed_at) : current.last_confirmed_at ?? null;
  const uncertaintyFlag =
    patch.uncertainty_flag !== undefined && patch.uncertainty_flag !== null ? patch.uncertainty_flag : current.uncertainty_flag;
  const notes = patch.notes !== undefined ? normalizeOptionalText(patch.notes) : current.notes;

  if (primaryInternalOwnerUserId && backupInternalOwnerUserId && primaryInternalOwnerUserId === backupInternalOwnerUserId) {
    throw new ApiError(400, "Choose different people for the primary and backup relationship owners");
  }
  await Promise.all([
    assertDirectoryOwnerExists(client, auth.tenantId, primaryInternalOwnerUserId),
    assertDirectoryOwnerExists(client, auth.tenantId, backupInternalOwnerUserId)
  ]);

  const duplicate = await client.query<{ id: string }>(
    `
      SELECT id
      FROM organization_contact
      WHERE tenant_id = $1
        AND organization_id = $2
        AND id <> $3
        AND (
          normalized_full_name = $4
          OR ($5::text IS NOT NULL AND lower(email) = $5)
        )
      LIMIT 1
    `,
    [auth.tenantId, current.organization_id, contactId, normalizedFullName, email]
  );
  if (duplicate.rows[0]) {
    throw new ApiError(409, "A Contact with the same name or email already exists for this Organization");
  }

  await client.query(
    `
      UPDATE organization_contact
      SET
        first_name = $3,
        last_name = $4,
        full_name = $5,
        normalized_full_name = $6,
        preferred_name = $7,
        title = $8,
        department_program = $9,
        phone = $10,
        email = $11,
        photo_url = $12,
        active_status = $13,
        contact_status = $14,
        role_category = $15,
        operational_importance = $16,
        decision_influence = $17,
        primary_internal_owner_user_id = $18,
        backup_internal_owner_user_id = $19,
        relationship_strength = $20,
        handoff_ready = $21,
        last_confirmed_at = $22,
        uncertainty_flag = $23,
        notes = $24,
        updated_by_user_id = $25,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      contactId,
      firstName,
      lastName,
      fullName,
      normalizedFullName,
      preferredName,
      title,
      departmentProgram,
      phone,
      email,
      photoUrl,
      activeStatus,
      contactStatus,
      roleCategory,
      operationalImportance,
      decisionInfluence,
      primaryInternalOwnerUserId,
      backupInternalOwnerUserId,
      relationshipStrength,
      handoffReady,
      lastConfirmedAt,
      uncertaintyFlag,
      notes,
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "contact.updated",
    entityType: "organization_contact",
    entityId: contactId,
    previousValues: {
      first_name: current.first_name,
      last_name: current.last_name,
      preferred_name: current.preferred_name,
      title: current.title,
      department_program: current.department_program,
      phone: current.phone,
      email: current.email,
      photo_url: current.photo_url,
      active_status: current.active_status,
      contact_status: current.contact_status,
      role_category: current.role_category,
      operational_importance: current.operational_importance,
      decision_influence: current.decision_influence,
      primary_internal_owner_user_id: current.primary_internal_owner_user_id,
      backup_internal_owner_user_id: current.backup_internal_owner_user_id,
      relationship_strength: current.relationship_strength,
      handoff_ready: current.handoff_ready,
      last_confirmed_at: current.last_confirmed_at,
      uncertainty_flag: current.uncertainty_flag,
      notes: current.notes
    },
    newValues: {
      first_name: firstName,
      last_name: lastName,
      preferred_name: preferredName,
      title,
      department_program: departmentProgram,
      phone,
      email,
      photo_url: photoUrl,
      active_status: activeStatus,
      contact_status: contactStatus,
      role_category: roleCategory,
      operational_importance: operationalImportance,
      decision_influence: decisionInfluence,
      primary_internal_owner_user_id: primaryInternalOwnerUserId,
      backup_internal_owner_user_id: backupInternalOwnerUserId,
      relationship_strength: relationshipStrength,
      handoff_ready: handoffReady,
      last_confirmed_at: lastConfirmedAt,
      uncertainty_flag: uncertaintyFlag,
      notes
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return getOrganizationDetail(client, auth, current.organization_id);
}

export async function setOrganizationContactActiveStatus(
  client: PoolClient,
  auth: AuthUser,
  contactId: string,
  activeStatus: DirectoryActiveStatus,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertOrganizationDirectoryManageAccess(auth);
  const current = await loadOrganizationContact(client, auth.tenantId, contactId);
  if (!current) {
    throw new ApiError(404, "Contact not found");
  }
  const organization = await loadOrganizationSummary(client, auth.tenantId, current.organization_id);
  if (!organization) {
    throw new ApiError(404, "Organization not found");
  }
  assertSchoolFoundationAccessForOrganization(auth, organization.account_type);

  await client.query(
    `
      UPDATE organization_contact
      SET
        active_status = $3,
        contact_status = $4,
        updated_by_user_id = $5,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, contactId, activeStatus, deriveContactStatusFromActiveStatus(activeStatus), auth.id]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: activeStatus === "active" ? "contact.reactivated" : "contact.archived",
    entityType: "organization_contact",
    entityId: contactId,
    previousValues: {
      active_status: current.active_status
    },
    newValues: {
      active_status: activeStatus,
      contact_status: deriveContactStatusFromActiveStatus(activeStatus)
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return getOrganizationDetail(client, auth, current.organization_id);
}

export async function attachContactToOrganization(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  input: OrganizationContactRelationshipInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertOrganizationDirectoryManageAccess(auth);
  const organization = await loadOrganizationSummary(client, auth.tenantId, organizationId);
  if (!organization) {
    throw new ApiError(404, "Organization not found");
  }
  assertSchoolFoundationAccessForOrganization(auth, organization.account_type);
  const contact = await loadOrganizationContact(client, auth.tenantId, input.contact_id);
  if (!contact) {
    throw new ApiError(404, "Contact not found");
  }

  const relationshipRole = input.relationship_role ?? "general";
  const isPrimary = input.is_primary ?? false;
  const startDate = normalizeOptionalDate(input.start_date);
  const endDate = normalizeOptionalDate(input.end_date);
  const isCurrent = deriveRelationshipCurrentState(input.is_current, endDate);

  await saveOrganizationContactRelationship(client, {
    tenantId: auth.tenantId,
    organizationId,
    contactId: input.contact_id,
    relationshipRole,
    isPrimary,
    startDate,
    endDate,
    isCurrent,
    actorUserId: auth.id
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "organization.contact_linked",
    entityType: "organization_contact_relationship",
    entityId: input.contact_id,
    metadata: {
      organization_id: organizationId,
      contact_id: input.contact_id,
      relationship_role: relationshipRole,
      is_primary: isPrimary,
      start_date: startDate,
      end_date: endDate,
      is_current: isCurrent
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return getOrganizationDetail(client, auth, organizationId);
}

export async function updateOrganizationLocation(
  client: PoolClient,
  auth: AuthUser,
  locationId: string,
  patch: UpdateOrganizationLocationInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertOrganizationDirectoryManageAccess(auth);
  const current = await loadOrganizationLocation(client, auth.tenantId, locationId);
  if (!current) {
    throw new ApiError(404, "Location not found");
  }
  if (!current.organization_id) {
    throw new ApiError(400, "This Location is not attached to an Organization");
  }

  const locationName =
    patch.location_name !== undefined ? (patch.location_name ?? current.location_name).trim() : current.location_name;
  const addressLine1 =
    patch.address_line_1 !== undefined ? (patch.address_line_1 ?? current.address_line_1 ?? "").trim() : current.address_line_1 ?? "";
  const addressLine2 = patch.address_line_2 !== undefined ? normalizeOptionalText(patch.address_line_2) : current.address_line_2;
  const city = patch.city !== undefined ? (patch.city ?? current.city ?? "").trim() : current.city ?? "";
  const state = patch.state !== undefined ? (patch.state ?? current.state ?? "").trim().toUpperCase() : current.state ?? "";
  const zip = patch.zip !== undefined ? (patch.zip ?? current.zip ?? "").trim() : current.zip ?? "";
  const mapsLabel = patch.maps_label !== undefined ? normalizeOptionalText(patch.maps_label) ?? locationName : current.maps_label;
  const notes = patch.notes !== undefined ? normalizeOptionalText(patch.notes) : current.notes;
  const addressDisplay = buildAddressDisplay({
    address_line_1: addressLine1,
    address_line_2: addressLine2,
    city,
    state,
    zip
  });
  const normalizedName = normalizeDirectoryText(locationName);
  const normalizedAddress = normalizeDirectoryText(addressDisplay);

  const duplicate = await client.query<{ id: string }>(
    `
      SELECT id
      FROM shoot_location
      WHERE tenant_id = $1
        AND organization_id = $2
        AND id <> $3
        AND normalized_name = $4
        AND COALESCE(normalized_address, '') = COALESCE($5, '')
      LIMIT 1
    `,
    [auth.tenantId, current.organization_id, locationId, normalizedName, normalizedAddress || null]
  );
  if (duplicate.rows[0]) {
    throw new ApiError(409, "A Location with the same name and address already exists on this Organization");
  }

  const mapsUrl = buildGoogleMapsLink({
    address: addressDisplay,
    label: mapsLabel
  });

  await client.query(
    `
      UPDATE shoot_location
      SET
        name = $3,
        normalized_name = $4,
        address = $5,
        normalized_address = $6,
        address_line_1 = $7,
        address_line_2 = $8,
        city = $9,
        state = $10,
        zip = $11,
        maps_label = $12,
        location_details = $13,
        navigation_url = $14,
        updated_by_user_id = $15,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      locationId,
      locationName,
      normalizedName,
      addressDisplay,
      normalizedAddress || null,
      addressLine1,
      addressLine2,
      city,
      state,
      zip,
      mapsLabel,
      notes,
      mapsUrl,
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "location.updated",
    entityType: "shoot_location",
    entityId: locationId,
    previousValues: {
      location_name: current.location_name,
      address_line_1: current.address_line_1,
      address_line_2: current.address_line_2,
      city: current.city,
      state: current.state,
      zip: current.zip,
      maps_label: current.maps_label,
      notes: current.notes
    },
    newValues: {
      location_name: locationName,
      address_line_1: addressLine1,
      address_line_2: addressLine2,
      city,
      state,
      zip,
      maps_label: mapsLabel,
      notes
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return getOrganizationDetail(client, auth, current.organization_id);
}

export async function setOrganizationLocationActiveStatus(
  client: PoolClient,
  auth: AuthUser,
  locationId: string,
  activeStatus: DirectoryActiveStatus,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertOrganizationDirectoryManageAccess(auth);
  const current = await loadOrganizationLocation(client, auth.tenantId, locationId);
  if (!current) {
    throw new ApiError(404, "Location not found");
  }
  if (!current.organization_id) {
    throw new ApiError(400, "This Location is not attached to an Organization");
  }

  await client.query(
    `
      UPDATE shoot_location
      SET
        active_status = $3,
        updated_by_user_id = $4,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, locationId, activeStatus, auth.id]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: activeStatus === "active" ? "location.reactivated" : "location.archived",
    entityType: "shoot_location",
    entityId: locationId,
    previousValues: {
      active_status: current.active_status
    },
    newValues: {
      active_status: activeStatus
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return getOrganizationDetail(client, auth, current.organization_id);
}

export async function attachContactToLocation(
  client: PoolClient,
  auth: AuthUser,
  locationId: string,
  input: LocationContactLinkInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertOrganizationDirectoryManageAccess(auth);
  const location = await loadOrganizationLocation(client, auth.tenantId, locationId);
  if (!location) {
    throw new ApiError(404, "Location not found");
  }
  if (!location.organization_id) {
    throw new ApiError(400, "This Location is not attached to an Organization");
  }
  await assertContactLinkedToOrganization(client, auth.tenantId, location.organization_id, input.contact_id);

  const relationshipRole = input.relationship_role ?? "general";
  const isPrimary = input.is_primary ?? false;
  if (isPrimary) {
    await clearLocationPrimaryRelationship(client, auth.tenantId, locationId, input.contact_id);
  }

  await client.query(
    `
      INSERT INTO location_contact_link (
        tenant_id,
        location_id,
        contact_id,
        relationship_role,
        is_primary,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$6)
      ON CONFLICT (tenant_id, location_id, contact_id)
      DO UPDATE SET
        relationship_role = EXCLUDED.relationship_role,
        is_primary = EXCLUDED.is_primary,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
    `,
    [auth.tenantId, locationId, input.contact_id, relationshipRole, isPrimary, auth.id]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "location.contact_linked",
    entityType: "location_contact_link",
    entityId: locationId,
    metadata: {
      location_id: locationId,
      contact_id: input.contact_id,
      relationship_role: relationshipRole,
      is_primary: isPrimary
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return getOrganizationDetail(client, auth, location.organization_id);
}

export async function detachContactFromLocation(
  client: PoolClient,
  auth: AuthUser,
  locationId: string,
  contactId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertOrganizationDirectoryManageAccess(auth);
  const location = await loadOrganizationLocation(client, auth.tenantId, locationId);
  if (!location) {
    throw new ApiError(404, "Location not found");
  }
  if (!location.organization_id) {
    throw new ApiError(400, "This Location is not attached to an Organization");
  }

  const result = await client.query(
    `
      DELETE FROM location_contact_link
      WHERE tenant_id = $1
        AND location_id = $2
        AND contact_id = $3
    `,
    [auth.tenantId, locationId, contactId]
  );
  if (!result.rowCount) {
    throw new ApiError(404, "The Contact is not linked to this Location");
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "location.contact_unlinked",
    entityType: "location_contact_link",
    entityId: locationId,
    metadata: {
      location_id: locationId,
      contact_id: contactId
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return getOrganizationDetail(client, auth, location.organization_id);
}

export async function createOrganizationTouchpoint(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  input: CreateDirectoryTouchpointInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertOrganizationDirectoryManageAccess(auth);
  await assertOrganizationExists(client, auth.tenantId, organizationId);

  if (input.contact_id) {
    await assertContactLinkedToOrganization(client, auth.tenantId, organizationId, input.contact_id);
  }
  if (input.location_id) {
    await assertLocationBelongsToOrganization(client, auth.tenantId, organizationId, input.location_id);
  }
  if (input.shoot_id) {
    await assertShootBelongsToOrganization(client, auth.tenantId, organizationId, input.shoot_id);
  }
  if (input.owner_user_id) {
    await assertUserExists(client, auth.tenantId, input.owner_user_id);
  }

  const occurredAt = input.occurred_at ?? new Date().toISOString();
  const ownerUserId = input.owner_user_id ?? auth.id;
  const followUpDate = input.follow_up_date ?? null;
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO directory_touchpoint (
        tenant_id,
        organization_id,
        location_id,
        shoot_id,
        contact_id,
        channel,
        summary,
        outcome,
        owner_user_id,
        occurred_at,
        follow_up_date,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
      RETURNING id
    `,
    [
      auth.tenantId,
      organizationId,
      input.location_id ?? null,
      input.shoot_id ?? null,
      input.contact_id ?? null,
      input.channel,
      input.summary.trim(),
      normalizeOptionalText(input.outcome),
      ownerUserId,
      occurredAt,
      followUpDate,
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "directory.touchpoint_created",
    entityType: "directory_touchpoint",
    entityId: rows[0].id,
    metadata: {
      organization_id: organizationId,
      location_id: input.location_id ?? null,
      shoot_id: input.shoot_id ?? null,
      contact_id: input.contact_id ?? null,
      channel: input.channel,
      follow_up_date: followUpDate
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return loadDirectoryTouchpointById(client, auth.tenantId, rows[0].id);
}

export async function listOrganizationTouchpoints(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string
): Promise<DirectoryTouchpointListResponse> {
  await assertOrganizationExists(client, auth.tenantId, organizationId);
  const { rows } = await client.query<DirectoryTouchpointRow>(
    `
      SELECT
        dt.id,
        dt.organization_id,
        dt.location_id,
        dt.shoot_id,
        dt.contact_id,
        dt.channel,
        dt.category,
        dt.subject,
        dt.summary,
        dt.outcome,
        dt.outcome_state,
        dt.owner_user_id,
        owner.full_name AS owner_name,
        dt.occurred_at::text,
        dt.follow_up_date::text,
        dt.follow_up_needed,
        dt.follow_up_owner_user_id,
        follow_up_owner.full_name AS follow_up_owner_name,
        follow_up_owner.email AS follow_up_owner_email,
        follow_up_owner.department::text AS follow_up_owner_department,
        follow_up_owner.status::text AS follow_up_owner_status,
        dt.relationship_memory_suggested,
        dt.attachment_reference,
        dt.touchpoint_plan_id,
        dt.created_at::text,
        dt.updated_at::text
      FROM directory_touchpoint dt
      LEFT JOIN app_user owner
        ON owner.id = dt.owner_user_id
      LEFT JOIN app_user follow_up_owner
        ON follow_up_owner.id = dt.follow_up_owner_user_id
      WHERE dt.tenant_id = $1
        AND dt.organization_id = $2
      ORDER BY dt.occurred_at DESC, dt.created_at DESC
    `,
    [auth.tenantId, organizationId]
  );

  return {
    touchpoints: rows.map(mapDirectoryTouchpoint),
    total: rows.length
  };
}

export async function listContactTouchpoints(
  client: PoolClient,
  auth: AuthUser,
  contactId: string
): Promise<DirectoryTouchpointListResponse> {
  const contact = await loadOrganizationContact(client, auth.tenantId, contactId);
  if (!contact) {
    throw new ApiError(404, "Contact not found");
  }

  const { rows } = await client.query<DirectoryTouchpointRow>(
    `
      SELECT
        dt.id,
        dt.organization_id,
        dt.location_id,
        dt.shoot_id,
        dt.contact_id,
        dt.channel,
        dt.category,
        dt.subject,
        dt.summary,
        dt.outcome,
        dt.outcome_state,
        dt.owner_user_id,
        owner.full_name AS owner_name,
        dt.occurred_at::text,
        dt.follow_up_date::text,
        dt.follow_up_needed,
        dt.follow_up_owner_user_id,
        follow_up_owner.full_name AS follow_up_owner_name,
        follow_up_owner.email AS follow_up_owner_email,
        follow_up_owner.department::text AS follow_up_owner_department,
        follow_up_owner.status::text AS follow_up_owner_status,
        dt.relationship_memory_suggested,
        dt.attachment_reference,
        dt.touchpoint_plan_id,
        dt.created_at::text,
        dt.updated_at::text
      FROM directory_touchpoint dt
      LEFT JOIN app_user owner
        ON owner.id = dt.owner_user_id
      LEFT JOIN app_user follow_up_owner
        ON follow_up_owner.id = dt.follow_up_owner_user_id
      WHERE dt.tenant_id = $1
        AND dt.contact_id = $2
      ORDER BY dt.occurred_at DESC, dt.created_at DESC
    `,
    [auth.tenantId, contactId]
  );

  return {
    touchpoints: rows.map(mapDirectoryTouchpoint),
    total: rows.length
  };
}

export async function getDirectoryContactDetail(
  client: PoolClient,
  auth: AuthUser,
  contactId: string
): Promise<DirectoryContactDetailResponse | null> {
  const contact = await loadOrganizationContact(client, auth.tenantId, contactId);
  if (!contact) {
    return null;
  }

  const [touchpoints, relationshipHistoryByContactId, internalConnectionsByContactId, linkedLocationNamesByContactId] = await Promise.all([
    listContactTouchpoints(client, auth, contactId),
    loadRelationshipHistoryForContacts(client, auth.tenantId, [contactId]),
    loadInternalOwnerConnectionsForContacts(client, auth.tenantId, [contactId]),
    loadLinkedLocationNamesForContacts(client, auth.tenantId, [contactId])
  ]);

  return {
    contact: mapOrganizationContact(
      contact,
      relationshipHistoryByContactId.get(contactId) ?? [],
      internalConnectionsByContactId.get(contactId) ?? [],
      linkedLocationNamesByContactId.get(contactId) ?? []
    ),
    touchpoints: touchpoints.touchpoints
  };
}

export async function createDirectoryDuplicateReview(
  client: PoolClient,
  auth: AuthUser,
  input: CreateDirectoryDuplicateReviewInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertOrganizationDirectoryManageAccess(auth);
  if (input.primary_contact_id === input.suspected_duplicate_contact_id) {
    throw new ApiError(400, "Choose two different Contacts for duplicate review");
  }

  const primaryContact = await loadOrganizationContact(client, auth.tenantId, input.primary_contact_id);
  const duplicateContact = await loadOrganizationContact(client, auth.tenantId, input.suspected_duplicate_contact_id);
  if (!primaryContact || !duplicateContact) {
    throw new ApiError(404, "One or more Contacts could not be found");
  }

  const existing = await client.query<{ id: string }>(
    `
      SELECT id
      FROM directory_duplicate_review
      WHERE tenant_id = $1
        AND primary_contact_id = $2
        AND suspected_duplicate_contact_id = $3
        AND status = 'open'
      LIMIT 1
    `,
    [auth.tenantId, input.primary_contact_id, input.suspected_duplicate_contact_id]
  );
  if (existing.rows[0]) {
    throw new ApiError(409, "A duplicate review is already open for these Contacts");
  }

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO directory_duplicate_review (
        tenant_id,
        primary_contact_id,
        suspected_duplicate_contact_id,
        summary,
        notes,
        created_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id
    `,
    [
      auth.tenantId,
      input.primary_contact_id,
      input.suspected_duplicate_contact_id,
      input.summary.trim(),
      normalizeOptionalText(input.notes),
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "directory.duplicate_review_created",
    entityType: "directory_duplicate_review",
    entityId: rows[0].id,
    metadata: {
      primary_contact_id: input.primary_contact_id,
      suspected_duplicate_contact_id: input.suspected_duplicate_contact_id
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return loadDirectoryDuplicateReviewById(client, auth.tenantId, rows[0].id);
}

export async function listDirectoryDuplicateReviews(
  client: PoolClient,
  auth: AuthUser
): Promise<DirectoryDuplicateReviewListResponse> {
  const { rows } = await client.query<DirectoryDuplicateReviewRow>(
    `
      SELECT
        ddr.id,
        ddr.primary_contact_id,
        primary_contact.full_name AS primary_contact_name,
        ddr.suspected_duplicate_contact_id,
        duplicate_contact.full_name AS suspected_duplicate_contact_name,
        ddr.status,
        ddr.decision,
        ddr.summary,
        ddr.notes,
        ddr.created_by_user_id,
        created_by.full_name AS created_by_name,
        ddr.reviewed_by_user_id,
        reviewed_by.full_name AS reviewed_by_name,
        ddr.reviewed_at::text,
        ddr.created_at::text,
        ddr.updated_at::text
      FROM directory_duplicate_review ddr
      LEFT JOIN organization_contact primary_contact
        ON primary_contact.tenant_id = ddr.tenant_id
       AND primary_contact.id = ddr.primary_contact_id
      LEFT JOIN organization_contact duplicate_contact
        ON duplicate_contact.tenant_id = ddr.tenant_id
       AND duplicate_contact.id = ddr.suspected_duplicate_contact_id
      LEFT JOIN app_user created_by
        ON created_by.id = ddr.created_by_user_id
      LEFT JOIN app_user reviewed_by
        ON reviewed_by.id = ddr.reviewed_by_user_id
      WHERE ddr.tenant_id = $1
      ORDER BY
        ddr.status = 'open' DESC,
        ddr.updated_at DESC,
        ddr.created_at DESC
    `,
    [auth.tenantId]
  );

  return {
    reviews: rows.map(mapDirectoryDuplicateReview),
    total: rows.length
  };
}

export async function updateDirectoryDuplicateReview(
  client: PoolClient,
  auth: AuthUser,
  reviewId: string,
  patch: UpdateDirectoryDuplicateReviewInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertOrganizationDirectoryManageAccess(auth);
  const current = await loadDirectoryDuplicateReviewById(client, auth.tenantId, reviewId);
  if (!current) {
    throw new ApiError(404, "Duplicate review not found");
  }

  const nextDecision = patch.decision ?? current.decision;
  const nextStatus = patch.status ?? (nextDecision === "pending" ? current.status : "resolved");
  const nextNotes = patch.notes !== undefined ? normalizeOptionalText(patch.notes) : current.notes;
  const reviewedAt = nextDecision === "pending" && nextStatus === "open" ? current.reviewed_at : new Date().toISOString();

  await client.query(
    `
      UPDATE directory_duplicate_review
      SET
        status = $3,
        decision = $4,
        notes = $5,
        reviewed_by_user_id = $6,
        reviewed_at = $7,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, reviewId, nextStatus, nextDecision, nextNotes, auth.id, reviewedAt]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "directory.duplicate_review_updated",
    entityType: "directory_duplicate_review",
    entityId: reviewId,
    previousValues: {
      status: current.status,
      decision: current.decision,
      notes: current.notes
    },
    newValues: {
      status: nextStatus,
      decision: nextDecision,
      notes: nextNotes
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return loadDirectoryDuplicateReviewById(client, auth.tenantId, reviewId);
}

export async function attachContactToShoot(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  input: ShootContactLinkInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
): Promise<ShootDirectoryContactLinkResponse> {
  assertOrganizationDirectoryManageAccess(auth);
  const shoot = await loadShootDirectoryContext(client, auth.tenantId, shootId);
  if (!shoot) {
    throw new ApiError(404, "Shoot not found");
  }
  if (!shoot.organization_id) {
    throw new ApiError(400, "This Shoot is not attached to an Organization");
  }

  await assertContactLinkedToOrganization(client, auth.tenantId, shoot.organization_id, input.contact_id);

  const relationshipRole = input.relationship_role ?? (input.is_primary ? "day_of" : "general");
  const isPrimary = input.is_primary ?? false;

  if (!isPrimary && shoot.primary_contact_id === input.contact_id) {
    throw new ApiError(409, "This Contact is already the primary Shoot Contact");
  }

  if (isPrimary) {
    await client.query(
      `
        UPDATE shoot_contact_link
        SET
          contact_role = 'additional',
          is_primary = false,
          updated_by_user_id = $3,
          updated_at = now()
        WHERE tenant_id = $1
          AND shoot_id = $2
          AND contact_id <> $4
          AND is_primary = true
      `,
      [auth.tenantId, shootId, auth.id, input.contact_id]
    );
  }

  const sortOrderResult = await client.query<{ next_sort_order: number }>(
    `
      SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort_order
      FROM shoot_contact_link
      WHERE tenant_id = $1
        AND shoot_id = $2
        AND contact_role = 'additional'
    `,
    [auth.tenantId, shootId]
  );
  const nextSortOrder = isPrimary ? 0 : Number(sortOrderResult.rows[0]?.next_sort_order ?? 1);

  await client.query(
    `
      INSERT INTO shoot_contact_link (
        tenant_id,
        shoot_id,
        contact_id,
        contact_role,
        relationship_role,
        is_primary,
        sort_order,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
      ON CONFLICT (tenant_id, shoot_id, contact_id)
      DO UPDATE SET
        contact_role = EXCLUDED.contact_role,
        relationship_role = EXCLUDED.relationship_role,
        is_primary = EXCLUDED.is_primary,
        sort_order = CASE
          WHEN EXCLUDED.is_primary THEN 0
          ELSE shoot_contact_link.sort_order
        END,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
    `,
    [
      auth.tenantId,
      shootId,
      input.contact_id,
      isPrimary ? "primary" : "additional",
      relationshipRole,
      isPrimary,
      nextSortOrder,
      auth.id
    ]
  );

  await client.query(
    `
      UPDATE shoot
      SET
        primary_contact_id = CASE WHEN $3 THEN $4 ELSE primary_contact_id END,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, shootId, isPrimary, input.contact_id]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "shoot.contact_linked",
    entityType: "shoot_contact_link",
    entityId: shootId,
    metadata: {
      shoot_id: shootId,
      contact_id: input.contact_id,
      relationship_role: relationshipRole,
      is_primary: isPrimary
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return loadShootDirectoryContactLinks(client, auth.tenantId, shootId);
}

export async function detachContactFromShoot(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  contactId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
): Promise<ShootDirectoryContactLinkResponse> {
  assertOrganizationDirectoryManageAccess(auth);
  const shoot = await loadShootDirectoryContext(client, auth.tenantId, shootId);
  if (!shoot) {
    throw new ApiError(404, "Shoot not found");
  }
  if (shoot.primary_contact_id === contactId) {
    throw new ApiError(409, "Assign a replacement primary Contact before removing the current primary Shoot Contact");
  }

  const result = await client.query(
    `
      DELETE FROM shoot_contact_link
      WHERE tenant_id = $1
        AND shoot_id = $2
        AND contact_id = $3
    `,
    [auth.tenantId, shootId, contactId]
  );
  if (!result.rowCount) {
    throw new ApiError(404, "The Contact is not linked to this Shoot");
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "shoot.contact_unlinked",
    entityType: "shoot_contact_link",
    entityId: shootId,
    metadata: {
      shoot_id: shootId,
      contact_id: contactId
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return loadShootDirectoryContactLinks(client, auth.tenantId, shootId);
}

async function loadOrganizationSummary(client: PoolClient, tenantId: string, organizationId: string): Promise<OrganizationSummary | null> {
  const { rows } = await client.query<OrganizationListRow>(
    `
      SELECT
        o.id,
        o.canonical_name,
        o.logo_url,
        o.display_name,
        o.account_type,
        o.active_status,
        o.parent_organization_id::text AS parent_organization_id,
        parent.display_name AS parent_organization_name,
        o.client_entity_kind::text AS client_entity_kind,
        o.client_organization_type::text AS client_organization_type,
        o.website,
        o.main_phone,
        COALESCE(
          (
            SELECT json_agg(alias ORDER BY alias)
            FROM organization_alias oa
            WHERE oa.tenant_id = o.tenant_id
              AND oa.organization_id = o.id
          ),
          '[]'::json
        ) AS aliases,
        o.notes,
        (
          SELECT count(*)::text
          FROM organization_contact_relationship ocr
          JOIN organization_contact oc
            ON oc.tenant_id = ocr.tenant_id
           AND oc.id = ocr.contact_id
          WHERE ocr.tenant_id = o.tenant_id
            AND ocr.organization_id = o.id
            AND oc.active_status IN ('active', 'inactive')
        ) AS contact_count,
        (
          SELECT count(*)::text
          FROM shoot_location sl
          WHERE sl.tenant_id = o.tenant_id
            AND sl.organization_id = o.id
        ) AS location_count,
        (
          SELECT count(*)::text
          FROM organization child
          WHERE child.tenant_id = o.tenant_id
            AND child.parent_organization_id = o.id
        ) AS child_organization_count,
        o.created_at::text,
        o.updated_at::text
      FROM organization o
      LEFT JOIN organization parent
        ON parent.tenant_id = o.tenant_id
       AND parent.id = o.parent_organization_id
      WHERE o.tenant_id = $1
        AND o.id = $2
      LIMIT 1
    `,
    [tenantId, organizationId]
  );
  return rows[0] ? mapOrganizationSummary(rows[0]) : null;
}

// The District's child Schools (id + display) and, for a School, the deterministic
// list is empty. Bounded, deterministic. Used by getOrganizationDetail.
async function loadChildOrganizations(
  client: PoolClient,
  tenantId: string,
  organizationId: string
): Promise<Array<{ id: string; display_name: string; account_type: OrganizationAccountType; active_status: DirectoryActiveStatus }>> {
  const { rows } = await client.query<{ id: string; display_name: string; account_type: OrganizationAccountType; active_status: DirectoryActiveStatus }>(
    `SELECT id::text, display_name, account_type, active_status
       FROM organization
       WHERE tenant_id = $1 AND parent_organization_id = $2
       ORDER BY lower(display_name)
       LIMIT 500`,
    [tenantId, organizationId]
  );
  return rows;
}

async function loadSchoolProfile(client: PoolClient, tenantId: string, organizationId: string): Promise<SchoolProfileRecord | null> {
  const { rows } = await client.query<SchoolProfileRow>(
    `
      SELECT
        sp.organization_id,
        sp.district_name,
        sp.school_type,
        sp.school_year_label,
        sp.relationship_health_state,
        sp.relationship_summary,
        primary_owner.id::text AS primary_internal_owner_user_id,
        primary_owner.full_name AS primary_internal_owner_name,
        primary_owner.email AS primary_internal_owner_email,
        primary_owner.department AS primary_internal_owner_department,
        primary_owner.status AS primary_internal_owner_status,
        backup_owner.id::text AS backup_internal_owner_user_id,
        backup_owner.full_name AS backup_internal_owner_name,
        backup_owner.email AS backup_internal_owner_email,
        backup_owner.department AS backup_internal_owner_department,
        backup_owner.status AS backup_internal_owner_status,
        sp.primary_location_id::text,
        sl.name AS primary_location_name,
        COALESCE(
          NULLIF(sl.address, ''),
          NULLIF(
            trim(
              concat_ws(
                ', ',
                NULLIF(sl.address_line_1, ''),
                NULLIF(sl.address_line_2, ''),
                NULLIF(
                  trim(
                    concat_ws(
                      ' ',
                      NULLIF(concat_ws(', ', NULLIF(sl.city, ''), NULLIF(sl.state, '')), ''),
                      NULLIF(sl.zip, '')
                    )
                  ),
                  ''
                )
              )
            ),
            ''
          )
        ) AS primary_location_address,
        sp.tags,
        sp.notes,
        sp.created_at::text,
        sp.updated_at::text
      FROM school_profile sp
      LEFT JOIN app_user primary_owner
        ON primary_owner.id = sp.primary_internal_owner_user_id
      LEFT JOIN app_user backup_owner
        ON backup_owner.id = sp.backup_internal_owner_user_id
      LEFT JOIN shoot_location sl
        ON sl.tenant_id = sp.tenant_id
       AND sl.id = sp.primary_location_id
      WHERE sp.tenant_id = $1
        AND sp.organization_id = $2
      LIMIT 1
    `,
    [tenantId, organizationId]
  );
  return rows[0] ? mapSchoolProfile(rows[0]) : null;
}

async function loadSchoolRule(
  client: PoolClient,
  tenantId: string,
  organizationId: string,
  ruleId: string
): Promise<SchoolRuleRecord | null> {
  const { rows } = await client.query<SchoolRuleRow>(
    `
      SELECT
        sr.id,
        sr.organization_id,
        sr.rule_type,
        sr.active_status,
        sr.title,
        sr.summary,
        sr.structured_value,
        sr.sort_order,
        created_by.full_name AS created_by_name,
        updated_by.full_name AS updated_by_name,
        sr.created_at::text,
        sr.updated_at::text
      FROM school_rule sr
      LEFT JOIN app_user created_by
        ON created_by.id = sr.created_by_user_id
      LEFT JOIN app_user updated_by
        ON updated_by.id = sr.updated_by_user_id
      WHERE sr.tenant_id = $1
        AND sr.organization_id = $2
        AND sr.id = $3
      LIMIT 1
    `,
    [tenantId, organizationId, ruleId]
  );
  return rows[0] ? mapSchoolRule(rows[0]) : null;
}

async function listSchoolRules(client: PoolClient, tenantId: string, organizationId: string): Promise<SchoolRuleRecord[]> {
  const { rows } = await client.query<SchoolRuleRow>(
    `
      SELECT
        sr.id,
        sr.organization_id,
        sr.rule_type,
        sr.active_status,
        sr.title,
        sr.summary,
        sr.structured_value,
        sr.sort_order,
        created_by.full_name AS created_by_name,
        updated_by.full_name AS updated_by_name,
        sr.created_at::text,
        sr.updated_at::text
      FROM school_rule sr
      LEFT JOIN app_user created_by
        ON created_by.id = sr.created_by_user_id
      LEFT JOIN app_user updated_by
        ON updated_by.id = sr.updated_by_user_id
      WHERE sr.tenant_id = $1
        AND sr.organization_id = $2
      ORDER BY
        sr.active_status = 'active' DESC,
        sr.sort_order ASC,
        sr.created_at DESC
    `,
    [tenantId, organizationId]
  );
  return rows.map(mapSchoolRule);
}

async function listSchoolActivity(client: PoolClient, tenantId: string, organizationId: string): Promise<SchoolActivityLogRecord[]> {
  const { rows } = await client.query<SchoolActivityLogRow>(
    `
      SELECT
        sal.id,
        sal.organization_id,
        sal.activity_type,
        sal.summary,
        sal.detail,
        sal.metadata,
        sal.related_contact_id,
        related_contact.full_name AS related_contact_name,
        sal.related_rule_id,
        sal.actor_user_id::text,
        actor.full_name AS actor_name,
        sal.created_at::text
      FROM school_activity_log sal
      LEFT JOIN organization_contact related_contact
        ON related_contact.tenant_id = sal.tenant_id
       AND related_contact.id = sal.related_contact_id
      LEFT JOIN app_user actor
        ON actor.id = sal.actor_user_id
      WHERE sal.tenant_id = $1
        AND sal.organization_id = $2
      ORDER BY sal.created_at DESC
      LIMIT 40
    `,
    [tenantId, organizationId]
  );
  return rows.map(mapSchoolActivityLog);
}

async function ensureSchoolProfileRecord(
  client: PoolClient,
  tenantId: string,
  organizationId: string,
  actorUserId: string | null
) {
  await client.query(
    `
      INSERT INTO school_profile (
        organization_id,
        tenant_id,
        primary_location_id,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES (
        $1,
        $2,
        (
          SELECT sl.id
          FROM shoot_location sl
          WHERE sl.tenant_id = $2
            AND sl.organization_id = $1
            AND sl.active_status = 'active'
          ORDER BY lower(sl.name), sl.created_at
          LIMIT 1
        ),
        $3,
        $3
      )
      ON CONFLICT (organization_id) DO NOTHING
    `,
    [organizationId, tenantId, actorUserId]
  );
}

async function appendSchoolActivityLog(
  client: PoolClient,
  input: {
    tenantId: string;
    organizationId: string;
    activityType: SchoolActivityType;
    summary: string;
    detail?: string | null;
    metadata?: Record<string, unknown>;
    relatedContactId?: string | null;
    relatedRuleId?: string | null;
    actorUserId?: string | null;
  }
) {
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO school_activity_log (
        tenant_id,
        organization_id,
        activity_type,
        summary,
        detail,
        metadata,
        related_contact_id,
        related_rule_id,
        actor_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id
    `,
    [
      input.tenantId,
      input.organizationId,
      input.activityType,
      input.summary,
      normalizeOptionalText(input.detail),
      input.metadata ?? {},
      input.relatedContactId ?? null,
      input.relatedRuleId ?? null,
      input.actorUserId ?? null
    ]
  );
  return rows[0].id;
}

async function assertSchoolOrganization(client: PoolClient, tenantId: string, organizationId: string) {
  const organization = await loadOrganizationSummary(client, tenantId, organizationId);
  if (!organization) {
    throw new ApiError(404, "Organization not found");
  }
  if (!isSchoolOrganizationAccountType(organization.account_type)) {
    throw new ApiError(400, "School foundation is only available on school organizations");
  }
  return organization;
}

async function assertOrganizationExists(client: PoolClient, tenantId: string, organizationId: string) {
  const exists = await client.query<{ id: string }>(
    `
      SELECT id
      FROM organization
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, organizationId]
  );
  if (!exists.rows[0]) {
    throw new ApiError(404, "Organization not found");
  }
}

async function findConflictingOrganization(
  client: PoolClient,
  tenantId: string,
  normalizedCanonicalName: string,
  aliases: string[],
  excludeOrganizationId?: string | null
) {
  const normalizedAliases = aliases.map(normalizeDirectoryText);
  const { rows } = await client.query<{ id: string; display_name: string }>(
    `
      SELECT o.id, o.display_name
      FROM organization o
      WHERE o.tenant_id = $1
        AND ($4::uuid IS NULL OR o.id <> $4)
        AND (
          o.normalized_canonical_name = $2
          OR EXISTS (
            SELECT 1
            FROM organization_alias oa
            WHERE oa.tenant_id = o.tenant_id
              AND oa.organization_id = o.id
              AND oa.normalized_alias = ANY($3::text[])
          )
        )
      LIMIT 1
    `,
    [tenantId, normalizedCanonicalName, normalizedAliases.length ? normalizedAliases : [""], excludeOrganizationId ?? null]
  );
  return rows[0] ?? null;
}

async function loadOrganizationContact(client: PoolClient, tenantId: string, contactId: string) {
  const { rows } = await client.query<OrganizationContactRow>(
    `
      SELECT
        organization_contact.id,
        organization_contact.organization_id,
        organization_contact.organization_id AS canonical_organization_id,
        organization_contact.first_name,
        organization_contact.last_name,
        organization_contact.full_name,
        organization_contact.preferred_name,
        organization_contact.title,
        organization_contact.department_program,
        organization_contact.phone,
        organization_contact.email,
        organization_contact.photo_url,
        organization_contact.active_status,
        organization_contact.contact_status,
        organization_contact.role_category,
        organization_contact.decision_influence,
        organization_contact.operational_importance,
        organization_contact.relationship_strength,
        organization_contact.primary_internal_owner_user_id::text,
        primary_owner.full_name AS primary_internal_owner_name,
        primary_owner.email AS primary_internal_owner_email,
        primary_owner.department AS primary_internal_owner_department,
        primary_owner.status AS primary_internal_owner_status,
        organization_contact.backup_internal_owner_user_id::text,
        backup_owner.full_name AS backup_internal_owner_name,
        backup_owner.email AS backup_internal_owner_email,
        backup_owner.department AS backup_internal_owner_department,
        backup_owner.status AS backup_internal_owner_status,
        organization_contact.last_confirmed_at::text,
        last_touch.last_occurred_at::text AS last_meaningful_interaction_at,
        primary_location.location_id AS primary_location_id,
        primary_location.location_name AS primary_location_name,
        organization_contact.handoff_ready,
        organization_contact.uncertainty_flag,
        updated_by.full_name AS last_updated_by_name,
        relationship_snapshot.relationship_role,
        relationship_snapshot.is_primary,
        relationship_snapshot.school_contact_categories,
        organization_contact.notes,
        organization_contact.created_at::text,
        organization_contact.updated_at::text
      FROM organization_contact
      LEFT JOIN app_user primary_owner
        ON primary_owner.id = organization_contact.primary_internal_owner_user_id
      LEFT JOIN app_user backup_owner
        ON backup_owner.id = organization_contact.backup_internal_owner_user_id
      LEFT JOIN app_user updated_by
        ON updated_by.id = organization_contact.updated_by_user_id
      LEFT JOIN LATERAL (
        SELECT
          ocr.relationship_role,
          ocr.is_primary,
          ocr.school_contact_categories
        FROM organization_contact_relationship ocr
        WHERE ocr.tenant_id = organization_contact.tenant_id
          AND ocr.contact_id = organization_contact.id
          AND ocr.organization_id = organization_contact.organization_id
          AND ocr.is_current = true
        ORDER BY ocr.is_primary DESC, ocr.created_at DESC
        LIMIT 1
      ) relationship_snapshot ON true
      LEFT JOIN LATERAL (
        SELECT dt.occurred_at AS last_occurred_at
        FROM directory_touchpoint dt
        WHERE dt.tenant_id = organization_contact.tenant_id
          AND dt.contact_id = organization_contact.id
        ORDER BY dt.occurred_at DESC, dt.created_at DESC
        LIMIT 1
      ) last_touch ON true
      LEFT JOIN LATERAL (
        SELECT
          sl.id::text AS location_id,
          sl.name AS location_name
        FROM location_contact_link lcl
        JOIN shoot_location sl
          ON sl.tenant_id = lcl.tenant_id
         AND sl.id = lcl.location_id
        WHERE lcl.tenant_id = organization_contact.tenant_id
          AND lcl.contact_id = organization_contact.id
        ORDER BY lcl.is_primary DESC, lower(sl.name)
        LIMIT 1
      ) primary_location ON true
      WHERE organization_contact.tenant_id = $1
        AND organization_contact.id = $2
      LIMIT 1
    `,
    [tenantId, contactId]
  );
  return rows[0] ?? null;
}

async function loadOrganizationLocation(client: PoolClient, tenantId: string, locationId: string) {
  const { rows } = await client.query<OrganizationLocationRow>(
    `
      SELECT
        id,
        organization_id,
        name AS location_name,
        address_line_1,
        address_line_2,
        city,
        state,
        zip,
        COALESCE(
          NULLIF(address, ''),
          NULLIF(
            trim(
              concat_ws(
                ', ',
                NULLIF(address_line_1, ''),
                NULLIF(address_line_2, ''),
                NULLIF(
                  trim(
                    concat_ws(
                      ' ',
                      NULLIF(concat_ws(', ', NULLIF(city, ''), NULLIF(state, '')), ''),
                      NULLIF(zip, '')
                    )
                  ),
                  ''
                )
              )
            ),
            ''
          )
        ) AS address_display,
        maps_label,
        navigation_url AS maps_url,
        active_status,
        location_details AS notes,
        created_at::text,
        updated_at::text
      FROM shoot_location
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, locationId]
  );
  return rows[0] ?? null;
}

async function loadShootDirectoryContext(client: PoolClient, tenantId: string, shootId: string) {
  const { rows } = await client.query<{ id: string; organization_id: string | null; primary_contact_id: string | null }>(
    `
      SELECT id, organization_id, primary_contact_id
      FROM shoot
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [tenantId, shootId]
  );
  return rows[0] ?? null;
}

async function assertContactLinkedToOrganization(client: PoolClient, tenantId: string, organizationId: string, contactId: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT oc.id
      FROM organization_contact oc
      LEFT JOIN organization_contact_relationship ocr
        ON ocr.tenant_id = oc.tenant_id
       AND ocr.contact_id = oc.id
       AND ocr.organization_id = $2
       AND ocr.is_current = true
      WHERE oc.tenant_id = $1
        AND oc.id = $3
        AND (oc.organization_id = $2 OR ocr.id IS NOT NULL)
      LIMIT 1
    `,
    [tenantId, organizationId, contactId]
  );
  if (!rows[0]) {
    throw new ApiError(400, "The selected Contact is not linked to this Organization");
  }
}

async function assertLocationBelongsToOrganization(client: PoolClient, tenantId: string, organizationId: string, locationId: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT id
      FROM shoot_location
      WHERE tenant_id = $1
        AND organization_id = $2
        AND id = $3
      LIMIT 1
    `,
    [tenantId, organizationId, locationId]
  );
  if (!rows[0]) {
    throw new ApiError(400, "The selected Location is not linked to this Organization");
  }
}

async function assertShootBelongsToOrganization(client: PoolClient, tenantId: string, organizationId: string, shootId: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT id
      FROM shoot
      WHERE tenant_id = $1
        AND organization_id = $2
        AND id = $3
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [tenantId, organizationId, shootId]
  );
  if (!rows[0]) {
    throw new ApiError(400, "The selected Shoot is not linked to this Organization");
  }
}

async function assertUserExists(client: PoolClient, tenantId: string, userId: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT id
      FROM app_user
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, userId]
  );
  if (!rows[0]) {
    throw new ApiError(400, "The selected owner could not be found");
  }
}

async function assertDirectoryOwnerExists(client: PoolClient, tenantId: string, userId?: string | null) {
  if (!userId) {
    return;
  }
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT id
      FROM app_user
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, userId]
  );
  if (!rows[0]) {
    throw new ApiError(400, "Relationship owner must be a valid user in this workspace.");
  }
}

async function clearOrganizationPrimaryRelationship(
  client: PoolClient,
  tenantId: string,
  organizationId: string,
  keepContactId: string
) {
  await client.query(
    `
      UPDATE organization_contact_relationship
      SET is_primary = false, updated_at = now()
      WHERE tenant_id = $1
        AND organization_id = $2
        AND contact_id <> $3
        AND is_primary = true
        AND is_current = true
    `,
    [tenantId, organizationId, keepContactId]
  );
}

async function saveOrganizationContactRelationship(
  client: PoolClient,
  input: {
    tenantId: string;
    organizationId: string;
    contactId: string;
    relationshipRole: DirectoryContactRelationshipRole;
    isPrimary: boolean;
    startDate: string | null;
    endDate: string | null;
    isCurrent: boolean;
    actorUserId: string | null;
  }
) {
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    throw new ApiError(400, "Relationship end dates must be on or after the start date.");
  }

  if (input.isCurrent && input.endDate) {
    throw new ApiError(400, "Current relationships cannot have an end date.");
  }

  if (input.isPrimary && input.isCurrent) {
    await clearOrganizationPrimaryRelationship(client, input.tenantId, input.organizationId, input.contactId);
  }

  if (input.isCurrent) {
    const { rows } = await client.query<{ id: string }>(
      `
        INSERT INTO organization_contact_relationship (
          tenant_id,
          organization_id,
          contact_id,
          relationship_role,
          is_primary,
          start_date,
          end_date,
          is_current,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$8)
        ON CONFLICT (tenant_id, organization_id, contact_id)
          WHERE is_current
        DO UPDATE SET
          relationship_role = EXCLUDED.relationship_role,
          is_primary = EXCLUDED.is_primary,
          start_date = COALESCE(EXCLUDED.start_date, organization_contact_relationship.start_date),
          end_date = NULL,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = now()
        RETURNING id
      `,
      [
        input.tenantId,
        input.organizationId,
        input.contactId,
        input.relationshipRole,
        input.isPrimary,
        input.startDate,
        null,
        input.actorUserId
      ]
    );
    return rows[0].id;
  }

  const existingHistory = await client.query<{ id: string }>(
    `
      SELECT id
      FROM organization_contact_relationship
      WHERE tenant_id = $1
        AND organization_id = $2
        AND contact_id = $3
        AND is_current = false
        AND relationship_role = $4
        AND is_primary = $5
        AND start_date IS NOT DISTINCT FROM $6::date
        AND end_date IS NOT DISTINCT FROM $7::date
      LIMIT 1
    `,
    [
      input.tenantId,
      input.organizationId,
      input.contactId,
      input.relationshipRole,
      input.isPrimary,
      input.startDate,
      input.endDate
    ]
  );
  if (existingHistory.rows[0]) {
    return existingHistory.rows[0].id;
  }

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO organization_contact_relationship (
        tenant_id,
        organization_id,
        contact_id,
        relationship_role,
        is_primary,
        start_date,
        end_date,
        is_current,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,$8)
      RETURNING id
    `,
    [
      input.tenantId,
      input.organizationId,
      input.contactId,
      input.relationshipRole,
      input.isPrimary,
      input.startDate,
      input.endDate,
      input.actorUserId
    ]
  );
  return rows[0].id;
}

async function loadRelationshipHistoryForContacts(client: PoolClient, tenantId: string, contactIds: string[]) {
  const historyByContactId = new Map<string, OrganizationContactRelationshipHistoryRecord[]>();
  const uniqueContactIds = [...new Set(contactIds.filter(Boolean))];
  if (!uniqueContactIds.length) {
    return historyByContactId;
  }

  const { rows } = await client.query<OrganizationContactRelationshipHistoryRow>(
    `
      SELECT
        ocr.id,
        ocr.contact_id,
        ocr.organization_id,
        o.display_name AS organization_display_name,
        o.account_type AS organization_account_type,
        ocr.relationship_role,
        ocr.is_primary,
        ocr.is_current,
        ocr.start_date::text,
        ocr.end_date::text,
        ocr.created_at::text,
        ocr.updated_at::text
      FROM organization_contact_relationship ocr
      JOIN organization o
        ON o.tenant_id = ocr.tenant_id
       AND o.id = ocr.organization_id
      WHERE ocr.tenant_id = $1
        AND ocr.contact_id = ANY($2::uuid[])
      ORDER BY
        ocr.contact_id,
        ocr.is_current DESC,
        COALESCE(ocr.end_date, ocr.start_date) DESC NULLS LAST,
        ocr.created_at DESC
    `,
    [tenantId, uniqueContactIds]
  );

  for (const row of rows) {
    const list = historyByContactId.get(row.contact_id) ?? [];
    list.push(mapOrganizationContactRelationshipHistory(row));
    historyByContactId.set(row.contact_id, list);
  }

  return historyByContactId;
}

async function loadInternalOwnerConnectionsForContacts(client: PoolClient, tenantId: string, contactIds: string[]) {
  const connectionsByContactId = new Map<string, DirectoryInternalOwnerRecord[]>();
  const uniqueContactIds = [...new Set(contactIds.filter(Boolean))];
  if (!uniqueContactIds.length) {
    return connectionsByContactId;
  }

  const { rows } = await client.query<DirectoryInternalOwnerConnectionRow>(
    `
      SELECT
        dt.contact_id,
        dt.owner_user_id::text,
        owner.full_name AS owner_name,
        owner.email AS owner_email,
        owner.department AS owner_department,
        owner.status AS owner_status,
        count(*)::text AS touchpoint_count,
        max(dt.occurred_at)::text AS last_interaction_at
      FROM directory_touchpoint dt
      JOIN app_user owner
        ON owner.id = dt.owner_user_id
      WHERE dt.tenant_id = $1
        AND dt.contact_id = ANY($2::uuid[])
        AND dt.owner_user_id IS NOT NULL
      GROUP BY
        dt.contact_id,
        dt.owner_user_id,
        owner.full_name,
        owner.email,
        owner.department,
        owner.status
      ORDER BY
        dt.contact_id,
        count(*) DESC,
        max(dt.occurred_at) DESC
    `,
    [tenantId, uniqueContactIds]
  );

  for (const row of rows) {
    if (!row.owner_user_id || !row.owner_name) {
      continue;
    }
    const list = connectionsByContactId.get(row.contact_id) ?? [];
    list.push({
      user_id: row.owner_user_id,
      full_name: row.owner_name,
      email: row.owner_email,
      department: row.owner_department,
      status: row.owner_status,
      relationship_weight: Number(row.touchpoint_count ?? 0),
      last_interaction_at: row.last_interaction_at
    });
    connectionsByContactId.set(row.contact_id, list);
  }

  return connectionsByContactId;
}

async function loadLinkedLocationNamesForContacts(client: PoolClient, tenantId: string, contactIds: string[]) {
  const namesByContactId = new Map<string, string[]>();
  const uniqueContactIds = [...new Set(contactIds.filter(Boolean))];
  if (!uniqueContactIds.length) {
    return namesByContactId;
  }

  const { rows } = await client.query<{ contact_id: string; location_name: string }>(
    `
      SELECT
        lcl.contact_id::text AS contact_id,
        sl.name AS location_name
      FROM location_contact_link lcl
      JOIN shoot_location sl
        ON sl.tenant_id = lcl.tenant_id
       AND sl.id = lcl.location_id
      WHERE lcl.tenant_id = $1
        AND lcl.contact_id = ANY($2::uuid[])
      ORDER BY lcl.contact_id, lcl.is_primary DESC, lower(sl.name)
    `,
    [tenantId, uniqueContactIds]
  );

  for (const row of rows) {
    const list = namesByContactId.get(row.contact_id) ?? [];
    if (!list.includes(row.location_name)) {
      list.push(row.location_name);
    }
    namesByContactId.set(row.contact_id, list);
  }

  return namesByContactId;
}

async function clearLocationPrimaryRelationship(
  client: PoolClient,
  tenantId: string,
  locationId: string,
  keepContactId: string
) {
  await client.query(
    `
      UPDATE location_contact_link
      SET is_primary = false, updated_at = now()
      WHERE tenant_id = $1
        AND location_id = $2
        AND contact_id <> $3
        AND is_primary = true
    `,
    [tenantId, locationId, keepContactId]
  );
}

async function loadDirectoryTouchpointById(
  client: PoolClient,
  tenantId: string,
  touchpointId: string
): Promise<DirectoryTouchpointRecord | null> {
  const { rows } = await client.query<DirectoryTouchpointRow>(
    `
      SELECT
        dt.id,
        dt.organization_id,
        dt.location_id,
        dt.shoot_id,
        dt.contact_id,
        dt.channel,
        dt.category,
        dt.subject,
        dt.summary,
        dt.outcome,
        dt.outcome_state,
        dt.owner_user_id,
        owner.full_name AS owner_name,
        dt.occurred_at::text,
        dt.follow_up_date::text,
        dt.follow_up_needed,
        dt.follow_up_owner_user_id,
        follow_up_owner.full_name AS follow_up_owner_name,
        follow_up_owner.email AS follow_up_owner_email,
        follow_up_owner.department::text AS follow_up_owner_department,
        follow_up_owner.status::text AS follow_up_owner_status,
        dt.relationship_memory_suggested,
        dt.attachment_reference,
        dt.touchpoint_plan_id,
        dt.created_at::text,
        dt.updated_at::text
      FROM directory_touchpoint dt
      LEFT JOIN app_user owner
        ON owner.id = dt.owner_user_id
      LEFT JOIN app_user follow_up_owner
        ON follow_up_owner.id = dt.follow_up_owner_user_id
      WHERE dt.tenant_id = $1
        AND dt.id = $2
      LIMIT 1
    `,
    [tenantId, touchpointId]
  );
  return rows[0] ? mapDirectoryTouchpoint(rows[0]) : null;
}

async function loadDirectoryDuplicateReviewById(
  client: PoolClient,
  tenantId: string,
  reviewId: string
): Promise<DirectoryDuplicateReviewRecord | null> {
  const { rows } = await client.query<DirectoryDuplicateReviewRow>(
    `
      SELECT
        ddr.id,
        ddr.primary_contact_id,
        primary_contact.full_name AS primary_contact_name,
        ddr.suspected_duplicate_contact_id,
        duplicate_contact.full_name AS suspected_duplicate_contact_name,
        ddr.status,
        ddr.decision,
        ddr.summary,
        ddr.notes,
        ddr.created_by_user_id,
        created_by.full_name AS created_by_name,
        ddr.reviewed_by_user_id,
        reviewed_by.full_name AS reviewed_by_name,
        ddr.reviewed_at::text,
        ddr.created_at::text,
        ddr.updated_at::text
      FROM directory_duplicate_review ddr
      LEFT JOIN organization_contact primary_contact
        ON primary_contact.tenant_id = ddr.tenant_id
       AND primary_contact.id = ddr.primary_contact_id
      LEFT JOIN organization_contact duplicate_contact
        ON duplicate_contact.tenant_id = ddr.tenant_id
       AND duplicate_contact.id = ddr.suspected_duplicate_contact_id
      LEFT JOIN app_user created_by
        ON created_by.id = ddr.created_by_user_id
      LEFT JOIN app_user reviewed_by
        ON reviewed_by.id = ddr.reviewed_by_user_id
      WHERE ddr.tenant_id = $1
        AND ddr.id = $2
      LIMIT 1
    `,
    [tenantId, reviewId]
  );
  return rows[0] ? mapDirectoryDuplicateReview(rows[0]) : null;
}

async function loadShootDirectoryContactLinks(
  client: PoolClient,
  tenantId: string,
  shootId: string
): Promise<ShootDirectoryContactLinkResponse> {
  const { rows } = await client.query<ShootDirectoryContactLinkRow>(
    `
      SELECT
        s.id AS shoot_id,
        s.organization_id,
        s.primary_contact_id,
        oc.id AS contact_id,
        oc.full_name,
        oc.title,
        oc.phone,
        oc.email,
        scl.contact_role,
        scl.relationship_role,
        scl.is_primary,
        scl.sort_order
      FROM shoot s
      LEFT JOIN shoot_contact_link scl
        ON scl.tenant_id = s.tenant_id
       AND scl.shoot_id = s.id
      LEFT JOIN organization_contact oc
        ON oc.tenant_id = s.tenant_id
       AND oc.id = scl.contact_id
      WHERE s.tenant_id = $1
        AND s.id = $2
        AND s.deleted_at IS NULL
      ORDER BY scl.is_primary DESC, scl.sort_order ASC, lower(COALESCE(oc.full_name, ''))
    `,
    [tenantId, shootId]
  );
  if (!rows.length) {
    throw new ApiError(404, "Shoot not found");
  }
  return {
    shoot_id: rows[0].shoot_id,
    organization_id: rows[0].organization_id,
    primary_contact_id: rows[0].primary_contact_id,
    contact_links: rows
      .filter((row) => row.contact_id)
      .map(mapShootDirectoryContactLink)
  };
}

function assertOrganizationDirectoryManageAccess(auth: AuthUser) {
  if (!canManageCanonicalDirectoryRecords(auth)) {
    throw new ApiError(403, "You do not have permission to create Organizations, Contacts, or Locations.");
  }
}

function assertSchoolFoundationManageAccess(auth: AuthUser) {
  if (!canManageSchoolFoundation(auth)) {
    throw new ApiError(403, "You do not have permission to edit school rules, notes, or school contact roles.");
  }
}

function assertSchoolFoundationAccessForOrganization(auth: AuthUser, accountType: OrganizationAccountType) {
  if (isSchoolOrganizationAccountType(accountType)) {
    assertSchoolFoundationManageAccess(auth);
  }
}

function mapOrganizationSummary(row: OrganizationListRow): OrganizationSummary {
  // Canonical columns are authoritative; fall back to legacy notes-packed values on
  // read only when the canonical column is null (no writes regenerate note tokens).
  const legacy = parseLegacyOrganizationNotes(row.notes);
  return {
    id: row.id,
    canonical_name: row.canonical_name,
    logo_url: row.logo_url,
    display_name: row.display_name,
    account_type: row.account_type,
    active_status: row.active_status,
    parent_organization_id: row.parent_organization_id ?? null,
    parent_organization_name: row.parent_organization_name ?? null,
    client_entity_kind: row.client_entity_kind ?? null,
    client_organization_type: row.client_organization_type ?? null,
    website: row.website ?? legacy.website,
    main_phone: row.main_phone ?? legacy.main_phone,
    child_organization_count: Number(row.child_organization_count ?? 0),
    aliases: toStringArray(row.aliases),
    notes: row.notes,
    contact_count: Number(row.contact_count ?? 0),
    location_count: Number(row.location_count ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapOrganizationContact(
  row: OrganizationContactRow,
  relationshipHistory: OrganizationContactRelationshipHistoryRecord[] = [],
  internalConnections: DirectoryInternalOwnerRecord[] = [],
  linkedLocationNames: string[] = []
): OrganizationContactRecord {
  const primaryInternalOwner = mapInternalOwnerFromRow(
    row.primary_internal_owner_user_id,
    row.primary_internal_owner_name,
    row.primary_internal_owner_email,
    row.primary_internal_owner_department,
    row.primary_internal_owner_status
  );
  const backupInternalOwner = mapInternalOwnerFromRow(
    row.backup_internal_owner_user_id,
    row.backup_internal_owner_name,
    row.backup_internal_owner_email,
    row.backup_internal_owner_department,
    row.backup_internal_owner_status
  );
  const strongestInternalRelationship =
    primaryInternalOwner ??
    internalConnections[0] ??
    null;
  const lastSpokeWith =
    [...internalConnections].sort(compareOwnerByLastInteraction)[0] ??
    primaryInternalOwner ??
    null;
  const ownershipState = deriveDirectoryOwnershipState(row, primaryInternalOwner, backupInternalOwner, internalConnections);
  const freshnessState = deriveDirectoryFreshnessState(row);
  const maintenanceSignals = buildDirectoryContactMaintenanceSignals(row, ownershipState, freshnessState, primaryInternalOwner, backupInternalOwner);

  return {
    id: row.id,
    organization_id: row.organization_id,
    canonical_organization_id: row.canonical_organization_id ?? row.organization_id,
    first_name: row.first_name,
    last_name: row.last_name,
    full_name: row.full_name,
    preferred_name: row.preferred_name,
    title: row.title,
    department_program: row.department_program,
    phone: row.phone,
    email: row.email,
    photo_url: row.photo_url,
    active_status: row.active_status,
    contact_status: row.contact_status,
    role_category: row.role_category,
    operational_importance: row.operational_importance,
    decision_influence: row.decision_influence,
    relationship_strength: row.relationship_strength,
    primary_internal_owner: primaryInternalOwner,
    backup_internal_owner: backupInternalOwner,
    ownership_state: ownershipState,
    freshness_state: freshnessState,
    last_confirmed_at: row.last_confirmed_at,
    last_meaningful_interaction_at: row.last_meaningful_interaction_at,
    primary_location_id: row.primary_location_id,
    primary_location_name: row.primary_location_name,
    linked_location_names: linkedLocationNames,
    strongest_internal_relationship: strongestInternalRelationship,
    last_spoke_with: lastSpokeWith,
    additional_internal_connected_staff: internalConnections.filter(
      (connection) => connection.user_id !== primaryInternalOwner?.user_id && connection.user_id !== backupInternalOwner?.user_id
    ),
    handoff_ready: row.handoff_ready,
    uncertainty_flag: row.uncertainty_flag,
    maintenance_signals: maintenanceSignals,
    last_updated_by_name: row.last_updated_by_name,
    relationship_role: row.relationship_role ?? null,
    is_primary: Boolean(row.is_primary),
    school_contact_categories: toSchoolContactCategoryArray(row.school_contact_categories),
    relationship_history: relationshipHistory,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapSchoolProfile(row: SchoolProfileRow): SchoolProfileRecord {
  return {
    organization_id: row.organization_id,
    district_name: row.district_name,
    school_type: row.school_type,
    school_year_label: row.school_year_label,
    relationship_health_state: row.relationship_health_state,
    relationship_summary: row.relationship_summary,
    primary_internal_owner: mapInternalOwnerFromRow(
      row.primary_internal_owner_user_id,
      row.primary_internal_owner_name,
      row.primary_internal_owner_email,
      row.primary_internal_owner_department,
      row.primary_internal_owner_status
    ),
    backup_internal_owner: mapInternalOwnerFromRow(
      row.backup_internal_owner_user_id,
      row.backup_internal_owner_name,
      row.backup_internal_owner_email,
      row.backup_internal_owner_department,
      row.backup_internal_owner_status
    ),
    primary_location_id: row.primary_location_id,
    primary_location_name: row.primary_location_name,
    primary_location_address: row.primary_location_address,
    tags: toStringArray(row.tags),
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapSchoolRule(row: SchoolRuleRow): SchoolRuleRecord {
  return {
    id: row.id,
    organization_id: row.organization_id,
    rule_type: row.rule_type,
    active_status: row.active_status,
    title: row.title,
    summary: row.summary,
    structured_value: isPlainObject(row.structured_value) ? row.structured_value : {},
    sort_order: Number(row.sort_order ?? 0),
    created_by_name: row.created_by_name,
    updated_by_name: row.updated_by_name,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapSchoolActivityLog(row: SchoolActivityLogRow): SchoolActivityLogRecord {
  return {
    id: row.id,
    organization_id: row.organization_id,
    activity_type: row.activity_type,
    summary: row.summary,
    detail: row.detail,
    metadata: isPlainObject(row.metadata) ? row.metadata : {},
    related_contact_id: row.related_contact_id,
    related_contact_name: row.related_contact_name,
    related_rule_id: row.related_rule_id,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name,
    created_at: row.created_at
  };
}

function mapDirectoryContactSummary(row: DirectoryContactListRow): DirectoryContactSummary {
  return {
    ...mapOrganizationContact(row),
    organization_display_name: row.organization_display_name,
    organization_account_type: row.organization_account_type,
    organization_logo_url: row.organization_logo_url
  };
}

function mapInternalOwnerFromRow(
  userId: string | null,
  fullName: string | null,
  email: string | null,
  department: string | null,
  status: string | null
): DirectoryInternalOwnerRecord | null {
  if (!userId || !fullName) {
    return null;
  }
  return {
    user_id: userId,
    full_name: fullName,
    email,
    department,
    status
  };
}

function deriveDirectoryOwnershipState(
  row: OrganizationContactRow,
  primaryOwner: DirectoryInternalOwnerRecord | null,
  backupOwner: DirectoryInternalOwnerRecord | null,
  internalConnections: DirectoryInternalOwnerRecord[]
): DirectoryRelationshipOwnershipState {
  if (!primaryOwner) {
    return "unassigned";
  }
  if (primaryOwner.status && primaryOwner.status !== "active") {
    return "needs_reassignment";
  }
  if (backupOwner || internalConnections.some((connection) => connection.user_id !== primaryOwner.user_id)) {
    return "shared";
  }
  if (row.uncertainty_flag && !row.handoff_ready) {
    return "needs_reassignment";
  }
  return "owned";
}

function deriveDirectoryFreshnessState(row: OrganizationContactRow): DirectoryFreshnessState {
  if (row.contact_status === "needs_review" || row.uncertainty_flag || !row.last_confirmed_at) {
    return "needs_review";
  }
  const lastConfirmed = new Date(row.last_confirmed_at);
  if (Number.isNaN(lastConfirmed.getTime())) {
    return "needs_review";
  }
  const ageDays = (Date.now() - lastConfirmed.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays > 180) {
    return "needs_review";
  }
  if (ageDays > 90) {
    return "aging";
  }
  return "fresh";
}

function buildDirectoryContactMaintenanceSignals(
  row: OrganizationContactRow,
  ownershipState: DirectoryRelationshipOwnershipState,
  freshnessState: DirectoryFreshnessState,
  primaryOwner: DirectoryInternalOwnerRecord | null,
  backupOwner: DirectoryInternalOwnerRecord | null
): DirectoryRelationshipMaintenanceSignal[] {
  const signals: DirectoryRelationshipMaintenanceSignal[] = [];
  const isImportant = row.operational_importance === "critical" || row.operational_importance === "high";

  if (ownershipState === "unassigned" && isImportant) {
    signals.push({
      code: "critical_contact_unassigned",
      severity: "critical",
      label: "Critical contact has no owner",
      detail: "Assign a primary internal owner so relationship responsibility is visible before the next operational handoff."
    });
  } else if (ownershipState === "needs_reassignment") {
    signals.push({
      code: "owner_reassignment_needed",
      severity: "warning",
      label: "Relationship ownership needs reassignment",
      detail: "The current owner is inactive or the handoff is not ready, so this contact should be reassigned before it drifts."
    });
  }

  if (isImportant && !backupOwner) {
    signals.push({
      code: "backup_owner_missing",
      severity: "warning",
      label: "No backup owner is assigned",
      detail: "Add a backup owner so the contact is still covered when staffing or account ownership changes."
    });
  }

  if (freshnessState === "needs_review") {
    signals.push({
      code: "contact_needs_review",
      severity: isImportant ? "critical" : "warning",
      label: "Contact details need review",
      detail: "The relationship is stale, uncertain, or has not been confirmed recently enough to trust without review."
    });
  } else if (freshnessState === "aging") {
    signals.push({
      code: "contact_aging",
      severity: "info",
      label: "Contact confirmation is aging",
      detail: "Refresh this contact soon so role, title, and ownership stay current."
    });
  }

  if (primaryOwner && !row.handoff_ready && isImportant) {
    signals.push({
      code: "handoff_not_ready",
      severity: "warning",
      label: "Handoff readiness is incomplete",
      detail: "Document enough context for a backup owner before the next major shoot or ownership change."
    });
  }

  return signals;
}

function compareOwnerByLastInteraction(left: DirectoryInternalOwnerRecord, right: DirectoryInternalOwnerRecord) {
  const leftTime = left.last_interaction_at ? new Date(left.last_interaction_at).getTime() : 0;
  const rightTime = right.last_interaction_at ? new Date(right.last_interaction_at).getTime() : 0;
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return (right.relationship_weight ?? 0) - (left.relationship_weight ?? 0);
}

function mapOrganizationLocation(row: OrganizationLocationRow, contactLinks: LocationContactLinkRecord[] = []): OrganizationLocationRecord {
  return {
    id: row.id,
    organization_id: row.organization_id,
    location_name: row.location_name,
    address_line_1: row.address_line_1,
    address_line_2: row.address_line_2,
    city: row.city,
    state: row.state,
    zip: row.zip,
    address_display: row.address_display,
    maps_label: row.maps_label,
    maps_url: row.maps_url,
    active_status: row.active_status,
    contact_links: contactLinks,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapDirectoryLocationSummary(row: DirectoryLocationListRow): DirectoryLocationSummary {
  return {
    ...mapOrganizationLocation(row),
    organization_display_name: row.organization_display_name,
    organization_account_type: row.organization_account_type
  };
}

function mapLocationContactLink(row: LocationContactLinkRow): LocationContactLinkRecord {
  return {
    contact_id: row.contact_id,
    full_name: row.full_name,
    title: row.title,
    phone: row.phone,
    email: row.email,
    relationship_role: row.relationship_role,
    is_primary: row.is_primary,
    canonical_organization_id: row.canonical_organization_id
  };
}

function mapOrganizationContactRelationshipHistory(
  row: OrganizationContactRelationshipHistoryRow
): OrganizationContactRelationshipHistoryRecord {
  return {
    id: row.id,
    organization_id: row.organization_id,
    organization_display_name: row.organization_display_name,
    organization_account_type: row.organization_account_type,
    relationship_role: row.relationship_role,
    is_primary: row.is_primary,
    is_current: row.is_current,
    relationship_state: row.is_current ? "current" : "previous",
    start_date: row.start_date,
    end_date: row.end_date,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapDirectoryTouchpoint(row: DirectoryTouchpointRow): DirectoryTouchpointRecord {
  return {
    id: row.id,
    organization_id: row.organization_id,
    location_id: row.location_id,
    shoot_id: row.shoot_id,
    contact_id: row.contact_id,
    channel: row.channel,
    category: row.category,
    subject: row.subject,
    summary: row.summary,
    outcome: row.outcome,
    outcome_state: row.outcome_state,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    occurred_at: row.occurred_at,
    follow_up_date: row.follow_up_date,
    follow_up_needed: row.follow_up_needed,
    follow_up_owner: mapInternalOwnerFromRow(
      row.follow_up_owner_user_id,
      row.follow_up_owner_name,
      row.follow_up_owner_email,
      row.follow_up_owner_department,
      row.follow_up_owner_status
    ),
    relationship_memory_suggested: row.relationship_memory_suggested,
    attachment_reference: row.attachment_reference,
    touchpoint_plan_id: row.touchpoint_plan_id,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapDirectoryDuplicateReview(row: DirectoryDuplicateReviewRow): DirectoryDuplicateReviewRecord {
  return {
    id: row.id,
    primary_contact_id: row.primary_contact_id,
    primary_contact_name: row.primary_contact_name,
    suspected_duplicate_contact_id: row.suspected_duplicate_contact_id,
    suspected_duplicate_contact_name: row.suspected_duplicate_contact_name,
    status: row.status,
    decision: row.decision,
    summary: row.summary,
    notes: row.notes,
    created_by_user_id: row.created_by_user_id,
    created_by_name: row.created_by_name,
    reviewed_by_user_id: row.reviewed_by_user_id,
    reviewed_by_name: row.reviewed_by_name,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapShootDirectoryContactLink(row: ShootDirectoryContactLinkRow): ShootDirectoryContactLinkRecord {
  return {
    contact_id: row.contact_id,
    full_name: row.full_name,
    title: row.title,
    phone: row.phone,
    email: row.email,
    contact_role: row.contact_role,
    relationship_role: row.relationship_role,
    is_primary: row.is_primary,
    sort_order: Number(row.sort_order ?? 0)
  };
}

function toStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const inner = trimmed.slice(1, -1).trim();
      if (!inner) {
        return [];
      }
      return inner
        .split(",")
        .map((item) => item.trim().replace(/^"(.*)"$/, "$1").replace(/\\"/g, "\""))
        .filter(Boolean);
    }
    return [trimmed];
  }
  return [];
}

function toSchoolContactCategoryArray(value: unknown): SchoolContactCategory[] {
  const allowed = new Set<SchoolContactCategory>([
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
  return toStringArray(value).filter((item): item is SchoolContactCategory => allowed.has(item as SchoolContactCategory));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeStructuredValue(value: Record<string, unknown>) {
  const next: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (rawValue === undefined || rawValue === null) {
      continue;
    }
    if (typeof rawValue === "string") {
      const trimmed = rawValue.trim();
      if (!trimmed) {
        continue;
      }
      next[key] = trimmed;
      continue;
    }
    next[key] = rawValue;
  }
  return next;
}

function isSchoolOrganizationAccountType(accountType: OrganizationAccountType) {
  return SCHOOL_ACCOUNT_TYPES.includes(accountType);
}

function labelForSchoolRuleType(ruleType: SchoolRuleType) {
  switch (ruleType) {
    case "additional_language_needs":
      return "Additional Language Needs";
    case "qr_organization_rules":
      return "QR Organization Rules";
    case "hat_policy":
      return "Hat Policy";
    case "additional_shoot_rules":
      return "Additional Shoot Rules";
    case "punch_id_rules":
      return "Punch / ID Rules";
    case "sticker_counts":
      return "Sticker Counts";
    case "subject_directory_requirements":
      return "Subject Directory Requirements";
    case "subject_directory_counts":
      return "Subject Directory Counts";
    case "yearbook_participation":
      return "Yearbook Participation";
    case "delivery_preferences":
      return "Delivery Preferences";
    case "mailing_preferences":
      return "Mailing Preferences";
    case "special_handling":
      return "Special Handling";
    default:
      return ruleType;
  }
}

function normalizeOptionalText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalUuid(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    throw new ApiError(400, "Relationship owner must be a valid user.");
  }
  return trimmed;
}

function normalizeOptionalDate(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new ApiError(400, "Dates must use YYYY-MM-DD.");
  }
  return trimmed;
}

function deriveContactStatusFromActiveStatus(activeStatus: DirectoryActiveStatus): DirectoryContactStatus {
  return activeStatus === "inactive" ? "inactive" : "active";
}

function deriveActiveStatusFromContactStatus(contactStatus: DirectoryContactStatus): DirectoryActiveStatus {
  return contactStatus === "inactive" || contactStatus === "archived" ? "inactive" : "active";
}

function deriveRelationshipCurrentState(isCurrent?: boolean, endDate?: string | null) {
  if (typeof isCurrent === "boolean") {
    return isCurrent;
  }
  return endDate ? false : true;
}

function normalizeDirectoryText(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dedupeAliasValues(values: string[]) {
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = normalizeDirectoryText(trimmed);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    aliases.push(trimmed);
  }
  return aliases;
}

function buildAddressDisplay(input: {
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}) {
  const lines = [input.address_line_1, input.address_line_2].map(normalizeOptionalText).filter(Boolean);
  const cityStateZip = [normalizeOptionalText(input.city), normalizeOptionalText(input.state)].filter(Boolean).join(", ");
  const trailing = [cityStateZip, normalizeOptionalText(input.zip)].filter(Boolean).join(" ");
  return [...lines, trailing].filter(Boolean).join(", ") || null;
}

function buildOrganizationAccountOverview(input: {
  contacts: OrganizationContactRecord[];
  recentShoots: OrganizationDetail["recent_shoots"];
  nextShoot: OrganizationDetail["next_shoot"];
  agreementSummary: OrganizationDetail["agreement_summary"];
  agreements: OrganizationDetail["agreements"];
  upcomingShootAgreementRisks: OrganizationDetail["upcoming_shoot_agreement_risks"];
  salesPipelineSummary: OrganizationDetail["sales_pipeline_summary"];
  salesPipelineAlerts: OrganizationDetail["sales_pipeline_alerts"];
}): OrganizationDetail["account_overview"] {
  const recentIssues = buildOrganizationRecentIssues({
    agreementSummary: input.agreementSummary,
    upcomingShootAgreementRisks: input.upcomingShootAgreementRisks,
    salesPipelineAlerts: input.salesPipelineAlerts
  });
  const healthReasons = buildAccountHealthReasons({
    agreementSummary: input.agreementSummary,
    salesPipelineSummary: input.salesPipelineSummary,
    upcomingShootAgreementRisks: input.upcomingShootAgreementRisks
  });

  let accountHealthState: OrganizationDetail["account_overview"]["account_health_state"] = "healthy";
  if (
    input.agreementSummary.has_expired ||
    input.upcomingShootAgreementRisks.length ||
    input.salesPipelineSummary.open_alerts > 0
  ) {
    accountHealthState = "at_risk";
  } else if (
    input.agreementSummary.has_expiring_soon ||
    input.agreementSummary.has_pending_signature ||
    input.salesPipelineSummary.missing_next_action > 0 ||
    input.salesPipelineSummary.inactive_opportunities > 0
  ) {
    accountHealthState = "watch";
  }

  return {
    contract_status: summarizeContractStatus(input.agreementSummary),
    expiration_timeline: summarizeAgreementTimeline(input.agreements),
    last_shoot: input.recentShoots[0] ?? null,
    next_shoot: input.nextShoot,
    key_contacts: input.contacts
      .filter((contact) => contact.active_status === "active")
      .sort((left, right) => scoreContactPriority(right) - scoreContactPriority(left))
      .slice(0, 3),
    account_health_state: accountHealthState,
    account_health_summary:
      accountHealthState === "healthy"
        ? "No active contract or CRM warnings are pushing this account off track right now."
        : accountHealthState === "watch"
          ? "This account has renewal or follow-up pressure that should stay visible."
          : "This account has active agreement or CRM issues that need leadership attention.",
    account_health_reasons: healthReasons,
    recent_issues: recentIssues,
    revenue_check_status: "not_tracked",
    revenue_check_summary: "Revenue check status is not tracked in Mission Control yet."
  };
}

function buildOrganizationRecentIssues(input: {
  agreementSummary: OrganizationDetail["agreement_summary"];
  upcomingShootAgreementRisks: OrganizationDetail["upcoming_shoot_agreement_risks"];
  salesPipelineAlerts: OrganizationDetail["sales_pipeline_alerts"];
}): OrganizationDetail["account_overview"]["recent_issues"] {
  const issues: OrganizationDetail["account_overview"]["recent_issues"] = [];

  for (const warning of input.agreementSummary.warnings) {
    if (warning.severity === "clear") {
      continue;
    }
    issues.push({
      issue_type: "agreement_warning",
      severity: warning.severity,
      title: "Agreement Warning",
      summary: warning.summary,
      linked_entity_id: null
    });
  }

  for (const risk of input.upcomingShootAgreementRisks.slice(0, 3)) {
    if (risk.severity === "clear") {
      continue;
    }
    issues.push({
      issue_type: "shoot_risk",
      severity: risk.severity,
      title: `Upcoming Shoot Risk: ${risk.title}`,
      summary: risk.summary,
      linked_entity_id: risk.shoot_id
    });
  }

  for (const alert of input.salesPipelineAlerts.slice(0, 4)) {
    issues.push({
      issue_type: "crm_alert",
      severity: alert.severity,
      title: alert.title,
      summary: alert.message,
      linked_entity_id: alert.opportunity_id
    });
  }

  return issues
    .sort((left, right) => compareIssueSeverity(right.severity) - compareIssueSeverity(left.severity))
    .slice(0, 6);
}

function buildAccountHealthReasons(input: {
  agreementSummary: OrganizationDetail["agreement_summary"];
  salesPipelineSummary: OrganizationDetail["sales_pipeline_summary"];
  upcomingShootAgreementRisks: OrganizationDetail["upcoming_shoot_agreement_risks"];
}) {
  const reasons: string[] = [];
  if (input.agreementSummary.has_expired) {
    reasons.push("An Agreement on this account is expired.");
  } else if (input.agreementSummary.has_expiring_soon) {
    reasons.push("An Agreement is entering the renewal window.");
  } else if (!input.agreementSummary.has_active_agreement) {
    reasons.push("No active Agreement is on file.");
  }
  if (input.agreementSummary.has_pending_signature) {
    reasons.push("A renewal or contract is still waiting on signature.");
  }
  if (input.salesPipelineSummary.missing_next_action > 0) {
    reasons.push("One or more active opportunities are missing a next action.");
  }
  if (input.salesPipelineSummary.inactive_opportunities > 0) {
    reasons.push("Opportunity follow-up has gone inactive.");
  }
  if (input.upcomingShootAgreementRisks.length > 0) {
    reasons.push("An upcoming Shoot is tied to agreement risk.");
  }
  if (!reasons.length) {
    reasons.push("Agreement coverage and CRM follow-up are currently in good shape.");
  }
  return reasons;
}

function summarizeContractStatus(summary: OrganizationDetail["agreement_summary"]) {
  if (summary.has_active_agreement && summary.has_pending_signature) {
    return "Active with renewal pending signature";
  }
  if (summary.has_expired) {
    return "Expired";
  }
  if (summary.has_expiring_soon) {
    return "Expiring Soon";
  }
  if (summary.has_active_agreement) {
    return "Active";
  }
  if (summary.has_pending_signature) {
    return "Pending Signature";
  }
  return "No Active Agreement";
}

function summarizeAgreementTimeline(agreements: OrganizationDetail["agreements"]) {
  const activeLikeAgreement = [...agreements]
    .filter((agreement) => agreement.expiration_date && ["active", "expiring_soon", "signed", "countersigned"].includes(agreement.status))
    .sort((left, right) => String(left.expiration_date).localeCompare(String(right.expiration_date)))[0];
  if (activeLikeAgreement?.expiration_date) {
    const label = activeLikeAgreement.status === "expiring_soon" ? "Expiring" : "Expires";
    return `${label} ${formatDisplayDate(activeLikeAgreement.expiration_date)}`;
  }

  const expiredAgreement = [...agreements]
    .filter((agreement) => agreement.expiration_date && agreement.status === "expired")
    .sort((left, right) => String(right.expiration_date).localeCompare(String(left.expiration_date)))[0];
  if (expiredAgreement?.expiration_date) {
    return `Expired ${formatDisplayDate(expiredAgreement.expiration_date)}`;
  }

  const pendingAgreement = [...agreements].find((agreement) =>
    ["sent", "viewed", "partially_signed"].includes(agreement.status)
  );
  if (pendingAgreement?.sent_at) {
    return `Pending signature since ${formatDisplayDate(pendingAgreement.sent_at.slice(0, 10))}`;
  }

  return "No agreement expiration timeline is tracked yet.";
}

function scoreContactPriority(contact: OrganizationContactRecord) {
  let score = 0;
  if (contact.title) {
    score += 3;
  }
  if (contact.email) {
    score += 2;
  }
  if (contact.phone) {
    score += 2;
  }
  return score;
}

function compareIssueSeverity(severity: OrganizationDetail["account_overview"]["recent_issues"][number]["severity"]) {
  switch (severity) {
    case "critical":
      return 3;
    case "major":
      return 2;
    case "warning":
    default:
      return 1;
  }
}

function formatDisplayDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}
