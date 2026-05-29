// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../api";
import { QuickCreateJobDrawer } from "../components/jobIntake/QuickCreateJobDrawer";
import { SchoolsHub } from "../pages/SchoolsHub";
import { SportsOverview } from "../pages/SportsOverview";
import type {
  CentralJobDepartment,
  CentralJobDraftResponse,
  CentralJobDuplicateResult,
  CentralJobPublishResult
} from "../jobIntakeTypes";
import type { SchoolsHubReferenceData, SchoolsHubWorkspaceResponse } from "../schoolsHubTypes";
import type { SportsOverviewResponse } from "../sportsTypes";
import type { SessionUser } from "../types";

const listOrganizationsMock = vi.fn();
const getOrganizationDetailMock = vi.fn();
const listDirectoryOwnerOptionsMock = vi.fn();
const createCentralJobDraftMock = vi.fn();
const getCentralJobDraftMock = vi.fn();
const listCentralJobDraftsMock = vi.fn();
const updateCentralJobDraftMock = vi.fn();
const previewCentralJobDuplicatesMock = vi.fn();
const publishCentralJobDraftMock = vi.fn();
const parseCentralJobIntakeTextMock = vi.fn();
const getCentralJobOrganizationDefaultsMock = vi.fn();
const getSchoolsHubWorkspaceMock = vi.fn();
const getSchoolsHubReferenceDataMock = vi.fn();
const getSportsOverviewMock = vi.fn();
const listSharedJobsMock = vi.fn();
const listSharedWatchlistMock = vi.fn();
const getSharedDashboardMock = vi.fn();
const getProjectWorkflowCommandCenterMock = vi.fn();
const listSharedTasksMock = vi.fn();
const listSharedProductionQueueMock = vi.fn();
const listSharedAlertsMock = vi.fn();
const getSharedProductionReportingMock = vi.fn();
const apiFetchMock = vi.fn();

vi.mock("../featureFlags", () => ({
  featureFlags: {
    centralJobIntakeV1: true
  }
}));

vi.mock("../services/organizationApi", () => ({
  listOrganizations: (...args: unknown[]) => listOrganizationsMock(...args),
  getOrganizationDetail: (...args: unknown[]) => getOrganizationDetailMock(...args),
  listDirectoryOwnerOptions: (...args: unknown[]) => listDirectoryOwnerOptionsMock(...args)
}));

vi.mock("../services/centralJobIntakeApi", () => ({
  createCentralJobDraft: (...args: unknown[]) => createCentralJobDraftMock(...args),
  getCentralJobDraft: (...args: unknown[]) => getCentralJobDraftMock(...args),
  listCentralJobDrafts: (...args: unknown[]) => listCentralJobDraftsMock(...args),
  updateCentralJobDraft: (...args: unknown[]) => updateCentralJobDraftMock(...args),
  previewCentralJobDuplicates: (...args: unknown[]) => previewCentralJobDuplicatesMock(...args),
  publishCentralJobDraft: (...args: unknown[]) => publishCentralJobDraftMock(...args),
  parseCentralJobIntakeText: (...args: unknown[]) => parseCentralJobIntakeTextMock(...args),
  getCentralJobOrganizationDefaults: (...args: unknown[]) => getCentralJobOrganizationDefaultsMock(...args),
  extractCentralJobFormErrors: (error: unknown) => {
    if (error instanceof ApiClientError && error.details && typeof error.details === "object") {
      const details = error.details as {
        field_errors?: Record<string, string[]>;
        form_errors?: string[];
        duplicate_result?: CentralJobDuplicateResult | null;
      };
      return {
        fieldErrors: details.field_errors ?? {},
        formErrors: details.form_errors ?? [error.message],
        duplicateResult: details.duplicate_result ?? null
      };
    }
    return {
      fieldErrors: {},
      formErrors: [error instanceof Error ? error.message : "Unknown error"],
      duplicateResult: null
    };
  }
}));

