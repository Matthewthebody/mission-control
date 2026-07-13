import type { Express } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { devLoginDefaultFor } from "../src/config.js";

// MC-016 — dev-login hardening. The passwordless dev-login endpoint was gated only
// by a defaultable NODE_ENV: a deploy that forgot to set NODE_ENV landed on the
// "development" default and silently enabled dev-login. The default must fail
// closed on an ambiguous environment, and the endpoint must be rate limited so it
// is never an unmetered account-enumeration oracle.

let app: Express;

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

describe("MC-016 dev-login default fails closed", () => {
  it("an UNSET NODE_ENV never enables dev-login by default", () => {
    expect(devLoginDefaultFor(undefined)).toBe(false);
  });

  it("an explicit production NODE_ENV never enables dev-login by default", () => {
    expect(devLoginDefaultFor("production")).toBe(false);
  });

  it("only explicit non-production environments default dev-login on", () => {
    expect(devLoginDefaultFor("development")).toBe(true);
    expect(devLoginDefaultFor("test")).toBe(true);
  });

  it("dev-login remains available in the explicit test environment (sanity)", async () => {
    const response = await request(app).post("/auth/dev-login").send({ email: "leadership@example.com" });
    expect(response.status).toBe(200);
    expect(typeof response.body.token).toBe("string");
  });
});

describe("MC-016 dev-login rate limit", () => {
  it("throttles repeated dev-login attempts for the same email", async () => {
    // Unique email so this probe never collides with fixture logins in this process.
    const email = "mc016-rate-limit-probe@example.com";
    let throttled = 0;
    let lastNonThrottledStatus = 0;
    for (let attempt = 0; attempt < 65; attempt += 1) {
      const response = await request(app).post("/auth/dev-login").send({ email });
      if (response.status === 429) {
        throttled += 1;
      } else {
        lastNonThrottledStatus = response.status;
      }
    }
    expect(throttled).toBeGreaterThan(0); // the cap engaged
    expect(lastNonThrottledStatus).toBeGreaterThanOrEqual(400); // unknown email never logs in
  });

  it("does not throttle distinct emails at normal volumes (suite safety)", async () => {
    const response = await request(app).post("/auth/dev-login").send({ email: "photo@example.com" });
    expect(response.status).toBe(200);
  });
});
