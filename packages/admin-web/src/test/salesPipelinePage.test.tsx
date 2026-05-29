import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SalesPipeline } from "../pages/SalesPipeline";
import type { SessionUser } from "../types";

const apiFetchMock = vi.fn();

vi.mock("../api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  apiUrl: "http://localhost:4000"
}));

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
  permissions: ["sales_pipeline.view", "sales_pipeline.create", "sales_pipeline.edit"],
  authorityTier: "leadership",
  primaryJobFunctionProfile: "leadership_team_member",
  jobFunctionProfiles: ["leadership_team_member"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust: standardSessionTrust
};

const photographerUser: SessionUser = {
  ...leadershipUser,
  id: "user-photo",
  email: "photo@example.com",
  fullName: "Demo Photographer",
  permissions: ["shoot.read"],
  authorityTier: "standard_employee",
  primaryJobFunctionProfile: "associate_photographer",
  jobFunctionProfiles: ["associate_photographer"]
};

const ownersResponse = {
  owners: [
    {
      id: "owner-1",
      full_name: "Brenda Example",
      email: "brenda@example.com",
      authority_tier: "leadership",
      primary_job_function_profile: "leadership_team_member",
      department: "sales"
    }
  ]
};

const organizationsResponse = {
  organizations: [
    {
      id: "organization-1",
    canonical_name: "Lakeside High School",
    logo_url: null,
    display_name: "Lakeside High School",
      account_type: "schools_underclass_portraits",
      active_status: "active",
      aliases: [],
      notes: "Primary school account",
      contact_count: 1,
      location_count: 1,
      created_at: "2026-03-28T12:00:00.000Z",
      updated_at: "2026-03-28T12:00:00.000Z"
    }
  ],
  search: { query: "", total: 1 }
};

const boardResponse = {
  generated_at: "2026-03-28T12:00:00.000Z",
  allowed_pipeline_types: ["schools", "sports"],
  summary: {
    active: 2,
    dormant: 1,
    won: 0,
    lost: 0,
    resurfacing_soon: 1,
    overdue_next_actions: 1
  },
  automation_summary: {
    missing_next_action: 1,
    inactive_opportunities: 1,
    meeting_scheduled: 0,
    contract_reminders_due: 2,
    renewals_due: 1,
    upcoming_shoot_risk: 1,
    pending_unsigned_accounts: 1,
    accounts_missing_active_agreement: 1
  },
  automation_alerts: [
    {
      id: "sales-alert-1",
      alert_type: "missing_next_action",
      status: "open",
      severity: "critical",
      dedupe_key: "sales-opportunity:opportunity-2:missing-next-action",
      pipeline_type: "schools",
      opportunity_id: "opportunity-2",
      organization_id: "organization-1",
      agreement_id: null,
      linked_shoot_id: null,
      title: "Missing Next Action: Lakeside High School",
      message: "Lakeside High School is active without a scheduled next action.",
      due_at: null,
      first_triggered_at: "2026-03-28T12:00:00.000Z",
      last_triggered_at: "2026-03-28T12:00:00.000Z",
      first_notified_at: "2026-03-28T12:00:00.000Z",
      last_notified_at: "2026-03-28T12:00:00.000Z",
      resolved_at: null,
      metadata: {},
      created_at: "2026-03-28T12:00:00.000Z",
      updated_at: "2026-03-28T12:00:00.000Z"
    }
  ],
  pipelines: [
    {
      pipeline_type: "schools",
      label: "Schools Pipeline",
      summary: {
        active: 2,
        dormant: 1,
        won: 0,
        lost: 0,
        resurfacing_soon: 1,
        overdue_next_actions: 1
      },
      resurfacing_soon: [
        {
          id: "opportunity-1",
          organization_id: "organization-1",
          organization_display_name: "Lakeside High School",
          primary_contact_id: "contact-1",
          primary_contact_name: "Barb Byzee",
          primary_contact_email: "barb@example.com",
          primary_contact_phone: "555-0100",
          owner_id: "owner-1",
          owner_name: "Brenda Example",
          owner_email: "brenda@example.com",
          opportunity_type: "renewal",
          pipeline_type: "schools",
          stage: "dormant",
          estimated_value: 22000,
          next_action_date: "2026-04-04",
          last_touch_date: "2026-03-28",
          last_verified_contact_date: null,
          notes: "Re-engage before contract season.",
          status: "dormant",
          follow_up_date: "2026-04-02",
          resurface_ready: true,
          next_action_missing: false,
          next_action_overdue: false,
          open_alert_count: 0,
          attention_state: "warning",
          created_at: "2026-03-28T12:00:00.000Z",
          updated_at: "2026-03-28T12:00:00.000Z"
        }
      ],
      stage_columns: [
        {
          stage: "lead",
          label: "Lead",
          opportunities: []
        },
        {
          stage: "contacted",
          label: "Contacted",
          opportunities: []
        },
        {
          stage: "meeting_scheduled",
          label: "Meeting Scheduled",
          opportunities: []
        },
        {
          stage: "proposal_sent",
          label: "Proposal Sent",
          opportunities: []
        },
        {
          stage: "follow_up",
          label: "Follow-Up",
          opportunities: []
        },
        {
          stage: "negotiation",
          label: "Negotiation",
          opportunities: []
        },
        {
          stage: "contract_sent",
          label: "Contract Sent",
          opportunities: [
            {
              id: "opportunity-2",
              organization_id: "organization-1",
              organization_display_name: "Lakeside High School",
              primary_contact_id: "contact-1",
              primary_contact_name: "Barb Byzee",
              primary_contact_email: "barb@example.com",
              primary_contact_phone: "555-0100",
              owner_id: "owner-1",
              owner_name: "Brenda Example",
              owner_email: "brenda@example.com",
              opportunity_type: "new",
              pipeline_type: "schools",
              stage: "contract_sent",
              estimated_value: 30000,
              next_action_date: null,
              last_touch_date: "2026-03-25",
              last_verified_contact_date: "2026-03-20",
              notes: "Waiting on signature packet.",
              status: "active",
              follow_up_date: null,
              resurface_ready: false,
              next_action_missing: true,
              next_action_overdue: false,
              open_alert_count: 1,
              attention_state: "critical",
              created_at: "2026-03-28T12:00:00.000Z",
              updated_at: "2026-03-28T12:00:00.000Z"
            }
          ]
        },
        { stage: "won", label: "Won", opportunities: [] },
        { stage: "lost", label: "Lost", opportunities: [] },
        { stage: "dormant", label: "Dormant", opportunities: [] }
      ]
    }
  ]
};

