import { useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../api";
import { StatusPill, formatDateTime, humanizeToken, statusTone } from "../components/sports/SportsPrimitives";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceFilterToolbar } from "../components/workspace/WorkspaceFilterToolbar";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { listSportsContacts } from "../services/sportsApi";
import type { SportsContactSummary } from "../sportsTypes";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

function matchesContact(item: SportsContactSummary, search: string) {
  const normalized = search.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return (
    item.full_name.toLowerCase().includes(normalized) ||
    item.organization_name.toLowerCase().includes(normalized) ||
    (item.email ?? "").toLowerCase().includes(normalized) ||
    (item.role ?? "").toLowerCase().includes(normalized)
  );
}

export function SportsContacts({ token }: Props) {
  const [items, setItems] = useState<SportsContactSummary[]>([]);
  const [search, setSearch] = useState("");
  const [contactTypeFilter, setContactTypeFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void listSportsContacts(token)
      .then((response) => {
        if (!cancelled) {
          setItems(response.items);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load sports contacts right now.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          matchesContact(item, search) &&
          (contactTypeFilter === "all" ||
            (contactTypeFilter === "approval_owner" && item.approval_owner) ||
            (contactTypeFilter === "billing_contact" && item.billing_contact) ||
            (contactTypeFilter === "active_linked" && item.active_shoot_count > 0))
      ),
    [contactTypeFilter, items, search]
  );

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading sports contacts" summary="Opening the sports-filtered shared contact directory." />;
  }

  return (
    <section className="sports-workspace">
      <WorkspacePageHeader
        eyebrow="Sports"
        title="Sports Contacts"
        summary="Sports-filtered wrapper around shared contacts for approval owners, billing contacts, and live client relationship context."
        meta={[{ label: `${items.length} linked sports contacts`, tone: "info" }]}
      />

      <WorkspaceFilterToolbar className="sports-filter-toolbar">
        <label className="filter-field filter-field--wide">
          <span>Search Contacts</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, organization, email, or role" />
        </label>
        <label className="filter-field">
          <span>Role Lens</span>
          <select value={contactTypeFilter} onChange={(event) => setContactTypeFilter(event.target.value)}>
            <option value="all">All linked contacts</option>
            <option value="approval_owner">Approval owners</option>
            <option value="billing_contact">Billing contacts</option>
            <option value="active_linked">Active shoot linked</option>
          </select>
        </label>
      </WorkspaceFilterToolbar>

      {error ? <div className="error-banner">{error}</div> : null}

      {!filtered.length ? (
        <WorkspaceEmptyState title="No sports contacts match these filters" summary="Shared contacts will appear here once sports jobs link them into active work." />
      ) : (
        <section className="panel sports-master-table">
          <div className="sports-master-table__header">
            <strong>Shared Contacts Used By Sports</strong>
            <span>{filtered.length} contacts</span>
          </div>
          <div className="sports-master-table__scroll">
            <table>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Organization</th>
                  <th>Role</th>
                  <th>Preferred</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Linked Jobs</th>
                  <th>Last Interaction</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="sports-table__primary">{item.full_name}</div>
                      <div className="sports-table__secondary">{item.contact_type ?? "Shared contact"}</div>
                    </td>
                    <td>{item.organization_name}</td>
                    <td>{item.role ?? "Role pending"}</td>
                    <td>{humanizeToken(item.preferred_contact_method)}</td>
                    <td>{item.phone ?? "Not listed"}</td>
                    <td>{item.email ?? "Not listed"}</td>
                    <td>{item.active_shoot_count}</td>
                    <td>{formatDateTime(item.last_interaction)}</td>
                    <td>
                      <div className="sports-status-stack">
                        {item.approval_owner ? <StatusPill label="Approval owner" tone={statusTone("approved")} /> : null}
                        {item.billing_contact ? <StatusPill label="Billing" tone="warning" /> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
