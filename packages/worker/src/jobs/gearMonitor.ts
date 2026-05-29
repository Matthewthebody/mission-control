import { pool } from "../db.js";

type OverdueCandidate = {
  tenant_id: string;
  checkout_id: string;
  asset_id: string | null;
  kit_id: string | null;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  checked_out_to_user_id: string | null;
  current_custodian_id: string | null;
  label: string;
  shoot_title: string | null;
  due_at: string;
};

type MissingCandidate = {
  tenant_id: string;
  target_type: "asset" | "kit";
  target_id: string;
  asset_id: string | null;
  kit_id: string | null;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  current_custodian_id: string | null;
  label: string;
  target_updated_at: string;
};

async function createAppEvent(client: any, input: {
  tenantId: string;
  eventType: string;
  aggregateType: string;
  aggregateId?: string | null;
  payload: Record<string, unknown>;
  dedupeKey: string;
}) {
  await client.query(
    `
      INSERT INTO app_event (tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6)
      ON CONFLICT (tenant_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL
      DO NOTHING
    `,
    [input.tenantId, input.eventType, input.aggregateType, input.aggregateId ?? null, JSON.stringify(input.payload), input.dedupeKey]
  );
}

async function insertAuditLog(client: any, input: {
  tenantId: string;
  action: string;
  entityId: string;
  previousValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  reasonComment?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await client.query(
    `
      INSERT INTO audit_log (
        tenant_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        previous_values,
        new_values,
        reason_comment,
        metadata
      )
      VALUES ($1,NULL,$2,'gear_alert',$3,$4::jsonb,$5::jsonb,$6,$7::jsonb)
    `,
    [
      input.tenantId,
      input.action,
      input.entityId,
      JSON.stringify(input.previousValues ?? {}),
      JSON.stringify(input.newValues ?? {}),
      input.reasonComment ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

async function queueLeadershipNotification(client: any, input: {
  tenantId: string;
  alertId: string;
  notificationType: string;
  title: string;
  body: string;
  targetType: "asset" | "kit";
  targetId: string;
}) {
  const recipients = await getLeadershipRecipients(client, input.tenantId);
  for (const recipientUserId of recipients) {
    for (const channel of ["in_app", "email"]) {
      await createAppEvent(client, {
        tenantId: input.tenantId,
        eventType: "notification.dispatch",
        aggregateType: "gear_alert",
        aggregateId: input.alertId,
        dedupeKey: `gear-notify:${input.alertId}:${recipientUserId}:${channel}`,
        payload: {
          tenant_id: input.tenantId,
          recipient_user_id: recipientUserId,
          notification_type: input.notificationType,
          channel,
          priority: "high",
          title: input.title,
          body: input.body,
          deep_link: `/gear?view=${input.targetType === "asset" ? "assets" : "kits"}&${input.targetType === "asset" ? "asset" : "kit"}=${input.targetId}`
        }
      });
    }
  }
}

async function getLeadershipRecipients(client: any, tenantId: string) {
  const { rows } = await client.query(
    `
      SELECT DISTINCT au.id
      FROM user_authority_assignment uaa
      JOIN app_user au
        ON au.id = uaa.user_id
       AND au.tenant_id = uaa.tenant_id
      WHERE uaa.tenant_id = $1
        AND uaa.authority_tier IN ('super_admin', 'leadership', 'director_admin')
        AND au.status = 'active'
    `,
    [tenantId]
  );
  return rows.map((row: any) => String(row.id));
}

async function getDefaultGearActorId(client: any, tenantId: string) {
  const recipients = await getLeadershipRecipients(client, tenantId);
  return recipients[0] ?? null;
}

async function createCustodyEvent(client: any, input: {
  tenantId: string;
  createdBy: string;
  assetId?: string | null;
  kitId?: string | null;
  linkedShootId?: string | null;
  linkedLocationId?: string | null;
  eventType: string;
  note: string;
}) {
  await client.query(
    `
      INSERT INTO gear_custody_event (
        tenant_id,
        asset_id,
        kit_id,
        event_type,
        linked_shoot_id,
        linked_location_id,
        timestamp,
        note,
        created_by,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8,now())
    `,
    [
      input.tenantId,
      input.assetId ?? null,
      input.kitId ?? null,
      input.eventType,
      input.linkedShootId ?? null,
      input.linkedLocationId ?? null,
      input.note,
      input.createdBy
    ]
  );
}

async function upsertOverdueReturnAlert(client: any, candidate: OverdueCandidate) {
  const createdBy = await getDefaultGearActorId(client, candidate.tenant_id);
  if (!createdBy) {
    return;
  }

  const manualResolved = await client.query(
    `
      SELECT id
      FROM gear_alert
      WHERE tenant_id = $1
        AND alert_type = 'overdue_return'
        AND checkout_id = $2
        AND status = 'resolved'
        AND resolution_type = 'manual_resolution'
      ORDER BY resolved_at DESC
      LIMIT 1
    `,
    [candidate.tenant_id, candidate.checkout_id]
  );
  if (manualResolved.rows[0]) {
    return;
  }

  const existing = await client.query(
    `
      SELECT *
      FROM gear_alert
      WHERE tenant_id = $1
        AND alert_type = 'overdue_return'
        AND checkout_id = $2
        AND status = 'open'
      LIMIT 1
      FOR UPDATE
    `,
    [candidate.tenant_id, candidate.checkout_id]
  );

  if (existing.rows[0]) {
    await client.query(
      `
        UPDATE gear_alert
        SET
          last_triggered_at = now(),
          due_at = $3,
          linked_shoot_id = $4,
          linked_location_id = $5,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [candidate.tenant_id, existing.rows[0].id, candidate.due_at, candidate.linked_shoot_id, candidate.linked_location_id]
    );
    return;
  }

  const insertResult = await client.query(
    `
      INSERT INTO gear_alert (
        tenant_id,
        alert_type,
        status,
        asset_id,
        kit_id,
        checkout_id,
        linked_shoot_id,
        linked_location_id,
        first_triggered_at,
        last_triggered_at,
        due_at,
        created_at,
        updated_at
      )
      VALUES ($1,'overdue_return','open',$2,$3,$4,$5,$6,now(),now(),$7,now(),now())
      RETURNING *
    `,
    [
      candidate.tenant_id,
      candidate.asset_id,
      candidate.kit_id,
      candidate.checkout_id,
      candidate.linked_shoot_id,
      candidate.linked_location_id,
      candidate.due_at
    ]
  );

  const alert = insertResult.rows[0];
  await createCustodyEvent(client, {
    tenantId: candidate.tenant_id,
    createdBy,
    assetId: candidate.asset_id,
    kitId: candidate.kit_id,
    linkedShootId: candidate.linked_shoot_id,
    linkedLocationId: candidate.linked_location_id,
    eventType: "overdue_return_flagged",
    note: "Overdue Return created after gear remained out more than 48 hours after shoot completion."
  });
  await insertAuditLog(client, {
    tenantId: candidate.tenant_id,
    action: "gear.alert.created",
    entityId: alert.id,
    previousValues: {},
    newValues: alert,
    reasonComment: "Overdue Return created automatically.",
    metadata: {
      alert_type: "overdue_return",
      checkout_id: candidate.checkout_id
    }
  });
  await queueLeadershipNotification(client, {
    tenantId: candidate.tenant_id,
    alertId: alert.id,
    notificationType: "gear.overdue_return",
    title: `Overdue Return: ${candidate.label}`,
    body: `${candidate.label} is still out more than 48 hours after ${candidate.shoot_title || "the linked shoot"} finished.`,
    targetType: candidate.asset_id ? "asset" : "kit",
    targetId: candidate.asset_id ?? (candidate.kit_id as string)
  });
}

async function upsertMissingGearAlert(client: any, candidate: MissingCandidate) {
  const createdBy = await getDefaultGearActorId(client, candidate.tenant_id);
  if (!createdBy) {
    return;
  }

  const manualResolved = await client.query(
    `
      SELECT resolved_at
      FROM gear_alert
      WHERE tenant_id = $1
        AND alert_type = 'missing_gear'
        AND status = 'resolved'
        AND resolution_type = 'manual_resolution'
        AND (
          ($2::uuid IS NOT NULL AND asset_id = $2)
          OR ($3::uuid IS NOT NULL AND kit_id = $3)
        )
      ORDER BY resolved_at DESC
      LIMIT 1
    `,
    [candidate.tenant_id, candidate.asset_id, candidate.kit_id]
  );
  if (manualResolved.rows[0]?.resolved_at && new Date(manualResolved.rows[0].resolved_at) >= new Date(candidate.target_updated_at)) {
    return;
  }

  const existing = await client.query(
    `
      SELECT *
      FROM gear_alert
      WHERE tenant_id = $1
        AND alert_type = 'missing_gear'
        AND status = 'open'
        AND (
          ($2::uuid IS NOT NULL AND asset_id = $2)
          OR ($3::uuid IS NOT NULL AND kit_id = $3)
        )
      LIMIT 1
      FOR UPDATE
    `,
    [candidate.tenant_id, candidate.asset_id, candidate.kit_id]
  );

  if (existing.rows[0]) {
    await client.query(
      `
        UPDATE gear_alert
        SET
          last_triggered_at = now(),
          linked_shoot_id = $3,
          linked_location_id = $4,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [candidate.tenant_id, existing.rows[0].id, candidate.linked_shoot_id, candidate.linked_location_id]
    );
    return;
  }

  const insertResult = await client.query(
    `
      INSERT INTO gear_alert (
        tenant_id,
        alert_type,
        status,
        asset_id,
        kit_id,
        linked_shoot_id,
        linked_location_id,
        first_triggered_at,
        last_triggered_at,
        created_at,
        updated_at
      )
      VALUES ($1,'missing_gear','open',$2,$3,$4,$5,now(),now(),now(),now())
      RETURNING *
    `,
    [candidate.tenant_id, candidate.asset_id, candidate.kit_id, candidate.linked_shoot_id, candidate.linked_location_id]
  );

  const alert = insertResult.rows[0];
  await createCustodyEvent(client, {
    tenantId: candidate.tenant_id,
    createdBy,
    assetId: candidate.asset_id,
    kitId: candidate.kit_id,
    linkedShootId: candidate.linked_shoot_id,
    linkedLocationId: candidate.linked_location_id,
    eventType: "missing_gear_alerted",
    note: "Missing Gear Alert created automatically after item was marked missing."
  });
  await insertAuditLog(client, {
    tenantId: candidate.tenant_id,
    action: "gear.alert.created",
    entityId: alert.id,
    previousValues: {},
    newValues: alert,
    reasonComment: "Missing Gear Alert created automatically.",
    metadata: {
      alert_type: "missing_gear",
      target_type: candidate.target_type,
      target_id: candidate.target_id
    }
  });
  await queueLeadershipNotification(client, {
    tenantId: candidate.tenant_id,
    alertId: alert.id,
    notificationType: "gear.missing_gear",
    title: `Missing Gear Alert: ${candidate.label}`,
    body: `${candidate.label} is marked missing and needs follow-through.`,
    targetType: candidate.target_type,
    targetId: candidate.target_id
  });
}

async function resolveGearAlert(client: any, input: {
  tenantId: string;
  alertId: string;
  resolutionType: "returned" | "status_cleared";
  reasonComment: string;
}) {
  const { rows } = await client.query(
    `
      UPDATE gear_alert
      SET
        status = 'resolved',
        resolved_at = now(),
        resolution_type = $3,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
        AND status = 'open'
      RETURNING *
    `,
    [input.tenantId, input.alertId, input.resolutionType]
  );

  const alert = rows[0];
  if (!alert) {
    return;
  }

  await insertAuditLog(client, {
    tenantId: input.tenantId,
    action: "gear.alert.auto_resolved",
    entityId: alert.id,
    previousValues: {},
    newValues: alert,
    reasonComment: input.reasonComment,
    metadata: {
      resolution_type: input.resolutionType
    }
  });
}

async function resolveStaleOverdueAlerts(client: any, tenantId: string) {
  const { rows } = await client.query(
    `
      SELECT gal.id, gcr.status AS checkout_status, gcr.returned_at
      FROM gear_alert gal
      LEFT JOIN gear_checkout_record gcr
        ON gcr.id = gal.checkout_id
      WHERE gal.tenant_id = $1
        AND gal.alert_type = 'overdue_return'
        AND gal.status = 'open'
    `,
    [tenantId]
  );

  for (const row of rows) {
    if (!row.checkout_status || row.checkout_status === "returned" || row.returned_at) {
      await resolveGearAlert(client, {
        tenantId,
        alertId: row.id,
        resolutionType: "returned",
        reasonComment: "Overdue Return auto-resolved after return was recorded."
      });
    }
  }
}

async function resolveClearedMissingAlerts(client: any, tenantId: string) {
  const { rows } = await client.query(
    `
      SELECT
        gal.id,
        gal.asset_id,
        gal.kit_id,
        ga.status AS asset_status,
        ga.active_status AS asset_active,
        gk.status AS kit_status,
        gk.active_status AS kit_active
      FROM gear_alert gal
      LEFT JOIN gear_asset ga
        ON ga.id = gal.asset_id
      LEFT JOIN gear_kit gk
        ON gk.id = gal.kit_id
      WHERE gal.tenant_id = $1
        AND gal.alert_type = 'missing_gear'
        AND gal.status = 'open'
    `,
    [tenantId]
  );

  for (const row of rows) {
    const stillMissing =
      (row.asset_id && row.asset_active && row.asset_status === "missing") ||
      (row.kit_id && row.kit_active && row.kit_status === "missing");
    if (!stillMissing) {
      await resolveGearAlert(client, {
        tenantId,
        alertId: row.id,
        resolutionType: "status_cleared",
        reasonComment: "Missing Gear Alert auto-resolved after target status changed."
      });
    }
  }
}

async function listOverdueCandidates(client: any, tenantId: string) {
  const result = await client.query(
    `
      SELECT
        gcr.tenant_id,
        gcr.id AS checkout_id,
        gcr.asset_id,
        gcr.kit_id,
        gcr.linked_shoot_id,
        gcr.linked_location_id,
        gcr.checked_out_to_user_id,
        COALESCE(ga.current_custodian_id, gk.current_custodian_id) AS current_custodian_id,
        COALESCE(ga.asset_name, gk.kit_name) AS label,
        shoot.title AS shoot_title,
        (
          COALESCE(shoot.end_time_est, shoot.start_time, shoot.showtime, gcr.expected_return_at, gcr.checked_out_at, gcr.reserved_at)
          + interval '48 hours'
        )::text AS due_at
      FROM gear_checkout_record gcr
      LEFT JOIN gear_asset ga
        ON ga.id = gcr.asset_id
      LEFT JOIN gear_kit gk
        ON gk.id = gcr.kit_id
      LEFT JOIN shoot shoot
        ON shoot.id = gcr.linked_shoot_id
      WHERE gcr.tenant_id = $1
        AND gcr.status IN ('assigned', 'checked_out')
        AND gcr.returned_at IS NULL
        AND gcr.linked_shoot_id IS NOT NULL
        AND (
          COALESCE(shoot.end_time_est, shoot.start_time, shoot.showtime, gcr.expected_return_at, gcr.checked_out_at, gcr.reserved_at)
          + interval '48 hours'
        ) <= now()
    `,
    [tenantId]
  );

  return result.rows as OverdueCandidate[];
}

async function listMissingCandidates(client: any, tenantId: string) {
  const result = await client.query(
    `
      SELECT *
      FROM (
        SELECT
          ga.tenant_id,
          'asset'::text AS target_type,
          ga.id AS target_id,
          ga.id AS asset_id,
          NULL::uuid AS kit_id,
          latest_checkout.linked_shoot_id,
          latest_checkout.linked_location_id,
          ga.current_custodian_id,
          ga.asset_name AS label,
          ga.updated_at::text AS target_updated_at
        FROM gear_asset ga
        LEFT JOIN LATERAL (
          SELECT linked_shoot_id, linked_location_id
          FROM gear_checkout_record gcr
          WHERE gcr.tenant_id = ga.tenant_id
            AND gcr.asset_id = ga.id
          ORDER BY COALESCE(gcr.returned_at, gcr.checked_out_at, gcr.reserved_at) DESC
          LIMIT 1
        ) latest_checkout ON true
        WHERE ga.tenant_id = $1
          AND ga.active_status = true
          AND ga.status = 'missing'

        UNION ALL

        SELECT
          gk.tenant_id,
          'kit'::text AS target_type,
          gk.id AS target_id,
          NULL::uuid AS asset_id,
          gk.id AS kit_id,
          latest_checkout.linked_shoot_id,
          latest_checkout.linked_location_id,
          gk.current_custodian_id,
          gk.kit_name AS label,
          gk.updated_at::text AS target_updated_at
        FROM gear_kit gk
        LEFT JOIN LATERAL (
          SELECT linked_shoot_id, linked_location_id
          FROM gear_checkout_record gcr
          WHERE gcr.tenant_id = gk.tenant_id
            AND gcr.kit_id = gk.id
          ORDER BY COALESCE(gcr.returned_at, gcr.checked_out_at, gcr.reserved_at) DESC
          LIMIT 1
        ) latest_checkout ON true
        WHERE gk.tenant_id = $1
          AND gk.active_status = true
          AND gk.status = 'missing'
      ) missing_candidates
    `,
    [tenantId]
  );

  return result.rows as MissingCandidate[];
}

export async function monitorGear() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE pmc_app");
    const tenants = await client.query("SELECT id FROM tenant");
    for (const tenant of tenants.rows) {
      await client.query("SELECT app.set_context($1::uuid, NULL::uuid)", [tenant.id]);

      await resolveStaleOverdueAlerts(client, tenant.id);
      await resolveClearedMissingAlerts(client, tenant.id);

      const overdueCandidates = await listOverdueCandidates(client, tenant.id);
      for (const candidate of overdueCandidates) {
        await upsertOverdueReturnAlert(client, candidate);
      }

      const missingCandidates = await listMissingCandidates(client, tenant.id);
      for (const candidate of missingCandidates) {
        await upsertMissingGearAlert(client, candidate);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
