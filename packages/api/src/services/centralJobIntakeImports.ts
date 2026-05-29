import type { PoolClient } from "pg";
import { canCreateOrEditShootDepartment, hasAuthorityTier } from "../authz/authority.js";
import type {
  CentralJobDeliveryType,
  CentralJobDepartment,
  CentralJobPriority,
  CentralJobProductionGroupingRule
} from "../domain/centralJobIntake/index.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  CentralJobCanonicalJobType,
  CentralJobDuplicateMatch,
  CentralJobDuplicateResult,
  CentralJobImportColumnMapping,
  CentralJobImportCommitMode,
  CentralJobImportCommitResult,
  CentralJobImportFieldKey,
  CentralJobImportFieldOption,
  CentralJobImportIssueSummary,
  CentralJobImportRowRecord,
  CentralJobImportRowReview,
  CentralJobImportRowSummary,
  CentralJobImportSessionRecord,
  CentralJobImportSessionResponse,
  CentralJobImportSessionSummary,
  CentralJobIntakeInput,
  CentralJobReadinessEvaluation
} from "../types/centralJobIntake.js";
import { createAuditLog } from "./audit.js";
import {
  buildJobAutoTitle,
  createDraftJob,
  evaluateJobReadiness,
  findPotentialDuplicates,
  normalizeIntakePayload,
  previewDraftDuplicates,
  publishDraftJob,
  validateJobDraft,
  validateJobPublish
} from "./centralJobIntake.js";

type CreateCentralJobImportSessionInput = {
  department: CentralJobDepartment;
  source_filename: string;
  csv_text: string;
};

type UpdateCentralJobImportMappingInput = {
  mapping: CentralJobImportColumnMapping;
};

type CommitCentralJobImportSessionInput = {
  mode?: CentralJobImportCommitMode;
  acknowledge_soft_duplicates?: boolean;
  override_hard_duplicates?: boolean;
  duplicate_override_note?: string | null;
};

