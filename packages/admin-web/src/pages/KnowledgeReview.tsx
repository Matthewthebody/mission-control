import { useCallback, useEffect, useState } from "react";
import {
  approveVersion,
  getReviewQueue,
  rejectVersion,
  resolveConflict,
  resolveQuestion,
  retireVersion,
  retryIngestion,
  reviewReport,
  type ReviewQueue
} from "../services/knowledgeReviewApi";

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

export default function KnowledgeReview({ token }: Props) {
  const [load, setLoad] = useState<LoadState>({ state: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