const listResponse = {
  allowed_pipeline_types: ["schools", "sports"],
  summary: {
    total: 2,
    active: 1,
    dormant: 1,
    won: 0,
    lost: 0,
    resurfacing_soon: 1,
    overdue_next_actions: 1
  },
  automation_summary: boardResponse.automation_summary,
  automation_alerts: boardResponse.automation_alerts,
  opportunities: [
    boardResponse.pipelines[0].resurfacing_soon[0],
    boardResponse.pipelines[0].stage_columns[6].opportunities[0]
  ]
};

const detailResponse = {
  opportunity: listResponse.opportunities[0],
  stage_rules: {
    proposal_sent_blockers: [],
    contract_sent_blockers: [],
    won_blockers: ["Won requires a signed, countersigned, or active Agreement on the Organization."],
    has_signed_agreement_on_file: false,
    signed_agreement_count: 0
  },
  alerts: [],
  email_templates: [
    {
      id: "template-1",
      template_key: "proposal_email",
      template_name: "Proposal Email",
      subject_template: "Proposal for {{organization_name}}",
      body_template: "Hi {{contact_name}}, proposal attached.",
      merge_fields: ["organization_name", "contact_name"],
      active_status: true,
      automation_enabled: false,
      created_at: "2026-03-28T12:00:00.000Z",
      updated_at: "2026-03-28T12:00:00.000Z"
    }
  ],
  communications: [
    {
      id: "communication-1",
      template_id: "template-1",
      template_key: "proposal_email",
      template_name: "Proposal Email",
      opportunity_id: "opportunity-1",
      organization_id: "organization-1",
      contact_id: "contact-1",
      contact_name: "Barb Byzee",
      contact_email: "barb@example.com",
      sent_by_user_id: "owner-1",
      sent_by_name: "Brenda Example",
      trigger_type: "manual",
      status: "sent",
      subject: "Proposal for Lakeside High School",
      body: "Hi Barb, proposal attached.",
      queued_at: "2026-03-28T12:00:00.000Z",
      sent_at: "2026-03-28T12:01:00.000Z",
      last_delivery_attempt_at: "2026-03-28T12:01:00.000Z",
      delivery_provider: "smtp_stub",
      delivery_reference: null,
      provider_error_state: null,
      metadata: {},
      created_at: "2026-03-28T12:00:00.000Z",
      updated_at: "2026-03-28T12:01:00.000Z",
      events: [
        {
          id: "communication-event-1",
          communication_id: "communication-1",
          event_type: "sent",
          actor_user_id: null,
          actor_name: null,
          note: "Email delivery completed.",
          metadata: {},
          timestamp: "2026-03-28T12:01:00.000Z",
          created_at: "2026-03-28T12:01:00.000Z"
        }
      ]
    }
  ]
};

const contractSentDetailResponse = {
  opportunity: listResponse.opportunities[1],
  stage_rules: {
    proposal_sent_blockers: [],
    contract_sent_blockers: [],
    won_blockers: ["Won requires a signed, countersigned, or active Agreement on the Organization."],
    has_signed_agreement_on_file: false,
    signed_agreement_count: 0
  },
  alerts: boardResponse.automation_alerts,
  email_templates: detailResponse.email_templates,
  communications: detailResponse.communications
};

