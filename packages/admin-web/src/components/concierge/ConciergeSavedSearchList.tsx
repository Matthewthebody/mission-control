import type { ConciergeSavedSearch } from "../../conciergeTypes";

type Props = {
  savedSearches: ConciergeSavedSearch[];
  activeIndexOffset: number;
  activeIndex: number;
  onActivate: (index: number) => void;
  onApply: (savedSearch: ConciergeSavedSearch) => void;
  onTogglePin: (savedSearch: ConciergeSavedSearch) => void;
  onDelete: (savedSearch: ConciergeSavedSearch) => void;
};

function formatSavedTimestamp(value: string | null) {
  if (!value) {
    return "Saved";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Saved";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function ConciergeSavedSearchList({
  savedSearches,
  activeIndexOffset,
  activeIndex,
  onActivate,
  onApply,
  onTogglePin,
  onDelete
}: Props) {
  if (!savedSearches.length) {
    return null;
  }

  return (
    <div className="concierge-saved-list" aria-label="Saved searches">
      <div className="concierge-saved-list__header">
        <strong>Pinned & Saved Searches</strong>
        <span>{savedSearches.length}</span>
      </div>
      {savedSearches.map((savedSearch, index) => {
        const itemIndex = activeIndexOffset + index;
        return (
          <div
            key={savedSearch.id}
            className={`concierge-saved-row${itemIndex === activeIndex ? " is-active" : ""}`}
            onMouseEnter={() => onActivate(itemIndex)}
          >
            <button type="button" className="concierge-saved-row__apply" onClick={() => onApply(savedSearch)}>
              <span className="concierge-saved-row__name">{savedSearch.name}</span>
              <span className="concierge-saved-row__query">{savedSearch.query}</span>
              <span className="concierge-saved-row__meta">
                {savedSearch.pinned ? "Pinned" : "Saved"} | {formatSavedTimestamp(savedSearch.last_used_at)}
              </span>
            </button>
            <div className="concierge-saved-row__actions">
              <button type="button" className="secondary-button" onClick={() => onTogglePin(savedSearch)}>
                {savedSearch.pinned ? "Unpin" : "Pin"}
              </button>
              <button type="button" className="secondary-button" onClick={() => onDelete(savedSearch)}>
                Remove
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
