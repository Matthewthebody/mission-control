import type { PoolClient } from "pg";
import pino from "pino";
import { canManageCanonicalDirectoryRecords, hasAuthorityTier, hasPermissionCode } from "../authz/authority.js";
import { config } from "../config.js";
import { WORK_DEPARTMENT_TYPES } from "../domain/jobTruth/index.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  AccountServiceRecord,
  AccountServiceStatus,
  AccountServiceType,
  ClientAccountDetail,
  ClientCommandCenterDashboard,
  ClientCommunicationType,
  ClientContactRole,
  ClientContactSummary,
  ClientEntityKind,
  ClientInternalOwnerRecord,
  ClientLocationReferenceAttachment,
  ClientLocationSummary,
  ClientLifecycleStatus,
  ClientOrganizationSummary,
  ClientOrganizationType,
  ClientOwnerType,
  ClientPreferredContactMethod,
  ClientReadinessIssue,
  ClientReadinessResult,
  ClientSmsConsentStatus,
  ClientTimelineItem
} from "../types/clientCommandCenter.js";
import type { WorkDepartmentType } from "../domain/jobTruth/index.js";
import { createWorkTask } from "./jobTruth/index.js";

const logger = pino({ name: "pmc-client-command-center", enabled: config.NODE_ENV !== "test" });

type ClientOrganizationInput = {
  name: string;
  organization_type: ClientOrganizationType;
  status?: ClientLifecycleStatus;
  phone?: string | null;
  website?: string | null;
  notes?: string | null;
  external_code?: string | null;
};

type ClientAccountInput = {
  organization_id?: string | null;
  name: string;
  account_type: ClientOrganizationType;
  status?: ClientLifecycleStatus;
  main_phone?: string | null;
  office_phone?: string | null;
  website?: string | null;
  notes?: string | null;
  external_code?: string | null;
};

type ClientContactInput = {
  organization_id?: string | null;
  account_id?: string | null;
  first_name: string;
  last_name: string;
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile_phone?: string | null;
  office_phone?: string | null;
  title?: string | null;
  preferred_contact_method?: ClientPreferredContactMethod;
  allow_email?: boolean;
  allow_sms?: boolean;
  allow_phone?: boolean;
  do_not_contact?: boolean;
  sms_consent_status?: ClientSmsConsentStatus;
  sms_consent_source?: string | null;
  sms_consent_at?: string | null;
  sms_opted_out_at?: string | null;
  notes?: string | null;
};

type ClientRelationshipInput = {
  contact_id: string;
  organization_id?: string | null;
  account_id?: string | null;
  roles: ClientContactRole[];
  is_primary?: boolean;
  receives_picture_day_emails?: boolean;
  receives_yearbook_emails?: boolean;
  receives_billing_emails?: boolean;
  receives_gallery_emails?: boolean;
  receives_approval_emails?: boolean;
  receives_onboarding_emails?: boolean;
  receives_internal_escalations?: boolean;
  notes?: string | null;
};

type ClientOwnerInput = {
  organization_id?: string | null;
  account_id?: string | null;
  owner_user_id: string;
  owner_type: ClientOwnerType;
  notes?: string | null;
};

type AccountServiceInput = {
  service_type: AccountServiceType;
  status?: AccountServiceStatus;
  notes?: string | null;
};

type AccountTaskInput = {
  title: string;
  description?: string | null;
  assigned_to_user_id?: string | null;
  due_at?: string | null;
  priority?: "low" | "normal" | "high" | "urgent";
  service_type?: AccountServiceType | null;
  communication_type?: ClientCommunicationType | null;
  contact_id?: string | null;
  related_job_id?: string | null;
  department_type?: WorkDepartmentType;
};

type OrganizationRow = {
  id: string;
  entity_kind: ClientEntityKind;
  name: string;
  parent_organization_id: string | null;
  parent_organization_name: string | null;
  client_organization_type: ClientOrganizationType | null;
  lifecycle_status: ClientLifecycleStatus;
  account_type: string;
  main_phone: string | null;
  office_phone: string | null;
  website: string | null;
  contact_count: string | number;
  service_count: string | number;
  open_job_count: string | number;
  studio_bestie_name: string | null;
  updated_at: string;
};

const SCHOOL_TYPES = new Set<ClientOrganizationType>(["school_district", "elementary_school", "middle_school", "high_school", "school"]);
const SPORTS_TYPES = new Set<ClientOrganizationType>(["league", "sports_association"]);
const PICTURE_DAY_SERVICES = new Set<AccountServiceType>(["fall_pictures", "spring_pictures", "retakes"]);

function assertReadAccess(auth: AuthUser) {
  if (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "supervisor"]) ||
    canManageCanonicalDirectoryRecords(auth) ||
    hasPermissionCode(auth, "client_command_center.read") ||
    hasPermissionCode(auth, "client_command_center.manage")
  ) {
    return;
  }
  throw new ApiError(403, "Forbidden");
}

function assertManageAccess(auth: AuthUser) {
  if (
    canManageCanonicalDirectoryRecords(auth) ||
    hasPermissionCode(auth, "client_command_center.manage") ||
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])
  ) {
    return;
  }
  throw new ApiError(403, "Forbidden");
}

