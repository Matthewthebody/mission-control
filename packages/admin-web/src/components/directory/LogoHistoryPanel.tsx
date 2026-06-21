import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "../../api";
import type { OrganizationLogoHistoryEntry } from "../../types";
import { getOrganizationLogoHistory, restoreOrganizationLogoRecord } from "../../services/organizationApi";
import { DirectoryAvatar } from "./DirectoryAvatar";
import { formatDateTimeLabel } from "./directoryOptions";

// Phase 4.1 — organization logo history + restore. Self-contained (token + organizationId,
// like RecordResourcesPanel) over the migration-162 backend: the current logo with an
// immediate preview, the append-only history (each prior logo with its source, who set it,
// and when), and a manager-only Restore. No second logo store — reads/writes the existing
// organization_logo_history endpoints.

type Props = {
  token: string;
  organizationId: string;
  organizationName: string;
  currentLogoUrl: string | null;
  canManage: boolean;
};

function sourceLabel(source: string | null): string {
  switch (source) {
    case "upload":
      return "Uploaded";
    case "url":
      return "Linked URL";
    case "restore":
      return "Restored from history";
    case "brand_update":
      return "Brand update";
    default:
      return source ? source.replace(/_/g, " ") : "Recorded";
  }
}

export function LogoHistoryPanel({ token, organizationId, organizationName, currentLogoUrl, canManage }: Props) {
  const [entries, setEntries] = useState<OrganizationLogoHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await getOrganizationLogoHistory(token, organizationId);
      setEntries(response.logo_history);
    } catch (error) {
      setLoadError(error instanceof ApiClientError ? error.message : "We couldn't load logo history right now.");
    } finally {
      setLoading(false);
    }
  }, [token, organizationId]);

  useEffect(() => {
    void load();
    setActionError("");
  }, [load]);

  const restore = useCallback(
    async (entry: OrganizationLogoHistoryEntry) => {
      setActionBusy(true);
      setActionError("");
      try {
        const response = await restoreOrganizationLogoRecord(token, organizationId, entry.id);
        setEntries(response.logo_history);
      } catch (error) {
        setActionError(error instanceof ApiClientError ? error.message : "We couldn't restore that logo right now.");
      } finally {
        setActionBusy(false);
      }
    },
    [token, organizationId]
  );

  return (
    <section className="request-card logo-history-panel" aria-label="Organization logo history">
      <div className="directory-card__header">
        <div>
          <strong>Logo &amp; Brand History</strong>
          <div className="muted">The current logo for {organizationName} and every prior logo, with who set it and when.</div>
        </div>
        {!canManage ? <span className="meta-pill">Read-only</span> : null}
      </div>

      <div className="logo-history-panel__current">
        <DirectoryAvatar name={organizationName} imageUrl={currentLogoUrl} kind="organization" size="md" />
        <div>
          <div className="logo-history-panel__current-label muted">Current logo</div>
          <strong>{currentLogoUrl ? "Set" : "No logo on file"}</strong>
        </div>
      </div>

      {actionError ? <div className="form-error" role="alert">{actionError}</div> : null}

      {loading ? (
        <div className="empty-state empty-state--panel">Loading logo history…</div>
      ) : loadError ? (
        <div className="empty-state empty-state--panel">{loadError}</div>
      ) : !entries.length ? (
        <div className="empty-state empty-state--panel">No logo history recorded yet.</div>
      ) : (
        <ul className="logo-history-panel__list" aria-label="Prior logos">
          {entries.map((entry, index) => (
            <li key={entry.id} className="logo-history-panel__entry">
              <DirectoryAvatar name={organizationName} imageUrl={entry.logo_url} kind="organization" size="sm" />
              <div className="logo-history-panel__entry-body">
                <div className="directory-chip-row">
                  <span className="meta-pill">{sourceLabel(entry.source)}</span>
                  {entry.status ? <span className="meta-pill">{entry.status.replace(/_/g, " ")}</span> : null}
                  {index === 0 ? <span className="meta-pill meta-pill--success">Current</span> : null}
                </div>
                <div className="muted">
                  {formatDateTimeLabel(entry.created_at)}
                  {entry.set_by_user_name ? ` · ${entry.set_by_user_name}` : ""}
                </div>
                {entry.note ? <div className="logo-history-panel__note">{entry.note}</div> : null}
              </div>
              {canManage && index !== 0 ? (
                <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => void restore(entry)}>
                  Restore
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
