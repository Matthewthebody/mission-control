import { describe, expect, it } from "vitest";
import { assertRequestQueryAllowed, instrumentGuardedClientForTesting, isMutatingSql, ReadOnlyRequestMutationError } from "../src/db/pool.js";

describe("database guardrails", () => {
  it("detects mutating SQL statements while allowing read-only queries", () => {
    expect(isMutatingSql("SELECT * FROM urgent_watch_item")).toBe(false);
    expect(isMutatingSql("  -- comment\nSELECT 1")).toBe(false);
    expect(isMutatingSql("WITH scope AS (SELECT 1) SELECT * FROM scope")).toBe(false);

    expect(isMutatingSql("UPDATE urgent_watch_item SET status = 'resolved'")).toBe(true);
    expect(isMutatingSql("INSERT INTO urgent_watch_item(id) VALUES ('1')")).toBe(true);
    expect(isMutatingSql("WITH changed AS (UPDATE urgent_watch_item SET status = 'active' RETURNING id) SELECT * FROM changed")).toBe(true);
  });

  it("blocks mutating SQL during GET requests only", () => {
    expect(() =>
      assertRequestQueryAllowed("GET", "/api/exceptions", "UPDATE urgent_watch_item SET status = 'resolved'")
    ).toThrow(ReadOnlyRequestMutationError);

    expect(() =>
      assertRequestQueryAllowed("POST", "/api/exceptions/reconcile", "UPDATE urgent_watch_item SET status = 'active'")
    ).not.toThrow();

    expect(() =>
      assertRequestQueryAllowed("GET", "/api/exceptions", "SELECT * FROM urgent_watch_item")
    ).not.toThrow();
  });

  it("serializes concurrent queries on a guarded client", async () => {
    let activeQueries = 0;
    let maxConcurrentQueries = 0;
    const callOrder: string[] = [];
    const guardedClient = instrumentGuardedClientForTesting({
      query<T>(_sql: string) {
        const label = String(_sql);
        callOrder.push(`start:${label}`);
        activeQueries += 1;
        maxConcurrentQueries = Math.max(maxConcurrentQueries, activeQueries);

        return new Promise<{ rows: T[]; rowCount: number; command: string; oid: number; fields: [] }>((resolve) => {
          setTimeout(() => {
            activeQueries -= 1;
            callOrder.push(`finish:${label}`);
            resolve({
              rows: [],
              rowCount: 0,
              command: "SELECT",
              oid: 0,
              fields: []
            });
          }, 5);
        });
      }
    });

    await Promise.all([guardedClient.query("SELECT 1"), guardedClient.query("SELECT 2"), guardedClient.query("SELECT 3")]);

    expect(maxConcurrentQueries).toBe(1);
    expect(callOrder).toEqual([
      "start:SELECT 1",
      "finish:SELECT 1",
      "start:SELECT 2",
      "finish:SELECT 2",
      "start:SELECT 3",
      "finish:SELECT 3"
    ]);
  });
});
