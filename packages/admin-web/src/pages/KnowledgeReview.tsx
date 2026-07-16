import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "../api";
import {
  approveVersion,
  cancelIngestion,
  CLASSIFICATION_LABELS,
  correctSegment,
  getReviewQueue,
  getVersionTranscript,
  rejectVersion,
  resolveConflict,
  resolveQuestion,
  retireVersion,
  retryIngestion,
  reviewReport,
  SEGMENT_CLASSIFICATIONS,
  type ReviewQueue,
  type ReviewSegment,
  type SegmentClassification,
  type VersionTranscript
} from "../services/knowledgeReviewApi";
import { convertQuestion } from "../services/knowledgeAuthoringApi";

// Knowledge Review — the knowledge-owner workflow behind Ask Bailey.
// Five queues: pending source versions, open source conflicts, unresolved
// questions, answer reports, and ingestion jobs needing attention. Every
// action here calls a reviewer-gated, audited endpoint; nothing is local.

type Props = {
  token: string;
};

type LoadState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; queue: ReviewQueue };

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    new Date(value)
  );
}

function formatClock(seconds: number | null): string {
  if (seconds === null) return "—";
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

// Transcript & segment review (H3-E): reviewers inspect and correct extracted
// content, adjust timestamps, and classify segments. Every save is an audited
// server-side correction; classification changes retrieval eligibility.
function TranscriptReviewPanel({
  token,
  versionId,
  onClose,
  onActionError
}: {
  token: string;
  versionId: string;
  onClose: () => void;
  onActionError: (message: string) => void;
}) {
  const [transcript, setTranscript] = useState<VersionTranscript | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Partial<ReviewSegment>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const playerRef = useRef<HTMLVideoElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTranscript(await getVersionTranscript(token, versionId));
      setDrafts({});
    } catch (error) {
      onActionError(error instanceof Error ? error.message : "Failed to load the transcript.");
    }
  }, [token, versionId, onActionError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!transcript) {
    return (
      <section className="panel">
        <div className="section-title">Transcript review</div>
        <p className="section-subtitle">Loading segments…</p>
      </section>
    );
  }

  const { version, segments, jobs } = transcript;
  const isApproved = version.publication_status === "approved";
  const mediaSrc = version.resource_library_item_id
    ? `${apiUrl}/api/ask-bailey/sources/${version.source_id}/media`
    : null;

  const draftFor = (segment: ReviewSegment) => ({ ...segment, ...(drafts[segment.id] ?? {}) });
  const setDraft = (segmentId: string, patch: Partial<ReviewSegment>) =>
    setDrafts((current) => ({ ...current, [segmentId]: { ...(current[segmentId] ?? {}), ...patch } }));

  const save = async (segment: ReviewSegment) => {
    const draft = draftFor(segment);
    let note: string | undefined;
    if (isApproved) {
      const entered = window.prompt("This version is approved. Why is this correction needed? (required)");
      if (!entered || !entered.trim()) return;
      note = entered.trim();
    }
    setSavingId(segment.id);
    try {
      await correctSegment(token, segment.id, {
        content: draft.content,
        start_seconds: draft.start_seconds,
        end_seconds: draft.end_seconds,
        reviewer_classification: draft.reviewer_classification ?? null,
        review_notes: draft.review_notes ?? null,
        speaker_label: draft.speaker_label ?? null,
        note
      });
      await refresh();
    } catch (error) {
      onActionError(error instanceof Error ? error.message : "The correction failed.");
    } finally {
      setSavingId(null);
    }
  };

  const playFrom = (seconds: number | null) => {
    if (seconds === null || !playerRef.current) return;
    playerRef.current.currentTime = seconds;
    void playerRef.current.play().catch(() => {
      // Playback may be blocked (no media / storage not configured); the
      // element's own error UI stays honest.
    });
  };

  return (
    <section className="panel">
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <div className="section-title" style={{ marginBottom: 0 }}>
          Transcript review — {version.title}
        </div>
        <span className="badge-pill">{version.publication_status.replace(/_/g, " ")}</span>
        {version.media_duration_seconds !== null ? (
          <span className="badge-pill">duration {formatClock(version.media_duration_seconds)}</span>
        ) : null}
        <button type="button" className="secondary-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="section-subtitle">
        Corrections are audited with before/after values; the provider’s original text is preserved. Classification
        controls whether a segment may support answers.
      </p>

      {mediaSrc ? (
        <video ref={playerRef} controls preload="none" style={{ width: "100%", maxHeight: 260, background: "#000" }} src={mediaSrc}>
          <track kind="captions" />
        </video>
      ) : (
        <p className="section-subtitle">This source has no linked media asset.</p>
      )}

      {jobs.length > 0 ? (
        <div style={{ margin: "0.5rem 0", fontSize: "0.85rem" }}>
          {jobs.slice(0, 3).map((job) => (
            <div key={job.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <span className="badge-pill">{job.job_kind.replace(/_/g, " ")}</span>
              <span className="badge-pill">{job.status}</span>
              <span>{job.provider ?? ""}</span>
              {job.error_message ? <span style={{ opacity: 0.8 }}>{job.error_message}</span> : null}
              {["failed", "not_configured", "needs_review"].includes(job.status) ? (
                <>
                  <button type="button" className="secondary-button" onClick={() => void retryIngestion(token, job.id).then(refresh)}>
                    Retry
                  </button>
                  <button type="button" className="secondary-button" onClick={() => void cancelIngestion(token, job.id).then(refresh)}>
                    Cancel
                  </button>
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.5rem" }}>
        {segments.map((segment) => {
          const draft = draftFor(segment);
          return (
            <div key={segment.id} style={{ border: "1px solid var(--border-color, #d9d4c8)", borderRadius: 8, padding: "0.6rem 0.9rem" }}>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <span className="badge-pill">{segment.locator_label ?? `#${segment.ordinal + 1}`}</span>
                {segment.start_seconds !== null ? (
                  <button type="button" className="secondary-button" onClick={() => playFrom(segment.start_seconds)}>
                    Play from {formatClock(segment.start_seconds)}
                  </button>
                ) : null}
                <select
                  aria-label={`Classification for segment ${segment.ordinal + 1}`}
                  value={draft.reviewer_classification ?? ""}
                  onChange={(event) =>
                    setDraft(segment.id, {
                      reviewer_classification: (event.target.value || null) as SegmentClassification | null
                    })
                  }
                >
                  <option value="">Inherit from version</option>
                  {SEGMENT_CLASSIFICATIONS.map((classification) => (
                    <option key={classification} value={classification}>
                      {CLASSIFICATION_LABELS[classification]}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                aria-label={`Transcript text for segment ${segment.ordinal + 1}`}
                value={draft.content}
                onChange={(event) => setDraft(segment.id, { content: event.target.value })}
                rows={3}
                style={{ width: "100%", marginTop: "0.4rem" }}
              />
              {segment.start_seconds !== null ? (
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.3rem", fontSize: "0.85rem" }}>
                  <label>
                    Start (s):{" "}
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={draft.start_seconds ?? 0}
                      onChange={(event) => setDraft(segment.id, { start_seconds: Number(event.target.value) })}
                      style={{ width: 90 }}
                    />
                  </label>
                  <label>
                    End (s):{" "}
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={draft.end_seconds ?? 0}
                      onChange={(event) => setDraft(segment.id, { end_seconds: Number(event.target.value) })}
                      style={{ width: 90 }}
                    />
                  </label>
                </div>
              ) : null}
              <input
                aria-label={`Reviewer notes for segment ${segment.ordinal + 1}`}
                placeholder="Reviewer notes"
                value={draft.review_notes ?? ""}
                onChange={(event) => setDraft(segment.id, { review_notes: event.target.value || null })}
                style={{ width: "100%", marginTop: "0.3rem" }}
              />
              {segment.original_content ? (
                <details style={{ marginTop: "0.3rem" }}>
                  <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>Provider original</summary>
                  <p style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem", opacity: 0.85 }}>{segment.original_content}</p>
                </details>
              ) : null}
              <div style={{ marginTop: "0.4rem" }}>
                <button
                  type="button"
                  className="primary-button"
                  disabled={savingId === segment.id}
                  onClick={() => void save(segment)}
                >
                  Save correction
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function KnowledgeReview({ token }: Props) {
  const [load, setLoad] = useState<LoadState>({ state: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [transcriptVersionId, setTranscriptVersionId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const queue = await getReviewQueue(token);
      setLoad({ state: "ready", queue });
    } catch (error) {
      setLoad({ state: "error", message: error instanceof Error ? error.message : "Failed to load the review queue." });
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAction = useCallback(
    async (id: string, action: () => Promise<unknown>) => {
      setBusyId(id);
      setActionError(null);
      try {
        await action();
        await refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "The action failed.");
      } finally {
        setBusyId(null);
      }
    },
    [refresh]
  );

  if (load.state === "loading") {
    return (
      <section className="panel">
        <div className="section-title">Knowledge Review</div>
        <p className="section-subtitle">Loading the review queue…</p>
      </section>
    );
  }
  if (load.state === "error") {
    return (
      <section className="panel">
        <div className="section-title">Knowledge Review</div>
        <p className="section-subtitle">{load.message}</p>
        <button type="button" className="secondary-button" onClick={() => void refresh()}>
          Try again
        </button>
      </section>
    );
  }

  const { queue } = load;

  return (
    <div className="workspace-shell knowledge-review" style={{ display: "grid", gap: "1rem" }}>
      <section className="panel">
        <div className="section-title">Knowledge Review</div>
        <p className="section-subtitle">
          The review workflow behind Ask Bailey: approve or reject sources, resolve conflicts, answer the questions
          Bailey couldn’t, and handle reported answers. Every action is recorded in the audit trail.
        </p>
        {actionError ? (
          <p role="alert" style={{ color: "var(--danger-color, #c53030)" }}>
            {actionError}
          </p>
        ) : null}
      </section>

      {transcriptVersionId ? (
        <TranscriptReviewPanel
          token={token}
          versionId={transcriptVersionId}
          onClose={() => setTranscriptVersionId(null)}
          onActionError={setActionError}
        />
      ) : null}

      <section className="panel">
        <div className="section-title">Pending source versions ({queue.pending_versions.length})</div>
        {queue.pending_versions.length === 0 ? (
          <p className="section-subtitle">Nothing waiting for review.</p>
        ) : (
          queue.pending_versions.map((version) => (
            <div key={version.id} style={{ borderTop: "1px solid var(--border-color, #d9d4c8)", padding: "0.6rem 0" }}>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <strong>{version.title}</strong>
                <span className="badge-pill">v{version.version_number}</span>
                <span className="badge-pill">{version.authority_class.replace(/_/g, " ")}</span>
                <span className="badge-pill">{version.knowledge_mode}</span>
              </div>
              <div style={{ fontSize: "0.85rem", opacity: 0.8 }}>
                {version.source_type.replace(/_/g, " ")} · submitted {formatDate(version.created_at)}
                {version.submitted_by_name ? ` by ${version.submitted_by_name}` : ""} · extraction:{" "}
                {version.extraction_status}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setTranscriptVersionId(version.id)}
                >
                  Review transcript
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busyId === version.id}
                  onClick={() => void runAction(version.id, () => approveVersion(token, version.id))}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busyId === version.id}
                  onClick={() => {
                    const note = window.prompt("Why is this version rejected? (required)");
                    if (note && note.trim()) {
                      void runAction(version.id, () => rejectVersion(token, version.id, note.trim()));
                    }
                  }}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busyId === version.id}
                  onClick={() => void runAction(version.id, () => retireVersion(token, version.id))}
                >
                  Retire
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="panel">
        <div className="section-title">Source conflicts ({queue.open_conflicts.length})</div>
        {queue.open_conflicts.length === 0 ? (
          <p className="section-subtitle">No open conflicts. Bailey answers without disagreement warnings.</p>
        ) : (
          queue.open_conflicts.map((conflict) => (
            <div key={conflict.id} style={{ borderTop: "1px solid var(--border-color, #d9d4c8)", padding: "0.6rem 0" }}>
              <div>
                <strong>{conflict.source_a_title}</strong> vs <strong>{conflict.source_b_title}</strong>
              </div>
              {conflict.note ? <div style={{ fontSize: "0.85rem", opacity: 0.8 }}>{conflict.note}</div> : null}
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busyId === conflict.id}
                  onClick={() => {
                    const note = window.prompt("How was this conflict resolved? (required)");
                    if (note && note.trim()) {
                      void runAction(conflict.id, () => resolveConflict(token, conflict.id, "resolved", note.trim()));
                    }
                  }}
                >
                  Mark resolved
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busyId === conflict.id}
                  onClick={() => {
                    const note = window.prompt("Why is this conflict dismissed? (required)");
                    if (note && note.trim()) {
                      void runAction(conflict.id, () => resolveConflict(token, conflict.id, "dismissed", note.trim()));
                    }
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="panel">
        <div className="section-title">Unresolved questions ({queue.unresolved_questions.length})</div>
        {queue.unresolved_questions.length === 0 ? (
          <p className="section-subtitle">No open questions — Bailey found approved answers for everything asked.</p>
        ) : (
          queue.unresolved_questions.map((question) => (
            <div key={question.id} style={{ borderTop: "1px solid var(--border-color, #d9d4c8)", padding: "0.6rem 0" }}>
              <div>
                <strong>{question.example_question}</strong>
              </div>
              <div style={{ fontSize: "0.85rem", opacity: 0.8 }}>
                Asked {question.occurrence_count} time{question.occurrence_count === 1 ? "" : "s"} · last{" "}
                {formatDate(question.last_asked_at)}
                {question.departments_asking.length ? ` · departments: ${question.departments_asking.join(", ")}` : ""}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busyId === question.id}
                  onClick={() => {
                    const note = window.prompt(
                      "Where was this answered? (e.g. new/updated source title — the source itself still goes through review)"
                    );
                    if (note && note.trim()) {
                      void runAction(question.id, () => resolveQuestion(token, question.id, "answered", note.trim()));
                    }
                  }}
                >
                  Mark answered
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busyId === question.id}
                  onClick={() => {
                    // H5: turn the gap into governed draft guidance. The draft
                    // stays invisible to Ask Bailey until it is approved.
                    const title = window.prompt("Title for the new guidance source:");
                    if (!title || !title.trim()) return;
                    const body = window.prompt("Draft answer (this becomes a DRAFT — it will not answer questions until approved):");
                    if (!body || !body.trim()) return;
                    void runAction(question.id, async () => {
                      const created = await convertQuestion(token, question.id, {
                        title: title.trim(),
                        body: body.trim()
                      });
                      window.location.hash = `#knowledge/sources/${created.source_id}`;
                    });
                  }}
                >
                  Convert to draft guidance
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busyId === question.id}
                  onClick={() => void runAction(question.id, () => resolveQuestion(token, question.id, "dismissed"))}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="panel">
        <div className="section-title">Reported answers ({queue.open_reports.length})</div>
        {queue.open_reports.length === 0 ? (
          <p className="section-subtitle">No open reports.</p>
        ) : (
          queue.open_reports.map((report) => (
            <div key={report.id} style={{ borderTop: "1px solid var(--border-color, #d9d4c8)", padding: "0.6rem 0" }}>
              <div>
                <strong>{report.question}</strong> <span className="badge-pill">{report.feedback_kind.replace(/_/g, " ")}</span>
              </div>
              <div style={{ fontSize: "0.85rem", opacity: 0.8 }}>
                {report.reporter_name ? `Reported by ${report.reporter_name} · ` : ""}
                {formatDate(report.created_at)}
                {report.note ? ` · "${report.note}"` : ""}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busyId === report.id}
                  onClick={() => void runAction(report.id, () => reviewReport(token, report.id, "reviewed"))}
                >
                  Mark reviewed
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busyId === report.id}
                  onClick={() => void runAction(report.id, () => reviewReport(token, report.id, "dismissed"))}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="panel">
        <div className="section-title">Ingestion needing attention ({queue.ingestion_attention.length})</div>
        {queue.ingestion_attention.length === 0 ? (
          <p className="section-subtitle">All ingestion jobs are healthy.</p>
        ) : (
          queue.ingestion_attention.map((job) => (
            <div key={job.id} style={{ borderTop: "1px solid var(--border-color, #d9d4c8)", padding: "0.6rem 0" }}>
              <div>
                <strong>{job.source_title}</strong> <span className="badge-pill">{job.job_kind.replace(/_/g, " ")}</span>{" "}
                <span className="badge-pill">{job.status}</span>
              </div>
              <div style={{ fontSize: "0.85rem", opacity: 0.8 }}>
                {job.attempts} attempt{job.attempts === 1 ? "" : "s"} · {formatDate(job.created_at)}
                {job.error_message ? ` · ${job.error_message}` : ""}
              </div>
              <div style={{ marginTop: "0.4rem" }}>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busyId === job.id}
                  onClick={() => void runAction(job.id, () => retryIngestion(token, job.id))}
                >
                  Retry ingestion
                </button>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
