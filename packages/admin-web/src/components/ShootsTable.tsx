import type { ShootSummary } from "../types";

type Props = {
  shoots: ShootSummary[];
  onSelect: (shoot: ShootSummary) => void;
};

export function ShootsTable({ shoots, onSelect }: Props) {
  return (
    <table className="shoots-table">
      <thead>
        <tr>
          <th align="left">Code</th>
          <th align="left">Title</th>
          <th align="left">Projected</th>
          <th align="left">Scheduled</th>
          <th align="left">Clocked In</th>
          <th align="left">Arrival</th>
          <th align="left">Status</th>
          <th align="left">Latest Activity</th>
        </tr>
      </thead>
      <tbody>
        {shoots.map((shoot) => (
          <tr key={shoot.id} className="shoots-row" onClick={() => onSelect(shoot)}>
            <td data-label="Code">
              <div className="shoot-code">
                <strong>{shoot.shoot_code}</strong>
                <span className="muted">Open shoot workspace</span>
              </div>
            </td>
            <td data-label="Title">{shoot.title}</td>
            <td data-label="Projected">{shoot.projected_students ?? 0}</td>
            <td data-label="Scheduled">{shoot.scheduled_employee_count ?? 0}</td>
            <td data-label="Clocked In">{shoot.clocked_in_employee_count ?? 0}</td>
            <td data-label="Arrival">{formatOptionalTime(shoot.arrival_time)}</td>
            <td data-label="Status">
              <span className="badge-pill">{shoot.status}</span>
            </td>
            <td data-label="Latest Activity">
              {shoot.latest_event_type ? (
                <div className="activity-line">
                  <span>{shoot.latest_event_type}</span>
                  <span className="muted">at {formatOptionalTime(shoot.latest_event_at)}</span>
                </div>
              ) : (
                <span className="empty-state">No events yet</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatOptionalTime(value?: string | null) {
  return value ? new Date(value).toLocaleTimeString() : "TBD";
}
