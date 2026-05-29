import { useEffect, useMemo, useState } from "react";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { WorkspaceSectionHeader } from "../components/workspace/WorkspaceSectionHeader";
import { featureFlags } from "../featureFlags";
import type {
  CentralJobDepartment,
  CentralJobImportColumnMapping,
  CentralJobImportCommitMode,
  CentralJobImportIssueSummary,
  CentralJobImportRowReview,
  CentralJobImportSessionResponse
} from "../jobIntakeTypes";
import { canCreateShootRecords, hasAuthorityTier } from "../permissions";
import {
  commitCentralJobImportSession,
  createCentralJobImportSession,
  getCentralJobImportSession,
  updateCentralJobImportMapping
} from "../services/centralJobIntakeApi";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  department: CentralJobDepartment;
  contextLabel: string;
  routeHash: string;
  returnHash: string;
};

type BusyState = "uploading" | "loading_session" | "validating" | "committing" | null;

const COMMIT_MODE_OPTIONS: Array<{ value: CentralJobImportCommitMode; label: string; description: string }> = [
  {
    value: "create_drafts_only",
    label: "Create Drafts Only",
    description: "Safe default. Valid rows become drafts and any publish decisions stay manual."
  },
  {
    value: "publish_valid_rows_leave_exceptions",
    label: "Publish Valid Rows and Leave Exceptions",
    description: "Only publish rows that already clear validation and duplicate rules."
  },
  {
    value: "publish_all_valid_rows_with_acknowledgement",
    label: "Publish All Valid Rows With Acknowledgement",
    description: "Publish valid rows, including soft-duplicate warnings once you acknowledge them."
  }
];

const SESSION_EXCEPTION_STATUSES = new Set(["exception", "duplicate_blocked", "commit_failed"]);
const SESSION_SUCCESS_STATUSES = new Set(["draft_created", "published"]);
const PUBLISH_TIERS = ["super_admin", "leadership", "director_admin", "supervisor"] as const;

function getImportSessionIdFromHash() {
  const hash = window.location.hash;
  const queryIndex = hash.indexOf("?");
  if (queryIndex < 0) {
    return null;
  }
  const params = new URLSearchParams(hash.slice(queryIndex + 1));
  return params.get("session");
}

function setImportSessionHash(routeHash: string, sessionId: string | null) {
  const nextHash = sessionId ? `${routeHash}?session=${sessionId}` : routeHash;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
}

function groupFieldsBySection(session: CentralJobImportSessionResponse | null) {
  if (!session) {
    return [];
  }
  const groups = new Map<string, typeof session.supported_fields>();
  for (const field of session.supported_fields) {
    groups.set(field.section, [...(groups.get(field.section) ?? []), field]);
  }
  return Array.from(groups.entries()).map(([section, fields]) => ({ section, fields }));
}

function summarizeIssueMessages(issues: CentralJobImportIssueSummary[]) {
  return issues.map((issue) => issue.message);
}

function labelForRowStatus(status: string) {
  switch (status) {
    case "uploaded":
      return "Uploaded";
    case "validated":
      return "Validated";
    case "partial_commit":
      return "Partially Committed";
    case "committed":
      return "Committed";
    case "draft_ready":
      return "Draft Ready";
    case "publish_ready":
      return "Publish Ready";
    case "publish_ack_required":
      return "Needs Acknowledgement";
    case "exception":
      return "Exception";
    case "draft_created":
      return "Draft Created";
    case "published":
      return "Published";
    case "duplicate_blocked":
      return "Duplicate Blocked";
    case "commit_failed":
      return "Commit Failed";
    default:
      return status;
  }
}

function toneForRowStatus(status: string) {
  if (status === "published" || status === "draft_created" || status === "committed") {
    return "success";
  }
  if (status === "publish_ready" || status === "draft_ready" || status === "validated") {
    return "info";
  }
  if (status === "publish_ack_required" || status === "partial_commit" || status === "uploaded") {
    return "warning";
  }
  return "critical";
}