vi.mock("../services/schoolsHubApi", () => ({
  getSchoolsHubWorkspace: (...args: unknown[]) => getSchoolsHubWorkspaceMock(...args),
  getSchoolsHubReferenceData: (...args: unknown[]) => getSchoolsHubReferenceDataMock(...args),
  getSchoolWorkItemDetailRecord: vi.fn(),
  updateSchoolWorkItemRecord: vi.fn(),
  bulkUpdateSchoolWorkItemsRecord: vi.fn(),
  convertSchoolWorkItemToDeliverableRecord: vi.fn()
}));

vi.mock("../services/sportsApi", () => ({
  getSportsOverview: (...args: unknown[]) => getSportsOverviewMock(...args)
}));

vi.mock("../services/jobsApi", () => ({
  listSharedJobs: (...args: unknown[]) => listSharedJobsMock(...args),
  listSharedExceptions: (...args: unknown[]) => listSharedWatchlistMock(...args),
  getSharedDashboard: (...args: unknown[]) => getSharedDashboardMock(...args),
  listSharedProductionQueue: (...args: unknown[]) => listSharedProductionQueueMock(...args),
  listSharedAlerts: (...args: unknown[]) => listSharedAlertsMock(...args),
  getSharedProductionReporting: (...args: unknown[]) => getSharedProductionReportingMock(...args)
}));

vi.mock("../services/tasksApi", () => ({
  listSharedTasks: (...args: unknown[]) => listSharedTasksMock(...args)
}));

vi.mock("../services/projectTracking", () => ({
  getProjectWorkflowCommandCenter: (...args: unknown[]) => getProjectWorkflowCommandCenterMock(...args)
}));

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetchMock(...args)
  };
});

afterEach(() => {
  cleanup();
});

