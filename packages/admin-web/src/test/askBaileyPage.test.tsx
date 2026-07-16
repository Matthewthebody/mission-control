import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AskBailey from "../pages/AskBailey";
import type { AskBaileyAnswer } from "../services/askBaileyApi";

// Ask Bailey page — presentation of server-assembled answers. The page must
// render every honest state, never interpret answer text as HTML, and surface
// timestamps exactly as the server provided them.

const askBaileyMock = vi.fn();
const listConversationsMock = vi.fn();
const getConversationMock = vi.fn();
const submitFeedbackMock = vi.fn();

vi.mock("../services/askBaileyApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/askBaileyApi")>();
  return {
    ...actual,
    askBailey: (...args: unknown[]) => askBaileyMock(...args),
    listConversations: (...args: unknown[]) => listConversationsMock(...args),
    getConversation: (...args: unknown[]) => getConversationMock(...args),
    submitAskBaileyFeedback: (...args: unknown[]) => submitFeedbackMock(...args)
  };
});

function answerFixture(overrides: Partial<AskBaileyAnswer> = {}): AskBaileyAnswer {
  return {
    status: "supported",
    conversation_id: "conv-1",
    message_id: "msg-1",
    answer_markdown: "Here's what the approved SOP — Tether SOP (Section: Recovery) — says:\n\nReseat the cable.",
    answer_blocks: [],
    citations: [
      {
        segment_id: "seg-1",
        source_version_id: "ver-1",
        source_id: "src-1",
        title: "Tether SOP",
        source_type: "written_sop",
        authority_class: "approved_sop",
        locator_label: "Section: Recovery",
        start_seconds: null,
        end_seconds: null,
        resource_library_item_id: null,
        media_url: null
      }
    ],
    warnings: [],
    conflicts: [],
    context: null,
    evidence: { source_count: 1, highest_authority: "approved_sop", conflict_detected: false },
    ...overrides
  };
}

