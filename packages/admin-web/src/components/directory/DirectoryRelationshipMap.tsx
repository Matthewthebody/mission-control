import { DirectoryAvatar } from "./DirectoryAvatar";

export type DirectoryRelationshipMapNode = {
  id: string;
  kind: "organization" | "contact" | "location" | "owner";
  label: string;
  subtitle?: string | null;
  badge?: string | null;
  imageUrl?: string | null;
};

export type DirectoryRelationshipMapEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
};

type Props = {
  title?: string;
  subtitle?: string;
  nodes: DirectoryRelationshipMapNode[];
  edges: DirectoryRelationshipMapEdge[];
};

const LANE_ORDER: DirectoryRelationshipMapNode["kind"][] = ["owner", "organization", "contact", "location"];

const LANE_LABELS: Record<DirectoryRelationshipMapNode["kind"], string> = {
  owner: "Kemmetmueller",
  organization: "District / Account",
  contact: "Contacts",
  location: "Schools / Locations"
};

export function DirectoryRelationshipMap({
  title = "Relationship Map",
  subtitle = "See who owns the connection, who else knows the contact, and where the relationship lives operationally.",
  nodes,
  edges
}: Props) {
  const nodesByLane = new Map<DirectoryRelationshipMapNode["kind"], DirectoryRelationshipMapNode[]>();
  for (const lane of LANE_ORDER) {
    nodesByLane.set(lane, []);
  }
  for (const node of nodes) {
    const lane = nodesByLane.get(node.kind) ?? [];
    lane.push(node);
    nodesByLane.set(node.kind, lane);
  }

  const labelByNodeId = new Map(nodes.map((node) => [node.id, node.label]));

  return (
    <section className="request-card">
      <div className="directory-card__header">
        <div>
          <strong>{title}</strong>
          <div className="muted">{subtitle}</div>
        </div>
      </div>
      <div className="directory-map">
        <div className="directory-map__lanes">
          {LANE_ORDER.map((lane) => {
            const laneNodes = nodesByLane.get(lane) ?? [];
            return (
              <div key={lane} className="directory-map__lane">
                <div className="directory-map__lane-label">{LANE_LABELS[lane]}</div>
                {laneNodes.length ? (
                  laneNodes.map((node) => (
                    <article key={node.id} className={`directory-map-node directory-map-node--${node.kind}`}>
                      <div className="directory-map-node__identity">
                        <DirectoryAvatar
                          name={node.label}
                          imageUrl={node.imageUrl}
                          kind={node.kind === "organization" ? "organization" : "contact"}
                          size="sm"
                        />
                        <div>
                          <strong>{node.label}</strong>
                          {node.subtitle ? <div className="muted">{node.subtitle}</div> : null}
                        </div>
                      </div>
                      {node.badge ? <span className="meta-pill">{node.badge}</span> : null}
                    </article>
                  ))
                ) : (
                  <div className="empty-state empty-state--panel">No {LANE_LABELS[lane].toLowerCase()} nodes yet.</div>
                )}
              </div>
            );
          })}
        </div>
        <div className="directory-map__edges">
          {edges.length ? (
            edges.map((edge) => (
              <div key={edge.id} className="directory-map__edge">
                <span>{labelByNodeId.get(edge.from) ?? "Unknown"}</span>
                <span className="meta-pill">{edge.label}</span>
                <span>{labelByNodeId.get(edge.to) ?? "Unknown"}</span>
              </div>
            ))
          ) : (
            <div className="empty-state empty-state--panel">No relationship edges are confirmed for this view yet.</div>
          )}
        </div>
      </div>
    </section>
  );
}
