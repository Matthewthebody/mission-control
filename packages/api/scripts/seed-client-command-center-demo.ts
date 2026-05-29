import process from "node:process";
import { pathToFileURL } from "node:url";
import type { PoolClient, QueryResultRow } from "pg";
import { pool } from "../src/db/pool.js";

const DEMO_MARKER = "client_command_center_v1";
const DEMO_ORGANIZATION_KEYS = ["wayzata-district", "osseo-district", "tonka-united"];
const DEMO_ACCOUNT_KEYS = ["wayzata-high", "maple-grove-high", "tonka-united-soccer"];
const DEMO_LOCATION_KEYS = ["wayzata-main", "wayzata-gym", "maple-grove-main", "tonka-stadium"];
const DEMO_LOCATION_ATTACHMENT_TITLES = [
  "Wayzata Door 1 Parking Map",
  "Wayzata Door 7 Entrance Photo",
  "Wayzata Commons Setup Reference",
  "Tonka Stadium Field Map"
];
const DEMO_CONTACT_KEYS = [
  "wayzata-principal",
  "wayzata-secretary",
  "wayzata-yearbook",
  "wayzata-day-of",
  "wayzata-billing",
  "wayzata-district-contact",
  "maple-grove-principal",
  "maple-grove-secretary",
  "tonka-united-director",
  "tonka-united-coach"
];
const DEMO_JOB_NUMBERS = ["CCC-DEMO-001", "CCC-DEMO-002"];
const DEMO_TASK_NUMBERS = ["CCC-DEMO-TASK-001", "CCC-DEMO-TASK-002"];

function assertClientCommandCenterDemoSeedAllowed(argv = process.argv, env = process.env) {
  if (env.NODE_ENV === "production") {
    throw new Error("Client Command Center demo seed is disabled in production.");
  }
  if (!argv.includes("--allow-demo-data")) {
    throw new Error("Pass --allow-demo-data to confirm this development-only demo seed.");
  }
}

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

async function queryOne<T extends QueryResultRow>(client: PoolClient, sql: string, params: unknown[]) {
  const { rows } = await client.query<T>(sql, params);
  const row = rows[0];
  if (!row) {
    throw new Error("Expected seed query to return one row.");
  }
  return row;
}

async function getTenantAndUsers(client: PoolClient) {
  const tenant = await queryOne<{ id: string }>(client, "SELECT id::text FROM tenant WHERE name = 'Demo Studio' LIMIT 1", []);
  const users = await client.query<{ email: string; id: string }>(
    `
      SELECT lower(email) AS email, id::text
      FROM app_user
      WHERE tenant_id = $1
        AND lower(email) = ANY($2::text[])
    `,
    [tenant.id, ["leadership@example.com", "schools-office@example.com", "sports-office@example.com", "graphic@example.com"]]
  );
  const byEmail = new Map(users.rows.map((row) => [row.email, row.id]));
  const fallback = users.rows[0]?.id;
  if (!fallback) {
    throw new Error("Expected seeded demo users before loading Client Command Center demo data.");
  }
  return {
    tenantId: tenant.id,
    users: {
      leadership: byEmail.get("leadership@example.com") ?? fallback,
      schools: byEmail.get("schools-office@example.com") ?? fallback,
      sports: byEmail.get("sports-office@example.com") ?? fallback,
      graphics: byEmail.get("graphic@example.com") ?? fallback
    }
  };
}

