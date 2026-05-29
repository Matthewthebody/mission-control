import { io, type Socket } from "socket.io-client";
import { config } from "../config.js";

let socket: Socket | null = null;

function getSocket() {
  if (!socket) {
    socket = io(`http://localhost:${config.API_PORT}/internal`, {
      auth: {
        secret: config.INTERNAL_SOCKET_SECRET
      },
      transports: ["websocket"]
    });
  }
  return socket;
}

export function publishRealtime(tenantId: string, event: string, data: unknown) {
  getSocket().emit("publish", { tenantId, event, data });
}