function issueCountForRow(row: CentralJobImportRowReview) {
  return row.validation_errors.length + row.validation_warnings.length + (row.duplicate_result?.matching_records.length ?? 0);
}

function formatSummaryCount(label: string, value: number) {
  return (
    <div className="job-intake-import__summary-stat" key={label}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ExceptionRowCard({ row }: { row: CentralJobImportRowReview }) {
  const errorMessages = summarizeIssueMessages(row.validation_errors);
  const warningMessages = summarizeIssueMessages(row.validation_warnings);
  const duplicateMessages =
    row.duplicate_result?.matching_records.map((match) =>
      `${match.match_source === "import_row" ? "Import row" : match.shoot_code}: ${match.title}`
    ) ?? [];

  return (
    <article className="panel job-intake-import__row-card">
      <div className="job-intake-import__row-card-header">
        <div>
          <strong>
            Row {row.row_number}: {row.summary.title}
          </strong>
          <div className="muted">
            {row.summary.organization_name ?? "Unknown organization"}
            {row.summary.start_date ? ` | ${row.summary.start_date}` : ""}
            {row.summary.department_subtype ? ` | ${row.summary.department_subtype}` : ""}
          </div>
        </div>
        <span className={`job-intake-import__status-pill job-intake-import__status-pill--${toneForRowStatus(row.status)}`}>
          {labelForRowStatus(row.status)}
        </span>
      </div>
      <div className="job-intake-import__row-grid">
        <div>
          <div className="job-intake-import__row-label">Can still become a draft</div>
          <div>{row.can_create_draft ? "Yes" : "No"}</div>
        </div>
        <div>
          <div className="job-intake-import__row-label">Publish state</div>
          <div>
            {row.can_publish ? "Ready to publish" : row.can_publish_with_acknowledgement ? "Publish with acknowledgement" : "Not publishable yet"}
          </div>
        </div>
        <div>
          <div className="job-intake-import__row-label">Issues</div>
          <div>{issueCountForRow(row)}</div>
        </div>
      </div>
      {errorMessages.length ? (
        <div className="job-intake-import__issue-block job-intake-import__issue-block--error">
          <strong>Validation errors</strong>
          <ul>
            {errorMessages.map((message) => (
              <li key={`${row.id}-error-${message}`}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {warningMessages.length ? (
        <div className="job-intake-import__issue-block job-intake-import__issue-block--warning">
          <strong>Warnings</strong>
          <ul>
            {warningMessages.map((message) => (
              <li key={`${row.id}-warning-${message}`}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {duplicateMessages.length ? (
        <div className="job-intake-import__issue-block job-intake-import__issue-block--warning">
          <strong>Duplicate review</strong>
          <ul>
            {duplicateMessages.map((message) => (
              <li key={`${row.id}-duplicate-${message}`}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

export function CentralJobImportPage({
  token,
  currentUser,
  department,
  contextLabel,
  routeHash,
  returnHash
}: Props) {
  const canCreate = canCreateShootRecords(currentUser);
  const canBatchPublish = hasAuthorityTier(currentUser, [...PUBLISH_TIERS]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [session, setSession] = useState<CentralJobImportSessionResponse | null>(null);
  const [mappingDraft, setMappingDraft] = useState<CentralJobImportColumnMapping>({});
  const [busyState, setBusyState] = useState<BusyState>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [commitMode, setCommitMode] = useState<CentralJobImportCommitMode>("create_drafts_only");
  const [acknowledgeSoftDuplicates, setAcknowledgeSoftDuplicates] = useState(false);
  const [overrideHardDuplicates, setOverrideHardDuplicates] = useState(false);
  const [duplicateOverrideNote, setDuplicateOverrideNote] = useState("");

  useEffect(() => {
    if (!featureFlags.centralJobIntakeV1) {
      return;
    }
    const sessionId = getImportSessionIdFromHash();
    if (!sessionId) {
      return;
    }
    let cancelled = false;
    setBusyState("loading_session");
    setError("");
    void getCentralJobImportSession(token, sessionId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setSession(response);
        setMappingDraft(response.mapping);
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "We couldn't reopen that import session.");
      })
      .finally(() => {
        if (!cancelled) {
          setBusyState(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const fieldGroups = useMemo(() => groupFieldsBySection(session), [session]);
  const unmappedRequiredFields = useMemo(
    () => (session?.supported_fields ?? []).filter((field) => field.required_for_publish && !mappingDraft[field.key]),
    [mappingDraft, session]
  );
  const exceptionRows = useMemo(
    () =>
      (session?.rows ?? []).filter(
        (row) =>
          SESSION_EXCEPTION_STATUSES.has(row.status) ||
          row.validation_errors.length > 0 ||
          Boolean(row.duplicate_result?.hard_block || row.duplicate_result?.soft_warning)
      ),
    [session]
  );
  const validRows = useMemo(
    () => (session?.rows ?? []).filter((row) => !exceptionRows.some((exception) => exception.id === row.id)),
    [exceptionRows, session]
  );
  const stepIndex = session == null ? 0 : session.session.status === "uploaded" ? 1 : SESSION_SUCCESS_STATUSES.has(session.session.status) ? 4 : 3;
  const commitDisabled =
    busyState === "committing" ||
    !session ||
    session.session.status === "uploaded" ||
    (commitMode !== "create_drafts_only" && !canBatchPublish) ||
    (commitMode === "publish_all_valid_rows_with_acknowledgement" &&
      session.summary.soft_duplicate_rows > 0 &&
      !acknowledgeSoftDuplicates) ||
    (overrideHardDuplicates && !duplicateOverrideNote.trim());
  const commitDisabledMessage =
    !session || session.session.status === "uploaded"
      ? "Validate the current mapping before committing rows."
      : commitMode !== "create_drafts_only" && !canBatchPublish
        ? "Only leads and admins can batch publish imported rows. Standard users can still create drafts."
        : commitMode === "publish_all_valid_rows_with_acknowledgement" &&
            session.summary.soft_duplicate_rows > 0 &&
            !acknowledgeSoftDuplicates
          ? "Acknowledge the soft duplicate warnings before using the publish-with-acknowledgement mode."
          : overrideHardDuplicates && !duplicateOverrideNote.trim()
            ? "Add a duplicate override note before forcing hard-duplicate rows through import publish."
            : null;

  async function handleUpload() {
    if (!selectedFile) {
      setError("Choose a CSV file to start the import review.");
      return;
    }
    setBusyState("uploading");
    setError("");
    setNotice("");
    try {
      const csvText = await selectedFile.text();
      const response = await createCentralJobImportSession(token, {
        department,
        source_filename: selectedFile.name,
        csv_text: csvText
      });
      setSession(response);
      setMappingDraft(response.mapping);
      setCommitMode("create_drafts_only");
      setAcknowledgeSoftDuplicates(false);
      setOverrideHardDuplicates(false);
      setDuplicateOverrideNote("");
      setNotice("Import session staged. Review the auto-detected mapping, then validate rows before committing.");
      setImportSessionHash(routeHash, response.session.id);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "We couldn't stage that CSV right now.");
    } finally {
      setBusyState(null);
    }
  }

  async function handleValidate() {
    if (!session) {
      return;
    }
    setBusyState("validating");
    setError("");
    setNotice("");
    try {
      const filteredMapping = Object.fromEntries(
        Object.entries(mappingDraft).filter(([, header]) => typeof header === "string" && header.trim().length > 0)
      ) as CentralJobImportColumnMapping;
      const response = await updateCentralJobImportMapping(token, session.session.id, { mapping: filteredMapping });
      setSession(response);
      setMappingDraft(response.mapping);
      setNotice("Validation complete. Review exceptions before committing rows.");
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "We couldn't validate the current mapping.");
    } finally {
      setBusyState(null);
    }
  }

  async function handleCommit() {
    if (!session) {
      return;
    }
    setBusyState("committing");
    setError("");
    setNotice("");
    try {
      const result = await commitCentralJobImportSession(token, session.session.id, {
        mode: commitMode,
        acknowledge_soft_duplicates: acknowledgeSoftDuplicates,
        override_hard_duplicates: overrideHardDuplicates,
        duplicate_override_note: duplicateOverrideNote.trim() || null
      });
      const refreshed = await getCentralJobImportSession(token, result.session.id);
      setSession(refreshed);
      setNotice(
        `Commit complete. ${result.summary.drafts_created} drafts created, ${result.summary.jobs_published} jobs published, ${result.summary.exception_rows} rows still need review.`
      );
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : "We couldn't commit that import session.");
    } finally {
      setBusyState(null);
    }
  }

  function handleReset() {
    setSelectedFile(null);
    setSession(null);
    setMappingDraft({});
    setBusyState(null);
    setError("");
    setNotice("");
    setCommitMode("create_drafts_only");
    setAcknowledgeSoftDuplicates(false);
    setOverrideHardDuplicates(false);
    setDuplicateOverrideNote("");
    setImportSessionHash(routeHash, null);
  }

  if (!featureFlags.centralJobIntakeV1) {
    return (
      <div className="workspace-shell">
        <WorkspaceEmptyState
          title="Central job intake is not enabled"
          summary="Bulk import stays hidden until the central intake feature flag is turned on for this environment."
          actions={
            <button type="button" className="secondary-button" onClick={() => { window.location.hash = returnHash; }}>
              Back
            </button>
          }
        />
      </div>
    );
  }

  if (!canCreate) {
    return (
      <div className="workspace-shell">
        <WorkspaceEmptyState
          title="You don't have access to import jobs"
          summary="Bulk import uses the same canonical shoot-create permission as Quick Create and Smart Paste."
          actions={
            <button type="button" className="secondary-button" onClick={() => { window.location.hash = returnHash; }}>
              Back
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="workspace-shell job-intake-import-page">
      <WorkspacePageHeader
        eyebrow={contextLabel}
        title="Bulk Job Import"
        summary={`Upload a CSV, map source columns into canonical intake fields, validate row-by-row, and commit with exceptions isolated instead of forcing the whole batch through.`}
        meta={[
          { label: department === "schools" ? "Schools default" : "Sports default", tone: "info" },
          { label: "Safe default: drafts only", tone: "warning" },
          ...(session ? [{ label: `${session.summary.total_rows} rows`, tone: "neutral" as const }] : [])
        ]}
        actions={
          <WorkspaceActionBar align="end" compact>
            <button type="button" className="secondary-button" onClick={() => { window.location.hash = returnHash; }}>
              Back
            </button>
            {session ? (
              <button type="button" className="secondary-button" onClick={handleReset}>
                Start New Import
              </button>
            ) : null}
          </WorkspaceActionBar>
        }
        compact
      />

      <section className="panel job-intake-import__step-strip" aria-label="Import steps">
        {["Upload", "Map Columns", "Validate", "Review Exceptions", "Commit"].map((label, index) => (
          <div
            key={label}
            className={`job-intake-import__step${index === stepIndex ? " is-active" : ""}${index < stepIndex ? " is-complete" : ""}`}
          >
            <span>{index + 1}</span>
            <strong>{label}</strong>
          </div>
        ))}
      </section>

      {error ? <div className="feedback-strip feedback-strip--critical">{error}</div> : null}
      {notice ? <div className="feedback-strip feedback-strip--info">{notice}</div> : null}

      {busyState === "loading_session" ? (
        <WorkspaceLoadingBlock title="Opening import session" summary="Loading the staged rows, mapping, and review state." />
      ) : null}

      {!session ? (
        <section className="panel job-intake-import__upload-panel">
          <WorkspaceSectionHeader
            title="Upload CSV"
            summary="CSV is required in Phase 6. Each row will be traced through mapping, validation, exceptions, and commit status."
          />
          <div className="job-intake-import__upload-grid">
            <label className="filter-field filter-field--wide">
              <span>CSV file</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <div className="job-intake-import__upload-help">
              <strong>Accepted columns can be mapped later.</strong>
              <p>Required row values for publish can stay unresolved during draft review. The commit default is always Create Drafts Only.</p>
            </div>
          </div>
          <WorkspaceActionBar align="end">
            <button type="button" className="secondary-button" onClick={() => { window.location.hash = returnHash; }}>
              Cancel
            </button>
            <button type="button" onClick={() => void handleUpload()} disabled={!selectedFile || busyState === "uploading"}>
              {busyState === "uploading" ? "Uploading..." : "Start Import Review"}
            </button>
          </WorkspaceActionBar>
        </section>
      ) : (
        <>
          <section className="panel job-intake-import__summary-panel">
            <WorkspaceSectionHeader
              title="Import Summary"
              summary={`${session.session.source_filename} is staged. Review mapping, validate rows, and keep exceptions separate from rows that can safely commit.`}
              badge={<span className={`job-intake-import__status-pill job-intake-import__status-pill--${toneForRowStatus(session.session.status)}`}>{labelForRowStatus(session.session.status)}</span>}
            />
            <div className="job-intake-import__summary-grid">
              {formatSummaryCount("Rows", session.summary.total_rows)}
              {formatSummaryCount("Draft-ready", session.summary.draft_ready_rows)}
              {formatSummaryCount("Publish-ready", session.summary.publish_ready_rows)}
              {formatSummaryCount("Exceptions", session.summary.exception_rows)}
              {formatSummaryCount("Hard duplicates", session.summary.hard_duplicate_rows)}
              {formatSummaryCount("Soft warnings", session.summary.soft_duplicate_rows)}
            </div>
          </section>

          <section className="panel job-intake-import__mapping-panel">
            <WorkspaceSectionHeader
              title="Map Columns"
              summary="Map source headers into the canonical intake fields. Unmapped publish-required fields are called out here before validation."
            />
            {unmappedRequiredFields.length ? (
              <div className="job-intake-import__unmapped-warning" role="alert">
                <strong>Unmapped publish-required fields:</strong>{" "}
                {unmappedRequiredFields.map((field) => field.label).join(", ")}
              </div>
            ) : null}
            <div className="job-intake-import__mapping-sections">
              {fieldGroups.map((group) => (
                <section key={group.section} className="job-intake-import__mapping-group">
                  <h3>{group.section}</h3>
                  <div className="job-intake-import__mapping-grid">
                    {group.fields.map((field) => (
                      <label
                        key={field.key}
                        className={`filter-field filter-field--wide${field.required_for_publish && !mappingDraft[field.key] ? " job-intake-import__mapping-field--required" : ""}`}
                      >
                        <span>
                          {field.label}
                          {field.required_for_publish ? <span className="job-intake__required"> *</span> : null}
                        </span>
                        <select
                          value={mappingDraft[field.key] ?? ""}
                          onChange={(event) =>
                            setMappingDraft((current) => ({
                              ...current,
                              [field.key]: event.target.value || null
                            }))
                          }
                        >
                          <option value="">Not mapped</option>
                          {session.headers.map((header) => (
                            <option key={`${field.key}-${header}`} value={header}>
                              {header}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <WorkspaceActionBar align="end">
              <button type="button" className="secondary-button" onClick={handleReset}>
                Replace File
              </button>
              <button type="button" onClick={() => void handleValidate()} disabled={busyState === "validating"}>
                {busyState === "validating" ? "Validating..." : "Validate Rows"}
              </button>
            </WorkspaceActionBar>
          </section>

          <section className="panel job-intake-import__review-panel">
            <WorkspaceSectionHeader
              title="Review Exceptions"
              summary="Rows with validation failures, unresolved matches, or duplicate pressure stay isolated here. Fix the source CSV and re-upload if row-level editing is too heavy."
              badge={<span className="job-intake-import__badge">{exceptionRows.length} exception{exceptionRows.length === 1 ? "" : "s"}</span>}
            />
            {session.session.status === "uploaded" ? (
              <WorkspaceEmptyState
                compact
                title="Validate the staged rows first"
                summary="The exception table fills in after the current mapping is validated."
              />
            ) : exceptionRows.length ? (
              <div className="job-intake-import__row-stack">
                {exceptionRows.map((row) => (
                  <ExceptionRowCard key={row.id} row={row} />
                ))}
              </div>
            ) : (
              <WorkspaceEmptyState
                compact
                title="No exception rows"
                summary="This batch currently clears validation and duplicate review for the selected commit modes."
              />
            )}
            {validRows.length ? (
              <div className="job-intake-import__valid-summary">
                <strong>{validRows.length} row{validRows.length === 1 ? "" : "s"} currently clear exception review.</strong>
                <span>Those rows can move forward according to the commit mode you choose below.</span>
              </div>
            ) : null}
          </section>

          <section className="panel job-intake-import__commit-panel">
            <WorkspaceSectionHeader
              title="Commit"
              summary="Create drafts by default. Leads and admins can publish rows that clear validation and duplicate rules without letting one bad row poison the whole batch."
            />
            <div className="job-intake-import__commit-options" role="radiogroup" aria-label="Commit mode">
              {COMMIT_MODE_OPTIONS.map((option) => {
                const disabled = option.value !== "create_drafts_only" && !canBatchPublish;
                return (
                  <label key={option.value} className={`job-intake-import__commit-option${commitMode === option.value ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}>
                    <input
                      type="radio"
                      name="import-commit-mode"
                      value={option.value}
                      checked={commitMode === option.value}
                      disabled={disabled}
                      onChange={() => setCommitMode(option.value)}
                    />
                    <div>
                      <strong>{option.label}</strong>
                      <p>{option.description}</p>
                    </div>
                  </label>
                );
              })}
            </div>
            {!canBatchPublish ? (
              <div className="job-intake-import__commit-note">
                You can stage and create drafts from import, but only leads and admins can batch publish rows.
              </div>
            ) : null}
            {commitMode === "publish_all_valid_rows_with_acknowledgement" && session.summary.soft_duplicate_rows > 0 ? (
              <label className="job-intake-import__toggle">
                <input
                  type="checkbox"
                  checked={acknowledgeSoftDuplicates}
                  onChange={(event) => setAcknowledgeSoftDuplicates(event.target.checked)}
                />
                <span>Acknowledge soft duplicate warnings for rows that are otherwise publishable.</span>
              </label>
            ) : null}
            {canBatchPublish && session.summary.hard_duplicate_rows > 0 ? (
              <div className="job-intake-import__override-block">
                <label className="job-intake-import__toggle">
                  <input
                    type="checkbox"
                    checked={overrideHardDuplicates}
                    onChange={(event) => setOverrideHardDuplicates(event.target.checked)}
                  />
                  <span>Allow hard duplicate override for rows leadership explicitly wants to force through.</span>
                </label>
                {overrideHardDuplicates ? (
                  <label className="filter-field filter-field--wide">
                    <span>Duplicate override note</span>
                    <textarea
                      rows={3}
                      value={duplicateOverrideNote}
                      onChange={(event) => setDuplicateOverrideNote(event.target.value)}
                      placeholder="Explain why these rows are intentionally being forced through."
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
            {commitDisabledMessage ? <div className="job-intake-import__commit-gate">{commitDisabledMessage}</div> : null}
            <WorkspaceActionBar align="end">
              <button type="button" className="secondary-button" onClick={handleReset}>
                Start Over
              </button>
              <button type="button" onClick={() => void handleCommit()} disabled={commitDisabled}>
                {busyState === "committing" ? "Committing..." : "Commit Import"}
              </button>
            </WorkspaceActionBar>
          </section>
        </>
      )}
    </div>
  );
}
