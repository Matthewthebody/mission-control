// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../api";
import { SharedJobDetailPage } from "../pages/SharedJobDetailPage";
import { SharedJobEditorPage } from "../pages/SharedJobEditorPage";
import { SharedJobsPage } from "../pages/SharedJobsPage";
import { PrepReadinessQueuePage } from "../pages/PrepReadinessQueuePage";
import { SharedProductionPage as SharedProductionPageRoute } from "../pages/SharedProductionPage";
import { TodayOperationsBoard } from "../components/jobs/SharedJobOperations";
import type { SessionUser } from "../types";

const listSharedJobsMock = vi.fn();
const listSharedPrepReadinessQueueMock = vi.fn();
const getSharedJobDetailMock = vi.fn();
const createSharedJobDraftMock = vi.fn();
const updateSharedJobDraftMock = vi.fn();
const updateSharedPublishedJobMock = vi.fn();
const publishSharedJobMock = vi.fn();
const archiveSharedJobMock = vi.fn();
const cancelSharedJobMock = vi.fn();
const postponeSharedJobMock = vi.fn();
const markSharedJobDayReadyMock = vi.fn();
const completeSharedReadinessItemMock = vi.fn();
const updateSharedReadinessItemMock = vi.fn();
const addSharedJobStaffAssignmentMock = vi.fn();
const checkInSharedJobStaffMock = vi.fn();
const updateSharedJobStaffAssignmentMock = vi.fn();
const updateSharedJobDayMock = vi.fn();
const addSharedJobDayNoteMock = vi.fn();
const createOrResolveSharedJobWatchFlagMock = vi.fn();
const listSharedProductionQueueMock = vi.fn();
const getSharedProductionReportingMock = vi.fn();
const createOrUpdateSharedProductionItemMock = vi.fn();
const createOrUpdateSharedProductionHandoffMock = vi.fn();
const createOrUpdateSharedApprovalRequestMock = vi.fn();
const createOrUpdateSharedQaReviewMock = vi.fn();
const createOrUpdateSharedQaFindingMock = vi.fn();
const createOrUpdateSharedDeliverableItemMock = vi.fn();
const createOrUpdateSharedProductionIssueMock = vi.fn();
const getProjectWorkflowCommandCenterMock = vi.fn();
const getProjectWorkflowInstanceMock = vi.fn();
const instantiateProjectWorkflowMock = vi.fn();
const listProjectWorkflowTemplatesMock = vi.fn();

const listDirectoryOwnerOptionsMock = vi.fn();
const listOrganizationsMock = vi.fn();
const listDirectoryLocationsMock = vi.fn();
const listDirectoryContactsMock = vi.fn();
const listRecordResourcesMock = vi.fn();
const getOperationalApprovalSourceSummaryMock = vi.fn();
const createOperationalApprovalRequestMock = vi.fn();

vi.mock("../services/jobsApi", () => ({
  listSharedJobs: (...args: unknown[]) => listSharedJobsMock(...args),
  listSharedPrepReadinessQueue: (...args: unknown[]) => listSharedPrepReadinessQueueMock(...args),
  getSharedJobDetail: (...args: unknown[]) => getSharedJobDetailMock(...args),
  createSharedJobDraft: (...args: unknown[]) => createSharedJobDraftMock(...args),
  updateSharedJobDraft: (...args: unknown[]) => updateSharedJobDraftMock(...args),
  updateSharedPublishedJob: (...args: unknown[]) => updateSharedPublishedJobMock(...args),
  publishSharedJob: (...args: unknown[]) => publishSharedJobMock(...args),
  archiveSharedJob: (...args: unknown[]) => archiveSharedJobMock(...args),
  cancelSharedJob: (...args: unknown[]) => cancelSharedJobMock(...args),
  postponeSharedJob: (...args: unknown[]) => postponeSharedJobMock(...args),
  markSharedJobDayReady: (...args: unknown[]) => markSharedJobDayReadyMock(...args),
  completeSharedReadinessItem: (...args: unknown[]) => completeSharedReadinessItemMock(...args),
  updateSharedReadinessItem: (...args: unknown[]) => updateSharedReadinessItemMock(...args),
  addSharedJobStaffAssignment: (...args: unknown[]) => addSharedJobStaffAssignmentMock(...args),
  checkInSharedJobStaff: (...args: unknown[]) => checkInSharedJobStaffMock(...args),
  updateSharedJobStaffAssignment: (...args: unknown[]) => updateSharedJobStaffAssignmentMock(...args),
  updateSharedJobDay: (...args: unknown[]) => updateSharedJobDayMock(...args),
  addSharedJobDayNote: (...args: unknown[]) => addSharedJobDayNoteMock(...args),
  createOrResolveSharedJobWatchFlag: (...args: unknown[]) => createOrResolveSharedJobWatchFlagMock(...args),
  listSharedProductionQueue: (...args: unknown[]) => listSharedProductionQueueMock(...args),
  getSharedProductionReporting: (...args: unknown[]) => getSharedProductionReportingMock(...args),
  createOrUpdateSharedProductionItem: (...args: unknown[]) => createOrUpdateSharedProductionItemMock(...args),
  createOrUpdateSharedProductionHandoff: (...args: unknown[]) => createOrUpdateSharedProductionHandoffMock(...args),
  createOrUpdateSharedApprovalRequest: (...args: unknown[]) => createOrUpdateSharedApprovalRequestMock(...args),
  createOrUpdateSharedQaReview: (...args: unknown[]) => createOrUpdateSharedQaReviewMock(...args),
  createOrUpdateSharedQaFinding: (...args: unknown[]) => createOrUpdateSharedQaFindingMock(...args),
  createOrUpdateSharedDeliverableItem: (...args: unknown[]) => createOrUpdateSharedDeliverableItemMock(...args),
  createOrUpdateSharedProductionIssue: (...args: unknown[]) => createOrUpdateSharedProductionIssueMock(...args)
}));

vi.mock("../services/projectTracking", () => ({
  getProjectWorkflowCommandCenter: (...args: unknown[]) => getProjectWorkflowCommandCenterMock(...args),
  getProjectWorkflowInstance: (...args: unknown[]) => getProjectWorkflowInstanceMock(...args),
  instantiateProjectWorkflow: (...args: unknown[]) => instantiateProjectWorkflowMock(...args),
  listProjectWorkflowTemplates: (...args: unknown[]) => listProjectWorkflowTemplatesMock(...args)
}));

vi.mock("../services/organizationApi", () => ({
  listDirectoryOwnerOptions: (...args: unknown[]) => listDirectoryOwnerOptionsMock(...args),
  listOrganizations: (...args: unknown[]) => listOrganizationsMock(...args),
  listDirectoryLocations: (...args: unknown[]) => listDirectoryLocationsMock(...args),
  listDirectoryContacts: (...args: unknown[]) => listDirectoryContactsMock(...args)
}));

vi.mock("../services/recordResourcesApi", () => ({
  listRecordResources: (...args: unknown[]) => listRecordResourcesMock(...args),
  createRecordResource: vi.fn(),
  deleteRecordResource: vi.fn(),
  uploadRecordResourceFile: vi.fn()
}));

vi.mock("../services/operationalApprovals", () => ({
  getOperationalApprovalSourceSummary: (...args: unknown[]) => getOperationalApprovalSourceSummaryMock(...args),
  createOperationalApprovalRequest: (...args: unknown[]) => createOperationalApprovalRequestMock(...args)
}));

