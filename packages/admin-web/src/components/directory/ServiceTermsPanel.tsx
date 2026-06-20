import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../../api";
import type { SchoolServiceTermPeriodType, SchoolServiceTermRecord } from "../../types";
import {
  activateSchoolServiceTermRecord,
  createSchoolServiceTermRecord,
  listSchoolServiceTerms,
  rolloverSchoolServiceTermRecord,
  updateSchoolServiceTermRecord
} from "../../services/organizationApi";
import { formatDateLabel } from "./directoryOptions";

// Phase 4 Slice 4B — the school-year / season service term experience.
// A self-contained panel (token + organizationId, like RecordResourcesPanel) over the
// Slice 4 API: current truth, upcoming drafts (with inherited-field markers so a rolled
// over value is never mistaken for confirmed truth), and closed history. No rollover or
// term algorithm is reimplemented here — the server owns it; this surface only calls it.

type Props = {
  token: string;
  organizationId: string;
  organizationName: string;
  canManage: boolean;
};

const PERIOD_TYPE_OPTIONS: Array<{ value: SchoolServiceTermPeriodType; label: string }> = [
  { value: "school_year", label: "School Year" },
  { value: "season", label: "Season" },
  { value: "custom", label: "Custom" }
];

function labelForPeriodType(value: SchoolServiceTermPeriodType): string {
  return PERIOD_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function dateRangeLabel(term: SchoolServiceTermRecord): string {
  if (!term.start_date && !term.end_date) {
    return "No dates set";
  }
  const start = term.start_date ? formatDateLabel(term.start_date) : "Open start";
  const end = term.end_date ? formatDateLabel(term.end_date) : "Open end";
  return `${start} – ${end}`;
}

export function ServiceTermsPanel({ token, organizationId, organizationName, canManage }: Props) {
  const [terms, setTerms] = useState<SchoolServiceTermRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<{ period_type: SchoolServiceTermPeriodType; period_label: string; start_date: string; end_date: string; notes: string }>({
    period_type: "school_year",
    period_label: "",
    start_date: "",
    end_date: "",
    notes: ""
  });

  const [rolloverFor, setRolloverFor] = useState<string | null>(null);
  const [rolloverLabel, setRolloverLabel] = useState("");

  const [editFor, setEditFor] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ start_date: string; end_date: string; notes: string }>({ start_date: "", end_date: "", notes: "" });

  const loadTerms = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await listSchoolServiceTerms(token, organizationId);
      setTerms(response.service_terms);
    } catch (error) {
      setLoadError(error instanceof ApiClientError ? error.message : "We couldn't load service terms right now.");
    } finally {
      setLoading(false);
    }
  }, [token, organizationId]);

  useEffect(() => {
    void loadTerms();
    setAddOpen(false);
    setRolloverFor(null);
    setEditFor(null);
    setActionError("");
  }, [loadTerms]);

  const { current, drafts, history } = useMemo(() => {
    const byStatus = { current: [] as SchoolServiceTermRecord[], drafts: [] as SchoolServiceTermRecord[], history: [] as SchoolServiceTermRecord[] };
    for (const term of terms) {
      if (term.status === "current") byStatus.current.push(term);
      else if (term.status === "draft") byStatus.drafts.push(term);
      else byStatus.history.push(term);
    }
    return byStatus;
  }, [terms]);

  const runAction = useCallback(
    async (work: () => Promise<unknown>) => {
      setActionBusy(true);
      setActionError("");
      try {
        await work();
        await loadTerms();
        return true;
      } catch (error) {
        setActionError(error instanceof ApiClientError ? error.message : "That service-term action didn't go through.");
        return false;
      } finally {
        setActionBusy(false);
      }
    },
    [loadTerms]
  );

  const submitAdd = useCallback(async () => {
    if (!addForm.period_label.trim()) {
      setActionError("A period label (for example, 2026–2027) is required.");
      return;
    }
    const ok = await runAction(() =>
      createSchoolServiceTermRecord(token, organizationId, {
        period_type: addForm.period_type,
        period_label: addForm.period_label.trim(),
        start_date: addForm.start_date || null,
        end_date: addForm.end_date || null,
        notes: addForm.notes.trim() || null
      })
    );
    if (ok) {
      setAddOpen(false);
      setAddForm({ period_type: "school_year", period_label: "", start_date: "", end_date: "", notes: "" });
    }
  }, [addForm, organizationId, runAction, token]);

  const submitRollover = useCallback(
    async (termId: string) => {
      if (!rolloverLabel.trim()) {
        setActionError("Enter the new period label for the rolled-over draft.");
        return;
      }
      const ok = await runAction(() => rolloverSchoolServiceTermRecord(token, termId, rolloverLabel.trim()));
      if (ok) {
        setRolloverFor(null);
        setRolloverLabel("");
      }
    },
    [rolloverLabel, runAction, token]
  );

  const submitEdit = useCallback(
    async (termId: string) => {
      const ok = await runAction(() =>
        updateSchoolServiceTermRecord(token, termId, {
          start_date: editForm.start_date || null,
          end_date: editForm.end_date || null,
          notes: editForm.notes.trim() || null
        })
      );
      if (ok) {
        setEditFor(null);
      }
    },
    [editForm, runAction, token]
  );

  const openEdit = useCallback((term: SchoolServiceTermRecord) => {
    setEditFor(term.id);
    setRolloverFor(null);
    setEditForm({ start_date: term.start_date ?? "", end_date: term.end_date ?? "", notes: term.notes ?? "" });
  }, []);

  const renderTermCard = (term: SchoolServiceTermRecord, accent: "current" | "draft" | "history") => {
    const inherited = term.inherited_field_keys ?? [];
    const needsReview = term.status === "draft" && term.confirmation_state === "unconfirmed";
    return (
      <article key={term.id} className={`request-card service-term-card service-term-card--${accent}`}>
        <div className="directory-card__header">
          <div>
            <strong>{term.period_label}</strong>
            <div className="muted">
              {labelForPeriodType(term.period_type)} · {dateRangeLabel(term)}
            </div>
          </div>
          <div className="directory-chip-row">
            <span className={`meta-pill service-term-status service-term-status--${term.status}`}>
              {term.status === "current" ? "Current" : term.status === "draft" ? "Draft" : "Closed"}
            </span>
            {needsReview ? <span className="meta-pill meta-pill--warning">Needs review</span> : null}
            {term.confirmation_state === "confirmed" ? <span className="meta-pill">Confirmed</span> : null}
          </div>
        </div>

        {inherited.length ? (
          <p className="service-term-inherited muted">
            Inherited from the prior term: {inherited.join(", ")}. Review before confirming — these are copied values, not confirmed truth.
          </p>
        ) : null}
        {term.notes ? <p>{term.notes}</p> : null}

        {canManage ? (
          <div className="page-intro-actions page-intro-actions--compact">
            {term.status !== "current" ? (
              <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => void runAction(() => activateSchoolServiceTermRecord(token, term.id))}>
                Make current
              </button>
            ) : null}
            {needsReview ? (
              <button type="button" disabled={actionBusy} onClick={() => void runAction(() => updateSchoolServiceTermRecord(token, term.id, { confirm: true }))}>
                Confirm reviewed
              </button>
            ) : null}
            <button
              type="button"
              className="secondary-button"
              disabled={actionBusy}
              onClick={() => {
                setRolloverFor(term.id);
                setEditFor(null);
                setRolloverLabel("");
              }}
            >
              Roll over to next
            </button>
            <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => openEdit(term)}>
              Change dates / notes
            </button>
          </div>
        ) : null}

        {rolloverFor === term.id ? (
          <div className="service-term-inline-form">
            <label>
              New period label
              <input
                type="text"
                value={rolloverLabel}
                placeholder="2027–2028"
                aria-label="New period label"
                onChange={(event) => setRolloverLabel(event.target.value)}
              />
            </label>
            <div className="page-intro-actions page-intro-actions--compact">
              <button type="button" disabled={actionBusy} onClick={() => void submitRollover(term.id)}>
                Create draft
              </button>
              <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => setRolloverFor(null)}>
                Cancel
              </button>
            </div>
            <p className="muted">Copies this term's service values into a new unconfirmed draft for the next period.</p>
          </div>
        ) : null}

        {editFor === term.id ? (
          <div className="service-term-inline-form">
            <div className="service-term-form-grid">
              <label>
                Start date
                <input type="date" value={editForm.start_date} aria-label="Start date" onChange={(event) => setEditForm((prev) => ({ ...prev, start_date: event.target.value }))} />
              </label>
              <label>
                End date
                <input type="date" value={editForm.end_date} aria-label="End date" onChange={(event) => setEditForm((prev) => ({ ...prev, end_date: event.target.value }))} />
              </label>
            </div>
            <label>
              Notes
              <textarea value={editForm.notes} aria-label="Service term notes" rows={2} onChange={(event) => setEditForm((prev) => ({ ...prev, notes: event.target.value }))} />
            </label>
            <div className="page-intro-actions page-intro-actions--compact">
              <button type="button" disabled={actionBusy} onClick={() => void submitEdit(term.id)}>
                Save changes
              </button>
              <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => setEditFor(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </article>
    );
  };

  return (
    <section className="request-card service-terms-panel" aria-label="School-year and season service terms">
      <div className="directory-card__header">
        <div>
          <strong>Service Terms</strong>
          <div className="muted">
            School-year and season service truth for {organizationName}: the current term, upcoming drafts to confirm, and closed history.
          </div>
        </div>
        {canManage ? (
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => {
              setAddOpen((open) => !open);
              setRolloverFor(null);
              setEditFor(null);
            }}
          >
            {addOpen ? "Close" : "Add term"}
          </button>
        ) : (
          <span className="meta-pill">Read-only service terms</span>
        )}
      </div>

      {actionError ? <div className="form-error" role="alert">{actionError}</div> : null}

      {addOpen && canManage ? (
        <div className="service-term-inline-form">
          <div className="form-grid form-grid--two">
            <label>
              Period type
              <select value={addForm.period_type} onChange={(event) => setAddForm((prev) => ({ ...prev, period_type: event.target.value as SchoolServiceTermPeriodType }))}>
                {PERIOD_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Period label
              <input
                type="text"
                value={addForm.period_label}
                placeholder="2026–2027"
                aria-label="Period label"
                onChange={(event) => setAddForm((prev) => ({ ...prev, period_label: event.target.value }))}
              />
            </label>
            <label>
              Start date
              <input type="date" value={addForm.start_date} aria-label="New term start date" onChange={(event) => setAddForm((prev) => ({ ...prev, start_date: event.target.value }))} />
            </label>
            <label>
              End date
              <input type="date" value={addForm.end_date} aria-label="New term end date" onChange={(event) => setAddForm((prev) => ({ ...prev, end_date: event.target.value }))} />
            </label>
          </div>
          <label>
            Notes
            <textarea value={addForm.notes} aria-label="New term notes" rows={2} onChange={(event) => setAddForm((prev) => ({ ...prev, notes: event.target.value }))} />
          </label>
          <div className="page-intro-actions page-intro-actions--compact">
            <button type="button" disabled={actionBusy} onClick={() => void submitAdd()}>
              Create term
            </button>
            <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => setAddOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="empty-state empty-state--panel">Loading service terms…</div>
      ) : loadError ? (
        <div className="empty-state empty-state--panel">{loadError}</div>
      ) : !terms.length ? (
        <div className="empty-state empty-state--panel">
          No service terms yet. {canManage ? "Add the current school year or season to start tracking service truth." : "A manager hasn't set one up yet."}
        </div>
      ) : (
        <div className="directory-section-stack">
          <div className="service-term-group">
            <div className="service-term-group__label">Current</div>
            {current.length ? current.map((term) => renderTermCard(term, "current")) : <p className="muted">No current term is set. Make one of the drafts current.</p>}
          </div>

          {drafts.length ? (
            <div className="service-term-group">
              <div className="service-term-group__label">Upcoming drafts</div>
              {drafts.map((term) => renderTermCard(term, "draft"))}
            </div>
          ) : null}

          {history.length ? (
            <div className="service-term-group">
              <div className="service-term-group__label">History</div>
              {history.map((term) => renderTermCard(term, "history"))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
