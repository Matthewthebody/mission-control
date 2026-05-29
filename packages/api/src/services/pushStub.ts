import type { PoolClient } from "pg";

export async function registerPushToken(
  client: PoolClient,
  input: {
    tenantId: string;
    userId: string;
    platform: string;
    deviceIdentifier: string;
    appVersion?: string;
    token: string;
  }
) {
  const deviceResult = await client.query(
    `
      INSERT INTO device (tenant_id, user_id, platform, device_identifier, app_version)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (tenant_id, user_id, device_identifier)
      DO UPDATE SET platform = EXCLUDED.platform, app_version = EXCLUDED.app_version
      RETURNING *
    `,
    [input.tenantId, input.userId, input.platform, input.deviceIdentifier, input.appVersion ?? null]
  );
  const device = deviceResult.rows[0];
  const tokenResult = await client.query(
    `
      INSERT INTO push_token (tenant_id, user_id, device_id, token, platform, enabled, invalidated_at)
      VALUES ($1,$2,$3,$4,$5,true,NULL)
      ON CONFLICT (tenant_id, token)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        enabled = true,
        invalidated_at = NULL,
        device_id = EXCLUDED.device_id,
        platform = EXCLUDED.platform
      RETURNING *
    `,
    [input.tenantId, input.userId, device.id, input.token, input.platform]
  );
  return { device, pushToken: tokenResult.rows[0] };
}

export async function unregisterPushToken(client: PoolClient, tenantId: string, userId: string, token: string) {
  const { rows } = await client.query(
    `
      UPDATE push_token
      SET enabled = false, invalidated_at = now()
      WHERE tenant_id = $1 AND user_id = $2 AND token = $3
      RETURNING *
    `,
    [tenantId, userId, token]
  );
  return rows[0] ?? null;
}
