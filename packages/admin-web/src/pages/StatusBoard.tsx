import type { Socket } from "socket.io-client";
import { HomePulseSurface } from "../components/HomePulseSurface";

type Props = {
  token: string;
  socket: Socket | null;
  presentationMode?: boolean;
};

export function StatusBoard({ token, socket, presentationMode = false }: Props) {
  return <HomePulseSurface token={token} socket={socket} surfaceMode="status-board" presentationMode={presentationMode} />;
}
