import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Organizations } from "../pages/Organizations";
import type {
  DirectoryRelationshipContinuityBundle,
  DirectoryDuplicateReviewRecord,
  DirectoryRelationshipFollowUpRecord,
  DirectoryInternalOwner,
  DirectoryImportSessionRecord,
  DirectoryRelationshipMemoryRecord,
  DirectoryOwnerOption,
  DirectoryTouchpointRecord,
  DirectoryTouchpointPlan,
  DirectoryTouchpointPlanTemplate,
  OrganizationContact,
  OrganizationDetail,
  OrganizationLocation,
  OrganizationOperationsHub,
  SchoolActivityLog,
  SchoolProfile,
  SchoolRule,
  SessionUser
} from "../types";

const apiFetchMock = vi.fn();

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
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
  permissions: ["dashboard.read", "shoot.read", "schedule.read"],
  authorityTier: "leadership",
  primaryJobFunctionProfile: "leadership_team_member",
  jobFunctionProfiles: ["leadership_team_member"],
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

const directoryManagerUser: SessionUser = {
  ...leadershipUser,
  id: "user-directory-manager",
  accountId: "account-directory-manager",
  sessionId: "session-directory-manager",
  email: "directory.manager@example.com",
  fullName: "Directory Manager",
  roles: ["manager"],
  authorityTier: "manager",
  primaryJobFunctionProfile: "operations_manager",
  jobFunctionProfiles: ["operations_manager"]
};

const communicationReadyUser: SessionUser = {
  ...leadershipUser,
  permissions: [...leadershipUser.permissions, "communication.use", "communication.send", "communication.meeting.manage"],
  communicationIdentity: {
    provider: "microsoft_teams",
    microsoftUserId: "ms-user-1",
    microsoftTenantId: "ms-tenant-1",
    communicationEnabled: true,
    teamsChatDefaultTarget: null,
    linkedAt: "2026-04-03T12:00:00.000Z",
    lastVerifiedAt: "2026-04-03T12:00:00.000Z",
    status: "linked_ready"
  }
};

