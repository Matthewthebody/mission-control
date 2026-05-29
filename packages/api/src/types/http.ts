import type { Request } from "express";
import type { AuthUser } from "./auth.js";

export type AuthenticatedRequest = Request & {
  auth: AuthUser;
};

export type MaybeAuthenticatedRequest = Request & {
  auth?: AuthUser;
};