async function resetDemoData(client: PoolClient, tenantId: string) {
  const demoOrganizationIds = (
    await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM organization
        WHERE tenant_id = $1
          AND client_demo_key LIKE $2
      `,
      [tenantId, `${DEMO_MARKER}:%`]
    )
  ).rows.map((row) => row.id);
  const demoContactIds = (
    await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM organization_contact
        WHERE tenant_id = $1
          AND client_demo_key LIKE $2
      `,
      [tenantId, `${DEMO_MARKER}:%`]
    )
  ).rows.map((row) => row.id);
  const demoLocationIds = (
    await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM shoot_location
        WHERE tenant_id = $1
          AND external_source = $2
          AND external_key LIKE $3
      `,
      [tenantId, DEMO_MARKER, `${DEMO_MARKER}:%`]
    )
  ).rows.map((row) => row.id);

  await client.query(
    `
      DELETE FROM app_event
      WHERE tenant_id = $1
        AND (
          payload->>'demo_seed' = $2
          OR dedupe_key LIKE 'client-command-center-demo:%'
        )
    `,
    [tenantId, DEMO_MARKER]
  );
  await client.query("DELETE FROM client_context_link WHERE tenant_id = $1 AND (account_id = ANY($2::uuid[]) OR contact_id = ANY($3::uuid[]))", [
    tenantId,
    demoOrganizationIds,
    demoContactIds
  ]);
  await client.query("DELETE FROM location_reference_attachment WHERE tenant_id = $1 AND location_id = ANY($2::uuid[])", [tenantId, demoLocationIds]);
  await client.query("DELETE FROM work_task WHERE tenant_id = $1 AND task_number = ANY($2::text[])", [tenantId, DEMO_TASK_NUMBERS]);
  await client.query("DELETE FROM jobs WHERE tenant_id = $1 AND job_number = ANY($2::text[])", [tenantId, DEMO_JOB_NUMBERS]);
  await client.query("DELETE FROM shoot_location WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, demoLocationIds]);
  await client.query("DELETE FROM directory_touchpoint WHERE tenant_id = $1 AND organization_id = ANY($2::uuid[])", [tenantId, demoOrganizationIds]);
  await client.query("DELETE FROM organization_contact_relationship WHERE tenant_id = $1 AND contact_id = ANY($2::uuid[])", [tenantId, demoContactIds]);
  await client.query("DELETE FROM organization_contact WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, demoContactIds]);
  await client.query("DELETE FROM account_service WHERE tenant_id = $1 AND account_id = ANY($2::uuid[])", [tenantId, demoOrganizationIds]);
  await client.query("DELETE FROM client_internal_owner WHERE tenant_id = $1 AND (account_id = ANY($2::uuid[]) OR organization_id = ANY($2::uuid[]))", [
    tenantId,
    demoOrganizationIds
  ]);
  await client.query("DELETE FROM organization WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, demoOrganizationIds]);
}

async function upsertOrganization(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string;
    demoKey: string;
    name: string;
    entityKind: "parent_organization" | "account";
    organizationType: string;
    accountType: string;
    parentOrganizationId?: string | null;
    notes?: string;
  }
) {
  const demoKey = `${DEMO_MARKER}:${input.demoKey}`;
  const normalized = normalizeName(input.name);
  const existing = await client.query<{ id: string }>(
    "SELECT id::text FROM organization WHERE tenant_id = $1 AND client_demo_key = $2 LIMIT 1",
    [input.tenantId, demoKey]
  );
  if (existing.rows[0]) {
    return queryOne<{ id: string }>(
      client,
      `
        UPDATE organization
        SET
          canonical_name = $3,
          normalized_canonical_name = $4,
          display_name = $3,
          account_type = $5,
          parent_organization_id = $6,
          client_entity_kind = $7,
          client_organization_type = $8,
          client_lifecycle_status = 'active',
          notes = $9,
          updated_by_user_id = $10,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
        RETURNING id::text
      `,
      [
        input.tenantId,
        existing.rows[0].id,
        input.name,
        normalized,
        input.accountType,
        input.parentOrganizationId ?? null,
        input.entityKind,
        input.organizationType,
        input.notes ?? `[${DEMO_MARKER}] demo client context`,
        input.actorUserId
      ]
    );
  }
  return queryOne<{ id: string }>(
    client,
    `
      INSERT INTO organization (
        tenant_id,
        canonical_name,
        normalized_canonical_name,
        display_name,
        account_type,
        active_status,
        parent_organization_id,
        client_entity_kind,
        client_organization_type,
        client_lifecycle_status,
        client_demo_key,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$2,$4,'active',$5,$6,$7,'active',$8,$9,$10,$10)
      RETURNING id::text
    `,
    [
      input.tenantId,
      input.name,
      normalized,
      input.accountType,
      input.parentOrganizationId ?? null,
      input.entityKind,
      input.organizationType,
      demoKey,
      input.notes ?? `[${DEMO_MARKER}] demo client context`,
      input.actorUserId
    ]
  );
}

async function upsertContact(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string;
    organizationId: string;
    demoKey: string;
    firstName: string;
    lastName: string;
    title: string;
    email: string;
    phone?: string | null;
    mobilePhone?: string | null;
    officePhone?: string | null;
    allowSms?: boolean;
    smsConsentStatus?: "unknown" | "opted_in" | "opted_out" | "not_eligible";
    doNotContact?: boolean;
  }
) {
  const demoKey = `${DEMO_MARKER}:${input.demoKey}`;
  const fullName = `${input.firstName} ${input.lastName}`;
  const existing = await client.query<{ id: string }>(
    "SELECT id::text FROM organization_contact WHERE tenant_id = $1 AND client_demo_key = $2 LIMIT 1",
    [input.tenantId, demoKey]
  );
  if (existing.rows[0]) {
    return queryOne<{ id: string }>(
      client,
      `
        UPDATE organization_contact
        SET
          organization_id = $3,
          first_name = $4,
          last_name = $5,
          full_name = $6,
          display_name = $6,
          normalized_full_name = $7,
          title = $8,
          email = $9,
          phone = $10,
          mobile_phone = $11,
          office_phone = $12,
          allow_email = true,
          allow_sms = $13,
          allow_phone = true,
          do_not_contact = $14,
          sms_consent_status = $15,
          updated_by_user_id = $16,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
        RETURNING id::text
      `,
      [
        input.tenantId,
        existing.rows[0].id,
        input.organizationId,
        input.firstName,
        input.lastName,
        fullName,
        normalizeName(fullName),
        input.title,
        input.email,
        input.phone ?? null,
        input.mobilePhone ?? null,
        input.officePhone ?? null,
        input.allowSms ?? false,
        input.doNotContact ?? false,
        input.smsConsentStatus ?? "unknown",
        input.actorUserId
      ]
    );
  }
  return queryOne<{ id: string }>(
    client,
    `
      INSERT INTO organization_contact (
        tenant_id,
        organization_id,
        first_name,
        last_name,
        full_name,
        display_name,
        normalized_full_name,
        title,
        email,
        phone,
        mobile_phone,
        office_phone,
        preferred_contact_method,
        active_status,
        allow_email,
        allow_sms,
        allow_phone,
        do_not_contact,
        sms_consent_status,
        contact_status,
        role_category,
        operational_importance,
        decision_influence,
        relationship_strength,
        client_demo_key,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,'email','active',true,$12,true,$13,$14,'active','other','normal','informational_only','working_relationship',$15,$16,$16)
      RETURNING id::text
    `,
    [
      input.tenantId,
      input.organizationId,
      input.firstName,
      input.lastName,
      fullName,
      normalizeName(fullName),
      input.title,
      input.email,
      input.phone ?? null,
      input.mobilePhone ?? null,
      input.officePhone ?? null,
      input.allowSms ?? false,
      input.doNotContact ?? false,
      input.smsConsentStatus ?? "unknown",
      demoKey,
      input.actorUserId
    ]
  );
}

async function upsertLocation(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string;
    accountId: string;
    demoKey: string;
    name: string;
    locationType: "main_building" | "gym" | "stadium_field" | "district_office" | "offsite" | "other";
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    state: string;
    zip: string;
    parkingInstructions: string;
    entranceInstructions: string;
    unloadingInstructions?: string | null;
    setupArea: string;
    backupIndoorLocation?: string | null;
    accessibilityNotes?: string | null;
    powerAvailabilityNotes?: string | null;
    wifiCellNotes?: string | null;
    securityCheckinRequirements?: string | null;
    weatherContingencyNotes?: string | null;
    googleMapsUrl?: string | null;
    navigationNotes?: string | null;
    clientFacingNotes: string;
    employeeFacingNotes: string;
    internalOnlyNotes: string;
    notes?: string | null;
  }
) {
  const externalKey = `${DEMO_MARKER}:${input.demoKey}`;
  const address = [input.addressLine1, input.addressLine2, `${input.city}, ${input.state} ${input.zip}`].filter(Boolean).join(", ");
  return queryOne<{ id: string }>(
    client,
    `
      INSERT INTO shoot_location (
        tenant_id,
        external_source,
        external_key,
        name,
        normalized_name,
        address,
        normalized_address,
        organization_id,
        address_line_1,
        address_line_2,
        city,
        state,
        zip,
        maps_label,
        active_status,
        location_type,
        parking_instructions,
        entrance_instructions,
        unloading_instructions,
        setup_area,
        backup_indoor_location,
        accessibility_notes,
        power_availability_notes,
        wifi_cell_notes,
        security_checkin_requirements,
        weather_contingency_notes,
        navigation_url,
        navigation_notes,
        client_facing_notes,
        employee_facing_notes,
        internal_only_notes,
        location_details,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$4,'active',$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$31)
      ON CONFLICT (tenant_id, external_source, external_key)
      DO UPDATE SET
        name = EXCLUDED.name,
        normalized_name = EXCLUDED.normalized_name,
        address = EXCLUDED.address,
        normalized_address = EXCLUDED.normalized_address,
        organization_id = EXCLUDED.organization_id,
        address_line_1 = EXCLUDED.address_line_1,
        address_line_2 = EXCLUDED.address_line_2,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        zip = EXCLUDED.zip,
        maps_label = EXCLUDED.maps_label,
        active_status = EXCLUDED.active_status,
        location_type = EXCLUDED.location_type,
        parking_instructions = EXCLUDED.parking_instructions,
        entrance_instructions = EXCLUDED.entrance_instructions,
        unloading_instructions = EXCLUDED.unloading_instructions,
        setup_area = EXCLUDED.setup_area,
        backup_indoor_location = EXCLUDED.backup_indoor_location,
        accessibility_notes = EXCLUDED.accessibility_notes,
        power_availability_notes = EXCLUDED.power_availability_notes,
        wifi_cell_notes = EXCLUDED.wifi_cell_notes,
        security_checkin_requirements = EXCLUDED.security_checkin_requirements,
        weather_contingency_notes = EXCLUDED.weather_contingency_notes,
        navigation_url = EXCLUDED.navigation_url,
        navigation_notes = EXCLUDED.navigation_notes,
        client_facing_notes = EXCLUDED.client_facing_notes,
        employee_facing_notes = EXCLUDED.employee_facing_notes,
        internal_only_notes = EXCLUDED.internal_only_notes,
        location_details = EXCLUDED.location_details,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
      RETURNING id::text
    `,
    [
      input.tenantId,
      DEMO_MARKER,
      externalKey,
      input.name,
      normalizeName(input.name),
      address,
      normalizeName(address),
      input.accountId,
      input.addressLine1,
      input.addressLine2 ?? null,
      input.city,
      input.state,
      input.zip,
      input.locationType,
      input.parkingInstructions,
      input.entranceInstructions,
      input.unloadingInstructions ?? null,
      input.setupArea,
      input.backupIndoorLocation ?? null,
      input.accessibilityNotes ?? null,
      input.powerAvailabilityNotes ?? null,
      input.wifiCellNotes ?? null,
      input.securityCheckinRequirements ?? null,
      input.weatherContingencyNotes ?? null,
      input.googleMapsUrl ?? null,
      input.navigationNotes ?? null,
      input.clientFacingNotes,
      input.employeeFacingNotes,
      input.internalOnlyNotes,
      input.notes ?? `[${DEMO_MARKER}] communication-ready location`,
      input.actorUserId
    ]
  );
}

async function upsertLocationAttachment(
  client: PoolClient,
  input: {
    tenantId: string;
    locationId: string;
    title: string;
    description: string;
    attachmentType: "parking_map" | "entrance_photo" | "setup_reference" | "field_map" | "screenshot" | "building_map" | "other";
    audience: "client_facing" | "employee_facing" | "internal_only";
    fileUrl?: string | null;
    storageKey?: string | null;
    uploadedByUserId: string;
  }
) {
  await client.query(
    `
      INSERT INTO location_reference_attachment (
        tenant_id,
        location_id,
        title,
        description,
        attachment_type,
        audience,
        file_url,
        storage_key,
        uploaded_by_user_id,
        active_status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active')
      ON CONFLICT (tenant_id, location_id, title)
      DO UPDATE SET
        description = EXCLUDED.description,
        attachment_type = EXCLUDED.attachment_type,
        audience = EXCLUDED.audience,
        file_url = EXCLUDED.file_url,
        storage_key = EXCLUDED.storage_key,
        uploaded_by_user_id = EXCLUDED.uploaded_by_user_id,
        active_status = EXCLUDED.active_status,
        updated_at = now()
    `,
    [
      input.tenantId,
      input.locationId,
      input.title,
      input.description,
      input.attachmentType,
      input.audience,
      input.fileUrl ?? null,
      input.storageKey ?? null,
      input.uploadedByUserId
    ]
  );
}

async function upsertRelationship(
  client: PoolClient,
  input: { tenantId: string; actorUserId: string; organizationId: string; contactId: string; roles: string[]; primary?: boolean }
) {
  await client.query(
    `
      INSERT INTO organization_contact_relationship (
        tenant_id,
        organization_id,
        contact_id,
        relationship_role,
        is_primary,
        is_current,
        client_roles,
        receives_picture_day_emails,
        receives_yearbook_emails,
        receives_billing_emails,
        receives_approval_emails,
        receives_onboarding_emails,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,'general',$4,true,$5::client_contact_role[],$6,$7,$8,$9,$10,$11,$11)
      ON CONFLICT (tenant_id, organization_id, contact_id)
        WHERE is_current
      DO UPDATE SET
        client_roles = EXCLUDED.client_roles,
        is_primary = EXCLUDED.is_primary,
        receives_picture_day_emails = EXCLUDED.receives_picture_day_emails,
        receives_yearbook_emails = EXCLUDED.receives_yearbook_emails,
        receives_billing_emails = EXCLUDED.receives_billing_emails,
        receives_approval_emails = EXCLUDED.receives_approval_emails,
        receives_onboarding_emails = EXCLUDED.receives_onboarding_emails,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
    `,
    [
      input.tenantId,
      input.organizationId,
      input.contactId,
      input.primary ?? input.roles.includes("primary_contact"),
      input.roles,
      input.roles.includes("picture_day_contact"),
      input.roles.includes("yearbook_contact"),
      input.roles.includes("billing_contact"),
      input.roles.includes("approval_contact"),
      input.roles.includes("primary_contact"),
      input.actorUserId
    ]
  );
}

async function upsertService(client: PoolClient, input: { tenantId: string; actorUserId: string; accountId: string; serviceType: string; status?: string }) {
  await client.query(
    `
      INSERT INTO account_service (tenant_id, account_id, service_type, status, notes, created_by_user_id, updated_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$6)
      ON CONFLICT (tenant_id, account_id, service_type)
      DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()
    `,
    [input.tenantId, input.accountId, input.serviceType, input.status ?? "active", `[${DEMO_MARKER}] demo service`, input.actorUserId]
  );
}

async function upsertOwner(
  client: PoolClient,
  input: { tenantId: string; actorUserId: string; accountId: string; ownerUserId: string; ownerType: string; notes?: string }
) {
  const existing = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM client_internal_owner
      WHERE tenant_id = $1
        AND account_id = $2
        AND owner_user_id = $3
        AND owner_type = $4
      LIMIT 1
    `,
    [input.tenantId, input.accountId, input.ownerUserId, input.ownerType]
  );
  if (existing.rows[0]) {
    await client.query("UPDATE client_internal_owner SET notes = $3, updated_by_user_id = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2", [
      input.tenantId,
      existing.rows[0].id,
      input.notes ?? `[${DEMO_MARKER}] demo owner`,
      input.actorUserId
    ]);
    return;
  }
  await client.query(
    `
      INSERT INTO client_internal_owner (tenant_id, account_id, owner_user_id, owner_type, notes, created_by_user_id, updated_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$6)
    `,
    [input.tenantId, input.accountId, input.ownerUserId, input.ownerType, input.notes ?? `[${DEMO_MARKER}] demo owner`, input.actorUserId]
  );
}

