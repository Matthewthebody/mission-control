import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRouteId } from "../navigation";
import { canAccessRoute } from "../permissions";
import KnowledgeSources from "../pages/KnowledgeSources";
import KnowledgeSourceDetail from "../pages/KnowledgeSourceDetail";
import type { SessionUser } from "../types";
import type {
  KnowledgeHealth,
  ReviewerSourceDetail,
  EmployeeSourceDetail,
  SourceListResult
} from "../services/knowledgeAuthoringApi";

// H5 — knowledge operations pages: the reviewer workspace, the dual-mode
// source-detail page behind Ask Bailey source cards, and the route wiring.

const listSourcesMock = vi.fn();
const getSourceDetailMock = vi.fn();
const createSourceMock = vi.fn();
const createRevisionMock = vi.fn();
const getKnowledgeHealthApiMock = vi.fn();
const listSynonymsApiMock = vi.fn();
const upsertSynonymApiMock = vi.fn();
const previewSynonymsMock = vi.fn();

vi.mock("../services/knowledgeAuthoringApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/knowledgeAuthoringApi")>();
  return {
    ...actual,
    listSources: (...args: unknown[]) => listSourcesMock(...args),
    getSourceDetail: (...args: unknown[]) => getSourceDetailMock(...args),
    createSource: (...args: unknown[]) => createSourceMock(...args),
    createRevision: (...args: unknown[]) => createRevisionMock(...args),
    getKnowledgeHealthApi: (...args: unknown[]) => getKnowledgeHealthApiMock(...args),
    listSynonymsApi: (...args: unknown[]) => listSynonymsApiMock(...args),
    upsertSynonymApi: (...args: unknown[]) => upsertSynonymApiMock(...args),
    previewSynonyms: (...args: unknown[]) => previewSynonymsMock(...args)
  };
});

const getVersionTranscriptMock = vi.fn();
vi.mock("../services/knowledgeReviewApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/knowledgeReviewApi")>();
  return {
    ...actual,
    getVersionTranscript: (...args: unknown[]) => getVersionTranscriptMock(...args)
  };
});

const HEALTH: KnowledgeHealth = {
  counts: {
    active_approved: 4,
    pending_review: 1,
    overdue_review: 0,
    expiring_soon: 0,
    open_conflicts: 1,
    failed_ingestion: 0,
    failed_embeddings: 0,
    open_questions: 2,
    open_reports: 0
  },
  top_unanswered: [{ example_question: "How do I request parental leave?", occurrence_count: 3, last_asked_at: "2026-07-13T10:00:00Z" }],
  most_cited: [{ id: "src-1", title: "Tether SOP", citations: 9 }],
  most_reported: []
};

const LIST: SourceListResult = {
  total: 2,
  limit: 25,
  offset: 0,
  sources: [
    {
      id: "src-1",
      title: "Tether SOP",
      department_owner: "photography",
      owner_name: "Demo Leadership",
      version_id: "ver-1",
      version_number: 2,
      source_type: "written_sop",
      authority_class: "approved_sop",
      publication_status: "approved",
      knowledge_mode: "operational",
      confidential: false,
      extraction_status: "completed",
      effective_until: null,
      review_due_at: null,
      updated_at: "2026-07-13T10:00:00Z"
    },
    {
      id: "src-2",
      title: "Payroll Confidential Memo",
      department_owner: null,
      owner_name: null,
      version_id: "ver-2",
      version_number: 1,
      source_type: "policy_document",
      authority_class: "official_company_policy",
      publication_status: "draft",
      knowledge_mode: "operational",
      confidential: true,
      extraction_status: "completed",
      effective_until: null,
      review_due_at: null,
      updated_at: "2026-07-13T10:00:00Z"
    }
  ]
};

function versionRow(overrides: Record<string, unknown>) {
  return {
    id: "ver-approved",
    version_number: 1,
    source_type: "written_sop",
    authority_class: "approved_sop",
    publication_status: "approved",
    knowledge_mode: "operational",
    confidential: false,
    department_scope: [],
    role_scope: [],
    effective_from: null,
    effective_until: null,
    review_due_at: null,
    supersedes_version_id: null,
    superseded_by_version_id: null,
    extraction_status: "completed",
    media_duration_seconds: null,
    inline_body: "Always tether on set.",
    approved_at: "2026-07-13T10:00:00Z",
    approved_by_name: "Demo Leadership",
    review_notes: null,
    created_at: "2026-07-13T09:00:00Z",
    ...overrides
  };
}