const baseUser: SessionUser = {
  id: "user-manager",
  tenantId: "tenant-demo",
  accountId: "account-demo",
  sessionId: "session-demo",
  email: "manager@example.com",
  fullName: "Demo Manager",
  status: "active",
  department: "schools",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["manager"],
  permissions: ["shoot.create", "shoot.read", "shoot.update", "shoots.create", "schools_hub.view", "schools_hub.manage", "dashboard.read"],
  authorityTier: "supervisor",
  primaryJobFunctionProfile: "schools_client_success",
  jobFunctionProfiles: ["schools_client_success"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust: {
    identityProvider: "local_password",
    sessionAssurance: "standard",
    requestTransport: "bearer",
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
  }
};

const emptySchoolsWorkspace: SchoolsHubWorkspaceResponse = {
  anchor_date: "2026-04-01",
  generated_at: "2026-04-01T12:00:00.000Z",
  scope: "all",
  summary: {
    due_today: 0,
    overdue: 0,
    upcoming_shoots_needing_prep: 0,
    waiting_on_school: 0,
    waiting_on_internal_production: 0,
    id_work_queue: 0,
    gallery_due_soon: 0,
    yearbook_deadlines_approaching: 0,
    deliveries_ready: 0,
    recently_completed: 0,
    open_total: 0
  },
  sections: [],
  queue_total_count: 0,
  queue_page: 1,
  queue_page_size: 25,
  queue_has_more: false,
  queue_items: []
};

const emptySchoolsReferences: SchoolsHubReferenceData = {
  owners: [],
  schools: [],
  jobs: [],
  locations: [],
  contacts: []
};

const emptySportsOverview: SportsOverviewResponse = {
  generated_at: "2026-04-01T12:00:00.000Z",
  anchor_start: "2026-04-01",
  anchor_end: "2026-04-07",
  permissions: {
    can_manage_department: true,
    can_edit_shoots: true,
    can_manage_staffing: true,
    can_manage_production: true,
    can_manage_finance: false,
    can_view_finance_detail: false,
    can_manage_settings: false,
    can_publish_imports: false,
    can_override_duplicates: false,
    can_confirm_ready: true
  },
  saved_views: [],
  kpis: [],
  urgent_watch: [],
  upcoming_shoots: [],
  staffing_readiness: [],
  ready_pings: [],
  production_bottlenecks: [],
  proof_and_products: [],
  account_health: [],
  recent_activity: []
};

function makeDraftResponse(department: CentralJobDepartment, overrides: Partial<CentralJobDraftResponse["job"]> = {}): CentralJobDraftResponse {
  return {
    job: {
      id: "job-draft-1",
      tenant_id: "tenant-demo",
      shoot_code: "SHOOT-001",
      title: overrides.title ?? (department === "schools" ? "North High - Fall Portraits - 2026-04-10" : "Metro Athletics - Hockey Media Day - 2026-04-12"),
      organization_display_name: overrides.organization_display_name ?? null,
      location_display_name: overrides.location_display_name ?? null,
      primary_contact_name: overrides.primary_contact_name ?? null,
      job_number: null,
      department,
      job_type: overrides.job_type ?? (department === "sports" ? "sports" : null),
      source_reference: null,
      record_state: "draft",
      job_status: "new",
      readiness_status: "needs_info",
      sync_status: "not_linked",
      organization_id: overrides.organization_id ?? null,
      unresolved_organization_name: overrides.unresolved_organization_name ?? null,
      location_id: overrides.location_id ?? null,
      unresolved_location_name: null,
      primary_contact_id: overrides.primary_contact_id ?? null,
      unresolved_primary_contact_name: null,
      account_owner_user_id: overrides.account_owner_user_id ?? null,
      job_owner_user_id: overrides.job_owner_user_id ?? baseUser.id,
      start_date: overrides.start_date ?? "2026-04-10",
      schedule_date_placeholder: false,
      start_time: overrides.start_time ?? null,
      end_time: null,
      timezone: overrides.timezone ?? "America/Chicago",
      date_only: false,
      start_time_confirmed: false,
      is_multi_day: false,
      delivery_due_date: overrides.delivery_due_date ?? null,
      production_required: true,
      staffing_required: true,
      staffing_estimate: null,
      priority: "normal",
      delivery_type: null,
      production_grouping_rule: "one_per_job",
      request_source: "manual",
      internal_notes: null,
      client_notes: null,
      special_instructions: null,
      raw_source_text: null,
      merge_parent_job_id: null,
      duplicate_override_note: null,
      duplicate_check_completed_at: null,
      created_by: baseUser.id,
      updated_by_user_id: baseUser.id,
      published_by_user_id: null,
      published_at: null,
      created_at: "2026-04-01T12:00:00.000Z",
      updated_at: "2026-04-01T12:00:00.000Z"
    },
    job_days: [],
    school_detail: department === "schools" ? ({ shoot_id: "job-draft-1" } as never) : null,
    sports_detail: department === "sports" ? ({ shoot_id: "job-draft-1" } as never) : null,
    draft_validation: { valid: true, errors: [], warnings: [] },
    publish_validation: { valid: false, errors: [], warnings: [] },
    readiness: { readiness_status: "needs_info", blockers: [], warnings: [], items: [] },
    production_items: [],
    staffing_requirements: [],
    activity_log: []
  } as CentralJobDraftResponse;
}

const clearDuplicateResult: CentralJobDuplicateResult = {
  disposition: "clear",
  hard_block: false,
  soft_warning: false,
  matching_records: [],
  checked_at: "2026-04-01T12:00:00.000Z"
};

function renderSchoolsPage() {
  window.location.hash = "#schools";
  return render(<SchoolsHub token="token-demo" currentUser={baseUser} />);
}

function renderSportsPage() {
  window.location.hash = "#sports";
  return render(<SportsOverview token="token-demo" currentUser={{ ...baseUser, department: "sports" }} />);
}

function getLabeledControl<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
  dialog: HTMLElement,
  labelText: string,
  selector: string
) {
  const label = within(dialog).getByText(labelText).closest("label");
  if (!label) {
    throw new Error(`No label found for ${labelText}.`);
  }
  const control = label.querySelector(selector);
  if (!control) {
    throw new Error(`No ${selector} found for ${labelText}.`);
  }
  return control as T;
}

async function openQuickCreate(buttonName = "New School Job") {
  fireEvent.click(await screen.findByRole("button", { name: buttonName }));
  return screen.getByRole("dialog");
}

