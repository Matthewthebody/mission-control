// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChecklistRuntimePanel } from "../components/checklists/ChecklistRuntimePanel";
import type { ChecklistInstanceDetail } from "../checklistTypes";
import type { SessionUser } from "../types";

const listChecklistInstancesMock = vi.fn();
const listChecklistTemplatesMock = vi.fn();
const createChecklistInstanceMock = vi.fn();
const saveChecklistResponsesMock = vi.fn();
const submitChecklistInstanceMock = vi.fn();
const approveChecklistInstanceMock = vi.fn();
const rejectChecklistInstanceMock = vi.fn();
const waiveChecklistInstanceMock = vi.fn();
const addChecklistCommentMock = vi.fn();
const uploadChecklistAssetMock = vi.fn();
const addChecklistAttachmentMock = vi.fn();
const getChecklistInstanceMock = vi.fn();

vi.mock("../services/checklistApi", () => ({
  listChecklistInstances: (...args: unknown[]) => listChecklistInstancesMock(...args),
  listChecklistTemplates: (...args: unknown[]) => listChecklistTemplatesMock(...args),
  createChecklistInstance: (...args: unknown[]) => createChecklistInstanceMock(...args),
  saveChecklistResponses: (...args: unknown[]) => saveChecklistResponsesMock(...args),
  submitChecklistInstance: (...args: unknown[]) => submitChecklistInstanceMock(...args),
  approveChecklistInstance: (...args: unknown[]) => approveChecklistInstanceMock(...args),
  rejectChecklistInstance: (...args: unknown[]) => rejectChecklistInstanceMock(...args),
  waiveChecklistInstance: (...args: unknown[]) => waiveChecklistInstanceMock(...args),
  addChecklistComment: (...args: unknown[]) => addChecklistCommentMock(...args),
  uploadChecklistAsset: (...args: unknown[]) => uploadChecklistAssetMock(...args),
  addChecklistAttachment: (...args: unknown[]) => addChecklistAttachmentMock(...args),
  getChecklistInstance: (...args: unknown[]) => getChecklistInstanceMock(...args)
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

const reviewerUser: SessionUser = {
  id: "reviewer-1",
  tenantId: "tenant-demo",
  accountId: "account-demo",
  sessionId: "session-reviewer",
  email: "reviewer@example.com",
  fullName: "Peer Reviewer",
  status: "active",
  department: "sports",
  isEmailVerified: true,
  authVersion: 1,
  roles: [],
  permissions: [],
  authorityTier: "standard_employee",
  primaryJobFunctionProfile: "associate_photographer",
  jobFunctionProfiles: ["associate_photographer"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust
};

const managerUser: SessionUser = {
  ...reviewerUser,
  id: "manager-1",
  sessionId: "session-manager",
  email: "manager@example.com",
  fullName: "Production Manager",
  roles: ["manager"],
  permissions: ["production.update"],
  authorityTier: "supervisor",
  primaryJobFunctionProfile: "production_manager",
  jobFunctionProfiles: ["production_manager"]
};

function createChecklistInstance(overrides: Partial<ChecklistInstanceDetail> = {}): ChecklistInstanceDetail {
  return {
    id: overrides.id ?? "instance-1",
    tenant_id: "tenant-demo",
    template_id: "template-1",
    template_version_id: "version-1",
    scope_type: "production_item",
    job_id: "job-1",
    shoot_id: null,
    production_item_id: "production-1",
    location_id: null,
    department_type: "sports",
    title: "Peer Review Sign-Off",
    trigger_type: "manual",
    status: overrides.status ?? "submitted",
    approval_required: true,
    blocking_level: "hard_block",
    owner_user_id: "owner-1",
    reviewer_user_id: "reviewer-1",
    approver_user_id: "approver-1",
    due_at: "2026-04-10T15:00:00.000Z",
    submitted_at: "2026-04-09T16:00:00.000Z",
    approved_at: null,
    rejected_at: null,
    waived_at: null,
    rejection_note: null,
    waiver_note: null,
    progress_percent: 75,
    created_from_trigger_key: null,
    source_metadata_json: {},
    last_reminded_at: null,
    escalated_at: null,
    created_by_user_id: "owner-1",
    updated_by_user_id: "owner-1",
    created_at: "2026-04-08T12:00:00.000Z",
    updated_at: "2026-04-09T16:00:00.000Z",
    template: {
      id: "template-1",
      tenant_id: "tenant-demo",
      code: "peer_review_sign_off",
      name: "Peer Review Sign-Off",
      description: "Peer review",
      department_type: "sports",
      scope_type: "production_item",
      active_version_id: "version-1",
      created_by_user_id: "owner-1",
      updated_by_user_id: "owner-1",
      archived_at: null,
      created_at: "2026-04-08T12:00:00.000Z",
      updated_at: "2026-04-08T12:00:00.000Z"
    },
    template_version: {
      id: "version-1",
      tenant_id: "tenant-demo",
      template_id: "template-1",
      version_number: 1,
      status: "published",
      trigger_type: "manual",
      due_rule_json: {},
      approval_required: true,
      blocking_level: "hard_block",
      summary: "Peer review summary",
      created_by_user_id: "owner-1",
      published_by_user_id: "owner-1",
      published_at: "2026-04-08T12:00:00.000Z",
      created_at: "2026-04-08T12:00:00.000Z",
      updated_at: "2026-04-08T12:00:00.000Z"
    },
    progress: {
      total_items: 1,
      visible_items: 1,
      required_items: 1,
      completed_items: 1,
      completed_required_items: 1,
      proof_required_items: 0,
      proof_satisfied_items: 0,
      approval_required: true,
      approval_complete: false,
      progress_percent: 75,
      missing_item_ids: [],
      missing_proof_item_ids: [],
      missing_approval: true
    },
    sections: [
      {
        id: "section-1",
        tenant_id: "tenant-demo",
        template_version_id: "version-1",
        section_key: "review",
        title: "Review",
        description: "Review items",
        sort_order: 0,
        created_at: "2026-04-08T12:00:00.000Z",
        updated_at: "2026-04-08T12:00:00.000Z",
        items: [
          {
            id: "item-1",
            tenant_id: "tenant-demo",
            template_version_id: "version-1",
            section_id: "section-1",
            item_key: "visual_sample",
            label: "Visual sample review",
            help_text: "Check the sample quality.",
            item_type: "textarea",
            required: true,
            proof_required: false,
            validation_json: {},
            options_json: [],
            sort_order: 0,
            created_at: "2026-04-08T12:00:00.000Z",
            updated_at: "2026-04-08T12:00:00.000Z",
            conditions: [],
            response: {
              id: "response-1",
              tenant_id: "tenant-demo",
              checklist_instance_id: overrides.id ?? "instance-1",
              checklist_item_id: "item-1",
              checklist_section_id: "section-1",
              response_json: "Looks good",
              is_complete: true,
              answered_by_user_id: "owner-1",
              answered_at: "2026-04-09T15:00:00.000Z",
              created_at: "2026-04-09T15:00:00.000Z",
              updated_at: "2026-04-09T15:00:00.000Z"
            },
            attachments: [],
            comments: [],
            visible: true,
            effective_required: true,
            disabled: false,
            missing_required: false,
            missing_proof: false
          }
        ]
      }
    ],
    approvals: [
      {
        id: "approval-submitted",
        tenant_id: "tenant-demo",
        checklist_instance_id: overrides.id ?? "instance-1",
        decision: "submitted",
        actor_user_id: "owner-1",
        note: null,
        metadata_json: {},
        created_at: "2026-04-09T16:00:00.000Z"
      }
    ],
    comments: [],
    target: {
      job_id: "job-1",
      job_number: "SPT-100",
      shoot_id: null,
      production_item_id: "production-1",
      location_id: null,
      organization_name: "Metro Football Club",
      title: "Varsity Proof Packet",
      owner_name: "Alex Owner",
      reviewer_name: "Riley Reviewer",
      approver_name: "Release Lead"
    },
    ...overrides
  };
}

beforeEach(() => {
  listChecklistInstancesMock.mockReset();
  listChecklistTemplatesMock.mockReset();
  createChecklistInstanceMock.mockReset();
  saveChecklistResponsesMock.mockReset();
  submitChecklistInstanceMock.mockReset();
  approveChecklistInstanceMock.mockReset();
  rejectChecklistInstanceMock.mockReset();
  waiveChecklistInstanceMock.mockReset();
  addChecklistCommentMock.mockReset();
  uploadChecklistAssetMock.mockReset();
  addChecklistAttachmentMock.mockReset();
  getChecklistInstanceMock.mockReset();

  listChecklistTemplatesMock.mockResolvedValue({ templates: [] });
});

describe("ChecklistRuntimePanel", () => {
  it("lets assigned reviewers approve without a note and use manager-only comments", async () => {
    const instance = createChecklistInstance();
    listChecklistInstancesMock.mockResolvedValue({ instances: [instance] });
    approveChecklistInstanceMock.mockResolvedValue({ instance: { ...instance, status: "approved" } });

    render(
      <ChecklistRuntimePanel
        token="token-reviewer"
        currentUser={reviewerUser}
        scopeType="production_item"
        scopeId="production-1"
        departmentType="sports"
        allowEdit={false}
      />
    );

    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Comment" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Draft" })).not.toBeInTheDocument();

    const visibilitySelect = screen.getByRole("combobox", { name: "Visibility" });
    expect(within(visibilitySelect).getByRole("option", { name: "Manager Only" })).toBeInTheDocument();
    expect(within(visibilitySelect).queryByRole("option", { name: "Leadership Only" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(approveChecklistInstanceMock).toHaveBeenCalledWith("token-reviewer", "instance-1", ""));
  });

  it("prefers checklist target routing names over raw reviewer and approver ids in the summary", async () => {
    const instance = createChecklistInstance({
      reviewer_user_id: "reviewer-unlisted",
      approver_user_id: "approver-unlisted",
      target: {
        ...createChecklistInstance().target,
        reviewer_name: "Jordan Reviewer",
        approver_name: "Taylor Release"
      }
    });
    listChecklistInstancesMock.mockResolvedValue({ instances: [instance] });

    render(
      <ChecklistRuntimePanel
        token="token-manager"
        currentUser={managerUser}
        scopeType="production_item"
        scopeId="production-1"
        departmentType="sports"
        allowEdit
      />
    );

    expect(await screen.findByText("Jordan Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Taylor Release")).toBeInTheDocument();
    expect(screen.queryByText("reviewer-unlisted")).not.toBeInTheDocument();
    expect(screen.queryByText("approver-unlisted")).not.toBeInTheDocument();
  });

  it("reloads the instance after proof attachment failure so runtime state stays in sync", async () => {
    const uploadInstance = createChecklistInstance({
      id: "instance-upload",
      status: "in_progress",
      approval_required: false,
      progress: {
        total_items: 1,
        visible_items: 1,
        required_items: 0,
        completed_items: 0,
        completed_required_items: 0,
        proof_required_items: 1,
        proof_satisfied_items: 0,
        approval_required: false,
        approval_complete: false,
        progress_percent: 0,
        missing_item_ids: [],
        missing_proof_item_ids: ["item-upload"],
        missing_approval: false
      },
      sections: [
        {
          id: "section-upload",
          tenant_id: "tenant-demo",
          template_version_id: "version-1",
          section_key: "proof",
          title: "Proof",
          description: "Upload proof",
          sort_order: 0,
          created_at: "2026-04-08T12:00:00.000Z",
          updated_at: "2026-04-08T12:00:00.000Z",
          items: [
            {
              id: "item-upload",
              tenant_id: "tenant-demo",
              template_version_id: "version-1",
              section_id: "section-upload",
              item_key: "upload_proof",
              label: "Upload proof",
              help_text: null,
              item_type: "file_upload",
              required: false,
              proof_required: true,
              validation_json: {},
              options_json: [],
              sort_order: 0,
              created_at: "2026-04-08T12:00:00.000Z",
              updated_at: "2026-04-08T12:00:00.000Z",
              conditions: [],
              response: null,
              attachments: [],
              comments: [],
              visible: true,
              effective_required: false,
              disabled: false,
              missing_required: false,
              missing_proof: true
            }
          ]
        }
      ]
    });
    const syncedInstance = {
      ...uploadInstance,
      sections: [
        {
          ...uploadInstance.sections[0],
          items: [
            {
              ...uploadInstance.sections[0].items[0],
              response: {
                id: "response-upload",
                tenant_id: "tenant-demo",
                checklist_instance_id: "instance-upload",
                checklist_item_id: "item-upload",
                checklist_section_id: "section-upload",
                response_json: ["https://cdn.example.com/proof.txt"],
                is_complete: true,
                answered_by_user_id: "manager-1",
                answered_at: "2026-04-09T16:30:00.000Z",
                created_at: "2026-04-09T16:30:00.000Z",
                updated_at: "2026-04-09T16:30:00.000Z"
              }
            }
          ]
        }
      ]
    };

    listChecklistInstancesMock.mockResolvedValue({ instances: [uploadInstance] });
    uploadChecklistAssetMock.mockResolvedValue({
      file_name: "proof.txt",
      content_type: "text/plain",
      storage_key: "tenant-demo/checklists/proof.txt",
      object_url: "https://cdn.example.com/proof.txt"
    });
    saveChecklistResponsesMock.mockResolvedValue({ instance: syncedInstance });
    addChecklistAttachmentMock.mockRejectedValue(new Error("Proof attachment failed."));
    getChecklistInstanceMock.mockResolvedValue({ instance: syncedInstance });

    render(
      <ChecklistRuntimePanel
        token="token-manager"
        currentUser={managerUser}
        scopeType="production_item"
        scopeId="production-1"
        departmentType="sports"
        allowEdit
      />
    );

    const uploadInput = await screen.findByLabelText("Upload file proof");
    fireEvent.change(uploadInput, {
      target: {
        files: [new File(["proof"], "proof.txt", { type: "text/plain" })]
      }
    });

    await waitFor(() => expect(getChecklistInstanceMock).toHaveBeenCalledWith("token-manager", "instance-upload"));
    expect(await screen.findByText("Proof attachment failed.")).toBeInTheDocument();
  });
});
