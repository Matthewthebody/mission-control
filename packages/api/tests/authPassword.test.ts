import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { isMicrosoftEntraAuthEnabled } from "../src/services/microsoftEntra.js";
import { passwordLogin } from "./helpers.js";

const app = createApp();

describe("password auth flows", () => {
  it("logs in a seeded active user with email and password", async () => {
    const login = await passwordLogin(app, "admin@example.com");

    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();

    const session = await request(app).get("/auth/session").set("Authorization", `Bearer ${login.body.token}`);

    expect(session.status).toBe(200);
    expect(session.body.user.email).toBe("admin@example.com");
    expect(session.body.user.roles).toContain("admin");
  });

  it("returns a generic failure for an invalid password", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "admin@example.com",
      password: "WrongPassword123!"
    });

    expect(login.status).toBe(401);
    expect(login.body.error).toBe("Invalid email or password");
  });

  it("does not leak account existence in password reset requests", async () => {
    const existing = await request(app).post("/auth/password-reset/request").send({ email: "admin@example.com" });
    const missing = await request(app).post("/auth/password-reset/request").send({ email: "missing@example.com" });

    expect(existing.status).toBe(200);
    expect(missing.status).toBe(200);
    expect(existing.body.message).toBe(missing.body.message);
  });

  it("blocks pending users from password login", async () => {
    const login = await passwordLogin(app, "pending@example.com");

    expect(login.status).toBe(403);
    expect(login.body.error).toBe("Account is not active");
  });

  it("blocks suspended users from password login", async () => {
    const login = await passwordLogin(app, "suspended@example.com");

    expect(login.status).toBe(403);
    expect(login.body.error).toBe("Account is not active");
  });

  it("surfaces the available unauthenticated login options", async () => {
    const response = await request(app).get("/auth/options");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      microsoft_entra_enabled: isMicrosoftEntraAuthEnabled(),
      password_login_enabled: config.ALLOW_PASSWORD_LOGIN,
      password_login_break_glass_only: Boolean(config.ALLOW_PASSWORD_LOGIN_BREAK_GLASS_ONLY && isMicrosoftEntraAuthEnabled()),
      dev_login_enabled: config.NODE_ENV !== "production" && config.ALLOW_DEV_LOGIN
    });
  });
});