type ImportSessionDbRow = {
  id: string;
  tenant_id: string;
  department: CentralJobDepartment | null;
  source_filename: string;
  source_type: string;
  status: string;
  mappings: unknown;
  stats: unknown;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type ImportRowDbRow = {
  id: string;
  tenant_id: string;
  import_session_id: string;
  row_number: number;
  raw_payload: unknown;
  normalized_payload: unknown;
  status: string;
  errors: unknown;
  linked_shoot_id: string | null;
  created_at: string;
  updated_at: string;
};

type ImportedCsv = {
  headers: string[];
  rows: string[][];
};

type OrganizationMatch = {
  id: string;
  display_name: string;
};

type LocationMatch = {
  id: string;
  name: string;
};

type ContactMatch = {
  id: string;
  full_name: string;
};

type UserMatch = {
  id: string;
  full_name: string;
  email: string | null;
};

type StoredImportRowErrors = {
  validation_errors: CentralJobImportIssueSummary[];
  validation_warnings: CentralJobImportIssueSummary[];
  duplicate_result: CentralJobDuplicateResult | null;
  readiness: CentralJobReadinessEvaluation | null;
  can_create_draft: boolean;
  can_publish: boolean;
  can_publish_with_acknowledgement: boolean;
  summary: CentralJobImportRowSummary;
};

type ValidationContext = {
  organizationCache: Map<string, OrganizationMatch[]>;
  locationCache: Map<string, LocationMatch[]>;
  contactCache: Map<string, ContactMatch[]>;
  userCache: Map<string, UserMatch[]>;
};

type PreparedImportRow = {
  rowId: string;
  rowNumber: number;
  rawPayload: Record<string, unknown>;
  normalizedInput: CentralJobIntakeInput | null;
  errors: StoredImportRowErrors;
};

const IMPORT_UPLOAD_STATUSES = new Set(["uploaded", "validated", "partial_commit", "committed"]);
const BATCH_PUBLISH_TIERS = ["super_admin", "leadership", "director_admin", "supervisor"] as const;
const IMPORT_SOURCE_TYPE = "csv";
const IMPORT_ROW_STATUS_UPLOADED = "uploaded";
const IMPORT_ROW_STATUS_DRAFT_READY = "draft_ready";
const IMPORT_ROW_STATUS_PUBLISH_READY = "publish_ready";
const IMPORT_ROW_STATUS_PUBLISH_ACK_REQUIRED = "publish_ack_required";
const IMPORT_ROW_STATUS_EXCEPTION = "exception";
const IMPORT_ROW_STATUS_DRAFT_CREATED = "draft_created";
const IMPORT_ROW_STATUS_PUBLISHED = "published";
const IMPORT_ROW_STATUS_DUPLICATE_BLOCKED = "duplicate_blocked";
const IMPORT_ROW_STATUS_COMMIT_FAILED = "commit_failed";
const IMPORT_SESSION_STATUS_UPLOADED = "uploaded";
const IMPORT_SESSION_STATUS_VALIDATED = "validated";
const IMPORT_SESSION_STATUS_PARTIAL = "partial_commit";
const IMPORT_SESSION_STATUS_COMMITTED = "committed";
const TRUE_VALUES = new Set(["1", "true", "yes", "y", "required"]);
const FALSE_VALUES = new Set(["0", "false", "no", "n", "not_required"]);

const CENTRAL_JOB_IMPORT_FIELDS: CentralJobImportFieldOption[] = [
  { key: "job_type", label: "Job Type", section: "Job Type and Routing", department: "shared", required_for_publish: true },
  { key: "job_title", label: "Job Title", section: "Job Type and Routing", department: "shared" },
  { key: "source_reference", label: "Source Reference", section: "Job Type and Routing", department: "shared" },
  { key: "organization_name", label: "Organization", section: "Organization / Location / Contacts", department: "shared", required_for_publish: true },
  { key: "location_name", label: "Location", section: "Organization / Location / Contacts", department: "shared" },
  { key: "primary_contact_name", label: "Primary Contact", section: "Organization / Location / Contacts", department: "shared" },
  { key: "job_owner", label: "Job Owner", section: "Job Type and Routing", department: "shared", required_for_publish: true },
  { key: "account_owner", label: "Account Owner", section: "Job Type and Routing", department: "shared" },
  { key: "start_date", label: "Start Date", section: "Schedule", department: "shared", required_for_publish: true },
  { key: "start_time", label: "Start Time", section: "Schedule", department: "shared" },
  { key: "end_time", label: "End Time", section: "Schedule", department: "shared" },
  { key: "timezone", label: "Timezone", section: "Schedule", department: "shared", required_for_publish: true },
  { key: "date_only", label: "Date Only", section: "Schedule", department: "shared" },
  { key: "is_multi_day", label: "Multi-Day", section: "Schedule", department: "shared" },
  { key: "delivery_due_date", label: "Delivery Due Date", section: "Production and Staffing", department: "shared" },
  { key: "production_required", label: "Production Required", section: "Production and Staffing", department: "shared", required_for_publish: true },
  { key: "staffing_required", label: "Staffing Required", section: "Production and Staffing", department: "shared", required_for_publish: true },
  { key: "staffing_estimate", label: "Staffing Estimate", section: "Production and Staffing", department: "shared" },
  { key: "priority", label: "Priority", section: "Job Type and Routing", department: "shared" },
  { key: "delivery_type", label: "Delivery Type", section: "Production and Staffing", department: "shared" },
  { key: "production_grouping_rule", label: "Production Grouping Rule", section: "Production and Staffing", department: "shared" },
  { key: "internal_notes", label: "Internal Notes", section: "Notes and Attachments", department: "shared" },
  { key: "client_notes", label: "Client Notes", section: "Notes and Attachments", department: "shared" },
  { key: "special_instructions", label: "Special Instructions", section: "Notes and Attachments", department: "shared" },
  { key: "school_job_type", label: "School Job Type", section: "Department Details", department: "schools", required_for_publish: true },
  { key: "school_type", label: "School Type", section: "Department Details", department: "schools" },
  { key: "roster_status", label: "Roster Status", section: "Department Details", department: "schools", required_for_publish: true },
  { key: "roster_due_date", label: "Roster Due Date", section: "Department Details", department: "schools" },
  { key: "id_required", label: "ID Required", section: "Department Details", department: "schools" },
  { key: "id_sort_method", label: "ID Sort Method", section: "Department Details", department: "schools" },
  { key: "yearbook_required", label: "Yearbook Required", section: "Department Details", department: "schools" },
  { key: "yearbook_due_date", label: "Yearbook Due Date", section: "Department Details", department: "schools" },
  { key: "background_requirements", label: "Background Requirements", section: "Department Details", department: "schools" },
  { key: "school_day_notes", label: "School Day Notes", section: "Department Details", department: "schools" },
  { key: "building_instructions", label: "Building Instructions", section: "Department Details", department: "schools" },
  { key: "photo_day_special_notes", label: "Photo Day Special Notes", section: "Department Details", department: "schools" },
  { key: "sports_job_type", label: "Sports Job Type", section: "Department Details", department: "sports", required_for_publish: true },
  { key: "sport_name", label: "Sport Name", section: "Department Details", department: "sports", required_for_publish: true },
  { key: "season", label: "Season", section: "Department Details", department: "sports" },
  { key: "level_or_age_group", label: "Level / Age Group", section: "Department Details", department: "sports" },
  { key: "specialty_products_required", label: "Specialty Products Required", section: "Department Details", department: "sports" },
  { key: "specialty_product_types", label: "Specialty Product Types", section: "Department Details", department: "sports" },
  { key: "gallery_required", label: "Gallery Required", section: "Department Details", department: "sports" },
  { key: "delivery_deadline_type", label: "Delivery Deadline Type", section: "Department Details", department: "sports" },
  { key: "uniform_notes", label: "Uniform Notes", section: "Department Details", department: "sports" },
  { key: "sponsor_notes", label: "Sponsor Notes", section: "Department Details", department: "sports" },
  { key: "event_notes", label: "Event Notes", section: "Department Details", department: "sports" },
  { key: "on_site_sales_notes", label: "On-Site Sales Notes", section: "Department Details", department: "sports" }
];

const IMPORT_FIELD_ALIASES: Record<CentralJobImportFieldKey, string[]> = {
  job_type: ["job_type", "job type", "type", "shoot type"],
  job_title: ["job_title", "job title", "title"],
  source_reference: ["source_reference", "source reference", "source id", "request id"],
  organization_name: ["organization", "organization_name", "organization name", "school", "school name", "account", "team", "league"],
  location_name: ["location", "location_name", "location name", "venue", "site"],
  primary_contact_name: ["primary_contact", "primary contact", "contact", "contact name", "coach", "coach contact"],
  job_owner: ["job_owner", "job owner", "owner", "assigned owner"],
  account_owner: ["account_owner", "account owner", "account manager"],
  start_date: ["start_date", "start date", "shoot_date", "shoot date", "date"],
  start_time: ["start_time", "start time", "time"],
  end_time: ["end_time", "end time"],
  timezone: ["timezone", "time zone", "tz"],
  date_only: ["date_only", "date only"],
  is_multi_day: ["is_multi_day", "multi_day", "multi day"],
  delivery_due_date: ["delivery_due_date", "delivery due date", "due date", "deadline"],
  production_required: ["production_required", "production required"],
  staffing_required: ["staffing_required", "staffing required"],
  staffing_estimate: ["staffing_estimate", "staffing estimate", "photographers needed", "photographer count", "staff count"],
  priority: ["priority"],
  delivery_type: ["delivery_type", "delivery type"],
  production_grouping_rule: ["production_grouping_rule", "production grouping rule"],
  internal_notes: ["internal_notes", "internal notes", "notes"],
  client_notes: ["client_notes", "client notes"],
  special_instructions: ["special_instructions", "special instructions", "instructions"],
  school_job_type: ["school_job_type", "school job type", "portrait type"],
  school_type: ["school_type", "school type"],
  roster_status: ["roster_status", "roster status"],
  roster_due_date: ["roster_due_date", "roster due date"],
  id_required: ["id_required", "id required"],
  id_sort_method: ["id_sort_method", "id sort method"],
  yearbook_required: ["yearbook_required", "yearbook required"],
  yearbook_due_date: ["yearbook_due_date", "yearbook due date"],
  background_requirements: ["background_requirements", "background requirements"],
  school_day_notes: ["school_day_notes", "school day notes", "day notes"],
  building_instructions: ["building_instructions", "building instructions"],
  photo_day_special_notes: ["photo_day_special_notes", "photo day special notes"],
  sports_job_type: ["sports_job_type", "sports job type", "event type"],
  sport_name: ["sport_name", "sport name", "sport"],
  season: ["season"],
  level_or_age_group: ["level_or_age_group", "level", "age group"],
  specialty_products_required: ["specialty_products_required", "specialty products required"],
  specialty_product_types: ["specialty_product_types", "specialty product types", "products"],
  gallery_required: ["gallery_required", "gallery required"],
  delivery_deadline_type: ["delivery_deadline_type", "delivery deadline type"],
  uniform_notes: ["uniform_notes", "uniform notes"],
  sponsor_notes: ["sponsor_notes", "sponsor notes"],
  event_notes: ["event_notes", "event notes"],
  on_site_sales_notes: ["on_site_sales_notes", "on site sales notes"]
};

const JOB_TYPE_ALIASES: Record<string, CentralJobCanonicalJobType> = {
  schools_underclass_portraits: "schools_underclass_portraits",
  underclass: "schools_underclass_portraits",
  portrait_day: "schools_underclass_portraits",
  portraits: "schools_underclass_portraits",
  fall_portraits: "schools_underclass_portraits",
  spring_portraits: "schools_underclass_portraits",
  schools_events: "schools_events",
  school_event: "schools_events",
  sports: "sports",
  media_day: "sports",
  team_photo_day: "sports",
  events: "events",
  studio: "studio",
  headshots: "headshots",
  commercial: "commercial",
  internal: "internal"
};

const PRIORITY_ALIASES: Record<string, CentralJobPriority> = {
  low: "low",
  normal: "normal",
  medium: "normal",
  high: "high",
  urgent: "urgent",
  critical: "urgent"
};

const DELIVERY_TYPE_ALIASES: Record<string, CentralJobDeliveryType> = {
  ship_to_home: "ship_to_home",
  ship: "ship_to_home",
  school_delivery: "school_delivery",
  hand_delivery: "school_delivery",
  digital_gallery: "digital_gallery",
  gallery: "digital_gallery",
  specialty_products: "specialty_products",
  products: "specialty_products",
  mixed: "mixed"
};

const PRODUCTION_GROUPING_ALIASES: Record<string, CentralJobProductionGroupingRule> = {
  one_per_job: "one_per_job",
  per_job: "one_per_job",
  one_per_day: "one_per_day",
  per_day: "one_per_day",
  one_per_delivery: "one_per_delivery",
  per_delivery: "one_per_delivery",
  one_per_gallery: "one_per_gallery",
  per_gallery: "one_per_gallery",
  manual: "manual"
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeSearchText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeHeaderName(value?: string | null) {
  return normalizeSearchText(value).replace(/\s+/g, "_");
}

function parseCsv(source: string): ImportedCsv {
  const rows: string[][] = [];
  let currentValue = "";
  let currentRow: string[] = [];
  let insideQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '"') {
      if (insideQuotes && next === '"') {
        currentValue += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }
    if (char === "," && !insideQuotes) {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      currentRow.push(currentValue);
      if (currentRow.some((value) => value.trim().length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentValue = "";
      continue;
    }
    currentValue += char;
  }

  if (currentValue.length || currentRow.length) {
    currentRow.push(currentValue);
    if (currentRow.some((value) => value.trim().length > 0)) {
      rows.push(currentRow);
    }
  }

  const [headers = [], ...values] = rows;
  return {
    headers: headers.map((header) => header.trim()),
    rows: values
  };
}

function resolveImportColumnMapping(headers: string[], department: CentralJobDepartment, explicit?: CentralJobImportColumnMapping | null) {
  const availableFields = CENTRAL_JOB_IMPORT_FIELDS.filter(
    (field) => field.department === "shared" || field.department === department
  );
  const normalizedHeaders = new Map(headers.map((header) => [normalizeHeaderName(header), header]));
  const mapping: CentralJobImportColumnMapping = {};
  for (const field of availableFields) {
    const explicitHeader = normalizeText(explicit?.[field.key] ?? null);
    if (explicitHeader && headers.includes(explicitHeader)) {
      mapping[field.key] = explicitHeader;
      continue;
    }
    const detectedHeader = IMPORT_FIELD_ALIASES[field.key]
      .map((alias) => normalizedHeaders.get(normalizeHeaderName(alias)))
      .find(Boolean);
    if (detectedHeader) {
      mapping[field.key] = detectedHeader;
    }
  }
  return mapping;
}

function assertImportDepartmentAccess(auth: AuthUser, department: CentralJobDepartment) {
  if (!canCreateOrEditShootDepartment(auth, department)) {
    throw new ApiError(403, "You do not have access to import jobs for that department.");
  }
}

function canBatchPublishImport(auth: Pick<AuthUser, "authorityTier">) {
  return hasAuthorityTier(auth, [...BATCH_PUBLISH_TIERS]);
}

function parseIntegerValue(value: string | null, field: string, issues: CentralJobImportIssueSummary[]) {
  if (!value) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || !Number.isInteger(numeric)) {
    issues.push({ field, code: "invalid_integer", message: "Use a non-negative whole number.", severity: "error" });
    return null;
  }
  return numeric;
}

function parseBooleanValue(value: string | null) {
  if (!value) {
    return null;
  }
  const normalized = normalizeHeaderName(value);
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }
  return null;
}

function parseDateValue(value: string | null) {
  if (!value) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[1].padStart(2, "0")}-${slashMatch[2].padStart(2, "0")}`;
  }
  return null;
}

function parseTimeValue(value: string | null) {
  if (!value) {
    return null;
  }
  const directMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (directMatch) {
    return `${directMatch[1].padStart(2, "0")}:${directMatch[2]}:${(directMatch[3] ?? "00").padStart(2, "0")}`;
  }
  const meridiemMatch = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(value.trim());
  if (meridiemMatch) {
    let hours = Number(meridiemMatch[1]) % 12;
    if (meridiemMatch[3].toLowerCase() === "pm") {
      hours += 12;
    }
    return `${hours.toString().padStart(2, "0")}:${meridiemMatch[2]}:00`;
  }
  return null;
}

function parseEnumValue<T extends string>(
  value: string | null,
  aliases: Record<string, T>,
  field: string,
  issues: CentralJobImportIssueSummary[]
) {
  if (!value) {
    return null;
  }
  const normalized = normalizeHeaderName(value);
  const matched = aliases[normalized];
  if (!matched) {
    issues.push({ field, code: "invalid_enum", message: `Value "${value}" is not recognized.`, severity: "error" });
    return null;
  }
  return matched;
}

function toObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function createValidationContext(): ValidationContext {
  return {
    organizationCache: new Map(),
    locationCache: new Map(),
    contactCache: new Map(),
    userCache: new Map()
  };
}

function addIssue(
  issues: CentralJobImportIssueSummary[],
  field: string,
  code: string,
  message: string,
  severity: "error" | "warning"
) {
  issues.push({ field, code, message, severity });
}

function getMappedValue(rawPayload: Record<string, unknown>, mapping: CentralJobImportColumnMapping, key: CentralJobImportFieldKey) {
  const header = mapping[key];
  if (!header) {
    return null;
  }
  return normalizeText(rawPayload[header] ?? null);
}

function deriveDepartmentSubtype(input: CentralJobIntakeInput) {
  if (input.department === "schools") {
    return input.school_detail?.school_job_type ?? null;
  }
  if (input.department === "sports") {
    return input.sports_detail?.sports_job_type ?? null;
  }
  return null;
}

async function resolveOrganizationMatches(
  client: PoolClient,
  tenantId: string,
  value: string,
  context: ValidationContext
) {
  const cacheKey = normalizeSearchText(value);
  const cached = context.organizationCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const { rows } = await client.query<OrganizationMatch>(
    `
      SELECT DISTINCT o.id::text, o.display_name
      FROM organization o
      LEFT JOIN organization_alias oa
        ON oa.tenant_id = o.tenant_id
       AND oa.organization_id = o.id
      WHERE o.tenant_id = $1
        AND (
          regexp_replace(lower(o.display_name), '[^a-z0-9]+', ' ', 'g') = $2
          OR regexp_replace(lower(o.canonical_name), '[^a-z0-9]+', ' ', 'g') = $2
          OR regexp_replace(lower(COALESCE(oa.alias, '')), '[^a-z0-9]+', ' ', 'g') = $2
        )
      ORDER BY o.display_name ASC
    `,
    [tenantId, cacheKey]
  );
  context.organizationCache.set(cacheKey, rows);
  return rows;
}

async function resolveLocationMatches(
  client: PoolClient,
  tenantId: string,
  organizationId: string | null,
  value: string,
  context: ValidationContext
) {
  const cacheKey = `${organizationId ?? "none"}:${normalizeSearchText(value)}`;
  const cached = context.locationCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const { rows } = await client.query<LocationMatch>(
    `
      SELECT sl.id::text, sl.name
      FROM shoot_location sl
      WHERE sl.tenant_id = $1
        AND ($2::uuid IS NULL OR sl.organization_id = $2::uuid)
        AND (
          regexp_replace(lower(sl.name), '[^a-z0-9]+', ' ', 'g') = $3
          OR regexp_replace(lower(COALESCE(sl.maps_label, '')), '[^a-z0-9]+', ' ', 'g') = $3
        )
      ORDER BY sl.name ASC
    `,
    [tenantId, organizationId, normalizeSearchText(value)]
  );
  context.locationCache.set(cacheKey, rows);
  return rows;
}

async function resolveContactMatches(
  client: PoolClient,
  tenantId: string,
  organizationId: string | null,
  value: string,
  context: ValidationContext
) {
  const cacheKey = `${organizationId ?? "none"}:${normalizeSearchText(value)}`;
  const cached = context.contactCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const { rows } = await client.query<ContactMatch>(
    `
      SELECT DISTINCT oc.id::text, oc.full_name
      FROM organization_contact oc
      WHERE oc.tenant_id = $1
        AND ($2::uuid IS NULL OR oc.organization_id = $2::uuid)
        AND (
          regexp_replace(lower(oc.full_name), '[^a-z0-9]+', ' ', 'g') = $3
          OR regexp_replace(lower(COALESCE(oc.email, '')), '[^a-z0-9]+', ' ', 'g') = $3
          OR regexp_replace(lower(COALESCE(oc.phone, '')), '[^a-z0-9]+', ' ', 'g') = $3
        )
      ORDER BY oc.full_name ASC
    `,
    [tenantId, organizationId, normalizeSearchText(value)]
  );
  context.contactCache.set(cacheKey, rows);
  return rows;
}

async function resolveUserMatches(client: PoolClient, tenantId: string, value: string, context: ValidationContext) {
  const cacheKey = normalizeSearchText(value);
  const cached = context.userCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const { rows } = await client.query<UserMatch>(
    `
      SELECT id::text, full_name, email
      FROM app_user
      WHERE tenant_id = $1
        AND (
          regexp_replace(lower(full_name), '[^a-z0-9]+', ' ', 'g') = $2
          OR regexp_replace(lower(COALESCE(email, '')), '[^a-z0-9]+', ' ', 'g') = $2
          OR id::text = $3
        )
      ORDER BY full_name ASC
    `,
    [tenantId, cacheKey, value.trim()]
  );
  context.userCache.set(cacheKey, rows);
  return rows;
}

function buildRowStatus(errors: StoredImportRowErrors) {
  if (!errors.can_create_draft) {
    return IMPORT_ROW_STATUS_EXCEPTION;
  }
  if (errors.can_publish) {
    return IMPORT_ROW_STATUS_PUBLISH_READY;
  }
  if (errors.can_publish_with_acknowledgement) {
    return IMPORT_ROW_STATUS_PUBLISH_ACK_REQUIRED;
  }
  if (errors.validation_errors.length || errors.duplicate_result?.hard_block) {
    return IMPORT_ROW_STATUS_EXCEPTION;
  }
  return IMPORT_ROW_STATUS_DRAFT_READY;
}

function mapImportSession(session: ImportSessionDbRow): CentralJobImportSessionRecord {
  return {
    id: session.id,
    tenant_id: session.tenant_id,
    department: session.department,
    source_filename: session.source_filename,
    source_type: session.source_type,
    status: session.status,
    mappings: toObject(session.mappings),
    stats: toObject(session.stats),
    created_by_user_id: session.created_by_user_id,
    created_at: session.created_at,
    updated_at: session.updated_at
  };
}

function mapImportRowRecord(row: ImportRowDbRow): CentralJobImportRowRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    import_session_id: row.import_session_id,
    row_number: row.row_number,
    raw_payload: toObject(row.raw_payload),
    normalized_payload: row.normalized_payload ? toObject(row.normalized_payload) : null,
    status: row.status,
    errors: row.errors ? toObject(row.errors) : null,
    linked_shoot_id: row.linked_shoot_id,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function buildDefaultImportSummary(): CentralJobImportSessionSummary {
  return {
    total_rows: 0,
    uploaded_rows: 0,
    exception_rows: 0,
    draft_ready_rows: 0,
    publish_ready_rows: 0,
    publish_ack_required_rows: 0,
    hard_duplicate_rows: 0,
    soft_duplicate_rows: 0,
    drafts_created: 0,
    jobs_published: 0,
    duplicates_blocked: 0,
    duplicates_overridden: 0
  };
}

function summarizeRows(rows: CentralJobImportRowReview[]): CentralJobImportSessionSummary {
  return rows.reduce<CentralJobImportSessionSummary>((summary, row) => {
    summary.total_rows += 1;
    if (row.status === IMPORT_ROW_STATUS_UPLOADED) {
      summary.uploaded_rows += 1;
    }
    if (row.status === IMPORT_ROW_STATUS_DRAFT_READY) {
      summary.draft_ready_rows += 1;
    }
    if (row.status === IMPORT_ROW_STATUS_PUBLISH_READY) {
      summary.publish_ready_rows += 1;
    }
    if (row.status === IMPORT_ROW_STATUS_PUBLISH_ACK_REQUIRED) {
      summary.publish_ack_required_rows += 1;
    }
    if (
      row.status === IMPORT_ROW_STATUS_EXCEPTION ||
      row.status === IMPORT_ROW_STATUS_DUPLICATE_BLOCKED ||
      row.status === IMPORT_ROW_STATUS_COMMIT_FAILED
    ) {
      summary.exception_rows += 1;
    }
    if (row.status === IMPORT_ROW_STATUS_DRAFT_CREATED) {
      summary.drafts_created += 1;
    }
    if (row.status === IMPORT_ROW_STATUS_PUBLISHED) {
      summary.jobs_published += 1;
    }
    if (row.status === IMPORT_ROW_STATUS_DUPLICATE_BLOCKED) {
      summary.duplicates_blocked += 1;
    }
    if (row.duplicate_result?.hard_block) {
      summary.hard_duplicate_rows += 1;
    }
    if (row.duplicate_result?.soft_warning) {
      summary.soft_duplicate_rows += 1;
    }
    return summary;
  }, buildDefaultImportSummary());
}

function mapImportRowReview(row: CentralJobImportRowRecord): CentralJobImportRowReview {
  const stored = row.errors ? (toObject(row.errors) as StoredImportRowErrors) : null;
  return {
    id: row.id,
    row_number: row.row_number,
    status: row.status,
    summary: stored?.summary ?? {
      row_number: row.row_number,
      title: `Row ${row.row_number}`,
      department: "schools",
      organization_name: null,
      location_name: null,
      primary_contact_name: null,
      start_date: null,
      delivery_due_date: null,
      job_type: null,
      department_subtype: null
    },
    normalized_input: row.normalized_payload as CentralJobIntakeInput | null,
    validation_errors: stored?.validation_errors ?? [],
    validation_warnings: stored?.validation_warnings ?? [],
    duplicate_result: stored?.duplicate_result ?? null,
    readiness: stored?.readiness ?? null,
    can_create_draft: stored?.can_create_draft ?? false,
    can_publish: stored?.can_publish ?? false,
    can_publish_with_acknowledgement: stored?.can_publish_with_acknowledgement ?? false,
    linked_job_id: row.linked_shoot_id
  };
}

async function loadImportSessionRecord(client: PoolClient, tenantId: string, sessionId: string) {
  const { rows } = await client.query<ImportSessionDbRow>(
    `
      SELECT
        id::text,
        tenant_id::text,
        department::text,
        source_filename,
        source_type,
        status,
        mappings,
        stats,
        created_by_user_id::text,
        created_at::text,
        updated_at::text
      FROM shoot_import_session
      WHERE tenant_id = $1
        AND id = $2::uuid
    `,
    [tenantId, sessionId]
  );
  return rows[0] ?? null;
}

async function loadImportRowRecords(client: PoolClient, tenantId: string, sessionId: string) {
  const { rows } = await client.query<ImportRowDbRow>(
    `
      SELECT
        id::text,
        tenant_id::text,
        import_session_id::text,
        row_number,
        raw_payload,
        normalized_payload,
        status,
        errors,
        linked_shoot_id::text,
        created_at::text,
        updated_at::text
      FROM shoot_import_row
      WHERE tenant_id = $1
        AND import_session_id = $2::uuid
      ORDER BY row_number ASC
    `,
    [tenantId, sessionId]
  );
  return rows;
}

async function buildImportSessionResponse(client: PoolClient, auth: AuthUser, sessionId: string): Promise<CentralJobImportSessionResponse> {
  const sessionDb = await loadImportSessionRecord(client, auth.tenantId, sessionId);
  if (!sessionDb) {
    throw new ApiError(404, "Import session not found.");
  }
  const session = mapImportSession(sessionDb);
  if (session.department) {
    assertImportDepartmentAccess(auth, session.department);
  }
  const rows = (await loadImportRowRecords(client, auth.tenantId, sessionId)).map(mapImportRowRecord).map(mapImportRowReview);
  const mappings = toObject(session.mappings);
  const headers = Array.isArray(mappings.headers) ? mappings.headers.map((entry) => String(entry)) : [];
  const mapping = toObject(mappings.column_mapping) as CentralJobImportColumnMapping;
  const summary = Object.keys(session.stats).length
    ? ({ ...buildDefaultImportSummary(), ...toObject(session.stats) } as CentralJobImportSessionSummary)
    : summarizeRows(rows);
  return {
    session,
    headers,
    mapping,
    supported_fields: CENTRAL_JOB_IMPORT_FIELDS.filter(
      (field) => field.department === "shared" || field.department === session.department
    ),
    rows,
    summary
  };
}

async function resolveLinkedValues(
  client: PoolClient,
  auth: AuthUser,
  rawPayload: Record<string, unknown>,
  mapping: CentralJobImportColumnMapping,
  context: ValidationContext,
  warnings: CentralJobImportIssueSummary[]
) {
  const organizationValue = getMappedValue(rawPayload, mapping, "organization_name");
  let organizationId: string | null = null;
  let organizationDisplayName: string | null = organizationValue;
  let unresolvedOrganizationName: string | null = organizationValue;
  if (organizationValue) {
    const organizations = await resolveOrganizationMatches(client, auth.tenantId, organizationValue, context);
    if (organizations.length === 1) {
      organizationId = organizations[0].id;
      organizationDisplayName = organizations[0].display_name;
      unresolvedOrganizationName = null;
    } else if (organizations.length > 1) {
      addIssue(warnings, "organization_name", "organization_ambiguous", "Organization match is ambiguous. Keep as a draft placeholder or fix the source row.", "warning");
    } else {
      addIssue(warnings, "organization_name", "organization_unresolved", "Organization was not matched to an existing record. Draft placeholder will be used.", "warning");
    }
  }

  const locationValue = getMappedValue(rawPayload, mapping, "location_name");
  let locationId: string | null = null;
  let locationDisplayName: string | null = locationValue;
  let unresolvedLocationName: string | null = locationValue;
  if (locationValue) {
    const locations = await resolveLocationMatches(client, auth.tenantId, organizationId, locationValue, context);
    if (locations.length === 1) {
      locationId = locations[0].id;
      locationDisplayName = locations[0].name;
      unresolvedLocationName = null;
    } else if (locations.length > 1) {
      addIssue(warnings, "location_name", "location_ambiguous", "Location match is ambiguous. Keep as a draft placeholder or fix the source row.", "warning");
    } else {
      addIssue(warnings, "location_name", "location_unresolved", "Location was not matched to an existing record.", "warning");
    }
  }

  const contactValue = getMappedValue(rawPayload, mapping, "primary_contact_name");
  let contactId: string | null = null;
  let contactDisplayName: string | null = contactValue;
  let unresolvedContactName: string | null = contactValue;
  if (contactValue) {
    const contacts = await resolveContactMatches(client, auth.tenantId, organizationId, contactValue, context);
    if (contacts.length === 1) {
      contactId = contacts[0].id;
      contactDisplayName = contacts[0].full_name;
      unresolvedContactName = null;
    } else if (contacts.length > 1) {
      addIssue(warnings, "primary_contact_name", "contact_ambiguous", "Primary contact match is ambiguous. Keep as a draft placeholder or fix the source row.", "warning");
    } else {
      addIssue(warnings, "primary_contact_name", "contact_unresolved", "Primary contact was not matched to an existing record.", "warning");
    }
  }

  const jobOwnerValue = getMappedValue(rawPayload, mapping, "job_owner");
  let jobOwnerUserId: string | null = null;
  if (jobOwnerValue) {
    const users = await resolveUserMatches(client, auth.tenantId, jobOwnerValue, context);
    if (users.length === 1) {
      jobOwnerUserId = users[0].id;
    } else if (users.length > 1) {
      addIssue(warnings, "job_owner", "job_owner_ambiguous", "Job owner matched multiple internal users.", "warning");
    } else {
      addIssue(warnings, "job_owner", "job_owner_unresolved", "Job owner was not matched to an internal user.", "warning");
    }
  }

  const accountOwnerValue = getMappedValue(rawPayload, mapping, "account_owner");
  let accountOwnerUserId: string | null = null;
  if (accountOwnerValue) {
    const users = await resolveUserMatches(client, auth.tenantId, accountOwnerValue, context);
    if (users.length === 1) {
      accountOwnerUserId = users[0].id;
    } else if (users.length > 1) {
      addIssue(warnings, "account_owner", "account_owner_ambiguous", "Account owner matched multiple internal users.", "warning");
    } else {
      addIssue(warnings, "account_owner", "account_owner_unresolved", "Account owner was not matched to an internal user.", "warning");
    }
  }

  return {
    organizationId,
    organizationDisplayName,
    unresolvedOrganizationName,
    locationId,
    locationDisplayName,
    unresolvedLocationName,
    contactId,
    contactDisplayName,
    unresolvedContactName,
    jobOwnerUserId,
    accountOwnerUserId
  };
}

async function prepareImportRow(
  client: PoolClient,
  auth: AuthUser,
  department: CentralJobDepartment,
  row: CentralJobImportRowRecord,
  mapping: CentralJobImportColumnMapping,
  context: ValidationContext
): Promise<PreparedImportRow> {
  const validationErrors: CentralJobImportIssueSummary[] = [];
  const validationWarnings: CentralJobImportIssueSummary[] = [];
  const rawPayload = row.raw_payload;
  const linked = await resolveLinkedValues(client, auth, rawPayload, mapping, context, validationWarnings);

  const startDateRaw = getMappedValue(rawPayload, mapping, "start_date");
  const startDate = parseDateValue(startDateRaw);
  if (startDateRaw && !startDate) {
    addIssue(validationErrors, "start_date", "invalid_date", "Start date must use YYYY-MM-DD or MM/DD/YYYY.", "error");
  }

  const deliveryDueDateRaw = getMappedValue(rawPayload, mapping, "delivery_due_date");
  const deliveryDueDate = parseDateValue(deliveryDueDateRaw);
  if (deliveryDueDateRaw && !deliveryDueDate) {
    addIssue(validationErrors, "delivery_due_date", "invalid_date", "Delivery due date must use YYYY-MM-DD or MM/DD/YYYY.", "error");
  }

  const startTimeRaw = getMappedValue(rawPayload, mapping, "start_time");
  const startTime = parseTimeValue(startTimeRaw);
  if (startTimeRaw && !startTime) {
    addIssue(validationErrors, "start_time", "invalid_time", "Start time must use HH:MM or H:MM AM/PM.", "error");
  }

  const endTimeRaw = getMappedValue(rawPayload, mapping, "end_time");
  const endTime = parseTimeValue(endTimeRaw);
  if (endTimeRaw && !endTime) {
    addIssue(validationErrors, "end_time", "invalid_time", "End time must use HH:MM or H:MM AM/PM.", "error");
  }

  const dateOnlyRaw = getMappedValue(rawPayload, mapping, "date_only");
  const dateOnly = parseBooleanValue(dateOnlyRaw);
  if (dateOnlyRaw && dateOnly == null) {
    addIssue(validationErrors, "date_only", "invalid_boolean", "Date Only must use yes/no, true/false, or 1/0.", "error");
  }

  const multiDayRaw = getMappedValue(rawPayload, mapping, "is_multi_day");
  const isMultiDay = parseBooleanValue(multiDayRaw);
  if (multiDayRaw && isMultiDay == null) {
    addIssue(validationErrors, "is_multi_day", "invalid_boolean", "Multi-Day must use yes/no, true/false, or 1/0.", "error");
  }
  if (isMultiDay) {
    addIssue(validationWarnings, "is_multi_day", "multi_day_not_split", "Bulk import currently stages multi-day jobs as draft-only unless day records are added later.", "warning");
  }

  const productionRequiredRaw = getMappedValue(rawPayload, mapping, "production_required");
  const productionRequired = parseBooleanValue(productionRequiredRaw);
  if (productionRequiredRaw && productionRequired == null) {
    addIssue(validationErrors, "production_required", "invalid_boolean", "Production Required must use yes/no, true/false, or 1/0.", "error");
  }

  const staffingRequiredRaw = getMappedValue(rawPayload, mapping, "staffing_required");
  const staffingRequired = parseBooleanValue(staffingRequiredRaw);
  if (staffingRequiredRaw && staffingRequired == null) {
    addIssue(validationErrors, "staffing_required", "invalid_boolean", "Staffing Required must use yes/no, true/false, or 1/0.", "error");
  }

  const idRequiredRaw = getMappedValue(rawPayload, mapping, "id_required");
  const idRequired = parseBooleanValue(idRequiredRaw);
  if (idRequiredRaw && idRequired == null) {
    addIssue(validationErrors, "school_detail.id_required", "invalid_boolean", "ID Required must use yes/no, true/false, or 1/0.", "error");
  }

  const yearbookRequiredRaw = getMappedValue(rawPayload, mapping, "yearbook_required");
  const yearbookRequired = parseBooleanValue(yearbookRequiredRaw);
  if (yearbookRequiredRaw && yearbookRequired == null) {
    addIssue(validationErrors, "school_detail.yearbook_required", "invalid_boolean", "Yearbook Required must use yes/no, true/false, or 1/0.", "error");
  }

  const specialtyRequiredRaw = getMappedValue(rawPayload, mapping, "specialty_products_required");
  const specialtyRequired = parseBooleanValue(specialtyRequiredRaw);
  if (specialtyRequiredRaw && specialtyRequired == null) {
    addIssue(validationErrors, "sports_detail.specialty_products_required", "invalid_boolean", "Specialty Products Required must use yes/no, true/false, or 1/0.", "error");
  }

  const galleryRequiredRaw = getMappedValue(rawPayload, mapping, "gallery_required");
  const galleryRequired = parseBooleanValue(galleryRequiredRaw);
  if (galleryRequiredRaw && galleryRequired == null) {
    addIssue(validationErrors, "sports_detail.gallery_required", "invalid_boolean", "Gallery Required must use yes/no, true/false, or 1/0.", "error");
  }

  const jobType = parseEnumValue(getMappedValue(rawPayload, mapping, "job_type"), JOB_TYPE_ALIASES, "job_type", validationErrors);
  const priority = parseEnumValue(getMappedValue(rawPayload, mapping, "priority"), PRIORITY_ALIASES, "priority", validationErrors);
  const deliveryType = parseEnumValue(getMappedValue(rawPayload, mapping, "delivery_type"), DELIVERY_TYPE_ALIASES, "delivery_type", validationErrors);
  const productionGroupingRule = parseEnumValue(
    getMappedValue(rawPayload, mapping, "production_grouping_rule"),
    PRODUCTION_GROUPING_ALIASES,
    "production_grouping_rule",
    validationErrors
  );

  const staffingEstimate = parseIntegerValue(getMappedValue(rawPayload, mapping, "staffing_estimate"), "staffing_estimate", validationErrors);
  const specialtyProductTypesValue = getMappedValue(rawPayload, mapping, "specialty_product_types");
  const specialtyProductTypes = specialtyProductTypesValue
    ? specialtyProductTypesValue.split(/[;,|]/).map((entry) => entry.trim()).filter(Boolean)
    : null;

  const input: CentralJobIntakeInput = {
    department,
    job_type: jobType,
    job_title: getMappedValue(rawPayload, mapping, "job_title"),
    request_source: "bulk_import",
    source_reference: getMappedValue(rawPayload, mapping, "source_reference"),
    organization_id: linked.organizationId,
    unresolved_organization_name: linked.unresolvedOrganizationName,
    location_id: linked.locationId,
    unresolved_location_name: linked.unresolvedLocationName,
    primary_contact_id: linked.contactId,
    unresolved_primary_contact_name: linked.unresolvedContactName,
    account_owner_user_id: linked.accountOwnerUserId,
    job_owner_user_id: linked.jobOwnerUserId,
    start_date: startDate,
    start_time: startTime,
    end_time: endTime,
    timezone: getMappedValue(rawPayload, mapping, "timezone") ?? "America/Chicago",
    date_only: dateOnly ?? false,
    is_multi_day: isMultiDay ?? false,
    delivery_due_date: deliveryDueDate,
    production_required: productionRequired ?? false,
    staffing_required: staffingRequired ?? false,
    staffing_estimate: staffingEstimate,
    priority: priority ?? null,
    delivery_type: deliveryType ?? null,
    production_grouping_rule: productionGroupingRule ?? null,
    internal_notes: getMappedValue(rawPayload, mapping, "internal_notes"),
    client_notes: getMappedValue(rawPayload, mapping, "client_notes"),
    special_instructions: getMappedValue(rawPayload, mapping, "special_instructions"),
    raw_source_text: JSON.stringify(rawPayload),
    school_detail:
      department === "schools"
        ? {
            school_job_type: getMappedValue(rawPayload, mapping, "school_job_type"),
            school_type: getMappedValue(rawPayload, mapping, "school_type"),
            roster_status: getMappedValue(rawPayload, mapping, "roster_status"),
            roster_due_date: parseDateValue(getMappedValue(rawPayload, mapping, "roster_due_date")),
            id_required: idRequired ?? false,
            id_sort_method: getMappedValue(rawPayload, mapping, "id_sort_method"),
            yearbook_required: yearbookRequired ?? false,
            yearbook_due_date: parseDateValue(getMappedValue(rawPayload, mapping, "yearbook_due_date")),
            background_requirements: getMappedValue(rawPayload, mapping, "background_requirements"),
            school_day_notes: getMappedValue(rawPayload, mapping, "school_day_notes"),
            building_instructions: getMappedValue(rawPayload, mapping, "building_instructions"),
            photo_day_special_notes: getMappedValue(rawPayload, mapping, "photo_day_special_notes")
          }
        : null,
    sports_detail:
      department === "sports"
        ? {
            sports_job_type: getMappedValue(rawPayload, mapping, "sports_job_type"),
            sport_name: getMappedValue(rawPayload, mapping, "sport_name"),
            season: getMappedValue(rawPayload, mapping, "season"),
            level_or_age_group: getMappedValue(rawPayload, mapping, "level_or_age_group"),
            specialty_products_required: specialtyRequired ?? false,
            specialty_product_types: specialtyProductTypes,
            gallery_required: galleryRequired ?? false,
            delivery_deadline_type: getMappedValue(rawPayload, mapping, "delivery_deadline_type"),
            uniform_notes: getMappedValue(rawPayload, mapping, "uniform_notes"),
            sponsor_notes: getMappedValue(rawPayload, mapping, "sponsor_notes"),
            event_notes: getMappedValue(rawPayload, mapping, "event_notes"),
            on_site_sales_notes: getMappedValue(rawPayload, mapping, "on_site_sales_notes")
          }
        : null
  };

  const normalized = normalizeIntakePayload(input);
  const draftValidation = validateJobDraft(normalized);
  const publishValidation = validateJobPublish({
    ...normalized,
    duplicate_check_completed_at: new Date().toISOString()
  });
  const readiness = evaluateJobReadiness({
    department: normalized.department,
    organization_id: normalized.organization_id,
    unresolved_organization_name: normalized.unresolved_organization_name,
    location_id: normalized.location_id,
    unresolved_location_name: normalized.unresolved_location_name,
    primary_contact_id: normalized.primary_contact_id,
    unresolved_primary_contact_name: normalized.unresolved_primary_contact_name,
    start_date: normalized.start_date,
    date_only: normalized.date_only,
    start_time: normalized.start_time,
    staffing_required: normalized.staffing_required,
    staffing_estimate: normalized.staffing_estimate,
    production_required: normalized.production_required,
    delivery_type: normalized.delivery_type,
    delivery_due_date: normalized.delivery_due_date,
    school_detail: normalized.school_detail,
    sports_detail: normalized.sports_detail
  });
  const duplicateResult = await findPotentialDuplicates(client, auth, normalized);

  const allValidationErrors = [
    ...validationErrors,
    ...draftValidation.errors.map((entry) => ({ field: entry.field, code: entry.code, message: entry.message, severity: entry.severity }))
  ];
  const allValidationWarnings = [
    ...validationWarnings,
    ...draftValidation.warnings.map((entry) => ({ field: entry.field, code: entry.code, message: entry.message, severity: entry.severity })),
    ...publishValidation.errors.map((entry) => ({ field: entry.field, code: entry.code, message: entry.message, severity: "warning" as const })),
    ...publishValidation.warnings.map((entry) => ({ field: entry.field, code: entry.code, message: entry.message, severity: entry.severity }))
  ];

  const summary: CentralJobImportRowSummary = {
    row_number: row.row_number,
    title: buildJobAutoTitle({
      department: normalized.department,
      job_type: normalized.job_type,
      job_title: normalized.job_title,
      start_date: normalized.start_date,
      delivery_due_date: normalized.delivery_due_date,
      unresolved_organization_name: normalized.unresolved_organization_name,
      organization_display_name: linked.organizationDisplayName,
      school_detail: normalized.school_detail,
      sports_detail: normalized.sports_detail
    }),
    department,
    organization_name: linked.organizationDisplayName ?? normalized.unresolved_organization_name,
    location_name: linked.locationDisplayName ?? normalized.unresolved_location_name,
    primary_contact_name: linked.contactDisplayName ?? normalized.unresolved_primary_contact_name,
    start_date: normalized.start_date,
    delivery_due_date: normalized.delivery_due_date,
    job_type: normalized.job_type,
    department_subtype: deriveDepartmentSubtype(input)
  };

  const canCreateDraft = draftValidation.valid && validationErrors.length === 0;
  const canPublishWithAcknowledgement = canCreateDraft && publishValidation.valid && !duplicateResult.hard_block;
  const canPublish = canPublishWithAcknowledgement && !duplicateResult.soft_warning;

  return {
    rowId: row.id,
    rowNumber: row.row_number,
    rawPayload,
    normalizedInput: input,
    errors: {
      validation_errors: allValidationErrors,
      validation_warnings: allValidationWarnings,
      duplicate_result: duplicateResult,
      readiness,
      can_create_draft: canCreateDraft,
      can_publish: canPublish,
      can_publish_with_acknowledgement: canPublishWithAcknowledgement,
      summary
    }
  };
}

function mergeDuplicateMatches(target: CentralJobDuplicateResult | null, additions: CentralJobDuplicateMatch[]) {
  if (!target || additions.length === 0) {
    return target;
  }
  const combined = [...target.matching_records, ...additions];
  const hardBlock = combined.some((match) => match.hard_block);
  const softWarning = !hardBlock && combined.some((match) => match.soft_warning);
  return {
    disposition: hardBlock ? "hard_block" : softWarning ? "soft_warning" : "clear",
    hard_block: hardBlock,
    soft_warning: softWarning,
    matching_records: combined,
    checked_at: target.checked_at
  } satisfies CentralJobDuplicateResult;
}

function buildImportDuplicateMatch(row: PreparedImportRow, kind: "hard" | "soft"): CentralJobDuplicateMatch {
  const summary = row.errors.summary;
  return {
    id: `session-row-${row.rowNumber}`,
    shoot_code: `IMPORT-ROW-${row.rowNumber}`,
    job_number: null,
    title: summary.title,
    match_source: "import_row",
    department: summary.department,
    job_type: (summary.job_type as CentralJobCanonicalJobType | null) ?? null,
    job_subtype: summary.department_subtype,
    organization_id: null,
    organization_name: summary.organization_name,
    location_id: null,
    location_name: summary.location_name,
    unresolved_location_name: summary.location_name,
    primary_contact_id: null,
    primary_contact_name: summary.primary_contact_name,
    start_date: summary.start_date,
    delivery_due_date: summary.delivery_due_date,
    record_state: "draft",
    job_status: "new",
    hard_block: kind === "hard",
    soft_warning: kind === "soft",
    matched_rules: [kind === "hard" ? "session_hard_duplicate" : "session_soft_duplicate"]
  };
}

function applyWithinSessionDuplicateResults(preparedRows: PreparedImportRow[]) {
  const rowsByHardKey = new Map<string, PreparedImportRow[]>();
  for (const row of preparedRows) {
    const payload = row.normalizedInput;
    if (!payload?.department || !payload.organization_id || !payload.start_date) {
      continue;
    }
    const subtype = deriveDepartmentSubtype(payload) ?? payload.job_type ?? "";
    const locationKey = payload.location_id ?? `placeholder:${normalizeSearchText(payload.unresolved_location_name)}`;
    const hardKey = [payload.department, payload.organization_id, payload.job_type ?? subtype, locationKey, payload.start_date].join("|");
    rowsByHardKey.set(hardKey, [...(rowsByHardKey.get(hardKey) ?? []), row]);
  }

  for (const rows of rowsByHardKey.values()) {
    if (rows.length < 2) {
      continue;
    }
    for (const row of rows) {
      const matches = rows.filter((entry) => entry.rowId !== row.rowId).map((entry) => buildImportDuplicateMatch(entry, "hard"));
      row.errors.duplicate_result = mergeDuplicateMatches(row.errors.duplicate_result, matches);
      row.errors.can_publish = false;
      row.errors.can_publish_with_acknowledgement = false;
    }
  }

  for (let leftIndex = 0; leftIndex < preparedRows.length; leftIndex += 1) {
    const left = preparedRows[leftIndex];
    const leftInput = left.normalizedInput;
    if (!leftInput?.organization_id) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < preparedRows.length; rightIndex += 1) {
      const right = preparedRows[rightIndex];
      const rightInput = right.normalizedInput;
      if (!rightInput?.organization_id || rightInput.organization_id !== leftInput.organization_id) {
        continue;
      }
      const sameJobType = (leftInput.job_type ?? deriveDepartmentSubtype(leftInput)) === (rightInput.job_type ?? deriveDepartmentSubtype(rightInput));
      const sameContact =
        Boolean(leftInput.primary_contact_id && rightInput.primary_contact_id && leftInput.primary_contact_id === rightInput.primary_contact_id);
      const startDiff =
        leftInput.start_date && rightInput.start_date
          ? Math.abs(new Date(`${leftInput.start_date}T00:00:00Z`).getTime() - new Date(`${rightInput.start_date}T00:00:00Z`).getTime()) / 86400000
          : null;
      const deliveryDiff =
        leftInput.delivery_due_date && rightInput.delivery_due_date
          ? Math.abs(
              new Date(`${leftInput.delivery_due_date}T00:00:00Z`).getTime() -
                new Date(`${rightInput.delivery_due_date}T00:00:00Z`).getTime()
            ) / 86400000
          : null;
      const softDuplicate =
        (sameJobType && startDiff != null && startDiff <= 7) || (sameContact && deliveryDiff != null && deliveryDiff <= 7);
      if (!softDuplicate) {
        continue;
      }
      if (!left.errors.duplicate_result?.hard_block) {
        left.errors.duplicate_result = mergeDuplicateMatches(left.errors.duplicate_result, [buildImportDuplicateMatch(right, "soft")]);
        left.errors.can_publish = false;
      }
      if (!right.errors.duplicate_result?.hard_block) {
        right.errors.duplicate_result = mergeDuplicateMatches(right.errors.duplicate_result, [buildImportDuplicateMatch(left, "soft")]);
        right.errors.can_publish = false;
      }
    }
  }
}

async function persistPreparedRows(
  client: PoolClient,
  tenantId: string,
  sessionId: string,
  preparedRows: PreparedImportRow[]
) {
  for (const row of preparedRows) {
    await client.query(
      `
        UPDATE shoot_import_row
        SET
          normalized_payload = $4::jsonb,
          status = $5,
          errors = $6::jsonb,
          updated_at = now()
        WHERE tenant_id = $1
          AND import_session_id = $2::uuid
          AND id = $3::uuid
      `,
      [
        tenantId,
        sessionId,
        row.rowId,
        JSON.stringify(row.normalizedInput),
        buildRowStatus(row.errors),
        JSON.stringify(row.errors)
      ]
    );
  }
}

async function persistImportSessionSummary(
  client: PoolClient,
  tenantId: string,
  sessionId: string,
  summary: CentralJobImportSessionSummary,
  status: string
) {
  await client.query(
    `
      UPDATE shoot_import_session
      SET
        status = $3,
        stats = $4::jsonb,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2::uuid
    `,
    [tenantId, sessionId, status, JSON.stringify(summary)]
  );
}

export async function createCentralJobImportSession(
  client: PoolClient,
  auth: AuthUser,
  input: CreateCentralJobImportSessionInput
): Promise<CentralJobImportSessionResponse> {
  assertImportDepartmentAccess(auth, input.department);
  const sourceFilename = normalizeText(input.source_filename);
  if (!sourceFilename?.toLowerCase().endsWith(".csv")) {
    throw new ApiError(400, "Bulk import currently accepts CSV files only.");
  }
  const csvText = input.csv_text?.trim();
  if (!csvText) {
    throw new ApiError(400, "Provide CSV content to start the import review.");
  }

  const parsed = parseCsv(csvText);
  if (!parsed.headers.length) {
    throw new ApiError(400, "The CSV header row could not be parsed.");
  }
  if (!parsed.rows.length) {
    throw new ApiError(400, "The CSV file does not contain any job rows.");
  }

  const mapping = resolveImportColumnMapping(parsed.headers, input.department, null);
  const sessionInsert = await client.query<{ id: string }>(
    `
      INSERT INTO shoot_import_session (
        tenant_id,
        department,
        source_filename,
        source_type,
        status,
        mappings,
        stats,
        created_by_user_id
      )
      VALUES ($1,$2::department_code,$3,$4,$5,$6::jsonb,$7::jsonb,$8::uuid)
      RETURNING id::text
    `,
    [
      auth.tenantId,
      input.department,
      sourceFilename,
      IMPORT_SOURCE_TYPE,
      IMPORT_SESSION_STATUS_UPLOADED,
      JSON.stringify({ headers: parsed.headers, column_mapping: mapping }),
      JSON.stringify({ total_rows: parsed.rows.length, uploaded_rows: parsed.rows.length }),
      auth.id
    ]
  );
  const sessionId = sessionInsert.rows[0].id;

  for (let index = 0; index < parsed.rows.length; index += 1) {
    const rowPayload = Object.fromEntries(parsed.headers.map((header, headerIndex) => [header, parsed.rows[index][headerIndex] ?? null]));
    await client.query(
      `
        INSERT INTO shoot_import_row (
          tenant_id,
          import_session_id,
          row_number,
          raw_payload,
          status
        )
        VALUES ($1,$2::uuid,$3,$4::jsonb,$5)
      `,
      [auth.tenantId, sessionId, index + 1, JSON.stringify(rowPayload), IMPORT_ROW_STATUS_UPLOADED]
    );
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "central_job_intake.import_session_created",
    entityType: "shoot_import_session",
    entityId: sessionId,
    metadata: {
      department: input.department,
      source_filename: sourceFilename,
      row_count: parsed.rows.length
    }
  });

  return buildImportSessionResponse(client, auth, sessionId);
}

export async function getCentralJobImportSession(client: PoolClient, auth: AuthUser, sessionId: string) {
  return buildImportSessionResponse(client, auth, sessionId);
}

export async function updateCentralJobImportMapping(
  client: PoolClient,
  auth: AuthUser,
  sessionId: string,
  input: UpdateCentralJobImportMappingInput
): Promise<CentralJobImportSessionResponse> {
  const sessionDb = await loadImportSessionRecord(client, auth.tenantId, sessionId);
  if (!sessionDb) {
    throw new ApiError(404, "Import session not found.");
  }
  const session = mapImportSession(sessionDb);
  if (!session.department) {
    throw new ApiError(400, "Import session is missing a department.");
  }
  assertImportDepartmentAccess(auth, session.department);
  const headers = Array.isArray(toObject(session.mappings).headers) ? (toObject(session.mappings).headers as string[]) : [];
  const mapping = resolveImportColumnMapping(headers, session.department, input.mapping);

  await client.query(
    `
      UPDATE shoot_import_session
      SET
        mappings = $4::jsonb,
        status = $5,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2::uuid
        AND department = $3::department_code
    `,
    [auth.tenantId, sessionId, session.department, JSON.stringify({ headers, column_mapping: mapping }), IMPORT_SESSION_STATUS_VALIDATED]
  );

  const rows = (await loadImportRowRecords(client, auth.tenantId, sessionId)).map(mapImportRowRecord);
  const context = createValidationContext();
  const preparedRows = await Promise.all(rows.map((row) => prepareImportRow(client, auth, session.department!, row, mapping, context)));
  applyWithinSessionDuplicateResults(preparedRows);
  await persistPreparedRows(client, auth.tenantId, sessionId, preparedRows);

  const nextRows = preparedRows.map((row) =>
    mapImportRowReview({
      id: row.rowId,
      tenant_id: auth.tenantId,
      import_session_id: sessionId,
      row_number: row.rowNumber,
      raw_payload: row.rawPayload,
      normalized_payload: row.normalizedInput,
      status: buildRowStatus(row.errors),
      errors: row.errors,
      linked_shoot_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  );
  const summary = summarizeRows(nextRows);
  await persistImportSessionSummary(client, auth.tenantId, sessionId, summary, IMPORT_SESSION_STATUS_VALIDATED);

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "central_job_intake.import_session_validated",
    entityType: "shoot_import_session",
    entityId: sessionId,
    metadata: { department: session.department, summary }
  });

  return buildImportSessionResponse(client, auth, sessionId);
}

async function updateImportRowCommitState(
  client: PoolClient,
  tenantId: string,
  sessionId: string,
  rowId: string,
  status: string,
  linkedJobId: string | null,
  errors: StoredImportRowErrors
) {
  await client.query(
    `
      UPDATE shoot_import_row
      SET
        status = $4,
        linked_shoot_id = $5::uuid,
        errors = $6::jsonb,
        updated_at = now()
      WHERE tenant_id = $1
        AND import_session_id = $2::uuid
        AND id = $3::uuid
    `,
    [tenantId, sessionId, rowId, status, linkedJobId, JSON.stringify(errors)]
  );
}

export async function commitCentralJobImportSession(
  client: PoolClient,
  auth: AuthUser,
  sessionId: string,
  input: CommitCentralJobImportSessionInput = {}
): Promise<CentralJobImportCommitResult> {
  const sessionDb = await loadImportSessionRecord(client, auth.tenantId, sessionId);
  if (!sessionDb) {
    throw new ApiError(404, "Import session not found.");
  }
  const session = mapImportSession(sessionDb);
  if (!session.department) {
    throw new ApiError(400, "Import session is missing a department.");
  }
  assertImportDepartmentAccess(auth, session.department);

  const mode = input.mode ?? "create_drafts_only";
  const allowPublish = mode !== "create_drafts_only";
  const canPublish = canBatchPublishImport(auth);
  if (allowPublish && !canPublish) {
    throw new ApiError(403, "Only leads and admins can batch publish imported jobs.");
  }

  const allowHardOverride = Boolean(input.override_hard_duplicates);
  const overrideNote = normalizeText(input.duplicate_override_note);
  if (allowHardOverride && !canPublish) {
    throw new ApiError(403, "Only leads and admins can override hard duplicates during import.");
  }
  if (allowHardOverride && !overrideNote) {
    throw new ApiError(400, "Add a duplicate override note before overriding hard duplicates.");
  }

  let importSession = await buildImportSessionResponse(client, auth, sessionId);
  if (importSession.session.status === IMPORT_SESSION_STATUS_UPLOADED) {
    importSession = await updateCentralJobImportMapping(client, auth, sessionId, { mapping: importSession.mapping });
  }

  const rowRecords = new Map(
    (await loadImportRowRecords(client, auth.tenantId, sessionId)).map((row) => [row.id, mapImportRowRecord(row)])
  );

  for (const row of importSession.rows) {
    if (row.status === IMPORT_ROW_STATUS_DRAFT_CREATED || row.status === IMPORT_ROW_STATUS_PUBLISHED) {
      continue;
    }
    const rowRecord = rowRecords.get(row.id);
    const storedErrors = rowRecord?.errors ? (toObject(rowRecord.errors) as StoredImportRowErrors) : null;
    if (!storedErrors) {
      continue;
    }

    if (!row.normalized_input || !row.can_create_draft) {
      await updateImportRowCommitState(
        client,
        auth.tenantId,
        sessionId,
        row.id,
        row.duplicate_result?.hard_block ? IMPORT_ROW_STATUS_DUPLICATE_BLOCKED : IMPORT_ROW_STATUS_EXCEPTION,
        null,
        storedErrors
      );
      continue;
    }

    if (mode === "create_drafts_only") {
      await client.query(`SAVEPOINT central_job_import_row_${row.row_number}`);
      try {
        const draft = await createDraftJob(client, auth, row.normalized_input);
        await updateImportRowCommitState(
          client,
          auth.tenantId,
          sessionId,
          row.id,
          IMPORT_ROW_STATUS_DRAFT_CREATED,
          draft.job.id,
          storedErrors
        );
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT central_job_import_row_${row.row_number}`);
        storedErrors.validation_errors = [
          ...storedErrors.validation_errors,
          {
            field: "form",
            code: "draft_commit_failed",
            message: error instanceof Error ? error.message : "Draft creation failed for this row.",
            severity: "error"
          }
        ];
        await updateImportRowCommitState(client, auth.tenantId, sessionId, row.id, IMPORT_ROW_STATUS_COMMIT_FAILED, null, storedErrors);
      }
      continue;
    }

    const allowSoftWarnings = mode === "publish_all_valid_rows_with_acknowledgement" && Boolean(input.acknowledge_soft_duplicates);
    const duplicateDisposition = row.duplicate_result?.disposition ?? "clear";
    const publishAllowedByPreview =
      row.can_publish ||
      (allowSoftWarnings && row.can_publish_with_acknowledgement && duplicateDisposition === "soft_warning") ||
      (allowHardOverride && row.can_publish_with_acknowledgement && duplicateDisposition === "hard_block");

    if (!publishAllowedByPreview) {
      await updateImportRowCommitState(
        client,
        auth.tenantId,
        sessionId,
        row.id,
        duplicateDisposition === "hard_block" ? IMPORT_ROW_STATUS_DUPLICATE_BLOCKED : IMPORT_ROW_STATUS_EXCEPTION,
        null,
        storedErrors
      );
      continue;
    }

    await client.query(`SAVEPOINT central_job_import_row_${row.row_number}`);
    try {
      const draft = await createDraftJob(client, auth, row.normalized_input);
      const duplicates = await previewDraftDuplicates(client, auth, draft.job.id);
      if (duplicates.hard_block && !allowHardOverride) {
        throw new ApiError(409, "Hard duplicate detected during publish.", { duplicate_result: duplicates });
      }
      if (duplicates.soft_warning && !allowSoftWarnings && !allowHardOverride) {
        throw new ApiError(409, "Soft duplicate acknowledgement required during publish.", { duplicate_result: duplicates });
      }
      const publishResult = await publishDraftJob(client, auth, draft.job.id, {
        duplicate_override_note: duplicates.hard_block ? overrideNote : null
      });
      await updateImportRowCommitState(
        client,
        auth.tenantId,
        sessionId,
        row.id,
        IMPORT_ROW_STATUS_PUBLISHED,
        publishResult.intake.job.id,
        storedErrors
      );
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT central_job_import_row_${row.row_number}`);
      const details =
        error instanceof ApiError && error.details && typeof error.details === "object"
          ? (error.details as { duplicate_result?: CentralJobDuplicateResult })
          : null;
      if (details?.duplicate_result?.hard_block) {
        await updateImportRowCommitState(
          client,
          auth.tenantId,
          sessionId,
          row.id,
          IMPORT_ROW_STATUS_DUPLICATE_BLOCKED,
          null,
          { ...storedErrors, duplicate_result: details.duplicate_result }
        );
      } else {
        storedErrors.validation_errors = [
          ...storedErrors.validation_errors,
          {
            field: "form",
            code: "publish_commit_failed",
            message: error instanceof Error ? error.message : "Publish failed for this row.",
            severity: "error"
          }
        ];
        await updateImportRowCommitState(client, auth.tenantId, sessionId, row.id, IMPORT_ROW_STATUS_COMMIT_FAILED, null, storedErrors);
      }
    }
  }

  const finalResponse = await buildImportSessionResponse(client, auth, sessionId);
  const summary = summarizeRows(finalResponse.rows);
  if (allowHardOverride) {
    summary.duplicates_overridden = finalResponse.rows.filter((row) => row.status === IMPORT_ROW_STATUS_PUBLISHED && row.duplicate_result?.hard_block).length;
  }
  const nextStatus =
    summary.jobs_published + summary.drafts_created === summary.total_rows
      ? IMPORT_SESSION_STATUS_COMMITTED
      : summary.jobs_published + summary.drafts_created > 0
        ? IMPORT_SESSION_STATUS_PARTIAL
        : IMPORT_SESSION_STATUS_VALIDATED;
  await persistImportSessionSummary(client, auth.tenantId, sessionId, summary, nextStatus);

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "central_job_intake.import_session_committed",
    entityType: "shoot_import_session",
    entityId: sessionId,
    metadata: {
      department: session.department,
      mode,
      summary,
      acknowledge_soft_duplicates: Boolean(input.acknowledge_soft_duplicates),
      override_hard_duplicates: allowHardOverride
    }
  });

  const refreshed = await buildImportSessionResponse(client, auth, sessionId);
  return {
    session: refreshed.session,
    summary,
    rows: refreshed.rows,
    commit_mode: mode
  };
}
