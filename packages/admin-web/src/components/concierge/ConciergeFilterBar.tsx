import type {
  ConciergeDateFilter,
  ConciergeEntityType,
  ConciergeHasFilter,
  ConciergeSearchFilters
} from "../../conciergeTypes";

type Props = {
  filters: ConciergeSearchFilters;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onChange: (next: ConciergeSearchFilters) => void;
  compact?: boolean;
};

const ENTITY_OPTIONS: Array<{ value: ConciergeEntityType; label: string }> = [
  { value: "organization", label: "Organizations" },
  { value: "contact", label: "Contacts" },
  { value: "location", label: "Locations" },
  { value: "shoot", label: "Shoots" },
  { value: "production_item", label: "Production" },
  { value: "task", label: "Tasks" },
  { value: "note", label: "Notes" },
  { value: "comment", label: "Comments" },
  { value: "staffing_assignment", label: "Staffing" },
  { value: "urgent_watch_alert", label: "Exceptions" },
  { value: "post_shoot_evaluation", label: "Post-Shoot Evaluations" }
];

const DEPARTMENT_OPTIONS = ["schools", "sports", "production", "photography", "operations", "corporate", "headshots", "other"] as const;
const DATE_OPTIONS: Array<{ value: ConciergeDateFilter; label: string }> = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "next_24h", label: "Next 24 Hours" },
  { value: "next_7d", label: "Next 7 Days" },
  { value: "overdue", label: "Overdue" }
];
const HAS_OPTIONS: Array<{ value: ConciergeHasFilter; label: string }> = [
  { value: "notes", label: "Has Notes" },
  { value: "alerts", label: "Has Alerts" },
  { value: "staffing_gap", label: "Has Staffing Gap" }
];

function humanize(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ") : "";
}

function withValue<T>(current: ConciergeSearchFilters, key: keyof ConciergeSearchFilters, value: T) {
  return {
    ...current,
    [key]: value
  };
}

export function ConciergeFilterBar({ filters, expanded, onExpandedChange, onChange, compact = false }: Props) {
  return (
    <div className={`concierge-filter-bar${compact ? " is-compact" : ""}`}>
      <div className="concierge-filter-bar__header">
        <button type="button" className="secondary-button" onClick={() => onExpandedChange(!expanded)}>
          {expanded ? "Hide Filters" : "Show Filters"}
        </button>
      </div>
      {expanded ? (
        <div className="concierge-filter-bar__grid">
          <label className="filter-field">
            <span>Type</span>
            <select
              value={filters.entity_types[0] ?? ""}
              onChange={(event) =>
                onChange(
                  withValue(
                    filters,
                    "entity_types",
                    event.currentTarget.value ? [event.currentTarget.value as ConciergeEntityType] : []
                  )
                )
              }
            >
              <option value="">All types</option>
              {ENTITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Department</span>
            <select
              value={filters.department ?? ""}
              onChange={(event) => onChange(withValue(filters, "department", event.currentTarget.value || null))}
            >
              <option value="">All departments</option>
              {DEPARTMENT_OPTIONS.map((department) => (
                <option key={department} value={department}>
                  {humanize(department)}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Status</span>
            <input
              type="text"
              value={filters.status ?? ""}
              placeholder="blocked, overdue..."
              onChange={(event) => onChange(withValue(filters, "status", event.currentTarget.value || null))}
            />
          </label>
          <label className="filter-field">
            <span>Owner</span>
            <input
              type="text"
              value={filters.owner ?? ""}
              placeholder="Owner name"
              onChange={(event) => onChange(withValue(filters, "owner", event.currentTarget.value || null))}
            />
          </label>
          <label className="filter-field">
            <span>Assignee</span>
            <input
              type="text"
              value={filters.assignee ?? ""}
              placeholder="Assignee name"
              onChange={(event) => onChange(withValue(filters, "assignee", event.currentTarget.value || null))}
            />
          </label>
          <label className="filter-field">
            <span>Organization</span>
            <input
              type="text"
              value={filters.org ?? ""}
              placeholder="School or account"
              onChange={(event) => onChange(withValue(filters, "org", event.currentTarget.value || null))}
            />
          </label>
          <label className="filter-field">
            <span>Date</span>
            <select
              value={filters.date ?? ""}
              onChange={(event) => onChange(withValue(filters, "date", (event.currentTarget.value as ConciergeDateFilter) || null))}
            >
              <option value="">Any date</option>
              {DATE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Risk</span>
            <input
              type="text"
              value={filters.risk ?? ""}
              placeholder="critical, high..."
              onChange={(event) => onChange(withValue(filters, "risk", event.currentTarget.value || null))}
            />
          </label>
          <div className="concierge-filter-bar__toggles">
            {HAS_OPTIONS.map((option) => {
              const active = filters.has_any.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`concierge-filter-chip${active ? " is-active" : ""}`}
                  onClick={() =>
                    onChange(
                      withValue(
                        filters,
                        "has_any",
                        active ? filters.has_any.filter((entry) => entry !== option.value) : [...filters.has_any, option.value]
                      )
                    )
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="concierge-filter-bar__chips">
        {filters.entity_types[0] ? <span className="concierge-filter-chip is-active">type:{filters.entity_types[0]}</span> : null}
        {filters.department ? <span className="concierge-filter-chip is-active">department:{filters.department}</span> : null}
        {filters.status ? <span className="concierge-filter-chip is-active">status:{filters.status}</span> : null}
        {filters.owner ? <span className="concierge-filter-chip is-active">owner:{filters.owner}</span> : null}
        {filters.assignee ? <span className="concierge-filter-chip is-active">assignee:{filters.assignee}</span> : null}
        {filters.org ? <span className="concierge-filter-chip is-active">org:{filters.org}</span> : null}
        {filters.date ? <span className="concierge-filter-chip is-active">date:{filters.date}</span> : null}
        {filters.risk ? <span className="concierge-filter-chip is-active">risk:{filters.risk}</span> : null}
        {filters.has_any.map((entry) => (
          <span key={entry} className="concierge-filter-chip is-active">
            has:{entry.replace(/_/g, "-")}
          </span>
        ))}
      </div>
    </div>
  );
}
