import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { DetailPreviewPanel, SavedViewBar, StatusPill, formatDate, formatDateTime, humanizeToken, statusTone, useHashRouteSnapshot } from "../sports/SportsPrimitives";
import { WorkspaceActionBar } from "../workspace/WorkspaceActionBar";
import { CompactActiveWorkPanel } from "../workspace/CompactActiveWorkPanel";
import { WorkspaceEmptyState } from "../workspace/WorkspaceEmptyState";
import { WorkspaceFilterToolbar } from "../workspace/WorkspaceFilterToolbar";
import { WorkspaceLoadingBlock } from "../workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../workspace/WorkspacePageHeader";
import { WorkspaceSectionHeader } from "../workspace/WorkspaceSectionHeader";
import { ChecklistRuntimePanel } from "../checklists/ChecklistRuntimePanel";
import { ChecklistTransitionBlockModal } from "../checklists/ChecklistTransitionBlockModal";
import { ChecklistStatusSummary, buildChecklistRecordSummary } from "../checklists/ChecklistStatusSummary";
import {
  OperationalApprovalRequestPanel,
  PRODUCTION_OPERATIONAL_APPROVAL_OPTIONS
} from "../OperationalApprovalRequestPanel";
import { RecordResourcesPanel } from "../RecordResourcesPanel";
import { SharedStaffPicker } from "./SharedJobPickers";
import { DepartmentProductionReportingStrip, ProductionBoardReportingPanel } from "./ProductionBoardReportingPanels";
import { getDepartmentJobAdapterUI, getDepartmentJobDownstreamConfig } from "./DepartmentJobAdapterUIRegistry";
import { getSharedProductionReporting, listSharedProductionQueue, getSharedJobDetail } from "../../services/jobsApi";
import { ApiClientError } from "../../api";
import { hasAuthorityTier, hasPermission, canAccessGraphicsWorkspace, canManageOperatingSystemModule, canManageSchoolsHub, canManageSportsWorkspace } from "../../permissions";
import type { ChecklistInstanceDetail, ChecklistTransitionValidation } from "../../checklistTypes";
import { validateChecklistTransition } from "../../services/checklistApi";
import type {
  ProductionBoardHealthState,
  ProductionBoardReleaseStatus,
  ProductionBoardSyncState,
  ProductionBoardUploadStatus,
  ProductionBoardWorkflowStatus,
  SharedApprovalRequest,
  SharedApprovalRequestInput,
  SharedDeliverableItem,
  SharedDeliverableItemInput,
  SharedJobDetailResponse,
  SharedProductionHandoff,
  SharedProductionHandoffInput,
  SharedProductionIssue,
  SharedProductionIssueInput,
  SharedProductionItem,
  SharedProductionItemInput,
  SharedProductionItemShootLink,
  SharedProductionQueueQuery,
  SharedProductionQueueItem,
  SharedProductionQueueResponse,
  SharedProductionReportingQuery,
  SharedProductionReportingResponse,
  SharedQaFinding,
  SharedQaFindingInput,
  SharedQaReview,
  SharedQaReviewInput
} from "../../jobTruthTypes";
import type { DirectoryOwnerOption, SessionUser } from "../../types";
import { listDirectoryOwnerOptions } from "../../services/organizationApi";

type QueueDepartment = "schools" | "sports" | null;

type ProductionMutationHandlers = {
  onSaveProductionItem: (input: SharedProductionItemInput, productionItemId?: string) => Promise<void>;
  onSaveHandoff: (productionItemId: string, input: SharedProductionHandoffInput, handoffId?: string) => Promise<void>;
  onSaveApproval: (productionItemId: string, input: SharedApprovalRequestInput, approvalId?: string) => Promise<void>;
  onSaveQaReview: (productionItemId: string, input: SharedQaReviewInput, qaReviewId?: string) => Promise<void>;
  onSaveQaFinding: (productionItemId: string, qaReviewId: string, input: SharedQaFindingInput, findingId?: string) => Promise<void>;
  onSaveDeliverable: (productionItemId: string, input: SharedDeliverableItemInput, deliverableId?: string) => Promise<void>;
  onSaveIssue: (productionItemId: string, input: SharedProductionIssueInput, issueId?: string) => Promise<void>;
};

export type SharedDetailDownstreamProps = ProductionMutationHandlers & {
  detail: SharedJobDetailResponse;
  currentUser: SessionUser;
  canManage: boolean;
  canViewFinance: boolean;
  staffOptions: DirectoryOwnerOption[];
};

type SharedProductionPageProps = {
  token: string;
  currentUser: SessionUser;
  departmentType: QueueDepartment;
  routeBase: string;
  title: string;
  summary: string;
};

type DepartmentProductionOverviewPanelProps = {
  token: string;
  departmentType: Exclude<QueueDepartment, null>;
  title: string;
  summary: string;
  routeHash: string;
};

type ProductionQueueBoardProps = {
  token: string;
  currentUser: SessionUser;
  departmentType: QueueDepartment;
  routeBase: string;
  title: string;
  summary: string;
  ownerOptions: DirectoryOwnerOption[];
  payload: SharedProductionQueueResponse | null;
  reporting: SharedProductionReportingResponse | null;
  loading: boolean;
  reportingLoading: boolean;
  queueError: string;
  reportingError: string;
  onReload: () => Promise<void>;
  onUpdateProductionItem: (item: SharedProductionQueueItem, input: SharedProductionItemInput) => Promise<void>;
};

type ProductionItemCardProps = {
  token: string;
  item: SharedProductionItem;
  approvals: SharedApprovalRequest[];
  reviews: SharedQaReview[];
  findings: SharedQaFinding[];
  deliverables: SharedDeliverableItem[];
  issues: SharedProductionIssue[];
  handoffs: SharedProductionHandoff[];
  canManage: boolean;
  staffOptions: DirectoryOwnerOption[];
  onSaveProductionItem: SharedDetailDownstreamProps["onSaveProductionItem"];
  onSaveHandoff: SharedDetailDownstreamProps["onSaveHandoff"];
};

type SharedJobProductionPanelProps = SharedDetailDownstreamProps & {
  token: string;
};

type ProductionSavedViewKey =
  | "all_open"
  | "my_work"
  | "due_today"
  | "overdue"
  | "blocked"
  | "ready_for_qa"
  | "ready_for_release"
  | "schools"
  | "sports"
  | "specialty"
  | "vendor_work"
  | "closed_last_7_days";

type ProductionBoardFilterState = {
  department: JobDepartmentValue;
  ownerUserId: string;
  assignedToMe: boolean;
  workflowStatus: ProductionBoardWorkflowStatus | "";
  healthState: ProductionBoardHealthState | "";
  dueWindow: ProductionDueWindow;
  checklistState: "" | "overdue" | "awaiting_approval" | "rejected" | "blocked";
  deliverableType: string;
  organizationId: string;
  blockerState: "all" | "blocked" | "clear";
  releaseState: ProductionBoardReleaseStatus | "";
  priority: SharedProductionQueueItem["priority"] | "";
  search: string;
};

type JobDepartmentValue = Exclude<QueueDepartment, null> | "all" | "corporate" | "headshots" | "other";
type ProductionDueWindow = "all" | "today" | "overdue" | "next_3" | "next_7" | "closed_last_7_days";

type QaGateKey = "intake_qc" | "creator_review" | "peer_review" | "final_release_review";

type QaQuestionKey =
  | "files_complete_storage"
  | "color_density_consistency"
  | "sorting_and_roster_accuracy"
  | "template_price_release_accuracy"
  | "next_stage_decision";

type QaQuestionAnswerValue = boolean | string | null;

type QaGateConfig = {
  key: QaGateKey;
  label: string;
  summary: string;
  reviewType: string;
  minSamplePercent: number;
  reviewTypeLabel: string;
};

type QaQuestionConfig = {
  key: QaQuestionKey;
  label: string;
};

const QA_GATE_CONFIGS: QaGateConfig[] = [
  {
    key: "intake_qc",
    label: "Gate 1: Intake QC",
    summary: "100 percent structural check across files, folders, naming, handoff, and required roster or data inputs.",
    reviewType: "intake_qc",
    minSamplePercent: 100,
    reviewTypeLabel: "Intake QC"
  },
  {
    key: "creator_review",
    label: "Gate 2: Creator Review",
    summary: "Creator confirms the work is production-ready and completes the required visual sample review.",
    reviewType: "creator_review",
    minSamplePercent: 30,
    reviewTypeLabel: "Creator Review"
  },
  {
    key: "peer_review",
    label: "Gate 3: Peer Review",
    summary: "Independent reviewer clears the work for upload or sends it back with accountable issue notes.",
    reviewType: "peer_review",
    minSamplePercent: 10,
    reviewTypeLabel: "Peer Review"
  },
  {
    key: "final_release_review",
    label: "Gate 4: Post-Upload Final Review",
    summary: "Final release check confirms placement, sorting, templates, pricing, gallery logic, and release settings.",
    reviewType: "final_release_review",
    minSamplePercent: 5,
    reviewTypeLabel: "Final Review"
  }
];

const QA_QUESTION_CONFIGS: QaQuestionConfig[] = [
  {
    key: "files_complete_storage",
    label: "1. Are files complete, correctly named, and stored correctly?"
  },
  {
    key: "color_density_consistency",
    label: "2. Do color, density, and brightness look correct and consistent?"
  },
  {
    key: "sorting_and_roster_accuracy",
    label: "3. Are sorting, category placement, and roster links correct?"
  },
  {
    key: "template_price_release_accuracy",
    label: "4. Are templates, price sheets, vendor outputs, and release settings correct?"
  },
  {
    key: "next_stage_decision",
    label: "5. Approve for next stage, or send back for rework?"
  }
];

const QA_ISSUE_CATEGORY_OPTIONS = [
  { value: "files", label: "Files / Intake" },
  { value: "color_density", label: "Color / Density" },
  { value: "sorting_roster", label: "Sorting / Roster Links" },
  { value: "templates_release", label: "Templates / Release Settings" },
  { value: "vendor_output", label: "Vendor Output" },
  { value: "gallery_logic", label: "Gallery Category Logic" },
  { value: "other", label: "Other" }
];

type QaReviewDraftState = {
  reviewerUserId: string;
  checklistTemplateKey: string;
  sampleSizePercent: string;
  notes: string;
  decisionReason: string;
  issueCategory: string;
  overrideSameReviewer: boolean;
  overrideReason: string;
  answers: Record<QaQuestionKey, QaQuestionAnswerValue>;
};

const QA_PASS_STATUSES = new Set(["passed", "passed_with_notes", "complete"]);
const QA_FAIL_STATUSES = new Set(["failed", "rework_in_progress", "recheck_required"]);
const QA_TERMINAL_STATUSES = new Set(["passed", "passed_with_notes", "complete", "failed", "rework_in_progress", "recheck_required"]);

function isQaGateKey(value: string | null | undefined): value is QaGateKey {
  return QA_GATE_CONFIGS.some((gate) => gate.key === value);
}

function getQaGateConfig(gateKey: QaGateKey) {
  return QA_GATE_CONFIGS.find((gate) => gate.key === gateKey) ?? QA_GATE_CONFIGS[0];
}

function normalizeQaBooleanAnswer(value: unknown): boolean | null {
  if (value === true || value === "true" || value === "yes") {
    return true;
  }
  if (value === false || value === "false" || value === "no") {
    return false;
  }
  return null;
}

function normalizeQaDecisionAnswer(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildQaAnswers(review?: SharedQaReview | null): Record<QaQuestionKey, QaQuestionAnswerValue> {
  const source = (review?.question_answers_json ?? {}) as Record<string, unknown>;
  return {
    files_complete_storage: normalizeQaBooleanAnswer(source.files_complete_storage),
    color_density_consistency: normalizeQaBooleanAnswer(source.color_density_consistency),
    sorting_and_roster_accuracy: normalizeQaBooleanAnswer(source.sorting_and_roster_accuracy),
    template_price_release_accuracy: normalizeQaBooleanAnswer(source.template_price_release_accuracy),
    next_stage_decision: normalizeQaDecisionAnswer(source.next_stage_decision)
  };
}

function sortQaReviews(reviews: SharedQaReview[]) {
  return [...reviews].sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime());
}

function getQaReviewsForGate(reviews: SharedQaReview[], productionItemId: string, gateKey: QaGateKey) {
  return sortQaReviews(reviews.filter((review) => review.production_item_id === productionItemId && review.review_stage === gateKey));
}

function isQaReviewPassed(review: SharedQaReview | null | undefined) {
  return Boolean(review && QA_PASS_STATUSES.has(review.status));
}

function isQaReviewFailed(review: SharedQaReview | null | undefined) {
  return Boolean(review && QA_FAIL_STATUSES.has(review.status));
}

function isQaReviewTerminal(review: SharedQaReview | null | undefined) {
  return Boolean(review && QA_TERMINAL_STATUSES.has(review.status));
}

function getQaRequiredSamplePercent(detail: SharedJobDetailResponse, item: SharedProductionItem, gateKey: QaGateKey) {
  const sizeSignals = [detail.job.actual_subject_count, detail.job.estimated_subject_count, item.file_count_expected, item.file_count_received].filter(
    (value): value is number => typeof value === "number"
  );
  const largestSignal = sizeSignals.length ? Math.max(...sizeSignals) : 0;
  const largeJob = largestSignal >= 100;
  if (gateKey === "intake_qc") {
    return 100;
  }
  if (gateKey === "creator_review") {
    return largeJob ? 30 : 10;
  }
  if (gateKey === "peer_review") {
    return 10;
  }
  return 5;
}

function getQaGateCompleted(item: SharedProductionItem, gateKey: QaGateKey, latestReview: SharedQaReview | null) {
  if (gateKey === "intake_qc") {
    return (
      isQaReviewPassed(latestReview) ||
      [
        "READY_FOR_PRODUCTION",
        "IN_PRODUCTION",
        "READY_FOR_QA",
        "IN_PEER_REVIEW",
        "REWORK_REQUIRED",
        "READY_FOR_UPLOAD",
        "UPLOADING",
        "UPLOADED",
        "READY_FOR_RELEASE",
        "RELEASED",
        "SENT_TO_VENDOR",
        "DELIVERED_CLOSED"
      ].includes(item.workflow_status)
    );
  }
  if (gateKey === "creator_review") {
    return item.creator_review_complete || isQaReviewPassed(latestReview);
  }
  if (gateKey === "peer_review") {
    return item.peer_review_complete || isQaReviewPassed(latestReview);
  }
  return item.final_release_review_complete || isQaReviewPassed(latestReview);
}

function getQaGateStatusLabel(item: SharedProductionItem, gateKey: QaGateKey, latestReview: SharedQaReview | null) {
  if (getQaGateCompleted(item, gateKey, latestReview)) {
    return "Complete";
  }
  if (isQaReviewFailed(latestReview)) {
    return "Rework Required";
  }
  if (latestReview?.status === "in_review") {
    return "In Review";
  }
  if (latestReview?.status === "queued") {
    return "Queued";
  }
  return "Pending";
}

function getQaGateStatusTone(item: SharedProductionItem, gateKey: QaGateKey, latestReview: SharedQaReview | null) {
  if (getQaGateCompleted(item, gateKey, latestReview)) {
    return "success" as const;
  }
  if (isQaReviewFailed(latestReview)) {
    return "danger" as const;
  }
  if (latestReview?.status === "queued" || latestReview?.status === "in_review") {
    return "warning" as const;
  }
  return "neutral" as const;
}

function getQaGateReviewerLabel(item: SharedProductionItem, gateKey: QaGateKey, review: SharedQaReview | null) {
  if (review?.reviewer_name) {
    return review.reviewer_name;
  }
  if (gateKey === "peer_review") {
    return item.assigned_peer_reviewer_name ?? "Reviewer pending";
  }
  if (gateKey === "final_release_review") {
    return item.assigned_release_reviewer_name ?? "Reviewer pending";
  }
  return item.assigned_to_name ?? "Reviewer pending";
}

function getQaDefaultReviewerId(item: SharedProductionItem, gateKey: QaGateKey, review: SharedQaReview | null, staffOptions: DirectoryOwnerOption[]) {
  if (review?.reviewer_user_id) {
    return review.reviewer_user_id;
  }
  if (gateKey === "peer_review") {
    return item.assigned_peer_reviewer_user_id ?? item.assigned_to_user_id ?? staffOptions[0]?.user_id ?? "";
  }
  if (gateKey === "final_release_review") {
    return item.assigned_release_reviewer_user_id ?? item.assigned_peer_reviewer_user_id ?? item.assigned_to_user_id ?? staffOptions[0]?.user_id ?? "";
  }
  return item.assigned_to_user_id ?? staffOptions[0]?.user_id ?? "";
}

function buildQaDraftState(
  detail: SharedJobDetailResponse,
  item: SharedProductionItem,
  gateKey: QaGateKey,
  review: SharedQaReview | null,
  qaTemplates: Array<{ value: string; label: string }>,
  staffOptions: DirectoryOwnerOption[]
): QaReviewDraftState {
  const answers = buildQaAnswers(review);
  return {
    reviewerUserId: getQaDefaultReviewerId(item, gateKey, review, staffOptions),
    checklistTemplateKey: review?.checklist_template_key ?? qaTemplates[0]?.value ?? "",
    sampleSizePercent: review?.sample_size_percent != null ? String(review.sample_size_percent) : String(getQaRequiredSamplePercent(detail, item, gateKey)),
    notes: review?.notes ?? "",
    decisionReason: review?.decision_reason ?? "",
    issueCategory: review?.issue_category ?? "",
    overrideSameReviewer: review?.override_same_reviewer ?? false,
    overrideReason: review?.override_reason ?? "",
    answers
  };
}

function buildQaHistoryLabel(review: SharedQaReview) {
  const gateKey = isQaGateKey(review.review_stage) ? review.review_stage : null;
  return gateKey ? getQaGateConfig(gateKey).label : humanizeToken(review.review_stage);
}

type ProductionSavedViewDefinition = {
  key: ProductionSavedViewKey;
  label: string;
  description: string;
  filters: Partial<ProductionBoardFilterState>;
};

type ProductionRouteState = Partial<ProductionBoardFilterState> & {
  savedView?: ProductionSavedViewKey | null;
  item?: string | null;
};

const DEFAULT_PRODUCTION_FILTERS: ProductionBoardFilterState = {
  department: "all",
  ownerUserId: "",
  assignedToMe: false,
  workflowStatus: "",
  healthState: "",
  dueWindow: "all",
  checklistState: "",
  deliverableType: "",
  organizationId: "",
  blockerState: "all",
  releaseState: "",
  priority: "",
  search: ""
};

const PRODUCTION_ROUTE_FILTER_PARAMS = {
  department: "department",
  ownerUserId: "owner",
  assignedToMe: "assigned_to_me",
  workflowStatus: "workflow_status",
  healthState: "health_state",
  dueWindow: "due_window",
  checklistState: "checklist_state",
  deliverableType: "deliverable_type",
  organizationId: "organization_id",
  blockerState: "blocker_state",
  releaseState: "release_state",
  priority: "priority",
  search: "search"
} as const satisfies Record<keyof ProductionBoardFilterState, string>;

const PRODUCTION_ROUTE_FILTER_ENTRIES = Object.entries(PRODUCTION_ROUTE_FILTER_PARAMS) as Array<
  [keyof ProductionBoardFilterState, (typeof PRODUCTION_ROUTE_FILTER_PARAMS)[keyof typeof PRODUCTION_ROUTE_FILTER_PARAMS]]
>;

