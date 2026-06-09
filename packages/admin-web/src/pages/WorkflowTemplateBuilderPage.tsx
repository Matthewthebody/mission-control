import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { StatusPill } from "../components/sports/SportsPrimitives";
import { featureFlags } from "../featureFlags";
import { canManageWorkflowTemplates } from "../permissions";
import type {
  WorkflowTemplateBuilderDetail,
  WorkflowTemplateBuilderDependencyMode,
  WorkflowTemplateBuilderMilestone,
  WorkflowTemplateBuilderOwnerType,
  WorkflowTemplateBuilderStep,
  WorkflowTemplateBuilderSummary
} from "../projectTrackingTypes";
import {
  addWorkflowTemplateBuilderMilestone,
  addWorkflowTemplateBuilderStep,
  archiveWorkflowTemplateBuilderVersion,
  createWorkflowTemplateBuilderDraft,
  getWorkflowTemplateBuilderDetail,
  listWorkflowTemplateBuilderTemplates,
  moveWorkflowTemplateBuilderStep,
  publishWorkflowTemplateBuilderVersion,
  removeWorkflowTemplateBuilderStep,
  updateWorkflowTemplateBuilderStep
} from "../services/projectTracking";
import type { SessionUser } from "../types";

const WORK_DEPARTMENT_OPTIONS = [
  { label: "Schools", value: "schools" },
  { label: "Sports", value: "sports" },
  { label: "Production and Graphics", value: "production" },
  { label: "Photography / Studios", value: "photography" },
  { label: "Operations", value: "operations" },
  { label: "Other", value: "other" }
] as const;
const DEPARTMENT_OPTIONS = WORK_DEPARTMENT_OPTIONS.map((option) => option.value);
const TEMPLATE_CATEGORY_OPTIONS = [
  { label: "Schools", value: "schools" },
  { label: "Sports", value: "sports" },
  { label: "Studios", value: "studios" },
  { label: "Graphics", value: "graphics" },
  { label: "Production", value: "production" },
  { label: "Customer Service", value: "customer_service" },
  { label: "Admin", value: "admin" },
  { label: "Leadership", value: "leadership" },
  { label: "Company-wide", value: "company_wide" }
] as const;
const JOB_TYPE_OPTIONS = [
  { label: "Photo Day", value: "photo_day" },
  { label: "Sports Picture Day", value: "sports_picture_day" },
  { label: "Graduation", value: "graduation" },
  { label: "Studio Session", value: "studio_session" },
  { label: "Event", value: "event" },
  { label: "Other", value: "other" }
] as const;
const OWNER_TYPE_OPTIONS: WorkflowTemplateBuilderOwnerType[] = [
  "department",
  "role",
  "user",
  "account_owner",
  "job_owner",
  "qa_reviewer",
  "production_lead"
];
const DEPENDENCY_MODE_OPTIONS: WorkflowTemplateBuilderDependencyMode[] = [
  "can_start_immediately",
  "waits_for_prior_step",
  "waits_for_dependencies",
  "waits_for_milestone_completion"
];
const ROLE_PLACEHOLDER_OPTIONS: Array<{ label: string; value: string; ownerType: WorkflowTemplateBuilderOwnerType }> = [
  { label: "Account Owner", value: "account_owner", ownerType: "account_owner" },
  { label: "CSR Owner", value: "csr_owner", ownerType: "role" },
  { label: "Senior Photographer", value: "senior_photographer", ownerType: "role" },
  { label: "Graphics Artist", value: "graphics_artist", ownerType: "role" },
  { label: "Production Lead", value: "production_lead", ownerType: "production_lead" },
  { label: "Schools Director", value: "schools_director", ownerType: "role" },
  { label: "Billing Contact", value: "billing_contact", ownerType: "role" },
  { label: "Photographer", value: "photographer", ownerType: "role" },
  { label: "Shoot Lead", value: "shoot_lead", ownerType: "role" },
  { label: "Unassigned", value: "unassigned", ownerType: "role" }
];
const ASSIGNMENT_MODE_OPTIONS = [
  { label: "Auto-assign to role", value: "auto_role" },
  { label: "Auto-assign to team queue", value: "team_queue" },
  { label: "Needs assignment when reached", value: "needs_assignment" },
  { label: "Inherit from job owner", value: "inherit_job_owner" },
  { label: "Inherit from account / CSR owner", value: "inherit_account_owner" }
] as const;
const NEEDS_ASSIGNMENT_BLOCKED_BEHAVIOR = "needs_assignment_when_reached";
const TEAM_QUEUE_OPTIONS = WORK_DEPARTMENT_OPTIONS.filter((option) => option.value !== "other");

type ActiveStepEditor = {
  mode: "new" | "duplicate" | "edit";
  milestoneId: string;
  afterStepId: string | null;
  stepId: string | null;
  sortOrder: number | null;
};
type StepAssignmentMode = typeof ASSIGNMENT_MODE_OPTIONS[number]["value"];
type StepFormState = ReturnType<typeof emptyStepForm>;

function humanize(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ") : "Not set";
}

