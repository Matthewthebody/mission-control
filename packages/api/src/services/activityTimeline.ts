import type { PoolClient } from "pg";
import { getSchoolsHubAccessScope, hasAuthorityTier } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { JobDepartmentType } from "../domain/jobTruth/index.js";
import type { AuthUser } from "../types/auth.js";
import type {
  ActivityTimelineEntry,
  ActivityTimelineObjectType,
  ActivityTimelineResponse,
  ActivityTimelineSourceKind,
  ActivityTimelineTone
} from "../types/activityTimeline.js";
import { canSharedPolicy } from "./policy/index.js";
import { canViewPostShootEvaluations } from "./policy/operationalAuthorization.js";
import { assertShiftAccess } from "./shiftAccess.js";
import { canViewOperationalApprovals, getOperationalApprovalScope } from "./operationalApprovals.js";

type TimelineSubject = {
  objectType: ActivityTimelineObjectType;
  objectId: string;
  objectLabel: string | null;
  departmentType: JobDepartmentType | null;
  jobId: string | null;
  jobDayId: string | null;
  productionItemId: string | null;
  organizationId: string | null;
  locationId: string | null;
  contactId: string | null;
  linkedShootIds: string[];
  ownerUserIds: string[];
  assignedUserIds: string[];
  auditEntityType: string | null;
  approvalMode: "legacy" | "operational" | null;
  approvalMetadata: Record<string, unknown> | null;
};

type JobSubjectRow = {
  id: string;
  job_number: string | null;
  title: string;
  department_type: JobDepartmentType;
  organization_id: string | null;
  primary_location_id: string | null;
  primary_contact_id: string | null;
  account_owner_user_id: string | null;
  created_by_user_id: string | null;
};

type StaffingSubjectRow = {
  id: string;
  job_id: string;
  job_day_id: string | null;
  user_id: string;
  assignment_role: string;
  user_name: string | null;
  job_number: string | null;
  job_title: string;
  department_type: JobDepartmentType;
  organization_id: string | null;
  primary_location_id: string | null;
  primary_contact_id: string | null;
  account_owner_user_id: string | null;
  created_by_user_id: string | null;
};

type DirectorySubjectRow = {
  id: string;
  label: string;
  organization_id: string | null;
  location_id: string | null;
};

type ProductionSubjectRow = {
  id: string;
  title: string;
  job_id: string;
  job_day_id: string | null;
  department_type: JobDepartmentType;
  organization_id: string | null;
  location_id: string | null;
  primary_contact_id: string | null;
  account_owner_user_id: string | null;
  created_by_user_id: string | null;
};

type EvaluationSubjectRow = {
  id: string;
  shift_id: string | null;
  shoot_id: string | null;
  shoot_name: string | null;
  eval_status: string;
  organization_id: string | null;
  location_id: string | null;
};

type LegacyApprovalSubjectRow = {
  id: string;
  approval_type: string;
  job_id: string;
  job_day_id: string | null;
  production_item_id: string | null;
  summary: string | null;
  status: string;
};

type OperationalApprovalSubjectRow = {
  id: string;
  request_title: string;
  source_entity_type: string;
  source_entity_id: string;
  source_entity_label: string | null;
  requested_by_user_id: string;
  requester_department: string | null;
  current_approver_user_id: string | null;
  status: string;
};

type ActivityLogTimelineRow = {
  id: string;
  job_id: string | null;
  job_day_id: string | null;
  production_item_id: string | null;
  watch_flag_id: string | null;
  organization_id: string | null;
  location_id: string | null;
  contact_id: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  event_type: string;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  resource_type: string | null;
  resource_id: string | null;
  created_at: string;
};

type ActivityLogContextColumnSupport = {
  organizationId: boolean;
  locationId: boolean;
  contactId: boolean;
};

type AuditTimelineRow = {
  id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  reason_comment: string | null;
  created_at: string;
};

type LegacyApprovalTimelineRow = {
  id: string;
  job_id: string;
  job_day_id: string | null;
  production_item_id: string | null;
  approval_type: string;
  summary: string | null;
  status: string;
  requested_at: string | null;
  viewed_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  revision_requested_at: string | null;
  approver_user_id: string | null;
  approver_user_name: string | null;
};

