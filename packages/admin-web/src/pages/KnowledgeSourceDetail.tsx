import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "../api";
import { AskBaileyLaunchButton } from "../components/askBailey/AskBaileyLauncher";
import {
  approveVersion,
  CLASSIFICATION_LABELS,
  correctSegment,
  getVersionTranscript,
  rejectVersion,
  retireVersion,
  SEGMENT_CLASSIFICATIONS,
  type ReviewSegment,
  type SegmentClassification
} from "../services/knowledgeReviewApi";
import {
  createRevision,
  getSourceDetail,
  ingestVersion,
  mergeSegmentApi,
  splitSegmentApi,
  submitVersion,
  updateDraft,
  type ReviewerSourceDetail,
  type SourceDetail,
  type SourceVersionRow
} from "../services/knowledgeAuthoringApi";

// Knowledge source detail (H5) — the destination behind Ask Bailey source
// cards. Dual-mode from the server: employees get an eligibility-gated
// read-only view (an ineligible source was an opaque 404 before this page
// ever rendered); reviewers get the governance record with progressive
// disclosure. The version rule is visible here: approved versions have no
// edit control — only "New revision".

type Props = { token: string };

function parseSourceId(): string {
  const raw = window.location.hash.replace(/^#/, "").split("?")[0];
  const segments = raw.split("/").filter(Boolean);
  return segments.length ? decodeURIComponent(segments[segments.length - 1]) : "";
}

function formatClock(seconds: number | null): string {
  if (seconds === null) return "";
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function SegmentRow({
  token,
  segment,
  isLast,
  onChanged,
  onError
}: {
  token: string;
  segment: ReviewSegment;
  isLast: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const timestamped = segment.start_seconds !== null && segment.end_seconds !== null;
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : "The segment action failed.");
    }
  };

  const onSplit = () => {
    if (timestamped) {
      const raw = window.prompt(
        `Split at how many seconds? Must be strictly between ${segment.start_seconds} and ${segment.end_seconds}. Timestamps are never invented — the split point must be a real moment inside this segment.`
      );
      if (!raw) return;
      const splitSeconds = Number(raw);
      if (!Number.isFinite(splitSeconds)) {
        onError("The split point must be a number of seconds.");
        return;
      }
      void run(() => splitSegmentApi(token, segment.id, { split_seconds: splitSeconds }));
    } else {
      const raw = window.prompt(
        `Split after how many characters? Must be strictly inside the ${segment.content.length}-character content.`
      );
      if (!raw) return;
      const offsetChars = Number(raw);
      if (!Number.isInteger(offsetChars)) {
        onError("The split point must be a whole number of characters.");
        return;
      }
      void run(() => splitSegmentApi(token, segment.id, { offset_chars: offsetChars }));
    }
  };

  return (
    <div style={{ borderTop: "1px solid var(--border-color, #eee8dc)", padding: "0.4rem 0", fontSize: "0.85rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <strong>{segment.locator_label ?? segment.heading ?? `Segment ${segment.ordinal + 1}`}</strong>
        {timestamped ? (
          <span className="badge-pill">
            {formatClock(segment.start_seconds)}–{formatClock(segment.end_seconds)}
          </span>
        ) : null}
        {segment.speaker_label ? <span className="badge-pill">{segment.speaker_label}</span> : null}
        <label style={{ display: "inline-flex", gap: "0.3rem", alignItems: "center" }}>
          <span>Classification</span>
          <select
            aria-label={`Classification for segment ${segment.ordinal + 1}`}
            value={segment.reviewer_classification ?? segment.segment_kind}
            onChange={(event) =>
              void run(() =>
                correctSegment(token, segment.id, {
                  reviewer_classification: event.target.value as SegmentClassification
                })
              )
            }
          >
            {SEGMENT_CLASSIFICATIONS.map((classification) => (
              <option key={classification} value={classification}>
                {CLASSIFICATION_LABELS[classification]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary-button" onClick={onSplit}>
          Split
        </button>
        {!isLast ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => void run(() => mergeSegmentApi(token, segment.id))}
          >
            Merge with next
          </button>
        ) : null}
      </div>
      <p style={{ margin: "0.25rem 0 0", whiteSpace: "pre-wrap" }}>{segment.content}</p>
    </div>
  );
}

function VersionSegments({
  token,
  versionId,
  onError
}: {
  token: string;
  versionId: string;
  onError: (message: string) => void;
}) {
  const [segments, setSegments] = useState<ReviewSegment[] | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const transcript = await getVersionTranscript(token, versionId);
      setSegments(transcript.segments);
    } catch (error) {
      onError(error instanceof Error ? error.message : "The segments could not be loaded.");
    }
  }, [token, versionId, onError]);

  return (
    <details
      style={{ marginTop: "0.4rem" }}
      open={open}
      onToggle={(event) => {
        const isOpen = (event.target as HTMLDetailsElement).open;
        setOpen(isOpen);
        if (isOpen && segments === null) void load();
      }}
    >
      <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>Segments{segments ? ` (${segments.length})` : ""}</summary>
      {segments === null ? (
        <p className="section-subtitle">Loading segments…</p>
      ) : segments.length === 0 ? (
        <p className="section-subtitle">No segments yet — run ingestion first.</p>
      ) : (
        <div>
          {segments.map((segment, index) => (
            <SegmentRow
              key={segment.id}
              token={token}
              segment={segment}
              isLast={index === segments.length - 1}
              onChanged={() => void load()}
              onError={onError}
            />
          ))}
        </div>
      )}
    </details>
  );
}

function VersionCard({
  token,
  version,
  isCurrent,
  onChanged,
  onError
}: {
  token: string;
  version: SourceVersionRow;
  isCurrent: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(version.inline_body ?? "");
  const editable = ["draft", "rejected"].includes(version.publication_status);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : "The action failed.");
    }
  };

  return (
    <div style={{ border: "1px solid var(--border-color, #d9d4c8)", borderRadius: 8, padding: "0.6rem 0.9rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <strong>v{version.version_number}</strong>
        <span className="badge-pill">{version.publication_status.replace(/_/g, " ")}</span>
        <span className="badge-pill">{version.authority_class.replace(/_/g, " ")}</span>
        <span className="badge-pill">{version.knowledge_mode}</span>
        {isCurrent ? <span className="badge-pill">current</span> : null}
        {version.confidential ? <span className="badge-pill">confidential</span> : null}
      </div>
      <div style={{ fontSize: "0.8rem", opacity: 0.75, marginTop: "0.2rem" }}>
        {[
          version.supersedes_version_id ? "supersedes a prior version" : null,
          version.superseded_by_version_id ? "superseded by a newer version" : null,
          version.approved_at ? `approved ${version.approved_at.slice(0, 10)}${version.approved_by_name ? ` by ${version.approved_by_name}` : ""}` : null,
          version.review_due_at ? `review due ${version.review_due_at}` : null,
          version.effective_until ? `effective until ${version.effective_until}` : null,
          `extraction: ${version.extraction_status}`
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {version.review_notes ? (
        <p className="section-subtitle" style={{ margin: "0.25rem 0 0" }}>
          Review notes: {version.review_notes}
        </p>
      ) : null}
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
        {version.publication_status === "draft" || version.publication_status === "rejected" ? (
          <>
            <button type="button" className="secondary-button" onClick={() => setEditing((current) => !current)}>
              {editing ? "Close editor" : "Edit draft"}
            </button>
            <button type="button" className="primary-button" onClick={() => void run(() => submitVersion(token, version.id))}>
              Submit for review
            </button>
          </>
        ) : null}
        {version.publication_status === "pending_review" ? (
          <>
            <button type="button" className="primary-button" onClick={() => void run(() => approveVersion(token, version.id))}>
              Approve
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                const note = window.prompt("What changes are requested? (required)");
                if (note && note.trim()) void run(() => rejectVersion(token, version.id, note.trim()));
              }}
            >
              Request changes
            </button>
          </>
        ) : null}
        {version.publication_status === "approved" ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              const note = window.prompt("Why is this version being retired? (optional)") ?? undefined;
              void run(() => retireVersion(token, version.id, note));
            }}
          >
            Retire
          </button>
        ) : null}
        <button
          type="button"
          className="secondary-button"
          onClick={() => void run(() => ingestVersion(token, version.id, "document_extract"))}
        >
          Re-ingest
        </button>
      </div>
      {editing && editable ? (
        <div style={{ marginTop: "0.5rem", display: "grid", gap: "0.4rem" }}>
          <textarea
            aria-label={`Draft body for v${version.version_number}`}
            rows={8}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <div>
            <button
              type="button"
              className="primary-button"
              onClick={() => void run(() => updateDraft(token, version.id, { inline_body: body }))}
            >
              Save draft
            </button>
          </div>
        </div>
      ) : null}
      {version.inline_body && !editing ? (
        <details style={{ marginTop: "0.4rem" }}>
          <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>View content</summary>
          <p style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem" }}>{version.inline_body}</p>
        </details>
      ) : null}
      <VersionSegments token={token} versionId={version.id} onError={onError} />
    </div>
  );
}

