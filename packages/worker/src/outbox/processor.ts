import { pool } from "../db.js";
import { dispatchAppEvent } from "./dispatch.js";

export async function processOutboxBatch(limit = 25) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE pmc_app");
    const tenants = await client.query("SELECT id FROM tenant ORDER BY created_at ASC");
    let processed = 0;
    let handled = 0;

    for (const tenant of tenants.rows) {
      if (handled >= limit) {
        break;
      }
      await client.query("SELECT app.set_context($1::uuid, NULL::uuid)", [tenant.id]);
      const remaining = limit - handled;
      const claim = await client.query(
        `
          SELECT *
          FROM app_event
          WHERE processed_at IS NULL
            AND available_at <= now()
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        `,
        [remaining]
      );

      for (const appEvent of claim.rows) {
        try {
          await dispatchAppEvent(client, appEvent);
          await client.query(
            "UPDATE app_event SET processed_at = now(), last_error = NULL, attempts = attempts + 1 WHERE id = $1",
            [appEvent.id]
          );
          processed += 1;
          handled += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown outbox error";
          await client.query(
            `
              UPDATE app_event
              SET attempts = attempts + 1,
                  last_error = $2,
                  available_at = now() + make_interval(secs => LEAST((attempts + 1) * 10, 300))
              WHERE id = $1
            `,
            [appEvent.id, message]
          );
          handled += 1;
        }
      }
    }
    await client.query("COMMIT");
    return processed;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
