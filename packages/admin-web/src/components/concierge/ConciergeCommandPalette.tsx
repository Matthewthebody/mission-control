import { useEffect, useMemo, useRef, useState } from "react";
import { ApiClientError } from "../../api";
import type {
  ConciergeRecentSearch,
  ConciergeSavedSearch,
  ConciergeSearchFilters,
  ConciergeSearchResponse,
  ConciergeSearchResult,
  ConciergeSearchSuggestion
} from "../../conciergeTypes";
import {
  createConciergeSavedSearch,
  deleteConciergeSavedSearch,
  getConciergeRecentSearches,
  getConciergeSavedSearches,
  getConciergeSuggestions,
  lookupConciergeResult,
  recordConciergeRecentSearch,
  searchConcierge,
  updateConciergeSavedSearch
} from "../../services/conciergeApi";
import { ConciergeAnswerCards } from "./ConciergeAnswerCards";
import { ConciergeFilterBar } from "./ConciergeFilterBar";
import { ConciergeGroupedResults } from "./ConciergeGroupedResults";
import { ConciergeRecentSearchList } from "./ConciergeRecentSearchList";
import { ConciergeRelatedClusters } from "./ConciergeRelatedClusters";
import { ConciergeSavedSearchList } from "./ConciergeSavedSearchList";

type Props = {
  token: string;
  open: boolean;
  mode: "overlay" | "page";
  mobile: boolean;
  initialQuery?: string;
  onClose?: () => void;
};

type InteractiveItem =
  | { kind: "saved"; savedSearch: ConciergeSavedSearch }
  | { kind: "recent"; recent: ConciergeRecentSearch }
  | { kind: "result"; result: ConciergeSearchResult };

const EMPTY_FILTERS: ConciergeSearchFilters = {
  department: null,
  entity_types: [],
  status: null,
  owner: null,
  assignee: null,
  org: null,
  date: null,
  risk: null,
  has_any: []
};

function trimQuery(value: string) {
  return value.trim();
}

function hasActiveFilters(filters: ConciergeSearchFilters) {
  return Boolean(
    filters.department ||
      filters.entity_types.length ||
      filters.status ||
      filters.owner ||
      filters.assignee ||
      filters.org ||
      filters.date ||
      filters.risk ||
      filters.has_any.length
  );
}

function flattenResults(response: ConciergeSearchResponse | null) {
  return response?.sections.flatMap((section) => section.results) ?? [];
}

function buildInteractiveItems(
  query: string,
  filters: ConciergeSearchFilters,
  response: ConciergeSearchResponse | null,
  savedSearches: ConciergeSavedSearch[],
  recents: ConciergeRecentSearch[]
) {
  if (trimQuery(query) || hasActiveFilters(filters)) {
    return flattenResults(response).map<InteractiveItem>((result) => ({ kind: "result", result }));
  }
  return [
    ...savedSearches.map<InteractiveItem>((savedSearch) => ({ kind: "saved", savedSearch })),
    ...recents.map<InteractiveItem>((recent) => ({ kind: "recent", recent }))
  ];
}

