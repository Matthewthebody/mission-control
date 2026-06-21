import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError } from "../../api";
import type { CanonicalContactListItem, CanonicalContactRecord, CanonicalContactRelationship } from "../../types";
import {
  getCanonicalContactRelationships,
  linkCanonicalContactToOrganizationRecord,
  listCanonicalContacts,
  listOrganizations,
  setCanonicalContactArchivedRecord,
  unlinkCanonicalContactRelationshipRecord,
  updateCanonicalContactRecord,
  updateCanonicalContactRelationshipRecord
} from "../../services/organizationApi";
import type { OrganizationSummary } from "../../types";

// Phase 4.2 Part 2 — first-class canonical Contacts surface over reusable identities (the
// `contact` table, not org-bound rows). Three modes share one relationship-management core:
//   • default            — a self-contained section embedded inside an organization detail page.
//   • urlBacked          — the Directory "Contacts" mode: URL-authoritative search + organization
//                          + role + active/archive filters + deterministic pagination + a selected
//                          contact, all preserved across refresh and Back/Forward; each row opens
//                          the stable canonical Contact route.
//   • focusContactId     — the full-page Contact experience for one identity (person edit that
//                          propagates to every org view, link, per-relationship role edit, unlink,
//                          archive/restore), reached from the route.
// Nothing merges on name/email; one row per identity; person and relationship fields are edited
// through separate mutations.

type Props = {
  token: string;
  organizationId?: string | null;
  activeStatus?: string | null;
  canManage?: boolean;
  urlBacked?: boolean;
  focusContactId?: string | null;
};

const PAGE_SIZE = 25;

// Rich client roles (migration 144) offered as the Contacts-mode role filter + role inputs.
const ROLE_FILTER_OPTIONS = [
  "principal",
  "head_secretary",
  "administrative_assistant",
  "athletic_director",
  "activities_director",
  "coach",
  "yearbook_contact",
  "picture_day_contact",
  "billing_contact",
  "approval_contact",
  "contract_signer",
  "emergency_day_of_contact",
  "district_contact",
  "primary_contact",
  "other"
];

const humanizeRole = (role: string) => role.replace(/_/g, " ");

type ContactsUrlState = {
  search: string;
  orgFilter: string;
  roleFilter: string;
  statusFilter: string;
  page: number;
  selected: string | null;
};

function readContactsUrlState(): ContactsUrlState {
  const [, query = ""] = window.location.hash.split("?");
  const params = new URLSearchParams(query);
  return {
    search: params.get("cq") ?? "",
    orgFilter: params.get("corg") ?? "",
    roleFilter: params.get("crole") ?? "",
    statusFilter: params.get("cstatus") ?? "active",
    page: Math.max(0, Number(params.get("cpage") ?? "0") || 0),
    selected: params.get("cselected")
  };
}

