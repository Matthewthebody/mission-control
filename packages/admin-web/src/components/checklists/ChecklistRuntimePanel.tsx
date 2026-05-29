import { useEffect, useMemo, useState } from "react";
import { hasAuthorityTier, hasPermission } from "../../permissions";
import type {
  ChecklistAttachmentRecord,
  ChecklistCommentInput,
  ChecklistCommentVisibility,
  ChecklistInstanceDetail,
  ChecklistItemType,
  ChecklistRuntimeItemView,
  ChecklistRuntimeSectionView,
  ChecklistScopeType,
  ChecklistTemplateSummary
} from "../../checklistTypes";
import {
  addChecklistAttachment,
  addChecklistComment,
  approveChecklistInstance,
  createChecklistInstance,
  getChecklistInstance,
  listChecklistInstances,
  listChecklistTemplates,
  rejectChecklistInstance,
  saveChecklistResponses,
  submitChecklistInstance,
  uploadChecklistAsset,
  waiveChecklistInstance
} from "../../services/checklistApi";
import { StatusPill, formatDate, formatDateTime, humanizeToken, statusTone } from "../sports/SportsPrimitives";
import { WorkspaceActionBar } from "../workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../workspace/WorkspaceLoadingBlock";
import { WorkspaceSectionHeader } from "../workspace/WorkspaceSectionHeader";
import type { DirectoryOwnerOption, SessionUser } from "../../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  scopeType: ChecklistScopeType;
  scopeId: string;
  departmentType?: "schools" | "sports" | "corporate" | "headshots" | "other" | null;
  allowEdit?: boolean;
  staffOptions?: DirectoryOwnerOption[];
  preferredInstanceId?: string | null;
  onInstancesChange?: (instances: ChecklistInstanceDetail[]) => void;
};

type ChecklistCreateDraft = {
  templateId: string;
  title: string;
  dueAt: string;
  ownerUserId: string;
  reviewerUserId: string;
  approverUserId: string;
};

function emptyCreateDraft(): ChecklistCreateDraft {
  return {
    templateId: "",
    title: "",
    dueAt: "",
    ownerUserId: "",
    reviewerUserId: "",
    approverUserId: ""
  };
}

function sortInstances(instances: ChecklistInstanceDetail[]) {
  return [...instances].sort((left, right) => {
    const leftDue = left.due_at ? new Date(left.due_at).getTime() : Number.MAX_SAFE_INTEGER;
    const rightDue = right.due_at ? new Date(right.due_at).getTime() : Number.MAX_SAFE_INTEGER;
    if (left.status === "overdue" && right.status !== "overdue") {
      return -1;
    }
    if (right.status === "overdue" && left.status !== "overdue") {
      return 1;
    }
    if (left.blocking_level === "hard_block" && right.blocking_level !== "hard_block") {
      return -1;
    }
    if (right.blocking_level === "hard_block" && left.blocking_level !== "hard_block") {
      return 1;
    }
    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }
    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  });
}

function getVisibleSections(instance: ChecklistInstanceDetail): ChecklistRuntimeSectionView[] {
  const runtimeSections = instance.sections as ChecklistRuntimeSectionView[];
  return runtimeSections
    .map((section) => {
      const runtimeItems = section.items as ChecklistRuntimeItemView[];
      return {
        ...section,
        items: runtimeItems.filter((item) => item.visible)
      };
    })
    .filter((section) => section.items.length > 0);
}

function defaultResponseValue(item: ChecklistRuntimeItemView) {
  if (item.item_type === "checkbox" || item.item_type === "yes_no") {
    return null;
  }
  if (item.item_type === "multi_select" || item.item_type === "photo_upload" || item.item_type === "file_upload") {
    return [];
  }
  return "";
}

function buildResponseDraft(instance: ChecklistInstanceDetail) {
  const next: Record<string, unknown> = {};
  for (const section of instance.sections) {
    for (const item of section.items) {
      next[item.id] = item.response?.response_json ?? defaultResponseValue(item);
    }
  }
  return next;
}

function toInputString(value: unknown) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

function toBooleanSelect(value: unknown) {
  if (value === true) {
    return "yes";
  }
  if (value === false) {
    return "no";
  }
  return "";
}

function parseOptions(item: ChecklistRuntimeItemView) {
  return (item.options_json ?? []).map((option) => {
    if (typeof option === "string" || typeof option === "number" || typeof option === "boolean") {
      const normalized = String(option);
      return { label: normalized, value: normalized };
    }
    if (option && typeof option === "object") {
      const candidate = option as Record<string, unknown>;
      const value = candidate.value != null ? String(candidate.value) : candidate.label != null ? String(candidate.label) : JSON.stringify(candidate);
      const label = candidate.label != null ? String(candidate.label) : value;
      return { label, value };
    }
    return { label: String(option), value: String(option) };
  });
}

function isMeaningfulResponse(itemType: ChecklistItemType, value: unknown) {
  if (value == null) {
    return false;
  }
  switch (itemType) {
    case "checkbox":
    case "yes_no":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "multi_select":
      return Array.isArray(value) && value.length > 0;
    case "photo_upload":
    case "file_upload":
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    default:
      return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
  }
}

