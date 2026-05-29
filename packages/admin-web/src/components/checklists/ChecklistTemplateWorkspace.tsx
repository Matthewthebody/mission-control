import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { canAccessChecklistTemplates, hasPermission } from "../../permissions";
import type {
  ChecklistBlockingLevel,
  ChecklistConditionEffect,
  ChecklistConditionLogic,
  ChecklistDepartmentType,
  ChecklistItemType,
  ChecklistScopeType,
  ChecklistTemplateDetail,
  ChecklistTemplateQuery,
  ChecklistTemplateSummary,
  ChecklistTemplateVersionInput,
  ChecklistTriggerType
} from "../../checklistTypes";
import { createChecklistTemplateDraft, getChecklistTemplateDetail, listChecklistTemplates, publishChecklistTemplateVersion, seedChecklistDefaults, updateChecklistTemplateDraft } from "../../services/checklistApi";
import { StatusPill, formatDateTime, humanizeToken } from "../sports/SportsPrimitives";
import { WorkspaceActionBar } from "../workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../workspace/WorkspaceEmptyState";
import { WorkspaceFilterToolbar } from "../workspace/WorkspaceFilterToolbar";
import { WorkspaceLoadingBlock } from "../workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../workspace/WorkspacePageHeader";
import { WorkspaceSectionHeader } from "../workspace/WorkspaceSectionHeader";
import type { SessionUser } from "../../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type ChecklistConditionDraft = {
  localId: string;
  conditionGroupKey: string;
  logicOperator: ChecklistConditionLogic;
  sourceItemKey: string;
  comparisonOperator: string;
  expectedValueText: string;
  effect: ChecklistConditionEffect;
};

type ChecklistItemDraft = {
  localId: string;
  itemKey: string;
  label: string;
  helpText: string;
  itemType: ChecklistItemType;
  required: boolean;
  proofRequired: boolean;
  validationText: string;
  optionsText: string;
  conditions: ChecklistConditionDraft[];
};

type ChecklistSectionDraft = {
  localId: string;
  sectionKey: string;
  title: string;
  description: string;
  items: ChecklistItemDraft[];
};

type TemplateDraftState = {
  templateId: string | null;
  activeVersionId: string | null;
  editingVersionId: string | null;
  editingVersionNumber: number | null;
  name: string;
  code: string;
  description: string;
  departmentType: ChecklistDepartmentType;
  scopeType: ChecklistScopeType;
  triggerType: ChecklistTriggerType;
  dueRuleText: string;
  approvalRequired: boolean;
  blockingLevel: ChecklistBlockingLevel;
  summary: string;
  sections: ChecklistSectionDraft[];
};

const DEPARTMENT_OPTIONS: Array<{ value: ChecklistDepartmentType | "all"; label: string }> = [
  { value: "all", label: "All Departments" },
  { value: "schools", label: "Schools" },
  { value: "sports", label: "Sports" },
  { value: "corporate", label: "Corporate" },
  { value: "headshots", label: "Headshots" },
  { value: "other", label: "Other" },
  { value: null, label: "Shared / Cross-Department" }
];

const SCOPE_OPTIONS: Array<{ value: ChecklistScopeType; label: string }> = [
  { value: "shoot", label: "Shoot" },
  { value: "production_item", label: "Production Item" },
  { value: "job", label: "Job" },
  { value: "location", label: "Location" }
];

const FILTER_SCOPE_OPTIONS: Array<{ value: ChecklistScopeType | ""; label: string }> = [
  { value: "", label: "All Scopes" },
  ...SCOPE_OPTIONS
];

const TRIGGER_OPTIONS: Array<{ value: ChecklistTriggerType; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "shoot_status_transition", label: "Shoot Status Transition" },
  { value: "production_status_transition", label: "Production Status Transition" },
  { value: "job_publish", label: "Job Publish" },
  { value: "shoot_complete", label: "Shoot Complete" },
  { value: "upload_verified", label: "Upload Verified" },
  { value: "release_review", label: "Release Review" }
];

const BLOCKING_OPTIONS: Array<{ value: ChecklistBlockingLevel; label: string }> = [
  { value: "none", label: "Non-blocking" },
  { value: "soft_block", label: "Soft Block" },
  { value: "hard_block", label: "Hard Block" }
];

const ITEM_TYPE_OPTIONS: Array<{ value: ChecklistItemType; label: string }> = [
  { value: "checkbox", label: "Checkbox" },
  { value: "text", label: "Text" },
  { value: "textarea", label: "Textarea" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "time", label: "Time" },
  { value: "select", label: "Select" },
  { value: "multi_select", label: "Multi Select" },
  { value: "yes_no", label: "Yes / No" },
  { value: "user_picker", label: "User Picker" },
  { value: "photo_upload", label: "Photo Upload" },
  { value: "file_upload", label: "File Upload" },
  { value: "signature", label: "Signature" }
];

const CONDITION_EFFECT_OPTIONS: Array<{ value: ChecklistConditionEffect; label: string }> = [
  { value: "show", label: "Show" },
  { value: "hide", label: "Hide" },
  { value: "require", label: "Require" },
  { value: "disable", label: "Disable" }
];

