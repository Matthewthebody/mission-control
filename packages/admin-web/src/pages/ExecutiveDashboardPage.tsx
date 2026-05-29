import { ExecutiveDashboardShell } from "../components/jobs/SharedJobCommandCenter";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

export function ExecutiveDashboardPage({ token, currentUser }: Props) {
  return (
    <ExecutiveDashboardShell
      token={token}
      currentUser={currentUser}
      scope="executive"
      title="Executive Dashboard"
      summary="Cross-department operational health, urgent risk, blocked work, and workload pressure in one leadership command surface."
    />
  );
}