beforeEach(() => {
  listOrganizationsMock.mockReset();
  getOrganizationDetailMock.mockReset();
  listDirectoryOwnerOptionsMock.mockReset();
  createCentralJobDraftMock.mockReset();
  getCentralJobDraftMock.mockReset();
  listCentralJobDraftsMock.mockReset();
  updateCentralJobDraftMock.mockReset();
  previewCentralJobDuplicatesMock.mockReset();
  publishCentralJobDraftMock.mockReset();
  parseCentralJobIntakeTextMock.mockReset();
  getCentralJobOrganizationDefaultsMock.mockReset();
  getSchoolsHubWorkspaceMock.mockReset();
  getSchoolsHubReferenceDataMock.mockReset();
  getSportsOverviewMock.mockReset();
  getProjectWorkflowCommandCenterMock.mockReset();
  listSharedJobsMock.mockReset();
  listSharedWatchlistMock.mockReset();
  getSharedDashboardMock.mockReset();
  listSharedTasksMock.mockReset();
  listSharedProductionQueueMock.mockReset();
  listSharedAlertsMock.mockReset();
  getSharedProductionReportingMock.mockReset();
  apiFetchMock.mockReset();

  listDirectoryOwnerOptionsMock.mockResolvedValue({
    owners: [{ user_id: baseUser.id, full_name: baseUser.fullName, email: baseUser.email, department: baseUser.department, status: "active" }]
  });
  listOrganizationsMock.mockImplementation(async (_token: string, filters?: { search?: string }) => ({
    organizations: [
      {
        id: "org-schools",
        canonical_name: "north-high",
        logo_url: null,
        display_name: "North High",
        account_type: "schools_underclass_portraits",
        active_status: "active",
        aliases: [],
        notes: null,
        contact_count: 2,
        location_count: 1,
        created_at: "2026-04-01T12:00:00.000Z",
        updated_at: "2026-04-01T12:00:00.000Z"
      },
      {
        id: "org-sports",
        canonical_name: "metro-athletics",
        logo_url: null,
        display_name: "Metro Athletics",
        account_type: "sports",
        active_status: "active",
        aliases: [],
        notes: null,
        contact_count: 2,
        location_count: 1,
        created_at: "2026-04-01T12:00:00.000Z",
        updated_at: "2026-04-01T12:00:00.000Z"
      }
    ],
    search: { query: filters?.search ?? "", total: 2 }
  }));
  getOrganizationDetailMock.mockResolvedValue({
    organization: {
      id: "org-sports",
      canonical_name: "metro-athletics",
      logo_url: null,
      display_name: "Metro Athletics",
      account_type: "sports",
      active_status: "active",
      aliases: [],
      notes: null,
      contact_count: 1,
      location_count: 1,
      created_at: "2026-04-01T12:00:00.000Z",
      updated_at: "2026-04-01T12:00:00.000Z"
    },
    contacts: [{ id: "contact-1", organization_id: "org-sports", first_name: "Casey", last_name: "Jones", full_name: "Casey Jones", title: "Coach", phone: "555-0000", email: "coach@example.com", photo_url: null, active_status: "active", notes: null, created_at: "2026-04-01T12:00:00.000Z", updated_at: "2026-04-01T12:00:00.000Z" }],
    locations: [{ id: "location-1", organization_id: "org-sports", location_name: "Metro Arena", address_line_1: null, address_line_2: null, city: null, state: null, zip: null, address_display: "Metro Arena", maps_label: null, maps_url: null, active_status: "active", notes: null, created_at: "2026-04-01T12:00:00.000Z", updated_at: "2026-04-01T12:00:00.000Z" }],
    recent_shoots: [],
    agreements_access: { can_view: false, can_manage: false },
    agreement_summary: { total: 0, active: 0, expiring_soon: 0, missing: 0 },
    agreements: [],
    agreement_templates: [],
    upcoming_shoot_agreement_risks: [],
    sales_pipeline_summary: { linked_opportunities: 0, active_opportunities: 0, dormant_opportunities: 0, open_alerts: 0, missing_next_action: 0, inactive_opportunities: 0, meeting_scheduled: 0 },
    sales_pipeline: []
  });
  getCentralJobOrganizationDefaultsMock.mockResolvedValue({
    organization_id: "org-sports",
    organization_name: "Metro Athletics",
    department: "sports",
    account_owner_user_id: baseUser.id,
    default_location_id: "location-1",
    default_location_name: "Metro Arena",
    default_primary_contact_id: "contact-1",
    default_primary_contact_name: "Casey Jones",
    timezone: "America/New_York",
    production_required: true,
    staffing_required: true
  });
  createCentralJobDraftMock.mockImplementation(async (_token: string, input: { department: CentralJobDepartment }) => makeDraftResponse(input.department));
  getCentralJobDraftMock.mockResolvedValue(
    makeDraftResponse("schools", {
      id: "draft-resume-1",
      title: "North High - Underclass - 2026-04-15",
      organization_id: "org-schools",
      organization_display_name: "North High",
      location_id: "location-1",
      location_display_name: "Metro Arena",
      primary_contact_id: "contact-1",
      primary_contact_name: "Casey Jones",
      start_date: "2026-04-15"
    })
  );
  listCentralJobDraftsMock.mockResolvedValue({
    drafts: [
      {
        id: "draft-resume-1",
        title: "North High - Underclass - 2026-04-15",
        department: "schools",
        job_number: null,
        organization_display_name: "North High",
        unresolved_organization_name: null,
        start_date: "2026-04-15",
        updated_at: "2026-04-01T12:00:00.000Z",
        created_at: "2026-04-01T11:00:00.000Z",
        job_owner_user_id: baseUser.id,
        job_owner_name: baseUser.fullName
      }
    ]
  });
  updateCentralJobDraftMock.mockImplementation(async (_token: string, _id: string, input: { department: CentralJobDepartment }) => makeDraftResponse(input.department));
  previewCentralJobDuplicatesMock.mockResolvedValue(clearDuplicateResult);
  publishCentralJobDraftMock.mockResolvedValue({
    intake: makeDraftResponse("sports"),
    duplicates: clearDuplicateResult,
    redirect_target: "/api/shoots/job-draft-1",
    downstream: { production_project_ids: [], staffing_requirement_ids: [] }
  } as CentralJobPublishResult);
  getSchoolsHubWorkspaceMock.mockResolvedValue(emptySchoolsWorkspace);
  getSchoolsHubReferenceDataMock.mockResolvedValue(emptySchoolsReferences);
  getSportsOverviewMock.mockResolvedValue(emptySportsOverview);
  getProjectWorkflowCommandCenterMock.mockResolvedValue({
    generated_at: "2026-04-04T12:00:00.000Z",
    view: "department",
    summary: {},
    alerts: [],
    steps: [],
    job_rows: []
  });
  listSharedJobsMock.mockResolvedValue({ jobs: [] });
  listSharedWatchlistMock.mockResolvedValue({
    items: [],
    summary: {
      total_count: 0,
      critical_count: 0,
      high_count: 0,
      snoozed_count: 0,
      ownerless_count: 0,
      next_24_hours_count: 0
    },
    saved_views: []
  });
  getSharedDashboardMock.mockResolvedValue({
    scope: "home",
    department_type: "schools",
    summary: {
      jobs_today: 0,
      jobs_next_7_days: 0,
      urgent_count: 0,
      critical_watch_count: 0,
      high_watch_count: 0,
      blocked_production_count: 0,
      overdue_approval_count: 0,
      delivery_risk_count: 0,
      staffing_gap_count: 0,
      missing_ready_confirmation_count: 0,
      overdue_checklist_count: 0,
      awaiting_checklist_approval_count: 0,
      rejected_checklist_count: 0,
      blocked_job_count: 0
    },
    health: { state: "success", score: 100, explanation: [] },
    widgets: [],
    widget_layout: { role_key: "schools", supports_personalization: false, items: [] },
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
  });
  listSharedTasksMock.mockResolvedValue({ items: [] });
  listSharedProductionQueueMock.mockResolvedValue({
    items: [],
    summary: {
      total_count: 0,
      blocked_count: 0,
      overdue_count: 0,
      awaiting_approval_count: 0,
      qa_pending_count: 0,
      due_today_count: 0
    }
  });
  listSharedAlertsMock.mockResolvedValue({
    items: [],
    summary: {
      unread_count: 0,
      critical_count: 0,
      acted_count: 0
    }
  });
  getSharedProductionReportingMock.mockResolvedValue({
    generated_at: "2026-04-01T12:00:00.000Z",
    department_type: "sports",
    summary: {
      total_open_items: 0,
      overdue_items: 0,
      blocked_items: 0,
      due_today: 0,
      due_this_week: 0,
      average_turnaround_days: null,
      on_time_release_percentage: null,
      average_stage_duration_days: null,
      rework_rate: 0,
      first_pass_approval_rate: null,
      file_mismatch_rate: 0,
      upload_failure_rate: 0,
      vendor_turnaround_days: null,
      completion_volume_this_week: 0,
      ready_for_qa_count: 0,
      ready_for_release_count: 0
    },
    management: {
      overdue_queue: [],
      blocked_queue: [],
      exception_view: [],
      team_workload: [],
      qa_performance: []
    },
    insights: {
      backlog_by_owner: [],
      backlog_by_department: [],
      qa_failure_categories: [],
      operational_burden_by_account: [],
      work_concentration_by_person: [],
      repeat_problem_organizations: [],
      post_shoot_eval_delay_signals: [],
      top_performers: []
    },
    trends: {
      by_day: [],
      by_week: []
    },
    urgent_watch: {
      total_count: 0,
      critical_count: 0,
      high_count: 0,
      blocked_count: 0,
      overdue_count: 0,
      next_24_hours_count: 0
    },
    restricted_overlays: null
  });
  apiFetchMock.mockResolvedValue({
    generated_at: "2026-04-01T12:00:00.000Z",
    anchor_date: "2026-04-01",
    sections: []
  });
});

