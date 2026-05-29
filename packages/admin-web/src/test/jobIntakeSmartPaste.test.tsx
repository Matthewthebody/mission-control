// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../api";
import { SmartPasteJobDrawer } from "../components/jobIntake/SmartPasteJobDrawer";
import type {
  CentralJobDepartment,
  CentralJobDraftResponse,
  CentralJobDuplicateResult,
  CentralJobPublishResult,
  CentralJobSmartPasteParseResult
} from "../jobIntakeTypes";
import type { SessionUser } from "../types";

const listDirectoryOwnerOptionsMock = vi.fn();
const listOrganizationsMock = vi.fn();
const getOrganizationDetailMock = vi.fn();
const createCentralJobDraftMock = vi.fn();
const updateCentralJobDraftMock = vi.fn();
const previewCentralJobDuplicatesMock = vi.fn();
const publishCentralJobDraftMock = vi.fn();
const parseCentralJobIntakeTextMock = vi.fn();
const getCentralJobOrganizationDefaultsMock = vi.fn();

vi.mock("../services/organizationApi", () => ({
  listDirectoryOwnerOptions: (...args: unknown[]) => listDirectoryOwnerOptionsMock(...args),
  listOrganizations: (...args: unknown[]) => listOrganizationsMock(...args),
  getOrganizationDetail: (...args: unknown[]) => getOrganizationDetailMock(...args)
}));

