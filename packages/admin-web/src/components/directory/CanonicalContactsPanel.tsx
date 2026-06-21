import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "../../api";
import type { CanonicalContactListItem, CanonicalContactRelationship } from "../../types";
import {
  getCanonicalContactRelationships,
  linkCanonicalContactToOrganizationRecord,
  listCanonicalContacts,
  listOrganizations,
  unlinkCanonicalContactRelationshipRecord,
  updateCanonicalContactRecord,
  updateCanonicalContactRelationshipRecord
} from "../../services/organizationApi";
import type { OrganizationSummary } from "../../types";

// Phase 4.2 Part 2 — first-class canonical Contacts list over reusable identities (the
// `contact` table, not org-bound rows). Search by name/email/phone, see how many
// organizations each person is linked to and their contextual roles, and expand a person to
// see every organization relationship (the canonical cross-org rollup that the org-bound
// relationship_history could not give). Page size is bounded; nothing merges on name/email.

type Props = {
  token: string;
  organizationId?: string | null;
  activeStatus?: string | null;
  canManage?: boolean;
};

const PAGE_SIZE = 25;

export function CanonicalContactsPanel({ token, organizationId, activeStatus, canManage }: Props) {
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<CanonicalContactListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [relationships, setRelationships] = useState<CanonicalContactRelationship[]>([]);
  const [relLoading, setRelLoading] = useState(false);
  const [unlinkBusy, setUnlinkBusy] = useState("");
  const [editPersonId, setEditPersonId] = useState<string | null>(null);
  const [personForm, setPersonForm] = useState<{ first_name: string; last_name: string; email: string; phone: string }>({ first_name: "", last_name: "", email: "", phone: "" });
  const [personBusy, setPersonBusy] = useState(false);
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [orgQuery, setOrgQuery] = useState("");
  const [orgResults, setOrgResults] = useState<OrganizationSummary[]>([]);
  const [linkRole, setLinkRole] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [editRelId, setEditRelId] = useState<string | null>(null);
  const [relRole, setRelRole] = useState("");
  const [relEditBusy, setRelEditBusy] = useState(false);

  const reloadRelationships = useCallback(
    async (contactId: string) => {
      const refreshed = await getCanonicalContactRelationships(token, contactId);
      setRelationships(refreshed.relationships);
    },
    [token]
  );

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

  // Org search for the "link to another organization" action (debounced).
  useEffect(() => {
    if (!linkFor || orgQuery.trim().length < 2) {
      setOrgResults([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void listOrganizations(token, { search: orgQuery.trim(), activeStatus: "active" })
        .then((r) => {
          if (!cancelled) setOrgResults(r.organizations);
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [linkFor, orgQuery, token]);

  const submitPersonEdit = useCallback(
    async (contactId: string) => {
      setPersonBusy(true);
      try {
        await updateCanonicalContactRecord(token, contactId, {
          first_name: personForm.first_name || null,
          last_name: personForm.last_name || null,
          email: personForm.email || null,
          phone: personForm.phone || null
        });
        setEditPersonId(null);
        await load();
        if (expandedId === contactId) await reloadRelationships(contactId);
      } catch {
        /* keep the form open on failure */
      } finally {
        setPersonBusy(false);
      }
    },
    [personForm, token, load, expandedId, reloadRelationships]
  );

  const submitRelEdit = useCallback(
    async (contactId: string, organizationContactId: string) => {
      setRelEditBusy(true);
      try {
        await updateCanonicalContactRelationshipRecord(token, contactId, organizationContactId, { client_roles: relRole.trim() ? [relRole.trim()] : [] });
        setEditRelId(null);
        setRelRole("");
        await reloadRelationships(contactId);
      } catch {
        /* keep the form open on failure */
      } finally {
        setRelEditBusy(false);
      }
    },
    [token, relRole, reloadRelationships]
  );

  const submitLink = useCallback(
    async (contactId: string, organizationId: string) => {
      setLinkBusy(true);
      try {
        await linkCanonicalContactToOrganizationRecord(token, contactId, {
          organization_id: organizationId,
          client_roles: linkRole ? [linkRole] : undefined
        });
        setLinkFor(null);
        setOrgQuery("");
        setOrgResults([]);
        setLinkRole("");
        await reloadRelationships(contactId);
        await load();
      } catch {
        /* keep the form open on failure */
      } finally {
        setLinkBusy(false);
      }
    },
    [token, linkRole, reloadRelationships, load]
  );

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
        <span className="visually-hidden">Search people</span>
        <input type="text" aria-label="Search people" placeholder="Search by name, email, or phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
                  {canManage ? (
                    <div className="page-intro-actions page-intro-actions--compact">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          setEditPersonId(editPersonId === contact.id ? null : contact.id);
                          setPersonForm({ first_name: contact.first_name ?? "", last_name: contact.last_name ?? "", email: contact.email ?? "", phone: contact.phone ?? "" });
                          setLinkFor(null);
                        }}
                      >
                        {editPersonId === contact.id ? "Close" : "Edit person"}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          setLinkFor(linkFor === contact.id ? null : contact.id);
                          setEditPersonId(null);
                          setOrgQuery("");
                          setOrgResults([]);
                          setLinkRole("");
                        }}
                      >
                        {linkFor === contact.id ? "Close" : "Link to organization"}
                      </button>
                    </div>
                  ) : null}

                  {editPersonId === contact.id ? (
                    <div className="canonical-contacts-panel__edit">
                      <div className="service-term-form-grid">
                        <label>First name<input aria-label="Edit first name" value={personForm.first_name} onChange={(e) => setPersonForm((p) => ({ ...p, first_name: e.target.value }))} /></label>
                        <label>Last name<input aria-label="Edit last name" value={personForm.last_name} onChange={(e) => setPersonForm((p) => ({ ...p, last_name: e.target.value }))} /></label>
                        <label>Email<input type="email" aria-label="Edit email" value={personForm.email} onChange={(e) => setPersonForm((p) => ({ ...p, email: e.target.value }))} /></label>
                        <label>Phone<input aria-label="Edit phone" value={personForm.phone} onChange={(e) => setPersonForm((p) => ({ ...p, phone: e.target.value }))} /></label>
                      </div>
                      <p className="muted">Editing the person updates every organization view they appear in.</p>
                      <button type="button" disabled={personBusy} onClick={() => void submitPersonEdit(contact.id)}>Save person</button>
                    </div>
                  ) : null}

                  {linkFor === contact.id ? (
                    <div className="canonical-contacts-panel__edit">
                      <label className="directory-field">Find an organization<input aria-label="Link organization search" placeholder="Search organizations…" value={orgQuery} onChange={(e) => setOrgQuery(e.target.value)} /></label>
                      <label className="directory-field">Role<input aria-label="Link role" placeholder="e.g. picture_day_contact" value={linkRole} onChange={(e) => setLinkRole(e.target.value)} /></label>
                      {orgResults.length ? (
                        <ul className="canonical-contact-selector__results" role="listbox" aria-label="Organizations to link">
                          {orgResults.slice(0, 6).map((org) => (
                            <li key={org.id} role="option" aria-selected={false}>
                              <button type="button" className="canonical-contact-selector__option" disabled={linkBusy} onClick={() => void submitLink(contact.id, org.id)}>
                                {org.display_name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : orgQuery.trim().length >= 2 ? (
                        <p className="muted">No matching organizations.</p>
                      ) : null}
                    </div>
                  ) : null}

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
                          {canManage ? (
                            <>
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => {
                                  setEditRelId(editRelId === rel.organization_contact_id ? null : rel.organization_contact_id);
                                  setRelRole(rel.client_roles[0] ?? "");
                                }}
                              >
                                {editRelId === rel.organization_contact_id ? "Close" : "Edit role"}
                              </button>
                              <button
                                type="button"
                                className="secondary-button canonical-contacts-panel__unlink"
                                disabled={unlinkBusy === rel.organization_contact_id}
                                onClick={async () => {
                                  // Unlink this relationship only — the identity + other relationships stay.
                                  setUnlinkBusy(rel.organization_contact_id);
                                  try {
                                    await unlinkCanonicalContactRelationshipRecord(token, contact.id, rel.organization_contact_id);
                                    const refreshed = await getCanonicalContactRelationships(token, contact.id);
                                    setRelationships(refreshed.relationships);
                                  } catch {
                                    /* leave the list as-is on failure */
                                  } finally {
                                    setUnlinkBusy("");
                                  }
                                }}
                              >
                                Unlink
                              </button>
                            </>
                          ) : null}
                          {editRelId === rel.organization_contact_id ? (
                            <div className="canonical-contacts-panel__edit" style={{ width: "100%" }}>
                              <label>
                                Contextual role
                                <input aria-label="Edit relationship role" placeholder="e.g. yearbook_contact" value={relRole} onChange={(e) => setRelRole(e.target.value)} />
                              </label>
                              <p className="muted">Changes only this organization relationship — the person and every other relationship stay the same.</p>
                              <button type="button" disabled={relEditBusy} onClick={() => void submitRelEdit(contact.id, rel.organization_contact_id)}>Save role</button>
                            </div>
                          ) : null}
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
