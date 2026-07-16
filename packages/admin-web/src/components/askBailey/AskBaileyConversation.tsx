import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  askBailey,
  authorityLabel,
  formatTimestamp,
  submitAskBaileyFeedback,
  type AnswerBlock,
  type AskBaileyAnswer,
  type AskBaileyCitation,
  type AskBaileyContext,
  type FeedbackKind,
  type KnowledgeMode
} from "../../services/askBaileyApi";

// Ask Bailey conversation — the ONE client surface for the server answer
// pipeline, shared by the dedicated page and the contextual drawer (H4-C).
// Answers arrive fully assembled and validated from the server; this
// component only presents them, always as plain text. The record context is
// a candidate {kind,id} pair — the server validates and echoes what it
// actually used, and the chips show only server-confirmed facts.

export type AskBaileyRecordContext = {
  kind: "job" | "shoot" | "organization" | "location" | "task" | "source";
  id: string;
  label: string;
};

export const CONTEXT_KIND_LABELS: Record<AskBaileyRecordContext["kind"], string> = {
  job: "Job",
  shoot: "Shoot",
  organization: "Organization",
  location: "Location",
  task: "Task",
  source: "Source"
};

/** Deterministic starter questions per context kind (approved templates only). */
export function starterSuggestions(kind: AskBaileyRecordContext["kind"] | null): string[] {
  switch (kind) {
    case "shoot":
    case "job":
      return [
        "What should we verify before the first student?",
        "What is the tethering failure procedure?",
        "Who should I contact if we fall behind?"
      ];
    case "location":
      return ["What should I know about this location?", "Are there approved setup notes for this location?"];
    case "organization":
      return ["What is the approved process for this account?", "What should I check before this job?"];
    case "task":
      return ["What is the approved process for this task?", "What do I do if I get stuck on this task?"];
    case "source":
      return ["Summarize what this source covers.", "What procedure does this source describe?"];
    default:
      return [
        "What do I do if the tether feed drops mid-session?",
        "When should I format an SD card?",
        "What is the pre-shoot checklist?"
      ];
  }
}

const MODE_OPTIONS: Array<{ value: KnowledgeMode; label: string }> = [
  { value: "operational", label: "How we do things today" },
  { value: "training", label: "Training" },
  { value: "planning", label: "Future plans & designs" },
  { value: "historical", label: "Historical" }
];

// Safe progress states (H2-E): the answer never streams — these stages
// describe the server's real pipeline while the request is in flight.
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
export function BaileyMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
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

