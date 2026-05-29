import type { JobDepartmentType, WorkDepartmentType } from "../../domain/jobTruth/index.js";
import type { ConciergeSearchIndexDocument, ConciergeSearchPermissionPayload } from "../../types/concierge.js";

type DirectoryDepartment = "schools" | "sports" | "headshots" | null;

function joinSearchText(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

function joinSubtitle(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" | ");
}

function mapDirectoryDepartment(accountType: string | null | undefined): DirectoryDepartment {
  if (!accountType) {
    return null;
  }
  if (accountType.startsWith("schools")) {
    return "schools";
  }
  if (accountType === "sports") {
    return "sports";
  }
  if (accountType === "headshots") {
    return "headshots";
  }
  return null;
}

function buildBaseDocument(
  tenantId: string,
  entityType: ConciergeSearchIndexDocument["entity_type"],
  entityId: string,
  permissionsPayload: ConciergeSearchPermissionPayload
): ConciergeSearchIndexDocument {
  return {
    tenant_id: tenantId,
    entity_type: entityType,
    entity_id: entityId,
    title: "",
    subtitle: null,
    body_search_text: null,
    status: null,
    department: null,
    org_id: null,
    org_name: null,
    owner_id: null,
    assignee_ids: [],
    related_ids: [],
    primary_date: null,
    risk_level: null,
    permissions_payload: permissionsPayload,
    deep_link: "#home",
    updated_at: new Date(0).toISOString(),
    activity_at: null,
    has_notes: false,
    has_alerts: false,
    has_staffing_gap: false
  };
}

export type OrganizationSearchSource = {
  tenant_id: string;
  id: string;
  display_name: string;
  canonical_name: string | null;
  notes: string | null;
  aliases: string[];
  account_type: string | null;
  active_status: string | null;
  updated_at: string;
};

export function mapOrganizationToSearchDocument(source: OrganizationSearchSource): ConciergeSearchIndexDocument {
  return {
    ...buildBaseDocument(source.tenant_id, "organization", source.id, { access_model: "directory" }),
    title: source.display_name,
    subtitle: source.account_type ? source.account_type.replace(/_/g, " ") : null,
    body_search_text: joinSearchText([source.canonical_name, source.notes, source.aliases.join(" ")]),
    status: source.active_status,
    department: mapDirectoryDepartment(source.account_type),
    org_id: source.id,
    org_name: source.display_name,
    related_ids: [source.id],
    risk_level: source.active_status && source.active_status !== "active" ? "warning" : null,
    deep_link: `#directory/organizations?organization=${source.id}&tab=profile`,
    updated_at: source.updated_at,
    activity_at: source.updated_at
  };
}

export type ContactSearchSource = {
  tenant_id: string;
  id: string;
  organization_id: string;
  organization_name: string;
  organization_account_type: string | null;
  full_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  role_category: string | null;
  operational_importance: string | null;
  contact_status: string | null;
  uncertainty_flag: boolean;
  primary_internal_owner_user_id: string | null;
  backup_internal_owner_user_id: string | null;
  updated_at: string;
};

export function mapContactToSearchDocument(source: ContactSearchSource): ConciergeSearchIndexDocument {
  return {
    ...buildBaseDocument(source.tenant_id, "contact", source.id, { access_model: "directory" }),
    title: source.full_name,
    subtitle: joinSubtitle([source.organization_name, source.title]),
    body_search_text: joinSearchText([source.email, source.phone, source.notes, source.role_category, source.operational_importance]),
    status: source.contact_status,
    department: mapDirectoryDepartment(source.organization_account_type),
    org_id: source.organization_id,
    org_name: source.organization_name,
    owner_id: source.primary_internal_owner_user_id,
    assignee_ids: [source.primary_internal_owner_user_id, source.backup_internal_owner_user_id].filter(
      (value): value is string => Boolean(value)
    ),
    related_ids: [source.organization_id],
    risk_level: Boolean(source.uncertainty_flag) ? "warning" : source.operational_importance,
    deep_link: `#directory/contacts?view=contacts&contact=${source.id}&tab=relationships`,
    updated_at: source.updated_at,
    activity_at: source.updated_at
  };
}

export type LocationSearchSource = {
  tenant_id: string;
  id: string;
  organization_id: string;
  organization_name: string;
  organization_account_type: string | null;
  name: string;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  maps_label: string | null;
  location_details: string | null;
  commentary: string | null;
  aliases: string[];
  active_status: string | null;
  updated_at: string;
};

