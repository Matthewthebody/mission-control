type OperationsLaneTone = "neutral" | "info" | "warning";

export type OperationsLaneCard = {
  id: string;
  label: string;
  summary: string;
  active?: boolean;
  badge?: string | null;
  tone?: OperationsLaneTone;
  onClick: () => void;
};

export type OperationsLaneLink = {
  id: string;
  label: string;
  onClick: () => void;
};

type Props = {
  eyebrow?: string;
  title: string;
  summary: string;
  lanes: OperationsLaneCard[];
  links?: OperationsLaneLink[];
};

export function OperationsLaneStrip({
  eyebrow = "Operations Workspace",
  title,
  summary,
  lanes,
  links = []
}: Props) {
  return (
    <section className="panel operations-lane-strip">
      <div className="operations-lane-strip__header">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <div className="section-title">{title}</div>
          <p className="section-subtitle">{summary}</p>
        </div>
      </div>

      <div className="operations-lane-grid">
        {lanes.map((lane) => (
          <button
            key={lane.id}
            type="button"
            className={`operations-lane-card operations-lane-card--${lane.tone ?? "neutral"}${lane.active ? " is-active" : ""}`}
            onClick={lane.onClick}
          >
            <div className="operations-lane-card__meta">
              <strong>{lane.label}</strong>
              {lane.badge ? <span className="meta-pill">{lane.badge}</span> : null}
            </div>
            <p>{lane.summary}</p>
          </button>
        ))}
      </div>

      {links.length ? (
        <div className="operations-lane-links" aria-label="Related operations links">
          {links.map((link) => (
            <button key={link.id} type="button" className="home-filter-chip" onClick={link.onClick}>
              {link.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