const CONDITION_LOGIC_OPTIONS: Array<{ value: ChecklistConditionLogic; label: string }> = [
  { value: "AND", label: "AND" },
  { value: "OR", label: "OR" }
];

let draftSequence = 0;

function nextDraftId(prefix: string) {
  draftSequence += 1;
  return `${prefix}-${draftSequence}`;
}

function createEmptyCondition(): ChecklistConditionDraft {
  return {
    localId: nextDraftId("condition"),
    conditionGroupKey: "default",
    logicOperator: "AND",
    sourceItemKey: "",
    comparisonOperator: "equals",
    expectedValueText: "",
    effect: "show"
  };
}

function createEmptyItem(): ChecklistItemDraft {
  return {
    localId: nextDraftId("item"),
    itemKey: "",
    label: "",
    helpText: "",
    itemType: "checkbox",
    required: false,
    proofRequired: false,
    validationText: "{}",
    optionsText: "",
    conditions: []
  };
}

function createEmptySection(): ChecklistSectionDraft {
  return {
    localId: nextDraftId("section"),
    sectionKey: "",
    title: "",
    description: "",
    items: [createEmptyItem()]
  };
}

function createEmptyDraft(scopeType: ChecklistScopeType = "shoot"): TemplateDraftState {
  return {
    templateId: null,
    activeVersionId: null,
    editingVersionId: null,
    editingVersionNumber: null,
    name: "",
    code: "",
    description: "",
    departmentType: null,
    scopeType,
    triggerType: "manual",
    dueRuleText: "{}",
    approvalRequired: false,
    blockingLevel: "none",
    summary: "",
    sections: [createEmptySection()]
  };
}

function buildOptionsText(options: unknown[]) {
  if (!options.length) {
    return "";
  }
  const simpleValues = options.every((entry) => ["string", "number", "boolean"].includes(typeof entry));
  if (simpleValues) {
    return options.map((entry) => String(entry)).join("\n");
  }
  return JSON.stringify(options, null, 2);
}

function toDraftState(template: ChecklistTemplateDetail): TemplateDraftState {
  const editableVersion =
    template.versions.find((version) => version.status === "draft") ??
    template.versions.find((version) => version.id === template.active_version_id) ??
    template.versions[0];

  return {
    templateId: template.id,
    activeVersionId: template.active_version_id,
    editingVersionId: editableVersion?.id ?? null,
    editingVersionNumber: editableVersion?.version_number ?? null,
    name: template.name,
    code: template.code,
    description: template.description ?? "",
    departmentType: template.department_type ?? null,
    scopeType: template.scope_type,
    triggerType: editableVersion?.trigger_type ?? "manual",
    dueRuleText: JSON.stringify(editableVersion?.due_rule_json ?? {}, null, 2),
    approvalRequired: editableVersion?.approval_required ?? false,
    blockingLevel: editableVersion?.blocking_level ?? "none",
    summary: editableVersion?.summary ?? "",
    sections:
      editableVersion?.sections.map((section) => ({
        localId: section.id,
        sectionKey: section.section_key,
        title: section.title,
        description: section.description ?? "",
        items: section.items.map((item) => ({
          localId: item.id,
          itemKey: item.item_key,
          label: item.label,
          helpText: item.help_text ?? "",
          itemType: item.item_type,
          required: item.required,
          proofRequired: item.proof_required,
          validationText: JSON.stringify(item.validation_json ?? {}, null, 2),
          optionsText: buildOptionsText(item.options_json ?? []),
          conditions: (item.conditions ?? []).map((condition) => ({
            localId: condition.id,
            conditionGroupKey: condition.condition_group_key,
            logicOperator: condition.logic_operator,
            sourceItemKey: condition.source_item_key,
            comparisonOperator: condition.comparison_operator,
            expectedValueText: JSON.stringify(condition.expected_value_json ?? null, null, 2),
            effect: condition.effect
          }))
        }))
      })) ?? [createEmptySection()]
  };
}

function parseLooseJson(value: string, fallback: unknown, errors: string[], label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  if (!["{", "["].includes(trimmed[0])) {
    if (trimmed === "true") {
      return true;
    }
    if (trimmed === "false") {
      return false;
    }
    if (trimmed === "null") {
      return null;
    }
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
      return numeric;
    }
    return trimmed;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    errors.push(`${label} must contain valid JSON.`);
    return fallback;
  }
}

