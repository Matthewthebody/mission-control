import type { PoolClient } from "pg";
import { z } from "zod";
import { hasAuthorityTier, hasPermissionCode } from "../authz/authority.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  CommunicationMeetingDefaultsConfig,
  DayReadyRequirementsConfig,
  HomeDashboardDefaultsConfig,
  OperationalEventDefaultsConfig,
  OperatingSystemVisibilityOverrideConfig,
  ProactiveCommunicationDefaultsConfig,
  ProductionFinalReleaseStatusesConfig,
  ProductionReleaseBlockersConfig,
  PublishRequiredFieldsConfig,
  TeamsEmbeddedCommunicationsDefaultsConfig
} from "../types/adminConfiguration.js";
import { PUBLISH_REQUIRED_FIELD_KEYS } from "../types/adminConfiguration.js";
import { OPERATIONAL_EVENT_TYPES } from "../types/operationalEvents.js";
import { PROACTIVE_COMMUNICATION_ROUTE_TYPES, PROACTIVE_COMMUNICATION_TRIGGER_TYPES } from "../types/proactiveCommunication.js";
import {
  HOME_WIDGET_VISIBILITY_KEYS,
  OPERATING_SYSTEM_HOME_COMPACT_WIDGET_KEYS,
  OPERATING_SYSTEM_HOME_SECTION_KEYS,
  OPERATING_SYSTEM_MODULE_KEYS
} from "../types/operatingSystem.js";
import { createAuditLog } from "./audit.js";
import { writeAuditEvent } from "./diagnostics/auditEventService.js";

export const ADMIN_SETTING_CATEGORIES = [
  "attendance_time_rules",
  "schedule_staffing_rules",
  "readiness_workflow_rules",
  "production_qa_rules",
  "relationship_directory_rules",
  "notification_summary_rules",
  "reporting_packet_rules",
  "branding_foundation",
  "integration_sync_rules",
  "roles_access_rules"
] as const;

export const ADMIN_SETTING_SCOPE_TYPES = [
  "global",
  "department",
  "workflow_type",
  "shoot_type",
  "job_type",
  "account",
  "location",
  "role"
] as const;

export const ADMIN_SETTING_STATUSES = ["approved", "pending_approval", "rejected", "superseded", "archived"] as const;

export type AdminSettingCategory = (typeof ADMIN_SETTING_CATEGORIES)[number];
export type AdminSettingScopeType = (typeof ADMIN_SETTING_SCOPE_TYPES)[number];
export type AdminSettingStatus = (typeof ADMIN_SETTING_STATUSES)[number];
export type AdminSettingValueType = "number" | "boolean" | "text" | "enum" | "time_range" | "color" | "json";
export type AdminCapabilityGroup =
  | "system_owner"
  | "operations_admin"
  | "scheduling_staffing_admin"
  | "production_admin"
  | "relationship_directory_admin"
  | "reporting_packet_admin"
  | "integration_admin"
  | "branding_admin"
  | "read_only_audit_admin";

type AdminSettingDefinition = {
  key: string;
  label: string;
  description: string;
  whyItMatters: string;
  category: AdminSettingCategory;
  defaultValue: boolean | number | string | Record<string, unknown>;
  valueType: AdminSettingValueType;
  allowedScopes: AdminSettingScopeType[];
  impactedModules: string[];
  editorGroup: AdminCapabilityGroup;
  protectedChange?: boolean;
  overrideCapable?: boolean;
  enumValues?: string[];
  helpText?: string | null;
  valueSchema?: z.ZodType<unknown>;
};

export type RuntimeAdminSettingScopeContext = Partial<
  Record<Exclude<AdminSettingScopeType, "global">, string | readonly string[] | null>
>;

type AdminSettingRow = {
  id: string;
  setting_key: string;
  setting_category: AdminSettingCategory;
  scope_type: AdminSettingScopeType;
  scope_id: string | null;
  scope_label: string | null;
  value: unknown;
  value_type: AdminSettingValueType;
  status: AdminSettingStatus;
  requires_approval: boolean;
  is_override: boolean;
  effective_at: string;
  expires_at: string | null;
  requested_by_user_id: string | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  reason: string;
  impact_snapshot: unknown;
  metadata: unknown;
  created_at: string;
  updated_at: string;
  requested_by_name: string | null;
  approved_by_name: string | null;
};

type TemplateSummaryRecord = {
  id: string;
  label: string;
  owner_module: string;
  count: number;
  route_hash: string;
  summary: string;
};

type AdminHealthIssue = {
  id: string;
  title: string;
  detail: string;
  tone: "neutral" | "warning" | "danger";
  action_hash: string | null;
};

type SummaryMetric = {
  id: string;
  label: string;
  value: number;
  detail: string;
  tone: "neutral" | "good" | "warning" | "danger";
};

