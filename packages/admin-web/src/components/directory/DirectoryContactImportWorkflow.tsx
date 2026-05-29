import { useEffect, useMemo, useState } from "react";
import {
  applyContactImportSessionRecord,
  createContactImportSessionRecord,
  getContactImportSessionRecord,
  listContactImportSessionsRecord,
  listDirectoryContacts,
  listOrganizations,
  updateContactImportRowRecord,
  type DirectoryContactImportRowUpdateInput
} from "../../services/organizationApi";
import type {
  DirectoryContactSummary,
  DirectoryImportCandidateMatch,
  DirectoryImportRowAction,
  DirectoryImportRowRecord,
  DirectoryImportSessionListItem,
  DirectoryImportSessionRecord,
  DirectoryImportSessionSummary,
  OrganizationSummary
} from "../../types";
import { formatDateLabel, labelForRelationshipRole } from "./directoryOptions";

type Props = {
  token: string;
  organizations: OrganizationSummary[];
  initialDefaultOrganizationId?: string | null;
  onApplied?: (session: DirectoryImportSessionRecord) => Promise<void> | void;
  onCancel: () => void;
};

type ContactOption = {
  id: string;
  label: string;
  detail: string | null;
};

export function DirectoryContactImportWorkflow({
  token,
  organizations,
  initialDefaultOrganizationId,
  onApplied,
  onCancel
}: Props) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [defaultOrganizationId, setDefaultOrganizationId] = useState(initialDefaultOrganizationId ?? "");
  const [session, setSession] = useState<DirectoryImportSessionRecord | null>(null);
  const [recentSessions, setRecentSessions] = useState<DirectoryImportSessionListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [busyState, setBusyState] = useState<"staging" | "applying" | "loading_session" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    void listContactImportSessionsRecord(token)
      .then((payload) => {
        if (!cancelled) {
          setRecentSessions(payload.sessions);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecentSessions([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const readyRowCount = (session?.summary.ready_to_create ?? 0) + (session?.summary.ready_to_link ?? 0);

  async function refreshSessionHistory() {
    const payload = await listContactImportSessionsRecord(token);
    setRecentSessions(payload.sessions);
  }

  async function handlePreview() {
    if (!selectedFile) {
      setError("Choose a CSV file to preview.");
      return;
    }
    setBusyState("staging");
    setError("");
    setNotice("");
    try {
      const csvText = await selectedFile.text();
      const nextSession = await createContactImportSessionRecord(token, {
        source_file_name: selectedFile.name,
        csv_text: csvText,
        default_organization_id: defaultOrganizationId || null,
        has_header_row: true
      });
      setSession(nextSession);
      await refreshSessionHistory();
      setNotice("Preview ready. Review duplicate warnings, unresolved organizations, and row decisions before importing.");
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "We couldn't preview that CSV right now.");
    } finally {
      setBusyState(null);
    }
  }

  async function handleApply() {
    if (!session) {
      return;
    }
    setBusyState("applying");
    setError("");
    setNotice("");
    try {
      const nextSession = await applyContactImportSessionRecord(token, session.id);
      setSession(nextSession);
      await refreshSessionHistory();
      await onApplied?.(nextSession);
      setNotice("Import Summary updated. Ready rows were applied and review rows stayed staged.");
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "We couldn't apply that import right now.");
    } finally {
      setBusyState(null);
    }
  }

  async function handleRowSave(rowId: string, input: DirectoryContactImportRowUpdateInput) {
    if (!session) {
      return;
    }
    setError("");
    setNotice("");
    try {
      const nextSession = await updateContactImportRowRecord(token, session.id, rowId, input);
      setSession(nextSession);
      await refreshSessionHistory();
      setNotice("Row review saved.");
    } catch (rowError) {
      setError(rowError instanceof Error ? rowError.message : "We couldn't save that row review.");
    }
  }

  async function handleOpenSession(sessionId: string) {
    setBusyState("loading_session");
    setError("");
    setNotice("");
    try {
      const nextSession = await getContactImportSessionRecord(token, sessionId);
      setSession(nextSession);
      setNotice("Staged import reopened. You can keep reviewing rows before applying.");
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : "We couldn't reopen that import session.");
    } finally {
      setBusyState(null);
    }
  }

  return (
    <div className="directory-import-workflow">
      {!session ? (
        <>
          <section className="request-card">
            <div className="directory-card__header">
              <div>
                <strong>Import Contacts</strong>
                <div className="muted">
                  Upload a CSV with a header row, preview what will be created or linked, and keep ambiguous duplicates in human review.
                </div>
              </div>
            </div>
            <div className="directory-form__grid">
              <label className="directory-field directory-field--wide">
                <span>CSV file</span>
                <input
                  aria-label="Choose CSV file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <label className="directory-field directory-field--wide">
                <span>Default organization</span>
                <select value={defaultOrganizationId} onChange={(event) => setDefaultOrganizationId(event.target.value)}>
                  <option value="">Use organization names from the CSV</option>
                  {organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.display_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="directory-import-supported-fields">
              <strong>Supported columns</strong>
              <div className="directory-chip-row">
                {[
                  "First name",
                  "Last name",
                  "Title",
                  "Email",
                  "Phone",
                  "Organization name",
                  "Relationship role",
                  "Start date",
                  "End date",
                  "Current flag"
                ].map((label) => (
                  <span key={label} className="meta-pill">
                    {label}
                  </span>
                ))}
              </div>
            </div>
            {error ? <p className="directory-form__error">{error}</p> : null}
            <div className="directory-form__actions">
              <button type="button" className="secondary-button" onClick={onCancel}>
                Cancel
              </button>
              <button type="button" onClick={() => void handlePreview()} disabled={!selectedFile || busyState === "staging"}>
                {busyState === "staging" ? "Previewing..." : "Preview import"}
              </button>
            </div>
          </section>

          <RecentImportSessionsSection
            sessions={recentSessions}
            organizations={organizations}
            loading={historyLoading}
            busy={busyState === "loading_session"}
            onOpenSession={(sessionId) => void handleOpenSession(sessionId)}
          />
        </>
      ) : (
        <>
          <section className="request-card">
            <div className="directory-card__header">
              <div>
                <strong>Import Summary</strong>
                <div className="muted">
                  {session.source_file_name} | {labelForImportSessionStatus(session.status)}
                </div>
              </div>
              <div className="directory-chip-row">
                <span className="meta-pill">{session.rows.length} rows</span>
                {session.default_organization_id ? (
                  <span className="meta-pill">
                    Default: {organizations.find((organization) => organization.id === session.default_organization_id)?.display_name ?? "Selected organization"}
                  </span>
                ) : null}
              </div>
            </div>
            <ImportSummaryGrid summary={session.summary} />
            <div className="directory-import-supported-fields">
              <strong>Column mapping</strong>
              <div className="directory-chip-row">
                {Object.entries(session.mapping)
                  .filter(([, value]) => Boolean(value))
                  .map(([columnKey, headerLabel]) => (
                    <span key={columnKey} className="meta-pill">
                      {labelForImportColumn(columnKey)}: {headerLabel}
                    </span>
                  ))}
              </div>
            </div>
            {notice ? <div className="feedback-strip feedback-strip--info">{notice}</div> : null}
            {error ? <p className="directory-form__error">{error}</p> : null}
            <div className="directory-form__actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setSession(null);
                  setSelectedFile(null);
                  setError("");
                  setNotice("");
                }}
              >
                Review another import
              </button>
              <button type="button" className="secondary-button" onClick={onCancel}>
                Close
              </button>
              <button type="button" onClick={() => void handleApply()} disabled={busyState === "applying" || readyRowCount === 0}>
                {busyState === "applying" ? "Importing..." : "Import contacts"}
              </button>
            </div>
          </section>

          <RecentImportSessionsSection
            sessions={recentSessions}
            organizations={organizations}
            loading={historyLoading}
            busy={busyState === "loading_session"}
            activeSessionId={session.id}
            onOpenSession={(sessionId) => void handleOpenSession(sessionId)}
          />

          <section className="directory-section-stack">
            {session.rows.map((row) => (
              <ContactImportRowCard
                key={row.id}
                token={token}
                row={row}
                organizations={organizations}
                onSave={handleRowSave}
              />
            ))}
          </section>
        </>
      )}
    </div>
  );
}