export function ConciergeCommandPalette({ token, open, mode, mobile, initialQuery = "", onClose }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState<ConciergeSearchFilters>(EMPTY_FILTERS);
  const [filterExpanded, setFilterExpanded] = useState(mode === "page");
  const [searchResponse, setSearchResponse] = useState<ConciergeSearchResponse | null>(null);
  const [recentSearches, setRecentSearches] = useState<ConciergeRecentSearch[]>([]);
  const [savedSearches, setSavedSearches] = useState<ConciergeSavedSearch[]>([]);
  const [suggestions, setSuggestions] = useState<ConciergeSearchSuggestion[]>([]);
  const [lookupBody, setLookupBody] = useState<string>("");
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);
  const [saveFormOpen, setSaveFormOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const trimmedQuery = trimQuery(query);
  const searchActive = Boolean(trimmedQuery || hasActiveFilters(filters));
  const interactiveItems = useMemo(
    () => buildInteractiveItems(query, filters, searchResponse, savedSearches, recentSearches),
    [filters, query, recentSearches, savedSearches, searchResponse]
  );
  const activeItem = interactiveItems[activeIndex] ?? null;
  const activeResult = activeItem?.kind === "result" ? activeItem.result : null;

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery(initialQuery);
  }, [initialQuery, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [open]);

  useEffect(() => {
    if (!(open && mode === "overlay")) {
      if (previouslyFocusedElementRef.current) {
        previouslyFocusedElementRef.current.focus();
        previouslyFocusedElementRef.current = null;
      }
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mode, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoadingRecent(true);
    setLoadingSaved(true);
    void Promise.all([getConciergeRecentSearches(token), getConciergeSavedSearches(token)])
      .then(([recentResponse, savedResponse]) => {
        if (!cancelled) {
          setRecentSearches(recentResponse.recent_searches);
          setSavedSearches(savedResponse.saved_searches);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecentSearches([]);
          setSavedSearches([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingRecent(false);
          setLoadingSaved(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, token]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (!searchActive) {
      setSuggestions([]);
      setSearchResponse(null);
      setLoadingSearch(false);
      setError("");
      return;
    }

    let cancelled = false;
    const request = {
      q: trimmedQuery || undefined,
      limit: 24,
      department: filters.department,
      entity_types: filters.entity_types,
      status: filters.status,
      owner: filters.owner,
      assignee: filters.assignee,
      org: filters.org,
      date: filters.date,
      risk: filters.risk,
      has_any: filters.has_any
    };

    const suggestionTimeout = window.setTimeout(() => {
      void getConciergeSuggestions(token, request)
        .then((response) => {
          if (!cancelled) {
            setSuggestions(response.suggestions);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSuggestions([]);
          }
        });
    }, 90);

    const searchTimeout = window.setTimeout(() => {
      setLoadingSearch(true);
      setError("");
      void searchConcierge(token, request)
        .then((response) => {
          if (!cancelled) {
            setSearchResponse(response);
            setFilters(response.applied_filters);
          }
        })
        .catch((loadError) => {
          if (!cancelled) {
            setError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load Concierge results right now.");
            setSearchResponse(null);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoadingSearch(false);
          }
        });
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(suggestionTimeout);
      window.clearTimeout(searchTimeout);
    };
  }, [filters, open, searchActive, token, trimmedQuery]);

  useEffect(() => {
    setActiveIndex(0);
  }, [trimmedQuery, filters, searchActive, searchResponse]);

  useEffect(() => {
    if (!searchActive) {
      setActiveIndex(0);
    }
  }, [recentSearches, savedSearches, searchActive]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (!activeResult) {
      setLookupBody("");
      return;
    }
    let cancelled = false;
    void lookupConciergeResult(token, activeResult.search_index_id)
      .then((response) => {
        if (!cancelled) {
          setLookupBody(response.result?.body ?? activeResult.body ?? "");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLookupBody(activeResult.body ?? "");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeResult, open, token]);

  async function openResult(result: ConciergeSearchResult) {
    try {
      await recordConciergeRecentSearch(token, {
        query: trimmedQuery || result.title,
        selected_search_index_id: result.search_index_id
      });
    } catch {
      // Recent-search persistence should never block navigation.
    }
    window.location.hash = result.deep_link;
    onClose?.();
  }

  function applyRecentSearch(queryText: string) {
    setQuery(queryText);
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(queryText.length, queryText.length);
    }, 0);
  }

  async function applySavedSearch(savedSearch: ConciergeSavedSearch) {
    setQuery(savedSearch.query);
    setFilters(savedSearch.filters);
    try {
      const response = await updateConciergeSavedSearch(token, savedSearch.id, { touch: true });
      setSavedSearches(response.saved_searches);
    } catch {
      // Keep the apply interaction fast even if the touch write fails.
    }
  }

  async function togglePin(savedSearch: ConciergeSavedSearch) {
    const response = await updateConciergeSavedSearch(token, savedSearch.id, {
      pinned: !savedSearch.pinned
    });
    setSavedSearches(response.saved_searches);
  }

  async function removeSavedSearch(savedSearch: ConciergeSavedSearch) {
    const response = await deleteConciergeSavedSearch(token, savedSearch.id);
    setSavedSearches(response.saved_searches);
  }

  async function saveCurrentSearch() {
    const nextName = saveName.trim();
    if (!nextName || !searchActive) {
      return;
    }
    setSavingSearch(true);
    try {
      const response = await createConciergeSavedSearch(token, {
        name: nextName,
        query: trimmedQuery || "Operational search",
        filters,
        pinned: true
      });
      setSavedSearches(response.saved_searches);
      setSaveFormOpen(false);
      setSaveName("");
    } finally {
      setSavingSearch(false);
    }
  }

  function openQuickAction(deepLink: string) {
    window.location.hash = deepLink;
    onClose?.();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && mode === "overlay") {
      event.preventDefault();
      onClose?.();
      return;
    }

    if (!interactiveItems.length) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % interactiveItems.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + interactiveItems.length) % interactiveItems.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const next = interactiveItems[activeIndex];
      if (!next) {
        return;
      }
      if (next.kind === "recent") {
        applyRecentSearch(next.recent.query);
        return;
      }
      if (next.kind === "saved") {
        void applySavedSearch(next.savedSearch);
        return;
      }
      void openResult(next.result);
    }
  }

  if (!open) {
    return null;
  }

  const containerClassName = mode === "overlay" ? `concierge-overlay${mobile ? " concierge-overlay--mobile" : ""}` : "concierge-page-surface";

  return (
    <div
      id={mode === "overlay" ? "concierge-command-palette" : undefined}
      className={containerClassName}
      role={mode === "overlay" ? "dialog" : undefined}
      aria-modal={mode === "overlay" ? "true" : undefined}
      aria-label="Kemmetmueller Concierge"
      onMouseDown={mode === "overlay" ? () => onClose?.() : undefined}
      onKeyDown={handleKeyDown}
    >
      <div className={`concierge-panel${mobile ? " concierge-panel--mobile" : ""}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="concierge-panel__header">
          <div>
            <div className="eyebrow">Kemmetmueller Concierge</div>
            <h2>{mode === "overlay" ? "Search the operating system" : "Operational Intelligence Search"}</h2>
          </div>
          <div className="concierge-panel__header-actions">
            {searchActive ? (
              <button type="button" className="secondary-button" onClick={() => setSaveFormOpen((current) => !current)}>
                Save Search
              </button>
            ) : null}
            {mode === "overlay" ? (
              <button type="button" className="secondary-button" onClick={onClose}>
                Close
              </button>
            ) : null}
          </div>
        </div>

        <div className="concierge-panel__searchbar">
          <input
            ref={inputRef}
            type="search"
            className="concierge-panel__input"
            value={query}
            placeholder="Ask Concierge anything..."
            onChange={(event) => setQuery(event.currentTarget.value)}
            aria-label="Ask Concierge anything"
            aria-describedby="concierge-search-help"
          />
          <div className="concierge-panel__shortcut">{mobile ? "Mobile" : "Cmd/Ctrl + K"}</div>
        </div>
        <div id="concierge-search-help" className="concierge-panel__assistive">
          Use arrow keys to move, Enter to open, and typed filters like type:, status:, department:, or has:notes.
        </div>

        <ConciergeFilterBar
          filters={filters}
          expanded={filterExpanded}
          onExpandedChange={setFilterExpanded}
          onChange={setFilters}
          compact={mobile}
        />

        {saveFormOpen ? (
          <div className="concierge-save-form">
            <input
              type="text"
              value={saveName}
              placeholder="Name this search"
              onChange={(event) => setSaveName(event.currentTarget.value)}
            />
            <button type="button" className="primary-button" onClick={() => void saveCurrentSearch()} disabled={savingSearch || !saveName.trim()}>
              {savingSearch ? "Saving..." : "Save"}
            </button>
          </div>
        ) : null}

        {suggestions.length > 0 && searchActive ? (
          <div className="concierge-suggestion-strip" aria-label="Suggestions">
            {suggestions.slice(0, 6).map((suggestion) =>
              suggestion.kind === "result" ? (
                <button key={`result-${suggestion.search_index_id}`} type="button" className="concierge-suggestion-chip" onClick={() => void openResult(suggestion)}>
                  {suggestion.title}
                </button>
              ) : suggestion.kind === "saved_search" ? (
                <button key={`saved-${suggestion.saved_search_id}`} type="button" className="concierge-suggestion-chip" onClick={() => void applySavedSearch(savedSearches.find((entry) => entry.id === suggestion.saved_search_id) ?? { id: suggestion.saved_search_id, name: suggestion.label, query: suggestion.query, filters: suggestion.filters, pinned: suggestion.pinned, created_at: "", updated_at: "", last_used_at: null })}>
                  {suggestion.label}
                </button>
              ) : (
                <button key={`recent-${suggestion.id}`} type="button" className="concierge-suggestion-chip" onClick={() => applyRecentSearch(suggestion.query)}>
                  {suggestion.label}
                </button>
              )
            )}
          </div>
        ) : null}

        <div className={`concierge-panel__body${activeResult && !mobile ? " has-preview" : ""}`}>
          <section className="concierge-panel__results" aria-busy={loadingSearch}>
            {!searchActive ? (
              <div className="concierge-blank-state">
                <div className="concierge-blank-state__title">Search records, notes, staffing, alerts, and post-shoot context from anywhere.</div>
                <div className="concierge-blank-state__copy">
                  Kemmetmueller Concierge now surfaces directory records, production work, field notes, checklist comments, staffing assignments, exception alerts, and post-shoot evaluations.
                </div>
                {(loadingRecent || loadingSaved) ? (
                  <div className="concierge-loading" role="status" aria-live="polite">
                    Loading saved and recent searches...
                  </div>
                ) : null}
                <ConciergeSavedSearchList
                  savedSearches={savedSearches}
                  activeIndexOffset={0}
                  activeIndex={activeIndex}
                  onActivate={setActiveIndex}
                  onApply={(savedSearch) => void applySavedSearch(savedSearch)}
                  onTogglePin={(savedSearch) => void togglePin(savedSearch)}
                  onDelete={(savedSearch) => void removeSavedSearch(savedSearch)}
                />
                <ConciergeRecentSearchList
                  recentSearches={recentSearches}
                  activeIndex={Math.max(0, activeIndex - savedSearches.length)}
                  onActivate={(index) => setActiveIndex(savedSearches.length + index)}
                  onApply={applyRecentSearch}
                />
              </div>
            ) : loadingSearch && !searchResponse ? (
              <div className="concierge-loading" role="status" aria-live="polite">
                Searching the dashboard...
              </div>
            ) : error ? (
              <div className="concierge-empty-state concierge-empty-state--error" role="status" aria-live="polite">
                {error}
              </div>
            ) : searchResponse && searchResponse.total_results === 0 && searchResponse.access_limited ? (
              <div className="concierge-empty-state" role="status" aria-live="polite">
                Matching records exist, but you do not currently have access to view them.
              </div>
            ) : searchResponse && searchResponse.total_results === 0 ? (
              <div className="concierge-empty-state" role="status" aria-live="polite">
                No records matched that search.
              </div>
            ) : (
              <>
                {searchResponse?.interpreted_intent ? (
                  <div className="concierge-intent-banner">
                    <strong>{searchResponse.interpreted_intent.kind.replace(/_/g, " ")}</strong>
                    <span>{searchResponse.interpreted_intent.rationale}</span>
                  </div>
                ) : null}
                <ConciergeAnswerCards cards={searchResponse?.answer_cards ?? []} onOpenDeepLink={openQuickAction} />
                <ConciergeRelatedClusters
                  clusters={searchResponse?.related_clusters ?? []}
                  onOpen={(nextResult) => void openResult(nextResult)}
                  onActivate={(nextResult) => {
                    const nextIndex = interactiveItems.findIndex(
                      (item) => item.kind === "result" && item.result.search_index_id === nextResult.search_index_id
                    );
                    if (nextIndex >= 0) {
                      setActiveIndex(nextIndex);
                    }
                  }}
                />
                <ConciergeGroupedResults
                  response={searchResponse}
                  activeResultId={activeResult?.search_index_id ?? null}
                  onOpen={(nextResult) => void openResult(nextResult)}
                  onActivate={(nextResult) => {
                    const nextIndex = interactiveItems.findIndex(
                      (item) => item.kind === "result" && item.result.search_index_id === nextResult.search_index_id
                    );
                    if (nextIndex >= 0) {
                      setActiveIndex(nextIndex);
                    }
                  }}
                />
              </>
            )}
          </section>

          {activeResult && !mobile ? (
            <aside className="concierge-panel__preview">
              <div className={`concierge-preview-card concierge-tone concierge-tone--${activeResult.tone}`}>
                <div className="concierge-preview-card__eyebrow">{activeResult.entity_type.replace(/_/g, " ")}</div>
                <h3>{activeResult.title}</h3>
                {activeResult.subtitle ? <p className="concierge-preview-card__subtitle">{activeResult.subtitle}</p> : null}
                {lookupBody ? <p className="concierge-preview-card__body">{lookupBody}</p> : activeResult.snippet ? <p className="concierge-preview-card__body">{activeResult.snippet}</p> : null}
                <div className="concierge-preview-card__meta">
                  {activeResult.status ? <span>Status: {activeResult.status.replace(/_/g, " ")}</span> : null}
                  {activeResult.org_name ? <span>Org: {activeResult.org_name}</span> : null}
                  {activeResult.primary_date ? <span>Date: {new Date(activeResult.primary_date).toLocaleString()}</span> : null}
                </div>
                <div className="concierge-preview-card__actions">
                  {activeResult.quick_actions.map((action) => (
                    <button
                      key={`${activeResult.search_index_id}-${action.key}`}
                      type="button"
                      className={action.key === "open" ? "primary-button" : "secondary-button"}
                      onClick={() => openQuickAction(action.deep_link)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
