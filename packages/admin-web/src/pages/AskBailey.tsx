import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  askBailey,
  authorityLabel,
  formatTimestamp,
  getConversation,
  listConversations,
  submitAskBaileyFeedback,
  type AnswerBlock,
  type AskBaileyAnswer,
  type AskBaileyCitation,
  type ConversationDetail,
  type ConversationSummary,
  type FeedbackKind,
  type KnowledgeMode
} from "../services/askBaileyApi";

// Ask Bailey — the dedicated assistant page. Answers arrive fully assembled
// from the server (status, citations, timestamps, conflicts); this page only
// presents them. Answer text renders as PLAIN TEXT — never as HTML — so
// source content can never inject markup.

type Props = {
  token: string;
};

const MODE_OPTIONS: Array<{ value: KnowledgeMode; label: string }> = [
  { value: "operational", label: "How we do things today" },
  { value: "training", label: "Training" },
  { value: "planning", label: "Future plans & designs" },
  { value: "historical", label: "Historical" }
];

// Safe progress states (H2-E): the answer itself never streams — these
// stages describe the server's real pipeline while the request is in flight,
// and the validated answer renders only once it arrives whole.
const PROGRESS_STAGES = [
  "Bailey is checking the approved playbook…",
  "Bailey found authorized sources…",
  "Bailey is comparing the current versions…",
  "Bailey is validating the answer…"
];

const BLOCK_KIND_LABELS: Record<AnswerBlock["kind"], string | null> = {
  direct_answer: null,
  steps: "Steps",
  warning: "Watch out",
  escalation: "Escalation",
  detail: null
};

const FEEDBACK_OPTIONS: Array<{ kind: FeedbackKind; label: string }> = [
  { kind: "helpful", label: "Helpful" },
  { kind: "not_helpful", label: "Not helpful" },
  { kind: "report_incorrect", label: "Report incorrect" },
  { kind: "missing_information", label: "Missing information" },
  { kind: "source_outdated", label: "Source is outdated" }
];

// Temporary Bailey mark: a simple black-lab silhouette. REPLACEABLE — swap for
// an approved Bailey asset once one is provided. Not a real photo of Bailey.
function BaileyMark() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 48 48"
      role="img"
      aria-label="Ask Bailey — temporary placeholder mark of a black lab silhouette"
      style={{ flexShrink: 0 }}
    >
      <circle cx="24" cy="24" r="23" fill="#1f2430" />
      <path
        d="M15 30c0-6 3.5-11 9-11s9 5 9 11c0 1.4-.4 2.6-1.1 3.6-.9 1.3-2.4 2.1-4.1 2.3l-3.8.4-3.8-.4c-1.7-.2-3.2-1-4.1-2.3-.7-1-1.1-2.2-1.1-3.6z"
        fill="#e8e2d6"
      />
      <path d="M17.5 19.5c-2.2.4-4 2.4-4.4 4.8l3 .8c.5-2 1.5-3.7 2.9-4.9z" fill="#e8e2d6" />
      <path d="M30.5 19.5c2.2.4 4 2.4 4.4 4.8l-3 .8c-.5-2-1.5-3.7-2.9-4.9z" fill="#e8e2d6" />
      <circle cx="21" cy="28" r="1.3" fill="#1f2430" />
      <circle cx="27" cy="28" r="1.3" fill="#1f2430" />
      <ellipse cx="24" cy="32" rx="2" ry="1.4" fill="#1f2430" />
    </svg>
  );
}

function StatusBadge({ status }: { status: AskBaileyAnswer["status"] }) {
  const labels: Record<AskBaileyAnswer["status"], string> = {
    supported: "Supported by approved sources",
    partially_supported: "Partially supported",
    no_approved_answer: "No approved answer yet",
    source_conflict: "Sources disagree",
    provider_unavailable: "Answer engine unavailable",
    access_limited: "Access limited",
    error: "Something went wrong"
  };
  return <span className="badge-pill">{labels[status]}</span>;
}