const REVIEWER_DETAIL: ReviewerSourceDetail = {
  mode: "reviewer",
  source: {
    id: "src-1",
    title: "Tether SOP",
    description: "How we tether.",
    department_owner: "photography",
    resource_library_item_id: null,
    current_version_id: "ver-approved",
    owner_name: "Demo Leadership",
    created_by_name: "Demo Leadership",
    created_at: "2026-07-13T09:00:00Z",
    updated_at: "2026-07-13T10:00:00Z",
    asset_file_name: null,
    asset_content_type: null
  },
  versions: [
    versionRow({ id: "ver-draft", version_number: 2, publication_status: "draft", approved_at: null, approved_by_name: null, supersedes_version_id: "ver-approved" }),
    versionRow({})
  ] as ReviewerSourceDetail["versions"],
  embedding_health: [{ status: "ready", n: 3 }],
  jobs: [],
  conflicts: [],
  usage: { citations: 9 },
  reports: [],
  audit: [
    { action: "knowledge.revision_created", created_at: "2026-07-13T10:00:00Z", actor_name: "Demo Leadership", metadata: {} }
  ]
};

const EMPLOYEE_DETAIL: EmployeeSourceDetail = {
  mode: "employee",
  source: {
    id: "src-1",
    title: "Tether SOP",
    description: "How we tether.",
    resource_library_item_id: null,
    source_type: "written_sop",
    authority_class: "approved_sop",
    knowledge_mode: "operational",
    approved_at: "2026-07-13T10:00:00Z",
    media_duration_seconds: null,
    version_id: "ver-approved",
  },
  segments: [
    { id: "seg-1", ordinal: 0, segment_kind: "procedure", heading: "Setup", locator_label: "Section: Setup", start_seconds: null, end_seconds: null }
  ]
};

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "";
  listSourcesMock.mockResolvedValue(LIST);
  getKnowledgeHealthApiMock.mockResolvedValue(HEALTH);
  listSynonymsApiMock.mockResolvedValue({ synonyms: [] });
  getSourceDetailMock.mockResolvedValue(REVIEWER_DETAIL);
  getVersionTranscriptMock.mockResolvedValue({ version: {}, segments: [], jobs: [] });
});

describe("knowledge route resolution", () => {
  const ALL_TABS = ["dashboard"] as any;
  it("resolves the workspace list and the id-bearing detail hash to distinct routes", () => {
    expect(resolveRouteId("#knowledge/sources", ALL_TABS, false)).toBe("knowledge-sources");
    expect(resolveRouteId("#knowledge/sources/src-123", ALL_TABS, false)).toBe("knowledge-source-detail");
    expect(resolveRouteId("#knowledge/review", ALL_TABS, false)).toBe("knowledge-review");
  });
});

describe("knowledge route access", () => {
  const baseUser = {
    roles: [],
    permissions: [],
    permissionGrants: [],
    effectiveScopes: [],
    jobFunctionProfiles: []
  } as unknown as SessionUser;

  it("gates the workspace to reviewers but lets any employee open the dual-mode detail page", () => {
    const associate = { ...baseUser, authorityTier: "associate" } as SessionUser;
    const leadership = { ...baseUser, authorityTier: "leadership" } as SessionUser;
    expect(canAccessRoute(associate, "knowledge-sources")).toBe(false);
    expect(canAccessRoute(leadership, "knowledge-sources")).toBe(true);
    // The detail page relies on the server's eligibility gate (opaque 404),
    // so the client route is open to every authenticated employee.
    expect(canAccessRoute(associate, "knowledge-source-detail")).toBe(true);
  });
});