export type AdminSettingValueRecord = {
  id: string;
  setting_key: string;
  scope_type: AdminSettingScopeType;
  scope_id: string | null;
  scope_label: string | null;
  value: boolean | number | string | Record<string, unknown> | null;
  value_type: AdminSettingValueType;
  status: AdminSettingStatus;
  requires_approval: boolean;
  is_override: boolean;
  effective_at: string;
  expires_at: string | null;
  requested_by_user_id: string | null;
  requested_by_name: string | null;
  approved_by_user_id: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  reason: string;
  impact_snapshot: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AdminSettingWorkspaceRecord = {
  generated_at: string;
  scope_hierarchy: AdminSettingScopeType[];
  summary_strip: SummaryMetric[];
  categories: Array<{
    id: AdminSettingCategory;
    label: string;
    description: string;
    setting_count: number;
    pending_count: number;
    override_count: number;
  }>;
  settings: Array<{
    definition: {
      key: string;
      label: string;
      description: string;
      why_it_matters: string;
      category: AdminSettingCategory;
      default_value: boolean | number | string | Record<string, unknown>;
      value_type: AdminSettingValueType;
      allowed_scopes: AdminSettingScopeType[];
      impacted_modules: string[];
      editor_group: AdminCapabilityGroup;
      protected_change: boolean;
      override_capable: boolean;
      enum_values: string[];
      help_text: string | null;
      who_can_edit: string;
    };
    global_value: AdminSettingValueRecord | null;
    active_overrides: AdminSettingValueRecord[];
    pending_changes: AdminSettingValueRecord[];
    history: AdminSettingValueRecord[];
  }>;
  template_summaries: TemplateSummaryRecord[];
  pending_approvals: AdminSettingValueRecord[];
  scheduled_future_changes: AdminSettingValueRecord[];
  stale_overrides: AdminSettingValueRecord[];
  recent_changes: AdminSettingValueRecord[];
  integration_health_issues: AdminHealthIssue[];
  data_health_warnings: AdminHealthIssue[];
};

export type AdminSettingPreview = {
  generated_at: string;
  setting_key: string;
  scope_type: AdminSettingScopeType;
  scope_id: string | null;
  scope_label: string | null;
  impact_summary: string;
  counts: Record<string, number>;
  freshness: {
    state: "live" | "recently_updated" | "daily_computed";
    label: string;
  };
};

export type AdminSettingChangeInput = {
  setting_key: string;
  scope_type: AdminSettingScopeType;
  scope_id?: string | null;
  scope_label?: string | null;
  value: unknown;
  effective_at?: string | null;
  expires_at?: string | null;
  reason: string;
};

export type AdminSettingPreviewInput = Pick<
  AdminSettingChangeInput,
  "setting_key" | "scope_type" | "scope_id" | "scope_label" | "value"
>;

const CATEGORY_LABELS: Record<AdminSettingCategory, { label: string; description: string }> = {
  attendance_time_rules: {
    label: "Attendance and Time Rules",
    description: "Clock, lateness, geofence, and time-record controls."
  },
  schedule_staffing_rules: {
    label: "Schedule and Staffing Rules",
    description: "Critical windows, staffing defaults, and travel buffers."
  },
  readiness_workflow_rules: {
    label: "Readiness and Shoot Workflow Rules",
    description: "Ready cutoffs, required pre-service signals, and closeout capture."
  },
  production_qa_rules: {
    label: "Production and QA Rules",
    description: "Due-date, QA, release, and blocker escalation defaults."
  },
  relationship_directory_rules: {
    label: "Directory and Relationship Rules",
    description: "Freshness windows, ownership expectations, and relationship continuity triggers."
  },
  notification_summary_rules: {
    label: "Notifications and Summary Rules",
    description: "Quiet hours, digests, escalation windows, and recurring summaries."
  },
  reporting_packet_rules: {
    label: "Reporting and Packet Rules",
    description: "Default windows, outlier thresholds, and leadership packet defaults."
  },
  branding_foundation: {
    label: "Branding Foundation",
    description: "Company identity and safe white-label presentation defaults."
  },
  integration_sync_rules: {
    label: "Integrations and Sync Rules",
    description: "Enabled integrations, sync cadence, and failure-routing defaults."
  },
  roles_access_rules: {
    label: "Roles, Access, and Admin Permissions",
    description: "Admin bundles, protected sharing defaults, and high-risk access controls."
  }
};

const SCOPE_PRECEDENCE: Record<AdminSettingScopeType, number> = {
  global: 0,
  department: 1,
  workflow_type: 2,
  shoot_type: 3,
  job_type: 4,
  account: 5,
  location: 6,
  role: 7
};

const notificationChannelSchema = z.enum(["in_app", "push", "sms", "email"]);
const notificationSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
const workflowIssueLevelSchema = z.enum(["hard_block", "warning"]);
const productionFinalReleaseStatusSchema = z.enum(["RELEASED", "SENT_TO_VENDOR", "DELIVERED", "CLOSED"]);

const operatingSystemVisibilityOverrideSchema = z
  .object({
    hidden_modules: z.array(z.enum(OPERATING_SYSTEM_MODULE_KEYS)).default([]),
    hidden_home_widgets: z.array(z.enum(HOME_WIDGET_VISIBILITY_KEYS)).default([])
  })
  .strict();

const homeDashboardDefaultsSchema = z
  .object({
    hidden_sections: z.array(z.enum(OPERATING_SYSTEM_HOME_SECTION_KEYS)).default([]),
    hidden_compact_widgets: z.array(z.enum(OPERATING_SYSTEM_HOME_COMPACT_WIDGET_KEYS)).default([])
  })
  .strict();

const publishRequiredFieldsSchema = z
  .object({
    required_fields: z.array(z.enum(PUBLISH_REQUIRED_FIELD_KEYS)).min(1),
    allow_location_override_note: z.boolean().default(true),
    allow_contact_override_note: z.boolean().default(true)
  })
  .strict();

const dayReadyRequirementsSchema = z
  .object({
    require_lead_assigned: z.boolean().default(true),
    missing_lead_level: workflowIssueLevelSchema.default("hard_block"),
    require_on_site_confirmed: z.boolean().default(true),
    require_setup_complete: z.boolean().default(true),
    require_all_required_staff_present: z.boolean().default(true),
    require_blockers_resolved: z.boolean().default(true),
    require_equipment_ready: z.boolean().default(false),
    require_client_contact_checked_in: z.boolean().default(false),
    manager_override_downgrades: z.boolean().default(true)
  })
  .strict();

const productionReleaseBlockersSchema = z
  .object({
    require_peer_review_for_upload: z.boolean().default(true),
    require_final_review_for_release: z.boolean().default(true),
    require_approval_when_required: z.boolean().default(true),
    require_proof_reference_when_required: z.boolean().default(true),
    require_no_blocking_issues_for_final_release: z.boolean().default(true)
  })
  .strict();

const productionFinalReleaseStatusesSchema = z
  .object({
    statuses: z.array(productionFinalReleaseStatusSchema).min(1)
  })
  .strict();

const operationalEventDefaultsSchema = z
  .object({
    default_channels: z.array(notificationChannelSchema).min(1).default(["in_app"]),
    event_overrides: z
      .record(
        z.enum(OPERATIONAL_EVENT_TYPES),
        z
          .object({
            severity: notificationSeveritySchema.optional(),
            channels: z.array(notificationChannelSchema).min(1).optional(),
            throttle_window_minutes: z.number().int().min(0).max(24 * 60).optional(),
            action_required: z.boolean().optional(),
            digest_eligible: z.boolean().optional()
          })
          .strict()
      )
      .default({})
  })
  .strict();

const communicationMeetingDefaultsSchema = z
  .object({
    default_mode: z.enum(["calendar_event", "standalone_online_meeting"]).default("calendar_event")
  })
  .strict();

const teamsEmbeddedCommunicationsDefaultsSchema = z
  .object({
    max_assigned_jobs: z.number().int().min(1).max(12).default(4),
    max_assigned_tasks: z.number().int().min(1).max(12).default(4),
    max_entries: z.number().int().min(1).max(20).default(8)
  })
  .strict()
  .refine(
    (value) => value.max_entries <= value.max_assigned_jobs + value.max_assigned_tasks,
    {
      message: "max_entries cannot exceed the combined assigned job/task limits."
    }
  );

const proactiveCommunicationDefaultsSchema = z
  .object({
    default_fallback_route: z.enum(["in_app_notification", "open_teams_recommendation"]).default("in_app_notification"),
    default_throttle_window_minutes: z.number().int().min(0).max(24 * 60).default(120),
    max_direct_message_recipients: z.number().int().min(1).max(12).default(3),
    trigger_overrides: z
      .record(
        z.enum(PROACTIVE_COMMUNICATION_TRIGGER_TYPES),
        z
          .object({
            enabled: z.boolean().optional(),
            preferred_route: z.enum(PROACTIVE_COMMUNICATION_ROUTE_TYPES).optional(),
            throttle_window_minutes: z.number().int().min(0).max(24 * 60).optional(),
            max_direct_message_recipients: z.number().int().min(1).max(12).optional()
          })
          .strict()
      )
      .default({})
  })
  .strict();

const microsoftEntraSensitiveActionContractSchema = z
  .object({
    default_action_key: z.string().trim().min(1).default("session.elevate"),
    actions: z
      .record(
        z.string().trim().min(1),
        z
          .object({
            auth_context_id: z.string().trim().min(1).nullable().default(null),
            required_assurance: z.enum(["standard", "mfa", "phishing_resistant"]).default("mfa"),
            reauth_window_minutes: z.number().int().min(1).max(24 * 60).default(10),
            elevated_window_minutes: z.number().int().min(1).max(24 * 60).default(10),
            privileged_window_minutes: z.number().int().min(1).max(24 * 60).default(15),
            allow_break_glass: z.boolean().default(false),
            prompt: z.enum(["login", "select_account"]).default("login")
          })
          .strict()
      )
      .default({})
  })
  .strict();

const microsoftEntraAuthorizationContractSchema = z
  .object({
    contract_version: z.string().trim().min(1).default("1"),
    require_assignment_for_sign_in: z.boolean().default(false),
    fail_closed_for_privileged: z.boolean().default(true),
    app_role_mappings: z
      .record(
        z.string().trim().min(1),
        z
          .object({
            authority_tier: z
              .enum(["super_admin", "leadership", "director_admin", "supervisor", "standard_employee", "read_only_viewer"])
              .nullable()
              .optional(),
            internal_role_groups: z
              .array(
                z.enum([
                  "system_admin",
                  "leadership",
                  "schools",
                  "sports",
                  "account_reps",
                  "senior_photographers",
                  "seasonal_photographers",
                  "graphics_production",
                  "customer_service"
                ])
              )
              .default([]),
            policy_roles: z.array(z.string().trim().min(1)).default([]),
            permission_keys: z.array(z.string().trim().min(1)).default([]),
            privileged: z.boolean().default(false)
          })
          .strict()
      )
      .default({}),
    group_mappings: z
      .array(
        z
          .object({
            group_id: z.string().trim().min(1),
            authority_tier: z
              .enum(["super_admin", "leadership", "director_admin", "supervisor", "standard_employee", "read_only_viewer"])
              .nullable()
              .optional(),
            internal_role_groups: z
              .array(
                z.enum([
                  "system_admin",
                  "leadership",
                  "schools",
                  "sports",
                  "account_reps",
                  "senior_photographers",
                  "seasonal_photographers",
                  "graphics_production",
                  "customer_service"
                ])
              )
              .default([]),
            policy_roles: z.array(z.string().trim().min(1)).default([]),
            permission_keys: z.array(z.string().trim().min(1)).default([]),
            privileged: z.boolean().default(false)
          })
          .strict()
      )
      .default([])
  })
  .strict();

const SETTING_DEFINITIONS: AdminSettingDefinition[] = [
  {
    key: "attendance_time.awareness_window_minutes",
    label: "Attendance Awareness Window",
    description: "Minutes before a shift starts when live attendance monitoring begins surfacing upcoming risk.",
    whyItMatters: "This controls when Home and the attendance desk start treating a scheduled assignment as an active same-day watch item.",
    category: "attendance_time_rules",
    defaultValue: 30,
    valueType: "number",
    allowedScopes: ["global", "department", "role"],
    impactedModules: ["Attendance", "Home", "Scheduling"],
    editorGroup: "operations_admin",
    overrideCapable: true
  },
  {
    key: "attendance_time.grace_window_minutes",
    label: "Attendance Grace Window",
    description: "Minutes after scheduled start before a missing check-in turns from grace into a real attendance issue.",
    whyItMatters: "This keeps same-day monitoring realistic without escalating every minor arrival delay into an urgent problem.",
    category: "attendance_time_rules",
    defaultValue: 5,
    valueType: "number",
    allowedScopes: ["global", "department", "role"],
    impactedModules: ["Attendance", "Home", "Notifications"],
    editorGroup: "operations_admin",
    overrideCapable: true
  },
  {
    key: "attendance_time.unresolved_threshold_minutes",
    label: "Unresolved Attendance Threshold",
    description: "Minutes after scheduled start before a missing attendance signal becomes unresolved and starts stronger escalation.",
    whyItMatters: "This is the handoff point between a late arrival and a same-day intervention problem.",
    category: "attendance_time_rules",
    defaultValue: 12,
    valueType: "number",
    allowedScopes: ["global", "department", "role"],
    impactedModules: ["Attendance", "Scheduling", "Notifications"],
    editorGroup: "operations_admin",
    protectedChange: true,
    overrideCapable: true
  },
  {
    key: "attendance_time.early_clock_in_window_minutes",
    label: "Early Clock-In Window",
    description: "How early standard employees can clock in without review.",
    whyItMatters: "This keeps time capture flexible in the field without opening the door to noisy early punches.",
    category: "attendance_time_rules",
    defaultValue: 30,
    valueType: "number",
    allowedScopes: ["global", "role", "department"],
    impactedModules: ["Attendance", "Home", "Manager Time Review"],
    editorGroup: "operations_admin",
    overrideCapable: true
  },
  {
    key: "attendance_time.probable_no_show_threshold_minutes",
    label: "Probable No-Show Threshold",
    description: "Minutes after scheduled start before a missing clock-in escalates to probable no-show.",
    whyItMatters: "This drives same-day staffing escalation and leadership visibility.",
    category: "attendance_time_rules",
    defaultValue: 20,
    valueType: "number",
    allowedScopes: ["global", "department", "role"],
    impactedModules: ["Attendance", "Home", "Notifications"],
    editorGroup: "operations_admin",
    protectedChange: true,
    overrideCapable: true
  },
  {
    key: "schedule_staffing.critical_window_hours",
    label: "Critical Schedule Edit Window",
    description: "Hours before start when staffing and schedule edits need stronger warnings and approvals.",
    whyItMatters: "This protects same-day execution from silent late-stage staffing drift.",
    category: "schedule_staffing_rules",
    defaultValue: 24,
    valueType: "number",
    allowedScopes: ["global", "department", "shoot_type"],
    impactedModules: ["Schedule", "Staffing", "Home"],
    editorGroup: "scheduling_staffing_admin",
    protectedChange: true,
    overrideCapable: true
  },
  {
    key: "schedule_staffing.travel_buffer_warning_minutes",
    label: "Travel Buffer Warning Threshold",
    description: "Minimum recommended travel buffer between assignments before Mission Control warns about risk.",
    whyItMatters: "This keeps schedule planning operationally realistic without needing routing optimization.",
    category: "schedule_staffing_rules",
    defaultValue: Math.max(config.OUTLOOK_CONFLICT_TRAVEL_BUFFER_MINUTES, 0),
    valueType: "number",
    allowedScopes: ["global", "department", "role"],
    impactedModules: ["Schedule", "Staffing", "Home"],
    editorGroup: "scheduling_staffing_admin",
    overrideCapable: true
  },
  {
    key: "schedule_staffing.tight_turnaround_warning_minutes",
    label: "Tight Turnaround Warning Threshold",
    description: "Minutes between assignments that should still surface as a same-day staffing warning even when travel buffer is not blocking.",
    whyItMatters: "This keeps schedulers aware of risky back-to-back commitments without hard-blocking every tight handoff.",
    category: "schedule_staffing_rules",
    defaultValue: 45,
    valueType: "number",
    allowedScopes: ["global", "department", "role"],
    impactedModules: ["Schedule", "Staffing", "Home"],
    editorGroup: "scheduling_staffing_admin",
    overrideCapable: true
  },
  {
    key: "readiness.ready_cutoff_hours_before_start",
    label: "Ready Cutoff Before Start",
    description: "Hours before shoot start when readiness should be green for clean operations.",
    whyItMatters: "This gives coordinators a common planning deadline and makes readiness reporting consistent.",
    category: "readiness_workflow_rules",
    defaultValue: 2,
    valueType: "number",
    allowedScopes: ["global", "shoot_type", "account"],
    impactedModules: ["Shoots", "Home", "Reports"],
    editorGroup: "operations_admin",
    overrideCapable: true
  },
  {
    key: "readiness.first_time_location_requires_setup_photos",
    label: "Require Setup Photos For First-Time Locations",
    description: "Whether first-time locations must submit setup photos for reusable memory.",
    whyItMatters: "This builds reusable location intelligence without forcing photo capture everywhere.",
    category: "readiness_workflow_rules",
    defaultValue: true,
    valueType: "boolean",
    allowedScopes: ["global", "shoot_type", "account", "location"],
    impactedModules: ["Shoot Closeout", "Location Memory", "Historical Context"],
    editorGroup: "operations_admin",
    overrideCapable: true
  },
  {
    key: "readiness.publish_required_fields",
    label: "Publish Required Fields",
    description: "Structured required-field rules that must be satisfied before a job can publish.",
    whyItMatters: "This makes publish blockers explicit and configurable instead of scattering required-field assumptions across the codebase.",
    category: "readiness_workflow_rules",
    defaultValue: {
      required_fields: [...PUBLISH_REQUIRED_FIELD_KEYS],
      allow_location_override_note: true,
      allow_contact_override_note: true
    } satisfies PublishRequiredFieldsConfig,
    valueType: "json",
    valueSchema: publishRequiredFieldsSchema,
    allowedScopes: ["global", "department", "account"],
    impactedModules: ["Jobs", "Workflow", "Search"],
    editorGroup: "operations_admin",
    protectedChange: true,
    overrideCapable: true,
    helpText:
      'Example: { "required_fields": ["organization_id", "title", "days", "timezone"], "allow_location_override_note": true, "allow_contact_override_note": true }'
  },
  {
    key: "readiness.day_ready_requirements",
    label: "Day Ready Requirements",
    description: "Structured rules that control what must be true before a job day can be marked ready.",
    whyItMatters: "This lets operations tune ready-confirmation blockers without rewriting the workflow engine for every department nuance.",
    category: "readiness_workflow_rules",
    defaultValue: {
      require_lead_assigned: true,
      missing_lead_level: "hard_block",
      require_on_site_confirmed: true,
      require_setup_complete: true,
      require_all_required_staff_present: true,
      require_blockers_resolved: true,
      require_equipment_ready: false,
      require_client_contact_checked_in: false,
      manager_override_downgrades: true
    } satisfies DayReadyRequirementsConfig,
    valueType: "json",
    valueSchema: dayReadyRequirementsSchema,
    allowedScopes: ["global", "department", "account"],
    impactedModules: ["Jobs", "Workflow", "Readiness"],
    editorGroup: "operations_admin",
    protectedChange: true,
    overrideCapable: true,
    helpText:
      'Example: { "require_lead_assigned": true, "missing_lead_level": "hard_block", "require_on_site_confirmed": true, "manager_override_downgrades": true }'
  },
  {
    key: "production_qa.default_due_days",
    label: "Default Production Due Days",
    description: "How many days after entry a production job defaults to due when no custom date is provided.",
    whyItMatters: "This keeps production jobs from entering the queue without a meaningful target date.",
    category: "production_qa_rules",
    defaultValue: 3,
    valueType: "number",
    allowedScopes: ["global", "job_type", "workflow_type"],
    impactedModules: ["Production Tracker", "Home", "Reports"],
    editorGroup: "production_admin",
    overrideCapable: true
  },
  {
    key: "production_qa.release_requires_signoff",
    label: "Release Requires Sign-Off",
    description: "Whether Ready to Release work still needs an authorized release sign-off before completion.",
    whyItMatters: "This protects final release on higher-risk production work.",
    category: "production_qa_rules",
    defaultValue: true,
    valueType: "boolean",
    allowedScopes: ["global", "job_type", "workflow_type"],
    impactedModules: ["Production Tracker", "QA Review", "Audit"],
    editorGroup: "production_admin",
    protectedChange: true,
    overrideCapable: true
  },
  {
    key: "production_qa.release_blockers",
    label: "Production Release Blockers",
    description: "Structured workflow blockers that control what must be complete before production can move into upload or release.",
    whyItMatters: "This keeps downstream release rules explicit, reviewable, and consistent across production types.",
    category: "production_qa_rules",
    defaultValue: {
      require_peer_review_for_upload: true,
      require_final_review_for_release: true,
      require_approval_when_required: true,
      require_proof_reference_when_required: true,
      require_no_blocking_issues_for_final_release: true
    } satisfies ProductionReleaseBlockersConfig,
    valueType: "json",
    valueSchema: productionReleaseBlockersSchema,
    allowedScopes: ["global", "department", "job_type"],
    impactedModules: ["Production Tracker", "QA Review", "Workflow"],
    editorGroup: "production_admin",
    protectedChange: true,
    overrideCapable: true,
    helpText:
      'Example: { "require_peer_review_for_upload": true, "require_final_review_for_release": true, "require_approval_when_required": true }'
  },
  {
    key: "production_qa.final_release_statuses",
    label: "Final Release Statuses",
    description: "Statuses that should count as final release for blocker enforcement and closeout rules.",
    whyItMatters: "This makes the production workflow tolerant of status-model differences without burying the release definition in code.",
    category: "production_qa_rules",
    defaultValue: {
      statuses: ["RELEASED", "SENT_TO_VENDOR", "DELIVERED", "CLOSED"]
    } satisfies ProductionFinalReleaseStatusesConfig,
    valueType: "json",
    valueSchema: productionFinalReleaseStatusesSchema,
    allowedScopes: ["global", "department", "job_type"],
    impactedModules: ["Production Tracker", "QA Review", "Reporting"],
    editorGroup: "production_admin",
    protectedChange: true,
    overrideCapable: true,
    helpText: 'Example: { "statuses": ["RELEASED", "DELIVERED", "CLOSED"] }'
  },
  {
    key: "relationship_directory.contact_freshness_window_days",
    label: "Critical Contact Freshness Window",
    description: "Days before a critical or high-importance contact becomes stale and needs review.",
    whyItMatters: "This keeps relationship continuity and day-of readiness from drifting into tribal knowledge.",
    category: "relationship_directory_rules",
    defaultValue: 180,
    valueType: "number",
    allowedScopes: ["global", "account", "role"],
    impactedModules: ["Directory", "Continuity", "Reports"],
    editorGroup: "relationship_directory_admin",
    overrideCapable: true
  },
  {
    key: "relationship_directory.backup_owner_required_for_critical_contacts",
    label: "Require Backup Owner For Critical Contacts",
    description: "Whether critical contacts must have a visible backup internal owner.",
    whyItMatters: "This protects continuity during turnover and keeps important relationships from becoming ownerless.",
    category: "relationship_directory_rules",
    defaultValue: true,
    valueType: "boolean",
    allowedScopes: ["global", "account"],
    impactedModules: ["Directory", "Continuity", "Reports"],
    editorGroup: "relationship_directory_admin",
    protectedChange: true,
    overrideCapable: true
  },
  {
    key: "notifications.quiet_hours_window",
    label: "Quiet Hours Window",
    description: "Default quiet-hours window for low and medium urgency notifications.",
    whyItMatters: "This prevents alert fatigue while preserving critical operational routing.",
    category: "notification_summary_rules",
    defaultValue: { start: "22:00", end: "06:00" },
    valueType: "time_range",
    allowedScopes: ["global", "department", "role"],
    impactedModules: ["Notification Center", "Push", "Digest Delivery"],
    editorGroup: "operations_admin",
    overrideCapable: true
  },
  {
    key: "notifications.high_severity_ack_window_minutes",
    label: "High-Severity Acknowledgment Window",
    description: "Minutes before unresolved high-severity operational alerts escalate to the next role layer.",
    whyItMatters: "This keeps ownership clear and makes escalations explainable.",
    category: "notification_summary_rules",
    defaultValue: 30,
    valueType: "number",
    allowedScopes: ["global", "department", "workflow_type"],
    impactedModules: ["Notification Center", "Home", "Alerts"],
    editorGroup: "operations_admin",
    protectedChange: true,
    overrideCapable: true
  },
  {
    key: "notifications.operational_event_defaults",
    label: "Operational Event Routing Defaults",
    description: "Structured defaults for high-signal internal operational events before channel-specific delivery takes over.",
    whyItMatters: "This keeps alert routing and throttling configurable without hardcoding channel behavior into every business service.",
    category: "notification_summary_rules",
    defaultValue: {
      default_channels: ["in_app"],
      event_overrides: {}
    } satisfies OperationalEventDefaultsConfig,
    valueType: "json",
    valueSchema: operationalEventDefaultsSchema,
    allowedScopes: ["global"],
    impactedModules: ["Notifications", "Alerts", "Activity"],
    editorGroup: "operations_admin",
    protectedChange: true,
    helpText:
      'Example: { "default_channels": ["in_app"], "event_overrides": { "approval.requested": { "severity": "high", "throttle_window_minutes": 30 } } }'
  },
  {
    key: "notifications.proactive_communication_defaults",
    label: "Proactive Communication Routing Defaults",
    description: "Structured defaults for when the app should route high-signal communication triggers into direct Teams sends, channel alerts, or in-app recommendations.",
    whyItMatters: "This keeps proactive communication rules explainable and reusable instead of hardcoding one-off trigger behavior into job, staffing, and task mutations.",
    category: "notification_summary_rules",
    defaultValue: {
      default_fallback_route: "in_app_notification",
      default_throttle_window_minutes: 120,
      max_direct_message_recipients: 3,
      trigger_overrides: {
        assignment_changed: {
          preferred_route: "direct_teams_message",
          throttle_window_minutes: 90
        },
        call_time_changed: {
          preferred_route: "channel_alert",
          throttle_window_minutes: 180
        },
        required_info_missing: {
          preferred_route: "in_app_notification",
          throttle_window_minutes: 240
        },
        approval_needed: {
          preferred_route: "in_app_notification",
          throttle_window_minutes: 120
        },
        conflict_detected: {
          preferred_route: "channel_alert",
          throttle_window_minutes: 120
        },
        urgent_job_update: {
          preferred_route: "channel_alert",
          throttle_window_minutes: 60
        },
        overdue_task_tied_to_job: {
          preferred_route: "open_teams_recommendation",
          throttle_window_minutes: 180
        }
      }
    } satisfies ProactiveCommunicationDefaultsConfig,
    valueType: "json",
    valueSchema: proactiveCommunicationDefaultsSchema,
    allowedScopes: ["global", "role"],
    impactedModules: ["Communications", "Notifications", "Jobs", "Tasks", "Approvals"],
    editorGroup: "integration_admin",
    protectedChange: true,
    overrideCapable: true,
    helpText:
      '{ "default_fallback_route": "in_app_notification", "default_throttle_window_minutes": 120, "max_direct_message_recipients": 3, "trigger_overrides": { "assignment_changed": { "preferred_route": "direct_teams_message", "throttle_window_minutes": 90 } } }'
  },
  {
    key: "reporting.default_dashboard_window",
      label: "Default Reports Window",
      description: "Default reporting date window for Reports dashboards.",
    whyItMatters: "This keeps saved views and exported review packets anchored to a sane decision window.",
    category: "reporting_packet_rules",
    defaultValue: "last_30_days",
    valueType: "enum",
    enumValues: ["today", "last_7_days", "last_30_days", "last_90_days", "season_to_date", "year_to_date"],
    allowedScopes: ["global", "role"],
    impactedModules: ["Reports", "Saved Views", "Leadership Packets"],
    editorGroup: "reporting_packet_admin",
    overrideCapable: true
  },
  {
    key: "reporting.weekly_packet_delivery_day",
    label: "Weekly Packet Delivery Day",
    description: "Default weekday for recurring weekly leadership packet delivery.",
    whyItMatters: "This keeps recurring summaries predictable and easy to trust.",
    category: "reporting_packet_rules",
    defaultValue: "monday",
    valueType: "enum",
    enumValues: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    allowedScopes: ["global", "department", "role"],
    impactedModules: ["Reports", "Packets", "Recurring Delivery"],
    editorGroup: "reporting_packet_admin",
    overrideCapable: true
  },
  {
    key: "branding.company_name",
    label: "Company Name",
    description: "Company name shown across the shell, packets, and support surfaces.",
    whyItMatters: "This keeps white-label basics consistent without exposing every copy string as a setting.",
    category: "branding_foundation",
    defaultValue: "Kemmetmueller Photography",
    valueType: "text",
    allowedScopes: ["global"],
    impactedModules: ["Shell", "Reports", "Mobile"],
    editorGroup: "branding_admin"
  },
  {
    key: "branding.accent_color",
    label: "Brand Accent Color",
    description: "Primary accent color used in company-level white-label surfaces.",
    whyItMatters: "This keeps presentation consistent without creating a theme playground.",
    category: "branding_foundation",
    defaultValue: "#20456f",
    valueType: "color",
    allowedScopes: ["global"],
    impactedModules: ["Shell", "PDF Packets", "Email Links"],
    editorGroup: "branding_admin"
  },
  {
    key: "integrations.sync_cadence_minutes",
    label: "Integration Sync Cadence",
    description: "Default sync interval for enabled operational integrations.",
    whyItMatters: "This tunes freshness without opening every integration job to ad hoc edits.",
    category: "integration_sync_rules",
    defaultValue: 30,
    valueType: "number",
    allowedScopes: ["global", "workflow_type"],
    impactedModules: ["Integrations", "Schedule Sync", "Notifications"],
    editorGroup: "integration_admin",
    protectedChange: true,
    overrideCapable: true
  },
  {
    key: "integrations.failure_alert_recipient_group",
    label: "Integration Failure Alert Group",
    description: "Default admin group that should receive integration failure alerts.",
    whyItMatters: "This keeps operational failures routed without hardcoding every recipient.",
    category: "integration_sync_rules",
    defaultValue: "leadership",
    valueType: "enum",
    enumValues: ["operations_admin", "integration_admin", "leadership"],
    allowedScopes: ["global", "workflow_type"],
    impactedModules: ["Integrations", "Notification Center", "Admin Dashboard"],
    editorGroup: "integration_admin",
    overrideCapable: true
  },
  {
    key: "integration_sync.communication_meeting_defaults",
    label: "Communication Meeting Defaults",
    description: "Structured defaults for app-orchestrated internal Teams meetings before a specific record overrides them.",
    whyItMatters: "This keeps meeting orchestration predictable and lets operators choose calendar-backed versus standalone defaults without rewriting meeting services.",
    category: "integration_sync_rules",
    defaultValue: {
      default_mode: "calendar_event"
    } satisfies CommunicationMeetingDefaultsConfig,
    valueType: "json",
    valueSchema: communicationMeetingDefaultsSchema,
    allowedScopes: ["global", "department", "role"],
    impactedModules: ["Communications", "Teams Meetings", "Jobs", "Tasks"],
    editorGroup: "integration_admin",
    protectedChange: true,
    overrideCapable: true,
    helpText: '{ "default_mode": "calendar_event" }'
  },
  {
    key: "integration_sync.teams_embedded_communications_defaults",
    label: "Teams Embedded Communications Defaults",
    description: "Structured defaults for how many assigned records the focused Teams communications hub should surface.",
    whyItMatters: "This keeps the Teams-embedded communications view operational and compact without hardcoding one layout for every role.",
    category: "integration_sync_rules",
    defaultValue: {
      max_assigned_jobs: 4,
      max_assigned_tasks: 4,
      max_entries: 8
    } satisfies TeamsEmbeddedCommunicationsDefaultsConfig,
    valueType: "json",
    valueSchema: teamsEmbeddedCommunicationsDefaultsSchema,
    allowedScopes: ["global", "role"],
    impactedModules: ["Communications", "Teams Personal App", "Home"],
    editorGroup: "integration_admin",
    overrideCapable: true,
    helpText: '{ "max_assigned_jobs": 4, "max_assigned_tasks": 4, "max_entries": 8 }'
  },
  {
    key: "roles_access.shared_view_default_visibility",
    label: "Shared View Default Visibility",
    description: "Default visibility for newly shared saved views and packets.",
    whyItMatters: "This keeps report sharing consistent without forcing every creator to make a policy decision.",
    category: "roles_access_rules",
    defaultValue: "team_role_shared",
    valueType: "enum",
    enumValues: ["private", "team_role_shared", "department_shared", "leadership_shared", "company_shared"],
    allowedScopes: ["global", "role"],
    impactedModules: ["Reports", "Saved Views", "Packets"],
    editorGroup: "reporting_packet_admin",
    overrideCapable: true
  },
  {
    key: "roles_access.protected_change_requires_leadership_approval",
    label: "Protected Changes Require Leadership Approval",
    description: "Whether protected admin setting changes require leadership approval before becoming active.",
    whyItMatters: "This preserves control over high-impact rule changes without turning all config into bureaucracy.",
    category: "roles_access_rules",
    defaultValue: true,
    valueType: "boolean",
    allowedScopes: ["global"],
    impactedModules: ["Admin Settings", "Audit", "Approvals"],
    editorGroup: "system_owner",
    protectedChange: true
  },
  {
    key: "roles_access.operating_system_visibility_overrides",
    label: "Operating System Visibility Overrides",
    description: "Hide specific modules or home-entry widgets for a role without changing the underlying permission model.",
    whyItMatters: "This keeps the operational shell focused for each role while preserving the app as the real authorization source.",
    category: "roles_access_rules",
    defaultValue: {
      hidden_modules: [],
      hidden_home_widgets: []
    } satisfies OperatingSystemVisibilityOverrideConfig,
    valueType: "json",
    valueSchema: operatingSystemVisibilityOverrideSchema,
    allowedScopes: ["global", "role"],
    impactedModules: ["Shell", "Home", "Navigation"],
    editorGroup: "system_owner",
    protectedChange: true,
    overrideCapable: true,
    helpText:
      'Example: { "hidden_modules": ["reports"], "hidden_home_widgets": ["reports_overview"] }'
  },
  {
    key: "roles_access.default_operating_system_route",
    label: "Default Operating System Route",
    description: "Preferred landing module for a role when they enter the operating-system shell.",
    whyItMatters: "This lets admins steer each role toward the right front door without forking the app shell.",
    category: "roles_access_rules",
    defaultValue: "home",
    valueType: "enum",
    enumValues: [...OPERATING_SYSTEM_MODULE_KEYS],
    allowedScopes: ["global", "role"],
    impactedModules: ["Shell", "Home", "Navigation"],
    editorGroup: "system_owner",
    protectedChange: true,
    overrideCapable: true
  },
  {
    key: "roles_access.home_dashboard_defaults",
    label: "Home Dashboard Defaults",
    description: "Role-scoped dashboard visibility defaults for home sections and compact widgets.",
    whyItMatters: "This keeps the daily home experience focused without forcing every role into the same dashboard layout.",
    category: "roles_access_rules",
    defaultValue: {
      hidden_sections: [],
      hidden_compact_widgets: []
    } satisfies HomeDashboardDefaultsConfig,
    valueType: "json",
    valueSchema: homeDashboardDefaultsSchema,
    allowedScopes: ["global", "role"],
    impactedModules: ["Home", "Shell", "Dashboard"],
    editorGroup: "system_owner",
    protectedChange: true,
    overrideCapable: true,
    helpText:
      'Example: { "hidden_sections": ["schools_risk"], "hidden_compact_widgets": ["schools_risk"] }'
  },
  {
    key: "roles_access.microsoft_entra_sensitive_action_contract",
    label: "Microsoft Entra Sensitive Action Contract",
    description: "Admin-managed mapping between privileged Mission Control actions and the Entra auth context + reauthentication requirements that must be satisfied first.",
    whyItMatters: "This keeps enterprise step-up enforceable without hard-coding tenant auth context IDs in the app.",
    category: "roles_access_rules",
    defaultValue: {
      default_action_key: "session.elevate",
      actions: {
        "session.elevate": {
          auth_context_id: null,
          required_assurance: "mfa",
          reauth_window_minutes: 10,
          elevated_window_minutes: 10,
          privileged_window_minutes: 15,
          allow_break_glass: false,
          prompt: "login"
        },
        "break_glass.start": {
          auth_context_id: null,
          required_assurance: "mfa",
          reauth_window_minutes: 5,
          elevated_window_minutes: 10,
          privileged_window_minutes: 30,
          allow_break_glass: true,
          prompt: "login"
        }
      }
    },
    valueType: "json",
    valueSchema: microsoftEntraSensitiveActionContractSchema,
    allowedScopes: ["global"],
    impactedModules: ["Security Center", "Authentication", "Microsoft Entra", "Audit"],
    editorGroup: "system_owner",
    protectedChange: true,
    helpText:
      '{ "default_action_key": "session.elevate", "actions": { "session.elevate": { "auth_context_id": "c1", "required_assurance": "mfa", "reauth_window_minutes": 10, "elevated_window_minutes": 10, "privileged_window_minutes": 15, "allow_break_glass": false, "prompt": "login" } } }'
  },
  {
    key: "roles_access.microsoft_entra_authorization_contract",
    label: "Microsoft Entra Authorization Contract",
    description: "Stable Entra app role and group ID contract that Mission Control translates into app authority tiers, internal role groups, policy roles, and final permissions.",
    whyItMatters: "This turns Microsoft assignments into a real external authorization contract instead of relying on nested groups, raw names, or soft assumptions.",
    category: "roles_access_rules",
    defaultValue: {
      contract_version: "1",
      require_assignment_for_sign_in: false,
      fail_closed_for_privileged: true,
      app_role_mappings: {},
      group_mappings: []
    },
    valueType: "json",
    valueSchema: microsoftEntraAuthorizationContractSchema,
    allowedScopes: ["global"],
    impactedModules: ["Authentication", "Access Control", "Security Center", "Microsoft Entra"],
    editorGroup: "system_owner",
    protectedChange: true,
    helpText:
      '{ "contract_version": "1", "require_assignment_for_sign_in": true, "fail_closed_for_privileged": true, "app_role_mappings": { "missioncontrol.platform_admin": { "authority_tier": "super_admin", "internal_role_groups": ["system_admin"], "permission_keys": ["system.configure"], "privileged": true } }, "group_mappings": [{ "group_id": "00000000-0000-0000-0000-000000000000", "internal_role_groups": ["schools"] }] }'
  }
];

const TEMPLATE_SUMMARIES: Array<Omit<TemplateSummaryRecord, "count"> & { table: string; where?: string }> = [
  {
    id: "staffing_templates",
    label: "Staffing Templates",
    owner_module: "Operations",
    route_hash: "#operations/staffing",
    summary: "Reusable staffing requirements and timing offsets by shoot type.",
    table: "staffing_template"
  },
  {
    id: "production_templates",
    label: "Production Templates",
    owner_module: "Production",
    route_hash: "#production/projects",
    summary: "Default production job packages, stages, and due-date expectations.",
    table: "production_project_template"
  },
  {
    id: "touchpoint_templates",
    label: "Touchpoint Templates",
    owner_module: "Directory",
    route_hash: "#directory/organizations",
    summary: "Relationship cadence patterns and continuity touchpoints.",
    table: "directory_touchpoint_plan_template"
  },
  {
    id: "packet_templates",
    label: "Leadership Packet Templates",
      owner_module: "Reports",
      route_hash: "#reports",
    summary: "Curated operating review packets for recurring leadership delivery.",
    table: "leadership_packet_template",
    where: "active_status = true"
  }
];

function getDefinition(settingKey: string) {
  const definition = SETTING_DEFINITIONS.find((item) => item.key === settingKey) ?? null;
  if (!definition) {
    throw new ApiError(404, "Setting definition not found");
  }
  return definition;
}

function mapValueType(value: unknown): boolean | number | string | Record<string, unknown> | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function mapJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function mapSettingRow(row: AdminSettingRow): AdminSettingValueRecord {
  return {
    id: row.id,
    setting_key: row.setting_key,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    scope_label: row.scope_label,
    value: mapValueType(row.value),
    value_type: row.value_type,
    status: row.status,
    requires_approval: row.requires_approval,
    is_override: row.is_override,
    effective_at: row.effective_at,
    expires_at: row.expires_at,
    requested_by_user_id: row.requested_by_user_id,
    requested_by_name: row.requested_by_name,
    approved_by_user_id: row.approved_by_user_id,
    approved_by_name: row.approved_by_name,
    approved_at: row.approved_at,
    reason: row.reason,
    impact_snapshot: mapJsonObject(row.impact_snapshot),
    metadata: mapJsonObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function humanizeEditorGroup(group: AdminCapabilityGroup) {
  switch (group) {
    case "system_owner":
      return "System Owner / Super Admin";
    case "operations_admin":
      return "Operations Admin";
    case "scheduling_staffing_admin":
      return "Scheduling and Staffing Admin";
    case "production_admin":
      return "Production Admin";
    case "relationship_directory_admin":
      return "Relationship / Directory Admin";
    case "reporting_packet_admin":
      return "Reporting and Packet Admin";
    case "integration_admin":
      return "Integration Admin";
    case "branding_admin":
      return "Branding Admin";
    case "read_only_audit_admin":
      return "Read-Only Audit Admin";
    default:
      return "Admin";
  }
}

function isActiveAt(row: AdminSettingValueRecord, referenceTime: Date) {
  if (row.status !== "approved") {
    return false;
  }
  const effectiveAt = new Date(row.effective_at);
  if (effectiveAt > referenceTime) {
    return false;
  }
  if (row.expires_at && new Date(row.expires_at) <= referenceTime) {
    return false;
  }
  return true;
}

function sortByCreatedDesc<T extends { created_at: string }>(rows: T[]) {
  return [...rows].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
}

function sortByEffectiveDesc<T extends { effective_at: string; scope_type: AdminSettingScopeType }>(rows: T[]) {
  return [...rows].sort((left, right) => {
    const leftWeight = SCOPE_PRECEDENCE[left.scope_type];
    const rightWeight = SCOPE_PRECEDENCE[right.scope_type];
    if (rightWeight !== leftWeight) {
      return rightWeight - leftWeight;
    }
    return new Date(right.effective_at).getTime() - new Date(left.effective_at).getTime();
  });
}

function canViewAdminSettings(auth: AuthUser) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"]) ||
    hasPermissionCode(auth, "system_settings_permissions.view")
  );
}

function canManageAdminSettings(auth: AuthUser) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    hasPermissionCode(auth, "system_settings_permissions.edit") ||
    hasPermissionCode(auth, "system_settings_permissions.override")
  );
}