const sessionTrust = {
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

const schoolsManager: SessionUser = {
  id: "user-schools",
  tenantId: "tenant-demo",
  accountId: "account-demo",
  sessionId: "session-schools",
  email: "schools@example.com",
  fullName: "Schools Manager",
  status: "active",
  department: "schools",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["manager"],
  permissions: [
    "shoot.create",
    "shoot.read",
    "shoot.update",
    "schools_hub.view",
    "schools_hub.manage",
    "job.create",
    "job.read",
    "job.update",
    "job.publish",
    "production.read",
    "production.update"
  ],
  authorityTier: "supervisor",
  primaryJobFunctionProfile: "schools_client_success",
  jobFunctionProfiles: ["schools_client_success"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust
};

const sportsManager: SessionUser = {
  ...schoolsManager,
  id: "user-sports",
  sessionId: "session-sports",
  email: "sports@example.com",
  fullName: "Sports Manager",
  department: "sports",
  permissions: [
    "shoot.create",
    "shoot.read",
    "shoot.update",
    "sports_hub.manage",
    "job.create",
    "job.read",
    "job.update",
    "job.publish",
    "production.read",
    "production.update"
  ],
  primaryJobFunctionProfile: "director_of_sports_photography",
  jobFunctionProfiles: ["director_of_sports_photography"]
};

const sportsFinanceViewer: SessionUser = {
  ...sportsManager,
  permissions: [...sportsManager.permissions, "sports_finance.view"]
};

const sportsCoordinator: SessionUser = {
  ...sportsManager,
  id: "user-sports-coordinator",
  sessionId: "session-sports-coordinator",
  email: "sports-coordinator@example.com",
  fullName: "Sports Coordinator",
  roles: [],
  authorityTier: "standard_employee",
  permissions: [],
  primaryJobFunctionProfile: "associate_photographer",
  jobFunctionProfiles: ["associate_photographer"]
};

const sportsLeadUser: SessionUser = {
  ...sportsCoordinator,
  id: "user-sports",
  sessionId: "session-sports-lead",
  email: "lead@example.com",
  fullName: "Sports Lead"
};

const ownerOptions = {
  owners: [
    {
      user_id: "owner-1",
      full_name: "Alex Owner",
      department: "sports"
    }
  ]
};

const schoolOrganization = {
  id: "org-school",
  canonical_name: "North High",
  logo_url: null,
  display_name: "North High",
  account_type: "schools_underclass_portraits",
  active_status: "active",
  aliases: [],
  notes: null,
  contact_count: 3,
  location_count: 2,
  created_at: "2026-04-01T12:00:00.000Z",
  updated_at: "2026-04-01T12:00:00.000Z"
};

const sportsOrganization = {
  ...schoolOrganization,
  id: "org-sports",
  canonical_name: "Metro Football Club",
  display_name: "Metro Football Club",
  account_type: "sports",
  aliases: ["Metro Athletics"]
};

const schoolLocation = {
  id: "loc-school",
  organization_id: "org-school",
  location_name: "North High Main Gym",
  address_line_1: "100 North High Rd",
  address_line_2: null,
  city: "Milwaukee",
  state: "WI",
  zip: "53202",
  address_display: "100 North High Rd, Milwaukee, WI 53202",
  maps_label: null,
  maps_url: null,
  active_status: "active",
  contact_links: [],
  notes: "Use activities entrance.",
  created_at: "2026-04-01T12:00:00.000Z",
  updated_at: "2026-04-01T12:00:00.000Z"
};

const sportsLocation = {
  ...schoolLocation,
  id: "loc-sports",
  organization_id: "org-sports",
  location_name: "Metro Field House",
  address_display: "200 Stadium Way, Milwaukee, WI 53202",
  notes: "Load in at south doors."
};

function buildJobListItem(overrides: Record<string, unknown>) {
  return {
    id: "job-1",
    tenant_id: "tenant-demo",
    legacy_shoot_id: null,
    job_number: "SCH-2026-0007",
    department_type: "schools",
    job_category: "photo_day",
    organization_id: "org-school",
    primary_location_id: "loc-1",
    primary_contact_id: "contact-1",
    account_owner_user_id: "owner-1",
    title: "North High Picture Day",
    event_name: "Picture Day",
    description_internal: null,
    job_status: "confirmed",
    production_status: "queued",
    staffing_status: "staffed",
    readiness_status: "on_track",
    sync_status: "clean",
    risk_status: "low",
    priority_level: "normal",
    delivery_type: "mixed",
    gallery_type: "individual",
    scheduled_start_at: "2026-09-12T08:00:00",
    scheduled_end_at: "2026-09-12T15:00:00",
    timezone: "America/Chicago",
    estimated_subject_count: 400,
    actual_subject_count: null,
    estimated_staff_count: 4,
    actual_staff_count: null,
    client_deadline_at: null,
    production_deadline_at: null,
    published_at: "2026-04-01T12:00:00.000Z",
    archived_at: null,
    cancelled_at: null,
    cancel_reason: null,
    production_required: true,
    location_override_note: null,
    contact_override_note: null,
    created_by_user_id: "user-1",
    updated_by_user_id: "user-1",
    created_at: "2026-04-01T12:00:00.000Z",
    updated_at: "2026-04-01T12:00:00.000Z",
    organization_name: "North High",
    primary_location_name: "Main Gym",
    primary_location_address: "123 Main",
    primary_contact_name: "Jamie Contact",
    account_owner_name: "Alex Owner",
    lead_owner_user_id: "lead-1",
    lead_owner_name: "Taylor Lead",
    primary_day_date: "2026-09-12",
    primary_day_start_time: "08:00",
    primary_day_end_time: "15:00",
    primary_day_label: "Day 1",
    school_profile: {
      job_id: "job-1",
      tenant_id: "tenant-demo",
      district_id: "district-1",
      district_name: "North District",
      school_type: "high_school",
      school_year: "2026-2027",
      grade_scope: "9-12",
      roster_source: "sis_export",
      id_cards_required: true,
      yearbook_required: true,
      composite_required: false,
      admin_portal_required: false,
      submission_deadline: "2026-10-01",
      advisor_sorting_required: false,
      homeroom_sorting_required: true,
      data_import_mode: "roster_csv",
      special_instructions: null
    },
    sports_profile: null,
    department_summary: {},
    proof_status: null,
    readiness_percent: 75,
    blocker_count: 0,
    day_count: 1,
    assigned_staff_count: 2,
    checked_in_staff_count: 0,
    ready_present_count: 0,
    open_watch_flag_count: 0,
    ...overrides
  } as any;
}

function buildSportsDetail(overrides: Record<string, unknown> = {}) {
  return {
    job: buildJobListItem({
      id: "job-sports-1",
      job_number: "SPT-2026-0007",
      department_type: "sports",
      title: "Metro Football Media Day",
      event_name: "Media Day",
      organization_id: "org-sports",
      organization_name: "Metro Football Club",
      primary_location_id: "loc-sports",
      primary_contact_id: "contact-sports",
      primary_contact_name: "Jordan Coach",
      readiness_status: "at_risk",
      production_status: "proof_build",
      risk_status: "high",
      lead_owner_user_id: "owner-1",
      lead_owner_name: "Alex Owner",
      school_profile: null,
      sports_profile: {
        job_id: "job-sports-1",
        tenant_id: "tenant-demo",
        sport_type: "football",
        season: "fall",
        league_name: "Metro League",
        division: "Varsity",
        team_structure: "scheduled_slots",
        estimated_team_count: 6,
        proof_required: true,
        approval_contact_id: "contact-approval",
        approval_contact_name: "Morgan Approval",
        billing_contact_id: "contact-billing",
        billing_contact_name: "Taylor Billing",
        revenue_share_enabled: true,
        revenue_share_terms_summary: "15% after approvals",
        banner_work_required: true,
        specialty_products_required: true,
        buddy_photos_required: false,
        sponsor_graphics_required: true,
        client_expectations_notes: "Sponsor banner proofs due first."
      },
      proof_status: "proof_build"
    }),
    summary: {
      organization_name: "Metro Football Club",
      organization_account_type: "sports",
      primary_location_name: "Stadium A",
      primary_location_address: "456 Arena",
      primary_contact_name: "Jordan Coach",
      primary_contact_title: "Coach",
      account_owner_name: "Alex Owner",
      lead_owner_user_id: "owner-1",
      lead_owner_name: "Alex Owner",
      primary_day_date: "2026-08-22",
      primary_day_start_time: "09:00",
      primary_day_end_time: "13:00",
      primary_day_label: "Day 1",
      latest_activity_at: "2026-04-01T12:00:00.000Z",
      department_summary: {},
      proof_status: "proof_build"
    },
    school_profile: null,
    sports_profile: {
      job_id: "job-sports-1",
      tenant_id: "tenant-demo",
      sport_type: "football",
      season: "fall",
      league_name: "Metro League",
      division: "Varsity",
      team_structure: "scheduled_slots",
      estimated_team_count: 6,
      proof_required: true,
      approval_contact_id: "contact-approval",
      approval_contact_name: "Morgan Approval",
      billing_contact_id: "contact-billing",
      billing_contact_name: "Taylor Billing",
      revenue_share_enabled: true,
      revenue_share_terms_summary: "15% after approvals",
      banner_work_required: true,
      specialty_products_required: true,
      buddy_photos_required: false,
      sponsor_graphics_required: true,
      client_expectations_notes: "Sponsor banner proofs due first."
    },
    days: [
      {
        id: "day-1",
        tenant_id: "tenant-demo",
        job_id: "job-sports-1",
        legacy_shoot_day_id: null,
        day_label: "Day 1",
        date: "2026-08-22",
        start_time: "09:00",
        end_time: "13:00",
        timezone: "America/Chicago",
        location_id: "loc-sports",
        location_name: "Stadium A",
        onsite_contact_id: "contact-sports",
        onsite_contact_name: "Jordan Coach",
        lead_user_id: "owner-1",
        lead_user_name: "Alex Owner",
        day_status: "scheduled",
        weather_sensitive: false,
        indoor_outdoor: "outdoor",
        access_notes: null,
        parking_notes: null,
        setup_notes: null,
        travel_notes: null,
        check_in_window_start: null,
        check_in_window_end: null,
        ready_confirmed_at: null,
        ready_confirmed_by_user_id: null,
        created_at: "2026-04-01T12:00:00.000Z",
        updated_at: "2026-04-01T12:00:00.000Z"
      }
    ],
    staff_assignments: [],
    readiness_items: [],
    production_items: [],
    production_handoffs: [],
    approval_requests: [],
    qa_reviews: [],
    qa_findings: [],
    deliverable_items: [],
    production_issues: [],
    watch_flags: [],
    activity: [
      {
        id: "activity-1",
        tenant_id: "tenant-demo",
        object_type: "job",
        object_id: "job-sports-1",
        related_object_type: "job",
        related_object_id: "job-sports-1",
        source_kind: "activity_log",
        job_id: "job-sports-1",
        job_day_id: null,
        production_item_id: null,
        watch_flag_id: null,
        organization_id: null,
        location_id: null,
        contact_id: null,
        actor_user_id: "owner-1",
        actor_name: "Alex Owner",
        event_type: "job_published",
        action_label: "Published",
        summary: "Job published",
        detail: null,
        tone: "success",
        metadata: {},
        created_at: "2026-04-01T12:00:00.000Z"
      }
    ],
    status: {
      readiness_percent: 66,
      job_status: "confirmed",
      production_status: "proof_build",
      staffing_status: "partially_staffed",
      readiness_status: "at_risk",
      risk_status: "high",
      blocker_count: 1,
      open_watch_flag_count: 0
    },
    ...overrides
  } as any;
}

function buildWorkflowSummaryFixture() {
  return {
    publish: {
      key: "publish",
      label: "Publish Readiness",
      state: "blocked",
      blocker_count: 2,
      warning_count: 0,
      summary: "Required job data is still missing.",
      next_action: "Resolve the publish blockers",
      issues: [
        {
          code: "required",
          level: "hard_block",
          subject_type: "job",
          subject_id: "job-sports-1",
          field: "organization_id",
          message: "Organization is required before publish.",
          action_label: "Link the organization",
          metadata: null
        }
      ]
    },
    readiness: {
      key: "readiness",
      label: "Staffing and Readiness",
      state: "warning",
      blocker_count: 0,
      warning_count: 1,
      summary: "Execution can proceed, but readiness still has warnings.",
      next_action: "Resolve staffing gaps",
      issues: []
    },
    production: {
      key: "production",
      label: "Production Workflow",
      state: "clear",
      blocker_count: 0,
      warning_count: 0,
      summary: "Production work is clear to continue.",
      next_action: null,
      issues: []
    },
    approvals: {
      key: "approvals",
      label: "Approvals",
      state: "clear",
      blocker_count: 0,
      warning_count: 0,
      summary: "No approval gates are currently blocking this job.",
      next_action: null,
      issues: []
    },
    evaluations: {
      key: "evaluations",
      label: "Post-Shoot Evaluation",
      state: "warning",
      blocker_count: 0,
      warning_count: 1,
      summary: "Capture the post-shoot evaluation when execution wraps.",
      next_action: "Capture post-shoot evaluation",
      issues: []
    }
  };
}

function buildWorkflowValidationFixture() {
  return {
    subject_type: "job",
    subject_id: "job-sports-1",
    transition_key: "job.publish",
    current_state: "draft",
    target_state: "published",
    allowed: false,
    hard_blocked: true,
    blocker_count: 1,
    warning_count: 0,
    issues: [
      {
        code: "required",
        level: "hard_block",
        subject_type: "job",
        subject_id: "job-sports-1",
        field: "organization_id",
        message: "Organization is required before publish.",
        action_label: "Link the organization",
        metadata: null
      }
    ],
    checklist_validation: null
  };
}

function buildOperationalSportsDetail(overrides: Record<string, unknown> = {}) {
  return buildSportsDetail({
    days: [
      {
        id: "day-1",
        tenant_id: "tenant-demo",
        job_id: "job-sports-1",
        legacy_shoot_day_id: null,
        day_label: "Game Day",
        date: "2026-08-22",
        start_time: "09:00",
        end_time: "13:00",
        timezone: "America/Chicago",
        location_id: "loc-sports",
        location_name: "Stadium A",
        onsite_contact_id: "contact-sports",
        onsite_contact_name: "Jordan Coach",
        lead_user_id: "user-sports",
        lead_user_name: "Sports Manager",
        day_status: "scheduled",
        weather_sensitive: false,
        indoor_outdoor: "outdoor",
        access_notes: "Use east gate.",
        parking_notes: "Lot B",
        setup_notes: "Backdrop on field level.",
        travel_notes: null,
        check_in_window_start: null,
        check_in_window_end: null,
        ready_confirmed_at: null,
        ready_confirmed_by_user_id: null,
        created_at: "2026-04-01T12:00:00.000Z",
        updated_at: "2026-04-01T12:00:00.000Z"
      }
    ],
    staff_assignments: [
      {
        id: "assignment-lead",
        tenant_id: "tenant-demo",
        job_id: "job-sports-1",
        job_day_id: "day-1",
        user_id: "user-sports",
        user_name: "Sports Manager",
        assignment_role: "lead_photographer",
        assignment_status: "assigned",
        is_lead: true,
        check_in_at: null,
        check_out_at: null,
        is_ready_present: false,
        notes: "Lead on deck.",
        created_at: "2026-04-01T12:00:00.000Z",
        updated_at: "2026-04-01T12:00:00.000Z"
      },
      {
        id: "assignment-second",
        tenant_id: "tenant-demo",
        job_id: "job-sports-1",
        job_day_id: "day-1",
        user_id: "owner-1",
        user_name: "Alex Owner",
        assignment_role: "assistant",
        assignment_status: "assigned",
        is_lead: false,
        check_in_at: null,
        check_out_at: null,
        is_ready_present: false,
        notes: "Support camera setup.",
        created_at: "2026-04-01T12:00:00.000Z",
        updated_at: "2026-04-01T12:00:00.000Z"
      }
    ],
    readiness_items: [
      {
        id: "readiness-1",
        tenant_id: "tenant-demo",
        job_id: "job-sports-1",
        job_day_id: null,
        section_key: "schedule",
        label: "Team schedule received",
        description: "Slot schedule must be confirmed before the team arrives.",
        is_required: true,
        is_blocker: true,
        is_complete: false,
        completed_at: null,
        completed_by_user_id: null,
        completed_by_name: null,
        due_at: "2026-08-21T18:00:00.000Z",
        sort_order: 1,
        source_template_key: "sports-schedule",
        notes: "Waiting on updated slot list.",
        created_at: "2026-04-01T12:00:00.000Z",
        updated_at: "2026-04-01T12:00:00.000Z"
      },
      {
        id: "readiness-2",
        tenant_id: "tenant-demo",
        job_id: "job-sports-1",
        job_day_id: null,
        section_key: "client_approvals",
        label: "Approval owner confirmed",
        description: "Proof owner must be known.",
        is_required: true,
        is_blocker: false,
        is_complete: true,
        completed_at: "2026-04-01T12:00:00.000Z",
        completed_by_user_id: "user-sports",
        completed_by_name: "Sports Manager",
        due_at: null,
        sort_order: 2,
        source_template_key: "sports-proof-owner",
        notes: "Morgan Approval confirmed.",
        created_at: "2026-04-01T12:00:00.000Z",
        updated_at: "2026-04-01T12:00:00.000Z"
      }
    ],
    watch_flags: [
      {
        id: "flag-1",
        tenant_id: "tenant-demo",
        job_id: "job-sports-1",
        job_day_id: "day-1",
        production_item_id: null,
        severity: "high",
        flag_type: "staffing_gap",
        title: "Assistant coverage still missing",
        description: "Need a backup assistant if Alex cannot arrive.",
        status: "open",
        owner_user_id: null,
        owner_name: null,
        due_at: "2026-08-22T08:00:00.000Z",
        resolved_at: null,
        resolved_by_user_id: null,
        resolved_by_name: null,
        auto_key: null,
        created_at: "2026-04-01T12:00:00.000Z"
      }
    ],
    activity: [
      {
        id: "activity-1",
        tenant_id: "tenant-demo",
        object_type: "job",
        object_id: "job-sports-1",
        related_object_type: "job",
        related_object_id: "job-sports-1",
        source_kind: "activity_log",
        job_id: "job-sports-1",
        job_day_id: null,
        production_item_id: null,
        watch_flag_id: null,
        organization_id: null,
        location_id: null,
        contact_id: null,
        actor_user_id: "owner-1",
        actor_name: "Alex Owner",
        event_type: "job_published",
        action_label: "Published",
        summary: "Job published",
        detail: null,
        tone: "success",
        metadata: {},
        created_at: "2026-04-01T12:00:00.000Z"
      },
      {
        id: "activity-2",
        tenant_id: "tenant-demo",
        object_type: "job",
        object_id: "job-sports-1",
        related_object_type: "job_staff_assignment",
        related_object_id: "assignment-1",
        source_kind: "activity_log",
        job_id: "job-sports-1",
        job_day_id: "day-1",
        production_item_id: null,
        watch_flag_id: null,
        organization_id: null,
        location_id: null,
        contact_id: null,
        actor_user_id: "user-sports",
        actor_name: "Sports Manager",
        event_type: "assignment_created",
        action_label: "Assigned staff",
        summary: "Lead assigned for game day",
        detail: null,
        tone: "info",
        metadata: {},
        created_at: "2026-04-01T13:00:00.000Z"
      }
    ],
    status: {
      readiness_percent: 50,
      job_status: "confirmed",
      production_status: "proof_build",
      staffing_status: "gap_flagged",
      readiness_status: "at_risk",
      risk_status: "high",
      blocker_count: 1,
      open_watch_flag_count: 1
    },
    ...overrides
  });
}

function buildOperationalSchoolDetail(overrides: Record<string, unknown> = {}) {
  const base = buildJobListItem({
    id: "job-school-ops",
    job_number: "SCH-2026-0042",
    title: "North High Picture Day",
    department_type: "schools",
    job_status: "confirmed",
    readiness_status: "off_track",
    staffing_status: "unassigned",
    risk_status: "high"
  });
  return {
    job: base,
    summary: {
      organization_name: "North High",
      organization_account_type: "schools_underclass_portraits",
      primary_location_name: "Main Gym",
      primary_location_address: "123 Main",
      primary_contact_name: "Jamie Contact",
      primary_contact_title: "Office Manager",
      account_owner_name: "Alex Owner",
      lead_owner_user_id: null,
      lead_owner_name: null,
      primary_day_date: "2026-09-12",
      primary_day_start_time: "08:00",
      primary_day_end_time: "14:00",
      primary_day_label: "Picture Day",
      latest_activity_at: "2026-04-01T12:00:00.000Z",
      department_summary: {},
      proof_status: null
    },
    school_profile: base.school_profile,
    sports_profile: null,
    days: [
      {
        id: "day-school-1",
        tenant_id: "tenant-demo",
        job_id: "job-school-ops",
        legacy_shoot_day_id: null,
        day_label: "Picture Day",
        date: "2026-09-12",
        start_time: "08:00",
        end_time: "14:00",
        timezone: "America/Chicago",
        location_id: "loc-1",
        location_name: "Main Gym",
        onsite_contact_id: "contact-1",
        onsite_contact_name: "Jamie Contact",
        lead_user_id: null,
        lead_user_name: null,
        day_status: "scheduled",
        weather_sensitive: false,
        indoor_outdoor: "indoor",
        access_notes: "Use front office entrance.",
        parking_notes: "Staff lot",
        setup_notes: "Line up 3 stations.",
        travel_notes: null,
        check_in_window_start: null,
        check_in_window_end: null,
        ready_confirmed_at: null,
        ready_confirmed_by_user_id: null,
        created_at: "2026-04-01T12:00:00.000Z",
        updated_at: "2026-04-01T12:00:00.000Z"
      }
    ],
    staff_assignments: [],
    readiness_items: [
      {
        id: "school-readiness-1",
        tenant_id: "tenant-demo",
        job_id: "job-school-ops",
        job_day_id: null,
        section_key: "data",
        label: "Roster received",
        description: "Roster import must be complete.",
        is_required: true,
        is_blocker: true,
        is_complete: false,
        completed_at: null,
        completed_by_user_id: null,
        completed_by_name: null,
        due_at: "2026-09-11T12:00:00.000Z",
        sort_order: 1,
        source_template_key: "school-roster",
        notes: "Still waiting on SIS export.",
        created_at: "2026-04-01T12:00:00.000Z",
        updated_at: "2026-04-01T12:00:00.000Z"
      },
      {
        id: "school-readiness-2",
        tenant_id: "tenant-demo",
        job_id: "job-school-ops",
        job_day_id: null,
        section_key: "contacts",
        label: "Admin contact confirmed",
        description: "Front office contact verified.",
        is_required: true,
        is_blocker: false,
        is_complete: true,
        completed_at: "2026-04-01T12:00:00.000Z",
        completed_by_user_id: "user-schools",
        completed_by_name: "Schools Manager",
        due_at: null,
        sort_order: 2,
        source_template_key: "school-admin-contact",
        notes: "Jamie will open building at 7:30.",
        created_at: "2026-04-01T12:00:00.000Z",
        updated_at: "2026-04-01T12:00:00.000Z"
      }
    ],
    production_items: [],
    production_handoffs: [],
    approval_requests: [],
    qa_reviews: [],
    qa_findings: [],
    deliverable_items: [],
    production_issues: [],
    watch_flags: [],
    activity: [
      {
        id: "school-activity-1",
        tenant_id: "tenant-demo",
        object_type: "job",
        object_id: "job-school-ops",
        related_object_type: "job",
        related_object_id: "job-school-ops",
        source_kind: "activity_log",
        job_id: "job-school-ops",
        job_day_id: null,
        production_item_id: null,
        watch_flag_id: null,
        organization_id: null,
        location_id: null,
        contact_id: null,
        actor_user_id: "user-schools",
        actor_name: "Schools Manager",
        event_type: "job_published",
        action_label: "Published",
        summary: "Job published",
        detail: null,
        tone: "success",
        metadata: {},
        created_at: "2026-04-01T12:00:00.000Z"
      }
    ],
    status: {
      readiness_percent: 50,
      job_status: "confirmed",
      production_status: "queued",
      staffing_status: "unassigned",
      readiness_status: "off_track",
      risk_status: "high",
      blocker_count: 1,
      open_watch_flag_count: 0
    },
    prep_readiness: {
      preview_only: true,
      generated_at: "2026-04-01T12:00:00.000Z",
      status: "needs_attention",
      client_prep: {
        account_name: "North High",
        job_name: "North High Picture Day",
        job_date: "2026-09-12",
        primary_location: {
          id: "loc-1",
          location_name: "Main Gym",
          address_display: "123 Main, Plymouth, MN",
          google_maps_url: "https://www.google.com/maps/search/?api=1&query=Main%20Gym",
          client_facing_notes: "Client-safe: please use Door 7.",
          reference_attachments: []
        },
        eligible_email_recipients: [
          {
            id: "contact-ready",
            display_name: "Pat Prep",
            title: "Secretary",
            email: "pat@example.com",
            mobile_phone: "555-2010",
            client_roles: ["picture_day_prep_recipient"]
          }
        ],
        eligible_sms_recipients: [],
        excluded_contacts: [
          {
            id: "contact-unknown",
            display_name: "Sam Unknown",
            title: "Office",
            email: "sam@example.com",
            mobile_phone: "555-2020",
            client_roles: ["picture_day_prep_recipient"],
            prep_email_exclusion_reason: null,
            prep_sms_exclusion_reason: "SMS consent is unknown."
          }
        ]
      },
      employee_briefing: {
        primary_location: {
          id: "loc-1",
          location_name: "Main Gym",
          address_display: "123 Main, Plymouth, MN",
          google_maps_url: "https://www.google.com/maps/search/?api=1&query=Main%20Gym",
          client_facing_notes: "Client-safe: please use Door 7.",
          navigation_notes: "Use Door 7, not the main entrance.",
          parking_instructions: "Park in the west staff lot.",
          entrance_instructions: "Check in at Door 7.",
          unloading_instructions: "Unload by the west service lane.",
          setup_area: "Set up near the cafeteria stage.",
          backup_indoor_location: "Media center.",
          accessibility_notes: null,
          power_availability_notes: "North wall outlets.",
          wifi_cell_notes: "Guest Wi-Fi from office.",
          security_checkin_requirements: null,
          weather_contingency_notes: "Use indoor route during rain.",
          employee_facing_notes: "Bring extension cords.",
          internal_only_notes: "Internal-only: do not mention the bus lane conflict.",
          reference_attachments: [
            {
              id: "attachment-internal",
              title: "Internal Parking Map",
              description: "West lot reference.",
              attachment_type: "parking_map",
              audience: "internal_only",
              file_url: "https://example.com/internal-map.png",
              storage_key: null
            }
          ]
        }
      },
      message_previews: {
        client_prep_email: {
          preview_only: true,
          template_key: "client_prep_email_v1",
          label: "Client Prep Email",
          channel: "email",
          can_preview: true,
          recipients: [
            {
              id: "contact-ready",
              display_name: "Pat Prep",
              title: "Secretary",
              email: "pat@example.com",
              mobile_phone: "555-2010",
              client_roles: ["picture_day_prep_recipient"]
            }
          ],
          subject: "Prep details for North High Picture Day",
          body_lines: [
            "Hello Pat,",
            "Here are the prep details for North High Picture Day.",
            "Account: North High",
            "Location: Main Gym",
            "Google Maps: https://www.google.com/maps/search/?api=1&query=Main%20Gym",
            "Prep note: Client-safe: please use Door 7."
          ],
          warnings: [],
          reference_attachments: []
        },
        client_prep_sms: {
          preview_only: true,
          template_key: "client_prep_sms_v1",
          label: "Client Prep SMS",
          channel: "sms",
          can_preview: false,
          recipients: [],
          subject: null,
          body_lines: ["SMS preview unavailable until at least one prep contact is SMS eligible."],
          warnings: [
            {
              code: "sms_preview_no_recipient",
              severity: "blocker",
              label: "No SMS-eligible recipients",
              detail: "SMS preview requires opted-in SMS recipients."
            }
          ],
          reference_attachments: []
        },
        employee_briefing: {
          preview_only: true,
          template_key: "employee_briefing_v1",
          label: "Employee Briefing",
          channel: "internal_briefing",
          can_preview: true,
          recipients: [],
          subject: "Employee briefing: North High Picture Day",
          body_lines: [
            "Job: North High Picture Day",
            "Account: North High",
            "Google Maps: https://www.google.com/maps/search/?api=1&query=Main%20Gym",
            "Employee-facing notes: Bring extension cords.",
            "Internal-only notes: Internal-only: do not mention the bus lane conflict.",
            "Reference attachments: Internal Parking Map (internal only)"
          ],
          warnings: [],
          reference_attachments: [
            {
              id: "attachment-internal",
              title: "Internal Parking Map",
              description: "West lot reference.",
              attachment_type: "parking_map",
              audience: "internal_only",
              file_url: "https://example.com/internal-map.png",
              storage_key: null
            }
          ]
        }
      },
      warnings: [
        {
          code: "no_prep_sms_recipients",
          severity: "warning",
          label: "No SMS-eligible prep recipients",
          detail: "SMS requires opted-in consent."
        }
      ]
    },
    ...overrides
  } as any;
}

function buildProjectWorkflowCommandCenter(rows: any[] = []) {
  return {
    generated_at: "2026-04-01T12:00:00.000Z",
    view: "global",
    summary: {
      open_steps: rows.length,
      overdue_steps: 0,
      due_soon_steps: 0,
      blocked_steps: 0,
      assigned_steps: 0,
      rework_steps: 0,
      at_risk_steps: 0,
      total_active_workflows: rows.length,
      total_open_work: rows.length,
      total_needs_attention: 0,
      total_blocked: 0,
      total_running_late: 0,
      total_due_soon: 0,
      total_returned_for_fixes: 0,
      total_waiting_on_school: 0,
      total_waiting_on_kp: 0,
      total_missing_info: 0,
      total_complete: 0,
      total_no_workflow_linked: 0,
      source: "true_totals",
      confidence: "explicit"
    },
    alerts: [],
    steps: [],
    job_rows: rows
  };
}

function buildProjectWorkflowJobRow(overrides: Record<string, unknown> = {}) {
  return {
    job_id: "job-school-ops",
    job_number: "SCH-2026-0042",
    job_code: null,
    job_title: "North High Picture Day",
    organization_id: "org-school",
    organization_name: "North High",
    account_id: "account-school",
    account_name: "North High Account",
    workflow_run_id: "workflow-school-ops",
    workflow_template_id: "template-school",
    workflow_template_name: "School Portraits Workflow",
    workflow_template_version: "v1",
    current_step: {
      id: "step-prep",
      workflow_run_id: "workflow-school-ops",
      job_id: "job-school-ops",
      milestone_key: "schools_setup",
      step_key: "prep_data_admin",
      name: "Prep data/admin",
      description: null,
      department: "schools",
      role_key: "csr_owner",
      assigned_user_id: null,
      assigned_user_name: null,
      assignment_status: "needs_assignment",
      assigned_queue: "schools",
      assigned_by_user_id: null,
      assigned_by_user_name: null,
      assigned_at: null,
      waiting_on_party: "school",
      waiting_detail: "Roster SIS export",
      status: "IN_PROGRESS",
      required: true,
      skippable: false,
      blocking: true,
      expected_duration_minutes: 240,
      started_at: "2026-04-01T12:00:00.000Z",
      completed_at: null,
      completed_by_user_id: null,
      notes: null,
      exception_reason: null,
      rework_count: 0,
      dependency_step_ids: [],
      timing: {
        elapsed_minutes: 30,
        remaining_minutes: 210,
        overdue_minutes: 0,
        idle_minutes: 10,
        sla_percent: 12,
        alert_level: "risk",
        health_state: "yellow"
      },
      updated_at: "2026-04-01T12:30:00.000Z",
      phase: "Schools Setup"
    },
    phase: "Schools Setup",
    owner_display: "CSR Owner",
    owner_type: "role",
    job_date: "2026-09-12",
    next_deadline_at: "2026-09-11T17:00:00.000Z",
    deadline_state: "due_soon",
    waiting_on_party: "school",
    health: "at_risk",
    health_reasons: ["Roster data still needs confirmation."],
    file_status: "not_connected",
    missing_info_flags: ["missing_roster"],
    rework_count: 0,
    blocked_reason: null,
    updated_at: "2026-04-01T12:30:00.000Z",
    ...overrides
  };
}

function buildProjectWorkflowInstance(overrides: Record<string, unknown> = {}) {
  const stepBase = buildProjectWorkflowJobRow().current_step;
  return {
    workflow_run: {
      id: "workflow-school-ops",
      job_id: "job-school-ops",
      template_id: "template-school",
      template_version_id: "template-version-school",
      template_key: "school_portraits",
      template_name: "School Portraits Workflow",
      template_version_label: "v1",
      workflow_family: "project_tracking",
      status: "active",
      started_at: "2026-04-01T12:00:00.000Z",
      completed_at: null
    },
    job: {
      id: "job-school-ops",
      title: "North High Picture Day",
      job_type: "school_portraits",
      organization_id: "org-school",
      organization_name: "North High",
      account_owner_user_id: null
    },
    milestones: [
      {
        id: "milestone-schools",
        milestone_key: "schools_setup",
        name: "Schools Setup",
        description: null,
        status: "ACTIVE",
        steps: [
          {
            ...stepBase,
            id: "step-confirm",
            step_key: "confirm_schedule",
            name: "Confirm schedule",
            status: "COMPLETE",
            completed_at: "2026-04-01T11:00:00.000Z"
          },
          stepBase,
          {
            ...stepBase,
            id: "step-send-production",
            step_key: "send_to_production",
            name: "Send to Production",
            status: "NOT_STARTED",
            waiting_on_party: "none",
            waiting_detail: null
          }
        ]
      }
    ],
    handoffs: [],
    audit_events: [],
    ...overrides
  };
}

function buildDownstreamSportsDetail(overrides: Record<string, unknown> = {}) {
  const base = buildSportsDetail({
    job_shoot_links: [
      {
        id: "job-shoot-link-1",
        tenant_id: "tenant-demo",
        job_id: "job-sports-1",
        shoot_id: "shoot-sports-1",
        link_reason: "published_shoot_default",
        created_at: "2026-04-01T12:00:00.000Z"
      }
    ],
    production_items: [
      {
        id: "prod-1",
        tenant_id: "tenant-demo",
        job_id: "job-sports-1",
        job_day_id: null,
        production_group_key: "proof-1",
        title: "Varsity Proof Packet",
        job_type: "sports_media_day",
        production_type: "proof_build",
        created_from_source: "published_shoot_default",
        status: "blocked",
        workflow_status: "READY_FOR_QA",
        health_state: "BLOCKED",
        sync_state: "PARTIAL_ERROR",
        priority: "high",
        assigned_to_user_id: "owner-1",
        assigned_to_name: "Alex Owner",
        organization_id: "org-sports",
        location_id: "loc-sports-1",
        location_name: "Main Turf",
        primary_contact_id: "contact-sports-1",
        primary_contact_name: "Jamie Coach",
        account_owner_user_id: "owner-1",
        account_owner_name: "Alex Owner",
        department_owner_user_id: "user-sports",
        assigned_peer_reviewer_user_id: "user-sports",
        assigned_peer_reviewer_name: "Sports Manager",
        assigned_release_reviewer_user_id: "owner-1",
        assigned_release_reviewer_name: "Alex Owner",
        escalation_owner_user_id: "user-sports",
        escalation_owner_name: "Sports Manager",
        department_type: "sports",
        shoot_date_start: "2026-08-22",
        shoot_date_end: "2026-08-22",
        production_start_at: "2026-08-22T12:30:00.000Z",
        approval_required: true,
        proof_required: true,
        qa_required: true,
        due_at: "2026-08-24T17:00:00.000Z",
        release_due_at: "2026-08-25T17:00:00.000Z",
        delivery_deadline_at: "2026-08-26T17:00:00.000Z",
        completed_at: null,
        closed_at: null,
        readiness_score: 72,
        blocker_count: 1,
        rework_count: 1,
        file_count_expected: 120,
        file_count_received: 60,
        file_match_status: "PARTIAL",
        roster_received: true,
        naming_verified: true,
        folder_structure_verified: false,
        tags_or_flags_verified: true,
        handoff_complete: true,
        upload_status: "NOT_STARTED",
        release_status: "NOT_STARTED",
        release_target: "proof_portal",
        gallery_or_output_reference: "proof-portal://varsity-packet",
        vendor_name: null,
        vendor_reference: null,
        blocked_reason: "Awaiting coach proof response.",
        client_visible_label: "Proof Packet",
        qa_status: "queued",
        creator_review_complete: true,
        peer_review_complete: false,
        final_release_review_complete: false,
        qa_fail_count: 1,
        first_pass_approved: false,
        internal_notes: "Keep the varsity and JV packets separate for release.",
        production_notes: "Coach proof still outstanding.",
        post_shoot_eval_summary: "Late roster change added 12 replacement files.",
        risk_flag: true,
        legacy_source_reference: "legacy-shoot-901",
        hold_reason: null,
        hold_owner_user_id: null,
        hold_owner_name: null,
        hold_review_at: null,
        merged_into_production_item_id: null,
        linked_shoot_ids: ["shoot-sports-1"],
        days_since_shoot: 2,
        days_open: 3,
        days_to_due: 1,
        days_past_due: null,
        stage_age: 2,
        turnaround_days: null,
        on_time_flag: null,
        open_blocker_count: 1,
        overdue_flag: true,
        checklist_total_count: 3,
        checklist_overdue_count: 1,
        checklist_awaiting_approval_count: 1,
        checklist_rejected_count: 0,
        checklist_blocked_count: 1,
        checklist_missing_proof_count: 1,
        blocking_checklist_instance_id: "checklist-prod-1",
        blocking_checklist_title: "Peer Review Sign-Off",
        release_lag_days: null,
        created_at: "2026-04-01T12:00:00.000Z",
        updated_at: "2026-04-01T12:00:00.000Z"
      }
    ],
    production_item_shoot_links: [
      {
        id: "prod-shoot-link-1",
        tenant_id: "tenant-demo",
        production_item_id: "prod-1",
        shoot_id: "shoot-sports-1",
        created_at: "2026-04-01T12:00:00.000Z"
      }
    ],
    production_handoffs: [
      {
        id: "handoff-1",
        tenant_id: "tenant-demo",
        production_item_id: "prod-1",
        handoff_type: "stage_handoff",
        from_stage: "editing",
        to_stage: "proofing",
        from_user_id: "owner-1",
        from_user_name: "Alex Owner",
        to_user_id: "user-sports",
        to_user_name: "Sports Manager",
        status: "completed",
        note: "Proof build handed off for client review.",
        completed_at: "2026-04-01T16:00:00.000Z",
        created_at: "2026-04-01T15:30:00.000Z"
      }
    ],
    approval_requests: [
      {
        id: "approval-1",
        tenant_id: "tenant-demo",
        production_item_id: "prod-1",
        job_id: "job-sports-1",
        job_day_id: null,
        approval_type: "coach_proof_approval",
        approver_contact_id: "contact-approval",
        approver_contact_name: "Morgan Approval",
        approver_user_id: null,
        approver_user_name: null,
        status: "overdue",
        requested_at: "2026-08-21T12:00:00.000Z",
        viewed_at: null,
        approved_at: null,
        rejected_at: null,
        revision_requested_at: null,
        due_at: "2026-08-23T17:00:00.000Z",
        last_follow_up_at: "2026-08-23T12:00:00.000Z",
        revision_count: 1,
        summary: "Coach proof signoff pending.",
        notes: null,
        created_at: "2026-08-21T12:00:00.000Z",
        updated_at: "2026-08-23T12:00:00.000Z"
      }
    ],
    qa_reviews: [
      {
        id: "qa-creator-1",
        tenant_id: "tenant-demo",
        production_item_id: "prod-1",
        job_id: "job-sports-1",
        review_type: "creator_review",
        review_stage: "creator_review",
        reviewer_user_id: "owner-1",
        reviewer_name: "Alex Owner",
        requested_by_user_id: "owner-1",
        requested_by_name: "Alex Owner",
        status: "passed",
        decision: "approve",
        reviewed_at: "2026-08-22T09:45:00.000Z",
        sample_size_percent: 30,
        checklist_template_key: "team_grouping_correctness",
        question_answers_json: {
          files_complete_storage: true,
          color_density_consistency: true,
          sorting_and_roster_accuracy: true,
          template_price_release_accuracy: true,
          next_stage_decision: "approve"
        },
        notes: "Creator review complete and ready for peer review.",
        decision_reason: null,
        issue_category: null,
        rework_required: false,
        sent_back_to_user_id: null,
        sent_back_to_name: null,
        override_same_reviewer: false,
        override_reason: null,
        original_owner_user_id: "owner-1",
        original_owner_name: "Alex Owner",
        accountability_stage_key: null,
        accountable_owner_user_id: null,
        accountable_owner_name: null,
        accountable_reviewer_user_id: null,
        accountable_reviewer_name: null,
        created_at: "2026-08-22T09:15:00.000Z",
        updated_at: "2026-08-22T09:45:00.000Z"
      },
      {
        id: "qa-1",
        tenant_id: "tenant-demo",
        production_item_id: "prod-1",
        job_id: "job-sports-1",
        review_type: "peer_review",
        review_stage: "peer_review",
        reviewer_user_id: "user-sports",
        reviewer_name: "Sports Manager",
        requested_by_user_id: "user-sports",
        requested_by_name: "Sports Manager",
        status: "failed",
        decision: "send_back",
        reviewed_at: "2026-08-22T10:30:00.000Z",
        sample_size_percent: 10,
        checklist_template_key: "team_grouping_correctness",
        question_answers_json: {
          files_complete_storage: true,
          color_density_consistency: true,
          sorting_and_roster_accuracy: false,
          template_price_release_accuracy: true,
          next_stage_decision: "send_back"
        },
        notes: "Team grouping needs cleanup.",
        decision_reason: "Team grouping needs cleanup before upload.",
        issue_category: "sorting_roster",
        rework_required: true,
        sent_back_to_user_id: "owner-1",
        sent_back_to_name: "Alex Owner",
        override_same_reviewer: false,
        override_reason: null,
        original_owner_user_id: "owner-1",
        original_owner_name: "Alex Owner",
        accountability_stage_key: null,
        accountable_owner_user_id: null,
        accountable_owner_name: null,
        accountable_reviewer_user_id: null,
        accountable_reviewer_name: null,
        created_at: "2026-08-22T10:00:00.000Z",
        updated_at: "2026-08-22T10:30:00.000Z"
      }
    ],
    qa_findings: [
      {
        id: "finding-1",
        qa_review_record_id: "qa-1",
        finding_type: "grouping",
        severity: "high",
        title: "Team grouping mismatch",
        description: "JV and Varsity assets are still mixed.",
        is_blocking: true,
        resolved_at: null,
        resolved_by_user_id: null,
        resolved_by_name: null,
        created_at: "2026-08-22T10:20:00.000Z"
      }
    ],
    deliverable_items: [
      {
        id: "deliverable-1",
        tenant_id: "tenant-demo",
        production_item_id: "prod-1",
        deliverable_type: "proof_packet_delivered",
        title: "Varsity proof packet",
        quantity: 1,
        delivery_method: "digital",
        status: "sent",
        vendor_name: null,
        tracking_reference: "proof-link-1",
        delivered_at: null,
        recipient_contact_id: "contact-approval",
        recipient_contact_name: "Morgan Approval",
        recipient_organization_id: "org-sports",
        recipient_organization_name: "Metro Football Club",
        notes: "Shared via proof portal.",
        created_at: "2026-08-22T11:00:00.000Z",
        updated_at: "2026-08-22T11:00:00.000Z"
      }
    ],
    production_blockers: [
      {
        id: "blocker-1",
        production_item_id: "prod-1",
        job_id: "job-sports-1",
        issue_type: "approval_delay",
        severity: "high",
        title: "Coach approval delayed",
        description: "Approval window slipped past SLA.",
        status: "open",
        owner_user_id: "user-sports",
        owner_name: "Sports Manager",
        due_at: "2026-08-24T17:00:00.000Z",
        resolved_at: null,
        resolved_by_user_id: null,
        resolved_by_name: null,
        created_at: "2026-08-23T18:00:00.000Z",
        updated_at: "2026-08-23T18:00:00.000Z"
      }
    ],
    production_issues: [
      {
        id: "issue-1",
        production_item_id: "prod-1",
        job_id: "job-sports-1",
        issue_type: "approval_delay",
        severity: "high",
        title: "Coach approval delayed",
        description: "Approval window slipped past SLA.",
        status: "open",
        owner_user_id: "user-sports",
        owner_name: "Sports Manager",
        due_at: "2026-08-24T17:00:00.000Z",
        resolved_at: null,
        resolved_by_user_id: null,
        resolved_by_name: null,
        created_at: "2026-08-23T18:00:00.000Z"
      }
    ],
    status: {
      ...buildSportsDetail().status,
      production_status: "blocked",
      risk_status: "high"
    }
  });

  return {
    ...base,
    ...overrides
  } as any;
}

function buildProductionQueuePayload(overrides: Record<string, unknown> = {}) {
  return {
    summary: {
      total_count: 1,
      blocked_count: 1,
      overdue_count: 1,
      awaiting_approval_count: 1,
      qa_pending_count: 1,
      due_today_count: 0
    },
    items: [
      {
        id: "prod-1",
        tenant_id: "tenant-demo",
        job_id: "job-sports-1",
        job_day_id: null,
        production_group_key: "proof-1",
        title: "Varsity Proof Packet",
        job_type: "sports_media_day",
        production_type: "proof_build",
        created_from_source: "published_shoot_default",
        status: "blocked",
        workflow_status: "READY_FOR_QA",
        health_state: "BLOCKED",
        sync_state: "PARTIAL_ERROR",
        priority: "high",
        assigned_to_user_id: "owner-1",
        assigned_to_name: "Alex Owner",
        organization_id: "org-sports",
        job_number: "SPT-2026-0007",
        job_title: "Metro Football Media Day",
        organization_name: "Metro Football Club",
        primary_location_name: "Main Turf",
        primary_contact_name: "Jamie Coach",
        approval_status: "overdue",
        qa_summary_status: "failed",
        deliverable_status: "sent",
        file_receipt_state: "partial_receipt",
        overdue_approval_count: 1,
        open_issue_count: 1,
        blocking_issue_count: 1,
        job_risk_status: "high",
        job_readiness_status: "on_track",
        department_type: "sports",
        location_id: "loc-sports-1",
        location_name: "Main Turf",
        primary_contact_id: "contact-sports-1",
        account_owner_user_id: "owner-1",
        account_owner_name: "Alex Owner",
        department_owner_user_id: "user-sports",
        assigned_peer_reviewer_user_id: "user-sports",
        assigned_peer_reviewer_name: "Sports Manager",
        assigned_release_reviewer_user_id: "owner-1",
        assigned_release_reviewer_name: "Alex Owner",
        escalation_owner_user_id: "user-sports",
        escalation_owner_name: "Sports Manager",
        shoot_date_start: "2026-08-22",
        shoot_date_end: "2026-08-22",
        production_start_at: "2026-08-22T12:30:00.000Z",
        approval_required: true,
        proof_required: true,
        qa_required: true,
        due_at: "2026-08-24T17:00:00.000Z",
        release_due_at: "2026-08-25T17:00:00.000Z",
        delivery_deadline_at: "2026-08-26T17:00:00.000Z",
        completed_at: null,
        closed_at: null,
        readiness_score: 72,
        blocker_count: 1,
        rework_count: 1,
        blocked_reason: "Awaiting coach proof response.",
        file_count_expected: 120,
        file_count_received: 60,
        file_match_status: "PARTIAL",
        roster_received: true,
        naming_verified: true,
        folder_structure_verified: false,
        tags_or_flags_verified: true,
        handoff_complete: true,
        upload_status: "NOT_STARTED",
        release_status: "NOT_STARTED",
        release_target: "proof_portal",
        gallery_or_output_reference: "proof-portal://varsity-packet",
        vendor_name: null,
        vendor_reference: null,
        client_visible_label: "Proof Packet",
        qa_status: "queued",
        creator_review_complete: true,
        peer_review_complete: false,
        final_release_review_complete: false,
        qa_fail_count: 1,
        first_pass_approved: false,
        internal_notes: "Keep the varsity and JV packets separate for release.",
        production_notes: "Coach proof still outstanding.",
        post_shoot_eval_summary: "Late roster change added 12 replacement files.",
        risk_flag: true,
        legacy_source_reference: "legacy-shoot-901",
        hold_reason: null,
        hold_owner_user_id: null,
        hold_owner_name: null,
        hold_review_at: null,
        merged_into_production_item_id: null,
        linked_shoot_ids: ["shoot-sports-1"],
        days_since_shoot: 2,
        days_open: 3,
        days_to_due: 1,
        days_past_due: null,
        stage_age: 2,
        turnaround_days: null,
        on_time_flag: null,
        open_blocker_count: 1,
        overdue_flag: true,
        checklist_total_count: 3,
        checklist_overdue_count: 1,
        checklist_awaiting_approval_count: 1,
        checklist_rejected_count: 0,
        checklist_blocked_count: 1,
        checklist_missing_proof_count: 1,
        blocking_checklist_instance_id: "checklist-prod-1",
        blocking_checklist_title: "Peer Review Sign-Off",
        release_lag_days: null,
        updated_at: "2026-08-23T18:00:00.000Z"
      }
    ],
    ...overrides
  } as any;
}

function buildProductionReportingPayload(overrides: Record<string, unknown> = {}) {
  return {
    generated_at: "2026-04-02T12:00:00.000Z",
    department_type: "sports",
    summary: {
      total_open_items: 6,
      overdue_items: 2,
      blocked_items: 2,
      due_today: 1,
      due_this_week: 4,
      average_turnaround_days: 3.8,
      on_time_release_percentage: 91,
      average_stage_duration_days: 2.6,
      rework_rate: 18,
      first_pass_approval_rate: 82,
      file_mismatch_rate: 12,
      upload_failure_rate: 4,
      vendor_turnaround_days: 5.5,
      completion_volume_this_week: 7,
      ready_for_qa_count: 1,
      ready_for_release_count: 1,
      awaiting_files_count: 1,
      awaiting_upload_count: 1,
      vendor_pending_count: 1
    },
    management: {
      overdue_queue: buildProductionQueuePayload().items,
      blocked_queue: buildProductionQueuePayload().items,
      exception_view: [
        {
          ...buildProductionQueuePayload().items[0],
          exception_types: ["missing_owner", "stalled_stage"]
        }
      ],
      team_workload: [
        {
          owner_user_id: "owner-1",
          owner_name: "Alex Owner",
          open_count: 4,
          blocked_count: 1,
          overdue_count: 1,
          due_this_week_count: 3,
          ready_for_qa_count: 1,
          ready_for_release_count: 1,
          average_stage_age_days: 2.5,
          work_share_percent: 66,
          load_score: 25
        }
      ],
      qa_performance: [
        {
          reviewer_user_id: "reviewer-1",
          reviewer_name: "Jamie Reviewer",
          reviews_completed: 5,
          send_back_count: 1,
          first_pass_approvals: 4,
          accountability_failures: 0,
          average_review_turnaround_days: 0.8
        }
      ]
    },
    insights: {
      backlog_by_owner: [
        {
          owner_user_id: "owner-1",
          owner_name: "Alex Owner",
          open_count: 4,
          blocked_count: 1,
          overdue_count: 1,
          due_this_week_count: 3,
          ready_for_qa_count: 1,
          ready_for_release_count: 1,
          average_stage_age_days: 2.5,
          work_share_percent: 66,
          load_score: 25
        }
      ],
      backlog_by_department: [
        {
          department_type: "sports",
          open_count: 6,
          blocked_count: 2,
          overdue_count: 2,
          due_this_week_count: 4,
          rework_rate: 18,
          on_time_release_percentage: 91
        }
      ],
      qa_failure_categories: [
        {
          category: "sorting_error",
          label: "Sorting Error",
          count: 2
        }
      ],
      operational_burden_by_account: [
        {
          account_owner_user_id: "owner-1",
          account_owner_name: "Alex Owner",
          open_count: 4,
          blocked_count: 1,
          overdue_count: 1,
          at_risk_count: 2,
          burden_score: 18
        }
      ],
      work_concentration_by_person: [
        {
          owner_user_id: "owner-1",
          owner_name: "Alex Owner",
          open_count: 4,
          blocked_count: 1,
          overdue_count: 1,
          due_this_week_count: 3,
          ready_for_qa_count: 1,
          ready_for_release_count: 1,
          average_stage_age_days: 2.5,
          work_share_percent: 66,
          load_score: 25
        }
      ],
      repeat_problem_organizations: [
        {
          organization_id: "org-sports",
          organization_name: "Metro Football Club",
          blocked_count: 1,
          overdue_count: 1,
          rework_count: 2,
          file_mismatch_count: 1,
          issue_count: 2,
          risk_score: 15
        }
      ],
      post_shoot_eval_delay_signals: [
        {
          production_item_id: "prod-1",
          title: "Varsity Proof Packet",
          organization_name: "Metro Football Club",
          workflow_status: "READY_FOR_QA",
          health_state: "BLOCKED",
          delay_days: 3,
          post_shoot_eval_summary: "Late file handoff delayed sorting."
        }
      ],
      top_performers: [
        {
          owner_user_id: "owner-1",
          owner_name: "Alex Owner",
          items_completed: 8,
          on_time_release_percentage: 92,
          first_pass_approval_rate: 88,
          average_turnaround_days: 3.1,
          qa_fail_rate: 10,
          performance_score: 89
        }
      ]
    },
    trends: {
      by_day: [
        {
          key: "2026-03-31",
          label: "03-31",
          starts_at: "2026-03-31T00:00:00.000Z",
          ends_before: "2026-04-01T00:00:00.000Z",
          completions: 1,
          releases: 1,
          overdue: 0,
          blocked: 1,
          rework: 0
        }
      ],
      by_week: [
        {
          key: "week_2026-03-24",
          label: "03-24-03-30",
          starts_at: "2026-03-24T00:00:00.000Z",
          ends_before: "2026-03-31T00:00:00.000Z",
          completions: 6,
          releases: 5,
          overdue: 1,
          blocked: 2,
          rework: 1
        }
      ]
    },
    urgent_watch: {
      total_count: 3,
      critical_count: 1,
      high_count: 1,
      blocked_count: 2,
      overdue_count: 1,
      next_24_hours_count: 2
    },
    restricted_overlays: null,
    ...overrides
  } as any;
}

function getControlWithinLabel(text: string, selector: "input" | "select" | "textarea") {
  const labelNode = screen
    .getAllByText((content, node) => node?.textContent?.replace(/\*/g, "").trim() === text)
    .find((node) => node.closest("label")?.querySelector(selector));
  if (!labelNode) {
    throw new Error(`No label container found for ${text}`);
  }
  const field = labelNode.closest("label");
  if (!field) {
    throw new Error(`No label container found for ${text}`);
  }
  const control = field.querySelector(selector);
  if (!control) {
    throw new Error(`No ${selector} found for ${text}`);
  }
  return control as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
}

function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

describe("shared job pages", () => {
beforeEach(() => {
    window.location.hash = "#jobs";
    window.localStorage.clear();
    vi.restoreAllMocks();

    listSharedJobsMock.mockReset();
    listSharedPrepReadinessQueueMock.mockReset();
    getSharedJobDetailMock.mockReset();
    createSharedJobDraftMock.mockReset();
    updateSharedJobDraftMock.mockReset();
    updateSharedPublishedJobMock.mockReset();
    publishSharedJobMock.mockReset();
    archiveSharedJobMock.mockReset();
    cancelSharedJobMock.mockReset();
    postponeSharedJobMock.mockReset();
    markSharedJobDayReadyMock.mockReset();
    completeSharedReadinessItemMock.mockReset();
    updateSharedReadinessItemMock.mockReset();
    addSharedJobStaffAssignmentMock.mockReset();
    checkInSharedJobStaffMock.mockReset();
    updateSharedJobStaffAssignmentMock.mockReset();
    updateSharedJobDayMock.mockReset();
    addSharedJobDayNoteMock.mockReset();
    createOrResolveSharedJobWatchFlagMock.mockReset();
    listSharedProductionQueueMock.mockReset();
    getSharedProductionReportingMock.mockReset();
    createOrUpdateSharedProductionItemMock.mockReset();
    createOrUpdateSharedProductionHandoffMock.mockReset();
    createOrUpdateSharedApprovalRequestMock.mockReset();
    createOrUpdateSharedQaReviewMock.mockReset();
    createOrUpdateSharedQaFindingMock.mockReset();
    createOrUpdateSharedDeliverableItemMock.mockReset();
    createOrUpdateSharedProductionIssueMock.mockReset();
    getProjectWorkflowCommandCenterMock.mockReset();
    getProjectWorkflowInstanceMock.mockReset();
    instantiateProjectWorkflowMock.mockReset();
    listProjectWorkflowTemplatesMock.mockReset();
    listRecordResourcesMock.mockReset();
    getOperationalApprovalSourceSummaryMock.mockReset();
    createOperationalApprovalRequestMock.mockReset();
    listDirectoryOwnerOptionsMock.mockReset();
    listOrganizationsMock.mockReset();
    listDirectoryLocationsMock.mockReset();
    listDirectoryContactsMock.mockReset();

    listDirectoryOwnerOptionsMock.mockResolvedValue(ownerOptions);
    listOrganizationsMock.mockResolvedValue({ organizations: [schoolOrganization, sportsOrganization] });
    listDirectoryLocationsMock.mockResolvedValue({ locations: [schoolLocation, sportsLocation] });
    listDirectoryContactsMock.mockResolvedValue({ contacts: [] });
    listRecordResourcesMock.mockResolvedValue({
      object: { object_type: "job", object_id: "job-1", label: "Job" },
      access: { can_view: true, can_manage: false },
      summary: { total_items: 0, uploaded_file_count: 0, external_link_count: 0 },
      items: []
    });
    getOperationalApprovalSourceSummaryMock.mockResolvedValue({
      source_module: "jobs",
      source_entity_type: "job",
      source_entity_id: "job-1",
      open_count: 0,
      blocking_open_count: 0,
      overdue_count: 0,
      escalated_count: 0,
      items: []
    });
    createOperationalApprovalRequestMock.mockResolvedValue({
      id: "approval-new",
      request_type: "policy_exception_approval",
      request_type_label: "Policy Exception",
      status: "pending",
      status_label: "Pending"
    });
    createSharedJobDraftMock.mockResolvedValue({ job: { id: "job-created-1" } });
    updateSharedJobDraftMock.mockResolvedValue({ job: { id: "job-created-1" } });
    updateSharedPublishedJobMock.mockResolvedValue({ job: { id: "job-created-1" } });
    publishSharedJobMock.mockResolvedValue({ job: { id: "job-created-1" } });
    archiveSharedJobMock.mockResolvedValue({});
    cancelSharedJobMock.mockResolvedValue({});
    postponeSharedJobMock.mockResolvedValue({});
    markSharedJobDayReadyMock.mockResolvedValue({});
    completeSharedReadinessItemMock.mockResolvedValue({});
    updateSharedReadinessItemMock.mockResolvedValue({});
    addSharedJobStaffAssignmentMock.mockResolvedValue({});
    checkInSharedJobStaffMock.mockResolvedValue({});
    updateSharedJobStaffAssignmentMock.mockResolvedValue({});
    updateSharedJobDayMock.mockResolvedValue({});
    addSharedJobDayNoteMock.mockResolvedValue({});
    createOrResolveSharedJobWatchFlagMock.mockResolvedValue({});
    listSharedPrepReadinessQueueMock.mockResolvedValue({
      generated_at: "2026-05-21T12:00:00.000Z",
      preview_only: true,
      summary: {
        total_count: 0,
        ready_count: 0,
        needs_review_count: 0,
        blocked_count: 0,
        missing_location_count: 0,
        missing_prep_recipient_count: 0,
        missing_sms_eligibility_count: 0
      },
      items: []
    });
    listSharedProductionQueueMock.mockResolvedValue({ items: [], summary: { total_count: 0, blocked_count: 0, overdue_count: 0, awaiting_approval_count: 0, qa_pending_count: 0, due_today_count: 0 } });
    getSharedProductionReportingMock.mockResolvedValue(buildProductionReportingPayload());
    createOrUpdateSharedProductionItemMock.mockResolvedValue({});
    createOrUpdateSharedProductionHandoffMock.mockResolvedValue({});
    createOrUpdateSharedApprovalRequestMock.mockResolvedValue({});
    createOrUpdateSharedQaReviewMock.mockResolvedValue({});
    createOrUpdateSharedQaFindingMock.mockResolvedValue({});
    createOrUpdateSharedDeliverableItemMock.mockResolvedValue({});
    createOrUpdateSharedProductionIssueMock.mockResolvedValue({});
    getProjectWorkflowCommandCenterMock.mockResolvedValue(buildProjectWorkflowCommandCenter());
    getProjectWorkflowInstanceMock.mockResolvedValue(buildProjectWorkflowInstance());
    instantiateProjectWorkflowMock.mockResolvedValue({ workflow_run: { id: "workflow-new" } });
    listProjectWorkflowTemplatesMock.mockResolvedValue({ templates: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the prep readiness queue with missing-data filters and fix links", async () => {
    listSharedPrepReadinessQueueMock.mockResolvedValueOnce({
      generated_at: "2026-05-21T12:00:00.000Z",
      preview_only: true,
      summary: {
        total_count: 3,
        ready_count: 1,
        needs_review_count: 1,
        blocked_count: 1,
        missing_location_count: 1,
        missing_prep_recipient_count: 1,
        missing_sms_eligibility_count: 1
      },
      items: [
        {
          job_id: "job-blocked",
          job_number: "SCH-2026-0008",
          organization_id: "org-lakeview",
          organization_name: "Lakeview Elementary",
          job_name: "Lakeview Retake Day",
          job_date: "2026-09-12",
          department_type: "schools",
          job_category: "photo_day",
          readiness_status: "blocked",
          warnings: [
            {
              code: "missing_primary_location",
              severity: "blocker",
              label: "No primary location",
              detail: "Add a primary job location before prep messages can be trusted."
            }
          ],
          issue_codes: ["missing_location", "message_preview_blocked"],
          primary_location_status: "missing",
          prep_email_recipient_status: "ready",
          sms_readiness_status: "not_ready",
          message_preview_status: "blocked",
          job_command_center_href: "#jobs/job-blocked",
          client_command_center_href: "#client-command-center/accounts/org-lakeview"
        },
        {
          job_id: "job-needs-review",
          job_number: "SCH-2026-0009",
          organization_id: "org-oak",
          organization_name: "Oak Ridge Elementary",
          job_name: "Oak Ridge Picture Day",
          job_date: "2026-09-18",
          department_type: "schools",
          job_category: "photo_day",
          readiness_status: "needs_attention",
          warnings: [
            {
              code: "sms_consent_unknown",
              severity: "warning",
              label: "SMS consent unknown",
              detail: "A prep recipient cannot receive SMS until consent is confirmed."
            }
          ],
          issue_codes: ["missing_sms_eligibility"],
          primary_location_status: "ready",
          prep_email_recipient_status: "ready",
          sms_readiness_status: "not_ready",
          message_preview_status: "needs_review",
          job_command_center_href: "#jobs/job-needs-review",
          client_command_center_href: "#client-command-center/accounts/org-oak"
        },
        {
          job_id: "job-ready",
          job_number: "SPT-2026-0010",
          organization_id: "org-metro",
          organization_name: "Metro Athletics",
          job_name: "Metro Media Day",
          job_date: "2026-09-20",
          department_type: "sports",
          job_category: "media_day",
          readiness_status: "ready",
          warnings: [],
          issue_codes: [],
          primary_location_status: "ready",
          prep_email_recipient_status: "ready",
          sms_readiness_status: "ready",
          message_preview_status: "ready",
          job_command_center_href: "#jobs/job-ready",
          client_command_center_href: "#client-command-center/accounts/org-metro"
        }
      ]
    });

    render(<PrepReadinessQueuePage token="token-demo" currentUser={schoolsManager} />);

    expect(await screen.findByRole("heading", { name: "Prep Readiness Queue" })).toBeInTheDocument();
    expect(screen.getByText("Lakeview Elementary")).toBeInTheDocument();
    expect(screen.getByText("No primary location")).toBeInTheDocument();
    expect(screen.getByText("SMS consent unknown")).toBeInTheDocument();

    const blockedRow = screen.getByText("Lakeview Retake Day").closest("article");
    expect(blockedRow).not.toBeNull();
    expect(within(blockedRow as HTMLElement).getByRole("link", { name: "Open Job" })).toHaveAttribute("href", "#jobs/job-blocked");
    expect(within(blockedRow as HTMLElement).getByRole("link", { name: "Fix Client Data" })).toHaveAttribute(
      "href",
      "#client-command-center/accounts/org-lakeview"
    );

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "blocked" } });
    await waitFor(() => {
      expect(listSharedPrepReadinessQueueMock).toHaveBeenLastCalledWith(
        "token-demo",
        expect.objectContaining({ status: "blocked", issue: "all", department_type: "all" })
      );
    });

    fireEvent.change(screen.getByLabelText("Missing data"), { target: { value: "missing_location" } });
    await waitFor(() => {
      expect(listSharedPrepReadinessQueueMock).toHaveBeenLastCalledWith(
        "token-demo",
        expect.objectContaining({ status: "blocked", issue: "missing_location", department_type: "all" })
      );
    });
  });

  it("renders department-specific list adapters through the shared list shell", async () => {
    listSharedJobsMock.mockResolvedValueOnce({ jobs: [buildJobListItem({})] });
    render(<SharedJobsPage token="token-demo" currentUser={schoolsManager} departmentType="schools" routeBase="#schools/jobs" />);

    expect(await screen.findByRole("heading", { name: "School Jobs" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "District" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Yearbook" })).toBeInTheDocument();

    cleanup();

    listSharedJobsMock.mockResolvedValueOnce({
      jobs: [
        buildJobListItem({
          department_type: "sports",
          job_number: "SPT-2026-0012",
          title: "Metro Football Media Day",
          organization_id: "org-sports",
          organization_name: "Metro Football Club",
          school_profile: null,
          sports_profile: {
            sport_type: "football",
            season: "fall",
            proof_required: true,
            banner_work_required: true,
            revenue_share_enabled: true,
            estimated_team_count: 6
          }
        })
      ]
    });

    render(<SharedJobsPage token="token-demo" currentUser={sportsManager} departmentType="sports" routeBase="#sports/shoots" />);

    expect(await screen.findByRole("heading", { name: "Sports Shoots" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Sport" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Proof" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Teams" })).toBeInTheDocument();
  });

  it("renders the top-level Jobs route as a searchable paginated database", async () => {
    const databaseJobs = Array.from({ length: 30 }, (_, index) => {
      const oneBasedIndex = index + 1;
      const isSports = index % 2 === 1;
      const schoolProfile = {
        ...buildJobListItem({}).school_profile,
        roster_source: index === 0 ? null : "sis_export"
      };
      const sportsProfile = {
        job_id: `job-database-${oneBasedIndex}`,
        tenant_id: "tenant-demo",
        sport_type: "football",
        season: "fall",
        league_name: index === 1 ? "Metro League" : "Metro Athletics",
        division: "Varsity",
        team_structure: "scheduled_slots",
        estimated_team_count: 6,
        proof_required: true,
        approval_contact_id: "contact-approval",
        approval_contact_name: "Morgan Approval",
        billing_contact_id: "contact-billing",
        billing_contact_name: "Taylor Billing",
        revenue_share_enabled: true,
        revenue_share_terms_summary: "15% after approvals",
        banner_work_required: true,
        specialty_products_required: true,
        buddy_photos_required: false,
        sponsor_graphics_required: true,
        client_expectations_notes: "Sponsor banner proofs due first."
      };
      return buildJobListItem({
        id: `job-database-${oneBasedIndex}`,
        job_number: `${isSports ? "SPT" : "SCH"}-2026-${String(oneBasedIndex).padStart(4, "0")}`,
        department_type: isSports ? "sports" : "schools",
        title: `${isSports ? "Metro Athletics" : "North High"} Database Job ${oneBasedIndex}`,
        organization_id: isSports ? "org-sports" : "org-school",
        organization_name: isSports ? "Metro Athletics" : "North High",
        job_category: isSports ? "media_day" : "photo_day",
        job_status: index % 3 === 0 ? "confirmed" : "planning",
        production_status: index === 2 ? "awaiting_approval" : isSports ? "proof_build" : "queued",
        proof_status: index === 2 ? "awaiting_approval" : isSports ? "proof_build" : null,
        staffing_status: index === 1 ? "gap_flagged" : "staffed",
        risk_status: index % 5 === 0 ? "high" : "low",
        readiness_status: index === 0 ? "off_track" : index % 5 === 0 ? "at_risk" : "on_track",
        lead_owner_user_id: isSports ? "lead-sports" : "lead-schools",
        lead_owner_name: isSports ? "Sports Lead" : "Schools Lead",
        blocker_count: index === 0 || index === 1 ? 1 : 0,
        school_profile: isSports ? null : schoolProfile,
        sports_profile: isSports ? sportsProfile : null
      });
    });
    listSharedJobsMock.mockResolvedValueOnce({ jobs: databaseJobs });

    render(<SharedJobsPage token="token-demo" currentUser={sportsCoordinator} departmentType={null} routeBase="#jobs" />);

    expect(await screen.findByRole("heading", { name: "Jobs" })).toBeInTheDocument();
    expect(screen.getByText("Find active jobs, review missing info, and start new job intake.")).toBeInTheDocument();
    expect(screen.queryByText("Jobs Database")).not.toBeInTheDocument();
    expect(screen.queryByText("Quick Access")).not.toBeInTheDocument();
    expect(screen.queryAllByText(/^Jobs$/).length).toBeLessThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Start New Job" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save current view/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pin default/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rename/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/work spine|read model|command layer|database surface|job truth layer|current view/i)).not.toBeInTheDocument();

    expect(screen.getByLabelText("Search Jobs")).toHaveAttribute("placeholder", "Search by job, organization, job type, owner, or stage...");
    expect(screen.getByLabelText("Department")).toBeInTheDocument();
    expect(screen.getByLabelText("Stage")).toBeInTheDocument();
    expect(screen.getByLabelText("Calendar readiness")).toBeInTheDocument();
    expect(screen.getByLabelText("Blocked / Missing info")).toBeInTheDocument();
    expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Job Type")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Date Range")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Owner")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Production Status")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Gallery and Release Status")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Job management summary")).toBeInTheDocument();
    expect(screen.getByText("Job Snapshot")).toBeInTheDocument();
    expect(screen.getByText("Intake Review Queue")).toBeInTheDocument();
    expect(screen.getAllByText("Waiting on client").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Waiting internal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ready for calendar").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Calendar confirmed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Confirm details").length).toBeGreaterThan(0);
    expect(screen.getByText("Request missing info")).toBeInTheDocument();
    expect(screen.getByText("Follow up")).toBeInTheDocument();
    expect(screen.getByText("Assign owner")).toBeInTheDocument();
    expect(screen.getByText("Prepare handoff")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Job" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Organization" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Date" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Calendar Readiness" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Details Confirmation" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Missing Info" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Department" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Stage" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Lead Owner" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Next Step" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Needs Attention" })).toBeInTheDocument();
    expect(screen.getByLabelText("Jobs per page")).toHaveValue("25");
    expect(screen.getByText("Showing 1-25 of 30 jobs")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(26);
    expect(screen.getAllByText("North High Database Job 1").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Open job" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Missing roster").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Client approval needed").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Missing info checklist preview")).toBeInTheDocument();
    expect(screen.getAllByText(/Owner: Schools/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Date conflict").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Needs details|Partial|Confirm|Confirmed|Reconfirm/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Resolve readiness").length).toBeGreaterThan(0);
    expect(screen.queryByText("Metro Athletics Database Job 30")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search Jobs"), { target: { value: "Metro Athletics" } });

    await waitFor(() => expect(screen.getByText("Showing 1-15 of 15 jobs")).toBeInTheDocument());
    expect(screen.queryByText("North High Database Job 1")).not.toBeInTheDocument();
    expect(screen.getAllByText("Metro Athletics Database Job 2").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Search Jobs"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "stage:Blocked" } });
    await waitFor(() => expect(screen.getByText(/Showing 1-/)).toBeInTheDocument());
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
  });

  it("renders the shared editor with school adapter sections", async () => {
    window.location.hash = "#schools/jobs/new";
    render(<SharedJobEditorPage token="token-demo" currentUser={schoolsManager} departmentType="schools" routeBase="#schools/jobs" mode="create" />);

    expect(await screen.findByRole("heading", { name: "New School Job" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "School Data" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Deliverables" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "School Operations" }).length).toBeGreaterThan(0);
  });

  it("renders the shared editor with sports adapter validation and shared blockers", async () => {
    window.location.hash = "#sports/shoots/new";
    render(<SharedJobEditorPage token="token-demo" currentUser={sportsManager} departmentType="sports" routeBase="#sports/shoots" mode="create" />);

    expect(await screen.findByRole("heading", { name: "New Sports Job" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    expect((await screen.findAllByText("Choose an organization.")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Choose a primary location or add an override note.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sport type is required.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Proof-required sports jobs need an approval owner.").length).toBeGreaterThan(0);
  });

  it("renders the global New Job Intake route with clean V2 intake fields", async () => {
    window.location.hash = "#jobs/new";
    const { container } = render(<SharedJobEditorPage token="token-demo" currentUser={sportsManager} departmentType={null} routeBase="#jobs" mode="create" />);

    expect(await screen.findByRole("heading", { name: "Job Basics" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "New Job Intake" })).not.toBeInTheDocument();
    expect(screen.queryByText("Start with the basics. Choose the job type, then Mission Control will help identify missing info and next steps.")).not.toBeInTheDocument();
    expect(container.querySelector(".shared-job-shell--clean-intake")).toBeInTheDocument();
    expect(container.querySelector(".shared-job-shell__form-layout--single")).toBeInTheDocument();
    expect(container.querySelector(".shared-job-shell__clean-intake-actions")).not.toBeInTheDocument();
    expect(container.querySelector(".workspace-page-header")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Workspace status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "What happens after submit" })).not.toBeInTheDocument();
    expect(screen.queryByText("Handoff Plan")).not.toBeInTheDocument();
    expect(screen.queryByText("Ownership")).not.toBeInTheDocument();
    expect(screen.queryByText("Current team")).not.toBeInTheDocument();
    expect(screen.queryByText("Current intake")).not.toBeInTheDocument();
    expect(screen.queryByText("Current owner")).not.toBeInTheDocument();
    expect(screen.queryByText("Waiting on")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Work Packages")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Intake readiness")).not.toBeInTheDocument();
    expect(screen.queryByText("Review and Next Steps")).not.toBeInTheDocument();
    expect(screen.queryByText("Department Handoff Plan")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Notification Signals")).not.toBeInTheDocument();
    expect(screen.queryByText("Assignment Needed")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mission Control will prepare" })).toBeInTheDocument();
    expect(screen.getByText("Workflow: School Picture Day")).toBeInTheDocument();
    expect(screen.getByText("Selected automatically from Job Type.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Change workflow" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Work area")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Job type")).toBeInTheDocument();
    const jobTypeSelect = getControlWithinLabel("Job type", "select");
    expect(screen.getByRole("option", { name: "School Picture Day" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Sports Picture Day" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Graduation" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Retake / Makeup Day" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Yearbook" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Cap & Gown" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "In-Studio Work" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Event" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Other" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Specialty" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Sports League" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Team Photos" })).not.toBeInTheDocument();

    expect(screen.getByLabelText("Job Name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Event Name")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toBeInTheDocument();
    expect(screen.getByLabelText("Alternate date")).toBeInTheDocument();
    expect(screen.getByLabelText("Setup time")).toBeInTheDocument();
    expect(screen.getByLabelText("Photography start time")).toBeInTheDocument();
    expect(screen.getByLabelText("Expected end time")).toBeInTheDocument();
    expect(getControlWithinLabel("Photographers", "input")).toBeInTheDocument();
    expect(getControlWithinLabel("Photo assistants", "input")).toBeInTheDocument();
    expect(screen.getByLabelText("Organization-provided assistance?")).toBeInTheDocument();
    fireEvent.change(getControlWithinLabel("Photographers", "input"), { target: { value: "3" } });
    fireEvent.change(getControlWithinLabel("Photo assistants", "input"), { target: { value: "1" } });
    expect(getControlWithinLabel("Photographers", "input")).toHaveValue(3);
    expect(getControlWithinLabel("Photo assistants", "input")).toHaveValue(1);
    fireEvent.click(screen.getByLabelText("Organization-provided assistance?"));
    expect(screen.getByLabelText("What help will the organization provide?")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Location & Shoot Details" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Calendar readiness")).toBeInTheDocument();
    expect(screen.getAllByText("Needs date").length).toBeGreaterThan(0);
    expect(screen.getByText(/Next: Set the requested shoot date\./)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Organization and Contact" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Starting team")).not.toBeInTheDocument();
    expect(screen.queryByText("Unresolved organization placeholder")).not.toBeInTheDocument();
    expect(screen.queryByText("Organization not selected yet")).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+ matching organization/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /North High/i })).not.toBeInTheDocument();
    fireEvent.change(jobTypeSelect, { target: { value: "school_picture_day" } });
    expect(getControlWithinLabel("District", "input")).toBeInTheDocument();
    expect(screen.queryByLabelText("School")).not.toBeInTheDocument();
    expect(screen.getByText("Select a saved district to see its schools.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Association / Organization")).not.toBeInTheDocument();
    const organizationInput = screen.getByPlaceholderText("Search districts");
    fireEvent.change(organizationInput, { target: { value: "zzzz" } });
    expect(await screen.findByText("No matching district found. Choose a saved district, or ask a director/admin to add this to Directory.")).toBeInTheDocument();
    expect(screen.getByText("Select a saved district to see its schools.")).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ matching organization/)).not.toBeInTheDocument();
    fireEvent.change(organizationInput, { target: { value: "North" } });
    expect(await screen.findByRole("button", { name: /North High.*3 contacts.*2 locations/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("School")).not.toBeInTheDocument();
    expect(screen.getByText("Select a saved district to see its schools.")).toBeInTheDocument();
    expect(screen.queryByText("No matching district found. Choose a saved district, or ask a director/admin to add this to Directory.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /North High.*3 contacts.*2 locations/i }));
    expect(organizationInput).toHaveValue("North High");
    expect(screen.queryByRole("button", { name: /North High.*3 contacts.*2 locations/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Select a saved district to see its schools.")).not.toBeInTheDocument();
    expect(screen.queryByText("schools underclass portraits")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Location & Shoot Details" })).not.toBeInTheDocument();
    const schoolInput = screen.getByPlaceholderText("Search schools or sites");
    fireEvent.change(schoolInput, { target: { value: "Metro" } });
    expect(await screen.findByText("This school is not in Directory yet. Mission Control can flag it for Directory review.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Metro Field House/i })).not.toBeInTheDocument();
    fireEvent.change(schoolInput, { target: { value: "Gym" } });
    fireEvent.click(await screen.findByRole("button", { name: /North High Main Gym/i }));
    expect(schoolInput).toHaveValue("North High Main Gym");
    expect(screen.getByRole("button", { name: "District-level job / no single school" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Job Needs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Prep Details" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Staffing & Prep" })).not.toBeInTheDocument();
    expect(screen.queryByText("Photographers needed")).not.toBeInTheDocument();
    expect(screen.queryByText("Assistants needed")).not.toBeInTheDocument();
    expect(getControlWithinLabel("Roster or team list source", "input")).toBeInTheDocument();
    expect(getControlWithinLabel("Teams, classes, or groups", "input")).toBeInTheDocument();
    expect(screen.queryByLabelText("Indoor / Outdoor")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tethered / Untethered")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Rain location?")).not.toBeInTheDocument();
    expect(getControlWithinLabel("Expected volume", "input")).toBeInTheDocument();
    expect(getControlWithinLabel("Products and services", "select")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Important Notes" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Important notes" })).toBeInTheDocument();
    expect(screen.getByText("Calendar readiness: Needs date")).toBeInTheDocument();
    expect(screen.getByText("Photography checklist")).toBeInTheDocument();
    expect(screen.getByText("Production tasks")).toBeInTheDocument();
    expect(screen.getByText("Client follow-up tasks")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Job Package" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Job" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.queryByText("Access mode")).not.toBeInTheDocument();
    expect(screen.queryByText("Assignment Rules")).not.toBeInTheDocument();
    expect(screen.queryByText("Workflow Route")).not.toBeInTheDocument();
    expect(screen.queryByText("First live summary")).not.toBeInTheDocument();
    expect(screen.queryByText("Live summary")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sports Event Structure" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Day-Level Management" })).not.toBeInTheDocument();
    expect(screen.queryByText("Priority/risk flag")).not.toBeInTheDocument();
    expect(screen.queryByText("Requested products/services")).not.toBeInTheDocument();

    const routeExpectations = [
      { value: "school_picture_day", route: "School Picture Day route", workflow: "School Picture Day" },
      { value: "retake_day", route: "Retake Day route", workflow: "Retake / Makeup Day" },
      { value: "sports_picture_day", route: "Sports Picture Day route", workflow: "Sports Picture Day" },
      { value: "graduation", route: "Graduation route", workflow: "Graduation" },
      { value: "cap_and_gown", route: "Cap & Gown route", workflow: "Cap & Gown" },
      { value: "yearbook", route: "Yearbook route", workflow: "Yearbook" },
      { value: "event", route: "Event route", workflow: "Event" },
      { value: "specialty", route: "In-Studio Work route", workflow: "In-Studio Work" },
      { value: "other", route: "Custom Event route", workflow: "Other" }
    ];

    for (const expectation of routeExpectations) {
      fireEvent.change(jobTypeSelect, { target: { value: expectation.value } });
      expect(jobTypeSelect).toHaveValue(expectation.value);
      await waitFor(() => expect(screen.getByText(new RegExp(expectation.route))).toBeInTheDocument());
      await waitFor(() => expect(screen.getByText(`Workflow: ${expectation.workflow}`)).toBeInTheDocument());
    }

    fireEvent.change(jobTypeSelect, { target: { value: "school_picture_day" } });
    fireEvent.change(screen.getByLabelText("Job Name"), { target: { value: "North High Picture Day" } });
    expect(screen.getByLabelText("Job Name")).toHaveValue("North High Picture Day");
    fireEvent.change(jobTypeSelect, { target: { value: "sports_picture_day" } });
    expect(getControlWithinLabel("Association / Organization", "input")).toBeInTheDocument();
    expect(screen.queryByLabelText("District")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("School")).not.toBeInTheDocument();
    expect(screen.getByText("Workflow: Sports Picture Day")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Job Name"), { target: { value: "Metro Football Photo Day" } });
    expect(screen.getByLabelText("Job Name")).toHaveValue("Metro Football Photo Day");
    expect(screen.getByLabelText("Indoor / Outdoor")).toBeInTheDocument();
    expect(screen.getByLabelText("Tethered / Untethered")).toBeInTheDocument();
    expect(screen.getByLabelText("Rain location?")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Rain location?"));
    expect(screen.getByLabelText("Rain location details")).toBeInTheDocument();
    await waitFor(() => expect(getControlWithinLabel("Products and services", "select")).toHaveValue("mixed"));
  });

  it("blocks unauthorized users from creating global job intake packages", async () => {
    window.location.hash = "#jobs/new";
    render(<SharedJobEditorPage token="token-demo" currentUser={sportsCoordinator} departmentType={null} routeBase="#jobs" mode="create" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You do not have permission to create new jobs. Ask a department director or Mission Control admin to start a job package."
    );
    expect(screen.queryByRole("heading", { name: "Job Basics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Job Package" })).not.toBeInTheDocument();
    expect(createSharedJobDraftMock).not.toHaveBeenCalled();
  });

  it("uses organization typeahead on global intake and saves the selected organization id", async () => {
    window.location.hash = "#jobs/new";
    render(<SharedJobEditorPage token="token-demo" currentUser={sportsManager} departmentType={null} routeBase="#jobs" mode="create" />);

    expect(await screen.findByRole("heading", { name: "Job Basics" })).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ matching organization/)).not.toBeInTheDocument();

    fireEvent.change(getControlWithinLabel("Job type", "select"), { target: { value: "sports_picture_day" } });
    fireEvent.change(screen.getByLabelText("Job Name"), { target: { value: "Metro Athletics Intake" } });
    fireEvent.change(getControlWithinLabel("Photographers", "input"), { target: { value: "3" } });
    fireEvent.change(getControlWithinLabel("Photo assistants", "input"), { target: { value: "2" } });
    fireEvent.change(screen.getByPlaceholderText("Search associations or clubs"), { target: { value: "Athletics" } });
    fireEvent.click(await screen.findByRole("button", { name: /Metro Football Club/i }));

    expect(screen.getByPlaceholderText("Search associations or clubs")).toHaveValue("Metro Football Club");
    expect(screen.queryByRole("button", { name: /Metro Football Club/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(createSharedJobDraftMock).toHaveBeenCalled());
    const payload = createSharedJobDraftMock.mock.calls[0][1];
    expect(payload.organization_id).toBe("org-sports");
    expect(payload.estimated_staff_count).toBe(3);
  });

  it("routes school intake packages with a Schools Director workflow confirmation notice", async () => {
    window.location.hash = "#jobs/new";
    render(<SharedJobEditorPage token="token-demo" currentUser={schoolsManager} departmentType={null} routeBase="#jobs" mode="create" />);

    expect(await screen.findByRole("heading", { name: "Job Basics" })).toBeInTheDocument();
    fireEvent.change(getControlWithinLabel("Job type", "select"), { target: { value: "school_picture_day" } });
    fireEvent.change(screen.getByLabelText("Job Name"), { target: { value: "North High Picture Day" } });
    fireEvent.change(screen.getByPlaceholderText("Search districts"), { target: { value: "North" } });
    fireEvent.click(await screen.findByRole("button", { name: /North High.*3 contacts.*2 locations/i }));
    fireEvent.change(screen.getByPlaceholderText("Search schools or sites"), { target: { value: "Gym" } });
    fireEvent.click(await screen.findByRole("button", { name: /North High Main Gym/i }));
    fireEvent.click(screen.getByRole("button", { name: "Create Job Package" }));

    await waitFor(() => expect(createSharedJobDraftMock).toHaveBeenCalled());
    const payload = createSharedJobDraftMock.mock.calls[0][1];
    expect(payload.organization_id).toBe("org-school");
    expect(payload.primary_location_id).toBe("loc-school");
    expect(payload.school_profile.district_id).toBe("org-school");
    const query = new URLSearchParams(window.location.hash.split("?")[1]);
    expect(window.location.hash).toContain("#jobs/job-created-1?");
    expect(query.get("notice")).toBe("workflow_review");
    expect(query.get("workflowName")).toBe("School Picture Day route");
    expect(query.get("jobType")).toBe("School Picture Day");
    expect(query.get("director")).toBe("Schools Director");
  });

  it("marks unmatched school or location text for Directory review without creating a verified record", async () => {
    window.location.hash = "#jobs/new";
    render(<SharedJobEditorPage token="token-demo" currentUser={schoolsManager} departmentType={null} routeBase="#jobs" mode="create" />);

    expect(await screen.findByRole("heading", { name: "Job Basics" })).toBeInTheDocument();
    fireEvent.change(getControlWithinLabel("Job type", "select"), { target: { value: "school_picture_day" } });
    fireEvent.change(screen.getByLabelText("Job Name"), { target: { value: "Districtwide Senior Day" } });
    fireEvent.change(screen.getByPlaceholderText("Search districts"), { target: { value: "North" } });
    fireEvent.click(await screen.findByRole("button", { name: /North High.*3 contacts.*2 locations/i }));
    fireEvent.change(screen.getByPlaceholderText("Search schools or sites"), { target: { value: "North Annex" } });

    expect(await screen.findByText("This school is not in Directory yet. Mission Control can flag it for Directory review.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Job Package" }));

    await waitFor(() => expect(createSharedJobDraftMock).toHaveBeenCalled());
    const payload = createSharedJobDraftMock.mock.calls[0][1];
    expect(payload.organization_id).toBe("org-school");
    expect(payload.primary_location_id).toBeNull();
    expect(payload.location_override_note).toBe("North Annex");
  });

  it("routes sports intake packages with a Sports Director workflow confirmation notice", async () => {
    window.location.hash = "#jobs/new";
    render(<SharedJobEditorPage token="token-demo" currentUser={sportsManager} departmentType={null} routeBase="#jobs" mode="create" />);

    expect(await screen.findByRole("heading", { name: "Job Basics" })).toBeInTheDocument();
    fireEvent.change(getControlWithinLabel("Job type", "select"), { target: { value: "sports_picture_day" } });
    fireEvent.change(screen.getByLabelText("Job Name"), { target: { value: "Metro Football Photo Day" } });
    fireEvent.change(screen.getByPlaceholderText("Search associations or clubs"), { target: { value: "Athletics" } });
    fireEvent.click(await screen.findByRole("button", { name: /Metro Football Club/i }));
    fireEvent.click(screen.getByRole("button", { name: "Create Job Package" }));

    await waitFor(() => expect(createSharedJobDraftMock).toHaveBeenCalled());
    const query = new URLSearchParams(window.location.hash.split("?")[1]);
    expect(query.get("notice")).toBe("workflow_review");
    expect(query.get("workflowName")).toBe("Sports Picture Day route");
    expect(query.get("jobType")).toBe("Sports Picture Day");
    expect(query.get("director")).toBe("Sports Director");
  });

  it("surfaces the workflow confirmation notice on the destination job detail", async () => {
    window.location.hash = "#jobs/job-created-1?notice=workflow_review&workflowName=School+Picture+Day+route&jobType=School+Picture+Day&director=Schools+Director";
    getSharedJobDetailMock.mockResolvedValue(buildOperationalSchoolDetail());

    render(<SharedJobDetailPage token="token-demo" currentUser={schoolsManager} departmentType="schools" routeBase="#jobs" />);

    expect(await screen.findByText("Review workflow selection for North High Picture Day")).toBeInTheDocument();
    expect(screen.getByText("Mission Control selected School Picture Day route based on School Picture Day. Please confirm the workflow and update it if needed.")).toBeInTheDocument();
    expect(screen.getByText("For: Schools Director")).toBeInTheDocument();
  });

  it("saves school drafts through the shared shell and preserves adapter fields", async () => {
    window.location.hash = "#schools/jobs/new";
    render(<SharedJobEditorPage token="token-demo" currentUser={schoolsManager} departmentType="schools" routeBase="#schools/jobs" mode="create" />);

    fireEvent.change(await screen.findByPlaceholderText("Search canonical organizations"), { target: { value: "North" } });
    fireEvent.click(await screen.findByRole("button", { name: /North High.*3 contacts.*2 locations/i }));
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "North High Fall Picture Day" } });
    fireEvent.change(screen.getByLabelText("School type"), { target: { value: "high_school" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(createSharedJobDraftMock).toHaveBeenCalled());
    const payload = createSharedJobDraftMock.mock.calls[0][1];
    expect(payload.organization_id).toBe("org-school");
    expect(payload.school_profile.school_type).toBe("high_school");
    expect(window.location.hash).toBe("#schools/jobs/job-created-1");
  });

  it("publishes sports jobs through the shared shell and routes to the shared detail wrapper", async () => {
    window.location.hash = "#sports/shoots/new";
    createSharedJobDraftMock.mockResolvedValueOnce({ job: { id: "job-sports-1" } });
    publishSharedJobMock.mockResolvedValueOnce({ job: { id: "job-sports-1" } });

    render(<SharedJobEditorPage token="token-demo" currentUser={sportsManager} departmentType="sports" routeBase="#sports/shoots" mode="create" />);

    fireEvent.change(await screen.findByPlaceholderText("Search canonical organizations"), { target: { value: "Metro" } });
    fireEvent.click(await screen.findByRole("button", { name: /Metro Football Club/i }));
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Metro Football Media Day" } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-08-22" } });
    fireEvent.change(screen.getByLabelText("Unresolved location placeholder"), { target: { value: "Stadium A" } });
    fireEvent.change(screen.getByLabelText("Unresolved primary contact placeholder"), { target: { value: "Jordan Coach" } });
    fireEvent.change(getControlWithinLabel("Account owner", "select"), { target: { value: "owner-1" } });
    fireEvent.change(screen.getByLabelText("Sport type"), { target: { value: "football" } });
    fireEvent.change(screen.getByLabelText("Season"), { target: { value: "fall" } });
    fireEvent.change(screen.getByLabelText("Team structure"), { target: { value: "scheduled_slots" } });
    fireEvent.change(screen.getByLabelText("Approval contact ID"), { target: { value: "contact-approval" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(publishSharedJobMock).toHaveBeenCalledWith("token-demo", "job-sports-1"));
    const payload = createSharedJobDraftMock.mock.calls[0][1];
    expect(payload.sports_profile.sport_type).toBe("football");
    expect(payload.sports_profile.team_structure).toBe("scheduled_slots");
    expect(window.location.hash).toBe("#sports/shoots/job-sports-1");
  });

  it("renders shared and sports adapter detail tabs while hiding finance for disallowed roles", async () => {
    window.location.hash = "#sports/shoots/job-sports-1";
    getSharedJobDetailMock.mockResolvedValue(buildOperationalSportsDetail());

    render(<SharedJobDetailPage token="token-demo" currentUser={sportsCoordinator} departmentType="sports" routeBase="#sports/shoots" />);

    expect(await screen.findByRole("heading", { name: "SPT-2026-0007" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Days" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Readiness" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Staffing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Production" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approvals" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "QA" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deliverables" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Event" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Proofs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Products" })).toBeInTheDocument();
    expect(screen.getAllByText("Published").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Job published").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Job Truth Snapshot" })).toBeInTheDocument();
    const truthSnapshot = within(screen.getByLabelText("Job truth snapshot"));
    expect(truthSnapshot.getByText("Job name")).toBeInTheDocument();
    expect(truthSnapshot.getByText("Organization")).toBeInTheDocument();
    expect(truthSnapshot.getByText("Job type")).toBeInTheDocument();
    expect(truthSnapshot.getByText("Shoot date")).toBeInTheDocument();
    expect(truthSnapshot.getByText("Calendar readiness")).toBeInTheDocument();
    expect(truthSnapshot.getByText("Details confirmation")).toBeInTheDocument();
    expect(truthSnapshot.getByText("Staffing readiness")).toBeInTheDocument();
    expect(truthSnapshot.getByText("Current stage")).toBeInTheDocument();
    expect(truthSnapshot.getByText("Current owner")).toBeInTheDocument();
    expect(truthSnapshot.getByText("Next action")).toBeInTheDocument();
    expect(truthSnapshot.getByText("Blocked status")).toBeInTheDocument();
    expect(truthSnapshot.getByText("Missing info")).toBeInTheDocument();
    expect(truthSnapshot.getByText("Priority")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Job Progress" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Calendar Readiness" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Details Confirmation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm details" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm details" }));
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Confirm details" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Date conflict").length).toBeGreaterThan(0);
    expect(screen.getByText("Next scheduling action: Resolve the schedule, readiness, or blocker signal.")).toBeInTheDocument();
    expect(screen.getByLabelText("Job progress timeline")).toBeInTheDocument();
    expect(screen.getByText("Handoff Plan")).toBeInTheDocument();
    expect(screen.getByText("Ownership")).toBeInTheDocument();
    expect(screen.getAllByText("Current Department").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Department Lead").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Assigned Person").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Assignment Status").length).toBeGreaterThan(0);
    expect(screen.getByText("Current Owner")).toBeInTheDocument();
    expect(screen.getByText("Waiting On")).toBeInTheDocument();
    expect(screen.getByText("Next Department")).toBeInTheDocument();
    expect(screen.getByText("Blocker Status")).toBeInTheDocument();
    expect(screen.getByText("Next Action")).toBeInTheDocument();
    expect(screen.getByLabelText("Work Packages")).toBeInTheDocument();
    expect(screen.getByLabelText("Department task plan")).toBeInTheDocument();
    expect(screen.getByText("Notification Signals")).toBeInTheDocument();
    expect(screen.getByLabelText("Job change notices")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Job Change Notices" })).toBeInTheDocument();
    expect(screen.getByText("Location changed: Maple Grove Baseball Media Day")).toBeInTheDocument();
    expect(screen.getAllByText("Blocker added").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Shoot manager assigned").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Task reassigned").length).toBeGreaterThan(0);
    expect(screen.getByText("Shoot date changed: Maple Grove Baseball Media Day")).toBeInTheDocument();
    expect(screen.getByText("Blocker resolved: parking plan confirmed")).toBeInTheDocument();
    expect(screen.getByText("Shoot manager still needed: Maple Grove Baseball Media Day")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Department Tasks and Work Packages" })).toBeInTheDocument();
    expect(screen.getByLabelText("Department tasks and work packages")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Notes" })).toBeInTheDocument();
    expect(screen.getByLabelText("Job notes")).toBeInTheDocument();
    expect(screen.getByText("Shoot notes")).toBeInTheDocument();
    expect(screen.getByText(/Use east gate/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Prior Job Intelligence" })).toBeInTheDocument();
    expect(screen.getByLabelText("Prior job intelligence")).toBeInTheDocument();
    expect(screen.getByText("Sports flow")).toBeInTheDocument();
    expect(screen.getByText("Separate varsity and JV QR lanes")).toBeInTheDocument();
    expect(screen.getByText("Confirm banner crop before QA")).toBeInTheDocument();
    expect(screen.getByText("Sponsor proofs drive client confidence")).toBeInTheDocument();
    expect(screen.getByText("Stadium A tunnel team-photo reference")).toBeInTheDocument();
    expect(screen.getByText("Job Resources")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent activity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to Jobs" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to Jobs" }));
    expect(window.location.hash).toBe("#sports/shoots");
    expect(screen.queryByRole("button", { name: "Financial" })).not.toBeInTheDocument();

    cleanup();

    window.location.hash = "#sports/shoots/job-sports-1";
    getSharedJobDetailMock.mockResolvedValue(buildSportsDetail());
    render(<SharedJobDetailPage token="token-demo" currentUser={sportsFinanceViewer} departmentType="sports" routeBase="#sports/shoots" />);
    expect(await screen.findByRole("button", { name: "Financial" })).toBeInTheDocument();
  });

  it("surfaces school prior-job intelligence and calm empty memory states on job detail", async () => {
    window.location.hash = "#schools/jobs/job-school-ops";
    getSharedJobDetailMock.mockResolvedValue(buildOperationalSchoolDetail());

    const { unmount } = render(<SharedJobDetailPage token="token-demo" currentUser={schoolsManager} departmentType="schools" routeBase="#schools/jobs" />);

    expect(await screen.findByRole("heading", { name: "SCH-2026-0042" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Prior Job Intelligence" })).toBeInTheDocument();
    expect(screen.getByText("Parking and load-in")).toBeInTheDocument();
    expect(screen.getByText("North High uses the front office entrance")).toBeInTheDocument();
    expect(screen.getByText("Prior-year lesson")).toBeInTheDocument();
    expect(screen.getByText("Run ID card work before lunch")).toBeInTheDocument();
    expect(screen.getByText("Contact preference")).toBeInTheDocument();
    expect(screen.getByText("Main Gym three-station setup")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open related context" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /upload/i })).not.toBeInTheDocument();

    unmount();

    window.location.hash = "#sports/shoots/job-empty";
    getSharedJobDetailMock.mockResolvedValue(
      buildSportsDetail({
        job: buildJobListItem({
          id: "job-empty",
          job_number: "SPT-2026-0999",
          department_type: "sports",
          title: "One-Off Specialty Event",
          event_name: "Specialty Event",
          organization_id: "org-empty",
          organization_name: "New Client",
          primary_location_id: null,
          primary_contact_id: null,
          school_profile: null,
          sports_profile: null
        }),
        summary: {
          ...buildSportsDetail().summary,
          organization_name: "New Client",
          organization_account_type: "events",
          primary_location_name: null,
          primary_contact_name: null
        },
        sports_profile: null
      })
    );

    render(<SharedJobDetailPage token="token-demo" currentUser={sportsCoordinator} departmentType="sports" routeBase="#sports/shoots" />);

    expect(await screen.findByRole("heading", { name: "SPT-2026-0999" })).toBeInTheDocument();
    expect(screen.getByText("No prior notes or resources are linked yet.")).toBeInTheDocument();
    expect(screen.getByText(/parking notes, setup references, prior lessons, and production learnings/i)).toBeInTheDocument();
    expect(screen.queryByText("Internal server error")).not.toBeInTheDocument();
  });

  it("renders the job detail missing-info checklist with waiting and resolved blocker states", async () => {
    window.location.hash = "#sports/shoots/job-sports-1";
    getSharedJobDetailMock.mockResolvedValue(
      buildSportsDetail({
        readiness_items: [
          {
            id: "readiness-team-list",
            tenant_id: "tenant-demo",
            job_id: "job-sports-1",
            job_day_id: null,
            section_key: "client_roster",
            label: "Team list received",
            description: "Team list is required before proof setup.",
            is_required: true,
            is_blocker: true,
            is_complete: false,
            completed_at: null,
            completed_by_user_id: null,
            completed_by_name: null,
            due_at: "2026-08-20T18:00:00.000Z",
            sort_order: 1,
            source_template_key: "sports-team-list",
            notes: "Waiting on updated team list from the league.",
            created_at: "2026-04-01T12:00:00.000Z",
            updated_at: "2026-04-01T12:00:00.000Z"
          },
          {
            id: "readiness-resolved",
            tenant_id: "tenant-demo",
            job_id: "job-sports-1",
            job_day_id: null,
            section_key: "contacts",
            label: "Approval owner confirmed",
            description: "Client approver was missing during intake.",
            is_required: true,
            is_blocker: true,
            is_complete: true,
            completed_at: "2026-08-18T16:00:00.000Z",
            completed_by_user_id: "user-sports",
            completed_by_name: "Sports Manager",
            due_at: "2026-08-18T18:00:00.000Z",
            sort_order: 2,
            source_template_key: "sports-approval-owner",
            notes: "Morgan Approval confirmed.",
            created_at: "2026-04-01T12:00:00.000Z",
            updated_at: "2026-08-18T16:00:00.000Z"
          }
        ],
        watch_flags: [
          {
            id: "flag-client-approval",
            tenant_id: "tenant-demo",
            job_id: "job-sports-1",
            job_day_id: null,
            production_item_id: null,
            approval_request_id: null,
            qa_review_record_id: null,
            deliverable_item_id: null,
            source_entity_type: null,
            source_entity_id: null,
            severity: "medium",
            flag_type: "client_approval",
            title: "Proof approval pending",
            description: "Coach approval is still needed before production release.",
            status: "open",
            owner_user_id: null,
            owner_name: "Client Success",
            created_by_user_id: null,
            due_at: "2026-08-23T18:00:00.000Z",
            snooze_until: null,
            escalated_at: null,
            escalated_to_role: null,
            resolved_at: null,
            resolved_by_user_id: null,
            resolved_by_name: null,
            auto_key: null,
            created_at: "2026-04-01T12:00:00.000Z",
            updated_at: "2026-04-01T12:00:00.000Z"
          }
        ],
        status: {
          readiness_percent: 66,
          job_status: "confirmed",
          production_status: "awaiting_approval",
          staffing_status: "partially_staffed",
          readiness_status: "at_risk",
          risk_status: "high",
          blocker_count: 1,
          open_watch_flag_count: 1
        }
      })
    );

    render(<SharedJobDetailPage token="token-demo" currentUser={sportsCoordinator} departmentType="sports" routeBase="#sports/shoots" />);

    expect(await screen.findByRole("heading", { name: "Missing Info Checklist" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Missing Info and Blockers" })).toBeInTheDocument();
    expect(screen.getAllByText("Missing team list").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Client approval needed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Waiting on client").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Waiting on internal team").length).toBeGreaterThan(0);
    expect(screen.getByText("Resolved blocker history")).toBeInTheDocument();
    expect(screen.getByText(/Approval owner confirmed resolved/)).toBeInTheDocument();
    expect(screen.getByText(/Owner: Client Success/)).toBeInTheDocument();
    expect(screen.getAllByText(/Follow up with the client approver/).length).toBeGreaterThan(0);
  });

  it("renders the shared production queue for sports and routes bulk-safe actions through the shared production api", async () => {
    listSharedProductionQueueMock.mockResolvedValue(buildProductionQueuePayload());
    getSharedProductionReportingMock.mockResolvedValue(buildProductionReportingPayload());
    getSharedJobDetailMock.mockResolvedValue(buildDownstreamSportsDetail());

    render(
      <SharedProductionPageRoute
        token="token-demo"
        currentUser={sportsManager}
        departmentType="sports"
        routeBase="#sports/shoots"
        title="Sports Production"
        summary="Shared downstream queue for sports."
      />
    );

    expect(await screen.findByRole("heading", { name: "Sports Production" })).toBeInTheDocument();
    expect(screen.getByText("Open Items")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All Open" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Workflow Status" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Production ID" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /Varsity Proof Packet/i })).toBeInTheDocument();
    expect(screen.getByText("Linked Job and Shoot Info")).toBeInTheDocument();
    expect(screen.getByText("Average Turnaround")).toBeInTheDocument();
    expect(screen.getByText("Management Exceptions")).toBeInTheDocument();
    expect(screen.getAllByText(/missing proof/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Peer Review Sign-Off/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("Cost Overlay")).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("table")).getByLabelText("Select Varsity Proof Packet"));
    fireEvent.click(within(screen.getByText("1 selected").closest("section") as HTMLElement).getByRole("button", { name: "Assign To Me" }));

    await waitFor(() =>
      expect(createOrUpdateSharedProductionItemMock).toHaveBeenCalledWith(
        "token-demo",
        "job-sports-1",
        expect.objectContaining({
          assigned_to_user_id: "user-sports"
        }),
        "prod-1"
      )
    );
  });

  it("switches the active production detail when another queue row is clicked", async () => {
    const primaryItem = buildProductionQueuePayload().items[0];
    const secondaryItem = {
      ...primaryItem,
      id: "prod-2",
      production_group_key: "banner-2",
      title: "Vendor Banner Batch",
      workflow_status: "READY_FOR_RELEASE",
      health_state: "AT_RISK",
      status: "queued",
      release_status: "SENT_TO_VENDOR",
      sync_state: "CLEAN",
      blocked_reason: null,
      open_blocker_count: 0,
      blocker_count: 0,
      overdue_flag: false,
      due_at: "2026-08-26T17:00:00.000Z",
      days_to_due: 3,
      assigned_to_name: "Taylor Banner Lead",
      assigned_to_user_id: "owner-2"
    };

    listSharedProductionQueueMock.mockResolvedValue(
      buildProductionQueuePayload({
        summary: {
          total_count: 2,
          blocked_count: 1,
          overdue_count: 1,
          awaiting_approval_count: 1,
          qa_pending_count: 1,
          due_today_count: 0
        },
        items: [primaryItem, secondaryItem]
      })
    );
    getSharedProductionReportingMock.mockResolvedValue(buildProductionReportingPayload());
    getSharedJobDetailMock.mockResolvedValue(buildDownstreamSportsDetail());

    render(
      <SharedProductionPageRoute
        token="token-demo"
        currentUser={sportsManager}
        departmentType="sports"
        routeBase="#sports/shoots"
        title="Sports Production"
        summary="Shared downstream queue for sports."
      />
    );

    expect(await screen.findByRole("heading", { name: /Varsity Proof Packet/i })).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("table")).getByText("Vendor Banner Batch"));

    expect(await screen.findByRole("heading", { name: /Vendor Banner Batch/i })).toBeInTheDocument();
  });

  it("keeps reporting and queue requests aligned with the active production saved view filters", async () => {
    window.location.hash = "#sports/production?saved_view=vendor_work&search=prime&organization_id=org-sports";
    const vendorItem = {
      ...buildProductionQueuePayload().items[0],
      id: "prod-vendor",
      production_group_key: "vendor-batch-1",
      title: "Vendor Banner Batch",
      production_type: "banner_batch",
      workflow_status: "SENT_TO_VENDOR",
      release_status: "SENT_TO_VENDOR",
      vendor_name: "Prime Prints",
      blocked_reason: null,
      open_blocker_count: 0,
      overdue_flag: false
    };
    listSharedProductionQueueMock.mockResolvedValue(
      buildProductionQueuePayload({
        items: [vendorItem]
      })
    );
    getSharedProductionReportingMock.mockResolvedValue(buildProductionReportingPayload());
    getSharedJobDetailMock.mockResolvedValue(
      buildDownstreamSportsDetail({
        production_items: [
          {
            ...buildDownstreamSportsDetail().production_items[0],
            id: "prod-vendor",
            production_group_key: "vendor-batch-1",
            title: "Vendor Banner Batch",
            production_type: "banner_batch",
            workflow_status: "SENT_TO_VENDOR",
            release_status: "SENT_TO_VENDOR",
            vendor_name: "Prime Prints",
            blocked_reason: null,
            open_blocker_count: 0,
            overdue_flag: false
          }
        ]
      })
    );

    render(
      <SharedProductionPageRoute
        token="token-demo"
        currentUser={sportsManager}
        departmentType="sports"
        routeBase="#sports/shoots"
        title="Sports Production"
        summary="Shared downstream queue for sports."
      />
    );

    expect(await screen.findByRole("heading", { name: /Vendor Banner Batch/i })).toBeInTheDocument();
    await waitFor(() =>
      expect(listSharedProductionQueueMock).toHaveBeenCalledWith(
        "token-demo",
        expect.objectContaining({
          department_type: "sports",
          release_status: "SENT_TO_VENDOR",
          organization_id: "org-sports",
          search: "prime"
        })
      )
    );
    await waitFor(() =>
      expect(getSharedProductionReportingMock).toHaveBeenCalledWith(
        "token-demo",
        expect.objectContaining({
          department_type: "sports",
          release_status: "SENT_TO_VENDOR",
          organization_id: "org-sports",
          search: "prime"
        })
      )
    );
  });

  it("passes checklist and assigned-to-me filters through the shared production board queries", async () => {
    window.location.hash = "#sports/production?assigned_to_me=yes&checklist_state=blocked";
    const myWorkUser: SessionUser = {
      ...sportsManager,
      id: "owner-1",
      fullName: "Alex Owner"
    };
    listSharedProductionQueueMock.mockResolvedValue(buildProductionQueuePayload());
    getSharedProductionReportingMock.mockResolvedValue(buildProductionReportingPayload());
    getSharedJobDetailMock.mockResolvedValue(buildDownstreamSportsDetail());

    render(
      <SharedProductionPageRoute
        token="token-demo"
        currentUser={myWorkUser}
        departmentType="sports"
        routeBase="#sports/shoots"
        title="Sports Production"
        summary="Shared downstream queue for sports."
      />
    );

    expect(await screen.findByRole("heading", { name: /Varsity Proof Packet/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Assigned to me" })).toBeChecked();
    await waitFor(() =>
        expect(listSharedProductionQueueMock).toHaveBeenCalledWith(
          "token-demo",
          expect.objectContaining({
            department_type: "sports",
            assigned_to_user_id: "owner-1",
            checklist_state: "blocked"
          })
        )
    );
    await waitFor(() =>
        expect(getSharedProductionReportingMock).toHaveBeenCalledWith(
          "token-demo",
          expect.objectContaining({
            department_type: "sports",
            assigned_to_user_id: "owner-1",
            checklist_state: "blocked"
          })
        )
    );
  });

  it("keeps the production queue usable when reporting fails independently", async () => {
    window.location.hash = "#sports/production";
    listSharedProductionQueueMock.mockResolvedValue(buildProductionQueuePayload());
    getSharedProductionReportingMock.mockRejectedValueOnce(new Error("reporting down"));
    getSharedJobDetailMock.mockResolvedValue(buildDownstreamSportsDetail());

    render(
      <SharedProductionPageRoute
        token="token-demo"
        currentUser={sportsManager}
        departmentType="sports"
        routeBase="#sports/shoots"
        title="Sports Production"
        summary="Shared downstream queue for sports."
      />
    );

    expect(await screen.findByRole("heading", { name: /Varsity Proof Packet/i })).toBeInTheDocument();
    expect(screen.getByText("Production reporting")).toBeInTheDocument();
    expect(screen.getByText("Management reporting is temporarily unavailable. The queue is still current.")).toBeInTheDocument();
    expect(screen.queryByText("Production queue unavailable")).not.toBeInTheDocument();
  });

  it("filters the shared production board through saved views and exposes the closed-work lens only when requested", async () => {
    const openItem = buildProductionQueuePayload().items[0];
    const recentlyClosedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const closedItem = {
      ...openItem,
      id: "prod-2",
      production_group_key: "composite-closed",
      title: "Archived Composite Delivery",
      production_type: "composite_delivery",
      workflow_status: "DELIVERED_CLOSED",
      health_state: "ON_TRACK",
      status: "complete",
      release_status: "RELEASED",
      sync_state: "SYNCED",
      due_at: "2026-04-24T17:00:00.000Z",
      closed_at: recentlyClosedAt,
      open_blocker_count: 0,
      blocker_count: 0,
      blocked_reason: null,
      overdue_flag: false,
      days_open: 9,
      days_to_due: -4,
      days_past_due: 0,
      linked_shoot_ids: ["shoot-sports-1"],
      file_count_received: 120,
      file_match_status: "MATCHED"
    };
    listSharedProductionQueueMock.mockResolvedValue(
      buildProductionQueuePayload({
        summary: {
          total_count: 2,
          blocked_count: 1,
          overdue_count: 1,
          awaiting_approval_count: 1,
          qa_pending_count: 1,
          due_today_count: 0
        },
        items: [openItem, closedItem]
      })
    );
    getSharedProductionReportingMock.mockResolvedValue(buildProductionReportingPayload());
    getSharedJobDetailMock.mockResolvedValue(
      buildDownstreamSportsDetail({
        production_items: [
          buildDownstreamSportsDetail().production_items[0],
          {
            ...buildDownstreamSportsDetail().production_items[0],
            id: "prod-2",
            production_group_key: "composite-closed",
            title: "Archived Composite Delivery",
            production_type: "composite_delivery",
            status: "complete",
            workflow_status: "DELIVERED_CLOSED",
            health_state: "ON_TRACK",
            sync_state: "SYNCED",
            due_at: "2026-03-28T17:00:00.000Z",
            closed_at: recentlyClosedAt,
            release_status: "RELEASED",
            blocked_reason: null,
            open_blocker_count: 0,
            blocker_count: 0,
            overdue_flag: false,
            days_open: 9,
            days_to_due: -4,
            days_past_due: 0,
            file_count_received: 120,
            file_match_status: "MATCHED",
            production_notes: "Delivered and archived."
          }
        ],
        production_item_shoot_links: [
          {
            id: "prod-shoot-link-1",
            tenant_id: "tenant-demo",
            production_item_id: "prod-1",
            shoot_id: "shoot-sports-1",
            created_at: "2026-04-01T12:00:00.000Z"
          },
          {
            id: "prod-shoot-link-2",
            tenant_id: "tenant-demo",
            production_item_id: "prod-2",
            shoot_id: "shoot-sports-1",
            created_at: "2026-04-01T12:00:00.000Z"
          }
        ]
      })
    );

    render(
      <SharedProductionPageRoute
        token="token-demo"
        currentUser={sportsManager}
        departmentType="sports"
        routeBase="#sports/shoots"
        title="Sports Production"
        summary="Shared downstream queue for sports."
      />
    );

    const queueTable = await screen.findByRole("table");
    expect(await within(queueTable).findByText("Varsity Proof Packet")).toBeInTheDocument();
    expect(within(queueTable).queryByText("Archived Composite Delivery")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Closed Last 7 Days" }));
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    await waitFor(() => {
      expect(window.location.hash).toContain("saved_view=closed_last_7_days");
      expect(getSharedProductionReportingMock).toHaveBeenLastCalledWith(
        "token-demo",
        expect.objectContaining({
          department_type: "sports",
          due_window: "closed_last_7_days"
        })
      );
      expect(listSharedProductionQueueMock).toHaveBeenLastCalledWith(
        "token-demo",
        expect.objectContaining({
          department_type: "sports"
        })
      );
    });

    expect(screen.getAllByText("1 visible").length).toBeGreaterThan(0);
    expect(screen.getByText("1 in view")).toBeInTheDocument();
    expect((await screen.findAllByText("Archived Composite Delivery")).length).toBeGreaterThan(0);
  });

  it("shows production file-receipt health and updates shared production items from the detail shell", async () => {
    window.location.hash = "#sports/shoots/job-sports-1?tab=production";
    const detail = buildDownstreamSportsDetail();
    const updated = buildDownstreamSportsDetail({
      production_items: [
        {
          ...detail.production_items[0],
          file_count_received: 120,
          status: "ingest_complete",
          blocked_reason: null
        }
      ],
      status: {
        ...detail.status,
        production_status: "ingest_complete"
      }
    });
    getSharedJobDetailMock.mockResolvedValue(detail);
    createOrUpdateSharedProductionItemMock.mockResolvedValueOnce(updated);

    render(<SharedJobDetailPage token="token-demo" currentUser={sportsManager} departmentType="sports" routeBase="#sports/shoots" />);

    expect(await screen.findByText("Varsity Proof Packet")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Received files"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Receipt" }));

    await waitFor(() =>
      expect(createOrUpdateSharedProductionItemMock).toHaveBeenCalledWith(
        "token-demo",
        "job-sports-1",
        expect.objectContaining({
          file_count_expected: 120,
          file_count_received: 120
        }),
        "prod-1"
      )
    );
    expect(await screen.findByText("Received: 120")).toBeInTheDocument();
  });

  it("tracks approvals, QA findings, and deliverables through the shared downstream tabs", async () => {
    const detail = buildDownstreamSportsDetail();

    window.location.hash = "#sports/shoots/job-sports-1?tab=approvals";
    getSharedJobDetailMock.mockResolvedValue(detail);
    createOrUpdateSharedApprovalRequestMock.mockResolvedValueOnce(
      buildDownstreamSportsDetail({
        approval_requests: detail.approval_requests.map((request: any) =>
          request.id === "approval-1"
            ? {
                ...request,
                status: "viewed",
                viewed_at: "2026-08-23T17:15:00.000Z"
              }
            : request
        )
      })
    );

    render(<SharedJobDetailPage token="token-demo" currentUser={sportsManager} departmentType="sports" routeBase="#sports/shoots" />);

    expect(await screen.findByText("Coach proof signoff pending.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark Viewed" }));

    await waitFor(() =>
      expect(createOrUpdateSharedApprovalRequestMock).toHaveBeenCalledWith(
        "token-demo",
        "job-sports-1",
        "prod-1",
        expect.objectContaining({
          status: "viewed"
        }),
        "approval-1"
      )
    );
    expect(await screen.findByText("Viewed")).toBeInTheDocument();

    cleanup();

    window.location.hash = "#sports/shoots/job-sports-1?tab=qa";
    getSharedJobDetailMock.mockResolvedValue(detail);
    createOrUpdateSharedQaFindingMock.mockResolvedValueOnce(
      buildDownstreamSportsDetail({
        qa_findings: [
          ...detail.qa_findings,
          {
            id: "finding-2",
            qa_review_record_id: "qa-1",
            finding_type: "quality_check",
            severity: "medium",
            title: "Backdrop glare",
            description: "Backdrop glare still shows on the left edge.",
            is_blocking: true,
            resolved_at: null,
            resolved_by_user_id: null,
            resolved_by_name: null,
            created_at: "2026-08-22T10:25:00.000Z"
          }
        ]
      })
    );

    render(<SharedJobDetailPage token="token-demo" currentUser={sportsManager} departmentType="sports" routeBase="#sports/shoots" />);

    expect(await screen.findByText("Rework still required")).toBeInTheDocument();
    expect(screen.getByText("Team grouping mismatch")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Finding title"), { target: { value: "Backdrop glare" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Backdrop glare still shows on the left edge." } });
    fireEvent.click(screen.getByRole("button", { name: "Add Finding" }));

    await waitFor(() =>
      expect(createOrUpdateSharedQaFindingMock).toHaveBeenCalledWith(
        "token-demo",
        "job-sports-1",
        "prod-1",
        "qa-1",
        expect.objectContaining({
          title: "Backdrop glare"
        }),
        undefined
      )
    );
    expect(await screen.findByText("Backdrop glare")).toBeInTheDocument();

    cleanup();

    window.location.hash = "#sports/shoots/job-sports-1?tab=deliverables";
    getSharedJobDetailMock.mockResolvedValue(detail);
    createOrUpdateSharedDeliverableItemMock.mockResolvedValueOnce(
      buildDownstreamSportsDetail({
        deliverable_items: detail.deliverable_items.map((deliverable: any) =>
          deliverable.id === "deliverable-1"
            ? {
                ...deliverable,
                status: "delivered",
                delivered_at: "2026-08-24T18:00:00.000Z"
              }
            : deliverable
        )
      })
    );

    render(<SharedJobDetailPage token="token-demo" currentUser={sportsManager} departmentType="sports" routeBase="#sports/shoots" />);

    expect(await screen.findByText("Varsity proof packet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark Delivered" }));

    await waitFor(() =>
      expect(createOrUpdateSharedDeliverableItemMock).toHaveBeenCalledWith(
        "token-demo",
        "job-sports-1",
        "prod-1",
        expect.objectContaining({
          status: "delivered"
        }),
        "deliverable-1"
      )
    );
    expect(await screen.findByText("Delivered")).toBeInTheDocument();
  });

  it("renders the gated QA workflow and submits peer review send-backs with required review data", async () => {
    window.location.hash = "#sports/shoots/job-sports-1?tab=qa";
    const detail = buildDownstreamSportsDetail();
    const updatedDetail = buildDownstreamSportsDetail({
      production_items: detail.production_items.map((item: any) =>
        item.id === "prod-1"
          ? {
              ...item,
              workflow_status: "REWORK_REQUIRED",
              rework_count: 2,
              qa_fail_count: 2,
              peer_review_complete: false,
              first_pass_approved: false
            }
          : item
      ),
      qa_reviews: [
        ...detail.qa_reviews,
        {
          id: "qa-2",
          tenant_id: "tenant-demo",
          production_item_id: "prod-1",
          job_id: "job-sports-1",
          review_type: "peer_review",
          review_stage: "peer_review",
          reviewer_user_id: "user-sports",
          reviewer_name: "Sports Manager",
          requested_by_user_id: "user-sports",
          requested_by_name: "Sports Manager",
          status: "failed",
          decision: "send_back",
          reviewed_at: "2026-08-22T11:30:00.000Z",
          sample_size_percent: 10,
          checklist_template_key: "team_grouping_correctness",
          question_answers_json: {
            files_complete_storage: true,
            color_density_consistency: true,
            sorting_and_roster_accuracy: false,
            template_price_release_accuracy: true,
            next_stage_decision: "send_back"
          },
          notes: "Still seeing roster grouping issues.",
          decision_reason: "Team grouping still needs cleanup.",
          issue_category: "sorting_roster",
          rework_required: true,
          sent_back_to_user_id: "owner-1",
          sent_back_to_name: "Alex Owner",
          override_same_reviewer: false,
          override_reason: null,
          original_owner_user_id: "owner-1",
          original_owner_name: "Alex Owner",
          accountability_stage_key: null,
          accountable_owner_user_id: null,
          accountable_owner_name: null,
          accountable_reviewer_user_id: null,
          accountable_reviewer_name: null,
          created_at: "2026-08-22T11:00:00.000Z",
          updated_at: "2026-08-22T11:30:00.000Z"
        }
      ]
    });
    getSharedJobDetailMock.mockResolvedValue(detail);
    createOrUpdateSharedQaReviewMock.mockResolvedValueOnce(updatedDetail);

    render(<SharedJobDetailPage token="token-demo" currentUser={sportsManager} departmentType="sports" routeBase="#sports/shoots" />);

    expect(await screen.findByRole("heading", { name: /Gate 1: Intake QC/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Gate 3: Peer Review/i })).toBeInTheDocument();

    const peerGate = screen.getByRole("heading", { name: /Gate 3: Peer Review/i }).closest("section");
    if (!(peerGate instanceof HTMLElement)) {
      throw new Error("Peer review gate card not found.");
    }

    expect(within(peerGate).queryByText(/Approve peer self-review override/i)).not.toBeInTheDocument();
    fireEvent.change(within(peerGate).getByLabelText("Sample size percent"), { target: { value: "10" } });
    fireEvent.change(within(peerGate).getByLabelText(/1\. Are files complete, correctly named, and stored correctly\?/i), { target: { value: "yes" } });
    fireEvent.change(within(peerGate).getByLabelText(/2\. Do color, density, and brightness look correct and consistent\?/i), { target: { value: "yes" } });
    fireEvent.change(within(peerGate).getByLabelText(/3\. Are sorting, category placement, and roster links correct\?/i), { target: { value: "no" } });
    fireEvent.change(within(peerGate).getByLabelText(/4\. Are templates, price sheets, vendor outputs, and release settings correct\?/i), { target: { value: "yes" } });
    fireEvent.change(within(peerGate).getByLabelText(/5\. Approve for next stage, or send back for rework\?/i), { target: { value: "send_back" } });
    fireEvent.change(within(peerGate).getByLabelText("Send-back reason"), { target: { value: "Team grouping still needs cleanup." } });
    fireEvent.change(within(peerGate).getByLabelText("Issue category"), { target: { value: "sorting_roster" } });
    fireEvent.click(within(peerGate).getByRole("button", { name: "Send Back" }));

    await waitFor(() =>
      expect(createOrUpdateSharedQaReviewMock).toHaveBeenCalledWith(
        "token-demo",
        "job-sports-1",
        "prod-1",
        expect.objectContaining({
          review_stage: "peer_review",
          status: "failed",
          decision_reason: "Team grouping still needs cleanup.",
          issue_category: "sorting_roster",
          question_answers_json: expect.objectContaining({
            next_stage_decision: "send_back",
            sorting_and_roster_accuracy: false
          })
        }),
        undefined
      )
    );

    expect(await screen.findByText("Rework 2")).toBeInTheDocument();
  });

  it("keeps preset lenses without exposing saved-view management controls", async () => {
    listSharedJobsMock.mockResolvedValue({
      jobs: [
        buildJobListItem({
          department_type: "sports",
          job_number: "SPT-2026-0012",
          title: "Metro Football Media Day",
          organization_id: "org-sports",
          organization_name: "Metro Football Club",
          school_profile: null,
          sports_profile: {
            sport_type: "football",
            season: "fall",
            proof_required: true,
            banner_work_required: true,
            revenue_share_enabled: true,
            estimated_team_count: 6
          }
        })
      ]
    });

    render(<SharedJobsPage token="token-demo" currentUser={sportsManager} departmentType="sports" routeBase="#sports/shoots" />);

    expect(await screen.findByRole("heading", { name: "Sports Shoots" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next 14 Days" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Waiting on Approval" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save current view/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pin default/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rename/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/i })).not.toBeInTheDocument();
  });

  it("renders workflow checkpoints on the shared job summary", async () => {
    window.location.hash = "#sports/shoots/job-sports-1";
    getSharedJobDetailMock.mockResolvedValue(
      buildSportsDetail({
        workflow: buildWorkflowSummaryFixture()
      })
    );

    render(<SharedJobDetailPage token="token-demo" currentUser={sportsManager} departmentType="sports" routeBase="#sports/shoots" />);

    expect(await screen.findByText("Workflow checkpoints")).toBeInTheDocument();
    expect(screen.getByText("Publish Readiness")).toBeInTheDocument();
    expect(screen.getByText("Production Workflow")).toBeInTheDocument();
    expect(screen.getByText(/Next:\s*Resolve the publish blockers/i)).toBeInTheDocument();
    expect(screen.getAllByText("Organization is required before publish.").length).toBeGreaterThan(0);
  });

  it("renders canonical current workflow state in the job command center", async () => {
    window.location.hash = "#schools/jobs/job-school-ops";
    getSharedJobDetailMock.mockResolvedValue(buildOperationalSchoolDetail());
    getProjectWorkflowCommandCenterMock.mockResolvedValueOnce(
      buildProjectWorkflowCommandCenter([buildProjectWorkflowJobRow()])
    );
    getProjectWorkflowInstanceMock.mockResolvedValueOnce(buildProjectWorkflowInstance());

    render(<SharedJobDetailPage token="token-demo" currentUser={schoolsManager} departmentType="schools" routeBase="#schools/jobs" />);

    expect(await screen.findByText("Prep data/admin")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Job Command Center" })).toBeInTheDocument();
    expect(screen.getAllByText("Schools").length).toBeGreaterThan(0);
    expect(screen.getByText("Needs Assignment · Schools Queue")).toBeInTheDocument();
    expect(screen.getByText("Waiting on School · Roster SIS export")).toBeInTheDocument();
    expect(screen.getByText("School Portraits Workflow · v1")).toBeInTheDocument();
    expect(screen.getByText("Confirm schedule · Schools Setup")).toBeInTheDocument();
    expect(screen.getByText("Send to Production · Schools Setup")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Schools queue" })).toHaveAttribute("href", "#schools");
    expect(screen.getByRole("link", { name: "Open Live Job Workflow" })).toHaveAttribute("href", "#project-tracking/workflows/workflow-school-ops");
  });

  it("renders non-sending prep readiness without leaking internal-only notes into client prep", async () => {
    window.location.hash = "#schools/jobs/job-school-ops";
    getSharedJobDetailMock.mockResolvedValue(buildOperationalSchoolDetail());
    getProjectWorkflowCommandCenterMock.mockResolvedValueOnce(
      buildProjectWorkflowCommandCenter([buildProjectWorkflowJobRow()])
    );
    getProjectWorkflowInstanceMock.mockResolvedValueOnce(buildProjectWorkflowInstance());

    render(<SharedJobDetailPage token="token-demo" currentUser={schoolsManager} departmentType="schools" routeBase="#schools/jobs" />);

    expect(await screen.findByRole("heading", { name: "Job Prep Readiness Preview" })).toBeInTheDocument();
    expect(screen.getByText("Preview only. Mission Control is not sending email or SMS from this panel.")).toBeInTheDocument();
    expect(screen.getAllByText("Pat Prep - pat@example.com").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("No SMS recipients are ready.")).toBeInTheDocument();
    expect(screen.getByText(/SMS consent is unknown/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open in Google Maps" }).length).toBeGreaterThanOrEqual(1);

    const clientSection = screen.getByRole("heading", { name: "Client Prep Preview" }).closest("section");
    expect(clientSection).not.toBeNull();
    expect(within(clientSection as HTMLElement).getByText("Client-safe: please use Door 7.")).toBeInTheDocument();
    expect(within(clientSection as HTMLElement).queryByText(/Internal-only/)).not.toBeInTheDocument();
    expect(within(clientSection as HTMLElement).queryByText("Internal Parking Map")).not.toBeInTheDocument();

    const employeeSection = screen.getByRole("heading", { name: "Employee Briefing Preview" }).closest("section");
    expect(employeeSection).not.toBeNull();
    expect(within(employeeSection as HTMLElement).getByText("Internal-only: do not mention the bus lane conflict.")).toBeInTheDocument();
    expect(within(employeeSection as HTMLElement).getByText("Internal Parking Map")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Message Template Readiness" })).toBeInTheDocument();
    expect(screen.getAllByText("Preview only - nothing is sent.").length).toBeGreaterThanOrEqual(3);

    const emailPreview = screen.getByRole("heading", { name: "Client Prep Email" }).closest("section");
    expect(emailPreview).not.toBeNull();
    expect(within(emailPreview as HTMLElement).getByText("Prep details for North High Picture Day")).toBeInTheDocument();
    expect(within(emailPreview as HTMLElement).getByText("Prep note: Client-safe: please use Door 7.")).toBeInTheDocument();
    expect(within(emailPreview as HTMLElement).queryByText(/Internal-only/)).not.toBeInTheDocument();
    expect(within(emailPreview as HTMLElement).queryByText("Internal Parking Map")).not.toBeInTheDocument();

    const smsPreview = screen.getByRole("heading", { name: "Client Prep SMS" }).closest("section");
    expect(smsPreview).not.toBeNull();
    expect(within(smsPreview as HTMLElement).getByText("SMS preview unavailable until at least one prep contact is SMS eligible.")).toBeInTheDocument();
    expect(within(smsPreview as HTMLElement).getByText(/No SMS-eligible recipients/)).toBeInTheDocument();

    const employeeMessagePreview = screen.getByRole("heading", { name: "Employee Briefing" }).closest("section");
    expect(employeeMessagePreview).not.toBeNull();
    expect(within(employeeMessagePreview as HTMLElement).getByText("Internal-only notes: Internal-only: do not mention the bus lane conflict.")).toBeInTheDocument();
    expect(within(employeeMessagePreview as HTMLElement).getByText("Internal Parking Map")).toBeInTheDocument();
  });

  it("handles missing workflow fields in the job command center without overclaiming", async () => {
    window.location.hash = "#schools/jobs/job-school-ops";
    getSharedJobDetailMock.mockResolvedValue(buildOperationalSchoolDetail());
    getProjectWorkflowCommandCenterMock.mockResolvedValueOnce(
      buildProjectWorkflowCommandCenter([
        buildProjectWorkflowJobRow({
          workflow_run_id: null,
          workflow_template_name: null,
          workflow_template_version: null,
          current_step: null,
          organization_name: null,
          account_name: null,
          owner_display: "Owner not set",
          owner_type: "unknown",
          job_date: null,
          next_deadline_at: null,
          waiting_on_party: "unknown",
          health: "no_workflow",
          health_reasons: [],
          missing_info_flags: []
        })
      ])
    );

    render(<SharedJobDetailPage token="token-demo" currentUser={schoolsManager} departmentType="schools" routeBase="#schools/jobs" />);

    expect(await screen.findByText("No workflow linked")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Job Command Center" })).toBeInTheDocument();
    expect(screen.getByText("Team not set")).toBeInTheDocument();
    expect(screen.getByText("Job date not connected yet")).toBeInTheDocument();
    expect(screen.getByText("Deadline not set")).toBeInTheDocument();
    expect(screen.getByText("Waiting not set")).toBeInTheDocument();
    expect(screen.getByText("Workflow template not linked")).toBeInTheDocument();
    expect(screen.getByText("Workflow not assigned yet")).toBeInTheDocument();
    expect(getProjectWorkflowInstanceMock).not.toHaveBeenCalled();
  });

  it("surfaces structured workflow blockers after a blocked publish attempt", async () => {
    window.location.hash = "#sports/shoots/job-sports-1";
    getSharedJobDetailMock.mockResolvedValue(
      buildSportsDetail({
        job: {
          ...buildSportsDetail().job,
          published_at: null
        },
        workflow: buildWorkflowSummaryFixture()
      })
    );
    publishSharedJobMock.mockRejectedValueOnce(
      new ApiClientError(409, "Validation failed", {
        workflow_validation: buildWorkflowValidationFixture()
      })
    );

    render(<SharedJobDetailPage token="token-demo" currentUser={sportsManager} departmentType="sports" routeBase="#sports/shoots" />);

    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));

    expect(await screen.findByText("Workflow transition blocked")).toBeInTheDocument();
    expect(screen.getAllByText("Organization is required before publish.").length).toBeGreaterThan(0);
  });

  it("renders grouped readiness sections, blocker state, and school-specific readiness cards", async () => {
    window.location.hash = "#schools/jobs/job-school-ops?tab=readiness";
    getSharedJobDetailMock.mockResolvedValue(buildOperationalSchoolDetail());

    render(<SharedJobDetailPage token="token-demo" currentUser={schoolsManager} departmentType="schools" routeBase="#schools/jobs" />);

    expect(await screen.findByRole("heading", { name: "Picture Day readiness" })).toBeInTheDocument();
    expect(screen.getByText("1 blocker still open")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Data" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Contacts" })).toBeInTheDocument();
    expect(screen.getAllByText("Roster received").length).toBeGreaterThan(0);
    expect(screen.getByText("Admin contact confirmed")).toBeInTheDocument();
    expect(screen.getByText("School Data Readiness")).toBeInTheDocument();
    expect(screen.getByText("Deliverables Readiness")).toBeInTheDocument();
  });

  it("completes readiness items through the shared readiness board", async () => {
    window.location.hash = "#schools/jobs/job-school-ops?tab=readiness";
    const detail = buildOperationalSchoolDetail();
    const updated = buildOperationalSchoolDetail({
      readiness_items: detail.readiness_items.map((item: any) =>
        item.id === "school-readiness-1"
          ? {
              ...item,
              is_complete: true,
              completed_at: "2026-04-02T12:00:00.000Z",
              completed_by_user_id: "user-schools",
              completed_by_name: "Schools Manager"
            }
          : item
      ),
      status: {
        ...detail.status,
        readiness_percent: 100,
        readiness_status: "ready",
        blocker_count: 0
      }
    });
    getSharedJobDetailMock.mockResolvedValue(detail);
    updateSharedReadinessItemMock.mockResolvedValueOnce(updated);

    render(<SharedJobDetailPage token="token-demo" currentUser={schoolsManager} departmentType="schools" routeBase="#schools/jobs" />);

    fireEvent.click(await screen.findByRole("button", { name: "Mark Complete" }));

    await waitFor(() =>
      expect(updateSharedReadinessItemMock).toHaveBeenCalledWith(
        "token-demo",
        "job-school-ops",
        "school-readiness-1",
        expect.objectContaining({
          is_complete: true,
          note: "Still waiting on SIS export."
        })
      )
    );
    expect(await screen.findByText("2/2")).toBeInTheDocument();
    expect(screen.queryByText("1 blocker still open")).not.toBeInTheDocument();
  });

  it("renders staffing coverage gaps and sports-specific staffing cards through the shared staffing board", async () => {
    window.location.hash = "#sports/shoots/job-sports-1?tab=staffing";
    getSharedJobDetailMock.mockResolvedValue(buildOperationalSportsDetail());

    render(<SharedJobDetailPage token="token-demo" currentUser={sportsManager} departmentType="sports" routeBase="#sports/shoots" />);

    expect(await screen.findByRole("heading", { name: "Shoot staffing" })).toBeInTheDocument();
    expect(screen.getByText("Coverage gap detected")).toBeInTheDocument();
    expect(screen.getByText("Sports Manager")).toBeInTheDocument();
    expect(screen.getByText("Alex Owner")).toBeInTheDocument();
    expect(screen.getByText("Coverage Context")).toBeInTheDocument();
  });

  it("lets an assigned user self check in while hiding manager-only day-of actions", async () => {
    window.location.hash = "#sports/shoots/job-sports-1?tab=day-of";
    const today = getTodayDateString();
    const detail = buildOperationalSportsDetail({
      days: [
        {
          ...buildOperationalSportsDetail().days[0],
          date: today
        }
      ]
    });
    const updated = buildOperationalSportsDetail({
      days: [
        {
          ...detail.days[0],
          date: today
        }
      ],
      staff_assignments: detail.staff_assignments.map((assignment: any) =>
        assignment.id === "assignment-lead"
          ? {
              ...assignment,
              check_in_at: `${today}T08:47:00.000Z`
            }
          : assignment
      ),
      status: {
        ...detail.status,
        staffing_status: "checked_in"
      }
    });
    getSharedJobDetailMock.mockResolvedValue(detail);
    checkInSharedJobStaffMock.mockResolvedValueOnce(updated);

    render(<SharedJobDetailPage token="token-demo" currentUser={sportsLeadUser} departmentType="sports" routeBase="#sports/shoots" />);

    expect(await screen.findByRole("heading", { name: "Shoot execution" })).toBeInTheDocument();
    const roster = screen.getByRole("heading", { name: "Check-In Roster" }).closest("section");
    if (!roster) {
      throw new Error("Check-In roster section not found");
    }
    fireEvent.click(within(roster).getAllByRole("button", { name: "Check In" })[0]);

    await waitFor(() => expect(checkInSharedJobStaffMock).toHaveBeenCalledWith("token-demo", "job-sports-1", "assignment-lead"));
    expect(await screen.findByText("Checked In")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark Absent" })).not.toBeInTheDocument();
  });

  it("lets the assigned lead confirm ready through the shared day-of console", async () => {
    window.location.hash = "#sports/shoots/job-sports-1?tab=day-of";
    const today = getTodayDateString();
    const base = buildOperationalSportsDetail({
      days: [
        {
          ...buildOperationalSportsDetail().days[0],
          date: today
        }
      ]
    });
    const updated = buildOperationalSportsDetail({
      days: [
        {
          ...base.days[0],
          date: today,
          day_status: "ready",
          ready_confirmed_at: `${today}T08:55:00.000Z`,
          ready_confirmed_by_user_id: "user-sports"
        }
      ],
      staff_assignments: base.staff_assignments.map((assignment: any) =>
        assignment.id === "assignment-lead"
          ? {
              ...assignment,
              is_ready_present: true
            }
          : assignment
      ),
      status: {
        ...base.status,
        staffing_status: "ready_confirmed"
      },
      activity: [
        {
          id: "activity-ready",
          tenant_id: "tenant-demo",
          object_type: "job",
          object_id: "job-sports-1",
          related_object_type: "job_day",
          related_object_id: "day-1",
          source_kind: "activity_log",
          job_id: "job-sports-1",
          job_day_id: "day-1",
          production_item_id: null,
          watch_flag_id: null,
          organization_id: null,
          location_id: null,
          contact_id: null,
          actor_user_id: "user-sports",
          actor_name: "Sports Lead",
          event_type: "lead_ready_confirmed",
          action_label: "Ready confirmed",
          summary: "Lead confirmed the crew is ready to work.",
          detail: null,
          tone: "success",
          metadata: {},
          created_at: `${today}T08:55:00.000Z`
        }
      ]
    });
    getSharedJobDetailMock.mockResolvedValue(base);
    markSharedJobDayReadyMock.mockResolvedValueOnce(updated);

    render(<SharedJobDetailPage token="token-demo" currentUser={sportsLeadUser} departmentType="sports" routeBase="#sports/shoots" />);

    fireEvent.click(await screen.findByRole("button", { name: "Ready to Work" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Ready" }));

    await waitFor(() =>
      expect(markSharedJobDayReadyMock).toHaveBeenCalledWith(
        "token-demo",
        "job-sports-1",
        "day-1",
        expect.objectContaining({
          on_site_confirmed: true,
          setup_complete: true,
          all_required_staff_present: true,
          blockers_resolved: true
        })
      )
    );
    expect((await screen.findAllByText("Ready confirmed")).length).toBeGreaterThan(0);
    expect(screen.getByText("Specialty Products Watch")).toBeInTheDocument();
  });

  it("creates execution issues through the shared day-of console and shows the new issue state", async () => {
    window.location.hash = "#sports/shoots/job-sports-1?tab=day-of";
    const detail = buildOperationalSportsDetail({
      watch_flags: [],
      status: {
        ...buildOperationalSportsDetail().status,
        open_watch_flag_count: 0
      }
    });
    const updated = buildOperationalSportsDetail({
      watch_flags: [
        {
          id: "flag-new",
          tenant_id: "tenant-demo",
          job_id: "job-sports-1",
          job_day_id: "day-1",
          production_item_id: null,
          severity: "critical",
          flag_type: "weather",
          title: "Storm rolling in",
          description: "Lightning watch issued for kickoff window.",
          status: "open",
          owner_user_id: "user-sports",
          owner_name: "Sports Manager",
          due_at: null,
          resolved_at: null,
          resolved_by_user_id: null,
          resolved_by_name: null,
          auto_key: null,
          created_at: "2026-04-01T14:00:00.000Z"
        }
      ],
      status: {
        ...detail.status,
        open_watch_flag_count: 1,
        risk_status: "critical"
      }
    });
    getSharedJobDetailMock.mockResolvedValue(detail);
    createOrResolveSharedJobWatchFlagMock.mockResolvedValueOnce(updated);

    render(<SharedJobDetailPage token="token-demo" currentUser={sportsManager} departmentType="sports" routeBase="#sports/shoots" />);

    expect(await screen.findByRole("heading", { name: "Shoot execution" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Issue type"), { target: { value: "weather" } });
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "critical" } });
    fireEvent.change(screen.getByLabelText("Issue title"), { target: { value: "Storm rolling in" } });
    fireEvent.change(screen.getByLabelText("Issue note"), { target: { value: "Lightning watch issued for kickoff window." } });
    fireEvent.click(screen.getByRole("button", { name: "Log Issue" }));

    await waitFor(() =>
      expect(createOrResolveSharedJobWatchFlagMock).toHaveBeenCalledWith(
        "token-demo",
        "job-sports-1",
        expect.objectContaining({
          job_day_id: "day-1",
          flag_type: "weather",
          severity: "critical",
          title: "Storm rolling in"
        })
      )
    );
    expect(await screen.findByText("Storm rolling in")).toBeInTheDocument();
  });

  it("renders the shared today board with live day-of alerts and department summaries", async () => {
    const today = getTodayDateString();
    listSharedJobsMock.mockResolvedValueOnce({
      jobs: [
        buildJobListItem({
          id: "job-today-1",
          department_type: "sports",
          job_number: "SPT-2026-0101",
          title: "Metro Football Media Day",
          organization_id: "org-sports",
          organization_name: "Metro Football Club",
          primary_day_date: today,
          readiness_status: "at_risk",
          staffing_status: "gap_flagged",
          risk_status: "critical",
          blocker_count: 2,
          assigned_staff_count: 2,
          checked_in_staff_count: 1,
          estimated_staff_count: 3,
          lead_owner_name: "Sports Manager",
          school_profile: null,
          sports_profile: {
            sport_type: "football",
            season: "fall",
            proof_required: true,
            banner_work_required: true,
            revenue_share_enabled: true,
            estimated_team_count: 6
          }
        })
      ]
    });

    render(
      <TodayOperationsBoard
        token="token-demo"
        currentUser={sportsManager}
        departmentType="sports"
        routeBase="#sports/shoots"
        title="Today Sports Operations"
      />
    );

    expect(await screen.findByRole("heading", { name: "Today Sports Operations" })).toBeInTheDocument();
    await waitFor(() =>
      expect(listSharedJobsMock).toHaveBeenCalledWith(
        "token-demo",
        expect.objectContaining({
          department_type: "sports",
          day_date: today
        })
      )
    );
    expect(screen.getByText("Metro Football Media Day")).toBeInTheDocument();
    expect(screen.getByText("Lead Ready Feed")).toBeInTheDocument();
    expect(screen.getByText("Check-In Monitor")).toBeInTheDocument();
    expect(screen.getByText("Staffing Summary")).toBeInTheDocument();
    expect(screen.getByText("Readiness Summary")).toBeInTheDocument();
  });
});
