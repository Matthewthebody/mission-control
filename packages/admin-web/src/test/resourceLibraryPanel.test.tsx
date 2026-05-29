import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const apiFetchMock = vi.fn();

vi.mock("../api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  apiUrl: "http://localhost:4000"
}));

import { ResourceLibraryPanel } from "../components/ResourceLibraryPanel";
import type { ResourceLibraryItem, ResourceLibraryLearning, ResourceLibraryView } from "../types";

function buildItem(overrides: Partial<ResourceLibraryItem>): ResourceLibraryItem {
  return {
    id: "resource-default",
    organization_id: "org-1",
    organization_display_name: "Lakeside High School",
    location_id: "location-1",
    location_name: "Main Gym",
    shoot_id: null,
    shoot_code: null,
    shoot_title: null,
    uploader_user_id: "user-leadership",
    uploader_name: "Demo Leadership",
    resource_type: "image",
    category: "misc_internal_reference",
    note: null,
    issue_type: null,
    approval_status: "approved",
    visibility_scope: "photographer_prep",
    best_reference_candidate: false,
    is_best_reference: false,
    best_reference_category: null,
    file_name: "resource-default.jpg",
    content_type: "image/jpeg",
    file_size_bytes: 24000,
    storage_key: "tenants/demo/resource-default.jpg",
    preview_url: "https://example.test/resource-default.jpg",
    download_url: "https://example.test/resource-default.jpg",
    upload_source: "web_upload",
    gps_lat: null,
    gps_lng: null,
    shoot_date: null,
    captured_at: "2026-03-20T12:00:00.000Z",
    created_at: "2026-03-20T12:00:00.000Z",
    reviewed_at: "2026-03-20T12:30:00.000Z",
    reviewed_by_user_id: "user-leadership",
    reviewed_by_name: "Demo Leadership",
    review_note: null,
    linked_scope: "organization",
    ...overrides
  };
}

function buildLearning(overrides: Partial<ResourceLibraryLearning>): ResourceLibraryLearning {
  return {
    id: "learning-default",
    organization_id: "org-1",
    organization_display_name: "Lakeside High School",
    location_id: "location-1",
    location_name: "Main Gym",
    shoot_id: "shoot-1",
    shoot_name: "Lakeside High School Tennis",
    shoot_date: "2026-03-20",
    photographer_name: "Demo Senior Photographer",
    overall_rating: 4,
    recommendations: "Unload through the east doors first.",
    notes: "Keep the podium out of the frame line.",
    access_details: null,
    late_details: null,
    ...overrides
  };
}