function canApproveProtectedAdminSettings(auth: AuthUser) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership"]) ||
    hasPermissionCode(auth, "system_settings_permissions.approve") ||
    hasPermissionCode(auth, "system_settings_permissions.override")
  );
}

function assertViewAccess(auth: AuthUser) {
  if (!canViewAdminSettings(auth) && !canManageAdminSettings(auth)) {
    throw new ApiError(403, "You do not have access to admin settings.");
  }
}

function assertManageAccess(auth: AuthUser) {
  if (!canManageAdminSettings(auth)) {
    throw new ApiError(403, "You do not have permission to change admin settings.");
  }
}

function assertApproveAccess(auth: AuthUser) {
  if (!canApproveProtectedAdminSettings(auth)) {
    throw new ApiError(403, "You do not have permission to approve protected admin settings.");
  }
}

function normalizeScopeId(scopeType: AdminSettingScopeType, scopeId: string | null | undefined) {
  if (scopeType === "global") {
    return null;
  }
  if (!scopeId || !scopeId.trim()) {
    throw new ApiError(400, "A scope identifier is required for non-global settings.");
  }
  return scopeId.trim();
}

function parseTimeRange(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "Time-range settings require start and end values.");
  }
  const start = typeof (value as Record<string, unknown>).start === "string" ? String((value as Record<string, unknown>).start).trim() : "";
  const end = typeof (value as Record<string, unknown>).end === "string" ? String((value as Record<string, unknown>).end).trim() : "";
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
    throw new ApiError(400, "Time ranges must use HH:MM values.");
  }
  return { start, end };
}