function normalizeResponseValue(item: ChecklistRuntimeItemView, value: unknown) {
  switch (item.item_type) {
    case "checkbox":
    case "yes_no":
      return typeof value === "boolean" ? value : null;
    case "number": {
      if (typeof value === "number") {
        return value;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }
    case "multi_select":
      return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
    case "photo_upload":
    case "file_upload":
      return Array.isArray(value) ? value : [];
    default:
      return typeof value === "string" ? value : value == null ? "" : String(value);
  }
}

function isAssignedChecklistReviewer(user: SessionUser, instance: ChecklistInstanceDetail | null) {
  if (!instance) {
    return false;
  }
  return instance.reviewer_user_id === user.id || instance.approver_user_id === user.id;
}

function canReviewRuntime(user: SessionUser, instance: ChecklistInstanceDetail | null) {
  return Boolean(instance) && (hasPermission(user, "checklist.approve") || hasAuthorityTier(user, ["leadership", "super_admin"]) || isAssignedChecklistReviewer(user, instance));
}

function canCommentRuntime(user: SessionUser, instance: ChecklistInstanceDetail | null, scopeType: ChecklistScopeType, allowEdit: boolean) {
  return (
    canManageRuntime(user, scopeType, allowEdit) ||
    canReviewRuntime(user, instance) ||
    canWaiveRuntime(user) ||
    hasAuthorityTier(user, ["supervisor", "director_admin", "leadership", "super_admin"])
  );
}

function buildCommentVisibilityOptions(user: SessionUser, instance: ChecklistInstanceDetail | null): ChecklistCommentVisibility[] {
  if (hasAuthorityTier(user, ["leadership", "super_admin"])) {
    return ["standard_internal", "manager_only", "leadership_only"];
  }
  if (
    canReviewRuntime(user, instance) ||
    canWaiveRuntime(user) ||
    hasAuthorityTier(user, ["supervisor", "director_admin", "leadership", "super_admin"])
  ) {
    return ["standard_internal", "manager_only"];
  }
  return ["standard_internal"];
}

function matchesTemplateScope(template: ChecklistTemplateSummary, scopeType: ChecklistScopeType, departmentType: Props["departmentType"]) {
  if (template.scope_type !== scopeType) {
    return false;
  }
  if (!departmentType) {
    return true;
  }
  return template.department_type == null || template.department_type === departmentType;
}

function isImageAttachment(attachment: ChecklistAttachmentRecord) {
  return attachment.content_type.startsWith("image/");
}

function canReadTemplateLibrary(user: SessionUser) {
  return hasPermission(user, "checklist.template.read") || hasPermission(user, "checklist.template.manage") || hasPermission(user, "settings.update");
}

function canWaiveRuntime(user: SessionUser) {
  return hasPermission(user, "checklist.waive") || hasAuthorityTier(user, ["leadership", "super_admin"]);
}

function canManageRuntime(user: SessionUser, scopeType: ChecklistScopeType, allowEdit: boolean) {
  if (!allowEdit) {
    return false;
  }
  if (scopeType === "production_item") {
    return hasPermission(user, "production.update") || hasPermission(user, "production.create");
  }
  if (scopeType === "shoot") {
    return hasPermission(user, "shoot.update") || hasPermission(user, "job.mark_ready") || hasPermission(user, "job.manage_readiness");
  }
  if (scopeType === "job") {
    return hasPermission(user, "job.update");
  }
  return hasPermission(user, "location.update") || hasPermission(user, "settings.update");
}

function formatInstanceTone(instance: ChecklistInstanceDetail) {
  if (instance.status === "overdue" || instance.blocking_level === "hard_block") {
    return "danger";
  }
  if (instance.blocking_level === "soft_block") {
    return "warning";
  }
  return statusTone(instance.status);
}

function buildTimeline(instance: ChecklistInstanceDetail, resolveActorLabel: (userId: string | null | undefined) => string) {
  const runtimeSections = instance.sections as ChecklistRuntimeSectionView[];
  const itemLabelById = new Map(runtimeSections.flatMap((section) => section.items).map((item) => [item.id, item.label]));
  const approvalEntries = instance.approvals.map((approval) => ({
    id: `approval-${approval.id}`,
    created_at: approval.created_at,
    title: humanizeToken(approval.decision),
    body: approval.note ?? "Checklist approval activity recorded.",
    actor: resolveActorLabel(approval.actor_user_id)
  }));
  const commentEntries = instance.comments.map((comment) => ({
    id: `comment-${comment.id}`,
    created_at: comment.created_at,
    title: comment.checklist_item_id ? `Item comment: ${itemLabelById.get(comment.checklist_item_id) ?? "Checklist item"}` : "Comment",
    body: comment.body,
    actor: resolveActorLabel(comment.author_user_id)
  }));
  const attachmentEntries = runtimeSections.flatMap((section: ChecklistRuntimeSectionView) =>
    (section.items as ChecklistRuntimeItemView[]).flatMap((item: ChecklistRuntimeItemView) =>
      item.attachments.map((attachment: ChecklistAttachmentRecord) => ({
        id: `attachment-${attachment.id}`,
        created_at: attachment.created_at,
        title: item.item_type === "photo_upload" ? "Photo proof uploaded" : "File proof uploaded",
        body: `${attachment.file_name} attached to ${item.label}.`,
        actor: resolveActorLabel(attachment.uploaded_by_user_id)
      }))
    )
  );

  return [...approvalEntries, ...commentEntries, ...attachmentEntries].sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  );
}

