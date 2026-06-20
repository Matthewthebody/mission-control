import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError } from "../../api";
import type { CanonicalDistrictOption } from "../../types";
import { listCanonicalDistricts } from "../../services/organizationApi";

// Phase 4 Slice 5 — searchable canonical Parent-District selector. Replaces the unwired
// `districtOptions` prop: it loads canonical Districts (client_entity_kind='parent_organization')
// from the server, name-searchable, so a School can be attached to the real District record
// instead of a free-text guess. A District is a canonical organization, never a notes string.

type Props = {
  token: string;
  value: string;
  initialName?: string | null;
  disabled?: boolean;
  onChange: (districtId: string, districtName: string | null) => void;
};

export function ParentDistrictSelector({ token, value, initialName, disabled, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CanonicalDistrictOption[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(initialName ?? null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Keep the display name in sync if the caller seeds/changes it (e.g. opening edit).
    setSelectedName(initialName ?? null);
  }, [initialName, value]);

  const runSearch = useCallback(
    async (searchTerm: string) => {
      setLoading(true);
      setError("");
      try {
        const response = await listCanonicalDistricts(token, searchTerm);
        setResults(response.districts);
      } catch (loadError) {
        setError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load districts right now.");
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  const openAndLoad = useCallback(() => {
    setOpen(true);
    void runSearch(query.trim());
  }, [query, runSearch]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      void runSearch(query.trim());
    }, 200);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, open, runSearch]);

  const choose = useCallback(
    (district: CanonicalDistrictOption | null) => {
      if (district) {
        setSelectedName(district.display_name);
        onChange(district.id, district.display_name);
      } else {
        setSelectedName(null);
        onChange("", null);
      }
      setOpen(false);
      setQuery("");
    },
    [onChange]
  );

  return (
    <div className="parent-district-selector">
      <div className="parent-district-selector__current">
        <span className="parent-district-selector__value">
          {value ? selectedName ?? "Selected district" : "No parent district"}
        </span>
        {value && !disabled ? (
          <button type="button" className="secondary-button" onClick={() => choose(null)}>
            Clear
          </button>
        ) : null}
        {!disabled ? (
          <button type="button" className="secondary-button" onClick={() => (open ? setOpen(false) : openAndLoad())} aria-expanded={open}>
            {open ? "Close" : value ? "Change district" : "Choose district"}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="parent-district-selector__panel">
          <input
            type="text"
            className="parent-district-selector__search"
            placeholder="Search districts by name…"
            aria-label="Search parent districts"
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {loading ? (
            <p className="muted">Searching districts…</p>
          ) : results.length ? (
            <ul className="parent-district-selector__results" role="listbox" aria-label="Parent district results">
              {results.map((district) => (
                <li key={district.id} role="option" aria-selected={district.id === value}>
                  <button type="button" className="parent-district-selector__option" onClick={() => choose(district)}>
                    <span>{district.display_name}</span>
                    <span className="muted">
                      {district.child_organization_count} school{district.child_organization_count === 1 ? "" : "s"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No matching districts. Create the District first, then attach the school.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