const PRODUCTION_SAVED_VIEWS: ProductionSavedViewDefinition[] = [
  { key: "all_open", label: "All Open", description: "Everything still moving through downstream work.", filters: {} },
  { key: "my_work", label: "My Work", description: "Items assigned to me.", filters: { assignedToMe: true } },
  { key: "due_today", label: "Due Today", description: "Items due today.", filters: { dueWindow: "today" } },
  { key: "overdue", label: "Overdue", description: "Items already past due.", filters: { dueWindow: "overdue", healthState: "OVERDUE" } },
  { key: "blocked", label: "Blocked", description: "Items with blockers or blocked health.", filters: { blockerState: "blocked" } },
  { key: "ready_for_qa", label: "Ready for QA", description: "Work waiting on peer review.", filters: { workflowStatus: "READY_FOR_QA" } },
  { key: "ready_for_release", label: "Ready for Release", description: "Work waiting on final release.", filters: { workflowStatus: "READY_FOR_RELEASE" } },
  { key: "schools", label: "Schools", description: "Schools-only production work.", filters: { department: "schools" } },
  { key: "sports", label: "Sports", description: "Sports-only production work.", filters: { department: "sports" } },
  { key: "specialty", label: "Specialty", description: "Specialty and print-oriented work.", filters: { deliverableType: "specialty" } },
  { key: "vendor_work", label: "Vendor Work", description: "Items going to a vendor or waiting on vendor handoff.", filters: { releaseState: "SENT_TO_VENDOR" } },
  { key: "closed_last_7_days", label: "Closed Last 7 Days", description: "Recently closed work for follow-through checks.", filters: { dueWindow: "closed_last_7_days" } }
] as const;

function toRouteBase(departmentType: QueueDepartment) {
  if (departmentType === "schools") {
    return "#schools/jobs";
  }
  if (departmentType === "sports") {
    return "#sports/jobs";
  }
  return "#jobs";
}

function canManageQueueDepartment(currentUser: SessionUser, departmentType: QueueDepartment) {
  if (departmentType === "schools") {
    return canManageSchoolsHub(currentUser) || canManageOperatingSystemModule(currentUser, "graphics");
  }
  if (departmentType === "sports") {
    return canManageSportsWorkspace(currentUser) || canManageOperatingSystemModule(currentUser, "graphics");
  }
  return canManageOperatingSystemModule(currentUser, "graphics");
}

function getQueueDepartmentLabel(departmentType: QueueDepartment) {
  if (departmentType === "schools") {
    return "Schools";
  }
  if (departmentType === "sports") {
    return "Sports";
  }
  return "Production";
}

function savedViewStorageKey(departmentType: QueueDepartment) {
  return `pmc-production-board-default-view-${departmentType ?? "all"}`;
}

function isProductionSavedViewKey(value: string | null): value is ProductionSavedViewKey {
  return PRODUCTION_SAVED_VIEWS.some((view) => view.key === value);
}

function hasExplicitProductionFilters(params: URLSearchParams) {
  return Object.values(PRODUCTION_ROUTE_FILTER_PARAMS).some((key) => params.has(key));
}

function readActiveSavedViewKey(params: URLSearchParams, departmentType: QueueDepartment): ProductionSavedViewKey | null {
  const queryValue = params.get("saved_view");
  if (isProductionSavedViewKey(queryValue)) {
    return queryValue;
  }
  if (hasExplicitProductionFilters(params)) {
    return null;
  }
  const stored = window.localStorage.getItem(savedViewStorageKey(departmentType));
  return isProductionSavedViewKey(stored) ? stored : "all_open";
}

function readProductionFilters(params: URLSearchParams, departmentType: QueueDepartment, currentUserId: string): ProductionBoardFilterState {
  const savedViewKey = readActiveSavedViewKey(params, departmentType) ?? "all_open";
  const preset = PRODUCTION_SAVED_VIEWS.find((view) => view.key === savedViewKey);
  const directFilters: Partial<ProductionBoardFilterState> = {};
  for (const [stateKey, paramKey] of PRODUCTION_ROUTE_FILTER_ENTRIES) {
    if (!params.has(paramKey)) {
      continue;
    }
    const value = params.get(paramKey);
    switch (stateKey) {
      case "department":
        directFilters.department = (value as JobDepartmentValue | null) ?? "all";
        break;
      case "assignedToMe":
        directFilters.assignedToMe = value === "yes";
        break;
      case "workflowStatus":
        directFilters.workflowStatus = (value as ProductionBoardWorkflowStatus | null) ?? "";
        break;
      case "healthState":
        directFilters.healthState = (value as ProductionBoardHealthState | null) ?? "";
        break;
      case "dueWindow":
        directFilters.dueWindow = (value as ProductionDueWindow | null) ?? "all";
        break;
      case "checklistState":
        directFilters.checklistState = (value as ProductionBoardFilterState["checklistState"] | null) ?? "";
        break;
      case "blockerState":
        directFilters.blockerState = (value as ProductionBoardFilterState["blockerState"] | null) ?? "all";
        break;
      case "releaseState":
        directFilters.releaseState = (value as ProductionBoardReleaseStatus | null) ?? "";
        break;
      case "priority":
        directFilters.priority = (value as SharedProductionQueueItem["priority"] | null) ?? "";
        break;
      default:
        directFilters[stateKey] = value ?? "";
        break;
    }
  }
  const merged = {
    ...DEFAULT_PRODUCTION_FILTERS,
    ...preset?.filters,
    ...directFilters
  };
  if (savedViewKey === "my_work" && directFilters.assignedToMe == null) {
    merged.assignedToMe = true;
  }
  if (merged.assignedToMe) {
    merged.ownerUserId = currentUserId;
  }
  if (!merged.department) {
    merged.department = departmentType ?? "all";
  }
  if (departmentType) {
    merged.department = departmentType;
  }
  return merged;
}

function writeProductionRouteState(
  path: string,
  currentParams: URLSearchParams,
  updates: ProductionRouteState
) {
  const params = new URLSearchParams(currentParams.toString());
  for (const [stateKey, paramKey] of PRODUCTION_ROUTE_FILTER_ENTRIES) {
    const rawValue = updates[stateKey];
    if (typeof rawValue === "boolean") {
      if (!rawValue) {
        params.delete(paramKey);
        continue;
      }
      params.set(paramKey, "yes");
      continue;
    }
    const value = rawValue as string | null | undefined;
    if (!value || value === "all" || value === "") {
      params.delete(paramKey);
      continue;
    }
    params.set(paramKey, value);
  }
  for (const [key, value] of [
    ["saved_view", updates.savedView ?? null],
    ["item", updates.item ?? null]
  ] as const) {
    if (!value || value === "") {
      params.delete(key);
      continue;
    }
    params.set(key, value);
  }
  const query = params.toString();
  window.location.hash = query ? `#${path}?${query}` : `#${path}`;
}

function normalizeState(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function localDateKey(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
}

function matchesStateValue(left: string | null | undefined, right: string | null | undefined) {
  return normalizeState(left) === normalizeState(right);
}

function productionStatusTone(value: string | null | undefined) {
  switch (normalizeState(value)) {
    case "released":
    case "delivered_closed":
    case "delivered":
    case "closed":
    case "ready_for_release":
    case "on_track":
    case "synced":
    case "clean":
    case "ready":
    case "verified":
    case "not_applicable":
    case "matched":
      return "success" as const;
    case "watch":
    case "at_risk":
    case "waiting_on_files":
    case "waiting_on_intake":
    case "intake_review":
    case "ready_for_qa":
    case "ready_for_upload":
    case "uploading":
    case "partial_error":
    case "stale":
    case "partial_receipt":
    case "partial":
    case "mismatch":
    case "missing":
    case "rework_required":
    case "in_peer_review":
    case "proof_build":
    case "pending_review":
      return "warning" as const;
    case "blocked":
    case "overdue":
    case "sync_error":
    case "cancelled":
    case "missing_receipt":
    case "extra_files":
    case "failed":
      return "danger" as const;
    case "uploaded":
    case "ready_for_production":
    case "in_production":
    case "sent_to_vendor":
    case "pending_sync":
    case "not_started":
      return "info" as const;
    default:
      return statusTone(normalizeState(value));
  }
}

function formatShootRange(item: Pick<SharedProductionQueueItem, "shoot_date_start" | "shoot_date_end">) {
  if (!item.shoot_date_start && !item.shoot_date_end) {
    return "No linked shoot date";
  }
  if (item.shoot_date_start && item.shoot_date_end && item.shoot_date_start !== item.shoot_date_end) {
    return `${formatDate(item.shoot_date_start)} to ${formatDate(item.shoot_date_end)}`;
  }
  return formatDate(item.shoot_date_start ?? item.shoot_date_end);
}

type ProductionAttentionRecord = Pick<
  SharedProductionItem,
  | "health_state"
  | "open_blocker_count"
  | "blocked_reason"
  | "due_at"
  | "overdue_flag"
  | "days_past_due"
  | "days_to_due"
  | "workflow_status"
  | "assigned_to_user_id"
  | "file_match_status"
  | "release_status"
  | "assigned_peer_reviewer_user_id"
  | "assigned_release_reviewer_user_id"
  | "qa_required"
  | "vendor_name"
> & {
  file_receipt_state?: SharedProductionQueueItem["file_receipt_state"];
  qa_summary_status?: SharedProductionQueueItem["qa_summary_status"];
};

function isBlockedProductionItem(item: Pick<ProductionAttentionRecord, "health_state" | "open_blocker_count" | "blocked_reason">) {
  return item.health_state === "BLOCKED" || item.open_blocker_count > 0 || Boolean(item.blocked_reason);
}

function isOverdueProductionItem(item: Pick<ProductionAttentionRecord, "health_state" | "overdue_flag">) {
  return item.overdue_flag || item.health_state === "OVERDUE";
}

function isWatchProductionItem(item: Pick<ProductionAttentionRecord, "health_state">) {
  return item.health_state === "AT_RISK" || item.health_state === "WATCH";
}

function getQueueRowClass(item: Pick<ProductionAttentionRecord, "health_state" | "open_blocker_count" | "blocked_reason" | "overdue_flag">) {
  if (isBlockedProductionItem(item)) {
    return " shared-job-prod__table-row--blocked";
  }
  if (isOverdueProductionItem(item)) {
    return " shared-job-prod__table-row--overdue";
  }
  if (isWatchProductionItem(item)) {
    return " shared-job-prod__table-row--watch";
  }
  return "";
}

function getDueStateLabel(item: Pick<SharedProductionItem, "due_at" | "overdue_flag" | "health_state" | "days_past_due" | "days_to_due" | "workflow_status">) {
  if (isOverdueProductionItem(item)) {
    return item.days_past_due != null && item.days_past_due > 0 ? `Overdue by ${item.days_past_due}d` : "Overdue";
  }
  if (!item.due_at) {
    return "No due date";
  }
  const today = localDateKey(new Date());
  if (localDateKey(item.due_at) === today) {
    return "Due today";
  }
  if (item.days_to_due === 0) {
    return "Due today";
  }
  if (item.days_to_due === 1) {
    return "Due tomorrow";
  }
  if (typeof item.days_to_due === "number" && item.days_to_due > 1 && item.days_to_due <= 7) {
    return `Due in ${item.days_to_due}d`;
  }
  return "On schedule";
}

function getBlockerLabel(item: Pick<SharedProductionItem, "open_blocker_count" | "blocked_reason">) {
  if (item.open_blocker_count) {
    return `${item.open_blocker_count} Open`;
  }
  if (item.blocked_reason) {
    return "Blocked";
  }
  return "Clear";
}

function buildAttentionItems(item: ProductionAttentionRecord) {
  const items: Array<{ key: string; label: string; tone: "danger" | "warning" | "info" }> = [];
  if (isBlockedProductionItem(item)) {
    items.push({
      key: "blocked",
      label: item.blocked_reason ? `Blocked: ${item.blocked_reason}` : `${item.open_blocker_count} blocker${item.open_blocker_count === 1 ? "" : "s"} open`,
      tone: "danger"
    });
  } else if (isOverdueProductionItem(item)) {
    items.push({
      key: "overdue",
      label: getDueStateLabel(item),
      tone: "danger"
    });
  } else if (isWatchProductionItem(item)) {
    items.push({
      key: "watch",
      label: `Health: ${humanizeToken(item.health_state)}`,
      tone: "warning"
    });
  }
  if (!item.assigned_to_user_id) {
    items.push({ key: "owner", label: "No production owner assigned", tone: "warning" });
  }
  if (
    ["MISSING", "PARTIAL", "MISMATCH"].includes(item.file_match_status) ||
    item.file_receipt_state === "missing_receipt" ||
    item.file_receipt_state === "partial_receipt"
  ) {
    items.push({ key: "files", label: `Files: ${humanizeToken(item.file_match_status)}`, tone: "warning" });
  }
  if (item.qa_summary_status === "failed") {
    items.push({ key: "qa", label: "QA send-back active", tone: "warning" });
  }
  if (item.release_status === "SENT_TO_VENDOR") {
    items.push({ key: "vendor", label: "Waiting on vendor handoff", tone: "info" });
  }
  return items.slice(0, 4);
}

function isClosedWorkflow(item: Pick<SharedProductionQueueItem, "workflow_status">) {
  return ["DELIVERED_CLOSED", "CANCELLED"].includes(item.workflow_status);
}

function matchesDueWindow(item: SharedProductionQueueItem, dueWindow: ProductionDueWindow) {
  if (dueWindow === "all") {
    return true;
  }
  const now = new Date();
  const dueTime = item.due_at ? new Date(item.due_at).getTime() : null;
  const todayKey = localDateKey(now);
  if (dueWindow === "today") {
    return Boolean(item.due_at && localDateKey(item.due_at) === todayKey);
  }
  if (dueWindow === "overdue") {
    return Boolean(item.overdue_flag || (dueTime != null && dueTime < now.getTime() && !isClosedWorkflow(item)));
  }
  if (dueWindow === "next_3") {
    return Boolean(dueTime != null && dueTime >= now.getTime() && dueTime - now.getTime() <= 3 * 24 * 60 * 60 * 1000);
  }
  if (dueWindow === "next_7") {
    return Boolean(dueTime != null && dueTime >= now.getTime() && dueTime - now.getTime() <= 7 * 24 * 60 * 60 * 1000);
  }
  if (dueWindow === "closed_last_7_days") {
    if (!item.closed_at) {
      return false;
    }
    const closed = new Date(item.closed_at);
    if (Number.isNaN(closed.getTime())) {
      return false;
    }
    const dayMs = 24 * 60 * 60 * 1000;
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const closedStart = Date.UTC(closed.getUTCFullYear(), closed.getUTCMonth(), closed.getUTCDate());
    const dayDelta = Math.floor((todayStart - closedStart) / dayMs);
    return dayDelta >= 0 && dayDelta <= 7;
  }
  return true;
}

function matchesSearch(item: SharedProductionQueueItem, search: string) {
  if (!search.trim()) {
    return true;
  }
  const normalized = search.trim().toLowerCase();
  return [
    item.title,
    item.job_title,
    item.job_number,
    item.organization_name,
    item.production_type,
    item.assigned_to_name,
    item.primary_contact_name,
    item.release_target,
    item.client_visible_label,
    item.vendor_name,
    item.vendor_reference,
    item.blocked_reason
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized));
}

function applyProductionFilters(items: SharedProductionQueueItem[], filters: ProductionBoardFilterState, savedViewKey: ProductionSavedViewKey) {
  return items.filter((item) => {
    if (savedViewKey !== "closed_last_7_days" && !filters.workflowStatus && isClosedWorkflow(item)) {
      return false;
    }
    if (filters.department !== "all" && item.department_type !== filters.department) {
      return false;
    }
    if (filters.ownerUserId && item.assigned_to_user_id !== filters.ownerUserId) {
      return false;
    }
    if (filters.assignedToMe && item.assigned_to_user_id !== filters.ownerUserId) {
      return false;
    }
    if (filters.workflowStatus && item.workflow_status !== filters.workflowStatus) {
      return false;
    }
    if (filters.healthState && item.health_state !== filters.healthState) {
      return false;
    }
    if (filters.organizationId && item.organization_id !== filters.organizationId) {
      return false;
    }
    if (filters.priority && item.priority !== filters.priority) {
      return false;
    }
    if (!matchesChecklistState(item, filters.checklistState)) {
      return false;
    }
    if (filters.blockerState === "blocked" && !(item.open_blocker_count > 0 || item.health_state === "BLOCKED" || Boolean(item.blocked_reason))) {
      return false;
    }
    if (filters.blockerState === "clear" && (item.open_blocker_count > 0 || item.health_state === "BLOCKED" || Boolean(item.blocked_reason))) {
      return false;
    }
    if (filters.releaseState && !matchesStateValue(item.release_status, filters.releaseState)) {
      return false;
    }
    if (filters.deliverableType) {
      const typeValue = item.production_type.toLowerCase();
      const requested = filters.deliverableType.toLowerCase();
      if (!typeValue.includes(requested)) {
        return false;
      }
    }
    if (!matchesDueWindow(item, filters.dueWindow)) {
      return false;
    }
    if (!matchesSearch(item, filters.search)) {
      return false;
    }
    return true;
  });
}

function productionSortRank(item: SharedProductionQueueItem) {
  if (item.open_blocker_count > 0 || item.health_state === "BLOCKED" || Boolean(item.blocked_reason)) {
    return 0;
  }
  if (item.overdue_flag || item.health_state === "OVERDUE") {
    return 1;
  }
  if (localDateKey(item.due_at) === localDateKey(new Date())) {
    return 2;
  }
  if (item.health_state === "AT_RISK" || item.health_state === "WATCH") {
    return 3;
  }
  return 4;
}

function sortProductionItems(items: SharedProductionQueueItem[]) {
  return [...items].sort((left, right) => {
    const rankDelta = productionSortRank(left) - productionSortRank(right);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    const leftDue = left.due_at ? new Date(left.due_at).getTime() : Number.MAX_SAFE_INTEGER;
    const rightDue = right.due_at ? new Date(right.due_at).getTime() : Number.MAX_SAFE_INTEGER;
    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }
    return left.title.localeCompare(right.title);
  });
}

function summarizeProductionBoard(items: SharedProductionQueueItem[]) {
  return {
    openItems: items.filter((item) => !isClosedWorkflow(item)).length,
    dueToday: items.filter((item) => matchesDueWindow(item, "today")).length,
    overdue: items.filter((item) => matchesDueWindow(item, "overdue")).length,
    blocked: items.filter((item) => item.open_blocker_count > 0 || item.health_state === "BLOCKED" || Boolean(item.blocked_reason)).length,
    readyForQa: items.filter((item) => item.workflow_status === "READY_FOR_QA").length,
    readyForRelease: items.filter((item) => item.workflow_status === "READY_FOR_RELEASE").length,
    awaitingFiles: items.filter((item) => item.workflow_status === "WAITING_ON_FILES").length,
    awaitingUpload: items.filter((item) => item.workflow_status === "READY_FOR_UPLOAD" || item.workflow_status === "UPLOADING").length,
    vendorPending: items.filter((item) => item.workflow_status === "SENT_TO_VENDOR" || matchesStateValue(item.release_status, "SENT_TO_VENDOR")).length
  };
}

function buildProductionQuery(
  filters: ProductionBoardFilterState,
  departmentType: QueueDepartment,
  currentUserId: string
): SharedProductionQueueQuery {
  const due_bucket =
    filters.dueWindow === "today" || filters.dueWindow === "overdue"
      ? filters.dueWindow
      : filters.dueWindow === "next_7"
        ? "next-7"
      : "";
  const assignedUserId = filters.assignedToMe ? currentUserId : filters.ownerUserId || null;
  return {
    department_type: (departmentType ?? filters.department) === "all" ? "all" : (departmentType ?? filters.department),
    workflow_status: filters.workflowStatus,
    health_state: filters.healthState,
    assigned_to_user_id: assignedUserId,
    blocked: filters.blockerState === "blocked" ? "yes" : filters.blockerState === "clear" ? "no" : "",
    priority: filters.priority,
    due_bucket,
    search: filters.search || null,
    deliverable_type: filters.deliverableType || null,
    organization_id: filters.organizationId || null,
    release_status: filters.releaseState || "",
    checklist_state: filters.checklistState || ""
  };
}

function buildProductionReportingQuery(
  filters: ProductionBoardFilterState,
  departmentType: QueueDepartment,
  currentUserId: string
): SharedProductionReportingQuery {
  return {
    ...buildProductionQuery(filters, departmentType, currentUserId),
    due_window: filters.dueWindow
  };
}

function matchesChecklistState(item: SharedProductionQueueItem, checklistState: ProductionBoardFilterState["checklistState"]) {
  if (!checklistState) {
    return true;
  }
  if (checklistState === "overdue") {
    return item.checklist_overdue_count > 0;
  }
  if (checklistState === "awaiting_approval") {
    return item.checklist_awaiting_approval_count > 0;
  }
  if (checklistState === "rejected") {
    return item.checklist_rejected_count > 0;
  }
  if (checklistState === "blocked") {
    return item.checklist_blocked_count > 0;
  }
  return true;
}