vi.mock("../services/centralJobIntakeApi", () => ({
  createCentralJobDraft: (...args: unknown[]) => createCentralJobDraftMock(...args),
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

const clearDuplicateResult: CentralJobDuplicateResult = {
  disposition: "clear",
  hard_block: false,
  soft_warning: false,
  matching_records: [],
  checked_at: "2026-04-01T12:00:00.000Z"
};

function makeDraftResponse(department: CentralJobDepartment, rawSourceText: string): CentralJobDraftResponse {
  return {
    job: {
      id: "job-draft-1",
      tenant_id: "tenant-demo",
      shoot_code: "SHOOT-001",
      title: department === "schools" ? "North High - Fall Portraits - 2026-09-14" : "Metro Athletics - Hockey Media Day - 2026-10-22",
      organization_display_name: null,
      location_display_name: null,
      primary_contact_name: null,
      job_number: null,
      department,
      job_type: department === "sports" ? "sports" : "schools_underclass_portraits",
      source_reference: null,
      record_state: "draft",
      job_status: "new",
      readiness_status: "needs_info",
      sync_status: "not_linked",
      organization_id: null,
      unresolved_organization_name: department === "schools" ? "North High" : "Metro Athletics",
      location_id: null,
      unresolved_location_name: null,
      primary_contact_id: null,
      unresolved_primary_contact_name: null,
      account_owner_user_id: null,
      job_owner_user_id: baseUser.id,
      start_date: department === "schools" ? "2026-09-14" : "2026-10-22",
      schedule_date_placeholder: false,
      start_time: department === "schools" ? "08:15:00" : "18:30:00",
      end_time: null,
      timezone: "America/Chicago",
      date_only: false,
      start_time_confirmed: true,
      is_multi_day: false,
      delivery_due_date: null,
      production_required: true,
      staffing_required: true,
      staffing_estimate: department === "sports" ? 2 : null,
      priority: "normal",
      delivery_type: null,
      production_grouping_rule: "one_per_job",
      request_source: "smart_paste",
      internal_notes: null,
      client_notes: null,
      special_instructions: null,
      raw_source_text: rawSourceText,
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
    school_detail:
      department === "schools"
        ? ({
            shoot_id: "job-draft-1",
            school_job_type: "fall_portraits",
            school_type: null,
            student_count_estimate: null,
            staff_count_estimate: null,
            grade_range: null,
            camera_count_estimate: null,
            roster_status: "Requested",
            roster_due_date: null,
            id_required: false,
            id_sort_method: null,
            yearbook_required: false,
            yearbook_due_date: null,
            staff_packages_required: false,
            parent_communication_needed: false,
            background_requirements: null,
            school_day_notes: null,
            building_instructions: null,
            photo_day_special_notes: null
          } satisfies CentralJobDraftResponse["school_detail"])
        : null,
    sports_detail:
      department === "sports"
        ? ({
            shoot_id: "job-draft-1",
            sports_job_type: "media_day",
            sport_name: "Hockey",
            season: null,
            level_or_age_group: null,
            team_count_estimate: null,
            athlete_count_estimate: null,
            coach_count_estimate: null,
            coach_contact_id: null,
            alternate_team_contact_id: null,
            specialty_products_required: false,
            specialty_product_types: [],
            gallery_required: false,
            delivery_deadline_type: null,
            uniform_notes: null,
            sponsor_notes: null,
            event_notes: null,
            on_site_sales_notes: null
          } satisfies CentralJobDraftResponse["sports_detail"])
        : null,
    draft_validation: { valid: true, errors: [], warnings: [] },
    publish_validation: { valid: false, errors: [], warnings: [] },
    readiness: { readiness_status: "needs_info", blockers: [], warnings: [], items: [] },
    production_items: [],
    staffing_requirements: [],
    activity_log: []
    };
  }

function makeParseResult(
  department: CentralJobDepartment,
  overrides: Partial<CentralJobSmartPasteParseResult> = {}
): CentralJobSmartPasteParseResult {
  return {
    raw_text:
      overrides.raw_text ??
      (department === "schools"
        ? "School: North High\nDate: 2026-09-14\nTime: 8:15 AM\nSchool Job Type: Fall Portraits"
        : "Organization: Metro Athletics\nSport: Hockey\nDate: 10/22/2026\nTime: 6:30 PM\nEvent Type: Media Day"),
    department_hint: department,
    parsed_input:
      overrides.parsed_input ??
      (department === "schools"
        ? {
            department: "schools",
            job_type: "schools_underclass_portraits",
            request_source: "smart_paste",
            unresolved_organization_name: "North High",
            start_date: "2026-09-14",
            start_time: "08:15:00",
            timezone: "America/Chicago",
            raw_source_text: "School: North High\nDate: 2026-09-14\nTime: 8:15 AM\nSchool Job Type: Fall Portraits",
            school_detail: {
              school_job_type: "fall_portraits",
              roster_status: "Requested"
            }
          }
        : {
            department: "sports",
            job_type: "sports",
            request_source: "smart_paste",
            unresolved_organization_name: "Metro Athletics",
            start_date: "2026-10-22",
            start_time: "18:30:00",
            timezone: "America/Chicago",
            staffing_required: true,
            staffing_estimate: 2,
            raw_source_text: "Organization: Metro Athletics\nSport: Hockey\nDate: 10/22/2026\nTime: 6:30 PM\nEvent Type: Media Day",
            sports_detail: {
              sports_job_type: "media_day",
              sport_name: "Hockey"
            }
          }),
    inferred_fields:
      overrides.inferred_fields ??
      [
        {
          field: "unresolved_organization_name",
          label: "Organization Candidate",
          value: department === "schools" ? "North High" : "Metro Athletics",
          display_value: department === "schools" ? "North High" : "Metro Athletics",
          confidence_band: "high",
          confidence_score: 0.94,
          source_span: { start: 8, end: 18, text: department === "schools" ? "North High" : "Metro Athletics" },
          requires_confirmation: false
        }
      ],
    unresolved_entities:
      overrides.unresolved_entities ??
      {
        organization: {
          kind: "organization",
          value: department === "schools" ? "North High" : "Metro Athletics",
          confidence_band: "high",
          confidence_score: 0.94,
          source_span: { start: 8, end: 18, text: department === "schools" ? "North High" : "Metro Athletics" },
          requires_confirmation: false
        },
        location: null,
        primary_contact: null
      },
    warnings: overrides.warnings ?? []
  };
}

beforeEach(() => {
  listDirectoryOwnerOptionsMock.mockReset();
  listOrganizationsMock.mockReset();
  getOrganizationDetailMock.mockReset();
  createCentralJobDraftMock.mockReset();
  updateCentralJobDraftMock.mockReset();
  previewCentralJobDuplicatesMock.mockReset();
  publishCentralJobDraftMock.mockReset();
  parseCentralJobIntakeTextMock.mockReset();
  getCentralJobOrganizationDefaultsMock.mockReset();

  listDirectoryOwnerOptionsMock.mockResolvedValue({
    owners: [{ user_id: baseUser.id, full_name: baseUser.fullName, email: baseUser.email, department: baseUser.department, status: "active" }]
  });
  listOrganizationsMock.mockResolvedValue({ organizations: [], search: { query: "", total: 0 } });
  getOrganizationDetailMock.mockResolvedValue({
    organization: { id: "org-1", display_name: "North High" },
    contacts: [],
    locations: [],
    recent_shoots: [],
    agreements_access: { can_view: false, can_manage: false },
    agreement_summary: { total: 0, active: 0, expiring_soon: 0, missing: 0 },
    agreements: [],
    agreement_templates: [],
    upcoming_shoot_agreement_risks: [],
    notes: []
  });
  getCentralJobOrganizationDefaultsMock.mockResolvedValue({
    organization_id: "org-1",
    organization_name: "North High",
    department: "schools",
    account_owner_user_id: null,
    default_location_id: null,
    default_location_name: null,
    default_primary_contact_id: null,
    default_primary_contact_name: null,
    timezone: "America/Chicago",
    production_required: true,
    staffing_required: true
  });
  previewCentralJobDuplicatesMock.mockResolvedValue(clearDuplicateResult);
});

describe("Smart Paste job intake", () => {
  it("saves a schools smart-paste draft through the shared draft endpoint", async () => {
    const parseResult = makeParseResult("schools");
    parseCentralJobIntakeTextMock.mockResolvedValue(parseResult);
    createCentralJobDraftMock.mockResolvedValue(makeDraftResponse("schools", parseResult.raw_text));

    render(
      <SmartPasteJobDrawer
        open
        token="token-demo"
        currentUser={baseUser}
        defaultDepartment="schools"
        launchLabel="Schools board"
        onClose={() => undefined}
      />
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Raw Request Text" }), {
      target: { value: parseResult.raw_text }
    });
    fireEvent.click(screen.getByRole("button", { name: "Parse" }));

    await waitFor(() => expect(parseCentralJobIntakeTextMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(createCentralJobDraftMock).toHaveBeenCalledTimes(1));
    expect(createCentralJobDraftMock).toHaveBeenCalledWith(
      "token-demo",
      expect.objectContaining({
        request_source: "smart_paste",
        raw_source_text: parseResult.raw_text,
        unresolved_organization_name: "North High"
      })
    );
  });

  it("requires manual correction for low-confidence linked fields before saving", async () => {
    const parseResult = makeParseResult("schools", {
      raw_text: "Portraits for Central next Tuesday. Talk to Sam.",
      parsed_input: {
        department: "schools",
        job_type: "schools_underclass_portraits",
        request_source: "smart_paste",
        unresolved_organization_name: "Central",
        start_date: "2026-09-14",
        raw_source_text: "Portraits for Central next Tuesday. Talk to Sam.",
        school_detail: {
          school_job_type: "fall_portraits",
          roster_status: "Requested"
        }
      },
      inferred_fields: [
        {
          field: "unresolved_organization_name",
          label: "Organization Candidate",
          value: "Central",
          display_value: "Central",
          confidence_band: "low",
          confidence_score: 0.42,
          source_span: { start: 14, end: 21, text: "Central" },
          requires_confirmation: true
        }
      ],
      unresolved_entities: {
        organization: {
          kind: "organization",
          value: "Central",
          confidence_band: "low",
          confidence_score: 0.42,
          source_span: { start: 14, end: 21, text: "Central" },
          requires_confirmation: true
        },
        location: null,
        primary_contact: null
      }
    });
    parseCentralJobIntakeTextMock.mockResolvedValue(parseResult);
    createCentralJobDraftMock.mockResolvedValue(makeDraftResponse("schools", parseResult.raw_text));

    render(
      <SmartPasteJobDrawer
        open
        token="token-demo"
        currentUser={baseUser}
        defaultDepartment="schools"
        launchLabel="Schools board"
        onClose={() => undefined}
      />
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Raw Request Text" }), {
      target: { value: parseResult.raw_text }
    });
    fireEvent.click(screen.getByRole("button", { name: "Parse" }));

    await waitFor(() => expect(parseCentralJobIntakeTextMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    expect(createCentralJobDraftMock).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Confirm the low-confidence organization candidate before saving or publishing.")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Keep Placeholder" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(createCentralJobDraftMock).toHaveBeenCalledTimes(1));
  });

  it("publishes a sports smart-paste draft through the shared publish endpoint", async () => {
    const parseResult = makeParseResult("sports");
    parseCentralJobIntakeTextMock.mockResolvedValue(parseResult);
    createCentralJobDraftMock.mockResolvedValue(makeDraftResponse("sports", parseResult.raw_text));
    publishCentralJobDraftMock.mockResolvedValue({
      intake: makeDraftResponse("sports", parseResult.raw_text),
      duplicates: clearDuplicateResult,
      redirect_target: "/api/shoots/job-draft-1",
      downstream: {
        production_project_ids: ["prod-1"],
        staffing_requirement_ids: ["staff-1"]
      }
    } satisfies CentralJobPublishResult);

    const onPublished = vi.fn();

    render(
      <SmartPasteJobDrawer
        open
        token="token-demo"
        currentUser={{ ...baseUser, department: "sports", authorityTier: "leadership" }}
        defaultDepartment="sports"
        launchLabel="Sports shoot surface"
        onClose={() => undefined}
        onPublished={onPublished}
      />
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Raw Request Text" }), {
      target: { value: parseResult.raw_text }
    });
    fireEvent.click(screen.getByRole("button", { name: "Parse" }));

    await waitFor(() => expect(parseCentralJobIntakeTextMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect(createCentralJobDraftMock).toHaveBeenCalledWith(
        "token-demo",
        expect.objectContaining({
          request_source: "smart_paste",
          raw_source_text: parseResult.raw_text,
          department: "sports",
          sports_detail: expect.objectContaining({
            sports_job_type: "media_day",
            sport_name: "Hockey"
          })
        })
      );
    });
    await waitFor(() => {
      expect(publishCentralJobDraftMock).toHaveBeenCalledWith("token-demo", "job-draft-1", {
        duplicate_override_note: null
      });
    });
    expect(onPublished).toHaveBeenCalledWith("job-draft-1");
  });
});
