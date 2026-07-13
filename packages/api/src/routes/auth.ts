import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { withSystemTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { validateBody } from "../middleware/validate.js";
import { ApiError } from "../errors/apiError.js";
import { changePassword, devLogin, loginWithPassword, logout, requestPasswordReset, resetPassword } from "../services/auth.js";
import { acceptInvite } from "../services/access.js";
import {
  buildMicrosoftLogoutUrl,
  createMicrosoftEntraAuthorizationUrl,
  handleMicrosoftEntraCallback,
  isMicrosoftEntraAuthEnabled
} from "../services/microsoftEntra.js";
import { activateBreakGlass, elevateAuthenticatedSession, endBreakGlass, endSessionElevation } from "../services/securitySession.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { getRequestMeta } from "../utils/requestMeta.js";
import { markRequestContextAsAction } from "../services/requestContext.js";

const router = Router();

const devLoginSchema = z.object({
  email: z.string().email()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const changePasswordSchema = z.object({
  current_password: z.string().min(8),
  new_password: z.string().min(8)
});

const resetRequestSchema = z.object({
  email: z.string().email()
});

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8)
});

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  full_name: z.string().min(1),
  password: z.string().min(8)
});

const elevateSchema = z.object({
  current_password: z.string().min(8).optional(),
  reason: z.string().max(500).optional(),
  action_key: z.string().max(200).optional(),
  return_hash: z.string().max(500).optional()
});

const breakGlassSchema = z.object({
  reason: z.string().min(8).max(1000),
  scope_type: z.string().max(120).optional(),
  scope_id: z.string().max(200).optional(),
  duration_minutes: z.number().int().min(5).max(config.AUTH_BREAK_GLASS_MAX_MINUTES).optional()
});

const endBreakGlassSchema = z.object({
  reason: z.string().max(500).optional()
});

const loginRateLimit = createRateLimiter({
  bucket: "auth-login",
  windowMs: 10 * 60 * 1000,
  max: 5,
  key: (req) => `${req.ip}:${String(req.body?.email ?? "")}`
});

const resetRateLimit = createRateLimiter({
  bucket: "auth-reset",
  windowMs: 10 * 60 * 1000,
  max: 5,
  key: (req) => `${req.ip}:${String(req.body?.email ?? "")}`
});

// MC-016 defense-in-depth: dev-login is passwordless, so even in development it
// must not be an unmetered account-enumeration oracle. The cap is generous because
// the test suite legitimately logs in the same fixture emails repeatedly in-process.
const devLoginRateLimit = createRateLimiter({
  bucket: "auth-dev-login",
  windowMs: 10 * 60 * 1000,
  max: 60,
  key: (req) => `${req.ip}:${String(req.body?.email ?? "")}`
});

router.get("/options", (_req, res) => {
  setNoStore(res);
  return res.json({
    microsoft_entra_enabled: isMicrosoftEntraAuthEnabled(),
    password_login_enabled: config.ALLOW_PASSWORD_LOGIN,
    password_login_break_glass_only: Boolean(config.ALLOW_PASSWORD_LOGIN_BREAK_GLASS_ONLY && isMicrosoftEntraAuthEnabled()),
    dev_login_enabled: config.NODE_ENV !== "production" && config.ALLOW_DEV_LOGIN
  });
});

router.post("/dev-login", devLoginRateLimit, validateBody(devLoginSchema), async (req, res, next) => {
  try {
    if (config.NODE_ENV === "production" || !config.ALLOW_DEV_LOGIN) {
      throw new ApiError(404, "Not found");
    }
    const result = await devLogin(req.body.email, getRequestMeta(req));
    setAuthCookies(res, result.token, result.csrfToken);
    setNoStore(res);
    return res.json({ token: result.token, user_transport: "cookie_and_bearer" });
  } catch (error) {
    return next(error);
  }
});