function buildChecklistIndicators(item: SharedProductionQueueItem | SharedProductionItem) {
  const indicators: Array<{ key: string; label: string; tone: "danger" | "warning" | "info" }> = [];
  if (item.checklist_overdue_count) {
    indicators.push({
      key: "overdue",
      label: `${item.checklist_overdue_count} overdue checklist${item.checklist_overdue_count === 1 ? "" : "s"}`,
      tone: "danger"
    });
  }
  if (item.checklist_blocked_count) {
    indicators.push({
      key: "blocked",
      label: `${item.checklist_blocked_count} blocked checklist${item.checklist_blocked_count === 1 ? "" : "s"}`,
      tone: "danger"
    });
  }
  if (item.checklist_awaiting_approval_count) {
    indicators.push({
      key: "awaiting_approval",
      label: `${item.checklist_awaiting_approval_count} awaiting approval`,
      tone: "warning"
    });
  }
  if (item.checklist_rejected_count) {
    indicators.push({
      key: "rejected",
      label: `${item.checklist_rejected_count} rejected`,
      tone: "warning"
    });
  }
  if (item.checklist_missing_proof_count) {
    indicators.push({
      key: "missing_proof",
      label: `${item.checklist_missing_proof_count} missing proof`,
      tone: "warning"
    });
  }
  return indicators;
}

function renderChecklistIndicators(
  item: SharedProductionQueueItem | SharedProductionItem,
  options: { compact?: boolean; maxVisible?: number } = {}
) {
  const indicators = buildChecklistIndicators(item).slice(0, options.maxVisible ?? 3);
  if (!indicators.length && !item.blocking_checklist_title) {
    return null;
  }
  return (
    <div className={`shared-job-prod__checklist-badges${options.compact ? " shared-job-prod__checklist-badges--compact" : ""}`}>
      {indicators.map((indicator) => (
        <StatusPill key={indicator.key} label={indicator.label} tone={indicator.tone} />
      ))}
      {item.blocking_checklist_title ? <span className="shared-job-prod__checklist-badge-meta">{item.blocking_checklist_title}</span> : null}
    </div>
  );
}

function buildApprovalStatusSummary(approvals: SharedApprovalRequest[]) {
  return {
    overdue: approvals.filter((item) => item.status === "overdue").length,
    pending: approvals.filter((item) => ["requested", "viewed", "revisions_requested"].includes(item.status)).length,
    approved: approvals.filter((item) => item.status === "approved").length
  };
}

function buildQaSummary(reviews: SharedQaReview[], findings: SharedQaFinding[]) {
  return {
    pending: reviews.filter((review) => ["queued", "in_review", "recheck_required"].includes(review.status)).length,
    failed: reviews.filter((review) => ["failed", "rework_in_progress"].includes(review.status)).length,
    blockingFindings: findings.filter((finding) => finding.is_blocking && !finding.resolved_at).length
  };
}

function buildDeliverableSummary(deliverables: SharedDeliverableItem[]) {
  return {
    inFlight: deliverables.filter((item) => ["preparing", "sent", "in_transit"].includes(item.status)).length,
    delivered: deliverables.filter((item) => ["delivered", "confirmed"].includes(item.status)).length,
    issues: deliverables.filter((item) => item.status === "issue_flagged").length
  };
}

function buildProductionHealth(items: SharedProductionItem[], issues: SharedProductionIssue[]) {
  return {
    blocked: items.filter((item) => item.status === "blocked" || Boolean(item.blocked_reason)).length,
    dueSoon: items.filter((item) => {
      if (!item.due_at) {
        return false;
      }
      const due = new Date(item.due_at).getTime();
      return due >= Date.now() && due - Date.now() <= 2 * 24 * 60 * 60 * 1000;
    }).length,
    openIssues: issues.filter((issue) => ["open", "acknowledged"].includes(issue.status)).length
  };
}

function getItemApprovals(detail: SharedJobDetailResponse, productionItemId: string) {
  return detail.approval_requests.filter((item) => item.production_item_id === productionItemId);
}

function getItemReviews(detail: SharedJobDetailResponse, productionItemId: string) {
  return detail.qa_reviews.filter((item) => item.production_item_id === productionItemId);
}

function getItemFindings(detail: SharedJobDetailResponse, productionItemId: string) {
  const reviewIds = new Set(getItemReviews(detail, productionItemId).map((review) => review.id));
  return detail.qa_findings.filter((item) => reviewIds.has(item.qa_review_record_id));
}

function getItemDeliverables(detail: SharedJobDetailResponse, productionItemId: string) {
  return detail.deliverable_items.filter((item) => item.production_item_id === productionItemId);
}

function getItemIssues(detail: SharedJobDetailResponse, productionItemId: string) {
  return detail.production_issues.filter((item) => item.production_item_id === productionItemId);
}

function getItemHandoffs(detail: SharedJobDetailResponse, productionItemId: string) {
  return detail.production_handoffs.filter((item) => item.production_item_id === productionItemId);
}

function renderSummaryCard(title: string, value: string | number, detail: string, tone?: "success" | "warning" | "danger" | "info") {
  return (
    <section className={`shared-job-prod__summary-card${tone ? ` tone-${tone}` : ""}`}>
      <WorkspaceSectionHeader title={title} compact />
      <div className="shared-job-prod__summary-value">{value}</div>
      <div className="shared-job-prod__summary-detail">{detail}</div>
    </section>
  );
}

export function ProductionSummaryCard({ items }: { items: SharedProductionItem[] }) {
  return renderSummaryCard("Production Items", items.length, "Shared downstream work units currently linked to this job.", "info");
}

export function ProductionDeadlineCard({ items }: { items: SharedProductionItem[] }) {
  const dueSoon = buildProductionHealth(items, []).dueSoon;
  return renderSummaryCard("Due Soon", dueSoon, "Items due in the next 48 hours.", dueSoon ? "warning" : "success");
}

export function ProductionHealthSummaryCard({
  items,
  issues
}: {
  items: SharedProductionItem[];
  issues: SharedProductionIssue[];
}) {
  const health = buildProductionHealth(items, issues);
  return renderSummaryCard("Blocked Work", health.blocked, `${health.openIssues} issue(s) open across this scope.`, health.blocked ? "danger" : "success");
}

export function ApprovalStatusSummaryCard({ approvals }: { approvals: SharedApprovalRequest[] }) {
  const summary = buildApprovalStatusSummary(approvals);
  return renderSummaryCard("Approvals", summary.pending, `${summary.overdue} overdue | ${summary.approved} approved`, summary.overdue ? "danger" : "info");
}

export function PeerReviewSummaryCard({
  reviews,
  findings
}: {
  reviews: SharedQaReview[];
  findings: SharedQaFinding[];
}) {
  const summary = buildQaSummary(reviews, findings);
  return renderSummaryCard("QA / Peer Review", summary.pending, `${summary.failed} rework lane | ${summary.blockingFindings} blocking finding(s)`, summary.failed || summary.blockingFindings ? "warning" : "success");
}

export function DeliveryStatusCard({ deliverables }: { deliverables: SharedDeliverableItem[] }) {
  const summary = buildDeliverableSummary(deliverables);
  return renderSummaryCard("Deliverables", summary.inFlight, `${summary.delivered} delivered | ${summary.issues} issue(s) flagged`, summary.issues ? "danger" : "info");
}

export function DepartmentProductionSummaryCard({ payload }: { payload: SharedProductionQueueResponse | null }) {
  return renderSummaryCard(
    "Queued / Blocked",
    payload ? `${payload.summary.total_count} / ${payload.summary.blocked_count}` : "0 / 0",
    "Shared production volume and blocked work snapshot.",
    payload?.summary.blocked_count ? "warning" : "success"
  );
}

export function DepartmentApprovalsSummaryCard({ payload }: { payload: SharedProductionQueueResponse | null }) {
  return renderSummaryCard(
    "Awaiting Approval",
    payload?.summary.awaiting_approval_count ?? 0,
    `${payload?.summary.overdue_count ?? 0} overdue across the queue.`,
    (payload?.summary.overdue_count ?? 0) > 0 ? "danger" : "info"
  );
}

export function DepartmentDeliverySummaryCard({ payload }: { payload: SharedProductionQueueResponse | null }) {
  return renderSummaryCard(
    "Delivery Pressure",
    payload?.summary.due_today_count ?? 0,
    `${payload?.summary.qa_pending_count ?? 0} QA-pending items before delivery.`,
    (payload?.summary.due_today_count ?? 0) > 0 ? "warning" : "success"
  );
}

export function DepartmentProductionOverviewPanel({
  token,
  departmentType,
  title,
  summary,
  routeHash
}: DepartmentProductionOverviewPanelProps) {
  const [payload, setPayload] = useState<SharedProductionQueueResponse | null>(null);
  const [reporting, setReporting] = useState<SharedProductionReportingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      listSharedProductionQueue(token, { department_type: departmentType }),
      getSharedProductionReporting(token, { department_type: departmentType })
    ])
      .then(([queueResponse, reportingResponse]) => {
        if (!cancelled) {
          setPayload(queueResponse);
          setReporting(reportingResponse);
          setError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setPayload(null);
          setReporting(null);
          setError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load the downstream snapshot right now.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [departmentType, token]);

  const spotlightItems = useMemo(() => sortProductionItems(payload?.items ?? []).slice(0, 3), [payload]);

  return (
    <section className="panel shared-job-prod__overview-panel">
      <WorkspaceSectionHeader
        title={title}
        summary={summary}
        actions={
          <WorkspaceActionBar align="end" compact>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = routeHash)}>
              Open Queue
            </button>
          </WorkspaceActionBar>
        }
      />
      {loading ? (
        <WorkspaceLoadingBlock
          title={`Loading ${title}`}
          summary="Opening the shared downstream snapshot for this department."
          className="shared-job-prod__overview-loading"
        />
      ) : error ? (
        <div className="shared-job-list__error" role="alert">
          {error}
        </div>
      ) : (
        <div className="shared-job-prod__stack">
          <div className="shared-job-prod__metric-grid">
            <DepartmentProductionSummaryCard payload={payload} />
            <DepartmentApprovalsSummaryCard payload={payload} />
            <DepartmentDeliverySummaryCard payload={payload} />
            {renderSummaryCard(
              "QA Pending",
              payload?.summary.qa_pending_count ?? 0,
              "Items still waiting on review or recheck.",
              (payload?.summary.qa_pending_count ?? 0) > 0 ? "warning" : "success"
            )}
            {renderSummaryCard(
              "Checklist Pressure",
              (payload?.items ?? []).filter(
                (item) =>
                  item.checklist_overdue_count > 0 ||
                  item.checklist_blocked_count > 0 ||
                  item.checklist_awaiting_approval_count > 0 ||
                  item.checklist_rejected_count > 0
              ).length,
              "Production items with overdue, rejected, or blocking checklist work.",
              (payload?.items ?? []).some((item) => item.checklist_overdue_count > 0 || item.checklist_blocked_count > 0) ? "danger" : "info"
            )}
          </div>
          <DepartmentProductionReportingStrip reporting={reporting} loading={loading} />
          <SavedViewBar
            views={[
              { key: "blocked", label: "Blocked" },
              { key: "ready_for_qa", label: "Ready for QA" },
              { key: "ready_for_release", label: "Ready for Release" }
            ]}
            activeKey={null}
            onSelect={(key) => {
              const params = new URLSearchParams();
              params.set("saved_view", key as ProductionSavedViewKey);
              window.location.hash = `${routeHash}?${params.toString()}`;
            }}
          />
          {spotlightItems.length ? (
            <div className="shared-job-prod__overview-list">
              {spotlightItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`shared-job-prod__overview-row${item.health_state === "BLOCKED" || item.overdue_flag ? " is-critical" : ""}`}
                  onClick={() => {
                    const params = new URLSearchParams();
                    params.set("item", item.id);
                    window.location.hash = `${routeHash}?${params.toString()}`;
                  }}
                >
                  <div className="shared-job-prod__overview-row-copy">
                    <strong>{item.title}</strong>
                    <span>{item.organization_name ?? "Unassigned"} | {humanizeToken(item.production_type)}</span>
                    {renderChecklistIndicators(item, { compact: true, maxVisible: 2 })}
                  </div>
                  <div className="shared-job-prod__overview-row-meta">
                    <StatusPill label={humanizeToken(item.health_state)} tone={productionStatusTone(item.health_state)} />
                    <span>{item.due_at ? formatDate(item.due_at) : "No due date"}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <WorkspaceEmptyState title="No production pressure right now" summary="Blocked work, due-today items, and release pressure will surface here for this department." compact />
          )}
        </div>
      )}
    </section>
  );
}

export function FileReceiptCard({
  item,
  canManage,
  onSave
}: {
  item: SharedProductionItem | SharedProductionQueueItem;
  canManage: boolean;
  onSave: (input: SharedProductionItemInput) => Promise<void>;
}) {
  const [expected, setExpected] = useState(item.file_count_expected != null ? String(item.file_count_expected) : "");
  const [received, setReceived] = useState(item.file_count_received != null ? String(item.file_count_received) : "");

  useEffect(() => {
    setExpected(item.file_count_expected != null ? String(item.file_count_expected) : "");
    setReceived(item.file_count_received != null ? String(item.file_count_received) : "");
  }, [item.file_count_expected, item.file_count_received, item.id]);

  const expectedNumber = expected ? Number(expected) : null;
  const receivedNumber = received ? Number(received) : null;
  const receiptState =
    expectedNumber == null
      ? "Not applicable"
      : receivedNumber == null || receivedNumber === 0
        ? "Missing receipt"
        : receivedNumber < expectedNumber
          ? "Partial receipt"
          : receivedNumber === expectedNumber
            ? "Exact match"
            : "Extra files";

  return (
    <section className="shared-job-prod__card">
      <WorkspaceSectionHeader title="File Receipt" compact />
      <div className="shared-job-prod__kv">
        <span>Expected: {item.file_count_expected ?? "TBD"}</span>
        <span>Received: {item.file_count_received ?? "0"}</span>
        <span>{receiptState}</span>
      </div>
      {canManage ? (
        <div className="shared-job-prod__mini-form">
          <label className="filter-field">
            <span>Expected files</span>
            <input value={expected} onChange={(event) => setExpected(event.target.value)} inputMode="numeric" />
          </label>
          <label className="filter-field">
            <span>Received files</span>
            <input value={received} onChange={(event) => setReceived(event.target.value)} inputMode="numeric" />
          </label>
          <WorkspaceActionBar align="end" compact>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                void onSave({
                  file_count_expected: expected ? Number(expected) : null,
                  file_count_received: received ? Number(received) : null,
                  status: received && expected && Number(received) >= Number(expected) ? "ingest_complete" : item.status
                })
              }
            >
              Confirm Receipt
            </button>
          </WorkspaceActionBar>
        </div>
      ) : null}
    </section>
  );
}

export function BlockedProductionBanner({
  item,
  approvals,
  findings,
  issues
}: {
  item: SharedProductionItem | SharedProductionQueueItem;
  approvals: SharedApprovalRequest[];
  findings: SharedQaFinding[];
  issues: SharedProductionIssue[];
}) {
  const blockers: string[] = [];
  if (item.blocked_reason) {
    blockers.push(item.blocked_reason);
  }
  if (approvals.some((request) => request.status === "overdue")) {
    blockers.push("Required approval is overdue.");
  }
  if (findings.some((finding) => finding.is_blocking && !finding.resolved_at)) {
    blockers.push("Blocking QA findings still unresolved.");
  }
  if (issues.some((issue) => ["open", "acknowledged"].includes(issue.status))) {
    blockers.push("Production issue remains open.");
  }
  if (!blockers.length && item.status !== "blocked") {
    return null;
  }

  return (
    <section className="shared-job-ops__banner shared-job-ops__banner--warning" role="alert">
      <div className="shared-job-ops__banner-copy">
        <strong>Blocked downstream work</strong>
        <span>{blockers[0] ?? "This production item is currently blocked."}</span>
      </div>
      <div className="shared-job-prod__banner-list">
        {blockers.slice(0, 4).map((reason, index) => (
          <span key={`${item.id}-blocker-${index}`}>{reason}</span>
        ))}
      </div>
    </section>
  );
}