async function upsertJob(
  client: PoolClient,
  input: { tenantId: string; actorUserId: string; accountId: string; contactId: string; ownerUserId: string; jobNumber: string; title: string; startsInDays: number; locationId?: string | null }
) {
  return queryOne<{ id: string }>(
    client,
    `
      INSERT INTO jobs (
        tenant_id,
        job_number,
        department_type,
        job_category,
        organization_id,
        primary_contact_id,
        primary_location_id,
        account_owner_user_id,
        title,
        job_status,
        readiness_status,
        scheduled_start_at,
        scheduled_end_at,
        timezone,
        production_required,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,'schools','photo_day',$3,$4,$5,$6,$7,'confirmed','ready',now() + ($8 || ' days')::interval,now() + ($8 || ' days')::interval + interval '2 hours','America/Chicago',true,$9,$9)
      ON CONFLICT (tenant_id, job_number) WHERE job_number IS NOT NULL
      DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        primary_contact_id = EXCLUDED.primary_contact_id,
        primary_location_id = EXCLUDED.primary_location_id,
        account_owner_user_id = EXCLUDED.account_owner_user_id,
        title = EXCLUDED.title,
        scheduled_start_at = EXCLUDED.scheduled_start_at,
        scheduled_end_at = EXCLUDED.scheduled_end_at,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
      RETURNING id::text
    `,
    [
      input.tenantId,
      input.jobNumber,
      input.accountId,
      input.contactId,
      input.locationId ?? null,
      input.ownerUserId,
      input.title,
      input.startsInDays,
      input.actorUserId
    ]
  );
}

