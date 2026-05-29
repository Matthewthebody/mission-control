import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";
import { haversineMiles } from "./geo.js";
import { assertShootAccess } from "./shootAccess.js";
import { getMileageReimbursementForEmployeeDate, recalculateMileageForEmployeeDate } from "./timeClockMileage.js";

export async function previewMileage(client: PoolClient, auth: AuthUser, shootId: string, userId: string) {
  await assertShootAccess(client, auth, shootId);
  const { rows } = await client.query(
    `
      SELECT s.id, s.shoot_date::text, s.location_lat, s.location_lng, st.latitude AS studio_lat, st.longitude AS studio_lng
      FROM shoot s
      JOIN studio st ON st.id = s.studio_id
      WHERE s.id = $1
    `,
    [shootId]
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Shoot not found");
  }
  const miles = Number(
    haversineMiles(Number(row.studio_lat), Number(row.studio_lng), Number(row.location_lat), Number(row.location_lng)).toFixed(2)
  );
  const zoneResult = await client.query(
    `
      SELECT * FROM mileage_zone
      WHERE active_status = true
        AND min_distance <= $1
        AND max_distance >= $1
      ORDER BY reimbursement_amount ASC
      LIMIT 1
    `,
    [miles]
  );
  return {
    shoot_id: shootId,
    user_id: userId,
    miles,
    zone: zoneResult.rows[0] ?? null,
    source_of_truth: "canonical_mileage_reimbursement",
    compatibility_mode: "legacy_preview_bridge",
    canonical_work_date: row.shoot_date ?? null,
    canonical_reimbursement:
      row.shoot_date
        ? await getMileageReimbursementForEmployeeDate(client, {
            tenantId: auth.tenantId,
            employeeId: userId,
            workDate: String(row.shoot_date)
          })
        : null
  };
}

export async function submitMileage(client: PoolClient, auth: AuthUser, shootId: string, userId: string) {
  const preview = await previewMileage(client, auth, shootId, userId);
  const canonicalReimbursement = preview.canonical_work_date
    ? await getMileageReimbursementForEmployeeDate(client, {
        tenantId: auth.tenantId,
        employeeId: userId,
        workDate: String(preview.canonical_work_date)
      })
    : null;
  if (!preview.zone) {
    throw new Error("No mileage zone configured");
  }
  const existing = await client.query("SELECT * FROM mileage_claim WHERE shoot_id = $1 AND user_id = $2", [shootId, userId]);
  if (existing.rows[0]) {
    return {
      ...existing.rows[0],
      source_of_truth: "canonical_mileage_reimbursement",
      compatibility_mode: "legacy_claim_bridge",
      canonical_work_date: preview.canonical_work_date ?? null,
      canonical_reimbursement: canonicalReimbursement
    };
  }
  const shoot = await client.query("SELECT tenant_id FROM shoot WHERE id = $1", [shootId]);
  const { rows } = await client.query(
    `
      INSERT INTO mileage_claim (tenant_id, shoot_id, user_id, miles, mileage_zone_id, reimbursement_amount)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
    `,
    [shoot.rows[0].tenant_id, shootId, userId, preview.miles, preview.zone.id, preview.zone.reimbursement_amount]
  );
  if (preview.canonical_work_date) {
    await recalculateMileageForEmployeeDate(client, {
      tenantId: auth.tenantId,
      employeeId: userId,
      workDate: String(preview.canonical_work_date),
      actorUserId: auth.id,
      reason: "Legacy mileage submit synced canonical reimbursement state"
    });
  }
  const refreshedCanonicalReimbursement = preview.canonical_work_date
    ? await getMileageReimbursementForEmployeeDate(client, {
        tenantId: auth.tenantId,
        employeeId: userId,
        workDate: String(preview.canonical_work_date)
      })
    : null;

  return {
    ...rows[0],
    source_of_truth: "canonical_mileage_reimbursement",
    compatibility_mode: "legacy_claim_bridge",
    canonical_work_date: preview.canonical_work_date ?? null,
    canonical_reimbursement: refreshedCanonicalReimbursement ?? canonicalReimbursement
  };
}