export function HandoffTimeline({ handoffs }: { handoffs: SharedProductionHandoff[] }) {
  if (!handoffs.length) {
    return <WorkspaceEmptyState title="No handoffs yet" summary="Internal movement between ingest, edit, QA, proof, and delivery will show here." compact />;
  }
  return (
    <section className="shared-job-prod__card">
      <WorkspaceSectionHeader title="Handoff Timeline" compact />
      <div className="shared-job-detail__timeline">
        {handoffs.map((handoff) => (
          <div key={handoff.id} className="shared-job-detail__timeline-entry">
            <strong>{humanizeToken(handoff.handoff_type)}</strong>
            <span>{humanizeToken(handoff.from_stage)} to {humanizeToken(handoff.to_stage)}</span>
            <span>{handoff.from_user_name ?? "System"} to {handoff.to_user_name ?? "Unassigned"} | {humanizeToken(handoff.status)}</span>
            {handoff.note ? <span>{handoff.note}</span> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function HandoffActionPanel({
  productionItemId,
  staffOptions,
  canManage,
  onSave
}: {
  productionItemId: string;
  staffOptions: DirectoryOwnerOption[];
  canManage: boolean;
  onSave: (productionItemId: string, input: SharedProductionHandoffInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<SharedProductionHandoffInput>({
    handoff_type: "stage_handoff",
    from_stage: "editing",
    to_stage: "qa",
    to_user_id: null,
    status: "pending",
    note: null
  });

  if (!canManage) {
    return null;
  }

  return (
    <section className="shared-job-prod__card">
      <WorkspaceSectionHeader title="Record Handoff" compact />
      <div className="shared-job-prod__mini-form">
        <div className="field-grid shared-job-form__grid">
          <label className="filter-field">
            <span>Handoff type</span>
            <input value={draft.handoff_type ?? ""} onChange={(event) => setDraft((current) => ({ ...current, handoff_type: event.target.value }))} />
          </label>
          <label className="filter-field">
            <span>From stage</span>
            <input value={draft.from_stage ?? ""} onChange={(event) => setDraft((current) => ({ ...current, from_stage: event.target.value }))} />
          </label>
          <label className="filter-field">
            <span>To stage</span>
            <input value={draft.to_stage ?? ""} onChange={(event) => setDraft((current) => ({ ...current, to_stage: event.target.value }))} />
          </label>
          <SharedStaffPicker
            label="Next owner"
            value={draft.to_user_id ?? ""}
            options={staffOptions}
            onChange={(value) => setDraft((current) => ({ ...current, to_user_id: value || null }))}
            emptyLabel="Choose next owner"
          />
          <label className="filter-field filter-field--wide">
            <span>Note</span>
            <textarea rows={2} value={draft.note ?? ""} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} />
          </label>
        </div>
        <WorkspaceActionBar align="end" compact>
          <button type="button" className="secondary-button" onClick={() => void onSave(productionItemId, draft)}>
            Add Handoff
          </button>
        </WorkspaceActionBar>
      </div>
    </section>
  );
}

export function ApprovalRequestCard({
  request,
  canManage,
  onSave
}: {
  request: SharedApprovalRequest;
  canManage: boolean;
  onSave: (productionItemId: string, input: SharedApprovalRequestInput, approvalId?: string) => Promise<void>;
}) {
  return (
    <article className="shared-job-prod__item-card">
      <div className="shared-job-detail__list-card-header">
        <div>
          <h4>{humanizeToken(request.approval_type)}</h4>
          <p className="shared-job-sidebar__muted">{request.approver_contact_name ?? request.approver_user_name ?? "Approver pending"}</p>
        </div>
        <StatusPill label={humanizeToken(request.status)} tone={statusTone(request.status)} />
      </div>
      <div className="shared-job-prod__kv">
        <span>Requested: {request.requested_at ? formatDateTime(request.requested_at) : "Not requested yet"}</span>
        <span>Due: {request.due_at ? formatDate(request.due_at) : "No due date"}</span>
        <span>Revisions: {request.revision_count}</span>
      </div>
      {request.summary ? <p className="shared-job-prod__copy">{request.summary}</p> : null}
      {canManage ? (
        <WorkspaceActionBar align="end" compact>
          <button type="button" className="secondary-button" onClick={() => void onSave(request.production_item_id, { status: "requested" }, request.id)}>
            Mark Requested
          </button>
          <button type="button" className="secondary-button" onClick={() => void onSave(request.production_item_id, { status: "viewed" }, request.id)}>
            Mark Viewed
          </button>
          <button type="button" className="secondary-button" onClick={() => void onSave(request.production_item_id, { status: "approved" }, request.id)}>
            Mark Approved
          </button>
          <button type="button" className="secondary-button" onClick={() => void onSave(request.production_item_id, { status: "revisions_requested" }, request.id)}>
            Request Revisions
          </button>
        </WorkspaceActionBar>
      ) : null}
    </article>
  );
}

export function ApprovalFollowUpPanel({
  productionItems,
  approvalTypes,
  canManage,
  onSave
}: {
  productionItems: SharedProductionItem[];
  approvalTypes: Array<{ value: string; label: string }>;
  canManage: boolean;
  onSave: (productionItemId: string, input: SharedApprovalRequestInput, approvalId?: string) => Promise<void>;
}) {
  const [productionItemId, setProductionItemId] = useState(productionItems[0]?.id ?? "");
  const [approvalType, setApprovalType] = useState(approvalTypes[0]?.value ?? "client_approval");
  const [summary, setSummary] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [approverContactId, setApproverContactId] = useState("");

  useEffect(() => {
    setProductionItemId((current) => current || productionItems[0]?.id || "");
  }, [productionItems]);

  if (!canManage) {
    return null;
  }

  return (
    <section className="shared-job-prod__card">
      <WorkspaceSectionHeader title="Create Approval Request" compact />
      <div className="field-grid shared-job-form__grid">
        <label className="filter-field">
          <span>Production item</span>
          <select value={productionItemId} onChange={(event) => setProductionItemId(event.target.value)}>
            {productionItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Approval type</span>
          <select value={approvalType} onChange={(event) => setApprovalType(event.target.value)}>
            {approvalTypes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Approver contact ID</span>
          <input value={approverContactId} onChange={(event) => setApproverContactId(event.target.value)} />
        </label>
        <label className="filter-field">
          <span>Due date</span>
          <input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
        </label>
        <label className="filter-field filter-field--wide">
          <span>Summary</span>
          <textarea rows={2} value={summary} onChange={(event) => setSummary(event.target.value)} />
        </label>
      </div>
      <WorkspaceActionBar align="end" compact>
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            void onSave(productionItemId, {
              approval_type: approvalType,
              approver_contact_id: approverContactId || null,
              due_at: dueAt ? `${dueAt}T17:00:00` : null,
              summary: summary || null,
              status: "requested"
            })
          }
        >
          Create Approval
        </button>
      </WorkspaceActionBar>
    </section>
  );
}

export function QAFindingList({
  review,
  findings,
  canManage,
  onSave
}: {
  review: SharedQaReview;
  findings: SharedQaFinding[];
  canManage: boolean;
  onSave: (productionItemId: string, qaReviewId: string, input: SharedQaFindingInput, findingId?: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  return (
    <section className="shared-job-prod__card">
      <WorkspaceSectionHeader title="QA Findings" compact />
      {findings.length ? (
        <div className="shared-job-prod__stack">
          {findings.map((finding) => (
            <article key={finding.id} className="shared-job-prod__finding-row">
              <div>
                <strong>{finding.title}</strong>
                <p className="shared-job-prod__copy">{finding.description}</p>
              </div>
              <div className="shared-job-prod__finding-meta">
                <StatusPill label={humanizeToken(finding.severity)} tone={statusTone(finding.severity)} />
                {finding.is_blocking ? <StatusPill label="Blocking" tone="warning" /> : null}
                <StatusPill label={finding.resolved_at ? "Resolved" : "Open"} tone={finding.resolved_at ? "success" : "neutral"} />
                {canManage && !finding.resolved_at ? (
                  <button type="button" className="secondary-button" onClick={() => void onSave(review.production_item_id, review.id, { resolve: true }, finding.id)}>
                    Resolve
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <WorkspaceEmptyState title="No findings yet" summary="Structured QA findings appear here when review catches something worth tracking." compact />
      )}
      {canManage ? (
        <div className="shared-job-prod__mini-form">
          <label className="filter-field">
            <span>Finding title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="filter-field filter-field--wide">
            <span>Description</span>
            <textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <WorkspaceActionBar align="end" compact>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                if (!title.trim()) {
                  return;
                }
                void onSave(review.production_item_id, review.id, {
                  finding_type: "quality_check",
                  severity: "medium",
                  title: title.trim(),
                  description: description.trim() || "QA finding logged",
                  is_blocking: true
                });
                setTitle("");
                setDescription("");
              }}
            >
              Add Finding
            </button>
          </WorkspaceActionBar>
        </div>
      ) : null}
    </section>
  );
}

export function ReworkBanner({ reviews, findings }: { reviews: SharedQaReview[]; findings: SharedQaFinding[] }) {
  const hasRework = reviews.some((review) => ["failed", "rework_in_progress", "recheck_required"].includes(review.status)) || findings.some((finding) => finding.is_blocking && !finding.resolved_at);
  if (!hasRework) {
    return null;
  }
  return (
    <section className="shared-job-ops__banner shared-job-ops__banner--warning" role="alert">
      <div className="shared-job-ops__banner-copy">
        <strong>Rework still required</strong>
        <span>QA has not fully cleared this downstream work yet.</span>
      </div>
    </section>
  );
}

function ProductionQaGateCard({
  detail,
  item,
  gate,
  latestReview,
  reviewHistory,
  findings,
  canManage,
  currentUser,
  staffOptions,
  qaTemplates,
  onSaveQaReview,
  onSaveQaFinding
}: {
  detail: SharedJobDetailResponse;
  item: SharedProductionItem;
  gate: QaGateConfig;
  latestReview: SharedQaReview | null;
  reviewHistory: SharedQaReview[];
  findings: SharedQaFinding[];
  canManage: boolean;
  currentUser: SessionUser;
  staffOptions: DirectoryOwnerOption[];
  qaTemplates: Array<{ value: string; label: string }>;
  onSaveQaReview: SharedDetailDownstreamProps["onSaveQaReview"];
  onSaveQaFinding: SharedDetailDownstreamProps["onSaveQaFinding"];
}) {
  const [draft, setDraft] = useState<QaReviewDraftState>(() => buildQaDraftState(detail, item, gate.key, latestReview, qaTemplates, staffOptions));
  const [localError, setLocalError] = useState("");
  const minimumSamplePercent = getQaRequiredSamplePercent(detail, item, gate.key);
  const canOverrideSelfReview = currentUser.permissions.includes("qa.self_review_override");
  const reviewIdForMutation = latestReview && !isQaReviewTerminal(latestReview) ? latestReview.id : undefined;
  const originalOwnerUserId = latestReview?.original_owner_user_id ?? item.assigned_to_user_id;
  const selfPeerReview = gate.key === "peer_review" && Boolean(originalOwnerUserId && draft.reviewerUserId && originalOwnerUserId === draft.reviewerUserId);

  useEffect(() => {
    setDraft(buildQaDraftState(detail, item, gate.key, latestReview, qaTemplates, staffOptions));
    setLocalError("");
  }, [detail, item, gate.key, latestReview, qaTemplates, staffOptions]);

  async function submit(action: "request" | "start" | "approve" | "send_back") {
    const sampleSize =
      draft.sampleSizePercent.trim() === ""
        ? null
        : Number.isFinite(Number(draft.sampleSizePercent))
          ? Number(draft.sampleSizePercent)
          : Number.NaN;
    if (!draft.reviewerUserId.trim()) {
      setLocalError("Choose a reviewer before moving this gate.");
      return;
    }
    if (selfPeerReview && !canOverrideSelfReview) {
      setLocalError("Peer review must be assigned to someone other than the original owner unless an override is granted.");
      return;
    }
    if (selfPeerReview && canOverrideSelfReview && !draft.overrideSameReviewer) {
      setLocalError("Explicitly approve the self-review override before moving this peer review.");
      return;
    }
    if (selfPeerReview && canOverrideSelfReview && draft.overrideSameReviewer && !draft.overrideReason.trim()) {
      setLocalError("Enter an override reason before approving self-review.");
      return;
    }
    if ((action === "approve" || action === "send_back") && (!Number.isFinite(sampleSize) || sampleSize == null)) {
      setLocalError("Enter the review sample size before submitting a QA decision.");
      return;
    }
    if ((action === "approve" || action === "send_back") && typeof sampleSize === "number" && sampleSize < minimumSamplePercent) {
      setLocalError(`${gate.reviewTypeLabel} requires at least a ${minimumSamplePercent}% sample.`);
      return;
    }
    if (action === "send_back" && !draft.decisionReason.trim()) {
      setLocalError("Send-back requires a reason.");
      return;
    }
    if (action === "send_back" && !draft.issueCategory.trim()) {
      setLocalError("Choose an issue category before sending the item back.");
      return;
    }

    const answers = {
      files_complete_storage: draft.answers.files_complete_storage,
      color_density_consistency: draft.answers.color_density_consistency,
      sorting_and_roster_accuracy: draft.answers.sorting_and_roster_accuracy,
      template_price_release_accuracy: draft.answers.template_price_release_accuracy,
      next_stage_decision: action === "approve" ? "approve" : action === "send_back" ? "send_back" : draft.answers.next_stage_decision
    } as Record<string, unknown>;

    setLocalError("");
    await onSaveQaReview(
      item.id,
      {
        review_type: gate.reviewType,
        review_stage: gate.key,
        reviewer_user_id: draft.reviewerUserId || null,
        checklist_template_key: draft.checklistTemplateKey || null,
        sample_size_percent: typeof sampleSize === "number" && Number.isFinite(sampleSize) ? sampleSize : null,
        notes: draft.notes.trim() || null,
        question_answers_json: answers,
        decision_reason: draft.decisionReason.trim() || null,
        issue_category: draft.issueCategory || null,
        override_same_reviewer: selfPeerReview ? draft.overrideSameReviewer : false,
        override_reason: selfPeerReview && draft.overrideSameReviewer ? draft.overrideReason.trim() || null : null,
        status:
          action === "request"
            ? "queued"
            : action === "start"
              ? "in_review"
              : action === "approve"
                ? "passed"
                : "failed",
        decision: action === "approve" ? "approve" : action === "send_back" ? "send_back" : null,
        rework_required: action === "send_back"
      },
      reviewIdForMutation
    );
  }

  return (
    <section className="shared-job-prod__card shared-job-prod__qa-gate-card">
      <div className="shared-job-detail__list-card-header shared-job-prod__qa-gate-header">
        <div>
          <h4>{gate.label}</h4>
          <p className="shared-job-sidebar__muted">{gate.summary}</p>
        </div>
        <div className="shared-job-preview__status-row">
          <StatusPill label={getQaGateStatusLabel(item, gate.key, latestReview)} tone={getQaGateStatusTone(item, gate.key, latestReview)} />
          <StatusPill label={`Min ${minimumSamplePercent}% sample`} tone="info" />
        </div>
      </div>
      <div className="shared-job-prod__detail-kv-grid">
        {renderCompactValue("Reviewer", getQaGateReviewerLabel(item, gate.key, latestReview))}
        {renderCompactValue("Checklist", (latestReview?.checklist_template_key ?? draft.checklistTemplateKey) || "Default")}
        {renderCompactValue("Last Reviewed", latestReview?.reviewed_at ? formatDateTime(latestReview.reviewed_at) : "Not reviewed")}
        {renderCompactValue("Decision", latestReview?.decision_reason ? `${humanizeToken(latestReview.decision ?? "pending")} with notes` : humanizeToken(latestReview?.decision ?? "pending"))}
      </div>
      {latestReview?.decision_reason ? (
        <div className="shared-job-prod__qa-note">
          <strong>Decision note</strong>
          <p>{latestReview.decision_reason}</p>
        </div>
      ) : null}
      {latestReview?.issue_category ? (
        <div className="shared-job-prod__qa-note">
          <strong>Issue category</strong>
          <p>{humanizeToken(latestReview.issue_category)}</p>
        </div>
      ) : null}
      {latestReview?.accountability_stage_key ? (
        <div className="shared-job-prod__qa-note shared-job-prod__qa-note--warning">
          <strong>Accountability tracked</strong>
          <p>
            Responsibility is attached to {latestReview.accountable_owner_name ?? "the original owner"} and {latestReview.accountable_reviewer_name ?? "the peer reviewer"} from{" "}
            {humanizeToken(latestReview.accountability_stage_key)}.
          </p>
        </div>
      ) : null}
      {canManage ? (
        <div className="shared-job-prod__mini-form shared-job-prod__qa-form">
          <div className="field-grid shared-job-form__grid">
            <SharedStaffPicker
              label="Reviewer"
              value={draft.reviewerUserId}
              options={staffOptions}
              onChange={(value) => setDraft((current) => ({ ...current, reviewerUserId: value || "" }))}
              emptyLabel="Choose reviewer"
            />
            <label className="filter-field">
              <span>QA checklist</span>
              <select
                value={draft.checklistTemplateKey}
                onChange={(event) => setDraft((current) => ({ ...current, checklistTemplateKey: event.target.value }))}
              >
                <option value="">Default checklist</option>
                {qaTemplates.map((template) => (
                  <option key={template.value} value={template.value}>
                    {template.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Sample size percent</span>
              <input
                type="number"
                min={minimumSamplePercent}
                max={100}
                value={draft.sampleSizePercent}
                onChange={(event) => setDraft((current) => ({ ...current, sampleSizePercent: event.target.value }))}
              />
            </label>
            <label className="filter-field filter-field--wide">
              <span>Reviewer notes</span>
              <textarea rows={3} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
            </label>
          </div>

          <div className="shared-job-prod__qa-question-grid">
            {QA_QUESTION_CONFIGS.filter((question) => question.key !== "next_stage_decision").map((question) => (
              <label key={question.key} className="filter-field">
                <span>{question.label}</span>
                <select
                  value={draft.answers[question.key] == null ? "" : draft.answers[question.key] ? "yes" : "no"}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      answers: {
                        ...current.answers,
                        [question.key]: event.target.value === "" ? null : event.target.value === "yes"
                      }
                    }))
                  }
                >
                  <option value="">Select answer</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
            ))}
            <label className="filter-field">
              <span>{QA_QUESTION_CONFIGS[4].label}</span>
              <select
                value={typeof draft.answers.next_stage_decision === "string" ? draft.answers.next_stage_decision : ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    answers: {
                      ...current.answers,
                      next_stage_decision: event.target.value || null
                    }
                  }))
                }
              >
                <option value="">Select decision</option>
                <option value="approve">Approve for next stage</option>
                <option value="send_back">Send back for rework</option>
              </select>
            </label>
            <label className="filter-field filter-field--wide">
              <span>Send-back reason</span>
              <textarea
                rows={2}
                value={draft.decisionReason}
                onChange={(event) => setDraft((current) => ({ ...current, decisionReason: event.target.value }))}
              />
            </label>
            <label className="filter-field">
              <span>Issue category</span>
              <select value={draft.issueCategory} onChange={(event) => setDraft((current) => ({ ...current, issueCategory: event.target.value }))}>
                <option value="">Choose category</option>
                {QA_ISSUE_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selfPeerReview ? (
            canOverrideSelfReview ? (
              <div className="shared-job-prod__qa-note shared-job-prod__qa-note--warning">
                <strong>Self-review override required</strong>
                <label className="shared-job-prod__qa-inline-check">
                  <input
                    type="checkbox"
                    checked={draft.overrideSameReviewer}
                    onChange={(event) => setDraft((current) => ({ ...current, overrideSameReviewer: event.target.checked }))}
                  />
                  <span>Approve peer self-review override</span>
                </label>
                {draft.overrideSameReviewer ? (
                  <label className="filter-field filter-field--wide">
                    <span>Override reason</span>
                    <textarea
                      rows={2}
                      value={draft.overrideReason}
                      onChange={(event) => setDraft((current) => ({ ...current, overrideReason: event.target.value }))}
                    />
                  </label>
                ) : null}
              </div>
            ) : (
              <div className="shared-job-prod__qa-note shared-job-prod__qa-note--warning">
                <strong>Independent review required</strong>
                <p>Peer review cannot be assigned back to the original owner without a specific override permission.</p>
              </div>
            )
          ) : null}

          {localError ? (
            <div className="shared-job-list__error" role="alert">
              {localError}
            </div>
          ) : null}

          <WorkspaceActionBar align="end" compact>
            <button type="button" className="secondary-button" onClick={() => void submit("request")}>
              {reviewIdForMutation ? "Requeue Review" : "Request Review"}
            </button>
            <button type="button" className="secondary-button" onClick={() => void submit("start")}>
              Start Review
            </button>
            <button type="button" className="secondary-button" onClick={() => void submit("approve")}>
              Approve Stage
            </button>
            <button type="button" className="secondary-button" onClick={() => void submit("send_back")}>
              Send Back
            </button>
          </WorkspaceActionBar>
        </div>
      ) : null}
      {latestReview && (findings.length > 0 || gate.key === "peer_review" || gate.key === "final_release_review" || isQaReviewFailed(latestReview)) ? (
        <QAFindingList review={latestReview} findings={findings} canManage={canManage} onSave={onSaveQaFinding} />
      ) : null}
      {reviewHistory.length > 1 ? (
        <div className="shared-job-prod__detail-list">
          {reviewHistory.slice(1).map((review) => (
            <article key={review.id} className="shared-job-prod__detail-list-item">
              <div>
                <strong>{buildQaHistoryLabel(review)}</strong>
                <p>
                  {review.reviewer_name ?? "Reviewer pending"} | {humanizeToken(review.status)} | {review.sample_size_percent != null ? `${review.sample_size_percent}% sample` : "Sample pending"}
                </p>
                {review.decision_reason ? <p>{review.decision_reason}</p> : null}
              </div>
              <div className="shared-job-preview__status-row">
                <StatusPill label={humanizeToken(review.status)} tone={productionStatusTone(review.status)} />
                {review.issue_category ? <StatusPill label={humanizeToken(review.issue_category)} tone="warning" /> : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function DeliverableCard({
  deliverable,
  canManage,
  onSave
}: {
  deliverable: SharedDeliverableItem;
  canManage: boolean;
  onSave: (productionItemId: string, input: SharedDeliverableItemInput, deliverableId?: string) => Promise<void>;
}) {
  return (
    <article className="shared-job-prod__item-card">
      <div className="shared-job-detail__list-card-header">
        <div>
          <h4>{deliverable.title}</h4>
          <p className="shared-job-sidebar__muted">{humanizeToken(deliverable.deliverable_type)} | {humanizeToken(deliverable.delivery_method)}</p>
        </div>
        <StatusPill label={humanizeToken(deliverable.status)} tone={statusTone(deliverable.status)} />
      </div>
      <div className="shared-job-prod__kv">
        <span>Recipient: {deliverable.recipient_contact_name ?? deliverable.recipient_organization_name ?? "Pending"}</span>
        <span>Tracking: {deliverable.tracking_reference ?? "None"}</span>
        <span>Delivered: {deliverable.delivered_at ? formatDateTime(deliverable.delivered_at) : "Not delivered"}</span>
      </div>
      {canManage ? (
        <WorkspaceActionBar align="end" compact>
          <button type="button" className="secondary-button" onClick={() => void onSave(deliverable.production_item_id, { status: "sent" }, deliverable.id)}>
            Mark Sent
          </button>
          <button type="button" className="secondary-button" onClick={() => void onSave(deliverable.production_item_id, { status: "delivered" }, deliverable.id)}>
            Mark Delivered
          </button>
          <button type="button" className="secondary-button" onClick={() => void onSave(deliverable.production_item_id, { status: "confirmed" }, deliverable.id)}>
            Confirm
          </button>
        </WorkspaceActionBar>
      ) : null}
    </article>
  );
}

export function ProductionIssuesPanel({
  productionItems,
  issues,
  canManage,
  staffOptions,
  onSave
}: {
  productionItems: SharedProductionItem[];
  issues: SharedProductionIssue[];
  canManage: boolean;
  staffOptions: DirectoryOwnerOption[];
  onSave: (productionItemId: string, input: SharedProductionIssueInput, issueId?: string) => Promise<void>;
}) {
  const [productionItemId, setProductionItemId] = useState(productionItems[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [severity, setSeverity] = useState<"low" | "medium" | "high" | "critical">("medium");

  useEffect(() => {
    setProductionItemId((current) => current || productionItems[0]?.id || "");
  }, [productionItems]);

  return (
    <section className="shared-job-prod__card">
      <WorkspaceSectionHeader title="Production Issues" summary="Structured downstream issues stay visible, assignable, and auditable." />
      {issues.length ? (
        <div className="shared-job-prod__stack">
          {issues.map((issue) => (
            <article key={issue.id} className="shared-job-prod__item-card">
              <div className="shared-job-detail__list-card-header">
                <div>
                  <h4>{issue.title}</h4>
                  <p className="shared-job-sidebar__muted">{humanizeToken(issue.issue_type)} | {issue.owner_name ?? "Unassigned"}</p>
                </div>
                <StatusPill label={humanizeToken(issue.status)} tone={statusTone(issue.status)} />
              </div>
              <p className="shared-job-prod__copy">{issue.description}</p>
              <div className="shared-job-prod__kv">
                <span>{humanizeToken(issue.severity)}</span>
                <span>{issue.due_at ? `Due ${formatDate(issue.due_at)}` : "No due timing"}</span>
              </div>
              {canManage ? (
                <WorkspaceActionBar align="end" compact>
                  <button type="button" className="secondary-button" onClick={() => void onSave(issue.production_item_id, { status: "acknowledged" }, issue.id)}>
                    Acknowledge
                  </button>
                  <button type="button" className="secondary-button" onClick={() => void onSave(issue.production_item_id, { status: "resolved" }, issue.id)}>
                    Resolve
                  </button>
                  <button type="button" className="secondary-button" onClick={() => void onSave(issue.production_item_id, { status: "dismissed" }, issue.id)}>
                    Dismiss
                  </button>
                </WorkspaceActionBar>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <WorkspaceEmptyState title="No downstream issues" summary="Missing files, approval delays, vendor blockers, and delivery problems will appear here." compact />
      )}
      {canManage ? (
        <div className="shared-job-prod__mini-form">
          <div className="field-grid shared-job-form__grid">
            <label className="filter-field">
              <span>Production item</span>
              <select value={productionItemId} onChange={(event) => setProductionItemId(event.target.value)}>
                {productionItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Severity</span>
              <select value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <SharedStaffPicker
              label="Owner"
              value={ownerUserId}
              options={staffOptions}
              onChange={setOwnerUserId}
              emptyLabel="Assign owner"
            />
            <label className="filter-field filter-field--wide">
              <span>Issue title</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="filter-field filter-field--wide">
              <span>Issue detail</span>
              <textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
          </div>
          <WorkspaceActionBar align="end" compact>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                if (!title.trim()) {
                  return;
                }
                void onSave(productionItemId, {
                  issue_type: "other",
                  severity,
                  title: title.trim(),
                  description: description.trim() || "Production issue logged",
                  owner_user_id: ownerUserId || null,
                  status: "open"
                });
                setTitle("");
                setDescription("");
              }}
            >
              Log Issue
            </button>
          </WorkspaceActionBar>
        </div>
      ) : null}
    </section>
  );
}

type ProductionDetailSnapshot = {
  detail: SharedJobDetailResponse;
  item: SharedProductionItem;
  approvals: SharedApprovalRequest[];
  reviews: SharedQaReview[];
  findings: SharedQaFinding[];
  deliverables: SharedDeliverableItem[];
  issues: SharedProductionIssue[];
  blockers: SharedProductionIssue[];
  handoffs: SharedProductionHandoff[];
  shootLinks: SharedProductionItemShootLink[];
};

function buildProductionDetailSnapshot(detail: SharedJobDetailResponse | null | undefined, itemId: string): ProductionDetailSnapshot | null {
  if (!detail) {
    return null;
  }
  const item = detail.production_items.find((candidate) => candidate.id === itemId);
  if (!item) {
    return null;
  }
  const reviews = detail.qa_reviews.filter((review) => review.production_item_id === itemId);
  const reviewIds = new Set(reviews.map((review) => review.id));
  return {
    detail,
    item,
    approvals: detail.approval_requests.filter((request) => request.production_item_id === itemId),
    reviews,
    findings: detail.qa_findings.filter((finding) => reviewIds.has(finding.qa_review_record_id)),
    deliverables: detail.deliverable_items.filter((deliverable) => deliverable.production_item_id === itemId),
    issues: detail.production_issues.filter((issue) => issue.production_item_id === itemId),
    blockers: (detail.production_blockers ?? []).filter((issue) => issue.production_item_id === itemId),
    handoffs: detail.production_handoffs.filter((handoff) => handoff.production_item_id === itemId),
    shootLinks: (detail.production_item_shoot_links ?? []).filter((link) => link.production_item_id === itemId)
  };
}

function ProductionDetailSection({
  title,
  children,
  collapsed = false,
  defaultOpen = true
}: {
  title: string;
  children: ReactNode;
  collapsed?: boolean;
  defaultOpen?: boolean;
}) {
  if (collapsed) {
    return (
      <details className="shared-job-prod__detail-section shared-job-prod__detail-section--collapsed" open={defaultOpen}>
        <summary>{title}</summary>
        <div className="shared-job-prod__detail-section-body">{children}</div>
      </details>
    );
  }
  return (
    <section className="shared-job-prod__detail-section">
      <WorkspaceSectionHeader title={title} compact />
      <div className="shared-job-prod__detail-section-body">{children}</div>
    </section>
  );
}

function renderCompactValue(label: string, value: ReactNode) {
  return (
    <div className="shared-job-prod__detail-kv-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProductionDetailPanel({
  token,
  selectedItem,
  snapshot,
  detailLoading,
  detailError,
  currentUser,
  canManage,
  ownerOptions,
  onSaveProductionItem
}: {
  token: string;
  selectedItem: SharedProductionQueueItem | null;
  snapshot: ProductionDetailSnapshot | null;
  detailLoading: boolean;
  detailError: string;
  currentUser: SessionUser;
  canManage: boolean;
  ownerOptions: DirectoryOwnerOption[];
  onSaveProductionItem: (item: SharedProductionQueueItem, input: SharedProductionItemInput) => Promise<void>;
}) {
  const [workflowStatus, setWorkflowStatus] = useState<ProductionBoardWorkflowStatus | "">("");
  const [priority, setPriority] = useState<SharedProductionQueueItem["priority"] | "">("");
  const [ownerId, setOwnerId] = useState("");
  const [productionNotes, setProductionNotes] = useState("");
  const [postShootEvalSummary, setPostShootEvalSummary] = useState("");
  const [transitionValidation, setTransitionValidation] = useState<ChecklistTransitionValidation | null>(null);
  const [transitionInput, setTransitionInput] = useState<SharedProductionItemInput | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [checklistInstances, setChecklistInstances] = useState<ChecklistInstanceDetail[]>([]);
  const [preferredChecklistInstanceId, setPreferredChecklistInstanceId] = useState<string | null>(null);

  useEffect(() => {
    setWorkflowStatus((snapshot?.item.workflow_status ?? selectedItem?.workflow_status ?? "") as ProductionBoardWorkflowStatus | "");
    setPriority((snapshot?.item.priority ?? selectedItem?.priority ?? "") as SharedProductionQueueItem["priority"] | "");
    setOwnerId(snapshot?.item.assigned_to_user_id ?? selectedItem?.assigned_to_user_id ?? "");
    setProductionNotes(snapshot?.item.production_notes ?? "");
    setPostShootEvalSummary(snapshot?.item.post_shoot_eval_summary ?? "");
    setChecklistInstances([]);
    setPreferredChecklistInstanceId(null);
  }, [selectedItem, snapshot]);

  if (!selectedItem) {
    return <WorkspaceEmptyState title="Select production work" summary="Choose a production item to inspect the full downstream detail stack." compact />;
  }

  const detailItem = snapshot?.item ?? selectedItem;
  const activity = (snapshot?.detail.activity ?? []).filter(
    (entry) => entry.production_item_id === selectedItem.id || (entry.production_item_id == null && entry.job_id === selectedItem.job_id)
  );
  const attentionItems = buildAttentionItems(detailItem);
  const checklistSummary = buildChecklistRecordSummary(checklistInstances);
  const canOverrideChecklistBlock = hasPermission(currentUser, "checklist.override.soft_block") || hasAuthorityTier(currentUser, ["leadership", "super_admin"]);

  async function runChecklistValidatedSave(input: SharedProductionItemInput) {
    if (!selectedItem) {
      return;
    }
    const nextWorkflowStatus = input.workflow_status ?? null;
    if (nextWorkflowStatus && nextWorkflowStatus !== detailItem.workflow_status) {
      const response = await validateChecklistTransition(token, {
        resource_type: "production_item",
        from_stage: detailItem.workflow_status,
        to_stage: nextWorkflowStatus,
        department_type: detailItem.department_type,
        job_id: detailItem.job_id,
        production_item_id: detailItem.id
      });
      const validation = response.validation;
      if (!validation.allowed) {
        setTransitionValidation(validation);
        setTransitionInput(input);
        setOverrideReason("");
        return;
      }
    }
    await onSaveProductionItem(selectedItem, input);
  }

  async function handleChecklistOverride() {
    if (!selectedItem || !transitionInput || !transitionValidation || !overrideReason.trim()) {
      return;
    }
    setTransitionBusy(true);
    try {
      await onSaveProductionItem(selectedItem, {
        ...transitionInput,
        allow_checklist_override: true,
        checklist_override_reason: overrideReason.trim()
      });
      setTransitionValidation(null);
      setTransitionInput(null);
      setOverrideReason("");
    } finally {
      setTransitionBusy(false);
    }
  }

  return (
    <>
      <DetailPreviewPanel
        title={`${selectedItem.id.slice(0, 8).toUpperCase()} | ${selectedItem.title}`}
        subtitle={`${selectedItem.organization_name ?? "Unassigned organization"} | ${selectedItem.job_number ?? selectedItem.job_title}`}
        actions={
          <WorkspaceActionBar align="end" compact>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = `${toRouteBase(selectedItem.department_type as QueueDepartment)}/${selectedItem.job_id}?tab=production`)}>
              Open Linked Job
            </button>
          </WorkspaceActionBar>
        }
      >
        <div className="shared-job-prod__stack">
        <div className="shared-job-prod__detail-header">
          <div className="shared-job-prod__detail-header-copy">
            <div className="shared-job-preview__status-row">
              <StatusPill label={humanizeToken(detailItem.workflow_status)} tone={productionStatusTone(detailItem.workflow_status)} />
              <StatusPill label={humanizeToken(detailItem.health_state)} tone={productionStatusTone(detailItem.health_state)} />
              <StatusPill label={`Release ${humanizeToken(detailItem.release_status)}`} tone={productionStatusTone(detailItem.release_status)} />
              <StatusPill label={`${detailItem.open_blocker_count} blocker${detailItem.open_blocker_count === 1 ? "" : "s"}`} tone={detailItem.open_blocker_count ? "danger" : "success"} />
              {detailItem.checklist_overdue_count ? <StatusPill label={`${detailItem.checklist_overdue_count} overdue checklist${detailItem.checklist_overdue_count === 1 ? "" : "s"}`} tone="danger" /> : null}
              {detailItem.checklist_missing_proof_count ? <StatusPill label={`${detailItem.checklist_missing_proof_count} missing proof`} tone="warning" /> : null}
              {detailItem.production_template_key ? <StatusPill label={humanizeToken(detailItem.production_template_key)} tone="info" /> : null}
            </div>
            <div className="shared-job-prod__detail-kv-grid">
              {renderCompactValue("Owner", detailItem.assigned_to_name ?? "Unassigned")}
              {renderCompactValue("Due Date", detailItem.due_at ? formatDate(detailItem.due_at) : "No due date")}
              {renderCompactValue("Readiness Score", `${detailItem.readiness_score}%`)}
              {renderCompactValue("Linked Shoots", detailItem.linked_shoot_ids.length ? detailItem.linked_shoot_ids.length : "None")}
            </div>
            {attentionItems.length ? (
              <div className="shared-job-prod__attention-strip" role="list" aria-label="Production attention summary">
                {attentionItems.map((attention) => (
                  <span key={attention.key} role="listitem" className={`shared-job-prod__attention-chip tone-${attention.tone}`}>
                    {attention.label}
                  </span>
                ))}
              </div>
            ) : null}
            {renderChecklistIndicators(detailItem, { maxVisible: 4 })}
            {checklistSummary.total_count ? (
              <ChecklistStatusSummary
                instances={checklistInstances}
                compact
                title="Checklist Status"
                summary="Missing proof, approvals, and checklist blocks on this production item."
                onOpenBlockingChecklist={(instanceId) => setPreferredChecklistInstanceId(instanceId)}
              />
            ) : null}
          </div>
        </div>

        {detailItem.open_blocker_count || detailItem.blocked_reason || (snapshot?.issues.length ?? 0) ? (
          <BlockedProductionBanner item={detailItem} approvals={snapshot?.approvals ?? []} findings={snapshot?.findings ?? []} issues={snapshot?.issues ?? []} />
        ) : null}

        {detailLoading ? (
          <WorkspaceLoadingBlock title="Loading production detail" summary="Pulling the linked job record and item-level downstream context." className="shared-job-prod__detail-loading" />
        ) : detailError ? (
          <div className="shared-job-list__error" role="alert">
            {detailError}
          </div>
        ) : null}

        <ProductionDetailSection title="Overview">
          <div className="shared-job-prod__detail-kv-grid">
            {renderCompactValue("Production ID", selectedItem.id.slice(0, 8).toUpperCase())}
            {renderCompactValue("Department", humanizeToken(selectedItem.department_type))}
            {renderCompactValue("Production Type", humanizeToken(detailItem.production_type))}
            {renderCompactValue("Template", detailItem.production_template_key ? humanizeToken(detailItem.production_template_key) : "Shared default")}
            {renderCompactValue("Completion Rule", detailItem.completion_rule_key ? humanizeToken(detailItem.completion_rule_key) : "Shared rule")}
            {renderCompactValue("Sync State", humanizeToken(detailItem.sync_state))}
            {renderCompactValue("Days Open", detailItem.days_open)}
            {renderCompactValue("Days To Due", detailItem.days_to_due ?? "TBD")}
            {renderCompactValue("Stage Age", detailItem.stage_age)}
            {renderCompactValue("On Time", detailItem.on_time_flag == null ? "Unknown" : detailItem.on_time_flag ? "Yes" : "No")}
          </div>
        </ProductionDetailSection>

        <ProductionDetailSection title="Linked Job and Shoot Info">
          <div className="shared-job-prod__detail-kv-grid">
            {renderCompactValue("Job", selectedItem.job_number ?? selectedItem.job_title)}
            {renderCompactValue("Organization", selectedItem.organization_name ?? "Unassigned")}
            {renderCompactValue("Location", selectedItem.primary_location_name ?? detailItem.location_name ?? "TBD")}
            {renderCompactValue("Primary Contact", selectedItem.primary_contact_name ?? detailItem.primary_contact_name ?? "TBD")}
            {renderCompactValue("Shoot Window", formatShootRange(selectedItem))}
            {renderCompactValue("Shoot IDs", detailItem.linked_shoot_ids.length ? detailItem.linked_shoot_ids.join(", ") : "None linked")}
          </div>
        </ProductionDetailSection>

        <ProductionDetailSection title="Intake and File Readiness">
          <FileReceiptCard item={detailItem} canManage={canManage} onSave={(input) => onSaveProductionItem(selectedItem, input)} />
          <div className="shared-job-prod__detail-kv-grid">
            {renderCompactValue("File Match", humanizeToken(detailItem.file_match_status))}
            {renderCompactValue("Roster Received", detailItem.roster_received ? "Yes" : "No")}
            {renderCompactValue("Naming Verified", detailItem.naming_verified ? "Yes" : "No")}
            {renderCompactValue("Folder Structure", detailItem.folder_structure_verified ? "Yes" : "No")}
            {renderCompactValue("Tags / Flags", detailItem.tags_or_flags_verified ? "Yes" : "No")}
            {renderCompactValue("Handoff Complete", detailItem.handoff_complete ? "Yes" : "No")}
          </div>
        </ProductionDetailSection>

        <ProductionDetailSection title="Production Workflow">
          <div className="shared-job-prod__detail-kv-grid">
            {renderCompactValue("Workflow", humanizeToken(detailItem.workflow_status))}
            {renderCompactValue("Legacy Status", humanizeToken(detailItem.status))}
            {renderCompactValue("Priority", humanizeToken(detailItem.priority))}
            {renderCompactValue("Production Start", detailItem.production_start_at ? formatDate(detailItem.production_start_at) : "Not started")}
            {renderCompactValue("Peer Reviewer", detailItem.assigned_peer_reviewer_name ?? "Unassigned")}
            {renderCompactValue("Release Reviewer", detailItem.assigned_release_reviewer_name ?? "Unassigned")}
          </div>
          {canManage ? (
            <div className="shared-job-prod__mini-form">
              <div className="field-grid shared-job-form__grid">
                <label className="filter-field">
                  <span>Workflow Status</span>
                  <select value={workflowStatus} onChange={(event) => setWorkflowStatus(event.target.value as ProductionBoardWorkflowStatus)}>
                    {[
                      "DRAFT",
                      "WAITING_ON_INTAKE",
                      "WAITING_ON_FILES",
                      "INTAKE_REVIEW",
                      "READY_FOR_PRODUCTION",
                      "IN_PRODUCTION",
                      "READY_FOR_QA",
                      "IN_PEER_REVIEW",
                      "REWORK_REQUIRED",
                      "READY_FOR_UPLOAD",
                      "UPLOADING",
                      "UPLOADED",
                      "READY_FOR_RELEASE",
                      "RELEASED",
                      "SENT_TO_VENDOR",
                      "DELIVERED_CLOSED",
                      "ON_HOLD",
                      "BLOCKED",
                      "CANCELLED"
                    ].map((value) => (
                      <option key={value} value={value}>
                        {humanizeToken(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="filter-field">
                  <span>Priority</span>
                  <select value={priority} onChange={(event) => setPriority(event.target.value as SharedProductionQueueItem["priority"])}>
                    {["low", "normal", "high", "urgent"].map((value) => (
                      <option key={value} value={value}>
                        {humanizeToken(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <SharedStaffPicker label="Owner" value={ownerId} options={ownerOptions} onChange={(value) => setOwnerId(value || "")} emptyLabel="Choose owner" />
              </div>
              <WorkspaceActionBar align="end" compact>
                <button type="button" className="secondary-button" onClick={() => void runChecklistValidatedSave({ workflow_status: workflowStatus || null, priority: priority || null, assigned_to_user_id: ownerId || null })}>
                  Save Workflow
                </button>
                <button type="button" className="secondary-button" onClick={() => void onSaveProductionItem(selectedItem, { assigned_to_user_id: currentUser.id })}>
                  Assign To Me
                </button>
              </WorkspaceActionBar>
            </div>
          ) : null}
        </ProductionDetailSection>

        <ProductionDetailSection title="Workflow Checklists">
          <ChecklistRuntimePanel
            token={token}
            currentUser={currentUser}
            scopeType="production_item"
            scopeId={detailItem.id}
            departmentType={detailItem.department_type}
            allowEdit={canManage}
            staffOptions={ownerOptions}
            preferredInstanceId={preferredChecklistInstanceId}
            onInstancesChange={setChecklistInstances}
          />
        </ProductionDetailSection>

        <ProductionDetailSection title="QA / Peer Review">
          <div className="shared-job-prod__detail-kv-grid">
            {renderCompactValue("QA Summary", humanizeToken(selectedItem.qa_summary_status))}
            {renderCompactValue("Creator Review", detailItem.creator_review_complete ? "Complete" : "Pending")}
            {renderCompactValue("Peer Review", detailItem.peer_review_complete ? "Complete" : "Pending")}
            {renderCompactValue("Final Release Review", detailItem.final_release_review_complete ? "Complete" : "Pending")}
            {renderCompactValue("QA Fail Count", detailItem.qa_fail_count)}
            {renderCompactValue("First Pass Approved", detailItem.first_pass_approved ? "Yes" : "No")}
            {renderCompactValue("Rework Count", detailItem.rework_count)}
          </div>
          {snapshot?.reviews.length ? (
            <div className="shared-job-prod__detail-list">
              {snapshot.reviews.map((review) => (
                <article key={review.id} className="shared-job-prod__detail-list-item">
                  <div>
                    <strong>{buildQaHistoryLabel(review)}</strong>
                    <p>
                      {review.reviewer_name ?? "Reviewer pending"} | {humanizeToken(review.status)} | {review.sample_size_percent != null ? `${review.sample_size_percent}% sample` : "Sample pending"}
                    </p>
                    {review.decision_reason ? <p>{review.decision_reason}</p> : null}
                    {review.issue_category ? <p>Issue category: {humanizeToken(review.issue_category)}</p> : null}
                    {review.accountability_stage_key ? (
                      <p>
                        Accountability: {review.accountable_owner_name ?? "owner"} and {review.accountable_reviewer_name ?? "reviewer"} from {humanizeToken(review.accountability_stage_key)}
                      </p>
                    ) : null}
                  </div>
                  <div className="shared-job-preview__status-row">
                    <StatusPill label={humanizeToken(review.status)} tone={productionStatusTone(review.status)} />
                    {review.rework_required ? <StatusPill label="Rework" tone="warning" /> : null}
                    {review.override_same_reviewer ? <StatusPill label="Override" tone="danger" /> : null}
                  </div>
                </article>
              ))}
              {snapshot.findings.map((finding) => (
                <article key={finding.id} className="shared-job-prod__detail-list-item shared-job-prod__detail-list-item--warning">
                  <div>
                    <strong>{finding.title}</strong>
                    <p>{finding.description}</p>
                  </div>
                  <div className="shared-job-preview__status-row">
                    <StatusPill label={humanizeToken(finding.severity)} tone={productionStatusTone(finding.severity)} />
                    {finding.is_blocking ? <StatusPill label="Blocking" tone="danger" /> : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <WorkspaceEmptyState title="No QA records yet" summary="Peer review and QA findings for this production item will appear here." compact />
          )}
        </ProductionDetailSection>

        <ProductionDetailSection title="Upload and Release">
          <div className="shared-job-prod__detail-kv-grid">
            {renderCompactValue("Upload Status", humanizeToken(detailItem.upload_status))}
            {renderCompactValue("Release State", humanizeToken(detailItem.release_status))}
            {renderCompactValue("Release Target", detailItem.release_target ?? "Not set")}
            {renderCompactValue("Gallery / Output Ref", detailItem.gallery_or_output_reference ?? "Not linked")}
            {renderCompactValue("Vendor", detailItem.vendor_name ?? "Internal")}
            {renderCompactValue("Vendor Ref", detailItem.vendor_reference ?? "None")}
          </div>
          {canManage ? (
            <WorkspaceActionBar align="end" compact>
              <button type="button" className="secondary-button" onClick={() => void runChecklistValidatedSave({ upload_status: "UPLOADED", workflow_status: "UPLOADED" })}>
                Mark Uploaded
              </button>
              <button type="button" className="secondary-button" onClick={() => void runChecklistValidatedSave({ workflow_status: "READY_FOR_RELEASE", release_status: "READY_FOR_RELEASE" })}>
                Ready for Release
              </button>
              <button type="button" className="secondary-button" onClick={() => void onSaveProductionItem(selectedItem, { workflow_status: "RELEASED", release_status: "RELEASED" })}>
                Mark Released
              </button>
            </WorkspaceActionBar>
          ) : null}
        </ProductionDetailSection>

        <ProductionDetailSection title="Deliverables">
          {snapshot?.deliverables.length ? (
            <div className="shared-job-prod__detail-list">
              {snapshot.deliverables.map((deliverable) => (
                <article key={deliverable.id} className="shared-job-prod__detail-list-item">
                  <div>
                    <strong>{deliverable.title}</strong>
                    <p>{humanizeToken(deliverable.deliverable_type)} | {deliverable.recipient_organization_name ?? deliverable.recipient_contact_name ?? "Recipient pending"}</p>
                    {deliverable.deliverable_group_key || deliverable.completion_marker_key ? (
                      <p>
                        {deliverable.deliverable_group_key ? `Group: ${humanizeToken(deliverable.deliverable_group_key)}` : "Group: Shared"}
                        {deliverable.completion_marker_key ? ` | Completion marker: ${humanizeToken(deliverable.completion_marker_key)}` : ""}
                      </p>
                    ) : null}
                    {deliverable.legacy_source_reference ? <p>Legacy source: {deliverable.legacy_source_reference}</p> : null}
                  </div>
                  <div className="shared-job-preview__status-row">
                    <StatusPill label={humanizeToken(deliverable.status)} tone={productionStatusTone(deliverable.status)} />
                    <span>{deliverable.tracking_reference ?? deliverable.delivery_method}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <WorkspaceEmptyState title="No deliverables yet" summary="Delivery outputs and gallery handoffs for this item will appear here." compact />
          )}
        </ProductionDetailSection>

        <ProductionDetailSection title="Notes and Post-Shoot Evaluation">
          {canManage ? (
            <div className="shared-job-prod__mini-form">
              <div className="shared-job-prod__detail-note-stack">
                <div>
                  <strong>Internal Notes</strong>
                  <p>{detailItem.internal_notes ?? "No internal notes yet."}</p>
                </div>
              </div>
              <label className="filter-field filter-field--wide">
                <span>Production Notes</span>
                <textarea rows={3} value={productionNotes} onChange={(event) => setProductionNotes(event.target.value)} />
              </label>
              <label className="filter-field filter-field--wide">
                <span>Post-Shoot Evaluation</span>
                <textarea rows={3} value={postShootEvalSummary} onChange={(event) => setPostShootEvalSummary(event.target.value)} />
              </label>
              <WorkspaceActionBar align="end" compact>
                <button type="button" className="secondary-button" onClick={() => void onSaveProductionItem(selectedItem, { production_notes: productionNotes || null, post_shoot_eval_summary: postShootEvalSummary || null })}>
                  Save Notes
                </button>
              </WorkspaceActionBar>
            </div>
          ) : (
            <div className="shared-job-prod__detail-note-stack">
              <div>
                <strong>Internal Notes</strong>
                <p>{detailItem.internal_notes ?? "No internal notes yet."}</p>
              </div>
              <div>
                <strong>Production Notes</strong>
                <p>{detailItem.production_notes ?? "No production notes yet."}</p>
              </div>
              <div>
                <strong>Post-Shoot Evaluation</strong>
                <p>{detailItem.post_shoot_eval_summary ?? "No post-shoot evaluation yet."}</p>
              </div>
            </div>
          )}
          <details className="shared-job-prod__archived-notes" open={false}>
            <summary>Archived Notes and Legacy References</summary>
            <div className="shared-job-prod__detail-note-stack">
              <div>
                <strong>Legacy Source Reference</strong>
                <p>{detailItem.legacy_source_reference ?? "No legacy source reference."}</p>
              </div>
              <div>
                <strong>Hold Reason</strong>
                <p>{detailItem.hold_reason ?? "No hold reason recorded."}</p>
              </div>
            </div>
          </details>
        </ProductionDetailSection>

        <ProductionDetailSection title="Activity Log" collapsed defaultOpen={false}>
          {activity.length ? (
            <div className="shared-job-detail__timeline">
              {activity.map((entry) => (
                <div key={entry.id} className="shared-job-detail__timeline-entry">
                  <strong>{humanizeToken(entry.event_type)}</strong>
                  <span>{entry.actor_name ?? "System"} | {formatDateTime(entry.created_at)}</span>
                  <span>{entry.summary}</span>
                </div>
              ))}
            </div>
          ) : (
            <WorkspaceEmptyState title="No activity yet" summary="Activity for this production item will appear here when work moves." compact />
          )}
        </ProductionDetailSection>

        <ProductionDetailSection title="Sync / Integration Details" collapsed defaultOpen={false}>
          <div className="shared-job-prod__detail-kv-grid">
            {renderCompactValue("Created From", detailItem.created_from_source ?? "System")}
            {renderCompactValue("Sync State", humanizeToken(detailItem.sync_state))}
            {renderCompactValue("Template", detailItem.production_template_key ? humanizeToken(detailItem.production_template_key) : "Shared default")}
            {renderCompactValue("Completion Rule", detailItem.completion_rule_key ? humanizeToken(detailItem.completion_rule_key) : "Shared rule")}
            {renderCompactValue("Legacy Source", detailItem.legacy_source_reference ?? "None")}
            {renderCompactValue("Imported Status", detailItem.imported_status_source ?? "None")}
            {renderCompactValue("Merged Into", detailItem.merged_into_production_item_id ?? "No merge target")}
            {renderCompactValue("Hold Reason", detailItem.hold_reason ?? "No hold")}
            {renderCompactValue("Hold Review", detailItem.hold_review_at ? formatDateTime(detailItem.hold_review_at) : "Not scheduled")}
          </div>
        </ProductionDetailSection>
      </div>
      </DetailPreviewPanel>
      <ChecklistTransitionBlockModal
        open={Boolean(transitionValidation)}
        validation={transitionValidation}
        canOverride={canOverrideChecklistBlock && Boolean(transitionValidation?.soft_blocked)}
        overrideReason={overrideReason}
        busy={transitionBusy}
        onOverrideReasonChange={setOverrideReason}
        onClose={() => {
          setTransitionValidation(null);
          setTransitionInput(null);
          setOverrideReason("");
        }}
        onConfirmOverride={() => void handleChecklistOverride()}
      />
    </>
  );
}

export function ProductionItemTable({
  items,
  selectedIds,
  onToggleSelection,
  onSelectItem,
  activeItemId
}: {
  items: SharedProductionQueueItem[];
  selectedIds: string[];
  onToggleSelection: (itemId: string, checked: boolean) => void;
  onSelectItem: (item: SharedProductionQueueItem) => void;
  activeItemId: string | null;
}) {
  const [isNarrowLayout, setIsNarrowLayout] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return false;
    }
    const mediaQuery = window.matchMedia("(max-width: 860px)");
    return Boolean(mediaQuery?.matches);
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 860px)");
    if (!mediaQuery) {
      return;
    }
    const legacyMediaQuery = mediaQuery as MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent | MediaQueryList) => void) => void;
      removeListener?: (listener: (event: MediaQueryListEvent | MediaQueryList) => void) => void;
    };
    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsNarrowLayout(event.matches);
    };

    handleChange(mediaQuery);

    if ("addEventListener" in mediaQuery) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    legacyMediaQuery.addListener?.(handleChange);
    return () => legacyMediaQuery.removeListener?.(handleChange);
  }, []);

  if (isNarrowLayout) {
    return (
      <div className="shared-job-prod__mobile-list" aria-label="Production Board mobile list">
        {items.map((item) => (
          <article
            key={item.id}
            className={`shared-job-prod__mobile-card${activeItemId === item.id ? " is-active" : ""}${getQueueRowClass(item)}`}
            role="button"
            aria-label={`Open ${item.title}`}
            tabIndex={0}
            onClick={() => onSelectItem(item)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectItem(item);
              }
            }}
          >
            <div className="shared-job-prod__mobile-card-header">
              <div className="shared-job-prod__cell-stack">
                <strong>{item.title}</strong>
                <span className="shared-job-prod__cell-meta">{item.organization_name ?? "Unassigned organization"} | {item.job_number ?? item.job_title}</span>
              </div>
              <input
                type="checkbox"
                aria-label={`Select ${item.title}`}
                checked={selectedIds.includes(item.id)}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onToggleSelection(item.id, event.target.checked)}
              />
            </div>
            <div className="shared-job-prod__mobile-card-statuses">
              <StatusPill label={humanizeToken(item.health_state)} tone={productionStatusTone(item.health_state)} />
              <StatusPill label={humanizeToken(item.workflow_status)} tone={productionStatusTone(item.workflow_status)} />
              <StatusPill label={humanizeToken(item.release_status)} tone={productionStatusTone(item.release_status)} />
            </div>
            {renderChecklistIndicators(item, { compact: true, maxVisible: 2 })}
            <div className="shared-job-prod__mobile-card-grid">
              <div className="shared-job-prod__cell-stack">
                <strong>{item.due_at ? formatDate(item.due_at) : "No due date"}</strong>
                <span className={`shared-job-prod__cell-meta${isOverdueProductionItem(item) ? " is-danger" : item.days_to_due != null && item.days_to_due <= 1 ? " is-warning" : ""}`}>
                  {getDueStateLabel(item)}
                </span>
              </div>
              <div className="shared-job-prod__cell-stack">
                <strong>{item.assigned_to_name ?? "Unassigned"}</strong>
                <span className="shared-job-prod__cell-meta">Owner</span>
              </div>
              <div className="shared-job-prod__cell-stack">
                <strong>{getBlockerLabel(item)}</strong>
                <span className={`shared-job-prod__cell-meta${item.blocked_reason ? " is-danger" : ""}`}>
                  {item.blocked_reason ?? `${humanizeToken(item.production_type)} | ${formatShootRange(item)}`}
                </span>
              </div>
              <div className="shared-job-prod__cell-stack">
                <strong>{item.production_group_key || item.id.slice(0, 8).toUpperCase()}</strong>
                <span className="shared-job-prod__cell-meta">Days open: {item.days_open}</span>
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  }

  return (
    <div className="shared-job-prod__table-shell shared-job-prod__table-shell--desktop">
      <table className="shared-job-prod__table">
        <thead>
          <tr>
            <th aria-label="Select" />
            <th>Health</th>
            <th>Workflow Status</th>
            <th>Due Date</th>
            <th>Production ID</th>
            <th>Organization / Job</th>
            <th>Deliverable Type</th>
            <th>Linked Shoot Date</th>
            <th>Owner</th>
            <th>QA State</th>
            <th>Blockers</th>
            <th>Release State</th>
            <th>Sync State</th>
            <th>Days Open</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const rowClass = getQueueRowClass(item);
            return (
              <tr
                key={item.id}
                className={`${activeItemId === item.id ? "is-active" : ""}${rowClass}`}
                tabIndex={0}
                onClick={() => onSelectItem(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectItem(item);
                  }
                }}
              >
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.title}`}
                    checked={selectedIds.includes(item.id)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    onChange={(event) => onToggleSelection(item.id, event.target.checked)}
                  />
                </td>
                <td><StatusPill label={humanizeToken(item.health_state)} tone={productionStatusTone(item.health_state)} /></td>
                <td><StatusPill label={humanizeToken(item.workflow_status)} tone={productionStatusTone(item.workflow_status)} /></td>
                <td>
                  <div className="shared-job-prod__cell-stack">
                    <strong>{item.due_at ? formatDate(item.due_at) : "No due date"}</strong>
                    <span className={`shared-job-prod__cell-meta${isOverdueProductionItem(item) ? " is-danger" : item.days_to_due != null && item.days_to_due <= 1 ? " is-warning" : ""}`}>
                      {getDueStateLabel(item)}
                    </span>
                  </div>
                </td>
                <td>
                  <div className="shared-job-prod__cell-stack">
                    <strong>{item.production_group_key || item.id.slice(0, 8).toUpperCase()}</strong>
                    <span className="shared-job-prod__cell-meta">{item.title}</span>
                  </div>
                </td>
                <td>
                  <div className="shared-job-prod__cell-stack">
                    <strong>{item.organization_name ?? "Unassigned organization"}</strong>
                    <span className="shared-job-prod__cell-meta">{item.job_number ?? item.job_title}</span>
                  </div>
                </td>
                <td>{humanizeToken(item.production_type)}</td>
                <td>{formatShootRange(item)}</td>
                <td>
                  <div className="shared-job-prod__cell-stack">
                    <strong>{item.assigned_to_name ?? "Unassigned"}</strong>
                    {!item.assigned_to_name ? (
                      <span className="shared-job-prod__cell-meta is-warning">Needs assignment</span>
                    ) : item.checklist_awaiting_approval_count ? (
                      <span className="shared-job-prod__cell-meta is-warning">{item.checklist_awaiting_approval_count} awaiting approval</span>
                    ) : null}
                  </div>
                </td>
                <td>
                  <div className="shared-job-prod__cell-stack">
                    <StatusPill label={humanizeToken(item.qa_summary_status)} tone={productionStatusTone(item.qa_summary_status)} />
                    {renderChecklistIndicators(item, { compact: true, maxVisible: 2 })}
                  </div>
                </td>
                <td>
                  <div className="shared-job-prod__cell-stack">
                    <StatusPill
                      label={getBlockerLabel(item)}
                      tone={item.open_blocker_count || item.blocked_reason ? "danger" : "success"}
                    />
                    {item.blocked_reason ? (
                      <span className="shared-job-prod__cell-meta is-danger">{item.blocked_reason}</span>
                    ) : item.blocking_checklist_title ? (
                      <span className="shared-job-prod__cell-meta is-danger">{item.blocking_checklist_title}</span>
                    ) : null}
                  </div>
                </td>
                <td><StatusPill label={humanizeToken(item.release_status)} tone={productionStatusTone(item.release_status)} /></td>
                <td><StatusPill label={humanizeToken(item.sync_state)} tone={productionStatusTone(item.sync_state)} /></td>
                <td>{item.days_open}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProductionItemCard({
  token,
  item,
  approvals,
  reviews,
  findings,
  deliverables,
  issues,
  handoffs,
  canManage,
  staffOptions,
  onSaveProductionItem,
  onSaveHandoff
}: ProductionItemCardProps) {
  const [ownerId, setOwnerId] = useState(item.assigned_to_user_id ?? "");
  const [status, setStatus] = useState(item.status);
  const [blockedReason, setBlockedReason] = useState(item.blocked_reason ?? "");

  useEffect(() => {
    setOwnerId(item.assigned_to_user_id ?? "");
    setStatus(item.status);
    setBlockedReason(item.blocked_reason ?? "");
  }, [item.assigned_to_user_id, item.status, item.blocked_reason, item.id]);

  return (
    <section className="shared-job-prod__item-shell">
      <div className="shared-job-detail__list-card-header">
        <div>
          <h3>{item.title}</h3>
          <p className="shared-job-sidebar__muted">{humanizeToken(item.production_type)} | {item.client_visible_label ?? "Internal downstream work unit"}</p>
        </div>
        <div className="shared-job-preview__status-row">
          <StatusPill label={humanizeToken(item.status)} tone={statusTone(item.status)} />
          {item.approval_required ? <StatusPill label={`${approvals.length} approval${approvals.length === 1 ? "" : "s"}`} tone="warning" /> : null}
          {item.qa_required ? <StatusPill label={`${reviews.length} QA review${reviews.length === 1 ? "" : "s"}`} tone="info" /> : null}
          {deliverables.length ? <StatusPill label={`${deliverables.length} deliverable${deliverables.length === 1 ? "" : "s"}`} tone="success" /> : null}
          {issues.length ? <StatusPill label={`${issues.length} issue${issues.length === 1 ? "" : "s"}`} tone="danger" /> : null}
        </div>
      </div>

      <BlockedProductionBanner item={item} approvals={approvals} findings={findings} issues={issues} />

      <div className="shared-job-prod__detail-grid">
        <section className="shared-job-prod__card">
          <WorkspaceSectionHeader title="Production Overview" compact />
          <div className="shared-job-prod__kv">
            <span>Owner: {item.assigned_to_name ?? "Unassigned"}</span>
            <span>Due: {item.due_at ? formatDate(item.due_at) : "No due date"}</span>
            <span>Delivery deadline: {item.delivery_deadline_at ? formatDate(item.delivery_deadline_at) : "No delivery deadline"}</span>
            <span>Vendor: {item.vendor_name ?? "None"}</span>
          </div>
          {canManage ? (
            <div className="shared-job-prod__mini-form">
              <div className="field-grid shared-job-form__grid">
                <SharedStaffPicker
                  label="Owner"
                  value={ownerId}
                  options={staffOptions}
                  onChange={setOwnerId}
                  emptyLabel="Assign owner"
                />
                <label className="filter-field">
                  <span>Status</span>
                  <select value={status} onChange={(event) => setStatus(event.target.value as SharedProductionItem["status"])}>
                    {[
                      "queued",
                      "awaiting_ingest",
                      "ingest_complete",
                      "editing",
                      "awaiting_internal_review",
                      "proof_build",
                      "proof_sent",
                      "awaiting_approval",
                      "revisions_requested",
                      "approved_for_final",
                      "in_final_production",
                      "ordered_or_sent",
                      "packaged",
                      "delivered",
                      "complete",
                      "blocked"
                    ].map((value) => (
                      <option key={value} value={value}>
                        {humanizeToken(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="filter-field filter-field--wide">
                  <span>Blocked reason</span>
                  <input value={blockedReason} onChange={(event) => setBlockedReason(event.target.value)} placeholder="Only set when there is a real blocker." />
                </label>
              </div>
              <WorkspaceActionBar align="end" compact>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    void onSaveProductionItem(
                      {
                        assigned_to_user_id: ownerId || null,
                        status,
                        blocked_reason: blockedReason.trim() || null
                      },
                      item.id
                    )
                  }
                >
                  Save Production Item
                </button>
              </WorkspaceActionBar>
            </div>
          ) : null}
        </section>

        <FileReceiptCard item={item} canManage={canManage} onSave={(input) => onSaveProductionItem(input, item.id)} />
      </div>

      <RecordResourcesPanel
        token={token}
        objectType="production_item"
        objectId={item.id}
        title="Attached Resources"
        summary="Keep proofs, reference files, SOPs, and support documents with this production item."
      />

      <OperationalApprovalRequestPanel
        token={token}
        sourceModule="production"
        sourceEntityType="production_item"
        sourceEntityId={item.id}
        sourceEntityLabel={item.title}
        title="Production Approvals"
        summary="Request rush, release, or exception approvals tied to this production item without leaving the job detail view."
        canCreate={canManage}
        requestOptions={PRODUCTION_OPERATIONAL_APPROVAL_OPTIONS}
      />

      <div className="shared-job-prod__detail-grid">
        <HandoffTimeline handoffs={handoffs} />
        <HandoffActionPanel productionItemId={item.id} staffOptions={staffOptions} canManage={canManage} onSave={onSaveHandoff} />
      </div>
    </section>
  );
}

export function DeliverablesBoard({
  productionItems,
  deliverables,
  deliverableTypes,
  canManage,
  onSave
}: {
  productionItems: SharedProductionItem[];
  deliverables: SharedDeliverableItem[];
  deliverableTypes: Array<{ value: string; label: string }>;
  canManage: boolean;
  onSave: (productionItemId: string, input: SharedDeliverableItemInput, deliverableId?: string) => Promise<void>;
}) {
  const [productionItemId, setProductionItemId] = useState(productionItems[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [type, setType] = useState(deliverableTypes[0]?.value ?? "gallery_live");

  useEffect(() => {
    setProductionItemId((current) => current || productionItems[0]?.id || "");
  }, [productionItems]);

  return (
    <div className="shared-job-prod__stack">
      {deliverables.length ? (
        deliverables.map((deliverable) => <DeliverableCard key={deliverable.id} deliverable={deliverable} canManage={canManage} onSave={onSave} />)
      ) : (
        <WorkspaceEmptyState title="No deliverables yet" summary="Final outputs, tracking, and delivery confirmation will appear here once downstream work turns into something deliverable." />
      )}
      {canManage ? (
        <section className="shared-job-prod__card">
          <WorkspaceSectionHeader title="Create Deliverable" compact />
          <div className="field-grid shared-job-form__grid">
            <label className="filter-field">
              <span>Production item</span>
              <select value={productionItemId} onChange={(event) => setProductionItemId(event.target.value)}>
                {productionItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Deliverable type</span>
              <select value={type} onChange={(event) => setType(event.target.value)}>
                {deliverableTypes.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field filter-field--wide">
              <span>Title</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
          </div>
          <WorkspaceActionBar align="end" compact>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                if (!title.trim()) {
                  return;
                }
                void onSave(productionItemId, {
                  deliverable_type: type,
                  title: title.trim(),
                  delivery_method: "digital",
                  status: "preparing"
                });
                setTitle("");
              }}
            >
              Create Deliverable
            </button>
          </WorkspaceActionBar>
        </section>
      ) : null}
    </div>
  );
}

export function SharedJobProductionPanel({
  token,
  detail,
  canManage,
  canViewFinance,
  staffOptions,
  currentUser,
  onSaveProductionItem,
  onSaveHandoff
}: SharedJobProductionPanelProps) {
  const downstream = getDepartmentJobDownstreamConfig({
    departmentType: detail.job.department_type as "schools" | "sports",
    detail,
    canViewFinance
  });
  const [draft, setDraft] = useState<SharedProductionItemInput>({
    title: "",
    production_type: downstream.productionTypes[0]?.value ?? "general",
    status: "queued",
    priority: "normal",
    assigned_to_user_id: null,
    approval_required: false,
    proof_required: false,
    qa_required: false
  });

  return (
    <div className="shared-job-prod__stack">
      <div className="shared-job-prod__metric-grid">
        <ProductionSummaryCard items={detail.production_items} />
        <ProductionDeadlineCard items={detail.production_items} />
        <ProductionHealthSummaryCard items={detail.production_items} issues={detail.production_issues} />
        {downstream.summaryCards
          .filter((card) => card.placement === "production" || card.placement === "overview")
          .map((card) => (
            <section key={card.key} className="shared-job-shell__sidebar-card">
              <WorkspaceSectionHeader title={card.title} compact />
              <div className="shared-job-shell__sidebar-body">{card.body}</div>
            </section>
          ))}
      </div>
      {detail.production_items[0] ? (
        <BlockedProductionBanner item={detail.production_items[0]} approvals={detail.approval_requests} findings={detail.qa_findings} issues={detail.production_issues} />
      ) : null}
      {canManage ? (
        <section className="shared-job-prod__card">
          <WorkspaceSectionHeader title="Add Production Item" summary="Every published job can split into one or many shared downstream work units when delivery, approval, or product paths diverge." />
          <div className="field-grid shared-job-form__grid">
            <label className="filter-field">
              <span>Title</span>
              <input value={draft.title ?? ""} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label className="filter-field">
              <span>Production type</span>
              <select value={draft.production_type ?? ""} onChange={(event) => setDraft((current) => ({ ...current, production_type: event.target.value }))}>
                {downstream.productionTypes.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <SharedStaffPicker
              label="Assigned owner"
              value={draft.assigned_to_user_id ?? ""}
              options={staffOptions}
              onChange={(value) => setDraft((current) => ({ ...current, assigned_to_user_id: value || null }))}
              emptyLabel="Choose owner"
            />
            <div className="shared-job-form__toggle-grid">
              <label className="shared-job-form__toggle">
                <input type="checkbox" checked={draft.approval_required ?? false} onChange={(event) => setDraft((current) => ({ ...current, approval_required: event.target.checked }))} />
                <span>Approval required</span>
              </label>
              <label className="shared-job-form__toggle">
                <input type="checkbox" checked={draft.proof_required ?? false} onChange={(event) => setDraft((current) => ({ ...current, proof_required: event.target.checked }))} />
                <span>Proof required</span>
              </label>
              <label className="shared-job-form__toggle">
                <input type="checkbox" checked={draft.qa_required ?? false} onChange={(event) => setDraft((current) => ({ ...current, qa_required: event.target.checked }))} />
                <span>QA required</span>
              </label>
            </div>
          </div>
          <WorkspaceActionBar align="end" compact>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                if (!draft.title?.trim()) {
                  return;
                }
                void onSaveProductionItem(draft);
                setDraft({
                  title: "",
                  production_type: downstream.productionTypes[0]?.value ?? "general",
                  status: "queued",
                  priority: "normal",
                  assigned_to_user_id: currentUser.id,
                  approval_required: false,
                  proof_required: false,
                  qa_required: false
                });
              }}
            >
              Create Production Item
            </button>
          </WorkspaceActionBar>
        </section>
      ) : null}
      {detail.production_items.length ? (
        detail.production_items.map((item) => (
          <ProductionItemCard
            key={item.id}
            token={token}
            item={item}
            approvals={getItemApprovals(detail, item.id)}
            reviews={getItemReviews(detail, item.id)}
            findings={getItemFindings(detail, item.id)}
            deliverables={getItemDeliverables(detail, item.id)}
            issues={getItemIssues(detail, item.id)}
            handoffs={getItemHandoffs(detail, item.id)}
            canManage={canManage}
            staffOptions={staffOptions}
            onSaveProductionItem={onSaveProductionItem}
            onSaveHandoff={onSaveHandoff}
          />
        ))
      ) : (
        <WorkspaceEmptyState title="No production items yet" summary="Publish-time shells or manual production splits will land here once downstream work exists." />
      )}
    </div>
  );
}

export function SharedJobApprovalsPanel({
  detail,
  canManage,
  canViewFinance,
  onSaveApproval
}: SharedDetailDownstreamProps) {
  const downstream = getDepartmentJobDownstreamConfig({
    departmentType: detail.job.department_type as "schools" | "sports",
    detail,
    canViewFinance
  });

  return (
    <div className="shared-job-prod__stack">
      <div className="shared-job-prod__metric-grid">
        <ApprovalStatusSummaryCard approvals={detail.approval_requests} />
        {downstream.summaryCards
          .filter((card) => card.placement === "approvals")
          .map((card) => (
            <section key={card.key} className="shared-job-shell__sidebar-card">
              <WorkspaceSectionHeader title={card.title} compact />
              <div className="shared-job-shell__sidebar-body">{card.body}</div>
            </section>
          ))}
      </div>
      <ApprovalFollowUpPanel productionItems={detail.production_items} approvalTypes={downstream.approvalTypes} canManage={canManage} onSave={onSaveApproval} />
      {detail.approval_requests.length ? (
        <section className="shared-job-prod__stack">
          {detail.approval_requests.map((request) => (
            <ApprovalRequestCard key={request.id} request={request} canManage={canManage} onSave={onSaveApproval} />
          ))}
        </section>
      ) : (
        <WorkspaceEmptyState title="No approvals yet" summary="Proof approvals, internal signoff, and client approvals will appear here once requested." />
      )}
    </div>
  );
}

export function SharedJobQaPanel({
  detail,
  canManage,
  canViewFinance,
  currentUser,
  staffOptions,
  onSaveQaReview,
  onSaveQaFinding
}: SharedDetailDownstreamProps) {
  const downstream = getDepartmentJobDownstreamConfig({
    departmentType: detail.job.department_type as "schools" | "sports",
    detail,
    canViewFinance
  });
  const qaSummary = useMemo(
    () => ({
      creatorComplete: detail.production_items.filter((item) => item.creator_review_complete).length,
      peerComplete: detail.production_items.filter((item) => item.peer_review_complete).length,
      finalComplete: detail.production_items.filter((item) => item.final_release_review_complete).length,
      firstPassApproved: detail.production_items.filter((item) => item.first_pass_approved).length,
      qaFailCount: detail.production_items.reduce((sum, item) => sum + item.qa_fail_count, 0),
      reworkCount: detail.production_items.reduce((sum, item) => sum + item.rework_count, 0)
    }),
    [detail.production_items]
  );

  return (
    <div className="shared-job-prod__stack">
      <div className="shared-job-prod__metric-grid">
        <PeerReviewSummaryCard reviews={detail.qa_reviews} findings={detail.qa_findings} />
        {renderSummaryCard(
          "Creator Review",
          `${qaSummary.creatorComplete}/${detail.production_items.length || 0}`,
          "Items with creator review completed.",
          qaSummary.creatorComplete === detail.production_items.length && detail.production_items.length > 0 ? "success" : "warning"
        )}
        {renderSummaryCard(
          "Peer Review",
          `${qaSummary.peerComplete}/${detail.production_items.length || 0}`,
          "Items cleared through peer review.",
          qaSummary.peerComplete === detail.production_items.length && detail.production_items.length > 0 ? "success" : "warning"
        )}
        {renderSummaryCard(
          "Final Review",
          `${qaSummary.finalComplete}/${detail.production_items.length || 0}`,
          "Items cleared for release.",
          qaSummary.finalComplete === detail.production_items.length && detail.production_items.length > 0 ? "success" : "warning"
        )}
        {renderSummaryCard(
          "First Pass Approved",
          qaSummary.firstPassApproved,
          "Items that cleared QA without a rework loop.",
          qaSummary.firstPassApproved ? "success" : "info"
        )}
        {renderSummaryCard("QA Fail Count", qaSummary.qaFailCount, "Total QA send-backs recorded on this job.", qaSummary.qaFailCount ? "danger" : "success")}
        {renderSummaryCard("Rework Count", qaSummary.reworkCount, "How many rework loops this job has accumulated.", qaSummary.reworkCount ? "warning" : "success")}
        {downstream.summaryCards
          .filter((card) => card.placement === "qa")
          .map((card) => (
            <section key={card.key} className="shared-job-shell__sidebar-card">
              <WorkspaceSectionHeader title={card.title} compact />
              <div className="shared-job-shell__sidebar-body">{card.body}</div>
            </section>
          ))}
      </div>
      <ReworkBanner reviews={detail.qa_reviews} findings={detail.qa_findings} />
      {detail.production_items.length ? (
        detail.production_items.map((item) => (
          <section key={item.id} className="shared-job-prod__item-shell shared-job-prod__qa-shell">
            <div className="shared-job-detail__list-card-header">
              <div>
                <h3>{item.title}</h3>
                <p className="shared-job-sidebar__muted">
                  {item.assigned_to_name ?? "Owner pending"} | {humanizeToken(item.workflow_status)} | {item.first_pass_approved ? "First pass approved" : "QA still active"}
                </p>
              </div>
              <div className="shared-job-preview__status-row">
                <StatusPill label={humanizeToken(item.workflow_status)} tone={productionStatusTone(item.workflow_status)} />
                <StatusPill label={`QA fails ${item.qa_fail_count}`} tone={item.qa_fail_count ? "danger" : "success"} />
                <StatusPill label={`Rework ${item.rework_count}`} tone={item.rework_count ? "warning" : "success"} />
              </div>
            </div>
            <div className="shared-job-prod__detail-kv-grid">
              {renderCompactValue("Creator Review", item.creator_review_complete ? "Complete" : "Pending")}
              {renderCompactValue("Peer Review", item.peer_review_complete ? "Complete" : "Pending")}
              {renderCompactValue("Final Review", item.final_release_review_complete ? "Complete" : "Pending")}
              {renderCompactValue("First Pass Approved", item.first_pass_approved ? "Yes" : "No")}
            </div>
            <div className="shared-job-prod__stack">
              {QA_GATE_CONFIGS.map((gate) => {
                const reviewHistory = getQaReviewsForGate(detail.qa_reviews, item.id, gate.key);
                const latestReview = reviewHistory[0] ?? null;
                const findings = detail.qa_findings.filter((finding) => finding.qa_review_record_id === latestReview?.id);
                return (
                  <ProductionQaGateCard
                    key={`${item.id}:${gate.key}`}
                    detail={detail}
                    item={item}
                    gate={gate}
                    latestReview={latestReview}
                    reviewHistory={reviewHistory}
                    findings={findings}
                    canManage={canManage}
                    currentUser={currentUser}
                    staffOptions={staffOptions}
                    qaTemplates={downstream.qaTemplates}
                    onSaveQaReview={onSaveQaReview}
                    onSaveQaFinding={onSaveQaFinding}
                  />
                );
              })}
            </div>
            {sortQaReviews(detail.qa_reviews.filter((review) => review.production_item_id === item.id)).length ? (
              <section className="shared-job-prod__card">
                <WorkspaceSectionHeader title="Review History" summary="Past review loops, send-backs, and accountability records for this item." compact />
                <div className="shared-job-prod__detail-list">
                  {sortQaReviews(detail.qa_reviews.filter((review) => review.production_item_id === item.id)).map((review) => (
                    <article key={review.id} className="shared-job-prod__detail-list-item">
                      <div>
                        <strong>{buildQaHistoryLabel(review)}</strong>
                        <p>
                          {review.reviewer_name ?? "Reviewer pending"} | {humanizeToken(review.status)} | {review.sample_size_percent != null ? `${review.sample_size_percent}% sample` : "Sample pending"}
                        </p>
                        {review.decision_reason ? <p>{review.decision_reason}</p> : null}
                        {review.accountability_stage_key ? (
                          <p>
                            Accountability: {review.accountable_owner_name ?? "owner"} and {review.accountable_reviewer_name ?? "reviewer"} from {humanizeToken(review.accountability_stage_key)}
                          </p>
                        ) : null}
                      </div>
                      <div className="shared-job-preview__status-row">
                        <StatusPill label={humanizeToken(review.status)} tone={productionStatusTone(review.status)} />
                        {review.issue_category ? <StatusPill label={humanizeToken(review.issue_category)} tone="warning" /> : null}
                        {review.override_same_reviewer ? <StatusPill label="Override" tone="danger" /> : null}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </section>
        ))
      ) : (
        <WorkspaceEmptyState title="No production items yet" summary="The QA workflow unlocks as soon as downstream production items exist for this job." />
      )}
    </div>
  );
}

export function SharedJobDeliverablesPanel({
  detail,
  canManage,
  canViewFinance,
  onSaveDeliverable,
  onSaveIssue,
  staffOptions
}: SharedDetailDownstreamProps) {
  const downstream = getDepartmentJobDownstreamConfig({
    departmentType: detail.job.department_type as "schools" | "sports",
    detail,
    canViewFinance
  });
  return (
    <div className="shared-job-prod__stack">
      <div className="shared-job-prod__metric-grid">
        <DeliveryStatusCard deliverables={detail.deliverable_items} />
        {downstream.summaryCards
          .filter((card) => card.placement === "deliverables" || card.placement === "overview")
          .map((card) => (
            <section key={card.key} className="shared-job-shell__sidebar-card">
              <WorkspaceSectionHeader title={card.title} compact />
              <div className="shared-job-shell__sidebar-body">{card.body}</div>
            </section>
          ))}
      </div>
      <DeliverablesBoard productionItems={detail.production_items} deliverables={detail.deliverable_items} deliverableTypes={downstream.deliverableTypes} canManage={canManage} onSave={onSaveDeliverable} />
      <ProductionIssuesPanel productionItems={detail.production_items} issues={detail.production_issues} canManage={canManage} staffOptions={staffOptions} onSave={onSaveIssue} />
    </div>
  );
}

export function ProductionQueueBoard({
  token,
  currentUser,
  departmentType,
  routeBase,
  title,
  summary,
  ownerOptions,
  payload,
  reporting,
  loading,
  reportingLoading,
  queueError,
  reportingError,
  onReload,
  onUpdateProductionItem
}: ProductionQueueBoardProps) {
  const { path, params } = useHashRouteSnapshot();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailCache, setDetailCache] = useState<Record<string, SharedJobDetailResponse>>({});
  const [detailLoadingJobId, setDetailLoadingJobId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState("");
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const canManage = canManageQueueDepartment(currentUser, departmentType);
  const activeSavedViewKey = readActiveSavedViewKey(params, departmentType);
  const filters = useMemo(() => readProductionFilters(params, departmentType, currentUser.id), [currentUser.id, departmentType, params]);
  const items = useMemo(() => sortProductionItems(applyProductionFilters(payload?.items ?? [], filters, activeSavedViewKey ?? "all_open")), [activeSavedViewKey, filters, payload?.items]);
  const selectedItemId = params.get("item") && items.some((item) => item.id === params.get("item")) ? params.get("item") : items[0]?.id ?? null;
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const detailSnapshot = selectedItem ? buildProductionDetailSnapshot(detailCache[selectedItem.job_id] ?? null, selectedItem.id) : null;
  const boardSummary = useMemo(() => summarizeProductionBoard(items), [items]);
  const departmentOptions = useMemo(() => {
    const seen = new Set<JobDepartmentValue>(departmentType ? [departmentType] : ["schools", "sports", "corporate", "headshots", "other"]);
    return ["all", ...Array.from(seen)] as JobDepartmentValue[];
  }, [departmentType]);
  const organizationOptions = useMemo(
    () =>
      Array.from(new Map((payload?.items ?? []).filter((item) => item.organization_id).map((item) => [item.organization_id as string, item.organization_name ?? "Unknown organization"])).entries()),
    [payload?.items]
  );
  const deliverableTypeOptions = useMemo(() => Array.from(new Set((payload?.items ?? []).map((item) => item.production_type))).sort(), [payload?.items]);
  const releaseStateOptions = useMemo(() => Array.from(new Set((payload?.items ?? []).map((item) => item.release_status))).sort(), [payload?.items]);
  const savedViews = useMemo(
    () =>
      PRODUCTION_SAVED_VIEWS.filter((view) => {
        if (!departmentType) {
          return true;
        }
        if (view.key === "schools" && departmentType !== "schools") {
          return false;
        }
        if (view.key === "sports" && departmentType !== "sports") {
          return false;
        }
        return true;
      }),
    [departmentType]
  );
  const activeSavedView = useMemo(
    () => savedViews.find((view) => view.key === activeSavedViewKey) ?? null,
    [activeSavedViewKey, savedViews]
  );
  const advancedFilterCount = [
    filters.deliverableType,
    filters.organizationId,
    filters.checklistState,
    filters.blockerState !== "all" ? filters.blockerState : "",
    filters.releaseState,
    filters.priority
  ].filter(Boolean).length;
  const activeFilterCount = [
    !departmentType && filters.department !== "all" ? filters.department : "",
    filters.assignedToMe ? "assigned_to_me" : filters.ownerUserId,
    filters.workflowStatus,
    filters.healthState,
    filters.dueWindow !== "all" ? filters.dueWindow : "",
    filters.checklistState,
    filters.search.trim(),
    filters.deliverableType,
    filters.organizationId,
    filters.blockerState !== "all" ? filters.blockerState : "",
    filters.releaseState,
    filters.priority
  ].filter(Boolean).length;

  useEffect(() => {
    if (advancedFilterCount > 0) {
      setAdvancedFiltersOpen(true);
    }
  }, [advancedFilterCount]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => items.some((item) => item.id === id)));
  }, [items]);

  useEffect(() => {
    if (!selectedItem || detailCache[selectedItem.job_id] || detailLoadingJobId === selectedItem.job_id) {
      return;
    }
    let cancelled = false;
    setDetailLoadingJobId(selectedItem.job_id);
    setDetailError("");
    void getSharedJobDetail(token, selectedItem.job_id)
      .then((response) => {
        if (!cancelled) {
          setDetailCache((current) => ({ ...current, [selectedItem.job_id]: response }));
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setDetailError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load the linked production detail right now.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoadingJobId((current) => (current === selectedItem.job_id ? null : current));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [detailCache, detailLoadingJobId, selectedItem, token]);

  function updateFilters(nextPartial: Partial<ProductionBoardFilterState>) {
    const mergedFilters = {
      ...filters,
      ...nextPartial
    };
    if (Object.prototype.hasOwnProperty.call(nextPartial, "assignedToMe")) {
      if (nextPartial.assignedToMe) {
        mergedFilters.ownerUserId = currentUser.id;
      } else if (!Object.prototype.hasOwnProperty.call(nextPartial, "ownerUserId")) {
        mergedFilters.ownerUserId = "";
      }
    }
    writeProductionRouteState(path, params, {
      ...mergedFilters,
      savedView: null,
      item: selectedItemId
    });
  }

  function applySavedView(key: ProductionSavedViewKey) {
    const preset = PRODUCTION_SAVED_VIEWS.find((view) => view.key === key);
    if (!preset) {
      return;
    }
    window.localStorage.setItem(savedViewStorageKey(departmentType), key);
    writeProductionRouteState(path, params, {
      ...DEFAULT_PRODUCTION_FILTERS,
      ...preset.filters,
      department: departmentType ?? (preset.filters.department ?? "all"),
      ownerUserId: key === "my_work" ? currentUser.id : preset.filters.ownerUserId ?? "",
      assignedToMe: key === "my_work" ? true : preset.filters.assignedToMe ?? false,
      savedView: key,
      item: selectedItemId
    });
  }

  async function runItemUpdate(item: SharedProductionQueueItem, input: SharedProductionItemInput) {
    await onUpdateProductionItem(item, input);
    await onReload();
    try {
      const refreshed = await getSharedJobDetail(token, item.job_id);
      setDetailCache((current) => ({ ...current, [item.job_id]: refreshed }));
      setDetailError("");
    } catch (loadError) {
      setDetailError(loadError instanceof ApiClientError ? loadError.message : "We couldn't refresh the linked detail after saving.");
    }
  }

  async function applyBulkPatch(input: SharedProductionItemInput) {
    const targets = items.filter((item) => selectedIds.includes(item.id));
    for (const item of targets) {
      await onUpdateProductionItem(item, input);
    }
    await onReload();
  }

  if (loading) {
    return <WorkspaceLoadingBlock title={`Loading ${title}`} summary="Opening the shared graphics and downstream workflow queue." />;
  }

  return (
    <section className="sports-workspace shared-job-prod__workspace">
      <WorkspacePageHeader
        eyebrow={getQueueDepartmentLabel(departmentType)}
        title={title}
        summary={summary}
        meta={[
          { label: `${items.length} visible`, tone: "info" },
          { label: `${boardSummary.blocked} blocked`, tone: boardSummary.blocked > 0 ? "critical" : "success" },
          { label: `${boardSummary.overdue} overdue`, tone: boardSummary.overdue > 0 ? "critical" : "success" }
        ]}
        actions={
          <WorkspaceActionBar align="end">
            <button type="button" className="secondary-button" onClick={() => void onReload()}>
              Refresh Queue
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = `${routeBase}`)}>
              Open {departmentType ? getDepartmentJobAdapterUI(departmentType).labels.pluralLabel : "Jobs"}
            </button>
          </WorkspaceActionBar>
        }
      />

      <CompactActiveWorkPanel
        token={token}
        currentUser={currentUser}
        title="Graphics Active Work"
        summary="Compact graphics and downstream strip for ownership, due pressure, blockers, and next moves before the full workflow table and detail drawer."
        defaultDepartment={departmentType ?? "all"}
        routeHash={departmentType ? `#${departmentType}/graphics` : "#graphics"}
        source="production"
        focus="workload"
        showDepartmentFilter={!departmentType}
        showOpenWorkspaceAction={false}
      />

      <div className="shared-job-prod__metric-grid">
        {renderSummaryCard("Open Items", boardSummary.openItems, "Active graphics workflow items still moving through the board.", boardSummary.openItems ? "info" : "success")}
        {renderSummaryCard("Due Today", boardSummary.dueToday, "Items due before the day closes.", boardSummary.dueToday ? "warning" : "success")}
        {renderSummaryCard("Overdue", boardSummary.overdue, "Items already past due.", boardSummary.overdue ? "danger" : "success")}
        {renderSummaryCard("Blocked", boardSummary.blocked, "Items with blockers or blocked health.", boardSummary.blocked ? "danger" : "success")}
        {renderSummaryCard("Ready for QA", boardSummary.readyForQa, "Work waiting on peer review.", boardSummary.readyForQa ? "warning" : "info")}
        {renderSummaryCard("Ready for Release", boardSummary.readyForRelease, "Work cleared for release review.", boardSummary.readyForRelease ? "info" : "success")}
        {renderSummaryCard("Awaiting Files", boardSummary.awaitingFiles, "Items still waiting on post-shoot file readiness.", boardSummary.awaitingFiles ? "warning" : "success")}
        {renderSummaryCard("Awaiting Upload", boardSummary.awaitingUpload, "Work cleared for upload but not out yet.", boardSummary.awaitingUpload ? "warning" : "success")}
        {renderSummaryCard("Vendor Pending", boardSummary.vendorPending, "Items sitting in vendor handoff or vendor follow-through.", boardSummary.vendorPending ? "warning" : "success")}
      </div>

      <section className="panel">
        <SavedViewBar
          views={savedViews.map((view) => ({ key: view.key, label: view.label }))}
          activeKey={activeSavedViewKey}
          onSelect={(key) => applySavedView(key as ProductionSavedViewKey)}
        />
        <div className="shared-job-prod__saved-view-context">
          <div className="shared-job-prod__cell-stack">
            <strong>{activeSavedView?.label ?? "Custom View"}</strong>
            <span className="shared-job-prod__cell-meta">
              {activeSavedView?.description ?? "A custom Graphics Board slice based on your current filters."}
            </span>
          </div>
          <span className="shared-job-prod__saved-view-count">
            {activeFilterCount} active filter{activeFilterCount === 1 ? "" : "s"}
          </span>
        </div>
      </section>

      <WorkspaceFilterToolbar className="shared-job-prod__filter-toolbar">
        <div className="workspace-toolbar__group shared-job-prod__filter-grid shared-job-prod__filter-grid--primary">
          <label className="filter-field filter-field--wide">
            <span>Search</span>
            <input value={filters.search} onChange={(event) => updateFilters({ search: event.target.value })} placeholder="Graphics item, organization, job, owner, vendor, or blocker" />
          </label>
          <label className="filter-field">
            <span>Department</span>
            <select value={filters.department} onChange={(event) => updateFilters({ department: event.target.value as JobDepartmentValue })} disabled={Boolean(departmentType)}>
              {departmentOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All departments" : humanizeToken(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Owner</span>
            <select
              value={filters.ownerUserId}
              onChange={(event) => updateFilters({ ownerUserId: event.target.value, assignedToMe: false })}
              disabled={filters.assignedToMe}
            >
              <option value="">All owners</option>
              {ownerOptions.map((option) => (
                <option key={option.user_id} value={option.user_id}>
                  {option.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Workflow Status</span>
            <select value={filters.workflowStatus} onChange={(event) => updateFilters({ workflowStatus: event.target.value as ProductionBoardWorkflowStatus | "" })}>
              <option value="">All workflow states</option>
              {Array.from(new Set((payload?.items ?? []).map((item) => item.workflow_status))).sort().map((value) => (
                <option key={value} value={value}>
                  {humanizeToken(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Health State</span>
            <select value={filters.healthState} onChange={(event) => updateFilters({ healthState: event.target.value as ProductionBoardHealthState | "" })}>
              <option value="">All health states</option>
              {Array.from(new Set((payload?.items ?? []).map((item) => item.health_state))).sort().map((value) => (
                <option key={value} value={value}>
                  {humanizeToken(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Due Date Window</span>
            <select value={filters.dueWindow} onChange={(event) => updateFilters({ dueWindow: event.target.value as ProductionDueWindow })}>
              <option value="all">All windows</option>
              <option value="today">Due today</option>
              <option value="overdue">Overdue</option>
              <option value="next_3">Next 3 days</option>
              <option value="next_7">Next 7 days</option>
              <option value="closed_last_7_days">Closed last 7 days</option>
            </select>
          </label>
          <label className="shared-job-prod__toggle">
            <input
              type="checkbox"
              checked={filters.assignedToMe}
              onChange={(event) => updateFilters({ assignedToMe: event.target.checked })}
            />
            <span>Assigned to me</span>
          </label>
          <details className="shared-job-prod__filter-details" open={advancedFiltersOpen} onToggle={(event) => setAdvancedFiltersOpen((event.currentTarget as HTMLDetailsElement).open)}>
            <summary>Advanced Filters{advancedFilterCount ? ` (${advancedFilterCount})` : ""}</summary>
            <div className="shared-job-prod__filter-grid shared-job-prod__filter-grid--advanced">
              <label className="filter-field">
                <span>Deliverable Type</span>
                <select value={filters.deliverableType} onChange={(event) => updateFilters({ deliverableType: event.target.value })}>
                  <option value="">All deliverable types</option>
                  {deliverableTypeOptions.map((value) => (
                    <option key={value} value={value}>
                      {humanizeToken(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Organization</span>
                <select value={filters.organizationId} onChange={(event) => updateFilters({ organizationId: event.target.value })}>
                  <option value="">All organizations</option>
                  {organizationOptions.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Checklist State</span>
                <select value={filters.checklistState} onChange={(event) => updateFilters({ checklistState: event.target.value as ProductionBoardFilterState["checklistState"] })}>
                  <option value="">All checklist states</option>
                  <option value="overdue">Overdue</option>
                  <option value="awaiting_approval">Awaiting approval</option>
                  <option value="rejected">Rejected</option>
                  <option value="blocked">Blocked transition</option>
                </select>
              </label>
              <label className="filter-field">
                <span>Blocker State</span>
                <select value={filters.blockerState} onChange={(event) => updateFilters({ blockerState: event.target.value as ProductionBoardFilterState["blockerState"] })}>
                  <option value="all">All blocker states</option>
                  <option value="blocked">Blocked only</option>
                  <option value="clear">Clear only</option>
                </select>
              </label>
              <label className="filter-field">
                <span>Release State</span>
                <select value={filters.releaseState} onChange={(event) => updateFilters({ releaseState: event.target.value as ProductionBoardReleaseStatus | "" })}>
                  <option value="">All release states</option>
                  {releaseStateOptions.map((value) => (
                    <option key={value} value={value}>
                      {humanizeToken(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Priority</span>
                <select value={filters.priority} onChange={(event) => updateFilters({ priority: event.target.value as SharedProductionQueueItem["priority"] | "" })}>
                  <option value="">All priorities</option>
                  {["low", "normal", "high", "urgent"].map((value) => (
                    <option key={value} value={value}>
                      {humanizeToken(value)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        </div>
        <div className="workspace-toolbar__actions">
          <button type="button" className="secondary-button" onClick={() => updateFilters(DEFAULT_PRODUCTION_FILTERS)}>
            Clear Filters
          </button>
        </div>
      </WorkspaceFilterToolbar>

      {queueError ? <div className="shared-job-list__error" role="alert">{queueError}</div> : null}

      <ProductionBoardReportingPanel
        reporting={reporting}
        loading={reportingLoading}
        error={reportingError}
        onOpenItem={(itemId) =>
          writeProductionRouteState(path, params, {
            ...filters,
            savedView: activeSavedViewKey,
            item: itemId
          })
        }
      />

      {selectedIds.length && canManage ? (
        <section className="panel shared-job-prod__bulk-bar">
          <span>{selectedIds.length} selected</span>
          <WorkspaceActionBar align="end" compact>
            <button type="button" className="secondary-button" onClick={() => void applyBulkPatch({ assigned_to_user_id: currentUser.id })}>
              Assign To Me
            </button>
            <button type="button" className="secondary-button" onClick={() => void applyBulkPatch({ priority: "urgent" })}>
              Raise Priority
            </button>
            <button type="button" className="secondary-button" onClick={() => void applyBulkPatch({ status: "blocked", blocked_reason: "Blocked from shared graphics queue." })}>
              Mark Blocked
            </button>
            <button type="button" className="secondary-button" onClick={() => void applyBulkPatch({ status: "queued", blocked_reason: null })}>
              Clear Block
            </button>
          </WorkspaceActionBar>
        </section>
      ) : null}

      {queueError && !payload ? (
        <WorkspaceEmptyState
          title="Graphics queue unavailable"
          summary="The queue couldn't be loaded right now. Try refreshing again in a moment."
          actions={
            <button type="button" className="secondary-button" onClick={() => void onReload()}>
              Retry Queue
            </button>
          }
        />
      ) : !items.length ? (
        <WorkspaceEmptyState
          title={payload?.items?.length ? "No graphics items match these filters" : "No graphics items yet"}
          summary={
            payload?.items?.length
              ? `${activeSavedView?.label ?? "This view"} is currently empty. Try widening the primary filters or opening advanced filters.`
              : "Graphics workflow items will appear here once published jobs create downstream work."
          }
          actions={
            payload?.items?.length ? (
              <button type="button" className="secondary-button" onClick={() => updateFilters(DEFAULT_PRODUCTION_FILTERS)}>
                Reset Filters
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="shared-job-shell__split shared-job-shell__split--preview">
          <section className="panel sports-master-table">
            <div className="sports-master-table__header">
              <strong>Graphics Board</strong>
              <span>{items.length} visible</span>
            </div>
            <div className="sports-master-table__scroll">
              <ProductionItemTable
                items={items}
                selectedIds={selectedIds}
                activeItemId={selectedItemId}
                onToggleSelection={(itemId, checked) => {
                  setSelectedIds((current) => checked ? [...new Set([...current, itemId])] : current.filter((id) => id !== itemId));
                }}
                onSelectItem={(item) =>
                  writeProductionRouteState(path, params, {
                    ...filters,
                    savedView: activeSavedViewKey,
                    item: item.id
                  })
                }
              />
            </div>
          </section>

          <ProductionDetailPanel
            token={token}
            selectedItem={selectedItem}
            snapshot={detailSnapshot}
            detailLoading={detailLoadingJobId === selectedItem?.job_id}
            detailError={detailError}
            currentUser={currentUser}
            canManage={canManage}
            ownerOptions={ownerOptions}
            onSaveProductionItem={runItemUpdate}
          />
        </div>
      )}
    </section>
  );
}

export function SharedProductionPage({
  token,
  currentUser,
  departmentType,
  routeBase,
  title,
  summary
}: SharedProductionPageProps) {
  const { params } = useHashRouteSnapshot();
  const [payload, setPayload] = useState<SharedProductionQueueResponse | null>(null);
  const [reporting, setReporting] = useState<SharedProductionReportingResponse | null>(null);
  const [ownerOptions, setOwnerOptions] = useState<DirectoryOwnerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportingLoading, setReportingLoading] = useState(true);
  const [queueError, setQueueError] = useState("");
  const [reportingError, setReportingError] = useState("");
  const filters = useMemo(() => readProductionFilters(params, departmentType, currentUser.id), [currentUser.id, departmentType, params]);
  const queueQuery = useMemo(() => buildProductionQuery(filters, departmentType, currentUser.id), [currentUser.id, departmentType, filters]);
  const reportingQuery = useMemo(
    () => buildProductionReportingQuery(filters, departmentType, currentUser.id),
    [currentUser.id, departmentType, filters]
  );

  async function load() {
    setLoading(true);
    setReportingLoading(true);
    setQueueError("");
    setReportingError("");
    const [queueResult, reportingResult] = await Promise.allSettled([
      listSharedProductionQueue(token, queueQuery),
      getSharedProductionReporting(token, reportingQuery)
    ]);
    if (queueResult.status === "fulfilled") {
      setPayload(queueResult.value);
    } else {
      setPayload(null);
      setQueueError(
        queueResult.reason instanceof ApiClientError ? queueResult.reason.message : "We couldn't load the shared graphics queue right now."
      );
    }
    if (reportingResult.status === "fulfilled") {
      setReporting(reportingResult.value);
    } else {
      setReporting(null);
      setReportingError(
        reportingResult.reason instanceof ApiClientError
          ? reportingResult.reason.message
          : "Management reporting is temporarily unavailable. The queue is still current."
      );
    }
    setLoading(false);
    setReportingLoading(false);
  }

  useEffect(() => {
    void load();
  }, [queueQuery, reportingQuery, token]);

  useEffect(() => {
    let cancelled = false;
    void listDirectoryOwnerOptions(token)
      .then((response) => {
        if (!cancelled) {
          setOwnerOptions(response.owners);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOwnerOptions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onUpdateProductionItem(item: SharedProductionQueueItem, input: SharedProductionItemInput) {
    const { createOrUpdateSharedProductionItem } = await import("../../services/jobsApi");
    await createOrUpdateSharedProductionItem(token, item.job_id, input, item.id);
  }

  if (!canAccessGraphicsWorkspace(currentUser) && !departmentType) {
    return <WorkspaceEmptyState title="No graphics access" summary="Graphics queues are permissioned. Ask a manager if you need a broader downstream view." />;
  }

  return (
    <ProductionQueueBoard
      token={token}
      currentUser={currentUser}
      departmentType={departmentType}
      routeBase={routeBase}
      title={title}
      summary={summary}
      ownerOptions={ownerOptions}
      payload={payload}
      reporting={reporting}
      loading={loading}
      reportingLoading={reportingLoading}
      queueError={queueError}
      reportingError={reportingError}
      onReload={load}
      onUpdateProductionItem={onUpdateProductionItem}
    />
  );
}
