import type { PoolClient } from "pg";

export async function setRlsContext(client: PoolClient, tenantId: string | null, userId: string | null) {
  await client.query("SET LOCAL ROLE pmc_app");
  await client.query("SELECT app.set_context($1::uuid, $2::uuid)", [tenantId, userId]);
}
