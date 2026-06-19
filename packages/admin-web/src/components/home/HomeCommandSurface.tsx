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
import { MyWorkspaceHome } from "../../home/MyWorkspaceHome";
import { SportsCommandCenter } from "../../home/SportsCommandCenter";
import { SamSportsWorkspace } from "../../home/SamSportsWorkspace";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
  onOpenConcierge?: (initialQuery?: string) => void;
};

const HOME_ROLE_STORAGE_KEY = "pmc-home-demo-role";

function readInitialHomeRole(user: SessionUser): HomeRoleId {
  try {
    const stored = window.localStorage.getItem(HOME_ROLE_STORAGE_KEY);
    if (isHomeRoleId(stored)) {
      return stored;
    }
  } catch {
    // ignore storage access issues
  }
  return defaultHomeRoleForUser(user);
}

// Role-aware Home. Leadership and department leads land on Company Command;
// associates land on My Workspace. The single page header carries the role-aware
// title and the demo role-preview switcher so there is never a duplicate header.
export function HomeCommandSurface({ token, currentUser, onOpenConcierge }: Props) {
  const [homeRoleId, setHomeRoleId] = useState<HomeRoleId>(() => readInitialHomeRole(currentUser));
  const [conciergeQuery, setConciergeQuery] = useState("");
  const homeRole = getHomeRole(homeRoleId);

  useEffect(() => {
    try {
      window.localStorage.setItem(HOME_ROLE_STORAGE_KEY, homeRoleId);
    } catch {
      // ignore storage access issues
    }
  }, [homeRoleId]);

  const isCommand = homeRole.mode === "company_command";
  const isSportsCommand = homeRole.id === "josh";
  const isSamWorkspace = homeRole.id === "sam";
  const title = isSportsCommand
    ? "Sports Command Center"
    : isSamWorkspace
      ? "My Sports Work"
      : isCommand
        ? "Company Command"
        : "My Workspace";
  const summary = isSportsCommand
    ? "What changed, what is at risk, what needs approval, and what to rebook — for sports."
    : isSamWorkspace
      ? "Your groups, your next actions, and what you are waiting on."
      : isCommand
        ? "What is happening across the company, what is on fire, and who needs help."
        : "What you need to do today — your shift, your queue, and your next action.";

  function submitConcierge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onOpenConcierge?.(conciergeQuery.trim() || undefined);
  }

  return (
    <div className="home-operational home-operational--role-aware">
      <WorkspacePageHeader
        eyebrow={homeRole.title}
        title={title}
        summary={summary}
        summaryAsHelp
        compact
        className="home-operational__header"
        actions={
          <div className="home-operational__header-actions">
            <RolePreviewSwitcher value={homeRoleId} onChange={setHomeRoleId} />
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
      {isSportsCommand ? (
        <SportsCommandCenter currentUser={currentUser} />
      ) : isSamWorkspace ? (
        <SamSportsWorkspace />
      ) : isCommand ? (
        <CompanyCommandHome role={homeRole} token={token} />
      ) : (
        <MyWorkspaceHome role={homeRole} />
      )}
    </div>
  );
}
