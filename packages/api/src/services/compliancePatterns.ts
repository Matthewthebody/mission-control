import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";

// G6 slice 1: repeated-incident patterns over time_clock_compliance_flag
// history — recurrence intelligence built only on the consolidated canonical
// truth (G1/G2 precondition). Honest by construction: the window and minimum
// recurrence are explicit in the payload, every count equals its grouped rows,
// and the true total is disclosed alongside the capped list.
export async function listComplianceIncidentPatterns(
  client: PoolClient,
  auth: AuthUser,
  input: { windowDays?: number; minIncidents?: number; limit?: number } = {}
) {
  const windowDays = Math.min(Math.max(input.windowDays ?? 90, 7), 365);
  const minIncidents = Math.min(Math.max(input.minIncidents ?? 2, 1), 20);
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const { rows } = await client.query(
    `
      SELECT
        flag.employee_id::text AS employee_id,
        employee.full_name AS employee_name,
        flag.item_type::text AS item_type,
        COUNT(*)::int AS incident_count,
        COUNT(*) FILTER (WHERE flag.status = 'open')::int AS open_count,
        MIN(flag.first_detected_at)::text AS first_detected_at,
        MAX(flag.last_detected_at)::text AS last_detected_at,
        COUNT(DISTINCT date_trunc('week', flag.first_detected_at))::int AS distinct_weeks
      FROM time_clock_compliance_flag flag
      JOIN app_user employee ON employee.id = flag.employee_id
      WHERE flag.tenant_id = $1
        AND flag.first_detected_at >= now() - ($2 || ' days')::interval
      GROUP BY flag.employee_id, employee.full_name, flag.item_type
      HAVING COUNT(*) >= $3
      ORDER BY COUNT(*) DESC, MAX(flag.last_detected_at) DESC
    `,
    [auth.tenantId, windowDays, minIncidents]
  );
  return {
    window_days: windowDays,
    min_incidents: minIncidents,
    source: "time_clock_compliance_flag",
    total_pattern_count: rows.length,
    patterns: rows.slice(0, limit)
  };
}
