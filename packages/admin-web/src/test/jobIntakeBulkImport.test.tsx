// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CentralJobImportPage } from "../pages/CentralJobImportPage";
import type {
  CentralJobDepartment,
  CentralJobImportFieldOption,
  CentralJobImportCommitMode,
  CentralJobImportSessionResponse
} from "../jobIntakeTypes";
import type { SessionUser } from "../types";

const createCentralJobImportSessionMock = vi.fn();
const getCentralJobImportSessionMock = vi.fn();
const updateCentralJobImportMappingMock = vi.fn();
const commitCentralJobImportSessionMock = vi.fn();

vi.mock("../featureFlags", () => ({
  featureFlags: {
    centralJobIntakeV1: true
  }
}));

vi.mock("../services/centralJobIntakeApi", () => ({
  createCentralJobImportSession: (...args: unknown[]) => createCentralJobImportSessionMock(...args),
  getCentralJobImportSession: (...args: unknown[]) => getCentralJobImportSessionMock(...args),
  updateCentralJobImportMapping: (...args: unknown[]) => updateCentralJobImportMappingMock(...args),
  commitCentralJobImportSession: (...args: unknown[]) => commitCentralJobImportSessionMock(...args)
}));

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
  permissions: ["shoot.create", "shoot.read", "shoot.update"],
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

function makeImportSession(
  department: CentralJobDepartment,
  overrides: Partial<CentralJobImportSessionResponse> = {}
): CentralJobImportSessionResponse {
  const supportedFields: CentralJobImportFieldOption[] = [
    { key: "organization_name", label: "Organization", section: "Organization / Location / Contacts", department: "shared", required_for_publish: true },
    { key: "job_type", label: "Job Type", section: "Job Type and Routing", department: "shared", required_for_publish: true },
    { key: "job_owner", label: "Job Owner", section: "Job Type and Routing", department: "shared", required_for_publish: true },
    { key: "start_date", label: "Start Date", section: "Schedule", department: "shared", required_for_publish: true },
    ...(department === "schools"
      ? ([
          { key: "school_job_type", label: "School Job Type", section: "Department Details", department: "schools", required_for_publish: true },
          { key: "roster_status", label: "Roster Status", section: "Department Details", department: "schools", required_for_publish: true }
        ] satisfies CentralJobImportFieldOption[])
      : ([
          { key: "sports_job_type", label: "Sports Job Type", section: "Department Details", department: "sports", required_for_publish: true },
          { key: "sport_name", label: "Sport Name", section: "Department Details", department: "sports", required_for_publish: true }
        ] satisfies CentralJobImportFieldOption[]))
  ];

  return {
    session: {
      id: "import-session-1",
      tenant_id: "tenant-demo",
      department,
      source_filename: department === "schools" ? "schools.csv" : "sports.csv",
      source_type: "csv",
      status: "uploaded",
      mappings: {},
      stats: {},
      created_by_user_id: baseUser.id,
      created_at: "2026-04-01T12:00:00.000Z",
      updated_at: "2026-04-01T12:00:00.000Z"
    },
    headers: [
      "Organization",
      "Location",
      "Primary Contact",
      "Job Type",
      "Job Owner",
      "Start Date",
      "Start Time",
      "Timezone",
      "Production Required",
      "Staffing Required",
      "Staffing Estimate",
      ...(department === "schools" ? ["School Job Type", "Roster Status"] : ["Sports Job Type", "Sport Name"])
    ],
    mapping: {
      organization_name: "Organization",
      location_name: "Location",
      primary_contact_name: "Primary Contact",
      job_type: "Job Type",
      job_owner: "Job Owner",
      start_date: "Start Date",
      start_time: "Start Time",
      timezone: "Timezone",
      production_required: "Production Required",
      staffing_required: "Staffing Required",
      staffing_estimate: "Staffing Estimate",
      ...(department === "schools"
        ? { school_job_type: "School Job Type", roster_status: "Roster Status" }
        : { sports_job_type: "Sports Job Type", sport_name: "Sport Name" })
    },
    supported_fields: supportedFields,
    rows: [],
    summary: {
      total_rows: 1,
      uploaded_rows: 1,
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
    },
    ...overrides
  };
}

function renderImportPage(props?: Partial<ComponentProps<typeof CentralJobImportPage>>) {
  window.location.hash = props?.routeHash ?? "#schools/import";
  return render(
    <CentralJobImportPage
      token="token-demo"
      currentUser={props?.currentUser ?? baseUser}
      department={props?.department ?? "schools"}
      contextLabel={props?.contextLabel ?? "Schools"}
      routeHash={props?.routeHash ?? "#schools/import"}
      returnHash={props?.returnHash ?? "#schools"}
    />
  );
}

