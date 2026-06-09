import { useEffect, useMemo, useState } from "react";
import { OperationalDetailSection } from "../components/OperationalDetailSection";
import { OperationalPreviewCard } from "../components/OperationalPreviewCard";
import { ProjectTrackingDepartmentQueue } from "../components/projectTracking/ProjectTrackingDepartmentQueue";
import { ProductionProjectDetailPanel } from "../components/projects/ProductionProjectDetailPanel";
import { ProductionProjectDrawer } from "../components/projects/ProductionProjectDrawer";
import { toGraphicsLabel } from "../components/projects/graphicsNaming";
import { ProductionLeadBoard } from "../components/projects/ProductionLeadBoard";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceFilterToolbar } from "../components/workspace/WorkspaceFilterToolbar";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { getOperatingSystemRoleTemplate } from "../permissions";
import {
  buildProductionProjectsHash,
  createProductionProjectException,
  createProductionProject,
  getProductionProjectAnalytics,
  getProductionProjectQaWorkspace,
  getProductionProjectDetail,
  getProductionProjectReferenceData,
  listProductionProjects,
  listProductionProjectTemplates,
  submitProductionProjectQaReview,
  updateProductionProject,
  updateProductionProjectTask,
  updateProductionProjectException,
  updateBuddyWorkflow,
  updateVirtualTeamWorkflow,
  type ProductionProjectBoardFilters
} from "../services/productionProjects";
import type {
  ProductionLeadBoardFocus,
  ProductionLeadBoardSort,
  ProductionProjectBoardResponse,
  ProductionProjectCategory,
  ProductionProjectDetail,
  ProductionProjectDueState,
  ProductionProjectJobType,
  ProductionProjectQueueId,
  ProductionProjectQaCheckRecord,
  ProductionProjectAnalytics,
  ProductionProjectQaWorkspace,
  ProductionProjectReferenceData,
  ProductionProjectStage,
  ProductionProjectStatus,
  ProductionProjectTeamOwner,
  ProductionProjectTemplateRecord,
  ProductionProjectWorkspaceView,
  SessionUser
} from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type RouteState = {
  projectId: string | null;
  workspaceView: ProductionProjectWorkspaceView | null;
};

type CreateDraft = {
  templateId: string;
  title: string;
  summary: string;
  jobType: ProductionProjectJobType;
  category: ProductionProjectCategory;
  priority: "low" | "normal" | "high" | "critical";
  ownerUserId: string;
  dueDate: string;
  followUpDate: string;
  linkedOrganizationId: string;
  linkedLocationId: string;
  linkedShootId: string;
  note: string;
};

type DetailDraft = {
  status: ProductionProjectStatus;
  jobType: ProductionProjectJobType;
  stage: ProductionProjectStage;
  ownerUserId: string;
  peerReviewerUserId: string;
  finalQcReviewerUserId: string;
  dueDate: string;
  followUpDate: string;
  note: string;
};

type BoardFiltersState = ProductionProjectBoardFilters;

type ProductionGuidanceCard = {
  eyebrow: string;
  title: string;
  summary: string;
  bullets: string[];
  hash: string;
  linkLabel: string;
};

const DEFAULT_PRIORITY = "all" as const;
const DEFAULT_SOURCE_TYPE = "all" as const;
const DEFAULT_DUE_STATE = "all" as const;
const DEFAULT_CATEGORY = "all" as const;
const DEFAULT_JOB_TYPE = "all" as const;
const DEFAULT_STAGE = "all" as const;
const DEFAULT_TEAM_OWNER = "all" as const;
const DEFAULT_LEAD_BOARD_SORT = "overdue_severity" as const;
const DEFAULT_LEAD_BOARD_FOCUS = "all" as const;

const PROJECT_CATEGORY_OPTIONS: Array<{ value: ProductionProjectCategory; label: string }> = [
  { value: "production_follow_up", label: "Graphics Follow-Up" },
  { value: "photography_production", label: "Studios Capture Follow-Up" },
  { value: "digital_production", label: "Post-Shoot Graphics" },
  { value: "qa_peer_review", label: "QA / Peer Review" },
  { value: "remediation", label: "Remediation" }
];

const PROJECT_JOB_TYPE_OPTIONS: Array<{ value: ProductionProjectJobType; label: string }> = [
  { value: "standard_school_production", label: "Standard School Graphics" },
  { value: "sports_production", label: "Sports Graphics" },
  { value: "specialty_graphics", label: "Specialty / Graphics" },
  { value: "banner_specialty_product", label: "Banner / Specialty Product" },
  { value: "gallery_prep_upload", label: "Gallery Prep / Upload" },
  { value: "qa_final_review", label: "QA / Final Review" },
  { value: "correction_rework", label: "Correction / Rework" }
];

const PROJECT_TEAM_OWNER_OPTIONS: Array<{ value: ProductionProjectTeamOwner; label: string }> = [
  { value: "production", label: "Graphics Intake" },
  { value: "graphics", label: "Graphics" },
  { value: "upload", label: "Upload" },
  { value: "qa", label: "QA" },
  { value: "release", label: "Release" },
  { value: "corrections", label: "Corrections" }
];

const PROJECT_STAGE_OPTIONS: Array<{ value: ProductionProjectStage; label: string }> = [
  { value: "intake_pending", label: "Intake Pending" },
  { value: "ready_for_production", label: "Ready for Graphics" },
  { value: "in_production", label: "In Graphics" },
  { value: "blocked", label: "Blocked" },
  { value: "ready_for_qa", label: "Ready for QA" },
  { value: "in_qa_review", label: "In QA Review" },
  { value: "qa_hold", label: "QA Hold" },
  { value: "correction_needed", label: "Correction Needed" },
  { value: "ready_to_release", label: "Ready to Release" },
  { value: "released_complete", label: "Released / Complete" },
  { value: "on_hold", label: "On Hold" },
  { value: "cancelled", label: "Cancelled" }
];

const PRODUCTION_GUIDANCE_CARDS: ProductionGuidanceCard[] = [
  {
    eyebrow: "Workflow",
    title: "Workflow Rules",
    summary: "Tasks and handoffs are the work truth. The queue should explain the next move without relying on memory or side messages.",
    bullets: [
      "Keep the real owner and due date current when work changes hands.",
      "Use task notes for blocker or handoff context the next operator actually needs.",
      "Move the workflow with task completion and handoff actions, not vague status changes."
    ],
    hash: buildProductionProjectsHash({ queue: "team_queue", view: "staff_workspace" }),
    linkLabel: "Open Team Queue"
  },
  {
    eyebrow: "Peer Review",
    title: "Peer Review Standards",
    summary: "Peer review is a real quality gate. It should catch completeness and obvious graphics misses before final QC starts.",
    bullets: [
      "Check completeness, obvious misses, and whether the job is ready for QC.",
      "Return corrections with a reason, not a vague \"needs work\" note.",
      "Reassign the correct owner before the job leaves QA."
    ],
    hash: buildProductionProjectsHash({ queue: "qa_queue", stage: "ready_for_qa", view: "staff_workspace" }),
    linkLabel: "Open Peer Review Queue"
  },
  {
    eyebrow: "Final QC",
    title: "QA Expectations",
    summary: "Final QC is the last quality gate before release. It validates correction history, gate clearance, and send safety.",
    bullets: [
      "Do not clear final QC until peer review and required tasks are actually done.",
      "Check correction history, blocker state, and release warnings together.",
      "If the job is not safe to send, return it cleanly instead of forcing it forward."
    ],
    hash: buildProductionProjectsHash({ queue: "qa_queue", stage: "in_qa_review", view: "staff_workspace" }),
    linkLabel: "Open Final QC Queue"
  },
  {
    eyebrow: "Release",
    title: "Release Standards",
    summary: "Ready-to-release means the work is clear, not merely close. Release is a controlled final step, not a cleanup lane.",
    bullets: [
      "Do not release while blockers, approval banners, or required tasks are still open.",
      "Wait-to-send is a controlled handoff lane, not a parking lot.",
      "Use the release queue for the final send action after QA and QC are clear."
    ],
    hash: buildProductionProjectsHash({ queue: "ready_to_release_queue", stage: "ready_to_release", view: "staff_workspace" }),
    linkLabel: "Open Release Queue"
  }
];