function validateSettingValue(definition: AdminSettingDefinition, value: unknown) {
  switch (definition.valueType) {
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        throw new ApiError(400, "This setting requires a numeric value.");
      }
      return value;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        throw new ApiError(400, "This setting requires a true or false value.");
      }
      return value;
    }
    case "text": {
      if (typeof value !== "string" || !value.trim()) {
        throw new ApiError(400, "This setting requires text.");
      }
      return value.trim();
    }
    case "enum": {
      if (typeof value !== "string" || !value.trim()) {
        throw new ApiError(400, "This setting requires a structured selection.");
      }
      const normalized = value.trim();
      if (definition.enumValues?.length && !definition.enumValues.includes(normalized)) {
        throw new ApiError(400, "That value is not allowed for this setting.");
      }
      return normalized;
    }
    case "color": {
      if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value.trim())) {
        throw new ApiError(400, "Accent colors must use a six-digit hex value.");
      }
      return value.trim();
    }
    case "time_range":
      return parseTimeRange(value);
    case "json": {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new ApiError(400, "This setting requires a structured JSON object.");
      }
      if (!definition.valueSchema) {
        return value as Record<string, unknown>;
      }
      const parsed = definition.valueSchema.safeParse(value);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ApiError(400, issue?.message || "This setting contains invalid structured data.");
      }
      return parsed.data as Record<string, unknown>;
    }
    default:
      throw new ApiError(400, "Unsupported setting value type.");
  }
}

