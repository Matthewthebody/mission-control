import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import type { DashboardWidgetPreferenceRecord } from "../../types/jobTruth.js";
import { normalizeDashboardWidgetPreferences } from "./dashboardWidgetLayout.js";

type WidgetPreferenceInput = {
  widget_key: string;
  position_index: number;
  is_visible: boolean;
  settings_json?: Record<string, unknown> | null;
};

export async function listDashboardWidgetPreferences(client: PoolClient, auth: AuthUser, dashboardScope: string) {
  const { rows } = await client.query<DashboardWidgetPreferenceRecord>(
    `
      SELECT *
      FROM dashboard_widget_preferences
      WHERE tenant_id = $1
        AND user_id = $2
        AND dashboard_scope = $3
      ORDER BY position_index ASC, widget_key ASC
    `,
    [auth.tenantId, auth.id, dashboardScope]
  );
  return rows;
}

export async function saveDashboardWidgetPreferences(
  client: PoolClient,
  auth: AuthUser,
  dashboardScope: string,
  preferences: WidgetPreferenceInput[]
) {
  const normalizedPreferences = normalizeDashboardWidgetPreferences(auth, dashboardScope, preferences);

  await client.query(
    `
      DELETE FROM dashboard_widget_preferences
      WHERE tenant_id = $1
        AND user_id = $2
        AND dashboard_scope = $3
    `,
    [auth.tenantId, auth.id, dashboardScope]
  );

  for (const preference of normalizedPreferences) {
    await client.query(
      `
        INSERT INTO dashboard_widget_preferences (
          tenant_id,
          user_id,
          dashboard_scope,
          widget_key,
          position_index,
          is_visible,
          settings_json
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
      `,
      [
        auth.tenantId,
        auth.id,
        dashboardScope,
        preference.widget_key,
        preference.position_index,
        preference.is_visible,
        JSON.stringify(preference.settings_json ?? {})
      ]
    );
  }

  return listDashboardWidgetPreferences(client, auth, dashboardScope);
}
