// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../pages/Dashboard";
import { CustomerService } from "../pages/CustomerService";
import { Scheduling } from "../pages/Scheduling";
import { Schedule } from "../pages/Schedule";
import { LiveShoots } from "../pages/LiveShoots";
import { Attendance } from "../pages/Attendance";
import { Labor } from "../pages/Labor";
import { Reports } from "../pages/Reports";
import { StatusBoard } from "../pages/StatusBoard";
import { OutlookIntegration } from "../pages/OutlookIntegration";
import { ShootLocations } from "../pages/ShootLocations";
import { Training } from "../pages/Training";
import type { ComplianceWorkspaceListPayload } from "../complianceTypes";
import type {
  AttendanceExceptionRecord,
  AttendanceOperationDetailRecord,
  AttendanceOperationsWorkspaceRecord,
  EmployeeTrainingProfile,
  HomeDashboardResponse,
  LeadershipReportDetail,
  LeadershipReportsIndex,
  LiveShootQueueResponse,
  ManagerCockpitResponse,
  IntegrationGovernancePayload,
  LocationCatalogResponse,
  OrganizationDetail,
  ShootLocationDetail,
  OperationsDashboard,
  OutlookCalendar,
  OutlookCalendarEvent,
  OutlookCalendarStatusPayload,
  ReportingDeliveryCenter,
  SessionUser,
  ShootDetail,
  ShootSummary,
  TrainingCatalogResponse,
  TrainingDashboardSnapshot,
  TrainingEmployeeSummary,
  TrainingQuizQuestion,
  TrainingQuizRoundResponse,
  TrainingQuizSubmitResponse,
  UnifiedScheduleBoardResponse,
  UnifiedScheduleCalendarResponse,
  ShiftRecord,
  ShootStaffingSnapshot,
  StaffingDashboardResponse,
  ZendeskLeadershipSummary,
  ZendeskLeadershipTicketList,
  ZendeskLeadershipTrends,
  ZendeskStatusPayload
} from "../types";

const apiFetchMock = vi.fn();

const standardSessionTrust = {
  identityProvider: "local_password" as const,
  sessionAssurance: "standard" as const,
  requestTransport: "bearer" as const,
  elevatedUntil: null,
  privilegedModeUntil: null,
  breakGlassStartedAt: null,
  breakGlassUntil: null,
  breakGlassReason: null,
  breakGlassScopeType: null,
  breakGlassScopeId: null,
  elevatedSessionActive: false,
  privilegedModeActive: false,
  breakGlassModeActive: false
};

vi.mock(import("../api"), async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetchMock(...args),
    apiUrl: "http://localhost:4000"
  };
});