describe("Knowledge Sources workspace", () => {
  it("renders health, the source list with detail links, and honest totals", async () => {
    render(<KnowledgeSources token="token" />);
    // "Tether SOP" appears in the list row AND the most-cited health panel.
    const matches = await screen.findAllByText("Tether SOP");
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.getByText("Payroll Confidential Memo")).toBeInTheDocument();
    expect(screen.getByText("2 sources · showing 2")).toBeInTheDocument();
    expect(screen.getByText("Active approved: 4")).toBeInTheDocument();
    for (const match of matches) {
      expect(match.closest("a")).toHaveAttribute("href", "#knowledge/sources/src-1");
    }
  });

  it("creates a new draft source and navigates to its detail page", async () => {
    createSourceMock.mockResolvedValue({ source_id: "src-new", version_id: "ver-new" });
    render(<KnowledgeSources token="token" />);
    await screen.findAllByText("Tether SOP");
    fireEvent.click(screen.getByText("New source"));
    fireEvent.change(screen.getByLabelText("New source title"), { target: { value: "Card Formatting SOP" } });
    fireEvent.change(screen.getByLabelText("New source body"), { target: { value: "# Cards\n\nFormat like this." } });
    fireEvent.click(screen.getByText("Create draft source"));
    await waitFor(() => expect(createSourceMock).toHaveBeenCalled());
    expect(createSourceMock.mock.calls[0][1]).toMatchObject({ title: "Card Formatting SOP", source_type: "written_sop" });
    await waitFor(() => expect(window.location.hash).toBe("#knowledge/sources/src-new"));
  });

  it("previews question normalization through the synonym manager", async () => {
    previewSynonymsMock.mockResolvedValue({
      terms: ["ss"],
      concepts: [{ term: "ss", variants: ["smart shooter"], from_synonym: true }]
    });
    render(<KnowledgeSources token="token" />);
    await screen.findAllByText("Tether SOP");
    fireEvent.change(screen.getByLabelText("Normalization preview"), { target: { value: "how do I use ss" } });
    fireEvent.click(screen.getByText("Preview normalization"));
    expect(await screen.findByText("ss → [smart shooter]")).toBeInTheDocument();
  });
});

describe("Knowledge source detail page", () => {
  it("reviewer mode: approved versions have no in-place edit — only drafts are editable (the version rule)", async () => {
    window.location.hash = "#knowledge/sources/src-1";
    render(<KnowledgeSourceDetail token="token" />);
    expect(await screen.findByText("Tether SOP")).toBeInTheDocument();
    expect(screen.getByText("Versions (2)")).toBeInTheDocument();
    // Exactly one editable version: the draft. The approved version offers
    // Retire (governed) but never an editor.
    expect(screen.getAllByText("Edit draft")).toHaveLength(1);
    expect(screen.getByText("Retire")).toBeInTheDocument();
    expect(screen.getByText("Submit for review")).toBeInTheDocument();
    expect(screen.getByText("New revision")).toBeInTheDocument();
  });

  it("reviewer mode: blocks a second concurrent revision while one is in flight", async () => {
    window.location.hash = "#knowledge/sources/src-1";
    render(<KnowledgeSourceDetail token="token" />);
    const button = (await screen.findByText("New revision")) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("employee mode: read-only view with no governance controls", async () => {
    getSourceDetailMock.mockResolvedValue(EMPLOYEE_DETAIL);
    window.location.hash = "#knowledge/sources/src-1";
    render(<KnowledgeSourceDetail token="token" />);
    expect(await screen.findByText("Tether SOP")).toBeInTheDocument();
    expect(screen.getByText("Section: Setup")).toBeInTheDocument();
    expect(screen.queryByText("New revision")).not.toBeInTheDocument();
    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
    expect(screen.queryByText("Retire")).not.toBeInTheDocument();
    expect(screen.queryByText("Versions (2)")).not.toBeInTheDocument();
  });

  it("shows an opaque not-available state when the server answers 404", async () => {
    getSourceDetailMock.mockRejectedValue(new Error("Not found"));
    window.location.hash = "#knowledge/sources/src-hidden";
    render(<KnowledgeSourceDetail token="token" />);
    expect(await screen.findByText("Source not available")).toBeInTheDocument();
    expect(screen.queryByText("Versions", { exact: false })).not.toBeInTheDocument();
  });
});
