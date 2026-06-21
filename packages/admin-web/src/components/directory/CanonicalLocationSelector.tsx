import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError } from "../../api";
import type { DirectoryLocationSummary } from "../../types";
import { listDirectoryLocations } from "../../services/organizationApi";

// Phase 4.2 Part 3 — the shared canonical Location selector used by Create Organization (and any
// flow that attaches a Location). It searches existing directory Locations by name/address, warns
// on an exact normalized-address match so the operator reuses the existing place instead of
// creating a duplicate, and supports inline creation of a brand-new Location. Locations are
// org-bound, so "reuse" copies the canonical address into the new organization's own row — it never
// fuzzy-merges and never re-parents another organization's Location. Room/access phrases (gym,
// auditorium) belong in the per-location notes, not as separate Locations.

export type LocationSelection = {
  existing_location_id?: string | null;
  location_name: string;
  address_line_1: string;
  address_line_2?: string | null;
  city: string;
  state: string;
  zip: string;
  notes?: string | null;
};

type Props = {
  token: string;
  onSelect: (location: LocationSelection) => void;
  disabled?: boolean;
  label?: string;
};

const normalizeAddress = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

export function CanonicalLocationSelector({ token, onSelect, disabled, label }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryLocationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ location_name: "", address_line_1: "", address_line_2: "", city: "", state: "", zip: "", notes: "" });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(
    async (term: string) => {
      setLoading(true);
      setError("");
      try {
        const response = await listDirectoryLocations(token, { search: term });
        setResults(response.locations);
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : "We couldn't search locations right now.");
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
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

  // Exact normalized-address match between the inline draft and an existing Location → offer reuse.
  const inlineMatch = creating && form.address_line_1.trim()
    ? results.find((loc) => normalizeAddress(loc.address_line_1 ?? "") === normalizeAddress(form.address_line_1))
    : undefined;

  const submitInline = useCallback(() => {
    if (!form.location_name.trim() || !form.address_line_1.trim()) {
      setError("A new location needs a name and a street address.");
      return;
    }
    onSelect({
      location_name: form.location_name.trim(),
      address_line_1: form.address_line_1.trim(),
      address_line_2: form.address_line_2.trim() || null,
      city: form.city.trim(),
      state: form.state.trim(),
      zip: form.zip.trim(),
      notes: form.notes.trim() || null
    });
    setForm({ location_name: "", address_line_1: "", address_line_2: "", city: "", state: "", zip: "", notes: "" });
    setCreating(false);
    setQuery("");
  }, [form, onSelect]);

  return (
    <div className="canonical-location-selector">
      <label className="directory-field">
        <span>{label ?? "Find a location"}</span>
        <input
          type="text"
          aria-label="Search canonical locations"
          placeholder="Search by name or address…"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {error ? <div className="form-error" role="alert">{error}</div> : null}

      {loading ? (
        <p className="muted">Searching locations…</p>
      ) : results.length ? (
        <ul className="canonical-contact-selector__results" role="listbox" aria-label="Canonical locations">
          {results.map((loc) => (
            <li key={loc.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="canonical-contact-selector__option"
                disabled={disabled}
                onClick={() =>
                  onSelect({
                    existing_location_id: loc.id,
                    location_name: loc.location_name,
                    address_line_1: loc.address_line_1 ?? "",
                    address_line_2: loc.address_line_2,
                    city: loc.city ?? "",
                    state: loc.state ?? "",
                    zip: loc.zip ?? ""
                  })
                }
              >
                <span className="canonical-contact-selector__name">{loc.location_name}</span>
                <span className="muted">
                  {[loc.address_line_1, loc.city, loc.state].filter(Boolean).join(", ") || "No address"} · {loc.organization_display_name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim() ? (
        <p className="muted">No matching locations. Create a new one below.</p>
      ) : null}

      {!disabled ? (
        creating ? (
          <div className="canonical-contact-selector__create">
            <div className="service-term-form-grid">
              <label>Location name<input aria-label="New location name" value={form.location_name} onChange={(e) => setForm((p) => ({ ...p, location_name: e.target.value }))} /></label>
              <label>Street address<input aria-label="New location address" value={form.address_line_1} onChange={(e) => setForm((p) => ({ ...p, address_line_1: e.target.value }))} /></label>
              <label>City<input aria-label="New location city" value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} /></label>
              <label>State<input aria-label="New location state" value={form.state} onChange={(e) => setForm((p) => ({ ...p, state: e.target.value }))} /></label>
              <label>ZIP<input aria-label="New location zip" value={form.zip} onChange={(e) => setForm((p) => ({ ...p, zip: e.target.value }))} /></label>
              <label className="directory-field--wide">Room / access notes<input aria-label="New location notes" placeholder="e.g. east gym, load-in at door 3" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} /></label>
            </div>
            {inlineMatch ? (
              <div className="form-warning" role="status">
                A location with this address already exists ({inlineMatch.location_name}).{" "}
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    onSelect({
                      existing_location_id: inlineMatch.id,
                      location_name: inlineMatch.location_name,
                      address_line_1: inlineMatch.address_line_1 ?? "",
                      address_line_2: inlineMatch.address_line_2,
                      city: inlineMatch.city ?? "",
                      state: inlineMatch.state ?? "",
                      zip: inlineMatch.zip ?? ""
                    })
                  }
                >
                  Use the existing location
                </button>
              </div>
            ) : null}
            <div className="page-intro-actions page-intro-actions--compact">
              <button type="button" onClick={submitInline}>Add location</button>
              <button type="button" className="secondary-button" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" className="secondary-button" onClick={() => setCreating(true)}>+ New location</button>
        )
      ) : null}
    </div>
  );
}