function getRequiresApproval(definition: AdminSettingDefinition, auth: AuthUser) {
  if (!definition.protectedChange) {
    return false;
  }
  return !hasAuthorityTier(auth, "super_admin");
}

async function ensureDefaultAdminSettings(client: PoolClient, auth: AuthUser) {
  for (const definition of SETTING_DEFINITIONS) {
    await client.query(
      `
        INSERT INTO admin_setting_value (
          tenant_id,
          setting_key,
          setting_category,
          scope_type,
          scope_id,
          scope_label,
          value,
          value_type,
          status,
          requires_approval,
          is_override,
          effective_at,
          requested_by_user_id,
          approved_by_user_id,
          approved_at,
          reason,
          impact_snapshot,
          metadata
        )
        SELECT
          $1,
          $2,
          $3::admin_setting_category,
          'global'::admin_setting_scope_type,
          NULL,
          'Company Default',
          $4::jsonb,
          $5,
          'approved'::admin_setting_status,
          false,
          false,
          now(),
          $6,
          $6,
          now(),
          'Seeded from the Phase 1 admin settings default registry.',
          '{"seeded":true}'::jsonb,
          $7::jsonb
        WHERE NOT EXISTS (
          SELECT 1
          FROM admin_setting_value existing
          WHERE existing.tenant_id = $1
            AND existing.setting_key = $2
            AND existing.scope_type = 'global'
            AND existing.scope_id IS NULL
        )
      `,
      [
        auth.tenantId,
        definition.key,
        definition.category,
        JSON.stringify(definition.defaultValue),
        definition.valueType,
        auth.id,
        JSON.stringify({
          system_seeded: true,
          editor_group: definition.editorGroup,
          impacted_modules: definition.impactedModules
        })
      ]
    );
  }
}

function buildProjectedDefaultSettingValue(definition: AdminSettingDefinition): AdminSettingValueRecord {
  const defaultTimestamp = "1970-01-01T00:00:00.000Z";
  return {
    id: `default:${definition.key}`,
    setting_key: definition.key,
    scope_type: "global",
    scope_id: null,
    scope_label: "Built-In Default",
    value: definition.defaultValue as boolean | number | string | Record<string, unknown>,
    value_type: definition.valueType,
    status: "approved",
    requires_approval: false,
    is_override: false,
    effective_at: defaultTimestamp,
    expires_at: null,
    requested_by_user_id: null,
    requested_by_name: null,
    approved_by_user_id: null,
    approved_by_name: null,
    approved_at: null,
    reason: "Built-in system default",
    impact_snapshot: {},
    metadata: {
      projected_default: true
    },
    created_at: defaultTimestamp,
    updated_at: defaultTimestamp
  };
}

async function listSettingRows(client: PoolClient, auth: AuthUser) {
  const { rows } = await client.query<AdminSettingRow>(
    `
      SELECT
        asv.id,
        asv.setting_key,
        asv.setting_category::text AS setting_category,
        asv.scope_type::text AS scope_type,
        asv.scope_id,
        asv.scope_label,
        asv.value,
        asv.value_type,
        asv.status::text AS status,
        asv.requires_approval,
        asv.is_override,
        asv.effective_at::text,
        asv.expires_at::text,
        asv.requested_by_user_id,
        asv.approved_by_user_id,
        asv.approved_at::text,
        asv.reason,
        asv.impact_snapshot,
        asv.metadata,
        asv.created_at::text,
        asv.updated_at::text,
        requester.full_name AS requested_by_name,
        approver.full_name AS approved_by_name
      FROM admin_setting_value asv
      LEFT JOIN app_user requester
        ON requester.tenant_id = asv.tenant_id
       AND requester.id = asv.requested_by_user_id
      LEFT JOIN app_user approver
        ON approver.tenant_id = asv.tenant_id
       AND approver.id = asv.approved_by_user_id
      WHERE asv.tenant_id = $1
      ORDER BY asv.created_at DESC
    `,
    [auth.tenantId]
  );
  return rows.map(mapSettingRow);
}

