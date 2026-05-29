import { describe, expect, it } from "vitest";
import type {
  ApprovalRequestRecord,
  JobDayRecord,
  JobReadinessItemRecord,
  JobRecord,
  JobStaffAssignmentRecord,
  JobStatusSnapshot,
  JobValidationResult,
  ProductionIssueRecord,
  ProductionItemRecord
} from "../src/types/jobTruth.js";
import {
  buildJobDayReadyTransitionValidation,
  buildJobWorkflowSummary,
  buildProductionWorkflowTransitionValidation,
  buildPublishWorkflowValidation
} from "../src/services/jobTruth/workflowStateEngine.js";

function buildJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    tenant_id: "tenant-1",
    legacy_shoot_id: null,
    job_number: null,
    department_type: "sports",
    job_category: "photo_day",
    organization_id: "org-1",
    primary_location_id: "loc-1",
    primary_contact_id: "contact-1",
    account_owner_user_id: "user-1",
    title: "Metro Media Day",
    event_name: null,
    description_internal: null,
    job_status: "confirmed",
    production_status: "queued",
    staffing_status: "partially_staffed",
    readiness_status: "at_risk",
    sync_status: "clean",
    risk_status: "medium",
    priority_level: "normal",
    delivery_type: null,
    gallery_type: null,
    scheduled_start_at: "2026-08-22T14:00:00.000Z",
    scheduled_end_at: "2026-08-22T18:00:00.000Z",
    timezone: "America/Chicago",
    estimated_subject_count: null,
    actual_subject_count: null,
    estimated_staff_count: null,
    actual_staff_count: null,
    client_deadline_at: null,
    production_deadline_at: null,
    published_at: null,
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
    ...overrides
  };
}

function buildDay(overrides: Partial<JobDayRecord> = {}): JobDayRecord {
  return {
    id: "day-1",
    tenant_id: "tenant-1",
    job_id: "job-1",
    legacy_shoot_day_id: null,
    day_label: "Day 1",
    date: "2026-08-22",
    start_time: "09:00",
    end_time: "13:00",
    timezone: "America/Chicago",
    location_id: "loc-1",
    onsite_contact_id: "contact-1",
    lead_user_id: "lead-1",
    day_status: "scheduled",
    weather_sensitive: false,
    indoor_outdoor: null,
    access_notes: null,
    parking_notes: null,
    setup_notes: null,
    travel_notes: null,
    check_in_window_start: null,
    check_in_window_end: null,
    ready_confirmed_at: null,
    ready_confirmed_by_user_id: null,
    created_by_user_id: "user-1",
    updated_by_user_id: "user-1",
    created_at: "2026-04-01T12:00:00.000Z",
    updated_at: "2026-04-01T12:00:00.000Z",
    ...overrides
  };
}

function buildAssignment(overrides: Partial<JobStaffAssignmentRecord> = {}): JobStaffAssignmentRecord {
  return {
    id: "assignment-1",
    tenant_id: "tenant-1",
    job_id: "job-1",
    job_day_id: "day-1",
    user_id: "lead-1",
    assignment_role: "lead_photographer",
    assignment_status: "assigned",
    is_lead: true,
    check_in_at: null,
    check_out_at: null,
    is_ready_present: false,
    notes: null,
    created_by_user_id: "user-1",
    updated_by_user_id: "user-1",
    created_at: "2026-04-01T12:00:00.000Z",
    updated_at: "2026-04-01T12:00:00.000Z",
    ...overrides
  };
}

function buildReadinessItem(overrides: Partial<JobReadinessItemRecord> = {}): JobReadinessItemRecord {
  return {
    id: "readiness-1",
    tenant_id: "tenant-1",
    job_id: "job-1",
    job_day_id: null,
    section_key: "schedule",
    label: "Schedule confirmed",
    description: null,
    is_required: true,
    is_blocker: true,
    is_complete: false,
    completed_at: null,
    completed_by_user_id: null,
    due_at: null,
    sort_order: 1,
    source_template_key: null,
    notes: null,
    created_at: "2026-04-01T12:00:00.000Z",
    updated_at: "2026-04-01T12:00:00.000Z",
    ...overrides
  };
}