async function upsertTask(
  client: PoolClient,
  input: { tenantId: string; actorUserId: string; accountId: string; contactId: string; assigneeId: string; taskNumber: string; title: string; serviceType: string; communicationType: string }
) {
  const task = await queryOne<{ id: string }>(
    client,
    `
      INSERT INTO work_task (
        tenant_id,
        task_number,
        title,
        description,
        task_type,
        department_type,
        organization_id,
        contact_id,
        assigned_to_user_id,
        status,
        priority,
        due_at,
        service_type,
        communication_type,
        source_type,
        source_id,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,'Client Command Center demo task','client_follow_up','schools',$4,$5,$6,'not_started','normal',now() + interval '2 days',$7,$8,'client_command_center_demo',$4,$9,$9)
      ON CONFLICT (tenant_id, task_number)
      DO UPDATE SET
        title = EXCLUDED.title,
        organization_id = EXCLUDED.organization_id,
        contact_id = EXCLUDED.contact_id,
        assigned_to_user_id = EXCLUDED.assigned_to_user_id,
        service_type = EXCLUDED.service_type,
        communication_type = EXCLUDED.communication_type,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
      RETURNING id::text
    `,
    [
      input.tenantId,
      input.taskNumber,
      input.title,
      input.accountId,
      input.contactId,
      input.assigneeId,
      input.serviceType,
      input.communicationType,
      input.actorUserId
    ]
  );
  await client.query(
    `
      INSERT INTO client_context_link (
        tenant_id,
        account_id,
        contact_id,
        task_id,
        owner_user_id,
        service_type,
        communication_type,
        source_type,
        source_id,
        metadata,
        created_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,'client_command_center_demo',$2,$8,$9)
      ON CONFLICT DO NOTHING
    `,
    [
      input.tenantId,
      input.accountId,
      input.contactId,
      task.id,
      input.assigneeId,
      input.serviceType,
      input.communicationType,
      JSON.stringify({ demo_seed: DEMO_MARKER, task_number: input.taskNumber }),
      input.actorUserId
    ]
  );
}

