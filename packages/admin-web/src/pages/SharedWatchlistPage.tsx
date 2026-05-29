import { SharedExceptionsPage as SharedExceptionsSurface } from "../components/jobs/SharedJobCommandCenter";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  departmentType?: "schools" | "sports" | null;
  title?: string;
  summary?: string;
};

export function SharedExceptionsPage(props: Props) {
  return <SharedExceptionsSurface {...props} />;
}

/** @deprecated Use `SharedExceptionsPage`. */
export const SharedWatchlistPage = SharedExceptionsPage;