function buildProductionItem(overrides: Partial<ProductionItemRecord> = {}): ProductionItemRecord {
  return {
    id: "production-1",
    tenant_id: "tenant-1",
    job_id: "job-1",
    job_day_id: "day-1",
    production_group_key: "default",
    title: "Proof Gallery",
    job_type: null,
    production_type: "gallery",
    production_template_key: null,
    completion_rule_key: null,
    created_from_source: "manual",
    status: "queued",
    workflow_status: "READY_FOR_RELEASE",
    health_state: "WATCH",
    sync_state: "PENDING_SYNC",
    priority: "normal",
    assigned_to_user_id: "owner-1",
    organization_id: "org-1",
    location_id: "loc-1",
    primary_contact_id: "contact-1",
    account_owner_user_id: "user-1",
    department_owner_user_id: null,
    assigned_peer_reviewer_user_id: null,
    assigned_release_reviewer_user_id: null,
    escalation_owner_user_id: null,
    department_type: "sports",
    shoot_date_start: null,
    shoot_date_end: null,
    production_start_at: null,
    approval_required: true,
    proof_required: true,
    qa_required: true,
    due_at: null,
    release_due_at: null,
    delivery_deadline_at: null,
    completed_at: null,
    closed_at: null,
    readiness_score: 80,
    blocker_count: 0,
    rework_count: 0,
    file_count_expected: null,
    file_count_received: null,
    file_match_status: "UNKNOWN",
    roster_received: true,
    naming_verified: true,
    folder_structure_verified: true,
    tags_or_flags_verified: true,
    handoff_complete: true,
    upload_status: "UPLOADED",
    release_status: "READY_FOR_RELEASE",
    release_target: null,
    gallery_or_output_reference: null,
    vendor_name: null,
    vendor_reference: null,
    blocked_reason: null,
    client_visible_label: null,
    qa_status: "queued",
    creator_review_complete: true,
    peer_review_complete: true,
    final_release_review_complete: false,
    qa_fail_count: 0,
    first_pass_approved: false,
    internal_notes: null,
    production_notes: null,
    post_shoot_eval_summary: null,
    risk_flag: false,
    legacy_source_reference: null,
    imported_status_source: null,
    legacy_owner_history_json: null,
    merged_into_production_item_id: null,
    hold_reason: null,
    hold_owner_user_id: null,
    hold_review_at: null,
    created_by_user_id: "user-1",
    updated_by_user_id: "user-1",
    created_at: "2026-04-01T12:00:00.000Z",
    updated_at: "2026-04-01T12:00:00.000Z",
    ...overrides
  };
}

function buildApproval(overrides: Partial<ApprovalRequestRecord> = {}): ApprovalRequestRecord {
  return {
    id: "approval-1",
    tenant_id: "tenant-1",
    production_item_id: "production-1",
    job_id: "job-1",
    job_day_id: "day-1",
    approval_type: "proof",
    approver_contact_id: null,
    approver_user_id: "approver-1",
    status: "requested",
    requested_at: null,
    viewed_at: null,
    approved_at: null,
    rejected_at: null,
    revision_requested_at: null,
    due_at: null,
    last_follow_up_at: null,
    revision_count: 0,
    summary: "Client proof approval",
    notes: null,
    created_at: "2026-04-01T12:00:00.000Z",
    updated_at: "2026-04-01T12:00:00.000Z",
    ...overrides
  };
}

function buildIssue(overrides: Partial<ProductionIssueRecord> = {}): ProductionIssueRecord {
  return {
    id: "issue-1",
    tenant_id: "tenant-1",
    production_item_id: "production-1",
    job_id: "job-1",
    issue_type: "qa",
    severity: "high",
    title: "Blocking issue",
    description: "Needs correction",
    status: "open",
    is_blocking: true,
    source_key: null,
    owner_user_id: "owner-1",
    created_by_user_id: "user-1",
    due_at: null,
    resolved_at: null,
    resolved_by_user_id: null,
    resolution_note: null,
    created_at: "2026-04-01T12:00:00.000Z",
    updated_at: "2026-04-01T12:00:00.000Z",
    ...overrides
  };
}