function normalizeDirectoryText(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function optionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toExistingAccountType(type: ClientOrganizationType) {
  if (SCHOOL_TYPES.has(type)) {
    return "schools_underclass_portraits";
  }
  if (SPORTS_TYPES.has(type)) {
    return "sports";
  }
  if (type === "studio_client") {
    return "studio";
  }
  if (type === "corporate_client" || type === "company") {
    return "commercial";
  }
  return "events";
}

function toOrganizationSummary(row: OrganizationRow, readinessIssueCount = 0): ClientOrganizationSummary {
  return {
    id: row.id,
    entity_kind: row.entity_kind,
    name: row.name,
    parent_organization_id: row.parent_organization_id,
    parent_organization_name: row.parent_organization_name,
    client_organization_type: row.client_organization_type,
    lifecycle_status: row.lifecycle_status,
    account_type: row.account_type,
    main_phone: row.main_phone,
    office_phone: row.office_phone,
    website: row.website,
    contact_count: Number(row.contact_count ?? 0),
    service_count: Number(row.service_count ?? 0),
    open_job_count: Number(row.open_job_count ?? 0),
    readiness_issue_count: readinessIssueCount,
    studio_bestie_name: row.studio_bestie_name,
    updated_at: row.updated_at
  };
}

function parseClientRoles(value: unknown): ClientContactRole[] {
  if (Array.isArray(value)) {
    return value as ClientContactRole[];
  }
  if (typeof value === "string") {
    return value
      .replace(/^\{|\}$/g, "")
      .split(",")
      .map((role) => role.trim().replace(/^"|"$/g, ""))
      .filter(Boolean) as ClientContactRole[];
  }
  return [];
}

const PREP_RECIPIENT_ROLES: ClientContactRole[] = [
  "primary_contact",
  "primary_decision_maker",
  "picture_day_contact",
  "picture_day_prep_recipient",
  "day_before_reminder_recipient",
  "head_secretary",
  "secretary_admin_assistant"
];

function contactHasPrepRole(contact: Pick<ClientContactSummary, "client_roles">) {
  return PREP_RECIPIENT_ROLES.some((role) => contact.client_roles.includes(role));
}

function buildPrepEmailReadiness(contact: Pick<ClientContactSummary, "active_status" | "do_not_contact" | "allow_email" | "email" | "client_roles">) {
  if (contact.active_status !== "active") {
    return { eligible: false, reason: "Contact is inactive." };
  }
  if (contact.do_not_contact) {
    return { eligible: false, reason: "Do not contact is enabled." };
  }
  if (!contactHasPrepRole(contact)) {
    return { eligible: false, reason: "Contact is not marked for prep communication." };
  }
  if (!contact.allow_email) {
    return { eligible: false, reason: "Email is not allowed for this contact." };
  }
  if (!contact.email) {
    return { eligible: false, reason: "Missing email address." };
  }
  return { eligible: true, reason: null };
}

function buildPrepSmsReadiness(
  contact: Pick<ClientContactSummary, "active_status" | "do_not_contact" | "allow_sms" | "mobile_phone" | "sms_consent_status" | "client_roles">
) {
  if (contact.active_status !== "active") {
    return { eligible: false, reason: "Contact is inactive." };
  }
  if (contact.do_not_contact) {
    return { eligible: false, reason: "Do not contact is enabled." };
  }
  if (!contactHasPrepRole(contact)) {
    return { eligible: false, reason: "Contact is not marked for prep communication." };
  }
  if (!contact.allow_sms) {
    return { eligible: false, reason: "SMS is not allowed for this contact." };
  }
  if (!contact.mobile_phone) {
    return { eligible: false, reason: "Missing mobile phone." };
  }
  if (contact.sms_consent_status !== "opted_in") {
    return { eligible: false, reason: `SMS consent is ${contact.sms_consent_status.replace(/_/g, " ")}.` };
  }
  return { eligible: true, reason: null };
}

async function loadAccountRow(client: PoolClient, tenantId: string, accountId: string) {
  const result = await client.query<OrganizationRow>(
    `
      SELECT
        account.id::text,
        account.client_entity_kind::text AS entity_kind,
        account.display_name AS name,
        account.parent_organization_id::text,
        parent.display_name AS parent_organization_name,
        account.client_organization_type::text AS client_organization_type,
        account.client_lifecycle_status::text AS lifecycle_status,
        account.account_type::text AS account_type,
        account.main_phone,
        account.office_phone,
        account.website,
        count(DISTINCT relationship.contact_id)::text AS contact_count,
        count(DISTINCT service.id)::text AS service_count,
        count(DISTINCT job.id) FILTER (
          WHERE job.job_status NOT IN ('cancelled'::job_status_type, 'archived'::job_status_type, 'execution_complete'::job_status_type)
        )::text AS open_job_count,
        max(owner_user.full_name) FILTER (WHERE owner.owner_type = 'studio_bestie'::client_owner_type) AS studio_bestie_name,
        account.updated_at::text
      FROM organization account
      LEFT JOIN organization parent
        ON parent.tenant_id = account.tenant_id
       AND parent.id = account.parent_organization_id
      LEFT JOIN organization_contact_relationship relationship
        ON relationship.tenant_id = account.tenant_id
       AND relationship.organization_id = account.id
       AND relationship.is_current = true
      LEFT JOIN account_service service
        ON service.tenant_id = account.tenant_id
       AND service.account_id = account.id
      LEFT JOIN jobs job
        ON job.tenant_id = account.tenant_id
       AND job.organization_id = account.id
      LEFT JOIN client_internal_owner owner
        ON owner.tenant_id = account.tenant_id
       AND owner.account_id = account.id
      LEFT JOIN app_user owner_user
        ON owner_user.tenant_id = owner.tenant_id
       AND owner_user.id = owner.owner_user_id
      WHERE account.tenant_id = $1
        AND account.id = $2
      GROUP BY account.id, parent.display_name
      LIMIT 1
    `,
    [tenantId, accountId]
  );
  return result.rows[0] ?? null;
}

async function loadContactSummaries(client: PoolClient, tenantId: string, accountId: string): Promise<ClientContactSummary[]> {
  const result = await client.query<{
    id: string;
    display_name: string;
    first_name: string;
    last_name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    mobile_phone: string | null;
    office_phone: string | null;
    preferred_contact_method: ClientPreferredContactMethod;
    active_status: "active" | "inactive";
    allow_email: boolean;
    allow_sms: boolean;
    allow_phone: boolean;
    do_not_contact: boolean;
    sms_consent_status: ClientSmsConsentStatus;
    sms_consent_source: string | null;
    sms_consent_at: string | null;
    sms_opted_out_at: string | null;
    notes: string | null;
    relationship_id: string | null;
    organization_id: string | null;
    organization_name: string | null;
    client_roles: unknown;
    is_primary: boolean;
    receives_picture_day_emails: boolean;
    receives_yearbook_emails: boolean;
    receives_billing_emails: boolean;
    receives_gallery_emails: boolean;
    receives_approval_emails: boolean;
    receives_onboarding_emails: boolean;
    receives_internal_escalations: boolean;
  }>(
    `
      SELECT
        contact.id::text,
        COALESCE(contact.display_name, contact.full_name) AS display_name,
        contact.first_name,
        contact.last_name,
        contact.title,
        contact.email,
        contact.phone,
        contact.mobile_phone,
        contact.office_phone,
        contact.preferred_contact_method::text AS preferred_contact_method,
        contact.active_status::text AS active_status,
        contact.allow_email,
        contact.allow_sms,
        contact.allow_phone,
        contact.do_not_contact,
        contact.sms_consent_status::text AS sms_consent_status,
        contact.sms_consent_source,
        contact.sms_consent_at::text,
        contact.sms_opted_out_at::text,
        contact.notes,
        relationship.id::text AS relationship_id,
        relationship.organization_id::text,
        organization.display_name AS organization_name,
        relationship.client_roles,
        relationship.is_primary,
        relationship.receives_picture_day_emails,
        relationship.receives_yearbook_emails,
        relationship.receives_billing_emails,
        relationship.receives_gallery_emails,
        relationship.receives_approval_emails,
        relationship.receives_onboarding_emails,
        relationship.receives_internal_escalations
      FROM organization_contact_relationship relationship
      JOIN organization_contact contact
        ON contact.tenant_id = relationship.tenant_id
       AND contact.id = relationship.contact_id
      JOIN organization
        ON organization.tenant_id = relationship.tenant_id
       AND organization.id = relationship.organization_id
      WHERE relationship.tenant_id = $1
        AND relationship.organization_id = $2
        AND relationship.is_current = true
      ORDER BY relationship.is_primary DESC, contact.active_status, lower(contact.full_name)
    `,
    [tenantId, accountId]
  );

  return result.rows.map((row) => {
    const contact = {
      ...row,
      client_roles: parseClientRoles(row.client_roles)
    };
    const prepEmail = buildPrepEmailReadiness(contact);
    const prepSms = buildPrepSmsReadiness(contact);
    return {
      ...contact,
      prep_email_eligible: prepEmail.eligible,
      prep_email_exclusion_reason: prepEmail.reason,
      prep_sms_eligible: prepSms.eligible,
      prep_sms_exclusion_reason: prepSms.reason
    };
  });
}

async function loadOwners(client: PoolClient, tenantId: string, accountId: string): Promise<ClientInternalOwnerRecord[]> {
  const result = await client.query<ClientInternalOwnerRecord>(
    `
      SELECT
        owner.id::text,
        owner.owner_user_id::text,
        COALESCE(app_user.full_name, app_user.email, 'Unknown owner') AS owner_name,
        app_user.email AS owner_email,
        app_user.department::text AS owner_department,
        owner.owner_type::text AS owner_type,
        owner.notes
      FROM client_internal_owner owner
      JOIN app_user
        ON app_user.tenant_id = owner.tenant_id
       AND app_user.id = owner.owner_user_id
      WHERE owner.tenant_id = $1
        AND owner.account_id = $2
      ORDER BY owner.owner_type::text, owner.created_at
    `,
    [tenantId, accountId]
  );
  return result.rows;
}

async function loadServices(client: PoolClient, tenantId: string, accountId: string): Promise<AccountServiceRecord[]> {
  const result = await client.query<AccountServiceRecord>(
    `
      SELECT
        id::text,
        service_type::text AS service_type,
        status::text AS status,
        notes
      FROM account_service
      WHERE tenant_id = $1
        AND account_id = $2
      ORDER BY service_type::text
    `,
    [tenantId, accountId]
  );
  return result.rows;
}

async function loadLocationSummaries(client: PoolClient, tenantId: string, accountId: string): Promise<ClientLocationSummary[]> {
  type LocationRow = Omit<ClientLocationSummary, "google_maps_url" | "reference_attachments"> & {
    navigation_url: string | null;
  };
  const result = await client.query<LocationRow>(
    `
      SELECT
        id::text,
        name AS location_name,
        location_type,
        organization_id::text,
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
        navigation_url,
        active_status::text AS active_status,
        navigation_notes,
        parking_instructions,
        entrance_instructions,
        unloading_instructions,
        setup_area,
        backup_indoor_location,
        accessibility_notes,
        power_availability_notes,
        wifi_cell_notes,
        security_checkin_requirements,
        weather_contingency_notes,
        client_facing_notes,
        employee_facing_notes,
        internal_only_notes,
        location_details AS notes,
        updated_at::text
      FROM shoot_location
      WHERE tenant_id = $1
        AND organization_id = $2
      ORDER BY active_status = 'active' DESC, location_type, lower(name)
    `,
    [tenantId, accountId]
  );
  if (!result.rows.length) {
    return [];
  }

  const locationIds = result.rows.map((row) => row.id);
  const attachments = await client.query<ClientLocationReferenceAttachment>(
    `
      SELECT
        attachment.id::text,
        attachment.location_id::text,
        attachment.title,
        attachment.description,
        attachment.attachment_type::text AS attachment_type,
        attachment.audience::text AS audience,
        attachment.file_url,
        attachment.storage_key,
        attachment.uploaded_by_user_id::text,
        app_user.full_name AS uploaded_by_name,
        attachment.uploaded_at::text,
        attachment.active_status::text AS active_status
      FROM location_reference_attachment attachment
      LEFT JOIN app_user
        ON app_user.tenant_id = attachment.tenant_id
       AND app_user.id = attachment.uploaded_by_user_id
      WHERE attachment.tenant_id = $1
        AND attachment.location_id = ANY($2::uuid[])
        AND attachment.active_status = 'active'
      ORDER BY attachment.audience::text, attachment.attachment_type::text, lower(attachment.title)
    `,
    [tenantId, locationIds]
  );

  const attachmentsByLocation = new Map<string, ClientLocationReferenceAttachment[]>();
  for (const attachment of attachments.rows) {
    const current = attachmentsByLocation.get(attachment.location_id) ?? [];
    current.push(attachment);
    attachmentsByLocation.set(attachment.location_id, current);
  }

  return result.rows.map((row) => {
    const { navigation_url: navigationUrl, ...location } = row;
    return {
      ...location,
      google_maps_url: navigationUrl ?? buildGoogleMapsSearchUrl(row),
      reference_attachments: attachmentsByLocation.get(row.id) ?? []
    };
  });
}

function buildGoogleMapsSearchUrl(location: Pick<ClientLocationSummary, "location_name" | "address_display" | "address_line_1" | "city" | "state" | "zip">) {
  const address = location.address_display || [location.address_line_1, [location.city, location.state].filter(Boolean).join(", "), location.zip].filter(Boolean).join(" ");
  const query = [location.location_name, address].filter(Boolean).join(" ");
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

function contactHasAnyRole(contact: ClientContactSummary, roles: ClientContactRole[]) {
  return roles.some((role) => contact.client_roles.includes(role));
}

function contactHasUsableAddress(contact: ClientContactSummary) {
  if (contact.do_not_contact) {
    return false;
  }
  return Boolean((contact.allow_email && contact.email) || (contact.allow_phone && contact.phone) || (contact.allow_phone && contact.office_phone) || (contact.allow_sms && contact.mobile_phone));
}

async function buildReadiness(
  client: PoolClient,
  tenantId: string,
  accountId: string,
  contacts?: ClientContactSummary[],
  services?: AccountServiceRecord[],
  owners?: ClientInternalOwnerRecord[]
): Promise<ClientReadinessResult> {
  const [loadedContacts, loadedServices, loadedOwners] = await Promise.all([
    contacts ? Promise.resolve(contacts) : loadContactSummaries(client, tenantId, accountId),
    services ? Promise.resolve(services) : loadServices(client, tenantId, accountId),
    owners ? Promise.resolve(owners) : loadOwners(client, tenantId, accountId)
  ]);
  const activeServices = loadedServices.filter((service) => service.status === "active" || service.status === "seasonal");
  const activeServiceTypes = new Set(activeServices.map((service) => service.service_type));
  const hasActiveJobsResult = await client.query<{ count: string }>(
    `
      SELECT count(*)::text
      FROM jobs
      WHERE tenant_id = $1
        AND organization_id = $2
        AND job_status NOT IN ('cancelled'::job_status_type, 'archived'::job_status_type, 'execution_complete'::job_status_type)
    `,
    [tenantId, accountId]
  );
  const hasActiveJobs = Number(hasActiveJobsResult.rows[0]?.count ?? 0) > 0;

  const primaryContacts = loadedContacts.filter((contact) => contact.is_primary || contactHasAnyRole(contact, ["primary_contact"]));
  const pictureDayContacts = loadedContacts.filter((contact) => contactHasAnyRole(contact, ["picture_day_contact"]));
  const yearbookContacts = loadedContacts.filter((contact) => contactHasAnyRole(contact, ["yearbook_contact"]));
  const billingContacts = loadedContacts.filter((contact) => contactHasAnyRole(contact, ["billing_contact"]));
  const emergencyContacts = loadedContacts.filter((contact) => contactHasAnyRole(contact, ["emergency_day_of_contact"]));
  const requiredContacts = [...primaryContacts, ...pictureDayContacts, ...yearbookContacts, ...billingContacts, ...emergencyContacts];
  const hasPictureService = [...activeServiceTypes].some((service) => PICTURE_DAY_SERVICES.has(service));
  const hasYearbookService = activeServiceTypes.has("yearbook");
  const requiredContactsHaveUsableInfo = requiredContacts.length > 0 && requiredContacts.every(contactHasUsableAddress);
  const checks = [
    {
      code: "has_primary_contact",
      passed: primaryContacts.length > 0,
      label: "Primary contact",
      detail: primaryContacts.length ? "Primary contact is on file." : "Add a primary contact so the account has a clear main point person."
    },
    {
      code: "has_picture_day_contact",
      passed: !hasPictureService || pictureDayContacts.length > 0,
      label: "Picture day contact",
      detail: hasPictureService
        ? pictureDayContacts.length
          ? "Picture-day services have a prep and day-of contact."
          : "Add a picture day contact before prep emails or day-of reminders."
        : "No active picture-day service requires this yet."
    },
    {
      code: "has_yearbook_contact",
      passed: !hasYearbookService || yearbookContacts.length > 0,
      label: "Yearbook contact",
      detail: hasYearbookService
        ? yearbookContacts.length
          ? "Yearbook service has a deadline/reminder contact."
          : "Add a yearbook contact before deadline reminders are prepared."
        : "Yearbook is not active for this account."
    },
    {
      code: "has_billing_contact",
      passed: billingContacts.length > 0,
      label: "Billing contact",
      detail: billingContacts.length ? "Billing contact is on file." : "Add a billing contact before invoice or approval follow-up."
    },
    {
      code: "has_emergency_day_of_contact",
      passed: !hasActiveJobs || emergencyContacts.length > 0,
      label: "Emergency day-of contact",
      detail: hasActiveJobs
        ? emergencyContacts.length
          ? "Active jobs have an emergency day-of contact."
          : "Add an emergency day-of contact before the next active job."
        : "No active job currently requires a day-of contact."
    },
    {
      code: "has_internal_owner",
      passed: loadedOwners.length > 0,
      label: "Studio Bestie/internal owner",
      detail: loadedOwners.length ? "Studio Bestie/internal owner is assigned." : "Assign a Studio Bestie or internal owner for relationship accountability."
    },
    {
      code: "has_valid_phone_or_email_for_required_contacts",
      passed: requiredContactsHaveUsableInfo,
      label: "Usable contact info",
      detail: requiredContacts.length
        ? requiredContactsHaveUsableInfo
          ? "Required contacts have at least one usable email or phone."
          : "Add an email, phone, or mobile phone for each required contact."
        : "Add required contacts first, then confirm each has an email or phone."
    }
  ];

  const issueMap: Record<string, { severity: "warning" | "critical"; communication_type: ClientCommunicationType | null }> = {
    has_primary_contact: { severity: "critical", communication_type: "new_client_onboarding" },
    has_picture_day_contact: { severity: "critical", communication_type: "picture_day_prep" },
    has_yearbook_contact: { severity: "warning", communication_type: "yearbook_deadline" },
    has_billing_contact: { severity: "warning", communication_type: "missing_approval_followup" },
    has_emergency_day_of_contact: { severity: "critical", communication_type: "picture_day_confirmation" },
    has_internal_owner: { severity: "critical", communication_type: "issue_escalation" },
    has_valid_phone_or_email_for_required_contacts: { severity: "critical", communication_type: null }
  };
  const issues: ClientReadinessIssue[] = checks
    .filter((check) => !check.passed)
    .map((check) => ({
      code: check.code,
      severity: issueMap[check.code]?.severity ?? "warning",
      label: check.label,
      detail: check.detail,
      communication_type: issueMap[check.code]?.communication_type ?? null
    }));

  return {
    account_id: accountId,
    generated_at: new Date().toISOString(),
    status: issues.some((issue) => issue.severity === "critical") ? "blocked" : issues.length ? "needs_attention" : "ready",
    checks,
    issues
  };
}

export async function listClientCommandCenter(client: PoolClient, auth: AuthUser): Promise<ClientCommandCenterDashboard> {
  assertReadAccess(auth);
  const parentOrganizations = await client.query<OrganizationRow>(
    `
      SELECT
        organization.id::text,
        organization.client_entity_kind::text AS entity_kind,
        organization.display_name AS name,
        organization.parent_organization_id::text,
        NULL::text AS parent_organization_name,
        organization.client_organization_type::text AS client_organization_type,
        organization.client_lifecycle_status::text AS lifecycle_status,
        organization.account_type::text AS account_type,
        organization.main_phone,
        organization.office_phone,
        organization.website,
        count(DISTINCT relationship.contact_id)::text AS contact_count,
        0::text AS service_count,
        0::text AS open_job_count,
        max(owner_user.full_name) FILTER (WHERE owner.owner_type = 'studio_bestie'::client_owner_type) AS studio_bestie_name,
        organization.updated_at::text
      FROM organization
      LEFT JOIN organization_contact_relationship relationship
        ON relationship.tenant_id = organization.tenant_id
       AND relationship.organization_id = organization.id
       AND relationship.is_current = true
      LEFT JOIN client_internal_owner owner
        ON owner.tenant_id = organization.tenant_id
       AND owner.organization_id = organization.id
      LEFT JOIN app_user owner_user
        ON owner_user.tenant_id = owner.tenant_id
       AND owner_user.id = owner.owner_user_id
      WHERE organization.tenant_id = $1
        AND organization.client_entity_kind = 'parent_organization'::client_entity_kind
        AND organization.active_status = 'active'::directory_active_status
      GROUP BY organization.id
      ORDER BY lower(organization.display_name)
      LIMIT 100
    `,
    [auth.tenantId]
  );
  const accounts = await client.query<OrganizationRow>(
    `
      SELECT
        account.id::text,
        account.client_entity_kind::text AS entity_kind,
        account.display_name AS name,
        account.parent_organization_id::text,
        parent.display_name AS parent_organization_name,
        account.client_organization_type::text AS client_organization_type,
        account.client_lifecycle_status::text AS lifecycle_status,
        account.account_type::text AS account_type,
        account.main_phone,
        account.office_phone,
        account.website,
        count(DISTINCT relationship.contact_id)::text AS contact_count,
        count(DISTINCT service.id)::text AS service_count,
        count(DISTINCT job.id) FILTER (
          WHERE job.job_status NOT IN ('cancelled'::job_status_type, 'archived'::job_status_type, 'execution_complete'::job_status_type)
        )::text AS open_job_count,
        max(owner_user.full_name) FILTER (WHERE owner.owner_type = 'studio_bestie'::client_owner_type) AS studio_bestie_name,
        account.updated_at::text
      FROM organization account
      LEFT JOIN organization parent
        ON parent.tenant_id = account.tenant_id
       AND parent.id = account.parent_organization_id
      LEFT JOIN organization_contact_relationship relationship
        ON relationship.tenant_id = account.tenant_id
       AND relationship.organization_id = account.id
       AND relationship.is_current = true
      LEFT JOIN account_service service
        ON service.tenant_id = account.tenant_id
       AND service.account_id = account.id
      LEFT JOIN jobs job
        ON job.tenant_id = account.tenant_id
       AND job.organization_id = account.id
      LEFT JOIN client_internal_owner owner
        ON owner.tenant_id = account.tenant_id
       AND owner.account_id = account.id
      LEFT JOIN app_user owner_user
        ON owner_user.tenant_id = owner.tenant_id
       AND owner_user.id = owner.owner_user_id
      WHERE account.tenant_id = $1
        AND account.client_entity_kind = 'account'::client_entity_kind
        AND account.active_status = 'active'::directory_active_status
      GROUP BY account.id, parent.display_name
      ORDER BY account.updated_at DESC
      LIMIT 100
    `,
    [auth.tenantId]
  );

  const readinessByAccount = new Map<string, ClientReadinessResult>();
  for (const row of accounts.rows) {
    readinessByAccount.set(row.id, await buildReadiness(client, auth.tenantId, row.id));
  }
  const summaries = accounts.rows.map((row) => toOrganizationSummary(row, readinessByAccount.get(row.id)?.issues.length ?? 0));
  const readinessIssues = summaries.flatMap((account) =>
    (readinessByAccount.get(account.id)?.issues ?? []).map((issue) => ({
      ...issue,
      account_id: account.id,
      account_name: account.name
    }))
  );
  return {
    generated_at: new Date().toISOString(),
    summary: {
      active_accounts: summaries.length,
      accounts_missing_required_contacts: summaries.filter((account) => account.readiness_issue_count > 0).length,
      accounts_missing_studio_bestie: summaries.filter((account) => !account.studio_bestie_name).length,
      accounts_with_upcoming_jobs: summaries.filter((account) => account.open_job_count > 0).length,
      readiness_issues: readinessIssues.length
    },
    accounts: summaries,
    parent_organizations: parentOrganizations.rows.map((row) => toOrganizationSummary(row)),
    readiness_issues: readinessIssues,
    recently_updated: [...summaries].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 12)
  };
}

export async function getClientAccountDetail(client: PoolClient, auth: AuthUser, accountId: string): Promise<ClientAccountDetail> {
  assertReadAccess(auth);
  const row = await loadAccountRow(client, auth.tenantId, accountId);
  if (!row) {
    throw new ApiError(404, "Account not found");
  }
  const [contacts, locations, owners, services] = await Promise.all([
    loadContactSummaries(client, auth.tenantId, accountId),
    loadLocationSummaries(client, auth.tenantId, accountId),
    loadOwners(client, auth.tenantId, accountId),
    loadServices(client, auth.tenantId, accountId)
  ]);
  const readiness = await buildReadiness(client, auth.tenantId, accountId, contacts, services, owners);
  const parent = row.parent_organization_id ? await loadAccountRow(client, auth.tenantId, row.parent_organization_id) : null;
  const upcomingJobs = await client.query<{
    id: string;
    job_number: string | null;
    title: string;
    scheduled_start_at: string | null;
    job_status: string;
  }>(
    `
      SELECT id::text, job_number, title, scheduled_start_at::text, job_status::text
      FROM jobs
      WHERE tenant_id = $1
        AND organization_id = $2
        AND job_status NOT IN ('cancelled'::job_status_type, 'archived'::job_status_type)
      ORDER BY scheduled_start_at NULLS LAST, created_at DESC
      LIMIT 12
    `,
    [auth.tenantId, accountId]
  );
  const openTasks = await client.query<{
    id: string;
    task_number: string;
    title: string;
    status: string;
    due_at: string | null;
    assigned_to_name: string | null;
  }>(
    `
      SELECT
        task.id::text,
        task.task_number,
        task.title,
        task.status::text,
        task.due_at::text,
        assignee.full_name AS assigned_to_name
      FROM work_task task
      LEFT JOIN app_user assignee
        ON assignee.tenant_id = task.tenant_id
       AND assignee.id = task.assigned_to_user_id
      WHERE task.tenant_id = $1
        AND task.organization_id = $2
        AND task.status NOT IN ('completed'::work_task_status_type, 'cancelled'::work_task_status_type)
      ORDER BY task.due_at NULLS LAST, task.created_at DESC
      LIMIT 12
    `,
    [auth.tenantId, accountId]
  );
  const timeline = await loadClientTimeline(client, auth.tenantId, accountId);
  return {
    account: toOrganizationSummary(row, readiness.issues.length),
    parent_organization: parent ? toOrganizationSummary(parent) : null,
    contacts,
    locations,
    owners,
    services,
    readiness,
    upcoming_jobs: upcomingJobs.rows,
    open_tasks: openTasks.rows,
    timeline
  };
}

async function loadClientTimeline(client: PoolClient, tenantId: string, accountId: string): Promise<ClientTimelineItem[]> {
  const result = await client.query<ClientTimelineItem>(
    `
      SELECT
        touchpoint.id::text,
        'note'::text AS kind,
        COALESCE(touchpoint.subject, 'Client note') AS title,
        touchpoint.summary,
        touchpoint.occurred_at::text AS occurred_at,
        actor.full_name AS actor_name,
        touchpoint.id::text AS source_id
      FROM directory_touchpoint touchpoint
      LEFT JOIN app_user actor
        ON actor.tenant_id = touchpoint.tenant_id
       AND actor.id = touchpoint.created_by_user_id
      WHERE touchpoint.tenant_id = $1
        AND touchpoint.organization_id = $2
      UNION ALL
      SELECT
        task.id::text,
        'task'::text AS kind,
        task.title,
        concat('Task ', task.task_number, ' is ', task.status::text) AS summary,
        task.created_at::text AS occurred_at,
        actor.full_name AS actor_name,
        task.id::text AS source_id
      FROM work_task task
      LEFT JOIN app_user actor
        ON actor.tenant_id = task.tenant_id
       AND actor.id = task.created_by_user_id
      WHERE task.tenant_id = $1
        AND task.organization_id = $2
      ORDER BY occurred_at DESC
      LIMIT 20
    `,
    [tenantId, accountId]
  );
  return result.rows;
}

async function assertOrganizationExists(client: PoolClient, tenantId: string, id: string, expectedKind?: ClientEntityKind) {
  const result = await client.query<{ id: string; client_entity_kind: ClientEntityKind }>(
    `
      SELECT id::text, client_entity_kind::text AS client_entity_kind
      FROM organization
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, id]
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "Organization/account not found");
  }
  if (expectedKind && row.client_entity_kind !== expectedKind) {
    throw new ApiError(400, `Expected ${expectedKind.replace("_", " ")} record`);
  }
}

export async function createClientOrganization(client: PoolClient, auth: AuthUser, input: ClientOrganizationInput) {
  assertManageAccess(auth);
  const name = input.name.trim();
  const normalized = normalizeDirectoryText(name);
  const duplicate = await client.query<{ id: string }>(
    `
      SELECT id
      FROM organization
      WHERE tenant_id = $1
        AND normalized_canonical_name = $2
        AND client_entity_kind = 'parent_organization'::client_entity_kind
        AND active_status = 'active'::directory_active_status
      LIMIT 1
    `,
    [auth.tenantId, normalized]
  );
  if (duplicate.rows[0]) {
    throw new ApiError(409, "An active parent organization with this exact name already exists");
  }
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO organization (
        tenant_id,
        canonical_name,
        normalized_canonical_name,
        display_name,
        account_type,
        active_status,
        client_entity_kind,
        client_organization_type,
        client_lifecycle_status,
        main_phone,
        website,
        external_code,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$2,$4::organization_account_type,$5::directory_active_status,'parent_organization',$6,$7,$8,$9,$10,$11,$12,$12)
      RETURNING id::text
    `,
    [
      auth.tenantId,
      name,
      normalized,
      toExistingAccountType(input.organization_type),
      input.status === "archived" || input.status === "inactive" || input.status === "former_client" ? "inactive" : "active",
      input.organization_type,
      input.status ?? "active",
      optionalText(input.phone),
      optionalText(input.website),
      optionalText(input.external_code),
      optionalText(input.notes),
      auth.id
    ]
  );
  await emitClientEvent(client, auth.tenantId, "client.organization_created", "organization", result.rows[0].id, {
    name,
    organization_type: input.organization_type
  });
  return getClientAccountDetail(client, auth, result.rows[0].id);
}

export async function createClientAccount(client: PoolClient, auth: AuthUser, input: ClientAccountInput) {
  assertManageAccess(auth);
  const name = input.name.trim();
  const normalized = normalizeDirectoryText(name);
  const parentId = optionalText(input.organization_id);
  if (parentId) {
    await assertOrganizationExists(client, auth.tenantId, parentId, "parent_organization");
  }
  const duplicate = await client.query<{ id: string }>(
    `
      SELECT id
      FROM organization
      WHERE tenant_id = $1
        AND normalized_canonical_name = $2
        AND parent_organization_id IS NOT DISTINCT FROM $3::uuid
        AND client_entity_kind = 'account'::client_entity_kind
        AND active_status = 'active'::directory_active_status
      LIMIT 1
    `,
    [auth.tenantId, normalized, parentId]
  );
  if (duplicate.rows[0]) {
    throw new ApiError(409, "An active account with this exact name already exists under this parent organization");
  }
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO organization (
        tenant_id,
        canonical_name,
        normalized_canonical_name,
        display_name,
        account_type,
        active_status,
        parent_organization_id,
        client_entity_kind,
        client_organization_type,
        client_lifecycle_status,
        main_phone,
        office_phone,
        website,
        external_code,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$2,$4::organization_account_type,$5::directory_active_status,$6,'account',$7,$8,$9,$10,$11,$12,$13,$14,$14)
      RETURNING id::text
    `,
    [
      auth.tenantId,
      name,
      normalized,
      toExistingAccountType(input.account_type),
      input.status === "archived" || input.status === "inactive" || input.status === "former_client" ? "inactive" : "active",
      parentId,
      input.account_type,
      input.status ?? "active",
      optionalText(input.main_phone),
      optionalText(input.office_phone),
      optionalText(input.website),
      optionalText(input.external_code),
      optionalText(input.notes),
      auth.id
    ]
  );
  await emitClientEvent(client, auth.tenantId, "client.account_created", "organization", result.rows[0].id, {
    name,
    account_type: input.account_type,
    parent_organization_id: parentId
  });
  return getClientAccountDetail(client, auth, result.rows[0].id);
}

export async function createClientContact(client: PoolClient, auth: AuthUser, input: ClientContactInput) {
  assertManageAccess(auth);
  const anchorOrganizationId = optionalText(input.account_id) ?? optionalText(input.organization_id);
  if (!anchorOrganizationId) {
    throw new ApiError(400, "Create contacts through an account or organization context");
  }
  await assertOrganizationExists(client, auth.tenantId, anchorOrganizationId);
  const email = optionalText(input.email)?.toLowerCase() ?? null;
  if (email) {
    const duplicate = await client.query<{ id: string; full_name: string }>(
      `
        SELECT id::text, full_name
        FROM organization_contact
        WHERE tenant_id = $1
          AND lower(email) = $2
          AND active_status = 'active'::directory_active_status
        LIMIT 1
      `,
      [auth.tenantId, email]
    );
    if (duplicate.rows[0]) {
      throw new ApiError(409, `A contact with this email already exists: ${duplicate.rows[0].full_name}`);
    }
  }
  const firstName = input.first_name.trim();
  const lastName = input.last_name.trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const displayName = optionalText(input.display_name) ?? fullName;
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO organization_contact (
        tenant_id,
        organization_id,
        first_name,
        last_name,
        full_name,
        display_name,
        normalized_full_name,
        title,
        phone,
        mobile_phone,
        office_phone,
        email,
        preferred_contact_method,
        allow_email,
        allow_sms,
        allow_phone,
        do_not_contact,
        sms_consent_status,
        sms_consent_source,
        sms_consent_at,
        sms_opted_out_at,
        contact_status,
        active_status,
        role_category,
        operational_importance,
        decision_influence,
        relationship_strength,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'active','active','other','normal','informational_only','unknown',$22,$23,$23)
      RETURNING id::text
    `,
    [
      auth.tenantId,
      anchorOrganizationId,
      firstName,
      lastName,
      fullName,
      displayName,
      normalizeDirectoryText(fullName),
      optionalText(input.title),
      optionalText(input.phone),
      optionalText(input.mobile_phone),
      optionalText(input.office_phone),
      email,
      input.preferred_contact_method ?? "unknown",
      input.allow_email ?? true,
      input.allow_sms ?? false,
      input.allow_phone ?? true,
      input.do_not_contact ?? false,
      input.sms_consent_status ?? "unknown",
      optionalText(input.sms_consent_source),
      optionalText(input.sms_consent_at),
      optionalText(input.sms_opted_out_at),
      optionalText(input.notes),
      auth.id
    ]
  );
  await emitClientEvent(client, auth.tenantId, "client.contact_created", "organization_contact", result.rows[0].id, {
    display_name: displayName,
    anchor_organization_id: anchorOrganizationId
  });
  return result.rows[0];
}