function DraftStaffPicker({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: DirectoryOwnerOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Use default</option>
        {options.map((option) => (
          <option key={option.user_id} value={option.user_id}>
            {option.full_name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ChecklistRuntimePanel({
  token,
  currentUser,
  scopeType,
  scopeId,
  departmentType = null,
  allowEdit = true,
  staffOptions = [],
  preferredInstanceId = null,
  onInstancesChange
}: Props) {
  const [instances, setInstances] = useState<ChecklistInstanceDetail[]>([]);
  const [templates, setTemplates] = useState<ChecklistTemplateSummary[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [responseDraft, setResponseDraft] = useState<Record<string, unknown>>({});
  const [createDraft, setCreateDraft] = useState<ChecklistCreateDraft>(emptyCreateDraft);
  const [generalComment, setGeneralComment] = useState("");
  const [generalVisibility, setGeneralVisibility] = useState<ChecklistCommentVisibility>("standard_internal");
  const [itemCommentDrafts, setItemCommentDrafts] = useState<Record<string, string>>({});
  const [approvalNote, setApprovalNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyKey, setBusyKey] = useState("");

  const canManage = canManageRuntime(currentUser, scopeType, allowEdit);
  const canWaive = canWaiveRuntime(currentUser);
  const canBrowseTemplates = canReadTemplateLibrary(currentUser);

  async function loadRuntime() {
    setLoading(true);
    try {
      const [instancePayload, templatePayload] = await Promise.all([
        listChecklistInstances(token, { scope_type: scopeType, scope_id: scopeId }),
        canBrowseTemplates ? listChecklistTemplates(token, { department_type: "all", scope_type: scopeType }) : Promise.resolve({ templates: [] })
      ]);
      const nextInstances = sortInstances(instancePayload.instances);
      const nextTemplates = templatePayload.templates.filter((template) => matchesTemplateScope(template, scopeType, departmentType));
      setInstances(nextInstances);
      setTemplates(nextTemplates);
      setSelectedInstanceId((current) => {
        if (preferredInstanceId && nextInstances.some((instance) => instance.id === preferredInstanceId)) {
          return preferredInstanceId;
        }
        if (current && nextInstances.some((instance) => instance.id === current)) {
          return current;
        }
        return nextInstances[0]?.id ?? null;
      });
      setCreateDraft((current) => ({
        ...current,
        templateId: current.templateId || nextTemplates[0]?.id || ""
      }));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load workflow checklist details right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRuntime();
  }, [token, scopeType, scopeId, departmentType, canBrowseTemplates, preferredInstanceId]);

  useEffect(() => {
    onInstancesChange?.(instances);
  }, [instances, onInstancesChange]);

  useEffect(() => {
    if (!preferredInstanceId || !instances.some((instance) => instance.id === preferredInstanceId)) {
      return;
    }
    setSelectedInstanceId(preferredInstanceId);
  }, [instances, preferredInstanceId]);

  const selectedInstance = useMemo(
    () => instances.find((instance) => instance.id === selectedInstanceId) ?? instances[0] ?? null,
    [instances, selectedInstanceId]
  );
  const canReviewSelectedInstance = useMemo(() => canReviewRuntime(currentUser, selectedInstance), [currentUser, selectedInstance]);
  const canCommentSelectedInstance = useMemo(
    () => canCommentRuntime(currentUser, selectedInstance, scopeType, allowEdit),
    [allowEdit, currentUser, scopeType, selectedInstance]
  );
  const visibilityOptions = useMemo(() => buildCommentVisibilityOptions(currentUser, selectedInstance), [currentUser, selectedInstance]);
  const staffNameById = useMemo(() => new Map(staffOptions.map((option) => [option.user_id, option.full_name])), [staffOptions]);

  useEffect(() => {
    if (!visibilityOptions.includes(generalVisibility)) {
      setGeneralVisibility(visibilityOptions[0] ?? "standard_internal");
    }
  }, [generalVisibility, visibilityOptions]);

  useEffect(() => {
    if (!selectedInstance) {
      setResponseDraft({});
      setGeneralComment("");
      setApprovalNote("");
      setItemCommentDrafts({});
      return;
    }
    setResponseDraft(buildResponseDraft(selectedInstance));
    setGeneralComment("");
    setApprovalNote("");
    setItemCommentDrafts({});
  }, [selectedInstance?.id]);

  function replaceInstance(nextInstance: ChecklistInstanceDetail, noticeMessage?: string) {
    setInstances((current) => sortInstances([...current.filter((instance) => instance.id !== nextInstance.id), nextInstance]));
    setSelectedInstanceId(nextInstance.id);
    if (noticeMessage !== undefined) {
      setNotice(noticeMessage);
    }
    setError("");
  }

  function applyInstance(nextInstance: ChecklistInstanceDetail, noticeMessage = `${nextInstance.title} updated.`) {
    replaceInstance(nextInstance, noticeMessage);
  }

  function resolveAssigneeName(userId: string | null, fallbackLabel: string, fallbackName?: string | null) {
    if (!userId) {
      return fallbackLabel;
    }
    return staffNameById.get(userId) ?? (userId === currentUser.id ? currentUser.fullName : fallbackName?.trim() || userId);
  }

  function resolveActorLabel(userId: string | null | undefined) {
    if (!userId) {
      return "System";
    }
    if (selectedInstance?.owner_user_id === userId) {
      return resolveAssigneeName(userId, "Owner", selectedInstance.target.owner_name);
    }
    if (selectedInstance?.reviewer_user_id === userId) {
      return resolveAssigneeName(userId, "Reviewer", selectedInstance.target.reviewer_name);
    }
    if (selectedInstance?.approver_user_id === userId) {
      return resolveAssigneeName(userId, "Approver", selectedInstance.target.approver_name);
    }
    return staffNameById.get(userId) ?? (userId === currentUser.id ? currentUser.fullName : userId);
  }

  async function reloadInstance(instanceId: string, fallbackErrorMessage: string) {
    try {
      const result = await getChecklistInstance(token, instanceId);
      replaceInstance(result.instance);
    } catch {
      setError(fallbackErrorMessage);
    }
  }

  async function persistResponses(instance: ChecklistInstanceDetail) {
    const payload = getVisibleSections(instance)
      .flatMap((section) => section.items)
      .map((item) => ({
        item,
        value: normalizeResponseValue(item, responseDraft[item.id])
      }))
      .filter(({ item, value }) => isMeaningfulResponse(item.item_type, value))
      .map(({ item, value }) => ({
        checklist_item_id: item.id,
        response_json: value
      }));

    if (!payload.length) {
      return instance;
    }

    const result = await saveChecklistResponses(token, instance.id, payload);
    applyInstance(result.instance);
    return result.instance;
  }

  async function handleCreateInstance() {
    if (!canManage || !createDraft.templateId) {
      return;
    }
    setBusyKey("create");
    setNotice("");
    try {
      const result = await createChecklistInstance(token, {
        template_id: createDraft.templateId,
        scope_type: scopeType,
        scope_id: scopeId,
        title: createDraft.title.trim() || null,
        due_at: createDraft.dueAt ? new Date(createDraft.dueAt).toISOString() : null,
        owner_user_id: createDraft.ownerUserId || null,
        reviewer_user_id: createDraft.reviewerUserId || null,
        approver_user_id: createDraft.approverUserId || null
      });
      applyInstance(result.instance);
      setCreateDraft((current) => ({ ...emptyCreateDraft(), templateId: current.templateId }));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "We couldn't start that checklist instance.");
    } finally {
      setBusyKey("");
    }
  }

  async function handleSaveDraft() {
    if (!selectedInstance || !canManage) {
      return;
    }
    setBusyKey("save");
    setNotice("");
    try {
      await persistResponses(selectedInstance);
      setNotice("Checklist draft responses saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "We couldn't save checklist progress right now.");
    } finally {
      setBusyKey("");
    }
  }

  async function handleSubmit() {
    if (!selectedInstance || !canManage) {
      return;
    }
    setBusyKey("submit");
    setNotice("");
    try {
      const latest = await persistResponses(selectedInstance);
      const result = await submitChecklistInstance(token, latest.id);
      applyInstance(result.instance);
      setNotice("Checklist submitted for review.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "We couldn't submit that checklist yet.");
    } finally {
      setBusyKey("");
    }
  }

  async function handleDecision(action: "approve" | "reject" | "waive") {
    if (!selectedInstance) {
      return;
    }
    const trimmedNote = approvalNote.trim();
    if (action !== "approve" && !trimmedNote) {
      setError("Add a note before rejecting or waiving this checklist.");
      return;
    }
    setBusyKey(action);
    setNotice("");
    try {
      const result =
        action === "approve"
          ? await approveChecklistInstance(token, selectedInstance.id, trimmedNote)
          : action === "reject"
            ? await rejectChecklistInstance(token, selectedInstance.id, trimmedNote)
            : await waiveChecklistInstance(token, selectedInstance.id, trimmedNote);
      applyInstance(result.instance);
      setApprovalNote("");
      setNotice(`Checklist ${action === "approve" ? "approved" : action === "reject" ? "rejected" : "waived"}.`);
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "We couldn't record that checklist decision.");
    } finally {
      setBusyKey("");
    }
  }

  async function handleAddComment(input: ChecklistCommentInput) {
    if (!selectedInstance || !canCommentSelectedInstance || !input.body.trim()) {
      return;
    }
    setBusyKey(`comment-${input.checklist_item_id ?? "instance"}`);
    setNotice("");
    try {
      const result = await addChecklistComment(token, selectedInstance.id, input);
      applyInstance(result.instance);
      if (input.checklist_item_id) {
        setItemCommentDrafts((current) => ({ ...current, [input.checklist_item_id!]: "" }));
      } else {
        setGeneralComment("");
      }
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : "We couldn't add that checklist comment.");
    } finally {
      setBusyKey("");
    }
  }

  async function handleUpload(item: ChecklistRuntimeItemView, file: File) {
    if (!selectedInstance || !canManage) {
      return;
    }
    setBusyKey(`upload-${item.id}`);
    setNotice("");
    let responseSaved = false;
    try {
      const asset = await uploadChecklistAsset(token, file, selectedInstance.id);
      const currentResponse = normalizeResponseValue(item, responseDraft[item.id]);
      const nextResponse =
        item.item_type === "photo_upload" || item.item_type === "file_upload"
          ? [...(Array.isArray(currentResponse) ? currentResponse : []), asset.object_url]
          : currentResponse;
      const responseResult = await saveChecklistResponses(token, selectedInstance.id, [
        {
          checklist_item_id: item.id,
          response_json: nextResponse
        }
      ]);
      responseSaved = true;
      const responseRecord = responseResult.instance.sections
        .flatMap((section) => section.items)
        .find((candidate) => candidate.id === item.id)?.response;
      const attachmentResult = await addChecklistAttachment(token, selectedInstance.id, {
        checklist_response_id: responseRecord?.id ?? null,
        attachment_type: item.item_type === "photo_upload" ? "photo_proof" : "file_proof",
        ...asset
      });
      applyInstance(attachmentResult.instance);
    } catch (uploadError) {
      if (responseSaved) {
        await reloadInstance(selectedInstance.id, "Proof upload did not finish cleanly, and we couldn't refresh the checklist state.");
      }
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : responseSaved
            ? "The response saved, but we couldn't finish attaching proof."
            : "We couldn't upload that checklist proof right now."
      );
    } finally {
      setBusyKey("");
    }
  }

  if (loading && !instances.length) {
    return <WorkspaceLoadingBlock title="Loading workflow checklist" summary="Pulling checklist instances, proof, and approval state for this record." />;
  }

  const timeline = selectedInstance ? buildTimeline(selectedInstance, resolveActorLabel) : [];
  const visibleSections = selectedInstance ? getVisibleSections(selectedInstance) : [];

  return (
    <div className="checklist-runtime">
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="live-banner">{notice}</div> : null}

      {canManage && canBrowseTemplates ? (
        <section className="checklist-runtime__create panel">
          <WorkspaceSectionHeader
            title="Create from template"
            summary="Start the right checklist directly on this shoot or production item without leaving the record."
            compact
          />
          <div className="field-grid checklist-runtime__create-grid">
            <label className="filter-field">
              <span>Template</span>
              <select value={createDraft.templateId} onChange={(event) => setCreateDraft((current) => ({ ...current, templateId: event.target.value }))}>
                <option value="">Choose template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Title override</span>
              <input value={createDraft.title} onChange={(event) => setCreateDraft((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label className="filter-field">
              <span>Due at</span>
              <input
                type="datetime-local"
                value={createDraft.dueAt}
                onChange={(event) => setCreateDraft((current) => ({ ...current, dueAt: event.target.value }))}
              />
            </label>
            {staffOptions.length ? (
              <>
                <DraftStaffPicker
                  label="Owner"
                  value={createDraft.ownerUserId}
                  options={staffOptions}
                  onChange={(value) => setCreateDraft((current) => ({ ...current, ownerUserId: value }))}
                />
                <DraftStaffPicker
                  label="Reviewer"
                  value={createDraft.reviewerUserId}
                  options={staffOptions}
                  onChange={(value) => setCreateDraft((current) => ({ ...current, reviewerUserId: value }))}
                />
                <DraftStaffPicker
                  label="Approver"
                  value={createDraft.approverUserId}
                  options={staffOptions}
                  onChange={(value) => setCreateDraft((current) => ({ ...current, approverUserId: value }))}
                />
              </>
            ) : null}
          </div>
          <WorkspaceActionBar align="end" compact>
            <button type="button" className="secondary-button" onClick={handleCreateInstance} disabled={busyKey === "create" || !createDraft.templateId}>
              {busyKey === "create" ? "Creating..." : "Create Checklist"}
            </button>
          </WorkspaceActionBar>
        </section>
      ) : null}

      {instances.length ? (
        <div className="checklist-runtime__layout">
          <div className="checklist-runtime__instance-list">
            {instances.map((instance) => (
              <button
                key={instance.id}
                type="button"
                className={`checklist-runtime__instance-card${instance.id === selectedInstance?.id ? " is-active" : ""}`}
                onClick={() => setSelectedInstanceId(instance.id)}
              >
                <div className="checklist-runtime__instance-card-header">
                  <div>
                    <strong>{instance.title}</strong>
                    <span>{instance.template.name}</span>
                  </div>
                  <StatusPill label={humanizeToken(instance.status)} tone={formatInstanceTone(instance)} />
                </div>
                <div className="checklist-runtime__instance-meta">
                  <span>{instance.due_at ? `Due ${formatDate(instance.due_at)}` : "No due date"}</span>
                  <span>{instance.progress.progress_percent}% complete</span>
                  <span>{instance.blocking_level === "none" ? "Non-blocking" : humanizeToken(instance.blocking_level)}</span>
                </div>
              </button>
            ))}
          </div>

          {selectedInstance ? (
            <div className="checklist-runtime__detail">
              <section className="checklist-runtime__summary panel">
                <div className="checklist-runtime__summary-header">
                  <div>
                    <h4>{selectedInstance.title}</h4>
                    <p>{selectedInstance.template.name}</p>
                  </div>
                  <div className="shared-job-preview__status-row">
                    <StatusPill label={humanizeToken(selectedInstance.status)} tone={formatInstanceTone(selectedInstance)} />
                    <StatusPill label={`${selectedInstance.progress.progress_percent}% complete`} tone="info" />
                    {selectedInstance.blocking_level !== "none" ? (
                      <StatusPill label={humanizeToken(selectedInstance.blocking_level)} tone={selectedInstance.blocking_level === "hard_block" ? "danger" : "warning"} />
                    ) : null}
                  </div>
                </div>
                <div className="checklist-runtime__summary-grid">
                  <div>
                    <span>Due</span>
                    <strong>{selectedInstance.due_at ? formatDateTime(selectedInstance.due_at) : "No due date"}</strong>
                  </div>
                  <div>
                    <span>Owner</span>
                    <strong>{selectedInstance.target.owner_name ?? "Unassigned"}</strong>
                  </div>
                  <div>
                    <span>Reviewer</span>
                <strong>{resolveAssigneeName(selectedInstance.reviewer_user_id, "Default routing", selectedInstance.target.reviewer_name)}</strong>
              </div>
              <div>
                <span>Approver</span>
                <strong>{resolveAssigneeName(selectedInstance.approver_user_id, "Default routing", selectedInstance.target.approver_name)}</strong>
              </div>
                </div>
                {(selectedInstance.progress.missing_item_ids.length || selectedInstance.progress.missing_proof_item_ids.length || selectedInstance.progress.missing_approval) ? (
                  <div className="checklist-runtime__warning" role="alert">
                    <strong>Still blocking this workflow</strong>
                    <span>
                      {selectedInstance.progress.missing_item_ids.length
                        ? `${selectedInstance.progress.missing_item_ids.length} required field${selectedInstance.progress.missing_item_ids.length === 1 ? "" : "s"} missing.`
                        : selectedInstance.progress.missing_proof_item_ids.length
                          ? `${selectedInstance.progress.missing_proof_item_ids.length} proof item${selectedInstance.progress.missing_proof_item_ids.length === 1 ? "" : "s"} missing.`
                          : "Approval is still required before this checklist clears."}
                    </span>
                  </div>
                ) : null}
              </section>

              <section className="checklist-runtime__responses panel">
                <WorkspaceSectionHeader
                  title="Checklist responses"
                  summary="Draft responses save directly on the workflow record so progress, proof, and approvals stay auditable."
                  compact
                />
                <div className="checklist-runtime__progress-bar" aria-hidden="true">
                  <span style={{ width: `${selectedInstance.progress.progress_percent}%` }} />
                </div>
                <div className="checklist-runtime__section-stack">
                  {visibleSections.map((section) => (
                    <section key={section.id} className="checklist-runtime__section">
                      <header>
                        <strong>{section.title}</strong>
                        {section.description ? <span>{section.description}</span> : null}
                      </header>
                      <div className="checklist-runtime__items">
                        {(section.items as ChecklistRuntimeItemView[]).map((item) => (
                          <ChecklistRuntimeItem
                            key={item.id}
                            item={item}
                            value={responseDraft[item.id]}
                            busyKey={busyKey}
                            canManage={canManage}
                            canComment={canCommentSelectedInstance}
                            visibility={generalVisibility}
                            itemComment={itemCommentDrafts[item.id] ?? ""}
                            onValueChange={(nextValue) =>
                              setResponseDraft((current) => ({
                                ...current,
                                [item.id]: nextValue
                              }))
                            }
                            onCommentChange={(nextComment) =>
                              setItemCommentDrafts((current) => ({
                                ...current,
                                [item.id]: nextComment
                              }))
                            }
                            onUpload={handleUpload}
                            onComment={(body) =>
                              void handleAddComment({
                                checklist_item_id: item.id,
                                body,
                                visibility: generalVisibility
                              })
                            }
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
                {canManage ? (
                  <WorkspaceActionBar align="end" compact>
                    <button type="button" className="secondary-button" onClick={handleSaveDraft} disabled={busyKey === "save"}>
                      {busyKey === "save" ? "Saving..." : "Save Draft"}
                    </button>
                    <button type="button" className="primary-button" onClick={handleSubmit} disabled={busyKey === "submit"}>
                      {busyKey === "submit" ? "Submitting..." : "Submit Checklist"}
                    </button>
                  </WorkspaceActionBar>
                ) : null}
              </section>

              <section className="checklist-runtime__activity panel">
                <WorkspaceSectionHeader title="Approval and comments" summary="Submission is separate from manager sign-off. Every decision and comment stays on the record." compact />
                <div className="checklist-runtime__approval-actions">
                  <label className="filter-field filter-field--wide">
                    <span>Decision note</span>
                    <textarea rows={3} value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} />
                  </label>
                  <div className="checklist-runtime__helper-text">Required for reject or waive. Optional for approve.</div>
                  {(canReviewSelectedInstance || canWaive) &&
                  ((canReviewSelectedInstance && ["submitted", "overdue"].includes(selectedInstance.status)) ||
                    (canWaive && !["approved", "waived"].includes(selectedInstance.status))) ? (
                    <WorkspaceActionBar align="end" compact>
                      {canReviewSelectedInstance && ["submitted", "overdue"].includes(selectedInstance.status) ? (
                        <>
                          <button type="button" className="secondary-button" disabled={busyKey === "reject"} onClick={() => void handleDecision("reject")}>
                            {busyKey === "reject" ? "Rejecting..." : "Reject"}
                          </button>
                          <button type="button" className="primary-button" disabled={busyKey === "approve"} onClick={() => void handleDecision("approve")}>
                            {busyKey === "approve" ? "Approving..." : "Approve"}
                          </button>
                        </>
                      ) : null}
                      {canWaive ? (
                        <button type="button" className="secondary-button" disabled={busyKey === "waive"} onClick={() => void handleDecision("waive")}>
                          {busyKey === "waive" ? "Waiving..." : "Waive"}
                        </button>
                      ) : null}
                    </WorkspaceActionBar>
                  ) : null}
                </div>
                <div className="checklist-runtime__general-comment">
                  <label className="filter-field filter-field--wide">
                    <span>Checklist comment</span>
                    <textarea rows={3} value={generalComment} onChange={(event) => setGeneralComment(event.target.value)} />
                  </label>
                  {visibilityOptions.length > 1 ? (
                    <label className="filter-field">
                      <span>Visibility</span>
                      <select value={generalVisibility} onChange={(event) => setGeneralVisibility(event.target.value as ChecklistCommentVisibility)}>
                        {visibilityOptions.map((visibility) => (
                          <option key={visibility} value={visibility}>
                            {humanizeToken(visibility)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {canCommentSelectedInstance ? (
                    <WorkspaceActionBar align="end" compact>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={!generalComment.trim() || busyKey === "comment-instance"}
                        onClick={() =>
                          void handleAddComment({
                            body: generalComment,
                            visibility: generalVisibility
                          })
                        }
                      >
                        Add Comment
                      </button>
                    </WorkspaceActionBar>
                  ) : null}
                </div>
                {timeline.length ? (
                  <div className="checklist-runtime__timeline">
                    {timeline.map((entry) => (
                      <article key={entry.id} className="checklist-runtime__timeline-entry">
                        <div>
                          <strong>{entry.title}</strong>
                          <p>{entry.body}</p>
                        </div>
                        <div>
                          <span>{entry.actor}</span>
                          <span>{formatDateTime(entry.created_at)}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <WorkspaceEmptyState title="No checklist activity yet" summary="Comments, submissions, approvals, and waivers will build the timeline here." compact />
                )}
              </section>
            </div>
          ) : null}
        </div>
      ) : (
        <WorkspaceEmptyState
          title="No checklist instances yet"
          summary={
            canManage && canBrowseTemplates
              ? "Create a checklist from a reusable template to capture proof, approval, and workflow blocks on this record."
              : "No checklist has been started on this record yet."
          }
        />
      )}
    </div>
  );
}

function ChecklistRuntimeItem({
  item,
  value,
  busyKey,
  canManage,
  canComment,
  visibility,
  itemComment,
  onValueChange,
  onCommentChange,
  onUpload,
  onComment
}: {
  item: ChecklistRuntimeItemView;
  value: unknown;
  busyKey: string;
  canManage: boolean;
  canComment: boolean;
  visibility: ChecklistCommentVisibility;
  itemComment: string;
  onValueChange: (value: unknown) => void;
  onCommentChange: (value: string) => void;
  onUpload: (item: ChecklistRuntimeItemView, file: File) => Promise<void>;
  onComment: (body: string) => void;
}) {
  const options = parseOptions(item);
  return (
    <article
      className={`checklist-runtime__item${item.missing_required || item.missing_proof ? " is-attention" : ""}${item.disabled ? " is-disabled" : ""}`}
    >
      <div className="checklist-runtime__item-header">
        <div>
          <strong>{item.label}</strong>
          {item.help_text ? <p>{item.help_text}</p> : null}
        </div>
        <div className="shared-job-preview__status-row">
          <StatusPill label={humanizeToken(item.item_type)} tone="info" />
          {item.effective_required ? <StatusPill label="Required" tone="warning" /> : null}
          {item.proof_required ? <StatusPill label="Proof" tone="danger" /> : null}
        </div>
      </div>

      {renderChecklistInput(item, value, options, canManage, onValueChange)}

      {canManage && (item.item_type === "photo_upload" || item.item_type === "file_upload") ? (
        <label className="filter-field checklist-runtime__upload-field">
          <span>{item.item_type === "photo_upload" ? "Upload photo proof" : "Upload file proof"}</span>
          <input
            type="file"
            accept={item.item_type === "photo_upload" ? "image/*" : undefined}
            disabled={busyKey === `upload-${item.id}`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void onUpload(item, file);
              }
              event.currentTarget.value = "";
            }}
          />
        </label>
      ) : null}

      {item.attachments.length ? (
        <div className="checklist-runtime__attachments">
          {item.attachments.map((attachment) => (
            <a key={attachment.id} href={attachment.object_url} target="_blank" rel="noreferrer" className="checklist-runtime__attachment">
              {isImageAttachment(attachment) ? <img src={attachment.object_url} alt={attachment.file_name} /> : null}
              <span>{attachment.file_name}</span>
            </a>
          ))}
        </div>
      ) : null}

      {item.comments.length ? (
        <div className="checklist-runtime__item-comments">
          {item.comments.map((comment) => (
            <div key={comment.id} className="checklist-runtime__comment">
              <strong>{humanizeToken(comment.visibility)}</strong>
              <p>{comment.body}</p>
              <span>{formatDateTime(comment.created_at)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {canComment ? (
        <div className="checklist-runtime__item-comment-form">
          <label className="filter-field filter-field--wide">
            <span>Item comment</span>
            <textarea rows={2} value={itemComment} onChange={(event) => onCommentChange(event.target.value)} />
          </label>
          <WorkspaceActionBar align="end" compact>
            <button
              type="button"
              className="secondary-button"
              disabled={!itemComment.trim() || busyKey === `comment-${item.id}`}
              onClick={() => onComment(itemComment)}
            >
              Add Item Comment
            </button>
            {visibility !== "standard_internal" ? <StatusPill label={humanizeToken(visibility)} tone="warning" /> : null}
          </WorkspaceActionBar>
        </div>
      ) : null}
    </article>
  );
}

function renderChecklistInput(
  item: ChecklistRuntimeItemView,
  value: unknown,
  options: Array<{ label: string; value: string }>,
  canManage: boolean,
  onChange: (value: unknown) => void
) {
  if (!canManage || item.disabled) {
    return (
      <div className="checklist-runtime__readonly">
        <span>{formatReadonlyChecklistValue(item, value)}</span>
      </div>
    );
  }

  switch (item.item_type) {
    case "checkbox":
      return (
        <label className="filter-field filter-field--checkbox">
          <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
          <span>Marked complete</span>
        </label>
      );
    case "textarea":
    case "signature":
      return (
        <label className="filter-field filter-field--wide">
          <span>Response</span>
          <textarea rows={3} value={toInputString(value)} onChange={(event) => onChange(event.target.value)} />
        </label>
      );
    case "number":
      return (
        <label className="filter-field">
          <span>Response</span>
          <input type="number" value={toInputString(value)} onChange={(event) => onChange(event.target.value)} />
        </label>
      );
    case "date":
      return (
        <label className="filter-field">
          <span>Response</span>
          <input type="date" value={toInputString(value)} onChange={(event) => onChange(event.target.value)} />
        </label>
      );
    case "time":
      return (
        <label className="filter-field">
          <span>Response</span>
          <input type="time" value={toInputString(value)} onChange={(event) => onChange(event.target.value)} />
        </label>
      );
    case "select":
      return (
        <label className="filter-field">
          <span>Response</span>
          <select value={toInputString(value)} onChange={(event) => onChange(event.target.value)}>
            <option value="">Select option</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      );
    case "multi_select":
      return (
        <label className="filter-field filter-field--wide">
          <span>Response</span>
          <select
            multiple
            value={Array.isArray(value) ? value.map((entry) => String(entry)) : []}
            onChange={(event) => onChange(Array.from(event.target.selectedOptions).map((option) => option.value))}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      );
    case "yes_no":
      return (
        <label className="filter-field">
          <span>Response</span>
          <select value={toBooleanSelect(value)} onChange={(event) => onChange(event.target.value === "" ? null : event.target.value === "yes")}>
            <option value="">Select answer</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      );
    case "user_picker":
      return (
        <label className="filter-field">
          <span>Response</span>
          <input value={toInputString(value)} onChange={(event) => onChange(event.target.value)} placeholder="Enter user or owner" />
        </label>
      );
    case "photo_upload":
    case "file_upload":
      return (
        <div className="checklist-runtime__readonly">
          <span>{Array.isArray(value) && value.length ? `${value.length} proof file(s) attached` : "No proof uploaded yet"}</span>
        </div>
      );
    default:
      return (
        <label className="filter-field">
          <span>Response</span>
          <input value={toInputString(value)} onChange={(event) => onChange(event.target.value)} />
        </label>
      );
  }
}

function formatReadonlyChecklistValue(item: ChecklistRuntimeItemView, value: unknown) {
  if (value == null || value === "") {
    return item.attachments.length ? `${item.attachments.length} proof file(s) attached` : "No response yet";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}
