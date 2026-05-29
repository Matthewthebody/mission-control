import type { ConciergeEntityType, ConciergeSearchResult } from "../../conciergeTypes";

type Props = {
  result: ConciergeSearchResult;
  active: boolean;
  onOpen: (result: ConciergeSearchResult) => void;
  onActivate: (result: ConciergeSearchResult) => void;
};

function entityLabel(entityType: ConciergeEntityType) {
  switch (entityType) {
    case "organization":
      return "Organization";
    case "contact":
      return "Contact";
    case "location":
      return "Location";
    case "shoot":
      return "Shoot";
    case "production_item":
      return "Production";
    case "task":
      return "Task";
    case "note":
      return "Note";
    case "comment":
      return "Comment";
    case "staffing_assignment":
      return "Staffing";
    case "urgent_watch_alert":
      return "Exceptions";
    case "post_shoot_evaluation":
      return "PSE";
    default:
      return "Record";
  }
}

function formatPrimaryDate(value: string | null) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function ConciergeResultRow({ result, active, onOpen, onActivate }: Props) {
  const formattedDate = formatPrimaryDate(result.primary_date);
  return (
    <button
      type="button"
      className={`concierge-result-row${active ? " is-active" : ""}`}
      onClick={() => onOpen(result)}
      onMouseEnter={() => onActivate(result)}
      onFocus={() => onActivate(result)}
    >
      <div className="concierge-result-row__content">
        <div className="concierge-result-row__heading">
          <span className={`concierge-result-row__entity concierge-tone concierge-tone--${result.tone}`}>{entityLabel(result.entity_type)}</span>
          {result.status ? <span className="concierge-result-row__status">{result.status.replace(/_/g, " ")}</span> : null}
        </div>
        <div className="concierge-result-row__title">{result.title}</div>
        {result.subtitle ? <div className="concierge-result-row__subtitle">{result.subtitle}</div> : null}
        {result.snippet ? <div className="concierge-result-row__snippet">{result.snippet}</div> : null}
        <div className="concierge-result-row__meta">
          {result.org_name ? <span>{result.org_name}</span> : null}
          {formattedDate ? <span>{formattedDate}</span> : null}
          {result.department && result.department !== "all" ? <span>{String(result.department).replace(/_/g, " ")}</span> : null}
          {result.has_alerts ? <span>Has alerts</span> : null}
          {result.has_staffing_gap ? <span>Staffing gap</span> : null}
        </div>
      </div>
      <span className="concierge-result-row__open">Open</span>
    </button>
  );
}
