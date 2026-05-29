import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";
import { assertShootAccess } from "./shootAccess.js";

export async function listTimeEntries(client: PoolClient, shootId: string) {
  // Callers are responsible for using the actor-aware overload when field scoping matters.
  const { rows } = await client.query(
    `
      SELECT te.*, u.email, u.full_name
      FROM time_entry te
      JOIN app_user u ON u.id = te.user_id
      WHERE te.shoot_id = $1
      ORDER BY te.created_at ASC
    `,
    [shootId]
  );
  return rows;
}

export async function listTimeEntriesForActor(client: PoolClient, auth: AuthUser, shootId: string) {
  await assertShootAccess(client, auth, shootId);
  return listTimeEntries(client, shootId);
}