async function loadTemplateSummaries(client: PoolClient, auth: AuthUser): Promise<TemplateSummaryRecord[]> {
  const summaries: TemplateSummaryRecord[] = [];
  for (const summary of TEMPLATE_SUMMARIES) {
    const whereClause = summary.where ? ` AND ${summary.where}` : "";
    const result = await client.query<{ count: string | number }>(
      `SELECT count(*)::int AS count FROM ${summary.table} WHERE tenant_id = $1${whereClause}`,
      [auth.tenantId]
    );
    summaries.push({
      id: summary.id,
      label: summary.label,
      owner_module: summary.owner_module,
      count: Number(result.rows[0]?.count ?? 0),
      route_hash: summary.route_hash,
      summary: summary.summary
    });
  }
  return summaries;
}

async function loadIntegrationHealthIssues(client: PoolClient, auth: AuthUser): Promise<AdminHealthIssue[]> {
  const issues: AdminHealthIssue[] = [];
  const syncResult = await client.query<{
    failed_count: string | number;
    conflict_count: string | number;
  }>(
    `
      SELECT
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
        COUNT(*) FILTER (WHERE status = 'conflict')::int AS conflict_count
      FROM integration_sync_operation
      WHERE tenant_id = $1
        AND created_at >= now() - interval '14 days'
    `,
    [auth.tenantId]
  );
  const failedCount = Number(syncResult.rows[0]?.failed_count ?? 0);
  const conflictCount = Number(syncResult.rows[0]?.conflict_count ?? 0);
  if (failedCount > 0) {
    issues.push({
      id: "sync_failed",
      title: "Recent sync failures",
      detail: `${failedCount} integration sync operation${failedCount === 1 ? "" : "s"} failed in the last 14 days.`,
      tone: "danger",
      action_hash: "#admin/integrations"
    });
  }
  if (conflictCount > 0) {
    issues.push({
      id: "sync_conflict",
      title: "Integration conflicts need review",
      detail: `${conflictCount} sync conflict${conflictCount === 1 ? "" : "s"} still need manual review.`,
      tone: "warning",
      action_hash: "#admin/integrations"
    });
  }

  const outlookResult = await client.query<{
    warning_count: string | number;
    error_count: string | number;
  }>(
    `
      SELECT
        COUNT(*) FILTER (WHERE health_state IN ('connected_warning', 'connected_pending_sync'))::int AS warning_count,
        COUNT(*) FILTER (WHERE health_state = 'connected_error')::int AS error_count
      FROM outlook_connection
      WHERE tenant_id = $1
    `,
    [auth.tenantId]
  );
  const outlookWarnings = Number(outlookResult.rows[0]?.warning_count ?? 0);
  const outlookErrors = Number(outlookResult.rows[0]?.error_count ?? 0);
  if (outlookErrors > 0) {
    issues.push({
      id: "outlook_error",
      title: "Outlook connection errors",
      detail: `${outlookErrors} Outlook connection${outlookErrors === 1 ? "" : "s"} are in an error state.`,
      tone: "danger",
      action_hash: "#admin/integrations"
    });
  } else if (outlookWarnings > 0) {
    issues.push({
      id: "outlook_warning",
      title: "Outlook connection warnings",
      detail: `${outlookWarnings} Outlook connection${outlookWarnings === 1 ? "" : "s"} are warning or pending sync.`,
      tone: "warning",
      action_hash: "#admin/integrations"
    });
  }
  return issues;
}

