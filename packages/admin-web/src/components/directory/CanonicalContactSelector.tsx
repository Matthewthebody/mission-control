import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError } from "../../api";
import type { CanonicalContactListItem } from "../../types";
import { createCanonicalContactRecord, listCanonicalContacts, type CanonicalContactCreateInput } from "../../services/organizationApi";

// Phase 4.2 Part 2 — the one shared, reusable canonical Contact selector used by Create
// Organization, Organization detail relationship management, standalone linking, and Job
// Intake. It searches canonical Contact IDENTITIES (not org-bound rows) by name/email/phone,
// shows how many organizations each is already linked to, warns when a contact is already
// linked to the selected organization, and supports inline identity creation using the same
// canonical create endpoint (never a reduced second form). It never merges or creates a
// duplicate silently — the operator explicitly picks an existing person or creates a new one.

type Props = {
  token: string;
  organizationId?: string | null;
  onSelect: (contact: CanonicalContactListItem) => void;
  disabled?: boolean;
  label?: string;
  // Deferred-create mode (atomic flows): when provided, the inline "Create & use" returns the
  // entered draft instead of persisting a new identity immediately, so the identity is created
  // inside the caller's single transaction (and rolls back with it). Same canonical validation.
  onCreateDraft?: (draft: CanonicalContactCreateInput) => void;
};

export function CanonicalContactSelector({ token, organizationId, onSelect, disabled, label, onCreateDraft }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CanonicalContactListItem[]>([]);
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createForm, setCreateForm] = useState<CanonicalContactCreateInput>({ first_name: "", last_name: "", email: "", phone: "" });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(
    async (term: string) => {
      setLoading(true);
      setError("");
      try {
        const response = await listCanonicalContacts(token, { search: term });
        setResults(response.contacts);
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : "We couldn't search contacts right now.");
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  // When an organization is in context, fetch the set already linked there to badge them.
  useEffect(() => {
    if (!organizationId) {
      setLinkedIds(new Set());
      return;
    }
    let cancelled = false;
    void listCanonicalContacts(token, { organizationId, limit: 100 })
      .then((response) => {
        if (!cancelled) setLinkedIds(new Set(response.contacts.map((c) => c.id)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, organizationId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Only hit the network for a real query — an empty selector makes no call (and never leaks an
    // on-mount fetch into the page that embeds it).
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => void search(query.trim()), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  const submitCreate = useCallback(async () => {
    const hasName = Boolean((createForm.first_name ?? "").trim() || (createForm.last_name ?? "").trim() || (createForm.full_name ?? "").trim());
    if (!hasName && !(createForm.email ?? "").trim()) {
      setError("A new contact needs at least a name or an email.");
      return;
    }
    // Deferred mode — hand the validated draft back; the caller creates it in its own transaction.
    if (onCreateDraft) {
      onCreateDraft({ ...createForm });
      setCreating(false);
      setCreateForm({ first_name: "", last_name: "", email: "", phone: "" });
      return;
    }
    setCreateBusy(true);
    setError("");
    try {
      const response = await createCanonicalContactRecord(token, createForm);
      const created: CanonicalContactListItem = { ...response.contact, linked_organization_count: 0, role_summary: [] };
      onSelect(created);
      setCreating(false);
      setCreateForm({ first_name: "", last_name: "", email: "", phone: "" });
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "We couldn't create that contact.");
    } finally {
      setCreateBusy(false);
    }
  }, [createForm, onSelect, token]);

  return (
    <div className="canonical-contact-selector">
      <label className="directory-field">
        <span>{label ?? "Find a person"}</span>
        <input
          type="text"
          aria-label="Search canonical contacts"
          placeholder="Search by name, email, or phone…"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {error ? <div className="form-error" role="alert">{error}</div> : null}

      {loading ? (
        <p className="muted">Searching people…</p>
      ) : results.length ? (
        <ul className="canonical-contact-selector__results" role="listbox" aria-label="Canonical contacts">
          {results.map((contact) => {
            const alreadyLinked = linkedIds.has(contact.id);
            return (
              <li key={contact.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="canonical-contact-selector__option"
                  disabled={disabled}
                  onClick={() => onSelect(contact)}
                >
                  <span className="canonical-contact-selector__name">
                    {contact.full_name || contact.email || "Unnamed contact"}
                    {alreadyLinked ? <span className="meta-pill meta-pill--warning">Already linked here</span> : null}
                  </span>
                  <span className="muted">
                    {[contact.email, contact.phone].filter(Boolean).join(" · ") || "No contact info"} ·{" "}
                    {contact.linked_organization_count} org{contact.linked_organization_count === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : query.trim() ? (
        <p className="muted">No matching people. Create a new contact below.</p>
      ) : null}

      {!disabled ? (
        creating ? (
          <div className="canonical-contact-selector__create">
            <div className="service-term-form-grid">
              <label>
                First name
                <input aria-label="New contact first name" value={createForm.first_name ?? ""} onChange={(e) => setCreateForm((p) => ({ ...p, first_name: e.target.value }))} />
              </label>
              <label>
                Last name
                <input aria-label="New contact last name" value={createForm.last_name ?? ""} onChange={(e) => setCreateForm((p) => ({ ...p, last_name: e.target.value }))} />
              </label>
              <label>
                Email
                <input type="email" aria-label="New contact email" value={createForm.email ?? ""} onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))} />
              </label>
              <label>
                Phone
                <input aria-label="New contact phone" value={createForm.phone ?? ""} onChange={(e) => setCreateForm((p) => ({ ...p, phone: e.target.value }))} />
              </label>
            </div>
            <div className="page-intro-actions page-intro-actions--compact">
              <button type="button" disabled={createBusy} onClick={() => void submitCreate()}>
                Create &amp; use
              </button>
              <button type="button" className="secondary-button" disabled={createBusy} onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="secondary-button" onClick={() => setCreating(true)}>
            + New person
          </button>
        )
      ) : null}
    </div>
  );
}
