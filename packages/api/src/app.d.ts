import type { AuthUser } from "./types/auth.js";
import type { PoolClient } from "pg";

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthUser;
    db?: PoolClient;
  }
}

export {};