async function loadDataHealthWarnings(client: PoolClient, auth: AuthUser): Promise<AdminHealthIssue[]> {
  const issues: AdminHealthIssue[] = [];

  const productionResult = await client.query<{ count: string | number }>(
      `
        SELECT count(*)::int AS count
        FROM production_project
        WHERE tenant_id = $1
          AND status <> 'canceled'
          AND due_date IS NULL
      `,
      [auth.tenantId]
    );
  const contactResult = await client.query<{
      stale_count: string | number;
      ownerless_count: string | number;
    }>(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE active_status = 'active'
              AND operational_importance IN ('critical', 'high')
              AND (
                contact_status = 'needs_review'
                OR uncertainty_flag = true
                OR last_confirmed_at IS NULL
                OR last_confirmed_at < current_date - 180
              )
          )::int AS stale_count,
          COUNT(*) FILTER (
            WHERE active_status = 'active'
              AND operational_importance = 'critical'
              AND primary_internal_owner_user_id IS NULL
          )::int AS ownerless_count
        FROM organization_contact
        WHERE tenant_id = $1
      `,
      [auth.tenantId]
    );
  const locationMemoryResult = await client.query<{ count: string | number }>(
      `
        WITH location_memory AS (
          SELECT
            note.object_id AS location_id,
            MAX(note.created_at) AS last_memory_at
          FROM operational_note note
          WHERE note.tenant_id = $1
            AND note.note_type = 'location_memory'
            AND note.publication_state = 'active'
            AND note.archived_at IS NULL
          GROUP BY note.object_id
        )
        SELECT count(*)::int AS count
        FROM shoot_location location
        LEFT JOIN location_memory memory
          ON memory.location_id = location.id
        WHERE location.tenant_id = $1
          AND location.active_status = 'active'
          AND (memory.last_memory_at IS NULL OR memory.last_memory_at < now() - interval '180 days')
      `,
      [auth.tenantId]
    );
  const deliveryResult = await client.query<{ count: string | number }>(
      `
        SELECT count(*)::int AS count
        FROM leadership_delivery_schedule
        WHERE tenant_id = $1
          AND active_status = true
          AND last_status = 'failed'
      `,
      [auth.tenantId]
    );

  const missingDueDates = Number(productionResult.rows[0]?.count ?? 0);
  if (missingDueDates > 0) {
    issues.push({
      id: "production_due_dates",
      title: "Production jobs missing due dates",
      detail: `${missingDueDates} active production job${missingDueDates === 1 ? "" : "s"} still have no due date.`,
      tone: "warning",
      action_hash: "#production/projects"
    });
  }

  const staleContacts = Number(contactResult.rows[0]?.stale_count ?? 0);
  const ownerlessContacts = Number(contactResult.rows[0]?.ownerless_count ?? 0);
  if (staleContacts > 0) {
    issues.push({
      id: "stale_contacts",
      title: "Critical contacts need review",
      detail: `${staleContacts} critical or high-importance contact${staleContacts === 1 ? "" : "s"} are stale.`,
      tone: "warning",
      action_hash: "#directory/contacts"
    });
  }
  if (ownerlessContacts > 0) {
    issues.push({
      id: "ownerless_contacts",
      title: "Ownerless critical contacts",
      detail: `${ownerlessContacts} critical contact${ownerlessContacts === 1 ? "" : "s"} still have no primary owner.`,
      tone: "danger",
      action_hash: "#directory/contacts"
    });
  }

  const staleLocationMemory = Number(locationMemoryResult.rows[0]?.count ?? 0);
  if (staleLocationMemory > 0) {
    issues.push({
      id: "stale_location_memory",
      title: "Location memory needs refresh",
      detail: `${staleLocationMemory} active location${staleLocationMemory === 1 ? "" : "s"} have stale or missing reusable memory.`,
      tone: "warning",
      action_hash: "#directory/locations"
    });
  }

  const deliveryFailures = Number(deliveryResult.rows[0]?.count ?? 0);
  if (deliveryFailures > 0) {
    issues.push({
      id: "delivery_failures",
      title: "Recurring summary failures",
      detail: `${deliveryFailures} active recurring summary schedule${deliveryFailures === 1 ? "" : "s"} last ran with a failure.`,
      tone: "danger",
      action_hash: "#reports"
    });
  }

  return issues;
}

async function buildImpactPreview(client: PoolClient, auth: AuthUser, definition: AdminSettingDefinition, input: AdminSettingPreviewInput) {
  const counts: Record<string, number> = {};
  switch (definition.category) {
    case "attendance_time_rules": {
      const result = await client.query<{
        upcoming_shoots: string | number;
        active_users: string | number;
        open_reviews: string | number;
      }>(
        `
          SELECT
        (SELECT count(*)::int FROM shoot WHERE tenant_id = $1 AND shoot_date BETWEEN current_date AND current_date + 7 AND status <> 'CANCELLED') AS upcoming_shoots,
            (SELECT count(*)::int FROM app_user WHERE tenant_id = $1 AND status = 'active') AS active_users,
            (SELECT count(*)::int FROM time_clock_compliance_flag WHERE tenant_id = $1 AND status = 'open') AS open_reviews
        `,
        [auth.tenantId]
      );
      counts.upcoming_shoots = Number(result.rows[0]?.upcoming_shoots ?? 0);
      counts.active_users = Number(result.rows[0]?.active_users ?? 0);
      counts.open_reviews = Number(result.rows[0]?.open_reviews ?? 0);
      break;
    }
    case "schedule_staffing_rules":
    case "readiness_workflow_rules": {
      const result = await client.query<{
        upcoming_shoots: string | number;
        staffing_templates: string | number;
        active_requirements: string | number;
      }>(
        `
          SELECT
        (SELECT count(*)::int FROM shoot WHERE tenant_id = $1 AND shoot_date BETWEEN current_date AND current_date + 14 AND status NOT IN ('DRAFT', 'CANCELLED')) AS upcoming_shoots,
            (SELECT count(*)::int FROM staffing_template WHERE tenant_id = $1) AS staffing_templates,
            (SELECT count(*)::int FROM shoot_staffing_requirement WHERE tenant_id = $1) AS active_requirements
        `,
        [auth.tenantId]
      );
      counts.upcoming_shoots = Number(result.rows[0]?.upcoming_shoots ?? 0);
      counts.staffing_templates = Number(result.rows[0]?.staffing_templates ?? 0);
      counts.active_requirements = Number(result.rows[0]?.active_requirements ?? 0);
      break;
    }
    case "production_qa_rules": {
      const result = await client.query<{
        active_jobs: string | number;
        blocked_jobs: string | number;
        templates: string | number;
      }>(
        `
          SELECT
            (SELECT count(*)::int FROM production_project WHERE tenant_id = $1 AND stage <> 'released_complete' AND status <> 'canceled') AS active_jobs,
            (SELECT count(*)::int FROM production_project WHERE tenant_id = $1 AND stage = 'blocked' AND status <> 'canceled') AS blocked_jobs,
            (SELECT count(*)::int FROM production_project_template WHERE tenant_id = $1) AS templates
        `,
        [auth.tenantId]
      );
      counts.active_jobs = Number(result.rows[0]?.active_jobs ?? 0);
      counts.blocked_jobs = Number(result.rows[0]?.blocked_jobs ?? 0);
      counts.templates = Number(result.rows[0]?.templates ?? 0);
      break;
    }
    case "relationship_directory_rules": {
      const result = await client.query<{
        critical_contacts: string | number;
        locations: string | number;
        touchpoint_templates: string | number;
      }>(
        `
          SELECT
            (SELECT count(*)::int FROM organization_contact WHERE tenant_id = $1 AND active_status = 'active' AND operational_importance IN ('critical', 'high')) AS critical_contacts,
            (SELECT count(*)::int FROM shoot_location WHERE tenant_id = $1 AND active_status = 'active') AS locations,
            (SELECT count(*)::int FROM directory_touchpoint_plan_template WHERE tenant_id = $1 AND active_status = true) AS touchpoint_templates
        `,
        [auth.tenantId]
      );
      counts.critical_contacts = Number(result.rows[0]?.critical_contacts ?? 0);
      counts.locations = Number(result.rows[0]?.locations ?? 0);
      counts.touchpoint_templates = Number(result.rows[0]?.touchpoint_templates ?? 0);
      break;
    }
    case "notification_summary_rules":
    case "reporting_packet_rules": {
      const result = await client.query<{
        schedules: string | number;
        saved_views: string | number;
        packet_templates: string | number;
      }>(
        `
          SELECT
            (SELECT count(*)::int FROM leadership_delivery_schedule WHERE tenant_id = $1 AND active_status = true) AS schedules,
            (SELECT count(*)::int FROM report_saved_view WHERE tenant_id = $1 AND active_status = true) AS saved_views,
            (SELECT count(*)::int FROM leadership_packet_template WHERE tenant_id = $1 AND active_status = true) AS packet_templates
        `,
        [auth.tenantId]
      );
      counts.schedules = Number(result.rows[0]?.schedules ?? 0);
      counts.saved_views = Number(result.rows[0]?.saved_views ?? 0);
      counts.packet_templates = Number(result.rows[0]?.packet_templates ?? 0);
      break;
    }
    case "branding_foundation": {
      const result = await client.query<{ active_users: string | number }>(
        `SELECT count(*)::int AS active_users FROM app_user WHERE tenant_id = $1 AND status = 'active'`,
        [auth.tenantId]
      );
      counts.active_users = Number(result.rows[0]?.active_users ?? 0);
      break;
    }
    case "integration_sync_rules": {
      const result = await client.query<{
        connections: string | number;
        failed_syncs: string | number;
      }>(
        `
          SELECT
            (SELECT count(*)::int FROM outlook_connection WHERE tenant_id = $1 AND connection_status <> 'disconnected') AS connections,
            (SELECT count(*)::int FROM integration_sync_operation WHERE tenant_id = $1 AND status IN ('failed', 'conflict') AND created_at >= now() - interval '14 days') AS failed_syncs
        `,
        [auth.tenantId]
      );
      counts.connections = Number(result.rows[0]?.connections ?? 0);
      counts.failed_syncs = Number(result.rows[0]?.failed_syncs ?? 0);
      break;
    }
    case "roles_access_rules": {
      const result = await client.query<{
        active_users: string | number;
        admin_users: string | number;
      }>(
        `
          SELECT
            (SELECT count(*)::int FROM app_user WHERE tenant_id = $1 AND status = 'active') AS active_users,
            (SELECT count(*)::int FROM user_authority_assignment WHERE tenant_id = $1 AND authority_tier IN ('super_admin', 'leadership', 'director_admin')) AS admin_users
        `,
        [auth.tenantId]
      );
      counts.active_users = Number(result.rows[0]?.active_users ?? 0);
      counts.admin_users = Number(result.rows[0]?.admin_users ?? 0);
      break;
    }
    default:
      break;
  }

  const impactedRecordCount = Object.values(counts).reduce((total, value) => total + value, 0);
  const scopedLabel =
    input.scope_type === "global"
      ? "company-wide defaults"
      : `${input.scope_label?.trim() || input.scope_type} override`;
  return {
    generated_at: new Date().toISOString(),
    setting_key: input.setting_key,
    scope_type: input.scope_type,
    scope_id: input.scope_type === "global" ? null : input.scope_id ?? null,
    scope_label: input.scope_label?.trim() || null,
    impact_summary:
      impactedRecordCount > 0
        ? `${definition.label} will update ${scopedLabel} behavior across ${impactedRecordCount} related record signals.`
        : `${definition.label} is ready to update ${scopedLabel} behavior. No directly counted record impact was found in the preview window.`,
    counts,
    freshness: {
      state: "recently_updated" as const,
      label: "Recently Updated"
    }
  };
}

function buildSummaryStrip(input: {
  settings: AdminSettingWorkspaceRecord["settings"];
  pendingApprovals: AdminSettingValueRecord[];
  scheduledFutureChanges: AdminSettingValueRecord[];
  staleOverrides: AdminSettingValueRecord[];
  integrationIssues: AdminHealthIssue[];
  dataWarnings: AdminHealthIssue[];
  recentChanges: AdminSettingValueRecord[];
}) {
  return [
    {
      id: "active_settings",
      label: "Active Policy Settings",
      value: input.settings.filter((setting) => setting.global_value != null).length,
      detail: "Curated settings currently active at the company default layer.",
      tone: "good" as const
    },
    {
      id: "pending_approvals",
      label: "Awaiting Approval",
      value: input.pendingApprovals.length,
      detail: "Protected or higher-risk config changes waiting on approval.",
      tone: input.pendingApprovals.length > 0 ? ("warning" as const) : ("neutral" as const)
    },
    {
      id: "scheduled_changes",
      label: "Future Changes",
      value: input.scheduledFutureChanges.length,
      detail: "Approved changes that will become active later.",
      tone: input.scheduledFutureChanges.length > 0 ? ("warning" as const) : ("neutral" as const)
    },
    {
      id: "stale_overrides",
      label: "Stale Overrides",
      value: input.staleOverrides.length,
      detail: "Overrides that are old or expired and should be reviewed.",
      tone: input.staleOverrides.length > 0 ? ("warning" as const) : ("neutral" as const)
    },
    {
      id: "integration_issues",
      label: "Integration Issues",
      value: input.integrationIssues.length,
      detail: "Integration warnings or failures affecting trust in sync-driven workflows.",
      tone: input.integrationIssues.some((issue) => issue.tone === "danger") ? ("danger" as const) : ("neutral" as const)
    },
    {
      id: "data_warnings",
      label: "Data Health Warnings",
      value: input.dataWarnings.length,
      detail: "Missing due dates, stale memory, or ownership gaps that reduce system trust.",
      tone: input.dataWarnings.some((issue) => issue.tone === "danger") ? ("danger" as const) : ("neutral" as const)
    },
    {
      id: "recent_changes",
      label: "Recent Changes",
      value: input.recentChanges.length,
      detail: "Recent approved, rejected, or newly requested setting changes.",
      tone: input.recentChanges.length > 0 ? ("neutral" as const) : ("good" as const)
    }
  ];
}

function buildCategorySummaries(settings: AdminSettingWorkspaceRecord["settings"]) {
  return ADMIN_SETTING_CATEGORIES.map((category) => {
    const label = CATEGORY_LABELS[category];
    const matches = settings.filter((setting) => setting.definition.category === category);
    return {
      id: category,
      label: label.label,
      description: label.description,
      setting_count: matches.length,
      pending_count: matches.reduce((total, setting) => total + setting.pending_changes.length, 0),
      override_count: matches.reduce((total, setting) => total + setting.active_overrides.length, 0)
    };
  });
}

async function getSettingChangeById(client: PoolClient, auth: AuthUser, id: string) {
  const rows = await listSettingRows(client, auth);
  const match = rows.find((row) => row.id === id) ?? null;
  if (!match) {
    throw new ApiError(404, "Setting change not found.");
  }
  return match;
}

export async function getAdminSettingsWorkspace(client: PoolClient, auth: AuthUser): Promise<AdminSettingWorkspaceRecord> {
  assertViewAccess(auth);

  const now = new Date();
  const rows = await listSettingRows(client, auth);
  const pendingApprovals = sortByCreatedDesc(rows.filter((row) => row.status === "pending_approval")).slice(0, 12);
  const scheduledFutureChanges = sortByEffectiveDesc(
    rows.filter((row) => row.status === "approved" && new Date(row.effective_at).getTime() > now.getTime())
  ).slice(0, 12);
  const staleOverrides = sortByCreatedDesc(
    rows.filter((row) => {
      if (!row.is_override || row.status !== "approved") {
        return false;
      }
      if (row.expires_at && new Date(row.expires_at).getTime() < now.getTime()) {
        return true;
      }
      return new Date(row.effective_at).getTime() < now.getTime() - 1000 * 60 * 60 * 24 * 90;
    })
  ).slice(0, 12);
  const recentChanges = sortByCreatedDesc(
    rows.filter((row) => ["approved", "pending_approval", "rejected"].includes(row.status))
  ).slice(0, 16);

  const settings = SETTING_DEFINITIONS.map((definition) => {
    const matchingRows = rows.filter((row) => row.setting_key === definition.key);
    const activeApprovedRows = sortByEffectiveDesc(matchingRows.filter((row) => isActiveAt(row, now)));
    const globalValue =
      activeApprovedRows.find((row) => row.scope_type === "global") ?? buildProjectedDefaultSettingValue(definition);
    const activeOverrides = activeApprovedRows.filter((row) => row.scope_type !== "global").slice(0, 10);
    const pendingChanges = sortByCreatedDesc(matchingRows.filter((row) => row.status === "pending_approval")).slice(0, 6);
    const history = sortByCreatedDesc(matchingRows).slice(0, 8);
    return {
      definition: {
        key: definition.key,
        label: definition.label,
        description: definition.description,
        why_it_matters: definition.whyItMatters,
        category: definition.category,
        default_value: definition.defaultValue,
        value_type: definition.valueType,
        allowed_scopes: definition.allowedScopes,
        impacted_modules: definition.impactedModules,
        editor_group: definition.editorGroup,
        protected_change: Boolean(definition.protectedChange),
        override_capable: definition.overrideCapable !== false,
        enum_values: definition.enumValues ?? [],
        help_text: definition.helpText ?? null,
        who_can_edit: humanizeEditorGroup(definition.editorGroup)
      },
      global_value: globalValue,
      active_overrides: activeOverrides,
      pending_changes: pendingChanges,
      history
    };
  });

  const templateSummaries = await loadTemplateSummaries(client, auth);
  const integrationHealthIssues = await loadIntegrationHealthIssues(client, auth);
  const dataHealthWarnings = await loadDataHealthWarnings(client, auth);

  return {
    generated_at: new Date().toISOString(),
    scope_hierarchy: [...ADMIN_SETTING_SCOPE_TYPES],
    summary_strip: buildSummaryStrip({
      settings,
      pendingApprovals,
      scheduledFutureChanges,
      staleOverrides,
      integrationIssues: integrationHealthIssues,
      dataWarnings: dataHealthWarnings,
      recentChanges
    }),
    categories: buildCategorySummaries(settings),
    settings,
    template_summaries: templateSummaries,
    pending_approvals: pendingApprovals,
    scheduled_future_changes: scheduledFutureChanges,
    stale_overrides: staleOverrides,
    recent_changes: recentChanges,
    integration_health_issues: integrationHealthIssues,
    data_health_warnings: dataHealthWarnings
  };
}

export async function previewAdminSettingChange(
  client: PoolClient,
  auth: AuthUser,
  input: AdminSettingPreviewInput
): Promise<AdminSettingPreview> {
  assertManageAccess(auth);
  const definition = getDefinition(input.setting_key);
  if (!definition.allowedScopes.includes(input.scope_type)) {
    throw new ApiError(400, "That scope is not allowed for this setting.");
  }
  validateSettingValue(definition, input.value);
  normalizeScopeId(input.scope_type, input.scope_id);
  return buildImpactPreview(client, auth, definition, input);
}

export async function createAdminSettingChange(
  client: PoolClient,
  auth: AuthUser,
  input: AdminSettingChangeInput
) {
  assertManageAccess(auth);
  const definition = getDefinition(input.setting_key);
  if (!definition.allowedScopes.includes(input.scope_type)) {
    throw new ApiError(400, "That scope is not allowed for this setting.");
  }

  const scopeId = normalizeScopeId(input.scope_type, input.scope_id);
  const value = validateSettingValue(definition, input.value);
  const effectiveAt = input.effective_at ? new Date(input.effective_at) : new Date();
  if (Number.isNaN(effectiveAt.getTime())) {
    throw new ApiError(400, "Effective date is invalid.");
  }
  const expiresAt = input.expires_at ? new Date(input.expires_at) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    throw new ApiError(400, "Expiration date is invalid.");
  }
  if (expiresAt && expiresAt <= effectiveAt) {
    throw new ApiError(400, "Expiration must be after the effective date.");
  }
  if (!input.reason?.trim()) {
    throw new ApiError(400, "A reason is required for admin setting changes.");
  }

  const preview = await buildImpactPreview(client, auth, definition, {
    ...input,
    scope_id: scopeId
  });
  const requiresApproval = getRequiresApproval(definition, auth);
  const status: AdminSettingStatus = requiresApproval ? "pending_approval" : "approved";

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO admin_setting_value (
        tenant_id,
        setting_key,
        setting_category,
        scope_type,
        scope_id,
        scope_label,
        value,
        value_type,
        status,
        requires_approval,
        is_override,
        effective_at,
        expires_at,
        requested_by_user_id,
        approved_by_user_id,
        approved_at,
        reason,
        impact_snapshot,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3::admin_setting_category,
        $4::admin_setting_scope_type,
        $5,
        $6,
        $7::jsonb,
        $8,
        $9::admin_setting_status,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17,
        $18::jsonb,
        $19::jsonb
      )
      RETURNING id
    `,
    [
      auth.tenantId,
      definition.key,
      definition.category,
      input.scope_type,
      scopeId,
      input.scope_label?.trim() || (input.scope_type === "global" ? "Company Default" : null),
      JSON.stringify(value),
      definition.valueType,
      status,
      requiresApproval,
      input.scope_type !== "global",
      effectiveAt.toISOString(),
      expiresAt?.toISOString() ?? null,
      auth.id,
      status === "approved" ? auth.id : null,
      status === "approved" ? new Date().toISOString() : null,
      input.reason.trim(),
      JSON.stringify({
        ...preview.counts,
        impact_summary: preview.impact_summary
      }),
      JSON.stringify({
        editor_group: definition.editorGroup,
        impacted_modules: definition.impactedModules,
        protected_change: Boolean(definition.protectedChange)
      })
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: status === "approved" ? "admin_setting.approved_direct" : "admin_setting.change_requested",
    entityType: "admin_setting_value",
    entityId: rows[0].id,
    reasonComment: input.reason.trim(),
    metadata: {
      setting_key: definition.key,
      category: definition.category,
      scope_type: input.scope_type,
      scope_id: scopeId,
      scope_label: input.scope_label?.trim() || null,
      status,
      requires_approval: requiresApproval
    },
    newValues: {
      value,
      effective_at: effectiveAt.toISOString(),
      expires_at: expiresAt?.toISOString() ?? null
    }
  });

  await writeAuditEvent(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    eventCategory: "admin_configuration",
    eventType: status === "approved" ? "admin_configuration.change_created_and_approved" : "admin_configuration.change_requested",
    resourceType: "admin_setting_value",
    resourceId: rows[0].id,
    result: status,
    context: {
      setting_key: definition.key,
      scope_type: input.scope_type,
      scope_id: scopeId,
      requires_approval: requiresApproval
    },
    newValues: {
      value,
      effective_at: effectiveAt.toISOString(),
      expires_at: expiresAt?.toISOString() ?? null
    }
  });

  return {
    change: await getSettingChangeById(client, auth, rows[0].id),
    preview
  };
}