export function mapLocationToSearchDocument(source: LocationSearchSource): ConciergeSearchIndexDocument {
  return {
    ...buildBaseDocument(source.tenant_id, "location", source.id, { access_model: "directory" }),
    title: source.name,
    subtitle: source.organization_name,
    body_search_text: joinSearchText([
      source.address_line_1,
      source.address_line_2,
      source.city,
      source.state,
      source.zip,
      source.maps_label,
      source.location_details,
      source.commentary,
      source.aliases.join(" ")
    ]),
    status: source.active_status,
    department: mapDirectoryDepartment(source.organization_account_type),
    org_id: source.organization_id,
    org_name: source.organization_name,
    related_ids: [source.organization_id, source.id],
    risk_level: source.active_status && source.active_status !== "active" ? "warning" : null,
    deep_link: `#directory/locations?view=locations&location=${source.id}&tab=relationships`,
    updated_at: source.updated_at,
    activity_at: source.updated_at
  };
}

export type ShootSearchSource = {
  tenant_id: string;
  id: string;
  title: string;
  shoot_code: string | null;
  organization_id: string | null;
  organization_name: string | null;
  location_id: string | null;
  location_name: string | null;
  primary_contact_id: string | null;
  special_instructions: string | null;
  access_notes: string | null;
  setup_notes: string | null;
  day_of_notes: string | null;
  internal_notes: string | null;
  status: string | null;
  department: string | null;
  readiness_owner_user_id: string | null;
  created_by: string | null;
  assignee_ids: string[];
  showtime: string | null;
  start_time: string | null;
  arrival_time: string | null;
  operations_priority: string | null;
  post_production_substage: string | null;
  updated_at: string;
};

export function mapShootToSearchDocument(source: ShootSearchSource): ConciergeSearchIndexDocument {
  const ownerId = source.readiness_owner_user_id ?? source.created_by ?? null;
  return {
    ...buildBaseDocument(source.tenant_id, "shoot", source.id, {
      access_model: "shoot",
      department: source.department
    }),
    title: source.title,
    subtitle: joinSubtitle([source.shoot_code, source.organization_name, source.location_name]),
    body_search_text: joinSearchText([
      source.title,
      source.shoot_code,
      source.organization_name,
      source.location_name,
      source.special_instructions,
      source.access_notes,
      source.setup_notes,
      source.day_of_notes,
      source.internal_notes
    ]),
    status: source.status,
    department: source.department as ConciergeSearchIndexDocument["department"],
    org_id: source.organization_id,
    org_name: source.organization_name,
    owner_id: ownerId,
    assignee_ids: source.assignee_ids,
    related_ids: [source.organization_id, source.location_id, source.primary_contact_id].filter((value): value is string => Boolean(value)),
    primary_date: source.showtime ?? source.start_time ?? source.arrival_time ?? null,
    risk_level: source.operations_priority ?? source.post_production_substage,
    deep_link: `#photography/shoots?shoot=${source.id}`,
    updated_at: source.updated_at,
    activity_at: source.start_time ?? source.updated_at
  };
}

export type ProductionItemSearchSource = {
  tenant_id: string;
  id: string;
  title: string;
  production_type: string | null;
  workflow_status: string | null;
  status: string | null;
  department_type: JobDepartmentType | null;
  job_id: string;
  job_number: string | null;
  job_title: string | null;
  organization_id: string | null;
  organization_name: string | null;
  account_owner_user_id: string | null;
  assignee_ids: string[];
  primary_location_id: string | null;
  primary_contact_id: string | null;
  release_due_at: string | null;
  due_at: string | null;
  health_state: string | null;
  blocked_reason: string | null;
  updated_at: string;
};

export function mapProductionItemToSearchDocument(source: ProductionItemSearchSource): ConciergeSearchIndexDocument {
  return {
    ...buildBaseDocument(source.tenant_id, "production_item", source.id, {
      access_model: "production_item",
      department: source.department_type
    }),
    title: source.title,
    subtitle: joinSubtitle([source.production_type, source.job_number, source.organization_name]),
    body_search_text: joinSearchText([
      source.title,
      source.production_type,
      source.job_title,
      source.job_number,
      source.organization_name,
      source.blocked_reason
    ]),
    status: source.workflow_status ?? source.status,
    department: source.department_type,
    org_id: source.organization_id,
    org_name: source.organization_name,
    owner_id: source.account_owner_user_id,
    assignee_ids: source.assignee_ids,
    related_ids: [source.job_id, source.organization_id, source.primary_location_id, source.primary_contact_id].filter(
      (value): value is string => Boolean(value)
    ),
    primary_date: source.release_due_at ?? source.due_at,
    risk_level: source.health_state,
    deep_link: `#production?item=${source.id}`,
    updated_at: source.updated_at,
    activity_at: source.updated_at
  };
}

