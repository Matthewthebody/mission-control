import type { PoolClient } from "pg";
import type {
  CommunicationMeetingDefaultMode,
  CommunicationMeetingDefaultsConfig,
  DayReadyRequirementsConfig,
  HomeDashboardDefaultsConfig,
  OperationalEventDefaultsConfig,
  OperationalEventDefaultOverride,
  OperatingSystemVisibilityOverrideConfig,
  ProactiveCommunicationDefaultsConfig,
  ProductionFinalReleaseStatusesConfig,
  ProductionReleaseBlockersConfig,
  PublishRequiredFieldsConfig,
  TeamsEmbeddedCommunicationsDefaultsConfig
} from "../types/adminConfiguration.js";
import type { DepartmentCode, InternalRoleGroup } from "../types/auth.js";
import type { NotificationChannel, NotificationSeverity } from "../types/domain.js";
import type { AuthUser } from "../types/auth.js";
import type { JobRecord, ProductionItemRecord } from "../types/jobTruth.js";
import type { OperatingSystemModuleKey } from "../types/operatingSystem.js";
import type { OperationalEventType } from "../types/operationalEvents.js";
import { resolveRuntimeAdminSettingValue } from "./adminSettings.js";

const INTERNAL_ROLE_GROUP_PRIORITY: InternalRoleGroup[] = [
  "system_admin",
  "leadership",
  "schools",
  "sports",
  "account_reps",
  "graphics_production",
  "customer_service",
  "senior_photographers",
  "seasonal_photographers"
];

function getPrimaryRoleScope(auth: Pick<AuthUser, "internalRoleGroups">): InternalRoleGroup | null {
  const groups = auth.internalRoleGroups ?? [];
  for (const role of INTERNAL_ROLE_GROUP_PRIORITY) {
    if (groups.includes(role)) {
      return role;
    }
  }
  return null;
}

function buildRoleScopeContext(auth: Pick<AuthUser, "internalRoleGroups">) {
  const role = getPrimaryRoleScope(auth);
  return role ? { role } : {};
}

export async function getOperatingSystemVisibilityOverrides(
  client: PoolClient,
  auth: Pick<AuthUser, "tenantId" | "internalRoleGroups">
): Promise<OperatingSystemVisibilityOverrideConfig> {
  return resolveRuntimeAdminSettingValue<OperatingSystemVisibilityOverrideConfig>(
    client,
    auth.tenantId,
    "roles_access.operating_system_visibility_overrides",
    buildRoleScopeContext(auth)
  );
}

export async function getDefaultOperatingSystemRouteModule(
  client: PoolClient,
  auth: Pick<AuthUser, "tenantId" | "internalRoleGroups">
): Promise<OperatingSystemModuleKey> {
  return resolveRuntimeAdminSettingValue<OperatingSystemModuleKey>(
    client,
    auth.tenantId,
    "roles_access.default_operating_system_route",
    buildRoleScopeContext(auth)
  );
}

export async function getHomeDashboardDefaults(
  client: PoolClient,
  auth: Pick<AuthUser, "tenantId" | "internalRoleGroups">
): Promise<HomeDashboardDefaultsConfig> {
  return resolveRuntimeAdminSettingValue<HomeDashboardDefaultsConfig>(
    client,
    auth.tenantId,
    "roles_access.home_dashboard_defaults",
    buildRoleScopeContext(auth)
  );
}

export async function getScheduleStaffingConfiguration(
  client: PoolClient,
  auth: Pick<AuthUser, "tenantId" | "internalRoleGroups">,
  options: { department?: DepartmentCode | null } = {}
) {
  const scopeContext = {
    ...(options.department ? { department: options.department } : {}),
    ...buildRoleScopeContext(auth)
  };
  const [travelBufferWarningMinutes, tightTurnaroundWarningMinutes] = await Promise.all([
    resolveRuntimeAdminSettingValue<number>(
      client,
      auth.tenantId,
      "schedule_staffing.travel_buffer_warning_minutes",
      scopeContext
    ),
    resolveRuntimeAdminSettingValue<number>(
      client,
      auth.tenantId,
      "schedule_staffing.tight_turnaround_warning_minutes",
      scopeContext
    )
  ]);

  return {
    travel_buffer_warning_minutes: Math.max(0, Math.round(travelBufferWarningMinutes)),
    tight_turnaround_warning_minutes: Math.max(0, Math.round(tightTurnaroundWarningMinutes))
  };
}

export async function getPublishRequiredFieldsConfiguration(client: PoolClient, tenantId: string, job: JobRecord) {
  return resolveRuntimeAdminSettingValue<PublishRequiredFieldsConfig>(
    client,
    tenantId,
    "readiness.publish_required_fields",
    {
      department: job.department_type,
      account: job.organization_id
    }
  );
}