type ContactImportRowCardProps = {
  token: string;
  row: DirectoryImportRowRecord;
  organizations: OrganizationSummary[];
  onSave: (rowId: string, input: DirectoryContactImportRowUpdateInput) => Promise<void>;
};

function ContactImportRowCard({ token, row, organizations, onSave }: ContactImportRowCardProps) {
  const [selectedAction, setSelectedAction] = useState<DirectoryImportRowAction>(row.selected_action ?? row.proposed_action);
  const [selectedContactId, setSelectedContactId] = useState(
    row.selected_contact_id ?? (row.candidate_matches.length === 1 ? row.candidate_matches[0].contact_id : "")
  );
  const [resolvedOrganizationId, setResolvedOrganizationId] = useState(row.resolved_organization_id ?? "");
  const [reviewNote, setReviewNote] = useState(row.review_note ?? "");
  const [contactSearch, setContactSearch] = useState(buildImportRowLabel(row));
  const [contactResults, setContactResults] = useState<DirectoryContactSummary[]>([]);
  const [organizationSearch, setOrganizationSearch] = useState(
    row.normalized_values.organization_name ?? row.normalized_values.resolved_organization_name ?? ""
  );
  const [organizationResults, setOrganizationResults] = useState<OrganizationSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [contactSearchBusy, setContactSearchBusy] = useState(false);
  const [contactSearchError, setContactSearchError] = useState("");
  const [organizationSearchBusy, setOrganizationSearchBusy] = useState(false);
  const [organizationSearchError, setOrganizationSearchError] = useState("");

  useEffect(() => {
    setSelectedAction(row.selected_action ?? row.proposed_action);
    setSelectedContactId(row.selected_contact_id ?? (row.candidate_matches.length === 1 ? row.candidate_matches[0].contact_id : ""));
    setResolvedOrganizationId(row.resolved_organization_id ?? "");
    setReviewNote(row.review_note ?? "");
    setContactSearch(buildImportRowLabel(row));
    setContactResults([]);
    setOrganizationSearch(row.normalized_values.organization_name ?? row.normalized_values.resolved_organization_name ?? "");
    setOrganizationResults([]);
    setError("");
    setContactSearchError("");
    setOrganizationSearchError("");
  }, [row]);

  const duplicateReviewNeeded = row.status === "needs_review" && row.candidate_matches.length > 1;
  const reviewNoteRequired = selectedAction === "create_contact" && row.candidate_matches.length > 0;
  const organizationRequired = selectedAction !== "skip" && !resolvedOrganizationId && Boolean(row.normalized_values.organization_name);
  const contactOptions = useMemo(() => mergeContactOptions(row.candidate_matches, contactResults), [contactResults, row.candidate_matches]);
  const organizationOptions = useMemo(() => mergeOrganizationOptions(organizations, organizationResults), [organizationResults, organizations]);

  async function handleSearchContacts() {
    if (!contactSearch.trim()) {
      setContactSearchError("Enter a name, email, or phone fragment before searching.");
      return;
    }
    setContactSearchBusy(true);
    setContactSearchError("");
    try {
      const payload = await listDirectoryContacts(token, { search: contactSearch.trim(), activeStatus: "active" });
      setContactResults(payload.contacts);
    } catch (searchError) {
      setContactSearchError(searchError instanceof Error ? searchError.message : "We couldn't search existing contacts right now.");
    } finally {
      setContactSearchBusy(false);
    }
  }

  async function handleSearchOrganizations() {
    if (!organizationSearch.trim()) {
      setOrganizationSearchError("Enter an organization name before searching.");
      return;
    }
    setOrganizationSearchBusy(true);
    setOrganizationSearchError("");
    try {
      const payload = await listOrganizations(token, { search: organizationSearch.trim(), activeStatus: "active" });
      setOrganizationResults(payload.organizations);
    } catch (searchError) {
      setOrganizationSearchError(searchError instanceof Error ? searchError.message : "We couldn't search organizations right now.");
    } finally {
      setOrganizationSearchBusy(false);
    }
  }

  async function handleSave() {
    if (selectedAction === "link_existing" && !selectedContactId) {
      setError("Choose an existing contact to link.");
      return;
    }
    if (reviewNoteRequired && !reviewNote.trim()) {
      setError("Add a short review note before forcing a new contact when duplicate candidates exist.");
      return;
    }
    if (organizationRequired) {
      setError("Choose an organization or skip the row until the account is resolved.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(row.id, {
        selected_action: selectedAction,
        selected_contact_id: selectedAction === "link_existing" ? selectedContactId || null : null,
        resolved_organization_id: resolvedOrganizationId || row.resolved_organization_id || null,
        review_note: reviewNote.trim() || null
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "We couldn't save that row decision.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="request-card directory-import-row">
      <div className="directory-import-row__header">
        <div>
          <strong>
            Row {row.row_number}: {buildImportRowLabel(row)}
          </strong>
          <div className="muted">
            {row.normalized_values.organization_name || row.normalized_values.resolved_organization_name || "No organization found"} |{" "}
            {labelForRelationshipRole(row.normalized_values.relationship_role)}
          </div>
        </div>
        <div className="directory-chip-row">
          <span className={`meta-pill directory-import-pill directory-import-pill--${row.status}`}>{labelForImportRowStatus(row.status)}</span>
          <span className="meta-pill">{labelForImportAction(row.selected_action ?? row.proposed_action)}</span>
          {row.normalized_values.is_current ? <span className="meta-pill">Current relationship</span> : <span className="meta-pill">Previous relationship</span>}
        </div>
      </div>

      <div className="directory-import-row__meta">
        <span>{row.normalized_values.email || row.normalized_values.phone || "No direct contact method in this row"}</span>
        <span>{formatRelationshipWindow(row)}</span>
      </div>

      {duplicateReviewNeeded ? (
        <div className="feedback-strip feedback-strip--danger">
          <strong>Duplicate Review Needed</strong>
          <div>This row matched more than one person closely enough to need a human decision before import.</div>
        </div>
      ) : null}

      {organizationRequired ? (
        <div className="feedback-strip feedback-strip--warning">
          <div className="feedback-strip__content">
            <strong>Organization resolution needed</strong>
            <div>Choose an existing organization before this row can be created or linked. The importer will not create new organizations from CSV names.</div>
          </div>
        </div>
      ) : null}

      {row.validation_errors.length ? (
        <div className="directory-import-row__issues">
          {row.validation_errors.map((issue) => (
            <div key={issue} className="directory-import-row__issue directory-import-row__issue--error">
              {issue}
            </div>
          ))}
        </div>
      ) : null}

      {row.warning_messages.length ? (
        <div className="directory-import-row__issues">
          {row.warning_messages.map((warning) => (
            <div key={warning} className="directory-import-row__issue directory-import-row__issue--warning">
              {warning}
            </div>
          ))}
        </div>
      ) : null}

      {row.candidate_matches.length ? (
        <div className="directory-import-match-list">
          {row.candidate_matches.map((candidate) => (
            <ImportCandidateCard key={candidate.contact_id} candidate={candidate} />
          ))}
        </div>
      ) : null}

      {row.status === "applied" ? (
        <div className="feedback-strip feedback-strip--success">{row.result_summary || "This row has already been applied."}</div>
      ) : (
        <div className="directory-form">
          <div className="directory-form__grid">
            <label className="directory-field">
              <span>Row decision</span>
              <select value={selectedAction} onChange={(event) => setSelectedAction(event.target.value as DirectoryImportRowAction)}>
                <option value="create_contact">Create new contact</option>
                <option value="link_existing">Link to existing contact</option>
                <option value="needs_review">Hold for review</option>
                <option value="skip">Skip row</option>
              </select>
            </label>

            {selectedAction === "link_existing" ? (
              <>
                <label className="directory-field directory-field--wide">
                  <span>Search existing contacts</span>
                  <div className="directory-inline-search">
                    <input value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Name, email, or phone" />
                    <button type="button" className="secondary-button" onClick={() => void handleSearchContacts()} disabled={contactSearchBusy}>
                      {contactSearchBusy ? "Searching..." : "Search"}
                    </button>
                  </div>
                  {contactSearchError ? <span className="directory-form__error">{contactSearchError}</span> : null}
                </label>
                <label className="directory-field directory-field--wide">
                  <span>Existing contact</span>
                  <select value={selectedContactId} onChange={(event) => setSelectedContactId(event.target.value)}>
                    <option value="">Choose a matched contact</option>
                    {contactOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                        {option.detail ? ` | ${option.detail}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}

            {(row.normalized_values.organization_name || !row.resolved_organization_id || selectedAction !== "skip") && selectedAction !== "skip" ? (
              <>
                <label className="directory-field directory-field--wide">
                  <span>Resolve organization</span>
                  <div className="directory-inline-search">
                    <input
                      value={organizationSearch}
                      onChange={(event) => setOrganizationSearch(event.target.value)}
                      placeholder="Search schools, leagues, districts, or accounts"
                    />
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void handleSearchOrganizations()}
                      disabled={organizationSearchBusy}
                    >
                      {organizationSearchBusy ? "Searching..." : "Search"}
                    </button>
                  </div>
                  {organizationSearchError ? <span className="directory-form__error">{organizationSearchError}</span> : null}
                </label>
                <label className="directory-field directory-field--wide">
                  <span>Organization</span>
                  <select value={resolvedOrganizationId} onChange={(event) => setResolvedOrganizationId(event.target.value)}>
                    <option value="">Choose an organization</option>
                    {organizationOptions.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.display_name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}

            <label className="directory-field directory-field--wide">
              <span>Review note</span>
              <textarea
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
                rows={2}
                placeholder="Why this row should be skipped, linked, or created"
              />
            </label>
          </div>
          {error ? <p className="directory-form__error">{error}</p> : null}
          <div className="directory-form__actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setSelectedAction(row.selected_action ?? row.proposed_action);
                setSelectedContactId(row.selected_contact_id ?? (row.candidate_matches.length === 1 ? row.candidate_matches[0].contact_id : ""));
                setResolvedOrganizationId(row.resolved_organization_id ?? "");
                setReviewNote(row.review_note ?? "");
                setContactResults([]);
                setOrganizationResults([]);
                setError("");
              }}
            >
              Reset row
            </button>
            <button type="button" onClick={() => void handleSave()} disabled={busy}>
              {busy ? "Saving..." : "Save row decision"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function RecentImportSessionsSection({
  sessions,
  organizations,
  loading,
  busy,
  activeSessionId,
  onOpenSession
}: {
  sessions: DirectoryImportSessionListItem[];
  organizations: OrganizationSummary[];
  loading: boolean;
  busy: boolean;
  activeSessionId?: string | null;
  onOpenSession: (sessionId: string) => void;
}) {
  if (!loading && !sessions.length) {
    return null;
  }

  return (
    <section className="request-card">
      <div className="directory-card__header">
        <div>
          <strong>Recent Imports</strong>
          <div className="muted">Reopen staged work, review partially applied sessions, and keep the import trail visible.</div>
        </div>
      </div>
      {loading ? (
        <div className="empty-state empty-state--panel">Loading recent imports...</div>
      ) : (
        <div className="directory-import-session-list">
          {sessions.map((session) => (
            <article key={session.id} className="directory-import-session-card">
              <div className="directory-card__header">
                <div>
                  <strong>{session.source_file_name}</strong>
                  <div className="muted">
                    {labelForImportSessionStatus(session.status)} | {formatDateLabel(session.updated_at.slice(0, 10))}
                  </div>
                </div>
                <div className="directory-chip-row">
                  <span className="meta-pill">{session.summary.total_rows} rows</span>
                  {session.default_organization_id ? (
                    <span className="meta-pill">
                      {organizations.find((organization) => organization.id === session.default_organization_id)?.display_name ?? "Linked organization"}
                    </span>
                  ) : null}
                </div>
              </div>
              <ImportSummaryGrid summary={session.summary} compact />
              <div className="directory-form__actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onOpenSession(session.id)}
                  disabled={busy || activeSessionId === session.id}
                >
                  {activeSessionId === session.id ? "Open now" : session.status === "applied" ? "Open summary" : "Open staged review"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ImportSummaryGrid({
  summary,
  compact = false
}: {
  summary: DirectoryImportSessionSummary;
  compact?: boolean;
}) {
  return (
    <div className={`directory-import-summary-grid${compact ? " directory-import-summary-grid--compact" : ""}`}>
      <ImportSummaryCard label="Ready to create" value={summary.ready_to_create} />
      <ImportSummaryCard label="Ready to link" value={summary.ready_to_link} />
      <ImportSummaryCard label="Needs review" value={summary.needs_review} tone="warning" />
      <ImportSummaryCard label="Skipped" value={summary.skipped} />
      <ImportSummaryCard label="Invalid" value={summary.invalid} tone="danger" />
      <ImportSummaryCard label="Applied" value={summary.applied} tone="good" />
    </div>
  );
}

function ImportSummaryCard({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: number;
  tone?: "neutral" | "warning" | "danger" | "good";
}) {
  return (
    <article className={`directory-import-summary-card directory-import-summary-card--${tone}`}>
      <span className="directory-import-summary-card__label">{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ImportCandidateCard({ candidate }: { candidate: DirectoryImportCandidateMatch }) {
  return (
    <article className="directory-import-match">
      <div className="directory-card__header">
        <div>
          <strong>{candidate.full_name}</strong>
          <div className="muted">{candidate.email || candidate.phone || "No direct method on file"}</div>
        </div>
        <span className="meta-pill">{labelForMatchConfidence(candidate.confidence)}</span>
      </div>
      <div className="directory-chip-row">
        {candidate.current_organization_labels.map((label) => (
          <span key={label} className="meta-pill">
            {label}
          </span>
        ))}
      </div>
      <p className="muted">{candidate.reason}</p>
    </article>
  );
}

function buildImportRowLabel(row: DirectoryImportRowRecord) {
  const parts = [row.normalized_values.first_name, row.normalized_values.last_name].filter(Boolean);
  return parts.join(" ") || row.raw_values.full_name || "Unnamed contact row";
}

function formatRelationshipWindow(row: DirectoryImportRowRecord) {
  if (row.normalized_values.start_date && row.normalized_values.end_date) {
    return `${formatDateLabel(row.normalized_values.start_date)} to ${formatDateLabel(row.normalized_values.end_date)}`;
  }
  if (row.normalized_values.is_current && row.normalized_values.start_date) {
    return `Current since ${formatDateLabel(row.normalized_values.start_date)}`;
  }
  if (row.normalized_values.end_date) {
    return `Ended ${formatDateLabel(row.normalized_values.end_date)}`;
  }
  if (row.normalized_values.start_date) {
    return `Started ${formatDateLabel(row.normalized_values.start_date)}`;
  }
  return row.normalized_values.is_current ? "Current relationship" : "Previous relationship";
}

function mergeContactOptions(candidateMatches: DirectoryImportCandidateMatch[], searchResults: DirectoryContactSummary[]): ContactOption[] {
  const options = new Map<string, ContactOption>();
  for (const candidate of candidateMatches) {
    options.set(candidate.contact_id, {
      id: candidate.contact_id,
      label: candidate.full_name,
      detail: candidate.reason
    });
  }
  for (const contact of searchResults) {
    options.set(contact.id, {
      id: contact.id,
      label: contact.full_name,
      detail: contact.organization_display_name
    });
  }
  return [...options.values()];
}

function mergeOrganizationOptions(base: OrganizationSummary[], searchResults: OrganizationSummary[]) {
  const options = new Map<string, OrganizationSummary>();
  for (const organization of [...base, ...searchResults]) {
    options.set(organization.id, organization);
  }
  return [...options.values()];
}

function labelForImportSessionStatus(status: DirectoryImportSessionRecord["status"]) {
  switch (status) {
    case "applied":
      return "Import complete";
    case "partially_applied":
      return "Partially applied";
    case "cancelled":
      return "Cancelled";
    default:
      return "Preview staged";
  }
}

function labelForImportRowStatus(status: DirectoryImportRowRecord["status"]) {
  switch (status) {
    case "ready":
      return "Ready";
    case "needs_review":
      return "Needs review";
    case "applied":
      return "Imported";
    case "skipped":
      return "Skipped";
    case "error":
      return "Error";
    default:
      return "Staged";
  }
}

function labelForImportAction(action: DirectoryImportRowAction) {
  switch (action) {
    case "create_contact":
      return "Create new contact";
    case "link_existing":
      return "Link existing";
    case "skip":
      return "Skip row";
    default:
      return "Hold for review";
  }
}

function labelForImportColumn(columnKey: string) {
  switch (columnKey) {
    case "first_name":
      return "First name";
    case "last_name":
      return "Last name";
    case "preferred_name":
      return "Preferred name";
    case "organization_name":
      return "Organization name";
    case "organization_type":
      return "Organization type";
    case "relationship_role":
      return "Relationship role";
    case "start_date":
      return "Start date";
    case "end_date":
      return "End date";
    case "current_flag":
      return "Current flag";
    default:
      return columnKey.replace(/_/g, " ");
  }
}

function labelForMatchConfidence(confidence: DirectoryImportCandidateMatch["confidence"]) {
  switch (confidence) {
    case "exact":
      return "Exact match";
    case "strong":
      return "Strong match";
    default:
      return "Possible match";
  }
}