async function askQuestion(text = "What do I do if the tether feed drops?") {
  fireEvent.change(screen.getByLabelText("What are you working on?"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Ask Bailey" }));
  await waitFor(() => expect(askBaileyMock).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  listConversationsMock.mockResolvedValue({ conversations: [] });
  submitFeedbackMock.mockResolvedValue({ feedback_id: "fb-1" });
});

describe("Ask Bailey page", () => {
  it("renders the identity, welcome copy, and empty history state", async () => {
    render(<AskBailey token="token" />);
    expect(screen.getByText("Ask Bailey", { selector: ".section-title" })).toBeInTheDocument();
    expect(screen.getByText("Your guide to how we do things at Kemmetmueller Photography.")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Ask Bailey — temporary placeholder mark of a black lab silhouette")
    ).toBeInTheDocument();
    await waitFor(() => expect(listConversationsMock).toHaveBeenCalled());
    expect(screen.getByText("No conversations yet. Ask your first question above.")).toBeInTheDocument();
  });

  it("renders a supported answer with source cards", async () => {
    askBaileyMock.mockResolvedValue(answerFixture());
    render(<AskBailey token="token" />);
    await askQuestion();
    expect(await screen.findByText("Supported by approved sources")).toBeInTheDocument();
    expect(screen.getByText("Tether SOP")).toBeInTheDocument();
    expect(screen.getByText("Approved SOP")).toBeInTheDocument();
    expect(screen.getByText("Section: Recovery")).toBeInTheDocument();
    expect(screen.getByText(/Reseat the cable/)).toBeInTheDocument();
  });

  it("shows a video citation with the exact server timestamp", async () => {
    askBaileyMock.mockResolvedValue(
      answerFixture({
        citations: [
          {
            segment_id: "seg-2",
            source_version_id: "ver-2",
            source_id: "src-2",
            title: "Tether Recovery Training Video",
            source_type: "training_video",
            authority_class: "approved_training",
            locator_label: "06:42–07:31",
            start_seconds: 402,
            end_seconds: 451,
            resource_library_item_id: "item-1",
            media_url: "/demo-media/video.mp4#t=402"
          }
        ]
      })
    );
    render(<AskBailey token="token" />);
    await askQuestion("show me the nozzle check");
    const watchLink = await screen.findByRole("link", { name: "Watch from 06:42" });
    expect(watchLink).toHaveAttribute("href", "/demo-media/video.mp4#t=402");
  });

  it("renders the honest no-answer state without inventing sources", async () => {
    askBaileyMock.mockResolvedValue(
      answerFixture({
        status: "no_approved_answer",
        answer_markdown:
          "I couldn't find an approved answer for that yet. I logged the question so the right owner can review it. I'm not going to make up a procedure.",
        citations: [],
        evidence: { source_count: 0, highest_authority: null, conflict_detected: false }
      })
    );
    render(<AskBailey token="token" />);
    await askQuestion("something nobody documented");
    expect(await screen.findByText("No approved answer yet")).toBeInTheDocument();
    expect(screen.getByText(/not going to make up a procedure/)).toBeInTheDocument();
    expect(screen.queryByText("Sources")).not.toBeInTheDocument();
  });

  it("renders the conflict state with both sources and owners", async () => {
    askBaileyMock.mockResolvedValue(
      answerFixture({
        status: "source_conflict",
        answer_markdown:
          "I found approved sources that do not agree. I'm not going to choose one silently. Here are the sources and the people responsible for resolving the conflict.",
        conflicts: [
          {
            conflict_id: "conflict-1",
            source_a_title: "SD Card SOP (Studio)",
            source_b_title: "SD Card Memo (Field)",
            owner_a_name: "Jess Leader",
            owner_b_name: "Sam Owner",
            note: "Formatting guidance disagrees."
          }
        ],
        evidence: { source_count: 2, highest_authority: "approved_sop", conflict_detected: true }
      })
    );
    render(<AskBailey token="token" />);
    await askQuestion("when do we format cards?");
    expect(await screen.findByText("Sources disagree")).toBeInTheDocument();
    expect(screen.getByText("SD Card SOP (Studio)")).toBeInTheDocument();
    expect(screen.getByText("SD Card Memo (Field)")).toBeInTheDocument();
    expect(screen.getByText(/Jess Leader/)).toBeInTheDocument();
    expect(screen.getByText(/Sam Owner/)).toBeInTheDocument();
  });

  it("renders the provider-unavailable state honestly", async () => {
    askBaileyMock.mockResolvedValue(
      answerFixture({
        status: "provider_unavailable",
        answer_markdown: "Bailey's answer engine isn't available right now. The approved sources I found are listed below."
      })
    );
    render(<AskBailey token="token" />);
    await askQuestion();
    expect(await screen.findByText("Answer engine unavailable")).toBeInTheDocument();
    expect(screen.getByText(/isn't available right now/)).toBeInTheDocument();
  });

  it("submits feedback and marks the choice as sent", async () => {
    askBaileyMock.mockResolvedValue(answerFixture());
    render(<AskBailey token="token" />);
    await askQuestion();
    const helpful = await screen.findByRole("button", { name: "Helpful" });
    fireEvent.click(helpful);
    await waitFor(() => expect(submitFeedbackMock).toHaveBeenCalledWith("token", "msg-1", "helpful"));
    expect(await screen.findByRole("button", { name: "Helpful ✓" })).toBeDisabled();
  });

  it("never interprets answer text as HTML", async () => {
    askBaileyMock.mockResolvedValue(
      answerFixture({ answer_markdown: '<img src=x onerror="window.__pwned = true"> plain text' })
    );
    const { container } = render(<AskBailey token="token" />);
    await askQuestion("injection attempt");
    await screen.findByText(/plain text/);
    // The markup is rendered as literal text, not parsed into elements.
    expect(container.querySelector("img")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("shows safe progress states while asking and never streams prose", async () => {
    let resolveAnswer: (value: AskBaileyAnswer) => void = () => {};
    askBaileyMock.mockReturnValue(new Promise((resolve) => (resolveAnswer = resolve)));
    render(<AskBailey token="token" />);
    fireEvent.change(screen.getByLabelText("What are you working on?"), { target: { value: "pending question" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask Bailey" }));
    // The first safe progress state appears; no answer content exists yet.
    expect(await screen.findByRole("status")).toHaveTextContent("Bailey is checking the approved playbook…");
    expect(screen.queryByText("Bailey’s answer")).not.toBeInTheDocument();
    resolveAnswer(answerFixture());
    expect(await screen.findByText("Supported by approved sources")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("supports cancelling an in-flight ask", async () => {
    askBaileyMock.mockImplementation(
      (_token: unknown, _input: unknown, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })
    );
    render(<AskBailey token="token" />);
    fireEvent.change(screen.getByLabelText("What are you working on?"), { target: { value: "slow question" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask Bailey" }));
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    // Back to idle: no error panel, ask button ready again.
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask Bailey" })).toBeInTheDocument();
  });

  it("renders validated answer blocks with kind labels", async () => {
    askBaileyMock.mockResolvedValue(
      answerFixture({
        status: "partially_supported",
        answer_blocks: [
          { kind: "direct_answer", text: "Reseat the cable at the camera end first.", segment_ids: ["seg-1"] },
          { kind: "warning", text: "Do not restart the workstation without a trainer.", segment_ids: ["seg-1"] },
          { kind: "escalation", text: "Two failed recoveries means you call the shoot lead.", segment_ids: ["seg-1"] }
        ]
      })
    );
    render(<AskBailey token="token" />);
    await askQuestion("blocks question");
    expect(await screen.findByText("Partially supported")).toBeInTheDocument();
    expect(screen.getByText("Reseat the cable at the camera end first.")).toBeInTheDocument();
    expect(screen.getByText("Watch out")).toBeInTheDocument();
    expect(screen.getByText("Escalation")).toBeInTheDocument();
    expect(screen.getByText("Two failed recoveries means you call the shoot lead.")).toBeInTheDocument();
  });

  it("submits with the Enter key for keyboard users", async () => {
    askBaileyMock.mockResolvedValue(answerFixture());
    render(<AskBailey token="token" />);
    const input = screen.getByLabelText("What are you working on?");
    fireEvent.change(input, { target: { value: "keyboard question" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(askBaileyMock).toHaveBeenCalled());
    expect(askBaileyMock.mock.calls[0][1]).toMatchObject({ question: "keyboard question" });
  });

  it("loads a previous conversation from history", async () => {
    listConversationsMock.mockResolvedValue({
      conversations: [{ id: "conv-9", title: "old tether question", created_at: "2026-07-13", updated_at: "2026-07-13" }]
    });
    getConversationMock.mockResolvedValue({
      conversation: { id: "conv-9", title: "old tether question", created_at: "2026-07-13" },
      messages: [
        {
          id: "msg-9",
          question: "old tether question",
          status: "supported",
          answer_markdown: "Archived answer text.",
          warnings: [],
          knowledge_mode: "operational",
          context_envelope: {},
          created_at: "2026-07-13"
        }
      ],
      citations: []
    });
    render(<AskBailey token="token" />);
    const historyButton = await screen.findByRole("button", { name: "old tether question" });
    fireEvent.click(historyButton);
    await waitFor(() => expect(getConversationMock).toHaveBeenCalledWith("token", "conv-9"));
    expect(await screen.findByText("Archived answer text.")).toBeInTheDocument();
  });
});