async function addDemoNote(client: PoolClient, input: { tenantId: string; actorUserId: string; accountId: string; contactId?: string | null; summary: string }) {
  await client.query(
    `
      INSERT INTO directory_touchpoint (
        tenant_id,
        organization_id,
        contact_id,
        channel,
        category,
        subject,
        summary,
        outcome_state,
        owner_user_id,
        created_by_user_id,
        updated_by_user_id
      )
      SELECT $1,$2,$3,'note','relationship_maintenance','Client Command Center demo note',$4,'informational_only',$5,$5,$5
      WHERE NOT EXISTS (
        SELECT 1
        FROM directory_touchpoint
        WHERE tenant_id = $1
          AND organization_id = $2
          AND summary = $4
      )
    `,
    [input.tenantId, input.accountId, input.contactId ?? null, input.summary, input.actorUserId]
  );
}

async function seedDemoData(client: PoolClient) {
  const { tenantId, users } = await getTenantAndUsers(client);
  await resetDemoData(client, tenantId);

  const wayzataDistrict = await upsertOrganization(client, {
    tenantId,
    actorUserId: users.leadership,
    demoKey: DEMO_ORGANIZATION_KEYS[0],
    name: "Wayzata School District",
    entityKind: "parent_organization",
    organizationType: "school_district",
    accountType: "schools_underclass_portraits"
  });
  const osseoDistrict = await upsertOrganization(client, {
    tenantId,
    actorUserId: users.leadership,
    demoKey: DEMO_ORGANIZATION_KEYS[1],
    name: "Osseo Area Schools",
    entityKind: "parent_organization",
    organizationType: "school_district",
    accountType: "schools_underclass_portraits"
  });
  const tonkaUnited = await upsertOrganization(client, {
    tenantId,
    actorUserId: users.leadership,
    demoKey: DEMO_ORGANIZATION_KEYS[2],
    name: "Tonka United",
    entityKind: "parent_organization",
    organizationType: "sports_association",
    accountType: "sports"
  });

  const wayzataHigh = await upsertOrganization(client, {
    tenantId,
    actorUserId: users.schools,
    demoKey: DEMO_ACCOUNT_KEYS[0],
    name: "Wayzata High School",
    entityKind: "account",
    organizationType: "high_school",
    accountType: "schools_underclass_portraits",
    parentOrganizationId: wayzataDistrict.id
  });
  const mapleGrove = await upsertOrganization(client, {
    tenantId,
    actorUserId: users.schools,
    demoKey: DEMO_ACCOUNT_KEYS[1],
    name: "Maple Grove Senior High",
    entityKind: "account",
    organizationType: "high_school",
    accountType: "schools_underclass_portraits",
    parentOrganizationId: osseoDistrict.id
  });
  const tonkaSoccer = await upsertOrganization(client, {
    tenantId,
    actorUserId: users.sports,
    demoKey: DEMO_ACCOUNT_KEYS[2],
    name: "Tonka United Soccer",
    entityKind: "account",
    organizationType: "sports_association",
    accountType: "sports",
    parentOrganizationId: tonkaUnited.id
  });

  const wayzataMain = await upsertLocation(client, {
    tenantId,
    actorUserId: users.schools,
    accountId: wayzataHigh.id,
    demoKey: DEMO_LOCATION_KEYS[0],
    name: "Wayzata High School Main Building",
    locationType: "main_building",
    addressLine1: "4955 Peony Ln N",
    city: "Plymouth",
    state: "MN",
    zip: "55446",
    parkingInstructions: "Use the visitor lot near Door 1 unless school buses are loading.",
    entranceInstructions: "Check in at Door 1 with the front office before unloading equipment.",
    unloadingInstructions: "Unload at the curb cut near Door 1, then move vehicles to visitor parking.",
    setupArea: "Main commons, west wall by the media center hallway.",
    backupIndoorLocation: "Auxiliary gym if commons is unavailable.",
    accessibilityNotes: "Elevator is available by the front office for second-floor access.",
    powerAvailabilityNotes: "Two outlets along the west wall; bring a 25-foot extension cord.",
    wifiCellNotes: "Cell service is strong in the commons; guest Wi-Fi requires office approval.",
    securityCheckinRequirements: "All staff must show ID badges at the front office.",
    weatherContingencyNotes: "Use Door 1 only during rain; side doors are locked during school hours.",
    googleMapsUrl: "https://www.google.com/maps/search/?api=1&query=Wayzata%20High%20School%204955%20Peony%20Ln%20N%20Plymouth%20MN%2055446",
    navigationNotes: "Navigate to the main office entrance, not the activities lot.",
    clientFacingNotes: "Photo team should check in at the front office and use the visitor lot near Door 1.",
    employeeFacingNotes: "Bring extension cord and keep gear tight to the west wall so lunch traffic can pass.",
    internalOnlyNotes: "Do not mention the recurring lunch traffic concern in client prep messages."
  });
  const wayzataGym = await upsertLocation(client, {
    tenantId,
    actorUserId: users.schools,
    accountId: wayzataHigh.id,
    demoKey: DEMO_LOCATION_KEYS[1],
    name: "Wayzata High School Gym",
    locationType: "gym",
    addressLine1: "4955 Peony Ln N",
    city: "Plymouth",
    state: "MN",
    zip: "55446",
    parkingInstructions: "Park in the activities lot on the south side of campus.",
    entranceInstructions: "Use Activities Door 7 and check in with the athletic office.",
    unloadingInstructions: "Unload through the south service entrance when athletics staff unlocks it.",
    setupArea: "Northwest corner of the main gym, away from team warmup lanes.",
    backupIndoorLocation: "Wrestling room if the main gym schedule changes.",
    accessibilityNotes: "Level entry from Door 7.",
    powerAvailabilityNotes: "Power is available behind the scorer table.",
    wifiCellNotes: "Cell service is weak inside the gym.",
    securityCheckinRequirements: "Activities staff must confirm access before doors are propped.",
    weatherContingencyNotes: "Keep wet gear off the gym floor; use hallway staging during snow.",
    googleMapsUrl: "https://www.google.com/maps/search/?api=1&query=Wayzata%20High%20School%20Activities%20Door%207%20Plymouth%20MN",
    navigationNotes: "Use Door 7 and the south activities lot; the main entrance adds a long walk.",
    clientFacingNotes: "Teams should enter through Activities Door 7 and follow signs to the gym.",
    employeeFacingNotes: "Confirm unlock timing with athletics before arrival.",
    internalOnlyNotes: "Gym schedule changes often; verify the day before even if calendar says confirmed."
  });
  const mapleMain = await upsertLocation(client, {
    tenantId,
    actorUserId: users.schools,
    accountId: mapleGrove.id,
    demoKey: DEMO_LOCATION_KEYS[2],
    name: "Maple Grove Senior High Main Office",
    locationType: "main_building",
    addressLine1: "9800 Fernbrook Ln N",
    city: "Maple Grove",
    state: "MN",
    zip: "55369",
    parkingInstructions: "Use the visitor stalls at the main entrance.",
    entranceInstructions: "Front office will have badges ready for the crew.",
    unloadingInstructions: "Keep unloading under 10 minutes at the main entrance.",
    setupArea: "Auditorium lobby, left side by trophy cases.",
    backupIndoorLocation: "Small gym if the lobby is reserved.",
    accessibilityNotes: "Flat entry through the main doors.",
    powerAvailabilityNotes: "Power strip recommended; outlets are behind display cases.",
    wifiCellNotes: "Cell service is reliable; guest Wi-Fi is not guaranteed.",
    securityCheckinRequirements: "Crew list must be sent to office before arrival.",
    weatherContingencyNotes: "Use the main entrance vestibule for staging in severe weather.",
    navigationNotes: "Use the main visitor entrance and avoid bus lanes before 8:15 a.m.",
    clientFacingNotes: "The crew will check in at the main office and set up near the auditorium lobby.",
    employeeFacingNotes: "Send final crew list to front office before arrival.",
    internalOnlyNotes: "Office prefers no early arrivals before buses clear."
  });
  const tonkaStadium = await upsertLocation(client, {
    tenantId,
    actorUserId: users.sports,
    accountId: tonkaSoccer.id,
    demoKey: DEMO_LOCATION_KEYS[3],
    name: "Tonka United Stadium Field",
    locationType: "stadium_field",
    addressLine1: "18300 Minnetonka Blvd",
    city: "Minnetonka",
    state: "MN",
    zip: "55345",
    parkingInstructions: "Use the west lot by the turf field.",
    entranceInstructions: "Meet the coach at the field gate before unloading.",
    unloadingInstructions: "Carts can roll through the west gate; do not drive onto turf.",
    setupArea: "North end of the field near the scoreboard.",
    backupIndoorLocation: "Use the fieldhouse lobby during lightning or heavy rain.",
    accessibilityNotes: "Ramp access is available at the west gate.",
    powerAvailabilityNotes: "No field power; charge strobes before arrival.",
    wifiCellNotes: "Cell signal is strong on the field.",
    securityCheckinRequirements: "Coach must unlock the west gate.",
    weatherContingencyNotes: "Move indoors immediately if lightning is within range.",
    googleMapsUrl: "https://www.google.com/maps/search/?api=1&query=Tonka%20United%20Stadium%20Field%2018300%20Minnetonka%20Blvd%20Minnetonka%20MN",
    navigationNotes: "Navigate to the stadium west lot, not the school office.",
    clientFacingNotes: "Teams should gather by the west gate and follow coach instructions.",
    employeeFacingNotes: "Bring charged batteries and sandbags; field can be windy.",
    internalOnlyNotes: "Do not promise fieldhouse access unless coach confirms it."
  });

  await upsertLocationAttachment(client, {
    tenantId,
    locationId: wayzataMain.id,
    title: DEMO_LOCATION_ATTACHMENT_TITLES[0],
    description: "Reference screenshot showing Door 1 visitor parking and the recommended unloading curb.",
    attachmentType: "parking_map",
    audience: "employee_facing",
    fileUrl: "https://example.com/mission-control-demo/wayzata-door-1-parking-map.png",
    uploadedByUserId: users.schools
  });
  await upsertLocationAttachment(client, {
    tenantId,
    locationId: wayzataGym.id,
    title: DEMO_LOCATION_ATTACHMENT_TITLES[1],
    description: "Photo reference for Activities Door 7 so sports crews do not enter at the main office.",
    attachmentType: "entrance_photo",
    audience: "client_facing",
    fileUrl: "https://example.com/mission-control-demo/wayzata-door-7-entrance.jpg",
    uploadedByUserId: users.schools
  });
  await upsertLocationAttachment(client, {
    tenantId,
    locationId: wayzataMain.id,
    title: DEMO_LOCATION_ATTACHMENT_TITLES[2],
    description: "Internal setup reminder for the main commons traffic pattern.",
    attachmentType: "setup_reference",
    audience: "internal_only",
    storageKey: "demo/location-references/wayzata-commons-setup-reference.png",
    uploadedByUserId: users.schools
  });
  await upsertLocationAttachment(client, {
    tenantId,
    locationId: tonkaStadium.id,
    title: DEMO_LOCATION_ATTACHMENT_TITLES[3],
    description: "Field map showing west gate access, north-end setup, and team gathering zone.",
    attachmentType: "field_map",
    audience: "employee_facing",
    fileUrl: "https://example.com/mission-control-demo/tonka-stadium-field-map.png",
    uploadedByUserId: users.sports
  });

  const principal = await upsertContact(client, {
    tenantId,
    actorUserId: users.schools,
    organizationId: wayzataHigh.id,
    demoKey: DEMO_CONTACT_KEYS[0],
    firstName: "Avery",
    lastName: "Nelson",
    title: "Principal",
    email: "avery.nelson.demo@example.com",
    phone: "555-0101"
  });
  const secretary = await upsertContact(client, {
    tenantId,
    actorUserId: users.schools,
    organizationId: wayzataHigh.id,
    demoKey: DEMO_CONTACT_KEYS[1],
    firstName: "Jamie",
    lastName: "Carlson",
    title: "Head Secretary",
    email: "jamie.carlson.demo@example.com",
    phone: "555-0102",
    mobilePhone: "555-2102",
    officePhone: "555-1102",
    allowSms: true,
    smsConsentStatus: "opted_in"
  });
  const yearbook = await upsertContact(client, {
    tenantId,
    actorUserId: users.schools,
    organizationId: wayzataHigh.id,
    demoKey: DEMO_CONTACT_KEYS[2],
    firstName: "Morgan",
    lastName: "Lee",
    title: "Yearbook Adviser",
    email: "morgan.lee.demo@example.com"
  });
  const dayOf = await upsertContact(client, {
    tenantId,
    actorUserId: users.schools,
    organizationId: wayzataHigh.id,
    demoKey: DEMO_CONTACT_KEYS[3],
    firstName: "Casey",
    lastName: "Brooks",
    title: "Day-of Contact",
    email: "casey.brooks.demo@example.com",
    phone: "555-0103",
    mobilePhone: "555-2103",
    allowSms: true,
    smsConsentStatus: "unknown"
  });
  const billingContact = await upsertContact(client, {
    tenantId,
    actorUserId: users.schools,
    organizationId: wayzataHigh.id,
    demoKey: DEMO_CONTACT_KEYS[4],
    firstName: "Pat",
    lastName: "Ramos",
    title: "Billing Contact",
    email: "pat.ramos.demo@example.com",
    officePhone: "555-1104"
  });
  const districtContact = await upsertContact(client, {
    tenantId,
    actorUserId: users.schools,
    organizationId: wayzataDistrict.id,
    demoKey: DEMO_CONTACT_KEYS[5],
    firstName: "Jordan",
    lastName: "Mills",
    title: "District Communications",
    email: "jordan.mills.demo@example.com",
    officePhone: "555-1105"
  });
  const maplePrincipal = await upsertContact(client, {
    tenantId,
    actorUserId: users.schools,
    organizationId: mapleGrove.id,
    demoKey: DEMO_CONTACT_KEYS[6],
    firstName: "Taylor",
    lastName: "Reed",
    title: "Principal",
    email: "taylor.reed.demo@example.com"
  });
  const mapleSecretary = await upsertContact(client, {
    tenantId,
    actorUserId: users.schools,
    organizationId: mapleGrove.id,
    demoKey: DEMO_CONTACT_KEYS[7],
    firstName: "Robin",
    lastName: "Parker",
    title: "Front Office",
    email: "robin.parker.demo@example.com"
  });
  const sportsDirector = await upsertContact(client, {
    tenantId,
    actorUserId: users.sports,
    organizationId: tonkaSoccer.id,
    demoKey: DEMO_CONTACT_KEYS[8],
    firstName: "Riley",
    lastName: "Hart",
    title: "Association Director",
    email: "riley.hart.demo@example.com"
  });
  const sportsCoach = await upsertContact(client, {
    tenantId,
    actorUserId: users.sports,
    organizationId: tonkaSoccer.id,
    demoKey: DEMO_CONTACT_KEYS[9],
    firstName: "Sam",
    lastName: "Porter",
    title: "Coach",
    email: "sam.porter.demo@example.com",
    mobilePhone: "555-2301",
    allowSms: true,
    smsConsentStatus: "opted_out"
  });

  await upsertRelationship(client, { tenantId, actorUserId: users.schools, organizationId: wayzataHigh.id, contactId: principal.id, roles: ["principal", "primary_contact"], primary: true });
  await upsertRelationship(client, { tenantId, actorUserId: users.schools, organizationId: wayzataHigh.id, contactId: secretary.id, roles: ["head_secretary", "picture_day_contact", "picture_day_prep_recipient", "day_before_reminder_recipient"] });
  await upsertRelationship(client, { tenantId, actorUserId: users.schools, organizationId: wayzataHigh.id, contactId: yearbook.id, roles: ["yearbook_contact"] });
  await upsertRelationship(client, { tenantId, actorUserId: users.schools, organizationId: wayzataHigh.id, contactId: dayOf.id, roles: ["emergency_day_of_contact", "approval_contact"] });
  await upsertRelationship(client, { tenantId, actorUserId: users.schools, organizationId: wayzataHigh.id, contactId: billingContact.id, roles: ["billing_contact"] });
  await upsertRelationship(client, { tenantId, actorUserId: users.schools, organizationId: wayzataHigh.id, contactId: districtContact.id, roles: ["district_contact", "contract_recipient"] });
  await upsertRelationship(client, { tenantId, actorUserId: users.schools, organizationId: mapleGrove.id, contactId: maplePrincipal.id, roles: ["principal", "primary_contact"], primary: true });
  await upsertRelationship(client, { tenantId, actorUserId: users.schools, organizationId: mapleGrove.id, contactId: mapleSecretary.id, roles: ["head_secretary", "picture_day_contact"] });
  await upsertRelationship(client, { tenantId, actorUserId: users.sports, organizationId: tonkaSoccer.id, contactId: sportsDirector.id, roles: ["athletic_director", "primary_contact", "approval_contact"], primary: true });
  await upsertRelationship(client, { tenantId, actorUserId: users.sports, organizationId: tonkaSoccer.id, contactId: sportsCoach.id, roles: ["coach", "picture_day_contact"] });

  for (const serviceType of ["fall_pictures", "yearbook", "id_cards"]) {
    await upsertService(client, { tenantId, actorUserId: users.schools, accountId: wayzataHigh.id, serviceType });
  }
  for (const serviceType of ["fall_pictures", "yearbook"]) {
    await upsertService(client, { tenantId, actorUserId: users.schools, accountId: mapleGrove.id, serviceType });
  }
  await upsertService(client, { tenantId, actorUserId: users.sports, accountId: tonkaSoccer.id, serviceType: "sports" });

  await upsertOwner(client, { tenantId, actorUserId: users.leadership, accountId: wayzataHigh.id, ownerUserId: users.schools, ownerType: "studio_bestie", notes: "Schools Client Success owns the closest relationship." });
  await upsertOwner(client, { tenantId, actorUserId: users.leadership, accountId: tonkaSoccer.id, ownerUserId: users.sports, ownerType: "studio_bestie", notes: "Sports Client Success owns the sports association relationship." });

  await upsertJob(client, {
    tenantId,
    actorUserId: users.schools,
    accountId: wayzataHigh.id,
    contactId: secretary.id,
    ownerUserId: users.schools,
    jobNumber: DEMO_JOB_NUMBERS[0],
    title: "Wayzata High Fall Picture Day",
    startsInDays: 14,
    locationId: wayzataMain.id
  });
  await upsertJob(client, {
    tenantId,
    actorUserId: users.schools,
    accountId: mapleGrove.id,
    contactId: mapleSecretary.id,
    ownerUserId: users.schools,
    jobNumber: DEMO_JOB_NUMBERS[1],
    title: "Maple Grove Senior High Fall Pictures",
    startsInDays: 3,
    locationId: mapleMain.id
  });

  await upsertTask(client, {
    tenantId,
    actorUserId: users.schools,
    accountId: mapleGrove.id,
    contactId: mapleSecretary.id,
    assigneeId: users.schools,
    taskNumber: DEMO_TASK_NUMBERS[0],
    title: "Confirm emergency day-of contact before prep email",
    serviceType: "fall_pictures",
    communicationType: "picture_day_prep"
  });
  await upsertTask(client, {
    tenantId,
    actorUserId: users.sports,
    accountId: tonkaSoccer.id,
    contactId: sportsDirector.id,
    assigneeId: users.sports,
    taskNumber: DEMO_TASK_NUMBERS[1],
    title: "Confirm T-ball picture day roster owner",
    serviceType: "sports",
    communicationType: "picture_day_confirmation"
  });

  await addDemoNote(client, { tenantId, actorUserId: users.schools, accountId: wayzataHigh.id, contactId: secretary.id, summary: "Demo note: Jamie prefers one concise prep email and a follow-up call the week before picture day." });
  await addDemoNote(client, { tenantId, actorUserId: users.schools, accountId: mapleGrove.id, contactId: mapleSecretary.id, summary: "Demo readiness gap: yearbook contact and emergency day-of contact still need confirmation." });
  await addDemoNote(client, { tenantId, actorUserId: users.sports, accountId: tonkaSoccer.id, contactId: sportsDirector.id, summary: "Demo sports context: keep team/individual picture days under the association account, not separate team accounts." });

  await client.query(
    `
      INSERT INTO app_event (tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key)
      VALUES ($1,'client.demo_seeded','client_command_center',$2,$3,$4)
      ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    `,
    [
      tenantId,
      wayzataHigh.id,
      JSON.stringify({
        demo_seed: DEMO_MARKER,
        provider_targets_supported: ["in_app", "email", "teams", "outlook"],
        microsoft_ready: true
      }),
      "client-command-center-demo:seeded"
    ]
  );
}

export async function runClientCommandCenterDemoSeed(argv = process.argv) {
  assertClientCommandCenterDemoSeedAllowed(argv, process.env);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (argv.includes("--reset")) {
      const { tenantId } = await getTenantAndUsers(client);
      await resetDemoData(client, tenantId);
    }
    if (!argv.includes("--reset-only")) {
      await seedDemoData(client);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runClientCommandCenterDemoSeed()
    .then(async () => {
      await pool.end();
      console.log("Client Command Center demo data is ready.");
    })
    .catch(async (error) => {
      await pool.end();
      console.error(error);
      process.exit(1);
    });
}