export function StatusBadge({ status }: { status: AskBaileyAnswer["status"] }) {
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

export function AnswerText({ text }: { text: string }) {
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

export function AnswerBlocks({ blocks }: { blocks: AnswerBlock[] }) {
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

export function SourceCard({ citation }: { citation: AskBaileyCitation }) {
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
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {hasTimestamp && citation.media_url ? (
          <a href={citation.media_url} target="_blank" rel="noreferrer">
            Watch from {formatTimestamp(citation.start_seconds as number)}
          </a>
        ) : null}
        <a href={`#knowledge/sources/${citation.source_id}`}>Open source</a>
      </div>
    </div>
  );
}

type LoadState =
  | { state: "idle" }
  | { state: "asking" }
  | { state: "answered"; answer: AskBaileyAnswer }
  | { state: "failed"; message: string };

type Props = {
  token: string;
  /** Candidate record context — the server validates it on every ask. */
  recordContext?: AskBaileyRecordContext | null;
  /** When provided, the record context chip is removable (optional context). */
  onRemoveContext?: () => void;
  /** Non-removable identity line, e.g. "Your role: Senior Photographer". */
  userLine?: string | null;
  onAnswer?: (answer: AskBaileyAnswer) => void;
  compact?: boolean;
};

function contextToRequest(context: AskBaileyRecordContext): AskBaileyContext {
  switch (context.kind) {
    case "job":
      return { job_id: context.id };
    case "shoot":
      return { shoot_id: context.id };
    case "organization":
      return { organization_id: context.id };
    case "location":
      return { location_id: context.id };
    case "task":
      return { task_id: context.id };
    case "source":
      return { source_id: context.id };
  }
}

export default function AskBaileyConversation({
  token,
  recordContext = null,
  onRemoveContext,
  userLine = null,
  onAnswer,
  compact = false
}: Props) {
  const questionId = useId();
  const modeId = useId();
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<KnowledgeMode>("operational");
  const [load, setLoad] = useState<LoadState>({ state: "idle" });
  const [progressStage, setProgressStage] = useState(0);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [feedbackSent, setFeedbackSent] = useState<Record<string, FeedbackKind[]>>({});
  const abortRef = useRef<AbortController | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const submitQuestion = useCallback(
    async (event?: { preventDefault: () => void }, presetQuestion?: string) => {
      event?.preventDefault();
      const trimmed = (presetQuestion ?? question).trim();
      if (!trimmed) {
        return;
      }
      if (presetQuestion) {
        setQuestion(presetQuestion);
      }
      setLoad({ state: "asking" });
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
            conversation_id: conversationId ?? undefined,
            context: recordContext ? contextToRequest(recordContext) : undefined
          },
          controller.signal
        );
        setConversationId(answer.conversation_id);
        setLoad({ state: "answered", answer });
        onAnswer?.(answer);
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
    [question, mode, conversationId, token, recordContext, onAnswer]
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

  const startNewConversation = useCallback(() => {
    setConversationId(null);
    setLoad({ state: "idle" });
    setQuestion("");
  }, []);

  const answer = load.state === "answered" ? load.answer : null;
  const suggestions = starterSuggestions(recordContext?.kind ?? null);

  return (
    <div style={{ display: "grid", gap: compact ? "0.75rem" : "1rem" }}>
      {/* Context transparency (H4): only server-confirmable facts appear.   */}
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }} aria-label="Bailey context">
        <span style={{ fontSize: "0.8rem", opacity: 0.75 }}>Using:</span>
        {recordContext ? (
          <span className="badge-pill">
            {CONTEXT_KIND_LABELS[recordContext.kind]}: {recordContext.label}
            {onRemoveContext ? (
              <button
                type="button"
                onClick={onRemoveContext}
                aria-label={`Remove ${recordContext.label} context`}
                style={{ marginLeft: 6, border: "none", background: "transparent", cursor: "pointer", fontWeight: 700 }}
              >
                ×
              </button>
            ) : null}
          </span>
        ) : (
          <span className="badge-pill">No record context</span>
        )}
        {userLine ? <span className="badge-pill">{userLine}</span> : null}
        <span className="badge-pill">
          {mode === "operational" ? "Approved operational sources" : MODE_OPTIONS.find((option) => option.value === mode)?.label}
        </span>
      </div>

      <form onSubmit={submitQuestion} style={{ display: "grid", gap: "0.5rem" }}>
        <label htmlFor={questionId} style={{ fontWeight: 600 }}>
          What are you working on?
        </label>
        <textarea
          id={questionId}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submitQuestion();
            }
          }}
          rows={compact ? 2 : 3}
          placeholder="e.g. What do I do if the tether feed drops mid-session?"
          style={{ resize: "vertical", padding: "0.6rem", borderRadius: 8 }}
        />
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <label htmlFor={modeId} style={{ fontSize: "0.85rem" }}>
            Answer from:
          </label>
          <select id={modeId} value={mode} onChange={(event) => setMode(event.target.value as KnowledgeMode)}>
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

      {load.state === "idle" && !answer ? (
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }} aria-label="Suggested questions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="secondary-button"
              onClick={() => void submitQuestion(undefined, suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}

      {load.state === "failed" ? (
        <div role="alert" className="panel" style={{ padding: "0.75rem 1rem" }}>
          <strong>Something went wrong</strong>
          <p className="section-subtitle" style={{ margin: "0.25rem 0 0.5rem" }}>
            {load.message}
          </p>
          <button type="button" className="secondary-button" onClick={() => void submitQuestion()}>
            Try again
          </button>
        </div>
      ) : null}

      {answer ? (
        <div aria-live="polite">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <strong>Bailey’s answer</strong>
            <StatusBadge status={answer.status} />
          </div>
          {answer.context ? (
            <p className="section-subtitle" style={{ margin: "0.25rem 0 0" }}>
              Context confirmed: {answer.context.label}
              {answer.context.detail ? ` (${answer.context.detail})` : ""}
            </p>
          ) : recordContext ? (
            <p className="section-subtitle" style={{ margin: "0.25rem 0 0" }}>
              No record context was applied to this answer.
            </p>
          ) : null}

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
        </div>
      ) : null}
    </div>
  );
}
