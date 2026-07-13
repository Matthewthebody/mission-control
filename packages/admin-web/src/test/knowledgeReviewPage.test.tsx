import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import KnowledgeReview from "../pages/KnowledgeReview";
import type { ReviewQueue } from "../services/knowledgeReviewApi";

// Knowledge Review page — the knowledge-owner queues behind Ask Bailey.

const getReviewQueueMock = vi.fn();
const approveVersionMock = vi.fn();
const rejectVersionMock = vi.fn();
const resolveConflictMock = vi.fn();
const reviewReportMock = vi.fn();
const resolveQuestionMock = vi.fn();
const retryIngestionMock = vi.fn();

vi.mock("../services/knowledgeReviewApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/knowledgeReviewApi")>();
  return {
    ...actual,
    getReviewQueue: (...args: unknown[]) => getReviewQueueMock(...args),
    approveVersion: (...args: unknown[]) => approveVersionMock(...args),
    rejectVersion: (...args: unknown[]) => rejectVersionMock(...args),
    resolveConflict: (...args: unknown[]) => resolveConflictMock(...args),
    reviewReport: (...args: unknown[]) => reviewReportMock(...args),
    resolveQuestion: (...args: unknown[]) => resolveQuestionMock(...args),
    retryIngestion: (...args: unknown[]) => retryIngestionMock(...args)
  };
});

function queueFixture(overrides: Partial<ReviewQueue> = {}): ReviewQueue {
  return {
    pending_versions: [
      {
        id: "ver-1",
        source_id: "src-1",
        title: "Tether SOP v2",
        version_number: 2,
        source_type: "written_sop",
        authority_class: "approved_sop",
        publication_status: "pending_review",
        knowledge_mode: "operational",
        extraction_status: "completed",
        created_at: "2026-07-13T10:00:00Z",
        submitted_by_name: "Demo Leadership"
      }
    ],
    open_conflicts: [
      {
        id: "conflict-1",
        status: "open",
        note: "Formatting guidance disagrees.",
        created_at: "2026-07-13T10:00:00Z",
        source_a_title: "SD SOP (Studio)",
        source_b_title: "SD Memo (Field)",
        version_a_id: "ver-a",
        version_b_id: "ver-b"
      }
    ],
    unresolved_questions: [
      {
        id: "question-1",
        normalized_question: "how do i request parental leave",
        example_question: "How do I request parental leave?",
        occurrence_count: 3,
        departments_asking: ["photography"],
        roles_asking: ["photographer"],
        status: "open",
        last_asked_at: "2026-07-13T10:00:00Z"
      }
    ],
    open_reports: [
      {
        id: "report-1",
        feedback_kind: "report_incorrect",
        note: "This changed last month.",
        created_at: "2026-07-13T10:00:00Z",
        question: "Where do cards get formatted?",
        reporter_name: "Demo Photographer"
      }
    ],
    ingestion_attention: [
      {
        id: "job-1",
        job_kind: "media_transcribe",
        status: "failed",
        attempts: 1,
        error_message: "cannot transcribe: no media",
        created_at: "2026-07-13T10:00:00Z",
        source_title: "Broken Video",
        source_version_id: "ver-9"
      }
    ],
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getReviewQueueMock.mockResolvedValue(queueFixture());
  approveVersionMock.mockResolvedValue({ version: {} });
  reviewReportMock.mockResolvedValue({ report: {} });
  resolveQuestionMock.mockResolvedValue({ question: {} });
  retryIngestionMock.mockResolvedValue({ job: {} });
});

describe("Knowledge Review page", () => {
  it("renders all five queues with counts", async () => {
    render(<KnowledgeReview token="token" />);
    expect(await screen.findByText("Pending source versions (1)")).toBeInTheDocument();
    expect(screen.getByText("Source conflicts (1)")).toBeInTheDocument();
    expect(screen.getByText("Unresolved questions (1)")).toBeInTheDocument();
    expect(screen.getByText("Reported answers (1)")).toBeInTheDocument();
    expect(screen.getByText("Ingestion needing attention (1)")).toBeInTheDocument();
    expect(screen.getByText("Tether SOP v2")).toBeInTheDocument();
    expect(screen.getByText("How do I request parental leave?")).toBeInTheDocument();
  });

  it("approves a pending version and refreshes the queue", async () => {
    render(<KnowledgeReview token="token" />);
    const approve = await screen.findByRole("button", { name: "Approve" });
    fireEvent.click(approve);
    await waitFor(() => expect(approveVersionMock).toHaveBeenCalledWith("token", "ver-1"));
    expect(getReviewQueueMock).toHaveBeenCalledTimes(2);
  });

  it("marks an answer report reviewed", async () => {
    render(<KnowledgeReview token="token" />);
    const reviewed = await screen.findByRole("button", { name: "Mark reviewed" });
    fireEvent.click(reviewed);
    await waitFor(() => expect(reviewReportMock).toHaveBeenCalledWith("token", "report-1", "reviewed"));
  });

  it("dismisses an unresolved question", async () => {
    render(<KnowledgeReview token="token" />);
    const dismissButtons = await screen.findAllByRole("button", { name: "Dismiss" });
    // Order on the page: conflicts, then unresolved questions, then reports.
    fireEvent.click(dismissButtons[1]);
    await waitFor(() => expect(resolveQuestionMock).toHaveBeenCalledWith("token", "question-1", "dismissed"));
  });

  it("retries a failed ingestion job", async () => {
    render(<KnowledgeReview token="token" />);
    const retry = await screen.findByRole("button", { name: "Retry ingestion" });
    fireEvent.click(retry);
    await waitFor(() => expect(retryIngestionMock).toHaveBeenCalledWith("token", "job-1"));
  });

  it("shows honest empty states", async () => {
    getReviewQueueMock.mockResolvedValue(
      queueFixture({
        pending_versions: [],
        open_conflicts: [],
        unresolved_questions: [],
        open_reports: [],
        ingestion_attention: []
      })
    );
    render(<KnowledgeReview token="token" />);
    expect(await screen.findByText("Nothing waiting for review.")).toBeInTheDocument();
    expect(screen.getByText("No open conflicts. Bailey answers without disagreement warnings.")).toBeInTheDocument();
    expect(screen.getByText("No open reports.")).toBeInTheDocument();
  });

  it("surfaces action failures without hiding them", async () => {
    approveVersionMock.mockRejectedValue(new Error("approval failed"));
    render(<KnowledgeReview token="token" />);
    const approve = await screen.findByRole("button", { name: "Approve" });
    fireEvent.click(approve);
    expect(await screen.findByRole("alert")).toHaveTextContent("approval failed");
  });
});
