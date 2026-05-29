import { Organizations } from "./Organizations";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

export function Contacts({ token, currentUser }: Props) {
  return <Organizations token={token} currentUser={currentUser} entryView="contacts" />;
}