function createDirectoryHarness(options: { seedOrganizationOnlyTouchpoint?: boolean; unresolvedImportOrganization?: boolean } = {}) {
  const organization = {
    id: "organization-1",
    canonical_name: "White Bear Lake High School",
    logo_url: "https://images.example/wbl-logo.png",
    display_name: "White Bear Lake High School",
    account_type: "schools_underclass_portraits" as const,
    active_status: "active" as const,
    aliases: ["WBL High School"],
    notes: "Canonical school account for scheduling.",
    contact_count: 1,
    location_count: 1,
    created_at: "2026-03-27T12:00:00.000Z",
    updated_at: "2026-03-27T12:00:00.000Z"
  };

  let contacts: OrganizationContact[] = [
    {
      id: "contact-1",
      organization_id: "organization-1",
      canonical_organization_id: "organization-1",
      first_name: "Jamie",
      last_name: "Carlson",
      full_name: "Jamie Carlson",
      preferred_name: "Jamie",
      title: "Activities Director",
      department_program: "Activities Office",
      phone: "555-0188",
      email: "jamie.carlson@example.com",
      photo_url: null,
      active_status: "active",
      contact_status: "needs_review",
      role_category: "school_administration",
      operational_importance: "critical",
      decision_influence: "decision_maker",
      relationship_strength: "strong_relationship",
      primary_internal_owner: {
        user_id: "user-leadership",
        full_name: "Demo Leadership",
        email: "leadership@example.com",
        department: "operations",
        status: "active",
        relationship_weight: 5,
        last_interaction_at: "2026-03-28T08:30:00.000Z"
      },
      backup_internal_owner: {
        user_id: "user-coordinator",
        full_name: "Morgan Coordinator",
        email: "coordinator@example.com",
        department: "operations",
        status: "active",
        relationship_weight: 3,
        last_interaction_at: "2026-03-20T10:00:00.000Z"
      },
      ownership_state: "shared",
      freshness_state: "needs_review",
      last_confirmed_at: "2025-08-01",
      last_meaningful_interaction_at: "2026-03-28T08:30:00.000Z",
      primary_location_id: "location-1",
      primary_location_name: "South Gym",
      linked_location_names: ["South Gym"],
      strongest_internal_relationship: {
        user_id: "user-leadership",
        full_name: "Demo Leadership",
        email: "leadership@example.com",
        department: "operations",
        status: "active",
        relationship_weight: 5,
        last_interaction_at: "2026-03-28T08:30:00.000Z"
      },
      last_spoke_with: {
        user_id: "user-leadership",
        full_name: "Demo Leadership",
        email: "leadership@example.com",
        department: "operations",
        status: "active",
        relationship_weight: 5,
        last_interaction_at: "2026-03-28T08:30:00.000Z"
      },
      additional_internal_connected_staff: [
        {
          user_id: "user-customer-success",
          full_name: "Pat Customer Success",
          email: "pat@example.com",
          department: "customer_success",
          status: "active",
          relationship_weight: 2,
          last_interaction_at: "2026-03-22T13:00:00.000Z"
        }
      ],
      handoff_ready: false,
      uncertainty_flag: true,
      maintenance_signals: [
        {
          code: "contact_needs_review",
          severity: "critical",
          label: "Contact details need review",
          detail: "The relationship is stale, uncertain, or has not been confirmed recently enough to trust without review."
        },
        {
          code: "handoff_not_ready",
          severity: "warning",
          label: "Handoff readiness is incomplete",
          detail: "Document enough context for a backup owner before the next major shoot or ownership change."
        }
      ],
      last_updated_by_name: "Demo Leadership",
      relationship_role: "planning",
      is_primary: true,
      school_contact_categories: ["photo_day_contact", "yearbook_contact"],
      relationship_history: [
        {
          id: "relationship-current-1",
          organization_id: "organization-1",
          organization_display_name: "White Bear Lake High School",
          organization_account_type: "schools_underclass_portraits",
          relationship_role: "planning",
          is_primary: true,
          is_current: true,
          relationship_state: "current",
          start_date: "2025-08-01",
          end_date: null,
          created_at: "2026-03-27T12:00:00.000Z",
          updated_at: "2026-03-27T12:00:00.000Z"
        },
        {
          id: "relationship-previous-1",
          organization_id: "organization-2",
          organization_display_name: "Metro League",
          organization_account_type: "sports",
          relationship_role: "operations",
          is_primary: false,
          is_current: false,
          relationship_state: "previous",
          start_date: "2024-01-15",
          end_date: "2024-10-30",
          created_at: "2026-03-27T12:00:00.000Z",
          updated_at: "2026-03-27T12:00:00.000Z"
        }
      ],
      notes: "Primary planning contact.",
      created_at: "2026-03-27T12:00:00.000Z",
      updated_at: "2026-03-27T12:00:00.000Z"
    }
  ];

  let locations: OrganizationLocation[] = [
    {
      id: "location-1",
      organization_id: "organization-1",
      location_name: "South Gym",
      address_line_1: "123 School Street",
      address_line_2: null,
      city: "White Bear Lake",
      state: "MN",
      zip: "55110",
      address_display: "123 School Street, White Bear Lake, MN 55110",
      maps_label: "South Gym",
      maps_url: "https://maps.example/south-gym",
      active_status: "active",
      contact_links: [],
      notes: "Use the south loading door.",
      created_at: "2026-03-27T12:00:00.000Z",
      updated_at: "2026-03-27T12:00:00.000Z"
    }
  ];
  const ownerOptions: DirectoryOwnerOption[] = [
    {
      user_id: "user-leadership",
      full_name: "Demo Leadership",
      email: "leadership@example.com",
      department: "operations",
      status: "active"
    },
    {
      user_id: "user-coordinator",
      full_name: "Morgan Coordinator",
      email: "coordinator@example.com",
      department: "operations",
      status: "active"
    }
  ];
  let schoolProfile: SchoolProfile = {
    organization_id: "organization-1",
    district_name: "White Bear Lake Area Schools",
    school_type: "High School",
    school_year_label: "2026-2027",
    relationship_health_state: "needs_attention",
    relationship_summary: "Yearbook is well covered, but roster turnaround still needs closer attention.",
    primary_internal_owner: toDirectoryInternalOwner("user-leadership") ?? null,
    backup_internal_owner: toDirectoryInternalOwner("user-coordinator") ?? null,
    primary_location_id: "location-1",
    primary_location_name: "South Gym",
    primary_location_address: "123 School Street, White Bear Lake, MN 55110",
    tags: ["yearbook", "graduation", "high_volume"],
    notes: "Confirm front-office packet delivery before every spring volume day.",
    created_at: "2026-03-27T12:00:00.000Z",
    updated_at: "2026-03-28T08:30:00.000Z"
  };
  let schoolRules: SchoolRule[] = [
    {
      id: "school-rule-1",
      organization_id: "organization-1",
      rule_type: "subject_directory_requirements",
      active_status: "active",
      title: "Subject directory delivery",
      summary: "Deliver subject directories grouped by homeroom with the yearbook packet.",
      structured_value: {
        grouping: "Homeroom",
        copies: 3,
        delivery_owner: "Yearbook adviser",
        roster_required: true,
        packet_contents: ["Subject directories", "Yearbook packet"],
        delivery_window: {
          start: "8:00 AM",
          end: "10:00 AM"
        }
      },
      sort_order: 10,
      created_by_name: "Demo Leadership",
      updated_by_name: "Demo Leadership",
      created_at: "2026-03-27T12:00:00.000Z",
      updated_at: "2026-03-28T08:30:00.000Z"
    }
  ];
  let schoolActivity: SchoolActivityLog[] = [
    {
      id: "school-activity-1",
      organization_id: "organization-1",
      activity_type: "profile_created",
      summary: "School profile established.",
      detail: "Initial school foundation was created from the directory record.",
      metadata: {},
      related_contact_id: null,
      related_contact_name: null,
      related_rule_id: null,
      actor_user_id: "user-leadership",
      actor_name: "Demo Leadership",
      created_at: "2026-03-27T12:00:00.000Z"
    }
  ];

  let touchpoints: DirectoryTouchpointRecord[] = options.seedOrganizationOnlyTouchpoint
    ? [
        {
          id: "touchpoint-org-1",
          organization_id: "organization-1",
          location_id: null,
          shoot_id: null,
          contact_id: null,
          channel: "email",
          category: "pre_shoot_confirmation",
          subject: "Pre-shoot prep",
          summary: "Organization-only prep note",
          outcome: null,
          outcome_state: "informational_only",
          owner_user_id: "user-leadership",
          owner_name: "Demo Leadership",
          occurred_at: "2026-03-28T08:30:00.000Z",
          follow_up_date: null,
          follow_up_needed: false,
          follow_up_owner: null,
          relationship_memory_suggested: false,
          attachment_reference: null,
          touchpoint_plan_id: null,
          created_at: "2026-03-28T08:30:00.000Z",
          updated_at: "2026-03-28T08:30:00.000Z"
        }
      ]
    : [];
  let touchpointPlans: DirectoryTouchpointPlan[] = [
    {
      id: "touchpoint-plan-1",
      organization_id: "organization-1",
      location_id: null,
      contact_id: "contact-1",
      linked_shoot_id: "shoot-1",
      template_id: "template-pre-shoot",
      category: "pre_shoot_confirmation",
      title: "Confirm arrival window",
      summary: "Verify office access, arrival timing, and front-office handoff.",
      status: "due_soon",
      owner_user_id: "user-leadership",
      owner_name: "Demo Leadership",
      backup_owner: toDirectoryInternalOwner("user-coordinator"),
      due_at: "2026-03-31T15:00:00.000Z",
      completed_at: null,
      skipped_reason: null,
      cancelled_reason: null,
      completion_note: null,
      created_at: "2026-03-27T12:00:00.000Z",
      updated_at: "2026-03-27T12:00:00.000Z"
    }
  ];
  let relationshipMemory: DirectoryRelationshipMemoryRecord[] = [
    {
      id: "memory-1",
      organization_id: "organization-1",
      location_id: "location-1",
      contact_id: "contact-1",
      source_touchpoint_id: null,
      memory_type: "day_of_coordination_preference",
      summary: "Front office prefers a quick call 15 minutes before arrival.",
      why_it_matters: "It helps the office unlock the south entrance and keeps arrival smoother for the crew.",
      source_label: "Reviewed from spring planning",
      visibility: "assignment_relevant",
      status: "active",
      created_by: toDirectoryInternalOwner("user-leadership"),
      reviewed_by: toDirectoryInternalOwner("user-coordinator"),
      reviewed_at: "2026-03-28T09:00:00.000Z",
      last_confirmed_at: "2026-03-28",
      created_at: "2026-03-27T12:00:00.000Z",
      updated_at: "2026-03-28T09:00:00.000Z"
    }
  ];
  let followUps: DirectoryRelationshipFollowUpRecord[] = [
    {
      id: "follow-up-1",
      organization_id: "organization-1",
      location_id: null,
      contact_id: "contact-1",
      linked_shoot_id: "shoot-1",
      source_touchpoint_id: null,
      source_touchpoint_plan_id: "touchpoint-plan-1",
      title: "Send final arrival window",
      summary: "Confirm the exact arrival window with Jamie before the crew heads out.",
      owner: toDirectoryInternalOwner("user-leadership"),
      backup_owner: toDirectoryInternalOwner("user-coordinator"),
      due_at: "2026-03-31T18:00:00.000Z",
      status: "open",
      completed_at: null,
      resolution_note: null,
      created_at: "2026-03-28T08:35:00.000Z",
      updated_at: "2026-03-28T08:35:00.000Z"
    }
  ];
  const touchpointTemplates: DirectoryTouchpointPlanTemplate[] = [
    {
      id: "template-pre-shoot",
      template_key: "pre_shoot_confirmation",
      template_name: "Pre-Shoot Confirmation",
      category: "pre_shoot_confirmation",
      scope_hint: "organization",
      summary: "Confirm logistics, access, and arrival timing before shoot day.",
      default_offset_days: 1,
      default_due_time: "15:00:00",
      active_status: true
    }
  ];
  let duplicateReviews: DirectoryDuplicateReviewRecord[] = [];
  let importSession: DirectoryImportSessionRecord | null = null;
  const shootLinks: string[] = [];
  const contactDetailRequests: string[] = [];

  function toDirectoryInternalOwner(userId: string | null | undefined): DirectoryInternalOwner | undefined {
    const owner = ownerOptions.find((option) => option.user_id === userId);
    if (!owner) {
      return undefined;
    }
    return {
      user_id: owner.user_id,
      full_name: owner.full_name,
      email: owner.email,
      department: owner.department,
      status: owner.status
    };
  }

  function buildContinuity(scope: "organization" | "contact", contactId: string | null = null): DirectoryRelationshipContinuityBundle {
    const scopedTouchpoints = touchpoints.filter((touchpoint) =>
      scope === "organization" ? true : touchpoint.contact_id === contactId
    );
    const scopedPlans = touchpointPlans.filter((plan) => (scope === "organization" ? true : plan.contact_id === contactId));
    const scopedMemory = relationshipMemory.filter((entry) =>
      scope === "organization" ? true : entry.contact_id === contactId
    );
    const scopedFollowUps = followUps.filter((entry) =>
      scope === "organization" ? true : entry.contact_id === contactId
    );
    const openPlans = scopedPlans.filter(
      (plan) => plan.status !== "completed" && plan.status !== "cancelled" && plan.status !== "skipped"
    );
    const openFollowUps = scopedFollowUps.filter(
      (entry) => entry.status !== "completed" && entry.status !== "cancelled"
    );
    const nextTouchpoint = [...openPlans].sort((left, right) => Date.parse(left.due_at) - Date.parse(right.due_at))[0] ?? null;
    const overduePlans = openPlans.filter((plan) => plan.status === "overdue");
    const overdueFollowUps = openFollowUps.filter((entry) => entry.status === "overdue");
    const needsReviewMemory = scopedMemory.filter((entry) => entry.status === "needs_review");
    const relationshipHealthState =
      overduePlans.length || overdueFollowUps.length
        ? "needs_attention"
        : scopedTouchpoints.length || openPlans.length || openFollowUps.length || scopedMemory.length
          ? "healthy"
          : "unknown";

    return {
      scope,
      organization_id: "organization-1",
      contact_id: scope === "contact" ? contactId : null,
      generated_at: "2026-03-30T12:00:00.000Z",
      summary: {
        relationship_health_state: relationshipHealthState,
        relationship_health_summary:
          relationshipHealthState === "needs_attention"
            ? "Relationship continuity has open items that still need follow-through."
            : relationshipHealthState === "healthy"
              ? "Relationship continuity is covered with recent communication and owned next steps."
              : "Relationship continuity has not been established yet.",
        last_communication_at: scopedTouchpoints[0]?.occurred_at ?? null,
        last_communication_label: scopedTouchpoints[0]
          ? `${scopedTouchpoints[0].subject ?? "Recent communication"} logged recently`
          : "No communication logged yet",
        next_touchpoint_due_at: nextTouchpoint?.due_at ?? null,
        next_touchpoint_label: nextTouchpoint?.title ?? "No planned touchpoint",
        open_follow_up_count: openFollowUps.length,
        overdue_follow_up_count: overdueFollowUps.length,
        due_soon_touchpoint_count: openPlans.filter((plan) => plan.status === "due_soon").length,
        overdue_touchpoint_count: overduePlans.length,
        active_memory_count: scopedMemory.filter((entry) => entry.status !== "archived").length,
        needs_review_memory_count: needsReviewMemory.length,
        stale_key_contact_count: scope === "contact" && contactId ? 1 : 0
      },
      touchpoint_templates: touchpointTemplates,
      touchpoint_plans: scopedPlans,
      communication_logs: scopedTouchpoints,
      relationship_memory: scopedMemory,
      follow_ups: scopedFollowUps
    };
  }

  const recentShoot = {
    id: "shoot-1",
    shoot_code: "SPRING-SPORTS-2027",
    title: "Spring Sports",
    shoot_date: "2027-04-12",
    location_name: "South Gym"
  };

  function buildDetail(): OrganizationDetail {
    organization.contact_count = contacts.length;
    organization.location_count = locations.length;
    return {
      organization,
      contacts,
      locations,
      school_profile: schoolProfile,
      school_rules: schoolRules,
      school_activity: schoolActivity,
      touchpoints,
      recent_shoots: [recentShoot],
      next_shoot: {
        ...recentShoot,
        showtime: "08:00:00",
        start_time: "2027-04-12T08:30:00.000Z"
      },
      sales_opportunities: [],
      account_overview: {
        contract_status: "Active",
        expiration_timeline: "Expires Mar 1, 2027",
        last_shoot: null,
        next_shoot: null,
        key_contacts: contacts.slice(0, 1),
        account_health_state: "healthy",
        account_health_summary: "Stable account health",
        account_health_reasons: [],
        recent_issues: [],
        revenue_check_status: "not_tracked",
        revenue_check_summary: "Not tracked"
      },
      agreements_access: { can_view: true, can_manage: true },
      agreement_summary: {
        total: 1,
        active: 1,
        pending_signature: 0,
        expiring_soon: 0,
        expired: 0,
        replaced_archived: 0,
        renewals_needed: 0,
        accounts_missing_active: 0,
        upcoming_shoot_risk_count: 0,
        has_active_agreement: true,
        has_pending_signature: false,
        has_expiring_soon: false,
        has_expired: false,
        needs_attention: false,
        warning_severity: "clear",
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
      sales_email_templates: [],
      sales_communications: [],
      resource_library: {} as OrganizationDetail["resource_library"],
      placeholders: {
        agreement_summary: "1 active agreement",
        sales_pipeline_summary: "No active opportunities",
        recent_shoots_summary: "1 recent shoot",
        resource_library_summary: "No resource library signals"
      }
    };
  }

  function buildImportSession(): DirectoryImportSessionRecord {
    if (importSession) {
      return importSession;
    }
    importSession = {
      id: "import-session-1",
      source_file_name: "contacts.csv",
      import_kind: "contacts_csv",
      status: "staged",
      has_header_row: true,
      default_organization_id: "organization-1",
      mapping: {
        first_name: "first_name",
        last_name: "last_name",
        email: "email",
        organization_name: "organization_name",
        relationship_role: "relationship_role",
        start_date: "start_date",
        end_date: "end_date",
        current_flag: "current_flag"
      },
      summary: {
        total_rows: 2,
        ready_to_create: options.unresolvedImportOrganization ? 0 : 1,
        ready_to_link: 0,
        needs_review: options.unresolvedImportOrganization ? 2 : 1,
        skipped: 0,
        invalid: 0,
        applied: 0,
        errors: 0
      },
      created_by_user_id: "user-leadership",
      applied_by_user_id: null,
      applied_at: null,
      created_at: "2026-03-29T09:00:00.000Z",
      updated_at: "2026-03-29T09:00:00.000Z",
      rows: [
        {
          id: "import-row-1",
          row_number: 1,
          status: options.unresolvedImportOrganization ? "needs_review" : "ready",
          proposed_action: options.unresolvedImportOrganization ? "needs_review" : "create_contact",
          selected_action: null,
          selected_contact_id: null,
          resolved_organization_id: options.unresolvedImportOrganization ? null : "organization-1",
          review_note: null,
          raw_values: {
            first_name: "Taylor",
            last_name: "Rowe",
            email: "taylor.rowe@example.com",
            organization_name: "White Bear Lake High School"
          },
          normalized_values: {
            first_name: "Taylor",
            last_name: "Rowe",
            preferred_name: null,
            title: "Assistant Coach",
            email: "taylor.rowe@example.com",
            phone: "555-0101",
            organization_name: "White Bear Lake High School",
            organization_type: "schools_underclass_portraits",
            relationship_role: "planning",
            notes: "New planning contact",
            start_date: "2026-03-01",
            end_date: null,
            is_current: true,
            resolved_organization_name: options.unresolvedImportOrganization ? null : "White Bear Lake High School"
          },
          validation_errors: [],
          warning_messages: options.unresolvedImportOrganization ? ["Organization name could not be matched to an existing account."] : [],
          candidate_matches: [],
          applied_contact_id: null,
          applied_relationship_id: null,
          result_summary: null
        },
        {
          id: "import-row-2",
          row_number: 2,
          status: "needs_review",
          proposed_action: "needs_review",
          selected_action: null,
          selected_contact_id: null,
          resolved_organization_id: "organization-1",
          review_note: null,
          raw_values: {
            first_name: "Pat",
            last_name: "Morgan",
            phone: "555-7878",
            organization_name: "White Bear Lake High School"
          },
          normalized_values: {
            first_name: "Pat",
            last_name: "Morgan",
            preferred_name: null,
            title: null,
            email: null,
            phone: "555-7878",
            organization_name: "White Bear Lake High School",
            organization_type: "schools_underclass_portraits",
            relationship_role: "general",
            notes: "Potential duplicate",
            start_date: null,
            end_date: null,
            is_current: true,
            resolved_organization_name: "White Bear Lake High School"
          },
          validation_errors: [],
          warning_messages: ["Multiple strong duplicate candidates found."],
          candidate_matches: [
            {
              contact_id: "contact-1",
              full_name: "Jamie Carlson",
              email: "jamie.carlson@example.com",
              phone: "555-0188",
              current_organization_labels: ["White Bear Lake High School"],
              confidence: "possible",
              reason: "Strong name and phone similarity"
            },
            {
              contact_id: "contact-2",
              full_name: "Pat Morgan",
              email: "pat.morgan@example.com",
              phone: "555-7878",
              current_organization_labels: ["Metro League"],
              confidence: "strong",
              reason: "Strong name and phone match"
            }
          ],
          applied_contact_id: null,
          applied_relationship_id: null,
          result_summary: null
        }
      ]
    };
    return importSession;
  }

  function buildOperationsHub(): OrganizationOperationsHub {
    const openDuplicateCount = duplicateReviews.filter((review) => review.status === "open").length;
    return {
      organization_id: "organization-1",
      generated_at: "2026-03-28T12:05:00.000Z",
      summary: {
        last_touch_at: touchpoints[0]?.occurred_at ?? null,
        last_touch_label: touchpoints[0] ? "Mar 28, 11:00 AM by Demo Leadership" : "No touchpoint logged yet",
        next_action: openDuplicateCount ? "Review duplicate queue" : "Log outreach and confirm the next step",
        owner_label: touchpoints[0]?.owner_name ?? "Demo Leadership",
        follow_up_date: touchpoints[0]?.follow_up_date ?? "2026-03-31",
        follow_up_label: touchpoints[0]?.follow_up_date ? "Due Mar 31" : "Due Mar 31",
        relationship_health_state: openDuplicateCount ? "watch" : "watch",
        relationship_health_summary: openDuplicateCount
          ? "Duplicate review open | Upcoming shoot needs outreach"
          : "Upcoming shoot needs outreach"
      },
      health_cues: [
        {
          code: "upcoming_shoot_outreach",
          label: "Upcoming shoot needs outreach",
          detail: "The next shoot is approaching without a recent touchpoint trail.",
          tone: "warning"
        },
        ...(openDuplicateCount
          ? [
              {
                code: "duplicate_review_open",
                label: "Duplicate review open",
                detail: "One duplicate review is still open.",
                tone: "info" as const
              }
            ]
          : [])
      ],
      queues: {
        contact_cleanup: {
          count: 0,
          items: []
        },
        projects: {
          count: 1,
          items: [
            {
              id: "project-ops-1",
              kind: "project",
              title: "Post-Shoot Production Wrap",
              summary: "Production kickoff is still waiting on owner assignment.",
              tone: "warning",
              next_action: "Assign the production owner and confirm the kickoff path.",
              action_hash: "#project-tracking/workflows/workflow-related-1",
              owner_label: "Owner unassigned",
              due_label: "Due Mar 29",
              related_contact_id: null,
              related_location_id: "location-1",
              related_shoot_id: "shoot-1"
            }
          ]
        },
        follow_up: {
          count: 1,
          items: [
            {
              id: "follow-up-1",
              kind: "follow_up",
              title: "Upcoming shoot needs outreach",
              summary: "No recent touchpoint is close enough to the next shoot, Spring Sports.",
              tone: "warning",
              next_action: "Confirm day-of details before the shoot arrives.",
              action_hash: "#directory/accounts?view=organizations&organization=organization-1&tab=linked_shoots",
              owner_label: "Contact Jamie Carlson",
              due_label: "Before Apr 12",
              related_contact_id: "contact-1",
              related_location_id: null,
              related_shoot_id: "shoot-1"
            }
          ]
        },
        duplicate_review: {
          count: openDuplicateCount,
          items: duplicateReviews.map((review) => ({
            id: review.id,
            kind: "duplicate_review",
            title: `${review.primary_contact_name || "Unknown"} vs ${review.suspected_duplicate_contact_name || "Unknown"}`,
            summary: review.summary,
            tone: "info",
            next_action: "Review whether these contacts should stay separate or move toward merge review.",
            action_hash: "#directory/contacts?view=contacts&organization=organization-1&contact=contact-1&tab=duplicates",
            owner_label: review.created_by_name || "Demo Leadership",
            due_label: "Opened Mar 28",
            related_contact_id: review.primary_contact_id,
            related_location_id: null,
            related_shoot_id: null
          }))
        }
      },
      timeline: touchpoints.map((touchpoint) => ({
        id: touchpoint.id,
        kind: "touchpoint",
        title: "Call",
        summary: touchpoint.summary,
        tone: "info",
        occurred_at: touchpoint.occurred_at,
        owner_label: touchpoint.owner_name || "Demo Leadership",
        related_contact_id: touchpoint.contact_id,
        related_location_id: touchpoint.location_id,
        related_shoot_id: touchpoint.shoot_id,
        due_label: touchpoint.follow_up_date ? "Due Mar 31" : null,
        action_hash: "#directory/contacts?view=contacts&organization=organization-1&contact=contact-1&tab=touchpoints"
      }))
    };
  }

  apiFetchMock.mockImplementation(async (path: string, _token?: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const url = new URL(path, "http://localhost");
    const query = url.searchParams;

    if (path.startsWith("/api/organizations?") && method === "GET") {
      return {
        organizations: [organization],
        search: { query: "", total: 1 }
      };
    }
    if (path === "/api/organizations/internal-owners" && method === "GET") {
      return {
        owners: ownerOptions
      };
    }
    if (path.startsWith("/api/record-resources/") && method === "GET") {
      const segments = url.pathname.split("/");
      return {
        object: {
          object_type: segments[3],
          object_id: segments[4],
          label: "Attached resources"
        },
        access: {
          can_view: true,
          can_manage: true
        },
        summary: {
          total_items: 0,
          uploaded_file_count: 0,
          external_link_count: 0
        },
        items: []
      };
    }
    if (path === "/api/communications/records/organization/organization-1" && method === "GET") {
      return {
        object_type: "organization",
        object_id: "organization-1",
        object_label: "White Bear Lake High School",
        permissions: {
          can_use: true,
          can_send: true,
          can_configure: false
        },
        feature_enabled: true,
        references: [
          {
            id: "org-reference-1",
            reference_type: "chat",
            status: "active",
            label: "Account Team Chat",
            description: "Internal account coordination",
            teams_web_url: "https://teams.microsoft.com/l/chat/0/0?users=leadership@example.com",
            team_id: null,
            channel_id: null,
            chat_id: "19:org-chat",
            is_primary: true,
            created_at: "2026-04-03T12:00:00.000Z",
            updated_at: "2026-04-03T12:00:00.000Z",
            last_verified_at: "2026-04-03T12:05:00.000Z"
          }
        ],
        recent_deliveries: []
      };
    }
    if (path === "/api/communications/records/location/location-1" && method === "GET") {
      return {
        object_type: "location",
        object_id: "location-1",
        object_label: "South Gym",
        permissions: {
          can_use: true,
          can_send: true,
          can_configure: false
        },
        feature_enabled: true,
        references: [
          {
            id: "location-reference-1",
            reference_type: "channel",
            status: "active",
            label: "South Gym Channel",
            description: "Room setup and site access updates",
            teams_web_url: "https://teams.microsoft.com/l/channel/location-1/south-gym",
            team_id: "team-1",
            channel_id: "channel-1",
            chat_id: null,
            is_primary: true,
            created_at: "2026-04-03T12:00:00.000Z",
            updated_at: "2026-04-03T12:00:00.000Z",
            last_verified_at: "2026-04-03T12:05:00.000Z"
          }
        ],
        recent_deliveries: []
      };
    }
    if (path === "/api/communications/records/organization/organization-1/meeting" && method === "GET") {
      return {
        object_type: "organization",
        object_id: "organization-1",
        object_label: "White Bear Lake High School",
        feature_enabled: true,
        permissions: {
          can_use: true,
          can_manage: true
        },
        defaults: {
          suggested_title: "White Bear Lake High School Internal Teams Meeting",
          suggested_description: "Internal Teams meeting linked to White Bear Lake High School.",
          scheduled_start_at: null,
          scheduled_end_at: null,
          app_deep_link: null,
          suggested_participants: []
        },
        meeting: null,
        recent_operations: []
      };
    }
    if (path === "/api/communications/records/organization/organization-1/history" && method === "GET") {
      return {
        object_type: "organization",
        object_id: "organization-1",
        object_label: "White Bear Lake High School",
        feature_enabled: true,
        permissions: {
          can_view_messages: true,
          can_view_meetings: true
        },
        summary: {
          latest_activity_at: "2026-04-03T12:15:00.000Z",
          latest_message: {
            kind: "message",
            action_type: "message_send",
            target_type: "chat",
            target_reference_id: "org-reference-1",
            target_id: "19:org-chat",
            target_label: "Account Team Chat",
            target_url: "https://teams.microsoft.com/l/chat/0/0?users=leadership@example.com",
            actor_user_id: "user-leadership",
            actor_name: "Demo Leadership",
            status: "sent",
            summary: "Sent update to Account Team Chat",
            join_url: null,
            failure_reason: null,
            occurred_at: "2026-04-03T12:15:00.000Z",
            created_at: "2026-04-03T12:15:00.000Z",
            updated_at: "2026-04-03T12:15:00.000Z"
          },
          latest_meeting: null,
          latest_failure: null
        },
        entries: []
      };
    }
    if (path === "/api/communications/records/location/location-1/meeting" && method === "GET") {
      return {
        object_type: "location",
        object_id: "location-1",
        object_label: "South Gym",
        feature_enabled: true,
        permissions: {
          can_use: true,
          can_manage: true
        },
        defaults: {
          suggested_title: "South Gym Internal Teams Meeting",
          suggested_description: "Internal Teams meeting linked to South Gym.",
          scheduled_start_at: null,
          scheduled_end_at: null,
          app_deep_link: null,
          suggested_participants: []
        },
        meeting: {
          id: "location-meeting-1",
          linked_record_type: "location",
          linked_record_id: "location-1",
          meeting_provider: "microsoft_teams",
          meeting_mode: "standalone_online_meeting",
          meeting_status: "scheduled",
          title: "South Gym Internal Teams Meeting",
          description: "Internal Teams meeting linked to South Gym.",
          meeting_join_url: "https://teams.microsoft.com/l/meetup-join/location-meeting-1",
          meeting_web_url: "https://teams.microsoft.com/l/meetup-join/location-meeting-1",
          external_meeting_id: "location-meeting-1",
          external_calendar_event_id: null,
          organizer_user_id: "user-leadership",
          organizer_email: "leadership@example.com",
          organizer_microsoft_user_id: "ms-user-1",
          participant_snapshot: [],
          app_deep_link: null,
          scheduled_start_at: "2026-04-10T15:00:00.000Z",
          scheduled_end_at: "2026-04-10T15:30:00.000Z",
          created_by_user_id: "user-leadership",
          updated_by_user_id: "user-leadership",
          last_sync_operation_id: null,
          last_sync_attempt_at: null,
          last_synced_at: "2026-04-03T12:15:00.000Z",
          sync_error: null,
          cancelled_at: null,
          created_at: "2026-04-03T12:00:00.000Z",
          updated_at: "2026-04-03T12:15:00.000Z"
        },
        recent_operations: []
      };
    }
    if (path === "/api/communications/records/location/location-1/history" && method === "GET") {
      return {
        object_type: "location",
        object_id: "location-1",
        object_label: "South Gym",
        feature_enabled: true,
        permissions: {
          can_view_messages: true,
          can_view_meetings: true
        },
        summary: {
          latest_activity_at: "2026-04-03T12:15:00.000Z",
          latest_message: null,
          latest_meeting: {
            kind: "meeting",
            action_type: "meeting_create",
            target_type: "meeting",
            target_reference_id: "location-meeting-1",
            target_id: "location-meeting-1",
            target_label: "South Gym Internal Teams Meeting",
            target_url: "https://teams.microsoft.com/l/meetup-join/location-meeting-1",
            actor_user_id: "user-leadership",
            actor_name: "Demo Leadership",
            status: "scheduled",
            summary: "Linked South Gym Internal Teams Meeting",
            join_url: "https://teams.microsoft.com/l/meetup-join/location-meeting-1",
            failure_reason: null,
            occurred_at: "2026-04-03T12:15:00.000Z",
            created_at: "2026-04-03T12:00:00.000Z",
            updated_at: "2026-04-03T12:15:00.000Z"
          },
          latest_failure: null
        },
        entries: []
      };
    }
    if (path.startsWith("/api/organizations/contacts?") && method === "GET") {
      const contactStatus = query.get("contact_status");
      const needsReview = query.get("needs_review");
      const myContactsOnly = query.get("my_contacts_only");
      const primaryInternalOwnerUserId = query.get("primary_internal_owner_user_id");
      return {
        contacts: contacts
          .filter((contact) => (contactStatus ? contact.contact_status === contactStatus : true))
          .filter((contact) => (needsReview === "true" ? contact.freshness_state === "needs_review" : true))
          .filter((contact) =>
            myContactsOnly === "true" ? contact.primary_internal_owner?.user_id === leadershipUser.id : true
          )
          .filter((contact) =>
            primaryInternalOwnerUserId ? contact.primary_internal_owner?.user_id === primaryInternalOwnerUserId : true
          )
          .map((contact) => ({
            ...contact,
            organization_display_name: organization.display_name,
            organization_account_type: organization.account_type
          })),
        search: { query: "", total: contacts.length }
      };
    }
    if (path.startsWith("/api/organizations/locations?") && method === "GET") {
      return {
        locations: locations.map((location) => ({
          ...location,
          organization_display_name: organization.display_name,
          organization_account_type: organization.account_type
        })),
        search: { query: "", total: locations.length }
      };
    }
    if (path === "/api/organizations/organization-1" && method === "GET") {
      return buildDetail();
    }
    if (path === "/api/organizations/organization-1/school-profile" && method === "PATCH") {
      schoolProfile = {
        ...schoolProfile,
        district_name: body.district_name ?? schoolProfile.district_name,
        school_type: body.school_type ?? schoolProfile.school_type,
        school_year_label: body.school_year_label ?? schoolProfile.school_year_label,
        relationship_health_state: body.relationship_health_state ?? schoolProfile.relationship_health_state,
        relationship_summary: body.relationship_summary ?? schoolProfile.relationship_summary,
        primary_internal_owner:
          body.primary_internal_owner_user_id === null
            ? null
            : toDirectoryInternalOwner(body.primary_internal_owner_user_id) ?? schoolProfile.primary_internal_owner,
        backup_internal_owner:
          body.backup_internal_owner_user_id === null
            ? null
            : toDirectoryInternalOwner(body.backup_internal_owner_user_id) ?? schoolProfile.backup_internal_owner,
        primary_location_id: body.primary_location_id ?? schoolProfile.primary_location_id,
        primary_location_name:
          locations.find((location) => location.id === (body.primary_location_id ?? schoolProfile.primary_location_id))
            ?.location_name ?? schoolProfile.primary_location_name,
        primary_location_address:
          locations.find((location) => location.id === (body.primary_location_id ?? schoolProfile.primary_location_id))
            ?.address_display ?? schoolProfile.primary_location_address,
        tags: body.tags ?? schoolProfile.tags,
        notes: body.notes ?? schoolProfile.notes,
        updated_at: "2026-03-30T15:00:00.000Z"
      };
      schoolActivity = [
        {
          id: `school-activity-${schoolActivity.length + 1}`,
          organization_id: "organization-1",
          activity_type: "profile_updated",
          summary: "School profile updated.",
          detail: body.relationship_summary ?? null,
          metadata: {},
          related_contact_id: null,
          related_contact_name: null,
          related_rule_id: null,
          actor_user_id: "user-leadership",
          actor_name: "Demo Leadership",
          created_at: "2026-03-30T15:00:00.000Z"
        },
        ...schoolActivity
      ];
      return buildDetail();
    }
    if (path === "/api/organizations/organization-1/contacts/contact-1/school-categories" && method === "PATCH") {
      contacts = contacts.map((contact) =>
        contact.id === "contact-1"
          ? {
              ...contact,
              school_contact_categories: body.school_contact_categories ?? []
            }
          : contact
      );
      schoolActivity = [
        {
          id: `school-activity-${schoolActivity.length + 1}`,
          organization_id: "organization-1",
          activity_type: "contact_categories_updated",
          summary: "Jamie Carlson school roles updated.",
          detail: (body.school_contact_categories ?? []).join(", "),
          metadata: {},
          related_contact_id: "contact-1",
          related_contact_name: "Jamie Carlson",
          related_rule_id: null,
          actor_user_id: "user-leadership",
          actor_name: "Demo Leadership",
          created_at: "2026-03-30T15:05:00.000Z"
        },
        ...schoolActivity
      ];
      return buildDetail();
    }
    if (path === "/api/organizations/organization-1/school-rules" && method === "POST") {
      const nextRule: SchoolRule = {
        id: `school-rule-${schoolRules.length + 1}`,
        organization_id: "organization-1",
        rule_type: body.rule_type,
        active_status: body.active_status ?? "active",
        title: body.title ?? "Untitled school rule",
        summary: body.summary ?? null,
        structured_value: body.structured_value ?? {},
        sort_order: body.sort_order ?? 0,
        created_by_name: "Demo Leadership",
        updated_by_name: "Demo Leadership",
        created_at: "2026-03-30T15:10:00.000Z",
        updated_at: "2026-03-30T15:10:00.000Z"
      };
      schoolRules = [nextRule, ...schoolRules];
      schoolActivity = [
        {
          id: `school-activity-${schoolActivity.length + 1}`,
          organization_id: "organization-1",
          activity_type: "rule_created",
          summary: `${nextRule.title} rule added.`,
          detail: nextRule.summary,
          metadata: {},
          related_contact_id: null,
          related_contact_name: null,
          related_rule_id: nextRule.id,
          actor_user_id: "user-leadership",
          actor_name: "Demo Leadership",
          created_at: "2026-03-30T15:10:00.000Z"
        },
        ...schoolActivity
      ];
      return buildDetail();
    }
    if (path.startsWith("/api/organizations/organization-1/school-rules/") && method === "PATCH") {
      const ruleId = path.split("/").pop() ?? "";
      schoolRules = schoolRules.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              title: body.title ?? rule.title,
              summary: body.summary ?? rule.summary,
              active_status: body.active_status ?? rule.active_status,
              structured_value: body.structured_value ?? rule.structured_value,
              sort_order: body.sort_order ?? rule.sort_order,
              updated_by_name: "Demo Leadership",
              updated_at: "2026-03-30T15:15:00.000Z"
            }
          : rule
      );
      schoolActivity = [
        {
          id: `school-activity-${schoolActivity.length + 1}`,
          organization_id: "organization-1",
          activity_type: "rule_updated",
          summary: "School rule updated.",
          detail: body.summary ?? null,
          metadata: {},
          related_contact_id: null,
          related_contact_name: null,
          related_rule_id: ruleId,
          actor_user_id: "user-leadership",
          actor_name: "Demo Leadership",
          created_at: "2026-03-30T15:15:00.000Z"
        },
        ...schoolActivity
      ];
      return buildDetail();
    }
    if (path === "/api/organizations/organization-1/school-notes" && method === "POST") {
      schoolActivity = [
        {
          id: `school-activity-${schoolActivity.length + 1}`,
          organization_id: "organization-1",
          activity_type: "note_added",
          summary: body.summary,
          detail: body.detail ?? null,
          metadata: {},
          related_contact_id: null,
          related_contact_name: null,
          related_rule_id: null,
          actor_user_id: "user-leadership",
          actor_name: "Demo Leadership",
          created_at: "2026-03-30T15:20:00.000Z"
        },
        ...schoolActivity
      ];
      return buildDetail();
    }
    if (path === "/api/organizations/organization-1/continuity" && method === "GET") {
      return buildContinuity("organization");
    }
    if (path.startsWith("/api/organizations/contacts/") && path.endsWith("/continuity") && method === "GET") {
      const contactId = path.split("/")[4] ?? "";
      return buildContinuity("contact", contactId);
    }
    if (path.startsWith("/api/organizations/contacts/") && method === "GET") {
      const contactId = path.split("/")[4] ?? "";
      contactDetailRequests.push(contactId);
      return {
        contact: contacts.find((contact) => contact.id === contactId),
        touchpoints: touchpoints.filter((touchpoint) => touchpoint.contact_id === contactId)
      };
    }
    if (path === "/api/organizations/organization-1/operations-hub" && method === "GET") {
      return buildOperationsHub();
    }
    if (path === "/api/organizations/organization-1/touchpoints" && method === "GET") {
      return { touchpoints, total: touchpoints.length };
    }
    if (path === "/api/organizations/duplicate-reviews" && method === "GET") {
      return { reviews: duplicateReviews, total: duplicateReviews.length };
    }
    if (path === "/api/organizations/organization-1/contacts" && method === "POST") {
      const newContact: OrganizationContact = {
        id: "contact-2",
        organization_id: "organization-1",
        canonical_organization_id: "organization-1",
        first_name: body.first_name,
        last_name: body.last_name,
        full_name: `${body.first_name} ${body.last_name}`,
        preferred_name: body.preferred_name ?? null,
        title: body.title ?? null,
        department_program: body.department_program ?? null,
        phone: body.phone ?? null,
        email: body.email ?? null,
        photo_url: body.photo_url ?? null,
        active_status: "active",
        contact_status: body.contact_status ?? "active",
        role_category: body.role_category ?? "other",
        operational_importance: body.operational_importance ?? "normal",
        decision_influence: body.decision_influence ?? "informational_only",
        relationship_strength: body.relationship_strength ?? "unknown",
        primary_internal_owner: toDirectoryInternalOwner(body.primary_internal_owner_user_id),
        backup_internal_owner: toDirectoryInternalOwner(body.backup_internal_owner_user_id),
        ownership_state: body.primary_internal_owner_user_id ? "owned" : "unassigned",
        freshness_state: body.contact_status === "needs_review" || body.uncertainty_flag ? "needs_review" : "fresh",
        last_confirmed_at: body.last_confirmed_at ?? null,
        last_meaningful_interaction_at: null,
        primary_location_id: null,
        primary_location_name: null,
        linked_location_names: [],
        strongest_internal_relationship: toDirectoryInternalOwner(body.primary_internal_owner_user_id),
        last_spoke_with: null,
        additional_internal_connected_staff: [],
        handoff_ready: Boolean(body.handoff_ready),
        uncertainty_flag: Boolean(body.uncertainty_flag),
        maintenance_signals: [],
        last_updated_by_name: "Demo Leadership",
        relationship_role: "general",
        is_primary: false,
        school_contact_categories: [],
        relationship_history: [
          {
            id: "relationship-current-2",
            organization_id: "organization-1",
            organization_display_name: "White Bear Lake High School",
            organization_account_type: "schools_underclass_portraits",
            relationship_role: "general",
            is_primary: false,
            is_current: true,
            relationship_state: "current",
            start_date: "2026-03-28",
            end_date: null,
            created_at: "2026-03-28T10:00:00.000Z",
            updated_at: "2026-03-28T10:00:00.000Z"
          }
        ],
        notes: body.notes ?? null,
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z"
      };
      contacts = [...contacts, newContact];
      return buildDetail();
    }
    if (path === "/api/organizations/contacts/contact-1" && method === "PATCH") {
      contacts = contacts.map((contact) =>
        contact.id === "contact-1"
          ? {
              ...contact,
              first_name: body.first_name,
              last_name: body.last_name,
              full_name: `${body.first_name} ${body.last_name}`,
              preferred_name: body.preferred_name ?? null,
              title: body.title,
              department_program: body.department_program ?? null,
              phone: body.phone,
              email: body.email,
              photo_url: body.photo_url,
              contact_status: body.contact_status ?? contact.contact_status,
              role_category: body.role_category ?? contact.role_category,
              operational_importance: body.operational_importance ?? contact.operational_importance,
              decision_influence: body.decision_influence ?? contact.decision_influence,
              relationship_strength: body.relationship_strength ?? contact.relationship_strength,
              primary_internal_owner:
                body.primary_internal_owner_user_id === null
                  ? undefined
                  : toDirectoryInternalOwner(body.primary_internal_owner_user_id) ?? contact.primary_internal_owner,
              backup_internal_owner:
                body.backup_internal_owner_user_id === null
                  ? undefined
                  : toDirectoryInternalOwner(body.backup_internal_owner_user_id) ?? contact.backup_internal_owner,
              last_confirmed_at: body.last_confirmed_at ?? contact.last_confirmed_at,
              handoff_ready: body.handoff_ready ?? contact.handoff_ready,
              uncertainty_flag: body.uncertainty_flag ?? contact.uncertainty_flag,
              notes: body.notes
            }
          : contact
      );
      return buildDetail();
    }
    if (path === "/api/organizations/organization-1/touchpoints" && method === "POST") {
      const record: DirectoryTouchpointRecord = {
        id: `touchpoint-${touchpoints.length + 1}`,
        organization_id: "organization-1",
        location_id: body.location_id ?? null,
        shoot_id: body.shoot_id ?? null,
        contact_id: body.contact_id ?? null,
        channel: body.channel,
        category: body.category ?? null,
        subject: body.subject ?? null,
        summary: body.summary,
        outcome: body.outcome ?? null,
        outcome_state: body.outcome_state ?? null,
        owner_user_id: "user-leadership",
        owner_name: "Demo Leadership",
        occurred_at: body.occurred_at ?? "2026-03-28T11:00:00.000Z",
        follow_up_date: body.follow_up_date ?? null,
        follow_up_needed: Boolean(body.follow_up_needed),
        follow_up_owner: toDirectoryInternalOwner(body.follow_up_owner_user_id) ?? null,
        relationship_memory_suggested: Boolean(body.relationship_memory_suggested),
        attachment_reference: body.attachment_reference ?? null,
        touchpoint_plan_id: body.touchpoint_plan_id ?? null,
        created_at: "2026-03-28T11:00:00.000Z",
        updated_at: "2026-03-28T11:00:00.000Z"
      };
      touchpoints = [record, ...touchpoints];
      if (body.follow_up_needed) {
        followUps = [
          {
            id: `follow-up-${followUps.length + 1}`,
            organization_id: "organization-1",
            location_id: body.location_id ?? null,
            contact_id: body.contact_id ?? null,
            linked_shoot_id: body.shoot_id ?? null,
            source_touchpoint_id: record.id,
            source_touchpoint_plan_id: body.touchpoint_plan_id ?? null,
            title: body.subject ?? "Follow up on communication",
            summary: body.outcome ?? body.summary ?? null,
            owner: toDirectoryInternalOwner(body.follow_up_owner_user_id) ?? toDirectoryInternalOwner("user-leadership"),
            backup_owner: null,
            due_at: `${body.follow_up_date ?? "2026-03-31"}T17:00:00.000Z`,
            status: "open",
            completed_at: null,
            resolution_note: null,
            created_at: "2026-03-28T11:00:00.000Z",
            updated_at: "2026-03-28T11:00:00.000Z"
          },
          ...followUps
        ];
      }
      if (body.relationship_memory_suggested && body.memory_summary && body.memory_why_it_matters) {
        relationshipMemory = [
          {
            id: `memory-${relationshipMemory.length + 1}`,
            organization_id: "organization-1",
            location_id: body.location_id ?? null,
            contact_id: body.contact_id ?? null,
            source_touchpoint_id: record.id,
            memory_type: body.memory_type ?? "other",
            summary: body.memory_summary,
            why_it_matters: body.memory_why_it_matters,
            source_label: body.subject ?? "Suggested from communication",
            visibility: body.memory_visibility ?? "manager_plus",
            status: "needs_review",
            created_by: toDirectoryInternalOwner("user-leadership"),
            reviewed_by: null,
            reviewed_at: null,
            last_confirmed_at: null,
            created_at: "2026-03-28T11:00:00.000Z",
            updated_at: "2026-03-28T11:00:00.000Z"
          },
          ...relationshipMemory
        ];
      }
      return record;
    }
    if (path === "/api/organizations/organization-1/touchpoint-plans" && method === "POST") {
      const record: DirectoryTouchpointPlan = {
        id: `touchpoint-plan-${touchpointPlans.length + 1}`,
        organization_id: "organization-1",
        location_id: body.location_id ?? null,
        contact_id: body.contact_id ?? null,
        linked_shoot_id: body.linked_shoot_id ?? null,
        template_id: body.template_id ?? null,
        category: body.category,
        title: body.title,
        summary: body.summary ?? null,
        status: "planned",
        owner_user_id: body.owner_user_id ?? null,
        owner_name: ownerOptions.find((owner) => owner.user_id === body.owner_user_id)?.full_name ?? null,
        backup_owner: toDirectoryInternalOwner(body.backup_owner_user_id) ?? null,
        due_at: body.due_at,
        completed_at: null,
        skipped_reason: null,
        cancelled_reason: null,
        completion_note: null,
        created_at: "2026-03-28T12:00:00.000Z",
        updated_at: "2026-03-28T12:00:00.000Z"
      };
      touchpointPlans = [record, ...touchpointPlans];
      return record;
    }
    if (path.startsWith("/api/organizations/touchpoint-plans/") && method === "PATCH") {
      const planId = path.split("/").pop() ?? "";
      const nextStatus = body.status ?? "planned";
      touchpointPlans = touchpointPlans.map((plan) =>
        plan.id === planId
          ? {
              ...plan,
              status: nextStatus,
              completed_at: nextStatus === "completed" ? "2026-03-30T12:15:00.000Z" : null,
              skipped_reason: body.skipped_reason ?? plan.skipped_reason,
              cancelled_reason: body.cancelled_reason ?? plan.cancelled_reason,
              completion_note: body.completion_note ?? plan.completion_note,
              updated_at: "2026-03-30T12:15:00.000Z"
            }
          : plan
      );
      return touchpointPlans.find((plan) => plan.id === planId);
    }
    if (path === "/api/organizations/organization-1/relationship-memory" && method === "POST") {
      const record: DirectoryRelationshipMemoryRecord = {
        id: `memory-${relationshipMemory.length + 1}`,
        organization_id: "organization-1",
        location_id: body.location_id ?? null,
        contact_id: body.contact_id ?? null,
        source_touchpoint_id: body.source_touchpoint_id ?? null,
        memory_type: body.memory_type,
        summary: body.summary,
        why_it_matters: body.why_it_matters,
        source_label: body.source_label ?? null,
        visibility: body.visibility ?? "manager_plus",
        status: "active",
        created_by: toDirectoryInternalOwner("user-leadership"),
        reviewed_by: null,
        reviewed_at: null,
        last_confirmed_at: body.last_confirmed_at ?? null,
        created_at: "2026-03-28T12:05:00.000Z",
        updated_at: "2026-03-28T12:05:00.000Z"
      };
      relationshipMemory = [record, ...relationshipMemory];
      return record;
    }
    if (path.startsWith("/api/organizations/relationship-memory/") && method === "PATCH") {
      const memoryId = path.split("/").pop() ?? "";
      relationshipMemory = relationshipMemory.map((entry) =>
        entry.id === memoryId
          ? {
              ...entry,
              status: body.status ?? entry.status,
              last_confirmed_at: body.last_confirmed_at ?? entry.last_confirmed_at,
              updated_at: "2026-03-30T12:20:00.000Z"
            }
          : entry
      );
      return relationshipMemory.find((entry) => entry.id === memoryId);
    }
    if (path === "/api/organizations/organization-1/follow-ups" && method === "POST") {
      const record: DirectoryRelationshipFollowUpRecord = {
        id: `follow-up-${followUps.length + 1}`,
        organization_id: "organization-1",
        location_id: body.location_id ?? null,
        contact_id: body.contact_id ?? null,
        linked_shoot_id: body.linked_shoot_id ?? null,
        source_touchpoint_id: body.source_touchpoint_id ?? null,
        source_touchpoint_plan_id: body.source_touchpoint_plan_id ?? null,
        title: body.title,
        summary: body.summary ?? null,
        owner: toDirectoryInternalOwner(body.owner_user_id) ?? null,
        backup_owner: toDirectoryInternalOwner(body.backup_owner_user_id) ?? null,
        due_at: body.due_at,
        status: "open",
        completed_at: null,
        resolution_note: null,
        created_at: "2026-03-28T12:10:00.000Z",
        updated_at: "2026-03-28T12:10:00.000Z"
      };
      followUps = [record, ...followUps];
      return record;
    }
    if (path.startsWith("/api/organizations/follow-ups/") && method === "PATCH") {
      const followUpId = path.split("/").pop() ?? "";
      followUps = followUps.map((entry) =>
        entry.id === followUpId
          ? {
              ...entry,
              status: body.status ?? entry.status,
              resolution_note: body.resolution_note ?? entry.resolution_note,
              completed_at: body.status === "completed" ? "2026-03-30T12:25:00.000Z" : entry.completed_at,
              updated_at: "2026-03-30T12:25:00.000Z"
            }
          : entry
      );
      return followUps.find((entry) => entry.id === followUpId);
    }
    if (path === "/api/organizations/locations/location-1/contacts" && method === "POST") {
      const contact = contacts.find((item) => item.id === body.contact_id)!;
      locations = locations.map((location) =>
        location.id === "location-1"
          ? {
              ...location,
              contact_links: [
                {
                  contact_id: contact.id,
                  full_name: contact.full_name,
                  title: contact.title,
                  phone: contact.phone,
                  email: contact.email,
                  relationship_role: body.relationship_role ?? "day_of",
                  is_primary: Boolean(body.is_primary),
                  canonical_organization_id: "organization-1"
                }
              ]
            }
          : location
      );
      return buildDetail();
    }
    if (path === "/api/organizations/shoots/shoot-1/contacts" && method === "POST") {
      shootLinks.push(body.contact_id);
      return {
        shoot_id: "shoot-1",
        organization_id: "organization-1",
        primary_contact_id: body.is_primary ? body.contact_id : null,
        contact_links: [
          {
            contact_id: body.contact_id,
            full_name: contacts.find((contact) => contact.id === body.contact_id)?.full_name ?? "Unknown",
            title: null,
            phone: null,
            email: null,
            contact_role: body.is_primary ? "primary" : "additional",
            relationship_role: body.relationship_role ?? "day_of",
            is_primary: Boolean(body.is_primary),
            sort_order: 0
          }
        ]
      };
    }
    if (path === "/api/organizations/duplicate-reviews" && method === "POST") {
      const record: DirectoryDuplicateReviewRecord = {
        id: "review-1",
        primary_contact_id: body.primary_contact_id,
        primary_contact_name: contacts.find((contact) => contact.id === body.primary_contact_id)?.full_name ?? null,
        suspected_duplicate_contact_id: body.suspected_duplicate_contact_id,
        suspected_duplicate_contact_name: contacts.find((contact) => contact.id === body.suspected_duplicate_contact_id)?.full_name ?? null,
        status: "open",
        decision: "pending",
        summary: body.summary,
        notes: body.notes ?? null,
        created_by_user_id: "user-leadership",
        created_by_name: "Demo Leadership",
        reviewed_by_user_id: null,
        reviewed_by_name: null,
        reviewed_at: null,
        created_at: "2026-03-28T12:00:00.000Z",
        updated_at: "2026-03-28T12:00:00.000Z"
      };
      duplicateReviews = [record];
      return record;
    }
    if (path === "/api/organizations/contact-import-sessions" && method === "POST") {
      return buildImportSession();
    }
    if (path === "/api/organizations/contact-import-sessions" && method === "GET") {
      return {
        sessions: [
          {
            id: "import-session-1",
            source_file_name: "contacts.csv",
            import_kind: "contacts_csv",
            status: importSession?.status ?? "staged",
            has_header_row: true,
            default_organization_id: "organization-1",
            summary: (importSession ?? buildImportSession()).summary,
            created_by_user_id: "user-leadership",
            applied_by_user_id: importSession?.applied_by_user_id ?? null,
            applied_at: importSession?.applied_at ?? null,
            created_at: "2026-03-29T09:00:00.000Z",
            updated_at: "2026-03-29T09:00:00.000Z"
          }
        ],
        total: 1
      };
    }
    if (path === "/api/organizations/contact-import-sessions/import-session-1" && method === "GET") {
      return buildImportSession();
    }
    if (path.startsWith("/api/organizations/contact-import-sessions/import-session-1/rows/") && method === "PATCH") {
      const rowId = path.split("/").pop() ?? "";
      const nextAction = body.selected_action ?? "needs_review";
      const nextRows = buildImportSession().rows.map((row) =>
        row.id === rowId
          ? {
              ...row,
              status: nextAction === "skip" ? "skipped" : row.status,
              selected_action: nextAction,
              selected_contact_id: body.selected_contact_id ?? null,
              resolved_organization_id: body.resolved_organization_id ?? row.resolved_organization_id,
              review_note: body.review_note ?? null,
              result_summary: nextAction === "skip" ? "Skipped until a human confirms the duplicate." : null
            }
          : row
      );
      importSession = {
        ...buildImportSession(),
        rows: nextRows,
        summary: {
          ...buildImportSession().summary,
          needs_review: nextRows.filter((row) => row.status === "needs_review").length,
          skipped: nextRows.filter((row) => row.status === "skipped").length
        }
      };
      return importSession;
    }
    if (path === "/api/organizations/contact-import-sessions/import-session-1/apply" && method === "POST") {
      importSession = {
        ...buildImportSession(),
        status: "applied",
        applied_by_user_id: "user-leadership",
        applied_at: "2026-03-29T09:10:00.000Z",
        summary: {
          ...buildImportSession().summary,
          ready_to_create: 0,
          needs_review: 0,
          skipped: 1,
          applied: 1
        },
        rows: buildImportSession().rows.map((row) =>
          row.id === "import-row-1"
            ? {
                ...row,
                status: "applied",
                selected_action: "create_contact",
                applied_contact_id: "contact-imported-1",
                applied_relationship_id: "relationship-imported-1",
                result_summary: "Created Taylor Rowe and linked the contact to White Bear Lake High School."
              }
            : {
                ...row,
                status: "skipped",
                selected_action: row.selected_action ?? "skip",
                result_summary: "Skipped until a human confirms the duplicate."
              }
        )
      };
      contacts = [
        ...contacts,
        {
          id: "contact-imported-1",
          organization_id: "organization-1",
          canonical_organization_id: "organization-1",
          first_name: "Taylor",
          last_name: "Rowe",
          full_name: "Taylor Rowe",
          title: "Assistant Coach",
          phone: "555-0101",
          email: "taylor.rowe@example.com",
          photo_url: null,
          active_status: "active",
          relationship_role: "planning",
          is_primary: false,
          relationship_history: [
            {
              id: "relationship-imported-1",
              organization_id: "organization-1",
              organization_display_name: "White Bear Lake High School",
              organization_account_type: "schools_underclass_portraits",
              relationship_role: "planning",
              is_primary: false,
              is_current: true,
              relationship_state: "current",
              start_date: "2026-03-01",
              end_date: null,
              created_at: "2026-03-29T09:10:00.000Z",
              updated_at: "2026-03-29T09:10:00.000Z"
            }
          ],
          notes: "New planning contact",
          created_at: "2026-03-29T09:10:00.000Z",
          updated_at: "2026-03-29T09:10:00.000Z"
        }
      ];
      return importSession;
    }

    throw new Error(`Unexpected call: ${method} ${path}`);
  });

  return {
    getContactDetailRequests: () => contactDetailRequests,
    getShootLinks: () => shootLinks,
    getTouchpoints: () => touchpoints
  };
}

