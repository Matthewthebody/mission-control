import { afterEach, describe, expect, it } from "vitest";
import { getAllowedCorsOrigins } from "../src/app.js";
import { config } from "../src/config.js";

const originalNodeEnv = config.NODE_ENV;

afterEach(() => {
  config.NODE_ENV = originalNodeEnv;
});

describe("local development CORS", () => {
  it("allows known Vite fallback ports for local smoke testing outside production", async () => {
    config.NODE_ENV = "test";

    const origins = getAllowedCorsOrigins();

    expect(origins.has("http://localhost:5175")).toBe(true);
    expect(origins.has("http://127.0.0.1:5175")).toBe(true);
  });

  it("does not add local Vite fallback ports in production", async () => {
    config.NODE_ENV = "production";

    const origins = getAllowedCorsOrigins();

    expect(origins.has("http://localhost:5175")).toBe(false);
  });
});
