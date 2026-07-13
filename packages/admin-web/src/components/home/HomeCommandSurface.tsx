import { useEffect, useState, type FormEvent } from "react";
import type { Socket } from "socket.io-client";
import type { SessionUser } from "../../types";
import { WorkspacePageHeader } from "../workspace/WorkspacePageHeader";
import {
  defaultHomeRoleForUser,
  getHomeRole,
  isHomeRoleId,
  type HomeRoleId
} from "../../home/homeRoles";
import { RolePreviewSwitcher } from "../../home/RolePreviewSwitcher";
import { CompanyCommandHome } from "../../home/CompanyCommandHome";
import { MyWork } from "../../pages/MyWork";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
  onOpenConcierge?: (initialQuery?: string) => void;
};

const HOME_ROLE_STORAGE_KEY = "pmc-home-demo-role";

function readStoredPreviewRole(): HomeRoleId | null {
  try {
    const stored = window.localStorage.getItem(HOME_ROLE_STORAGE_KEY);
    if (isHomeRoleId(stored)) {
      return stored;
    }
  } catch {
    // ignore storage access issues
  }
  return null;
}

// Role-aware Home. The rendered experience is derived from the REAL session role:
// leadership lands on Company Command; everyone else lands on their live My Work
// page (never a fabricated persona workspace). Leadership additionally gets a
// clearly-labeled Preview switcher to walk the operating model — the preview can
// only ever show live-or-labeled surfaces, so previewing is safe by construction.
export function HomeCommandSurface({ token, currentUser, socket, onOpenConcierge }: Props) {
  const realRoleId = defaultHomeRoleForUser(currentUser);
  const realRole = getHomeRole(realRoleId);
  const canPreview = realRole.leadership;

  const [previewRoleId, setPreviewRoleId] = useState<HomeRoleId>(() =>
    canPreview ? (readStoredPreviewRole() ?? realRoleId) : realRoleId
  );
  const [conciergeQuery, setConciergeQuery] = useState("");

  useEffect(() => {
    if (!canPreview) return;
    try {
      window.localStorage.setItem(HOME_ROLE_STORAGE_KEY, previewRoleId);
    } catch {
      // ignore storage access issues
    }
  }, [canPreview, previewRoleId]);

  // Non-leadership users' home IS their live work surface — no shell, no persona.
  if (!canPreview) {
    return <MyWork token={token} currentUser={currentUser} socket={socket} />;
  }

  const homeRole = getHomeRole(previewRoleId);
  const isCommand = homeRole.mode === "company_command";
  const isPreviewingOtherSeat = previewRoleId !== realRoleId;
  const title = isCommand ? "Company Command" : "My Workspace (Preview)";
  const summary = isCommand
    ? "What is happening across the company, what is on fire, and who needs help."
    : "Employees land directly on their live My Work page. This preview shows YOUR live My Work data, not a simulated employee.";

  function submitConcierge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onOpenConcierge?.(conciergeQuery.trim() || undefined);
  }

  return (
    <div className="home-operational home-operational--role-aware">
      <WorkspacePageHeader
        eyebrow={isPreviewingOtherSeat ? `Preview · ${homeRole.title}` : homeRole.title}
        title={title}
        summary={summary}
        summaryAsHelp
        compact
        className="home-operational__header"
        actions={
          <div className="home-operational__header-actions">
            <RolePreviewSwitcher value={previewRoleId} onChange={setPreviewRoleId} />
            <form className="home-concierge" role="search" onSubmit={submitConcierge}>
              <input
                className="home-concierge__input"
                type="search"
                aria-label="Ask Concierge anything"
                placeholder="Ask Concierge…"
                value={conciergeQuery}
                onChange={(event) => setConciergeQuery(event.target.value)}
              />
              <button type="submit" className="home-concierge__button">
                Ask
              </button>
            </form>
          </div>
        }
      />
      {isCommand ? (
        <CompanyCommandHome role={homeRole} token={token} />
      ) : (
        <MyWork token={token} currentUser={currentUser} socket={socket} />
      )}
    </div>
  );
}