export async function attachClientContactRelationship(client: PoolClient, auth: AuthUser, input: ClientRelationshipInput) {
  assertManageAccess(auth);
  const organizationId = optionalText(input.account_id) ?? optionalText(input.organization_id);
  if (!organizationId) {
    throw new ApiError(400, "Attach contacts to an account or organization");
  }
  await assertOrganizationExists(client, auth.tenantId, organizationId);
  const contactExists = await client.query<{ id: string }>(
    `SELECT id::text FROM organization_contact WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, input.contact_id]
  );
  if (!contactExists.rows[0]) {
    throw new ApiError(404, "Contact not found");
  }
  const roles = [...new Set(input.roles.length ? input.roles : ["other"])];
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO organization_contact_relationship (
        tenant_id,
        organization_id,
        contact_id,
        relationship_role,
        is_primary,
        is_current,
        client_roles,
        receives_picture_day_emails,
        receives_yearbook_emails,
        receives_billing_emails,
        receives_gallery_emails,
        receives_approval_emails,
        receives_onboarding_emails,
        receives_internal_escalations,
        relationship_notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,'general',$4,true,$5::client_contact_role[],$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
      ON CONFLICT (tenant_id, organization_id, contact_id)
        WHERE is_current
      DO UPDATE SET
        client_roles = (
          SELECT ARRAY(
            SELECT DISTINCT role_value
            FROM unnest(organization_contact_relationship.client_roles || EXCLUDED.client_roles) AS role_value
            ORDER BY role_value
          )::client_contact_role[]
        ),
        is_primary = organization_contact_relationship.is_primary OR EXCLUDED.is_primary,
        receives_picture_day_emails = organization_contact_relationship.receives_picture_day_emails OR EXCLUDED.receives_picture_day_emails,
        receives_yearbook_emails = organization_contact_relationship.receives_yearbook_emails OR EXCLUDED.receives_yearbook_emails,
        receives_billing_emails = organization_contact_relationship.receives_billing_emails OR EXCLUDED.receives_billing_emails,
        receives_gallery_emails = organization_contact_relationship.receives_gallery_emails OR EXCLUDED.receives_gallery_emails,
        receives_approval_emails = organization_contact_relationship.receives_approval_emails OR EXCLUDED.receives_approval_emails,
        receives_onboarding_emails = organization_contact_relationship.receives_onboarding_emails OR EXCLUDED.receives_onboarding_emails,
        receives_internal_escalations = organization_contact_relationship.receives_internal_escalations OR EXCLUDED.receives_internal_escalations,
        relationship_notes = COALESCE(EXCLUDED.relationship_notes, organization_contact_relationship.relationship_notes),
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
      RETURNING id::text
    `,
    [
      auth.tenantId,
      organizationId,
      input.contact_id,
      input.is_primary ?? roles.includes("primary_contact"),
      roles,
      input.receives_picture_day_emails ?? roles.includes("picture_day_contact"),
      input.receives_yearbook_emails ?? roles.includes("yearbook_contact"),
      input.receives_billing_emails ?? roles.includes("billing_contact"),
      input.receives_gallery_emails ?? false,
      input.receives_approval_emails ?? roles.includes("approval_contact"),
      input.receives_onboarding_emails ?? roles.includes("primary_contact"),
      input.receives_internal_escalations ?? roles.includes("emergency_day_of_contact"),
      optionalText(input.notes),
      auth.id
    ]
  );
  await emitClientEvent(client, auth.tenantId, "client.contact_relationship_upserted", "organization_contact_relationship", result.rows[0].id, {
    organization_id: organizationId,
    contact_id: input.contact_id,
    roles
  });
  return getClientAccountDetail(client, auth, organizationId);
}