// Preserve the existing root + any parent params (view/tab); manage only the c* contact params.
function writeContactsUrlState(state: ContactsUrlState) {
  const hash = window.location.hash.replace(/^#/, "");
  const [root, query = ""] = hash.split("?");
  const params = new URLSearchParams(query);
  const apply = (key: string, value: string, keep: boolean) => (keep && value ? params.set(key, value) : params.delete(key));
  apply("cq", state.search, true);
  apply("corg", state.orgFilter, true);
  apply("crole", state.roleFilter, true);
  apply("cstatus", state.statusFilter, state.statusFilter !== "active");
  apply("cpage", state.page > 0 ? String(state.page) : "", state.page > 0);
  apply("cselected", state.selected ?? "", Boolean(state.selected));
  window.location.hash = `#${root}?${params.toString()}`;
}

export function CanonicalContactsPanel({ token, organizationId, activeStatus, canManage, urlBacked, focusContactId }: Props) {
  const initialUrl = urlBacked ? readContactsUrlState() : null;
  const [search, setSearch] = useState(initialUrl?.search ?? "");
  const [orgFilter, setOrgFilter] = useState(initialUrl?.orgFilter ?? "");
  const [roleFilter, setRoleFilter] = useState(initialUrl?.roleFilter ?? "");
  const [statusFilter, setStatusFilter] = useState(initialUrl?.statusFilter ?? "active");
  const [page, setPage] = useState(initialUrl?.page ?? 0);
  const [contacts, setContacts] = useState<CanonicalContactListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [focusIdentity, setFocusIdentity] = useState<CanonicalContactRecord | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(focusContactId ?? initialUrl?.selected ?? null);
  const [relationships, setRelationships] = useState<CanonicalContactRelationship[]>([]);
  const [relLoading, setRelLoading] = useState(false);
  const [unlinkBusy, setUnlinkBusy] = useState("");
  const [archiveBusy, setArchiveBusy] = useState("");
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

  // Avoid feeding our own URL writes back through the hashchange re-sync.
  const lastWriteRef = useRef<string>("");

  const offset = page * PAGE_SIZE;
  const isFocus = Boolean(focusContactId);

  const syncUrl = useCallback(
    (next: Partial<ContactsUrlState>) => {
      if (!urlBacked) return;
      const merged: ContactsUrlState = {
        search: next.search ?? search,
        orgFilter: next.orgFilter ?? orgFilter,
        roleFilter: next.roleFilter ?? roleFilter,
        statusFilter: next.statusFilter ?? statusFilter,
        page: next.page ?? page,
        selected: next.selected !== undefined ? next.selected : expandedId
      };
      writeContactsUrlState(merged);
      lastWriteRef.current = window.location.hash;
    },
    [urlBacked, search, orgFilter, roleFilter, statusFilter, page, expandedId]
  );

  const reloadRelationships = useCallback(
    async (contactId: string) => {
      const refreshed = await getCanonicalContactRelationships(token, contactId);
      setRelationships(refreshed.relationships);
      if (refreshed.identity) setFocusIdentity((current) => (current && current.id === contactId ? refreshed.identity : current));
    },
    [token]
  );

  // Full-page focus mode: load one identity + its relationships directly (no list query).
  const loadFocus = useCallback(async () => {
    if (!focusContactId) return;
    setLoading(true);
    setError("");
    try {
      const response = await getCanonicalContactRelationships(token, focusContactId);
      setFocusIdentity(response.identity);
      setRelationships(response.relationships);
      setExpandedId(focusContactId);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "We couldn't load this contact right now.");
      setFocusIdentity(null);
    } finally {
      setLoading(false);
    }
  }, [focusContactId, token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await listCanonicalContacts(token, {
        search: search.trim() || undefined,
        organizationId: urlBacked ? orgFilter || null : organizationId,
        activeStatus: urlBacked ? (statusFilter === "all" ? null : statusFilter) : activeStatus,
        role: urlBacked ? roleFilter || null : undefined,
        limit: PAGE_SIZE,
        offset
      });
      setContacts(response.contacts ?? []);
      setTotal(response.total ?? 0);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "We couldn't load contacts right now.");
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, [token, search, organizationId, activeStatus, urlBacked, orgFilter, roleFilter, statusFilter, offset]);

  useEffect(() => {
    if (isFocus) {
      void loadFocus();
    } else {
      void load();
    }
  }, [isFocus, load, loadFocus]);

  // Back/Forward + refresh re-sync (urlBacked only). Ignore the echo of our own writes.
  useEffect(() => {
    if (!urlBacked) return;
    const onHash = () => {
      if (window.location.hash === lastWriteRef.current) return;
      const next = readContactsUrlState();
      setSearch(next.search);
      setOrgFilter(next.orgFilter);
      setRoleFilter(next.roleFilter);
      setStatusFilter(next.statusFilter);
      setPage(next.page);
      setExpandedId(next.selected);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [urlBacked]);

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

  const onSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      setPage(0);
      syncUrl({ search: value, page: 0 });
    },
    [syncUrl]
  );

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
        if (isFocus) await loadFocus();
        else await load();
        if (expandedId === contactId) await reloadRelationships(contactId);
      } catch {
        /* keep the form open on failure */
      } finally {
        setPersonBusy(false);
      }
    },
    [personForm, token, load, loadFocus, isFocus, expandedId, reloadRelationships]
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
    async (contactId: string, linkOrganizationId: string) => {
      setLinkBusy(true);
      try {
        await linkCanonicalContactToOrganizationRecord(token, contactId, {
          organization_id: linkOrganizationId,
          client_roles: linkRole ? [linkRole] : undefined
        });
        setLinkFor(null);
        setOrgQuery("");
        setOrgResults([]);
        setLinkRole("");
        await reloadRelationships(contactId);
        if (!isFocus) await load();
      } catch {
        /* keep the form open on failure */
      } finally {
        setLinkBusy(false);
      }
    },
    [token, linkRole, reloadRelationships, load, isFocus]
  );

  const setArchived = useCallback(
    async (contactId: string, archived: boolean) => {
      setArchiveBusy(contactId);
      try {
        await setCanonicalContactArchivedRecord(token, contactId, archived);
        if (isFocus) await loadFocus();
        else await load();
      } catch {
        /* leave the record as-is on failure */
      } finally {
        setArchiveBusy("");
      }
    },
    [token, isFocus, loadFocus, load]
  );

  const toggleExpand = useCallback(
    async (contactId: string) => {
      if (expandedId === contactId) {
        setExpandedId(null);
        syncUrl({ selected: null });
        return;
      }
      setExpandedId(contactId);
      syncUrl({ selected: contactId });
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
    [expandedId, token, syncUrl]
  );

  // The shared person + relationship management core, rendered for the expanded list row and for
  // the full-page focus identity. `archived` hides every mutation control and offers restore.
  const renderManagement = (record: CanonicalContactRecord, archived: boolean) => (
    <div className="canonical-contacts-panel__relationships">
      {canManage && !archived ? (
        <div className="page-intro-actions page-intro-actions--compact">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setEditPersonId(editPersonId === record.id ? null : record.id);
              setPersonForm({ first_name: record.first_name ?? "", last_name: record.last_name ?? "", email: record.email ?? "", phone: record.phone ?? "" });
              setLinkFor(null);
            }}
          >
            {editPersonId === record.id ? "Close" : "Edit person"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setLinkFor(linkFor === record.id ? null : record.id);
              setEditPersonId(null);
              setOrgQuery("");
              setOrgResults([]);
              setLinkRole("");
            }}
          >
            {linkFor === record.id ? "Close" : "Link to organization"}
          </button>
          <button type="button" className="secondary-button canonical-contacts-panel__archive" disabled={archiveBusy === record.id} onClick={() => void setArchived(record.id, true)}>
            Archive person
          </button>
        </div>
      ) : null}

      {canManage && archived ? (
        <div className="page-intro-actions page-intro-actions--compact">
          <button type="button" className="secondary-button" disabled={archiveBusy === record.id} onClick={() => void setArchived(record.id, false)}>
            Restore person
          </button>
        </div>
      ) : null}

      {editPersonId === record.id && !archived ? (
        <div className="canonical-contacts-panel__edit">
          <div className="service-term-form-grid">
            <label>First name<input aria-label="Edit first name" value={personForm.first_name} onChange={(e) => setPersonForm((p) => ({ ...p, first_name: e.target.value }))} /></label>
            <label>Last name<input aria-label="Edit last name" value={personForm.last_name} onChange={(e) => setPersonForm((p) => ({ ...p, last_name: e.target.value }))} /></label>
            <label>Email<input type="email" aria-label="Edit email" value={personForm.email} onChange={(e) => setPersonForm((p) => ({ ...p, email: e.target.value }))} /></label>
            <label>Phone<input aria-label="Edit phone" value={personForm.phone} onChange={(e) => setPersonForm((p) => ({ ...p, phone: e.target.value }))} /></label>
          </div>
          <p className="muted">Editing the person updates every organization view they appear in.</p>
          <button type="button" disabled={personBusy} onClick={() => void submitPersonEdit(record.id)}>Save person</button>
        </div>
      ) : null}

      {linkFor === record.id && !archived ? (
        <div className="canonical-contacts-panel__edit">
          <label className="directory-field">Find an organization<input aria-label="Link organization search" placeholder="Search organizations…" value={orgQuery} onChange={(e) => setOrgQuery(e.target.value)} /></label>
          <label className="directory-field">
            Role
            <select aria-label="Link role" value={linkRole} onChange={(e) => setLinkRole(e.target.value)}>
              <option value="">No specific role</option>
              {ROLE_FILTER_OPTIONS.map((role) => (
                <option key={role} value={role}>{humanizeRole(role)}</option>
              ))}
            </select>
          </label>
          {orgResults.length ? (
            <ul className="canonical-contact-selector__results" role="listbox" aria-label="Organizations to link">
              {orgResults.slice(0, 6).map((org) => {
                const alreadyLinked = relationships.some((rel) => rel.organization_id === org.id);
                return (
                  <li key={org.id} role="option" aria-selected={false}>
                    <button type="button" className="canonical-contact-selector__option" disabled={linkBusy} onClick={() => void submitLink(record.id, org.id)}>
                      {org.display_name}
                      {alreadyLinked ? <span className="meta-pill meta-pill--warning"> Already linked</span> : null}
                    </button>
                  </li>
                );
              })}
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
              {rel.client_roles.length ? <span className="muted"> — {rel.client_roles.map(humanizeRole).join(", ")}</span> : null}
              {rel.is_primary ? <span className="meta-pill">Primary</span> : null}
              {canManage && !archived ? (
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
                        await unlinkCanonicalContactRelationshipRecord(token, record.id, rel.organization_contact_id);
                        const refreshed = await getCanonicalContactRelationships(token, record.id);
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
              {editRelId === rel.organization_contact_id && !archived ? (
                <div className="canonical-contacts-panel__edit" style={{ width: "100%" }}>
                  <label>
                    Contextual role
                    <input aria-label="Edit relationship role" placeholder="e.g. yearbook_contact" value={relRole} onChange={(e) => setRelRole(e.target.value)} />
                  </label>
                  <p className="muted">Changes only this organization relationship — the person and every other relationship stay the same.</p>
                  <button type="button" disabled={relEditBusy} onClick={() => void submitRelEdit(record.id, rel.organization_contact_id)}>Save role</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No organization relationships recorded.</p>
      )}
    </div>
  );

  // ── Full-page focus mode ───────────────────────────────────────────────────
  if (isFocus) {
    if (loading) {
      return <section className="request-card canonical-contacts-panel" aria-busy="true"><div className="empty-state empty-state--panel">Loading this contact…</div></section>;
    }
    if (error || !focusIdentity) {
      return (
        <section className="request-card canonical-contacts-panel" aria-label="Canonical contact">
          <div className="empty-state empty-state--panel" role="alert">{error || "This contact could not be found."}</div>
        </section>
      );
    }
    const archived = focusIdentity.active_status === "inactive";
    return (
      <section className="request-card canonical-contacts-panel" aria-label={`${focusIdentity.full_name || focusIdentity.email || "Contact"} identity`}>
        <div className="directory-card__header">
          <div>
            <strong>{focusIdentity.full_name || focusIdentity.email || "Unnamed contact"}</strong>
            <div className="muted">
              {[focusIdentity.email, focusIdentity.phone].filter(Boolean).join(" · ") || "No contact info"}
              {focusIdentity.preferred_contact_method ? ` · prefers ${focusIdentity.preferred_contact_method}` : ""}
            </div>
          </div>
          <span className={`meta-pill ${archived ? "meta-pill--warning" : ""}`}>{archived ? "Archived — read-only" : "Active"}</span>
        </div>
        {archived ? <p className="muted">This person is archived. Their identity, relationships, and history stay readable; restore to make changes.</p> : null}
        {renderManagement(focusIdentity, archived)}
      </section>
    );
  }

  // ── List mode (default + urlBacked) ────────────────────────────────────────
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
        <input type="text" aria-label="Search people" placeholder="Search by name, email, or phone…" value={search} onChange={(e) => onSearchChange(e.target.value)} />
      </label>

      {urlBacked ? (
        <div className="directory-filter-row">
          <label className="directory-field">
            <span className="visually-hidden">Filter by role</span>
            <select
              aria-label="Filter by role"
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(0);
                syncUrl({ roleFilter: e.target.value, page: 0 });
              }}
            >
              <option value="">All roles</option>
              {ROLE_FILTER_OPTIONS.map((role) => (
                <option key={role} value={role}>{humanizeRole(role)}</option>
              ))}
            </select>
          </label>
          <label className="directory-field">
            <span className="visually-hidden">Filter by status</span>
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(0);
                syncUrl({ statusFilter: e.target.value, page: 0 });
              }}
            >
              <option value="active">Active</option>
              <option value="inactive">Archived</option>
              <option value="all">Active + archived</option>
            </select>
          </label>
          <label className="directory-field">
            <span className="visually-hidden">Filter by organization</span>
            <input
              aria-label="Filter by organization id"
              placeholder="Organization id…"
              value={orgFilter}
              onChange={(e) => {
                setOrgFilter(e.target.value.trim());
                setPage(0);
                syncUrl({ orgFilter: e.target.value.trim(), page: 0 });
              }}
            />
          </label>
        </div>
      ) : null}

      {error ? <div className="form-error" role="alert">{error}</div> : null}

      {loading ? (
        <div className="empty-state empty-state--panel">Loading contacts…</div>
      ) : !contacts.length ? (
        <div className="empty-state empty-state--panel">No contacts match.</div>
      ) : (
        <ul className="canonical-contacts-panel__list">
          {contacts.map((contact) => {
            const archived = contact.active_status === "inactive";
            return (
              <li key={contact.id} className="canonical-contacts-panel__item" aria-current={expandedId === contact.id ? "true" : undefined}>
                <button type="button" className="directory-link-button" aria-expanded={expandedId === contact.id} onClick={() => void toggleExpand(contact.id)}>
                  <span>
                    {contact.full_name || contact.email || "Unnamed contact"}
                    {archived ? <span className="meta-pill meta-pill--warning"> Archived</span> : null}
                    {contact.role_summary.length ? <span className="muted"> — {contact.role_summary.slice(0, 3).map(humanizeRole).join(", ")}</span> : null}
                  </span>
                  <span className="muted">
                    {[contact.email, contact.phone].filter(Boolean).join(" · ") || "No info"} · {contact.linked_organization_count} org{contact.linked_organization_count === 1 ? "" : "s"}
                  </span>
                </button>
                {urlBacked ? (
                  <button type="button" className="link-button" aria-label={`Open ${contact.full_name || contact.email || "contact"} full page`} onClick={() => (window.location.hash = `#directory/contacts/${contact.id}`)}>
                    Open
                  </button>
                ) : null}
                {expandedId === contact.id ? renderManagement(contact, archived) : null}
              </li>
            );
          })}
        </ul>
      )}

      {total > PAGE_SIZE ? (
        <div className="page-intro-actions page-intro-actions--compact">
          <button
            type="button"
            className="secondary-button"
            disabled={page === 0}
            onClick={() => {
              const next = Math.max(0, page - 1);
              setPage(next);
              syncUrl({ page: next });
            }}
          >
            Previous
          </button>
          <span className="muted">{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}</span>
          <button
            type="button"
            className="secondary-button"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => {
              const next = page + 1;
              setPage(next);
              syncUrl({ page: next });
            }}
          >
            Next
          </button>
        </div>
      ) : null}
    </section>
  );
}