export async function approveAdminSettingChange(client: PoolClient, auth: AuthUser, changeId: string, note?: string | null) {
  assertApproveAccess(auth);
  const current = await getSettingChangeById(client, auth, changeId);
  if (current.status !== "pending_approval") {
    throw new ApiError(409, "Only pending setting changes can be approved.");
  }

  await client.query(
    `
      UPDATE admin_setting_value
      SET status = 'approved',
          approved_by_user_id = $3,
          approved_at = now(),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, changeId, auth.id]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "admin_setting.change_approved",
    entityType: "admin_setting_value",
    entityId: changeId,
    reasonComment: note?.trim() || current.reason,
    metadata: {
      setting_key: current.setting_key,
      scope_type: current.scope_type,
      scope_id: current.scope_id
    },
    previousValues: {
      status: current.status
    },
    newValues: {
      status: "approved"
    }
  });

  await writeAuditEvent(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    eventCategory: "admin_configuration",
    eventType: "admin_configuration.change_approved",
    resourceType: "admin_setting_value",
    resourceId: changeId,
    result: "approved",
    context: {
      setting_key: current.setting_key,
      scope_type: current.scope_type,
      scope_id: current.scope_id
    },
    oldValues: {
      status: current.status
    },
    newValues: {
      status: "approved"
    }
  });

  return getSettingChangeById(client, auth, changeId);
}

export async function rejectAdminSettingChange(client: PoolClient, auth: AuthUser, changeId: string, note?: string | null) {
  assertApproveAccess(auth);
  const current = await getSettingChangeById(client, auth, changeId);
  if (current.status !== "pending_approval") {
    throw new ApiError(409, "Only pending setting changes can be rejected.");
  }

  await client.query(
    `
      UPDATE admin_setting_value
      SET status = 'rejected',
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, changeId]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "admin_setting.change_rejected",
    entityType: "admin_setting_value",
    entityId: changeId,
    reasonComment: note?.trim() || current.reason,
    metadata: {
      setting_key: current.setting_key,
      scope_type: current.scope_type,
      scope_id: current.scope_id
    },
    previousValues: {
      status: current.status
    },
    newValues: {
      status: "rejected"
    }
  });

  await writeAuditEvent(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    eventCategory: "admin_configuration",
    eventType: "admin_configuration.change_rejected",
    resourceType: "admin_setting_value",
    resourceId: changeId,
    result: "rejected",
    context: {
      setting_key: current.setting_key,
      scope_type: current.scope_type,
      scope_id: current.scope_id
    },
    oldValues: {
      status: current.status
    },
    newValues: {
      status: "rejected"
    }
  });

  return getSettingChangeById(client, auth, changeId);
}

export async function resolveEffectiveAdminSetting(
  client: PoolClient,
  auth: AuthUser,
  settingKey: string,
  scopeContext: RuntimeAdminSettingScopeContext,
  referenceAt = new Date()
) {
  assertViewAccess(auth);
  return resolveEffectiveAdminSettingRow(client, auth.tenantId, settingKey, scopeContext, referenceAt);
}

function matchesRuntimeScopeValue(candidate: string | null, expected: string | readonly string[] | null | undefined) {
  if (expected == null) {
    return candidate == null;
  }
  if (Array.isArray(expected)) {
    return expected.includes(candidate ?? "");
  }
  return candidate === expected;
}

function resolveScopeRank(scopeType: Exclude<AdminSettingScopeType, "global">, candidate: string | null, scopeContext: RuntimeAdminSettingScopeContext) {
  const expected = scopeContext[scopeType];
  if (Array.isArray(expected)) {
    const index = expected.indexOf(candidate ?? "");
    return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
  }
  return 0;
}

async function listRuntimeSettingRows(
  client: PoolClient,
  tenantId: string,
  settingKey: string
): Promise<AdminSettingValueRecord[]> {
  const { rows } = await client.query<AdminSettingRow>(
    `
      SELECT
        asv.id,
        asv.setting_key,
        asv.setting_category::text AS setting_category,
        asv.scope_type::text AS scope_type,
        asv.scope_id,
        asv.scope_label,
        asv.value,
        asv.value_type,
        asv.status::text AS status,
        asv.requires_approval,
        asv.is_override,
        asv.effective_at::text,
        asv.expires_at::text,
        asv.requested_by_user_id,
        asv.approved_by_user_id,
        asv.approved_at::text,
        asv.reason,
        asv.impact_snapshot,
        asv.metadata,
        asv.created_at::text,
        asv.updated_at::text,
        NULL::text AS requested_by_name,
        NULL::text AS approved_by_name
      FROM admin_setting_value asv
      WHERE asv.tenant_id = $1
        AND asv.setting_key = $2
        AND asv.status = 'approved'::admin_setting_status
      ORDER BY asv.created_at DESC
    `,
    [tenantId, settingKey]
  );
  return rows.map(mapSettingRow);
}

async function resolveEffectiveAdminSettingRow(
  client: PoolClient,
  tenantId: string,
  settingKey: string,
  scopeContext: RuntimeAdminSettingScopeContext,
  referenceAt = new Date()
) {
  const definition = getDefinition(settingKey);
  const rows = (await listRuntimeSettingRows(client, tenantId, definition.key))
    .filter((row) => isActiveAt(row, referenceAt))
    .filter((row) => {
      if (row.scope_type === "global") {
        return true;
      }
      return matchesRuntimeScopeValue(
        row.scope_id,
        scopeContext[row.scope_type as Exclude<AdminSettingScopeType, "global">] ?? null
      );
    })
    .sort((left, right) => {
      const scopeDelta = SCOPE_PRECEDENCE[right.scope_type] - SCOPE_PRECEDENCE[left.scope_type];
      if (scopeDelta !== 0) {
        return scopeDelta;
      }
      if (left.scope_type !== "global" && right.scope_type !== "global") {
        const leftRank = resolveScopeRank(left.scope_type, left.scope_id, scopeContext);
        const rightRank = resolveScopeRank(right.scope_type, right.scope_id, scopeContext);
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
      }
      return new Date(right.effective_at).getTime() - new Date(left.effective_at).getTime();
    });
  return rows[0] ?? null;
}

export async function resolveRuntimeAdminSettingValue<TValue = unknown>(
  client: PoolClient,
  tenantId: string,
  settingKey: string,
  scopeContext: RuntimeAdminSettingScopeContext,
  referenceAt = new Date()
): Promise<TValue> {
  const definition = getDefinition(settingKey);
  const row = await resolveEffectiveAdminSettingRow(client, tenantId, settingKey, scopeContext, referenceAt);
  return validateSettingValue(definition, row?.value ?? definition.defaultValue) as TValue;
}