export async function assignClientOwner(client: PoolClient, auth: AuthUser, input: ClientOwnerInput) {
  assertManageAccess(auth);
  const organizationId = optionalText(input.organization_id);
  const accountId = optionalText(input.account_id);
  if (!organizationId && !accountId) {
    throw new ApiError(400, "Assign an owner to an organization or account");
  }
  await assertOrganizationExists(client, auth.tenantId, (accountId ?? organizationId)!);
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO client_internal_owner (
        tenant_id,
        organization_id,
        account_id,
        owner_user_id,
        owner_type,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
      ON CONFLICT (
        tenant_id,
        COALESCE(account_id, organization_id),
        owner_type,
        owner_user_id
      )
      DO UPDATE SET
        notes = COALESCE(EXCLUDED.notes, client_internal_owner.notes),
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
      RETURNING id::text
    `,
    [auth.tenantId, organizationId, accountId, input.owner_user_id, input.owner_type, optionalText(input.notes), auth.id]
  );
  await emitClientEvent(client, auth.tenantId, "client.owner_assigned", "client_internal_owner", result.rows[0].id, {
    organization_id: organizationId,
    account_id: accountId,
    owner_user_id: input.owner_user_id,
    owner_type: input.owner_type
  });
  return accountId ? getClientAccountDetail(client, auth, accountId) : result.rows[0];
}

export async function upsertAccountService(client: PoolClient, auth: AuthUser, accountId: string, input: AccountServiceInput) {
  assertManageAccess(auth);
  await assertOrganizationExists(client, auth.tenantId, accountId, "account");
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO account_service (
        tenant_id,
        account_id,
        service_type,
        status,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$6)
      ON CONFLICT (tenant_id, account_id, service_type)
      DO UPDATE SET
        status = EXCLUDED.status,
        notes = COALESCE(EXCLUDED.notes, account_service.notes),
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
      RETURNING id::text
    `,
    [auth.tenantId, accountId, input.service_type, input.status ?? "active", optionalText(input.notes), auth.id]
  );
  await emitClientEvent(client, auth.tenantId, "client.account_service_upserted", "account_service", result.rows[0].id, {
    account_id: accountId,
    service_type: input.service_type,
    status: input.status ?? "active"
  });
  return getClientAccountDetail(client, auth, accountId);
}