describe("workflow state engine", () => {
  it("maps publish validation into hard workflow blockers", () => {
    const validation: JobValidationResult = {
      valid: false,
      errors: [
        {
          field: "organization_id",
          code: "required",
          message: "Organization is required."
        }
      ]
    };

    const result = buildPublishWorkflowValidation("job-1", "draft", validation);

    expect(result.allowed).toBe(false);
    expect(result.hard_blocked).toBe(true);
    expect(result.blocker_count).toBe(1);
    expect(result.issues[0]?.field).toBe("organization_id");
  });

  it("blocks ready confirmation for missing lead or incomplete required readiness work", () => {
    const result = buildJobDayReadyTransitionValidation({
      jobId: "job-1",
      day: buildDay({ lead_user_id: null }),
      staffAssignments: [],
      readinessItems: [buildReadinessItem()],
      managerOverride: true,
      input: {
        on_site_confirmed: true,
        setup_complete: true,
        all_required_staff_present: true,
        blockers_resolved: true
      }
    });

    expect(result.allowed).toBe(false);
    expect(result.hard_blocked).toBe(true);
    expect(result.issues.some((issue) => issue.code === "lead_assignment_missing")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "readiness_blocker_incomplete")).toBe(true);
  });

  it("downgrades unresolved confirmation flags to warnings when a manager override exists", () => {
    const result = buildJobDayReadyTransitionValidation({
      jobId: "job-1",
      day: buildDay(),
      staffAssignments: [buildAssignment()],
      readinessItems: [],
      managerOverride: true,
      input: {
        on_site_confirmed: false,
        setup_complete: true,
        all_required_staff_present: true,
        blockers_resolved: true,
        equipment_ready: false
      }
    });

    expect(result.allowed).toBe(true);
    expect(result.hard_blocked).toBe(false);
    expect(result.warning_count).toBeGreaterThanOrEqual(1);
  });

  it("lets admin-configured day-ready rules downgrade missing lead coverage to a warning", () => {
    const result = buildJobDayReadyTransitionValidation({
      jobId: "job-1",
      day: buildDay({ lead_user_id: null }),
      staffAssignments: [],
      readinessItems: [],
      managerOverride: false,
      rules: {
        require_lead_assigned: true,
        missing_lead_level: "warning",
        require_on_site_confirmed: true,
        require_setup_complete: true,
        require_all_required_staff_present: true,
        require_blockers_resolved: true,
        require_equipment_ready: false,
        require_client_contact_checked_in: false,
        manager_override_downgrades: true
      },
      input: {
        on_site_confirmed: true,
        setup_complete: true,
        all_required_staff_present: true,
        blockers_resolved: true
      }
    });

    expect(result.allowed).toBe(true);
    expect(result.hard_blocked).toBe(false);
    expect(result.issues.some((issue) => issue.code === "lead_assignment_missing" && issue.level === "warning")).toBe(true);
  });

  it("blocks release transitions without approval, proof reference, and final review", () => {
    const result = buildProductionWorkflowTransitionValidation({
      jobId: "job-1",
      item: buildProductionItem(),
      approvalRequests: [buildApproval({ status: "requested" })],
      productionIssues: [buildIssue()],
      checklistValidation: null,
      input: {
        workflow_status: "RELEASED",
        release_status: "RELEASED"
      }
    });

    expect(result.allowed).toBe(false);
    expect(result.issues.some((issue) => issue.code === "approval_required_before_release")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "proof_required_before_close")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "final_release_review_required")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "blocking_production_issue_open")).toBe(true);
  });

  it("honors configured final release statuses when deciding which release transitions need proof", () => {
    const result = buildProductionWorkflowTransitionValidation({
      jobId: "job-1",
      item: buildProductionItem({
        workflow_status: "READY_FOR_RELEASE",
        release_status: "READY_FOR_RELEASE",
        approval_required: false,
        proof_required: true,
        final_release_review_complete: true
      }),
      approvalRequests: [],
      productionIssues: [],
      finalReleaseStatuses: {
        statuses: ["RELEASED"]
      },
      rules: {
        require_peer_review_for_upload: true,
        require_final_review_for_release: true,
        require_approval_when_required: true,
        require_proof_reference_when_required: true,
        require_no_blocking_issues_for_final_release: true
      },
      checklistValidation: null,
      input: {
        release_status: "DELIVERED",
        workflow_status: "READY_FOR_RELEASE"
      }
    });

    expect(result.allowed).toBe(true);
    expect(result.issues.some((issue) => issue.code === "proof_required_before_close")).toBe(false);
  });

  it("builds a reusable workflow summary across publish, readiness, production, approvals, and evaluations", () => {
    const summary = buildJobWorkflowSummary({
      job: buildJob({ job_status: "execution_complete" }),
      days: [buildDay({ day_status: "complete" })],
      staffAssignments: [buildAssignment()],
      readinessItems: [buildReadinessItem()],
      productionItems: [buildProductionItem()],
      approvalRequests: [buildApproval({ status: "overdue" })],
      productionIssues: [buildIssue()],
      watchFlags: [],
      status: {
        readiness_percent: 50,
        job_status: "execution_complete",
        production_status: "blocked",
        staffing_status: "gap_flagged",
        readiness_status: "at_risk",
        risk_status: "high",
        blocker_count: 2,
        open_watch_flag_count: 1
      } satisfies JobStatusSnapshot,
      publishValidation: {
        valid: false,
        errors: [{ field: "organization_id", code: "required", message: "Organization is required." }]
      }
    });

    expect(summary.publish.state).toBe("blocked");
    expect(summary.readiness.state).toBe("blocked");
    expect(summary.production.state).toBe("blocked");
    expect(summary.approvals.state).toBe("blocked");
    expect(summary.evaluations.state).toBe("warning");
  });
});