beforeEach(() => {
  createCentralJobImportSessionMock.mockReset();
  getCentralJobImportSessionMock.mockReset();
  updateCentralJobImportMappingMock.mockReset();
  commitCentralJobImportSessionMock.mockReset();
});

describe("central job bulk import page", () => {
  it("uploads CSV text, preserves mapping, and surfaces validation exceptions", async () => {
    const staged = makeImportSession("schools");
    const validated = makeImportSession("schools", {
      session: {
        ...staged.session,
        status: "validated"
      },
      rows: [
        {
          id: "row-1",
          row_number: 1,
          status: "publish_ack_required",
          summary: {
            row_number: 1,
            title: "North High - Underclass - 2026-09-15",
            department: "schools",
            organization_name: "North High",
            location_name: "North High Gym",
            primary_contact_name: "Jordan Lee",
            start_date: "2026-09-15",
            delivery_due_date: null,
            job_type: "schools_underclass_portraits",
            department_subtype: "underclass"
          },
          normalized_input: {
            department: "schools",
            job_type: "schools_underclass_portraits",
            unresolved_organization_name: "North High",
            start_date: "2026-09-15"
          },
          validation_errors: [],
          validation_warnings: [
            { field: "location_name", code: "location_unresolved", message: "Location was not matched to an existing record.", severity: "warning" }
          ],
          duplicate_result: {
            disposition: "soft_warning",
            hard_block: false,
            soft_warning: true,
            checked_at: "2026-04-01T12:00:00.000Z",
            matching_records: [
              {
                id: "job-1",
                shoot_code: "SHOOT-100",
                job_number: "SCH-2026-00100",
                title: "North High - Underclass - 2026-09-12",
                match_source: "existing_job",
                department: "schools",
                job_type: "schools_underclass_portraits",
                job_subtype: "underclass",
                organization_id: "org-1",
                organization_name: "North High",
                location_id: null,
                location_name: null,
                unresolved_location_name: null,
                primary_contact_id: null,
                primary_contact_name: null,
                start_date: "2026-09-12",
                delivery_due_date: null,
                record_state: "published",
                job_status: "confirmed",
                hard_block: false,
                soft_warning: true,
                matched_rules: ["same_org_same_type_near_date"]
              }
            ]
          },
          readiness: { readiness_status: "needs_info", blockers: [], warnings: [], items: [] },
          can_create_draft: true,
          can_publish: false,
          can_publish_with_acknowledgement: true,
          linked_job_id: null
        }
      ],
      summary: {
        total_rows: 1,
        uploaded_rows: 0,
        exception_rows: 1,
        draft_ready_rows: 0,
        publish_ready_rows: 0,
        publish_ack_required_rows: 1,
        hard_duplicate_rows: 0,
        soft_duplicate_rows: 1,
        drafts_created: 0,
        jobs_published: 0,
        duplicates_blocked: 0,
        duplicates_overridden: 0
      }
    });

    createCentralJobImportSessionMock.mockResolvedValue(staged);
    updateCentralJobImportMappingMock.mockResolvedValue(validated);

    renderImportPage();

    const file = new File(
      ["Organization,Job Type,Job Owner,Start Date,School Job Type,Roster Status\nNorth High,schools_underclass_portraits,schools-office@example.com,2026-09-15,underclass,received"],
      "schools.csv",
      { type: "text/csv" }
    );
    fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Start Import Review" }));

    await waitFor(() => {
      expect(createCentralJobImportSessionMock).toHaveBeenCalledWith("token-demo", {
        department: "schools",
        source_filename: "schools.csv",
        csv_text: expect.stringContaining("North High")
      });
    });

    expect(await screen.findByRole("button", { name: "Validate Rows" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Validate Rows" }));

    await waitFor(() => {
      expect(updateCentralJobImportMappingMock).toHaveBeenCalledWith("token-demo", "import-session-1", {
        mapping: expect.objectContaining({ organization_name: "Organization", school_job_type: "School Job Type" })
      });
    });

    expect(await screen.findByText("Duplicate review")).toBeInTheDocument();
    expect(screen.getByText("Location was not matched to an existing record.")).toBeInTheDocument();
    expect(screen.getByText("SHOOT-100: North High - Underclass - 2026-09-12")).toBeInTheDocument();
  });

  it("commits imports in draft-only mode by default", async () => {
    const staged = makeImportSession("schools");
    const validated = makeImportSession("schools", {
      session: { ...staged.session, status: "validated" },
      rows: [
        {
          id: "row-1",
          row_number: 1,
          status: "draft_ready",
          summary: {
            row_number: 1,
            title: "North High - Underclass - 2026-09-15",
            department: "schools",
            organization_name: "North High",
            location_name: null,
            primary_contact_name: null,
            start_date: "2026-09-15",
            delivery_due_date: null,
            job_type: "schools_underclass_portraits",
            department_subtype: "underclass"
          },
          normalized_input: { department: "schools", job_type: "schools_underclass_portraits", start_date: "2026-09-15" },
          validation_errors: [],
          validation_warnings: [],
          duplicate_result: null,
          readiness: { readiness_status: "needs_info", blockers: [], warnings: [], items: [] },
          can_create_draft: true,
          can_publish: false,
          can_publish_with_acknowledgement: false,
          linked_job_id: null
        }
      ],
      summary: {
        total_rows: 1,
        uploaded_rows: 0,
        exception_rows: 0,
        draft_ready_rows: 1,
        publish_ready_rows: 0,
        publish_ack_required_rows: 0,
        hard_duplicate_rows: 0,
        soft_duplicate_rows: 0,
        drafts_created: 0,
        jobs_published: 0,
        duplicates_blocked: 0,
        duplicates_overridden: 0
      }
    });

    const committed = {
      session: { ...validated.session, status: "committed" },
      summary: {
        ...validated.summary,
        drafts_created: 1
      },
      rows: [
        {
          ...validated.rows[0],
          status: "draft_created",
          linked_job_id: "job-draft-1"
        }
      ],
      commit_mode: "create_drafts_only" as CentralJobImportCommitMode
    };

    createCentralJobImportSessionMock.mockResolvedValue(staged);
    updateCentralJobImportMappingMock.mockResolvedValue(validated);
    commitCentralJobImportSessionMock.mockResolvedValue(committed);
    getCentralJobImportSessionMock.mockResolvedValue({
      ...validated,
      session: committed.session,
      rows: committed.rows,
      summary: committed.summary
    });

    renderImportPage();

    const file = new File(
      ["Organization,Job Type,Job Owner,Start Date,School Job Type,Roster Status\nNorth High,schools_underclass_portraits,schools-office@example.com,2026-09-15,underclass,received"],
      "schools.csv",
      { type: "text/csv" }
    );
    fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Start Import Review" }));
    await screen.findByText("Import Summary");

    fireEvent.click(screen.getByRole("button", { name: "Validate Rows" }));
    await screen.findByRole("button", { name: "Commit Import" });

    fireEvent.click(screen.getByRole("button", { name: "Commit Import" }));

    await waitFor(() => {
      expect(commitCentralJobImportSessionMock).toHaveBeenCalledWith("token-demo", "import-session-1", {
        mode: "create_drafts_only",
        acknowledge_soft_duplicates: false,
        override_hard_duplicates: false,
        duplicate_override_note: null
      });
    });

    expect(await screen.findByText(/1 drafts created, 0 jobs published, 0 rows still need review/i)).toBeInTheDocument();
  });

  it("allows leadership to publish valid rows from the same import workspace", async () => {
    const staged = makeImportSession("sports", {
      session: {
        id: "import-session-2",
        tenant_id: "tenant-demo",
        department: "sports",
        source_filename: "sports.csv",
        source_type: "csv",
        status: "validated",
        mappings: {},
        stats: {},
        created_by_user_id: baseUser.id,
        created_at: "2026-04-01T12:00:00.000Z",
        updated_at: "2026-04-01T12:00:00.000Z"
      },
      rows: [
        {
          id: "row-1",
          row_number: 1,
          status: "publish_ready",
          summary: {
            row_number: 1,
            title: "Metro Athletics - Hockey Media Day - 2026-10-20",
            department: "sports",
            organization_name: "Metro Athletics",
            location_name: "Metro Arena",
            primary_contact_name: "Coach Casey",
            start_date: "2026-10-20",
            delivery_due_date: null,
            job_type: "sports",
            department_subtype: "media_day"
          },
          normalized_input: { department: "sports", job_type: "sports", start_date: "2026-10-20" },
          validation_errors: [],
          validation_warnings: [],
          duplicate_result: null,
          readiness: { readiness_status: "ready", blockers: [], warnings: [], items: [] },
          can_create_draft: true,
          can_publish: true,
          can_publish_with_acknowledgement: true,
          linked_job_id: null
        }
      ],
      summary: {
        total_rows: 1,
        uploaded_rows: 0,
        exception_rows: 0,
        draft_ready_rows: 0,
        publish_ready_rows: 1,
        publish_ack_required_rows: 0,
        hard_duplicate_rows: 0,
        soft_duplicate_rows: 0,
        drafts_created: 0,
        jobs_published: 0,
        duplicates_blocked: 0,
        duplicates_overridden: 0
      }
    });

    commitCentralJobImportSessionMock.mockResolvedValue({
      session: { ...staged.session, status: "committed" },
      summary: { ...staged.summary, jobs_published: 1 },
      rows: [{ ...staged.rows[0], status: "published", linked_job_id: "job-live-1" }],
      commit_mode: "publish_valid_rows_leave_exceptions" as CentralJobImportCommitMode
    });
    getCentralJobImportSessionMock.mockResolvedValue({
      ...staged,
      session: { ...staged.session, status: "committed" },
      rows: [{ ...staged.rows[0], status: "published", linked_job_id: "job-live-1" }],
      summary: { ...staged.summary, jobs_published: 1 }
    });

    renderImportPage({
      currentUser: { ...baseUser, authorityTier: "leadership", department: "sports" },
      department: "sports",
      contextLabel: "Sports",
      routeHash: "#operations/shoots/import?session=import-session-2",
      returnHash: "#operations/shoots"
    });

    expect(await screen.findByRole("button", { name: "Commit Import" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Publish Valid Rows and Leave Exceptions/i }));
    fireEvent.click(screen.getByRole("button", { name: "Commit Import" }));

    await waitFor(() => {
      expect(commitCentralJobImportSessionMock).toHaveBeenCalledWith("token-demo", "import-session-2", {
        mode: "publish_valid_rows_leave_exceptions",
        acknowledge_soft_duplicates: false,
        override_hard_duplicates: false,
        duplicate_override_note: null
      });
    });
  });

  it("keeps batch publish disabled for standard users and explains the restriction", async () => {
    const staged = makeImportSession("schools", {
      session: {
        id: "import-session-3",
        tenant_id: "tenant-demo",
        department: "schools",
        source_filename: "schools.csv",
        source_type: "csv",
        status: "validated",
        mappings: {},
        stats: {},
        created_by_user_id: baseUser.id,
        created_at: "2026-04-01T12:00:00.000Z",
        updated_at: "2026-04-01T12:00:00.000Z"
      },
      rows: [
        {
          id: "row-1",
          row_number: 1,
          status: "publish_ready",
          summary: {
            row_number: 1,
            title: "North High - Fall Portraits - 2026-09-18",
            department: "schools",
            organization_name: "North High",
            location_name: "North High Gym",
            primary_contact_name: "Jordan Lee",
            start_date: "2026-09-18",
            delivery_due_date: null,
            job_type: "schools_underclass_portraits",
            department_subtype: "fall_portraits"
          },
          normalized_input: { department: "schools", job_type: "schools_underclass_portraits", start_date: "2026-09-18" },
          validation_errors: [],
          validation_warnings: [],
          duplicate_result: null,
          readiness: { readiness_status: "ready", blockers: [], warnings: [], items: [] },
          can_create_draft: true,
          can_publish: true,
          can_publish_with_acknowledgement: true,
          linked_job_id: null
        }
      ],
      summary: {
        total_rows: 1,
        uploaded_rows: 0,
        exception_rows: 0,
        draft_ready_rows: 0,
        publish_ready_rows: 1,
        publish_ack_required_rows: 0,
        hard_duplicate_rows: 0,
        soft_duplicate_rows: 0,
        drafts_created: 0,
        jobs_published: 0,
        duplicates_blocked: 0,
        duplicates_overridden: 0
      }
    });

    getCentralJobImportSessionMock.mockResolvedValue(staged);

    renderImportPage({
      currentUser: { ...baseUser, authorityTier: "standard" },
      department: "schools",
      contextLabel: "Schools",
      routeHash: "#schools/import?session=import-session-3",
      returnHash: "#schools"
    });

    expect(await screen.findByRole("button", { name: "Commit Import" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Publish Valid Rows and Leave Exceptions/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Publish All Valid Rows With Acknowledgement/i })).toBeDisabled();
    expect(
      screen.getByText("You can stage and create drafts from import, but only leads and admins can batch publish rows.")
    ).toBeInTheDocument();
  });
});
