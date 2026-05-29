import { ChecklistTemplateWorkspace } from "../components/checklists/ChecklistTemplateWorkspace";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

export function ChecklistTemplatesPage({ token, currentUser }: Props) {
  return <ChecklistTemplateWorkspace token={token} currentUser={currentUser} />;
}