type OperationalApprovalEventRow = {
  id: string;
  approval_request_id: string;
  request_type: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type NotificationTimelineRow = {
  id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  event_type: string;
  title: string;
  summary: string;
  recipient_count: number;
  delivery_channels: string[];
  created_at: string;
  metadata: Record<string, unknown> | null;
};

type TimelineQueryInput = {
  objectType: ActivityTimelineObjectType;
  objectId: string;
  limit?: number;
};

let activityLogContextColumnSupportPromise: Promise<ActivityLogContextColumnSupport> | null = null;

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

async function getActivityLogContextColumnSupport(client: PoolClient): Promise<ActivityLogContextColumnSupport> {
  if (!activityLogContextColumnSupportPromise) {
    activityLogContextColumnSupportPromise = client
      .query<{ column_name: string }>(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'activity_log_entries'
            AND column_name IN ('organization_id', 'location_id', 'contact_id')
        `
      )
      .then(({ rows }) => {
        const names = new Set(rows.map((row) => row.column_name));
        return {
          organizationId: names.has("organization_id"),
          locationId: names.has("location_id"),
          contactId: names.has("contact_id")
        };
      })
      .catch((error) => {
        activityLogContextColumnSupportPromise = null;
        throw error;
      });
  }
  return activityLogContextColumnSupportPromise;
}

function normalizeObjectTypeForNotes(value: ActivityTimelineObjectType) {
  switch (value) {
    case "staffing_assignment":
      return "job_staff_assignment";
    case "evaluation":
      return "post_shoot_evaluation";
    default:
      return value;
  }
}

function humanizeToken(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "Updated";
  }
  return normalized
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toTimelineTone(eventType: string, sourceKind: ActivityTimelineSourceKind, metadata: Record<string, unknown> | null): ActivityTimelineTone {
  const normalized = eventType.toLowerCase();
  const severity = normalizeText(typeof metadata?.severity === "string" ? metadata.severity : null)?.toLowerCase();
  if (
    severity === "critical" ||
    severity === "high" ||
    normalized.includes("failed") ||
    normalized.includes("rejected") ||
    normalized.includes("denied") ||
    normalized.includes("blocked")
  ) {
    return "danger";
  }
  if (
    normalized.includes("warning") ||
    normalized.includes("missing") ||
    normalized.includes("conflict") ||
    normalized.includes("overdue") ||
    normalized.includes("risk")
  ) {
    return "warning";
  }
  if (
    normalized.includes("approved") ||
    normalized.includes("granted") ||
    normalized.includes("completed") ||
    normalized.includes("submitted") ||
    normalized.includes("sent")
  ) {
    return "success";
  }
  if (sourceKind === "notification" || sourceKind === "sync") {
    return "info";
  }
  return "neutral";
}

function getSportsReadScope(auth: Pick<AuthUser, "authorityTier" | "department" | "jobFunctionProfiles" | "permissions" | "roles">) {
  const canManageSportsDepartment =
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    (auth.department === "sports" && hasAuthorityTier(auth, "supervisor")) ||
    auth.jobFunctionProfiles.some((profile) => ["sports_client_success", "director_of_sports_photography"].includes(profile)) ||
    auth.permissions.includes("sports_hub.manage");
  if (canManageSportsDepartment) {
    return "all" as const;
  }
  if (hasAuthorityTier(auth, "read_only_viewer")) {
    return "all" as const;
  }
  if (
    auth.jobFunctionProfiles.some((profile) =>
      ["sports_client_success", "customer_service_rep", "graphic_artist", "director_of_digital_production", "director_of_school_photography"].includes(profile)
    )
  ) {
    return "all" as const;
  }
  if (auth.permissions.includes("sports_hub.view")) {
    return "all" as const;
  }
  const ownOnly =
    !hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"]) &&
    !auth.jobFunctionProfiles.some((profile) => ["schools_client_success", "sports_client_success", "customer_service_rep"].includes(profile)) &&
    (auth.jobFunctionProfiles.some((profile) =>
      ["associate_photographer", "seasonal_photographer", "part_time_photographer", "senior_photographer", "graphic_artist"].includes(profile)
    ) || auth.roles.includes("office_employee"));
  return ownOnly ? ("own" as const) : null;
}

function getJobReadScope(auth: AuthUser, departmentType: JobDepartmentType | null) {
  if (!departmentType) {
    return null;
  }
  const grants = auth.policyGrants.filter(
    (grant) =>
      grant.permissionKey === "job.read" &&
      grant.effect === "allow" &&
      (grant.scopeType === "global" || (grant.scopeType === "department" && grant.scopeValue === departmentType) || grant.scopeType !== "department")
  );
  if (grants.length) {
    return grants.some((grant) => grant.scopeType === "global" || (grant.scopeType === "department" && grant.scopeValue === departmentType))
      ? ("all" as const)
      : ("own" as const);
  }
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    return "all" as const;
  }
  if (departmentType === "schools") {
    return getSchoolsHubAccessScope(auth);
  }
  if (departmentType === "sports") {
    return getSportsReadScope(auth);
  }
  return null;
}

function assertDirectoryAccess(auth: AuthUser) {
  if (auth.status !== "active") {
    throw new ApiError(403, "Forbidden");
  }
}

function assertJobLikeAccess(auth: AuthUser, subject: TimelineSubject) {
  if (!subject.departmentType || !subject.jobId) {
    throw new ApiError(403, "Forbidden");
  }
  const policyContext = {
    departmentType: subject.departmentType,
    organizationId: subject.organizationId,
    locationId: subject.locationId,
    ownerUserIds: subject.ownerUserIds,
    assignedUserIds: subject.assignedUserIds
  };
  if (canSharedPolicy(auth, "job.read", policyContext)) {
    return;
  }
  const scope = getJobReadScope(auth, subject.departmentType);
  if (scope === "all") {
    return;
  }
  const isOwn = [...subject.ownerUserIds, ...subject.assignedUserIds].filter(Boolean).includes(auth.id);
  if (scope === "own" && isOwn) {
    return;
  }
  throw new ApiError(403, "Forbidden");
}

function assertOperationalApprovalVisible(auth: AuthUser, subject: TimelineSubject) {
  if (!canViewOperationalApprovals(auth)) {
    throw new ApiError(403, "Forbidden");
  }
  const scope = getOperationalApprovalScope(auth);
  const requestedByUserId =
    subject.approvalMetadata && typeof subject.approvalMetadata.requested_by_user_id === "string"
      ? subject.approvalMetadata.requested_by_user_id
      : null;
  const requesterDepartment =
    subject.approvalMetadata && typeof subject.approvalMetadata.requester_department === "string"
      ? subject.approvalMetadata.requester_department
      : null;
  const currentApproverUserId =
    subject.approvalMetadata && typeof subject.approvalMetadata.current_approver_user_id === "string"
      ? subject.approvalMetadata.current_approver_user_id
      : null;
  if (scope === "all") {
    return;
  }
  if (requestedByUserId === auth.id || currentApproverUserId === auth.id) {
    return;
  }
  if (scope === "department" && requesterDepartment && requesterDepartment === auth.department) {
    return;
  }
  throw new ApiError(403, "Forbidden");
}

async function loadLinkedShootIdsForJob(client: PoolClient, tenantId: string, jobId: string) {
  const { rows } = await client.query<{ shoot_id: string }>(
    `
      SELECT DISTINCT shoot_id::text AS shoot_id
      FROM job_shoot_links
      WHERE tenant_id = $1
        AND job_id = $2
      UNION
      SELECT DISTINCT link.shoot_id::text AS shoot_id
      FROM production_item_shoot_links link
      JOIN production_items item
        ON item.tenant_id = link.tenant_id
       AND item.id = link.production_item_id
      WHERE link.tenant_id = $1
        AND item.job_id = $2
    `,
    [tenantId, jobId]
  );
  return rows.map((row) => row.shoot_id);
}

async function loadLinkedShootIdsForProductionItem(client: PoolClient, tenantId: string, productionItemId: string, jobId: string) {
  const { rows } = await client.query<{ shoot_id: string }>(
    `
      SELECT DISTINCT shoot_id::text AS shoot_id
      FROM production_item_shoot_links
      WHERE tenant_id = $1
        AND production_item_id = $2
      UNION
      SELECT DISTINCT shoot_id::text AS shoot_id
      FROM job_shoot_links
      WHERE tenant_id = $1
        AND job_id = $3
    `,
    [tenantId, productionItemId, jobId]
  );
  return rows.map((row) => row.shoot_id);
}

async function loadTimelineSubject(client: PoolClient, auth: AuthUser, input: TimelineQueryInput): Promise<TimelineSubject> {
  switch (input.objectType) {
    case "job": {
      const jobResult = await client.query<JobSubjectRow>(
        `
          SELECT
            id::text,
            job_number,
            title,
            department_type::text AS department_type,
            organization_id::text AS organization_id,
            primary_location_id::text AS primary_location_id,
            primary_contact_id::text AS primary_contact_id,
            account_owner_user_id::text AS account_owner_user_id,
            created_by_user_id::text AS created_by_user_id
          FROM jobs
          WHERE tenant_id = $1
            AND id = $2
          LIMIT 1
        `,
        [auth.tenantId, input.objectId]
      );
      const job = jobResult.rows[0];
      if (!job) {
        throw new ApiError(404, "Record not found");
      }
      const assignmentUsers = await client.query<{ user_id: string }>(
        `
          SELECT DISTINCT user_id::text AS user_id
          FROM job_staff_assignments
          WHERE tenant_id = $1
            AND job_id = $2
        `,
        [auth.tenantId, job.id]
      );
      const productionUsers = await client.query<{ user_id: string }>(
        `
          SELECT DISTINCT assigned_to_user_id::text AS user_id
          FROM production_items
          WHERE tenant_id = $1
            AND job_id = $2
            AND assigned_to_user_id IS NOT NULL
        `,
        [auth.tenantId, job.id]
      );
      const flagOwners = await client.query<{ user_id: string }>(
        `
          SELECT DISTINCT owner_user_id::text AS user_id
          FROM job_watch_flags
          WHERE tenant_id = $1
            AND job_id = $2
            AND owner_user_id IS NOT NULL
        `,
        [auth.tenantId, job.id]
      );
      const linkedShootIds = await loadLinkedShootIdsForJob(client, auth.tenantId, job.id);
      return {
        objectType: input.objectType,
        objectId: job.id,
        objectLabel: job.job_number ? `${job.job_number} · ${job.title}` : job.title,
        departmentType: job.department_type,
        jobId: job.id,
        jobDayId: null,
        productionItemId: null,
        organizationId: job.organization_id,
        locationId: job.primary_location_id,
        contactId: job.primary_contact_id,
        linkedShootIds,
        ownerUserIds: [job.account_owner_user_id, job.created_by_user_id].filter((value): value is string => Boolean(value)),
        assignedUserIds: [
          ...assignmentUsers.rows.map((row) => row.user_id),
          ...productionUsers.rows.map((row) => row.user_id),
          ...flagOwners.rows.map((row) => row.user_id)
        ],
        auditEntityType: null,
        approvalMode: null,
        approvalMetadata: null
      };
    }
    case "staffing_assignment": {
      const result = await client.query<StaffingSubjectRow>(
        `
          SELECT
            assignment.id::text,
            assignment.job_id::text,
            assignment.job_day_id::text AS job_day_id,
            assignment.user_id::text,
            assignment.assignment_role,
            assignee.full_name AS user_name,
            job.job_number,
            job.title AS job_title,
            job.department_type::text AS department_type,
            job.organization_id::text AS organization_id,
            job.primary_location_id::text AS primary_location_id,
            job.primary_contact_id::text AS primary_contact_id,
            job.account_owner_user_id::text AS account_owner_user_id,
            job.created_by_user_id::text AS created_by_user_id
          FROM job_staff_assignments assignment
          JOIN jobs job
            ON job.tenant_id = assignment.tenant_id
           AND job.id = assignment.job_id
          LEFT JOIN app_user assignee
            ON assignee.id = assignment.user_id
          WHERE assignment.tenant_id = $1
            AND assignment.id = $2
          LIMIT 1
        `,
        [auth.tenantId, input.objectId]
      );
      const assignment = result.rows[0];
      if (!assignment) {
        throw new ApiError(404, "Record not found");
      }
      return {
        objectType: input.objectType,
        objectId: assignment.id,
        objectLabel: `${assignment.user_name ?? "Assigned Staff"} · ${humanizeToken(assignment.assignment_role)}`,
        departmentType: assignment.department_type,
        jobId: assignment.job_id,
        jobDayId: assignment.job_day_id,
        productionItemId: null,
        organizationId: assignment.organization_id,
        locationId: assignment.primary_location_id,
        contactId: assignment.primary_contact_id,
        linkedShootIds: await loadLinkedShootIdsForJob(client, auth.tenantId, assignment.job_id),
        ownerUserIds: [assignment.account_owner_user_id, assignment.created_by_user_id].filter((value): value is string => Boolean(value)),
        assignedUserIds: [assignment.user_id],
        auditEntityType: null,
        approvalMode: null,
        approvalMetadata: null
      };
    }
    case "organization": {
      const result = await client.query<DirectorySubjectRow>(
        `
          SELECT id::text, canonical_name AS label, NULL::text AS organization_id, NULL::text AS location_id
          FROM organization
          WHERE tenant_id = $1
            AND id = $2
          LIMIT 1
        `,
        [auth.tenantId, input.objectId]
      );
      const organization = result.rows[0];
      if (!organization) {
        throw new ApiError(404, "Record not found");
      }
      return {
        objectType: input.objectType,
        objectId: organization.id,
        objectLabel: organization.label,
        departmentType: null,
        jobId: null,
        jobDayId: null,
        productionItemId: null,
        organizationId: organization.id,
        locationId: null,
        contactId: null,
        linkedShootIds: [],
        ownerUserIds: [],
        assignedUserIds: [],
        auditEntityType: "organization",
        approvalMode: null,
        approvalMetadata: null
      };
    }
    case "location": {
      const result = await client.query<DirectorySubjectRow>(
        `
          SELECT
            id::text,
            location_name AS label,
            organization_id::text AS organization_id,
            id::text AS location_id
          FROM shoot_location
          WHERE tenant_id = $1
            AND id = $2
          LIMIT 1
        `,
        [auth.tenantId, input.objectId]
      );
      const location = result.rows[0];
      if (!location) {
        throw new ApiError(404, "Record not found");
      }
      return {
        objectType: input.objectType,
        objectId: location.id,
        objectLabel: location.label,
        departmentType: null,
        jobId: null,
        jobDayId: null,
        productionItemId: null,
        organizationId: location.organization_id,
        locationId: location.location_id,
        contactId: null,
        linkedShootIds: [],
        ownerUserIds: [],
        assignedUserIds: [],
        auditEntityType: "shoot_location",
        approvalMode: null,
        approvalMetadata: null
      };
    }
    case "contact": {
      const result = await client.query<DirectorySubjectRow>(
        `
          SELECT
            id::text,
            full_name AS label,
            canonical_organization_id::text AS organization_id,
            primary_location_id::text AS location_id
          FROM organization_contact
          WHERE tenant_id = $1
            AND id = $2
          LIMIT 1
        `,
        [auth.tenantId, input.objectId]
      );
      const contact = result.rows[0];
      if (!contact) {
        throw new ApiError(404, "Record not found");
      }
      return {
        objectType: input.objectType,
        objectId: contact.id,
        objectLabel: contact.label,
        departmentType: null,
        jobId: null,
        jobDayId: null,
        productionItemId: null,
        organizationId: contact.organization_id,
        locationId: contact.location_id,
        contactId: contact.id,
        linkedShootIds: [],
        ownerUserIds: [],
        assignedUserIds: [],
        auditEntityType: "organization_contact",
        approvalMode: null,
        approvalMetadata: null
      };
    }
    case "production_item": {
      const result = await client.query<ProductionSubjectRow>(
        `
          SELECT
            item.id::text,
            item.title,
            item.job_id::text,
            item.job_day_id::text AS job_day_id,
            item.department_type::text AS department_type,
            item.organization_id::text AS organization_id,
            item.location_id::text AS location_id,
            item.primary_contact_id::text AS primary_contact_id,
            COALESCE(item.account_owner_user_id::text, job.account_owner_user_id::text) AS account_owner_user_id,
            job.created_by_user_id::text AS created_by_user_id
          FROM production_items item
          JOIN jobs job
            ON job.tenant_id = item.tenant_id
           AND job.id = item.job_id
          WHERE item.tenant_id = $1
            AND item.id = $2
          LIMIT 1
        `,
        [auth.tenantId, input.objectId]
      );
      const productionItem = result.rows[0];
      if (!productionItem) {
        throw new ApiError(404, "Record not found");
      }
      const assignments = await client.query<{ user_id: string }>(
        `
          SELECT DISTINCT assigned_to_user_id::text AS user_id
          FROM production_items
          WHERE tenant_id = $1
            AND id = $2
            AND assigned_to_user_id IS NOT NULL
        `,
        [auth.tenantId, productionItem.id]
      );
      return {
        objectType: input.objectType,
        objectId: productionItem.id,
        objectLabel: productionItem.title,
        departmentType: productionItem.department_type,
        jobId: productionItem.job_id,
        jobDayId: productionItem.job_day_id,
        productionItemId: productionItem.id,
        organizationId: productionItem.organization_id,
        locationId: productionItem.location_id,
        contactId: productionItem.primary_contact_id,
        linkedShootIds: await loadLinkedShootIdsForProductionItem(client, auth.tenantId, productionItem.id, productionItem.job_id),
        ownerUserIds: [productionItem.account_owner_user_id, productionItem.created_by_user_id].filter((value): value is string => Boolean(value)),
        assignedUserIds: assignments.rows.map((row) => row.user_id),
        auditEntityType: null,
        approvalMode: null,
        approvalMetadata: null
      };
    }
    default:
      break;
  }

  if (input.objectType === "evaluation") {
    const result = await client.query<EvaluationSubjectRow>(
      `
        SELECT
          id::text,
          shift_id::text AS shift_id,
          shoot_id::text AS shoot_id,
          shoot_name,
          eval_status::text,
          organization_id::text AS organization_id,
          location_id::text AS location_id
        FROM post_shoot_evaluation
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [auth.tenantId, input.objectId]
    );
    const evaluation = result.rows[0];
    if (!evaluation) {
      throw new ApiError(404, "Record not found");
    }
    return {
      objectType: input.objectType,
      objectId: evaluation.id,
      objectLabel: evaluation.shoot_name ? `Post-Shoot Eval · ${evaluation.shoot_name}` : "Post-Shoot Evaluation",
      departmentType: null,
      jobId: null,
      jobDayId: null,
      productionItemId: null,
      organizationId: evaluation.organization_id,
      locationId: evaluation.location_id,
      contactId: null,
      linkedShootIds: evaluation.shoot_id ? [evaluation.shoot_id] : [],
      ownerUserIds: [],
      assignedUserIds: [],
      auditEntityType: "post_shoot_evaluation",
      approvalMode: null,
      approvalMetadata: { shift_id: evaluation.shift_id, eval_status: evaluation.eval_status }
    };
  }

  if (input.objectType === "approval") {
    const operationalResult = await client.query<OperationalApprovalSubjectRow>(
      `
        SELECT
          req.id::text,
          req.request_title,
          req.source_entity_type,
          req.source_entity_id::text,
          req.source_entity_label,
          req.requested_by_user_id::text,
          req.requester_department,
          pending.approver_user_id::text AS current_approver_user_id,
          req.status::text
        FROM operational_approval_request req
        LEFT JOIN LATERAL (
          SELECT approver_user_id
          FROM operational_approval_step
          WHERE tenant_id = req.tenant_id
            AND approval_request_id = req.id
            AND status = 'pending'
          ORDER BY step_order ASC
          LIMIT 1
        ) pending ON true
        WHERE req.tenant_id = $1
          AND req.id = $2
        LIMIT 1
      `,
      [auth.tenantId, input.objectId]
    );
    const operational = operationalResult.rows[0];
    if (operational) {
      return {
        objectType: input.objectType,
        objectId: operational.id,
        objectLabel: operational.request_title,
        departmentType: null,
        jobId: null,
        jobDayId: null,
        productionItemId: null,
        organizationId: null,
        locationId: null,
        contactId: null,
        linkedShootIds: [],
        ownerUserIds: [],
        assignedUserIds: [],
        auditEntityType: "operational_approval_request",
        approvalMode: "operational",
        approvalMetadata: {
          source_entity_type: operational.source_entity_type,
          source_entity_id: operational.source_entity_id,
          source_entity_label: operational.source_entity_label,
          requested_by_user_id: operational.requested_by_user_id,
          requester_department: operational.requester_department,
          current_approver_user_id: operational.current_approver_user_id,
          status: operational.status
        }
      };
    }

    const legacyResult = await client.query<LegacyApprovalSubjectRow>(
      `
        SELECT
          id::text,
          approval_type,
          job_id::text,
          job_day_id::text AS job_day_id,
          production_item_id::text AS production_item_id,
          summary,
          status::text
        FROM approval_requests
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [auth.tenantId, input.objectId]
    );
    const legacy = legacyResult.rows[0];
    if (!legacy) {
      throw new ApiError(404, "Record not found");
    }
    const jobSubject = await loadTimelineSubject(client, auth, { objectType: "job", objectId: legacy.job_id, limit: input.limit });
    return {
      ...jobSubject,
      objectType: "approval",
      objectId: legacy.id,
      objectLabel: legacy.summary ?? `Approval · ${humanizeToken(legacy.approval_type)}`,
      jobDayId: legacy.job_day_id,
      productionItemId: legacy.production_item_id,
      approvalMode: "legacy",
      approvalMetadata: {
        job_id: legacy.job_id,
        job_day_id: legacy.job_day_id,
        production_item_id: legacy.production_item_id,
        approval_type: legacy.approval_type,
        summary: legacy.summary,
        status: legacy.status
      }
    };
  }

  throw new ApiError(400, "Unsupported activity object type");
}

async function assertSubjectAccess(client: PoolClient, auth: AuthUser, subject: TimelineSubject) {
  switch (subject.objectType) {
    case "job":
    case "staffing_assignment":
    case "production_item":
      assertJobLikeAccess(auth, subject);
      return;
    case "organization":
    case "location":
    case "contact":
      assertDirectoryAccess(auth);
      return;
    case "evaluation": {
      const shiftId =
        subject.approvalMetadata && typeof subject.approvalMetadata.shift_id === "string" ? subject.approvalMetadata.shift_id : null;
      if (shiftId) {
        await assertShiftAccess(client, auth, shiftId);
        return;
      }
      if (!canViewPostShootEvaluations(auth)) {
        throw new ApiError(403, "Forbidden");
      }
      return;
    }
    case "approval":
      if (subject.approvalMode === "operational") {
        assertOperationalApprovalVisible(auth, subject);
        return;
      }
      assertJobLikeAccess(auth, subject);
      return;
    default:
      throw new ApiError(403, "Forbidden");
  }
}

function buildEntry(
  tenantId: string,
  subject: TimelineSubject,
  input: {
    id: string;
    sourceKind: ActivityTimelineSourceKind;
    eventType: string;
    actionLabel?: string | null;
    summary: string;
    detail?: string | null;
    actorUserId?: string | null;
    actorName?: string | null;
    createdAt: string;
    relatedObjectType?: string | null;
    relatedObjectId?: string | null;
    metadata?: Record<string, unknown> | null;
    jobId?: string | null;
    jobDayId?: string | null;
    productionItemId?: string | null;
    watchFlagId?: string | null;
    organizationId?: string | null;
    locationId?: string | null;
    contactId?: string | null;
  }
): ActivityTimelineEntry {
  return {
    id: input.id,
    tenant_id: tenantId,
    object_type: subject.objectType,
    object_id: subject.objectId,
    related_object_type: input.relatedObjectType ?? null,
    related_object_id: input.relatedObjectId ?? null,
    source_kind: input.sourceKind,
    event_type: input.eventType,
    action_label: input.actionLabel ?? humanizeToken(input.eventType),
    summary: input.summary,
    detail: input.detail ?? null,
    actor_user_id: input.actorUserId ?? null,
    actor_name: input.actorName ?? null,
    created_at: input.createdAt,
    tone: toTimelineTone(input.eventType, input.sourceKind, input.metadata ?? null),
    metadata: input.metadata ?? {},
    job_id: input.jobId ?? subject.jobId,
    job_day_id: input.jobDayId ?? subject.jobDayId,
    production_item_id: input.productionItemId ?? subject.productionItemId,
    watch_flag_id: input.watchFlagId ?? null,
    organization_id: input.organizationId ?? subject.organizationId,
    location_id: input.locationId ?? subject.locationId,
    contact_id: input.contactId ?? subject.contactId
  };
}

function buildActionLabelFromAudit(action: string) {
  switch (action) {
    case "note.created":
      return "Note added";
    case "shoot.post_shoot_evaluation.submitted":
      return "Evaluation submitted";
    case "shoot.post_shoot_evaluation.draft_saved":
      return "Evaluation draft saved";
    case "operational_approval.requested":
      return "Approval requested";
    case "operational_approval.approved":
    case "operational_approval.step_approved":
      return "Approval granted";
    case "operational_approval.rejected":
      return "Approval denied";
    case "operational_approval.executed":
      return "Approved action executed";
    case "integration.sync.processing":
      return "Sync started";
    case "integration.sync.succeeded":
      return "Sync completed";
    case "integration.sync.failed":
      return "Sync failed";
    case "integration.sync.conflict":
      return "Sync conflict";
    default:
      return humanizeToken(action);
  }
}

function buildAuditSummary(row: AuditTimelineRow) {
  const actionLabel = buildActionLabelFromAudit(row.action);
  if (row.action === "note.created") {
    const noteType = typeof row.metadata?.note_type === "string" ? humanizeToken(row.metadata.note_type) : "Operational";
    return {
      actionLabel,
      summary: `${noteType} note added.`,
      detail: typeof row.metadata?.visibility_scope === "string" ? `Visibility: ${humanizeToken(row.metadata.visibility_scope)}` : null
    };
  }
  if (row.action.startsWith("shoot.post_shoot_evaluation.")) {
    const outcome = typeof row.metadata?.overall_outcome === "string" ? humanizeToken(row.metadata.overall_outcome) : null;
    return {
      actionLabel,
      summary: outcome ? `Post-shoot evaluation ${outcome.toLowerCase()}.` : "Post-shoot evaluation updated.",
      detail: typeof row.metadata?.eval_status === "string" ? `Status: ${humanizeToken(row.metadata.eval_status)}` : null
    };
  }
  if (row.action.startsWith("integration.sync.")) {
    const provider = typeof row.metadata?.provider === "string" ? humanizeToken(row.metadata.provider) : "Integration";
    const operationType = typeof row.metadata?.operation_type === "string" ? humanizeToken(row.metadata.operation_type) : "Sync";
    return {
      actionLabel,
      summary: `${provider} ${operationType.toLowerCase()}.`,
      detail: typeof row.metadata?.error_message === "string" ? row.metadata.error_message : row.reason_comment
    };
  }
  return {
    actionLabel,
    summary: row.reason_comment ?? actionLabel,
    detail: null
  };
}

function isHighSignalAuditAction(action: string) {
  const normalized = action.toLowerCase();
  if (
    normalized.includes(".view") ||
    normalized.includes(".read") ||
    normalized.includes(".list") ||
    normalized.includes(".search")
  ) {
    return false;
  }
  return true;
}

async function loadActivityLogEntries(client: PoolClient, auth: AuthUser, subject: TimelineSubject, limit: number) {
  if (!subject.jobId && !subject.productionItemId && subject.objectType !== "staffing_assignment") {
    return [];
  }

  const contextColumns = await getActivityLogContextColumnSupport(client);
  const organizationSelect = contextColumns.organizationId
    ? "entry.organization_id::text AS organization_id"
    : "NULL::text AS organization_id";
  const locationSelect = contextColumns.locationId ? "entry.location_id::text AS location_id" : "NULL::text AS location_id";
  const contactSelect = contextColumns.contactId ? "entry.contact_id::text AS contact_id" : "NULL::text AS contact_id";

  if (subject.objectType === "staffing_assignment") {
    const result = await client.query<ActivityLogTimelineRow>(
      `
        SELECT
          entry.id::text,
          entry.job_id::text AS job_id,
          entry.job_day_id::text AS job_day_id,
          entry.production_item_id::text AS production_item_id,
          entry.watch_flag_id::text AS watch_flag_id,
          ${organizationSelect},
          ${locationSelect},
          ${contactSelect},
          entry.actor_user_id::text AS actor_user_id,
          actor.full_name AS actor_name,
          entry.event_type,
          entry.summary,
          COALESCE(entry.metadata_json, entry.metadata, '{}'::jsonb) AS metadata,
          entry.resource_type,
          entry.resource_id::text AS resource_id,
          entry.created_at::text
        FROM activity_log_entries entry
        LEFT JOIN app_user actor
          ON actor.id = entry.actor_user_id
        WHERE entry.tenant_id = $1
          AND entry.job_id = $2
          AND COALESCE(entry.metadata_json, entry.metadata, '{}'::jsonb)->>'assignment_id' = $3
        ORDER BY entry.created_at DESC
        LIMIT $4
      `,
      [auth.tenantId, subject.jobId, subject.objectId, limit]
    );
    return result.rows.map((row) =>
      buildEntry(auth.tenantId, subject, {
        id: `activity_log:${row.id}`,
        sourceKind: "activity_log",
        eventType: row.event_type,
        summary: row.summary ?? humanizeToken(row.event_type),
        actorUserId: row.actor_user_id,
        actorName: row.actor_name,
        createdAt: row.created_at,
        relatedObjectType: row.resource_type,
        relatedObjectId: row.resource_id,
        metadata: row.metadata,
        jobId: row.job_id,
        jobDayId: row.job_day_id,
        productionItemId: row.production_item_id,
        watchFlagId: row.watch_flag_id,
        organizationId: row.organization_id,
        locationId: row.location_id,
        contactId: row.contact_id
      })
    );
  }

  const conditions: string[] = [];
  const params: unknown[] = [auth.tenantId];
  let index = 2;

  if (subject.objectType === "job" && subject.jobId) {
    conditions.push(`entry.job_id = $${index}`);
    params.push(subject.jobId);
    index += 1;
  }
  if (subject.objectType === "production_item" && subject.productionItemId) {
    conditions.push(`entry.production_item_id = $${index}`);
    params.push(subject.productionItemId);
    index += 1;
  }
  if (!conditions.length) {
    return [];
  }

  params.push(limit);
  const result = await client.query<ActivityLogTimelineRow>(
    `
        SELECT
          entry.id::text,
          entry.job_id::text AS job_id,
          entry.job_day_id::text AS job_day_id,
          entry.production_item_id::text AS production_item_id,
          entry.watch_flag_id::text AS watch_flag_id,
          ${organizationSelect},
          ${locationSelect},
          ${contactSelect},
          entry.actor_user_id::text AS actor_user_id,
          actor.full_name AS actor_name,
        entry.event_type,
        entry.summary,
        COALESCE(entry.metadata_json, entry.metadata, '{}'::jsonb) AS metadata,
        entry.resource_type,
        entry.resource_id::text AS resource_id,
        entry.created_at::text
      FROM activity_log_entries entry
      LEFT JOIN app_user actor
        ON actor.id = entry.actor_user_id
      WHERE entry.tenant_id = $1
        AND (${conditions.join(" OR ")})
      ORDER BY entry.created_at DESC
      LIMIT $${index}
    `,
    params
  );

  return result.rows.map((row) =>
    buildEntry(auth.tenantId, subject, {
      id: `activity_log:${row.id}`,
      sourceKind: "activity_log",
      eventType: row.event_type,
      summary: row.summary ?? humanizeToken(row.event_type),
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      createdAt: row.created_at,
      relatedObjectType: row.resource_type,
      relatedObjectId: row.resource_id,
      metadata: row.metadata,
      jobId: row.job_id,
      jobDayId: row.job_day_id,
      productionItemId: row.production_item_id,
      watchFlagId: row.watch_flag_id,
      organizationId: row.organization_id,
      locationId: row.location_id,
      contactId: row.contact_id
    })
  );
}

async function loadDirectAuditEntries(client: PoolClient, auth: AuthUser, subject: TimelineSubject, limit: number) {
  if (!subject.auditEntityType || subject.objectType === "evaluation" || (subject.objectType === "approval" && subject.approvalMode === "operational")) {
    return [];
  }
  const result = await client.query<AuditTimelineRow>(
    `
      SELECT
        audit.id::text,
        audit.actor_user_id::text AS actor_user_id,
        actor.full_name AS actor_name,
        audit.action,
        audit.entity_type,
        audit.entity_id::text AS entity_id,
        audit.metadata,
        audit.reason_comment,
        audit.created_at::text
      FROM audit_log audit
      LEFT JOIN app_user actor
        ON actor.id = audit.actor_user_id
      WHERE audit.tenant_id = $1
        AND audit.entity_type = $2
        AND audit.entity_id = $3
      ORDER BY audit.created_at DESC
      LIMIT $4
    `,
    [auth.tenantId, subject.auditEntityType, subject.objectId, limit]
  );
  return result.rows
    .filter((row) => isHighSignalAuditAction(row.action))
    .map((row) => {
      const summary = buildAuditSummary(row);
      return buildEntry(auth.tenantId, subject, {
        id: `audit:${row.id}`,
        sourceKind: "audit_log",
        eventType: row.action,
        actionLabel: summary.actionLabel,
        summary: summary.summary,
        detail: summary.detail,
        actorUserId: row.actor_user_id,
        actorName: row.actor_name,
        createdAt: row.created_at,
        relatedObjectType: row.entity_type,
        relatedObjectId: row.entity_id,
        metadata: row.metadata
      });
    });
}

async function loadNoteAuditEntries(client: PoolClient, auth: AuthUser, subject: TimelineSubject, limit: number) {
  const params: unknown[] = [auth.tenantId];
  const conditions: string[] = [];
  let index = 2;

  if (subject.objectType === "job" && subject.linkedShootIds.length) {
    conditions.push(`((audit.metadata->>'object_type') = 'shoot' AND (audit.metadata->>'object_id') = ANY($${index}::text[]))`);
    params.push(subject.linkedShootIds);
    index += 1;
  }

  if (["organization", "location", "contact", "evaluation"].includes(subject.objectType)) {
    conditions.push(`((audit.metadata->>'object_type') = $${index} AND (audit.metadata->>'object_id') = $${index + 1})`);
    params.push(normalizeObjectTypeForNotes(subject.objectType));
    params.push(subject.objectId);
    index += 2;
  }

  if (!conditions.length) {
    return [];
  }

  params.push(limit);
  const result = await client.query<AuditTimelineRow>(
    `
      SELECT
        audit.id::text,
        audit.actor_user_id::text AS actor_user_id,
        actor.full_name AS actor_name,
        audit.action,
        audit.entity_type,
        audit.entity_id::text AS entity_id,
        audit.metadata,
        audit.reason_comment,
        audit.created_at::text
      FROM audit_log audit
      LEFT JOIN app_user actor
        ON actor.id = audit.actor_user_id
      WHERE audit.tenant_id = $1
        AND audit.action = 'note.created'
        AND (${conditions.join(" OR ")})
      ORDER BY audit.created_at DESC
      LIMIT $${index}
    `,
    params
  );

  return result.rows.map((row) => {
    const summary = buildAuditSummary(row);
    return buildEntry(auth.tenantId, subject, {
      id: `note_audit:${row.id}`,
      sourceKind: "audit_log",
      eventType: row.action,
      actionLabel: summary.actionLabel,
      summary: summary.summary,
      detail: summary.detail,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      createdAt: row.created_at,
      relatedObjectType: row.entity_type,
      relatedObjectId: row.entity_id,
      metadata: row.metadata
    });
  });
}

async function loadEvaluationAuditEntries(client: PoolClient, auth: AuthUser, subject: TimelineSubject, limit: number) {
  const params: unknown[] = [auth.tenantId];
  const conditions: string[] = [];
  let index = 2;

  if (subject.objectType === "job" && subject.linkedShootIds.length) {
    conditions.push(`((audit.metadata->>'shoot_id') = ANY($${index}::text[]))`);
    params.push(subject.linkedShootIds);
    index += 1;
  }

  if (subject.objectType === "evaluation") {
    conditions.push(`(audit.entity_type = 'post_shoot_evaluation' AND audit.entity_id = $${index})`);
    params.push(subject.objectId);
    index += 1;
  }

  if (!conditions.length) {
    return [];
  }

  params.push(limit);
  const result = await client.query<AuditTimelineRow>(
    `
      SELECT
        audit.id::text,
        audit.actor_user_id::text AS actor_user_id,
        actor.full_name AS actor_name,
        audit.action,
        audit.entity_type,
        audit.entity_id::text AS entity_id,
        audit.metadata,
        audit.reason_comment,
        audit.created_at::text
      FROM audit_log audit
      LEFT JOIN app_user actor
        ON actor.id = audit.actor_user_id
      WHERE audit.tenant_id = $1
        AND audit.action IN (
          'shoot.post_shoot_evaluation.submitted',
          'shoot.post_shoot_evaluation.draft_saved',
          'shoot.post_shoot_evaluation.reviewed',
          'shoot.post_shoot_evaluation.closed'
        )
        AND (${conditions.join(" OR ")})
      ORDER BY audit.created_at DESC
      LIMIT $${index}
    `,
    params
  );

  return result.rows
    .filter((row) => row.action !== "shoot.post_shoot_evaluation.draft_saved")
    .map((row) => {
      const summary = buildAuditSummary(row);
      return buildEntry(auth.tenantId, subject, {
        id: `evaluation_audit:${row.id}`,
        sourceKind: "audit_log",
        eventType: row.action,
        actionLabel: summary.actionLabel,
        summary: summary.summary,
        detail: summary.detail,
        actorUserId: row.actor_user_id,
        actorName: row.actor_name,
        createdAt: row.created_at,
        relatedObjectType: row.entity_type,
        relatedObjectId: row.entity_id,
        metadata: row.metadata
      });
    });
}

async function loadLegacyApprovalEntries(client: PoolClient, auth: AuthUser, subject: TimelineSubject) {
  if (!(subject.objectType === "job" || subject.objectType === "production_item" || (subject.objectType === "approval" && subject.approvalMode === "legacy"))) {
    return [];
  }

  const conditions: string[] = [];
  const params: unknown[] = [auth.tenantId];
  let index = 2;

  if (subject.objectType === "approval" && subject.approvalMode === "legacy") {
    conditions.push(`request.id = $${index}`);
    params.push(subject.objectId);
    index += 1;
  } else if (subject.objectType === "production_item" && subject.productionItemId) {
    conditions.push(`request.production_item_id = $${index}`);
    params.push(subject.productionItemId);
    index += 1;
  } else if (subject.jobId) {
    conditions.push(`request.job_id = $${index}`);
    params.push(subject.jobId);
    index += 1;
  }

  const result = await client.query<LegacyApprovalTimelineRow>(
    `
      SELECT
        request.id::text,
        request.job_id::text AS job_id,
        request.job_day_id::text AS job_day_id,
        request.production_item_id::text AS production_item_id,
        request.approval_type,
        request.summary,
        request.status::text,
        request.requested_at::text,
        request.viewed_at::text,
        request.approved_at::text,
        request.rejected_at::text,
        request.revision_requested_at::text,
        request.approver_user_id::text AS approver_user_id,
        approver.full_name AS approver_user_name
      FROM approval_requests request
      LEFT JOIN app_user approver
        ON approver.id = request.approver_user_id
      WHERE request.tenant_id = $1
        AND (${conditions.join(" OR ")})
      ORDER BY request.created_at DESC
    `,
    params
  );

  const items: ActivityTimelineEntry[] = [];
  for (const row of result.rows) {
    const summaryBase = row.summary ?? `${humanizeToken(row.approval_type)} approval`;
    const transitions = [
      { key: "requested", timestamp: row.requested_at, actorUserId: null, actorName: null, actionLabel: "Approval requested", summary: `${summaryBase} requested.` },
      { key: "viewed", timestamp: row.viewed_at, actorUserId: row.approver_user_id, actorName: row.approver_user_name, actionLabel: "Approval viewed", summary: `${summaryBase} opened for review.` },
      { key: "approved", timestamp: row.approved_at, actorUserId: row.approver_user_id, actorName: row.approver_user_name, actionLabel: "Approval granted", summary: `${summaryBase} approved.` },
      { key: "rejected", timestamp: row.rejected_at, actorUserId: row.approver_user_id, actorName: row.approver_user_name, actionLabel: "Approval denied", summary: `${summaryBase} denied.` },
      { key: "revisions_requested", timestamp: row.revision_requested_at, actorUserId: row.approver_user_id, actorName: row.approver_user_name, actionLabel: "Revision requested", summary: `${summaryBase} sent back for revision.` }
    ];

    for (const transition of transitions) {
      if (!transition.timestamp) {
        continue;
      }
      items.push(
        buildEntry(auth.tenantId, subject, {
          id: `legacy_approval:${row.id}:${transition.key}`,
          sourceKind: transition.key === "requested" ? "approval_request" : "approval_event",
          eventType: `approval.${transition.key}`,
          actionLabel: transition.actionLabel,
          summary: transition.summary,
          actorUserId: transition.actorUserId,
          actorName: transition.actorName,
          createdAt: transition.timestamp,
          relatedObjectType: "approval_request",
          relatedObjectId: row.id,
          metadata: {
            approval_type: row.approval_type,
            status: row.status
          },
          jobId: row.job_id,
          jobDayId: row.job_day_id,
          productionItemId: row.production_item_id
        })
      );
    }
  }
  return items;
}

async function loadOperationalApprovalEntries(client: PoolClient, auth: AuthUser, subject: TimelineSubject) {
  if (
    !(
      (subject.objectType === "approval" && subject.approvalMode === "operational") ||
      (subject.objectType === "job" && subject.jobId) ||
      (subject.objectType === "production_item" && subject.productionItemId)
    )
  ) {
    return [];
  }

  const conditions: string[] = [];
  const params: unknown[] = [auth.tenantId];
  let index = 2;

  if (subject.objectType === "approval" && subject.approvalMode === "operational") {
    conditions.push(`event.approval_request_id = $${index}`);
    params.push(subject.objectId);
    index += 1;
  }

  if (subject.objectType === "job" && subject.jobId) {
    conditions.push(`(req.source_entity_type = 'job' AND req.source_entity_id = $${index})`);
    params.push(subject.jobId);
    index += 1;
  }

  if (subject.objectType === "production_item" && subject.productionItemId) {
    conditions.push(`(req.source_entity_type = 'production_item' AND req.source_entity_id = $${index})`);
    params.push(subject.productionItemId);
    index += 1;
  }

  const result = await client.query<OperationalApprovalEventRow>(
    `
      SELECT
        event.id::text,
        event.approval_request_id::text AS approval_request_id,
        req.request_type::text AS request_type,
        event.event_type,
        event.summary,
        event.note,
        event.actor_user_id::text AS actor_user_id,
        actor.full_name AS actor_name,
        event.metadata,
        event.created_at::text
      FROM operational_approval_event event
      JOIN operational_approval_request req
        ON req.tenant_id = event.tenant_id
       AND req.id = event.approval_request_id
      LEFT JOIN app_user actor
        ON actor.id = event.actor_user_id
      WHERE event.tenant_id = $1
        AND (${conditions.join(" OR ")})
      ORDER BY event.created_at DESC
    `,
    params
  );

  return result.rows.map((row) =>
    buildEntry(auth.tenantId, subject, {
      id: `operational_approval:${row.id}`,
      sourceKind: "approval_event",
      eventType: row.event_type,
      actionLabel: humanizeToken(row.event_type),
      summary: row.summary,
      detail: row.note,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      createdAt: row.created_at,
      relatedObjectType: "operational_approval_request",
      relatedObjectId: row.approval_request_id,
      metadata: {
        ...(row.metadata ?? {}),
        request_type: row.request_type
      }
    })
  );
}

async function loadNotificationEntries(client: PoolClient, auth: AuthUser, subject: TimelineSubject, limit: number) {
  const notificationTypeMap: Record<ActivityTimelineObjectType, string[]> = {
    job: ["job"],
    staffing_assignment: [],
    organization: ["organization"],
    location: ["location"],
    contact: ["contact"],
    production_item: ["production_item"],
    evaluation: ["post_shoot_evaluation"],
    approval: subject.approvalMode === "operational" ? ["operational_approval_request"] : []
  };
  const sourceTypes = notificationTypeMap[subject.objectType];
  if (!sourceTypes.length) {
    return [];
  }
  const result = await client.query<NotificationTimelineRow>(
    `
      SELECT
        event.id::text,
        event.actor_user_id::text AS actor_user_id,
        actor.full_name AS actor_name,
        event.event_type::text,
        event.title,
        event.summary,
        COALESCE(array_length(event.recipient_user_ids, 1), 0) AS recipient_count,
        COALESCE(
          ARRAY(
            SELECT jsonb_array_elements_text(event.delivery_channels)
          ),
          ARRAY[]::text[]
        ) AS delivery_channels,
        COALESCE(event.occurred_at::text, event.created_at::text) AS created_at,
        event.metadata
      FROM operational_event event
      LEFT JOIN app_user actor
        ON actor.id = event.actor_user_id
      WHERE event.tenant_id = $1
        AND event.source_object_type = ANY($2::text[])
        AND event.source_object_id = $3
      ORDER BY COALESCE(event.occurred_at, event.created_at) DESC
      LIMIT $4
    `,
    [auth.tenantId, sourceTypes, subject.objectId, limit]
  );

  return result.rows.map((row) =>
    buildEntry(auth.tenantId, subject, {
      id: `notification:${row.id}`,
      sourceKind: "notification",
      eventType: row.event_type,
      actionLabel: "Notification sent",
      summary: row.title,
      detail:
        row.recipient_count > 0 || row.delivery_channels.length
          ? `${row.recipient_count} recipient${row.recipient_count === 1 ? "" : "s"}${row.delivery_channels.length ? ` · ${row.delivery_channels.map(humanizeToken).join(", ")}` : ""}`
          : null,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      createdAt: row.created_at,
      metadata: row.metadata
    })
  );
}

async function loadSyncEntries(client: PoolClient, auth: AuthUser, subject: TimelineSubject, limit: number) {
  const params: unknown[] = [auth.tenantId];
  const conditions: string[] = [];
  let index = 2;

  if (subject.jobId) {
    conditions.push(`((audit.metadata->>'job_id') = $${index})`);
    params.push(subject.jobId);
    index += 1;
  }
  if (subject.jobDayId) {
    conditions.push(`((audit.metadata->>'job_day_id') = $${index})`);
    params.push(subject.jobDayId);
    index += 1;
  }
  if (subject.productionItemId) {
    conditions.push(`((audit.metadata->>'production_item_id') = $${index})`);
    params.push(subject.productionItemId);
    index += 1;
  }
  if (subject.objectType === "staffing_assignment") {
    conditions.push(`((audit.metadata->>'assignment_id') = $${index})`);
    params.push(subject.objectId);
    index += 1;
  }
  if (subject.organizationId) {
    conditions.push(`((audit.metadata->>'organization_id') = $${index})`);
    params.push(subject.organizationId);
    index += 1;
  }
  if (subject.locationId) {
    conditions.push(`((audit.metadata->>'location_id') = $${index})`);
    params.push(subject.locationId);
    index += 1;
  }
  if (subject.contactId) {
    conditions.push(`((audit.metadata->>'contact_id') = $${index})`);
    params.push(subject.contactId);
    index += 1;
  }

  if (!conditions.length) {
    return [];
  }

  params.push(limit);
  const result = await client.query<AuditTimelineRow>(
    `
      SELECT
        audit.id::text,
        audit.actor_user_id::text AS actor_user_id,
        actor.full_name AS actor_name,
        audit.action,
        audit.entity_type,
        audit.entity_id::text AS entity_id,
        audit.metadata,
        audit.reason_comment,
        audit.created_at::text
      FROM audit_log audit
      LEFT JOIN app_user actor
        ON actor.id = audit.actor_user_id
      WHERE audit.tenant_id = $1
        AND audit.action IN (
          'integration.sync.processing',
          'integration.sync.succeeded',
          'integration.sync.failed',
          'integration.sync.conflict'
        )
        AND (${conditions.join(" OR ")})
      ORDER BY audit.created_at DESC
      LIMIT $${index}
    `,
    params
  );

  return result.rows.map((row) => {
    const summary = buildAuditSummary(row);
    return buildEntry(auth.tenantId, subject, {
      id: `sync:${row.id}`,
      sourceKind: "sync",
      eventType: row.action,
      actionLabel: summary.actionLabel,
      summary: summary.summary,
      detail: summary.detail,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      createdAt: row.created_at,
      relatedObjectType: row.entity_type,
      relatedObjectId: row.entity_id,
      metadata: row.metadata
    });
  });
}

export async function getActivityTimeline(
  client: PoolClient,
  auth: AuthUser,
  input: TimelineQueryInput
): Promise<ActivityTimelineResponse> {
  const limit = Math.max(1, Math.min(input.limit ?? 40, 100));
  const subject = await loadTimelineSubject(client, auth, input);
  await assertSubjectAccess(client, auth, subject);

  const items = [
    ...(await loadActivityLogEntries(client, auth, subject, limit * 2)),
    ...(await loadDirectAuditEntries(client, auth, subject, limit)),
    ...(await loadNoteAuditEntries(client, auth, subject, Math.max(8, Math.ceil(limit / 2)))),
    ...(await loadEvaluationAuditEntries(client, auth, subject, Math.max(8, Math.ceil(limit / 2)))),
    ...(await loadLegacyApprovalEntries(client, auth, subject)),
    ...(await loadOperationalApprovalEntries(client, auth, subject)),
    ...(await loadNotificationEntries(client, auth, subject, Math.max(8, Math.ceil(limit / 2)))),
    ...(await loadSyncEntries(client, auth, subject, Math.max(8, Math.ceil(limit / 2))))
    ]
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
      .slice(0, limit);

  return {
    object_type: subject.objectType,
    object_id: subject.objectId,
    object_label: subject.objectLabel,
    items
  };
}
