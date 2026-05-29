import { io, type Socket } from "socket.io-client";
import { apiUrl } from "./api";

let socket: Socket | null = null;
let currentToken = "";

export function connectRealtime(token: string) {
  if (socket && currentToken === token) {
    return socket;
  }
  if (socket) {
    socket.disconnect();
  }
  currentToken = token;
  socket = io(apiUrl, {
    auth: {
      token
    },
    transports: ["websocket", "polling"]
  });
  return socket;
}

export function getRealtime() {
  return socket;
}
