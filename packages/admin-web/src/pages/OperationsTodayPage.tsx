import { RoleAwareHomeDashboard } from "../components/jobs/SharedJobCommandCenter";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  departmentType?: "schools" | "sports" | null;
};

export function OperationsTodayPage({ token, currentUser, departmentType = null }: Props) {
  return (
    <RoleAwareHomeDashboard
      token={token}
      currentUser={currentUser}
      scope="today"
      departmentType={departmentType}
      title={departmentType ? `${departmentType === "schools" ? "Schools" : "Sports"} Today` : "Operations Today"}
      summary="Live same-day operational visibility for readiness, staffing gaps, lead confirmations, exceptions, and downstream risk that affects today."
    />
  );
}
