import type { SharedJobActivityEntry } from "../../jobTruthTypes";
import { formatDateTime } from "../sports/SportsPrimitives";

type Props = {
  entries: SharedJobActivityEntry[];
  limit?: number;
};

export function ActivityTimelineList({ entries, limit }: Props) {
  const items = typeof limit === "number" ? entries.slice(0, limit) : entries;

  return (
    <div className="shared-job-detail__timeline">
      {items.map((entry) => (
        <div key={entry.id} className="shared-job-detail__timeline-entry">
          <strong>{entry.action_label || entry.event_type}</strong>
          <span>{entry.summary}</span>
          {entry.detail ? <span>{entry.detail}</span> : null}
          <span>{entry.actor_name ?? "System"} | {formatDateTime(entry.created_at)}</span>
        </div>
      ))}
    </div>
  );
}