export type TaskSearchSource = {
  tenant_id: string;
  id: string;
  title: string;
  task_number: string | null;
  description: string | null;
  task_type: string | null;
  blocked_reason: string | null;
  status: string | null;
  department_type: WorkDepartmentType | null;
  related_job_id: string | null;
  related_job_title: string | null;
  related_job_number: string | null;
  organization_id: string | null;
  organization_name: string | null;
  created_by_user_id: string | null;
  assigned_to_user_id: string | null;
  due_at: string | null;
  priority: string | null;
  updated_at: string;
};

export function mapTaskToSearchDocument(source: TaskSearchSource): ConciergeSearchIndexDocument {
  return {
    ...buildBaseDocument(source.tenant_id, "task", source.id, {
      access_model: "task",
      department: source.department_type,
      created_by_user_id: source.created_by_user_id
    }),
    title: source.title,
    subtitle: joinSubtitle([source.task_number, source.organization_name, source.related_job_title]),
    body_search_text: joinSearchText([
      source.title,
      source.description,
      source.task_type,
      source.blocked_reason,
      source.related_job_number,
      source.related_job_title,
      source.organization_name
    ]),
    status: source.status,
    department: source.department_type,
    org_id: source.organization_id,
    org_name: source.organization_name,
    owner_id: source.created_by_user_id,
    assignee_ids: source.assigned_to_user_id ? [source.assigned_to_user_id] : [],
    related_ids: [source.related_job_id, source.organization_id].filter((value): value is string => Boolean(value)),
    primary_date: source.due_at,
    risk_level: source.status === "blocked" ? "blocked" : source.priority === "urgent" || source.priority === "high" ? source.priority : null,
    deep_link: `#tasks/${source.id}`,
    updated_at: source.updated_at,
    activity_at: source.updated_at
  };
}

export type OperationalNoteSearchSource = {
  tenant_id: string;
  id: string;
  object_type: "shoot" | "shift" | "location" | "alert";
  visibility_scope: "object_viewers" | "assigned_staff_and_managers" | "managers_and_leadership" | "leadership_only";
  note_type: string;
  body: string;
  author_user_id: string | null;
  author_name: string | null;
  status: string | null;
  department: string | null;
  org_id: string | null;
  org_name: string | null;
  assigned_user_id: string | null;
  manager_user_id: string | null;
  assigned_user_ids: string[];
  lead_user_ids: string[];
  deep_link: string;
  updated_at: string;
};

export function mapOperationalNoteToSearchDocument(source: OperationalNoteSearchSource): ConciergeSearchIndexDocument {
  return {
    ...buildBaseDocument(source.tenant_id, "note", source.id, {
      access_model: "note",
      object_type: source.object_type,
      visibility_scope: source.visibility_scope,
      department: source.department,
      assigned_user_id: source.assigned_user_id,
      manager_user_id: source.manager_user_id,
      assigned_user_ids: source.assigned_user_ids,
      lead_user_ids: source.lead_user_ids
    }),
    title: `${source.note_type.replace(/_/g, " ")} note`,
    subtitle: joinSubtitle([source.org_name, source.department]),
    body_search_text: joinSearchText([source.body, source.author_name, source.note_type, source.org_name]),
    status: source.status,
    department: source.department as ConciergeSearchIndexDocument["department"],
    org_id: source.org_id,
    org_name: source.org_name,
    owner_id: source.author_user_id,
    assignee_ids: [...source.assigned_user_ids, source.author_user_id].filter((value): value is string => Boolean(value)),
    related_ids: [source.org_id].filter((value): value is string => Boolean(value)),
    primary_date: source.updated_at,
    deep_link: source.deep_link,
    updated_at: source.updated_at,
    activity_at: source.updated_at,
    has_notes: true,
    has_alerts: source.object_type === "alert"
  };
}

export type ChecklistCommentSearchSource = {
  tenant_id: string;
  id: string;
  visibility: "standard_internal" | "manager_only" | "leadership_only";
  body: string;
  author_user_id: string | null;
  department_type: JobDepartmentType | null;
  principal_user_ids: string[];
  org_id: string | null;
  org_name: string | null;
  deep_link: string;
  updated_at: string;
};

export function mapChecklistCommentToSearchDocument(source: ChecklistCommentSearchSource): ConciergeSearchIndexDocument {
  return {
    ...buildBaseDocument(source.tenant_id, "comment", source.id, {
      access_model: "comment",
      visibility: source.visibility,
      department: source.department_type,
      principal_user_ids: source.principal_user_ids
    }),
    title: "Checklist comment",
    subtitle: source.org_name,
    body_search_text: joinSearchText([source.body, source.visibility, source.org_name]),
    status: source.visibility,
    department: source.department_type,
    org_id: source.org_id,
    org_name: source.org_name,
    owner_id: source.author_user_id,
    assignee_ids: source.principal_user_ids,
    related_ids: [source.org_id].filter((value): value is string => Boolean(value)),
    primary_date: source.updated_at,
    risk_level: source.visibility === "leadership_only" ? "high" : null,
    deep_link: source.deep_link,
    updated_at: source.updated_at,
    activity_at: source.updated_at,
    has_notes: true
  };
}