function formatStepTime(minutes: number) {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} min`;
}

function rolePlaceholderLabel(value: string | null | undefined) {
  const match = ROLE_PLACEHOLDER_OPTIONS.find((option) => option.value === value);
  return match?.label ?? humanize(value);
}

function assignmentModeLabel(value: StepAssignmentMode) {
  return ASSIGNMENT_MODE_OPTIONS.find((option) => option.value === value)?.label ?? "Assignment";
}

function departmentLabel(value: string | null | undefined) {
  const match = WORK_DEPARTMENT_OPTIONS.find((option) => option.value === value);
  return match?.label ?? humanize(value);
}

function templateCategoryLabel(value: string | null | undefined) {
  const match = TEMPLATE_CATEGORY_OPTIONS.find((option) => option.value === value);
  return match?.label ?? humanize(value);
}

function templateCodeFromName(name: string, existingKey: string) {
  const suffix = existingKey.match(/_(\d{6})$/)?.[1] ?? uniqueCopySuffix();
  return `${templateKeyFromName(name)}_${suffix}`;
}

function isMissionControlDemoTemplate(template: WorkflowTemplateBuilderSummary) {
  return template.template_key.startsWith("mission_control_demo_");
}

function isGeneratedWorkflowFixture(template: WorkflowTemplateBuilderSummary) {
  const name = template.name.toLowerCase();
  return name.includes("smoke template") || template.template_key.startsWith("project_tracking_");
}

function templateKeyFromName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "workflow_template";
}

function emptyDraftForm() {
  const suffix = Date.now().toString().slice(-6);
  return {
    template_key: `workflow_template_${suffix}`,
    name: "New Workflow Template",
    description: "Linear controlled workflow for a reusable job type.",
    job_type: "photo_day",
    category: "schools",
    departments_involved: ["schools", "production"]
  };
}

function emptyMilestoneForm() {
  return {
    milestone_key: "intake",
    name: "Intake",
    description: "Confirm scope, schedule, and owner path before production starts.",
    default_owner_type: "account_owner" as WorkflowTemplateBuilderOwnerType,
    default_owner_value: "account_owner"
  };
}

function emptyStepForm() {
  return {
    milestone_template_id: "",
    step_key: "confirm_scope",
    name: "Confirm scope",
    description: "Make sure the job has enough information to move forward.",
    department: "schools",
    role_key: "account_owner",
    assigned_user_id: null as string | null,
    owner_type: "account_owner" as WorkflowTemplateBuilderOwnerType,
    owner_value: "account_owner",
    expected_duration_minutes: 1440,
    due_offset_minutes: 0,
    dependency_mode: "waits_for_prior_step" as WorkflowTemplateBuilderDependencyMode,
    depends_on_step_keys: "",
    blocked_behavior: null as string | null,
    required: true,
    skippable: false,
    blocking: true,
    assignment_mode: "inherit_account_owner" as StepAssignmentMode,
    assignment_role: "account_owner",
    assignment_team_queue: "schools",
    assignment_assigner_role: "production_lead"
  };
}

function assignmentStateFromStep(step: WorkflowTemplateBuilderStep | null | undefined) {
  if (!step) {
    return {
      assignment_mode: "inherit_account_owner" as StepAssignmentMode,
      assignment_role: "account_owner",
      assignment_team_queue: "schools",
      assignment_assigner_role: "production_lead"
    };
  }
  if (step.blocked_behavior === NEEDS_ASSIGNMENT_BLOCKED_BEHAVIOR) {
    return {
      assignment_mode: "needs_assignment" as StepAssignmentMode,
      assignment_role: step.role_key ?? "production_lead",
      assignment_team_queue: step.department,
      assignment_assigner_role: step.role_key ?? "production_lead"
    };
  }
  if (step.owner_type === "department") {
    return {
      assignment_mode: "team_queue" as StepAssignmentMode,
      assignment_role: step.role_key ?? "production_lead",
      assignment_team_queue: step.department,
      assignment_assigner_role: "production_lead"
    };
  }
  if (step.owner_type === "job_owner") {
    return {
      assignment_mode: "inherit_job_owner" as StepAssignmentMode,
      assignment_role: "job_owner",
      assignment_team_queue: step.department,
      assignment_assigner_role: "production_lead"
    };
  }
  if (step.owner_type === "account_owner" || step.owner_value === "account_owner" || step.owner_value === "csr_owner") {
    return {
      assignment_mode: "inherit_account_owner" as StepAssignmentMode,
      assignment_role: step.owner_value ?? "account_owner",
      assignment_team_queue: step.department,
      assignment_assigner_role: "production_lead"
    };
  }
  return {
    assignment_mode: "auto_role" as StepAssignmentMode,
    assignment_role: step.role_key ?? step.owner_value ?? "production_lead",
    assignment_team_queue: step.department,
    assignment_assigner_role: step.role_key ?? "production_lead"
  };
}

function assignmentSummaryForStep(step: WorkflowTemplateBuilderStep) {
  const state = assignmentStateFromStep(step);
  switch (state.assignment_mode) {
    case "needs_assignment":
      return {
        label: "Needs assignment",
        detail: `${departmentLabel(state.assignment_team_queue)} queue`
      };
    case "team_queue":
      return {
        label: "Team queue",
        detail: departmentLabel(state.assignment_team_queue)
      };
    case "inherit_job_owner":
      return {
        label: "Inherit owner",
        detail: "Job owner"
      };
    case "inherit_account_owner":
      return {
        label: "Inherit owner",
        detail: rolePlaceholderLabel(state.assignment_role)
      };
    case "auto_role":
    default:
      return {
        label: "Auto-assign role",
        detail: rolePlaceholderLabel(state.assignment_role)
      };
  }
}

function stepFormWithAssignmentMode(form: StepFormState, assignmentMode: StepAssignmentMode): StepFormState {
  switch (assignmentMode) {
    case "team_queue":
      return {
        ...form,
        assignment_mode: assignmentMode,
        owner_type: "department",
        owner_value: form.assignment_team_queue,
        role_key: "",
        assigned_user_id: null,
        blocked_behavior: null
      };
    case "needs_assignment":
      return {
        ...form,
        assignment_mode: assignmentMode,
        owner_type: "department",
        owner_value: form.assignment_team_queue,
        role_key: form.assignment_assigner_role,
        assigned_user_id: null,
        blocked_behavior: NEEDS_ASSIGNMENT_BLOCKED_BEHAVIOR
      };
    case "inherit_job_owner":
      return {
        ...form,
        assignment_mode: assignmentMode,
        owner_type: "job_owner",
        owner_value: "job_owner",
        role_key: "",
        assigned_user_id: null,
        blocked_behavior: null
      };
    case "inherit_account_owner":
      return {
        ...form,
        assignment_mode: assignmentMode,
        owner_type: "account_owner",
        owner_value: "account_owner",
        role_key: "account_owner",
        assigned_user_id: null,
        blocked_behavior: null
      };
    case "auto_role":
    default: {
      const selectedRole = ROLE_PLACEHOLDER_OPTIONS.find((option) => option.value === form.assignment_role);
      return {
        ...form,
        assignment_mode: "auto_role",
        owner_type: selectedRole?.ownerType ?? "role",
        owner_value: form.assignment_role,
        role_key: form.assignment_role,
        assigned_user_id: null,
        blocked_behavior: null
      };
    }
  }
}

function resolveStepAssignmentPayload(form: StepFormState) {
  const normalized = stepFormWithAssignmentMode(form, form.assignment_mode);
  return {
    owner_type: normalized.owner_type,
    owner_value: normalized.owner_value || null,
    role_key: normalized.role_key || null,
    assigned_user_id: normalized.assigned_user_id ?? null,
    department: normalized.department,
    blocked_behavior: normalized.blocked_behavior
  };
}

function uniqueCopySuffix() {
  return Date.now().toString().slice(-6);
}

export function WorkflowTemplateBuilderPage({ token, currentUser }: { token: string; currentUser: SessionUser }) {
  const [templates, setTemplates] = useState<WorkflowTemplateBuilderSummary[]>([]);
  const [detail, setDetail] = useState<WorkflowTemplateBuilderDetail | null>(null);
  const [draftForm, setDraftForm] = useState(emptyDraftForm);
  const [milestoneForm, setMilestoneForm] = useState(emptyMilestoneForm);
  const [stepForm, setStepForm] = useState(emptyStepForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeStepEditor, setActiveStepEditor] = useState<ActiveStepEditor | null>(null);
  const inlineStepNameRef = useRef<HTMLInputElement | null>(null);
  const stageNameRef = useRef<HTMLInputElement | null>(null);

  const canManage = canManageWorkflowTemplates(currentUser);
  const selectedDraft = detail?.version.status === "draft" ? detail : null;
  const totalSteps = detail?.milestones.reduce((count, milestone) => count + milestone.steps.length, 0) ?? 0;
  const demoTemplates = templates.filter(isMissionControlDemoTemplate);
  const nonGeneratedTemplates = templates.filter((template) => !isGeneratedWorkflowFixture(template));
  const visibleTemplates = demoTemplates.length >= 3 ? demoTemplates : nonGeneratedTemplates.slice(0, 10);
  const hiddenTemplateCount = Math.max(templates.length - visibleTemplates.length, 0);

  useEffect(() => {
    if (!activeStepEditor) {
      return;
    }
    window.requestAnimationFrame(() => inlineStepNameRef.current?.focus());
  }, [activeStepEditor]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!featureFlags.workflowTemplateBuilderV1 || !canManage) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const payload = await listWorkflowTemplateBuilderTemplates(token);
        if (!cancelled) {
          setTemplates(payload.templates);
          setError(null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Workflow templates could not load.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [canManage, token]);

  async function refreshTemplateList() {
    const payload = await listWorkflowTemplateBuilderTemplates(token);
    setTemplates(payload.templates);
  }

  async function selectTemplate(templateId: string) {
    if (!templateId) {
      setDetail(null);
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const payload = await getWorkflowTemplateBuilderDetail(token, templateId);
      setDetail(payload);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Workflow template could not be opened.");
    } finally {
      setSaving(false);
    }
  }

  async function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const payload = await createWorkflowTemplateBuilderDraft(token, draftForm);
      setDetail(payload);
      setStepForm((current) => ({ ...current, milestone_template_id: payload.milestones[0]?.id ?? "" }));
      await refreshTemplateList();
      setNotice("Draft created. Add milestones and controlled steps before publishing.");
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Draft could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function submitMilestone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDraft) {
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const payload = await addWorkflowTemplateBuilderMilestone(token, selectedDraft.version.id, milestoneForm);
      setDetail(payload);
      const latestMilestone = payload.milestones[payload.milestones.length - 1];
      setStepForm((current) => ({ ...current, milestone_template_id: latestMilestone?.id ?? current.milestone_template_id }));
      setMilestoneForm(emptyMilestoneForm());
      setNotice("Milestone added to the draft.");
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Milestone could not be added.");
    } finally {
      setSaving(false);
    }
  }

  async function submitStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDraft) {
      return;
    }
    const dependencyKeys = stepForm.depends_on_step_keys
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    setSaving(true);
    setNotice(null);
    try {
      const normalizedStepForm = stepFormWithAssignmentMode(stepForm, stepForm.assignment_mode);
      const assignmentPayload = resolveStepAssignmentPayload(stepForm);
      const stepPayload = {
        milestone_template_id: normalizedStepForm.milestone_template_id,
        step_key: normalizedStepForm.step_key,
        name: normalizedStepForm.name,
        description: normalizedStepForm.description,
        expected_duration_minutes: normalizedStepForm.expected_duration_minutes,
        due_offset_minutes: normalizedStepForm.due_offset_minutes,
        dependency_mode: normalizedStepForm.dependency_mode,
        depends_on_step_keys: dependencyKeys,
        role_key: assignmentPayload.role_key,
        assigned_user_id: assignmentPayload.assigned_user_id,
        owner_type: assignmentPayload.owner_type,
        owner_value: assignmentPayload.owner_value,
        department: assignmentPayload.department,
        blocked_behavior: assignmentPayload.blocked_behavior,
        required: stepForm.required,
        skippable: stepForm.skippable,
        blocking: stepForm.blocking,
        sort_order: activeStepEditor?.sortOrder ?? null
      };
      const payload = activeStepEditor?.mode === "edit" && activeStepEditor.stepId
        ? await updateWorkflowTemplateBuilderStep(token, selectedDraft.version.id, activeStepEditor.stepId, stepPayload)
        : await addWorkflowTemplateBuilderStep(token, selectedDraft.version.id, stepPayload);
      setDetail(payload);
      setActiveStepEditor(null);
      setStepForm((current) => ({
        ...emptyStepForm(),
        milestone_template_id: current.milestone_template_id,
        step_key: `${current.step_key}_next`,
        name: "Next controlled step",
        depends_on_step_keys: stepForm.step_key
      }));
      setNotice(activeStepEditor?.mode === "edit" ? "Controlled step updated in the draft." : "Controlled step added to the draft.");
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Controlled step could not be added.");
    } finally {
      setSaving(false);
    }
  }

  function canReplaceActiveStepEditor() {
    return !activeStepEditor || window.confirm("Discard the unsaved step draft?");
  }

  function stepSortOrderAfter(milestone: WorkflowTemplateBuilderMilestone, priorStep: WorkflowTemplateBuilderStep | null) {
    const steps = [...milestone.steps].sort((left, right) => left.sort_order - right.sort_order);
    if (!priorStep) {
      const firstStep = steps[0];
      return firstStep ? Math.max(0, firstStep.sort_order - 5) : 10;
    }
    const priorIndex = steps.findIndex((step) => step.id === priorStep.id);
    const nextStep = priorIndex >= 0 ? steps[priorIndex + 1] : null;
    if (nextStep && nextStep.sort_order - priorStep.sort_order > 1) {
      return Math.floor((priorStep.sort_order + nextStep.sort_order) / 2);
    }
    return priorStep.sort_order + 10;
  }

  function prepareStepAfter(milestone: WorkflowTemplateBuilderMilestone, priorStep: WorkflowTemplateBuilderStep | null) {
    if (!canReplaceActiveStepEditor()) {
      return;
    }
    const assignmentState = assignmentStateFromStep(priorStep);
    setStepForm({
      ...emptyStepForm(),
      milestone_template_id: milestone.id,
      step_key: priorStep ? `${priorStep.step_key}_next_${uniqueCopySuffix()}` : `${milestone.milestone_key}_step_${uniqueCopySuffix()}`,
      name: priorStep ? "Next controlled step" : "New controlled step",
      department: priorStep?.department ?? "schools",
      owner_type: priorStep?.owner_type ?? milestone.default_owner_type ?? "account_owner",
      owner_value: priorStep?.owner_value ?? milestone.default_owner_value ?? "account_owner",
      role_key: priorStep?.role_key ?? "account_owner",
      depends_on_step_keys: priorStep?.step_key ?? "",
      blocked_behavior: priorStep?.blocked_behavior ?? null,
      ...assignmentState
    });
    setActiveStepEditor({
      mode: "new",
      milestoneId: milestone.id,
      afterStepId: priorStep?.id ?? null,
      stepId: null,
      sortOrder: stepSortOrderAfter(milestone, priorStep)
    });
  }

  function prepareEditStep(milestone: WorkflowTemplateBuilderMilestone, step: WorkflowTemplateBuilderStep) {
    if (!canReplaceActiveStepEditor()) {
      return;
    }
    const assignmentState = assignmentStateFromStep(step);
    setStepForm({
      ...emptyStepForm(),
      milestone_template_id: milestone.id,
      step_key: step.step_key,
      name: step.name,
      description: step.description ?? "",
      department: step.department,
      role_key: step.role_key ?? "",
      assigned_user_id: step.assigned_user_id,
      owner_type: step.owner_type ?? "department",
      owner_value: step.owner_value ?? step.department,
      expected_duration_minutes: step.expected_duration_minutes,
      due_offset_minutes: step.due_offset_minutes ?? 0,
      dependency_mode: step.dependency_mode,
      depends_on_step_keys: step.depends_on_step_keys.join(", "),
      required: step.required,
      skippable: step.skippable,
      blocking: step.blocking,
      blocked_behavior: step.blocked_behavior,
      ...assignmentState
    });
    setActiveStepEditor({
      mode: "edit",
      milestoneId: milestone.id,
      afterStepId: step.id,
      stepId: step.id,
      sortOrder: step.sort_order
    });
  }

  function prepareDuplicateStep(milestone: WorkflowTemplateBuilderMilestone, step: WorkflowTemplateBuilderStep) {
    if (!canReplaceActiveStepEditor()) {
      return;
    }
    const assignmentState = assignmentStateFromStep(step);
    setStepForm({
      ...emptyStepForm(),
      milestone_template_id: milestone.id,
      step_key: `${step.step_key}_copy_${uniqueCopySuffix()}`,
      name: `${step.name} Copy`,
      description: step.description ?? "",
      department: step.department,
      role_key: step.role_key ?? "",
      assigned_user_id: step.assigned_user_id,
      owner_type: step.owner_type ?? "department",
      owner_value: step.owner_value ?? step.department,
      expected_duration_minutes: step.expected_duration_minutes,
      due_offset_minutes: step.due_offset_minutes ?? 0,
      dependency_mode: step.dependency_mode,
      depends_on_step_keys: step.depends_on_step_keys.join(", "),
      required: step.required,
      skippable: step.skippable,
      blocking: step.blocking,
      blocked_behavior: step.blocked_behavior,
      ...assignmentState
    });
    setActiveStepEditor({
      mode: "duplicate",
      milestoneId: milestone.id,
      afterStepId: step.id,
      stepId: null,
      sortOrder: stepSortOrderAfter(milestone, step)
    });
  }

  function cancelInlineStep() {
    setActiveStepEditor(null);
    setStepForm(emptyStepForm());
  }

  async function moveStep(step: WorkflowTemplateBuilderStep, direction: "up" | "down") {
    if (!selectedDraft) {
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const payload = await moveWorkflowTemplateBuilderStep(token, selectedDraft.version.id, step.id, direction);
      setDetail(payload);
      setActiveStepEditor(null);
      setNotice(`Step moved ${direction} in the draft copy.`);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Workflow step could not be moved.");
    } finally {
      setSaving(false);
    }
  }

  async function removeStep(step: WorkflowTemplateBuilderStep) {
    if (!selectedDraft) {
      return;
    }
    if (!window.confirm(`Remove "${step.name}" from this draft copy? The protected template and live workflows will not change.`)) {
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const payload = await removeWorkflowTemplateBuilderStep(token, selectedDraft.version.id, step.id);
      setDetail(payload);
      if (activeStepEditor?.stepId === step.id || activeStepEditor?.afterStepId === step.id) {
        setActiveStepEditor(null);
      }
      setNotice("Step removed from the draft copy.");
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Workflow step could not be removed.");
    } finally {
      setSaving(false);
    }
  }

  function scrollToStageForm() {
    window.requestAnimationFrame(() => stageNameRef.current?.focus());
  }

  function selectRolePlaceholder(value: string) {
    const selected = ROLE_PLACEHOLDER_OPTIONS.find((option) => option.value === value);
    if (!selected) {
      return;
    }
    setStepForm((current) => ({
      ...current,
      assignment_role: selected.value,
      owner_type: selected.ownerType,
      owner_value: selected.value,
      role_key: selected.value
    }));
  }

  function selectAssignmentMode(value: StepAssignmentMode) {
    setStepForm((current) => stepFormWithAssignmentMode(current, value));
  }

  function selectAssignmentTeamQueue(value: string) {
    setStepForm((current) => stepFormWithAssignmentMode({
      ...current,
      department: value,
      assignment_team_queue: value,
      owner_value: value
    }, current.assignment_mode));
  }

  function selectAssignmentAssignerRole(value: string) {
    setStepForm((current) => stepFormWithAssignmentMode({
      ...current,
      assignment_assigner_role: value,
      role_key: value
    }, current.assignment_mode));
  }

  function addDepartmentToDraft(value: string) {
    if (!value) {
      return;
    }
    setDraftForm((current) => ({
      ...current,
      departments_involved: current.departments_involved.includes(value)
        ? current.departments_involved
        : [...current.departments_involved, value]
    }));
  }

  function removeDepartmentFromDraft(value: string) {
    setDraftForm((current) => ({
      ...current,
      departments_involved: current.departments_involved.length > 1
        ? current.departments_involved.filter((department) => department !== value)
        : current.departments_involved
    }));
  }

  function renderAssignmentTargetFields() {
    if (stepForm.assignment_mode === "team_queue") {
      return (
        <label>
          Team queue
          <select value={stepForm.assignment_team_queue} onChange={(event) => selectAssignmentTeamQueue(event.target.value)}>
            {TEAM_QUEUE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      );
    }
    if (stepForm.assignment_mode === "needs_assignment") {
      return (
        <>
          <label>
            Team queue
            <select value={stepForm.assignment_team_queue} onChange={(event) => selectAssignmentTeamQueue(event.target.value)}>
              {TEAM_QUEUE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            Assigning lead
            <select value={stepForm.assignment_assigner_role} onChange={(event) => selectAssignmentAssignerRole(event.target.value)}>
              {ROLE_PLACEHOLDER_OPTIONS.filter((option) => option.value !== "unassigned").map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </>
      );
    }
    if (stepForm.assignment_mode === "inherit_job_owner" || stepForm.assignment_mode === "inherit_account_owner") {
      return (
        <div className="workflow-template-builder__assignment-readout">
          <span>Owner source</span>
          <strong>{stepForm.assignment_mode === "inherit_job_owner" ? "Job owner" : "Account / CSR owner"}</strong>
        </div>
      );
    }
    return (
      <label>
        Owner role
        <select value={stepForm.assignment_role} onChange={(event) => selectRolePlaceholder(event.target.value)}>
          {ROLE_PLACEHOLDER_OPTIONS.filter((option) => option.value !== "unassigned").map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    );
  }

  function renderInlineStepEditor(milestone: WorkflowTemplateBuilderMilestone) {
    if (!selectedDraft || activeStepEditor?.milestoneId !== milestone.id) {
      return null;
    }
    return (
      <form
        className="workflow-template-builder__inline-step-editor"
        onSubmit={(event) => void submitStep(event)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancelInlineStep();
          }
        }}
      >
        <div className="workflow-template-builder__inline-step-editor-heading">
          <div>
            <span className="eyebrow">
              {activeStepEditor.mode === "edit" ? "Editing step" : activeStepEditor.mode === "duplicate" ? "Duplicating step" : "New step"}
            </span>
            <strong>
              {activeStepEditor.mode === "edit"
                ? "Update the draft step in place."
                : activeStepEditor.mode === "duplicate"
                  ? "Rename this copy, then save it."
                  : "Add the next workflow step."}
            </strong>
          </div>
          <button type="button" className="secondary-button" onClick={cancelInlineStep}>
            Cancel
          </button>
        </div>
        <div className="workflow-template-builder__inline-step-fields">
          <label className="workflow-template-builder__inline-step-name">
            Step name
            <input
              ref={inlineStepNameRef}
              value={stepForm.name}
              onChange={(event) => {
                const name = event.target.value;
                setStepForm((current) => ({ ...current, name, step_key: current.step_key || templateKeyFromName(name) }));
              }}
            />
          </label>
          <label>
            Stage
            <select
              value={stepForm.milestone_template_id}
              onChange={(event) => {
                const nextMilestoneId = event.target.value;
                const nextMilestone = detail?.milestones.find((candidate) => candidate.id === nextMilestoneId);
                setStepForm((current) => ({ ...current, milestone_template_id: nextMilestoneId }));
                setActiveStepEditor((current) => current && nextMilestone ? {
                  ...current,
                  milestoneId: nextMilestoneId,
                  afterStepId: null,
                  sortOrder: stepSortOrderAfter(nextMilestone, null)
                } : current);
              }}
            >
              {detail?.milestones.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
              ))}
            </select>
          </label>
          <label>
            Assignment mode
            <select value={stepForm.assignment_mode} onChange={(event) => selectAssignmentMode(event.target.value as StepAssignmentMode)}>
              {ASSIGNMENT_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
              <option value="specific_person" disabled>Auto-assign to specific person (staff picker needed)</option>
            </select>
          </label>
          {renderAssignmentTargetFields()}
          <label>
            Due rule
            <select
              value={stepForm.expected_duration_minutes}
              onChange={(event) => setStepForm((current) => ({ ...current, expected_duration_minutes: Number(event.target.value) }))}
            >
              <option value={60}>1 hour</option>
              <option value={240}>4 hours</option>
              <option value={1440}>1 day</option>
              <option value={2880}>2 days</option>
              <option value={7200}>5 days</option>
            </select>
          </label>
          <label className="workflow-template-builder__inline-toggle">
            <input
              type="checkbox"
              checked={stepForm.required}
              onChange={(event) => setStepForm((current) => ({ ...current, required: event.target.checked }))}
            />
            Required
          </label>
          <label className="workflow-template-builder__inline-toggle">
            <input
              type="checkbox"
              checked={stepForm.blocking}
              onChange={(event) => setStepForm((current) => ({ ...current, blocking: event.target.checked }))}
            />
            Blocking
          </label>
        </div>
        {stepForm.assignment_mode === "needs_assignment" ? (
          <p className="workflow-template-builder__assignment-note">
            This keeps the step in the team queue until a lead assigns a real person on the live job. Live assignment queue automation still needs backend support.
          </p>
        ) : null}
        <details className="workflow-template-builder__advanced-step-options">
          <summary>More details</summary>
          <div className="workflow-template-builder__advanced-step-grid">
            <label>
              Step shortcut
              <input value={stepForm.step_key} onChange={(event) => setStepForm((current) => ({ ...current, step_key: event.target.value }))} />
            </label>
            <label>
              Department
              <select value={stepForm.department} onChange={(event) => setStepForm((current) => ({ ...current, department: event.target.value }))}>
                {DEPARTMENT_OPTIONS.map((option) => (
                  <option key={option} value={option}>{departmentLabel(option)}</option>
                ))}
              </select>
            </label>
            <label>
              What has to happen first
              <select
                value={stepForm.dependency_mode}
                onChange={(event) => setStepForm((current) => ({ ...current, dependency_mode: event.target.value as WorkflowTemplateBuilderDependencyMode }))}
              >
                {DEPENDENCY_MODE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{humanize(option)}</option>
                ))}
              </select>
            </label>
            <label>
              Steps that must finish first
              <input
                value={stepForm.depends_on_step_keys}
                placeholder="confirm_scope, photograph_job"
                onChange={(event) => setStepForm((current) => ({ ...current, depends_on_step_keys: event.target.value }))}
              />
            </label>
            <label className="workflow-template-builder__inline-toggle">
              <input
                type="checkbox"
                checked={stepForm.skippable}
                onChange={(event) => setStepForm((current) => ({ ...current, skippable: event.target.checked }))}
              />
              Can be skipped if not needed
            </label>
            <label className="workflow-template-builder__inline-step-description">
              Step notes
              <textarea value={stepForm.description} onChange={(event) => setStepForm((current) => ({ ...current, description: event.target.value }))} />
            </label>
          </div>
        </details>
        <div className="workflow-template-builder__inline-step-actions">
          <button className="button button-primary" type="submit" disabled={!stepForm.name.trim() || !stepForm.step_key.trim() || saving}>
            {activeStepEditor.mode === "edit" ? "Save changes" : "Save step"}
          </button>
          <button type="button" className="button button-secondary" onClick={cancelInlineStep}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  async function duplicateSelectedTemplate() {
    if (!detail) {
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const suffix = uniqueCopySuffix();
      const copyName = `${detail.template.name} Copy`;
      let copiedDetail = await createWorkflowTemplateBuilderDraft(token, {
        template_key: `${templateKeyFromName(detail.template.name)}_copy_${suffix}`,
        name: copyName,
        description: detail.template.description ?? "Editable copy created from an existing workflow template.",
        job_type: detail.template.job_type ?? "photo_day",
        category: detail.template.category ?? "schools",
        departments_involved: detail.version.departments_involved.length ? detail.version.departments_involved : ["schools", "production"]
      });

      const copiedMilestoneIds = new Map<string, string>();
      for (const milestone of detail.milestones) {
        copiedDetail = await addWorkflowTemplateBuilderMilestone(token, copiedDetail.version.id, {
          milestone_key: milestone.milestone_key,
          name: milestone.name,
          description: milestone.description,
          sort_order: milestone.sort_order,
          default_owner_type: milestone.default_owner_type,
          default_owner_value: milestone.default_owner_value
        });
        const copiedMilestone = copiedDetail.milestones.find((candidate) => candidate.milestone_key === milestone.milestone_key);
        if (copiedMilestone) {
          copiedMilestoneIds.set(milestone.milestone_key, copiedMilestone.id);
        }
      }

      for (const milestone of detail.milestones) {
        const copiedMilestoneId = copiedMilestoneIds.get(milestone.milestone_key);
        if (!copiedMilestoneId) {
          continue;
        }
        for (const step of milestone.steps) {
          copiedDetail = await addWorkflowTemplateBuilderStep(token, copiedDetail.version.id, {
            milestone_template_id: copiedMilestoneId,
            step_key: step.step_key,
            name: step.name,
            description: step.description,
            sort_order: step.sort_order,
            department: step.department,
            role_key: step.role_key,
            assigned_user_id: step.assigned_user_id,
            owner_type: step.owner_type ?? "department",
            owner_value: step.owner_value ?? step.department,
            required: step.required,
            skippable: step.skippable,
            blocking: step.blocking,
            expected_duration_minutes: step.expected_duration_minutes,
            due_offset_minutes: step.due_offset_minutes,
            dependency_mode: step.dependency_mode,
            blocked_behavior: step.blocked_behavior,
            checklist_template_id: step.checklist_template_id,
            depends_on_step_keys: step.depends_on_step_keys
          });
        }
      }

      setDetail(copiedDetail);
      setStepForm((current) => ({ ...current, milestone_template_id: copiedDetail.milestones[0]?.id ?? "" }));
      await refreshTemplateList();
      setNotice(`${copyName} is now an editable draft copy. The original template and active workflow instances were not changed.`);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Workflow template copy could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function publishDraft() {
    if (!selectedDraft) {
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const payload = await publishWorkflowTemplateBuilderVersion(token, selectedDraft.version.id);
      setDetail(payload);
      await refreshTemplateList();
      setNotice("Published. New jobs can use this version; existing workflow runs keep their original version.");
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Workflow template could not be published.");
    } finally {
      setSaving(false);
    }
  }

  async function archiveVersion() {
    if (!detail) {
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const payload = await archiveWorkflowTemplateBuilderVersion(token, detail.version.id);
      setDetail(payload);
      await refreshTemplateList();
      setNotice("Version archived. Historical workflow runs remain intact.");
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Workflow template version could not be archived.");
    } finally {
      setSaving(false);
    }
  }

  if (!featureFlags.workflowTemplateBuilderV1) {
    return (
      <main className="dashboard-page">
        <section className="panel">
          <div className="section-title">Workflow Template Builder</div>
          <p className="section-subtitle">This builder is feature-flagged off in this environment. Project Dashboard and live Job Workflows still work.</p>
        </section>
      </main>
    );
  }

  if (!canManage) {
    return (
      <main className="dashboard-page">
        <section className="panel">
          <div className="section-title">Workflow Template Builder</div>
          <p className="section-subtitle">Workflow game plans are managed by leadership. If a repeatable job path needs to change, ask a department lead to make a safe copy first.</p>
        </section>
      </main>
    );
  }

  return (
    <main className={`dashboard-page workflow-template-builder ${isExpanded ? "workflow-template-builder--expanded" : ""}`}>
      <section className="workflow-template-builder__topline">
        <div>
          <p className="eyebrow">Project Dashboard</p>
          <h1>Workflow Template Builder</h1>
          <p>
            Build a reusable workflow recipe: stages, steps, owners, timing, and safe copies for new jobs.
          </p>
        </div>
        <div className="hero-actions">
          <button className="button button-secondary" type="button" onClick={() => setIsExpanded((current) => !current)}>
            {isExpanded ? "Exit full-screen editor" : "Full-screen editor"}
          </button>
          <a className="button button-secondary" href="#project-tracking">
            Command Center
          </a>
          <a className="button button-secondary" href="#admin/checklists">
            Checklist Templates
          </a>
        </div>
      </section>

      <section className="workflow-template-builder__control-bar" aria-label="Template controls">
        <label className="workflow-template-builder__selector workflow-template-builder__selector--top">
          <span>Template</span>
          <select value={detail?.template.id ?? ""} disabled={loading || saving} onChange={(event) => void selectTemplate(event.target.value)}>
            <option value="">Select a template</option>
            {visibleTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} {template.latest_version ? `(v${template.latest_version.version_number} ${template.latest_version.status})` : ""}
              </option>
            ))}
          </select>
        </label>
        <button className="button button-secondary" type="button" disabled={!detail || saving} onClick={() => void duplicateSelectedTemplate()}>
          Duplicate template to edit
        </button>
        <div className="workflow-template-builder__copy-status">
          {detail ? (
            <StatusPill label={selectedDraft ? "Editing copy" : detail.version.status} tone={selectedDraft ? "info" : detail.version.status === "published" ? "success" : "neutral"} />
          ) : (
            <StatusPill label="Choose template" tone="neutral" />
          )}
          <div>
            <strong>{selectedDraft ? "Editing a copy" : detail ? "Original protected" : "Pick a recipe"}</strong>
            <span>Duplicate a template before editing. Active jobs stay on their current version.</span>
          </div>
        </div>
      </section>

      <details className="workflow-template-builder__template-browser">
        <summary>Browse templates</summary>
        <div className="workflow-template-builder__template-browser-content">
          {loading ? <p className="section-subtitle">Loading workflow templates...</p> : null}
          {!loading && !templates.length ? <p className="section-subtitle">No workflow templates yet. Start with a safe copy, then add the stages and steps.</p> : null}
          {!loading && hiddenTemplateCount > 0 ? (
            <p className="section-subtitle">
              Showing the clean demo templates first. {hiddenTemplateCount} older or test-generated template{hiddenTemplateCount === 1 ? "" : "s"} hidden from this walkthrough view.
            </p>
          ) : null}
          <div className="workflow-template-builder__template-list workflow-template-builder__template-list--compact">
            {visibleTemplates.map((template) => (
              <button
                className={`workflow-template-builder__template-card ${detail?.template.id === template.id ? "is-selected" : ""}`}
                type="button"
                key={template.id}
                onClick={() => void selectTemplate(template.id)}
              >
                <strong>{template.name}</strong>
                <span>{humanize(template.job_type)} - {templateCategoryLabel(template.category)}</span>
                <span>
                  {template.latest_version ? `v${template.latest_version.version_number} ${template.latest_version.status}` : "No version yet"}
                </span>
              </button>
            ))}
          </div>
        </div>
      </details>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {notice ? <div className="alert alert-success">{notice}</div> : null}

      <section className="workflow-template-builder__layout">
        <div className="workflow-template-builder__main">
          <section className="panel workflow-template-builder__steps-panel">
            <div className="workflow-template-builder__step-heading">
              <div>
                <span className="eyebrow">Step list</span>
                <div className="section-title">Recipe Preview</div>
                <p className="section-subtitle">Click Edit, + Add after, or Duplicate to open a small editable block right in the list.</p>
              </div>
              <div className="workflow-template-builder__step-heading-actions">
                {detail ? <span className="workflow-template-builder__step-count">{totalSteps} step{totalSteps === 1 ? "" : "s"}</span> : null}
                <button type="button" className="secondary-button" disabled={!selectedDraft} onClick={scrollToStageForm}>
                  + Add stage
                </button>
              </div>
            </div>
            {!detail ? <p className="section-subtitle">Create or open a draft to preview the workflow steps.</p> : null}
            {detail ? (
              <div className="workflow-template-builder__preview">
                <div className="workflow-template-builder__version-strip">
                  <strong>{detail.template.name}</strong>
                  <span>
                    v{detail.version.version_number} - {detail.version.status}
                    {selectedDraft ? " - draft controls enabled" : " - duplicate before editing"}
                  </span>
                </div>
                {detail.milestones.map((milestone) => (
                  <article className="workflow-template-builder__milestone-block" key={milestone.id}>
                    <div className="workflow-template-builder__milestone-header">
                      <div>
                        <div className="eyebrow">Stage {milestone.sort_order}</div>
                        <h3>{milestone.name}</h3>
                        {milestone.description ? <p>{milestone.description}</p> : null}
                      </div>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={!selectedDraft}
                        onClick={() => prepareStepAfter(milestone, milestone.steps[milestone.steps.length - 1] ?? null)}
                      >
                        + Add step
                      </button>
                    </div>
                    <div className="workflow-template-builder__step-list">
                      {activeStepEditor?.milestoneId === milestone.id && activeStepEditor.afterStepId === null ? renderInlineStepEditor(milestone) : null}
                      {milestone.steps.length ? milestone.steps.map((step, stepIndex) => {
                        const assignmentSummary = assignmentSummaryForStep(step);
                        const isFirstStep = stepIndex === 0;
                        const isLastStep = stepIndex === milestone.steps.length - 1;
                        const protectedTitle = selectedDraft ? undefined : "Duplicate this template before editing, moving, or removing steps.";
                        return (
                          <div className="workflow-template-builder__step-stack" key={step.id}>
                            <div className="workflow-template-builder__preview-step-row">
                              <div className="workflow-template-builder__step-order">{milestone.sort_order}.{step.sort_order}</div>
                              <div className="workflow-template-builder__step-name">
                                <strong title={step.name}>{step.name}</strong>
                                <span>{milestone.name}</span>
                              </div>
                              <div className="workflow-template-builder__step-owner">
                                <span>{assignmentSummary.label}</span>
                                <span>{assignmentSummary.detail}</span>
                              </div>
                              <div className="workflow-template-builder__step-badges">
                                <span>{formatStepTime(step.expected_duration_minutes)}</span>
                                <span>{step.required ? "Required" : "Optional"}</span>
                                <span>{step.blocking ? "Blocking" : "Non-blocking"}</span>
                                {step.skippable ? <span>Can skip</span> : null}
                              </div>
                              <div className="workflow-template-builder__inline-actions">
                                <button type="button" className="secondary-button" disabled={!selectedDraft} title={protectedTitle} onClick={() => prepareEditStep(milestone, step)}>
                                  Edit
                                </button>
                                <button type="button" className="secondary-button" disabled={!selectedDraft} title={protectedTitle} onClick={() => prepareDuplicateStep(milestone, step)}>
                                  Duplicate
                                </button>
                                <button type="button" className="secondary-button" disabled={!selectedDraft} title={protectedTitle} onClick={() => prepareStepAfter(milestone, step)}>
                                  + Add after
                                </button>
                                <button
                                  type="button"
                                  className="secondary-button"
                                  disabled={!selectedDraft || isFirstStep || saving}
                                  title={protectedTitle ?? (isFirstStep ? "First step cannot move up." : "Move step up")}
                                  onClick={() => void moveStep(step, "up")}
                                >
                                  Move up
                                </button>
                                <button
                                  type="button"
                                  className="secondary-button"
                                  disabled={!selectedDraft || isLastStep || saving}
                                  title={protectedTitle ?? (isLastStep ? "Last step cannot move down." : "Move step down")}
                                  onClick={() => void moveStep(step, "down")}
                                >
                                  Move down
                                </button>
                                <button
                                  type="button"
                                  className="danger-button"
                                  disabled={!selectedDraft || totalSteps <= 1 || saving}
                                  title={protectedTitle ?? (totalSteps <= 1 ? "Workflow templates need at least one controlled step." : "Remove step from draft")}
                                  onClick={() => void removeStep(step)}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                            {activeStepEditor?.milestoneId === milestone.id && activeStepEditor.afterStepId === step.id ? renderInlineStepEditor(milestone) : null}
                          </div>
                        );
                      }) : (
                        <div className="workflow-template-builder__empty-step-list">
                          {activeStepEditor?.milestoneId === milestone.id && activeStepEditor.afterStepId === null ? null : <p className="section-subtitle">No steps yet.</p>}
                          <button type="button" className="secondary-button" disabled={!selectedDraft} onClick={() => prepareStepAfter(milestone, null)}>
                            + Add first step
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </section>

          <section className="panel workflow-template-builder__editor-panel">
            <div className="workflow-template-builder__step-heading">
              <div>
                <span className="eyebrow">Template setup</span>
                <div className="section-title">New Recipe Details</div>
                <p className="section-subtitle">Keep this short. The real work happens in the step list above.</p>
              </div>
            </div>
            <form className="dashboard-form-grid workflow-template-builder__form-grid" onSubmit={(event) => void submitDraft(event)}>
              <label>
                Template name
                <input
                  value={draftForm.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    setDraftForm((current) => ({ ...current, name, template_key: templateCodeFromName(name, current.template_key) }));
                  }}
                />
              </label>
              <label>
                Team / category
                <select value={draftForm.category} onChange={(event) => setDraftForm((current) => ({ ...current, category: event.target.value }))}>
                  {TEMPLATE_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <div className="workflow-template-builder__departments-field">
                Teams involved
                <div className="workflow-template-builder__department-chips" aria-label="Selected departments">
                  {draftForm.departments_involved.map((department) => (
                    <span className="workflow-template-builder__department-chip" key={department}>
                      {departmentLabel(department)}
                      <button
                        type="button"
                        aria-label={`Remove ${departmentLabel(department)}`}
                        disabled={draftForm.departments_involved.length <= 1}
                        onClick={() => removeDepartmentFromDraft(department)}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
                <select aria-label="Add department" value="" onChange={(event) => addDepartmentToDraft(event.target.value)}>
                  <option value="">+ Add department</option>
                  {WORK_DEPARTMENT_OPTIONS.filter((option) => !draftForm.departments_involved.includes(option.value)).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <label className="workflow-template-builder__wide">
                Description
                <textarea value={draftForm.description} onChange={(event) => setDraftForm((current) => ({ ...current, description: event.target.value }))} />
              </label>
              <details className="workflow-template-builder__advanced-details workflow-template-builder__wide">
                <summary>Advanced details</summary>
                <div className="workflow-template-builder__advanced-details-grid">
                  <label>
                    Template code
                    <input value={draftForm.template_key} onChange={(event) => setDraftForm((current) => ({ ...current, template_key: event.target.value }))} />
                    <span className="workflow-template-builder__field-help">Internal app code. It auto-fills from the template name.</span>
                  </label>
                  <label>
                    Job type
                    <select value={draftForm.job_type} onChange={(event) => setDraftForm((current) => ({ ...current, job_type: event.target.value }))}>
                      {JOB_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </details>
              <button className="button button-primary" type="submit" disabled={saving}>
                Start new template
              </button>
            </form>
          </section>

          <section className="panel workflow-template-builder__editor-panel">
            <span className="eyebrow">Step 2</span>
            <div className="section-title">Big Stages</div>
            <p className="section-subtitle">Stages are the big handoff zones, like Intake, Picture Day, Production, QA, Release, and Wrap-up.</p>
            <form className="dashboard-form-grid workflow-template-builder__form-grid" onSubmit={(event) => void submitMilestone(event)}>
              <label>
                Stage name
                <input ref={stageNameRef} value={milestoneForm.name} disabled={!selectedDraft} onChange={(event) => setMilestoneForm((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <label>
                Stage shortcut
                <input value={milestoneForm.milestone_key} disabled={!selectedDraft} onChange={(event) => setMilestoneForm((current) => ({ ...current, milestone_key: event.target.value }))} />
              </label>
              <label>
                Usual owner type
                <select
                  value={milestoneForm.default_owner_type}
                  disabled={!selectedDraft}
                  onChange={(event) => setMilestoneForm((current) => ({ ...current, default_owner_type: event.target.value as WorkflowTemplateBuilderOwnerType }))}
                >
                  {OWNER_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{humanize(option)}</option>
                  ))}
                </select>
              </label>
              <label>
                Usual owner
                <input
                  value={milestoneForm.default_owner_value}
                  disabled={!selectedDraft}
                  onChange={(event) => setMilestoneForm((current) => ({ ...current, default_owner_value: event.target.value }))}
                />
              </label>
              <label className="workflow-template-builder__wide">
                Description
                <textarea value={milestoneForm.description} disabled={!selectedDraft} onChange={(event) => setMilestoneForm((current) => ({ ...current, description: event.target.value }))} />
              </label>
              <button className="button button-primary" type="submit" disabled={!selectedDraft || saving}>
                Add stage
              </button>
            </form>
          </section>

          <section className="panel workflow-template-builder__publish-panel">
            <span className="eyebrow">Final step</span>
            <div className="section-title">Make Available</div>
            <p className="section-subtitle">When this looks right, make it available for new jobs. Existing jobs stay on the version they started with.</p>
            <div className="hero-actions">
              <button className="button button-primary" type="button" disabled={!selectedDraft || !detail?.milestones.length || totalSteps < 1 || saving} onClick={() => void publishDraft()}>
                Make available
              </button>
              <button className="button button-secondary" type="button" disabled={!detail || detail.version.status === "archived" || saving} onClick={() => void archiveVersion()}>
                Retire version
              </button>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
