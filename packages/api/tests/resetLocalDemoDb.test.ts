import { describe, expect, it } from "vitest";
import { inspectLocalDemoResetTarget, isSafeLocalDatabaseName } from "../scripts/reset-local-demo-db.js";

const confirmArgv = ["node", "reset-local-demo-db.ts", "--yes-reset-local-demo-db"];

describe("local demo database reset guardrails", () => {
  it("accepts the local Docker demo database target used by this repo", () => {
    const target = inspectLocalDemoResetTarget({
      dbUrl: "postgres://postgres:postgres@localhost:5432/pmc",
      nodeEnv: "development",
      argv: confirmArgv
    });

    expect(target.databaseName).toBe("pmc");
    expect(target.displayHost).toBe("localhost:5432");
    expect(target.maintenanceUrl).toContain("/postgres");
  });

  it("requires explicit reset confirmation", () => {
    expect(() =>
      inspectLocalDemoResetTarget({
        dbUrl: "postgres://postgres:postgres@localhost:5432/pmc",
        nodeEnv: "development",
        argv: ["node", "reset-local-demo-db.ts"]
      })
    ).toThrow(/--yes-reset-local-demo-db/);
  });

  it("rejects production mode, non-local hosts, and unsafe database names", () => {
    expect(() =>
      inspectLocalDemoResetTarget({
        dbUrl: "postgres://postgres:postgres@localhost:5432/pmc",
        nodeEnv: "production",
        argv: confirmArgv
      })
    ).toThrow(/NODE_ENV=production/);

    expect(() =>
      inspectLocalDemoResetTarget({
        dbUrl: "postgres://postgres:postgres@db.example.com:5432/pmc",
        nodeEnv: "development",
        argv: confirmArgv
      })
    ).toThrow(/Only localhost/);

    expect(() =>
      inspectLocalDemoResetTarget({
        dbUrl: "postgres://postgres:postgres@localhost:5432/pmc_production",
        nodeEnv: "development",
        argv: confirmArgv
      })
    ).toThrow(/Refusing to reset database/);

    expect(() =>
      inspectLocalDemoResetTarget({
        dbUrl: "postgres://app_user:postgres@localhost:5432/pmc",
        nodeEnv: "development",
        argv: confirmArgv
      })
    ).toThrow(/local Docker\/demo user allowlist/);
  });

  it("keeps safe database names intentionally narrow", () => {
    expect(isSafeLocalDatabaseName("pmc")).toBe(true);
    expect(isSafeLocalDatabaseName("pmc_demo")).toBe(true);
    expect(isSafeLocalDatabaseName("mission_control_local_review")).toBe(true);
    expect(isSafeLocalDatabaseName("pmc_staging")).toBe(false);
    expect(isSafeLocalDatabaseName("client_data")).toBe(false);
  });
});
