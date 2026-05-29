import type { ConciergeRecentSearch } from "../../conciergeTypes";

type Props = {
  recentSearches: ConciergeRecentSearch[];
  activeIndex: number;
  onActivate: (index: number) => void;
  onApply: (query: string) => void;
};

function formatRecentTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Recent search";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function ConciergeRecentSearchList({ recentSearches, activeIndex, onActivate, onApply }: Props) {
  if (!recentSearches.length) {
    return null;
  }

  return (
    <div className="concierge-recent-list" aria-label="Recent searches">
      {recentSearches.map((recent, index) => (
        <button
          key={recent.id}
          type="button"
          className={`concierge-recent-row${index === activeIndex ? " is-active" : ""}`}
          onClick={() => onApply(recent.query)}
          onMouseEnter={() => onActivate(index)}
          onFocus={() => onActivate(index)}
        >
          <span className="concierge-recent-row__label">{recent.query}</span>
          <span className="concierge-recent-row__meta">{formatRecentTimestamp(recent.last_used_at)}</span>
        </button>
      ))}
    </div>
  );
}
