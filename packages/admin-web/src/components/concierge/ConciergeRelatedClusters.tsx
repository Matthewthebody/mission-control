import type { ConciergeResultCluster, ConciergeSearchResult } from "../../conciergeTypes";

type Props = {
  clusters: ConciergeResultCluster[];
  onOpen: (result: ConciergeSearchResult) => void;
  onActivate: (result: ConciergeSearchResult) => void;
};

function entityLabel(entityType: ConciergeSearchResult["entity_type"]) {
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

export function ConciergeRelatedClusters({ clusters, onOpen, onActivate }: Props) {
  if (!clusters.length) {
    return null;
  }

  return (
    <section className="concierge-cluster-grid" aria-label="Related context">
      {clusters.map((cluster) => (
        <article key={cluster.id} className={`concierge-cluster-card concierge-tone concierge-tone--${cluster.tone}`}>
          <div className="concierge-cluster-card__title">{cluster.title}</div>
          <div className="concierge-cluster-card__summary">{cluster.summary}</div>
          <div className="concierge-cluster-card__list">
            {cluster.results.map((result) => (
              <button
                key={`${cluster.id}-${result.search_index_id}`}
                type="button"
                className="concierge-cluster-card__item"
                onClick={() => onOpen(result)}
                onMouseEnter={() => onActivate(result)}
                onFocus={() => onActivate(result)}
              >
                <span className="concierge-cluster-card__item-type">{entityLabel(result.entity_type)}</span>
                <span className="concierge-cluster-card__item-title">{result.title}</span>
                {result.status ? <span className="concierge-cluster-card__item-status">{result.status.replace(/_/g, " ")}</span> : null}
              </button>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