router.post("/login", loginRateLimit, validateBody(loginSchema), async (req, res, next) => {
  try {
    const result = await loginWithPassword(req.body.email, req.body.password, getRequestMeta(req));
    setAuthCookies(res, result.token, result.csrfToken);
    setNoStore(res);
    return res.json({ token: result.token, user_transport: "cookie_and_bearer" });
  } catch (error) {
    return next(error);
  }
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    await logout(auth, getRequestMeta(req));
    clearAuthCookies(res);
    setNoStore(res);
    return res.json({
      ok: true,
      federated_logout_url: auth.sessionTrust.identityProvider === "microsoft_entra" ? buildMicrosoftLogoutUrl() : null
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/microsoft/start", async (req, res, next) => {
  try {
    markRequestContextAsAction();
    const returnHash = req.query.return_hash ? String(req.query.return_hash) : null;
    if (!isMicrosoftEntraAuthEnabled()) {
      const params = new URLSearchParams({
        status: "error",
        notice: "Microsoft sign-in is not enabled in this environment."
      });
      if (returnHash?.startsWith("#")) {
        params.set("return_hash", returnHash);
      }
      setNoStore(res);
      return res.redirect(302, `${config.ADMIN_WEB_URL.replace(/\/$/, "")}/#auth/callback?${params.toString()}`);
    }
    const authorizationUrl = await withSystemTransaction((client) =>
      createMicrosoftEntraAuthorizationUrl(
        client,
        {
          returnHash
        },
        getRequestMeta(req)
      )
    );
    setNoStore(res);
    return res.redirect(302, authorizationUrl);
  } catch (error) {
    return next(error);
  }
});

router.get("/microsoft/callback", async (req, res, next) => {
  try {
    markRequestContextAsAction();
    const redirectUrl = await withSystemTransaction((client) =>
      handleMicrosoftEntraCallback(
        client,
        {
          code: req.query.code ? String(req.query.code) : undefined,
          state: req.query.state ? String(req.query.state) : undefined,
          error: req.query.error ? String(req.query.error) : undefined,
          errorDescription: req.query.error_description ? String(req.query.error_description) : undefined
        },
        getRequestMeta(req)
      )
    );
    setNoStore(res);
    return res.redirect(302, redirectUrl);
  } catch (error) {
    return next(error);
  }
});

router.get("/me", requireAuth, async (req, res) => {
  setNoStore(res);
  return res.json({ user: (req as AuthenticatedRequest).auth });
});

router.get("/session", requireAuth, async (req, res) => {
  setNoStore(res);
  return res.json({ user: (req as AuthenticatedRequest).auth });
});

router.post("/change-password", requireAuth, validateBody(changePasswordSchema), async (req, res, next) => {
  try {
    await changePassword((req as AuthenticatedRequest).auth, req.body.current_password, req.body.new_password, getRequestMeta(req));
    clearAuthCookies(res);
    setNoStore(res);
    return res.json({ ok: true, session_revoked: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/password-reset/request", resetRateLimit, validateBody(resetRequestSchema), async (req, res, next) => {
  try {
    const result = await requestPasswordReset(req.body.email, getRequestMeta(req));
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/password-reset/confirm", validateBody(resetSchema), async (req, res, next) => {
  try {
    await resetPassword(req.body.token, req.body.password, getRequestMeta(req));
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/invites/accept", validateBody(acceptInviteSchema), async (req, res, next) => {
  try {
    await withSystemTransaction(async (client) => {
      await acceptInvite(
        client,
        { token: req.body.token, fullName: req.body.full_name, password: req.body.password },
        getRequestMeta(req)
      );
    });
    return res.status(201).json({ ok: true, status: "pending_approval" });
  } catch (error) {
    return next(error);
  }
});

router.post("/elevate", requireAuth, validateBody(elevateSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const user = await withSystemTransaction((client) =>
      elevateAuthenticatedSession(
        client,
        auth,
        {
          currentPassword: req.body.current_password ?? null,
          reason: req.body.reason ?? null,
          actionKey: req.body.action_key ?? null,
          returnHash: req.body.return_hash ?? null
        },
        getRequestMeta(req)
      )
    );
    setNoStore(res);
    return res.json({ user });
  } catch (error) {
    return next(error);
  }
});

router.post("/elevation/end", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const user = await withSystemTransaction((client) => endSessionElevation(client, auth, getRequestMeta(req)));
    setNoStore(res);
    return res.json({ user });
  } catch (error) {
    return next(error);
  }
});

router.post("/break-glass", requireAuth, validateBody(breakGlassSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const result = await withSystemTransaction((client) =>
      activateBreakGlass(
        client,
        auth,
        {
          reason: req.body.reason,
          scopeType: req.body.scope_type ?? null,
          scopeId: req.body.scope_id ?? null,
          durationMinutes: req.body.duration_minutes ?? null
        },
        getRequestMeta(req)
      )
    );
    setNoStore(res);
    return res.json({
      user: result.auth,
      break_glass_event_id: result.breakGlassEventId
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/break-glass/end", requireAuth, validateBody(endBreakGlassSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const user = await withSystemTransaction((client) =>
      endBreakGlass(
        client,
        auth,
        {
          reason: req.body.reason ?? null
        },
        getRequestMeta(req)
      )
    );
    setNoStore(res);
    return res.json({ user });
  } catch (error) {
    return next(error);
  }
});

export default router;

function setNoStore(res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

function setAuthCookies(res: Response, token: string, csrfToken: string) {
  const secure = config.NODE_ENV === "production";
  res.cookie(config.AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: config.AUTH_SESSION_HOURS * 60 * 60 * 1000
  });
  res.cookie(config.AUTH_CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: config.AUTH_SESSION_HOURS * 60 * 60 * 1000
  });
}

function clearAuthCookies(res: Response) {
  const secure = config.NODE_ENV === "production";
  res.clearCookie(config.AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/"
  });
  res.clearCookie(config.AUTH_CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/"
  });
}
