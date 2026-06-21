import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "../../api";
import type { CanonicalContactListItem, CanonicalContactRelationship } from "../../types";
import { getCanonicalContactRelationships, listCanonicalContacts } from "../../services/organizationApi";

// Phase 4.2 Part 2 — first-class canonical Contacts list over reusable identities (the
// `contact` table, not org-bound rows). Search by name/email/phone, see how many
// organizations each person is linked to and their contextual roles, and expand a person to
// see every organization relationship (the canonical cross-org rollup that the org-bound
// relationship_history could not give). Page size is bounded; nothing merges on name/email.

type Props = {
  token: string;
  organizationId?: string | null;
  activeStatus?: string | null;
};

const PAGE_SIZE = 25;

export function CanonicalContactsPanel({ token, organizationId, activeStatus }: Props) {
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<CanonicalContactListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [relationships, setRelationships] = useState<CanonicalContactRelationship[]>([]);
  const [relLoading, setRelLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await listCanonicalContacts(token, { search: search.trim() || undefined, organizationId, activeStatus, limit: PAGE_SIZE, offset });
      setContacts(response.contacts ?? []);
      setTotal(response.total ?? 0);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "We couldn't load contacts right now.");
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, [token, search, organizationId, activeStatus, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [search]);

  const toggleExpand = useCallback(
    async (contactId: string) => {
      if (expandedId === contactId) {
        setExpandedId(null);
        return;
      }
      setExpandedId(contactId);
      setRelationships([]);
      setRelLoading(true);
      try {
        const response = await getCanonicalContactRelationships(token, contactId);
        setRelationships(response.relationships);
      } catch {
        setRelationships([]);
      } finally {
        setRelLoading(false);
      }
    },
    [expandedId, token]
  );

  return (
    <section className="request-card canonical-contacts-panel" aria-label="Canonical contacts">
      <div className="directory-card__header">
        <div>
          <strong>Contacts</strong>
          <div className="muted">Reusable people — one identity per person, linked to one or more organizations.</div>
        </div>
        <span className="meta-pill">{total} {total === 1 ? "person" : "people"}</span>
      </div>

      <label className="directory-field">
        <span className="visually-hidden">Search contacts</span>
        <input type="text" aria-label="Search contacts" placeholder="Search by name, email, or phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>

      {error ? <div className="form-error" role="alert">{error}</div> : null}

      {loading ? (
        <div className="empty-state empty-state--panel">Loading contacts…</div>
      ) : !contacts.length ? (
        <div className="empty-state empty-state--panel">No contacts match.</div>
      ) : (
        <ul className="canonical-contacts-panel__list">
          {contacts.map((contact) => (
            <li key={contact.id} className="canonical-contacts-panel__item">
              <button type="button" className="directory-link-button" aria-expanded={expandedId === contact.id} onClick={() => void toggleExpand(contact.id)}>
                <span>
                  {contact.full_name || contact.email || "Unnamed contact"}
                  {contact.role_summary.length ? <span className="muted"> — {contact.role_summary.slice(0, 3).map((r) => r.replace(/_/g, " ")).join(", ")}</span> : null}
                </span>
                <span className="muted">
                  {[contact.email, contact.phone].filter(Boolean).join(" · ") || "No info"} · {contact.linked_organization_count} org{contact.linked_organization_count === 1 ? "" : "s"}
                </span>
              </button>
              {expandedId === contact.id ? (
                <div className="canonical-contacts-panel__relationships">
                  {relLoading ? (
                    <p className="muted">Loading relationships…</p>
                  ) : relationships.length ? (
                    <ul>
                      {relationships.map((rel) => (
                        <li key={rel.organization_contact_id}>
                          <button type="button" className="link-button" onClick={() => (window.location.hash = `#directory/organizations/${rel.organization_id}`)}>
                            {rel.organization_name}
                          </button>
                          {rel.client_roles.length ? <span className="muted"> — {rel.client_roles.map((r) => r.replace(/_/g, " ")).join(", ")}</span> : null}
                          {rel.is_primary ? <span className="meta-pill">Primary</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No organization relationships recorded.</p>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {total > PAGE_SIZE ? (
        <div className="page-intro-actions page-intro-actions--compact">
          <button type="button" className="secondary-button" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}>
            Previous
          </button>
          <span className="muted">{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}</span>
          <button type="button" className="secondary-button" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset((o) => o + PAGE_SIZE)}>
            Next
          </button>
        </div>
      ) : null}
    </section>
  );
}
