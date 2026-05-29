import { SharedProductionPage as SharedProductionPageContent } from "../components/jobs/SharedJobProduction";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  departmentType: "schools" | "sports" | null;
  routeBase: string;
  title: string;
  summary: string;
};

export function SharedProductionPage({
  token,
  currentUser,
  departmentType,
  routeBase,
  title,
  summary
}: Props) {
  return (
    <SharedProductionPageContent
      token={token}
      currentUser={currentUser}
      departmentType={departmentType}
      routeBase={routeBase}
      title={title}
      summary={summary}
    />
  );
}
