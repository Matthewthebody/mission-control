import type { Socket } from "socket.io-client";
import { SharedAlertsCommandPage } from "../components/jobs/SharedJobCommandCenter";

type Props = {
  token: string;
  socket: Socket | null;
};

export function Alerts({ token }: Props) {
  return (
    <SharedAlertsCommandPage
      token={token}
      title="Notification Center"
      summary="Delivered alerts, escalations, and direct links into the work that needs attention now."
    />
  );
}

