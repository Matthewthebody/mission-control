import http from "node:http";
import { Server } from "socket.io";
import { createApp, getAllowedCorsOrigins } from "./app.js";
import { config } from "./config.js";
import { resolveAuthenticatedUser } from "./services/auth.js";

const app = createApp();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [...getAllowedCorsOrigins()]
  }
});

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error("Missing token"));
  }
  try {
    const auth = await resolveAuthenticatedUser(String(token));
    if (!auth) {
      throw new Error("Invalid token");
    }
    socket.data.tenantId = auth.tenantId;
    socket.data.userId = auth.id;
    socket.join(`tenant:${auth.tenantId}`);
    return next();
  } catch (error) {
    return next(error as Error);
  }
});

const internalNamespace = io.of("/internal");
internalNamespace.use((socket, next) => {
  const secret = socket.handshake.auth.secret;
  if (secret !== config.INTERNAL_SOCKET_SECRET) {
    return next(new Error("Unauthorized internal socket"));
  }
  return next();
});

internalNamespace.on("connection", (socket) => {
  socket.on("publish", (payload: { tenantId: string; event: string; data: unknown }) => {
    io.to(`tenant:${payload.tenantId}`).emit(payload.event, payload.data);
  });
});

server.listen(config.API_PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${config.API_PORT}`);
});
