import type { Socket } from "socket.io-client";
import { HomeCommandSurface } from "../components/home/HomeCommandSurface";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
  onOpenConcierge?: (initialQuery?: string) => void;
};

export function Dashboard({ token, currentUser, socket, onOpenConcierge = () => undefined }: Props) {
  const actionConfig = getHomeActionConfig(currentUser);

  return (
    <HomeCommandSurface
      token={token}
      currentUser={currentUser}
      socket={socket}
      onOpenConcierge={onOpenConcierge}
      createEventHash={actionConfig.createEventHash}
      createTaskHash={actionConfig.createTaskHash}
    />
  );
}

function hasProfile(user: SessionUser, profiles: string[]) {
  return profiles.some((profile) => user.jobFunctionProfiles.includes(profile) || user.primaryJobFunctionProfile === profile);
}

function getHomeActionConfig(user: SessionUser): {
  createEventHash: string;
  createTaskHash: string;
} {
  const isOversightUser =
    user.department === "operations" ||
    ["leadership", "supervisor", "admin", "system_admin"].includes(user.authorityTier) ||
    user.roles.some((role) => ["leadership", "admin", "manager", "director", "system_owner"].includes(role));

  if (isOversightUser) {
    return {
      createEventHash: "#jobs/new",
      createTaskHash: "#tasks/new?department=operations"
    };
  }

  if (user.department === "sports") {
    return {
      createEventHash: "#sports/jobs/new",
      createTaskHash: "#tasks/new?department=sports"
    };
  }

  if (user.department === "schools") {
    return {
      createEventHash: "#schools/jobs/new",
      createTaskHash: "#tasks/new?department=schools"
    };
  }

  if (user.department === "production" || hasProfile(user, ["graphic_artist", "director_of_digital_production", "production_artist"])) {
    return {
      createEventHash: "#jobs/new",
      createTaskHash: "#tasks/new?department=production"
    };
  }

  if (hasProfile(user, ["associate_photographer", "seasonal_photographer", "part_time_photographer", "senior_photographer", "lead_photographer"])) {
    return {
      createEventHash: "#jobs/new",
      createTaskHash: "#tasks/new?department=photography"
    };
  }

  return {
    createEventHash: "#jobs/new",
    createTaskHash: "#tasks/new?department=operations"
  };
}
