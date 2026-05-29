import { describe, expect, it } from "vitest";
import {
  buildDepartmentProductionTemplatePlan,
  buildLegacySchoolWorkDeliverableSeed,
  buildLegacySportsSpecialtyDeliverableSeed,
  evaluateProductionCompletionState,
  mapLegacyProductionProjectToProductionItemSeed,
  resolveProductionTemplateKey
} from "../src/services/jobTruth/productionBoardTemplates.js";

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    title: "Production Item",
    department_type: "schools",
    job_type: "photo_day",
    production_type: "schools_post_processing",
    proof_required: false,
    release_target: "gallery",
    vendor_name: null,
    workflow_status: "UPLOADED",
    release_status: "NOT_STARTED",
    completed_at: null,
    closed_at: null,
    imported_status_source: null,
    ...overrides
  } as const;
}

describe("production board department templates", () => {
  it("supports schools completion from gallery plus school outputs", () => {
    const plan = buildDepartmentProductionTemplatePlan({
      departmentType: "schools",
      jobCategory: "photo_day",
      title: "Lincoln Elementary",
      schoolProfile: {
        job_id: "job-1",
        tenant_id: "tenant-1",
        district_id: null,
        school_type: "elementary",
        school_year: "2026",
        grade_scope: "K-5",
        roster_source: "sis",
        id_cards_required: true,
        yearbook_required: true,
        composite_required: false,
        admin_portal_required: false,
        submission_deadline: null,
        advisor_sorting_required: true,
        homeroom_sorting_required: false,
        data_import_mode: null,
        special_instructions: null
      }
    });

    expect(plan.templateKey).toBe("schools_workflow");
    expect(plan.deliverableSeeds.map((seed) => seed.deliverable_type)).toEqual(
      expect.arrayContaining(["gallery_live", "gallery_email_sent", "yearbook_export_sent", "id_package_delivered"])
    );

    const completion = evaluateProductionCompletionState({
      item: baseItem(),
      plan,
      deliverables: [
        {
          deliverable_type: "gallery_live",
          title: "Gallery",
          status: "delivered",
          deliverable_group_key: "gallery",
          completion_marker_key: "gallery_release_event"
        },
        {
          deliverable_type: "yearbook_export_sent",
          title: "Yearbook",
          status: "sent",
          deliverable_group_key: "yearbook",
          completion_marker_key: "yearbook_export_sent"
        },
        {
          deliverable_type: "id_package_delivered",
          title: "ID",
          status: "delivered",
          deliverable_group_key: "id_package",
          completion_marker_key: "id_package_delivered"
        }
      ]
    });

    expect(completion.isCompleted).toBe(true);
    expect(completion.workflowStatus).toBe("DELIVERED_CLOSED");
  });

  it("supports sports completion from release state with legacy finished fallback", () => {
    const sportsPlan = buildDepartmentProductionTemplatePlan({
      departmentType: "sports",
      jobCategory: "photo_day",
      title: "Central High Sports",
      proofRequired: true,
      sportsProfile: {
        job_id: "job-2",
        tenant_id: "tenant-1",
        sport_type: "basketball",
        season: "winter",
        league_name: null,
        division: null,
        team_structure: "multi_team",
        estimated_team_count: 4,
        proof_required: true,
        approval_contact_id: null,
        billing_contact_id: null,
        revenue_share_enabled: false,
        revenue_share_terms_summary: null,
        banner_work_required: false,
        specialty_products_required: false,
        buddy_photos_required: false,
        sponsor_graphics_required: false,
        client_expectations_notes: null
      }
    });

    expect(sportsPlan.templateKey).toBe("sports_workflow");

    const released = evaluateProductionCompletionState({
      item: baseItem({
        department_type: "sports",
        production_type: "sports_post_processing",
        release_status: "RELEASED"
      }),
      plan: sportsPlan,
      deliverables: []
    });
    expect(released.isCompleted).toBe(true);

    const legacyFinished = evaluateProductionCompletionState({
      item: baseItem({
        department_type: "sports",
        production_type: "sports_post_processing",
        imported_status_source: "legacy_finished:released_complete"
      }),
      plan: sportsPlan,
      deliverables: []
    });
    expect(legacyFinished.isCompleted).toBe(true);
    expect(legacyFinished.evidence).toContain("legacy_finished");
  });

  it("supports specialty completion from template markers and detects photos-over-time templates", () => {
    expect(
      resolveProductionTemplateKey({
        departmentType: "other",
        jobCategory: "other",
        title: "Photos Over Time Preload",
        productionType: "preload_gallery"
      })
    ).toBe("photos_over_time");

    const specialtyPlan = buildDepartmentProductionTemplatePlan({
      departmentType: "sports",
      jobCategory: "specialty",
      title: "Banner and Vendor Work",
      productionType: "banner_specialty",
      vendorName: "Acme Print",
      proofRequired: true
    });

    expect(specialtyPlan.templateKey).toBe("specialty_workflow");
    expect(specialtyPlan.deliverableSeeds.map((seed) => seed.deliverable_group_key)).toEqual(
      expect.arrayContaining(["proofs", "vendor", "specialty_products", "delivery"])
    );

    const completion = evaluateProductionCompletionState({
      item: baseItem({
        department_type: "sports",
        job_type: "specialty",
        production_type: "banner_specialty",
        proof_required: true,
        vendor_name: "Acme Print"
      }),
      plan: specialtyPlan,
      deliverables: [
        {
          deliverable_type: "proof_packet_delivered",
          title: "Proof",
          status: "delivered",
          deliverable_group_key: "proofs",
          completion_marker_key: "proof_approval"
        },
        {
          deliverable_type: "vendor_print_batch_sent",
          title: "Vendor",
          status: "sent",
          deliverable_group_key: "vendor",
          completion_marker_key: "vendor_submission"
        },
        {
          deliverable_type: "specialty_products_delivered",
          title: "Specialty",
          status: "confirmed",
          deliverable_group_key: "specialty_products",
          completion_marker_key: "specialty_delivery_confirmation"
        },
        {
          deliverable_type: "client_email_sent",
          title: "Client Email",
          status: "sent",
          deliverable_group_key: "delivery",
          completion_marker_key: "email_sent"
        }
      ]
    });

    expect(completion.isCompleted).toBe(true);
  });

  it("maps legacy sources into shared production and deliverable metadata without dropping references", () => {
    const legacyItem = mapLegacyProductionProjectToProductionItemSeed({
      legacyId: "legacy-prod-1",
      departmentType: "sports",
      title: "Legacy Banner Workflow",
      jobType: "banner_specialty_product",
      stage: "released_complete",
      status: "completed",
      ownerUserId: "owner-1",
      peerReviewerUserId: "reviewer-1",
      finalQcReviewerUserId: "release-1",
      dueDate: "2026-08-22",
      completedAt: "2026-08-20T12:00:00.000Z"
    });

    expect(legacyItem.production_template_key).toBe("specialty_workflow");
    expect(legacyItem.imported_status_source).toBe("legacy_finished:completed");
    expect(legacyItem.legacy_source_reference).toBe("production_project:legacy-prod-1");
    expect(legacyItem.legacy_owner_history_json).toHaveLength(3);

    const schoolDeliverable = buildLegacySchoolWorkDeliverableSeed({
      legacyId: "school-work-1",
      workType: "yearbook",
      title: "Yearbook Export"
    });
    expect(schoolDeliverable.completion_marker_key).toBe("yearbook_export_sent");
    expect(schoolDeliverable.legacy_source_reference).toBe("school_work_item:school-work-1");

    const sportsDeliverable = buildLegacySportsSpecialtyDeliverableSeed({
      legacyId: "sport-specialty-1",
      productType: "banner",
      title: "Senior Night Banner",
      vendorName: "Print Vendor"
    });
    expect(sportsDeliverable.deliverable_group_key).toBe("banners");
    expect(sportsDeliverable.legacy_source_reference).toBe("sports_specialty_product_item:sport-specialty-1");
  });
});
