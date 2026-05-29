import request from "supertest";
import type { Express } from "express";
import { pool } from "../src/db/pool.js";

export async function passwordLogin(app: Express, email: string, password = "LocalDemo123!") {
  const response = await request(app).post("/auth/login").send({ email, password });
  return response;
}

export async function devLogin(app: Express, email: string) {
  const response = await request(app).post("/auth/dev-login").send({ email });
  return response;
}

export async function elevateSession(app: Express, token: string, currentPassword?: string) {
  const response = await request(app)
    .post("/auth/elevate")
    .set("Authorization", `Bearer ${token}`)
    .send(
      currentPassword
        ? {
            current_password: currentPassword,
            reason: "Test security elevation"
          }
        : {
            reason: "Test security elevation"
          }
    );
  return response;
}

export async function getMembershipId(email: string) {
  const result = await pool.query("SELECT id FROM app_user WHERE lower(email) = lower($1) LIMIT 1", [email]);
  return result.rows[0]?.id as string | undefined;
}

export async function getTenantId(name: string) {
  const result = await pool.query("SELECT id FROM tenant WHERE name = $1 LIMIT 1", [name]);
  return result.rows[0]?.id as string | undefined;
}

export async function getShootId(code = "DEMO-001") {
  const result = await pool.query("SELECT id FROM shoot WHERE shoot_code = $1 LIMIT 1", [code]);
  return result.rows[0]?.id as string | undefined;
}
