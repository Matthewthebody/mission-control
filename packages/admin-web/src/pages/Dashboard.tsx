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
  return <HomeCommandSurface token={token} currentUser={currentUser} socket={socket} onOpenConcierge={onOpenConcierge} />;
}