describe("organizations workflow surface", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    window.history.replaceState(null, "", "#directory/accounts?view=organizations");
  });

  async function openRelationshipsTab() {
    await screen.findByRole("button", { name: "Profile" });
    fireEvent.click(screen.getByRole("button", { name: "Relationships" }));
    await screen.findByRole("button", { name: "Edit Jamie Carlson" });
  }

  it("creates a new contact from a drawer instead of a permanent page form", async () => {
    createDirectoryHarness();

    render(<Organizations token="token" currentUser={leadershipUser} />);

    expect(await screen.findByText("White Bear Lake High School")).toBeInTheDocument();
    await screen.findByRole("button", { name: "Edit organization" });

    fireEvent.click(screen.getAllByRole("button", { name: "New contact" })[0]);

    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Rivera" } });
    fireEvent.change(screen.getByLabelText("Role or title"), { target: { value: "Principal" } });

    fireEvent.click(screen.getByRole("button", { name: "Create contact" }));

    const matches = await screen.findAllByText((content) => content.includes("Sam Rivera"));
    expect(matches.length).toBeGreaterThan(0);
  });

  it("edits a contact and refreshes the relationship card", async () => {
    createDirectoryHarness();

    render(<Organizations token="token" currentUser={leadershipUser} />);

    expect(await screen.findByText("White Bear Lake High School")).toBeInTheDocument();
    await openRelationshipsTab();

    fireEvent.click(screen.getByRole("button", { name: "Edit Jamie Carlson" }));
    fireEvent.change(screen.getByLabelText("Role or title"), { target: { value: "Principal" } });
    fireEvent.click(screen.getByRole("button", { name: "Save contact" }));

    expect(await screen.findByText(/Principal - jamie.carlson@example.com/i)).toBeInTheDocument();
  });

  it("logs a communication and moves the workspace into the continuity tab", async () => {
    const harness = createDirectoryHarness();

    render(<Organizations token="token" currentUser={leadershipUser} />);

    expect(await screen.findByText("White Bear Lake High School")).toBeInTheDocument();
    await openRelationshipsTab();

    fireEvent.click(screen.getByRole("button", { name: "Log communication for Jamie Carlson" }));
    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "Confirmed arrival window with the office." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Log communication" })[1]);

    await waitFor(() => {
      expect(harness.getTouchpoints()).toHaveLength(1);
    });
    expect(window.location.hash).toContain("tab=touchpoints");
    expect(screen.getByRole("button", { name: "Continuity" })).toBeInTheDocument();
  });

  it("attaches a contact to a location and shows the relationship inline", async () => {
    createDirectoryHarness();

    render(<Organizations token="token" currentUser={leadershipUser} />);

    expect(await screen.findByText("White Bear Lake High School")).toBeInTheDocument();
    await openRelationshipsTab();

    fireEvent.click(screen.getByRole("button", { name: "Attach Jamie Carlson to a location" }));
    fireEvent.click(screen.getByRole("button", { name: "Attach to location" }));

    await waitFor(() => {
      expect(screen.getByText("Day-of Contact For")).toBeInTheDocument();
    });
  });

  it("attaches a contact to a shoot through the operational action drawer", async () => {
    const harness = createDirectoryHarness();

    render(<Organizations token="token" currentUser={leadershipUser} />);

    expect(await screen.findByText("White Bear Lake High School")).toBeInTheDocument();
    await openRelationshipsTab();

    fireEvent.click(screen.getByRole("button", { name: "Attach Jamie Carlson to a shoot" }));
    fireEvent.click(screen.getByRole("button", { name: "Attach to shoot" }));

    await waitFor(() => {
      expect(harness.getShootLinks()).toContain("contact-1");
    });
  });

  it("shows the operations tab as an action surface instead of a passive account registry", async () => {
    createDirectoryHarness();

    render(<Organizations token="token" currentUser={leadershipUser} />);

    expect(await screen.findByText("White Bear Lake High School")).toBeInTheDocument();
    expect(
      apiFetchMock.mock.calls.some(
        ([path]) => typeof path === "string" && path === "/api/organizations/organization-1/operations-hub"
      )
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Operations" }));

    await waitFor(() => {
      expect(
        apiFetchMock.mock.calls.some(
          ([path]) => typeof path === "string" && path === "/api/organizations/organization-1/operations-hub"
        )
      ).toBe(true);
    });
    expect((await screen.findAllByText("Relationship Health")).length).toBeGreaterThan(0);
    expect(screen.getByText("Follow-Up (1)")).toBeInTheDocument();
    expect(screen.getByText("Linked Production (1)")).toBeInTheDocument();
    expect(screen.getByText(/Timeline \(/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Log communication" }).length).toBeGreaterThan(0);

    const relatedWorkPanel = screen.getByLabelText("Directory related work links");
    expect(within(relatedWorkPanel).getByText("Related Work Links")).toBeInTheDocument();
    expect(within(relatedWorkPanel).getByText("Post-Shoot Production Wrap")).toBeInTheDocument();
    expect(within(relatedWorkPanel).getByText("Project Tracking")).toBeInTheDocument();

    fireEvent.click(within(relatedWorkPanel).getByRole("button", { name: "Open in Project Tracking" }));
    await waitFor(() => {
      expect(window.location.hash).toBe("#project-tracking/workflows/workflow-related-1");
    });
  });

  it("keeps contact records honest when no direct work link exists", async () => {
    createDirectoryHarness();
    window.history.replaceState(null, "", "#directory/contacts");

    render(<Organizations token="token" currentUser={leadershipUser} entryView="contacts" />);

    const relatedWorkPanel = await screen.findByLabelText("Directory related work links");

    expect(within(relatedWorkPanel).getByText("Relationship Context")).toBeInTheDocument();
    expect(within(relatedWorkPanel).getByText("Connected organization: White Bear Lake High School")).toBeInTheDocument();
    expect(within(relatedWorkPanel).getByText(/does not have a direct work link/i)).toBeInTheDocument();
    expect(within(relatedWorkPanel).getByRole("button", { name: "Open organization" })).toBeInTheDocument();
    expect(within(relatedWorkPanel).queryByText(/Active work:/i)).not.toBeInTheDocument();
  });

  it("shows a school-focused detail panel with overview, rules, and timeline context", async () => {
    createDirectoryHarness();

    render(<Organizations token="token" currentUser={leadershipUser} />);

    expect(await screen.findByText("White Bear Lake High School")).toBeInTheDocument();
    await screen.findByRole("button", { name: "Edit organization" });

    const schoolPanel = (await screen.findByText("School Detail")).closest(".school-detail-panel");
    expect(schoolPanel).not.toBeNull();

    expect(within(schoolPanel as HTMLElement).getAllByText("White Bear Lake Area Schools").length).toBeGreaterThan(0);
    expect(within(schoolPanel as HTMLElement).getAllByText("High School").length).toBeGreaterThan(0);

    fireEvent.click(within(schoolPanel as HTMLElement).getByRole("button", { name: "Rules / Settings" }));
    expect(await within(schoolPanel as HTMLElement).findByText("Subject directory delivery")).toBeInTheDocument();
    expect(within(schoolPanel as HTMLElement).getByText("Homeroom")).toBeInTheDocument();
    expect(within(schoolPanel as HTMLElement).getByText("Roster Required")).toBeInTheDocument();
    expect(within(schoolPanel as HTMLElement).getByText("Yes")).toBeInTheDocument();
    expect(within(schoolPanel as HTMLElement).getByText("Packet Contents")).toBeInTheDocument();
    expect(within(schoolPanel as HTMLElement).getAllByText("Subject directories").length).toBeGreaterThan(0);
    expect(within(schoolPanel as HTMLElement).getByText("Delivery Window")).toBeInTheDocument();
    expect(within(schoolPanel as HTMLElement).getByText("Start")).toBeInTheDocument();
    expect(within(schoolPanel as HTMLElement).getByText("8:00 AM")).toBeInTheDocument();

    fireEvent.click(within(schoolPanel as HTMLElement).getByRole("button", { name: "Timeline" }));
    expect(await within(schoolPanel as HTMLElement).findByText("School profile established.")).toBeInTheDocument();
  });

  it("keeps school foundation editing behind the stricter school permission path", async () => {
    createDirectoryHarness();

    render(<Organizations token="token" currentUser={directoryManagerUser} />);

    expect(await screen.findByText("White Bear Lake High School")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Edit organization" })).toBeInTheDocument();
    expect(screen.getByText("Read-only school foundation")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit school profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add note" })).not.toBeInTheDocument();
  });

  it("supports editing the school profile, updating school contact roles, and adding school notes", async () => {
    createDirectoryHarness();

    render(<Organizations token="token" currentUser={leadershipUser} />);

    expect(await screen.findByText("White Bear Lake High School")).toBeInTheDocument();
    await screen.findByRole("button", { name: "Edit organization" });

    fireEvent.click(screen.getByRole("button", { name: "Edit school profile" }));
    fireEvent.change(screen.getByLabelText("District"), { target: { value: "ISD 624" } });
    fireEvent.change(screen.getByLabelText("School year"), { target: { value: "2027-2028" } });
    fireEvent.click(screen.getByRole("button", { name: "Save school profile" }));

    const schoolPanel = () => screen.getByText("School Detail").closest(".school-detail-panel") as HTMLElement;

    await waitFor(() => {
      expect(within(schoolPanel()).getAllByText("ISD 624").length).toBeGreaterThan(0);
      expect(within(schoolPanel()).getAllByText("2027-2028").length).toBeGreaterThan(0);
    });

    expect(schoolPanel()).not.toBeNull();

    fireEvent.click(within(schoolPanel()).getByRole("button", { name: "Contacts" }));
    fireEvent.click(within(schoolPanel()).getByRole("button", { name: "Edit school roles" }));
    fireEvent.click(screen.getByLabelText("Graduation Contact"));
    fireEvent.click(screen.getByRole("button", { name: "Save school roles" }));

    await waitFor(() => {
      expect(within(schoolPanel()).getAllByText("Graduation Contact").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    fireEvent.change(screen.getByLabelText("Note summary"), { target: { value: "Graduation packet timing changed" } });
    fireEvent.change(screen.getByLabelText("Detail"), { target: { value: "The office now wants graduation admin packets delivered two weeks earlier." } });
    fireEvent.click(screen.getByRole("button", { name: "Add school note" }));

    fireEvent.click(within(schoolPanel()).getByRole("button", { name: "Notes" }));
    expect(await within(schoolPanel()).findByText("Graduation packet timing changed")).toBeInTheDocument();
  });

  it("supports the explicit Contacts entry point and uses human-facing organization labels", async () => {
    createDirectoryHarness();
    window.history.replaceState(null, "", "#directory/contacts");

    render(<Organizations token="token" currentUser={leadershipUser} entryView="contacts" />);

    expect(await screen.findByText("Keep people visible, not buried inside accounts")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        apiFetchMock.mock.calls.some(
          ([path]) => typeof path === "string" && path.startsWith("/api/organizations/contacts?")
        )
      ).toBe(true);
    });
    expect(
      apiFetchMock.mock.calls.some(([path]) => typeof path === "string" && path.startsWith("/api/organizations?"))
    ).toBe(false);
    expect(
      apiFetchMock.mock.calls.some(([path]) => typeof path === "string" && path.startsWith("/api/organizations/locations?"))
    ).toBe(false);
    expect(screen.getByRole("button", { name: /Company Directory/i })).toBeInTheDocument();
    expect(await screen.findByText("Operational Role")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Organizations/i }));
    fireEvent.click(await screen.findByRole("button", { name: "New organization" }));

    expect(await screen.findByLabelText("Organization name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Canonical name")).not.toBeInTheDocument();
  });

  it("loads only the organization slice for the default directory landing", async () => {
    createDirectoryHarness();

    render(<Organizations token="token" currentUser={leadershipUser} />);

    expect(await screen.findByText("Find the right canonical record fast")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        apiFetchMock.mock.calls.some(([path]) => typeof path === "string" && path.startsWith("/api/organizations?"))
      ).toBe(true);
    });
    expect(
      apiFetchMock.mock.calls.some(([path]) => typeof path === "string" && path.startsWith("/api/organizations/contacts?"))
    ).toBe(false);
    expect(
      apiFetchMock.mock.calls.some(([path]) => typeof path === "string" && path.startsWith("/api/organizations/locations?"))
    ).toBe(false);
  });

  it("surfaces source-of-truth checks and routes work actions to existing hubs", async () => {
    createDirectoryHarness();

    render(<Organizations token="token" currentUser={leadershipUser} />);

    const sourceOfTruthHub = await screen.findByLabelText("Contacts and Organizations source-of-truth checks");

    expect(within(sourceOfTruthHub).getByText("Contacts + Organizations Source of Truth")).toBeInTheDocument();
    expect(within(sourceOfTruthHub).getByText("Confirm the record before work moves")).toBeInTheDocument();
    expect(within(sourceOfTruthHub).getByText("Current view")).toBeInTheDocument();
    expect(within(sourceOfTruthHub).getByText("Needs follow-up")).toBeInTheDocument();
    expect(within(sourceOfTruthHub).getByText("Owner gaps")).toBeInTheDocument();
    expect(within(sourceOfTruthHub).getByText("Primary contacts")).toBeInTheDocument();

    fireEvent.click(within(sourceOfTruthHub).getByRole("button", { name: "View in Project Tracking" }));
    await waitFor(() => {
      expect(window.location.hash).toBe("#project-tracking");
    });

    fireEvent.click(within(sourceOfTruthHub).getByRole("button", { name: "Review Relationship Health" }));
    await waitFor(() => {
      expect(window.location.hash).toBe("#directory/accounts");
    });
  });

  it("shows a focused import workflow with duplicate warnings from the Contacts workspace", async () => {
    createDirectoryHarness();
    window.history.replaceState(null, "", "#directory/contacts");

    render(<Organizations token="token" currentUser={leadershipUser} entryView="contacts" />);

    expect(await screen.findByText("Keep people visible, not buried inside accounts")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Import Contacts" })[0]);

    const file = new File(
      ["first_name,last_name,email,organization_name\nTaylor,Rowe,taylor.rowe@example.com,White Bear Lake High School"],
      "contacts.csv",
      { type: "text/csv" }
    );
    fireEvent.change(await screen.findByLabelText("Choose CSV file"), {
      target: { files: [file] }
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));

    expect(await screen.findByText("Import Summary")).toBeInTheDocument();
    expect(screen.getByText("Duplicate Review Needed")).toBeInTheDocument();
    expect(screen.getByText("Pat Morgan")).toBeInTheDocument();
    expect(screen.getByText("Strong name and phone match")).toBeInTheDocument();
  });

  it("shows recent import sessions and can reopen a staged review", async () => {
    createDirectoryHarness();
    window.history.replaceState(null, "", "#directory/contacts");

    render(<Organizations token="token" currentUser={leadershipUser} entryView="contacts" />);

    expect(await screen.findByText("Keep people visible, not buried inside accounts")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Import Contacts" })[0]);

    expect(await screen.findByText("Recent Imports")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Open staged review" }));

    expect(await screen.findByText("Import Summary")).toBeInTheDocument();
    expect(screen.getByText("contacts.csv")).toBeInTheDocument();
  });

  it("supports resolving a missing organization during import review", async () => {
    createDirectoryHarness({ unresolvedImportOrganization: true });
    window.history.replaceState(null, "", "#directory/contacts");

    render(<Organizations token="token" currentUser={leadershipUser} entryView="contacts" />);

    expect(await screen.findByText("Keep people visible, not buried inside accounts")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Import Contacts" })[0]);

    const file = new File(
      ["first_name,last_name,email,organization_name\nTaylor,Rowe,taylor.rowe@example.com,Unresolved School"],
      "contacts.csv",
      { type: "text/csv" }
    );
    fireEvent.change(await screen.findByLabelText("Choose CSV file"), {
      target: { files: [file] }
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));

    expect(await screen.findByText("Organization resolution needed")).toBeInTheDocument();

    const unresolvedRow = screen.getByText("Row 1: Taylor Rowe").closest("article");
    expect(unresolvedRow).not.toBeNull();

    fireEvent.change(within(unresolvedRow as HTMLElement).getByPlaceholderText("Search schools, leagues, districts, or accounts"), {
      target: { value: "White Bear Lake" }
    });
    fireEvent.click(within(unresolvedRow as HTMLElement).getByRole("button", { name: "Search" }));
    fireEvent.change(within(unresolvedRow as HTMLElement).getByLabelText("Organization"), {
      target: { value: "organization-1" }
    });
    fireEvent.click(within(unresolvedRow as HTMLElement).getByRole("button", { name: "Save row decision" }));

    expect(await screen.findByText("Row review saved.")).toBeInTheDocument();
  });

  it("shows current and previous organizations in the contact relationship history view", async () => {
    createDirectoryHarness();
    window.history.replaceState(null, "", "#directory/contacts");

    render(<Organizations token="token" currentUser={leadershipUser} entryView="contacts" />);

    expect(await screen.findByText("Keep people visible, not buried inside accounts")).toBeInTheDocument();
    expect(await screen.findByText("Relationship History")).toBeInTheDocument();
    expect(screen.getByText("Current Organizations")).toBeInTheDocument();
    expect(screen.getByText("Previous Organizations")).toBeInTheDocument();
    expect(screen.getAllByText("White Bear Lake High School").length).toBeGreaterThan(0);
    const previousRelationship = screen.getByText("Metro League").closest(".directory-history-list__content");
    expect(previousRelationship).not.toBeNull();
    expect(screen.getByText(/Current since/i)).toBeInTheDocument();
    expect(previousRelationship).toHaveTextContent(/2024/);
  });

  it("filters relationship history without hiding the contact workspace", async () => {
    createDirectoryHarness();
    window.history.replaceState(null, "", "#directory/contacts");

    render(<Organizations token="token" currentUser={leadershipUser} entryView="contacts" />);

    expect(await screen.findByText("Relationship History")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous only" }));
    expect(screen.queryByText("Current Organizations")).toBeInTheDocument();
    expect(screen.getByText("Metro League")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Company only" }));
    expect(screen.getByText("No previous organization relationships on file.")).toBeInTheDocument();
  });

  it("uses the dedicated contact-detail contract for contact continuity drill-in", async () => {
    const harness = createDirectoryHarness({ seedOrganizationOnlyTouchpoint: true });
    window.history.replaceState(null, "", "#directory/contacts");

    render(<Organizations token="token" currentUser={leadershipUser} entryView="contacts" />);

    expect(await screen.findByText("Keep people visible, not buried inside accounts")).toBeInTheDocument();
    await waitFor(() => {
      expect(harness.getContactDetailRequests()).toContain("contact-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Continuity" }));

    expect(await screen.findByText("No communication history has been logged yet.")).toBeInTheDocument();
    expect(screen.queryByText("Organization-only prep note")).not.toBeInTheDocument();
  });

  it("shows ownership risk, freshness, and relationship-map context for a contact", async () => {
    createDirectoryHarness();
    window.history.replaceState(null, "", "#directory/contacts");

    render(<Organizations token="token" currentUser={leadershipUser} entryView="contacts" />);

    expect(await screen.findByText("Contact details need review")).toBeInTheDocument();
    expect(screen.getByText("Handoff readiness is incomplete")).toBeInTheDocument();
    expect(screen.getAllByText("Demo Leadership").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Morgan Coordinator").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Relationships" }));

    expect(await screen.findByText("Relationship Map View")).toBeInTheDocument();
    expect(screen.getAllByText("Internal Owner").length).toBeGreaterThan(0);
    expect(screen.getByText("Backup Relationship")).toBeInTheDocument();
  });

  it("supports owner filters and shows structured ownership fields in the contact editor", async () => {
    createDirectoryHarness();
    window.history.replaceState(null, "", "#directory/contacts");

    render(<Organizations token="token" currentUser={leadershipUser} entryView="contacts" />);

    expect(await screen.findByText("Keep people visible, not buried inside accounts")).toBeInTheDocument();
    expect(screen.queryByLabelText("Primary owner")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show advanced filters/i }));

    fireEvent.change(screen.getByLabelText("Primary owner"), {
      target: { value: "user-leadership" }
    });

    await waitFor(() => {
      expect(
        apiFetchMock.mock.calls.some(
          ([path]) => typeof path === "string" && path.includes("primary_internal_owner_user_id=user-leadership")
        )
      ).toBe(true);
    });

    fireEvent.click(screen.getByLabelText("My contacts only"));

    await waitFor(() => {
      expect(
        apiFetchMock.mock.calls.some(([path]) => typeof path === "string" && path.includes("my_contacts_only=true"))
      ).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit contact" }));

    expect(await screen.findByLabelText("Primary internal owner")).toBeInTheDocument();
    expect(screen.getByLabelText("Backup owner")).toBeInTheDocument();
    expect(screen.getByLabelText("Last confirmed")).toBeInTheDocument();
    expect(screen.getByLabelText("Handoff ready")).toBeInTheDocument();
    expect(screen.getByLabelText("Mark as uncertain / needs review")).toBeInTheDocument();
  });

  it("shows organization pre-call context for communication-ready users", async () => {
    createDirectoryHarness();

    render(<Organizations token="token" currentUser={communicationReadyUser} />);

    expect(await screen.findByText("Organization Teams Meeting")).toBeInTheDocument();
    expect(await screen.findByText("Pre-Call Context")).toBeInTheDocument();
    expect(await screen.findByText("Key Contacts")).toBeInTheDocument();
    expect(screen.getAllByText("Jamie Carlson").length).toBeGreaterThan(0);
  });

  it("shows location-level Teams actions in the locations workspace for communication-ready users", async () => {
    createDirectoryHarness();
    window.history.replaceState(null, "", "#directory/locations");

    render(<Organizations token="token" currentUser={communicationReadyUser} entryView="locations" />);

    expect(await screen.findByText("Location Teams Messaging")).toBeInTheDocument();
    expect(screen.getByText("Location Teams Meeting")).toBeInTheDocument();
    expect(await screen.findByText("Pre-Call Context")).toBeInTheDocument();
    expect(screen.getByText("Site Notes")).toBeInTheDocument();
    expect(screen.getAllByText("Use the south loading door.").length).toBeGreaterThan(0);
    expect(await screen.findByRole("link", { name: "Open Related Channel" })).toHaveAttribute(
      "href",
      "https://teams.microsoft.com/l/channel/location-1/south-gym"
    );
    expect(await screen.findByRole("link", { name: "Join / Start Teams Meeting" })).toHaveAttribute(
      "href",
      "https://teams.microsoft.com/l/meetup-join/location-meeting-1"
    );
    expect(screen.getByText("Location Communication History")).toBeInTheDocument();
  });
});
