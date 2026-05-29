import { ShootStaffingCommand } from "./ShootStaffingCommand";
import type { ShootStaffingSnapshot } from "../types";

type Props = {
  token: string;
  shootId: string | null;
  open: boolean;
  canPublish: boolean;
  onClose: () => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onUpdated?: (snapshot: ShootStaffingSnapshot) => void;
};

export function ShootStaffingDrawer({ token, shootId, open, canPublish, onClose, onNotice, onError, onUpdated }: Props) {
  if (!open) {
    return null;
  }

  return (
    <div className="drawer-overlay staffing-drawer-overlay" onClick={onClose}>
      <aside className="panel staffing-drawer drawer-overlay__content" onClick={(event) => event.stopPropagation()}>
        <ShootStaffingCommand
          token={token}
          shootId={shootId}
          canPublish={canPublish}
          onClose={onClose}
          onNotice={onNotice}
          onError={onError}
          onUpdated={onUpdated}
          className="shoot-staffing-command"
        />
      </aside>
    </div>
  );
}
