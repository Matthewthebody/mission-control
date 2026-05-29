import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../src/db/pool.js";

const dispatchAppEvent = vi.fn();

vi.mock("../../worker/src/outbox/dispatch.js", () => ({
  dispatchAppEvent
}));

let processOutboxBatch: typeof import("../../worker/src/outbox/processor.js").processOutboxBatch;
let tenantId = "";
const testRunId = `outboxProcessor.test:${Date.now()}:${randomUUID()}`;
const createdEventIds: string[] = [];

async function getAppEventState(id: string) {
  const persisted = await pool.query("SELECT processed_at, last_error, attempts, available_at FROM app_event WHERE id = $1", [id]);
  return persisted.rows[0];
}

async function processUntil(
  eventId: string,
  predicate: (row: { processed_at: string | null; last_error: string | null; attempts: number; available_at: string }) => boolean
) {
  let latest = await getAppEventState(eventId);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (predicate(latest)) {
      return latest;
    }

    await processOutboxBatch(1);
    latest = await getAppEventState(eventId);
  }

  return latest;
}

beforeAll(async () => {
  ({ processOutboxBatch } = await import("../../worker/src/outbox/processor.js"));
  await pool.query("DELETE FROM tenant WHERE name LIKE 'Outbox Processor Test outboxProcessor.test:%'");
  const tenant = await pool.query(
    `
      INSERT INTO tenant (name, created_at)
      VALUES ($1, '1900-01-01T00:00:00Z'::timestamptz)
      RETURNING id
    `,
    [`Outbox Processor Test ${testRunId}`]
  );
  tenantId = tenant.rows[0].id;
});

beforeEach(async () => {
  dispatchAppEvent.mockReset();
  createdEventIds.length = 0;
});

afterEach(async () => {
  if (createdEventIds.length > 0) {
    await pool.query("DELETE FROM app_event WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, createdEventIds]);
  }
  createdEventIds.length = 0;
});

afterAll(async () => {
  if (tenantId) {
    await pool.query("DELETE FROM tenant WHERE id = $1", [tenantId]);
  }
});

describe("worker outbox processor", () => {
  it(
    "marks successful app events as processed",
    async () => {
    dispatchAppEvent.mockResolvedValue(undefined);

    const inserted = await pool.query(
      `
        INSERT INTO app_event (tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key, available_at)
        VALUES ($1, 'status_event.created', 'status_event', gen_random_uuid(), $2::jsonb, $3, now() - interval '1 minute')
        RETURNING id
      `,
      [
        tenantId,
        JSON.stringify({
          test_run_id: testRunId,
          shoot_id: randomUUID(),
          shoot_code: "OUTBOX-SUCCESS",
          type: "ARRIVED"
        }),
        `${testRunId}:success:${randomUUID()}`
      ]
    );
    createdEventIds.push(inserted.rows[0].id);

    const persisted = await processUntil(inserted.rows[0].id, (row) => Boolean(row.processed_at));

    expect(persisted.processed_at).toBeTruthy();
    expect(persisted.last_error).toBeNull();
    expect(persisted.attempts).toBe(1);
    expect(dispatchAppEvent).toHaveBeenCalled();
    },
    10_000
  );

  it(
    "records retries, backoff, and errors when dispatch fails",
    async () => {
    dispatchAppEvent.mockRejectedValue(new Error("forced dispatch failure"));

    const inserted = await pool.query(
      `
        INSERT INTO app_event (tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key, available_at)
        VALUES ($1, 'status_event.created', 'status_event', gen_random_uuid(), $2::jsonb, $3, now() - interval '1 minute')
        RETURNING id
      `,
      [
        tenantId,
        JSON.stringify({
          test_run_id: testRunId,
          shoot_id: randomUUID(),
          shoot_code: "OUTBOX-FAILURE",
          type: "ARRIVED"
        }),
        `${testRunId}:failure:${randomUUID()}`
      ]
    );
    createdEventIds.push(inserted.rows[0].id);

    const before = Date.now();
    const persisted = await processUntil(inserted.rows[0].id, (row) => row.attempts > 0);

    expect(persisted.processed_at).toBeNull();
    expect(persisted.last_error).toContain("forced dispatch failure");
    expect(persisted.attempts).toBe(1);
    expect(new Date(persisted.available_at).getTime()).toBeGreaterThan(before);
    expect(dispatchAppEvent).toHaveBeenCalled();
    },
    10_000
  );
});