export async function getAccountCommunicationReadiness(client: PoolClient, auth: AuthUser, accountId: string) {
  assertReadAccess(auth);
  await assertOrganizationExists(client, auth.tenantId, accountId, "account");
  return buildReadiness(client, auth.tenantId, accountId);
}

export async function createClientAccountNote(client: PoolClient, auth: AuthUser, accountId: string, input: { summary: string; contact_id?: string | null }) {
  assertManageAccess(auth);
  await assertOrganizationExists(client, auth.tenantId, accountId, "account");
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO directory_touchpoint (
        tenant_id,
        organization_id,
        contact_id,
        channel,
        category,
        subject,
        summary,
        outcome_state,
        owner_user_id,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,'note','relationship_maintenance','Client Command Center note',$4,'informational_only',$5,$5,$5)
      RETURNING id::text
    `,
    [auth.tenantId, accountId, optionalText(input.contact_id), input.summary.trim(), auth.id]
  );
  await emitClientEvent(client, auth.tenantId, "client.note_added", "directory_touchpoint", result.rows[0].id, {
    account_id: accountId,
    contact_id: optionalText(input.contact_id)
  });
  return getClientAccountDetail(client, auth, accountId);
}

export async function createClientAccountTask(client: PoolClient, auth: AuthUser, accountId: string, input: AccountTaskInput) {
  assertManageAccess(auth);
  await assertOrganizationExists(client, auth.tenantId, accountId, "account");
  if (input.department_type && !WORK_DEPARTMENT_TYPES.includes(input.department_type)) {
    throw new ApiError(400, "Invalid task department");
  }
  const task = await createWorkTask(
    client,
    auth,
    {
      title: input.title,
      description: input.description ?? null,
      task_type: input.communication_type ?? "client_follow_up",
      department_type: input.department_type ?? "schools",
      organization_id: accountId,
      related_job_id: input.related_job_id ?? null,
      assigned_to_user_id: input.assigned_to_user_id ?? null,
      priority: input.priority ?? "normal",
      due_at: input.due_at ?? null
    },
    { sourceSurface: "client_command_center" }
  );
  await client.query(
    `
      UPDATE work_task
      SET
        organization_id = $3,
        contact_id = $4,
        service_type = $5,
        communication_type = $6,
        source_type = 'client_command_center',
        source_id = $3
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, task.task.id, accountId, optionalText(input.contact_id), input.service_type ?? null, input.communication_type ?? null]
  );
  await client.query(
    `
      INSERT INTO client_context_link (
        tenant_id,
        account_id,
        contact_id,
        job_id,
        task_id,
        owner_user_id,
        service_type,
        communication_type,
        source_type,
        source_id,
        metadata,
        created_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'client_command_center',$2,$9,$10)
    `,
    [
      auth.tenantId,
      accountId,
      optionalText(input.contact_id),
      optionalText(input.related_job_id),
      task.task.id,
      optionalText(input.assigned_to_user_id),
      input.service_type ?? null,
      input.communication_type ?? null,
      JSON.stringify({ title: input.title }),
      auth.id
    ]
  );
  await emitClientEvent(client, auth.tenantId, "client.task_created", "work_task", task.task.id, {
    account_id: accountId,
    contact_id: optionalText(input.contact_id),
    service_type: input.service_type ?? null,
    communication_type: input.communication_type ?? null
  });
  return getClientAccountDetail(client, auth, accountId);
}

async function emitClientEvent(
  client: PoolClient,
  tenantId: string,
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown>
) {
  try {
    await client.query(
      `
        INSERT INTO app_event (
          tenant_id,
          event_type,
          aggregate_type,
          aggregate_id,
          payload,
          dedupe_key
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL
        DO NOTHING
      `,
      [
        tenantId,
        eventType,
        aggregateType,
        aggregateId,
        JSON.stringify({
          ...payload,
          provider_targets_supported: ["in_app", "email", "teams", "outlook"],
          microsoft_ready: true
        }),
        `${eventType}:${aggregateId}`
      ]
    );
  } catch (error) {
    logger.warn({ err: error, eventType, aggregateType, aggregateId }, "Client Command Center event emission failed");
  }
}
