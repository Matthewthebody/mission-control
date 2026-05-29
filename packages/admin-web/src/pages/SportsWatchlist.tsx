import { SharedExceptionsPage } from "./SharedWatchlistPage";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

export function SportsWatchlist({ token, currentUser }: Props) {
  return (
    <SharedExceptionsPage
      token={token}
      currentUser={currentUser}
      departmentType="sports"
      title="Sports Exceptions"
      summary="Urgent sports exceptions for staffing volatility, proof delays, specialty product pressure, and same-day gaps in one shared operational queue."
    />
  );
}