describe("ResourceLibraryPanel", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it("renders recurring location intelligence and filters by linked Shoot date across items and learnings", () => {
    const priorSuccessfulExample = buildItem({
      id: "resource-prior",
      shoot_id: "shoot-1",
      shoot_code: "DEMO-001",
      shoot_title: "Lakeside High School Tennis",
      shoot_date: "2026-03-20",
      category: "prior_successful_example",
      is_best_reference: true,
      best_reference_candidate: true,
      best_reference_category: "best_setup_example",
      file_name: "portrait-winning-frame.jpg",
      linked_scope: "shoot"
    });

    const setupPhoto = buildItem({
      id: "resource-setup",
      shoot_id: "shoot-1",
      shoot_code: "DEMO-001",
      shoot_title: "Lakeside High School Tennis",
      shoot_date: "2026-03-20",
      category: "setup_photo",
      file_name: "setup-east-wall.jpg",
      linked_scope: "shoot"
    });

    const locationReference = buildItem({
      id: "resource-location",
      location_id: "location-2",
      location_name: "North Stadium Entrance",
      shoot_date: "2026-03-20",
      category: "location_reference",
      file_name: "north-stadium-entrance.png",
      linked_scope: "location"
    });

    const qrDocument = buildItem({
      id: "resource-document",
      organization_id: "org-2",
      organization_display_name: "North Metro Athletics",
      location_id: "location-2",
      location_name: "North Stadium Entrance",
      shoot_id: "shoot-2",
      shoot_code: "DEMO-002",
      shoot_title: "Friday Night Lights Media Day",
      shoot_date: "2025-02-14",
      resource_type: "document",
      category: "qr_code_job_document",
      file_name: "stadium-check-in.pdf",
      content_type: "application/pdf",
      storage_key: "tenants/demo/stadium-check-in.pdf",
      preview_url: "https://example.test/stadium-check-in.pdf",
      download_url: "https://example.test/stadium-check-in.pdf",
      linked_scope: "shoot"
    });

    const learning = buildLearning({
      id: "learning-shoot-2",
      organization_id: "org-2",
      organization_display_name: "North Metro Athletics",
      location_id: "location-2",
      location_name: "North Stadium Entrance",
      shoot_id: "shoot-2",
      shoot_name: "Friday Night Lights Media Day",
      shoot_date: "2025-02-14"
    });

    const library: ResourceLibraryView = {
      access: {
        can_manage: true,
        can_download: true,
        limited_view: false,
        historical_window_years: null
      },
      summary: {
        total_items: 4,
        media_count: 1,
        document_count: 1,
        best_reference_count: 1,
        pending_review_count: 0,
        leadership_only_count: 0,
        rejected_count: 0,
        prep_highlight_count: 4
      },
      review_queue: [],
      prep_highlights: [priorSuccessfulExample, setupPhoto, locationReference, qrDocument],
      media: [setupPhoto],
      documents: [qrDocument],
      historical_references: [priorSuccessfulExample, locationReference],
      post_shoot_learnings: [learning],
      recurring_location_intelligence: {
        best_reference: [priorSuccessfulExample],
        setup_photos_last_two_years: [setupPhoto],
        prior_successful_examples: [priorSuccessfulExample],
        documents_and_qr: [qrDocument],
        issue_watchouts: [],
        recent_post_shoot_evaluations: [learning],
        recurring_contacts: [
          {
            id: "contact-1",
            full_name: "Barb Byzee",
            title: "Activities Director",
            phone: "555-0100",
            email: "barb@example.com"
          }
        ],
        reminders: [
          {
            id: "reminder-1",
            source: "post_shoot_evaluation",
            label: "Remember next time",
            detail: "Unload through the east doors first.",
            created_at: "2026-03-20",
            shoot_name: "Lakeside High School Tennis",
            shoot_date: "2026-03-20"
          }
        ]
      }
    };

    render(<ResourceLibraryPanel library={library} scopeLabel="Shoot" />);

    expect(screen.getByText("Recurring Location Intelligence")).toBeInTheDocument();
    expect(screen.getByText("What To Know Next Time")).toBeInTheDocument();
    expect(screen.getByText("Recurring Contacts")).toBeInTheDocument();
    expect(screen.getByText("Maps / Access Reminders")).toBeInTheDocument();
    expect(screen.getByText("Previous Shoots at This Location")).toBeInTheDocument();
    expect(screen.getAllByText("Shoot Resource Center").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Prior Successful Examples").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Setup Photos").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Product / Design Examples").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Location References").length).toBeGreaterThan(0);
    expect(screen.getByText("Documents & QR Files")).toBeInTheDocument();
    expect(screen.getByLabelText("Organization")).toBeInTheDocument();
    expect(screen.getByLabelText("Location")).toBeInTheDocument();
    expect(screen.getByLabelText("Shoot")).toBeInTheDocument();
    expect(screen.getByLabelText("Shoot Date")).toBeInTheDocument();
    expect(screen.getAllByText("stadium-check-in.pdf").length).toBeGreaterThan(0);
    expect(screen.getByText("Barb Byzee")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Shoot Date"), { target: { value: "2026-03-20" } });

    expect(screen.getAllByText("portrait-winning-frame.jpg").length).toBeGreaterThan(0);
    expect(screen.getAllByText("setup-east-wall.jpg").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("stadium-check-in.pdf").length).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Post-Shoot Learnings" }));

    expect(screen.queryByText("Friday Night Lights Media Day")).not.toBeInTheDocument();
    expect(screen.getByText("No Post-Shoot learnings match the current filters for this Shoot.")).toBeInTheDocument();
  });

  it("lets leadership review pending items and promote a curated setup example into Best Reference", async () => {
    const pendingReviewItem = buildItem({
      id: "resource-review",
      shoot_id: "shoot-1",
      shoot_code: "DEMO-001",
      shoot_title: "Lakeside High School Tennis",
      shoot_date: "2026-03-20",
      category: "setup_photo",
      approval_status: "pending_review",
      best_reference_candidate: true,
      is_best_reference: false,
      best_reference_category: null,
      file_name: "setup-lobby-example.jpg",
      linked_scope: "shoot"
    });

    const library: ResourceLibraryView = {
      access: {
        can_manage: true,
        can_download: true,
        limited_view: false,
        historical_window_years: null
      },
      summary: {
        total_items: 1,
        media_count: 1,
        document_count: 0,
        best_reference_count: 0,
        pending_review_count: 1,
        leadership_only_count: 0,
        rejected_count: 0,
        prep_highlight_count: 1
      },
      review_queue: [pendingReviewItem],
      prep_highlights: [pendingReviewItem],
      media: [pendingReviewItem],
      documents: [],
      historical_references: [],
      post_shoot_learnings: [],
      recurring_location_intelligence: {
        best_reference: [],
        setup_photos_last_two_years: [pendingReviewItem],
        prior_successful_examples: [],
        documents_and_qr: [],
        issue_watchouts: [],
        recent_post_shoot_evaluations: [],
        recurring_contacts: [],
        reminders: []
      }
    };

    apiFetchMock.mockResolvedValueOnce({
      ...pendingReviewItem,
      approval_status: "approved",
      visibility_scope: "photographer_prep",
      is_best_reference: true,
      best_reference_category: "best_setup_example",
      review_note: "Use this next year."
    });

    render(<ResourceLibraryPanel library={library} scopeLabel="Location" token="token" />);

    expect(screen.getByText("Approval Workflow")).toBeInTheDocument();
    expect(screen.getByText("Retrieval Lanes")).toBeInTheDocument();
    expect(screen.getByText("Retention and visibility rules")).toBeInTheDocument();
    expect(screen.getByText("Best Reference Category Coverage")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Mark as Best Reference"));
    fireEvent.change(screen.getByLabelText("Best Reference Category"), {
      target: { value: "best_setup_example" }
    });
    fireEvent.change(screen.getByLabelText("Review Note"), {
      target: { value: "Use this next year." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Review" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/resource-library/items/resource-review/review",
        "token",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            approval_status: "approved",
            visibility_scope: "photographer_prep",
            category: "setup_photo",
            best_reference_candidate: true,
            is_best_reference: true,
            best_reference_category: "best_setup_example",
            review_note: "Use this next year."
          })
        })
      );
    });

    expect(await screen.findByText("setup-lobby-example.jpg was updated for future prep visibility.")).toBeInTheDocument();
    expect(screen.getAllByText("Best Reference").length).toBeGreaterThan(0);
  });

  it("keeps photographer retrieval preview-first and hides download actions", () => {
    const approvedPrepItem = buildItem({
      id: "resource-photographer",
      file_name: "setup-approved.jpg",
      category: "setup_photo",
      note: "Approved setup angle for next year.",
      linked_scope: "shoot"
    });

    const library: ResourceLibraryView = {
      access: {
        can_manage: false,
        can_download: false,
        limited_view: true,
        historical_window_years: 2
      },
      summary: {
        total_items: 1,
        media_count: 1,
        document_count: 0,
        best_reference_count: 0,
        pending_review_count: 0,
        leadership_only_count: 0,
        rejected_count: 0,
        prep_highlight_count: 1
      },
      review_queue: [],
      prep_highlights: [approvedPrepItem],
      media: [approvedPrepItem],
      documents: [],
      historical_references: [],
      post_shoot_learnings: [],
      recurring_location_intelligence: {
        best_reference: [],
        setup_photos_last_two_years: [approvedPrepItem],
        prior_successful_examples: [],
        documents_and_qr: [],
        issue_watchouts: [],
        recent_post_shoot_evaluations: [],
        recurring_contacts: [],
        reminders: []
      }
    };

    render(<ResourceLibraryPanel library={library} scopeLabel="Shoot" />);

    expect(screen.getByText("Photographer prep view")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download" })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[0]);

    expect(screen.getByRole("dialog", { name: "setup-approved.jpg preview" })).toBeInTheDocument();
    expect(screen.getByText("Retrieval Controls")).toBeInTheDocument();
    expect(screen.getAllByText(/Download stays leadership-only on photographer prep surfaces/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Approved setup angle for next year.").length).toBeGreaterThan(0);
  });
});
