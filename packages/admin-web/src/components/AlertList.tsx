import { OperationalPreviewCard } from "./OperationalPreviewCard";
import type { AlertRecord } from "../types";

type Props = {
  alerts: AlertRecord[];
  selectedAlertId: string;
  onSelect: (alertId: string) => void;
};

export function AlertList({ alerts, selectedAlertId, onSelect }: Props) {
  return (
    <div className="ops-preview-list">
      {alerts.map((alert) => {
        const isResolved = alert.status === "resolved";
        return (
          <OperationalPreviewCard
            key={alert.id}
            eyebrow={alert.shoot_code ? `Shoot ${alert.shoot_code}` : "Operational Alert"}
            title={humanizeAlertLabel(alert.alert_type)}
            summary={alert.message}
            statusLabel={isResolved ? "Resolved" : "Open"}
            statusTone={isResolved ? "success" : "critical"}
            meta={[{ label: new Date(alert.created_at).toLocaleString() }]}
            nextAction={isResolved ? "Review history" : "Resolve or escalate"}
            selected={selectedAlertId === alert.id}
            onClick={() => onSelect(alert.id)}
          />
        );
      })}
    </div>
  );
}

function humanizeAlertLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}