function AnswerText({ text }: { text: string }) {
  // Plain text only: paragraphs split on blank lines, no markup interpretation.
  return (
    <div>
      {text.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index} style={{ whiteSpace: "pre-wrap", margin: "0 0 0.75rem" }}>
          {paragraph}
        </p>
      ))}
    </div>
  );
}

function AnswerBlocks({ blocks }: { blocks: AnswerBlock[] }) {
  // Each block was independently validated server-side; render as plain text.
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      {blocks.map((block, index) => {
        const label = BLOCK_KIND_LABELS[block.kind];
        return (
          <div key={index}>
            {label ? (
              <span className="badge-pill" style={{ marginBottom: "0.25rem", display: "inline-block" }}>
                {label}
              </span>
            ) : null}
            <AnswerText text={block.text} />
          </div>
        );
      })}
    </div>
  );
}

function SourceCard({ citation }: { citation: AskBaileyCitation }) {
  const hasTimestamp = citation.start_seconds != null;
  return (
    <div
      style={{
        border: "1px solid var(--border-color, #d9d4c8)",
        borderRadius: 8,
        padding: "0.75rem 1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <strong>{citation.title}</strong>
        <span className="badge-pill">{authorityLabel(citation.authority_class)}</span>
      </div>
      {citation.locator_label ? <div style={{ fontSize: "0.85rem", opacity: 0.8 }}>{citation.locator_label}</div> : null}
      {hasTimestamp && citation.media_url ? (
        <a href={citation.media_url} target="_blank" rel="noreferrer">
          Watch from {formatTimestamp(citation.start_seconds as number)}
        </a>
      ) : null}
    </div>
  );
}

type LoadState =
  | { state: "idle" }
  | { state: "asking" }
  | { state: "answered"; answer: AskBaileyAnswer }
  | { state: "failed"; message: string };

export default function AskBailey({ token }: Props) {
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<KnowledgeMode>("operational");
  const [load, setLoad] = useState<LoadState>({ state: "idle" });
  const [progressStage, setProgressStage] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [history, setHistory] = useState<ConversationDetail | null>(null);
  const [feedbackSent, setFeedbackSent] = useState<Record<string, FeedbackKind[]>>({});

  const refreshConversations = useCallback(async () => {
    try {
      const result = await listConversations(token);
      setConversations(result.conversations);
    } catch {
      // History is non-critical; the ask flow stays usable without it.
    }
  }, [token]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  const submitQuestion = useCallback(
    async (event?: { preventDefault: () => void }) => {
      event?.preventDefault();
      const trimmed = question.trim();
      if (!trimmed) {
        return;
      }
      setLoad({ state: "asking" });
      setHistory(null);
      setProgressStage(0);
      // Safe progress states only — no unvalidated prose ever streams in.
      progressTimerRef.current = setInterval(() => {
        setProgressStage((stage) => Math.min(stage + 1, PROGRESS_STAGES.length - 1));
      }, 900);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const answer = await askBailey(
          token,
          {
            question: trimmed,
            mode,
            conversation_id: conversationId ?? undefined
          },
          controller.signal
        );
        setConversationId(answer.conversation_id);
        setLoad({ state: "answered", answer });
        void refreshConversations();
      } catch (error) {
        if (controller.signal.aborted) {
          setLoad({ state: "idle" });
        } else {
          const message = error instanceof Error ? error.message : "The request failed.";
          setLoad({ state: "failed", message });
        }
      } finally {
        if (progressTimerRef.current) {
          clearInterval(progressTimerRef.current);
          progressTimerRef.current = null;
        }
        abortRef.current = null;
      }
    },
    [question, mode, conversationId, token, refreshConversations]
  );

  const cancelAsk = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const sendFeedback = useCallback(
    async (messageId: string, kind: FeedbackKind) => {
      try {
        await submitAskBaileyFeedback(token, messageId, kind);
        setFeedbackSent((current) => ({
          ...current,
          [messageId]: [...(current[messageId] ?? []), kind]
        }));
      } catch {
        // Feedback failures are silent-but-retryable; the button stays active.
      }
    },
    [token]
  );

  const openConversation = useCallback(
    async (id: string) => {
      try {
        const detail = await getConversation(token, id);
        setHistory(detail);
        setConversationId(id);
        setLoad({ state: "idle" });
      } catch {
        setHistory(null);
      }
    },
    [token]
  );

  const startNewConversation = useCallback(() => {
    setConversationId(null);
    setHistory(null);
    setLoad({ state: "idle" });
    setQuestion("");
  }, []);

  const answer = load.state === "answered" ? load.answer : null;
  const citationsByMessage = useMemo(() => {
    const map = new Map<string, AskBaileyCitation[]>();
    for (const citation of history?.citations ?? []) {
      const list = map.get(citation.message_id) ?? [];
      list.push(citation);
      map.set(citation.message_id, list);
    }
    return map;
  }, [history]);

  return (
    <div className="workspace-shell ask-bailey" style={{ display: "grid", gap: "1rem" }}>
      <section className="panel">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <BaileyMark />
          <div>
            <div className="section-title" style={{ marginBottom: 0 }}>
              Ask Bailey
            </div>
            <p className="section-subtitle" style={{ margin: 0 }}>
              Your guide to how we do things at Kemmetmueller Photography.
            </p>
          </div>
        </div>

        <form onSubmit={submitQuestion} style={{ marginTop: "1rem", display: "grid", gap: "0.5rem" }}>
          <label htmlFor="ask-bailey-question" style={{ fontWeight: 600 }}>
            What are you working on?
          </label>
          <p className="section-subtitle" style={{ margin: 0 }}>
            I’ll check the approved playbook, training videos, and the Mission Control information you are allowed to
            see.
          </p>
          <textarea
            id="ask-bailey-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submitQuestion();
              }
            }}
            rows={3}
            placeholder="e.g. What do I do if the tether feed drops mid-session?"
            style={{ resize: "vertical", padding: "0.6rem", borderRadius: 8 }}
          />
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <label htmlFor="ask-bailey-mode" style={{ fontSize: "0.85rem" }}>
              Answer from:
            </label>
            <select
              id="ask-bailey-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as KnowledgeMode)}
            >
              {MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button type="submit" className="primary-button" disabled={load.state === "asking" || !question.trim()}>
              {load.state === "asking" ? "Asking…" : "Ask Bailey"}
            </button>
            {load.state === "asking" ? (
              <button type="button" className="secondary-button" onClick={cancelAsk}>
                Cancel
              </button>
            ) : null}
            {conversationId && load.state !== "asking" ? (
              <button type="button" className="secondary-button" onClick={startNewConversation}>
                New conversation
              </button>
            ) : null}
          </div>
          {load.state === "asking" ? (
            <p className="section-subtitle" role="status" aria-live="polite" style={{ margin: "0.25rem 0 0" }}>
              {PROGRESS_STAGES[progressStage]}
            </p>
          ) : null}
        </form>
      </section>

      {load.state === "failed" ? (
        <section className="panel" role="alert">
          <div className="section-title">Something went wrong</div>
          <p className="section-subtitle">{load.message}</p>
          <button type="button" className="secondary-button" onClick={() => void submitQuestion()}>
            Try again
          </button>
        </section>
      ) : null}

      {answer ? (
        <section className="panel" aria-live="polite">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <div className="section-title" style={{ marginBottom: 0 }}>
              Bailey’s answer
            </div>
            <StatusBadge status={answer.status} />
          </div>

          {answer.warnings.length > 0 ? (
            <div style={{ margin: "0.75rem 0", padding: "0.5rem 0.75rem", background: "rgba(214,158,46,0.12)", borderRadius: 8 }}>
              {answer.warnings.map((warning, index) => (
                <p key={index} style={{ margin: 0 }}>
                  {warning}
                </p>
              ))}
            </div>
          ) : null}

          {answer.answer_blocks && answer.answer_blocks.length > 0 ? (
            <div style={{ marginTop: "0.75rem" }}>
              <AnswerBlocks blocks={answer.answer_blocks} />
            </div>
          ) : answer.answer_markdown ? (
            <div style={{ marginTop: "0.75rem" }}>
              <AnswerText text={answer.answer_markdown} />
            </div>
          ) : null}

          {answer.conflicts.length > 0 ? (
            <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
              <strong>Sources that disagree</strong>
              {answer.conflicts.map((conflict) => (
                <div
                  key={conflict.conflict_id}
                  style={{ border: "1px solid rgba(197,48,48,0.35)", borderRadius: 8, padding: "0.6rem 0.9rem" }}
                >
                  <div>
                    <strong>{conflict.source_a_title}</strong>
                    {conflict.owner_a_name ? ` — owner: ${conflict.owner_a_name}` : ""}
                  </div>
                  <div>
                    <strong>{conflict.source_b_title}</strong>
                    {conflict.owner_b_name ? ` — owner: ${conflict.owner_b_name}` : ""}
                  </div>
                  {conflict.note ? <div style={{ fontSize: "0.85rem", opacity: 0.8 }}>{conflict.note}</div> : null}
                </div>
              ))}
            </div>
          ) : null}

          {answer.citations.length > 0 ? (
            <div style={{ marginTop: "1rem", display: "grid", gap: "0.5rem" }}>
              <strong>Sources</strong>
              {answer.citations.map((citation) => (
                <SourceCard key={citation.segment_id} citation={citation} />
              ))}
            </div>
          ) : null}

          <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "0.85rem" }}>Did Bailey find the right answer?</span>
            {FEEDBACK_OPTIONS.map((option) => {
              const sent = (feedbackSent[answer.message_id] ?? []).includes(option.kind);
              return (
                <button
                  key={option.kind}
                  type="button"
                  className="secondary-button"
                  disabled={sent}
                  onClick={() => void sendFeedback(answer.message_id, option.kind)}
                >
                  {sent ? `${option.label} ✓` : option.label}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {history ? (
        <section className="panel">
          <div className="section-title">Conversation</div>
          {history.messages.map((message) => (
            <div key={message.id} style={{ marginBottom: "1rem" }}>
              <p style={{ fontWeight: 600, margin: "0 0 0.25rem" }}>{message.question}</p>
              <StatusBadge status={message.status} />
              {message.answer_blocks && message.answer_blocks.length > 0 ? (
                <div style={{ marginTop: "0.5rem" }}>
                  <AnswerBlocks blocks={message.answer_blocks} />
                </div>
              ) : message.answer_markdown ? (
                <div style={{ marginTop: "0.5rem" }}>
                  <AnswerText text={message.answer_markdown} />
                </div>
              ) : null}
              {(citationsByMessage.get(message.id) ?? []).length > 0 ? (
                <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.5rem" }}>
                  {(citationsByMessage.get(message.id) ?? []).map((citation) => (
                    <SourceCard key={`${message.id}-${citation.segment_id}`} citation={citation} />
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <section className="panel">
        <div className="section-title">Recent conversations</div>
        {conversations.length === 0 ? (
          <p className="section-subtitle">No conversations yet. Ask your first question above.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.35rem" }}>
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ width: "100%", textAlign: "left" }}
                  onClick={() => void openConversation(conversation.id)}
                >
                  {conversation.title ?? "Untitled conversation"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>About Ask Bailey</summary>
          <p className="section-subtitle" style={{ marginTop: "0.5rem" }}>
            Ask Bailey is named for Bailey, Kemmetmueller Photography’s beloved black lab and longest-tenured
            employee. She spent more than a decade as part of the company’s daily life. Ask Bailey carries forward
            that same steady presence by helping our people find the right information when they need it. Every
            operational answer is grounded in approved sources — Bailey never invents company truth.
          </p>
        </details>
      </section>
    </div>
  );
}