function ReviewerView({ token, detail, onChanged, onError }: { token: string; detail: ReviewerSourceDetail; onChanged: () => void; onError: (message: string) => void }) {
  const { source, versions } = detail;
  const hasInFlight = versions.some((version) => ["draft", "pending_review"].includes(version.publication_status));
  return (
    <>
      <section className="panel">
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <div className="section-title" style={{ marginBottom: 0 }}>
            {source.title}
          </div>
          <span className="badge-pill">{detail.usage.citations} citations</span>
        </div>
        <p className="section-subtitle">
          {[
            source.owner_name ? `Owner: ${source.owner_name}` : null,
            source.department_owner ? `Department: ${source.department_owner}` : null,
            source.asset_file_name ? `Asset: ${source.asset_file_name}` : "No linked asset",
            `Created ${source.created_at.slice(0, 10)}${source.created_by_name ? ` by ${source.created_by_name}` : ""}`
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {source.description ? <p className="section-subtitle">{source.description}</p> : null}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="primary-button"
            disabled={hasInFlight}
            title={hasInFlight ? "A draft or pending revision already exists." : undefined}
            onClick={() => {
              const note = window.prompt("Why is a revision needed? (optional)") ?? undefined;
              void createRevision(token, source.id, { note })
                .then(onChanged)
                .catch((error) => onError(error instanceof Error ? error.message : "Creating the revision failed."));
            }}
          >
            New revision
          </button>
          <a className="secondary-button" href="#knowledge/sources" style={{ textDecoration: "none" }}>
            Back to sources
          </a>
        </div>
      </section>

      <section className="panel">
        <div className="section-title">Versions ({versions.length})</div>
        <p className="section-subtitle">
          Approved content is never edited in place — create a revision, review it, and approval supersedes the prior
          version atomically.
        </p>
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {versions.map((version) => (
            <VersionCard
              key={version.id}
              token={token}
              version={version}
              isCurrent={version.id === source.current_version_id}
              onChanged={onChanged}
              onError={onError}
            />
          ))}
        </div>
      </section>

      <section className="panel">
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            Operations — ingestion ({detail.jobs.length}), embeddings, conflicts ({detail.conflicts.length}), reports ({detail.reports.length})
          </summary>
          <div style={{ marginTop: "0.5rem", display: "grid", gap: "0.5rem", fontSize: "0.85rem" }}>
            <div>
              <strong>Embedding health:</strong>{" "}
              {detail.embedding_health.length
                ? detail.embedding_health.map((row) => `${row.status}: ${row.n}`).join(" · ")
                : "no embeddings yet"}
            </div>
            {detail.jobs.slice(0, 5).map((job) => (
              <div key={job.id}>
                {job.job_kind.replace(/_/g, " ")} · {job.status} · {job.provider ?? ""} {job.error_message ? `· ${job.error_message}` : ""}
              </div>
            ))}
            {detail.conflicts.map((conflict) => (
              <div key={conflict.id}>
                Conflict {conflict.status}: {conflict.note ?? ""} {conflict.resolution_note ? `→ ${conflict.resolution_note}` : ""}
              </div>
            ))}
            {detail.reports.map((report) => (
              <div key={report.id}>
                Report ({report.feedback_kind.replace(/_/g, " ")}, {report.review_status}): {report.note ?? "no note"}
              </div>
            ))}
          </div>
        </details>
      </section>

      <section className="panel">
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Audit history ({detail.audit.length})</summary>
          <ul style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
            {detail.audit.map((entry, index) => (
              <li key={index}>
                {entry.created_at.slice(0, 16).replace("T", " ")} — {entry.action.replace("knowledge.", "").replace(/_/g, " ")}
                {entry.actor_name ? ` by ${entry.actor_name}` : ""}
              </li>
            ))}
          </ul>
        </details>
      </section>
    </>
  );
}

export default function KnowledgeSourceDetail({ token }: Props) {
  const [sourceId, setSourceId] = useState(parseSourceId);
  const [detail, setDetail] = useState<SourceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const onHash = () => setSourceId(parseSourceId());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const refresh = useCallback(async () => {
    if (!sourceId) return;
    try {
      setDetail(await getSourceDetail(token, sourceId));
      setNotFound(false);
    } catch (loadError) {
      setDetail(null);
      setNotFound(true);
      setError(loadError instanceof Error ? loadError.message : "This source could not be opened.");
    }
  }, [token, sourceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (notFound) {
    return (
      <section className="panel">
        <div className="section-title">Source not available</div>
        <p className="section-subtitle">
          This knowledge source doesn’t exist or isn’t available to you. {error}
        </p>
      </section>
    );
  }
  if (!detail) {
    return (
      <section className="panel">
        <div className="section-title">Knowledge source</div>
        <p className="section-subtitle">Loading…</p>
      </section>
    );
  }

  if (detail.mode === "employee") {
    const { source, segments } = detail;
    return (
      <div className="workspace-shell" style={{ display: "grid", gap: "1rem" }}>
        <section className="panel">
          <div className="section-title">{source.title}</div>
          <p className="section-subtitle">
            {[source.source_type.replace(/_/g, " "), source.authority_class.replace(/_/g, " "), source.approved_at ? `approved ${source.approved_at.slice(0, 10)}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {source.description ? <p className="section-subtitle">{source.description}</p> : null}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <AskBaileyLaunchButton
              context={{ kind: "source", id: source.id, label: source.title }}
              label="Ask Bailey about this source"
            />
            {source.resource_library_item_id ? (
              <a
                className="secondary-button"
                style={{ textDecoration: "none" }}
                href={`${apiUrl}/api/ask-bailey/sources/${source.id}/media`}
                target="_blank"
                rel="noreferrer"
              >
                Open media
              </a>
            ) : null}
          </div>
        </section>
        <section className="panel">
          <div className="section-title">Contents</div>
          <ul>
            {segments.map((segment) => (
              <li key={segment.id}>
                {segment.locator_label ?? segment.heading ?? `Part ${segment.ordinal + 1}`}
                {segment.start_seconds !== null ? ` (${formatClock(segment.start_seconds)})` : ""}
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  return (
    <div className="workspace-shell knowledge-source-detail" style={{ display: "grid", gap: "1rem" }}>
      {error ? (
        <p role="alert" style={{ color: "var(--danger-color, #c53030)" }}>
          {error}
        </p>
      ) : null}
      <ReviewerView token={token} detail={detail} onChanged={() => void refresh()} onError={setError} />
    </div>
  );
}