export async function getDayReadyRequirementsConfiguration(client: PoolClient, tenantId: string, job: JobRecord) {
  return resolveRuntimeAdminSettingValue<DayReadyRequirementsConfig>(
    client,
    tenantId,
    "readiness.day_ready_requirements",
    {
      department: job.department_type,
      account: job.organization_id
    }
  );
}

export async function getProductionReleaseBlockersConfiguration(
  client: PoolClient,
  tenantId: string,
  options: { department: JobRecord["department_type"]; jobType?: string | null }
) {
  return resolveRuntimeAdminSettingValue<ProductionReleaseBlockersConfig>(
    client,
    tenantId,
    "production_qa.release_blockers",
    {
      department: options.department,
      job_type: options.jobType ?? null
    }
  );
}

export async function getProductionFinalReleaseStatusesConfiguration(
  client: PoolClient,
  tenantId: string,
  options: { department: JobRecord["department_type"]; jobType?: string | null }
) {
  return resolveRuntimeAdminSettingValue<ProductionFinalReleaseStatusesConfig>(
    client,
    tenantId,
    "production_qa.final_release_statuses",
    {
      department: options.department,
      job_type: options.jobType ?? null
    }
  );
}

export async function getProductionWorkflowConfiguration(
  client: PoolClient,
  tenantId: string,
  options: { department: JobRecord["department_type"]; item: ProductionItemRecord | null }
) {
  const [releaseBlockers, finalReleaseStatuses] = await Promise.all([
    getProductionReleaseBlockersConfiguration(client, tenantId, {
      department: options.department,
      jobType: options.item?.job_type ?? null
    }),
    getProductionFinalReleaseStatusesConfiguration(client, tenantId, {
      department: options.department,
      jobType: options.item?.job_type ?? null
    })
  ]);

  return {
    releaseBlockers,
    finalReleaseStatuses
  };
}

export async function getOperationalEventDefaultsConfiguration(client: PoolClient, tenantId: string) {
  return resolveRuntimeAdminSettingValue<OperationalEventDefaultsConfig>(
    client,
    tenantId,
    "notifications.operational_event_defaults",
    {}
  );
}

export async function getProactiveCommunicationDefaultsConfiguration(
  client: PoolClient,
  auth: Pick<AuthUser, "tenantId" | "internalRoleGroups">
) {
  return resolveRuntimeAdminSettingValue<ProactiveCommunicationDefaultsConfig>(
    client,
    auth.tenantId,
    "notifications.proactive_communication_defaults",
    buildRoleScopeContext(auth)
  );
}

export async function getCommunicationMeetingDefaultsConfiguration(
  client: PoolClient,
  auth: Pick<AuthUser, "tenantId" | "internalRoleGroups">,
  options: { department?: DepartmentCode | null } = {}
) {
  const scopeContext = {
    ...(options.department ? { department: options.department } : {}),
    ...buildRoleScopeContext(auth)
  };
  return resolveRuntimeAdminSettingValue<CommunicationMeetingDefaultsConfig>(
    client,
    auth.tenantId,
    "integration_sync.communication_meeting_defaults",
    scopeContext
  );
}

export async function getCommunicationMeetingDefaultMode(
  client: PoolClient,
  auth: Pick<AuthUser, "tenantId" | "internalRoleGroups">,
  options: { department?: DepartmentCode | null } = {}
): Promise<CommunicationMeetingDefaultMode> {
  const defaults = await getCommunicationMeetingDefaultsConfiguration(client, auth, options);
  return defaults.default_mode;
}

export async function getTeamsEmbeddedCommunicationsDefaultsConfiguration(
  client: PoolClient,
  auth: Pick<AuthUser, "tenantId" | "internalRoleGroups">
) {
  return resolveRuntimeAdminSettingValue<TeamsEmbeddedCommunicationsDefaultsConfig>(
    client,
    auth.tenantId,
    "integration_sync.teams_embedded_communications_defaults",
    buildRoleScopeContext(auth)
  );
}

export function applyOperationalEventDefaultOverride(input: {
  base: {
    defaultChannels: NotificationChannel[];
    defaultSeverity: NotificationSeverity;
    defaultActionRequired: boolean;
    defaultDigestEligible: boolean;
    defaultThrottleWindowMinutes: number;
  };
  defaults: OperationalEventDefaultsConfig;
  eventType: OperationalEventType;
}) {
  const override: OperationalEventDefaultOverride | undefined = input.defaults.event_overrides[input.eventType];
  return {
    defaultChannels: override?.channels?.length ? override.channels : input.defaults.default_channels.length ? input.defaults.default_channels : input.base.defaultChannels,
    defaultSeverity: override?.severity ?? input.base.defaultSeverity,
    defaultActionRequired: override?.action_required ?? input.base.defaultActionRequired,
    defaultDigestEligible: override?.digest_eligible ?? input.base.defaultDigestEligible,
    defaultThrottleWindowMinutes: override?.throttle_window_minutes ?? input.base.defaultThrottleWindowMinutes
  };
}