export type StaffingAssignmentSearchSource = {
  tenant_id: string;
  id: string;
  department_type: JobDepartmentType | null;
  title: string;
  subtitle: string | null;
  body: string | null;
  assigned_user_id: string | null;
  owner_user_id: string | null;
  related_ids: string[];
  primary_date: string | null;
  status: string | null;
  org_id: string | null;
  org_name: string | null;
  deep_link: string;
  updated_at: string;
};

export function mapStaffingAssignmentToSearchDocument(source: StaffingAssignmentSearchSource): ConciergeSearchIndexDocument {
  return {
    ...buildBaseDocument(source.tenant_id, "staffing_assignment", source.id, {
      access_model: "staffing_assignment",
      department: source.department_type,
      assigned_user_id: source.assigned_user_id,
      owner_user_id: source.owner_user_id
    }),
    title: source.title,
    subtitle: source.subtitle,
    body_search_text: source.body,
    status: source.status,
    department: source.department_type,
    org_id: source.org_id,
    org_name: source.org_name,
    owner_id: source.owner_user_id,
    assignee_ids: [source.assigned_user_id].filter((value): value is string => Boolean(value)),
    related_ids: source.related_ids,
    primary_date: source.primary_date,
    risk_level: source.status === "absent" || source.status === "cancelled" ? "warning" : null,
    deep_link: source.deep_link,
    updated_at: source.updated_at,
    activity_at: source.updated_at,
    has_staffing_gap: source.status === "absent" || source.status === "cancelled"
  };
}

export type UrgentWatchSearchSource = {
  tenant_id: string;
  id: string;
  title: string;
  summary: string;
  status: string;
  scope_department: string | null;
  owner_user_id: string | null;
  due_at: string | null;
  severity: string | null;
  deep_link: string;
  updated_at: string;
};

export function mapUrgentWatchToSearchDocument(source: UrgentWatchSearchSource): ConciergeSearchIndexDocument {
  return {
    ...buildBaseDocument(source.tenant_id, "urgent_watch_alert", source.id, {
      access_model: "urgent_watch_alert",
      scope_department: source.scope_department,
      owner_user_id: source.owner_user_id
    }),
    title: source.title,
    subtitle: source.scope_department ? source.scope_department.replace(/_/g, " ") : null,
    body_search_text: source.summary,
    status: source.status,
    department: source.scope_department as ConciergeSearchIndexDocument["department"],
    owner_id: source.owner_user_id,
    assignee_ids: [source.owner_user_id].filter((value): value is string => Boolean(value)),
    primary_date: source.due_at,
    risk_level: source.severity,
    deep_link: source.deep_link,
    updated_at: source.updated_at,
    activity_at: source.updated_at,
    has_alerts: true,
    has_staffing_gap: source.title.toLowerCase().includes("staff") || source.summary.toLowerCase().includes("staff")
  };
}

export type PostShootEvaluationSearchSource = {
  tenant_id: string;
  id: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  department: string | null;
  photographer_user_id: string | null;
  manager_user_id: string | null;
  assigned_user_ids: string[];
  lead_user_ids: string[];
  org_id: string | null;
  org_name: string | null;
  status: string | null;
  primary_date: string | null;
  risk_level: string | null;
  deep_link: string;
  updated_at: string;
  staffing_gap: boolean;
};

export function mapPostShootEvaluationToSearchDocument(source: PostShootEvaluationSearchSource): ConciergeSearchIndexDocument {
  return {
    ...buildBaseDocument(source.tenant_id, "post_shoot_evaluation", source.id, {
      access_model: "post_shoot_evaluation",
      department: source.department,
      photographer_user_id: source.photographer_user_id,
      manager_user_id: source.manager_user_id,
      assigned_user_ids: source.assigned_user_ids,
      lead_user_ids: source.lead_user_ids
    }),
    title: source.title,
    subtitle: source.subtitle,
    body_search_text: source.body,
    status: source.status,
    department: source.department as ConciergeSearchIndexDocument["department"],
    org_id: source.org_id,
    org_name: source.org_name,
    owner_id: source.photographer_user_id,
    assignee_ids: [...source.assigned_user_ids, source.photographer_user_id].filter((value): value is string => Boolean(value)),
    related_ids: [source.org_id].filter((value): value is string => Boolean(value)),
    primary_date: source.primary_date,
    risk_level: source.risk_level,
    deep_link: source.deep_link,
    updated_at: source.updated_at,
    activity_at: source.updated_at,
    has_notes: true,
    has_staffing_gap: Boolean(source.staffing_gap)
  };
}
