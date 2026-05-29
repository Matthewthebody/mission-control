import type { PoolClient } from "pg";
import { connectGuardedClient } from "./pool.js";

export async function withClientTransaction<T>(
  tenantId: string | null,
  userId: string | null,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await connectGuardedClient();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE pmc_app");
    await client.query("SELECT app.set_context($1::uuid, $2::uuid)", [tenantId, userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function withSystemTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await connectGuardedClient();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