export function ProductionProjects({ token, currentUser }: Props) {
  const [route, setRoute] = useState<RouteState>(() => {
    const initialHashState = parseProjectsHash();
    return { projectId: initialHashState.projectId, workspaceView: initialHashState.workspaceView };
  });
  const [filters, setFilters] = useState<BoardFiltersState>(() => {
    const anchorDate = getLocalDateString();
    return buildBoardFilters(anchorDate, parseProjectsHash().filters);
  });
  const [board, setBoard] = useState<ProductionProjectBoardResponse | null>(null);
  const [qaWorkspace, setQaWorkspace] = useState<ProductionProjectQaWorkspace | null>(null);
  const [analytics, setAnalytics] = useState<ProductionProjectAnalytics | null>(null);
  const [detail, setDetail] = useState<ProductionProjectDetail | null>(null);
  const [templates, setTemplates] = useState<ProductionProjectTemplateRecord[]>([]);
  const [references, setReferences] = useState<ProductionProjectReferenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [qaWorkspaceLoading, setQaWorkspaceLoading] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [qaWorkspaceError, setQaWorkspaceError] = useState("");
  const [analyticsError, setAnalyticsError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [notice, setNotice] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);
  const [analyticsWindowDays, setAnalyticsWindowDays] = useState(90);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(() => ({
    templateId: "",
    title: "",
    summary: "",
    jobType: "standard_school_production",
    category: "digital_production",
    priority: "normal",
    ownerUserId: "",
    dueDate: getLocalDateString(),
    followUpDate: "",
    linkedOrganizationId: "",
    linkedLocationId: "",
    linkedShootId: "",
    note: ""
  }));
  const [detailDraft, setDetailDraft] = useState<DetailDraft>({
    status: "new",
    jobType: "standard_school_production",
    stage: "intake_pending",
    ownerUserId: "",
    peerReviewerUserId: "",
    finalQcReviewerUserId: "",
    dueDate: "",
    followUpDate: "",
    note: ""
  });

  useEffect(() => {
    const sync = () => {
      const next = parseProjectsHash();
      setRoute({ projectId: next.projectId, workspaceView: next.workspaceView });
      setFilters((current) => buildBoardFilters(current.anchorDate, next.filters));
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const roleTemplate = getOperatingSystemRoleTemplate(currentUser);
  const leadBoardEligible = roleTemplate === "leadership" || roleTemplate === "production_manager";
  const workspaceView = leadBoardEligible
    ? (route.workspaceView ?? board?.default_workspace_view ?? "lead_board")
    : "staff_workspace";
  const currentWorkspaceHash = window.location.hash.split("?")[0];
  const isQaWorkspace = currentWorkspaceHash === "#graphics/qa";
  const isAnalyticsWorkspace = currentWorkspaceHash === "#graphics/analytics";
  const needsReferenceData = workspaceView !== "lead_board" || showAdvancedFilters || createOpen;

  useEffect(() => {
    const nextHash = buildProductionProjectsHash(toHashState(route.projectId, filters, leadBoardEligible ? workspaceView : null));
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
    }
  }, [filters, leadBoardEligible, route.projectId, workspaceView]);

  useEffect(() => {
    let cancelled = false;
    setReferenceLoading(true);
    void Promise.all([
      listProductionProjectTemplates(token),
      needsReferenceData ? getProductionProjectReferenceData(token) : Promise.resolve(null)
    ])
      .then(([templatePayload, referencePayload]) => {
        if (cancelled) {
          return;
        }
        setTemplates(templatePayload.templates);
        if (referencePayload) {
          setReferences(referencePayload);
        }
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setError(messageFor(loadError, "We couldn't load the graphics reference data right now."));
      })
      .finally(() => {
        if (!cancelled) {
          setReferenceLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [needsReferenceData, token]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listProductionProjects(token, { ...filters, workspace_view: workspaceView })
      .then((boardPayload) => {
        if (cancelled) {
          return;
        }
        setBoard(boardPayload);
        setError("");
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setError(messageFor(loadError, "We couldn't load the graphics workspace right now."));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filters, token, workspaceView]);

  useEffect(() => {
    if (!isQaWorkspace) {
      setQaWorkspace(null);
      setQaWorkspaceError("");
      return;
    }
    let cancelled = false;
    setQaWorkspaceLoading(true);
    void getProductionProjectQaWorkspace(token)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setQaWorkspace(payload);
        setQaWorkspaceError("");
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setQaWorkspace(null);
        setQaWorkspaceError(messageFor(loadError, "We couldn't load the QA workspace right now."));
      })
      .finally(() => {
        if (!cancelled) {
          setQaWorkspaceLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isQaWorkspace, token]);

  useEffect(() => {
    if (!isAnalyticsWorkspace) {
      setAnalytics(null);
      setAnalyticsError("");
      return;
    }
    let cancelled = false;
    setAnalyticsLoading(true);
    void getProductionProjectAnalytics(token, analyticsWindowDays)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setAnalytics(payload);
        setAnalyticsError("");
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setAnalytics(null);
        setAnalyticsError(messageFor(loadError, "We couldn't load graphics analytics right now."));
      })
      .finally(() => {
        if (!cancelled) {
          setAnalyticsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [analyticsWindowDays, isAnalyticsWorkspace, token]);

  useEffect(() => {
    if (!route.projectId) {
      setDetail(null);
      setDetailError("");
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void getProductionProjectDetail(token, route.projectId)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setDetail(payload);
        setDetailDraft({
          status: payload.project.status,
          jobType: payload.project.job_type,
          stage: payload.project.stage,
          ownerUserId: payload.project.owner_user_id ?? "",
          peerReviewerUserId: payload.project.peer_reviewer_user_id ?? "",
          finalQcReviewerUserId: payload.project.final_qc_reviewer_user_id ?? "",
          dueDate: payload.project.due_date ?? "",
          followUpDate: payload.project.follow_up_date ?? "",
          note: payload.project.latest_note ?? ""
        });
        setDetailError("");
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setDetail(null);
        setDetailError(messageFor(loadError, "We couldn't open that graphics item right now."));
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [route.projectId, token]);

  useEffect(() => {
    setCreateDraft((current) => ({ ...current, dueDate: current.dueDate || filters.anchorDate }));
  }, [filters.anchorDate]);

  const selectedProjectId = route.projectId;
  const visibleSections = board?.sections ?? [];
  const leadBoardItems = board?.lead_board.items ?? [];
  const visibleProjects = useMemo(
    () => (workspaceView === "lead_board" ? leadBoardItems : visibleSections.flatMap((section) => section.items)),
    [leadBoardItems, visibleSections, workspaceView]
  );
  const visibleProjectIds = useMemo(() => new Set(visibleProjects.map((project) => project.id)), [visibleProjects]);
  const derivedLeadBoardOwners = useMemo(() => {
    const owners = new Map<string, { id: string; label: string; detail: string | null }>();
    for (const project of leadBoardItems) {
      if (!project.owner_user_id) {
        continue;
      }
      owners.set(project.owner_user_id, {
        id: project.owner_user_id,
        label: project.owner_label,
        detail: toGraphicsLabel(project.next_owner_label ?? project.team_owner_label)
      });
    }
    return [...owners.values()].sort((left, right) => left.label.localeCompare(right.label));
  }, [leadBoardItems]);
  const referenceOwners = references?.owners?.length ? references.owners : derivedLeadBoardOwners;
  const referenceOrganizations = references?.organizations ?? [];
  const referenceLocations = references?.locations ?? [];
  const referenceShoots = references?.shoots ?? [];
  const triggerSources = references?.source_triggers ?? [];

  const createLocationOptions = useMemo(
    () => referenceLocations.filter((location) => matchesLocationContext(location.organization_id, createDraft.linkedOrganizationId)),
    [createDraft.linkedOrganizationId, referenceLocations]
  );
  const createShootOptions = useMemo(
    () =>
      referenceShoots.filter((shoot) =>
        matchesShootContext(shoot, createDraft.linkedOrganizationId, createDraft.linkedLocationId)
      ),
    [createDraft.linkedLocationId, createDraft.linkedOrganizationId, referenceShoots]
  );
  const filterLocationOptions = useMemo(
    () => referenceLocations.filter((location) => matchesLocationContext(location.organization_id, filters.linked_organization_id ?? "")),
    [filters.linked_organization_id, referenceLocations]
  );
  const filterShootOptions = useMemo(
    () =>
      referenceShoots.filter((shoot) =>
        matchesShootContext(shoot, filters.linked_organization_id ?? "", filters.linked_location_id ?? "")
      ),
    [filters.linked_location_id, filters.linked_organization_id, referenceShoots]
  );
  const advancedFilterCount = countAdvancedFilters(filters);
  const workspaceIntro = describeProductionWorkspace(window.location.hash, workspaceView);
  const summaryCards = useMemo(
    () =>
      board
        ? workspaceView === "lead_board"
          ? [
              {
                label: "All Unfinished Jobs",
                value: board.summary.all_unfinished,
                detail: "Everything still in flight across intake, graphics, QA, corrections, and send.",
                hash: buildProductionProjectsHash({ queue: "all", status: "open", view: "lead_board" }),
                tone: "warning"
              },
              {
                label: "Overdue Jobs",
                value: board.summary.overdue,
                detail: "Jobs whose due date or follow-up date is already behind the anchor day.",
                hash: buildProductionProjectsHash({ queue: "at_risk_queue", due_state: "overdue", view: "lead_board" }),
                tone: "critical"
              },
              {
                label: "Blocked Jobs",
                value: board.summary.blocked,
                detail: "Projects blocked by dependencies, missing inputs, QA returns, or outside decisions.",
                hash: buildProductionProjectsHash({ queue: "blocked_queue", stage: "blocked", view: "lead_board" }),
                tone: "critical"
              },
              {
                label: "Pending Peer Review",
                value: board.summary.awaiting_peer_review ?? board.summary.jobs_in_qa,
                detail: "Jobs waiting for peer review before quality gates can move.",
                hash: buildProductionProjectsHash({ queue: "qa_queue", stage: "ready_for_qa", view: "lead_board" }),
                tone: "warning"
              },
              {
                label: "Pending Final QC",
                value: board.summary.awaiting_final_qc ?? 0,
                detail: "Jobs still waiting on final QC signoff before release is safe.",
                hash: buildProductionProjectsHash({ queue: "qa_queue", stage: "in_qa_review", view: "lead_board" }),
                tone: "warning"
              },
              {
                label: "Ready to Send",
                value: board.summary.ready_to_send,
                detail: "Jobs that have cleared the workflow and are safe for the controlled send step.",
                hash: buildProductionProjectsHash({ queue: "ready_to_release_queue", stage: "ready_to_release", view: "lead_board" }),
                tone: "success"
              },
              {
                label: "Wait To Send",
                value: board.summary.waiting_to_send,
                detail: "Jobs sitting in the release handoff lane and still needing the final send action watched.",
                hash: buildProductionProjectsHash({ queue: "ready_to_release_queue", view: "lead_board" }),
                tone: "warning"
              },
              {
                label: "Corrections Needed",
                value: board.summary.corrections_needed,
                detail: "Jobs returned for correction that can quietly go stale if they drop between feeds.",
                hash: buildProductionProjectsHash({ queue: "qa_queue", stage: "correction_needed", view: "lead_board" }),
                tone: "critical"
              },
              {
                label: "Stale Active Jobs",
                value: board.summary.stale_active,
                detail: "Open jobs that have not been touched recently and are now highest-risk for missed work.",
                hash: buildProductionProjectsHash({ queue: "all", status: "open", view: "lead_board" }),
                tone: "warning"
              },
              {
                label: "Needs Owner Coverage",
                value: board.summary.jobs_needing_owner_reassignment ?? board.summary.unassigned_jobs,
                detail: "Jobs or review gates that still need the right owner or reviewer assigned.",
                hash: buildProductionProjectsHash({ queue: "team_queue", owner_user_id: "unassigned", view: "lead_board" }),
                tone: "warning"
              },
              {
                label: "Triggered Intake Waiting",
                value: board.summary.trigger_intake_waiting ?? 0,
                detail: "Triggered jobs still parked at intake or ready-for-graphics instead of moving cleanly into active work.",
                hash: buildProductionProjectsHash({ queue: "team_queue", stage: "intake_pending", source_type: "trigger", view: "lead_board" }),
                tone: "warning"
              },
              {
                label: "Feed / Source Issues",
                value:
                  board.intake.counts.duplicates +
                  board.intake.counts.conflicts +
                  board.intake.counts.sync_failures +
                  board.intake.counts.stale_syncs,
                detail: board.intake.summary_line,
                hash: buildProductionProjectsHash({ queue: "all", status: "open", source_type: "trigger", view: "lead_board" }),
                tone:
                  board.intake.counts.conflicts + board.intake.counts.sync_failures > 0
                    ? "critical"
                    : board.intake.counts.duplicates + board.intake.counts.stale_syncs > 0
                      ? "warning"
                      : "success"
              }
            ]
          : [
              {
                label: "My Queue",
                value: board.summary.my_queue,
                detail: "Work already assigned to you or sitting in your immediate graphics lane.",
                hash: buildProductionProjectsHash({ queue: "my_queue", status: "open", view: "staff_workspace" }),
                tone: "warning"
              },
              {
                label: "Blocked Work",
                value: board.summary.blocked,
                detail: "Jobs you cannot move until blockers, inputs, or outside decisions are cleared.",
                hash: buildProductionProjectsHash({ queue: "blocked_queue", stage: "blocked", view: "staff_workspace" }),
                tone: "critical"
              },
              {
                label: "Needs Peer Review",
                value: board.summary.awaiting_peer_review ?? board.summary.jobs_in_qa,
                detail: "Work that must cross the peer-review gate before the workflow can advance.",
                hash: buildProductionProjectsHash({ queue: "qa_queue", stage: "ready_for_qa", view: "staff_workspace" }),
                tone: "warning"
              },
              {
                label: "Needs Final QC",
                value: board.summary.awaiting_final_qc ?? 0,
                detail: "Jobs that still need final QC signoff before release is safe.",
                hash: buildProductionProjectsHash({ queue: "qa_queue", stage: "in_qa_review", view: "staff_workspace" }),
                tone: "warning"
              },
              {
                label: "Corrections Needed",
                value: board.summary.corrections_needed,
                detail: "Returned work that needs attention before it gets lost between review passes.",
                hash: buildProductionProjectsHash({ queue: "qa_queue", stage: "correction_needed", view: "staff_workspace" }),
                tone: "critical"
              },
              {
                label: "Ready to Send",
                value: board.summary.ready_to_send,
                detail: "Jobs that have cleared the workflow and are waiting for the controlled send step.",
                hash: buildProductionProjectsHash({ queue: "ready_to_release_queue", stage: "ready_to_release", view: "staff_workspace" }),
                tone: "success"
              },
              {
                label: "Due Today",
                value: board.summary.due_within_24_hours,
                detail: "Open work with immediate deadline pressure in the current shift.",
                hash: buildProductionProjectsHash({ queue: "at_risk_queue", due_state: "due_today", view: "staff_workspace" }),
                tone: "warning"
              },
              {
                label: "Stale Active",
                value: board.summary.stale_active,
                detail: "Jobs that have not been touched recently and now need a deliberate follow-up pass.",
                hash: buildProductionProjectsHash({ queue: "all", status: "open", view: "staff_workspace" }),
                tone: "warning"
              }
            ]
        : [],
    [board, workspaceView]
  );

  const releaseDelaySummary = analytics?.release_delay_stages?.[0] ?? null;
  const workspaceGuidanceCards = useMemo<ProductionGuidanceCard[]>(() => {
    const roleCard: ProductionGuidanceCard =
      workspaceView === "lead_board"
        ? {
            eyebrow: "Role Quick Help",
            title: "Manager Scan Rules",
            summary: "Lead-board oversight should reduce missed work, not turn into another private tracker.",
            bullets: [
              "Triage stale, blocked, unassigned, and intake-risk jobs before new work.",
              "Use current step, due date, and owner drift to catch missed work early.",
              "Treat upstream sync failures as real execution risk, not just admin noise."
            ],
            hash: buildProductionProjectsHash({ queue: "all", status: "open", view: "lead_board" }),
            linkLabel: "Open Lead Board"
          }
        : {
            eyebrow: "Role Quick Help",
            title: "My Workflow Discipline",
            summary: "Operator guidance should keep work moving correctly without burying the task ladder under training copy.",
            bullets: [
              "Claim only work you can actually move and leave honest blockers behind.",
              "Keep task owners, due dates, and short notes current on every handoff.",
              "Do not skip peer review, final QC, or release gates just to clear the queue."
            ],
            hash: buildProductionProjectsHash({ queue: "my_queue", status: "open", view: "staff_workspace" }),
            linkLabel: "Open My Queue"
          };
    return [roleCard, ...PRODUCTION_GUIDANCE_CARDS];
  }, [workspaceView]);

  async function reloadBoard() {
    const payload = await listProductionProjects(token, { ...filters, workspace_view: workspaceView });
    setBoard(payload);
  }

  async function reloadQaWorkspace() {
    if (!isQaWorkspace) {
      return;
    }
    const payload = await getProductionProjectQaWorkspace(token);
    setQaWorkspace(payload);
  }

  async function reloadAnalytics() {
    if (!isAnalyticsWorkspace) {
      return;
    }
    const payload = await getProductionProjectAnalytics(token, analyticsWindowDays);
    setAnalytics(payload);
  }

  async function reloadDetail(projectId: string) {
    const payload = await getProductionProjectDetail(token, projectId);
    applyDetailPayload(payload);
  }

  function applyDetailPayload(payload: ProductionProjectDetail) {
    setDetail(payload);
    setDetailDraft({
      status: payload.project.status,
      jobType: payload.project.job_type,
      stage: payload.project.stage,
      ownerUserId: payload.project.owner_user_id ?? "",
      peerReviewerUserId: payload.project.peer_reviewer_user_id ?? "",
      finalQcReviewerUserId: payload.project.final_qc_reviewer_user_id ?? "",
      dueDate: payload.project.due_date ?? "",
      followUpDate: payload.project.follow_up_date ?? "",
      note: payload.project.latest_note ?? ""
    });
  }

  async function refreshAll(projectId?: string | null) {
    await reloadBoard();
    await reloadQaWorkspace();
    await reloadAnalytics();
    if (projectId) {
      await reloadDetail(projectId);
    }
  }

  function pushRoute(next: Partial<RouteState>, filterOverrides: Partial<BoardFiltersState> = {}) {
    const merged: RouteState = {
      projectId: next.projectId !== undefined ? next.projectId : route.projectId,
      workspaceView: next.workspaceView !== undefined ? next.workspaceView : route.workspaceView
    };
    const mergedFilters = buildBoardFilters(filters.anchorDate, { ...filters, ...filterOverrides });
    window.location.hash = buildProductionProjectsHash(
      toHashState(merged.projectId, mergedFilters, leadBoardEligible ? (merged.workspaceView ?? workspaceView) : null)
    );
  }

  useEffect(() => {
    if (loading || !board) {
      return;
    }
    const firstVisibleProjectId = visibleProjects[0]?.id ?? null;
    if (!firstVisibleProjectId) {
      if (route.projectId) {
        setDetail(null);
        setDetailError("");
        pushRoute({ projectId: null });
      }
      return;
    }
    if (!route.projectId || !visibleProjectIds.has(route.projectId)) {
      setDetail(null);
      setDetailError("");
      pushRoute({ projectId: firstVisibleProjectId });
    }
  }, [board, loading, route.projectId, visibleProjectIds, visibleProjects]);

  function resetCreateDraft() {
      setCreateDraft({
        templateId: "",
        title: "",
        summary: "",
        jobType: "standard_school_production",
        category: "digital_production",
        priority: "normal",
        ownerUserId: "",
      dueDate: filters.anchorDate,
      followUpDate: "",
      linkedOrganizationId: "",
      linkedLocationId: "",
      linkedShootId: "",
      note: ""
    });
  }

  function setCreateOrganization(organizationId: string) {
    setCreateDraft((current) => {
      const nextLocationId =
        current.linkedLocationId &&
        referenceLocations.some(
          (location) => location.id === current.linkedLocationId && matchesLocationContext(location.organization_id, organizationId)
        )
          ? current.linkedLocationId
          : "";
      const nextShootId =
        current.linkedShootId &&
        referenceShoots.some((shoot) => shoot.id === current.linkedShootId && matchesShootContext(shoot, organizationId, nextLocationId))
          ? current.linkedShootId
          : "";
      return {
        ...current,
        linkedOrganizationId: organizationId,
        linkedLocationId: nextLocationId,
        linkedShootId: nextShootId
      };
    });
  }

  function setCreateLocation(locationId: string) {
    const selectedLocation = referenceLocations.find((location) => location.id === locationId) ?? null;
    setCreateDraft((current) => {
      const nextOrganizationId = selectedLocation?.organization_id ?? current.linkedOrganizationId;
      const nextShootId =
        current.linkedShootId &&
        referenceShoots.some((shoot) => shoot.id === current.linkedShootId && matchesShootContext(shoot, nextOrganizationId ?? "", locationId))
          ? current.linkedShootId
          : "";
      return {
        ...current,
        linkedOrganizationId: nextOrganizationId ?? "",
        linkedLocationId: locationId,
        linkedShootId: nextShootId
      };
    });
  }

  function setCreateShoot(shootId: string) {
    const selectedShoot = referenceShoots.find((shoot) => shoot.id === shootId) ?? null;
    setCreateDraft((current) => ({
      ...current,
      linkedShootId: shootId,
      linkedOrganizationId: selectedShoot?.organization_id ?? current.linkedOrganizationId,
      linkedLocationId: selectedShoot?.location_id ?? current.linkedLocationId
    }));
  }

  function setFilterOrganization(organizationId: string) {
    setFilters((current) => {
      const nextLocationId =
        current.linked_location_id &&
        referenceLocations.some(
          (location) => location.id === current.linked_location_id && matchesLocationContext(location.organization_id, organizationId)
        )
          ? current.linked_location_id
          : null;
      const nextShootId =
        current.linked_shoot_id &&
        referenceShoots.some((shoot) => shoot.id === current.linked_shoot_id && matchesShootContext(shoot, organizationId, nextLocationId ?? ""))
          ? current.linked_shoot_id
          : null;
      return {
        ...current,
        linked_organization_id: organizationId || null,
        linked_location_id: nextLocationId,
        linked_shoot_id: nextShootId
      };
    });
  }

  function setFilterLocation(locationId: string) {
    const selectedLocation = referenceLocations.find((location) => location.id === locationId) ?? null;
    setFilters((current) => {
      const nextOrganizationId = selectedLocation?.organization_id ?? current.linked_organization_id ?? null;
      const nextShootId =
        current.linked_shoot_id &&
        referenceShoots.some((shoot) => shoot.id === current.linked_shoot_id && matchesShootContext(shoot, nextOrganizationId ?? "", locationId))
          ? current.linked_shoot_id
          : null;
      return {
        ...current,
        linked_organization_id: nextOrganizationId,
        linked_location_id: locationId || null,
        linked_shoot_id: nextShootId
      };
    });
  }

  function setFilterShoot(shootId: string) {
    const selectedShoot = referenceShoots.find((shoot) => shoot.id === shootId) ?? null;
    setFilters((current) => ({
      ...current,
      linked_shoot_id: shootId || null,
      linked_organization_id: selectedShoot?.organization_id ?? current.linked_organization_id ?? null,
      linked_location_id: selectedShoot?.location_id ?? current.linked_location_id ?? null
    }));
  }

  function clearAdvancedFilters() {
    setFilters((current) => ({
      ...current,
      owner_user_id: null,
      priority: DEFAULT_PRIORITY,
      template_id: null,
      source_type: DEFAULT_SOURCE_TYPE,
      source_trigger_key: null,
      category: DEFAULT_CATEGORY,
      job_type: DEFAULT_JOB_TYPE,
      stage: DEFAULT_STAGE,
      team_owner: DEFAULT_TEAM_OWNER,
      linked_organization_id: null,
      linked_location_id: null,
      linked_shoot_id: null,
      due_state: DEFAULT_DUE_STATE,
      big_critical_only: false
    }));
  }

  async function submitCreate() {
    setCreateBusy(true);
    setCreateError("");
    try {
      const payload = await createProductionProject(token, {
        template_id: createDraft.templateId || null,
        title: createDraft.title,
        summary: createDraft.summary || null,
        job_type: createDraft.jobType,
        category: createDraft.category,
        priority: createDraft.priority,
        owner_user_id: createDraft.ownerUserId || null,
        due_date: createDraft.dueDate || null,
        follow_up_date: createDraft.followUpDate || null,
        linked_organization_id: createDraft.linkedOrganizationId || null,
        linked_location_id: createDraft.linkedLocationId || null,
        linked_shoot_id: createDraft.linkedShootId || null,
        latest_note: createDraft.note || null
      });
      setCreateOpen(false);
      resetCreateDraft();
      await refreshAll(payload.project.id);
      pushRoute({ projectId: payload.project.id }, { queue: "team_queue" });
    } catch (submitError) {
      setCreateError(messageFor(submitError, "We couldn't create that graphics item."));
    } finally {
      setCreateBusy(false);
    }
  }

  async function applyProjectPatchToProject(projectId: string, patch: {
    status?: ProductionProjectStatus;
    stage?: ProductionProjectStage;
    owner_user_id?: string | null;
    peer_reviewer_user_id?: string | null;
    final_qc_reviewer_user_id?: string | null;
    job_type?: ProductionProjectJobType;
    due_date?: string | null;
    follow_up_date?: string | null;
    snoozed_until?: string | null;
    latest_note?: string | null;
    blocker_type?: string | null;
    blocker_reason?: string | null;
    correction_reason?: string | null;
  }) {
    setSavingDetail(true);
    setDetailError("");
    setNotice("");
    try {
      const payload = await updateProductionProject(token, projectId, patch);
      if ("approval_required" in payload) {
        applyDetailPayload(payload.detail);
        await reloadBoard();
        setNotice(`${payload.approval_request.request_title} was routed for approval.`);
        return;
      }
      await refreshAll(projectId);
    } catch (saveError) {
      setDetailError(messageFor(saveError, "We couldn't update that graphics item right now."));
    } finally {
      setSavingDetail(false);
    }
  }

  async function handleQaReviewSubmission(input: {
    result: "passed" | "correction_needed" | "blocked";
    note?: string | null;
    correction_reason?: string | null;
    qa_checks: ProductionProjectQaCheckRecord[];
  }) {
    if (!detail?.project.id) {
      return;
    }
    setSavingDetail(true);
    setDetailError("");
    setNotice("");
    try {
      const payload = await submitProductionProjectQaReview(token, detail.project.id, input);
      if ("approval_required" in payload) {
        applyDetailPayload(payload.detail);
        setNotice(`${payload.approval_request.request_title} was routed for approval.`);
        return;
      }
      applyDetailPayload(payload);
      await refreshAll(detail.project.id);
    } catch (saveError) {
      setDetailError(messageFor(saveError, "We couldn't save the QA review right now."));
    } finally {
      setSavingDetail(false);
    }
  }

  async function applyProjectPatch(patch: {
    status?: ProductionProjectStatus;
    stage?: ProductionProjectStage;
    owner_user_id?: string | null;
    peer_reviewer_user_id?: string | null;
    final_qc_reviewer_user_id?: string | null;
    job_type?: ProductionProjectJobType;
    due_date?: string | null;
    follow_up_date?: string | null;
    snoozed_until?: string | null;
    latest_note?: string | null;
    blocker_type?: string | null;
    blocker_reason?: string | null;
    correction_reason?: string | null;
  }) {
    if (!detail?.project.id) {
      return;
    }
    await applyProjectPatchToProject(detail.project.id, patch);
  }

  async function handleTaskUpdate(
    taskId: string,
    patch: {
      status?: "todo" | "in_progress" | "blocked" | "done" | "skipped";
      owner_user_id?: string | null;
      due_date?: string | null;
      latest_note?: string | null;
      handoff_to_user_id?: string | null;
      handoff_note?: string | null;
    }
  ) {
    if (!detail?.project.id) {
      return;
    }
    setSavingDetail(true);
    try {
      await updateProductionProjectTask(token, detail.project.id, taskId, patch);
      await refreshAll(detail.project.id);
    } catch (taskError) {
      setDetailError(messageFor(taskError, "We couldn't update that checklist item right now."));
    } finally {
      setSavingDetail(false);
    }
  }

  async function handleBuddyWorkflowUpdate(patch: {
    status?: "todo" | "in_progress" | "blocked" | "done" | "skipped";
    owner_user_id?: string | null;
    duplicate_handling_required?: boolean;
    cleanup_completed?: boolean;
    unresolved_group_count?: number;
    notes?: string | null;
  }) {
    if (!detail?.project.id) {
      return;
    }
    setSavingDetail(true);
    try {
      await updateBuddyWorkflow(token, detail.project.id, patch);
      await refreshAll(detail.project.id);
    } catch (buddyError) {
      setDetailError(messageFor(buddyError, "We couldn't update the buddy photo workflow right now."));
    } finally {
      setSavingDetail(false);
    }
  }

  async function handleVirtualTeamWorkflowUpdate(patch: {
    status?: "todo" | "in_progress" | "blocked" | "done" | "skipped";
    owner_user_id?: string | null;
    attributes_validated?: boolean;
    coach_tags_validated?: boolean;
    split_by_group_validated?: boolean;
    ambiguous_match_required?: boolean;
    ambiguous_match_resolved?: boolean;
    notes?: string | null;
  }) {
    if (!detail?.project.id) {
      return;
    }
    setSavingDetail(true);
    try {
      await updateVirtualTeamWorkflow(token, detail.project.id, patch);
      await refreshAll(detail.project.id);
    } catch (vtError) {
      setDetailError(messageFor(vtError, "We couldn't update the virtual team workflow right now."));
    } finally {
      setSavingDetail(false);
    }
  }

  async function handleExceptionCreate(payload: {
    lane_type: "buddy_photos" | "virtual_teams";
    exception_type:
      | "buddy_unresolved_group"
      | "buddy_duplicate_handling_needed"
      | "vt_ambiguous_match"
      | "vt_coach_tag_missing"
      | "vt_split_group_mismatch"
      | "vt_attribute_validation_failed";
    severity?: "low" | "normal" | "high" | "critical";
    blocking?: boolean;
    assignee_user_id?: string | null;
    notes?: string | null;
    issue_tag?: string | null;
    follow_up_type?: "training" | "ops_followup" | "coaching" | "process_update" | null;
    follow_up_status?: "open" | "in_progress" | "complete" | null;
    follow_up_owner_user_id?: string | null;
    follow_up_notes?: string | null;
  }) {
    if (!detail?.project.id) {
      return;
    }
    setSavingDetail(true);
    try {
      await createProductionProjectException(token, detail.project.id, payload);
      await refreshAll(detail.project.id);
    } catch (exceptionError) {
      setDetailError(messageFor(exceptionError, "We couldn't log that exception right now."));
    } finally {
      setSavingDetail(false);
    }
  }

  async function handleExceptionUpdate(
    exceptionId: string,
    patch: {
      status?: "open" | "resolved" | "dismissed";
      blocking?: boolean;
      assignee_user_id?: string | null;
      notes?: string | null;
      resolution_notes?: string | null;
      issue_tag?: string | null;
      follow_up_type?: "training" | "ops_followup" | "coaching" | "process_update" | null;
      follow_up_status?: "open" | "in_progress" | "complete" | null;
      follow_up_owner_user_id?: string | null;
      follow_up_notes?: string | null;
    }
  ) {
    if (!detail?.project.id) {
      return;
    }
    setSavingDetail(true);
    try {
      await updateProductionProjectException(token, exceptionId, patch);
      await refreshAll(detail.project.id);
    } catch (exceptionError) {
      setDetailError(messageFor(exceptionError, "We couldn't update that exception right now."));
    } finally {
      setSavingDetail(false);
    }
  }

  return (
    <div className="workspace-shell">
      <WorkspacePageHeader
        eyebrow="Graphics"
        title={workspaceView === "lead_board" ? "Graphics command board" : workspaceIntro.title}
        summary={workspaceIntro.summary}
        meta={
          board
            ? [
                { label: workspaceView === "lead_board" ? "Manager board" : "Staff workspace", tone: "info" },
                { label: `${visibleProjects.length} visible`, tone: "neutral" }
              ]
            : [{ label: workspaceView === "lead_board" ? "Manager board" : "Staff workspace", tone: "info" }]
        }
        actions={
          <>
            {leadBoardEligible ? (
              <div className="segmented-toggle segmented-toggle--compact" role="tablist" aria-label="Graphics workspace view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={workspaceView === "lead_board"}
                  className={workspaceView === "lead_board" ? "is-active" : ""}
                  onClick={() => pushRoute({ workspaceView: "lead_board" })}
                >
                  Lead Board
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={workspaceView === "staff_workspace"}
                  className={workspaceView === "staff_workspace" ? "is-active" : ""}
                  onClick={() => pushRoute({ workspaceView: "staff_workspace" })}
                >
                  Staff Workspace
                </button>
              </div>
            ) : null}
            {leadBoardEligible ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  window.location.hash = "#graphics/analytics";
                }}
              >
                Analytics
              </button>
            ) : null}
            <label className="filter-field">
              <span>Anchor Date</span>
              <input
                type="date"
                value={filters.anchorDate}
                onChange={(event) => setFilters((current) => ({ ...current, anchorDate: event.target.value }))}
              />
            </label>
            <button type="button" onClick={() => setCreateOpen(true)}>
              Add Manual Item
            </button>
          </>
        }
        compact
      />

      {notice ? (
        <section className="panel workspace-status workspace-status--success">
          <strong>Approval Requested</strong>
          <span>{notice}</span>
        </section>
      ) : null}

      <ProjectTrackingDepartmentQueue
        token={token}
        department="production"
        title="Production and Graphics workflow queue"
        summary="Live Project Dashboard rows where the current workflow step belongs to Production. Graphics-specific assignment is still handled in the graphics board below."
      />

      <WorkspaceFilterToolbar>
        <div className="workspace-toolbar__group">
          <label className="filter-field filter-field--wide">
            <span>Find Work</span>
            <input
              value={filters.search ?? ""}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Search by title, account, location, or shoot"
            />
          </label>
          <label className="filter-field">
            <span>Status</span>
            <select
              value={filters.status ?? "open"}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as "open" | "completed" | "all" }))}
            >
              <option value="open">Open</option>
              <option value="completed">Completed</option>
              <option value="all">All</option>
            </select>
          </label>
          <label className="filter-field">
            <span>Workflow View</span>
            <select
              value={filters.queue ?? "all"}
              onChange={(event) => {
                const nextQueue = event.target.value as ProductionProjectQueueId | "all";
                setFilters((current) => ({ ...current, queue: nextQueue }));
              }}
            >
              <option value="all">All workflow views</option>
              <option value="my_queue">My Queue</option>
              <option value="team_queue">Team Queue</option>
              <option value="blocked_queue">Blocked Queue</option>
              <option value="qa_queue">QA Queue</option>
              <option value="ready_to_release_queue">Ready to Release</option>
              <option value="at_risk_queue">Overdue / At Risk</option>
            </select>
          </label>
        </div>
        <WorkspaceActionBar compact>
          <button type="button" className="secondary-button" onClick={() => setShowAdvancedFilters((value) => !value)}>
            {showAdvancedFilters ? "Hide Filters" : `More Filters${advancedFilterCount ? ` (${advancedFilterCount})` : ""}`}
          </button>
          {advancedFilterCount ? (
            <button type="button" className="secondary-button" onClick={clearAdvancedFilters}>
              Clear Filters
            </button>
          ) : null}
        </WorkspaceActionBar>
        {showAdvancedFilters || advancedFilterCount ? (
          <div className="form-grid form-grid--compact projects-filter-grid">
            <label className="filter-field">
              <span>Owner</span>
              <select
                value={filters.owner_user_id ?? ""}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    owner_user_id: event.target.value ? (event.target.value as string | "unassigned") : null
                  }))
                }
              >
                <option value="">All owners</option>
                <option value="unassigned">Unassigned</option>
                {referenceOwners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Priority</span>
              <select
                value={filters.priority ?? DEFAULT_PRIORITY}
                onChange={(event) => setFilters((current) => ({ ...current, priority: event.target.value as BoardFiltersState["priority"] }))}
              >
                <option value="all">All priorities</option>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label className="filter-field">
              <span>Template</span>
              <select value={filters.template_id ?? ""} onChange={(event) => setFilters((current) => ({ ...current, template_id: event.target.value || null }))}>
                <option value="">All templates</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Created By</span>
              <select
                value={filters.source_type ?? DEFAULT_SOURCE_TYPE}
                onChange={(event) => setFilters((current) => ({ ...current, source_type: event.target.value as BoardFiltersState["source_type"] }))}
              >
                <option value="all">All creation paths</option>
                <option value="manual">Manual</option>
                <option value="trigger">Trigger</option>
              </select>
            </label>
            <label className="filter-field">
              <span>Trigger</span>
              <select value={filters.source_trigger_key ?? ""} onChange={(event) => setFilters((current) => ({ ...current, source_trigger_key: event.target.value || null }))}>
                <option value="">All triggers</option>
                {triggerSources.map((trigger) => (
                  <option key={trigger.key} value={trigger.key}>
                    {trigger.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Category</span>
              <select
                value={filters.category ?? DEFAULT_CATEGORY}
                onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value as BoardFiltersState["category"] }))}
              >
                <option value="all">All categories</option>
                {PROJECT_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Job Type</span>
              <select
                value={filters.job_type ?? DEFAULT_JOB_TYPE}
                onChange={(event) => setFilters((current) => ({ ...current, job_type: event.target.value as BoardFiltersState["job_type"] }))}
              >
                <option value="all">All job types</option>
                {PROJECT_JOB_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Workflow State</span>
              <select
                value={filters.stage ?? DEFAULT_STAGE}
                onChange={(event) => setFilters((current) => ({ ...current, stage: event.target.value as BoardFiltersState["stage"] }))}
              >
                <option value="all">All stages</option>
                {PROJECT_STAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Owning Queue</span>
              <select
                value={filters.team_owner ?? DEFAULT_TEAM_OWNER}
                onChange={(event) => setFilters((current) => ({ ...current, team_owner: event.target.value as BoardFiltersState["team_owner"] }))}
              >
                <option value="all">All owning queues</option>
                {PROJECT_TEAM_OWNER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Due State</span>
              <select
                value={filters.due_state ?? DEFAULT_DUE_STATE}
                onChange={(event) => setFilters((current) => ({ ...current, due_state: event.target.value as ProductionProjectDueState | "all" }))}
              >
                <option value="all">All due states</option>
                <option value="overdue">Overdue</option>
                <option value="due_today">Due Today</option>
                <option value="upcoming">Upcoming</option>
                <option value="unscheduled">Unscheduled</option>
              </select>
            </label>
            <label className="filter-field">
              <span>Organization</span>
              <select value={filters.linked_organization_id ?? ""} onChange={(event) => setFilterOrganization(event.target.value)}>
                <option value="">All organizations</option>
                {referenceOrganizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Location</span>
              <select value={filters.linked_location_id ?? ""} onChange={(event) => setFilterLocation(event.target.value)}>
                <option value="">All locations</option>
                {filterLocationOptions.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Shoot</span>
              <select value={filters.linked_shoot_id ?? ""} onChange={(event) => setFilterShoot(event.target.value)}>
                <option value="">All shoots</option>
                {filterShootOptions.map((shoot) => (
                  <option key={shoot.id} value={shoot.id}>
                    {shoot.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field filter-field--checkbox">
              <span>Big / Critical Only</span>
              <input
                type="checkbox"
                checked={Boolean(filters.big_critical_only)}
                onChange={(event) => setFilters((current) => ({ ...current, big_critical_only: event.target.checked }))}
              />
            </label>
          </div>
        ) : null}
      </WorkspaceFilterToolbar>

      {error ? <div className="error-banner">{error}</div> : null}

      {isQaWorkspace ? (
        <OperationalDetailSection
          title="QA Workspace"
          summary="QA hold, review readiness, blocking exceptions, and release readiness in one view."
          defaultOpen
        >
          {qaWorkspaceError ? <div className="error-banner">{qaWorkspaceError}</div> : null}
          {qaWorkspaceLoading ? (
            <div className="muted">Loading QA workspace...</div>
          ) : qaWorkspace ? (
            <>
              <div className="qa-workspace-grid">
                {[
                  {
                    label: "QA Hold",
                    value: qaWorkspace.qa_hold.length,
                    detail: "Jobs held in QA with blockers or unresolved checks.",
                    hash: buildProductionProjectsHash({ queue: "qa_queue", stage: "qa_hold", view: "staff_workspace" }),
                    tone: "critical" as const
                  },
                  {
                    label: "Ready For QA",
                    value: qaWorkspace.ready_for_qa.length,
                    detail: "Jobs ready to start peer review.",
                    hash: buildProductionProjectsHash({ queue: "qa_queue", stage: "ready_for_qa", view: "staff_workspace" }),
                    tone: "warning" as const
                  },
                  {
                    label: "Blocked By Exceptions",
                    value: qaWorkspace.blocked_by_exceptions.length,
                    detail: "Jobs with blocking exceptions that must clear before release.",
                    hash: buildProductionProjectsHash({ queue: "blocked_queue", view: "staff_workspace" }),
                    tone: "critical" as const
                  },
                  {
                    label: "Ready For Release",
                    value: qaWorkspace.ready_for_release.length,
                    detail: "Jobs that cleared QA and are ready for the controlled send.",
                    hash: buildProductionProjectsHash({ queue: "ready_to_release_queue", stage: "ready_to_release", view: "staff_workspace" }),
                    tone: "success" as const
                  }
                ].map((card) => (
                  <OperationalPreviewCard
                    key={card.label}
                    title={card.label}
                    summary={card.detail}
                    statusLabel={`${card.value}`}
                    statusTone={card.tone}
                    onClick={() => {
                      window.location.hash = card.hash;
                    }}
                    density="compact"
                  />
                ))}
              </div>

              <div className="qa-workspace-recent">
                <div className="section-title">Recent QA Reviews</div>
                {qaWorkspace.recent_reviews.length ? (
                  <div className="ops-preview-list">
                    {qaWorkspace.recent_reviews.map((entry) => (
                      <OperationalPreviewCard
                        key={entry.review.id}
                        eyebrow={toGraphicsLabel(entry.project.category_label)}
                        title={entry.project.title}
                        summary={entry.review.result_label}
                        meta={[
                          { label: entry.project.stage_label, tone: "info" },
                          { label: entry.review.review_stage_label, tone: "neutral" }
                        ]}
                        nextAction={`Reviewed by ${entry.review.reviewer_label ?? "System"}`}
                        onClick={() => {
                          window.location.hash = buildProductionProjectsHash({
                            projectId: entry.project.id,
                            queue: "qa_queue",
                            view: "staff_workspace"
                          });
                        }}
                        density="compact"
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty-state empty-state--panel">No recent QA reviews yet.</div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state empty-state--panel">QA workspace data is not available yet.</div>
          )}
        </OperationalDetailSection>
      ) : null}

      {isAnalyticsWorkspace ? (
        <OperationalDetailSection
          title="Graphics Analytics"
          summary="Pattern-level QA issues, workload hotspots, and release delays."
          defaultOpen
        >
          {analyticsError ? <div className="error-banner">{analyticsError}</div> : null}
          <div className="analytics-toolbar">
            <label className="filter-field">
              <span>Window</span>
              <select
                value={analyticsWindowDays}
                onChange={(event) => setAnalyticsWindowDays(Number(event.target.value))}
              >
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
                <option value={180}>Last 180 days</option>
                <option value={365}>Last 12 months</option>
              </select>
            </label>
            <span className="muted">
              Window: {analytics?.window_start ?? "—"} to {analytics?.window_end ?? "—"}
            </span>
          </div>
          {analyticsLoading ? (
            <div className="muted">Loading graphics analytics...</div>
          ) : analytics ? (
            <>
              <div className="analytics-summary-grid">
                <OperationalPreviewCard
                  title="Buddy Workflow Load"
                  summary="Jobs requiring buddy workflow validation."
                  statusLabel={`${analytics.buddy_workload.total}`}
                  statusTone={analytics.buddy_workload.total > 0 ? "warning" : "success"}
                  meta={[
                    { label: `${analytics.buddy_workload.duplicate_handling_required} duplicate handling`, tone: "info" },
                    { label: `${analytics.buddy_workload.unresolved_groups} unresolved groups`, tone: "warning" }
                  ]}
                  density="compact"
                />
                <OperationalPreviewCard
                  title="Virtual Team Load"
                  summary="Jobs requiring virtual team validation."
                  statusLabel={`${analytics.virtual_team_workload.total}`}
                  statusTone={analytics.virtual_team_workload.total > 0 ? "warning" : "success"}
                  meta={[{ label: `${analytics.virtual_team_workload.ambiguous_matches} ambiguous matches`, tone: "warning" }]}
                  density="compact"
                />
                <OperationalPreviewCard
                  title="Top Release Delay"
                  summary={releaseDelaySummary ? releaseDelaySummary.stage_label : "No delayed stages"}
                  statusLabel={releaseDelaySummary ? `${releaseDelaySummary.count}` : "0"}
                  statusTone={releaseDelaySummary ? "warning" : "success"}
                  meta={
                    releaseDelaySummary
                      ? [
                          { label: `Avg ${releaseDelaySummary.avg_days_in_stage} days`, tone: "info" },
                          { label: `Oldest ${releaseDelaySummary.oldest_days_in_stage} days`, tone: "critical" }
                        ]
                      : []
                  }
                  density="compact"
                />
              </div>

              <div className="analytics-grid">
                <AnalyticsTable title="QA Issues By Photographer" rows={analytics.qa_issues_by_photographer} />
                <AnalyticsTable title="QA Issues By Job Type" rows={analytics.qa_issues_by_job_type} />
                <AnalyticsTable title="QA Issues By Account" rows={analytics.qa_issues_by_account} />
                <AnalyticsTable title="QA Issues By Location" rows={analytics.qa_issues_by_location} />
                <AnalyticsTable title="Most Common Exception Types" rows={analytics.exception_type_frequency} />
                <AnalyticsTable title="Recurring Issue Tags" rows={analytics.recurring_issue_tags} emptyLabel="No issue tags logged yet." />
              </div>
            </>
          ) : (
            <div className="empty-state empty-state--panel">Graphics analytics are not available yet.</div>
          )}
        </OperationalDetailSection>
      ) : null}

      <section className="metrics-grid workspace-summary-strip">
        {summaryCards.map((card) => (
          <button
            key={card.label}
            type="button"
            className="stat-card panel workspace-summary-strip__button"
            onClick={() => {
              window.location.hash = card.hash;
            }}
          >
            <div className="eyebrow">{card.label}</div>
            <strong>{card.value}</strong>
            <span className="muted">{card.detail}</span>
          </button>
        ))}
      </section>

      {loading && !board ? (
        <WorkspaceLoadingBlock
          title="Loading Graphics"
          summary="Pulling ranked queues, intake context, linked shoot detail, QA gates, and release state."
        />
      ) : null}

      <div className="projects-layout">
        <section className="projects-board">
          {workspaceView === "lead_board" ? (
            <ProductionLeadBoard
              projects={leadBoardItems}
              allUnfinishedCount={board?.summary.all_unfinished ?? 0}
              summaryLine={board?.lead_board.summary_line ?? "All unfinished graphics workflow items in one board."}
              intake={board?.intake ?? null}
              selectedProjectId={selectedProjectId}
              currentUserId={currentUser.id}
              ownerOptions={referenceOwners}
              templateOptions={templates}
              ownerFilter={filters.owner_user_id ?? null}
              stepFilter={filters.stage ?? DEFAULT_STAGE}
              sourceFilter={filters.source_type ?? DEFAULT_SOURCE_TYPE}
              workflowFilter={filters.template_id ?? null}
              sortBy={filters.lead_board_sort ?? DEFAULT_LEAD_BOARD_SORT}
              focusFilter={filters.lead_board_focus ?? DEFAULT_LEAD_BOARD_FOCUS}
              onOpenProject={(projectId) => pushRoute({ projectId })}
              onAssignToMe={(project) =>
                void applyProjectPatchToProject(project.id, {
                  owner_user_id: currentUser.id,
                  latest_note: "Claimed from the Graphics lead board."
                })
              }
              onFollowUpToday={(project) =>
                void applyProjectPatchToProject(project.id, {
                  follow_up_date: filters.anchorDate,
                  latest_note: project.latest_note ?? "Follow-up reset from the Graphics lead board."
                })
              }
              onUpdateFilters={(next) =>
                setFilters((current) => ({
                  ...current,
                  owner_user_id: next.owner_user_id !== undefined ? next.owner_user_id : current.owner_user_id,
                  stage: next.stage !== undefined ? next.stage : current.stage,
                  source_type: next.source_type !== undefined ? next.source_type : current.source_type,
                  template_id: next.template_id !== undefined ? next.template_id : current.template_id,
                  lead_board_sort: next.lead_board_sort !== undefined ? next.lead_board_sort : current.lead_board_sort,
                  lead_board_focus: next.lead_board_focus !== undefined ? next.lead_board_focus : current.lead_board_focus
                }))
              }
              onResetFilters={() =>
                setFilters((current) => ({
                  ...current,
                  owner_user_id: null,
                  stage: DEFAULT_STAGE,
                  source_type: DEFAULT_SOURCE_TYPE,
                  template_id: null,
                  lead_board_sort: DEFAULT_LEAD_BOARD_SORT,
                  lead_board_focus: DEFAULT_LEAD_BOARD_FOCUS
                }))
              }
            />
          ) : (
            visibleSections.map((section, index) => (
              <OperationalDetailSection
                key={section.id}
                title={`${section.label} (${section.count})`}
                summary={section.summary}
                defaultOpen={section.count > 0 && (index < 2 || section.id === (filters.queue ?? "all"))}
              >
                {section.items.length ? (
                  <div className="ops-preview-list">
                    {section.items.map((project) => (
                      <OperationalPreviewCard
                        key={project.id}
                        eyebrow={toGraphicsLabel(project.category_label)}
                        title={project.title}
                        summary={project.summary ?? project.created_reason}
                        owner={project.owner_label}
                        statusLabel={toGraphicsLabel(project.stage_label)}
                        statusTone={project.status_tone}
                        meta={[
                          {
                            label: toGraphicsLabel(project.source_trigger_label ?? project.template_name ?? "Manual item"),
                            tone: "neutral" as const
                          },
                          ...(project.linked_shoot_code ? [{ label: project.linked_shoot_code, tone: "info" as const }] : []),
                          ...(!project.linked_shoot_code && project.linked_organization_name
                            ? [{ label: project.linked_organization_name, tone: "neutral" as const }]
                            : []),
                          ...(project.due_label ? [{ label: project.due_label, tone: "info" as const }] : []),
                          ...(project.follow_up_label ? [{ label: project.follow_up_label, tone: "warning" as const }] : [])
                        ]}
                        flags={project.flags.map((flag) => ({ label: flag.label, tone: flag.tone }))}
                        nextAction={project.next_action}
                        selected={selectedProjectId === project.id}
                        onClick={() => pushRoute({ projectId: project.id }, { queue: section.id })}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty-state empty-state--panel">No graphics work is sitting in this queue right now.</div>
                )}
              </OperationalDetailSection>
            ))
          )}

          <section className="panel production-guidance-panel" aria-labelledby="production-guidance-title">
            <div className="production-guidance-panel__header">
              <div>
                <div className="eyebrow">Graphics SOP</div>
                <h3 id="production-guidance-title">Quick SOP / operator guidance</h3>
                <p>Keep guidance tied to the real workflow, quality gates, and release rules instead of turning Graphics into a training site.</p>
              </div>
            </div>
            <div className="production-guidance-grid">
              {workspaceGuidanceCards.map((card) => (
                <article key={card.title} className="production-guidance-card">
                  <div className="eyebrow">{card.eyebrow}</div>
                  <strong>{card.title}</strong>
                  <p>{card.summary}</p>
                  <ul className="production-guidance-card__list">
                    {card.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                  <a className="secondary-button" href={card.hash}>
                    {card.linkLabel}
                  </a>
                </article>
              ))}
            </div>
          </section>
        </section>

        <ProductionProjectDetailPanel
          detail={detail}
          loading={detailLoading}
          error={detailError}
          workspaceView={workspaceView}
          currentUserId={currentUser.id}
          currentUserName={currentUser.fullName}
          ownerOptions={referenceOwners}
          draft={detailDraft}
          saving={savingDetail}
          onDraftChange={(next) => setDetailDraft((current) => ({ ...current, ...next }))}
          onAssignToMe={() => applyProjectPatch({ owner_user_id: currentUser.id, latest_note: "Claimed from the Graphics workspace." })}
          onStartProduction={() => applyProjectPatch({ status: "active", stage: "in_production", latest_note: detailDraft.note || "Graphics work started." })}
          onSendToPeerReview={() => applyProjectPatch({ status: "waiting", stage: "ready_for_qa", latest_note: detailDraft.note || "Moved to the QA handoff stage." })}
          onRequestChanges={() =>
            applyProjectPatch({
              status: "blocked",
              stage: "correction_needed",
              correction_reason: detailDraft.note || "Correction requested from QA review.",
              latest_note: detailDraft.note || "Correction requested from QA review."
            })
          }
          onMarkQaApproved={() =>
            applyProjectPatch({
              status: "waiting",
              stage: "in_qa_review",
              latest_note: detailDraft.note || "QA review started."
            })
          }
            onMarkReadyForRelease={() =>
              applyProjectPatch({
                status: "waiting",
                stage: "ready_to_release",
                latest_note: detailDraft.note || "Ready to release."
              })
            }
            onSubmitQaReview={handleQaReviewSubmission}
            onMarkComplete={() =>
              applyProjectPatch({
                status: "completed",
                stage: "released_complete",
                latest_note: detailDraft.note || "Released and completed from the Graphics workspace."
            })
          }
          onSnooze={() => applyProjectPatch({ snoozed_until: addDays(filters.anchorDate, 2), latest_note: detailDraft.note || "Snoozed for short graphics follow-up." })}
          onFollowUpToday={() => applyProjectPatch({ follow_up_date: filters.anchorDate, latest_note: detailDraft.note || "Follow-up reset for today." })}
          onSave={() =>
            applyProjectPatch({
              status: detailDraft.status,
              job_type: detailDraft.jobType,
              stage: detailDraft.stage,
              owner_user_id: detailDraft.ownerUserId || null,
              peer_reviewer_user_id: detailDraft.peerReviewerUserId || null,
              final_qc_reviewer_user_id: detailDraft.finalQcReviewerUserId || null,
              due_date: detailDraft.dueDate || null,
              follow_up_date: detailDraft.followUpDate || null,
              latest_note: detailDraft.note || null
            })
          }
          onOpenLinkedOrganization={(organizationId) => {
            window.location.hash = `#directory/accounts?view=organizations&organization=${organizationId}&tab=operations`;
          }}
          onOpenLinkedShoot={(shootId) => {
            window.location.hash = `#operations/shoots?shoot=${shootId}`;
          }}
          onTaskUpdate={handleTaskUpdate}
          onBuddyWorkflowUpdate={handleBuddyWorkflowUpdate}
          onVirtualTeamWorkflowUpdate={handleVirtualTeamWorkflowUpdate}
          onExceptionCreate={handleExceptionCreate}
          onExceptionUpdate={handleExceptionUpdate}
        />
      </div>

      <ProductionProjectDrawer
        open={createOpen}
        title="Create Manual Graphics Item"
        subtitle="Automatic intake from upstream workflow should be the normal path. Only add a manual item when the work is real and the funnel did not already create it."
        onClose={() => {
          setCreateOpen(false);
          setCreateError("");
        }}
      >
        <div className="form-grid">
          <label className="filter-field">
            <span>Template</span>
            <select
              value={createDraft.templateId}
              onChange={(event) => {
                const templateId = event.target.value;
                const selectedTemplate = templates.find((template) => template.id === templateId) ?? null;
                setCreateDraft((current) => ({
                  ...current,
                  templateId,
                  jobType: selectedTemplate?.job_type ?? current.jobType,
                  category: selectedTemplate?.category ?? current.category
                }));
              }}
            >
              <option value="">No template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field filter-field--wide">
            <span>Graphics Title</span>
            <input value={createDraft.title} onChange={(event) => setCreateDraft((current) => ({ ...current, title: event.target.value }))} />
          </label>
          <label className="filter-field filter-field--wide">
            <span>Summary</span>
            <textarea rows={3} value={createDraft.summary} onChange={(event) => setCreateDraft((current) => ({ ...current, summary: event.target.value }))} />
          </label>
          <label className="filter-field">
            <span>Job Type</span>
            <select value={createDraft.jobType} onChange={(event) => setCreateDraft((current) => ({ ...current, jobType: event.target.value as ProductionProjectJobType }))}>
              {PROJECT_JOB_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Category</span>
            <select value={createDraft.category} onChange={(event) => setCreateDraft((current) => ({ ...current, category: event.target.value as ProductionProjectCategory }))}>
              {PROJECT_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Priority</span>
            <select value={createDraft.priority} onChange={(event) => setCreateDraft((current) => ({ ...current, priority: event.target.value as CreateDraft["priority"] }))}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label className="filter-field">
            <span>Owner</span>
            <select value={createDraft.ownerUserId} onChange={(event) => setCreateDraft((current) => ({ ...current, ownerUserId: event.target.value }))}>
              <option value="">Unassigned</option>
              {referenceOwners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Due Date</span>
            <input type="date" value={createDraft.dueDate} onChange={(event) => setCreateDraft((current) => ({ ...current, dueDate: event.target.value }))} />
          </label>
          <label className="filter-field">
            <span>Follow-Up Date</span>
            <input type="date" value={createDraft.followUpDate} onChange={(event) => setCreateDraft((current) => ({ ...current, followUpDate: event.target.value }))} />
          </label>
          <label className="filter-field">
            <span>Organization</span>
            <select value={createDraft.linkedOrganizationId} onChange={(event) => setCreateOrganization(event.target.value)} disabled={referenceLoading}>
              <option value="">No linked organization</option>
              {referenceOrganizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Location</span>
            <select value={createDraft.linkedLocationId} onChange={(event) => setCreateLocation(event.target.value)} disabled={referenceLoading}>
              <option value="">No linked location</option>
              {createLocationOptions.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field filter-field--wide">
            <span>Shoot</span>
            <select value={createDraft.linkedShootId} onChange={(event) => setCreateShoot(event.target.value)} disabled={referenceLoading}>
              <option value="">No linked shoot</option>
              {createShootOptions.map((shoot) => (
                <option key={shoot.id} value={shoot.id}>
                  {shoot.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field filter-field--wide">
            <span>Kickoff Note</span>
            <textarea rows={3} value={createDraft.note} onChange={(event) => setCreateDraft((current) => ({ ...current, note: event.target.value }))} />
          </label>
        </div>
        {createError ? <div className="error-banner">{createError}</div> : null}
        <WorkspaceActionBar compact>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setCreateOpen(false);
              setCreateError("");
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submitCreate()}
            disabled={createBusy || referenceLoading || !createDraft.title.trim()}
          >
            {createBusy ? "Creating..." : referenceLoading ? "Loading linked context..." : "Create Manual Item"}
          </button>
        </WorkspaceActionBar>
      </ProductionProjectDrawer>
    </div>
  );
}

function parseProjectsHash(): {
  projectId: string | null;
  workspaceView: ProductionProjectWorkspaceView | null;
  filters: Partial<BoardFiltersState>;
} {
  const [, query = ""] = window.location.hash.split("?");
  const params = new URLSearchParams(query);
  return {
    projectId: params.get("project"),
    workspaceView: parseWorkspaceView(params.get("view")),
    filters: {
      workspace_view: parseWorkspaceView(params.get("view")),
      status: parseStatusFilter(params.get("status")),
      queue: parseQueueFilter(params.get("queue")),
      search: params.get("search") ?? "",
      owner_user_id: params.get("owner_user_id"),
      priority: parsePriorityFilter(params.get("priority")),
      template_id: params.get("template_id"),
      source_type: parseSourceTypeFilter(params.get("source_type")),
      source_trigger_key: params.get("source_trigger_key"),
      category: parseCategoryFilter(params.get("category")),
      job_type: parseJobTypeFilter(params.get("job_type")),
      stage: parseStageFilter(params.get("stage")),
      team_owner: parseTeamOwnerFilter(params.get("team_owner")),
      linked_organization_id: params.get("linked_organization_id"),
      linked_location_id: params.get("linked_location_id"),
      linked_shoot_id: params.get("linked_shoot_id"),
      due_state: parseDueStateFilter(params.get("due_state")),
      big_critical_only: params.get("big_critical_only") === "true",
      lead_board_sort: parseLeadBoardSort(params.get("lead_board_sort")),
      lead_board_focus: parseLeadBoardFocus(params.get("lead_board_focus"))
    }
  };
}

function buildBoardFilters(anchorDate: string, next: Partial<BoardFiltersState>): BoardFiltersState {
  return {
    anchorDate,
    workspace_view: next.workspace_view ?? null,
    status: next.status ?? "open",
    queue: next.queue ?? "all",
    search: next.search ?? "",
    owner_user_id: next.owner_user_id ?? null,
    priority: next.priority ?? DEFAULT_PRIORITY,
    template_id: next.template_id ?? null,
    source_type: next.source_type ?? DEFAULT_SOURCE_TYPE,
    source_trigger_key: next.source_trigger_key ?? null,
    category: next.category ?? DEFAULT_CATEGORY,
    job_type: next.job_type ?? DEFAULT_JOB_TYPE,
    stage: next.stage ?? DEFAULT_STAGE,
    team_owner: next.team_owner ?? DEFAULT_TEAM_OWNER,
    linked_organization_id: next.linked_organization_id ?? null,
    linked_location_id: next.linked_location_id ?? null,
    linked_shoot_id: next.linked_shoot_id ?? null,
    due_state: next.due_state ?? DEFAULT_DUE_STATE,
    big_critical_only: next.big_critical_only ?? false,
    lead_board_sort: next.lead_board_sort ?? DEFAULT_LEAD_BOARD_SORT,
    lead_board_focus: next.lead_board_focus ?? DEFAULT_LEAD_BOARD_FOCUS
  };
}

function toHashState(
  projectId: string | null,
  filters: BoardFiltersState,
  workspaceView: ProductionProjectWorkspaceView | null
) {
  return {
    projectId,
    view: workspaceView,
    status: filters.status,
    queue: filters.queue,
    search: filters.search,
    owner_user_id: filters.owner_user_id,
    priority: filters.priority,
    template_id: filters.template_id,
    source_type: filters.source_type,
    source_trigger_key: filters.source_trigger_key,
    category: filters.category,
    job_type: filters.job_type,
    stage: filters.stage,
    team_owner: filters.team_owner,
    linked_organization_id: filters.linked_organization_id,
    linked_location_id: filters.linked_location_id,
    linked_shoot_id: filters.linked_shoot_id,
    due_state: filters.due_state,
    big_critical_only: filters.big_critical_only,
    lead_board_sort: filters.lead_board_sort,
    lead_board_focus: filters.lead_board_focus
  };
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number) {
  const next = new Date(`${value}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function humanizeValue(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function matchesLocationContext(locationOrganizationId: string | null, organizationId: string) {
  return !organizationId || locationOrganizationId === organizationId;
}

function matchesShootContext(
  shoot: { organization_id: string | null; location_id: string | null },
  organizationId: string,
  locationId: string
) {
  if (organizationId && shoot.organization_id !== organizationId) {
    return false;
  }
  if (locationId && shoot.location_id !== locationId) {
    return false;
  }
  return true;
}

function countAdvancedFilters(filters: BoardFiltersState) {
  let count = 0;
  if (filters.owner_user_id) {
    count += 1;
  }
  if (filters.priority && filters.priority !== DEFAULT_PRIORITY) {
    count += 1;
  }
  if (filters.template_id) {
    count += 1;
  }
  if (filters.source_type && filters.source_type !== DEFAULT_SOURCE_TYPE) {
    count += 1;
  }
  if (filters.source_trigger_key) {
    count += 1;
  }
  if (filters.category && filters.category !== DEFAULT_CATEGORY) {
    count += 1;
  }
  if (filters.job_type && filters.job_type !== DEFAULT_JOB_TYPE) {
    count += 1;
  }
  if (filters.stage && filters.stage !== DEFAULT_STAGE) {
    count += 1;
  }
  if (filters.team_owner && filters.team_owner !== DEFAULT_TEAM_OWNER) {
    count += 1;
  }
  if (filters.linked_organization_id) {
    count += 1;
  }
  if (filters.linked_location_id) {
    count += 1;
  }
  if (filters.linked_shoot_id) {
    count += 1;
  }
  if (filters.due_state && filters.due_state !== DEFAULT_DUE_STATE) {
    count += 1;
  }
  if (filters.big_critical_only) {
    count += 1;
  }
  return count;
}

function parseStatusFilter(value: string | null): BoardFiltersState["status"] {
  return value === "completed" || value === "all" ? value : "open";
}

function parseQueueFilter(value: string | null): ProductionProjectQueueId | "all" {
  if (value === "needs_setup") {
    return "team_queue";
  }
  if (value === "needs_follow_up" || value === "overdue_tasks") {
    return "at_risk_queue";
  }
  if (value === "active") {
    return "team_queue";
  }
  if (value === "completed_recently") {
    return "all";
  }
  return value === "my_queue" ||
    value === "team_queue" ||
    value === "blocked_queue" ||
    value === "qa_queue" ||
    value === "ready_to_release_queue" ||
    value === "at_risk_queue"
    ? value
    : "all";
}

function parsePriorityFilter(value: string | null): BoardFiltersState["priority"] {
  return value === "low" || value === "normal" || value === "high" || value === "critical" ? value : DEFAULT_PRIORITY;
}

function parseSourceTypeFilter(value: string | null): BoardFiltersState["source_type"] {
  return value === "manual" || value === "trigger" ? value : DEFAULT_SOURCE_TYPE;
}

function parseCategoryFilter(value: string | null): BoardFiltersState["category"] {
  return PROJECT_CATEGORY_OPTIONS.some((option) => option.value === value)
    ? (value as ProductionProjectCategory)
    : DEFAULT_CATEGORY;
}

function parseJobTypeFilter(value: string | null): BoardFiltersState["job_type"] {
  return PROJECT_JOB_TYPE_OPTIONS.some((option) => option.value === value)
    ? (value as ProductionProjectJobType)
    : DEFAULT_JOB_TYPE;
}

function parseStageFilter(value: string | null): BoardFiltersState["stage"] {
  if (value === "needs_peer_review") {
    return "ready_for_qa";
  }
  if (value === "changes_requested") {
    return "correction_needed";
  }
  if (value === "qa_approved" || value === "ready_for_release") {
    return "ready_to_release";
  }
  if (value === "released") {
    return "released_complete";
  }
  return PROJECT_STAGE_OPTIONS.some((option) => option.value === value)
    ? (value as ProductionProjectStage)
    : DEFAULT_STAGE;
}

function parseTeamOwnerFilter(value: string | null): BoardFiltersState["team_owner"] {
  return PROJECT_TEAM_OWNER_OPTIONS.some((option) => option.value === value)
    ? (value as ProductionProjectTeamOwner)
    : DEFAULT_TEAM_OWNER;
}

function parseDueStateFilter(value: string | null): BoardFiltersState["due_state"] {
  return value === "overdue" || value === "due_today" || value === "upcoming" || value === "unscheduled"
    ? (value as ProductionProjectDueState)
    : DEFAULT_DUE_STATE;
}

function parseWorkspaceView(value: string | null): ProductionProjectWorkspaceView | null {
  return value === "lead_board" || value === "staff_workspace" ? value : null;
}

function parseLeadBoardSort(value: string | null): ProductionLeadBoardSort {
  return value === "due_date" ||
    value === "priority" ||
    value === "last_touched" ||
    value === "owner" ||
    value === "current_step"
    ? value
    : DEFAULT_LEAD_BOARD_SORT;
}

function parseLeadBoardFocus(value: string | null): ProductionLeadBoardFocus {
  return value === "blocked" || value === "overdue" || value === "waiting" ? value : DEFAULT_LEAD_BOARD_FOCUS;
}

function describeProductionWorkspace(hash: string, workspaceView: ProductionProjectWorkspaceView) {
  if (workspaceView === "lead_board") {
    return {
      title: "Graphics Lead Board",
      summary:
        "See every unfinished graphics workflow item at once, watch the current step and blocker state, and catch stale work before it disappears between feeds."
    };
  }
  const [baseHash] = hash.split("?");
  if (baseHash === "#graphics/qa") {
    return {
      title: "Graphics QA And Corrections",
      summary: "Work that is in peer review, QA, or correction. Use this lane to clear review gates, send rework back cleanly, and keep quality decisions traceable."
    };
  }
  if (baseHash === "#graphics/analytics") {
    return {
      title: "Graphics Analytics",
      summary: "Pattern-level QA issues, workload hotspots, and release delays to guide training and follow-up."
    };
  }
  if (baseHash === "#graphics/release") {
    return {
      title: "Graphics QC And Release",
      summary: "Final QC and release gating for graphics jobs that are close to delivery. This is the controlled release surface, not the place to rework core workflow steps."
    };
  }
  if (baseHash === "#graphics/workload") {
    return {
      title: "Graphics Workload",
      summary: "Owner-focused graphics planning across active jobs, task deadlines, blockers, review handoffs, and release pressure."
    };
  }
  return {
    title: "My Graphics Workflow",
    summary:
      "Move post-shoot work safely through graphics, QA, corrections, and release with the canonical task ladder, handoffs, and gate history."
  };
}

function AnalyticsTable({
  title,
  rows,
  emptyLabel = "No data yet."
}: {
  title: string;
  rows: Array<{ key: string; label: string; count: number }>;
  emptyLabel?: string;
}) {
  return (
    <div className="analytics-table">
      <div className="section-title">{title}</div>
      {rows.length ? (
        <div className="report-table-shell">
          <table className="shoots-table report-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td>
                    <strong>{row.count}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state empty-state--panel">{emptyLabel}</div>
      )}
    </div>
  );
}
