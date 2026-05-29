import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChecklistTemplatesPage } from "../pages/ChecklistTemplatesPage";
import type { ChecklistTemplateDetail, ChecklistTemplateSummary } from "../checklistTypes";
import type { SessionUser } from "../types";

const listChecklistTemplatesMock = vi.fn();
const getChecklistTemplateDetailMock = vi.fn();
const createChecklistTemplateDraftMock = vi.fn();
const updateChecklistTemplateDraftMock = vi.fn();
const publishChecklistTemplateVersionMock = vi.fn();
const seedChecklistDefaultsMock = vi.fn();

vi.mock("../services/checklistApi", () => ({
  listChecklistTemplates: (...args: unknown[]) => listChecklistTemplatesMock(...args),
  getChecklistTemplateDetail: (...args: unknown[]) => getChecklistTemplateDetailMock(...args),
  createChecklistTemplateDraft: (...args: unknown[]) => createChecklistTemplateDraftMock(...args),
  updateChecklistTemplateDraft: (...args: unknown[]) => updateChecklistTemplateDraftMock(...args),
  publishChecklistTemplateVersion: (...args: unknown[]) => publishChecklistTemplateVersionMock(...args),
  seedChecklistDefaults: (...args: unknown[]) => seedChecklistDefaultsMock(...args)
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

const adminUser: SessionUser = {
  id: "user-admin",
  tenantId: "tenant-demo",
  accountId: "account-admin",
  sessionId: "session-demo",
  email: "admin@example.com",
  fullName: "Checklist Admin",
  status: "active",
  department: "operations",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["admin"],
  permissions: ["checklist.template.read", "checklist.template.manage", "settings.update"],
  authorityTier: "super_admin",
  primaryJobFunctionProfile: "operations_admin",
  jobFunctionProfiles: ["operations_admin"],
  permissionGrants: [
    {
      domain: "workflow_checklists",
      action: "manage",
      scope: "organization_wide_scope"
    }
  ],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust: standardSessionTrust
};

function createTemplateSummary(overrides: Partial<ChecklistTemplateSummary> = {}): ChecklistTemplateSummary {
  return {
    id: overrides.id ?? "template-1",
    tenant_id: overrides.tenant_id ?? "tenant-demo",
    code: overrides.code ?? "shoot_readiness",
    name: overrides.name ?? "Shoot Readiness",
    description: overrides.description ?? "Standard readiness checklist for shoots.",
    department_type: overrides.department_type ?? "schools",
    scope_type: overrides.scope_type ?? "shoot",
    active_version_id: overrides.active_version_id ?? "version-1",
    created_by_user_id: overrides.created_by_user_id ?? "user-admin",
    updated_by_user_id: overrides.updated_by_user_id ?? "user-admin",
    archived_at: overrides.archived_at ?? null,
    created_at: overrides.created_at ?? "2026-04-01T10:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-04-01T12:00:00.000Z",
    active_version_number: overrides.active_version_number ?? 1,
    active_version_status: overrides.active_version_status ?? "published",
    active_trigger_type: overrides.active_trigger_type ?? "shoot_status_transition",
    active_approval_required: overrides.active_approval_required ?? true,
    active_blocking_level: overrides.active_blocking_level ?? "hard_block",
    usage_count: overrides.usage_count ?? 6,
    last_used_at: overrides.last_used_at ?? "2026-04-01T12:15:00.000Z"
  };
}

function createTemplateDetail(overrides: Partial<ChecklistTemplateDetail> = {}): ChecklistTemplateDetail {
  const summary = createTemplateSummary(overrides);
  return {
    ...summary,
    versions:
      overrides.versions ?? [
        {
          id: "version-2",
          tenant_id: "tenant-demo",
          template_id: summary.id,
          version_number: 2,
          status: "draft",
          trigger_type: "shoot_status_transition",
          due_rule_json: { offset_hours: 24 },
          approval_required: true,
          blocking_level: "hard_block",
          summary: "Draft rollout for spring season readiness.",
          created_by_user_id: "user-admin",
          published_by_user_id: null,
          published_at: null,
          created_at: "2026-04-01T11:00:00.000Z",
          updated_at: "2026-04-01T11:30:00.000Z",
          sections: [
            {
              id: "section-1",
              tenant_id: "tenant-demo",
              template_version_id: "version-2",
              section_key: "pre_arrival",
              title: "Pre-Arrival",
              description: "Confirm readiness before the crew departs.",
              sort_order: 0,
              created_at: "2026-04-01T11:00:00.000Z",
              updated_at: "2026-04-01T11:30:00.000Z",
              items: [
                {
                  id: "item-1",
                  tenant_id: "tenant-demo",
                  template_version_id: "version-2",
                  section_id: "section-1",
                  item_key: "roster_verified",
                  label: "Roster verified",
                  help_text: "Confirm the roster has been reviewed and matched.",
                  item_type: "checkbox",
                  required: true,
                  proof_required: false,
                  validation_json: {},
                  options_json: [],
                  sort_order: 0,
                  created_at: "2026-04-01T11:00:00.000Z",
                  updated_at: "2026-04-01T11:30:00.000Z",
                  conditions: []
                }
              ]
            }
          ]
        },
        {
          id: "version-1",
          tenant_id: "tenant-demo",
          template_id: summary.id,
          version_number: 1,
          status: "published",
          trigger_type: "shoot_status_transition",
          due_rule_json: { offset_hours: 24 },
          approval_required: true,
          blocking_level: "hard_block",
          summary: "Current published readiness checklist.",
          created_by_user_id: "user-admin",
          published_by_user_id: "user-admin",
          published_at: "2026-03-25T09:00:00.000Z",
          created_at: "2026-03-25T08:30:00.000Z",
          updated_at: "2026-03-25T09:00:00.000Z",
          sections: [
            {
              id: "section-legacy",
              tenant_id: "tenant-demo",
              template_version_id: "version-1",
              section_key: "legacy",
              title: "Legacy",
              description: null,
              sort_order: 0,
              created_at: "2026-03-25T08:30:00.000Z",
              updated_at: "2026-03-25T09:00:00.000Z",
              items: []
            }
          ]
        }
      ]
  };
}

beforeEach(() => {
  listChecklistTemplatesMock.mockReset();
  getChecklistTemplateDetailMock.mockReset();
  createChecklistTemplateDraftMock.mockReset();
  updateChecklistTemplateDraftMock.mockReset();
  publishChecklistTemplateVersionMock.mockReset();
  seedChecklistDefaultsMock.mockReset();

  const summary = createTemplateSummary();
  const detail = createTemplateDetail();
  listChecklistTemplatesMock.mockResolvedValue({ templates: [summary] });
  getChecklistTemplateDetailMock.mockResolvedValue({ template: detail });
  createChecklistTemplateDraftMock.mockResolvedValue({
    template: createTemplateDetail({
      id: "template-new",
      code: "production_intake",
      name: "Production Intake",
      department_type: "sports",
      scope_type: "production_item",
      active_version_id: null,
      active_version_number: null,
      active_version_status: null,
      active_trigger_type: null,
      active_approval_required: false,
      active_blocking_level: "soft_block"
    })
  });
  updateChecklistTemplateDraftMock.mockResolvedValue({ template: detail });
  publishChecklistTemplateVersionMock.mockResolvedValue({
    template: createTemplateDetail({
      versions: createTemplateDetail().versions.map((version) =>
        version.id === "version-2"
          ? { ...version, status: "published", published_at: "2026-04-02T10:00:00.000Z", published_by_user_id: "user-admin" }
          : version
      )
    })
  });
  seedChecklistDefaultsMock.mockResolvedValue({
    seeded: {
      template_count: 10,
      workflow_rule_count: 8
    }
  });
});

describe("ChecklistTemplatesPage", () => {
  it("loads the checklist library, saves a draft, and publishes a version", async () => {
    render(<ChecklistTemplatesPage token="token" currentUser={adminUser} />);

    expect(await screen.findByText("Checklist template library")).toBeInTheDocument();
    expect(await screen.findByText("Shoot Readiness")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Shoot Readiness")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save Draft Version" }));

    await waitFor(() => expect(updateChecklistTemplateDraftMock).toHaveBeenCalledTimes(1));
    expect(updateChecklistTemplateDraftMock.mock.calls[0]?.[1]).toBe("template-1");

    fireEvent.click(screen.getByRole("button", { name: "Publish v2" }));

    await waitFor(() => expect(publishChecklistTemplateVersionMock).toHaveBeenCalledTimes(1));
    expect(publishChecklistTemplateVersionMock.mock.calls[0]?.[1]).toBe("template-1");
    expect(publishChecklistTemplateVersionMock.mock.calls[0]?.[2]).toBe("version-2");
  });

  it("creates a new draft template and can seed the default starter library", async () => {
    render(<ChecklistTemplatesPage token="token" currentUser={adminUser} />);

    expect(await screen.findByText("Shoot Readiness")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Seed Initial Templates" }));

    await waitFor(() => expect(seedChecklistDefaultsMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "New Template" }));

    fireEvent.change(screen.getByLabelText("Template Name"), { target: { value: "Production Intake" } });
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "production_intake" } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Checklist for receiving files into production." }
    });
    fireEvent.change(screen.getByLabelText("Summary"), {
      target: { value: "Used when file receipt starts a production item." }
    });
    fireEvent.change(screen.getByLabelText("Section Title"), { target: { value: "Receipt" } });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Files present" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Draft" }));

    await waitFor(() => expect(createChecklistTemplateDraftMock).toHaveBeenCalledTimes(1));
    expect(createChecklistTemplateDraftMock.mock.calls[0]?.[1]).toMatchObject({
      name: "Production Intake",
      code: "production_intake",
      sections: [
        expect.objectContaining({
          title: "Receipt",
          items: [expect.objectContaining({ label: "Files present" })]
        })
      ]
    });
  });
});
