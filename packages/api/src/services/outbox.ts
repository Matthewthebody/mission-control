import type { PoolClient } from "pg";

export async function createAppEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    eventType: string;
    aggregateType: string;
    aggregateId?: string | null;
    payload: Record<string, unknown>;
    dedupeKey?: string | null;
  }
) {
  const { rows } = await client.query(
    `
      INSERT INTO app_event (tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      ON CONFLICT (tenant_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL
      DO NOTHING
      RETURNING *
    `,
    [
      input.tenantId,
      input.eventType,
      input.aggregateType,
      input.aggregateId ?? null,
      JSON.stringify(input.payload),
      input.dedupeKey ?? null
    ]
  );

  if (rows[0]) {
    return rows[0];
  }

  if (input.dedupeKey) {
    const existing = await client.query("SELECT * FROM app_event WHERE tenant_id = $1 AND dedupe_key = $2", [
      input.tenantId,
      input.dedupeKey
    ]);
    return existing.rows[0];
  }

  throw new Error("Failed to create app_event");
}