function buildTemplateInput(draft: TemplateDraftState) {
  const errors: string[] = [];
  const sections = draft.sections
    .map((section, sectionIndex) => {
      const items = section.items
        .map((item, itemIndex) => {
          const itemLabel = item.label || item.itemKey || `Item ${itemIndex + 1}`;
          const validationJson = parseLooseJson(item.validationText, {}, errors, `Validation rules for "${itemLabel}"`);
          const optionsJson = (() => {
            const trimmed = item.optionsText.trim();
            if (!trimmed) {
              return [];
            }
            if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
              const parsed = parseLooseJson(trimmed, [], errors, `Options for "${itemLabel}"`);
              return Array.isArray(parsed) ? parsed : [];
            }
            return trimmed
              .split(/\r?\n/)
              .map((entry) => entry.trim())
              .filter(Boolean);
          })();
          const conditions = item.conditions
            .map((condition, conditionIndex) => ({
              condition_group_key: condition.conditionGroupKey.trim() || "default",
              logic_operator: condition.logicOperator,
              source_item_key: condition.sourceItemKey.trim(),
              comparison_operator: condition.comparisonOperator.trim() || "equals",
              expected_value_json: parseLooseJson(
                condition.expectedValueText,
                null,
                errors,
                `Expected value for condition ${conditionIndex + 1} on "${itemLabel}"`,
              ),
              effect: condition.effect,
              sort_order: conditionIndex
            }))
            .filter((condition) => condition.source_item_key);

          if (!item.label.trim()) {
            errors.push(`Item ${itemIndex + 1} in "${section.title || `Section ${sectionIndex + 1}`}" needs a label.`);
          }

          return {
            item_key: item.itemKey.trim() || null,
            label: item.label.trim(),
            help_text: item.helpText.trim() || null,
            item_type: item.itemType,
            required: item.required,
            proof_required: item.proofRequired,
            validation_json: (validationJson as Record<string, unknown>) ?? {},
            options_json: optionsJson,
            sort_order: itemIndex,
            conditions
          };
        })
        .filter((item) => item.label);

      if (!section.title.trim()) {
        errors.push(`Section ${sectionIndex + 1} needs a title.`);
      }
      if (!items.length) {
        errors.push(`Section "${section.title || `Section ${sectionIndex + 1}`}" needs at least one item.`);
      }

      return {
        section_key: section.sectionKey.trim() || null,
        title: section.title.trim(),
        description: section.description.trim() || null,
        sort_order: sectionIndex,
        items
      };
    })
    .filter((section) => section.title);

  if (!draft.name.trim()) {
    errors.push("Template name is required.");
  }
  if (!draft.code.trim()) {
    errors.push("Template code is required.");
  }
  if (!sections.length) {
    errors.push("Add at least one section before saving.");
  }

  return {
    errors,
    input: {
      name: draft.name.trim(),
      code: draft.code.trim(),
      description: draft.description.trim() || null,
      department_type: draft.departmentType ?? null,
      scope_type: draft.scopeType,
      trigger_type: draft.triggerType,
      due_rule_json: parseLooseJson(draft.dueRuleText, {}, errors, "Due rule"),
      approval_required: draft.approvalRequired,
      blocking_level: draft.blockingLevel,
      summary: draft.summary.trim() || null,
      sections
    } satisfies ChecklistTemplateVersionInput
  };
}