describe("central job intake quick create", () => {
  it("saves a schools draft from the Schools entry point", async () => {
    renderSchoolsPage();
    const dialog = await openQuickCreate();
    const scope = within(dialog);

    fireEvent.change(getLabeledControl<HTMLInputElement>(dialog, "Unresolved organization placeholder", "input"), { target: { value: "North High" } });
    fireEvent.change(getLabeledControl<HTMLSelectElement>(dialog, "School Job Type", "select"), { target: { value: "fall_portraits" } });
    fireEvent.change(getLabeledControl<HTMLTextAreaElement>(dialog, "Internal Notes", "textarea"), { target: { value: "Need admin packet." } });
    fireEvent.click(scope.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => {
      expect(createCentralJobDraftMock).toHaveBeenCalledWith(
        "token-demo",
        expect.objectContaining({
          department: "schools",
          unresolved_organization_name: "North High",
          internal_notes: "Need admin packet.",
          school_detail: expect.objectContaining({ school_job_type: "fall_portraits" })
        })
      );
    });
    expect(previewCentralJobDuplicatesMock).toHaveBeenCalledWith("token-demo", "job-draft-1");
    expect(await scope.findByText(/saved as a draft/i)).toBeInTheDocument();
  });

  it("saves a sports draft from the sports-facing entry point", async () => {
    renderSportsPage();
    const dialog = await openQuickCreate("New Sports Job");

    fireEvent.change(getLabeledControl<HTMLInputElement>(dialog, "Unresolved organization placeholder", "input"), { target: { value: "Metro Athletics" } });
    fireEvent.change(getLabeledControl<HTMLSelectElement>(dialog, "Sports Job Type", "select"), { target: { value: "media_day" } });
    fireEvent.change(getLabeledControl<HTMLInputElement>(dialog, "Sport Name", "input"), { target: { value: "Hockey" } });
    fireEvent.change(getLabeledControl<HTMLTextAreaElement>(dialog, "Internal Notes", "textarea"), { target: { value: "Coach request pending." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Draft" }));

    await waitFor(() => {
      expect(createCentralJobDraftMock).toHaveBeenCalledWith(
        "token-demo",
        expect.objectContaining({
          department: "sports",
          job_type: "sports",
          unresolved_organization_name: "Metro Athletics",
          sports_detail: expect.objectContaining({ sports_job_type: "media_day", sport_name: "Hockey" })
        })
      );
    });
  });

  it("publishes successfully and redirects to the canonical job detail", async () => {
    const onPublished = vi.fn();
    render(
      <QuickCreateJobDrawer
        open
        token="token-demo"
        currentUser={{ ...baseUser, department: "sports" }}
        defaultDepartment="sports"
        launchLabel="Sports shoot surface"
        onClose={vi.fn()}
        onPublished={onPublished}
      />
    );
    const scope = within(screen.getByRole("dialog"));

    fireEvent.change(screen.getByPlaceholderText("Search canonical organizations"), { target: { value: "Metro" } });
    fireEvent.click(await scope.findByRole("button", { name: /metro athletics/i }));
    await waitFor(() => {
      expect(getLabeledControl<HTMLInputElement>(screen.getByRole("dialog"), "Timezone", "input")).toHaveValue("America/New_York");
    });
    fireEvent.change(getLabeledControl<HTMLSelectElement>(screen.getByRole("dialog"), "Sports Job Type", "select"), { target: { value: "media_day" } });
    fireEvent.change(getLabeledControl<HTMLInputElement>(screen.getByRole("dialog"), "Sport Name", "input"), { target: { value: "Hockey" } });
    fireEvent.change(getLabeledControl<HTMLInputElement>(screen.getByRole("dialog"), "Start Date", "input"), { target: { value: "2026-04-12" } });
    fireEvent.change(getLabeledControl<HTMLInputElement>(screen.getByRole("dialog"), "Start Time", "input"), { target: { value: "08:00" } });
    fireEvent.change(getLabeledControl<HTMLInputElement>(screen.getByRole("dialog"), "Staffing Estimate", "input"), { target: { value: "3" } });
    fireEvent.click(scope.getByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect(publishCentralJobDraftMock).toHaveBeenCalledWith("token-demo", "job-draft-1", { duplicate_override_note: null });
    });
    expect(onPublished).toHaveBeenCalledWith("job-draft-1");
  });

  it("publishes a schools quick-create draft through the same shared publish endpoint", async () => {
    const onPublished = vi.fn();
    render(
      <QuickCreateJobDrawer
        open
        token="token-demo"
        currentUser={baseUser}
        defaultDepartment="schools"
        launchLabel="Schools board"
        onClose={vi.fn()}
        onPublished={onPublished}
      />
    );
    const dialog = screen.getByRole("dialog");
    const scope = within(dialog);

    fireEvent.change(getLabeledControl<HTMLInputElement>(dialog, "Unresolved organization placeholder", "input"), {
      target: { value: "North High" }
    });
    fireEvent.change(getLabeledControl<HTMLSelectElement>(dialog, "School Job Type", "select"), {
      target: { value: "fall_portraits" }
    });
    fireEvent.change(getLabeledControl<HTMLTextAreaElement>(dialog, "Internal Notes", "textarea"), {
      target: { value: "Front office needs final confirmation." }
    });
    fireEvent.click(scope.getByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect(createCentralJobDraftMock).toHaveBeenCalledWith(
        "token-demo",
        expect.objectContaining({
          department: "schools",
          unresolved_organization_name: "North High",
          school_detail: expect.objectContaining({ school_job_type: "fall_portraits" })
        })
      );
    });
    await waitFor(() => {
      expect(publishCentralJobDraftMock).toHaveBeenCalledWith("token-demo", "job-draft-1", { duplicate_override_note: null });
    });
    expect(onPublished).toHaveBeenCalledWith("job-draft-1");
  });

  it("shows validation errors returned by the backend", async () => {
    createCentralJobDraftMock.mockRejectedValueOnce(
      new ApiClientError(400, "Validation failed", {
        field_errors: {
          unresolved_organization_name: ["Enter an organization placeholder or resolve the organization."]
        },
        form_errors: ["Draft minimum requirements are still missing."]
      })
    );

    render(
      <QuickCreateJobDrawer
        open
        token="token-demo"
        currentUser={baseUser}
        defaultDepartment="schools"
        launchLabel="Schools board"
        onClose={vi.fn()}
      />
    );
    const scope = within(screen.getByRole("dialog"));

    fireEvent.click(scope.getByRole("button", { name: "Save Draft" }));

    expect(await scope.findByText("Draft minimum requirements are still missing.")).toBeInTheDocument();
    expect(scope.getByText("Enter an organization placeholder or resolve the organization.")).toBeInTheDocument();
  });

  it("renders duplicate warnings from the shared duplicate preview", async () => {
    previewCentralJobDuplicatesMock.mockResolvedValueOnce({
      disposition: "soft_warning",
      hard_block: false,
      soft_warning: true,
      checked_at: "2026-04-01T12:00:00.000Z",
      matching_records: [
        {
          id: "job-existing",
          shoot_code: "SHOOT-900",
          job_number: "SCH-2026-00900",
          title: "North High - Fall Portraits - 2026-04-10",
          department: "schools",
          job_type: "schools_underclass_portraits",
          job_subtype: "fall_portraits",
          organization_id: "org-schools",
          organization_name: "North High",
          location_id: null,
          location_name: null,
          unresolved_location_name: null,
          primary_contact_id: null,
          primary_contact_name: null,
          start_date: "2026-04-10",
          delivery_due_date: null,
          record_state: "published",
          job_status: "confirmed",
          hard_block: false,
          soft_warning: true,
          matched_rules: ["same_org_same_type_near_date"]
        }
      ]
    });

    render(
      <QuickCreateJobDrawer
        open
        token="token-demo"
        currentUser={baseUser}
        defaultDepartment="schools"
        launchLabel="Schools board"
        onClose={vi.fn()}
      />
    );
    const dialog = screen.getByRole("dialog");
    const scope = within(dialog);

    fireEvent.change(getLabeledControl<HTMLInputElement>(dialog, "Unresolved organization placeholder", "input"), { target: { value: "North High" } });
    fireEvent.change(getLabeledControl<HTMLSelectElement>(dialog, "School Job Type", "select"), { target: { value: "fall_portraits" } });
    fireEvent.change(getLabeledControl<HTMLTextAreaElement>(dialog, "Internal Notes", "textarea"), { target: { value: "Need school confirmation." } });
    fireEvent.click(scope.getByRole("button", { name: "Save Draft" }));

    expect(await scope.findByText("A likely duplicate exists. Acknowledge it before publishing.")).toBeInTheDocument();
    expect(scope.getByText("North High - Fall Portraits - 2026-04-10")).toBeInTheDocument();
  });

  it("resumes an existing draft through the shared intake drawer", async () => {
    renderSchoolsPage();

    fireEvent.click(await screen.findByRole("button", { name: "Resume Drafts" }));
    expect(await screen.findByText("Saved intake drafts")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Resume Draft" }));

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(getCentralJobDraftMock).toHaveBeenCalledWith("token-demo", "draft-resume-1"));
    expect(within(dialog).getByDisplayValue("North High - Underclass - 2026-04-15")).toBeInTheDocument();
    expect(within(dialog).getByText("Draft active")).toBeInTheDocument();
  });

  it("autofills organization defaults when an organization is selected", async () => {
    render(
      <QuickCreateJobDrawer
        open
        token="token-demo"
        currentUser={{ ...baseUser, department: "sports" }}
        defaultDepartment="sports"
        launchLabel="Sports shoot surface"
        onClose={vi.fn()}
      />
    );
    const dialog = screen.getByRole("dialog");
    const scope = within(dialog);

    fireEvent.change(screen.getByPlaceholderText("Search canonical organizations"), { target: { value: "Metro" } });
    fireEvent.click(await scope.findByRole("button", { name: /metro athletics/i }));

    await waitFor(() => {
      expect(getLabeledControl<HTMLInputElement>(dialog, "Timezone", "input")).toHaveValue("America/New_York");
    });
    expect(await scope.findByText("Organization defaults loaded for Metro Athletics.")).toBeInTheDocument();
  });

  it("routes the Schools intake card into the bulk import workspace", async () => {
    renderSchoolsPage();

    fireEvent.click(await screen.findByRole("button", { name: "Import Jobs" }));

    expect(window.location.hash).toBe("#schools/import");
  });

  it("routes the sports intake card into the bulk import workspace", async () => {
    renderSportsPage();

    fireEvent.click(await screen.findByRole("button", { name: "Import Sports Jobs" }));

    expect(window.location.hash).toBe("#sports/jobs/import");
  });
});