const leadershipUser: SessionUser = {
  id: "user-leadership",
  tenantId: "tenant-demo",
  accountId: "account-leadership",
  sessionId: "session-demo",
  email: "leadership@example.com",
  fullName: "Demo Leadership",
  status: "active",
  department: "operations",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["leadership"],
  permissions: [
    "dashboard.read",
    "shoot.create",
    "shoot.read",
    "schedule.read",
    "schedule.manage",
    "schedule.publish",
    "attendance.read",
    "attendance.manage",
    "alerts.read",
    "trade.approve",
    "user.read",
    "audit.read"
  ],
  authorityTier: "leadership",
  primaryJobFunctionProfile: "leadership_team_member",
  jobFunctionProfiles: ["leadership_team_member"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust: standardSessionTrust
};

const fieldScheduleUser: SessionUser = {
  id: "user-photo",
  tenantId: "tenant-demo",
  accountId: "account-photo",
  sessionId: "session-photo",
  email: "photo@example.com",
  fullName: "Demo Photographer",
  status: "active",
  department: "schools",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["photographer"],
  permissions: ["schedule.read", "time.clock", "trade.request", "media.attach"],
  authorityTier: "standard_employee",
  primaryJobFunctionProfile: "associate_photographer",
  jobFunctionProfiles: ["associate_photographer"],
  permissionGrants: [],
  effectiveScopes: ["self_only"],
  sessionTrust: standardSessionTrust
};

const disconnectedScheduleIntegration = {
  provider: "outlook" as const,
  link_state: "not_linked" as const,
  sync_state: "not_linked" as const,
  sync_required: false,
  sync_health: "neutral" as const,
  last_synced_at: null,
  last_sync_direction: "none" as const,
  last_sync_error: null,
  manual_review_required: false,
  review_reason: null,
  changed_fields: [],
  changed_field_labels: [],
  external_last_modified_at: null,
  external_record_id: null,
  external_calendar_id: null,
  source_system: null,
  source_of_truth: "Mission Control owns this record until a leader explicitly links or pushes it to Outlook.",
  pending_external_changes: false,
  stale_data_warning: false,
  recommended_next_action: null
};

const mondayCoexistingIntegration = {
  provider: "monday" as const,
  link_state: "linked" as const,
  migration_state: "coexisting" as const,
  last_synced_at: "2026-03-24T14:10:00.000Z",
  monday_item_id: "monday-item-1",
  monday_item_url: null,
  externally_controlled_fields: ["Legacy workflow state", "Automation checkpoints", "Historical board metadata"],
  source_label: "Monday still owns part of this legacy workflow.",
  warnings: ["This location still depends on Monday-linked history for part of its operational context."]
};

const mondayPartialIntegration = {
  ...mondayCoexistingIntegration,
  migration_state: "partially_migrated" as const,
  source_label: "Mission Control and Monday are coexisting on this record.",
  warnings: [
    "Mission Control is adding new field context here, but some workflow checkpoints still come from Monday.",
    "Edit only Mission Control-owned notes here until the legacy board ownership transfers."
  ]
};

const operationsDashboard: OperationsDashboard = {
  summary: {
    all_shoots_today: 2,
    scheduled_employees: 4,
    clocked_in_employees: 2,
    late_employees: 1,
    no_shows: 0,
    excused_exceptions: 1,
    unscheduled_punches: 1,
    out_of_bounds_punches: 0,
    studio_staff_on_shift: 1,
    scheduled_labor_hours: 16,
    actual_labor_hours: 12.5
  },
  shoots: [
    {
      scope_id: "shoot-1",
      scope_code: "DEMO-001",
      scope_title: "Spring Portrait Day",
      projected_students: 48,
      scheduled_employees: 3,
      scheduled_hours: 8,
      actual_hours: 6.5,
      rigorous_shoot_score: 1.35
    }
  ],
  shifts: [
    {
      id: "shift-1",
      assigned_user_id: "user-photo",
      assigned_user_name: "Demo Photographer",
      manager_user_id: "user-senior",
      manager_name: "Demo Senior Photographer",
      shoot_id: "shoot-1",
      shoot_code: "DEMO-001",
      shoot_title: "Spring Portrait Day",
      shift_kind: "shoot",
      status: "published",
      department: "schools",
      title: "Portrait Coverage",
      starts_at: "2026-03-24T14:00:00.000Z",
      ends_at: "2026-03-24T18:00:00.000Z",
      location_name: "Main Gym",
      location_address: "123 School Street",
      scheduled_hours: 4,
      actual_hours: 2.5,
      punch_in_count: 1,
      open_exception_count: 0,
      latest_punch_direction: "in",
      latest_punch_at: "2026-03-24T14:03:00.000Z",
      latest_approval_state: "not_required",
      segments: [],
      punches: []
    }
  ],
  reporting: {
    labor: [
      {
        assigned_user_id: "user-photo",
        assigned_user_name: "Demo Photographer",
        department: "schools",
        manager_name: "Demo Senior Photographer",
        shift_count: 1,
        clocked_in_shift_count: 1,
        scheduled_hours: 4,
        actual_hours: 2.5,
        labor_delta_hours: -1.5,
        open_exception_count: 0
      }
    ],
    punches: [],
    exceptions: [],
    payroll: []
  }
};

const sharedHomeDashboardResponse = {
  scope: "home",
  department_type: null,
  summary: {
    jobs_today: 4,
    jobs_next_7_days: 11,
    urgent_count: 3,
    critical_watch_count: 1,
    high_watch_count: 2,
    blocked_production_count: 2,
    overdue_approval_count: 1,
    delivery_risk_count: 1,
    staffing_gap_count: 2,
    missing_ready_confirmation_count: 1,
    overdue_checklist_count: 1,
    awaiting_checklist_approval_count: 0,
    rejected_checklist_count: 0,
    blocked_job_count: 1
  },
  health: {
    score: 68,
    state: "at_risk",
    explanation: ["Blocked production and same-day staffing gaps are driving pressure."]
  },
  widgets: [
    {
      widget_key: "urgent_watch_next_24h",
      title: "Exceptions",
      metric: "3",
      description: "High-severity work due in the next 24 hours.",
      route_hash: "#exceptions",
      tone: "danger",
      count: 3
    }
  ],
  widget_layout: {
    role_key: "leadership",
    supports_personalization: true,
    items: [
      {
        widget_key: "urgent_watch_next_24h",
        required: true,
        default_visible: true,
        default_position: 0,
        reason: "Leadership needs exceptions pinned on Home."
      }
    ]
  },
  urgent_watch: [],
  checklist_attention_summary: {
    total_count: 0,
    overdue_count: 0,
    awaiting_approval_count: 0,
    rejected_count: 0,
    blocked_count: 0,
    missing_proof_count: 0,
    assigned_to_me_count: 0
  },
  checklist_attention: [],
  upcoming_risks: [],
  today_jobs: [],
  blocked_production: [],
  overdue_approvals: [],
  delivery_risks: [],
  my_open_flags: [],
  recent_movement: [],
  workload_pressure: [],
  production_snapshot: null
};

const sharedAlertsResponse = {
  summary: {
    unread_count: 0,
    critical_count: 0,
    acted_count: 0
  },
  items: []
};

const sharedJobsResponse = {
  jobs: []
};

const shootSummaries: ShootSummary[] = [
  {
    id: "shoot-1",
    studio_id: "studio-1",
    department: "schools",
    shoot_type: "schools_underclass_portraits",
    shoot_code: "DEMO-001",
    title: "Spring Portrait Day",
    shoot_date: "2026-03-24",
    organization_id: "org-1",
    organization_display_name: "White Bear Lake High School",
    organization_account_type: "schools_underclass_portraits",
    location_id: "location-1",
    location_name: "Main Gym",
    location_address: "123 School Street",
    navigation_url: "https://maps.example/main-gym",
    estimated_drive_minutes: 18,
    arrival_time: "2026-03-24T14:00:00.000Z",
    start_time: "2026-03-24T15:00:00.000Z",
    end_time_est: "2026-03-24T18:00:00.000Z",
    projected_students: 48,
    status: "READY",
    normalized_status: "READY",
    status_display: "Ready",
    ready_eligible: true,
    readiness_summary: "Ready Eligible",
    readiness_requirements: [
      { key: "lead_assigned", label: "Lead assigned", complete: true, required: true },
      { key: "staffing_threshold", label: "Minimum staffing threshold met", complete: true, required: true },
      { key: "location_schedule_confirmed", label: "Location and schedule confirmed", complete: true, required: true }
    ],
    operational_flags: [],
    primary_contact_id: "contact-1",
    primary_contact_name: "Jamie Carlson",
    primary_contact_phone: "555-0188",
    primary_contact_email: "jamie.carlson@example.com",
    additional_contact_ids: ["contact-2"],
    additional_contacts: [
      {
        id: "contact-2",
        full_name: "Megan Stark",
        title: "Main Office",
        phone: "555-0155",
        email: "office.whitebear@example.com"
      }
    ],
    scheduled_employee_count: 3,
    clocked_in_employee_count: 1,
    open_attendance_exception_count: 0
  },
  {
    id: "shoot-2",
    studio_id: "studio-1",
    department: "sports",
    shoot_type: "sports",
    shoot_code: "DEMO-002",
    title: "Friday Night Lights Media Day",
    shoot_date: "2026-03-24",
    organization_id: "org-2",
    organization_display_name: "North Metro Athletics",
    organization_account_type: "sports",
    location_id: "location-2",
    location_name: "North Metro Stadium",
    location_address: "2500 Stadium Drive, Plymouth, MN",
    navigation_url: "https://maps.example/north-metro-stadium",
    estimated_drive_minutes: 32,
    arrival_time: "2026-03-24T17:00:00.000Z",
    start_time: "2026-03-24T18:00:00.000Z",
    end_time_est: "2026-03-24T21:00:00.000Z",
    projected_students: 96,
    status: "CONFIRMED",
    normalized_status: "CONFIRMED",
    status_display: "Confirmed",
    ready_eligible: false,
    readiness_summary: "Needs attention before Ready",
    lead_confirmed_ready: false,
    lead_confirmed_ready_at: null,
    lead_confirmed_ready_by_name: null,
    lead_confirmed_ready_exception_flag: false,
    ready_to_shoot_status: "escalation_due",
    ready_to_shoot_label: "Lead confirmation overdue",
    ready_to_shoot_tone: "action_needed",
    readiness_requirements: [
      { key: "lead_assigned", label: "Lead assigned", complete: false, required: true, detail: "Lead-qualified coverage is still open." },
      { key: "staffing_threshold", label: "Minimum staffing threshold met", complete: false, required: true, detail: "Three staffing slots are still open." },
      { key: "location_schedule_confirmed", label: "Location and schedule confirmed", complete: true, required: true },
      { key: "contact_present", label: "Account or school contact present", complete: true, required: true },
      { key: "pre_service_notes", label: "Required pre-service notes complete", complete: false, required: true, detail: "Pre-service notes still need confirmation." },
      { key: "special_deliverables", label: "Special deliverables documented", complete: true, required: false },
      { key: "gear_requirements", label: "Gear requirements assigned", complete: false, required: false, detail: "Field lights and tether station still need assignment." },
      { key: "roster_data_ready", label: "Roster or data ready", complete: false, required: false, detail: "Roster import is still pending." }
    ],
    readiness_blocking_keys: ["lead_assigned", "staffing_threshold", "pre_service_notes"],
    operational_flags: [
      { code: "missing_lead", label: "Missing lead", tone: "critical", detail: "Lead-qualified coverage is still open." },
      { code: "understaffed", label: "Understaffed", tone: "critical", detail: "Three staffing slots are still open." },
      { code: "due_in_24_hours", label: "Due in 24 hours", tone: "warning", detail: "This shoot starts tonight." }
    ],
    primary_contact_id: "contact-3",
    primary_contact_name: "Coach Riley Hart",
    primary_contact_phone: "555-0142",
    primary_contact_email: "riley.hart@example.com",
    additional_contact_ids: [],
    additional_contacts: [],
    scheduled_employee_count: 2,
    clocked_in_employee_count: 0,
    open_attendance_exception_count: 1
  },
  {
    id: "shoot-3",
    studio_id: "studio-1",
    department: "events",
    shoot_type: "events",
    shoot_code: "DEMO-003",
    title: "District Awards Banquet",
    shoot_date: "2026-03-27",
    organization_id: "org-3",
    organization_display_name: "District Events Office",
    organization_account_type: "events",
    location_id: "location-3",
    location_name: "",
    location_address: "890 Grand Hall Way, St. Paul, MN",
    navigation_url: null,
    estimated_drive_minutes: null,
    arrival_time: null,
    start_time: null,
    end_time_est: "2026-03-27T23:00:00.000Z",
    projected_students: null,
    primary_contact_id: "contact-4",
    primary_contact_name: "Pat Monroe",
    scheduled_employee_count: 0,
    clocked_in_employee_count: 0,
    open_attendance_exception_count: 0
  }
];

const liveShootQueueResponse: LiveShootQueueResponse = {
  date: "2026-03-24",
  date_from: null,
  date_to: null,
  generated_at: "2026-03-24T18:30:00.000Z",
  summary: {
    in_view: 3,
    needs_staffing: 0,
    needs_review: 1,
    unscheduled: 1,
    scheduled: 1,
    completed: 0
  },
  sections: [
    {
      id: "needs_staffing",
      title: "Needs Staffing",
      summary: "Lead coverage or planned headcount is still open.",
      empty_state: "No shoots are waiting on staffing coverage right now.",
      items: []
    },
    {
      id: "needs_review",
      title: "Needs Review",
      summary: "Exceptions, sync concerns, or readiness warnings need leadership eyes.",
      empty_state: "No shoots are waiting on review right now.",
      items: [
        {
          shoot: shootSummaries[1],
          bucket: "needs_review",
          bucket_label: "Needs Review",
          status_label: "Needs Review",
          status_tone: "warning",
          next_action: "Review same-day exceptions",
          key_flags: [{ code: "attendance_exception", label: "1 attendance issue", tone: "warning" }],
          staffing_summary: {
            label: "Staff 2/2",
            tone: "success",
            assigned_count: 2,
            planned_count: 2,
            gap_count: 0,
            lead_missing: false,
            staffing_state: "staffed",
            publish_state: "ready_to_publish"
          },
          sync_summary: {
            label: "Mission Control only",
            tone: "info",
            schedule_sync_state: null,
            schedule_sync_required: false,
            manual_review_required: false,
            has_error: false,
            link_state: null
          },
          summary_string: "Arrival 11:00 AM | Shoot 12:00 PM - 3:00 PM | North Metro Stadium",
          owner_label: "Contact Coach Riley Hart"
        }
      ]
    },
    {
      id: "unscheduled",
      title: "Unscheduled",
      summary: "Core timing or location details are still incomplete.",
      empty_state: "No unscheduled shoots are in view for this date.",
      items: [
        {
          shoot: shootSummaries[2],
          bucket: "unscheduled",
          bucket_label: "Unscheduled",
          status_label: "Unscheduled",
          status_tone: "warning",
          next_action: "Set timing and publish details",
          key_flags: [],
          staffing_summary: {
            label: "0 assigned",
            tone: "success",
            assigned_count: 0,
            planned_count: 0,
            gap_count: 0,
            lead_missing: false,
            staffing_state: null,
            publish_state: "draft"
          },
          sync_summary: {
            label: "Mission Control only",
            tone: "info",
            schedule_sync_state: null,
            schedule_sync_required: false,
            manual_review_required: false,
            has_error: false,
            link_state: null
          },
          summary_string: "Time pending | Ends 6:00 PM | 890 Grand Hall Way",
          owner_label: "District Events Office"
        }
      ]
    },
    {
      id: "scheduled",
      title: "Scheduled",
      summary: "Cleanly scheduled shoots that are ready for operational follow-through.",
      empty_state: "No fully scheduled shoots are in view right now.",
      items: [
        {
          shoot: shootSummaries[0],
          bucket: "scheduled",
          bucket_label: "Scheduled",
          status_label: "Scheduled",
          status_tone: "info",
          next_action: "Open operational workspace",
          key_flags: [],
          staffing_summary: {
            label: "Staff 3/3",
            tone: "success",
            assigned_count: 3,
            planned_count: 3,
            gap_count: 0,
            lead_missing: false,
            staffing_state: "staffed",
            publish_state: "published"
          },
          sync_summary: {
            label: "Linked to Outlook",
            tone: "info",
            schedule_sync_state: "linked",
            schedule_sync_required: false,
            manual_review_required: false,
            has_error: false,
            link_state: "linked"
          },
          summary_string: "Arrival 8:00 AM | Shoot 9:00 AM - 12:00 PM | Main Gym",
          owner_label: "White Bear Lake High School"
        }
      ]
    },
    {
      id: "completed",
      title: "Completed / Archived",
      summary: "Wrapped, completed, canceled, or otherwise historical shoots stay here for review.",
      empty_state: "No completed or archived shoots are in view for this date.",
      items: []
    }
  ]
};

const managerCockpitResponse: ManagerCockpitResponse = {
  generated_at: "2026-03-24T18:30:00.000Z",
  anchor_date: "2026-03-24",
  headline: "Manager action queue",
  summary: {
    total_open: 8,
    needs_staffing: 1,
    needs_contact_cleanup: 1,
    needs_approval: 1,
    needs_follow_up: 1,
    needs_project_setup: 1,
    needs_project_follow_up: 1,
    overdue_project_tasks: 1,
    needs_payroll_compliance_review: 1
  },
  queues: [
    {
      id: "needs_staffing",
      label: "Needs Staffing",
      summary: "Shoots with open staffing pressure or missing lead coverage.",
      count: 1,
      items: [
        {
          id: "shoot:shoot-2",
          entity_kind: "shoot",
          entity_id: "shoot-2",
          organization_id: "org-2",
          shoot_id: "shoot-2",
          title: "Friday Night Lights Media Day",
          summary: "Arrival 11:00 AM | Shoot 12:00 PM - 3:00 PM | North Metro Stadium",
          owner_label: "Contact Coach Riley Hart",
          due_label: "Shoot 2026-03-24",
          status_label: "Needs Staffing",
          status_tone: "critical",
          next_action: "Fill staffing slots",
          action_hash: "#shoots",
          flags: [{ label: "1 open slot", tone: "critical" }]
        }
      ]
    },
    {
      id: "needs_contact_cleanup",
      label: "Needs Contact Cleanup",
      summary: "Accounts with primary-owner, duplicate, or location-contact gaps.",
      count: 1,
      items: [
        {
          id: "contact_cleanup:org-1",
          entity_kind: "organization",
          entity_id: "org-1",
          organization_id: "org-1",
          shoot_id: "shoot-1",
          title: "White Bear Lake High School",
          summary: "1 duplicate review | 1 location contact gap",
          owner_label: "Primary Jamie Carlson",
          due_label: "Next shoot Mar 24",
          status_label: "Needs Contact Cleanup",
          status_tone: "warning",
          next_action: "Resolve contact and relationship gaps",
          action_hash: "#organizations?view=organizations&organization=org-1&tab=operations",
          flags: [
            { label: "1 duplicate review", tone: "info" },
            { label: "1 location contact gap", tone: "warning" }
          ]
        }
      ]
    },
    {
      id: "needs_approval",
      label: "Needs Approval",
      summary: "Pending approval work that still needs leadership review.",
      count: 1,
      items: [
        {
          id: "approval-1",
          entity_kind: "approval_request",
          entity_id: "approval-1",
          organization_id: null,
          shoot_id: null,
          title: "Grant Privileged Access",
          summary: "Approve a privileged access change.",
          owner_label: "Demo Leadership",
          due_label: "Opened Mar 24",
          status_label: "Pending Approval",
          status_tone: "warning",
          next_action: "Review the approval request",
          action_hash: "#approvals",
          flags: [{ label: "Grant Privileged Access", tone: "warning" }]
        }
      ]
    },
    {
      id: "needs_follow_up",
      label: "Needs Follow-Up",
      summary: "Accounts that need outreach, follow-up logging, or next-step confirmation.",
      count: 1,
      items: [
        {
          id: "follow_up:org-1",
          entity_kind: "organization",
          entity_id: "org-1",
          organization_id: "org-1",
          shoot_id: "shoot-1",
          title: "White Bear Lake High School",
          summary: "The next shoot is coming up and the relationship trail needs a fresher touchpoint.",
          owner_label: "Demo Leadership",
          due_label: "Before Mar 24",
          status_label: "Needs Follow-Up",
          status_tone: "warning",
          next_action: "Log outreach and confirm the next step",
          action_hash: "#organizations?view=organizations&organization=org-1&tab=operations",
          flags: [{ label: "Upcoming shoot outreach gap", tone: "warning" }]
        }
      ]
    },
    {
      id: "needs_payroll_compliance_review",
      label: "Needs Payroll / Compliance Review",
      summary: "Unresolved payroll blockers and compliance review work.",
      count: 1,
      items: [
        {
          id: "compliance-1",
          entity_kind: "compliance_review",
          entity_id: "compliance-1",
          organization_id: "org-1",
          shoot_id: "shoot-1",
          title: "Demo Photographer",
          summary: "Missing post-shoot evaluation is blocking payroll closeout.",
          owner_label: "White Bear Lake High School",
          due_label: "Payroll blocking",
          status_label: "Missing Post-Shoot Evaluation",
          status_tone: "critical",
          next_action: "Review compliance item",
          action_hash: "#compliance",
          flags: [{ label: "Payroll blocking", tone: "critical" }]
        }
      ]
    },
    {
      id: "needs_project_setup",
      label: "Needs Production Setup",
      summary: "Triggered production work that still needs ownership, timing, or kickoff clarity.",
      count: 1,
      items: [
        {
          id: "project_setup:project-1",
          entity_kind: "project",
          entity_id: "project-1",
          organization_id: "org-1",
          shoot_id: "shoot-1",
          title: "Post-Shoot Production Wrap",
          summary: "The post-shoot wrap project still needs an owner and kickoff confirmation.",
          owner_label: "Owner unassigned",
          due_label: "Created Mar 24",
          status_label: "Needs Setup",
          status_tone: "warning",
          next_action: "Assign an owner and confirm the kickoff path",
          action_hash: "#production?project=project-1&queue=needs_setup",
          flags: [
            { label: "Owner missing", tone: "warning" },
            { label: "Triggered from shoot completion", tone: "info" }
          ]
        }
      ]
    },
    {
      id: "needs_project_follow_up",
      label: "Needs Production Follow-Up",
      summary: "Production work that has a follow-up date due or needs a response loop closed.",
      count: 1,
      items: [
        {
          id: "project_follow_up:project-2",
          entity_kind: "project",
          entity_id: "project-2",
          organization_id: "org-2",
          shoot_id: "shoot-2",
          title: "Issue Remediation Review",
          summary: "A flagged post-shoot issue still needs leadership follow-up.",
          owner_label: "Demo Leadership",
          due_label: "Due Mar 24",
          status_label: "Needs Follow-Up",
          status_tone: "warning",
          next_action: "Confirm the remediation plan and next checkpoint",
          action_hash: "#production?project=project-2&queue=needs_follow_up",
          flags: [{ label: "Follow-up due", tone: "warning" }]
        }
      ]
    },
    {
      id: "overdue_project_tasks",
      label: "Overdue Production Tasks",
      summary: "Project checklists with task work already past due.",
      count: 1,
      items: [
        {
          id: "project_overdue:project-3",
          entity_kind: "project",
          entity_id: "project-3",
          organization_id: "org-1",
          shoot_id: "shoot-1",
          title: "Resource Review Follow-Up",
          summary: "A production checklist item for resource review is now overdue.",
          owner_label: "Demo Senior Photographer",
          due_label: "Overdue since Mar 22",
          status_label: "Overdue Task",
          status_tone: "critical",
          next_action: "Clear the overdue checklist item",
          action_hash: "#production?project=project-3&queue=overdue_tasks",
          flags: [{ label: "1 overdue checklist item", tone: "critical" }]
        }
      ]
    }
  ]
};

const dashboardWorkflowCompliance: ComplianceWorkspaceListPayload = {
  summary: {
    open_count: 3,
    payroll_blocking_count: 1,
    mileage_blocking_count: 1,
    missing_closeout_count: 2,
    unresolved_end_of_day_confirmation_count: 0,
    missed_clock_in_review_count: 0,
    no_lunch_review_count: 0,
    off_clock_upload_review_count: 0,
    presence_incident_review_count: 0,
    counts_by_issue_type: {
      missing_setup_photo: 0,
      missing_post_shoot_evaluation: 1,
      mileage_blocked_missing_post_shoot_evaluation: 1,
      upload_while_off_clock: 0,
      unresolved_end_of_day_confirmation: 0,
      no_lunch_challenge: 0,
      missed_clock_in_request: 0,
      likely_present_missing_clock_in: 0,
      assigned_but_missing: 0
    }
  },
  filters: {
    employees: [{ id: "user-photo", name: "Demo Photographer" }],
    organizations: [{ id: "org-1", name: "White Bear Lake High School" }],
    shoots: [{ id: "shoot-1", title: "Spring Portrait Day" }],
    issue_types: [{ id: "missing_post_shoot_evaluation", label: "Missing Post-Shoot Evaluation" }]
  },
  rows: [
    {
      id: "workflow-compliance-1",
      source_kind: "compliance_flag",
      source_id: "flag-1",
      issue_type: "missing_post_shoot_evaluation",
      issue_label: "Missing Post-Shoot Evaluation",
      urgency: "urgent",
      source_status: "open",
      status_bucket: "unresolved",
      message: "Post-shoot follow-through is still missing for this assignment.",
      employee_id: "user-photo",
      employee_name: "Demo Photographer",
      shift_id: "shift-1",
      shift_title: "Portrait Coverage",
      session_id: null,
      shoot_id: "shoot-1",
      shoot_code: "DEMO-001",
      shoot_title: "Spring Portrait Day",
      organization_id: "org-1",
      organization_display_name: "White Bear Lake High School",
      location_id: "location-1",
      location_name: "Main Gym",
      linked_exception_request_id: null,
      linked_attendance_exception_id: null,
      payroll_blocking: true,
      mileage_blocking: true,
      missing_closeout: true,
      unresolved_end_of_day_confirmation: false,
      blocker: {
        state: "payroll_blocked",
        label: "Payroll Blocked",
        summary: "Post-shoot follow-through is still missing before payroll confidence is restored.",
        owning_workspace_label: "Compliance",
        owning_workspace_hash: "#employees/compliance"
      },
      occurred_at: "2026-03-24T19:00:00.000Z",
      updated_at: "2026-03-24T19:05:00.000Z",
      resolved_at: null,
      resolution_note: null
    }
  ]
};

const trainingSummaries: TrainingEmployeeSummary[] = [
  {
    identity: {
      id: "user-photo",
      email: "photo@example.com",
      full_name: "Demo Photographer",
      department: "schools",
      roles: ["associate_photographer"],
      employment_status: "active"
    },
    readiness_state: "cleared_with_oversight",
    readiness_note: "Ready for a school shoot with senior oversight still assigned.",
    onboarding_stage: "Field shadowing",
    workbook_progress_percent: 72,
    required_progress_percent: 80,
    optional_progress_percent: 35,
    overdue_module_count: 1,
    needs_signoff: true,
    next_module_title: "Equipment Setup and Safety"
  }
];

const trainingSnapshot: TrainingDashboardSnapshot = {
  org_completion_percent: 78,
  required_completion_percent: 84,
  optional_completion_percent: 52,
  overdue_module_count: 3,
  not_cleared_count: 1,
  oversight_count: 2,
  retraining_required_count: 0,
  new_hires_in_onboarding: 1,
  recent_completions: [
    {
      employee_name: "Demo Photographer",
      module_title: "What Great Looks Like on Picture Day",
      completed_at: "2026-03-23T18:10:00.000Z"
    }
  ],
  recent_quiz_scores: [
    {
      employee_name: "Demo Photographer",
      score_percent: 80,
      played_at: "2026-03-24T13:45:00.000Z"
    }
  ],
  recent_signoffs: [
    {
      employee_name: "Demo Photographer",
      module_title: "Running the School Day Flow",
      signed_off_by: "Demo Leadership",
      signed_off_at: "2026-03-23T20:00:00.000Z"
    }
  ],
  most_overdue_modules: [
    {
      employee_name: "Demo Photographer",
      module_title: "Equipment Setup and Safety",
      due_at: "2026-03-20T12:00:00.000Z",
      readiness_state: "cleared_with_oversight"
    }
  ],
  completion_by_team: [
    {
      team: "schools",
      completion_percent: 82,
      cleared_count: 4,
      total_count: 5
    }
  ]
};

const trainingProfile: EmployeeTrainingProfile = {
  employee: trainingSummaries[0].identity,
  assigned_learning_path: "School Photographer Workbook",
  onboarding_stage: "Field shadowing",
  readiness_state: "cleared_with_oversight",
  readiness_note: "Ready for supervised school coverage while equipment setup is still being signed off.",
  workbook_progress_percent: 72,
  required_progress_percent: 80,
  optional_progress_percent: 35,
  manager_signoff_status: "pending",
  modules: [
    {
      module_id: "module-company-standards",
      status: "completed",
      progress_percent: 100,
      due_at: null,
      last_started_at: "2026-03-20T12:00:00.000Z",
      completed_at: "2026-03-21T12:00:00.000Z",
      best_score: 100,
      signoff_status: "not_required",
      acknowledgement_complete: true,
      version_completed: "2026.1"
    },
    {
      module_id: "module-equipment-setup",
      status: "in_progress",
      progress_percent: 60,
      due_at: "2026-03-26T17:00:00.000Z",
      last_started_at: "2026-03-24T10:00:00.000Z",
      completed_at: null,
      best_score: 60,
      signoff_status: "pending",
      acknowledgement_complete: false,
      version_completed: null
    }
  ],
  quiz_history: [],
  checkpoints: [
    {
      checkpoint_id: "checkpoint-setup-safety",
      status: "attention",
      notes: "Needs one more supervised setup."
    }
  ],
  acknowledgements: [
    {
      acknowledgement_id: "ack-greeting-standard",
      acknowledged: true,
      acknowledged_at: "2026-03-21T12:00:00.000Z"
    },
    {
      acknowledgement_id: "ack-safety-standard",
      acknowledged: false
    }
  ],
  last_completed_at: "2026-03-21T12:00:00.000Z",
  oversight_note: "Pair with a senior photographer for the next school gym setup."
};

const trainingCatalog: TrainingCatalogResponse = {
  workbook: {
    id: "workbook-school-photographer",
    title: "School Photographer Workbook",
    summary: "Operational readiness catalog for field teams.",
    version: "2026.1",
    updated_at: "2026-03-24T12:00:00.000Z",
    sections: [
      {
        id: "company-standards",
        title: "Company Standards",
        summary: "Service and field standards.",
        sort_order: 1,
        module_ids: ["module-company-standards"]
      },
      {
        id: "equipment-setup",
        title: "Equipment Setup",
        summary: "Setup, safety, and test-frame discipline.",
        sort_order: 2,
        module_ids: ["module-equipment-setup"]
      }
    ]
  },
  modules: [
    {
      id: "module-company-standards",
      section_id: "company-standards",
      title: "What Great Looks Like on Picture Day",
      summary: "Kemmetmueller field standards and guest experience guidance.",
      estimated_minutes: 18,
      required: true,
      signoff_required: false,
      last_updated: "2026-03-18T15:00:00.000Z",
      version: "2026.1",
      content_blocks: [
        {
          id: "company-overview",
          type: "overview",
          title: "Operational hospitality",
          body: "Families remember how the team made them feel as much as the photo itself."
        }
      ],
      checkpoint_ids: ["checkpoint-arrival-standards"],
      acknowledgement_ids: ["ack-greeting-standard"],
      question_ids: ["q-greet-school"]
    },
    {
      id: "module-equipment-setup",
      section_id: "equipment-setup",
      title: "Equipment Setup and Safety",
      summary: "Safe setup sequencing and test-frame discipline.",
      estimated_minutes: 24,
      required: true,
      signoff_required: true,
      last_updated: "2026-03-10T20:00:00.000Z",
      version: "2026.1",
      content_blocks: [
        {
          id: "setup-checklist",
          type: "checklist",
          title: "Before the first frame",
          body: "Leadership wants this sequence to feel automatic.",
          bullets: ["Weights on every stand", "Cable lane protected", "Test frame reviewed"]
        }
      ],
      checkpoint_ids: ["checkpoint-setup-safety"],
      acknowledgement_ids: ["ack-safety-standard"],
      question_ids: ["q-weights-first"]
    }
  ],
  acknowledgements: [
    {
      id: "ack-greeting-standard",
      module_id: "module-company-standards",
      title: "Greeting standard",
      summary: "I understand that warmth and professionalism are part of the job standard."
    },
    {
      id: "ack-safety-standard",
      module_id: "module-equipment-setup",
      title: "Setup safety",
      summary: "I will weight stands, protect walking lanes, and stop a setup that feels unsafe."
    }
  ]
};

const trainingRoundQuestions: TrainingQuizQuestion[] = [
  {
    id: "q-greet-school",
    module_id: "module-company-standards",
    roles: ["associate_photographer"],
    prompt: "What should happen first when you arrive at the school?",
    scenario: "You arrive on time and the office contact is waiting near the gym.",
    choices: [
      {
        id: "q-greet-school-a",
        label: "Introduce yourself, confirm the plan, and then unload.",
        correct: true,
        explanation: "Leadership wants calm contact before the station takes over the space."
      },
      {
        id: "q-greet-school-b",
        label: "Unload first so the setup starts immediately.",
        correct: false,
        explanation: "Speed does not come before clarity with the school contact."
      }
    ]
  },
  {
    id: "q-battery-check",
    module_id: "module-pre-shoot-prep",
    roles: ["associate_photographer"],
    prompt: "What do you verify before leaving the lot?",
    scenario: "Traffic is light and departure looks clean.",
    choices: [
      {
        id: "q-battery-check-a",
        label: "Batteries, cards, signage, and backup kit.",
        correct: true,
        explanation: "Prep misses create avoidable field failures later."
      },
      {
        id: "q-battery-check-b",
        label: "Only the main camera body if the rest was packed yesterday.",
        correct: false,
        explanation: "Yesterday's prep is not today's verification."
      }
    ]
  },
  {
    id: "q-weights-first",
    module_id: "module-equipment-setup",
    roles: ["associate_photographer"],
    prompt: "What is non-negotiable during setup?",
    scenario: "Families will start arriving in five minutes.",
    choices: [
      {
        id: "q-weights-first-a",
        label: "Weights on every stand before calling setup ready.",
        correct: true,
        explanation: "Speed never overrides safety."
      },
      {
        id: "q-weights-first-b",
        label: "Skip weights if the gym looks calm.",
        correct: false,
        explanation: "Weighted stands are always required."
      }
    ]
  },
  {
    id: "q-line-pause",
    module_id: "module-school-day-flow",
    roles: ["associate_photographer"],
    prompt: "How should you handle a broken roster?",
    scenario: "A teacher arrives with names that do not match the line sheet.",
    choices: [
      {
        id: "q-line-pause-a",
        label: "Pause the lane cleanly and confirm names before proceeding.",
        correct: true,
        explanation: "Roster confusion should be solved, not guessed through."
      },
      {
        id: "q-line-pause-b",
        label: "Keep shooting and fix the data later.",
        correct: false,
        explanation: "Bad roster data creates expensive downstream corrections."
      }
    ]
  },
  {
    id: "q-nervous-kindergartner",
    module_id: "module-student-interaction",
    roles: ["associate_photographer"],
    prompt: "How do you respond to a nervous kindergartner?",
    scenario: "The line is moving, but the student freezes at the mark.",
    choices: [
      {
        id: "q-nervous-kindergartner-a",
        label: "Use a calm prompt and keep the moment warm and quick.",
        correct: true,
        explanation: "Warm authority is part of the standard."
      },
      {
        id: "q-nervous-kindergartner-b",
        label: "Rush the student through so the line stays on time.",
        correct: false,
        explanation: "Pace matters, but not at the expense of the family experience."
      }
    ]
  }
];

const unifiedScheduleCalendar: UnifiedScheduleCalendarResponse = {
  anchor_date: "2026-03-24",
  window: "today",
  range: {
    start_date: "2026-03-01",
    end_date: "2026-03-31"
  },
  sync: {
    source_of_truth: "mission_control",
    outlook_connected: false,
    outlook_health_state: "disconnected",
    last_sync_at: null,
    last_failed_sync_at: null,
    pending_sync_count: 0
  },
  items: [
    {
      item_kind: "shoot",
      id: "shoot-1",
      shoot_id: "shoot-1",
      date_key: "2026-03-24",
      title: "Spring Portrait Day",
      shoot_code: "DEMO-001",
      department: "schools",
      status: "scheduled",
      starts_at: "2026-03-24T14:45:00.000Z",
      ends_at: "2026-03-24T18:00:00.000Z",
      arrival_time: "2026-03-24T14:45:00.000Z",
      start_time: "2026-03-24T15:00:00.000Z",
      end_time_est: "2026-03-24T18:00:00.000Z",
      location_name: "Main Gym",
      location_address: "123 School Street",
      navigation_url: "https://maps.example/main-gym",
      estimated_drive_minutes: 18,
      projected_students: 48,
      planned_staff_count: 3,
      assigned_staff_count: 3,
      required_lead_count: 1,
      lead_coverage_count: 1,
      lead_name: "Demo Senior Photographer",
      missing_fields: [],
      open_alert_count: 0,
      open_attendance_exception_count: 0,
      schedule_sync_state: "not_linked",
      schedule_sync_required: false,
      integration: disconnectedScheduleIntegration,
      staffing_state: "staffed",
      scale_label: "Multi-camera",
      board_day_part: "Afternoon",
      under_staffed: false,
      missing_lead: false
    },
    {
      item_kind: "shoot",
      id: "shoot-2",
      shoot_id: "shoot-2",
      date_key: "2026-03-24",
      title: "Friday Night Lights Media Day",
      shoot_code: "DEMO-002",
      department: "sports",
      shoot_category: "sports",
      status: "scheduled",
      starts_at: "2026-03-24T17:00:00.000Z",
      ends_at: "2026-03-24T21:00:00.000Z",
      showtime: "2026-03-24T17:00:00.000Z",
      arrival_time: "2026-03-24T17:00:00.000Z",
      start_time: "2026-03-24T18:00:00.000Z",
      end_time_est: "2026-03-24T21:00:00.000Z",
      location_name: "North Metro Stadium",
      location_address: "2500 Stadium Drive, Plymouth, MN",
      navigation_url: "https://maps.example/north-metro-stadium",
      estimated_drive_minutes: 32,
      projected_students: 96,
      planned_staff_count: 4,
      assigned_staff_count: 1,
      required_lead_count: 1,
      lead_coverage_count: 0,
      lead_name: null,
      missing_fields: [],
      open_alert_count: 1,
      open_attendance_exception_count: 1,
      schedule_sync_state: "pending_sync",
      schedule_sync_required: true,
      integration: {
        ...disconnectedScheduleIntegration,
        sync_state: "pending_sync",
        sync_required: true,
        sync_health: "pending",
        recommended_next_action: "Push staffing plan to Outlook after assignments are confirmed."
      },
      staffing_state: "missing_lead",
      scale_label: "Big shoot",
      board_day_part: "Evening",
      operations_priority: "high_priority",
      big_shoot_manual_override: true,
      under_staffed: true,
      missing_lead: true,
      special_equipment: "Field lights and portable tether station"
    },
    {
      item_kind: "event",
      id: "event-ops",
      date_key: "2026-03-24",
      title: "Daily Ops Huddle",
      department: "operations",
      event_kind: "meeting",
      status: "scheduled",
      starts_at: "2026-03-24T13:30:00.000Z",
      ends_at: "2026-03-24T14:00:00.000Z",
      location_name: "Main Studio",
      location_address: "45 Studio Lane",
      navigation_url: "https://maps.example/studio",
      lead_user_id: "user-leadership",
      lead_name: "Demo Leadership",
      notes: "Morning review of staffing and attendance risk.",
      linked_shoot_id: null,
      schedule_sync_state: "not_linked",
      schedule_sync_required: false,
      integration: disconnectedScheduleIntegration
    },
    {
      item_kind: "shoot",
      id: "shoot-weekend",
      shoot_id: "shoot-weekend",
      date_key: "2026-03-28",
      title: "Saturday Senior Portraits",
      shoot_code: "DEMO-003",
      department: "schools",
      shoot_category: "schools",
      status: "scheduled",
      starts_at: "2026-03-28T14:00:00.000Z",
      ends_at: "2026-03-28T18:00:00.000Z",
      arrival_time: "2026-03-28T13:30:00.000Z",
      start_time: "2026-03-28T14:00:00.000Z",
      end_time_est: "2026-03-28T18:00:00.000Z",
      location_name: "Maple Grove High School",
      location_address: "9800 Fernbrook Lane N, Maple Grove, MN",
      navigation_url: "https://maps.example/maple-grove-high",
      estimated_drive_minutes: 24,
      projected_students: 42,
      planned_staff_count: 2,
      assigned_staff_count: 2,
      required_lead_count: 1,
      lead_coverage_count: 1,
      lead_name: "Demo Photographer",
      missing_fields: [],
      open_alert_count: 0,
      open_attendance_exception_count: 0,
      schedule_sync_state: "not_linked",
      schedule_sync_required: false,
      integration: disconnectedScheduleIntegration,
      staffing_state: "staffed",
      scale_label: "Weekend shoot",
      board_day_part: "Afternoon",
      under_staffed: false,
      missing_lead: false
    }
  ]
};

const unifiedScheduleBoard: UnifiedScheduleBoardResponse = {
  anchor_date: "2026-03-24",
  window: "today",
  group_by: "status",
  groups: [
    {
      key: "scheduled",
      label: "Scheduled",
      shoots: unifiedScheduleCalendar.items.filter((item) => item.item_kind === "shoot") as UnifiedScheduleBoardResponse["groups"][number]["shoots"]
    }
  ]
};

const unifiedScheduleAssignments: ShiftRecord[] = [
  {
    id: "shift-1",
    assigned_user_id: "user-photo",
    assigned_user_name: "Demo Photographer",
    assigned_user_email: "photo@example.com",
    manager_user_id: "user-senior",
    manager_name: "Demo Senior Photographer",
    shoot_id: "shoot-1",
    shoot_code: "DEMO-001",
    shoot_title: "Spring Portrait Day",
    shift_kind: "shoot",
    status: "published",
    department: "schools",
    title: "Portrait Coverage",
    starts_at: "2026-03-24T14:00:00.000Z",
    ends_at: "2026-03-24T18:00:00.000Z",
    location_name: "Main Gym",
    location_address: "123 School Street",
    attendance_state: "on_time",
    attendance_state_note: "Clocked in and on site.",
    staffing_role: "photographer",
    satisfies_lead_coverage: false,
    segments: [],
    punches: [],
    latest_punch_direction: "in",
    latest_punch_at: "2026-03-24T14:03:00.000Z",
    latest_geofence_status: "valid_on_site",
    latest_approval_state: "not_required"
  },
  {
    id: "shift-2",
    assigned_user_id: "user-assistant",
    assigned_user_name: "Demo Assistant",
    assigned_user_email: "assistant@example.com",
    manager_user_id: "user-senior",
    manager_name: "Demo Senior Photographer",
    shoot_id: "shoot-2",
    shoot_code: "DEMO-002",
    shoot_title: "Friday Night Lights Media Day",
    shift_kind: "shoot",
    status: "published",
    department: "sports",
    title: "Check-In Support",
    starts_at: "2026-03-24T17:00:00.000Z",
    ends_at: "2026-03-24T21:00:00.000Z",
    location_name: "North Metro Stadium",
    location_address: "2500 Stadium Drive, Plymouth, MN",
    attendance_state: "missing_clock_in",
    attendance_state_note: "Start time passed without a valid clock-in.",
    staffing_role: "check_in",
    satisfies_lead_coverage: false,
    segments: [],
    punches: [],
    latest_geofence_status: "clock_in_pending_location_review",
    latest_approval_state: "pending_review"
  }
];

const staffingDashboard: StaffingDashboardResponse = {
  anchor_date: "2026-03-24",
  summary: {
    shoots_today: 2,
    shoots_tomorrow: 1,
    open_staffing_slots: 3,
    shoots_missing_lead: 1,
    understaffed_shoots: 1,
    conflict_warnings: 1,
    available_staff_today: 5,
    unavailable_staff_today: 2
  },
  open_coverage: [
    {
      shoot_id: "shoot-2",
      shoot_code: "DEMO-002",
      title: "Friday Night Lights Media Day",
      shoot_date: "2026-03-24",
      department: "sports",
      location_label: "North Metro Stadium",
      time_label: "5:00 PM - 9:00 PM",
      assigned_staff_count: 1,
      planned_staff_count: 4,
      required_lead_count: 1,
      lead_coverage_count: 0,
      lead_present: false,
      lead_name: null,
      missing_lead: true,
      under_staffed: true,
      conflict_warning_count: 1,
      sync_state: "pending_sync",
      next_action: "Assign a lead-qualified photographer"
    }
  ],
  missing_lead: [
    {
      shoot_id: "shoot-2",
      shoot_code: "DEMO-002",
      title: "Friday Night Lights Media Day",
      shoot_date: "2026-03-24",
      department: "sports",
      location_label: "North Metro Stadium",
      time_label: "5:00 PM - 9:00 PM",
      assigned_staff_count: 1,
      planned_staff_count: 4,
      required_lead_count: 1,
      lead_coverage_count: 0,
      lead_present: false,
      lead_name: null,
      missing_lead: true,
      under_staffed: true,
      conflict_warning_count: 1,
      sync_state: "pending_sync",
      next_action: "Assign a lead-qualified photographer"
    }
  ],
  availability_groups: [
    {
      key: "available",
      label: "Available",
      count: 1,
      staff: [
        {
          user_id: "user-senior",
          name: "Demo Senior Photographer",
          title: "Senior Photographer",
          status: "Available",
          current_assignment: null,
          time_window: null,
          quick_note: null,
          lead_qualified: true
        }
      ]
    },
    {
      key: "conflict",
      label: "Conflict",
      count: 1,
      staff: [
        {
          user_id: "user-photo",
          name: "Demo Photographer",
          title: "Associate Photographer",
          status: "Conflict",
          current_assignment: "Portrait Coverage",
          time_window: "2:00 PM - 6:00 PM",
          quick_note: "Already assigned",
          lead_qualified: false
        }
      ]
    }
  ]
};

const staffingSnapshot: ShootStaffingSnapshot = {
  shoot: {
    id: "shoot-2",
    shoot_code: "DEMO-002",
    title: "Friday Night Lights Media Day",
    shoot_date: "2026-03-24",
    department: "sports",
    location_name: "North Metro Stadium",
    location_address: "2500 Stadium Drive, Plymouth, MN",
    arrival_time: "2026-03-24T17:00:00.000Z",
    start_time: "2026-03-24T18:00:00.000Z",
    end_time_est: "2026-03-24T21:00:00.000Z",
    planned_staff_count: 4,
    minimum_staff_count: 2,
    assigned_staff_count: 1,
    required_lead_count: 1,
    lead_coverage_count: 0,
    lead_name: null,
    conflict_warning_count: 1,
    draft_shift_count: 1,
    published_shift_count: 0,
    schedule_sync_state: "pending_sync",
    schedule_sync_required: true,
    staffing_state: "under_minimum",
    staffing_state_display: "Under Minimum",
    staffing_clean_for_ready: false,
    staffing_hard_blockers: ["No required lead is assigned.", "Minimum staffing is not met."],
    staffing_warnings: ["1 staffing slot still open.", "Staffing assignments are still in draft and have not been published to employees."],
    open_slot_count: 1,
    open_required_slot_count: 1,
    publish_state: "draft",
    under_staffed: true,
    over_staffed: false,
    missing_lead: true
  },
  warnings: ["Missing lead coverage.", "3 staffing slots still open.", "1 assigned slot carries conflict warnings."],
  requirements: [
    {
      requirement_id: "requirement-lead",
      source_of_creation: "template_from_shoot_type",
      source_of_creation_display: "Template From Shoot Type",
      staffing_role: "lead_photographer",
      label: "Lead Photographer",
      minimum_count: 1,
      ideal_count: 1,
      required_for_ready: true,
      lead_eligible: true,
      lead_required: true,
      call_offset_minutes: 0,
      start_offset_minutes: 0,
      end_offset_minutes: 0,
      location_name_override: null,
      location_address_override: null,
      required_qualification_tags: ["senior_photographer"],
      notes: "Lead the field team.",
      sort_order: 0,
      assigned_count: 0,
      open_count: 1
    }
  ],
  slots: [
    {
      slot_key: "requirement:requirement-lead:1",
      requirement_id: "requirement-lead",
      source_of_creation: "template_from_shoot_type",
      label: "Lead Photographer",
      staffing_role: "lead_photographer",
      satisfies_lead_coverage: true,
      lead_eligible: true,
      lead_required: true,
      required_for_ready: true,
      is_required_slot: true,
      minimum_count: 1,
      ideal_count: 1,
      call_time: "2026-03-24T17:00:00.000Z",
      start_time: "2026-03-24T18:00:00.000Z",
      end_time: "2026-03-24T21:00:00.000Z",
      location_name: "North Metro Stadium",
      location_address: "2500 Stadium Drive, Plymouth, MN",
      required_qualification_tags: ["senior_photographer"],
      notes: "Lead the field team.",
      assigned_shift_id: null,
      assigned_user_id: null,
      assigned_user_name: null,
      assigned_title: null,
      shift_status: null,
      assignment_status: "open",
      assignment_source: null,
      reassignment_history: [],
      warnings: ["Open slot"],
      option_groups: [
        {
          key: "best_available",
          label: "Best Available",
          options: [
            {
              user_id: "user-senior",
              name: "Demo Senior Photographer",
              title: "Senior Photographer",
              status: "Available",
              short_reason: null,
              before_label: null,
              during_label: null,
              after_label: null,
              availability_state: "best_available",
              requires_override: false,
              disabled: false
            }
          ]
        }
      ]
    }
  ],
  approval_summary: {
    source_module: "scheduling",
    source_entity_type: "shoot",
    source_entity_id: "shoot-2",
    open_count: 0,
    blocking_open_count: 0,
    overdue_count: 0,
    escalated_count: 0,
    items: []
  }
};

const leadershipReportsIndex = {
  generated_at: "2026-03-24T08:00:00.000Z",
  anchor_date: "2026-03-24",
  freshness: {
    state: "recently_updated",
    label: "Recently Updated",
    last_updated_at: "2026-03-24T08:00:00.000Z",
    data_latency: "near_real_time",
    current_day_may_be_incomplete: true
  },
  summary_strip: [
    {
      id: "shoots_at_risk",
      label: "Shoots At Risk",
      value: 2,
      tone: "action_needed",
      detail: "2 shoots still need same-day intervention."
    },
    {
      id: "under_minimum",
      label: "Under Minimum Staffed",
      value: 1,
      tone: "heads_up",
      detail: "1 shoot is below minimum staffing coverage."
    },
    {
      id: "blocked",
      label: "Blocked Production Jobs",
      value: 3,
      tone: "heads_up",
      detail: "3 jobs are currently blocked in production."
    },
    {
      id: "overdue_followups",
      label: "Overdue Follow-Ups",
      value: 2,
      tone: "heads_up",
      detail: "2 customer follow-ups are overdue."
    },
    {
      id: "repeat_issue_locations",
      label: "Repeat Issue Locations",
      value: 1,
      tone: "heads_up",
      detail: "1 location is showing repeated operational friction."
    },
    {
      id: "unresolved_review_queue",
      label: "Unresolved Review Queue",
      value: 4,
      tone: "action_needed",
      detail: "4 review items still need decisions."
    }
  ],
  saved_views: [
    {
      id: "executive_weekly_review",
      label: "Executive Weekly Review",
      summary: "Cross-company health for the last 7 days.",
      report_id: "executive_overview",
      window: "last_7_days"
    },
    {
      id: "production_blockers",
      label: "Production Blockers",
      summary: "Blocked, overdue, and release-risk production work.",
      report_id: "production_qa_health",
      window: "last_30_days"
    }
  ],
  scheduled_summaries: [
    {
      id: "daily_ops",
      label: "Daily morning leadership ops summary",
      cadence: "Daily",
      audience: "Leadership"
    },
    {
      id: "weekly_big_shoot",
      label: "Weekly big and critical shoot readiness summary",
      cadence: "Weekly",
      audience: "Leadership"
    }
  ],
  big_shoots_coming_up: {
    summary_line: "1 flagged shoot needs readiness attention in the next 30 days.",
    items: [
      {
        shoot_id: "shoot-2",
        shoot_code: "DEMO-002",
        title: "Friday Night Lights Media Day",
        shoot_date: "2026-03-24",
        location_label: "North Metro Stadium",
        priority_label: "big_shoot",
        priority_display: "Big Shoot",
        readiness_label: "Needs Attention",
        readiness_reason: "Lead coverage and staffing still need review before this flagged shoot is fully ready.",
        profitability_display: "Watch",
        prep_due_label: "T-3 Prep due today",
        reason_chips: [
          {
            label: "High Headcount",
            detail: "Projected headcount is above the big-shoot threshold."
          },
          {
            label: "Heavy Staffing",
            detail: "Staffing demand is high for this shoot."
          }
        ]
      }
    ]
  },
  reports: [
    {
      id: "executive_overview",
      title: "Today’s Operations Summary",
      layer: "live_operational_dashboard",
      audience: "Leadership and admins",
      summary_line: "2 shoots are carrying operational risk, 3 production jobs are blocked, and 2 customer follow-ups are overdue.",
      tone: "heads_up",
      action_needed_count: 2,
      default_window: "last_7_days",
      freshness_state: "live",
      export_pdf: true,
      export_csv: true
    },
    {
      id: "big_shoot_readiness_report",
      title: "Big and Critical Shoot Readiness Report",
      audience: "Leadership",
      summary_line: "Upcoming flagged shoots are visible with readiness posture and prep cues.",
      tone: "action_needed",
      action_needed_count: 1,
      export_pdf: true,
      export_csv: false
    },
    {
      id: "open_approvals_report",
      title: "Open Approvals Report",
      audience: "Managers and leadership",
      summary_line: "Approval queues are visible with aging and bottleneck counts.",
      tone: "neutral",
      action_needed_count: 0,
      export_pdf: false,
      export_csv: true
    },
    {
      id: "operational_intelligence_report",
      title: "Business Health Report",
      audience: "Leadership and managers",
      summary_line: "Cross-system patterns are surfaced across labor, compliance, locations, accounts, gear, and shoot readiness.",
      tone: "heads_up",
      action_needed_count: 2,
      export_pdf: true,
      export_csv: true
    }
  ]
};

const leadershipReportDetail = {
  id: "big_shoot_readiness_report",
  title: "Big and Critical Shoot Readiness Report",
  audience: "Leadership",
  formats: {
    onscreen: true,
    pdf: true,
    csv: false
  },
  summary_line: "Upcoming flagged shoots are visible with staffing completeness, prep cadence, and known risk.",
  tone: "action_needed",
  leadership_only: true,
  generated_at: "2026-03-24T08:00:00.000Z",
  metrics: [
    {
      label: "Flagged Shoots",
      value: 1,
      tone: "heads_up",
      detail: "1 shoot is currently raised above standard."
    },
    {
      label: "At Risk",
      value: 0,
      tone: "good",
      detail: "No flagged shoots are in an at-risk state."
    },
    {
      label: "Needs Attention",
      value: 1,
      tone: "action_needed",
      detail: "1 flagged shoot still needs prep work."
    }
  ],
  sections: [
    {
      id: "readiness_queue",
      title: "Flagged Shoot Queue",
      summary: "Readiness stays focused on the shoots that deserve more prep and leadership visibility.",
      rows: [
        {
          id: "shoot-2",
          primary: "Friday Night Lights Media Day",
          secondary: "DEMO-002 | North Metro Stadium",
          chips: [
            { label: "Needs Attention", tone: "action_needed" },
            { label: "Big Shoot", tone: "heads_up" }
          ],
          values: [
            { label: "Profitability", value: "Watch", tone: "heads_up" },
            { label: "Prep", value: "T-3 Prep due today", tone: "neutral" }
          ],
          next_action: "Confirm lead coverage and close the staffing gap."
        }
      ]
    }
  ]
};

const reportingDashboardIndex: LeadershipReportsIndex = {
  generated_at: "2026-03-24T08:00:00.000Z",
  anchor_date: "2026-03-24",
  freshness: {
    state: "recently_updated",
    label: "Recently Updated",
    last_updated_at: "2026-03-24T08:00:00.000Z",
    data_latency: "near_real_time",
    current_day_may_be_incomplete: true
  },
  summary_strip: [
    {
      id: "shoots_at_risk",
      label: "Shoots At Risk",
      value: 2,
      tone: "action_needed",
      detail: "2 shoots still need same-day intervention."
    },
    {
      id: "under_minimum",
      label: "Under Minimum Staffed",
      value: 1,
      tone: "heads_up",
      detail: "1 shoot is below minimum staffing coverage."
    },
    {
      id: "blocked",
      label: "Blocked Production Jobs",
      value: 3,
      tone: "heads_up",
      detail: "3 jobs are currently blocked in production."
    },
    {
      id: "overdue_followups",
      label: "Overdue Follow-Ups",
      value: 2,
      tone: "heads_up",
      detail: "2 customer follow-ups are overdue."
    },
    {
      id: "repeat_issue_locations",
      label: "Repeat Issue Locations",
      value: 1,
      tone: "heads_up",
      detail: "1 location is showing repeated operational friction."
    },
    {
      id: "unresolved_review_queue",
      label: "Unresolved Review Queue",
      value: 4,
      tone: "action_needed",
      detail: "4 review items still need decisions."
    }
  ],
  saved_views: [
    {
      id: "executive_weekly_review",
      label: "Executive Weekly Review",
      summary: "Cross-company health for the last 7 days.",
      report_id: "executive_overview",
      window: "last_7_days"
    },
    {
      id: "production_blockers",
      label: "Production Blockers",
      summary: "Blocked, overdue, and release-risk production work.",
      report_id: "production_qa_health",
      window: "last_30_days"
    }
  ],
  scheduled_summaries: leadershipReportsIndex.scheduled_summaries,
  big_shoots_coming_up: {
    summary_line: "1 flagged shoot needs readiness attention in the next 30 days.",
    items: [
      {
        shoot_id: "shoot-2",
        shoot_code: "DEMO-002",
        title: "Friday Night Lights Media Day",
        shoot_date: "2026-03-24",
        location_label: "North Metro Stadium",
        priority_label: "big_shoot",
        priority_display: "Big Shoot",
        readiness_label: "Needs Attention",
        readiness_reason: "Lead coverage and staffing still need review before this flagged shoot is fully ready.",
        profitability_display: "Watch",
        prep_due_label: "T-3 Prep due today",
        reason_chips: [
          {
            label: "High Headcount",
            detail: "Projected headcount is above the big-shoot threshold."
          },
          {
            label: "Heavy Staffing",
            detail: "Staffing demand is high for this shoot."
          }
        ]
      }
    ]
  },
  reports: [
    {
      id: "executive_overview",
      title: "Executive Overview",
      layer: "live_operational_dashboard",
      audience: "Leadership and admins",
      summary_line: "2 shoots are carrying operational risk, 3 production jobs are blocked, and 2 customer follow-ups are overdue.",
      tone: "heads_up",
      action_needed_count: 2,
      default_window: "last_7_days",
      freshness_state: "live",
      export_pdf: true,
      export_csv: true
    },
    {
      id: "shoot_operations_health",
      title: "Shoot Operations Health",
      layer: "management_trend_dashboard",
      audience: "Leadership and managers",
      summary_line: "1 shoot fell below minimum staffing and 1 major issue surfaced in the current reporting window.",
      tone: "action_needed",
      action_needed_count: 1,
      default_window: "last_30_days",
      freshness_state: "recently_updated",
      export_pdf: true,
      export_csv: true
    },
    {
      id: "production_qa_health",
      title: "Production and QA Health",
      layer: "live_operational_dashboard",
      audience: "Leadership, production leads, and admins",
      summary_line: "3 jobs are blocked, 2 are overdue, and 1 is ready to release in the current board.",
      tone: "heads_up",
      action_needed_count: 2,
      default_window: "last_30_days",
      freshness_state: "live",
      export_pdf: true,
      export_csv: true
    },
    {
      id: "workflow_compliance_data_quality",
      title: "Workflow Compliance and Data Quality",
      layer: "management_trend_dashboard",
      audience: "Leadership, managers, and admins",
      summary_line: "4 review items are unresolved, 1 required eval is missing, and 1 setup photo set is still open.",
      tone: "heads_up",
      action_needed_count: 2,
      default_window: "last_30_days",
      freshness_state: "recently_updated",
      export_pdf: true,
      export_csv: true
    }
  ]
};

const reportingDashboardDetail: LeadershipReportDetail = {
  id: "shoot_operations_health",
  title: "Shoot Operations Health",
  layer: "management_trend_dashboard",
  audience: "Leadership and managers",
  formats: {
    onscreen: true,
    pdf: true,
    csv: true
  },
  summary_line: "1 shoot fell below minimum staffing and 1 major issue surfaced in the current reporting window.",
  tone: "action_needed",
  leadership_only: false,
  generated_at: "2026-03-24T08:00:00.000Z",
  freshness: {
    state: "recently_updated",
    label: "Recently Updated",
    last_updated_at: "2026-03-24T08:00:00.000Z",
    data_latency: "near_real_time",
    current_day_may_be_incomplete: true
  },
  filter_summary: [
    { label: "Window", value: "Last 30 Days" },
    { label: "Department", value: "All Departments" }
  ],
  top_summary: [
    {
      id: "completed_shoots",
      label: "Completed Shoots",
      value: 12,
      tone: "neutral",
      detail: "12 eligible shoots reached completion in the reporting window."
    },
    {
      id: "under_minimum_rate",
      label: "Under Minimum Rate",
      value: "8.3%",
      tone: "heads_up",
      detail: "1 of 12 eligible shoots fell below minimum staffing."
    },
    {
      id: "eval_completion_rate",
      label: "Eval Completion Rate",
      value: "91.7%",
      tone: "good",
      detail: "11 of 12 required post-shoot evals were submitted by deadline."
    }
  ],
  metrics: [
    {
      id: "completed_shoots",
      label: "Completed Shoots",
      value: 12,
      tone: "neutral",
      detail: "12 eligible shoots reached completion in the reporting window."
    },
    {
      id: "under_minimum_rate",
      label: "Under Minimum Rate",
      value: "8.3%",
      tone: "heads_up",
      detail: "1 of 12 eligible shoots fell below minimum staffing."
    },
    {
      id: "eval_completion_rate",
      label: "Eval Completion Rate",
      value: "91.7%",
      tone: "good",
      detail: "11 of 12 required post-shoot evals were submitted by deadline."
    }
  ],
  trend_cards: [
    {
      id: "missing_setup_photos",
      label: "Missing Setup Photos",
      value: 1,
      tone: "heads_up",
      detail: "1 required setup-photo set is still open."
    },
    {
      id: "missing_evals",
      label: "Missing Required Evals",
      value: 1,
      tone: "action_needed",
      detail: "1 required post-shoot eval is still missing."
    }
  ],
  exception_sections: [
    {
      id: "at_risk_shoots",
      title: "At-Risk Shoot Queue",
      summary: "Shoots with the clearest staffing or readiness risk in the selected window.",
      rows: [
        {
          id: "shoot-2",
          primary: "Friday Night Lights Media Day",
          secondary: "DEMO-002 | North Metro Stadium",
          chips: [
            { label: "Under Minimum", tone: "action_needed" },
            { label: "Big Shoot", tone: "heads_up" }
          ],
          values: [
            { label: "Staffing", value: "2/5", tone: "heads_up" },
            { label: "Lead", value: "0/1", tone: "action_needed" }
          ],
          next_action: "Confirm lead coverage and close the staffing gap."
        }
      ]
    }
  ],
  sections: [
    {
      id: "at_risk_shoots",
      title: "At-Risk Shoot Queue",
      summary: "Shoots with the clearest staffing or readiness risk in the selected window.",
      rows: [
        {
          id: "shoot-2",
          primary: "Friday Night Lights Media Day",
          secondary: "DEMO-002 | North Metro Stadium",
          chips: [
            { label: "Under Minimum", tone: "action_needed" },
            { label: "Big Shoot", tone: "heads_up" }
          ],
          values: [
            { label: "Staffing", value: "2/5", tone: "heads_up" },
            { label: "Lead", value: "0/1", tone: "action_needed" }
          ],
          next_action: "Confirm lead coverage and close the staffing gap."
        }
      ]
    }
  ],
  drilldown_sections: [
    {
      id: "post_shoot_patterns",
      title: "Post-Shoot Patterns",
      summary: "Structured eval trends that should influence the next comparable shoot.",
      rows: [
        {
          id: "eval-1",
          primary: "North Metro Stadium | Friday Night Lights Media Day",
          secondary: "Mar 24 | Major Issues",
          values: [
            { label: "Staffing", value: "Understaffed", tone: "heads_up" },
            { label: "Setup", value: "High", tone: "heads_up" },
            { label: "Data", value: "Major Issues", tone: "action_needed" }
          ],
          next_action: "Review the next-time recommendation before the next visit."
        }
      ]
    }
  ],
  detail_panel: {
    title: "Operational Definitions",
    summary: "Trusted metric rules for shoot operations.",
    items: [
      {
        label: "Lead coverage rate",
        value: "Lead-required shoots with a valid lead assigned by cutoff / total lead-required shoots."
      },
      {
        label: "Post-shoot eval completion rate",
        value: "Required evals submitted by deadline / required evals."
      }
    ]
  }
};

const trainingRoundResponse: TrainingQuizRoundResponse = {
  round: {
    id: "round-1",
    mode: "dashboard",
    title: "Picture Day Challenge | Readiness Round",
    module_id: "module-equipment-setup",
    question_ids: trainingRoundQuestions.map((question) => question.id),
    pass_threshold: 80,
    best_score: 80,
    streak_placeholder: 2
  },
  questions: trainingRoundQuestions
};

const trainingSubmitResponse: TrainingQuizSubmitResponse = {
  profile: {
    ...trainingProfile,
    workbook_progress_percent: 78,
    required_progress_percent: 88,
    quiz_history: [
      {
        id: "attempt-1",
        round_title: "Picture Day Challenge | Readiness Round",
        module_id: "module-equipment-setup",
        played_at: "2026-03-24T15:00:00.000Z",
        score_percent: 80,
        passed: true,
        correct_count: 4,
        question_count: 5,
        missed_question_ids: ["q-line-pause"]
      }
    ]
  },
  attempt: {
    id: "attempt-1",
    round_title: "Picture Day Challenge | Readiness Round",
    module_id: "module-equipment-setup",
    played_at: "2026-03-24T15:00:00.000Z",
    score_percent: 80,
    passed: true,
    correct_count: 4,
    question_count: 5,
    missed_question_ids: ["q-line-pause"]
  },
  questions: trainingRoundQuestions
};

const outlookStatus: OutlookCalendarStatusPayload = {
  account: {
    id: "outlook-account",
    tenant_id: "tenant-demo",
    provider_mode: "mock",
    connection_status: "connected",
    health_state: "mock",
    connected_as: "leadership@example.com",
    connection_label: "Mock Outlook calendar preview is connected for this tenant.",
    last_sync_at: "2026-03-24T14:10:00.000Z",
    last_failed_sync_at: null,
    records_synced: 12,
    warning_count: 1,
    error_count: 0
  },
  graph_stub: {
    id: "graph-diagnostics",
    tenant_id: "tenant-demo",
    provider_mode: "graph_stub",
    connection_status: "attention",
    health_state: "connected_pending_sync",
    connected_as: null,
    connection_label: "Microsoft Graph credentials are configured but live auth is still mock-first in this environment.",
    last_sync_at: null,
    last_failed_sync_at: null,
    records_synced: 0,
    warning_count: 0,
    error_count: 0
  },
  sync_runs: [
    {
      id: "sync-1",
      provider_mode: "mock",
      started_at: "2026-03-24T14:10:00.000Z",
      finished_at: "2026-03-24T14:10:03.000Z",
      status: "warning",
      records_synced: 12,
      warnings: ["Mock sync only"],
      errors: []
    }
  ]
};

const integrationGovernance: IntegrationGovernancePayload = {
  summary: {
    provider_count: 3,
    connected_count: 2,
    warning_count: 2,
    failing_count: 0,
    unresolved_conflict_count: 1,
    pending_sync_count: 2,
    linked_record_count: 2,
    last_updated_at: "2026-03-24T14:15:00.000Z",
    freshness: {
      state: "recently_updated",
      label: "Recently Updated"
    }
  },
  providers: [
    {
      provider: "outlook",
      display_name: "Microsoft Outlook",
      enabled: true,
      connection_status: "connected",
      health_state: "warning",
      health_label: "Warning",
      sync_mode: "controlled_one_way_writeback",
      sync_mode_label: "Controlled One-Way Writeback",
      source_of_truth_summary: "Mission Control owns staffing and readiness. Outlook mirrors calendar timing and holds.",
      owner_contact: "Scheduling and operations leadership",
      last_successful_sync_at: "2026-03-24T14:10:00.000Z",
      last_failed_sync_at: null,
      next_scheduled_sync_at: null,
      failure_count: 0,
      unresolved_conflict_count: 0,
      pending_sync_count: 2,
      linked_record_count: 1,
      mapping_status: "Calendar mapping and explicit sync controls are active.",
      external_label: "Mock calendar preview",
      owned_domains: ["shoot_status"],
      mirrored_domains: ["calendar_holds"],
      overlay_domains: ["staffing_health"],
      writeback_domains: ["selected_schedule_timing"],
      replayable_operation_id: null
    },
    {
      provider: "zendesk",
      display_name: "Zendesk",
      enabled: true,
      connection_status: "connected",
      health_state: "warning",
      health_label: "Warning",
      sync_mode: "read_only_import",
      sync_mode_label: "Read-Only Import",
      source_of_truth_summary: "Zendesk owns ticket workflow. Mission Control mirrors support signals.",
      owner_contact: "Customer service systems owner",
      last_successful_sync_at: "2026-03-24T13:55:00.000Z",
      last_failed_sync_at: null,
      next_scheduled_sync_at: null,
      failure_count: 0,
      unresolved_conflict_count: 0,
      pending_sync_count: 0,
      linked_record_count: 14,
      mapping_status: "Summary ingestion maps queue health and backlog aging.",
      external_label: "Demo reporting cache",
      owned_domains: ["ticket_status"],
      mirrored_domains: ["ticket_backlog"],
      overlay_domains: ["home_alert_weighting"],
      writeback_domains: [],
      replayable_operation_id: null
    },
    {
      provider: "monday",
      display_name: "Monday.com",
      enabled: true,
      connection_status: "attention",
      health_state: "degraded",
      health_label: "Degraded",
      sync_mode: "manual_reconciliation",
      sync_mode_label: "Manual Reconciliation",
      source_of_truth_summary: "Monday stays transitional for selected legacy workflow records during migration.",
      owner_contact: "Operations migration owner",
      last_successful_sync_at: "2026-03-23T18:00:00.000Z",
      last_failed_sync_at: "2026-03-24T06:30:00.000Z",
      next_scheduled_sync_at: null,
      failure_count: 1,
      unresolved_conflict_count: 1,
      pending_sync_count: 0,
      linked_record_count: 1,
      mapping_status: "1 location-linked legacy record still depends on Monday history or assets.",
      external_label: "Legacy coexistence view only",
      owned_domains: ["legacy_board_item_state"],
      mirrored_domains: ["legacy_location_history"],
      overlay_domains: ["location_memory"],
      writeback_domains: ["selected_eval_exports"],
      replayable_operation_id: "sync-monday-1"
    }
  ],
  source_of_truth_rules: [
    {
      id: "mission-control-core",
      field_group: "Shoots, staffing, attendance, readiness",
      owner: "Mission Control",
      ownership_type: "source_of_truth",
      sync_direction: "Internal first",
      edit_policy: "Editable here",
      summary: "Mission Control is authoritative for operational execution records."
    },
    {
      id: "outlook-calendar",
      field_group: "Calendar holds and event timing",
      owner: "Outlook",
      ownership_type: "mirror",
      sync_direction: "Imported for visibility, explicit writeback only",
      edit_policy: "Editable in Outlook",
      summary: "Outlook stays a calendar mirror and does not own staffing or readiness."
    }
  ],
  recent_conflicts: [
    {
      operation_id: "sync-monday-1",
      provider: "monday",
      title: "Post Shoot Evaluation Create",
      summary: "Monday sync needs manual review before Mission Control or the external board state should win.",
      entity_type: "post_shoot_evaluation",
      entity_id: "eval-1",
      status: "conflict",
      occurred_at: "2026-03-24T06:30:00.000Z",
      source_system: "mission_control",
      local_value: "{\"shoot_name\":\"Wayzata High School\"}",
      external_value: "{\"board_state\":\"legacy_pending\"}",
      source_policy: "Monday is transitional during migration. Use manual reconciliation when legacy board state and Mission Control context disagree.",
      recommended_action: "Keep Mission Control as the operational overlay, verify the legacy board state, and replay only after the migration owner confirms the safe direction.",
      resolution_paths: ["Keep Local", "Keep External", "Escalate"],
      can_replay: true
    }
  ],
  linked_records: [
    {
      provider: "outlook",
      record_type: "shoot",
      local_record_id: "shoot-1",
      local_label: "Morning Shoot",
      external_record_id: "event-1",
      external_url: null,
      sync_state: "synced",
      sync_state_label: "Synced",
      last_sync_at: "2026-03-24T14:10:00.000Z",
      source_ownership_summary: "Outlook mirrors calendar timing and attendee context. Mission Control still owns staffing and readiness.",
      conflict_banner: null,
      recommended_action: null
    },
    {
      provider: "monday",
      record_type: "location",
      local_record_id: "location-1",
      local_label: "Wayzata High School",
      external_record_id: "monday-item-1",
      external_url: "https://monday.example.com/item/1",
      sync_state: "partially_synced",
      sync_state_label: "Partially Synced",
      last_sync_at: "2026-03-23T18:00:00.000Z",
      source_ownership_summary: "This record still carries Monday-linked history or assets.",
      conflict_banner: null,
      recommended_action: "Use manual reconciliation for high-risk changes."
    }
  ],
  recent_operations: [
    {
      id: "sync-op-outlook-1",
      provider: "outlook",
      direction: "outbound",
      entity_type: "shoot",
      entity_id: "shoot-1",
      operation_type: "update",
      external_object_type: "calendar_event",
      external_id: "event-1",
      source_system: "mission_control",
      status: "succeeded",
      attempt_count: 1,
      created_at: "2026-03-24T14:10:00.000Z",
      updated_at: "2026-03-24T14:10:00.000Z",
      message: "event-1"
    },
    {
      id: "sync-monday-1",
      provider: "monday",
      direction: "outbound",
      entity_type: "post_shoot_evaluation",
      entity_id: "eval-1",
      operation_type: "create",
      external_object_type: "monday_item",
      external_id: null,
      source_system: "mission_control",
      status: "conflict",
      attempt_count: 2,
      created_at: "2026-03-24T06:25:00.000Z",
      updated_at: "2026-03-24T06:30:00.000Z",
      message: "Legacy board state needs manual review."
    }
  ]
};

const reportingDeliveryCenter: ReportingDeliveryCenter = {
  generated_at: "2026-03-24T08:00:00.000Z",
  anchor_date: "2026-03-24",
  saved_views: [
    {
      id: "executive_weekly_review",
      label: "Executive Weekly Review",
      summary: "Cross-company health for the last 7 days.",
      report_id: "executive_overview",
      window: "last_7_days",
      visibility: "leadership_shared",
      source_module: "reporting_dashboard",
      owner_name: "Demo Leadership",
      is_pinned: true,
      is_default: true,
      system_defined: true,
      share_hash: "#business-health/reports?saved_view_id=executive_weekly_review"
    },
    {
      id: "production_blockers",
      label: "Production Blockers",
      summary: "Blocked, overdue, and release-risk production work.",
      report_id: "production_qa_health",
      window: "last_30_days",
      visibility: "leadership_shared",
      source_module: "reporting_dashboard",
      owner_name: "Demo Leadership",
      is_pinned: true,
      is_default: false,
      system_defined: true,
      share_hash: "#business-health/reports?saved_view_id=production_blockers"
    }
  ],
  packet_templates: [
    {
      id: "packet-1",
      name: "Executive Weekly Review",
      audience: "Leadership weekly review",
      description: "Weekly packet for change, risk, and ownership review.",
      owner_user_id: "user-leadership",
      owner_name: "Demo Leadership",
      visibility: "leadership_shared",
      default_window: "last_7_days",
      department_code: null,
      section_config: [
        { report_id: "executive_overview", enabled: true },
        { report_id: "shoot_operations_health", enabled: true },
        { report_id: "production_qa_health", enabled: true }
      ],
      system_defined: true,
      is_pinned: true,
      updated_at: "2026-03-24T08:00:00.000Z"
    }
  ],
  recent_packet_runs: [
    {
      id: "packet-run-1",
      run_label: "Executive Weekly Review",
      source_type: "packet_template",
      template_id: "packet-1",
      template_name: "Executive Weekly Review",
      saved_view_id: null,
      saved_view_name: null,
      schedule_id: "schedule-1",
      anchor_date: "2026-03-24",
      date_from: "2026-03-18",
      date_to: "2026-03-24",
      summary_snapshot: reportingDashboardDetail.top_summary ?? [],
      freshness_snapshot: reportingDashboardDetail.freshness ?? null,
      recipient_snapshot: [
        { user_id: "user-leadership", name: "Demo Leadership", email: "leadership@example.com" }
      ],
      delivery_result: {
        delivered: true
      },
      record_count: 3,
      status: "completed",
      pdf_reference: null,
      created_at: "2026-03-24T08:00:00.000Z",
      completed_at: "2026-03-24T08:00:00.000Z",
      packet_payload: {
        title: "Executive Weekly Review",
        audience: "Leadership weekly review",
        date_range_label: "Last 7 Days",
        run_timestamp: "2026-03-24T08:00:00.000Z",
        freshness_note: "Recently Updated",
        summary_strip: reportingDashboardDetail.top_summary ?? [],
        observations: [
          { id: "obs-1", tone: "risk", text: "Operational risk is elevated heading into the next 7 days." }
        ],
        sections: [],
        action_sections: []
      }
    }
  ],
  export_history: [
    {
      id: "export-1",
      export_name: "Shoot Operations Health CSV",
      source_module: "reporting_dashboard",
      report_id: "shoot_operations_health",
      format: "csv",
      status: "completed",
      requested_by_user_id: "user-leadership",
      requested_by_name: "Demo Leadership",
      requested_at: "2026-03-24T08:05:00.000Z",
      completed_at: "2026-03-24T08:05:03.000Z",
      record_count: 12,
      file_reference: "/api/dashboard/reports/shoot_operations_health/export.csv",
      error_message: null,
      freshness_snapshot: reportingDashboardDetail.freshness ?? null,
      filter_summary: [
        { label: "Date range", value: "2026-03-18 to 2026-03-24" },
        { label: "Department", value: "All Departments" }
      ]
    }
  ],
  delivery_schedules: [
    {
      id: "schedule-1",
      label: "Weekly Executive Review",
      source_type: "packet_template",
      template_id: "packet-1",
      template_name: "Executive Weekly Review",
      saved_view_id: null,
      saved_view_name: null,
      cadence: "weekly",
      day_of_week: 1,
      hour_local: 8,
      minute_local: 0,
      timezone: "America/Chicago",
      delivery_channel: "email_link",
      active_status: true,
      last_run_at: "2026-03-24T08:00:00.000Z",
      next_run_at: "2026-03-31T13:00:00.000Z",
      last_status: "completed",
      last_error: null,
      recipient_snapshot: [
        { user_id: "user-leadership", name: "Demo Leadership", email: "leadership@example.com" }
      ],
      updated_at: "2026-03-24T08:00:00.000Z"
    }
  ],
  recipient_options: [
    {
      id: "user-leadership",
      full_name: "Demo Leadership",
      email: "leadership@example.com",
      department: "operations",
      authority_tier: "leadership"
    }
  ]
};

const visibleCalendars: OutlookCalendar[] = [
  {
    id: "calendar-1",
    name: "Leadership Command",
    color_hex: "#436f9f",
    is_primary: true,
    owner_label: "Leadership",
    visible_in_app: true,
    scheduling_impact_enabled: true,
    overlaps_with_shoots: true,
    upcoming_count: 2
  },
  {
    id: "calendar-2",
    name: "Travel Holds",
    color_hex: "#c68945",
    is_primary: false,
    owner_label: "Operations",
    visible_in_app: false,
    scheduling_impact_enabled: true,
    overlaps_with_shoots: false,
    upcoming_count: 1
  }
];

const todayEvents: OutlookCalendarEvent[] = [
  {
    id: "event-1",
    calendar_id: "calendar-1",
    calendar_name: "Leadership Command",
    calendar_color_hex: "#436f9f",
    subject: "Morning Shoot Hold",
    starts_at: "2026-03-24T14:00:00.000Z",
    ends_at: "2026-03-24T15:00:00.000Z",
    organizer: "Leadership",
    location: "Main Gym",
    overlaps_with_shoots: true,
    scheduling_impact: true,
    preview_note: "Aligned to DEMO-001.",
    web_link: "https://outlook.office.com/calendar/item/event-1",
    shoot_code: "DEMO-001"
  }
];

const weekEvents: OutlookCalendarEvent[] = [
  ...todayEvents,
  {
    id: "event-2",
    calendar_id: "calendar-1",
    calendar_name: "Leadership Command",
    calendar_color_hex: "#436f9f",
    subject: "Week Planning Hold",
    starts_at: "2026-03-26T15:00:00.000Z",
    ends_at: "2026-03-26T16:00:00.000Z",
    organizer: "Leadership",
    location: "Mission Control room",
    overlaps_with_shoots: false,
    scheduling_impact: true,
    preview_note: "Leadership planning block.",
    web_link: "https://outlook.office.com/calendar/item/event-2",
    shoot_code: null
  }
];

const zendeskStatus: ZendeskStatusPayload = {
  connection: {
    id: "zendesk-connection",
    tenant_id: "tenant-demo",
    provider_mode: "mock",
    connection_status: "connected",
    health_state: "mock",
    connected_account_email: null,
    connection_label: "Zendesk demo mode is active for this tenant.",
    live_enabled: false,
    demo_mode: true,
    last_sync_at: "2026-03-24T14:15:00.000Z",
    last_successful_sync_at: "2026-03-24T14:15:00.000Z",
    last_failed_sync_at: null,
    records_synced: 15,
    warning_count: 1,
    error_count: 0,
    stale_sync: false,
    last_error_message: null
  },
  sync_runs: [
    {
      id: "zendesk-sync-1",
      provider_mode: "mock",
      started_at: "2026-03-24T14:15:00.000Z",
      finished_at: "2026-03-24T14:15:04.000Z",
      status: "warning",
      records_synced: 15,
      warnings: ["Demo cache refreshed from fixture data."],
      errors: []
    }
  ],
  category_rules: [
    {
      id: "rule-schools",
      category: "schools",
      rule_type: "tag",
      field_key: null,
      match_value: "schools",
      priority: 10,
      enabled: true
    }
  ]
};

const zendeskSummary: ZendeskLeadershipSummary = {
  connection: zendeskStatus.connection,
  kpis: {
    open_tickets: 6,
    new_tickets_this_week: 8,
    resolved_tickets_this_week: 5,
    unassigned_tickets: 2,
    median_first_reply_minutes: 24,
    median_resolution_minutes: 640,
    oldest_open_tickets: 2
  },
  comparisons: {
    new_tickets_week_over_week: 2,
    resolved_tickets_week_over_week: 1,
    open_backlog_change: 1,
    first_reply_change_minutes: 8,
    resolution_change_minutes: -12
  },
  queue_health: {
    total_open: 6,
    aging_buckets: [
      { label: "0 to 1 days", count: 2 },
      { label: "2 to 3 days", count: 1 },
      { label: "4 to 7 days", count: 1 },
      { label: "8+ days", count: 2 }
    ],
    status_breakdown: [
      { status: "open", count: 3 },
      { status: "pending", count: 1 },
      { status: "hold", count: 1 },
      { status: "solved", count: 4 }
    ]
  },
  category_breakdown: [
    { category: "schools", total_count: 5, open_count: 2, resolved_count: 2, unassigned_count: 1 },
    { category: "sports", total_count: 4, open_count: 2, resolved_count: 1, unassigned_count: 0 },
    { category: "other", total_count: 3, open_count: 2, resolved_count: 2, unassigned_count: 1 }
  ],
  flags: {
    backlog_rising: true,
    reply_time_degrading: false,
    unusual_ticket_spike: false
  }
};

const zendeskTrends: ZendeskLeadershipTrends = {
  connection: zendeskStatus.connection,
  range: "7d",
  points: [
    { metric_date: "2026-03-18", label: "Mar 18", opened_count: 2, resolved_count: 1, open_backlog_count: 5, median_first_reply_minutes: 22, median_resolution_minutes: 700 },
    { metric_date: "2026-03-19", label: "Mar 19", opened_count: 1, resolved_count: 2, open_backlog_count: 4, median_first_reply_minutes: 18, median_resolution_minutes: 500 },
    { metric_date: "2026-03-20", label: "Mar 20", opened_count: 3, resolved_count: 2, open_backlog_count: 5, median_first_reply_minutes: 25, median_resolution_minutes: 640 },
    { metric_date: "2026-03-21", label: "Mar 21", opened_count: 2, resolved_count: 1, open_backlog_count: 6, median_first_reply_minutes: 29, median_resolution_minutes: 720 },
    { metric_date: "2026-03-22", label: "Mar 22", opened_count: 1, resolved_count: 1, open_backlog_count: 6, median_first_reply_minutes: 24, median_resolution_minutes: 680 },
    { metric_date: "2026-03-23", label: "Mar 23", opened_count: 4, resolved_count: 2, open_backlog_count: 7, median_first_reply_minutes: 31, median_resolution_minutes: 750 },
    { metric_date: "2026-03-24", label: "Mar 24", opened_count: 2, resolved_count: 3, open_backlog_count: 6, median_first_reply_minutes: 20, median_resolution_minutes: 610 }
  ]
};

const zendeskTicketList: ZendeskLeadershipTicketList = {
  connection: zendeskStatus.connection,
  tickets: [
    {
      zendesk_ticket_id: "5001001",
      subject: "School portraits roster mismatch",
      requester_name: "Northview Elementary",
      requester_email: "office@northview.example.com",
      assignee_name: "Casey Support",
      organization_name: "Northview Elementary",
      group_name: "Schools Support",
      status: "open",
      priority: "high",
      category: "schools",
      ticket_created_at: "2026-03-24T14:00:00.000Z",
      ticket_updated_at: "2026-03-25T08:00:00.000Z",
      ticket_solved_at: null,
      first_reply_minutes: 18,
      resolution_minutes: null,
      is_unassigned: false,
      external_url: "https://example.zendesk.com/agent/tickets/5001001",
      tags: ["schools"]
    }
  ]
};

const attendanceExceptions: AttendanceExceptionRecord[] = [
  {
    id: "exception-1",
    exception_type: "EARLY_CLOCK_IN_APPROVAL",
    status: "open",
    severity: "high",
    classification: null,
    reason_code: "approved_early",
    notes: "First detail note",
    requested_value: { early_minutes: 12 },
    original_value: { early_minutes: 0 },
    resolved_value: null,
    requested_approver_user_id: "user-senior",
    requested_approver_name: "Demo Senior Photographer",
    approved_by_user_id: null,
    approved_by_name: null,
    shift_id: "shift-alpha",
    shoot_code: "DEMO-001",
    shift_title: "Shift Alpha",
    user_name: "Demo Photographer",
    manager_name: "Demo Senior Photographer",
    created_at: "2026-03-24T14:05:00.000Z",
    updated_at: "2026-03-24T14:05:00.000Z",
    approved_at: null
  },
  {
    id: "exception-2",
    exception_type: "WRONG_LOCATION",
    status: "open",
    severity: "high",
    classification: null,
    reason_code: "gps_issue",
    notes: "Second detail note",
    requested_value: { geofence_status: "inside" },
    original_value: { geofence_status: "outside" },
    resolved_value: null,
    requested_approver_user_id: "user-senior",
    requested_approver_name: "Demo Senior Photographer",
    approved_by_user_id: null,
    approved_by_name: null,
    shift_id: "shift-beta",
    shoot_code: "DEMO-002",
    shift_title: "Shift Beta",
    user_name: "Demo Associate",
    manager_name: "Demo Senior Photographer",
    created_at: "2026-03-24T15:05:00.000Z",
    updated_at: "2026-03-24T15:05:00.000Z",
    approved_at: null
  }
];

const attendanceOperationsWorkspace: AttendanceOperationsWorkspaceRecord = {
  generated_at: "2026-03-24T15:10:00.000Z",
  date: "2026-03-24",
  scope: "department",
  timing_rules: {
    awarenessWindowMinutes: 30,
    graceWindowMinutes: 5,
    unresolvedThresholdMinutes: 12,
    noShowThresholdMinutes: 20
  },
  summary: {
    tracked_shift_count: 2,
    on_time_count: 0,
    checked_in_count: 0,
    late_count: 1,
    unresolved_count: 0,
    called_out_count: 1,
    replacement_needed_count: 0,
    no_show_count: 0,
    coverage_impact_count: 1,
    critical_role_missing_count: 1,
    understaffed_due_to_attendance_count: 1
  },
  sections: [
    {
      key: "critical_risk",
      label: "Critical Coverage Risk",
      description: "Attendance problems already impacting lead coverage or minimum staffing.",
      count: 1,
      items: [
        {
          shift_id: "shift-beta",
          shoot_id: "shoot-2",
          employee_id: "user-associate",
          employee_name: "Demo Associate",
          employee_email: "associate@example.com",
          manager_user_id: "user-senior",
          manager_name: "Demo Senior Photographer",
          department: "schools",
          shift_title: "Shift Beta",
          starts_at: "2026-03-24T15:00:00.000Z",
          ends_at: "2026-03-24T17:00:00.000Z",
          location_name: "North Metro Stadium",
          location_address: "2500 Stadium Drive",
          staffing_role: "check_in",
          satisfies_lead_coverage: false,
          shoot_code: "DEMO-002",
          shoot_title: "Friday Night Lights Media Day",
          shoot_date: "2026-03-24",
          school_name: "North Metro High School",
          current_state: "called_out",
          current_state_reason: "Manager recorded a same-day callout and coverage is now at risk.",
          signal_source: "manager_mark_called_out",
          escalation_level: 3,
          last_signal_at: "2026-03-24T15:08:00.000Z",
          first_present_at: null,
          latest_check_in_at: null,
          latest_time_clock_start_at: null,
          manager_mark_present_at: null,
          late_acknowledged_at: null,
          called_out_at: "2026-03-24T15:08:00.000Z",
          replacement_needed_at: null,
          no_show_marked_at: null,
          manager_excused_at: null,
          open_alert_types: ["called_out", "critical_role_missing", "understaffed_due_to_attendance"],
          coverage_impact: true,
          critical_role_missing: true,
          understaffed_due_to_attendance: true,
          minimum_staff_count: 2,
          planned_staff_count: 2,
          required_lead_count: 1,
          active_present_count: 1,
          present_lead_count: 0,
          minutes_from_start: 8,
          minutes_until_start: null,
          health_tone: "critical",
          state_label: "Called Out",
          alert_labels: ["Called Out", "Critical Role Missing", "Understaffed Due To Attendance"],
          scheduling_hash: "#scheduling?area=staffing&date=2026-03-24&shoot=shoot-2&shift=shift-beta"
        }
      ]
    },
    {
      key: "late_watch",
      label: "Late And Unresolved",
      description: "People who are late, acknowledged late, or still unresolved after the start window.",
      count: 1,
      items: [
        {
          shift_id: "shift-alpha",
          shoot_id: "shoot-1",
          employee_id: "user-photo",
          employee_name: "Demo Photographer",
          employee_email: "photo@example.com",
          manager_user_id: "user-senior",
          manager_name: "Demo Senior Photographer",
          department: "schools",
          shift_title: "Shift Alpha",
          starts_at: "2026-03-24T14:00:00.000Z",
          ends_at: "2026-03-24T16:30:00.000Z",
          location_name: "Main Gym",
          location_address: "500 School Road",
          staffing_role: "photographer",
          satisfies_lead_coverage: false,
          shoot_code: "DEMO-001",
          shoot_title: "Spring Portrait Day",
          shoot_date: "2026-03-24",
          school_name: "White Bear Lake High School",
          current_state: "late",
          current_state_reason: "The grace window passed and no valid check-in was captured yet.",
          signal_source: "system_schedule",
          escalation_level: 2,
          last_signal_at: null,
          first_present_at: null,
          latest_check_in_at: null,
          latest_time_clock_start_at: null,
          manager_mark_present_at: null,
          late_acknowledged_at: null,
          called_out_at: null,
          replacement_needed_at: null,
          no_show_marked_at: null,
          manager_excused_at: null,
          open_alert_types: ["late"],
          coverage_impact: false,
          critical_role_missing: false,
          understaffed_due_to_attendance: false,
          minimum_staff_count: 2,
          planned_staff_count: 2,
          required_lead_count: 1,
          active_present_count: 1,
          present_lead_count: 1,
          minutes_from_start: 9,
          minutes_until_start: null,
          health_tone: "warning",
          state_label: "Late",
          alert_labels: ["Late"],
          scheduling_hash: "#scheduling?area=staffing&date=2026-03-24&shoot=shoot-1&shift=shift-alpha"
        }
      ]
    },
    {
      key: "coverage_replacement",
      label: "Callouts And Replacement",
      description: "Callouts, replacement-needed shifts, and same-day coverage handoffs.",
      count: 0,
      items: []
    },
    {
      key: "checked_in",
      label: "Checked In And On Time",
      description: "Assignments that have confirmed attendance and are operationally on track.",
      count: 0,
      items: []
    },
    {
      key: "resolved",
      label: "Resolved / Closed",
      description: "Excused, completed, or canceled assignments for the selected day.",
      count: 0,
      items: []
    }
  ],
  home_ready_summary: {
    visible: true,
    summary_line: "1 attendance issue is now impacting coverage.",
    urgent_count: 2,
    staffing_risk_count: 1,
    items: [
      {
        shift_id: "shift-beta",
        title: "North Metro High School",
        summary: "Demo Associate | Called Out | Coverage risk",
        urgency_label: "Coverage risk",
        state: "called_out",
        scheduling_hash: "#scheduling?area=staffing&date=2026-03-24&shoot=shoot-2&shift=shift-beta"
      }
    ]
  }
};

const attendanceDetailAlpha: AttendanceOperationDetailRecord = {
  generated_at: "2026-03-24T15:10:00.000Z",
  item: attendanceOperationsWorkspace.sections[1]?.items[0]!,
  available_actions: ["mark_present", "acknowledge_late", "mark_called_out", "request_replacement", "mark_no_show", "excuse"],
  staffing_impact: {
    coverage_impact: false,
    critical_role_missing: false,
    understaffed_due_to_attendance: false,
    minimum_staff_count: 2,
    planned_staff_count: 2,
    required_lead_count: 1,
    active_present_count: 1,
    present_lead_count: 1,
    scheduling_hash: "#scheduling?area=staffing&date=2026-03-24&shoot=shoot-1&shift=shift-alpha"
  },
  history: [
    {
      id: "attendance-history-alpha-1",
      event_type: "state_changed",
      from_state: "grace_window",
      to_state: "late",
      signal_source: "system_schedule",
      escalation_level: 2,
      note: "The grace window passed and no valid check-in was captured yet.",
      metadata: null,
      created_at: "2026-03-24T14:09:00.000Z",
      actor_user_id: null,
      actor_user_name: null
    }
  ]
};

const attendanceDetailBeta: AttendanceOperationDetailRecord = {
  generated_at: "2026-03-24T15:10:00.000Z",
  item: attendanceOperationsWorkspace.sections[0]?.items[0]!,
  available_actions: ["mark_present", "request_replacement", "mark_no_show", "excuse"],
  staffing_impact: {
    coverage_impact: true,
    critical_role_missing: true,
    understaffed_due_to_attendance: true,
    minimum_staff_count: 2,
    planned_staff_count: 2,
    required_lead_count: 1,
    active_present_count: 1,
    present_lead_count: 0,
    scheduling_hash: "#scheduling?area=staffing&date=2026-03-24&shoot=shoot-2&shift=shift-beta"
  },
  history: [
    {
      id: "attendance-history-beta-1",
      event_type: "manager_mark_called_out",
      from_state: "late",
      to_state: "called_out",
      signal_source: "manager_mark_called_out",
      escalation_level: 3,
      note: "Manager recorded a same-day callout and coverage is now at risk.",
      metadata: null,
      created_at: "2026-03-24T15:08:00.000Z",
      actor_user_id: "user-senior",
      actor_user_name: "Demo Senior Photographer"
    }
  ]
};

const timeClockComplianceReview = {
  summary: {
    open_count: 3,
    high_severity_count: 1,
    counts_by_item: {
      missing_setup_photo: 1,
      missing_post_shoot_evaluation: 1,
      mileage_blocked_missing_post_shoot_evaluation: 0,
      upload_while_off_clock: 1,
      unresolved_end_of_day_confirmation: 0
    }
  },
  rows: [
    {
      id: "compliance-1",
      employee_id: "user-photo",
      employee_name: "Demo Photographer",
      shift_id: "shift-alpha",
      shift_title: "Shift Alpha",
      session_id: "session-alpha",
      shoot_id: "shoot-1",
      shoot_code: "DEMO-001",
      shoot_title: "Spring Portrait Day",
      location_name: "Main Gym",
      item_type: "missing_setup_photo",
      item_label: "Missing Setup Photo",
      severity: "warning" as const,
      status: "open" as const,
      message: "Setup Photo is still missing 30 minutes into Spring Portrait Day.",
      first_detected_at: "2026-03-24T14:35:00.000Z",
      last_detected_at: "2026-03-24T14:35:00.000Z",
      linked_exception_request_id: null
    },
    {
      id: "compliance-2",
      employee_id: "user-associate",
      employee_name: "Demo Associate",
      shift_id: "shift-beta",
      shift_title: "Shift Beta",
      session_id: "session-beta",
      shoot_id: "shoot-2",
      shoot_code: "DEMO-002",
      shoot_title: "Friday Night Lights Media Day",
      location_name: "North Metro Stadium",
      item_type: "missing_post_shoot_evaluation",
      item_label: "Missing Post-Shoot Evaluation",
      severity: "high" as const,
      status: "open" as const,
      message: "Post-Shoot Evaluation is still missing for Friday Night Lights Media Day.",
      first_detected_at: "2026-03-24T21:15:00.000Z",
      last_detected_at: "2026-03-24T21:15:00.000Z",
      linked_exception_request_id: null
    },
    {
      id: "compliance-3",
      employee_id: "user-photo",
      employee_name: "Demo Photographer",
      shift_id: "shift-alpha",
      shift_title: "Shift Alpha",
      session_id: "session-alpha",
      shoot_id: "shoot-1",
      shoot_code: "DEMO-001",
      shoot_title: "Spring Portrait Day",
      location_name: "Main Gym",
      item_type: "upload_while_off_clock",
      item_label: "Upload While Off Clock",
      severity: "warning" as const,
      status: "open" as const,
      message: "Upload captured while Off Clock for Spring Portrait Day.",
      first_detected_at: "2026-03-24T14:40:00.000Z",
      last_detected_at: "2026-03-24T14:40:00.000Z",
      linked_exception_request_id: "request-1"
    }
  ]
};

const locationCatalog: LocationCatalogResponse = {
  locations: [
    {
      id: "location-1",
      name: "Downtown Demo Park",
      address: "101 Demo Park Avenue, Minneapolis, MN",
      location_details: "Unload curbside and keep the backup backdrop near the fountain.",
      commentary: "Families stack quickly after 3 PM.",
      custodian_contact: "Main office",
      category: "school",
      navigation_url: "https://maps.example/downtown-demo-park",
      latitude: 44.9778,
      longitude: -93.2649,
      estimated_drive_minutes: 18,
      stats: {
        avg_rating: 4.5,
        on_time_percent: 86,
        easy_access_percent: 74,
        evaluation_count: 3,
        setup_photo_count: 2
      },
      photo_count: 2,
      area_count: 1,
      latest_recommendation: "Use the side sidewalk for unload during dismissal.",
      distance_miles: null,
      integration: mondayPartialIntegration
    },
    {
      id: "location-2",
      name: "North Metro Stadium",
      address: "2500 Stadium Drive, Plymouth, MN",
      location_details: "Use the east athlete gate and keep a runner by the fieldhouse door.",
      commentary: "Gate access changes when buses queue on the west side.",
      custodian_contact: "Athletics office",
      category: "sports",
      navigation_url: "https://maps.example/north-metro-stadium",
      latitude: 45.0144,
      longitude: -93.4557,
      estimated_drive_minutes: 32,
      stats: {
        avg_rating: 4.2,
        on_time_percent: 82,
        easy_access_percent: 68,
        evaluation_count: 5,
        setup_photo_count: 4
      },
      photo_count: 4,
      area_count: 2,
      latest_recommendation: "Unload at the east gate first.",
      distance_miles: null,
      integration: mondayCoexistingIntegration
    }
  ],
  cache: {
    fetchedAt: "2026-03-24T14:10:00.000Z",
    stale: false,
    source: "live"
  }
};

const leadershipResourceLibrary = {
  access: {
    can_manage: true,
    can_download: true,
    limited_view: false,
    historical_window_years: null
  },
  summary: {
    total_items: 3,
    media_count: 1,
    document_count: 1,
    best_reference_count: 1,
    pending_review_count: 0,
    leadership_only_count: 0,
    rejected_count: 0,
    prep_highlight_count: 2
  },
  review_queue: [],
  prep_highlights: [
    {
      id: "resource-highlight-1",
      organization_id: "org-1",
      organization_display_name: "White Bear Lake High School",
      location_id: "location-1",
      location_name: "Downtown Demo Park",
      shoot_id: "shoot-1",
      shoot_code: "DEMO-001",
      shoot_title: "Spring Portrait Day",
      uploader_user_id: "user-leadership",
      uploader_name: "Demo Leadership",
      resource_type: "image" as const,
      category: "prior_successful_example" as const,
      note: "Best Reference for the spring portrait setup.",
      issue_type: null,
      approval_status: "approved" as const,
      visibility_scope: "photographer_prep" as const,
      best_reference_candidate: true,
      is_best_reference: true,
      best_reference_category: "best_setup_example" as const,
      file_name: "best-reference.jpg",
      content_type: "image/jpeg",
      file_size_bytes: 128400,
      storage_key: "tenants/demo/best-reference.jpg",
      preview_url: "https://example.test/best-reference.jpg",
      download_url: "https://example.test/best-reference.jpg",
      shoot_date: "2024-03-20",
      captured_at: "2024-03-20T12:00:00.000Z",
      created_at: "2024-03-20T12:00:00.000Z",
      reviewed_at: "2024-03-21T12:00:00.000Z",
      reviewed_by_user_id: "user-leadership",
      reviewed_by_name: "Demo Leadership",
      review_note: "Keep this for next season.",
      linked_scope: "shoot" as const
    },
    {
      id: "resource-highlight-2",
      organization_id: "org-1",
      organization_display_name: "White Bear Lake High School",
      location_id: "location-1",
      location_name: "Downtown Demo Park",
      shoot_id: null,
      shoot_code: null,
      shoot_title: null,
      uploader_user_id: "user-senior",
      uploader_name: "Demo Senior Photographer",
      resource_type: "document" as const,
      category: "qr_code_job_document" as const,
      note: "QR code packet for day-of check-in.",
      issue_type: null,
      approval_status: "approved" as const,
      visibility_scope: "photographer_prep" as const,
      best_reference_candidate: false,
      is_best_reference: false,
      best_reference_category: null,
      file_name: "check-in-qr.pdf",
      content_type: "application/pdf",
      file_size_bytes: 88321,
      storage_key: "tenants/demo/check-in-qr.pdf",
      preview_url: "https://example.test/check-in-qr.pdf",
      download_url: "https://example.test/check-in-qr.pdf",
      shoot_date: null,
      captured_at: "2025-03-20T12:00:00.000Z",
      created_at: "2025-03-20T12:00:00.000Z",
      reviewed_at: "2025-03-21T12:00:00.000Z",
      reviewed_by_user_id: "user-leadership",
      reviewed_by_name: "Demo Leadership",
      review_note: "Useful for field prep.",
      linked_scope: "location" as const
    }
  ],
  media: [
    {
      id: "resource-media-1",
      organization_id: "org-1",
      organization_display_name: "White Bear Lake High School",
      location_id: "location-1",
      location_name: "Downtown Demo Park",
      shoot_id: "shoot-1",
      shoot_code: "DEMO-001",
      shoot_title: "Spring Portrait Day",
      uploader_user_id: "user-leadership",
      uploader_name: "Demo Leadership",
      resource_type: "image" as const,
      category: "setup_photo" as const,
      note: "Portable risers stay tight to the wall.",
      issue_type: null,
      approval_status: "approved" as const,
      visibility_scope: "photographer_prep" as const,
      best_reference_candidate: false,
      is_best_reference: false,
      best_reference_category: null,
      file_name: "setup-photo.jpg",
      content_type: "image/jpeg",
      file_size_bytes: 64210,
      storage_key: "tenants/demo/setup-photo.jpg",
      preview_url: "https://example.test/setup-photo.jpg",
      download_url: "https://example.test/setup-photo.jpg",
      shoot_date: "2026-03-20",
      captured_at: "2026-03-20T12:00:00.000Z",
      created_at: "2026-03-20T12:00:00.000Z",
      reviewed_at: "2026-03-20T14:00:00.000Z",
      reviewed_by_user_id: "user-leadership",
      reviewed_by_name: "Demo Leadership",
      review_note: "Solid setup reminder.",
      linked_scope: "shoot" as const
    }
  ],
  documents: [
    {
      id: "resource-document-1",
      organization_id: "org-1",
      organization_display_name: "White Bear Lake High School",
      location_id: "location-1",
      location_name: "Downtown Demo Park",
      shoot_id: null,
      shoot_code: null,
      shoot_title: null,
      uploader_user_id: "user-leadership",
      uploader_name: "Demo Leadership",
      resource_type: "document" as const,
      category: "qr_code_job_document" as const,
      note: "Team QR reference.",
      issue_type: null,
      approval_status: "approved" as const,
      visibility_scope: "photographer_prep" as const,
      best_reference_candidate: false,
      is_best_reference: false,
      best_reference_category: null,
      file_name: "team-qr.pdf",
      content_type: "application/pdf",
      file_size_bytes: 42000,
      storage_key: "tenants/demo/team-qr.pdf",
      preview_url: "https://example.test/team-qr.pdf",
      download_url: "https://example.test/team-qr.pdf",
      shoot_date: null,
      captured_at: "2026-03-19T12:00:00.000Z",
      created_at: "2026-03-19T12:00:00.000Z",
      reviewed_at: "2026-03-19T15:00:00.000Z",
      reviewed_by_user_id: "user-leadership",
      reviewed_by_name: "Demo Leadership",
      review_note: "Current QR packet.",
      linked_scope: "organization" as const
    }
  ],
  historical_references: [
    {
      id: "resource-history-1",
      organization_id: "org-1",
      organization_display_name: "White Bear Lake High School",
      location_id: "location-1",
      location_name: "Downtown Demo Park",
      shoot_id: null,
      shoot_code: null,
      shoot_title: null,
      uploader_user_id: "user-leadership",
      uploader_name: "Demo Leadership",
      resource_type: "image" as const,
      category: "location_reference" as const,
      note: "Reference lane spacing from last season.",
      issue_type: null,
      approval_status: "approved" as const,
      visibility_scope: "photographer_prep" as const,
      best_reference_candidate: false,
      is_best_reference: false,
      best_reference_category: null,
      file_name: "lane-reference.jpg",
      content_type: "image/jpeg",
      file_size_bytes: 54321,
      storage_key: "tenants/demo/lane-reference.jpg",
      preview_url: "https://example.test/lane-reference.jpg",
      download_url: "https://example.test/lane-reference.jpg",
      shoot_date: "2023-03-20",
      captured_at: "2023-03-20T12:00:00.000Z",
      created_at: "2023-03-20T12:00:00.000Z",
      reviewed_at: "2023-03-21T12:00:00.000Z",
      reviewed_by_user_id: "user-leadership",
      reviewed_by_name: "Demo Leadership",
      review_note: "Useful historical lane layout.",
      linked_scope: "location" as const
    }
  ],
  post_shoot_learnings: [
    {
      id: "learning-1",
      shoot_name: "Spring Portrait Day",
      shoot_date: "2025-03-18",
      photographer_name: "Demo Senior Photographer",
      overall_rating: 4,
      recommendations: "Stage cases near the east wall before families start arriving.",
      notes: "Families stack up quickly near the south lot.",
      access_details: "Door 2 unlocks later than expected.",
      late_details: null
    }
  ],
  recurring_location_intelligence: null
} satisfies OrganizationDetail["resource_library"];

const locationDetailById: Record<string, ShootLocationDetail> = {
  "location-1": {
    ...locationCatalog.locations[0],
    areas: [
      {
        id: "area-1",
        name: "Fountain Lane",
        location_details: "Keep the second light further back from the curb.",
        commentary: "Families tend to arrive from the south lot.",
        photo_urls: ["https://images.example/fountain-lane.jpg"]
      }
    ],
    photo_gallery: [
      {
        id: "photo-1",
        image_url: "https://images.example/downtown-demo-park.jpg",
        source: "catalog",
        caption: "Downtown Demo Park setup lane",
        uploaded_at: "2026-03-20T17:00:00.000Z",
        uploader_name: "Location Guide"
      }
    ],
    evaluations: [
      {
        id: "eval-1",
        source: "monday",
        monday_item_id: "monday-1",
        shoot_name: "Downtown Demo Park",
        shoot_date: "2026-03-20",
        photographer_name: "Demo Photographer",
        shoot_type: "Schools",
        on_time: "Yes",
        easy_access: "No",
        overall_rating: 4,
        photos_uploaded: "Yes",
        late_details: null,
        access_details: "Dismissal traffic backed up the front lane.",
        notes: "The side sidewalk stayed clean for unload.",
        outreach_notes: null,
        recommendations: "Unload from the south curb.",
        image_quality: "Strong",
        submitted_by_name: "Monday history",
        created_at: "2026-03-20T18:00:00.000Z"
      }
    ],
    location_memory: {
      status: "active",
      last_confirmed_at: "2026-03-20T18:00:00.000Z",
      last_updated_by: "Demo Leadership",
      where_to_go: "Use the south curb unload lane.",
      where_to_park: "Staff can park in the south lot after unload.",
      where_to_set_up: "Stage the setup near Fountain Lane.",
      top_watch_out: "Dismissal traffic backs up the front lane.",
      notes: [],
      setup_photos: []
    },
    historical_context: {
      quick_context: {
        first_time_location: false,
        total_prior_visits: 4,
        last_visit_date: "2026-03-20",
        last_confirmed_memory_date: "2026-03-20T18:00:00.000Z",
        top_watch_outs: ["Dismissal traffic backs up the front lane.", "Unload from the south curb."],
        recommended_arrival_buffer_minutes: 20,
        recommended_staffing_note: "Plan 3 staff next time.",
        freshness_state: "fresh",
        memory_status: "active",
        open_issue_count: 1,
        trust_source: "reviewed_memory"
      },
      last_time_here: {
        shoot_date: "2026-03-20",
        shoot_type: "Schools",
        overall_outcome: "minor_issues",
        staffing_fit: "right_sized",
        setup_difficulty: "medium",
        major_issue: false,
        next_time_recommendation: "Unload from the south curb.",
        setup_photos_exist: true
      },
      repeat_pattern_signals: [
        {
          key: "repeated_parking_load_in",
          label: "Recurring entrance or parking confusion",
          detail: "2 recent comparable shoots flagged parking or load-in trouble.",
          evidence_count: 2,
          severity: "warning",
          source: "repeated_structured_pattern"
        }
      ],
      open_follow_ups: [
        {
          id: "follow-up-1",
          type: "eval_follow_up",
          title: "Post-shoot follow-up is still open",
          detail: "Confirm the unload lane with the school before the next visit.",
          related_shoot_name: "Downtown Demo Park",
          related_shoot_date: "2026-03-20",
          created_at: "2026-03-20T18:00:00.000Z",
          source_label: "Post-Shoot Eval"
        }
      ],
      setup_visuals: {
        photos: [
          {
            id: "photo-1",
            image_url: "https://images.example/downtown-demo-park.jpg",
            source: "catalog",
            caption: "Downtown Demo Park setup lane",
            uploaded_at: "2026-03-20T17:00:00.000Z",
            uploader_name: "Location Guide"
          }
        ],
        top_setup_instruction: "Stage the setup near Fountain Lane.",
        top_load_in_instruction: "Staff can park in the south lot after unload."
      },
      recent_comparable_shoots: [
        {
          id: "eval-1",
          shoot_name: "Downtown Demo Park",
          shoot_date: "2026-03-20",
          shoot_type: "Schools",
          overall_outcome: "minor_issues",
          staffing_fit: "right_sized",
          setup_difficulty: "medium",
          issue_category: "parking_load_in",
          next_time_recommendation: "Unload from the south curb.",
          major_issue: false
        }
      ]
    },
    resource_library: leadershipResourceLibrary
  },
  "location-2": {
    ...locationCatalog.locations[1],
    areas: [
      {
        id: "area-2",
        name: "East Gate",
        location_details: "Line up signage before the buses arrive.",
        commentary: "The east gate is the cleanest athlete entry point.",
        photo_urls: ["https://images.example/east-gate.jpg"]
      }
    ],
    photo_gallery: [
      {
        id: "photo-2",
        image_url: "https://images.example/north-metro-stadium.jpg",
        source: "mission_control",
        caption: "North Metro east gate setup",
        uploaded_at: "2026-03-23T18:20:00.000Z",
        uploader_name: "Demo Senior Photographer"
      }
    ],
    evaluations: [
      {
        id: "eval-2",
        source: "mission_control",
        monday_item_id: "monday-2",
        shoot_name: "North Metro Stadium",
        shoot_date: "2026-03-22",
        photographer_name: "Demo Associate Photographer",
        shoot_type: "Sports",
        on_time: "No",
        easy_access: "Yes",
        overall_rating: 4,
        photos_uploaded: "Yes",
        late_details: "Traffic stacked at the west lot.",
        access_details: "East gate opened cleanly.",
        notes: "The trainer hallway was the best unload path.",
        outreach_notes: "Athletics office appreciated the faster recovery.",
        recommendations: "Unload at the east gate first.",
        image_quality: "Strong",
        submitted_by_name: "Mission Control",
        created_at: "2026-03-22T19:10:00.000Z"
      }
    ],
    location_memory: {
      status: "needs_refresh",
      last_confirmed_at: "2026-03-22T19:10:00.000Z",
      last_updated_by: "Demo Manager",
      where_to_go: "Use the east gate for athlete entry.",
      where_to_park: "Unload from the east lot first.",
      where_to_set_up: "Line up staging in the trainer hallway.",
      top_watch_out: "West lot traffic stacks fast before game time.",
      notes: [],
      setup_photos: []
    },
    historical_context: {
      quick_context: {
        first_time_location: false,
        total_prior_visits: 3,
        last_visit_date: "2026-03-22",
        last_confirmed_memory_date: "2026-03-22T19:10:00.000Z",
        top_watch_outs: ["West lot traffic stacks fast before game time.", "Unload at the east gate first."],
        recommended_arrival_buffer_minutes: 30,
        recommended_staffing_note: "Increase staffing coverage or add a stronger backup plan next time.",
        freshness_state: "needs_refresh",
        memory_status: "needs_refresh",
        open_issue_count: 2,
        trust_source: "repeated_pattern"
      },
      last_time_here: {
        shoot_date: "2026-03-22",
        shoot_type: "Sports",
        overall_outcome: "major_issues",
        staffing_fit: "understaffed",
        setup_difficulty: "high",
        major_issue: true,
        next_time_recommendation: "Unload at the east gate first.",
        setup_photos_exist: true
      },
      repeat_pattern_signals: [
        {
          key: "repeated_understaffing",
          label: "Repeated understaffing",
          detail: "2 recent comparable shoots were marked understaffed.",
          evidence_count: 2,
          severity: "high",
          source: "repeated_structured_pattern"
        }
      ],
      open_follow_ups: [],
      setup_visuals: {
        photos: [
          {
            id: "photo-2",
            image_url: "https://images.example/north-metro-stadium.jpg",
            source: "mission_control",
            caption: "North Metro east gate setup",
            uploaded_at: "2026-03-23T18:20:00.000Z",
            uploader_name: "Demo Senior Photographer"
          }
        ],
        top_setup_instruction: "Line up staging in the trainer hallway.",
        top_load_in_instruction: "Unload from the east lot first."
      },
      recent_comparable_shoots: []
    },
    resource_library: leadershipResourceLibrary
  }
};

const shootDetailById: Record<string, ShootDetail> = Object.fromEntries(
  shootSummaries.map((shoot) => [
    shoot.id,
    {
      ...shoot,
      media:
        shoot.id === "shoot-1"
          ? [
              {
                id: "media-1",
                kind: "photo",
                storage_key: "shoots/demo-001/setup-reference.jpg",
                url: "https://example.com/demo-001-reference.jpg",
                created_at: "2026-03-23T15:00:00.000Z"
              }
            ]
          : [],
      location_intelligence:
        shoot.id === "shoot-1"
          ? {
              shoot_id: shoot.id,
              outlook_event_id: null,
              shoot_code: shoot.shoot_code,
              matched_location_id: locationDetailById["location-1"].id,
              match_source: "manual",
              confidence: 0.96,
              location: locationDetailById["location-1"],
              recent_evaluations: locationDetailById["location-1"].evaluations,
              recent_photos: locationDetailById["location-1"].photo_gallery,
              suggestions: [],
              missing_setup_photo_alert: null
            }
          : shoot.id === "shoot-2"
            ? {
                shoot_id: shoot.id,
                outlook_event_id: null,
                shoot_code: shoot.shoot_code,
                matched_location_id: locationDetailById["location-2"].id,
                match_source: "fuzzy",
                confidence: 0.92,
                location: locationDetailById["location-2"],
                recent_evaluations: locationDetailById["location-2"].evaluations,
                recent_photos: locationDetailById["location-2"].photo_gallery,
                suggestions: [],
                missing_setup_photo_alert: null
              }
            : null
      ,
      ready_to_shoot:
        shoot.id === "shoot-2"
          ? {
              lead_confirmed_ready: false,
              lead_confirmed_ready_at: null,
              lead_confirmed_ready_by_user_id: null,
              lead_confirmed_ready_by_name: null,
              lead_confirmed_ready_exception_flag: false,
              lead_confirmed_ready_confirmation_id: null,
              ready_to_shoot_status: "escalation_due",
              ready_to_shoot_label: "Lead confirmation overdue",
              ready_to_shoot_tone: "action_needed",
              ready_to_shoot_available: false,
              ready_to_shoot_setup_window_active: true,
              ready_to_shoot_reminder_due: false,
              ready_to_shoot_escalation_due: true,
              ready_to_shoot_minutes_until_start: 5,
              show_action: false,
              already_confirmed: false,
              actor_is_authorized: false,
              actor_has_exception_authority: true,
              actor_on_site: false,
              checks: [
                {
                  key: "lead_on_site",
                  label: "Lead is on site",
                  passed: false,
                  detail: "The confirming lead must be on site before confirming."
                },
                {
                  key: "required_photographers_present",
                  label: "Assigned photographers are present or accounted for",
                  passed: false,
                  detail: "1/2 assigned photographers accounted for."
                }
              ],
              missing_items: [
                "The confirming lead must be on site before confirming.",
                "1/2 assigned photographers accounted for."
              ],
              can_confirm_clean: false,
              can_confirm_with_exception: false,
              participants: [
                {
                  shift_id: "shift-lead",
                  user_id: "user-senior",
                  name: "Demo Senior Photographer",
                  role_label: "Lead Photographer",
                  is_photographer_role: true,
                  is_lead_assignment: true,
                  accounted_for: false,
                  accounted_label: "Not yet accounted for",
                  latest_punch_direction: null,
                  latest_punch_at: null,
                  presence_state: null,
                  presence_captured_at: null
                },
                {
                  shift_id: "shift-photo",
                  user_id: "user-photo",
                  name: "Demo Photographer",
                  role_label: "Photographer",
                  is_photographer_role: true,
                  is_lead_assignment: false,
                  accounted_for: true,
                  accounted_label: "Clocked in",
                  latest_punch_direction: "in",
                  latest_punch_at: "2026-03-24T17:54:00.000Z",
                  presence_state: "photography",
                  presence_captured_at: "2026-03-24T17:54:00.000Z"
                }
              ],
              staffing_snapshot: {
                assigned_staff_count: 2,
                minimum_staff_count: 2,
                lead_coverage_count: 0,
                open_required_slot_count: 1,
                staffing_state: "under_minimum",
                staffing_clean_for_ready: false,
                staffing_hard_blockers: ["Lead coverage missing."],
                staffing_warnings: ["Coverage is fragile."]
              },
              latest_confirmation: null,
              window: {
                shoot_is_today: true,
                starts_at: "2026-03-24T18:00:00.000Z",
                opens_at: "2026-03-24T17:00:00.000Z",
                closes_at: "2026-03-24T18:15:00.000Z",
                minutes_until_start: 5
              }
            }
          : null
    }
  ])
) as Record<string, ShootDetail>;

const organizationDetailById: Record<string, OrganizationDetail> = {
  "org-1": {
    organization: {
      id: "org-1",
    canonical_name: "White Bear Lake High School",
    logo_url: null,
    display_name: "White Bear Lake High School",
      account_type: "schools_underclass_portraits",
      active_status: "active",
      aliases: ["WBL High School"],
      notes: "Canonical school Organization record for recurring portrait scheduling.",
      contact_count: 2,
      location_count: 1,
      created_at: "2026-03-20T12:00:00.000Z",
      updated_at: "2026-03-24T12:00:00.000Z"
    },
    contacts: [
      {
        id: "contact-1",
        organization_id: "org-1",
        first_name: "Jamie",
        last_name: "Carlson",
        full_name: "Jamie Carlson",
        title: "Activities Director",
        phone: "555-0188",
        email: "jamie.carlson@example.com",
        photo_url: null,
        active_status: "active",
        notes: "Primary planning contact.",
        created_at: "2026-03-20T12:00:00.000Z",
        updated_at: "2026-03-24T12:00:00.000Z"
      },
      {
        id: "contact-2",
        organization_id: "org-1",
        first_name: "Megan",
        last_name: "Stark",
        full_name: "Megan Stark",
        title: "Main Office",
        phone: "555-0155",
        email: "office.whitebear@example.com",
        photo_url: null,
        active_status: "active",
        notes: "Front office escalation contact.",
        created_at: "2026-03-20T12:00:00.000Z",
        updated_at: "2026-03-24T12:00:00.000Z"
      }
    ],
    locations: [
      {
        id: "location-1",
        organization_id: "org-1",
        location_name: "Main Gym",
        address_line_1: "123 School Street",
        address_line_2: null,
        city: "White Bear Lake",
        state: "MN",
        zip: "55110",
        address_display: "123 School Street, White Bear Lake, MN, 55110",
        maps_label: "Main Gym",
        maps_url: "https://maps.example/main-gym",
        active_status: "active",
        notes: "Use the south loading door.",
        created_at: "2026-03-20T12:00:00.000Z",
        updated_at: "2026-03-24T12:00:00.000Z"
      }
    ],
    recent_shoots: [],
    agreements_access: {
      can_view: true,
      can_manage: true
    },
    agreement_summary: {
      total: 0,
      active: 0,
      pending_signature: 0,
      expiring_soon: 0,
      expired: 0,
      replaced_archived: 0,
      renewals_needed: 0,
      accounts_missing_active: 1,
      upcoming_shoot_risk_count: 0,
      has_active_agreement: false,
      has_pending_signature: false,
      has_expiring_soon: false,
      has_expired: false,
      needs_attention: false,
      warning_severity: "warning",
      warnings: []
    },
    agreements: [],
    agreement_templates: [],
    upcoming_shoot_agreement_risks: [],
    sales_pipeline_summary: {
      linked_opportunities: 0,
      active_opportunities: 0,
      dormant_opportunities: 0,
      open_alerts: 0,
      missing_next_action: 0,
      inactive_opportunities: 0,
      meeting_scheduled: 0
    },
    sales_pipeline_alerts: [],
    resource_library: leadershipResourceLibrary,
    placeholders: {
      agreement_summary: "No Agreements are attached to this Organization yet.",
      sales_pipeline_summary: "No sales pipeline activity is linked to this Organization yet.",
      recent_shoots_summary: "Recent shoots will live here.",
      resource_library_summary: "Resource Library will live here."
    }
  },
  "org-2": {
    organization: {
      id: "org-2",
    canonical_name: "North Metro Athletics",
    logo_url: null,
    display_name: "North Metro Athletics",
      account_type: "sports",
      active_status: "active",
      aliases: ["North Metro Stadium"],
      notes: "Canonical sports Organization record.",
      contact_count: 1,
      location_count: 1,
      created_at: "2026-03-20T12:00:00.000Z",
      updated_at: "2026-03-24T12:00:00.000Z"
    },
    contacts: [
      {
        id: "contact-3",
        organization_id: "org-2",
        first_name: "Riley",
        last_name: "Hart",
        full_name: "Coach Riley Hart",
        title: "Athletics Director",
        phone: "555-0142",
        email: "riley.hart@example.com",
        photo_url: null,
        active_status: "active",
        notes: "Primary game-day coordination contact.",
        created_at: "2026-03-20T12:00:00.000Z",
        updated_at: "2026-03-24T12:00:00.000Z"
      }
    ],
    locations: [
      {
        id: "location-2",
        organization_id: "org-2",
        location_name: "North Metro Stadium",
        address_line_1: "2500 Stadium Drive",
        address_line_2: null,
        city: "Plymouth",
        state: "MN",
        zip: "55447",
        address_display: "2500 Stadium Drive, Plymouth, MN, 55447",
        maps_label: "North Metro Stadium",
        maps_url: "https://maps.example/north-metro-stadium",
        active_status: "active",
        notes: "Use the east athlete gate.",
        created_at: "2026-03-20T12:00:00.000Z",
        updated_at: "2026-03-24T12:00:00.000Z"
      }
    ],
    recent_shoots: [],
    agreements_access: {
      can_view: true,
      can_manage: true
    },
    agreement_summary: {
      total: 0,
      active: 0,
      pending_signature: 0,
      expiring_soon: 0,
      expired: 0,
      replaced_archived: 0,
      renewals_needed: 0,
      accounts_missing_active: 1,
      upcoming_shoot_risk_count: 0,
      has_active_agreement: false,
      has_pending_signature: false,
      has_expiring_soon: false,
      has_expired: false,
      needs_attention: false,
      warning_severity: "warning",
      warnings: []
    },
    agreements: [],
    agreement_templates: [],
    upcoming_shoot_agreement_risks: [],
    sales_pipeline_summary: {
      linked_opportunities: 0,
      active_opportunities: 0,
      dormant_opportunities: 0,
      open_alerts: 0,
      missing_next_action: 0,
      inactive_opportunities: 0,
      meeting_scheduled: 0
    },
    sales_pipeline_alerts: [],
    resource_library: leadershipResourceLibrary,
    placeholders: {
      agreement_summary: "No Agreements are attached to this Organization yet.",
      sales_pipeline_summary: "No sales pipeline activity is linked to this Organization yet.",
      recent_shoots_summary: "Recent shoots will live here.",
      resource_library_summary: "Resource Library will live here."
    }
  },
  "org-3": {
    organization: {
      id: "org-3",
    canonical_name: "District Events Office",
    logo_url: null,
    display_name: "District Events Office",
      account_type: "events",
      active_status: "active",
      aliases: [],
      notes: "Placeholder event Organization record.",
      contact_count: 1,
      location_count: 1,
      created_at: "2026-03-20T12:00:00.000Z",
      updated_at: "2026-03-24T12:00:00.000Z"
    },
    contacts: [
      {
        id: "contact-4",
        organization_id: "org-3",
        first_name: "Pat",
        last_name: "Monroe",
        full_name: "Pat Monroe",
        title: "Event Coordinator",
        phone: "555-0199",
        email: "pat.monroe@example.com",
        photo_url: null,
        active_status: "active",
        notes: "Primary event contact.",
        created_at: "2026-03-20T12:00:00.000Z",
        updated_at: "2026-03-24T12:00:00.000Z"
      }
    ],
    locations: [
      {
        id: "location-3",
        organization_id: "org-3",
        location_name: "Grand Hall",
        address_line_1: "890 Grand Hall Way",
        address_line_2: null,
        city: "St. Paul",
        state: "MN",
        zip: "55102",
        address_display: "890 Grand Hall Way, St. Paul, MN, 55102",
        maps_label: "Grand Hall",
        maps_url: "https://maps.example/grand-hall",
        active_status: "active",
        notes: "Main event hall staging area.",
        created_at: "2026-03-20T12:00:00.000Z",
        updated_at: "2026-03-24T12:00:00.000Z"
      }
    ],
    recent_shoots: [],
    agreements_access: {
      can_view: true,
      can_manage: true
    },
    agreement_summary: {
      total: 0,
      active: 0,
      pending_signature: 0,
      expiring_soon: 0,
      expired: 0,
      replaced_archived: 0,
      renewals_needed: 0,
      accounts_missing_active: 1,
      upcoming_shoot_risk_count: 0,
      has_active_agreement: false,
      has_pending_signature: false,
      has_expiring_soon: false,
      has_expired: false,
      needs_attention: false,
      warning_severity: "warning",
      warnings: []
    },
    agreements: [],
    agreement_templates: [],
    upcoming_shoot_agreement_risks: [],
    sales_pipeline_summary: {
      linked_opportunities: 0,
      active_opportunities: 0,
      dormant_opportunities: 0,
      open_alerts: 0,
      missing_next_action: 0,
      inactive_opportunities: 0,
      meeting_scheduled: 0
    },
    sales_pipeline_alerts: [],
    resource_library: leadershipResourceLibrary,
    placeholders: {
      agreement_summary: "No Agreements are attached to this Organization yet.",
      sales_pipeline_summary: "No sales pipeline activity is linked to this Organization yet.",
      recent_shoots_summary: "Recent shoots will live here.",
      resource_library_summary: "Resource Library will live here."
    }
  }
};

const homeDashboardApp: HomeDashboardResponse = {
  generated_at: "2026-03-24T15:00:00.000Z",
  anchor_date: "2026-03-24",
  mode: "app",
  refresh_interval_seconds: 60,
  tv_rotation_seconds: 15,
  public_safe: false,
  tv_names_enabled: true,
  critical_banner: {
    tone: "action_needed",
    label: "Weather and Travel Watch",
    message: "Weather may affect 1 shoot today."
  },
  widgets: {
    today_strip: {
      shoot_count: 2,
      urgent_issue_count: 4,
      approvals_waiting_count: 3,
      late_arrival_count: 1,
      production_at_risk_count: 2
    },
    business_pulse: {
      tiles: [
        {
          id: "shoots_this_week",
          label: "Shoots This Week",
          value: 8,
          context_label: "+2 vs typical week",
          tone: "info",
          trend_label: "+14% vs typical",
          source_mode: "live"
        },
        {
          id: "subjects_this_week",
          label: "Subjects This Week",
          value: 542,
          context_label: "Very busy",
          tone: "info",
          trend_label: "+18% vs typical",
          source_mode: "live"
        },
        {
          id: "id_cards_to_print",
          label: "ID Cards to Print",
          value: 116,
          context_label: "Queue is building",
          tone: "heads_up",
          trend_label: "Building queue",
          source_mode: "derived_adapter"
        },
        {
          id: "jobs_needing_attention",
          label: "Jobs Needing Attention",
          value: 2,
          context_label: "2 jobs need a tune-up",
          tone: "action_needed",
          trend_label: "Watch this week",
          source_mode: "live"
        },
        {
          id: "labor_today",
          label: "Labor Today",
          value: 13,
          context_label: "On track",
          tone: "neutral",
          trend_label: "16.0h scheduled",
          source_mode: "live"
        }
      ],
      week_start: "2026-03-23",
      week_end: "2026-03-29",
      week_schedule: [
        { date: "2026-03-23", label: "Mon, Mar 23", short_label: "Mon", shoot_count: 1, big_shoot_count: 0, attention_count: 0, is_today: false },
        { date: "2026-03-24", label: "Tue, Mar 24", short_label: "Tue", shoot_count: 2, big_shoot_count: 1, attention_count: 1, is_today: true },
        { date: "2026-03-25", label: "Wed, Mar 25", short_label: "Wed", shoot_count: 1, big_shoot_count: 0, attention_count: 0, is_today: false },
        { date: "2026-03-26", label: "Thu, Mar 26", short_label: "Thu", shoot_count: 1, big_shoot_count: 0, attention_count: 0, is_today: false },
        { date: "2026-03-27", label: "Fri, Mar 27", short_label: "Fri", shoot_count: 2, big_shoot_count: 1, attention_count: 1, is_today: false },
        { date: "2026-03-28", label: "Sat, Mar 28", short_label: "Sat", shoot_count: 1, big_shoot_count: 0, attention_count: 0, is_today: false },
        { date: "2026-03-29", label: "Sun, Mar 29", short_label: "Sun", shoot_count: 0, big_shoot_count: 0, attention_count: 0, is_today: false }
      ],
      weekly_department_mix: [
        { department: "schools", shoots: 5, subjects: 342 },
        { department: "sports", shoots: 2, subjects: 160 },
        { department: "events", shoots: 1, subjects: 40 }
      ],
      jobs: [
        { id: "shoot-2", label: "DEMO-002 | Friday Night Lights Media Day", detail: "Schedule sync needs a retry", tone: "action_needed" },
        { id: "shoot-3", label: "DEMO-003 | District Awards Banquet", detail: "Timing or location details need a quick tune-up", tone: "heads_up" }
      ]
    },
    today_shoots: {
      total: 2,
      upcoming_count: 1,
      in_progress_count: 1,
      complete_count: 0,
      needs_attention_count: 1,
      big_shoot_count: 1,
      shoots: [
        {
          id: "shoot-1",
          shoot_code: "DEMO-001",
          title: "Spring Portrait Day",
          department: "schools",
          shoot_date: "2026-03-24",
          location_name: "Main Gym",
          location_address: "123 School Street",
          navigation_url: "https://maps.example/main-gym",
          estimated_drive_minutes: 18,
          arrival_time: "2026-03-24T14:00:00.000Z",
          start_time: "2026-03-24T15:00:00.000Z",
          end_time_est: "2026-03-24T18:00:00.000Z",
          projected_students: 48,
          status: "scheduled",
          scheduled_employee_count: 3,
          big_shoot: false,
          scale_label: "Multi-camera",
          phase: "in_progress",
          status_label: "In Progress",
          status_tone: "info",
          attention_label: null,
          attention_tone: null,
          sync_label: "In Sync",
          sync_tone: "neutral",
          next_action: "Keep the day moving"
        },
        {
          id: "shoot-2",
          shoot_code: "DEMO-002",
          title: "Friday Night Lights Media Day",
          department: "sports",
          shoot_date: "2026-03-24",
          location_name: "North Metro Stadium",
          location_address: "2500 Stadium Drive, Plymouth, MN",
          navigation_url: "https://maps.example/north-metro-stadium",
          estimated_drive_minutes: 32,
          arrival_time: "2026-03-24T17:00:00.000Z",
          start_time: "2026-03-24T18:00:00.000Z",
          end_time_est: "2026-03-24T21:00:00.000Z",
          projected_students: 96,
          status: "scheduled",
          scheduled_employee_count: 2,
          big_shoot: true,
          scale_label: "Large volume",
          phase: "needs_attention",
          status_label: "Needs Attention",
          status_tone: "action_needed",
          attention_label: "Weather watch",
          attention_tone: "action_needed",
          sync_label: "Sync Needs Retry",
          sync_tone: "action_needed",
          next_action: "Open the operational briefing"
        }
      ]
    },
    weather_travel_watch: {
      tone: "action_needed",
      summary_line: "1 shoot may be delayed by weather or travel.",
      items: [
        {
          shoot_id: "shoot-2",
          shoot_code: "DEMO-002",
          title: "Friday Night Lights Media Day",
          location_name: "North Metro Stadium",
          time_label: "6:00 PM - 9:00 PM",
          kind: "weather",
          severity: "action_needed",
          summary: "Weather may affect the outdoor setup window."
        }
      ]
    },
    customer_service_pulse: {
      safe_summary: true,
      tone: "heads_up",
      summary_line: "Backlog is building, but it still looks manageable.",
      open_tickets: 14,
      urgent_signal_count: 3,
      backlog_count: 14,
      trend_label: "Backlog is trending up",
      top_categories: [
        { label: "schools", count: 6 },
        { label: "sports", count: 4 },
        { label: "other", count: 4 }
      ],
      connected: true,
      drilldown_enabled: true
    },
    places_that_need_more_love: {
      summary_line: "2 locations could use extra prep or communication care.",
      items: [
        {
          location_id: "location-1",
          name: "Downtown Demo Park",
          category: "venue",
          tone: "heads_up",
          theme_label: "Parking is tricky",
          summary: "Unloading after 4 PM is smoother from the west gate.",
          affecting_today: true,
          recent_improvement: "Recent feedback is trending steadier here."
        },
        {
          location_id: "location-2",
          name: "North Metro Stadium",
          category: "sports",
          tone: "action_needed",
          theme_label: "Access is inconsistent",
          summary: "Use the east athlete gate and keep a runner by the fieldhouse door.",
          affecting_today: true,
          recent_improvement: null
        }
      ]
    },
    labor_snapshot_today: {
      visible: true,
      public_safe: true,
      tone: "neutral",
      summary_line: "Labor is tracking close to plan.",
      scheduled_hours: 16,
      actual_hours: 12.5,
      overtime_risk_count: 1,
      department_rollup: [{ label: "schools", scheduled_hours: 12, actual_hours: 10.5 }],
      shoot_rollup: [{ label: "DEMO-001", scheduled_hours: 8, actual_hours: 6.5 }]
    },
    attendance_awareness: {
      visible: true,
      summary: {
        clocked_in_count: 2,
        not_clocked_in_count: 1,
        late_count: 1,
        missing_count: 1,
        wrong_location_count: 1
      },
      clocked_in: {
        count: 2,
        items: [
          {
            id: "presence-office-1",
            employee_id: "user-senior",
            employee_name: "Demo Senior Photographer",
            shift_id: "shift-1",
            shoot_id: "shoot-1",
            primary_label: "Demo Senior Photographer",
            secondary_label: "Studio geofence",
            supporting_label: "Since 8:05 AM",
            current_state: "office_drive",
            captured_at: "2026-03-24T13:05:00.000Z"
          },
          {
            id: "presence-field-1",
            employee_id: "user-photo",
            employee_name: "Demo Photographer",
            shift_id: "shift-1",
            shoot_id: "shoot-1",
            primary_label: "Demo Photographer",
            secondary_label: "Spring Portrait Day",
            supporting_label: "Main Gym",
            current_state: "photography",
            captured_at: "2026-03-24T15:02:00.000Z"
          }
        ]
      },
      not_clocked_in: {
        count: 1,
        items: [
          {
            id: "presence-missing-clock-1",
            employee_id: "user-photo-2",
            employee_name: "Late Photographer",
            shift_id: "shift-2",
            shoot_id: "shoot-2",
            primary_label: "Late Photographer",
            secondary_label: "Friday Night Lights Media Day",
            supporting_label: "North Metro Stadium",
            current_state: "off_clock",
            captured_at: "2026-03-24T18:12:00.000Z"
          }
        ]
      },
      late: {
        count: 1,
        items: [
          {
            id: "presence-late-1",
            employee_id: "user-photo-2",
            employee_name: "Late Photographer",
            shift_id: "shift-2",
            shoot_id: "shoot-2",
            primary_label: "Late Photographer",
            secondary_label: "11 minutes after call time",
            supporting_label: "Friday Night Lights Media Day",
            current_state: "off_clock",
            captured_at: "2026-03-24T18:12:00.000Z"
          }
        ]
      },
      missing: {
        count: 1,
        items: [
          {
            id: "presence-missing-1",
            employee_id: "user-photo-2",
            employee_name: "Late Photographer",
            shift_id: "shift-2",
            shoot_id: "shoot-2",
            primary_label: "Late Photographer",
            secondary_label: "Friday Night Lights Media Day",
            supporting_label: "North Metro Stadium",
            current_state: "off_clock",
            captured_at: "2026-03-24T18:12:00.000Z"
          }
        ]
      },
      wrong_location: {
        count: 1,
        items: [
          {
            id: "presence-wrong-location-1",
            employee_id: "user-photo-3",
            employee_name: "Remote Assistant",
            shift_id: "shift-3",
            shoot_id: "shoot-2",
            primary_label: "Remote Assistant",
            secondary_label: "Clocked in at Main Studio",
            supporting_label: "Assigned to North Metro Stadium",
            current_state: "office_drive",
            captured_at: "2026-03-24T17:54:00.000Z"
          }
        ]
      },
      in_office: {
        count: 1,
        items: [
          {
            id: "presence-office-1",
            employee_id: "user-senior",
            employee_name: "Demo Senior Photographer",
            shift_id: "shift-1",
            shoot_id: "shoot-1",
            primary_label: "Demo Senior Photographer",
            secondary_label: "Studio geofence",
            supporting_label: "Since 8:05 AM",
            current_state: "office_drive",
            captured_at: "2026-03-24T13:05:00.000Z"
          }
        ]
      },
      in_field: {
        count: 1,
        items: [
          {
            id: "presence-field-1",
            employee_id: "user-photo",
            employee_name: "Demo Photographer",
            shift_id: "shift-1",
            shoot_id: "shoot-1",
            primary_label: "Demo Photographer",
            secondary_label: "Spring Portrait Day",
            supporting_label: "Main Gym",
            current_state: "photography",
            captured_at: "2026-03-24T15:02:00.000Z"
          }
        ]
      },
      assigned_but_missing: {
        count: 1,
        items: [
          {
            id: "presence-missing-1",
            employee_id: "user-photo-2",
            employee_name: "Late Photographer",
            shift_id: "shift-2",
            shoot_id: "shoot-2",
            primary_label: "Late Photographer",
            secondary_label: "Friday Night Lights Media Day",
            supporting_label: "North Metro Stadium",
            current_state: "off_clock",
            captured_at: "2026-03-24T18:12:00.000Z"
          }
        ]
      }
    },
    urgent_watch: {
      visible: true,
      tone: "action_needed",
      summary_line: "2 items need action today, with 1 more due within 24 hours.",
      items: [
        {
          id: "urgent-shoot-2",
          kind: "shoot",
          kind_label: "Shoot risk",
          title: "Friday Night Lights Media Day",
          summary: "Review same-day exceptions before arrival and keep the weather fallback ready.",
          supporting_label: "11:00 AM - 3:00 PM | North Metro Stadium",
          tone: "action_needed",
          urgency_state: "action_needed_today",
          urgency_label: "Action needed today",
          action_label: "Open shoot workspace",
          action_hash: "#operations/shoots?shoot=shoot-2",
          shoot_id: "shoot-2",
          location_id: null,
          project_id: null
        },
        {
          id: "urgent-location-2",
          kind: "location",
          kind_label: "Location",
          title: "North Metro Stadium",
          summary: "Use the east athlete gate and keep a runner by the fieldhouse door.",
          supporting_label: "Affects today",
          tone: "action_needed",
          urgency_state: "action_needed_today",
          urgency_label: "Action needed today",
          action_label: "Open Location Record",
          action_hash: "#directory/locations?location=location-2&tab=relationships",
          shoot_id: null,
          location_id: "location-2",
          project_id: null
        },
        {
          id: "urgent-project-2",
          kind: "project",
          kind_label: "Production",
          title: "Issue Remediation Review",
          summary: "Confirm the remediation plan and close the follow-up loop before the next handoff.",
          supporting_label: "Ready for QA | Demo Leadership | Due Mar 24",
          tone: "action_needed",
          urgency_state: "due_within_24h",
          urgency_label: "Due within 24h",
          action_label: "Open production",
          action_hash: "#production/qa?project=project-2&queue=qa_queue&stage=ready_for_qa",
          shoot_id: null,
          location_id: null,
          project_id: "project-2"
        }
      ]
    },
    department_task_counts: {
      schools: 0,
      sports: 0,
      production: 0
    },
    production_projects: {
      visible: true,
      generated_at: "2026-03-24T15:00:00.000Z",
      summary_line: "2 production stages are waiting on review or final QC.",
      tone: "heads_up",
      counts: {
        unassigned_jobs: 1,
        active_jobs: 3,
        in_production: 3,
        on_time: 6,
        blocked: 1,
        due_within_24_hours: 2,
        overdue: 1,
        jobs_in_qa: 1,
        ready_to_release: 1,
      blocked_or_corrections: 1,
      blocked_or_changes_requested: 1,
        awaiting_peer_review: 1,
        awaiting_final_qc: 1
      },
      assessment_cards: [
        {
          id: "unassigned_jobs",
          label: "Unassigned",
          value: 1,
          tone: "heads_up",
          detail: "Production work still missing an owner or kickoff.",
          action_hash: "#production?queue=at_risk_queue&owner_user_id=unassigned"
        },
        {
          id: "active_jobs",
          label: "In Production",
          value: 3,
          tone: "info",
          detail: "Active work moving through production.",
          action_hash: "#production/workload?queue=team_queue&stage=in_production"
        },
        {
          id: "overdue",
          label: "Overdue",
          value: 1,
          tone: "action_needed",
          detail: "Checklist or follow-up work already overdue.",
          action_hash: "#production?queue=at_risk_queue&due_state=overdue"
        },
        {
          id: "blocked",
          label: "Blocked",
          value: 1,
          tone: "action_needed",
          detail: "Blocked production work or QA changes holding release.",
          action_hash: "#production/qa?queue=blocked_queue&stage=blocked"
        },
        {
          id: "jobs_in_qa",
          label: "In QA",
          value: 1,
          tone: "heads_up",
          detail: "Production work waiting on peer-to-peer review.",
          action_hash: "#production/qa?queue=qa_queue&stage=ready_for_qa"
        },
        {
          id: "ready_to_release",
          label: "Ready to Release",
          value: 1,
          tone: "heads_up",
          detail: "Production work waiting on final QC signoff.",
          action_hash: "#production/release?queue=ready_to_release_queue&stage=ready_to_release"
        },
        {
          id: "on_time",
          label: "On Time",
          value: 6,
          tone: "good",
          detail: "Open work not currently drifting behind.",
          action_hash: "#production?status=open&due_state=upcoming"
        }
      ],
      owners: [
        {
          owner_user_id: "user-leadership",
          owner_label: "Demo Leadership",
          assignment_label: "Assigned",
          open_count: 4,
          in_production_count: 2,
          qa_queue_count: 1,
          ready_to_release_count: 1,
          overdue_count: 0,
          pressure_label: "2 review checkpoints open",
          action_hash: "#production/qa?owner_user_id=user-leadership&queue=qa_queue&stage=ready_for_qa"
        },
        {
          owner_user_id: null,
          owner_label: "Owner unassigned",
          assignment_label: "Needs owner",
          open_count: 1,
          in_production_count: 0,
          qa_queue_count: 0,
          ready_to_release_count: 0,
          overdue_count: 1,
          pressure_label: "1 overdue | 1 open",
          action_hash: "#production?owner_user_id=unassigned&queue=at_risk_queue&due_state=overdue"
        }
      ],
      focus_items: [
        {
          project_id: "project-4",
          title: "Banner Delivery QA Rework",
          summary: "QA requested changes before the final package can be released.",
          owner_label: "Owner unassigned",
          stage_label: "Correction Needed",
          queue_label: "Correction Needed",
          reviewer_label: "Final QC reviewer needed",
          due_label: "Overdue since Mar 23",
          next_action: "Clear QA changes and update the checklist",
          tone: "action_needed",
          action_hash: "#production/qa?project=project-4&queue=qa_queue&stage=correction_needed&due_state=overdue"
        },
        {
          project_id: "project-2",
          title: "Issue Remediation Review",
          summary: "Production follow-up is waiting on peer review before final QC can continue.",
          owner_label: "Demo Leadership",
          stage_label: "Ready for QA",
          queue_label: "QA Queue",
          reviewer_label: "Peer reviewer: Demo Senior Photographer",
          due_label: "Due Mar 24",
          next_action: "Complete peer review",
          tone: "heads_up",
          action_hash: "#production/qa?project=project-2&queue=qa_queue&stage=ready_for_qa&due_state=due_today"
        }
      ],
      urgent_items: [
        {
          project_id: "project-2",
          title: "Issue Remediation Review",
          summary: "Peer review and the follow-up note still need action today.",
          owner_label: "Demo Leadership",
          stage_label: "Ready for QA",
          due_label: "Due Mar 24",
          urgency_state: "action_needed_today",
          urgency_label: "Action needed today",
          action_hash: "#production/qa?project=project-2&queue=qa_queue&stage=ready_for_qa"
        }
      ]
    }
  }
};

const homeDashboardTv: HomeDashboardResponse = {
  ...homeDashboardApp,
  mode: "tv",
  public_safe: true,
  tv_names_enabled: false,
  widgets: {
    ...homeDashboardApp.widgets,
    labor_snapshot_today: null,
    attendance_awareness: {
      visible: false,
      summary: {
        clocked_in_count: 0,
        not_clocked_in_count: 0,
        late_count: 0,
        missing_count: 0,
        wrong_location_count: 0
      },
      clocked_in: { count: 0, items: [] },
      not_clocked_in: { count: 0, items: [] },
      late: { count: 0, items: [] },
      missing: { count: 0, items: [] },
      wrong_location: { count: 0, items: [] },
      in_office: { count: 0, items: [] },
      in_field: { count: 0, items: [] },
      assigned_but_missing: { count: 0, items: [] }
    },
    urgent_watch: {
      ...homeDashboardApp.widgets.urgent_watch,
      visible: false,
      items: []
    },
    production_projects: {
      ...homeDashboardApp.widgets.production_projects,
      visible: false,
      owners: [],
      urgent_items: []
    }
  }
};

const calmHomeDashboardApp: HomeDashboardResponse = {
  ...structuredClone(homeDashboardApp),
  critical_banner: null,
  widgets: {
    ...structuredClone(homeDashboardApp.widgets),
    today_strip: {
      ...structuredClone(homeDashboardApp.widgets.today_strip),
      urgent_issue_count: 0,
      late_arrival_count: 0,
      production_at_risk_count: 0
    },
    today_shoots: {
      ...structuredClone(homeDashboardApp.widgets.today_shoots),
      needs_attention_count: 0,
      shoots: homeDashboardApp.widgets.today_shoots.shoots.map((shoot) =>
        shoot.id === "shoot-2"
          ? {
              ...shoot,
              phase: "upcoming",
              status_label: "Scheduled",
              status_tone: "info",
              attention_label: null,
              attention_tone: null,
              sync_label: "Linked to Outlook",
              sync_tone: "info",
              next_action: "Confirm arrival plan"
            }
          : shoot
      )
    },
    weather_travel_watch: {
      ...structuredClone(homeDashboardApp.widgets.weather_travel_watch),
      tone: "good",
      summary_line: "Travel and weather look manageable right now.",
      items: homeDashboardApp.widgets.weather_travel_watch.items.map((item) => ({
        ...item,
        severity: "info",
        summary: "Keep a small travel buffer in mind, but nothing looks urgent."
      }))
    },
    customer_service_pulse: {
      ...structuredClone(homeDashboardApp.widgets.customer_service_pulse),
      tone: "neutral",
      urgent_signal_count: 0,
      summary_line: "Backlog looks steady and manageable."
    },
    places_that_need_more_love: {
      ...structuredClone(homeDashboardApp.widgets.places_that_need_more_love),
      items: [
        {
          ...homeDashboardApp.widgets.places_that_need_more_love.items[0],
          tone: "info",
          affecting_today: false,
          summary: "Parking note to keep in mind before the next visit."
        }
      ]
    },
    labor_snapshot_today: {
      ...homeDashboardApp.widgets.labor_snapshot_today!,
      overtime_risk_count: 0
    },
    attendance_awareness: {
      ...structuredClone(homeDashboardApp.widgets.attendance_awareness),
      summary: {
        clocked_in_count: 2,
        not_clocked_in_count: 0,
        late_count: 0,
        missing_count: 0,
        wrong_location_count: 0
      },
      not_clocked_in: { count: 0, items: [] },
      late: { count: 0, items: [] },
      missing: { count: 0, items: [] },
      wrong_location: { count: 0, items: [] },
      assigned_but_missing: { count: 0, items: [] }
    },
    urgent_watch: {
      visible: true,
      tone: "good",
      summary_line: "No open exceptions are due in the next 24 hours.",
      items: []
    },
    production_projects: {
      ...structuredClone(homeDashboardApp.widgets.production_projects),
      tone: "good",
      summary_line: "Production is on track right now.",
      counts: {
        unassigned_jobs: 0,
        active_jobs: 2,
        in_production: 2,
        on_time: 5,
        blocked: 0,
        due_within_24_hours: 0,
        overdue: 0,
        jobs_in_qa: 0,
        ready_to_release: 0,
      blocked_or_corrections: 0,
      blocked_or_changes_requested: 0,
        awaiting_peer_review: 0,
        awaiting_final_qc: 0
      },
      assessment_cards: [
        {
          id: "unassigned_jobs",
          label: "Unassigned",
          value: 0,
          tone: "good",
          detail: "Production work still missing an owner or kickoff.",
          action_hash: "#production?queue=at_risk_queue&owner_user_id=unassigned"
        },
        {
          id: "active_jobs",
          label: "In Production",
          value: 2,
          tone: "info",
          detail: "Active work moving through production.",
          action_hash: "#production/workload?queue=team_queue&stage=in_production"
        },
        {
          id: "overdue",
          label: "Overdue",
          value: 0,
          tone: "good",
          detail: "Checklist or follow-up work already overdue.",
          action_hash: "#production?queue=at_risk_queue&due_state=overdue"
        },
        {
          id: "blocked",
          label: "Blocked",
          value: 0,
          tone: "neutral",
          detail: "Blocked production work or QA changes holding release.",
          action_hash: "#production/qa?queue=blocked_queue&stage=blocked"
        },
        {
          id: "jobs_in_qa",
          label: "In QA",
          value: 0,
          tone: "neutral",
          detail: "Production work waiting on peer-to-peer review.",
          action_hash: "#production/qa?queue=qa_queue&stage=ready_for_qa"
        },
        {
          id: "ready_to_release",
          label: "Ready to Release",
          value: 0,
          tone: "neutral",
          detail: "Production work waiting on final QC signoff.",
          action_hash: "#production/release?queue=ready_to_release_queue&stage=ready_to_release"
        },
        {
          id: "on_time",
          label: "On Time",
          value: 5,
          tone: "good",
          detail: "Open work not currently drifting behind.",
          action_hash: "#production?status=open&due_state=upcoming"
        }
      ],
      owners: [
        {
          owner_user_id: "user-leadership",
          owner_label: "Demo Leadership",
          assignment_label: "Assigned",
          open_count: 2,
          in_production_count: 2,
          qa_queue_count: 0,
          ready_to_release_count: 0,
          overdue_count: 0,
          pressure_label: "2 actively in production",
          action_hash: "#production/workload?owner_user_id=user-leadership&queue=my_queue&stage=in_production"
        }
      ],
      focus_items: [],
      urgent_items: []
    }
  }
};

describe("admin operations regressions", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the role-aware Company Command home for leadership", async () => {
    apiFetchMock.mockImplementation(async (path: string, _token?: string, init?: RequestInit) => {
      if (path === "/api/jobs/dashboard/home") {
        return sharedHomeDashboardResponse;
      }
      if (path.startsWith("/api/jobs/alerts?")) {
        return sharedAlertsResponse;
      }
      if (path.startsWith("/api/jobs/dashboard/widget-preferences?")) {
        return { preferences: [] };
      }
        if (path === "/api/jobs" || path.startsWith("/api/jobs?")) {
          return sharedJobsResponse;
        }
        if (path === "/api/dashboard/home?mode=app") {
          return homeDashboardApp;
        }
      if (path.startsWith("/api/dashboard/operations?date=")) {
        return operationsDashboard;
      }
      if (path.startsWith("/api/attendance/compliance-review?date=")) {
        return dashboardWorkflowCompliance;
      }
      if (path.startsWith("/api/dashboard/manager-cockpit?date=")) {
        return managerCockpitResponse;
      }
      if (path.startsWith("/api/dashboard/reports?")) {
        return leadershipReportsIndex;
      }
      if (path.startsWith("/api/schedule/staffing-dashboard?")) {
        return staffingDashboard;
      }
      if (path === "/api/schedule/shoots/shoot-2/staffing") {
        return staffingSnapshot;
      }
      if (path === "/api/shoots/shoot-1") {
        return shootDetailById["shoot-1"];
      }
      if (path === "/api/shoots/shoot-2") {
        return shootDetailById["shoot-2"];
      }
      if (path === "/api/locations/location-2") {
        return locationDetailById["location-2"];
      }
      if (path === "/api/projects/project-1" && init?.method === "PATCH") {
        return {
          project: {
            id: "project-1"
          },
          tasks: [],
          events: []
        };
      }
      throw new Error(`Unexpected dashboard call: ${path}`);
    });

    render(<Dashboard token="token" currentUser={leadershipUser} socket={null} />);

    expect(screen.getByRole("heading", { name: "Company Command" })).toBeInTheDocument();
    expect(screen.getByText("On Fire")).toBeInTheDocument();
    expect(screen.getByText("Shoots Today")).toBeInTheDocument();
    expect(screen.getByText("Client Issues")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Urgent Watch/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Preview seat")).toBeInTheDocument();
    expect(screen.queryByText("This Week's Operational Priorities")).not.toBeInTheDocument();
    expect(screen.queryByText("Today at a glance")).not.toBeInTheDocument();
  });

  it("keeps the Company Command home free of legacy briefing clutter", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/jobs/dashboard/home") {
        return sharedHomeDashboardResponse;
      }
      if (path.startsWith("/api/jobs/alerts?")) {
        return sharedAlertsResponse;
      }
      if (path.startsWith("/api/jobs/dashboard/widget-preferences?")) {
        return { preferences: [] };
      }
        if (path === "/api/jobs" || path.startsWith("/api/jobs?")) {
          return sharedJobsResponse;
        }
        if (path === "/api/dashboard/home?mode=app") {
          return calmHomeDashboardApp;
        }
      if (path.startsWith("/api/dashboard/operations?date=")) {
        return operationsDashboard;
      }
      if (path.startsWith("/api/attendance/compliance-review?date=")) {
        return dashboardWorkflowCompliance;
      }
      if (path.startsWith("/api/dashboard/manager-cockpit?date=")) {
        return managerCockpitResponse;
      }
      throw new Error(`Unexpected calm dashboard call: ${path}`);
    });

    render(<Dashboard token="token" currentUser={leadershipUser} socket={null} />);

    expect(screen.getByRole("heading", { name: "Company Command" })).toBeInTheDocument();
    expect(screen.getByText("Operating Areas")).toBeInTheDocument();
    expect(screen.queryByText("Today at a glance")).not.toBeInTheDocument();
    expect(screen.queryByText("Dashboard unavailable")).not.toBeInTheDocument();
  });

  it("renders the status board in a public-safe TV mode", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/dashboard/home?mode=tv") {
        return homeDashboardTv;
      }
      throw new Error(`Unexpected status board call: ${path}`);
    });

    render(<StatusBoard token="token" socket={null} presentationMode />);

    expect(await screen.findByText("TV Mode")).toBeInTheDocument();
    expect(screen.getAllByText("Business Pulse").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Today's Shoots").length).toBeGreaterThan(0);
    expect(screen.getByText("Weather watch")).toBeInTheDocument();
    expect(screen.queryByText("Late / No-Show")).not.toBeInTheDocument();
    expect(screen.queryByText("Flagged Punches")).not.toBeInTheDocument();
  });

  it("renders the Business Health reporting suite with canonical dashboards and detail", async () => {
      apiFetchMock.mockImplementation(async (path: string) => {
        if (path.startsWith("/api/dashboard/reports/delivery-center?")) {
          return reportingDeliveryCenter;
        }
        if (path.startsWith("/api/dashboard/reports/")) {
          return reportingDashboardDetail;
        }
        if (path.startsWith("/api/dashboard/reports?")) {
          return reportingDashboardIndex;
      }
      throw new Error(`Unexpected reports call: ${path}`);
    });

    render(<Reports token="token" currentUser={leadershipUser} />);

    expect(await screen.findByText("Trend, Performance, And Audit")).toBeInTheDocument();
    expect(screen.getByText("Freshness")).toBeInTheDocument();
    expect(screen.getByText("Top Summary Strip")).toBeInTheDocument();
    expect(screen.getAllByText("Saved Views").length).toBeGreaterThan(0);
    expect(screen.getByText("Saved Views, Packets, And Exports")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delivery Tools" })).toBeInTheDocument();
    expect(screen.getAllByText("Packet Templates").length).toBeGreaterThan(0);
    expect(screen.getByText("Recurring Delivery")).toBeInTheDocument();
    expect(screen.getByText("Packet History")).toBeInTheDocument();
    expect(screen.getByText("Export History")).toBeInTheDocument();
  });

  it("renders the unified schedule and keeps shift operations on the same page", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/dashboard/operations?")) {
        return operationsDashboard;
      }
      if (path.startsWith("/api/shifts/resources/members?anchor_date=")) {
        return [
          {
            id: "user-photo",
            email: "photo@example.com",
            full_name: "Demo Photographer",
            department: "schools",
            roles: ["associate_photographer"]
          }
        ];
      }
      if (path.startsWith("/api/shoots?date=")) {
        return shootSummaries;
      }
      if (path === "/api/shoots/reference-data") {
        return {
          contacts: [
            {
              label: "Coach Riley Hart | North Metro Stadium",
              name: "Coach Riley Hart",
              phone: "555-0142",
              email: "riley.hart@example.com",
              source_kind: "shoot_primary",
              source_label: "North Metro Stadium",
              location_id: "location-2",
              last_used_at: "2026-03-24T12:00:00.000Z"
            }
          ]
        };
      }
      if (path === "/api/locations") {
        return locationCatalog;
      }
      if (path === "/api/shoots/shoot-2") {
        return shootDetailById["shoot-2"];
      }
      if (path === "/api/organizations/org-2") {
        return organizationDetailById["org-2"];
      }
      if (path.startsWith("/api/schedule/calendar?")) {
        return unifiedScheduleCalendar;
      }
      if (path.startsWith("/api/schedule/board?")) {
        return unifiedScheduleBoard;
      }
      if (path.startsWith("/api/shifts?date_from=")) {
        return unifiedScheduleAssignments;
      }
      if (path.startsWith("/api/integrations/outlook/status?")) {
        return outlookStatus;
      }
      if (path === "/api/integrations/governance") {
        return integrationGovernance;
      }
      if (path.startsWith("/api/integrations/outlook/calendars?")) {
        return visibleCalendars;
      }
      if (path === "/api/schedule/shoots/shoot-2/staffing") {
        return staffingSnapshot;
      }
      if (path.startsWith("/api/schedule/staffing-templates")) {
        return [];
      }
      if (path.startsWith("/api/shifts/trade-requests/list")) {
        return [];
      }
      if (path.startsWith("/api/shifts/pto-requests/list")) {
        return [];
      }
      if (path === "/api/training/summaries") {
        return trainingSummaries;
      }
      throw new Error(`Unexpected scheduling call: ${path}`);
    });

    render(<Scheduling token="token" currentUser={leadershipUser} socket={null} />);

    expect(screen.getByText("Loading schedule")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scheduling Workspace" })).toBeInTheDocument();
    expect(screen.getByText("Work staffing, planning, and exception control by lane")).toBeInTheDocument();
    expect(await screen.findByText("Coverage gaps")).toBeInTheDocument();
    expect(screen.getByText("Scheduled Labor")).toBeInTheDocument();
    expect(screen.getByText("Spring Portrait Day")).toBeInTheDocument();
    expect(screen.getByText("Daily Ops Huddle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Week" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3-Day" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List" })).toBeInTheDocument();
    expect(
      apiFetchMock.mock.calls.some(
        ([path]) => typeof path === "string" && path.startsWith("/api/schedule/board?")
      )
    ).toBe(false);
    expect(screen.getByText("Day Briefing")).toBeInTheDocument();
    expect(screen.getByText("Leadership Shoot Workspace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Needs Staffing/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shoots Queue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alerts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Shoot" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Lane Board" }));

    await waitFor(() => {
      expect(
        apiFetchMock.mock.calls.some(
          ([path]) => typeof path === "string" && path.startsWith("/api/schedule/board?")
        )
      ).toBe(true);
    });
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));

    fireEvent.click(screen.getByRole("button", { name: "New Shoot" }));

    const shootDialog = await screen.findByRole("dialog", { name: "New Shoot" });
    expect(within(shootDialog).getByText("Leadership Shoot Workspace")).toBeInTheDocument();
    expect(within(shootDialog).getByText("New Shoot")).toBeInTheDocument();
    fireEvent.click(within(shootDialog).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "New Shoot" })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText("Friday Night Lights Media Day")[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Open Shoot Workspace" }));

    expect(await screen.findByText("Selected Location")).toBeInTheDocument();
    expect(screen.getAllByText("Coach Riley Hart").length).toBeGreaterThan(0);
    expect(screen.getByText("Shoot Lifecycle")).toBeInTheDocument();
    expect(screen.getByText("Readiness Checks")).toBeInTheDocument();
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);
    expect(screen.getByText("Needs attention before Ready")).toBeInTheDocument();
    expect(await screen.findByText("Staffing Control")).toBeInTheDocument();
    expect(screen.getByText("Slot Assignments")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Assignments"), { target: { value: "show_assignments" } });
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect((await screen.findAllByRole("button", { name: /Demo Photographer/i })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Demo Assistant/i }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: /Demo Photographer/i })[0]);

    expect(await screen.findByText("Shift Roster")).toBeInTheDocument();
    expect(screen.getByText("Secondary Scheduling Tools")).toBeInTheDocument();
    expect(screen.getByText("Shift Detail")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Outlook Integrity/i }));

    expect(await screen.findByText("Calendar Preview Integrity")).toBeInTheDocument();
    expect(screen.getAllByText("Leadership Command").length).toBeGreaterThan(0);
  }, 15000);

  it("renders the shared Schedule page as a calendar-first view without staffing command clutter", async () => {
    window.location.hash = "#schedule/jobs?date=2026-03-24";
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/shifts/resources/members?anchor_date=")) {
        return [
          {
            id: "user-photo",
            email: "photo@example.com",
            full_name: "Demo Photographer",
            department: "schools",
            roles: ["associate_photographer"]
          }
        ];
      }
      if (path.startsWith("/api/schedule/calendar?")) {
        return unifiedScheduleCalendar;
      }
      if (path.startsWith("/api/shifts?date_from=")) {
        return unifiedScheduleAssignments;
      }
      throw new Error(`Unexpected schedule call: ${path}`);
    });

    render(<Schedule token="token" currentUser={leadershipUser} />);

    expect(screen.getByRole("heading", { name: "Team Schedule" })).toBeInTheDocument();
    expect(screen.getByText("A readable team calendar for shifts, events, shoots, locations, and weekly planning.")).toBeInTheDocument();
    expect(screen.getAllByText("Team Schedule").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Day / Week / Month")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Calendar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Staffing Schedule/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Assignment Board/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Day" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Week" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Month" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "3-Day" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "List" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lane Board" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Coverage Requests/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Coverage gaps")).not.toBeInTheDocument();
    expect(screen.queryByText("Critical role gaps")).not.toBeInTheDocument();
    expect(screen.queryByText("Conflicts")).not.toBeInTheDocument();
    expect(screen.queryByText("Unconfirmed labor")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending updates")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Staffing Health")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Lead")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Staff")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "All staff" })).toBeInTheDocument();
    expect(screen.getByLabelText("My shifts")).toBeInTheDocument();

    expect(await screen.findByText("Spring Portrait Day")).toBeInTheDocument();
    expect(screen.getByText("Friday Night Lights Media Day")).toBeInTheDocument();
    expect(screen.getByText("Saturday Senior Portraits")).toBeInTheDocument();
    expect(screen.getByText("Scheduled That Day")).toBeInTheDocument();
    expect(screen.getAllByText("Daily Ops Huddle").length).toBeGreaterThan(0);
    expect(
      apiFetchMock.mock.calls.some(
        ([path]) => typeof path === "string" && path.startsWith("/api/schedule/board?")
      )
    ).toBe(false);
  });

  it("renders the employee schedule as a filtered assignment calendar without manager staffing controls", async () => {
    window.location.hash = "#my-schedule?date=2026-03-24";
    const personalScheduleCalendar: UnifiedScheduleCalendarResponse = {
      ...unifiedScheduleCalendar,
      items: unifiedScheduleCalendar.items
        .filter((item) => item.item_kind !== "shoot" || item.id === "shoot-1")
        .map((item) =>
          item.item_kind === "shoot"
            ? {
                ...item,
                planned_staff_count: null,
                assigned_staff_count: null,
                required_lead_count: null,
                lead_coverage_count: null,
                lead_name: null,
                open_alert_count: null,
                open_attendance_exception_count: null,
                conflict_warning_count: null,
                draft_shift_count: null,
                published_shift_count: null,
                publish_state: null,
                staffing_health_state: "personal_view",
                staffing_health_label: "Assignment View",
                staffing_detail_visibility: "limited",
                staffing_gap_count: null,
                unconfirmed_staff_count: null
              }
            : item
        )
    };
    const personalAssignments = unifiedScheduleAssignments.filter((shift) => shift.assigned_user_id === "user-photo");

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/schedule/calendar?")) {
        return personalScheduleCalendar;
      }
      if (path.startsWith("/api/shifts?date_from=")) {
        return personalAssignments;
      }
      throw new Error(`Unexpected schedule call: ${path}`);
    });

    render(<Schedule token="token" currentUser={fieldScheduleUser} />);

    expect(screen.getByRole("heading", { name: "My Schedule" })).toBeInTheDocument();
    expect(screen.getAllByText("My Schedule").length).toBeLessThanOrEqual(2);
    expect(screen.getByText("Your shifts, events, linked jobs, times, and locations in one calendar view.")).toBeInTheDocument();
    expect(screen.getAllByText("My Schedule").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Jump to date")).toBeInTheDocument();
    expect(screen.queryByText("Anchor Date")).not.toBeInTheDocument();
    expect(screen.queryByText("Quick Access")).not.toBeInTheDocument();
    expect(screen.queryByText("Connected Standards")).not.toBeInTheDocument();
    expect(screen.queryByText("Directory of Photography")).not.toBeInTheDocument();
    expect(screen.queryByText("Demo Admin")).not.toBeInTheDocument();
    expect(screen.queryByText("Company scope")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Calendar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Staffing Schedule/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Assignment Board/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Day" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Week" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Month" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "3-Day" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "List" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lane Board" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Staffing Health")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Lead")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Scheduling" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "My Work" })).not.toBeInTheDocument();
    expect(
      apiFetchMock.mock.calls.some(
        ([path]) => typeof path === "string" && path.startsWith("/api/schedule/board?")
      )
    ).toBe(false);

    expect((await screen.findAllByText("Spring Portrait Day")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Main Gym")).length).toBeGreaterThan(0);
  });

  it("renders the shoots workspace queues and opens a meaningful shoot workspace", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/shoots/live-queue?date=")) {
        return liveShootQueueResponse;
      }
      if (path === "/api/shoots/shoot-2") {
        return shootDetailById["shoot-2"];
      }
      throw new Error(`Unexpected shoots workspace call: ${path}`);
    });

    render(<LiveShoots token="token" currentUser={leadershipUser} socket={null} realtimeStatus="connected" />);

    expect(screen.getByText("Loading shoots")).toBeInTheDocument();
    expect(await screen.findByText("Shoot Management Queue")).toBeInTheDocument();
    expect(screen.getByText("Keep shoot work inside Operations")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Needs Staffing/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alerts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approvals" })).toBeInTheDocument();
    expect(screen.getAllByText("Needs Review").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unscheduled").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Completed / Archived").length).toBeGreaterThan(0);
    expect(screen.queryByText("Tap for the full shoot story")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Friday Night Lights Media Day/i }));

    expect(await screen.findByText("Shoot Workspace")).toBeInTheDocument();
    expect(screen.getByText("Shoot Summary")).toBeInTheDocument();
    expect(screen.getAllByText("Organization").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Location").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Primary Contact").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Additional Contacts").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Timing").length).toBeGreaterThan(0);
    expect(screen.getByText("Operational Lifecycle")).toBeInTheDocument();
    expect(screen.getByText("Ready to Shoot")).toBeInTheDocument();
    expect(screen.getAllByText("Lead confirmation overdue").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Needs attention before Ready").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Missing lead").length).toBeGreaterThan(0);
    expect(screen.getByText("Readiness Watch")).toBeInTheDocument();
    expect(screen.getByText("Weather & Travel")).toBeInTheDocument();
    expect(screen.getAllByText("Coach Riley Hart").length).toBeGreaterThan(0);
    expect(screen.getByText("Agreement Warning")).toBeInTheDocument();
    expect(screen.getByText("Post-Shoot Evaluation")).toBeInTheDocument();
    expect(screen.getAllByText("Gear").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Labor").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Open Scheduling" }).length).toBeGreaterThan(0);
  });

  it("opens the exact shoot workspace when a queue hash includes a shoot id", async () => {
    window.history.replaceState(null, "", "#shoots?shoot=shoot-2");

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/shoots/live-queue?date=")) {
        return liveShootQueueResponse;
      }
      if (path === "/api/shoots/shoot-2") {
        return shootDetailById["shoot-2"];
      }
      throw new Error(`Unexpected deep-linked shoot call: ${path}`);
    });

    render(<LiveShoots token="token" currentUser={leadershipUser} socket={null} realtimeStatus="connected" />);

    expect(await screen.findByText("Shoot Management Queue")).toBeInTheDocument();
    expect(await screen.findByText("Shoot Workspace")).toBeInTheDocument();
    expect(screen.getAllByText("Coach Riley Hart").length).toBeGreaterThan(0);
  });

  it("renders the labor dashboard with reliability and export surfaces", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/dashboard/operations?")) {
        return {
          ...operationsDashboard,
          summary: {
            ...operationsDashboard.summary,
            fill_rate_percent: 92.5,
            early_clock_in_exception_count: 1,
            trade_request_count: 2,
            under_staffed_shoot_count: 1,
            average_setup_to_live_lag_minutes: 14.5
          },
          insights: {
            hours_by_department: [
              {
                department: "schools",
                scheduled_hours: 12,
                actual_hours: 10.5,
                employee_count: 3
              }
            ],
            hours_by_shoot: [
              {
                scope_id: "shoot-1",
                scope_code: "DEMO-001",
                scope_title: "Spring Portrait Day",
                department: "schools",
                scheduled_hours: 8,
                actual_hours: 6.5,
                planned_staff_count: 3,
                scheduled_employees: 3,
                fill_rate_percent: 100,
                rigorous_shoot_score: 1.35
              }
            ],
            attendance_reliability_by_employee: [
              {
                assigned_user_id: "user-photo",
                assigned_user_name: "Demo Photographer",
                department: "schools",
                late_count: 1,
                missed_punch_count: 0,
                no_show_count: 0,
                open_exception_count: 1,
                reliability_score: 90
              }
            ],
            labor_exceptions_trend: [
              {
                bucket_label: "2026-03-24",
                late_count: 1,
                missed_punch_count: 0,
                no_show_count: 0,
                outside_geofence_count: 0
              }
            ],
            shift_trade_frequency: [
              {
                department: "schools",
                total_requests: 2,
                approved_requests: 1,
                pending_requests: 1
              }
            ],
            staffing_efficiency_by_shoot_type: [],
            fill_rate_percent: 92.5,
            average_setup_to_live_lag_minutes: 14.5
          }
        };
      }
      if (path.startsWith("/api/shifts?date_from=")) {
        return operationsDashboard.shifts;
      }
      throw new Error(`Unexpected labor call: ${path}`);
    });

    render(<Labor token="token" currentUser={leadershipUser} socket={null} />);

    expect(await screen.findByText("Labor Review And Payroll Integrity")).toBeInTheDocument();
    expect(screen.getByText("Reliability By Employee")).toBeInTheDocument();
    expect(screen.getByText("Hours By Shoot")).toBeInTheDocument();
    // D19 (owner-ratified): ungated CSVs are gone from this surface — payroll
    // leaves only through the Labor Command Center's gated export.
    expect(screen.queryByText("Export CSV")).not.toBeInTheDocument();
    expect(screen.getAllByText("Open Labor Command Center").length).toBeGreaterThan(0);
  });

  it("renders attendance detail and lets the operator switch review focus", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/attendance/operations?")) {
        return attendanceOperationsWorkspace;
      }
      if (path === "/api/attendance/operations/shift-alpha") {
        return attendanceDetailAlpha;
      }
      if (path === "/api/attendance/operations/shift-beta") {
        return attendanceDetailBeta;
      }
      if (path.startsWith("/api/attendance/exceptions?")) {
        return attendanceExceptions;
      }
      if (path.startsWith("/api/attendance/compliance-flags?")) {
        return timeClockComplianceReview;
      }
      if (path === "/api/notifications") {
        return [];
      }
      if (path.startsWith("/api/dashboard/operations?")) {
        return operationsDashboard;
      }
      throw new Error(`Unexpected attendance call: ${path}`);
    });

    render(<Attendance token="token" currentUser={leadershipUser} socket={null} />);

    expect(screen.getByText("Loading attendance")).toBeInTheDocument();
    expect((await screen.findAllByText("Attendance Operating System")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Manager Correction Flow")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Project Tracking" })).toHaveAttribute("href", "#project-tracking");
    expect(screen.getByText("Coverage Risk")).toBeInTheDocument();
    expect(screen.getByText("Home-Ready Summary")).toBeInTheDocument();

    const detailPanel = screen.getByText("Manager Correction Flow").closest("aside");
    expect(detailPanel).not.toBeNull();
    expect(within(detailPanel as HTMLElement).getByText("Shift Alpha")).toBeInTheDocument();
    expect(screen.getByText("Open Project Tracking")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Demo Associate - Shift Beta/i }));

    await waitFor(() => {
      expect(screen.getAllByText("Shift Beta").length).toBeGreaterThan(0);
      expect(screen.getByText("Coverage impact")).toBeInTheDocument();
    });
  });

  it("updates Outlook calendar visibility and refreshes the preview", async () => {
    let calendars = structuredClone(visibleCalendars);
    const allEvents = [
      ...todayEvents,
      {
        id: "event-3",
        calendar_id: "calendar-2",
        calendar_name: "Travel Holds",
        calendar_color_hex: "#c68945",
        subject: "Travel Buffer",
        starts_at: "2026-03-24T17:00:00.000Z",
        ends_at: "2026-03-24T18:00:00.000Z",
        organizer: "Operations",
        location: "Route corridor",
        overlaps_with_shoots: false,
        scheduling_impact: true,
        preview_note: "Hidden by default.",
        web_link: "https://outlook.office.com/calendar/item/event-3",
        shoot_code: null
      }
    ] satisfies OutlookCalendarEvent[];

    apiFetchMock.mockImplementation(async (path: string, _token?: string, init?: RequestInit) => {
      if (path.startsWith("/api/integrations/outlook/status?")) {
        return outlookStatus;
      }
      if (path === "/api/integrations/governance") {
        return integrationGovernance;
      }
      if (path.startsWith("/api/integrations/outlook/calendars?")) {
        return calendars;
      }
      if (path === "/api/integrations/sync-operations?provider=outlook") {
        return [];
      }
      if (path.includes("/api/integrations/outlook/events/preview?")) {
        const enabledIds = new Set(calendars.filter((calendar) => calendar.visible_in_app).map((calendar) => calendar.id));
        return allEvents.filter((event) => enabledIds.has(event.calendar_id));
      }
      if (path === "/api/shoots/shoot-1") {
        return shootDetailById["shoot-1"];
      }
      if (path.includes("/api/integrations/outlook/calendars/calendar-1/visibility") && init?.method === "PATCH") {
        calendars = calendars.map((calendar) =>
          calendar.id === "calendar-1" ? { ...calendar, visible_in_app: false } : calendar
        );
        return calendars;
      }
      if (path === "/api/integrations/zendesk/test" && init?.method === "POST") {
        return { ok: true, mode: "mock" as const, message: "Zendesk demo mode is active." };
      }
      if (path === "/api/zendesk/sync" && init?.method === "POST") {
        return { connection: zendeskStatus.connection, sync_run: zendeskStatus.sync_runs[0] };
      }
      if (path === "/api/schools-hub/reference-data") {
        return { schools: [], owners: [], jobs: [] };
      }
      throw new Error(`Unexpected outlook call: ${path}`);
    });

    render(<OutlookIntegration token="token" currentUser={leadershipUser} socket={null} />);

    expect(await screen.findByText("Source-of-Truth Governance")).toBeInTheDocument();
    expect(screen.getByText("Conflict Review")).toBeInTheDocument();
    expect(screen.getByText("Monday Coexistence Controls")).toBeInTheDocument();
    expect(screen.getAllByText("Calendar Preview Integrity").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Morning Shoot Hold").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("checkbox", { name: "Shown on dashboard" }));

    await waitFor(() => {
      expect(screen.getByText("Leadership Command is now hidden in Mission Control. It remains connected in Outlook.")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryAllByText("Morning Shoot Hold")).toHaveLength(0);
    });
  });

  it("renders the training workspace and plays a picture day challenge round", async () => {
    window.history.replaceState(null, "", "#training?employee=photo%40example.com");

    apiFetchMock.mockImplementation(async (path: string, _token?: string, init?: RequestInit) => {
      if (path === "/api/training/profiles") {
        return [trainingProfile];
      }
      if (path === "/api/training/dashboard") {
        return trainingSnapshot;
      }
      if (path === "/api/training/catalog") {
        return trainingCatalog;
      }
      if (path === "/api/training/quiz-rounds" && init?.method === "POST") {
        return trainingRoundResponse;
      }
      if (path === "/api/training/quiz-attempts" && init?.method === "POST") {
        return trainingSubmitResponse;
      }
      if (path === `/api/training/profiles/${trainingProfile.employee.id}/signoff` && init?.method === "POST") {
        return trainingProfile;
      }
      throw new Error(`Unexpected training call: ${path}`);
    });

    render(<Training token="token" currentUser={leadershipUser} />);

    expect(screen.getByText("School Photographer Workbook")).toBeInTheDocument();
    const photographerLabels = await screen.findAllByText("Demo Photographer");
    expect(photographerLabels.length).toBeGreaterThan(0);
    expect(await screen.findByText("Employee Training Profile")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Launch Picture Day Challenge" }));

    const questionRadios = await screen.findAllByRole("radio");
    for (const radio of questionRadios) {
      const name = radio.getAttribute("name");
      const sameQuestionRadios = questionRadios.filter((candidate) => candidate.getAttribute("name") === name);
      if (sameQuestionRadios[0] === radio) {
        fireEvent.click(radio);
      }
    }

    fireEvent.click(screen.getByRole("button", { name: "Submit Round" }));

    await waitFor(() => {
      expect(screen.getByText(/Challenge submitted|Readiness progress has been updated/)).toBeInTheDocument();
    });
  });

  it("renders the Shoot Locations guide and lets the operator switch location detail", async () => {
    window.history.replaceState(null, "", "#locations");

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/locations") {
        return locationCatalog;
      }
      if (path === "/api/locations/location-1") {
        return locationDetailById["location-1"];
      }
      if (path === "/api/locations/location-2") {
        return locationDetailById["location-2"];
      }
      throw new Error(`Unexpected locations call: ${path}`);
    });

    render(<ShootLocations token="token" currentUser={leadershipUser} />);

    expect(screen.getByText("Loading location guide")).toBeInTheDocument();
    expect(await screen.findByText("Downtown Demo Park")).toBeInTheDocument();
    expect(screen.getByText("Guide Entries")).toBeInTheDocument();
    expect(screen.getByText("Field-Ready")).toBeInTheDocument();
    expect(screen.getByText("Needs Attention")).toBeInTheDocument();
    expect(screen.queryByText("Monday Transition")).not.toBeInTheDocument();
    expect((await screen.findAllByText("Historical Context")).length).toBeGreaterThan(0);
    expect(screen.getByText("Repeat Location")).toBeInTheDocument();
    expect(await screen.findByText("Access, Notes, And Contacts")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "North Metro" } });

    await waitFor(() => {
      expect(screen.getByText("Use the east athlete gate and keep a runner by the fieldhouse door.")).toBeInTheDocument();
    });
    expect(screen.getByText("Repeated understaffing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Downtown Demo Park/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Monday Transition State")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));

    expect(await screen.findByText("Legacy Integration Diagnostics")).toBeInTheDocument();
    expect(screen.getByText("Coexisting")).toBeInTheDocument();
  });

  it("renders the customer service scorecard and switches trend ranges", async () => {
    apiFetchMock.mockImplementation(async (path: string, _token?: string, init?: RequestInit) => {
      if (path === "/api/integrations/zendesk/status") {
        return zendeskStatus;
      }
      if (path === "/api/zendesk/leadership-summary") {
        return zendeskSummary;
      }
      if (path.startsWith("/api/zendesk/leadership-trends?range=7d")) {
        return zendeskTrends;
      }
      if (path.startsWith("/api/zendesk/leadership-trends?range=30d")) {
        return { ...zendeskTrends, range: "30d" as const, points: [...zendeskTrends.points, { ...zendeskTrends.points[0], metric_date: "2026-03-25", label: "Mar 25", opened_count: 5 }] };
      }
      if (path.startsWith("/api/zendesk/leadership-ticket-list?")) {
        return zendeskTicketList;
      }
      if (path === "/api/integrations/zendesk/test" && init?.method === "POST") {
        return { ok: true, mode: "mock" as const, message: "Zendesk demo mode is active." };
      }
      if (path === "/api/zendesk/sync" && init?.method === "POST") {
        return { connection: zendeskStatus.connection, sync_run: zendeskStatus.sync_runs[0] };
      }
      throw new Error(`Unexpected customer service call: ${path}`);
    });

    render(<CustomerService token="token" currentUser={leadershipUser} />);

    expect(screen.getByText("Loading customer service reporting")).toBeInTheDocument();
    expect(await screen.findByText("Support Trend Pulse")).toBeInTheDocument();
    expect(screen.getByText("School portraits roster mismatch")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Last 30 Days" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith("/api/zendesk/leadership-trends?range=30d", "token");
    });
  });
});
