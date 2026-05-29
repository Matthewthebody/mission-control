import type { PoolClient } from "pg";
import { pool } from "../src/db/pool.js";
import {
  getAuthorityGrantCatalog,
  getDefaultAuthorityAssignmentForLegacyRole
} from "../src/authz/authority.js";
import type { DepartmentCode } from "../src/types/auth.js";
import { hashOpaqueToken, hashPassword } from "../src/services/auth.js";
import { syncUserAuthorityAssignment } from "../src/services/authority.js";
import { buildGoogleMapsLink, estimateDriveMinutesFromStudio, getStudioLocation } from "../src/services/maps.js";
import { seedTrainingState } from "../src/services/training.js";

const LOCAL_DEMO_PASSWORD = "LocalDemo123!";

type SeedUser = {
  email: string;
  fullName: string;
  role: "owner_admin" | "admin" | "leadership" | "senior_photographer" | "associate_photographer" | "office_employee" | "photographer";
  department: DepartmentCode;
  status: "active" | "pending_approval" | "suspended";
  phoneNumber: string;
};

async function seedAuthorityPermissionCatalog(client: PoolClient) {
  const catalog = getAuthorityGrantCatalog();
  await client.query("DELETE FROM authority_permission_grant");

  for (const [authorityTier, grants] of Object.entries(catalog.tiers)) {
    for (const grant of grants) {
      await client.query(
        `
          INSERT INTO authority_permission_grant (
            authority_tier,
            job_function_profile,
            permission_domain,
            permission_action,
            permission_scope,
            enabled
          )
          VALUES ($1::authority_tier, NULL, $2::permission_domain, $3::permission_action, $4::permission_scope, true)
          ON CONFLICT (authority_tier, job_function_profile, permission_domain, permission_action, permission_scope)
          DO UPDATE SET enabled = true
        `,
        [authorityTier, grant.domain, grant.action, grant.scope]
      );
    }
  }

  for (const [profile, grants] of Object.entries(catalog.profiles)) {
    for (const grant of grants) {
      await client.query(
        `
          INSERT INTO authority_permission_grant (
            authority_tier,
            job_function_profile,
            permission_domain,
            permission_action,
            permission_scope,
            enabled
          )
          VALUES (NULL, $1::job_function_profile, $2::permission_domain, $3::permission_action, $4::permission_scope, true)
          ON CONFLICT (authority_tier, job_function_profile, permission_domain, permission_action, permission_scope)
          DO UPDATE SET enabled = true
        `,
        [profile, grant.domain, grant.action, grant.scope]
      );
    }
  }
}

async function seedProductionProjectIntakeTemplates(client: PoolClient, tenantId: string) {
  await client.query(
    `
      INSERT INTO production_project_template (
        tenant_id,
        template_key,
        name,
        description,
        default_priority,
        category,
        default_stage,
        peer_review_required,
        final_qc_required,
        job_type,
        workflow_family,
        workflow_mode,
        season_key
      )
      SELECT
        $1::uuid,
        seeded.template_key,
        seeded.name,
        seeded.description,
        seeded.default_priority::production_project_priority,
        seeded.category::production_project_category,
        seeded.default_stage::production_project_stage,
        seeded.peer_review_required,
        seeded.final_qc_required,
        seeded.job_type::production_project_job_type,
        seeded.workflow_family,
        seeded.workflow_mode,
        seeded.season_key
      FROM (
        VALUES
          (
            'post_shoot_issue_remediation',
            'Post-Shoot Issue Remediation',
            'Coordinate production remediation when a post-shoot evaluation flags quality or delivery issues.',
            'critical',
            'remediation',
            'correction_needed',
            false,
            false,
            'correction_rework',
            'general',
            'issue_remediation',
            'all_year'
          ),
          (
            'digital_production_delivery',
            'Digital Production Delivery',
            'Track the digital edit, peer review, final QC, and release path for a delivery package.',
            'high',
            'digital_production',
            'ready_for_production',
            true,
            true,
            'gallery_prep_upload',
            'schools',
            'digital_delivery',
            'all_year'
          ),
          (
            'sports_post_production_wrap',
            'Sports Production Wrap',
            'Sports-specific production wrap for event work entering post-production.',
            'high',
            'photography_production',
            'in_production',
            true,
            true,
            'sports_production',
            'sports',
            'post_shoot_wrap',
            'all_year'
          )
      ) AS seeded(
        template_key,
        name,
        description,
        default_priority,
        category,
        default_stage,
        peer_review_required,
        final_qc_required,
        job_type,
        workflow_family,
        workflow_mode,
        season_key
      )
      ON CONFLICT (tenant_id, template_key)
      DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        default_priority = EXCLUDED.default_priority,
        category = EXCLUDED.category,
        default_stage = EXCLUDED.default_stage,
        peer_review_required = EXCLUDED.peer_review_required,
        final_qc_required = EXCLUDED.final_qc_required,
        job_type = EXCLUDED.job_type,
        workflow_family = EXCLUDED.workflow_family,
        workflow_mode = EXCLUDED.workflow_mode,
        season_key = EXCLUDED.season_key,
        active_status = true,
        updated_at = now()
    `,
    [tenantId]
  );

  await client.query(
    `
      INSERT INTO production_project_template_task (
        tenant_id,
        template_id,
        task_key,
        title,
        summary,
        due_offset_days,
        required,
        sort_order,
        task_type,
        handoff_required,
        blocks_release
      )
      SELECT
        template.tenant_id,
        template.id,
        seeded.task_key,
        seeded.title,
        seeded.summary,
        seeded.due_offset_days,
        seeded.required,
        seeded.sort_order,
        seeded.task_type::production_project_task_type,
        seeded.handoff_required,
        seeded.blocks_release
      FROM production_project_template template
      JOIN (
        VALUES
          (
            'post_shoot_issue_remediation',
            'review_issue',
            'Review the issue context',
            'Inspect the evaluation notes, open comment, and linked shoot context.',
            0,
            true,
            0,
            'rework',
            false,
            false
          ),
          (
            'post_shoot_issue_remediation',
            'assign_recovery',
            'Assign remediation owner',
            'Make sure one production owner is responsible for the recovery path.',
            0,
            true,
            1,
            'handoff',
            true,
            false
          ),
          (
            'post_shoot_issue_remediation',
            'confirm_resolution',
            'Confirm resolution and follow-up',
            'Capture the recovery outcome before closing the remediation project.',
            1,
            true,
            2,
            'rework',
            false,
            false
          ),
          (
            'digital_production_delivery',
            'prepare_delivery',
            'Prepare delivery package',
            'Build the production package and confirm the handoff scope before review.',
            1,
            true,
            0,
            'production',
            false,
            false
          ),
          (
            'sports_post_production_wrap',
            'build_sports_package',
            'Build sports package and select path',
            'Prepare the sports package, capture any corrections, and get it ready for review.',
            1,
            true,
            0,
            'production',
            false,
            false
          )
      ) AS seeded(
        template_key,
        task_key,
        title,
        summary,
        due_offset_days,
        required,
        sort_order,
        task_type,
        handoff_required,
        blocks_release
      )
        ON seeded.template_key = template.template_key
      WHERE template.tenant_id = $1::uuid
      ON CONFLICT (tenant_id, template_id, task_key)
      DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        due_offset_days = EXCLUDED.due_offset_days,
        required = EXCLUDED.required,
        sort_order = EXCLUDED.sort_order,
        task_type = EXCLUDED.task_type,
        handoff_required = EXCLUDED.handoff_required,
        blocks_release = EXCLUDED.blocks_release,
        updated_at = now()
    `,
    [tenantId]
  );

  await client.query(
    `
      INSERT INTO production_project_trigger_rule (
        tenant_id,
        trigger_key,
        template_id,
        name,
        description,
        default_due_offset_days,
        default_follow_up_offset_days
      )
      SELECT
        template.tenant_id,
        seeded.trigger_key,
        template.id,
        seeded.name,
        seeded.description,
        seeded.default_due_offset_days,
        seeded.default_follow_up_offset_days
      FROM production_project_template template
      JOIN (
        VALUES
          (
            'post_shoot_issue_remediation',
            'post_shoot_issue_flagged',
            'Post-shoot issue flagged',
            'Create a remediation project when the post-shoot evaluation flags an issue.',
            1,
            0
          ),
          (
            'digital_production_delivery',
            'school_gallery_release_intake',
            'School gallery release intake',
            'Create a canonical production job when gallery-release work is active in the school operations engine.',
            0,
            1
          ),
          (
            'digital_production_delivery',
            'school_id_production_intake',
            'School ID production intake',
            'Create a canonical production job when school ID work is active in the school operations engine.',
            0,
            1
          ),
          (
            'digital_production_delivery',
            'school_yearbook_intake',
            'School yearbook intake',
            'Create a canonical production job when yearbook work is active in the school operations engine.',
            0,
            1
          ),
          (
            'sports_post_production_wrap',
            'shoot_completed_post_production_sports',
            'Sports post-production intake',
            'Create a sports production job when a sports shoot moves into post-production.',
            2,
            1
          )
      ) AS seeded(template_key, trigger_key, name, description, default_due_offset_days, default_follow_up_offset_days)
        ON seeded.template_key = template.template_key
      WHERE template.tenant_id = $1::uuid
      ON CONFLICT (tenant_id, trigger_key)
      DO UPDATE SET
        template_id = EXCLUDED.template_id,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        default_due_offset_days = EXCLUDED.default_due_offset_days,
        default_follow_up_offset_days = EXCLUDED.default_follow_up_offset_days,
        active_status = true,
        updated_at = now()
    `,
    [tenantId]
  );
}

type SeedShift = {
  shootId?: string | null;
  studioId?: string | null;
  assignedUserId: string;
  managerUserId?: string | null;
  createdByUserId: string;
  publishedByUserId?: string | null;
  shiftKind: "shoot" | "studio" | "office" | "training";
  status: "draft" | "published";
  department: string;
  staffingRole?: "lead_photographer" | "senior_photographer" | "photographer" | "support" | "check_in" | "assistant" | "producer" | "custom";
  satisfiesLeadCoverage?: boolean;
  title: string;
  startsAt: Date;
  endsAt: Date;
  locationName: string;
  locationAddress: string;
  locationLat?: number | null;
  locationLng?: number | null;
  geofenceRadiusMeters: number;
  notes?: string | null;
  segments: Array<{
    segmentKind: "studio_prep" | "travel" | "shoot" | "studio_wrap" | "office" | "training" | "break" | "other";
    label: string;
    startsAt: Date;
    endsAt: Date;
    rateCode: string;
    hourlyRateCents: number;
  }>;
};

type SeedPunch = {
  tenantId: string;
  shiftId: string;
  shootId?: string | null;
  userId: string;
  direction: "in" | "out";
  clientTimestamp: Date;
  geofenceStatus: "inside" | "outside" | "unknown";
  gpsConfidence: "normal" | "low_confidence" | "outside";
  statusEventId?: string | null;
  approvalState?: "not_required" | "pending" | "approved" | "rejected";
  notes?: string | null;
};

function localTodayAt(hour: number, minute: number) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date;
}

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60000);
}

function toIsoDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number) {
  const next = new Date(value.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

async function seedMembership(
  client: PoolClient,
  tenantId: string,
  user: SeedUser,
  passwordHash: string,
  invitedByUserId: string | null
) {
  const account = (
    await client.query(
      `
        INSERT INTO user_account (email, full_name, password_hash, is_email_verified)
        VALUES ($1,$2,$3,true)
        ON CONFLICT (email) DO UPDATE
        SET full_name = EXCLUDED.full_name,
            password_hash = EXCLUDED.password_hash,
            is_email_verified = true,
            updated_at = now()
        RETURNING *
      `,
      [user.email, user.fullName, passwordHash]
    )
  ).rows[0];

  const membership = (
    await client.query(
      `
        INSERT INTO app_user (
          tenant_id, account_id, email, full_name, phone_number, department, status, approved_by_user_id, approved_at,
          invited_by_user_id, invited_at, suspended_at, revoked_at, is_active
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7::membership_status,$8,
          CASE WHEN $7::membership_status = 'active' THEN now() ELSE NULL END,
          $8, now(),
          CASE WHEN $7::membership_status = 'suspended' THEN now() ELSE NULL END,
          NULL,
          CASE WHEN $7::membership_status = 'active' THEN true ELSE false END
        )
        ON CONFLICT (tenant_id, email) DO UPDATE
        SET account_id = EXCLUDED.account_id,
            full_name = EXCLUDED.full_name,
            phone_number = EXCLUDED.phone_number,
            department = EXCLUDED.department,
            status = EXCLUDED.status,
            approved_by_user_id = EXCLUDED.approved_by_user_id,
            approved_at = CASE WHEN EXCLUDED.status = 'active' THEN now() ELSE app_user.approved_at END,
            invited_by_user_id = EXCLUDED.invited_by_user_id,
            invited_at = COALESCE(app_user.invited_at, EXCLUDED.invited_at),
            suspended_at = CASE WHEN EXCLUDED.status = 'suspended' THEN now() ELSE NULL END,
            revoked_at = NULL,
            is_active = CASE WHEN EXCLUDED.status = 'active' THEN true ELSE false END
        RETURNING *
      `,
      [tenantId, account.id, user.email, user.fullName, user.phoneNumber, user.department, user.status, invitedByUserId]
    )
  ).rows[0];

  const role = (await client.query("SELECT id FROM role WHERE code = $1", [user.role])).rows[0];
  await client.query("DELETE FROM user_role WHERE tenant_id = $1 AND user_id = $2", [tenantId, membership.id]);
  await client.query("INSERT INTO user_role (tenant_id, user_id, role_id) VALUES ($1,$2,$3)", [tenantId, membership.id, role.id]);

  const authorityAssignment = getDefaultAuthorityAssignmentForLegacyRole(user.role, user.department);
  await syncUserAuthorityAssignment(client, {
    tenantId,
    userId: membership.id,
    authorityTier: authorityAssignment.authorityTier,
    primaryJobFunctionProfile: authorityAssignment.primaryJobFunctionProfile,
    jobFunctionProfiles: authorityAssignment.jobFunctionProfiles,
    scopeDepartment: user.department,
    assignedByUserId: invitedByUserId
  });

  return membership;
}

async function upsertEmployeePayProfile(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    officeRate: number;
    photographyRate: number;
    overtimeEligible?: boolean;
    mileageEligible?: boolean;
    effectiveDate?: string;
  }
) {
  const effectiveDate = input.effectiveDate ?? new Date().toISOString().slice(0, 10);
  await client.query(
    `
      UPDATE employee_pay_profile
      SET active_status = false,
          updated_at = now()
      WHERE tenant_id = $1
        AND employee_id = $2
        AND effective_date <> $3::date
        AND active_status = true
    `,
    [input.tenantId, input.employeeId, effectiveDate]
  );

  await client.query(
    `
      INSERT INTO employee_pay_profile (
        tenant_id,
        employee_id,
        office_rate,
        photography_rate,
        overtime_eligible,
        mileage_eligible,
        active_status,
        effective_date
      )
      VALUES ($1,$2,$3,$4,$5,$6,true,$7::date)
      ON CONFLICT (tenant_id, employee_id, effective_date)
      DO UPDATE SET
        office_rate = EXCLUDED.office_rate,
        photography_rate = EXCLUDED.photography_rate,
        overtime_eligible = EXCLUDED.overtime_eligible,
        mileage_eligible = EXCLUDED.mileage_eligible,
        active_status = true,
        updated_at = now()
    `,
    [
      input.tenantId,
      input.employeeId,
      input.officeRate,
      input.photographyRate,
      input.overtimeEligible ?? true,
      input.mileageEligible ?? false,
      effectiveDate
    ]
  );
}

async function upsertMileageZone(
  client: PoolClient,
  input: {
    tenantId: string;
    zoneName: string;
    minDistance: number;
    maxDistance: number;
    reimbursementAmount: number;
    effectiveDate?: string;
  }
) {
  await client.query(
    `
      INSERT INTO mileage_zone (
        tenant_id,
        code,
        min_miles,
        max_miles,
        zone_name,
        min_distance,
        max_distance,
        reimbursement_amount,
        active_status,
        effective_date
      )
      VALUES ($1,$2,$3,$4,$2,$3,$4,$5,true,$6::date)
      ON CONFLICT (tenant_id, zone_name, effective_date)
      DO UPDATE SET
        code = EXCLUDED.code,
        min_miles = EXCLUDED.min_miles,
        max_miles = EXCLUDED.max_miles,
        min_distance = EXCLUDED.min_distance,
        max_distance = EXCLUDED.max_distance,
        reimbursement_amount = EXCLUDED.reimbursement_amount,
        active_status = true,
        updated_at = now()
    `,
    [
      input.tenantId,
      input.zoneName,
      input.minDistance,
      input.maxDistance,
      input.reimbursementAmount,
      input.effectiveDate ?? new Date().toISOString().slice(0, 10)
    ]
  );
}

async function insertShift(client: PoolClient, tenantId: string, input: SeedShift) {
  const navigationUrl = buildGoogleMapsLink({
    latitude: input.locationLat ?? null,
    longitude: input.locationLng ?? null,
    address: input.locationAddress,
    label: input.locationName
  });

  const shift = (
    await client.query(
      `
        INSERT INTO work_shift (
          tenant_id, shoot_id, studio_id, assigned_user_id, manager_user_id, created_by_user_id, published_by_user_id,
          shift_kind, status, department, staffing_role, satisfies_lead_coverage, title, starts_at, ends_at, location_name, location_address, location_lat,
          location_lng, geofence_radius_meters, navigation_url, notes, published_at, calendar_sync_required, calendar_last_synced_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8::work_shift_kind,$9::work_shift_status,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
          CASE WHEN $9::work_shift_status = 'published' THEN now() ELSE NULL END,
          false,
          CASE WHEN $9::work_shift_status = 'published' THEN now() ELSE NULL END
        )
        RETURNING *
      `,
      [
        tenantId,
        input.shootId ?? null,
        input.studioId ?? null,
        input.assignedUserId,
        input.managerUserId ?? null,
        input.createdByUserId,
        input.publishedByUserId ?? null,
        input.shiftKind,
        input.status,
        input.department,
        input.staffingRole ?? "photographer",
        Boolean(input.satisfiesLeadCoverage),
        input.title,
        input.startsAt,
        input.endsAt,
        input.locationName,
        input.locationAddress,
        input.locationLat ?? null,
        input.locationLng ?? null,
        input.geofenceRadiusMeters,
        navigationUrl,
        input.notes ?? null
      ]
    )
  ).rows[0];

  for (const [index, segment] of input.segments.entries()) {
    await client.query(
      `
        INSERT INTO shift_segment (
          tenant_id, shift_id, segment_kind, label, scheduled_start_at, scheduled_end_at, rate_code, hourly_rate_cents, sort_order
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        tenantId,
        shift.id,
        segment.segmentKind,
        segment.label,
        segment.startsAt,
        segment.endsAt,
        segment.rateCode,
        segment.hourlyRateCents,
        index
      ]
    );
  }

  return shift;
}

async function insertShootStatusEvent(
  client: PoolClient,
  tenantId: string,
  shootId: string,
  userId: string,
  type: string,
  capturedAt: Date,
  geofenceStatus: "inside" | "outside" | "unknown",
  metadata: Record<string, unknown> = {}
) {
  const { rows } = await client.query(
    `
      INSERT INTO status_event (tenant_id, shoot_id, user_id, type, captured_at, geofence_status, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
      RETURNING *
    `,
    [tenantId, shootId, userId, type, capturedAt, geofenceStatus, JSON.stringify(metadata)]
  );
  return rows[0];
}

async function insertPunch(client: PoolClient, input: SeedPunch) {
  const { rows } = await client.query(
    `
      INSERT INTO shift_punch (
        tenant_id, shift_id, shoot_id, user_id, direction, source, status_event_id, client_timestamp,
        geofence_status, gps_confidence, approval_state, notes
      )
      VALUES ($1,$2,$3,$4,$5,'seed',$6,$7,$8,$9,$10,$11)
      RETURNING *
    `,
    [
      input.tenantId,
      input.shiftId,
      input.shootId ?? null,
      input.userId,
      input.direction,
      input.statusEventId ?? null,
      input.clientTimestamp,
      input.geofenceStatus,
      input.gpsConfidence,
      input.approvalState ?? "not_required",
      input.notes ?? null
    ]
  );
  return rows[0];
}

function normalizeSeedText(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildSeedAddress(input: {
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  zip: string;
}) {
  const lines = [input.addressLine1, input.addressLine2].filter(Boolean);
  const cityStateZip = [input.city, input.state].filter(Boolean).join(", ");
  const tail = [cityStateZip, input.zip].filter(Boolean).join(" ");
  return [...lines, tail].filter(Boolean).join(", ");
}

async function upsertOrganization(
  client: PoolClient,
  input: {
    tenantId: string;
    canonicalName: string;
    displayName: string;
    accountType:
      | "schools_underclass_portraits"
      | "schools_events"
      | "sports"
      | "events"
      | "studio"
      | "headshots"
      | "commercial"
      | "internal";
    aliases?: string[];
    notes?: string | null;
    actorUserId: string;
  }
) {
  const normalizedName = normalizeSeedText(input.canonicalName);
  const existing = await client.query<{ id: string }>(
    `
      SELECT id
      FROM organization
      WHERE tenant_id = $1
        AND normalized_canonical_name = $2
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [input.tenantId, normalizedName]
  );
  if (existing.rows[0]) {
    const updated = await client.query<{ id: string }>(
      `
        UPDATE organization
        SET
          canonical_name = $2,
          display_name = $3,
          account_type = $4,
          notes = $5,
          updated_by_user_id = $6,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $7
        RETURNING id
      `,
      [
        input.tenantId,
        input.canonicalName,
        input.displayName,
        input.accountType,
        input.notes ?? null,
        input.actorUserId,
        existing.rows[0].id
      ]
    );
    const organizationId = updated.rows[0].id;
    await client.query("DELETE FROM organization_alias WHERE tenant_id = $1 AND organization_id = $2", [input.tenantId, organizationId]);
    for (const alias of input.aliases ?? []) {
      await client.query(
        `
          INSERT INTO organization_alias (
            tenant_id,
            organization_id,
            alias,
            normalized_alias,
            created_by_user_id
          )
          VALUES ($1,$2,$3,$4,$5)
        `,
        [input.tenantId, organizationId, alias, normalizeSeedText(alias), input.actorUserId]
      );
    }
    return organizationId;
  }

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO organization (
        tenant_id,
        canonical_name,
        normalized_canonical_name,
        display_name,
        account_type,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
      RETURNING id
    `,
    [
      input.tenantId,
      input.canonicalName,
      normalizedName,
      input.displayName,
      input.accountType,
      input.notes ?? null,
      input.actorUserId
    ]
  );

  const organizationId = rows[0].id;
  await client.query("DELETE FROM organization_alias WHERE tenant_id = $1 AND organization_id = $2", [input.tenantId, organizationId]);
  for (const alias of input.aliases ?? []) {
    await client.query(
      `
        INSERT INTO organization_alias (
          tenant_id,
          organization_id,
          alias,
          normalized_alias,
          created_by_user_id
        )
        VALUES ($1,$2,$3,$4,$5)
      `,
      [input.tenantId, organizationId, alias, normalizeSeedText(alias), input.actorUserId]
    );
  }

  return organizationId;
}

async function upsertOrganizationContact(
  client: PoolClient,
  input: {
    tenantId: string;
    organizationId: string;
    firstName: string;
    lastName: string;
    title?: string | null;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
    actorUserId: string;
  }
) {
  const fullName = `${input.firstName} ${input.lastName}`.trim();
  await client.query(
    `
      INSERT INTO organization_contact (
        tenant_id,
        organization_id,
        first_name,
        last_name,
        full_name,
        normalized_full_name,
        title,
        phone,
        email,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11
      WHERE NOT EXISTS (
        SELECT 1
        FROM organization_contact
        WHERE tenant_id = $1
          AND organization_id = $2
          AND normalized_full_name = $6
          AND COALESCE(lower(email), '') = COALESCE(lower($9), '')
      )
    `,
    [
      input.tenantId,
      input.organizationId,
      input.firstName,
      input.lastName,
      fullName,
      normalizeSeedText(fullName),
      input.title ?? null,
      input.phone ?? null,
      input.email ?? null,
      input.notes ?? null,
      input.actorUserId
    ]
  );
  const existing = await client.query<{ id: string }>(
    `
      SELECT id
      FROM organization_contact
      WHERE tenant_id = $1
        AND organization_id = $2
        AND normalized_full_name = $3
        AND COALESCE(lower(email), '') = COALESCE(lower($4), '')
      LIMIT 1
    `,
    [input.tenantId, input.organizationId, normalizeSeedText(fullName), input.email ?? null]
  );
  return existing.rows[0].id;
}

async function upsertOrganizationLocation(
  client: PoolClient,
  input: {
    tenantId: string;
    organizationId: string;
    externalKey: string;
    locationName: string;
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    state: string;
    zip: string;
    mapsLabel?: string | null;
    notes?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    actorUserId: string;
  }
) {
  const address = buildSeedAddress(input);
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO shoot_location (
        tenant_id,
        organization_id,
        external_source,
        external_key,
        name,
        normalized_name,
        address,
        normalized_address,
        address_line_1,
        address_line_2,
        city,
        state,
        zip,
        maps_label,
        location_details,
        navigation_url,
        estimated_drive_minutes,
        latitude,
        longitude,
        created_by_user_id,
        updated_by_user_id,
        updated_at
      )
      VALUES (
        $1,$2,'mission_control',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19,now()
      )
      ON CONFLICT (tenant_id, external_source, external_key) DO UPDATE
      SET
        organization_id = EXCLUDED.organization_id,
        name = EXCLUDED.name,
        normalized_name = EXCLUDED.normalized_name,
        address = EXCLUDED.address,
        normalized_address = EXCLUDED.normalized_address,
        address_line_1 = EXCLUDED.address_line_1,
        address_line_2 = EXCLUDED.address_line_2,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        zip = EXCLUDED.zip,
        maps_label = EXCLUDED.maps_label,
        location_details = EXCLUDED.location_details,
        navigation_url = EXCLUDED.navigation_url,
        estimated_drive_minutes = EXCLUDED.estimated_drive_minutes,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
      RETURNING id
    `,
    [
      input.tenantId,
      input.organizationId,
      input.externalKey,
      input.locationName,
      normalizeSeedText(input.locationName),
      address,
      normalizeSeedText(address),
      input.addressLine1,
      input.addressLine2 ?? null,
      input.city,
      input.state,
      input.zip,
      input.mapsLabel ?? input.locationName,
      input.notes ?? null,
      buildGoogleMapsLink({
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        address,
        label: input.mapsLabel ?? input.locationName
      }),
      estimateDriveMinutesFromStudio(input.latitude ?? null, input.longitude ?? null),
      input.latitude ?? null,
      input.longitude ?? null,
      input.actorUserId
    ]
  );
  return rows[0].id;
}

async function upsertSchoolProfile(
  client: PoolClient,
  input: {
    tenantId: string;
    organizationId: string;
    districtName?: string | null;
    schoolType?: string | null;
    schoolYearLabel?: string | null;
    relationshipHealthState?: "healthy" | "needs_attention" | "fragile" | "at_risk" | "unknown";
    relationshipSummary?: string | null;
    primaryInternalOwnerUserId?: string | null;
    backupInternalOwnerUserId?: string | null;
    primaryLocationId?: string | null;
    tags?: string[];
    notes?: string | null;
    actorUserId: string;
  }
) {
  await client.query(
    `
      INSERT INTO school_profile (
        organization_id,
        tenant_id,
        district_name,
        school_type,
        school_year_label,
        relationship_health_state,
        relationship_summary,
        primary_internal_owner_user_id,
        backup_internal_owner_user_id,
        primary_location_id,
        tags,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
      ON CONFLICT (organization_id) DO UPDATE
      SET
        district_name = EXCLUDED.district_name,
        school_type = EXCLUDED.school_type,
        school_year_label = EXCLUDED.school_year_label,
        relationship_health_state = EXCLUDED.relationship_health_state,
        relationship_summary = EXCLUDED.relationship_summary,
        primary_internal_owner_user_id = EXCLUDED.primary_internal_owner_user_id,
        backup_internal_owner_user_id = EXCLUDED.backup_internal_owner_user_id,
        primary_location_id = EXCLUDED.primary_location_id,
        tags = EXCLUDED.tags,
        notes = EXCLUDED.notes,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
    `,
    [
      input.organizationId,
      input.tenantId,
      input.districtName ?? null,
      input.schoolType ?? null,
      input.schoolYearLabel ?? null,
      input.relationshipHealthState ?? "unknown",
      input.relationshipSummary ?? null,
      input.primaryInternalOwnerUserId ?? null,
      input.backupInternalOwnerUserId ?? null,
      input.primaryLocationId ?? null,
      input.tags ?? [],
      input.notes ?? null,
      input.actorUserId
    ]
  );
}

async function upsertSchoolContactRelationship(
  client: PoolClient,
  input: {
    tenantId: string;
    organizationId: string;
    contactId: string;
    relationshipRole?: "general" | "planning" | "billing" | "decision_maker" | "day_of" | "operations" | "other";
    isPrimary?: boolean;
    schoolContactCategories?: Array<
      | "principal"
      | "secretary"
      | "district_contact"
      | "photo_day_contact"
      | "yearbook_contact"
      | "billing_contact"
      | "athletics_contact"
      | "graduation_contact"
      | "other"
    >;
    actorUserId: string;
  }
) {
  await client.query(
    `
      INSERT INTO organization_contact_relationship (
        tenant_id,
        organization_id,
        contact_id,
        relationship_role,
        is_primary,
        start_date,
        end_date,
        is_current,
        school_contact_categories,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,NULL,NULL,true,$6::school_contact_category[],$7,$7)
      ON CONFLICT (tenant_id, organization_id, contact_id)
        WHERE is_current
      DO UPDATE SET
        relationship_role = EXCLUDED.relationship_role,
        is_primary = EXCLUDED.is_primary,
        end_date = NULL,
        school_contact_categories = EXCLUDED.school_contact_categories,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
    `,
    [
      input.tenantId,
      input.organizationId,
      input.contactId,
      input.relationshipRole ?? "general",
      input.isPrimary ?? false,
      input.schoolContactCategories ?? [],
      input.actorUserId
    ]
  );
}

async function upsertSchoolRule(
  client: PoolClient,
  input: {
    id: string;
    tenantId: string;
    organizationId: string;
    ruleType:
      | "additional_language_needs"
      | "qr_organization_rules"
      | "hat_policy"
      | "additional_shoot_rules"
      | "punch_id_rules"
      | "sticker_counts"
      | "subject_directory_requirements"
      | "subject_directory_counts"
      | "yearbook_participation"
      | "delivery_preferences"
      | "mailing_preferences"
      | "special_handling";
    title: string;
    summary?: string | null;
    structuredValue?: Record<string, unknown>;
    sortOrder?: number;
    actorUserId: string;
  }
) {
  await client.query(
    `
      INSERT INTO school_rule (
        id,
        tenant_id,
        organization_id,
        rule_type,
        active_status,
        title,
        summary,
        structured_value,
        sort_order,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,'active',$5,$6,$7::jsonb,$8,$9,$9)
      ON CONFLICT (id) DO UPDATE
      SET
        organization_id = EXCLUDED.organization_id,
        rule_type = EXCLUDED.rule_type,
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        structured_value = EXCLUDED.structured_value,
        sort_order = EXCLUDED.sort_order,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
    `,
    [
      input.id,
      input.tenantId,
      input.organizationId,
      input.ruleType,
      input.title,
      input.summary ?? null,
      JSON.stringify(input.structuredValue ?? {}),
      input.sortOrder ?? 0,
      input.actorUserId
    ]
  );
}

async function upsertSchoolActivity(
  client: PoolClient,
  input: {
    id: string;
    tenantId: string;
    organizationId: string;
    activityType:
      | "profile_created"
      | "profile_updated"
      | "contact_categories_updated"
      | "rule_created"
      | "rule_updated"
      | "note_added"
      | "automation_generated"
      | "automation_escalated"
      | "automation_trigger_received";
    summary: string;
    detail?: string | null;
    metadata?: Record<string, unknown>;
    relatedContactId?: string | null;
    relatedRuleId?: string | null;
    actorUserId?: string | null;
    createdAt?: string | null;
  }
) {
  await client.query(
    `
      INSERT INTO school_activity_log (
        id,
        tenant_id,
        organization_id,
        activity_type,
        summary,
        detail,
        metadata,
        related_contact_id,
        related_rule_id,
        actor_user_id,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,COALESCE($11::timestamptz, now()))
      ON CONFLICT (id) DO UPDATE
      SET
        activity_type = EXCLUDED.activity_type,
        summary = EXCLUDED.summary,
        detail = EXCLUDED.detail,
        metadata = EXCLUDED.metadata,
        related_contact_id = EXCLUDED.related_contact_id,
        related_rule_id = EXCLUDED.related_rule_id,
        actor_user_id = EXCLUDED.actor_user_id,
        created_at = EXCLUDED.created_at
    `,
    [
      input.id,
      input.tenantId,
      input.organizationId,
      input.activityType,
      input.summary,
      input.detail ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.relatedContactId ?? null,
      input.relatedRuleId ?? null,
      input.actorUserId ?? null,
      input.createdAt ?? null
    ]
  );
}

async function upsertSchoolJob(
  client: PoolClient,
  input: {
    id: string;
    tenantId: string;
    organizationId: string;
    linkedShootId?: string | null;
    linkedLocationId?: string | null;
    jobType:
      | "fall_portraits"
      | "retakes"
      | "spring_portraits"
      | "sports"
      | "graduation"
      | "yearbook"
      | "ids"
      | "admin_fulfillment"
      | "delivery"
      | "other";
    eventDate?: string | null;
    dueDate?: string | null;
    ownerUserId?: string | null;
    sourceSystem?: "mission_control" | "monday" | "manual_import" | "zendesk" | "outlook" | "other";
    sourceReference?: string | null;
    status?: "planned" | "active" | "waiting" | "on_hold" | "completed" | "cancelled";
    title: string;
    notes?: string | null;
    actorUserId: string;
  }
) {
  await client.query(
    `
      INSERT INTO school_job (
        id,
        tenant_id,
        organization_id,
        linked_shoot_id,
        linked_location_id,
        job_type,
        event_date,
        due_date,
        owner_user_id,
        source_system,
        source_reference,
        status,
        title,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
      ON CONFLICT (id) DO UPDATE
      SET
        organization_id = EXCLUDED.organization_id,
        linked_shoot_id = EXCLUDED.linked_shoot_id,
        linked_location_id = EXCLUDED.linked_location_id,
        job_type = EXCLUDED.job_type,
        event_date = EXCLUDED.event_date,
        due_date = EXCLUDED.due_date,
        owner_user_id = EXCLUDED.owner_user_id,
        source_system = EXCLUDED.source_system,
        source_reference = EXCLUDED.source_reference,
        status = EXCLUDED.status,
        title = EXCLUDED.title,
        notes = EXCLUDED.notes,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
    `,
    [
      input.id,
      input.tenantId,
      input.organizationId,
      input.linkedShootId ?? null,
      input.linkedLocationId ?? null,
      input.jobType,
      input.eventDate ?? null,
      input.dueDate ?? null,
      input.ownerUserId ?? null,
      input.sourceSystem ?? "mission_control",
      input.sourceReference ?? null,
      input.status ?? "planned",
      input.title,
      input.notes ?? null,
      input.actorUserId
    ]
  );
}

async function upsertSchoolWorkItem(
  client: PoolClient,
  input: {
    id: string;
    tenantId: string;
    organizationId: string;
    schoolJobId?: string | null;
    linkedShootId?: string | null;
    linkedLocationId?: string | null;
    linkedContactId?: string | null;
    workType:
      | "pre_shoot_coordination"
      | "gallery_release"
      | "id_production"
      | "admin_item"
      | "yearbook"
      | "graduation"
      | "delivery"
      | "invoicing"
      | "follow_up"
      | "exception_handling";
    title: string;
    description?: string | null;
    ownerUserId?: string | null;
    status?: "open" | "in_progress" | "waiting" | "blocked" | "completed" | "cancelled";
    stage?: "intake" | "planning" | "active" | "waiting_on_school" | "waiting_on_internal" | "ready_for_delivery" | "done";
    priority?: "low" | "normal" | "high" | "critical";
    dueDate?: string | null;
    slaDate?: string | null;
    blockerReason?: string | null;
    waitingOn?: "none" | "school" | "internal_production" | "internal_ops" | "shipping_vendor" | "billing" | "other";
    sourceSystem?: "mission_control" | "monday" | "manual_import" | "zendesk" | "outlook" | "other";
    sourceReference?: string | null;
    generatedByRule?: boolean;
    automationKey?: string | null;
    escalationLevel?: number;
    notes?: string | null;
    completedAt?: string | null;
    actorUserId: string;
  }
) {
  await client.query(
    `
      INSERT INTO school_work_item (
        id,
        tenant_id,
        organization_id,
        school_job_id,
        linked_shoot_id,
        linked_location_id,
        linked_contact_id,
        work_type,
        title,
        description,
        owner_user_id,
        status,
        stage,
        priority,
        due_date,
        sla_date,
        blocker_reason,
        waiting_on,
        source_system,
        source_reference,
        generated_by_rule,
        automation_key,
        escalation_level,
        completed_at,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$26)
      ON CONFLICT (id) DO UPDATE
      SET
        organization_id = EXCLUDED.organization_id,
        school_job_id = EXCLUDED.school_job_id,
        linked_shoot_id = EXCLUDED.linked_shoot_id,
        linked_location_id = EXCLUDED.linked_location_id,
        linked_contact_id = EXCLUDED.linked_contact_id,
        work_type = EXCLUDED.work_type,
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        owner_user_id = EXCLUDED.owner_user_id,
        status = EXCLUDED.status,
        stage = EXCLUDED.stage,
        priority = EXCLUDED.priority,
        due_date = EXCLUDED.due_date,
        sla_date = EXCLUDED.sla_date,
        blocker_reason = EXCLUDED.blocker_reason,
        waiting_on = EXCLUDED.waiting_on,
        source_system = EXCLUDED.source_system,
        source_reference = EXCLUDED.source_reference,
        generated_by_rule = EXCLUDED.generated_by_rule,
        automation_key = EXCLUDED.automation_key,
        escalation_level = EXCLUDED.escalation_level,
        completed_at = EXCLUDED.completed_at,
        notes = EXCLUDED.notes,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
    `,
    [
      input.id,
      input.tenantId,
      input.organizationId,
      input.schoolJobId ?? null,
      input.linkedShootId ?? null,
      input.linkedLocationId ?? null,
      input.linkedContactId ?? null,
      input.workType,
      input.title,
      input.description ?? null,
      input.ownerUserId ?? null,
      input.status ?? "open",
      input.stage ?? "intake",
      input.priority ?? "normal",
      input.dueDate ?? null,
      input.slaDate ?? null,
      input.blockerReason ?? null,
      input.waitingOn ?? "none",
      input.sourceSystem ?? "mission_control",
      input.sourceReference ?? null,
      input.generatedByRule ?? false,
      input.automationKey ?? null,
      input.escalationLevel ?? 0,
      input.completedAt ?? null,
      input.notes ?? null,
      input.actorUserId
    ]
  );
}

async function upsertResourceLibrarySeedItem(
  client: PoolClient,
  input: {
    tenantId: string;
    seedKey: string;
    organizationId?: string | null;
    locationId?: string | null;
    shootId?: string | null;
    uploaderUserId?: string | null;
    uploaderName?: string | null;
    resourceType: "image" | "document" | "qr_code" | "video";
    category:
      | "setup_photo"
      | "location_reference"
      | "prior_successful_example"
      | "product_example"
      | "issue_concern"
      | "equipment_setup_need"
      | "qr_code_job_document"
      | "misc_internal_reference";
    note?: string | null;
    issueType?: string | null;
    approvalStatus?: "pending_review" | "approved" | "leadership_only";
    visibilityScope?: "leadership_only" | "photographer_prep";
    isBestReference?: boolean;
    fileName: string;
    contentType?: string | null;
    fileSizeBytes?: number | null;
    storageKey?: string | null;
    fileUrl?: string | null;
    capturedAt?: string | null;
  }
) {
  await client.query(
    `
      INSERT INTO resource_library_item (
        tenant_id,
        organization_id,
        location_id,
        shoot_id,
        uploader_user_id,
        uploader_name,
        resource_type,
        category,
        note,
        issue_type,
        approval_status,
        visibility_scope,
        is_best_reference,
        file_name,
        content_type,
        file_size_bytes,
        storage_key,
        file_url,
        captured_at,
        source_record_type,
        source_record_id,
        created_at,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7::resource_library_type,$8::resource_library_category,$9,$10,
        $11::resource_library_approval_status,$12::resource_library_visibility_scope,$13,$14,$15,$16,$17,$18,$19,
        'seed_resource',$20,now(),now()
      )
      ON CONFLICT (tenant_id, source_record_type, source_record_id)
      DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        location_id = EXCLUDED.location_id,
        shoot_id = EXCLUDED.shoot_id,
        uploader_user_id = EXCLUDED.uploader_user_id,
        uploader_name = EXCLUDED.uploader_name,
        resource_type = EXCLUDED.resource_type,
        category = EXCLUDED.category,
        note = EXCLUDED.note,
        issue_type = EXCLUDED.issue_type,
        approval_status = EXCLUDED.approval_status,
        visibility_scope = EXCLUDED.visibility_scope,
        is_best_reference = EXCLUDED.is_best_reference,
        file_name = EXCLUDED.file_name,
        content_type = EXCLUDED.content_type,
        file_size_bytes = EXCLUDED.file_size_bytes,
        storage_key = EXCLUDED.storage_key,
        file_url = EXCLUDED.file_url,
        captured_at = EXCLUDED.captured_at,
        updated_at = now()
    `,
    [
      input.tenantId,
      input.organizationId ?? null,
      input.locationId ?? null,
      input.shootId ?? null,
      input.uploaderUserId ?? null,
      input.uploaderName ?? "Mission Control",
      input.resourceType,
      input.category,
      input.note ?? null,
      input.issueType ?? null,
      input.approvalStatus ?? "approved",
      input.visibilityScope ?? "photographer_prep",
      Boolean(input.isBestReference),
      input.fileName,
      input.contentType ?? null,
      input.fileSizeBytes ?? null,
      input.storageKey ?? null,
      input.fileUrl ?? null,
      input.capturedAt ?? null,
      input.seedKey
    ]
  );
}

async function linkShootToLocation(
  client: PoolClient,
  input: {
    tenantId: string;
    shootId: string;
    shootCode: string;
    shootTitle: string;
    locationId: string;
    locationName: string;
    actorUserId: string;
  }
) {
  await client.query(
    `
      INSERT INTO shoot_location_link (
        tenant_id,
        shoot_id,
        shoot_code,
        event_subject,
        event_location,
        location_id,
        match_status,
        match_source,
        confidence,
        linked_by_user_id,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,'matched','seed',1,$7,now())
      ON CONFLICT (tenant_id, shoot_id)
      WHERE shoot_id IS NOT NULL
      DO UPDATE SET
        shoot_code = EXCLUDED.shoot_code,
        event_subject = EXCLUDED.event_subject,
        event_location = EXCLUDED.event_location,
        location_id = EXCLUDED.location_id,
        match_status = EXCLUDED.match_status,
        match_source = EXCLUDED.match_source,
        confidence = EXCLUDED.confidence,
        linked_by_user_id = EXCLUDED.linked_by_user_id,
        updated_at = now()
    `,
    [
      input.tenantId,
      input.shootId,
      input.shootCode,
      input.shootTitle,
      input.locationName,
      input.locationId,
      input.actorUserId
    ]
  );
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const studioLocation = getStudioLocation() as {
      latitude: number;
      longitude: number;
      address: string;
      geofenceRadiusMeters: number;
    };

    const existingDemoTenants = await client.query(
      "SELECT * FROM tenant WHERE name = 'Demo Studio' ORDER BY created_at ASC, id ASC"
    );
    const tenant =
      existingDemoTenants.rows[0] ??
      (
        await client.query(
          `
            INSERT INTO tenant (name)
            VALUES ('Demo Studio')
            RETURNING *
          `
        )
      ).rows[0];

    await client.query("SELECT app.set_context($1::uuid, NULL::uuid)", [tenant.id]);
    await seedAuthorityPermissionCatalog(client);
    await seedProductionProjectIntakeTemplates(client, tenant.id);

    const studioInsert = await client.query(
      `
        INSERT INTO studio (tenant_id, name, latitude, longitude)
        VALUES ($1, 'Main Studio', $2, $3)
        ON CONFLICT (tenant_id, name)
        DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude
        RETURNING *
      `,
      [tenant.id, studioLocation.latitude, studioLocation.longitude]
    );
    const studio = studioInsert.rows[0] ?? (await client.query("SELECT * FROM studio WHERE tenant_id = $1 LIMIT 1", [tenant.id])).rows[0];

    const passwordHash = await hashPassword(LOCAL_DEMO_PASSWORD);

    const matthew = await seedMembership(
      client,
      tenant.id,
      {
        email: "matthew@example.com",
        fullName: "Matthew Owner",
        role: "owner_admin",
        department: "executive",
        status: "active",
        phoneNumber: "+15550000001"
      },
      passwordHash,
      null
    );

    const admin = await seedMembership(
      client,
      tenant.id,
      {
        email: "admin@example.com",
        fullName: "Demo Admin",
        role: "admin",
        department: "operations",
        status: "active",
        phoneNumber: "+15550000002"
      },
      passwordHash,
      matthew.id
    );

    const leadership = await seedMembership(
      client,
      tenant.id,
      {
        email: "leadership@example.com",
        fullName: "Demo Leadership",
        role: "leadership",
        department: "executive",
        status: "active",
        phoneNumber: "+15550000003"
      },
      passwordHash,
      matthew.id
    );

    const senior = await seedMembership(
      client,
      tenant.id,
      {
        email: "senior@example.com",
        fullName: "Demo Senior Photographer",
        role: "senior_photographer",
        department: "schools",
        status: "active",
        phoneNumber: "+15550000004"
      },
      passwordHash,
      admin.id
    );

    const photographer = await seedMembership(
      client,
      tenant.id,
      {
        email: "photo@example.com",
        fullName: "Demo Photographer",
        role: "photographer",
        department: "schools",
        status: "active",
        phoneNumber: "+15550000005"
      },
      passwordHash,
      admin.id
    );

    const associate = await seedMembership(
      client,
      tenant.id,
      {
        email: "associate@example.com",
        fullName: "Demo Associate Photographer",
        role: "associate_photographer",
        department: "sports",
        status: "active",
        phoneNumber: "+15550000006"
      },
      passwordHash,
      admin.id
    );

    const office = await seedMembership(
      client,
      tenant.id,
      {
        email: "office@example.com",
        fullName: "Demo Office Employee",
        role: "office_employee",
        department: "office",
        status: "active",
        phoneNumber: "+15550000007"
      },
      passwordHash,
      admin.id
    );

    const schoolsClientSuccess = await seedMembership(
      client,
      tenant.id,
      {
        email: "schools-office@example.com",
        fullName: "Schools Client Success",
        role: "office_employee",
        department: "schools",
        status: "active",
        phoneNumber: "+15550000011"
      },
      passwordHash,
      admin.id
    );

    const sportsClientSuccess = await seedMembership(
      client,
      tenant.id,
      {
        email: "sports-office@example.com",
        fullName: "Sports Client Success",
        role: "office_employee",
        department: "sports",
        status: "active",
        phoneNumber: "+15550000012"
      },
      passwordHash,
      admin.id
    );

    const graphicArtist = await seedMembership(
      client,
      tenant.id,
      {
        email: "graphic@example.com",
        fullName: "Graphic Artist",
        role: "office_employee",
        department: "production",
        status: "active",
        phoneNumber: "+15550000013"
      },
      passwordHash,
      admin.id
    );

    const newHire = await seedMembership(
      client,
      tenant.id,
      {
        email: "newhire@example.com",
        fullName: "Demo New Hire",
        role: "associate_photographer",
        department: "schools",
        status: "active",
        phoneNumber: "+15550000010"
      },
      passwordHash,
      admin.id
    );

    const pending = await seedMembership(
      client,
      tenant.id,
      {
        email: "pending@example.com",
        fullName: "Pending Approval User",
        role: "office_employee",
        department: "unassigned",
        status: "pending_approval",
        phoneNumber: "+15550000008"
      },
      passwordHash,
      admin.id
    );

    const suspended = await seedMembership(
      client,
      tenant.id,
      {
        email: "suspended@example.com",
        fullName: "Suspended User",
        role: "office_employee",
        department: "office",
        status: "suspended",
        phoneNumber: "+15550000009"
      },
      passwordHash,
      admin.id
    );

    await client.query(
      `
        UPDATE mileage_zone
        SET active_status = false
        WHERE tenant_id = $1
          AND active_status = true
      `,
      [tenant.id]
    );

    for (const zone of [
      { zoneName: "Zone 1", minDistance: 0, maxDistance: 15, reimbursementAmount: 15 },
      { zoneName: "Zone 2", minDistance: 15.01, maxDistance: 30, reimbursementAmount: 28 },
      { zoneName: "Zone 3", minDistance: 30.01, maxDistance: 45, reimbursementAmount: 42 },
      { zoneName: "Zone 4", minDistance: 45.01, maxDistance: 999, reimbursementAmount: 58 }
    ] as const) {
      await upsertMileageZone(client, {
        tenantId: tenant.id,
        zoneName: zone.zoneName,
        minDistance: zone.minDistance,
        maxDistance: zone.maxDistance,
        reimbursementAmount: zone.reimbursementAmount
      });
    }

    for (const profile of [
      { employeeId: matthew.id, officeRate: 42, photographyRate: 52, mileageEligible: true },
      { employeeId: admin.id, officeRate: 34, photographyRate: 40, mileageEligible: false },
      { employeeId: leadership.id, officeRate: 48, photographyRate: 58, mileageEligible: true },
      { employeeId: senior.id, officeRate: 26, photographyRate: 34, mileageEligible: true },
      { employeeId: photographer.id, officeRate: 22, photographyRate: 30, mileageEligible: true },
      { employeeId: associate.id, officeRate: 20, photographyRate: 26, mileageEligible: true },
      { employeeId: office.id, officeRate: 21, photographyRate: 21, mileageEligible: false },
      { employeeId: schoolsClientSuccess.id, officeRate: 24, photographyRate: 24, mileageEligible: false },
      { employeeId: sportsClientSuccess.id, officeRate: 24, photographyRate: 24, mileageEligible: false },
      { employeeId: graphicArtist.id, officeRate: 23, photographyRate: 23, mileageEligible: false },
      { employeeId: newHire.id, officeRate: 19, photographyRate: 24, mileageEligible: true },
      { employeeId: pending.id, officeRate: 20, photographyRate: 20, mileageEligible: false },
      { employeeId: suspended.id, officeRate: 20, photographyRate: 20, mileageEligible: false }
    ] as const) {
      await upsertEmployeePayProfile(client, {
        tenantId: tenant.id,
        employeeId: profile.employeeId,
        officeRate: profile.officeRate,
        photographyRate: profile.photographyRate,
        mileageEligible: profile.mileageEligible
      });
    }

    const outstandingInviteToken = "local-invite-token-demo";
    const inviteHash = hashOpaqueToken(outstandingInviteToken);
    await client.query(
      `
        INSERT INTO app_user (tenant_id, email, full_name, department, status, invited_by_user_id, invited_at, is_active)
        VALUES ($1,'invitee@example.com','Invited User','unassigned','invited',$2,now(),false)
        ON CONFLICT (tenant_id, email) DO UPDATE
        SET full_name = EXCLUDED.full_name,
            department = EXCLUDED.department,
            status = 'invited',
            invited_by_user_id = EXCLUDED.invited_by_user_id,
            invited_at = COALESCE(app_user.invited_at, now()),
            is_active = false
      `,
      [tenant.id, admin.id]
    );
    const invited = (await client.query("SELECT id FROM app_user WHERE tenant_id = $1 AND email = 'invitee@example.com' LIMIT 1", [tenant.id])).rows[0];
    const officeRole = (await client.query("SELECT id FROM role WHERE code = 'office_employee'")).rows[0];
    await client.query("DELETE FROM user_role WHERE tenant_id = $1 AND user_id = $2", [tenant.id, invited.id]);
    await client.query("INSERT INTO user_role (tenant_id, user_id, role_id) VALUES ($1,$2,$3)", [tenant.id, invited.id, officeRole.id]);
    await client.query("UPDATE user_invite SET revoked_at = now() WHERE app_user_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL", [invited.id]);
    await client.query(
      `
        INSERT INTO user_invite (
          tenant_id, app_user_id, email, invited_role, invited_department, invited_authority_tier, invited_job_function_profile, invited_by_user_id, token_hash, expires_at
        )
        VALUES ($1,$2,'invitee@example.com','office_employee','unassigned',$3,$4,$5,$6, now() + interval '72 hours')
        ON CONFLICT (token_hash) DO NOTHING
      `,
      [tenant.id, invited.id, "standard_employee", "customer_service_rep", admin.id, inviteHash]
    );

    const mainShootStart = localTodayAt(15, 0);
    const mainShootArrival = addMinutes(mainShootStart, -15);
    const mainShootEnd = addMinutes(mainShootStart, 120);
    const secondShootStart = localTodayAt(18, 0);
    const secondShootArrival = addMinutes(secondShootStart, -20);
    const secondShootEnd = addMinutes(secondShootStart, 120);
    const mainShootDate = toIsoDateOnly(mainShootStart);
    const sportsShootDate = toIsoDateOnly(secondShootStart);

    const demoShoot = (
      await client.query(
        `
          INSERT INTO shoot (
            tenant_id, studio_id, department, shoot_code, title, shoot_date, location_name, location_address, location_lat, location_lng,
            geofence_radius_meters, navigation_url, estimated_drive_minutes, arrival_time, start_time, end_time_est, projected_students,
            planned_staff_count, required_lead_count, revenue_potential_score, strategic_district_importance, account_growth_importance_score,
            complexity_score, customer_history_risk_score, multi_team_coordination, readiness_owner_user_id, future_profitability_manual,
            future_profitability_reason, schedule_sync_required, schedule_sync_state, created_by
          )
          VALUES (
            $1, $2, 'schools', 'DEMO-001', 'Demo Senior Session', $3, 'Downtown Demo Park',
            '101 Demo Park Avenue, Minneapolis, MN', 44.9778, -93.2649, 1609,
            $4, $5, $6, $7, $8, 200, 3, 1, 72, false, 60,
            50, 35, false, $9, NULL, NULL, false, 'not_linked', $10
          )
          ON CONFLICT (tenant_id, shoot_code) DO UPDATE
          SET shoot_date = EXCLUDED.shoot_date,
              title = EXCLUDED.title,
              location_name = EXCLUDED.location_name,
              location_address = EXCLUDED.location_address,
              location_lat = EXCLUDED.location_lat,
              location_lng = EXCLUDED.location_lng,
              geofence_radius_meters = EXCLUDED.geofence_radius_meters,
              navigation_url = EXCLUDED.navigation_url,
              estimated_drive_minutes = EXCLUDED.estimated_drive_minutes,
              arrival_time = EXCLUDED.arrival_time,
              start_time = EXCLUDED.start_time,
              end_time_est = EXCLUDED.end_time_est,
              projected_students = EXCLUDED.projected_students,
              planned_staff_count = EXCLUDED.planned_staff_count,
              required_lead_count = EXCLUDED.required_lead_count,
              revenue_potential_score = EXCLUDED.revenue_potential_score,
              strategic_district_importance = EXCLUDED.strategic_district_importance,
              account_growth_importance_score = EXCLUDED.account_growth_importance_score,
              complexity_score = EXCLUDED.complexity_score,
              customer_history_risk_score = EXCLUDED.customer_history_risk_score,
              multi_team_coordination = EXCLUDED.multi_team_coordination,
              readiness_owner_user_id = EXCLUDED.readiness_owner_user_id,
              future_profitability_manual = EXCLUDED.future_profitability_manual,
              future_profitability_reason = EXCLUDED.future_profitability_reason,
              schedule_sync_required = EXCLUDED.schedule_sync_required,
              schedule_sync_state = EXCLUDED.schedule_sync_state
          RETURNING *
        `,
        [
          tenant.id,
          studio.id,
          mainShootDate,
          buildGoogleMapsLink({
            latitude: 44.9778,
            longitude: -93.2649,
            address: "101 Demo Park Avenue, Minneapolis, MN",
            label: "Downtown Demo Park"
          }),
          estimateDriveMinutesFromStudio(44.9778, -93.2649),
          mainShootArrival,
          mainShootStart,
          mainShootEnd,
          leadership.id,
          admin.id
        ]
      )
    ).rows[0];

    const sportsShoot = (
      await client.query(
        `
          INSERT INTO shoot (
            tenant_id, studio_id, department, shoot_code, title, shoot_date, location_name, location_address, location_lat, location_lng,
            geofence_radius_meters, navigation_url, estimated_drive_minutes, arrival_time, start_time, end_time_est, projected_students,
            planned_staff_count, required_lead_count, revenue_potential_score, strategic_district_importance, account_growth_importance_score,
            complexity_score, customer_history_risk_score, multi_team_coordination, readiness_owner_user_id, future_profitability_manual,
            future_profitability_reason, schedule_sync_required, schedule_sync_state, created_by
          )
          VALUES (
            $1, $2, 'sports', 'DEMO-002', 'Demo Sports Portrait Day', $3, 'North Metro Stadium',
            '2500 Stadium Drive, Plymouth, MN', 45.0144, -93.4557, 1609,
            $4, $5, $6, $7, $8, 420, 6, 1, 90, true, 80,
            90, 70, true, $9, 'watch', 'Large travel crew and setup complexity make this a watch-level operational profitability signal.', false, 'not_linked', $10
          )
          ON CONFLICT (tenant_id, shoot_code) DO UPDATE
          SET shoot_date = EXCLUDED.shoot_date,
              title = EXCLUDED.title,
              location_name = EXCLUDED.location_name,
              location_address = EXCLUDED.location_address,
              location_lat = EXCLUDED.location_lat,
              location_lng = EXCLUDED.location_lng,
              geofence_radius_meters = EXCLUDED.geofence_radius_meters,
              navigation_url = EXCLUDED.navigation_url,
              estimated_drive_minutes = EXCLUDED.estimated_drive_minutes,
              arrival_time = EXCLUDED.arrival_time,
              start_time = EXCLUDED.start_time,
              end_time_est = EXCLUDED.end_time_est,
              projected_students = EXCLUDED.projected_students,
              planned_staff_count = EXCLUDED.planned_staff_count,
              required_lead_count = EXCLUDED.required_lead_count,
              revenue_potential_score = EXCLUDED.revenue_potential_score,
              strategic_district_importance = EXCLUDED.strategic_district_importance,
              account_growth_importance_score = EXCLUDED.account_growth_importance_score,
              complexity_score = EXCLUDED.complexity_score,
              customer_history_risk_score = EXCLUDED.customer_history_risk_score,
              multi_team_coordination = EXCLUDED.multi_team_coordination,
              readiness_owner_user_id = EXCLUDED.readiness_owner_user_id,
              future_profitability_manual = EXCLUDED.future_profitability_manual,
              future_profitability_reason = EXCLUDED.future_profitability_reason,
              schedule_sync_required = EXCLUDED.schedule_sync_required,
              schedule_sync_state = EXCLUDED.schedule_sync_state
          RETURNING *
        `,
        [
          tenant.id,
          studio.id,
          sportsShootDate,
          buildGoogleMapsLink({
            latitude: 45.0144,
            longitude: -93.4557,
            address: "2500 Stadium Drive, Plymouth, MN",
            label: "North Metro Stadium"
          }),
          estimateDriveMinutesFromStudio(45.0144, -93.4557),
          secondShootArrival,
          secondShootStart,
          secondShootEnd,
          leadership.id,
          admin.id
        ]
      )
    ).rows[0];

    await client.query("DELETE FROM shift_trade_request WHERE tenant_id = $1", [tenant.id]);
    await client.query("DELETE FROM pto_request WHERE tenant_id = $1", [tenant.id]);
    await client.query("DELETE FROM ops_notification WHERE tenant_id = $1", [tenant.id]);
    await client.query("DELETE FROM schedule_event WHERE tenant_id = $1", [tenant.id]);
    await client.query("DELETE FROM staffing_template_role WHERE tenant_id = $1", [tenant.id]);
    await client.query("DELETE FROM staffing_template WHERE tenant_id = $1", [tenant.id]);
    await client.query("DELETE FROM attendance_exception WHERE tenant_id = $1", [tenant.id]);
    await client.query("DELETE FROM shift_punch WHERE tenant_id = $1", [tenant.id]);
    await client.query("DELETE FROM shift_segment WHERE tenant_id = $1", [tenant.id]);
    await client.query("DELETE FROM work_shift WHERE tenant_id = $1", [tenant.id]);
    await client.query(
      "DELETE FROM external_object_map WHERE tenant_id = $1 AND object_type = ANY($2::text[])",
      [tenant.id, ["school_job", "school_work_item"]]
    );
    await client.query(
      "DELETE FROM integration_sync_operation WHERE tenant_id = $1 AND entity_type = ANY($2::text[])",
      [tenant.id, ["school_job", "school_work_item"]]
    );
    await client.query("DELETE FROM school_work_item WHERE tenant_id = $1", [tenant.id]);
    await client.query("DELETE FROM school_job WHERE tenant_id = $1", [tenant.id]);
    await client.query("DELETE FROM school_activity_log WHERE tenant_id = $1", [tenant.id]);
    await client.query("DELETE FROM school_rule WHERE tenant_id = $1", [tenant.id]);
    await client.query("DELETE FROM school_profile WHERE tenant_id = $1", [tenant.id]);
    await client.query("DELETE FROM notification_routing_rule WHERE tenant_id = $1", [tenant.id]);
    await client.query("DELETE FROM time_entry WHERE tenant_id = $1 AND shoot_id = ANY($2::uuid[])", [tenant.id, [demoShoot.id, sportsShoot.id]]);
    await client.query("DELETE FROM status_event WHERE tenant_id = $1 AND shoot_id = ANY($2::uuid[])", [tenant.id, [demoShoot.id, sportsShoot.id]]);
    await client.query("DELETE FROM alert WHERE tenant_id = $1 AND shoot_id = ANY($2::uuid[])", [tenant.id, [demoShoot.id, sportsShoot.id]]);
    await client.query(
      `
        DELETE FROM app_event
        WHERE tenant_id = $1
          AND (
            event_type IN ('notification.dispatch', 'schedule.calendar.sync')
            OR aggregate_type IN ('work_shift', 'ops_notification', 'attendance_exception')
          )
      `,
      [tenant.id]
    );

    const schoolsOrganizationId = await upsertOrganization(client, {
      tenantId: tenant.id,
      canonicalName: "White Bear Lake High School",
      displayName: "White Bear Lake High School",
      accountType: "schools_underclass_portraits",
      aliases: ["WBL High School", "White Bear HS"],
      notes: "Canonical school Organization record for recurring portrait scheduling and day-of contact reuse.",
      actorUserId: admin.id
    });
    const sportsOrganizationId = await upsertOrganization(client, {
      tenantId: tenant.id,
      canonicalName: "North Metro Athletics",
      displayName: "North Metro Athletics",
      accountType: "sports",
      aliases: ["North Metro Stadium", "North Metro Activities"],
      notes: "Canonical sports Organization record for stadium media days and recurring staffing patterns.",
      actorUserId: admin.id
    });
    const studioOrganizationId = await upsertOrganization(client, {
      tenantId: tenant.id,
      canonicalName: "Kemmetmueller Studio Operations",
      displayName: "Kemmetmueller Studio Operations",
      accountType: "internal",
      aliases: ["Main Studio"],
      notes: "Internal Organization record for studio and leadership operations work that still needs clean reusable contacts and locations.",
      actorUserId: admin.id
    });
    const cedarRidgeOrganizationId = await upsertOrganization(client, {
      tenantId: tenant.id,
      canonicalName: "Cedar Ridge High School",
      displayName: "Cedar Ridge High School",
      accountType: "schools_events",
      aliases: ["Cedar Ridge HS"],
      notes: "At-risk school account with yearbook pressure, delayed approvals, and repeated follow-up needs.",
      actorUserId: admin.id
    });
    const mapleGroveOrganizationId = await upsertOrganization(client, {
      tenantId: tenant.id,
      canonicalName: "Maple Grove Middle School",
      displayName: "Maple Grove Middle School",
      accountType: "schools_underclass_portraits",
      aliases: ["Maple Grove MS"],
      notes: "School account that depends on internal production timing and bundled delivery coordination.",
      actorUserId: admin.id
    });

    const schoolsPrimaryContactId = await upsertOrganizationContact(client, {
      tenantId: tenant.id,
      organizationId: schoolsOrganizationId,
      firstName: "Jamie",
      lastName: "Carlson",
      title: "Activities Director",
      phone: "555-0188",
      email: "jamie.carlson@example.com",
      notes: "Primary portrait-day planning contact.",
      actorUserId: admin.id
    });
    const schoolsSecondaryContactId = await upsertOrganizationContact(client, {
      tenantId: tenant.id,
      organizationId: schoolsOrganizationId,
      firstName: "Megan",
      lastName: "Stark",
      title: "Main Office",
      phone: "555-0155",
      email: "office.whitebear@example.com",
      notes: "Front desk escalation contact if the activities office is tied up.",
      actorUserId: admin.id
    });
    const sportsPrimaryContactId = await upsertOrganizationContact(client, {
      tenantId: tenant.id,
      organizationId: sportsOrganizationId,
      firstName: "Riley",
      lastName: "Hart",
      title: "Athletics Director",
      phone: "555-0142",
      email: "riley.hart@example.com",
      notes: "Primary game-day and media-day coordination contact.",
      actorUserId: admin.id
    });
    const studioPrimaryContactId = await upsertOrganizationContact(client, {
      tenantId: tenant.id,
      organizationId: studioOrganizationId,
      firstName: "Dana",
      lastName: "Frost",
      title: "Studio Coordinator",
      phone: "555-0131",
      email: "dana.frost@example.com",
      notes: "Internal coordination contact for studio loads and ad hoc operations blocks.",
      actorUserId: admin.id
    });
    const cedarRidgePrimaryContactId = await upsertOrganizationContact(client, {
      tenantId: tenant.id,
      organizationId: cedarRidgeOrganizationId,
      firstName: "Lauren",
      lastName: "Bishop",
      title: "Yearbook Adviser",
      phone: "555-0191",
      email: "lauren.bishop@example.com",
      notes: "Primary yearbook and subject-directory contact. Needs proactive follow-up on proofs.",
      actorUserId: admin.id
    });
    const cedarRidgeOfficeContactId = await upsertOrganizationContact(client, {
      tenantId: tenant.id,
      organizationId: cedarRidgeOrganizationId,
      firstName: "Tara",
      lastName: "Mills",
      title: "Main Office Secretary",
      phone: "555-0192",
      email: "tara.mills@example.com",
      notes: "Front-office contact for deliveries and access windows.",
      actorUserId: admin.id
    });
    const mapleGrovePrimaryContactId = await upsertOrganizationContact(client, {
      tenantId: tenant.id,
      organizationId: mapleGroveOrganizationId,
      firstName: "Andre",
      lastName: "Cole",
      title: "Assistant Principal",
      phone: "555-0197",
      email: "andre.cole@example.com",
      notes: "Owns picture day flow and approves bundled deliveries when the office is short-staffed.",
      actorUserId: admin.id
    });
    const mapleGroveOfficeContactId = await upsertOrganizationContact(client, {
      tenantId: tenant.id,
      organizationId: mapleGroveOrganizationId,
      firstName: "Beth",
      lastName: "Lopez",
      title: "School Administrative Assistant",
      phone: "555-0198",
      email: "beth.lopez@example.com",
      notes: "Coordinates front-desk packet handoff and same-day pickup windows.",
      actorUserId: admin.id
    });

    const downtownParkLocationId = await upsertOrganizationLocation(client, {
      tenantId: tenant.id,
      organizationId: schoolsOrganizationId,
      externalKey: "manual:downtown-demo-park",
      locationName: "Downtown Demo Park",
      addressLine1: "101 Demo Park Avenue",
      city: "Minneapolis",
      state: "MN",
      zip: "55415",
      mapsLabel: "Downtown Demo Park",
      notes: "Front office unlocks the south gate. Hold backdrop cases against the east wall until the senior lead clears setup.",
      latitude: 44.9778,
      longitude: -93.2649,
      actorUserId: admin.id
    });
    const northMetroLocationId = await upsertOrganizationLocation(client, {
      tenantId: tenant.id,
      organizationId: sportsOrganizationId,
      externalKey: "manual:north-metro-stadium",
      locationName: "North Metro Stadium",
      addressLine1: "2500 Stadium Drive",
      city: "Plymouth",
      state: "MN",
      zip: "55447",
      mapsLabel: "North Metro Stadium",
      notes: "Use the east athlete gate and keep a runner by the fieldhouse door for parent check-in overflow.",
      latitude: 45.0144,
      longitude: -93.4557,
      actorUserId: admin.id
    });
    await upsertOrganizationLocation(client, {
      tenantId: tenant.id,
      organizationId: studioOrganizationId,
      externalKey: "manual:main-studio",
      locationName: "Main Studio",
      addressLine1: studioLocation.address,
      city: "Minnetonka",
      state: "MN",
      zip: "55345",
      mapsLabel: "Main Studio",
      notes: "Internal studio hub for leadership huddles, gear loads, and training blocks.",
      latitude: studioLocation.latitude,
      longitude: studioLocation.longitude,
      actorUserId: admin.id
    });
    const cedarRidgeLocationId = await upsertOrganizationLocation(client, {
      tenantId: tenant.id,
      organizationId: cedarRidgeOrganizationId,
      externalKey: "manual:cedar-ridge-auditorium",
      locationName: "Cedar Ridge Auditorium",
      addressLine1: "880 Cedar Ridge Lane",
      city: "Woodbury",
      state: "MN",
      zip: "55125",
      mapsLabel: "Cedar Ridge Auditorium",
      notes: "Use the east loading door and confirm power access with the yearbook lab before setup.",
      latitude: 44.9232,
      longitude: -92.9597,
      actorUserId: admin.id
    });
    const mapleGroveLocationId = await upsertOrganizationLocation(client, {
      tenantId: tenant.id,
      organizationId: mapleGroveOrganizationId,
      externalKey: "manual:maple-grove-commons",
      locationName: "Maple Grove Commons",
      addressLine1: "410 Arbor Avenue",
      city: "Maple Grove",
      state: "MN",
      zip: "55369",
      mapsLabel: "Maple Grove Commons",
      notes: "The commons doubles as the delivery staging area, so keep internal production bins consolidated for office pickup.",
      latitude: 45.0808,
      longitude: -93.4558,
      actorUserId: admin.id
    });

    await client.query("DELETE FROM shoot_assignment WHERE tenant_id = $1 AND shoot_id IN ($2, $3)", [tenant.id, demoShoot.id, sportsShoot.id]);
    for (const [shootId, userId, isPrimary] of [
      [demoShoot.id, photographer.id, true],
      [demoShoot.id, senior.id, false],
      [sportsShoot.id, associate.id, true],
      [sportsShoot.id, senior.id, false]
    ] as const) {
      await client.query(
        `
          INSERT INTO shoot_assignment (tenant_id, shoot_id, user_id, is_primary)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (tenant_id, shoot_id, user_id) DO UPDATE SET is_primary = EXCLUDED.is_primary
        `,
        [tenant.id, shootId, userId, isPrimary]
      );
    }

    await linkShootToLocation(client, {
      tenantId: tenant.id,
      shootId: demoShoot.id,
      shootCode: demoShoot.shoot_code,
      shootTitle: demoShoot.title,
      locationId: downtownParkLocationId,
      locationName: demoShoot.location_name,
      actorUserId: admin.id
    });
    await linkShootToLocation(client, {
      tenantId: tenant.id,
      shootId: sportsShoot.id,
      shootCode: sportsShoot.shoot_code,
      shootTitle: sportsShoot.title,
      locationId: northMetroLocationId,
      locationName: sportsShoot.location_name,
      actorUserId: admin.id
    });

    await client.query(
      `
        UPDATE shoot
        SET
          organization_id = $3,
          location_id = $4,
          primary_contact_id = $5,
          shoot_type = 'schools_underclass_portraits',
          primary_contact_name = 'Jamie Carlson',
          primary_contact_phone = '555-0188',
          primary_contact_email = 'jamie.carlson@example.com',
          secondary_contact_name = 'Megan Stark',
          secondary_contact_phone = '555-0155',
          secondary_contact_email = 'office.whitebear@example.com',
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [tenant.id, demoShoot.id, schoolsOrganizationId, downtownParkLocationId, schoolsPrimaryContactId]
    );
    await client.query(
      `
        UPDATE shoot
        SET
          organization_id = $3,
          location_id = $4,
          primary_contact_id = $5,
          shoot_type = 'sports',
          primary_contact_name = 'Riley Hart',
          primary_contact_phone = '555-0142',
          primary_contact_email = 'riley.hart@example.com',
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [tenant.id, sportsShoot.id, sportsOrganizationId, northMetroLocationId, sportsPrimaryContactId]
    );

    await client.query("DELETE FROM shoot_contact_link WHERE tenant_id = $1 AND shoot_id IN ($2, $3)", [
      tenant.id,
      demoShoot.id,
      sportsShoot.id
    ]);
    await client.query(
      `
        INSERT INTO shoot_contact_link (
          tenant_id,
          shoot_id,
          contact_id,
          contact_role,
          sort_order,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES
          ($1,$2,$3,'primary',0,$6,$6),
          ($1,$2,$4,'additional',1,$6,$6),
          ($1,$5,$7,'primary',0,$6,$6)
        ON CONFLICT (tenant_id, shoot_id, contact_id) DO UPDATE
        SET contact_role = EXCLUDED.contact_role, sort_order = EXCLUDED.sort_order, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()
      `,
      [tenant.id, demoShoot.id, schoolsPrimaryContactId, schoolsSecondaryContactId, sportsShoot.id, admin.id, sportsPrimaryContactId]
    );

    const schoolsToday = new Date();
    const todayDate = toIsoDateOnly(schoolsToday);
    const yesterdayDate = toIsoDateOnly(addDays(schoolsToday, -1));
    const tomorrowDate = toIsoDateOnly(addDays(schoolsToday, 1));
    const twoDaysOut = toIsoDateOnly(addDays(schoolsToday, 2));
    const threeDaysOut = toIsoDateOnly(addDays(schoolsToday, 3));
    const fiveDaysOut = toIsoDateOnly(addDays(schoolsToday, 5));
    const tenDaysOut = toIsoDateOnly(addDays(schoolsToday, 10));
    const recentCompletedAt = addDays(schoolsToday, -1).toISOString();

    await Promise.all([
      upsertSchoolProfile(client, {
        tenantId: tenant.id,
        organizationId: schoolsOrganizationId,
        districtName: "White Bear Lake Area Schools",
        schoolType: "High School",
        schoolYearLabel: "2026-2027",
        relationshipHealthState: "healthy",
        relationshipSummary: "The school usually confirms quickly and the office packet process is stable.",
        primaryInternalOwnerUserId: schoolsClientSuccess.id,
        backupInternalOwnerUserId: office.id,
        primaryLocationId: downtownParkLocationId,
        tags: ["healthy", "ids", "portraits"],
        notes: "Default packet flow is stable. Keep ID packets grouped by advisory for the office team.",
        actorUserId: admin.id
      }),
      upsertSchoolProfile(client, {
        tenantId: tenant.id,
        organizationId: cedarRidgeOrganizationId,
        districtName: "East Metro Public Schools",
        schoolType: "High School",
        schoolYearLabel: "2026-2027",
        relationshipHealthState: "at_risk",
        relationshipSummary: "Yearbook deadlines are slipping and school-side approval gaps still need escalation support.",
        primaryInternalOwnerUserId: schoolsClientSuccess.id,
        backupInternalOwnerUserId: leadership.id,
        primaryLocationId: cedarRidgeLocationId,
        tags: ["at-risk", "yearbook", "subject-directory"],
        notes: "Use the leadership escalation path if yearbook approval is still missing three business days before print cutoff.",
        actorUserId: admin.id
      }),
      upsertSchoolProfile(client, {
        tenantId: tenant.id,
        organizationId: mapleGroveOrganizationId,
        districtName: "Maple Grove Public Schools",
        schoolType: "Middle School",
        schoolYearLabel: "2026-2027",
        relationshipHealthState: "needs_attention",
        relationshipSummary: "The school is responsive, but internal production timing and delivery bundling still need close coordination.",
        primaryInternalOwnerUserId: schoolsClientSuccess.id,
        backupInternalOwnerUserId: graphicArtist.id,
        primaryLocationId: mapleGroveLocationId,
        tags: ["gallery", "delivery", "internal-handoff"],
        notes: "Bundle office packets with gallery release materials whenever internal production finishes on the same day.",
        actorUserId: admin.id
      })
    ]);

    await Promise.all([
      upsertSchoolContactRelationship(client, {
        tenantId: tenant.id,
        organizationId: schoolsOrganizationId,
        contactId: schoolsPrimaryContactId,
        relationshipRole: "planning",
        isPrimary: true,
        schoolContactCategories: ["photo_day_contact", "yearbook_contact"],
        actorUserId: admin.id
      }),
      upsertSchoolContactRelationship(client, {
        tenantId: tenant.id,
        organizationId: schoolsOrganizationId,
        contactId: schoolsSecondaryContactId,
        relationshipRole: "operations",
        schoolContactCategories: ["secretary"],
        actorUserId: admin.id
      }),
      upsertSchoolContactRelationship(client, {
        tenantId: tenant.id,
        organizationId: cedarRidgeOrganizationId,
        contactId: cedarRidgePrimaryContactId,
        relationshipRole: "planning",
        isPrimary: true,
        schoolContactCategories: ["yearbook_contact", "photo_day_contact"],
        actorUserId: admin.id
      }),
      upsertSchoolContactRelationship(client, {
        tenantId: tenant.id,
        organizationId: cedarRidgeOrganizationId,
        contactId: cedarRidgeOfficeContactId,
        relationshipRole: "operations",
        schoolContactCategories: ["secretary"],
        actorUserId: admin.id
      }),
      upsertSchoolContactRelationship(client, {
        tenantId: tenant.id,
        organizationId: mapleGroveOrganizationId,
        contactId: mapleGrovePrimaryContactId,
        relationshipRole: "decision_maker",
        isPrimary: true,
        schoolContactCategories: ["photo_day_contact", "graduation_contact"],
        actorUserId: admin.id
      }),
      upsertSchoolContactRelationship(client, {
        tenantId: tenant.id,
        organizationId: mapleGroveOrganizationId,
        contactId: mapleGroveOfficeContactId,
        relationshipRole: "billing",
        schoolContactCategories: ["billing_contact", "other"],
        actorUserId: admin.id
      })
    ]);

    await Promise.all([
      upsertSchoolRule(client, {
        id: "00000000-0000-0000-0000-000000000701",
        tenantId: tenant.id,
        organizationId: schoolsOrganizationId,
        ruleType: "punch_id_rules",
        title: "ID packet sorting",
        summary: "Sort packets by advisory and hold extras for the office manager.",
        structuredValue: {
          grouping: "advisory",
          reprint_owner: "Main Office",
          same_day_pull: true
        },
        sortOrder: 10,
        actorUserId: admin.id
      }),
      upsertSchoolRule(client, {
        id: "00000000-0000-0000-0000-000000000702",
        tenantId: tenant.id,
        organizationId: cedarRidgeOrganizationId,
        ruleType: "yearbook_participation",
        title: "Yearbook proof review",
        summary: "Proofs must be reviewed with the adviser before final release.",
        structuredValue: {
          review_window_days: 3,
          requires_adviser_signoff: true
        },
        sortOrder: 10,
        actorUserId: admin.id
      }),
      upsertSchoolRule(client, {
        id: "00000000-0000-0000-0000-000000000703",
        tenantId: tenant.id,
        organizationId: cedarRidgeOrganizationId,
        ruleType: "subject_directory_requirements",
        title: "Subject directory bundle",
        summary: "Subject directories must ship with the yearbook packet and stay grouped by advisory.",
        structuredValue: {
          grouping: "advisory",
          copies_per_homeroom: 2,
          delivery_owner: "Yearbook Adviser"
        },
        sortOrder: 20,
        actorUserId: admin.id
      }),
      upsertSchoolRule(client, {
        id: "00000000-0000-0000-0000-000000000704",
        tenantId: tenant.id,
        organizationId: mapleGroveOrganizationId,
        ruleType: "delivery_preferences",
        title: "Bundled office delivery",
        summary: "Bundle gallery paperwork and pickup packets whenever internal production completes on the same day.",
        structuredValue: {
          preferred_method: "office_pickup",
          allow_bundled_delivery: true
        },
        sortOrder: 10,
        actorUserId: admin.id
      })
    ]);

    await Promise.all([
      upsertSchoolJob(client, {
        id: "00000000-0000-0000-0000-000000000401",
        tenantId: tenant.id,
        organizationId: schoolsOrganizationId,
        linkedShootId: demoShoot.id,
        linkedLocationId: downtownParkLocationId,
        jobType: "spring_portraits",
        eventDate: fiveDaysOut,
        dueDate: threeDaysOut,
        ownerUserId: schoolsClientSuccess.id,
        status: "active",
        title: "White Bear spring portrait prep",
        notes: "Healthy baseline school with steady portrait prep and ID follow-through.",
        actorUserId: admin.id
      }),
      upsertSchoolJob(client, {
        id: "00000000-0000-0000-0000-000000000402",
        tenantId: tenant.id,
        organizationId: schoolsOrganizationId,
        linkedLocationId: downtownParkLocationId,
        jobType: "ids",
        eventDate: todayDate,
        dueDate: twoDaysOut,
        ownerUserId: office.id,
        status: "active",
        title: "White Bear ID fulfillment",
        notes: "ID pull, sort, and office packet follow-up.",
        actorUserId: admin.id
      }),
      upsertSchoolJob(client, {
        id: "00000000-0000-0000-0000-000000000403",
        tenantId: tenant.id,
        organizationId: cedarRidgeOrganizationId,
        linkedLocationId: cedarRidgeLocationId,
        jobType: "yearbook",
        eventDate: tenDaysOut,
        dueDate: tenDaysOut,
        ownerUserId: schoolsClientSuccess.id,
        status: "waiting",
        title: "Cedar Ridge yearbook review",
        notes: "At-risk yearbook workflow with missing school-side approvals.",
        actorUserId: admin.id
      }),
      upsertSchoolJob(client, {
        id: "00000000-0000-0000-0000-000000000404",
        tenantId: tenant.id,
        organizationId: mapleGroveOrganizationId,
        linkedLocationId: mapleGroveLocationId,
        jobType: "delivery",
        eventDate: twoDaysOut,
        dueDate: twoDaysOut,
        ownerUserId: graphicArtist.id,
        sourceSystem: "monday",
        sourceReference: "legacy-maple-grove-delivery",
        status: "active",
        title: "Maple Grove gallery and packet release",
        notes: "Internal production dependency with a same-day delivery handoff.",
        actorUserId: admin.id
      })
    ]);

    await Promise.all([
      upsertSchoolWorkItem(client, {
        id: "00000000-0000-0000-0000-000000000501",
        tenantId: tenant.id,
        organizationId: schoolsOrganizationId,
        schoolJobId: "00000000-0000-0000-0000-000000000401",
        linkedShootId: demoShoot.id,
        linkedLocationId: downtownParkLocationId,
        linkedContactId: schoolsPrimaryContactId,
        workType: "pre_shoot_coordination",
        title: "Confirm White Bear spring roster and admin packet",
        description: "Final roster file and front-office packet still need same-day confirmation.",
        ownerUserId: schoolsClientSuccess.id,
        status: "open",
        stage: "planning",
        priority: "high",
        dueDate: todayDate,
        slaDate: fiveDaysOut,
        waitingOn: "school",
        notes: "Healthy school example that still needs a live school-side confirmation.",
        actorUserId: admin.id
      }),
      upsertSchoolWorkItem(client, {
        id: "00000000-0000-0000-0000-000000000502",
        tenantId: tenant.id,
        organizationId: schoolsOrganizationId,
        schoolJobId: "00000000-0000-0000-0000-000000000402",
        linkedShootId: demoShoot.id,
        linkedLocationId: downtownParkLocationId,
        linkedContactId: schoolsSecondaryContactId,
        workType: "id_production",
        title: "Pull and sort White Bear ID cards",
        description: "Office packets are staged and ready for ID sort-by-advisory.",
        ownerUserId: office.id,
        status: "in_progress",
        stage: "active",
        priority: "normal",
        dueDate: tomorrowDate,
        waitingOn: "internal_ops",
        notes: "Healthy ID queue example for the schools team.",
        actorUserId: admin.id
      }),
      upsertSchoolWorkItem(client, {
        id: "00000000-0000-0000-0000-000000000503",
        tenantId: tenant.id,
        organizationId: schoolsOrganizationId,
        schoolJobId: "00000000-0000-0000-0000-000000000402",
        linkedShootId: demoShoot.id,
        linkedLocationId: downtownParkLocationId,
        workType: "admin_item",
        title: "Deliver White Bear sticker packet",
        description: "Sticker and admin packet already handed off to the main office.",
        ownerUserId: office.id,
        status: "completed",
        stage: "done",
        priority: "normal",
        dueDate: yesterdayDate,
        waitingOn: "none",
        notes: "Recently completed seed item for weekly review.",
        completedAt: recentCompletedAt,
        actorUserId: admin.id
      }),
      upsertSchoolWorkItem(client, {
        id: "00000000-0000-0000-0000-000000000504",
        tenantId: tenant.id,
        organizationId: cedarRidgeOrganizationId,
        schoolJobId: "00000000-0000-0000-0000-000000000403",
        linkedLocationId: cedarRidgeLocationId,
        linkedContactId: cedarRidgePrimaryContactId,
        workType: "yearbook",
        title: "Finalize Cedar Ridge yearbook proof review",
        description: "The adviser still has not approved class-name changes or subject-directory counts.",
        ownerUserId: schoolsClientSuccess.id,
        status: "waiting",
        stage: "waiting_on_school",
        priority: "critical",
        dueDate: yesterdayDate,
        slaDate: tenDaysOut,
        waitingOn: "school",
        notes: "At-risk school example that is both overdue and school-blocked.",
        actorUserId: admin.id
      }),
      upsertSchoolWorkItem(client, {
        id: "00000000-0000-0000-0000-000000000505",
        tenantId: tenant.id,
        organizationId: mapleGroveOrganizationId,
        schoolJobId: "00000000-0000-0000-0000-000000000404",
        linkedLocationId: mapleGroveLocationId,
        linkedContactId: mapleGrovePrimaryContactId,
        workType: "gallery_release",
        title: "Release Maple Grove gallery after internal sign-off",
        description: "Production is nearly finished, but color sign-off is still blocking release.",
        ownerUserId: graphicArtist.id,
        status: "blocked",
        stage: "waiting_on_internal",
        priority: "high",
        dueDate: twoDaysOut,
        blockerReason: "Final production approval still pending.",
        waitingOn: "internal_production",
        sourceSystem: "monday",
        sourceReference: "legacy-gallery-release-17",
        generatedByRule: true,
        automationKey: "seed:maple-grove-gallery-release",
        escalationLevel: 1,
        notes: "Waiting on internal production example with transitional Monday attribution.",
        actorUserId: admin.id
      }),
      upsertSchoolWorkItem(client, {
        id: "00000000-0000-0000-0000-000000000506",
        tenantId: tenant.id,
        organizationId: mapleGroveOrganizationId,
        schoolJobId: "00000000-0000-0000-0000-000000000404",
        linkedLocationId: mapleGroveLocationId,
        linkedContactId: mapleGroveOfficeContactId,
        workType: "delivery",
        title: "Bundle Maple Grove office pickup packets",
        description: "Packets are staged and ready for office pickup once the team confirms the handoff window.",
        ownerUserId: office.id,
        status: "open",
        stage: "ready_for_delivery",
        priority: "normal",
        dueDate: todayDate,
        waitingOn: "none",
        notes: "Deliveries-ready example for the weekly schools hub landing page.",
        actorUserId: admin.id
      })
    ]);

    await Promise.all([
      upsertSchoolActivity(client, {
        id: "00000000-0000-0000-0000-000000000601",
        tenantId: tenant.id,
        organizationId: schoolsOrganizationId,
        activityType: "profile_updated",
        summary: "White Bear school profile refreshed for the current school year.",
        detail: "Relationship health and ID packet guidance were confirmed for the 2026-2027 season.",
        actorUserId: admin.id,
        createdAt: addDays(schoolsToday, -2).toISOString()
      }),
      upsertSchoolActivity(client, {
        id: "00000000-0000-0000-0000-000000000602",
        tenantId: tenant.id,
        organizationId: cedarRidgeOrganizationId,
        activityType: "automation_escalated",
        summary: "Cedar Ridge yearbook review escalated after missed proof approval.",
        detail: "The work item stayed overdue without a school response, so the schools team escalation path was activated.",
        actorUserId: schoolsClientSuccess.id,
        createdAt: addDays(schoolsToday, -1).toISOString()
      }),
      upsertSchoolActivity(client, {
        id: "00000000-0000-0000-0000-000000000603",
        tenantId: tenant.id,
        organizationId: mapleGroveOrganizationId,
        activityType: "automation_generated",
        summary: "Maple Grove gallery release work was generated from the internal production trigger.",
        detail: "The bundled delivery reminder stayed linked to the same release job so the handoff remains visible in one place.",
        actorUserId: graphicArtist.id,
        createdAt: addDays(schoolsToday, -1).toISOString()
      })
    ]);

    await upsertResourceLibrarySeedItem(client, {
      tenantId: tenant.id,
      seedKey: "00000000-0000-0000-0000-000000000301",
      organizationId: schoolsOrganizationId,
      locationId: downtownParkLocationId,
      shootId: demoShoot.id,
      uploaderUserId: leadership.id,
      uploaderName: leadership.full_name,
      resourceType: "image",
      category: "prior_successful_example",
      note: "Best Reference framing and backdrop spacing for this school portrait setup.",
      approvalStatus: "approved",
      visibilityScope: "photographer_prep",
      isBestReference: true,
      fileName: "demo-001-best-reference.jpg",
      contentType: "image/jpeg",
      fileSizeBytes: 184320,
      storageKey: "seed/resource-library/demo-001-best-reference.jpg",
      fileUrl: "https://example.test/resource-library/demo-001-best-reference.jpg",
      capturedAt: "2022-03-18T14:00:00.000Z"
    });
    await upsertResourceLibrarySeedItem(client, {
      tenantId: tenant.id,
      seedKey: "00000000-0000-0000-0000-000000000302",
      organizationId: schoolsOrganizationId,
      locationId: downtownParkLocationId,
      shootId: demoShoot.id,
      uploaderUserId: senior.id,
      uploaderName: senior.full_name,
      resourceType: "image",
      category: "setup_photo",
      note: "Current setup reference showing the south curb unload path and riser placement.",
      approvalStatus: "approved",
      visibilityScope: "photographer_prep",
      fileName: "demo-001-setup-photo.jpg",
      contentType: "image/jpeg",
      fileSizeBytes: 142880,
      storageKey: "seed/resource-library/demo-001-setup-photo.jpg",
      fileUrl: "https://example.test/resource-library/demo-001-setup-photo.jpg",
      capturedAt: "2026-03-20T14:15:00.000Z"
    });
    await upsertResourceLibrarySeedItem(client, {
      tenantId: tenant.id,
      seedKey: "00000000-0000-0000-0000-000000000303",
      organizationId: schoolsOrganizationId,
      locationId: downtownParkLocationId,
      uploaderUserId: admin.id,
      uploaderName: admin.full_name,
      resourceType: "document",
      category: "qr_code_job_document",
      note: "QR code packet and check-in sheet for the portrait day.",
      approvalStatus: "approved",
      visibilityScope: "photographer_prep",
      fileName: "demo-001-check-in-qr.pdf",
      contentType: "application/pdf",
      fileSizeBytes: 50412,
      storageKey: "seed/resource-library/demo-001-check-in-qr.pdf",
      fileUrl: "https://example.test/resource-library/demo-001-check-in-qr.pdf",
      capturedAt: "2026-03-19T09:00:00.000Z"
    });
    await upsertResourceLibrarySeedItem(client, {
      tenantId: tenant.id,
      seedKey: "00000000-0000-0000-0000-000000000304",
      organizationId: schoolsOrganizationId,
      locationId: downtownParkLocationId,
      uploaderUserId: leadership.id,
      uploaderName: leadership.full_name,
      resourceType: "image",
      category: "location_reference",
      note: "Recurring Location Intelligence reference for the family staging lane.",
      approvalStatus: "approved",
      visibilityScope: "photographer_prep",
      fileName: "downtown-demo-park-lane-reference.jpg",
      contentType: "image/jpeg",
      fileSizeBytes: 109220,
      storageKey: "seed/resource-library/downtown-demo-park-lane-reference.jpg",
      fileUrl: "https://example.test/resource-library/downtown-demo-park-lane-reference.jpg",
      capturedAt: "2023-03-15T11:00:00.000Z"
    });
    await upsertResourceLibrarySeedItem(client, {
      tenantId: tenant.id,
      seedKey: "00000000-0000-0000-0000-000000000305",
      organizationId: sportsOrganizationId,
      locationId: northMetroLocationId,
      shootId: sportsShoot.id,
      uploaderUserId: leadership.id,
      uploaderName: leadership.full_name,
      resourceType: "image",
      category: "product_example",
      note: "Poster and virtual team product example for the sports media day upsell conversation.",
      approvalStatus: "approved",
      visibilityScope: "photographer_prep",
      fileName: "demo-002-product-example.jpg",
      contentType: "image/jpeg",
      fileSizeBytes: 156000,
      storageKey: "seed/resource-library/demo-002-product-example.jpg",
      fileUrl: "https://example.test/resource-library/demo-002-product-example.jpg",
      capturedAt: "2025-08-11T16:30:00.000Z"
    });

    await client.query(
      `
        INSERT INTO alert_rule (tenant_id, code, minutes_after)
        VALUES
          ($1, 'LATE_CLOCK_IN', 10),
          ($1, 'MISSING_SETUP_COMPLETE', 30),
          ($1, 'MISSING_SHOOTING_STARTED', 45),
          ($1, 'MISSING_SETUP_PHOTO', 120),
          ($1, 'OUTSIDE_GEOFENCE', 0)
        ON CONFLICT (tenant_id, code) DO UPDATE SET minutes_after = EXCLUDED.minutes_after, enabled = true
      `,
      [tenant.id]
    );

    const portraitTemplate = (
      await client.query(
        `
          INSERT INTO staffing_template (
            tenant_id, department, name, description, planned_staff_count, required_lead_count, created_by_user_id
          )
          VALUES ($1, 'schools', 'Portrait Lead + 2 Shooters', 'Standard school portrait coverage with one lead and two shooters.', 3, 1, $2)
          RETURNING *
        `,
        [tenant.id, leadership.id]
      )
    ).rows[0];
    for (const [index, role] of [
      { staffingRole: "senior_photographer", label: "Senior lead", headcount: 1, satisfiesLeadCoverage: true },
      { staffingRole: "photographer", label: "Photographer", headcount: 2, satisfiesLeadCoverage: false }
    ].entries()) {
      await client.query(
        `
          INSERT INTO staffing_template_role (
            tenant_id, staffing_template_id, staffing_role, label, headcount, satisfies_lead_coverage, sort_order
          )
          VALUES ($1,$2,$3::staffing_role_code,$4,$5,$6,$7)
        `,
        [tenant.id, portraitTemplate.id, role.staffingRole, role.label, role.headcount, role.satisfiesLeadCoverage, index]
      );
    }

    const sportsTemplate = (
      await client.query(
        `
          INSERT INTO staffing_template (
            tenant_id, department, name, description, planned_staff_count, required_lead_count, created_by_user_id
          )
          VALUES ($1, 'sports', 'Media Day Lead + 2 Shooters + Check-In', 'Standard sports media day staffing pattern.', 4, 1, $2)
          RETURNING *
        `,
        [tenant.id, leadership.id]
      )
    ).rows[0];
    for (const [index, role] of [
      { staffingRole: "senior_photographer", label: "Senior lead", headcount: 1, satisfiesLeadCoverage: true },
      { staffingRole: "photographer", label: "Photographer", headcount: 2, satisfiesLeadCoverage: false },
      { staffingRole: "check_in", label: "Check-in support", headcount: 1, satisfiesLeadCoverage: false }
    ].entries()) {
      await client.query(
        `
          INSERT INTO staffing_template_role (
            tenant_id, staffing_template_id, staffing_role, label, headcount, satisfies_lead_coverage, sort_order
          )
          VALUES ($1,$2,$3::staffing_role_code,$4,$5,$6,$7)
        `,
        [tenant.id, sportsTemplate.id, role.staffingRole, role.label, role.headcount, role.satisfiesLeadCoverage, index]
      );
    }

    const largeVolumeTemplate = (
      await client.query(
        `
          INSERT INTO staffing_template (
            tenant_id, department, name, description, planned_staff_count, required_lead_count, created_by_user_id
          )
          VALUES ($1, 'schools', 'Large Volume Senior + 4 Shooters + Check-In', 'High-volume school pattern with one senior lead, four shooters, and check-in support.', 6, 1, $2)
          RETURNING *
        `,
        [tenant.id, leadership.id]
      )
    ).rows[0];
    for (const [index, role] of [
      { staffingRole: "senior_photographer", label: "Senior lead", headcount: 1, satisfiesLeadCoverage: true },
      { staffingRole: "photographer", label: "Photographer", headcount: 4, satisfiesLeadCoverage: false },
      { staffingRole: "check_in", label: "Check-in support", headcount: 1, satisfiesLeadCoverage: false }
    ].entries()) {
      await client.query(
        `
          INSERT INTO staffing_template_role (
            tenant_id, staffing_template_id, staffing_role, label, headcount, satisfies_lead_coverage, sort_order
          )
          VALUES ($1,$2,$3::staffing_role_code,$4,$5,$6,$7)
        `,
        [tenant.id, largeVolumeTemplate.id, role.staffingRole, role.label, role.headcount, role.satisfiesLeadCoverage, index]
      );
    }

    await client.query(
      `
        UPDATE shoot
        SET staffing_template_id = CASE
              WHEN id = $2 THEN $4
              WHEN id = $3 THEN $5
              ELSE staffing_template_id
            END
        WHERE tenant_id = $1
          AND id IN ($2, $3)
      `,
      [tenant.id, demoShoot.id, sportsShoot.id, portraitTemplate.id, sportsTemplate.id]
    );

    for (const event of [
      {
        department: "operations",
        eventKind: "meeting",
        title: "Daily Ops Huddle",
        startsAt: localTodayAt(8, 15),
        endsAt: localTodayAt(8, 45),
        locationName: "Main Studio",
        locationAddress: studioLocation.address,
        locationLat: studioLocation.latitude,
        locationLng: studioLocation.longitude,
        leadUserId: leadership.id,
        notes: "Morning leadership huddle for staffing risks and late attendance review.",
        linkedShootId: null
      },
      {
        department: "schools",
        eventKind: "operations",
        title: "School Shoot Staffing Review",
        startsAt: addMinutes(mainShootArrival, -120),
        endsAt: addMinutes(mainShootArrival, -75),
        locationName: "Main Studio War Room",
        locationAddress: studioLocation.address,
        locationLat: studioLocation.latitude,
        locationLng: studioLocation.longitude,
        leadUserId: admin.id,
        notes: "Last staffing and attendance review before the school shoot goes live.",
        linkedShootId: demoShoot.id
      },
      {
        department: "sports",
        eventKind: "travel",
        title: "North Metro Stadium Travel Window",
        startsAt: addMinutes(secondShootArrival, -15),
        endsAt: secondShootArrival,
        locationName: sportsShoot.location_name,
        locationAddress: sportsShoot.location_address,
        locationLat: sportsShoot.location_lat,
        locationLng: sportsShoot.location_lng,
        leadUserId: senior.id,
        notes: "Travel lane stays visible so leadership sees when the sports crew should already be moving.",
        linkedShootId: sportsShoot.id
      }
    ] as const) {
      await client.query(
        `
          INSERT INTO schedule_event (
            tenant_id, studio_id, department, event_kind, status, title, starts_at, ends_at, location_name, location_address,
            location_lat, location_lng, navigation_url, lead_user_id, notes, linked_shoot_id, sync_required, sync_state,
            created_by_user_id, updated_by_user_id
          )
          VALUES ($1,$2,$3::department_code,$4::schedule_event_kind,'scheduled',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false,'not_linked',$16,$16)
        `,
        [
          tenant.id,
          studio.id,
          event.department,
          event.eventKind,
          event.title,
          event.startsAt,
          event.endsAt,
          event.locationName,
          event.locationAddress,
          event.locationLat,
          event.locationLng,
          buildGoogleMapsLink({
            latitude: event.locationLat ?? null,
            longitude: event.locationLng ?? null,
            address: event.locationAddress,
            label: event.locationName
          }),
          event.leadUserId,
          event.notes,
          event.linkedShootId,
          leadership.id
        ]
      );
    }

    for (const [eventCode, roleCode, department] of [
      ["attendance.pre_shift_reminder", "associate_photographer", null],
      ["attendance.pre_shift_reminder", "photographer", null],
      ["attendance.early_clock_in", "leadership", null],
      ["attendance.early_clock_in", "senior_photographer", "schools"],
      ["attendance.early_clock_in_critical", "leadership", null],
      ["attendance.unscheduled_punch", "leadership", null],
      ["attendance.outside_geofence", "leadership", null],
      ["attendance.clock_in_reminder", "associate_photographer", null],
      ["attendance.clock_in_reminder", "photographer", null],
      ["attendance.late_manager_alert", "leadership", null],
      ["attendance.late_clock_in", "leadership", null],
      ["attendance.missed_clock_in", "leadership", null],
      ["attendance.no_show_suspected", "leadership", null],
      ["attendance.staffing_risk_prestart", "leadership", "schools"],
      ["attendance.staffing_risk_prestart", "leadership", "sports"],
      ["attendance.missed_punch_requested", "senior_photographer", null],
      ["attendance.auto_closed", "leadership", null],
      ["attendance.exception_requested", "senior_photographer", null],
      ["schedule.shift_changed", "leadership", null],
      ["schedule.shift_published", "associate_photographer", null],
      ["schedule.shift_published", "photographer", null],
      ["schedule.trade_requested", "leadership", null],
      ["schedule.pto_requested", "admin", null],
      ["shoot.closeout_missing_setup_photo", "leadership", null],
      ["shoot.closeout_missing_post_shoot_evaluation", "leadership", null]
    ] as const) {
      await client.query(
        `
          INSERT INTO notification_routing_rule (tenant_id, event_code, role_code, department, enabled)
          VALUES ($1,$2,$3,$4,true)
          ON CONFLICT (tenant_id, event_code, role_code, department)
          DO UPDATE SET enabled = true
        `,
        [tenant.id, eventCode, roleCode, department]
      );
    }

    const photoShift = await insertShift(client, tenant.id, {
      shootId: demoShoot.id,
      studioId: studio.id,
      assignedUserId: photographer.id,
      managerUserId: senior.id,
      createdByUserId: leadership.id,
      publishedByUserId: leadership.id,
      shiftKind: "shoot",
      status: "published",
      department: "schools",
      staffingRole: "photographer",
      satisfiesLeadCoverage: false,
      title: "DEMO-001 Primary Photographer",
      startsAt: addMinutes(mainShootStart, -45),
      endsAt: addMinutes(mainShootEnd, 45),
      locationName: demoShoot.location_name,
      locationAddress: demoShoot.location_address,
      locationLat: demoShoot.location_lat,
      locationLng: demoShoot.location_lng,
      geofenceRadiusMeters: demoShoot.geofence_radius_meters,
      notes: "Includes prep, travel, shoot, and wrap time.",
      segments: [
        {
          segmentKind: "studio_prep",
          label: "Studio load and prep",
          startsAt: addMinutes(mainShootStart, -45),
          endsAt: addMinutes(mainShootStart, -25),
          rateCode: "studio_prep",
          hourlyRateCents: 2200
        },
        {
          segmentKind: "travel",
          label: "Travel to location",
          startsAt: addMinutes(mainShootStart, -25),
          endsAt: mainShootStart,
          rateCode: "travel",
          hourlyRateCents: 1800
        },
        {
          segmentKind: "shoot",
          label: "Shoot coverage",
          startsAt: mainShootStart,
          endsAt: mainShootEnd,
          rateCode: "shoot",
          hourlyRateCents: 2600
        },
        {
          segmentKind: "studio_wrap",
          label: "Studio return and unload",
          startsAt: mainShootEnd,
          endsAt: addMinutes(mainShootEnd, 45),
          rateCode: "studio_wrap",
          hourlyRateCents: 2200
        }
      ]
    });

    const seniorShift = await insertShift(client, tenant.id, {
      shootId: demoShoot.id,
      studioId: studio.id,
      assignedUserId: senior.id,
      managerUserId: leadership.id,
      createdByUserId: leadership.id,
      publishedByUserId: leadership.id,
      shiftKind: "shoot",
      status: "published",
      department: "schools",
      staffingRole: "senior_photographer",
      satisfiesLeadCoverage: true,
      title: "DEMO-001 Senior Lead",
      startsAt: addMinutes(mainShootStart, -60),
      endsAt: addMinutes(mainShootEnd, 30),
      locationName: demoShoot.location_name,
      locationAddress: demoShoot.location_address,
      locationLat: demoShoot.location_lat,
      locationLng: demoShoot.location_lng,
      geofenceRadiusMeters: demoShoot.geofence_radius_meters,
      notes: "On-site lead and attendance approver for same-day issues.",
      segments: [
        {
          segmentKind: "travel",
          label: "Lead travel",
          startsAt: addMinutes(mainShootStart, -60),
          endsAt: addMinutes(mainShootStart, -15),
          rateCode: "lead_travel",
          hourlyRateCents: 2100
        },
        {
          segmentKind: "shoot",
          label: "Lead coverage",
          startsAt: addMinutes(mainShootStart, -15),
          endsAt: addMinutes(mainShootEnd, 15),
          rateCode: "lead_shoot",
          hourlyRateCents: 3000
        },
        {
          segmentKind: "studio_wrap",
          label: "Lead wrap",
          startsAt: addMinutes(mainShootEnd, 15),
          endsAt: addMinutes(mainShootEnd, 30),
          rateCode: "lead_wrap",
          hourlyRateCents: 2400
        }
      ]
    });

    const associateShift = await insertShift(client, tenant.id, {
      shootId: sportsShoot.id,
      studioId: studio.id,
      assignedUserId: associate.id,
      managerUserId: senior.id,
      createdByUserId: leadership.id,
      publishedByUserId: leadership.id,
      shiftKind: "shoot",
      status: "published",
      department: "sports",
      staffingRole: "photographer",
      satisfiesLeadCoverage: false,
      title: "DEMO-002 Associate Coverage",
      startsAt: addMinutes(secondShootStart, -30),
      endsAt: addMinutes(secondShootEnd, 30),
      locationName: sportsShoot.location_name,
      locationAddress: sportsShoot.location_address,
      locationLat: sportsShoot.location_lat,
      locationLng: sportsShoot.location_lng,
      geofenceRadiusMeters: sportsShoot.geofence_radius_meters,
      notes: "Published sports coverage shift.",
      segments: [
        {
          segmentKind: "travel",
          label: "Travel to stadium",
          startsAt: addMinutes(secondShootStart, -30),
          endsAt: secondShootStart,
          rateCode: "travel",
          hourlyRateCents: 1800
        },
        {
          segmentKind: "shoot",
          label: "Sports portrait coverage",
          startsAt: secondShootStart,
          endsAt: secondShootEnd,
          rateCode: "shoot",
          hourlyRateCents: 2400
        },
        {
          segmentKind: "travel",
          label: "Return travel",
          startsAt: secondShootEnd,
          endsAt: addMinutes(secondShootEnd, 30),
          rateCode: "travel",
          hourlyRateCents: 1800
        }
      ]
    });

    const officeShift = await insertShift(client, tenant.id, {
      studioId: studio.id,
      assignedUserId: office.id,
      managerUserId: admin.id,
      createdByUserId: leadership.id,
      publishedByUserId: leadership.id,
      shiftKind: "office",
      status: "published",
      department: "office",
      title: "Studio Office Desk",
      startsAt: localTodayAt(9, 0),
      endsAt: localTodayAt(17, 0),
      locationName: "Main Studio",
      locationAddress: studioLocation.address,
      locationLat: studioLocation.latitude,
      locationLng: studioLocation.longitude,
      geofenceRadiusMeters: studioLocation.geofenceRadiusMeters,
      notes: "Front office coverage at the studio.",
      segments: [
        {
          segmentKind: "office",
          label: "Office coverage",
          startsAt: localTodayAt(9, 0),
          endsAt: localTodayAt(17, 0),
          rateCode: "office",
          hourlyRateCents: 2000
        }
      ]
    });

    const trainingShift = await insertShift(client, tenant.id, {
      studioId: studio.id,
      assignedUserId: associate.id,
      managerUserId: leadership.id,
      createdByUserId: leadership.id,
      publishedByUserId: null,
      shiftKind: "training",
      status: "draft",
      department: "sports",
      title: "Lighting Training Block",
      startsAt: localTodayAt(10, 30),
      endsAt: localTodayAt(12, 0),
      locationName: "Main Studio",
      locationAddress: studioLocation.address,
      locationLat: studioLocation.latitude,
      locationLng: studioLocation.longitude,
      geofenceRadiusMeters: studioLocation.geofenceRadiusMeters,
      notes: "Draft training block waiting for leadership publish.",
      segments: [
        {
          segmentKind: "training",
          label: "Training session",
          startsAt: localTodayAt(10, 30),
          endsAt: localTodayAt(12, 0),
          rateCode: "training",
          hourlyRateCents: 1900
        }
      ]
    });

    const seniorClockIn = await insertShootStatusEvent(
      client,
      tenant.id,
      demoShoot.id,
      senior.id,
      "CLOCK_IN",
      addMinutes(mainShootStart, -20),
      "inside",
      { shift_id: seniorShift.id, source: "seed" }
    );
    const seniorClockOut = await insertShootStatusEvent(
      client,
      tenant.id,
      demoShoot.id,
      senior.id,
      "CLOCK_OUT",
      addMinutes(mainShootEnd, 10),
      "inside",
      { shift_id: seniorShift.id, source: "seed" }
    );

    await insertPunch(client, {
      tenantId: tenant.id,
      shiftId: seniorShift.id,
      shootId: demoShoot.id,
      userId: senior.id,
      direction: "in",
      clientTimestamp: addMinutes(mainShootStart, -20),
      geofenceStatus: "inside",
      gpsConfidence: "normal",
      statusEventId: seniorClockIn.id
    });
    await insertPunch(client, {
      tenantId: tenant.id,
      shiftId: seniorShift.id,
      shootId: demoShoot.id,
      userId: senior.id,
      direction: "out",
      clientTimestamp: addMinutes(mainShootEnd, 10),
      geofenceStatus: "inside",
      gpsConfidence: "normal",
      statusEventId: seniorClockOut.id
    });

    await client.query(
      `
        INSERT INTO time_entry (
          tenant_id, shift_id, shoot_id, user_id, clock_in_event_id, clock_in_at, clock_out_event_id, clock_out_at,
          minutes_worked, scheduled_minutes, gross_minutes, break_deduction_minutes, break_deduction_applied,
          break_deduction_source, payable_minutes, approved_payable_minutes, attendance_state, payroll_state
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,false,'none',$11,$11,'clocked_out','ready')
      `,
      [tenant.id, seniorShift.id, demoShoot.id, senior.id, seniorClockIn.id, seniorClockIn.captured_at, seniorClockOut.id, seniorClockOut.captured_at, 150, 150, 150]
    );

    const officePunchIn = await insertPunch(client, {
      tenantId: tenant.id,
      shiftId: officeShift.id,
      userId: office.id,
      direction: "in",
      clientTimestamp: localTodayAt(8, 58),
      geofenceStatus: "inside",
      gpsConfidence: "normal"
    });
    await insertPunch(client, {
      tenantId: tenant.id,
      shiftId: officeShift.id,
      userId: office.id,
      direction: "out",
      clientTimestamp: localTodayAt(17, 3),
      geofenceStatus: "inside",
      gpsConfidence: "normal",
      notes: `Paired with ${officePunchIn.id}`
    });

    const lateNotice = (
      await client.query(
        `
          INSERT INTO attendance_exception (
            tenant_id, shift_id, shoot_id, user_id, exception_type, status, severity, classification, reason_code, notes, requested_approver_user_id
          )
          VALUES ($1,$2,$3,$4,'RUNNING_LATE_NOTICE','open','high','late','running_late','Associate reported a delayed arrival to the stadium.',$5)
          RETURNING *
        `,
        [tenant.id, associateShift.id, sportsShoot.id, associate.id, senior.id]
      )
    ).rows[0];

    await client.query(
      `
        INSERT INTO shift_trade_request (
          tenant_id, shift_id, requester_user_id, requested_with_user_id, reason, status, same_day_exception_eligible
        )
        VALUES ($1,$2,$3,$4,$5,'pending',true)
      `,
      [tenant.id, photoShift.id, photographer.id, associate.id, "Need coverage swap for a family obligation."]
    );

    await client.query(
      `
        INSERT INTO pto_request (
          tenant_id,
          user_id,
          department,
          starts_on,
          ends_on,
          partial_day,
          reason,
          status,
          request_type,
          all_day,
          submitted_at
        )
        VALUES (
          $1,
          $2,
          'office',
          CURRENT_DATE + 7,
          CURRENT_DATE + 8,
          false,
          'Requested time away for family travel.',
          'submitted',
          'multi_day_off',
          true,
          now()
        )
      `,
      [tenant.id, office.id]
    );

    await client.query(
      `
        INSERT INTO ops_notification (
          tenant_id, recipient_user_id, related_user_id, shift_id, shoot_id, attendance_exception_id,
          notification_type, channel, priority, status, title, body, deep_link, metadata, sent_at, group_key
        )
        VALUES
          (
            $1,$2,$3,$4,$5,NULL,
            'schedule.shift_published','in_app','high','sent',
            'Published shift for DEMO-001',
            'Your Demo Senior Session shift was published with travel and studio segments.',
            $6,'{}'::jsonb, now(),'schedule.shift_published:seed-demo-001'
          ),
          (
            $1,$3,$2,$7,$8,$9,
            'attendance.running_late_notice','in_app','high','sent',
            'Associate running late',
            'Associate Coverage reported a same-day delay for DEMO-002 and needs review.',
            $10,'{}'::jsonb, now(),'attendance.running_late_notice:seed-demo-002'
          )
      `,
      [
        tenant.id,
        photographer.id,
        senior.id,
        photoShift.id,
        demoShoot.id,
        `/shifts/${photoShift.id}`,
        associateShift.id,
        sportsShoot.id,
        lateNotice.id,
        `/attendance/shifts/${associateShift.id}`
      ]
    );

    await seedTrainingState(client, tenant.id);

    await client.query("COMMIT");
    console.log(
      JSON.stringify(
        {
          tenant,
          seed_reused_existing_demo_tenant: existingDemoTenants.rows.length > 0,
          duplicate_demo_tenants_detected: Math.max(existingDemoTenants.rows.length - 1, 0),
          studio,
          owner_admin: { email: matthew.email, password: LOCAL_DEMO_PASSWORD },
          admin: { email: admin.email, password: LOCAL_DEMO_PASSWORD },
          leadership: { email: leadership.email, password: LOCAL_DEMO_PASSWORD },
          senior_photographer: { email: senior.email, password: LOCAL_DEMO_PASSWORD },
          photographer: { email: photographer.email, password: LOCAL_DEMO_PASSWORD },
          associate_photographer: { email: associate.email, password: LOCAL_DEMO_PASSWORD },
          office_employee: { email: office.email, password: LOCAL_DEMO_PASSWORD },
          schools_client_success: { email: schoolsClientSuccess.email, password: LOCAL_DEMO_PASSWORD },
          sports_client_success: { email: sportsClientSuccess.email, password: LOCAL_DEMO_PASSWORD },
          graphic_artist: { email: graphicArtist.email, password: LOCAL_DEMO_PASSWORD },
          new_hire: { email: newHire.email, password: LOCAL_DEMO_PASSWORD },
          pending_approval: { email: pending.email, password: LOCAL_DEMO_PASSWORD },
          suspended: { email: suspended.email, password: LOCAL_DEMO_PASSWORD },
          outstanding_invite: { email: "invitee@example.com", invite_token: outstandingInviteToken },
          shoots: [
            { code: demoShoot.shoot_code, title: demoShoot.title },
            { code: sportsShoot.shoot_code, title: sportsShoot.title }
          ],
          seeded_shift_titles: [photoShift.title, seniorShift.title, associateShift.title, officeShift.title, trainingShift.title]
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