const organizationDetailResponse = {
  organization: organizationsResponse.organizations[0],
  contacts: [
    {
      id: "contact-1",
      organization_id: "organization-1",
      first_name: "Barb",
      last_name: "Byzee",
      full_name: "Barb Byzee",
      title: "Activities Director",
      phone: "555-0100",
      email: "barb@example.com",
      photo_url: null,
      active_status: "active",
      notes: null,
      created_at: "2026-03-28T12:00:00.000Z",
      updated_at: "2026-03-28T12:00:00.000Z"
    }
  ],
  locations: [],
  recent_shoots: [],
  agreements_access: {
    can_view: true,
    can_manage: true
  },
  agreement_summary: {
    total: 0,
    active: 0,
    pending_signature: 1,
    expiring_soon: 0,
    expired: 0,
    replaced_archived: 0,
    renewals_needed: 0,
    accounts_missing_active: 1,
    upcoming_shoot_risk_count: 1,
    has_active_agreement: false,
    has_pending_signature: true,
    has_expiring_soon: false,
    has_expired: false,
    needs_attention: true,
    warning_severity: "warning",
    warnings: []
  },
  agreements: [],
  agreement_templates: [],
  upcoming_shoot_agreement_risks: [],
  sales_pipeline_summary: {
    linked_opportunities: 2,
    active_opportunities: 1,
    dormant_opportunities: 1,
    open_alerts: 1,
    missing_next_action: 1,
    inactive_opportunities: 0,
    meeting_scheduled: 0
  },
  sales_pipeline_alerts: boardResponse.automation_alerts,
  sales_email_templates: detailResponse.email_templates,
  sales_communications: detailResponse.communications,
  resource_library: {
    access: {
      can_manage: true,
      can_download: true,
      limited_view: false,
      historical_window_years: null
    },
    summary: {
      total_items: 0,
      media_count: 0,
      document_count: 0,
      best_reference_count: 0,
      pending_review_count: 0,
      leadership_only_count: 0,
      rejected_count: 0,
      prep_highlight_count: 0
    },
    review_queue: [],
    prep_highlights: [],
    media: [],
    documents: [],
    historical_references: [],
    post_shoot_learnings: [],
    recurring_location_intelligence: null
  },
  placeholders: {
    agreement_summary: "Contracts & Agreements is organized here with active coverage and clean version history.",
    sales_pipeline_summary: "CRM automation and opportunity health live here for linked accounts.",
    recent_shoots_summary: "Recent Shoot history will populate here as linked Shoot records accumulate on this Organization.",
    resource_library_summary: "Resource Library will live on this Organization record in a later phase."
  }
};

describe("Sales pipeline page", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it("renders board, list, and detail views for leadership users", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/sales/owners") {
        return ownersResponse;
      }
      if (path === "/api/organizations?active_status=active") {
        return organizationsResponse;
      }
      if (path === "/api/sales/board") {
        return boardResponse;
      }
      if (path === "/api/sales/opportunities") {
        return listResponse;
      }
      if (path === "/api/sales/opportunities/opportunity-1") {
        return detailResponse;
      }
      if (path === "/api/sales/opportunities/opportunity-2") {
        return contractSentDetailResponse;
      }
      if (path === "/api/organizations/organization-1") {
        return organizationDetailResponse;
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    render(<SalesPipeline token="token" currentUser={leadershipUser} />);

    expect(await screen.findByText("Schools and Sports opportunity management")).toBeInTheDocument();
    expect(screen.getByText("Dormant Follow-Up Coming Due")).toBeInTheDocument();
    expect((await screen.findAllByText("Lakeside High School")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Stage Rule Checks")).toBeInTheDocument();
    expect(screen.getByText("Communication Timeline")).toBeInTheDocument();
    expect(screen.getByText("Proposal for Lakeside High School")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "List" }));

    expect(await screen.findByPlaceholderText("Organization, Contact, owner, or notes")).toBeInTheDocument();
    expect(screen.getByText("CRM Automation")).toBeInTheDocument();
    expect(screen.getByText("Missing Next Action")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create Opportunity" }));

    const createDialog = await screen.findByRole("dialog", { name: "Create Opportunity" });
    expect(within(createDialog).getByText("New Sales Opportunity")).toBeInTheDocument();
    expect(within(createDialog).getByText("Stage Gate Reminders")).toBeInTheDocument();
    expect(within(createDialog).getByDisplayValue("Auto (Brenda if available)")).toBeInTheDocument();
  });

  it("keeps the pipeline restricted for photographers", async () => {
    render(<SalesPipeline token="token" currentUser={photographerUser} />);

    expect(screen.getByText("Sales Pipeline access is restricted")).toBeInTheDocument();
    await waitFor(() => {
      expect(apiFetchMock).not.toHaveBeenCalled();
    });
  });
});
