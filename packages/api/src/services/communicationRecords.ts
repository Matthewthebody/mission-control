import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type { TeamsCommunicationLinkedObjectType } from "../types/teamsMessaging.js";
import type { PolicyResourceContext } from "./policy/policyEngine.js";
import { getCommunicationGovernanceModule, type CommunicationGovernanceModule } from "./communicationGovernance.js";

export type CommunicationRecordContext = {
  objectType: TeamsCommunicationLinkedObjectType;
  objectId: string;
  objectLabel: string;
  module: CommunicationGovernanceModule;
  permissionEntity: "job" | "task" | "production" | "organization" | "location";
  policyContext: PolicyResourceContext;
};

export async function resolveCommunicationRecordContext(
  client: PoolClient,
  auth: AuthUser,
  objectType: TeamsCommunicationLinkedObjectType,
  objectId: string
): Promise<CommunicationRecordContext> {
  if (objectType === "job") {
    const jobResult = await client.query<{
      id: string;
      title: string;
      job_number: string | null;
      department_type: string;
      organization_id: string | null;
      primary_location_id: string | null;
      account_owner_user_id: string | null;
      created_by_user_id: string | null;
    }>(
      `
        SELECT
          id::text,
          title,
          job_number,
          department_type::text AS department_type,
          organization_id::text AS organization_id,
          primary_location_id::text AS primary_location_id,
          account_owner_user_id::text AS account_owner_user_id,
          created_by_user_id::text AS created_by_user_id
        FROM jobs
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [auth.tenantId, objectId]
    );
    const row = jobResult.rows[0];
    if (!row) {
      throw new ApiError(404, "Record not found");
    }
    const assignedUsers = await client.query<{ user_id: string }>(
      `
        SELECT DISTINCT user_id::text AS user_id
        FROM job_staff_assignments
        WHERE tenant_id = $1
          AND job_id = $2
      `,
      [auth.tenantId, objectId]
    );
    return {
      objectType,
      objectId,
      objectLabel: row.job_number ? `${row.job_number} · ${row.title}` : row.title,
      module: getCommunicationGovernanceModule(objectType),
      permissionEntity: "job",
      policyContext: {
        departmentType: row.department_type,
        organizationId: row.organization_id,
        locationId: row.primary_location_id,
        ownerUserIds: [row.account_owner_user_id, row.created_by_user_id].filter((value): value is string => Boolean(value)),
        assignedUserIds: assignedUsers.rows.map((entry) => entry.user_id)
      }
    };
  }

  if (objectType === "production_item") {
    const result = await client.query<{
      id: string;
      title: string;
      assigned_to_user_id: string | null;
      created_by_user_id: string | null;
      job_department_type: string;
      organization_id: string | null;
      location_id: string | null;
      account_owner_user_id: string | null;
    }>(
      `
        SELECT
          item.id::text,
          item.title,
          item.assigned_to_user_id::text AS assigned_to_user_id,
          item.created_by_user_id::text AS created_by_user_id,
          job.department_type::text AS job_department_type,
          job.organization_id::text AS organization_id,
          job.primary_location_id::text AS location_id,
          job.account_owner_user_id::text AS account_owner_user_id
        FROM production_items item
        JOIN jobs job
          ON job.tenant_id = item.tenant_id
         AND job.id = item.job_id
        WHERE item.tenant_id = $1
          AND item.id = $2
        LIMIT 1
      `,
      [auth.tenantId, objectId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, "Record not found");
    }
    return {
      objectType,
      objectId,
      objectLabel: row.title,
      module: getCommunicationGovernanceModule(objectType),
      permissionEntity: "production",
      policyContext: {
        departmentType: row.job_department_type,
        organizationId: row.organization_id,
        locationId: row.location_id,
        ownerUserIds: [row.account_owner_user_id, row.created_by_user_id].filter((value): value is string => Boolean(value)),
        assignedUserIds: [row.assigned_to_user_id].filter((value): value is string => Boolean(value))
      }
    };
  }

  if (objectType === "task") {
    const result = await client.query<{
      id: string;
      title: string;
      task_number: string | null;
      department_type: string;
      related_job_id: string | null;
      assigned_to_user_id: string | null;
      created_by_user_id: string | null;
      organization_id: string | null;
      location_id: string | null;
      account_owner_user_id: string | null;
    }>(
      `
        SELECT
          task.id::text,
          task.title,
          task.task_number,
          task.department_type::text AS department_type,
          task.related_job_id::text AS related_job_id,
          task.assigned_to_user_id::text AS assigned_to_user_id,
          task.created_by_user_id::text AS created_by_user_id,
          job.organization_id::text AS organization_id,
          job.primary_location_id::text AS location_id,
          job.account_owner_user_id::text AS account_owner_user_id
        FROM work_task task
        LEFT JOIN jobs job
          ON job.tenant_id = task.tenant_id
         AND job.id = task.related_job_id
        WHERE task.tenant_id = $1
          AND task.id = $2
        LIMIT 1
      `,
      [auth.tenantId, objectId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, "Record not found");
    }
    return {
      objectType,
      objectId,
      objectLabel: row.task_number ? `${row.task_number} · ${row.title}` : row.title,
      module: getCommunicationGovernanceModule(objectType),
      permissionEntity: "task",
      policyContext: {
        departmentType: row.department_type,
        organizationId: row.organization_id,
        locationId: row.location_id,
        ownerUserIds: [row.account_owner_user_id, row.created_by_user_id].filter((value): value is string => Boolean(value)),
        assignedUserIds: [row.assigned_to_user_id].filter((value): value is string => Boolean(value)),
        customScopeValues: row.related_job_id ? [row.related_job_id] : []
      }
    };
  }

  if (objectType === "organization") {
    const result = await client.query<{
      id: string;
      display_name: string;
      account_owner_user_id: string | null;
    }>(
      `
        SELECT
          id::text,
          display_name,
          account_owner_user_id::text AS account_owner_user_id
        FROM organization
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [auth.tenantId, objectId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, "Record not found");
    }
    return {
      objectType,
      objectId,
      objectLabel: row.display_name,
      module: getCommunicationGovernanceModule(objectType),
      permissionEntity: "organization",
      policyContext: {
        organizationId: row.id,
        ownerUserIds: [row.account_owner_user_id].filter((value): value is string => Boolean(value)),
        assignedUserIds: []
      }
    };
  }

  const result = await client.query<{
    id: string;
    location_name: string;
    organization_id: string | null;
  }>(
    `
      SELECT
        id::text,
        location_name,
        organization_id::text AS organization_id
      FROM shoot_location
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, objectId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "Record not found");
  }
  return {
    objectType,
    objectId,
    objectLabel: row.location_name,
    module: getCommunicationGovernanceModule(objectType),
    permissionEntity: "location",
    policyContext: {
      organizationId: row.organization_id,
      locationId: row.id,
      ownerUserIds: [],
      assignedUserIds: []
    }
  };
}