function reorder<T>(items: T[], fromIndex: number, toIndex: number) {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function updateSection(
  draft: TemplateDraftState,
  sectionLocalId: string,
  updater: (section: ChecklistSectionDraft) => ChecklistSectionDraft,
) {
  return {
    ...draft,
    sections: draft.sections.map((section) => (section.localId === sectionLocalId ? updater(section) : section))
  };
}

function updateItem(
  draft: TemplateDraftState,
  sectionLocalId: string,
  itemLocalId: string,
  updater: (item: ChecklistItemDraft) => ChecklistItemDraft,
) {
  return updateSection(draft, sectionLocalId, (section) => ({
    ...section,
    items: section.items.map((item) => (item.localId === itemLocalId ? updater(item) : item))
  }));
}

function templateStatusTone(template: ChecklistTemplateSummary) {
  if (template.archived_at) {
    return "neutral";
  }
  if (template.active_blocking_level === "hard_block") {
    return "danger";
  }
  if (template.active_approval_required) {
    return "warning";
  }
  return "info";
}

function versionTone(status: string) {
  if (status === "published") {
    return "success";
  }
  if (status === "draft") {
    return "warning";
  }
  return "neutral";
}

export function ChecklistTemplateWorkspace({ token, currentUser }: Props) {
  const canManageTemplates = hasPermission(currentUser, "checklist.template.manage") || hasPermission(currentUser, "settings.update");
  const canReadTemplates = canManageTemplates || canAccessChecklistTemplates(currentUser);
  const [filters, setFilters] = useState<ChecklistTemplateQuery>({
    department_type: "all",
    scope_type: undefined,
    include_archived: false
  });
  const [templates, setTemplates] = useState<ChecklistTemplateSummary[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<ChecklistTemplateDetail | null>(null);
  const [draft, setDraft] = useState<TemplateDraftState>(() => createEmptyDraft("shoot"));
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [builderError, setBuilderError] = useState("");
  const [builderNotice, setBuilderNotice] = useState("");

  const selectedSummary = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates]
  );
  const activeDraftVersion = useMemo(
    () => selectedTemplate?.versions.find((version) => version.status === "draft") ?? null,
    [selectedTemplate]
  );

  async function loadTemplates(options: { quiet?: boolean } = {}) {
    if (!canReadTemplates) {
      setTemplates([]);
      setLibraryLoading(false);
      setLibraryError("");
      return;
    }
    if (!options.quiet) {
      setLibraryLoading(true);
    }
    try {
      const payload = await listChecklistTemplates(token, filters);
      setTemplates(payload.templates);
      setLibraryError("");
      setSelectedTemplateId((current) => {
        if (current && payload.templates.some((template) => template.id === current)) {
          return current;
        }
        return payload.templates[0]?.id ?? null;
      });
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "We couldn't load the checklist template library.");
    } finally {
      if (!options.quiet) {
        setLibraryLoading(false);
      }
    }
  }

  async function loadTemplateDetail(templateId: string) {
    if (!templateId || !canReadTemplates) {
      setSelectedTemplate(null);
      setDetailError("");
      return;
    }
    setDetailLoading(true);
    try {
      const payload = await getChecklistTemplateDetail(token, templateId);
      setSelectedTemplate(payload.template);
      setDraft(toDraftState(payload.template));
      setDetailError("");
      setBuilderError("");
      setBuilderNotice("");
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "We couldn't load that checklist template.");
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void loadTemplates();
  }, [canReadTemplates, token, filters.department_type, filters.scope_type, filters.include_archived]);

  useEffect(() => {
    if (!selectedTemplateId) {
      setSelectedTemplate(null);
      if (!draft.templateId) {
        setDraft(createEmptyDraft(draft.scopeType));
      }
      return;
    }
    void loadTemplateDetail(selectedTemplateId);
  }, [selectedTemplateId, token]);

  function startNewTemplate() {
    setSelectedTemplateId(null);
    setSelectedTemplate(null);
    setDraft(createEmptyDraft(filters.scope_type ?? "shoot"));
    setBuilderError("");
    setBuilderNotice("");
    setDetailError("");
  }

  async function handleSaveDraft() {
    if (!canManageTemplates) {
      return;
    }
    const { input, errors } = buildTemplateInput(draft);
    if (errors.length) {
      setBuilderError(errors[0] ?? "Please review the draft before saving.");
      return;
    }
    setSaving(true);
    setBuilderError("");
    setBuilderNotice("");
    try {
      const payload = draft.templateId
        ? await updateChecklistTemplateDraft(token, draft.templateId, input)
        : await createChecklistTemplateDraft(token, input);
      setSelectedTemplateId(payload.template.id);
      setSelectedTemplate(payload.template);
      setDraft(toDraftState(payload.template));
      setBuilderNotice(
        draft.templateId
          ? `Draft version ${payload.template.versions.find((version) => version.status === "draft")?.version_number ?? ""} saved.`
          : "Checklist template draft created."
      );
      await loadTemplates({ quiet: true });
    } catch (error) {
      setBuilderError(error instanceof Error ? error.message : "We couldn't save that checklist draft.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublishDraft() {
    if (!canManageTemplates || !draft.templateId || !activeDraftVersion) {
      return;
    }
    setPublishing(true);
    setBuilderError("");
    setBuilderNotice("");
    try {
      const payload = await publishChecklistTemplateVersion(token, draft.templateId, activeDraftVersion.id);
      setSelectedTemplate(payload.template);
      setDraft(toDraftState(payload.template));
      setBuilderNotice(`Version ${activeDraftVersion.version_number} published.`);
      await loadTemplates({ quiet: true });
    } catch (error) {
      setBuilderError(error instanceof Error ? error.message : "We couldn't publish that checklist version.");
    } finally {
      setPublishing(false);
    }
  }

  async function handleSeedDefaults() {
    if (!canManageTemplates) {
      return;
    }
    setSeeding(true);
    setBuilderError("");
    setBuilderNotice("");
    try {
      const payload = await seedChecklistDefaults(token);
      setBuilderNotice(
        `Seeded ${payload.seeded.template_count} templates and ${payload.seeded.workflow_rule_count} workflow block rules.`
      );
      await loadTemplates();
    } catch (error) {
      setBuilderError(error instanceof Error ? error.message : "We couldn't seed the default checklist templates.");
    } finally {
      setSeeding(false);
    }
  }

  if (!canReadTemplates) {
    return (
      <section className="panel checklist-workspace checklist-workspace--limited">
        <WorkspaceEmptyState
          title="Checklist Templates"
          summary="Checklist templates are admin-managed workflow infrastructure. Ask an admin or department lead with checklist template access if you need a new reusable checklist."
        />
      </section>
    );
  }

  return (
    <div className="checklist-workspace">
      <WorkspacePageHeader
        eyebrow="Workflow Checklists"
        title="Checklist template library"
        summary="Build reusable, versioned workflow checklists for shoots and production without mutating historical completions."
        meta={[
          { label: `${templates.length} template${templates.length === 1 ? "" : "s"}`, tone: "info" },
          { label: activeDraftVersion ? `Draft v${activeDraftVersion.version_number} open` : "No draft selected", tone: activeDraftVersion ? "warning" : "neutral" }
        ]}
        actions={
          <WorkspaceActionBar align="end" compact>
            {canManageTemplates ? (
              <>
                <button className="secondary-button" type="button" onClick={handleSeedDefaults} disabled={seeding}>
                  {seeding ? "Seeding..." : "Seed Initial Templates"}
                </button>
                <button className="primary-button" type="button" onClick={startNewTemplate}>
                  New Template
                </button>
              </>
            ) : null}
          </WorkspaceActionBar>
        }
      />

      <WorkspaceFilterToolbar>
        <div className="workspace-toolbar__group">
          <label className="filter-field">
            <span>Department</span>
            <select
              value={filters.department_type === undefined ? "all" : String(filters.department_type)}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  department_type:
                    event.target.value === "all"
                      ? "all"
                      : event.target.value === "null"
                        ? null
                        : (event.target.value as ChecklistDepartmentType)
                }))
              }
            >
              {DEPARTMENT_OPTIONS.map((option) => (
                <option key={String(option.value)} value={option.value === null ? "null" : String(option.value)}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Scope</span>
            <select
              value={filters.scope_type ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  scope_type: event.target.value ? (event.target.value as ChecklistScopeType) : undefined
                }))
              }
            >
              {FILTER_SCOPE_OPTIONS.map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field filter-field--checkbox">
            <input
              type="checkbox"
              checked={Boolean(filters.include_archived)}
              onChange={(event) => setFilters((current) => ({ ...current, include_archived: event.target.checked }))}
            />
            <span>Include archived</span>
          </label>
        </div>
      </WorkspaceFilterToolbar>

      {libraryError ? <div className="error-banner">{libraryError}</div> : null}
      {builderError ? <div className="error-banner">{builderError}</div> : null}
      {builderNotice ? <div className="live-banner">{builderNotice}</div> : null}

      {libraryLoading && !templates.length ? (
        <WorkspaceLoadingBlock title="Loading checklist templates" summary="Pulling the reusable checklist library and active versions." />
      ) : (
        <div className="checklist-workspace__layout">
          <section className="panel checklist-library">
            <WorkspaceSectionHeader
              title="Template library"
              summary="Active and draft template versions stay versioned here so operational history never mutates underneath completed work."
            />
            {templates.length ? (
              <div className="checklist-library__table-wrap">
                <table className="checklist-library__table">
                  <thead>
                    <tr>
                      <th>Template</th>
                      <th>Department</th>
                      <th>Scope</th>
                      <th>Active Version</th>
                      <th>Approval</th>
                      <th>Blocking</th>
                      <th>Usage</th>
                      <th>Last Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((template) => {
                      const isActive = template.id === selectedTemplateId;
                      return (
                        <tr key={template.id} className={isActive ? "is-active" : undefined} onClick={() => setSelectedTemplateId(template.id)}>
                          <td>
                            <div className="checklist-library__name-cell">
                              <strong>{template.name}</strong>
                              <span>{template.code}</span>
                            </div>
                          </td>
                          <td>{template.department_type ? humanizeToken(template.department_type) : "Shared"}</td>
                          <td>{humanizeToken(template.scope_type)}</td>
                          <td>
                            {template.active_version_number ? (
                              <StatusPill label={`v${template.active_version_number}`} tone={versionTone(template.active_version_status ?? "draft")} />
                            ) : (
                              <StatusPill label="No published version" tone="warning" />
                            )}
                          </td>
                          <td>
                            <StatusPill label={template.active_approval_required ? "Approval required" : "No approval"} tone={template.active_approval_required ? "warning" : "info"} />
                          </td>
                          <td>
                            <StatusPill label={humanizeToken(template.active_blocking_level)} tone={templateStatusTone(template)} />
                          </td>
                          <td>{template.usage_count}</td>
                          <td>{formatDateTime(template.updated_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <WorkspaceEmptyState
                title="No checklist templates yet"
                summary="Seed the starting templates or create the first reusable workflow checklist."
              />
            )}
          </section>
          <section className="panel checklist-builder">
            <WorkspaceSectionHeader
              title={
                draft.templateId
                  ? `Builder | ${(selectedSummary?.name ?? draft.name) || "Checklist template"}`
                  : "Template builder"
              }
              summary="Save draft versions as often as you need, preview the runtime shape, and publish only when the version is ready to enforce workflow."
            />
            {detailLoading ? (
              <WorkspaceLoadingBlock title="Loading checklist builder" summary="Pulling the current template detail and version history." />
            ) : detailError ? (
              <WorkspaceEmptyState title="Template unavailable" summary={detailError} />
            ) : (
              <>
                <div className="checklist-builder__version-strip">
                  <div className="checklist-builder__version-summary">
                    <span>Editing</span>
                    <strong>{draft.editingVersionNumber ? `Version ${draft.editingVersionNumber}` : "New draft"}</strong>
                  </div>
                  <div className="shared-job-preview__status-row">
                    {selectedTemplate?.versions.map((version) => (
                      <StatusPill key={version.id} label={`v${version.version_number} ${humanizeToken(version.status)}`} tone={versionTone(version.status)} />
                    ))}
                  </div>
                </div>

                <div className="field-grid checklist-builder__top-grid">
                  <label className="filter-field">
                    <span>Template Name</span>
                    <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
                  </label>
                  <label className="filter-field">
                    <span>Code</span>
                    <input value={draft.code} onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))} />
                  </label>
                  <label className="filter-field">
                    <span>Department</span>
                    <select
                      value={draft.departmentType ?? "null"}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          departmentType: event.target.value === "null" ? null : (event.target.value as ChecklistDepartmentType)
                        }))
                      }
                    >
                      {DEPARTMENT_OPTIONS.filter((option) => option.value !== "all").map((option) => (
                        <option key={String(option.value)} value={option.value === null ? "null" : String(option.value)}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="filter-field">
                    <span>Scope</span>
                    <select value={draft.scopeType} onChange={(event) => setDraft((current) => ({ ...current, scopeType: event.target.value as ChecklistScopeType }))}>
                      {SCOPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="filter-field">
                    <span>Trigger</span>
                    <select value={draft.triggerType} onChange={(event) => setDraft((current) => ({ ...current, triggerType: event.target.value as ChecklistTriggerType }))}>
                      {TRIGGER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="filter-field">
                    <span>Blocking</span>
                    <select value={draft.blockingLevel} onChange={(event) => setDraft((current) => ({ ...current, blockingLevel: event.target.value as ChecklistBlockingLevel }))}>
                      {BLOCKING_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="filter-field filter-field--wide">
                  <span>Description</span>
                  <textarea rows={2} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
                </label>
                <label className="filter-field filter-field--wide">
                  <span>Summary</span>
                  <textarea rows={2} value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} />
                </label>
                <div className="field-grid checklist-builder__meta-grid">
                  <label className="filter-field filter-field--wide">
                    <span>Due Rule JSON</span>
                    <textarea rows={4} value={draft.dueRuleText} onChange={(event) => setDraft((current) => ({ ...current, dueRuleText: event.target.value }))} />
                  </label>
                  <label className="filter-field filter-field--checkbox">
                    <input
                      type="checkbox"
                      checked={draft.approvalRequired}
                      onChange={(event) => setDraft((current) => ({ ...current, approvalRequired: event.target.checked }))}
                    />
                    <span>Manager approval required</span>
                  </label>
                </div>

                <div className="checklist-builder__sections">
                  {draft.sections.map((section, sectionIndex) => (
                    <article key={section.localId} className="checklist-builder__section">
                      <div className="checklist-builder__section-header">
                        <div>
                          <strong>Section {sectionIndex + 1}</strong>
                          <span>{section.items.length} item{section.items.length === 1 ? "" : "s"}</span>
                        </div>
                        <WorkspaceActionBar align="end" compact>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={sectionIndex === 0}
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                sections: reorder(current.sections, sectionIndex, sectionIndex - 1)
                              }))
                            }
                          >
                            Move Up
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={sectionIndex === draft.sections.length - 1}
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                sections: reorder(current.sections, sectionIndex, sectionIndex + 1)
                              }))
                            }
                          >
                            Move Down
                          </button>
                          <button
                            type="button"
                            className="danger-button"
                            disabled={draft.sections.length === 1}
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                sections: current.sections.filter((candidate) => candidate.localId !== section.localId)
                              }))
                            }
                          >
                            Remove Section
                          </button>
                        </WorkspaceActionBar>
                      </div>

                      <div className="field-grid checklist-builder__section-grid">
                        <label className="filter-field">
                          <span>Section Title</span>
                          <input
                            value={section.title}
                            onChange={(event) =>
                              setDraft((current) => updateSection(current, section.localId, (candidate) => ({ ...candidate, title: event.target.value })))
                            }
                          />
                        </label>
                        <label className="filter-field">
                          <span>Section Key</span>
                          <input
                            value={section.sectionKey}
                            onChange={(event) =>
                              setDraft((current) => updateSection(current, section.localId, (candidate) => ({ ...candidate, sectionKey: event.target.value })))
                            }
                          />
                        </label>
                      </div>

                      <label className="filter-field filter-field--wide">
                        <span>Section Description</span>
                        <textarea
                          rows={2}
                          value={section.description}
                          onChange={(event) =>
                            setDraft((current) => updateSection(current, section.localId, (candidate) => ({ ...candidate, description: event.target.value })))
                          }
                        />
                      </label>

                      <div className="checklist-builder__items">
                          {section.items.map((item, itemIndex) => (
                            <ChecklistItemEditor
                              key={item.localId}
                              section={section}
                              item={item}
                              itemIndex={itemIndex}
                              itemCount={section.items.length}
                              onDraftChange={setDraft}
                          />
                        ))}
                      </div>

                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          setDraft((current) =>
                            updateSection(current, section.localId, (candidate) => ({
                              ...candidate,
                              items: [...candidate.items, createEmptyItem()]
                            }))
                          )
                        }
                      >
                        Add Item
                      </button>
                    </article>
                  ))}
                </div>

                <WorkspaceActionBar align="start">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setDraft((current) => ({ ...current, sections: [...current.sections, createEmptySection()] }))}
                  >
                    Add Section
                  </button>
                </WorkspaceActionBar>
                <div className="checklist-builder__preview-shell">
                  <WorkspaceSectionHeader
                    title="Runtime preview"
                    summary="This preview shows the draft as staff and managers will see it in Shoot and Production detail."
                  />
                  <div className="checklist-builder__preview">
                    <div className="shared-job-preview__status-row">
                      <StatusPill label={draft.blockingLevel === "none" ? "Non-blocking" : humanizeToken(draft.blockingLevel)} tone={draft.blockingLevel === "hard_block" ? "danger" : draft.blockingLevel === "soft_block" ? "warning" : "info"} />
                      <StatusPill label={humanizeToken(draft.scopeType)} tone="info" />
                      <StatusPill label={draft.approvalRequired ? "Approval required" : "Submission only"} tone={draft.approvalRequired ? "warning" : "success"} />
                    </div>
                    <h3>{draft.name || "Untitled checklist"}</h3>
                    <p>{draft.summary || draft.description || "Template summary will appear here."}</p>
                    <div className="checklist-builder__preview-sections">
                      {draft.sections.map((section, sectionIndex) => (
                        <section key={section.localId} className="checklist-builder__preview-section">
                          <header>
                            <strong>{section.title || `Section ${sectionIndex + 1}`}</strong>
                            {section.description ? <span>{section.description}</span> : null}
                          </header>
                          <div className="checklist-builder__preview-items">
                            {section.items.map((item, itemIndex) => (
                              <article key={item.localId} className="checklist-builder__preview-item">
                                <div className="checklist-builder__preview-item-main">
                                  <strong>{item.label || `Item ${itemIndex + 1}`}</strong>
                                  {item.helpText ? <p>{item.helpText}</p> : null}
                                  <div className="shared-job-preview__status-row">
                                    <StatusPill label={humanizeToken(item.itemType)} tone="info" />
                                    {item.required ? <StatusPill label="Required" tone="warning" /> : null}
                                    {item.proofRequired ? <StatusPill label="Proof" tone="danger" /> : null}
                                  </div>
                                </div>
                                {item.conditions.length ? (
                                  <div className="checklist-builder__preview-conditions">
                                    {item.conditions.map((condition) => (
                                      <span key={condition.localId} className="checklist-builder__preview-condition">
                                        {humanizeToken(condition.effect)} if {condition.sourceItemKey || "source item"} {condition.comparisonOperator || "equals"} {condition.expectedValueText || "value"}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </article>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                </div>

                <WorkspaceActionBar align="end">
                  <button className="secondary-button" type="button" onClick={startNewTemplate}>
                    Reset Builder
                  </button>
                  {canManageTemplates ? (
                    <>
                      <button className="secondary-button" type="button" onClick={handleSaveDraft} disabled={saving}>
                        {saving ? "Saving..." : draft.templateId ? "Save Draft Version" : "Create Draft"}
                      </button>
                      <button className="primary-button" type="button" onClick={handlePublishDraft} disabled={publishing || !draft.templateId || !activeDraftVersion}>
                        {publishing ? "Publishing..." : activeDraftVersion ? `Publish v${activeDraftVersion.version_number}` : "Save a draft first"}
                      </button>
                    </>
                  ) : null}
                </WorkspaceActionBar>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ChecklistItemEditor({
  section,
  item,
  itemIndex,
  itemCount,
  onDraftChange
}: {
  section: ChecklistSectionDraft;
  item: ChecklistItemDraft;
  itemIndex: number;
  itemCount: number;
  onDraftChange: Dispatch<SetStateAction<TemplateDraftState>>;
}) {
  return (
    <article className="checklist-builder__item">
      <div className="checklist-builder__item-header">
        <div>
          <strong>Item {itemIndex + 1}</strong>
          <span>{humanizeToken(item.itemType)}</span>
        </div>
        <WorkspaceActionBar align="end" compact>
          <button
            type="button"
            className="secondary-button"
            disabled={itemIndex === 0}
            onClick={() =>
              onDraftChange((current) =>
                updateSection(current, section.localId, (candidate) => ({
                  ...candidate,
                  items: reorder(candidate.items, itemIndex, itemIndex - 1)
                }))
              )
            }
          >
            Up
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={itemIndex === itemCount - 1}
            onClick={() =>
              onDraftChange((current) =>
                updateSection(current, section.localId, (candidate) => ({
                  ...candidate,
                  items: reorder(candidate.items, itemIndex, itemIndex + 1)
                }))
              )
            }
          >
            Down
          </button>
          <button
            type="button"
            className="danger-button"
            disabled={itemCount === 1}
            onClick={() =>
              onDraftChange((current) =>
                updateSection(current, section.localId, (candidate) => ({
                  ...candidate,
                  items: candidate.items.filter((candidateItem) => candidateItem.localId !== item.localId)
                }))
              )
            }
          >
            Remove
          </button>
        </WorkspaceActionBar>
      </div>
      <div className="field-grid checklist-builder__item-grid">
        <label className="filter-field">
          <span>Label</span>
          <input value={item.label} onChange={(event) => onDraftChange((current) => updateItem(current, section.localId, item.localId, (candidate) => ({ ...candidate, label: event.target.value })))} />
        </label>
        <label className="filter-field">
          <span>Key</span>
          <input value={item.itemKey} onChange={(event) => onDraftChange((current) => updateItem(current, section.localId, item.localId, (candidate) => ({ ...candidate, itemKey: event.target.value })))} />
        </label>
        <label className="filter-field">
          <span>Type</span>
          <select value={item.itemType} onChange={(event) => onDraftChange((current) => updateItem(current, section.localId, item.localId, (candidate) => ({ ...candidate, itemType: event.target.value as ChecklistItemType })))}>
            {ITEM_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="filter-field filter-field--wide">
        <span>Help Text</span>
        <textarea rows={2} value={item.helpText} onChange={(event) => onDraftChange((current) => updateItem(current, section.localId, item.localId, (candidate) => ({ ...candidate, helpText: event.target.value })))} />
      </label>
      <div className="field-grid checklist-builder__meta-grid">
        <label className="filter-field filter-field--checkbox">
          <input type="checkbox" checked={item.required} onChange={(event) => onDraftChange((current) => updateItem(current, section.localId, item.localId, (candidate) => ({ ...candidate, required: event.target.checked })))} />
          <span>Required</span>
        </label>
        <label className="filter-field filter-field--checkbox">
          <input type="checkbox" checked={item.proofRequired} onChange={(event) => onDraftChange((current) => updateItem(current, section.localId, item.localId, (candidate) => ({ ...candidate, proofRequired: event.target.checked })))} />
          <span>Proof required</span>
        </label>
      </div>
      <div className="field-grid checklist-builder__json-grid">
        <label className="filter-field filter-field--wide">
          <span>Validation Rules JSON</span>
          <textarea rows={3} value={item.validationText} onChange={(event) => onDraftChange((current) => updateItem(current, section.localId, item.localId, (candidate) => ({ ...candidate, validationText: event.target.value })))} />
        </label>
        <label className="filter-field filter-field--wide">
          <span>Options</span>
          <textarea rows={3} value={item.optionsText} onChange={(event) => onDraftChange((current) => updateItem(current, section.localId, item.localId, (candidate) => ({ ...candidate, optionsText: event.target.value })))} placeholder="One option per line or JSON array." />
        </label>
      </div>
      <div className="checklist-builder__conditions">
        <div className="checklist-builder__conditions-header">
          <strong>Conditions</strong>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              onDraftChange((current) =>
                updateItem(current, section.localId, item.localId, (candidate) => ({
                  ...candidate,
                  conditions: [...candidate.conditions, createEmptyCondition()]
                }))
              )
            }
          >
            Add Condition
          </button>
        </div>
        {item.conditions.length ? (
          item.conditions.map((condition) => (
            <div key={condition.localId} className="checklist-builder__condition-row">
              <label className="filter-field">
                <span>Source Key</span>
                <input value={condition.sourceItemKey} onChange={(event) => onDraftChange((current) => updateItem(current, section.localId, item.localId, (candidate) => ({ ...candidate, conditions: candidate.conditions.map((candidateCondition) => candidateCondition.localId === condition.localId ? { ...candidateCondition, sourceItemKey: event.target.value } : candidateCondition) })))} />
              </label>
              <label className="filter-field">
                <span>Effect</span>
                <select value={condition.effect} onChange={(event) => onDraftChange((current) => updateItem(current, section.localId, item.localId, (candidate) => ({ ...candidate, conditions: candidate.conditions.map((candidateCondition) => candidateCondition.localId === condition.localId ? { ...candidateCondition, effect: event.target.value as ChecklistConditionEffect } : candidateCondition) })))}>
                  {CONDITION_EFFECT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Logic</span>
                <select value={condition.logicOperator} onChange={(event) => onDraftChange((current) => updateItem(current, section.localId, item.localId, (candidate) => ({ ...candidate, conditions: candidate.conditions.map((candidateCondition) => candidateCondition.localId === condition.localId ? { ...candidateCondition, logicOperator: event.target.value as ChecklistConditionLogic } : candidateCondition) })))}>
                  {CONDITION_LOGIC_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Operator</span>
                <input value={condition.comparisonOperator} onChange={(event) => onDraftChange((current) => updateItem(current, section.localId, item.localId, (candidate) => ({ ...candidate, conditions: candidate.conditions.map((candidateCondition) => candidateCondition.localId === condition.localId ? { ...candidateCondition, comparisonOperator: event.target.value } : candidateCondition) })))} />
              </label>
              <label className="filter-field filter-field--wide">
                <span>Expected Value</span>
                <textarea rows={2} value={condition.expectedValueText} onChange={(event) => onDraftChange((current) => updateItem(current, section.localId, item.localId, (candidate) => ({ ...candidate, conditions: candidate.conditions.map((candidateCondition) => candidateCondition.localId === condition.localId ? { ...candidateCondition, expectedValueText: event.target.value } : candidateCondition) })))} />
              </label>
              <label className="filter-field">
                <span>Group Key</span>
                <input value={condition.conditionGroupKey} onChange={(event) => onDraftChange((current) => updateItem(current, section.localId, item.localId, (candidate) => ({ ...candidate, conditions: candidate.conditions.map((candidateCondition) => candidateCondition.localId === condition.localId ? { ...candidateCondition, conditionGroupKey: event.target.value } : candidateCondition) })))} />
              </label>
              <button
                type="button"
                className="danger-button checklist-builder__condition-remove"
                onClick={() =>
                  onDraftChange((current) =>
                    updateItem(current, section.localId, item.localId, (candidate) => ({
                      ...candidate,
                      conditions: candidate.conditions.filter((candidateCondition) => candidateCondition.localId !== condition.localId)
                    }))
                  )
                }
              >
                Remove
              </button>
            </div>
          ))
        ) : (
          <div className="empty-state empty-state--panel checklist-builder__empty-inline">
            No conditions yet. Add AND/OR groups only where the runtime needs to show, hide, require, or disable items.
          </div>
        )}
      </div>
    </article>
  );
}
