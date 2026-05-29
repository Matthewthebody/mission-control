import type { PoolClient } from "pg";

export async function disableInvalidToken(client: PoolClient, pushTokenId: string) {
  await client.query(
    `
      UPDATE push_token
      SET enabled = false, invalidated_at = now()
      WHERE id = $1
    `,
    [pushTokenId]
  );
}
