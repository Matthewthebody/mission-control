import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AskBaileyLaunchButton, AskBaileyProvider, useAskBailey } from "../components/askBailey/AskBaileyLauncher";
import type { AskBaileyAnswer } from "../services/askBaileyApi";

// Ask Bailey contextual drawer (H4) — one pipeline, one client surface.
// These tests pin the context-security UX: candidate context only, visible
// chips, no silent carry-over between records, honest rejection, and the
// keyboard/focus contract.

const askBaileyMock = vi.fn();
const submitFeedbackMock = vi.fn();

vi.mock("../services/askBaileyApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/askBaileyApi")>();
  return {
    ...actual,
    askBailey: (...args: unknown[]) => askBaileyMock(...args),
    submitAskBaileyFeedback: (...args: unknown[]) => submitFeedbackMock(...args)
  };
});

function answerFixture(overrides: Partial<AskBaileyAnswer> = {}): AskBaileyAnswer {
  return {
    status: "supported",
    conversation_id: "conv-1",
    message_id: "msg-1",
    answer_markdown: "Reseat the cable first.",
    answer_blocks: [{ kind: "direct_answer", text: "Reseat the cable first.", segment_ids: ["seg-1"] }],
    citations: [],
    warnings: [],
    conflicts: [],
    context: { kind: "job", id: "job-1", label: "Wayzata Picture Day", detail: "schools · 2026-08-24" },
    evidence: { source_count: 1, highest_authority: "approved_sop", conflict_detected: false },
    ...overrides
  };
}

function GeneralTrigger() {
  const { openAskBailey } = useAskBailey();
  return (
    <button type="button" onClick={() => openAskBailey()}>
      Open Bailey (general)
    </button>
  );
}

function Harness() {
  return (
    <AskBaileyProvider token="token" userLine="Your role: Senior Photographer">
      <GeneralTrigger />
      <AskBaileyLaunchButton context={{ kind: "job", id: "job-1", label: "Wayzata Picture Day" }} />
      <AskBaileyLaunchButton context={{ kind: "job", id: "job-2", label: "Osseo Sports Day" }} />
    </AskBaileyProvider>
  );
}

async function askInDrawer(text: string) {
  fireEvent.change(screen.getByLabelText("What are you working on?"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Ask Bailey" }));
  await waitFor(() => expect(askBaileyMock).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  askBaileyMock.mockResolvedValue(answerFixture());
});

describe("Ask Bailey drawer", () => {
  it("opens in general mode from the shell entry with the identity chips", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open Bailey (general)" }));
    const dialog = await screen.findByRole("dialog", { name: "Ask Bailey" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("No record context")).toBeInTheDocument();
    expect(screen.getByText("Your role: Senior Photographer")).toBeInTheDocument();
    expect(screen.getByText("Approved operational sources")).toBeInTheDocument();
  });

  it("opens contextually with the record chip and context-specific suggestions", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Bailey about Wayzata Picture Day" }));
    await screen.findByRole("dialog", { name: "Ask Bailey" });
    expect(screen.getByText("Job: Wayzata Picture Day")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What should we verify before the first student?" })).toBeInTheDocument();
  });

  it("sends the candidate context id and shows the server-confirmed context", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Bailey about Wayzata Picture Day" }));
    await screen.findByRole("dialog", { name: "Ask Bailey" });
    await askInDrawer("what should I check?");
    expect(askBaileyMock.mock.calls[0][1]).toMatchObject({ context: { job_id: "job-1" } });
    expect(await screen.findByText(/Context confirmed: Wayzata Picture Day/)).toBeInTheDocument();
  });

  it("switching records resets the thread — no silent carry-over", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Bailey about Wayzata Picture Day" }));
    await screen.findByRole("dialog", { name: "Ask Bailey" });
    await askInDrawer("first question");
    expect(await screen.findByText("Bailey’s answer")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close Ask Bailey" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask Bailey about Osseo Sports Day" }));
    await screen.findByRole("dialog", { name: "Ask Bailey" });
    // Fresh thread: the old answer is gone and the new record chip shows.
    expect(screen.queryByText("Bailey’s answer")).not.toBeInTheDocument();
    expect(screen.getByText("Job: Osseo Sports Day")).toBeInTheDocument();

    await askInDrawer("second question");
    const lastCall = askBaileyMock.mock.calls.at(-1)?.[1];
    expect(lastCall).toMatchObject({ context: { job_id: "job-2" } });
    expect(lastCall.conversation_id).toBeUndefined();
  });

  it("optional record context is removable; identity context is not", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Bailey about Wayzata Picture Day" }));
    await screen.findByRole("dialog", { name: "Ask Bailey" });
    fireEvent.click(screen.getByRole("button", { name: "Remove Wayzata Picture Day context" }));
    expect(await screen.findByText("No record context")).toBeInTheDocument();
    // The identity chip has no remove affordance.
    expect(screen.queryByRole("button", { name: /Remove Your role/ })).not.toBeInTheDocument();
  });

  it("shows an honest error when the server rejects the context", async () => {
    askBaileyMock.mockRejectedValue(new Error("Context record not found."));
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Bailey about Wayzata Picture Day" }));
    await screen.findByRole("dialog", { name: "Ask Bailey" });
    await askInDrawer("anything");
    expect(await screen.findByRole("alert")).toHaveTextContent("Context record not found.");
    expect(screen.queryByText("Bailey’s answer")).not.toBeInTheDocument();
  });

  it("closes on Escape and restores focus to the opener", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open Bailey (general)" });
    // jsdom clicks do not move focus the way real clicks do.
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Ask Bailey" });
    // Close button receives initial focus.
    expect(screen.getByRole("button", { name: "Close Ask Bailey" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });
});
