import type { PoolClient } from "pg";
import { pool } from "../db.js";

const DEFAULT_PRE_SHOOT_COORDINATION_DAYS = 21;
const DEFAULT_CONFIRMATION_ESCALATION_DAYS = 14;
const DEFAULT_NO_RESPONSE_FOLLOW_UP_DAYS = 3;
const DEFAULT_DELIVERY_BUNDLE_THRESHOLD = 2;

type SchoolAutomationConfig = {
  preShootCoordinationDays: number;
  confirmationEscalationDays: number;
  noResponseFollowUpDays: number;
  deliveryBundleThreshold: number;
  bundleDeliveriesEnabled: boolean;
  subjectDirectoryRequired: boolean;
  subjectDirectoryCount: number | null;
  yearbookEnabled: boolean;
};

type SchoolRuleRow = {
  organization_id: string;
  rule_type: string;
  structured_value: unknown;
};

type SchoolContextRow = {
  organization_id: string;
  school_name: string;
  primary_location_id: string | null;
  primary_internal_owner_user_id: string | null;
  backup_internal_owner_user_id: string | null;
};

type PreShootCandidateRow = {
  school_job_id: string;
  organization_id: string;
  school_name: string;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  owner_user_id: string | null;
  primary_internal_owner_user_id: string | null;
  backup_internal_owner_user_id: string | null;
  job_title: string;
  effective_event_date: string | null;
  has_completed_confirmation: boolean;
  has_logged_confirmation: boolean;
};

type PreShootFollowUpCandidateRow = {
  touchpoint_plan_id: string;
  organization_id: string;
  school_name: string;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  school_job_id: string | null;
  owner_user_id: string | null;
  primary_internal_owner_user_id: string | null;
  backup_internal_owner_user_id: string | null;
  title: string;
  summary: string | null;
  due_at: string;
  effective_event_date: string | null;
  has_response: boolean;
};

type GalleryCandidateRow = {
  project_id: string;
  organization_id: string;
  school_name: string;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  school_job_id: string | null;
  school_job_title: string | null;
  owner_user_id: string | null;
  primary_internal_owner_user_id: string | null;
  backup_internal_owner_user_id: string | null;
  project_title: string;
  project_summary: string | null;
  due_date: string | null;
  stage: string;
  status: string;
  release_state: string;
  blocker_reason: string | null;
};

type DeliveryBundleRow = {
  organization_id: string;
  school_name: string;
  owner_user_id: string | null;
  primary_internal_owner_user_id: string | null;
  backup_internal_owner_user_id: string | null;
  pending_delivery_count: string | number;
  earliest_due_date: string | null;
  titles: string[] | null;
};

type ExistingAutomationWorkRow = {
  id: string;
  organization_id: string;
  title: string;
  status: string;
  stage: string;
  priority: string;
  due_date: string | null;
  sla_date: string | null;
  blocker_reason: string | null;
  waiting_on: string;
  notes: string | null;
  owner_user_id: string | null;
  completed_at: string | null;
  escalation_level: number;
};

type EnsureGeneratedWorkInput = {
  tenantId: string;
  organizationId: string;
  schoolJobId?: string | null;
  linkedShootId?: string | null;
  linkedLocationId?: string | null;
  linkedContactId?: string | null;
  linkedProductionProjectId?: string | null;
  workType:
    | "pre_shoot_coordination"
    | "gallery_release"
    | "id_production"
    | "admin_item"
    | "yearbook"
    | "delivery"
    | "follow_up"
    | "exception_handling";
  title: string;
  description?: string | null;
  ownerUserId?: string | null;
  status: "open" | "in_progress" | "waiting" | "blocked" | "completed" | "cancelled";
  stage: "intake" | "planning" | "active" | "waiting_on_school" | "waiting_on_internal" | "ready_for_delivery" | "done";
  priority: "low" | "normal" | "high" | "critical";
  dueDate?: string | null;
  slaDate?: string | null;
  blockerReason?: string | null;
  waitingOn?: "none" | "school" | "internal_production" | "internal_ops" | "shipping_vendor" | "billing" | "other";
  sourceSystem?: "mission_control" | "monday" | "manual_import" | "zendesk" | "outlook" | "other";
  sourceReference?: string | null;
  notes?: string | null;
  automationKey: string;
  escalationLevel?: number;
  preserveUserState?: boolean;
};

type ManualUploadTriggerPayload = {
  organization_id: string;
  school_job_id?: string | null;
  linked_shoot_id?: string | null;
  linked_location_id?: string | null;
  linked_production_project_id?: string | null;
  trigger_type: "id_upload_received" | "gallery_deadline_set" | "final_retake_upload_completed";
  deadline_date?: string | null;
  source_system?: "mission_control" | "monday" | "manual_import" | "zendesk" | "outlook" | "other";
  source_reference?: string | null;
  note?: string | null;
  initiated_by_user_id?: string | null;
};

type ManualYearbookTriggerPayload = {
  organization_id: string;
  school_job_id?: string | null;
  linked_shoot_id?: string | null;
  linked_location_id?: string | null;
  request_type: "yearbook_request_received" | "yearbook_review_requested";
  deadline_date?: string | null;
  source_system?: "mission_control" | "monday" | "manual_import" | "zendesk" | "outlook" | "other";
  source_reference?: string | null;
  note?: string | null;
  initiated_by_user_id?: string | null;
};

type ManualDeliverableTriggerPayload = {
  organization_id: string;
  school_job_id?: string | null;
  linked_shoot_id?: string | null;
  linked_location_id?: string | null;
  deliverable_type: "yearbooks_arrived" | "admin_items_arrived" | "other_deliverable_arrived";
  arrived_on?: string | null;
  ready_date?: string | null;
  source_system?: "mission_control" | "monday" | "manual_import" | "zendesk" | "outlook" | "other";
  source_reference?: string | null;
  note?: string | null;
  initiated_by_user_id?: string | null;
};

export async function runSchoolsHubAutomationForTenant(client: PoolClient, tenantId: string, now = new Date()) {
  const today = formatDate(now);
  const configMap = await loadSchoolAutomationConfigMap(client, tenantId);

  await generatePreShootCoordinationWork(client, tenantId, today, configMap);
  await generatePreShootEscalations(client, tenantId, today, configMap);
  await generatePreShootNoResponseFollowUps(client, tenantId, today, configMap);
  await syncGalleryDueWork(client, tenantId, today);
  await generateDeliveryBundleSuggestions(client, tenantId, today, configMap);
}

export async function handleSchoolsHubUploadTrigger(client: PoolClient, tenantId: string, payload: Record<string, unknown>) {
  const input = payload as ManualUploadTriggerPayload;
  if (!input.organization_id || !input.trigger_type) {
    return;
  }

  const school = await loadSchoolContext(client, tenantId, input.organization_id);
  if (!school) {
    return;
  }

  const configMap = await loadSchoolAutomationConfigMap(client, tenantId);
  const config = configMap.get(input.organization_id) ?? defaultSchoolAutomationConfig();
  const sourceReference =
    normalizeText(input.source_reference) ?? buildFallbackTriggerReference("upload", input.organization_id, input.trigger_type, input.deadline_date ?? null);

  const job =
    (await ensureAutomationJob(client, {
      tenantId,
      organizationId: input.organization_id,
      schoolJobId: input.school_job_id ?? null,
      linkedShootId: input.linked_shoot_id ?? null,
      linkedLocationId: input.linked_location_id ?? school.primary_location_id,
      jobType:
        input.trigger_type === "id_upload_received"
          ? "ids"
          : input.trigger_type === "final_retake_upload_completed"
            ? "retakes"
            : "delivery",
      title:
        input.trigger_type === "id_upload_received"
          ? `${school.school_name} ID workflow`
          : input.trigger_type === "final_retake_upload_completed"
            ? `${school.school_name} retake follow-through`
            : `${school.school_name} gallery delivery`,
      eventDate: input.deadline_date ?? null,
      dueDate: input.deadline_date ?? null,
      ownerUserId: school.primary_internal_owner_user_id ?? school.backup_internal_owner_user_id ?? null,
      sourceSystem: input.source_system ?? "other",
      sourceReference,
      notes: normalizeText(input.note)
    })) ?? null;

  if (input.trigger_type === "id_upload_received") {
    const work = await ensureGeneratedWorkItem(client, {
      tenantId,
      organizationId: input.organization_id,
      schoolJobId: job?.id ?? input.school_job_id ?? null,
      linkedShootId: input.linked_shoot_id ?? null,
      linkedLocationId: input.linked_location_id ?? school.primary_location_id,
      linkedProductionProjectId: input.linked_production_project_id ?? null,
      workType: "id_production",
      title: `Start ID workflow for ${school.school_name}`,
      description: normalizeText(input.note) ?? "Upload completed and the school ID workflow is ready to start.",
      ownerUserId: school.primary_internal_owner_user_id ?? school.backup_internal_owner_user_id ?? null,
      status: "open",
      stage: "active",
      priority: "high",
      dueDate: input.deadline_date ?? addDays(formatDate(new Date()), 2),
      slaDate: input.deadline_date ?? null,
      waitingOn: "none",
      sourceSystem: input.source_system ?? "other",
      sourceReference,
      notes: "Triggered from upload-state automation.",
      automationKey: `schools_hub:upload:id:${sourceReference}`,
      preserveUserState: true
    });
    await appendSchoolActivityLog(client, {
      tenantId,
      organizationId: input.organization_id,
      activityType: "automation_trigger_received",
      summary: `ID workflow trigger received for ${school.school_name}.`,
      detail: `Trigger type: ${input.trigger_type}`,
      metadata: { work_item_id: work.id, source_reference: sourceReference, trigger_type: input.trigger_type },
      actorUserId: input.initiated_by_user_id ?? null
    });
    return;
  }

  if (input.trigger_type === "gallery_deadline_set") {
    const work = await ensureGeneratedWorkItem(client, {
      tenantId,
      organizationId: input.organization_id,
      schoolJobId: job?.id ?? input.school_job_id ?? null,
      linkedShootId: input.linked_shoot_id ?? null,
      linkedLocationId: input.linked_location_id ?? school.primary_location_id,
      linkedProductionProjectId: input.linked_production_project_id ?? null,
      workType: "gallery_release",
      title: `Release gallery for ${school.school_name}`,
      description: normalizeText(input.note) ?? "Gallery deadline entered and release work should stay visible.",
      ownerUserId: school.primary_internal_owner_user_id ?? school.backup_internal_owner_user_id ?? null,
      status: "waiting",
      stage: "waiting_on_internal",
      priority: "high",
      dueDate: input.deadline_date ?? addDays(formatDate(new Date()), 3),
      slaDate: input.deadline_date ?? null,
      waitingOn: "internal_production",
      sourceSystem: input.source_system ?? "other",
      sourceReference,
      notes: "Triggered from gallery-deadline automation.",
      automationKey: `schools_hub:upload:gallery:${sourceReference}`,
      preserveUserState: false
    });
    await appendSchoolActivityLog(client, {
      tenantId,
      organizationId: input.organization_id,
      activityType: "automation_trigger_received",
      summary: `Gallery deadline trigger received for ${school.school_name}.`,
      detail: `Trigger type: ${input.trigger_type}`,
      metadata: { work_item_id: work.id, source_reference: sourceReference, trigger_type: input.trigger_type },
      actorUserId: input.initiated_by_user_id ?? null
    });
    return;
  }

  if (!config.subjectDirectoryRequired) {
    await appendSchoolActivityLog(client, {
      tenantId,
      organizationId: input.organization_id,
      activityType: "automation_trigger_received",
      summary: `Retake upload trigger received, but subject-directory work is not enabled for ${school.school_name}.`,
      detail: normalizeText(input.note),
      metadata: { source_reference: sourceReference, trigger_type: input.trigger_type },
      actorUserId: input.initiated_by_user_id ?? null
    });
    return;
  }

  const subjectDirectoryCountLabel =
    typeof config.subjectDirectoryCount === "number" && Number.isFinite(config.subjectDirectoryCount)
      ? ` Target count: ${config.subjectDirectoryCount}.`
      : "";

  const work = await ensureGeneratedWorkItem(client, {
    tenantId,
    organizationId: input.organization_id,
    schoolJobId: job?.id ?? input.school_job_id ?? null,
    linkedShootId: input.linked_shoot_id ?? null,
    linkedLocationId: input.linked_location_id ?? school.primary_location_id,
    workType: "admin_item",
    title: `Prepare subject directory for ${school.school_name}`,
    description:
      (normalizeText(input.note) ?? "Final retake upload completed and the school rule requires subject-directory follow-through.") +
      subjectDirectoryCountLabel,
    ownerUserId: school.primary_internal_owner_user_id ?? school.backup_internal_owner_user_id ?? null,
    status: "open",
    stage: "active",
    priority: "high",
    dueDate: input.deadline_date ?? addDays(formatDate(new Date()), 2),
    slaDate: input.deadline_date ?? null,
    waitingOn: "none",
    sourceSystem: input.source_system ?? "other",
    sourceReference,
    notes: "Triggered because the school rules require subject-directory output after final retake upload.",
    automationKey: `schools_hub:upload:subject_directory:${sourceReference}`,
    preserveUserState: true
  });

  await appendSchoolActivityLog(client, {
    tenantId,
    organizationId: input.organization_id,
    activityType: "automation_trigger_received",
    summary: `Subject-directory trigger received for ${school.school_name}.`,
    detail: `Final retake upload completed.`,
    metadata: { work_item_id: work.id, source_reference: sourceReference, trigger_type: input.trigger_type },
    actorUserId: input.initiated_by_user_id ?? null
  });
}

export async function handleSchoolsHubYearbookTrigger(client: PoolClient, tenantId: string, payload: Record<string, unknown>) {
  const input = payload as ManualYearbookTriggerPayload;
  if (!input.organization_id || !input.request_type) {
    return;
  }

  const school = await loadSchoolContext(client, tenantId, input.organization_id);
  if (!school) {
    return;
  }

  const sourceReference =
    normalizeText(input.source_reference) ?? buildFallbackTriggerReference("yearbook", input.organization_id, input.request_type, input.deadline_date ?? null);
  const configMap = await loadSchoolAutomationConfigMap(client, tenantId);
  const config = configMap.get(input.organization_id) ?? defaultSchoolAutomationConfig();

  const job =
    (await ensureAutomationJob(client, {
      tenantId,
      organizationId: input.organization_id,
      schoolJobId: input.school_job_id ?? null,
      linkedShootId: input.linked_shoot_id ?? null,
      linkedLocationId: input.linked_location_id ?? school.primary_location_id,
      jobType: "yearbook",
      title: `${school.school_name} yearbook`,
      eventDate: input.deadline_date ?? null,
      dueDate: input.deadline_date ?? null,
      ownerUserId: school.primary_internal_owner_user_id ?? school.backup_internal_owner_user_id ?? null,
      sourceSystem: input.source_system ?? "other",
      sourceReference,
      notes: normalizeText(input.note)
    })) ?? null;

  const detailNote =
    normalizeText(input.note) ??
    (config.yearbookEnabled
      ? "Yearbook participation is already enabled for this school."
      : "Yearbook work was requested even though the school profile does not yet mark yearbook participation.");

  const work = await ensureGeneratedWorkItem(client, {
    tenantId,
    organizationId: input.organization_id,
    schoolJobId: job?.id ?? input.school_job_id ?? null,
    linkedShootId: input.linked_shoot_id ?? null,
    linkedLocationId: input.linked_location_id ?? school.primary_location_id,
    workType: "yearbook",
    title:
      input.request_type === "yearbook_review_requested"
        ? `Review yearbook materials for ${school.school_name}`
        : `Set up yearbook workflow for ${school.school_name}`,
    description: detailNote,
    ownerUserId: school.primary_internal_owner_user_id ?? school.backup_internal_owner_user_id ?? null,
    status: "open",
    stage: "planning",
    priority: "high",
    dueDate: input.deadline_date ?? addDays(formatDate(new Date()), 5),
    slaDate: input.deadline_date ?? null,
    waitingOn: "none",
    sourceSystem: input.source_system ?? "other",
    sourceReference,
    notes: "Triggered from a yearbook request/review event.",
    automationKey: `schools_hub:yearbook:${input.request_type}:${sourceReference}`,
    preserveUserState: true
  });

  await appendSchoolActivityLog(client, {
    tenantId,
    organizationId: input.organization_id,
    activityType: "automation_trigger_received",
    summary: `Yearbook trigger received for ${school.school_name}.`,
    detail: detailNote,
    metadata: { work_item_id: work.id, source_reference: sourceReference, request_type: input.request_type },
    actorUserId: input.initiated_by_user_id ?? null
  });
}

export async function handleSchoolsHubDeliverableTrigger(client: PoolClient, tenantId: string, payload: Record<string, unknown>) {
  const input = payload as ManualDeliverableTriggerPayload;
  if (!input.organization_id || !input.deliverable_type) {
    return;
  }

  const school = await loadSchoolContext(client, tenantId, input.organization_id);
  if (!school) {
    return;
  }

  const configMap = await loadSchoolAutomationConfigMap(client, tenantId);
  const config = configMap.get(input.organization_id) ?? defaultSchoolAutomationConfig();
  const sourceReference =
    normalizeText(input.source_reference) ??
    buildFallbackTriggerReference("deliverable", input.organization_id, input.deliverable_type, input.arrived_on ?? input.ready_date ?? null);

  const job =
    (await ensureAutomationJob(client, {
      tenantId,
      organizationId: input.organization_id,
      schoolJobId: input.school_job_id ?? null,
      linkedShootId: input.linked_shoot_id ?? null,
      linkedLocationId: input.linked_location_id ?? school.primary_location_id,
      jobType: input.deliverable_type === "yearbooks_arrived" ? "yearbook" : "delivery",
      title:
        input.deliverable_type === "yearbooks_arrived"
          ? `${school.school_name} yearbook delivery`
          : `${school.school_name} deliverables`,
      eventDate: input.arrived_on ?? null,
      dueDate: input.ready_date ?? input.arrived_on ?? null,
      ownerUserId: school.primary_internal_owner_user_id ?? school.backup_internal_owner_user_id ?? null,
      sourceSystem: input.source_system ?? "other",
      sourceReference,
      notes: normalizeText(input.note)
    })) ?? null;

  const work = await ensureGeneratedWorkItem(client, {
    tenantId,
    organizationId: input.organization_id,
    schoolJobId: job?.id ?? input.school_job_id ?? null,
    linkedShootId: input.linked_shoot_id ?? null,
    linkedLocationId: input.linked_location_id ?? school.primary_location_id,
    workType: "delivery",
    title:
      input.deliverable_type === "yearbooks_arrived"
        ? `Organize and deliver yearbooks for ${school.school_name}`
        : input.deliverable_type === "admin_items_arrived"
          ? `Organize admin deliverables for ${school.school_name}`
          : `Organize deliverables for ${school.school_name}`,
    description: normalizeText(input.note) ?? "Deliverables arrived and are ready for school-side organization and release.",
    ownerUserId: school.primary_internal_owner_user_id ?? school.backup_internal_owner_user_id ?? null,
    status: "open",
    stage: "ready_for_delivery",
    priority: "high",
    dueDate: input.ready_date ?? input.arrived_on ?? formatDate(new Date()),
    slaDate: input.ready_date ?? null,
    waitingOn: "none",
    sourceSystem: input.source_system ?? "other",
    sourceReference,
    notes: "Triggered from deliverable-arrival automation.",
    automationKey: `schools_hub:deliverable:${input.deliverable_type}:${sourceReference}`,
    preserveUserState: true
  });

  await appendSchoolActivityLog(client, {
    tenantId,
    organizationId: input.organization_id,
    activityType: "automation_trigger_received",
    summary: `Deliverable trigger received for ${school.school_name}.`,
    detail: normalizeText(input.note),
    metadata: { work_item_id: work.id, source_reference: sourceReference, deliverable_type: input.deliverable_type },
    actorUserId: input.initiated_by_user_id ?? null
  });

  if (config.bundleDeliveriesEnabled) {
    await ensureDeliveryBundleSuggestion(client, tenantId, input.organization_id, school.school_name, config.deliveryBundleThreshold);
  }
}

export async function monitorSchoolsHub() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE pmc_app");
    const tenants = await client.query<{ id: string }>("SELECT id::text FROM tenant ORDER BY created_at ASC");

    for (const tenant of tenants.rows) {
      await client.query("SELECT app.set_context($1::uuid, NULL::uuid)", [tenant.id]);
      await runSchoolsHubAutomationForTenant(client, tenant.id);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function generatePreShootCoordinationWork(
  client: PoolClient,
  tenantId: string,
  today: string,
  configMap: Map<string, SchoolAutomationConfig>
) {
  const candidates = await loadPreShootCandidates(client, tenantId);
  for (const candidate of candidates) {
    if (!candidate.effective_event_date || candidate.effective_event_date < today) {
      continue;
    }
    const config = configMap.get(candidate.organization_id) ?? defaultSchoolAutomationConfig();
    if (candidate.effective_event_date > addDays(today, config.preShootCoordinationDays)) {
      continue;
    }

    const dueDate = addDays(candidate.effective_event_date, -config.confirmationEscalationDays);
    const work = await ensureGeneratedWorkItem(client, {
      tenantId,
      organizationId: candidate.organization_id,
      schoolJobId: candidate.school_job_id,
      linkedShootId: candidate.linked_shoot_id,
      linkedLocationId: candidate.linked_location_id,
      workType: "pre_shoot_coordination",
      title: `Pre-shoot coordination for ${candidate.school_name}`,
      description: `Confirm roster, day-of contacts, timing, and prep for ${candidate.job_title}.`,
      ownerUserId: candidate.owner_user_id ?? candidate.primary_internal_owner_user_id ?? candidate.backup_internal_owner_user_id ?? null,
      status: "open",
      stage: "planning",
      priority: candidate.effective_event_date <= addDays(today, 7) ? "high" : "normal",
      dueDate,
      slaDate: dueDate,
      waitingOn: "none",
      sourceSystem: "mission_control",
      sourceReference: `school_job:${candidate.school_job_id}`,
      notes: "Generated automatically when the shoot entered the pre-shoot planning window.",
      automationKey: `schools_hub:pre_shoot:${candidate.school_job_id}`,
      preserveUserState: true
    });

    if (work.created) {
      await appendSchoolActivityLog(client, {
        tenantId,
        organizationId: candidate.organization_id,
        activityType: "automation_generated",
        summary: `Generated pre-shoot coordination work for ${candidate.school_name}.`,
        detail: `Planning window opened for ${candidate.job_title}.`,
        metadata: { school_job_id: candidate.school_job_id, work_item_id: work.id, automation_key: work.automationKey }
      });
    }
  }
}

async function generatePreShootEscalations(
  client: PoolClient,
  tenantId: string,
  today: string,
  configMap: Map<string, SchoolAutomationConfig>
) {
  const candidates = await loadPreShootCandidates(client, tenantId);
  for (const candidate of candidates) {
    if (!candidate.effective_event_date || candidate.effective_event_date < today) {
      continue;
    }
    const config = configMap.get(candidate.organization_id) ?? defaultSchoolAutomationConfig();
    if (candidate.effective_event_date > addDays(today, config.confirmationEscalationDays)) {
      continue;
    }
    if (candidate.has_completed_confirmation || candidate.has_logged_confirmation) {
      continue;
    }

    const work = await ensureGeneratedWorkItem(client, {
      tenantId,
      organizationId: candidate.organization_id,
      schoolJobId: candidate.school_job_id,
      linkedShootId: candidate.linked_shoot_id,
      linkedLocationId: candidate.linked_location_id,
      workType: "exception_handling",
      title: `Escalate missing confirmation for ${candidate.school_name}`,
      description: `Required pre-shoot confirmation is still missing for ${candidate.job_title}.`,
      ownerUserId: candidate.owner_user_id ?? candidate.primary_internal_owner_user_id ?? candidate.backup_internal_owner_user_id ?? null,
      status: "blocked",
      stage: "waiting_on_school",
      priority: "critical",
      dueDate: addDays(candidate.effective_event_date, -config.confirmationEscalationDays),
      slaDate: addDays(candidate.effective_event_date, -config.confirmationEscalationDays),
      blockerReason: "Required school confirmation is still missing.",
      waitingOn: "school",
      sourceSystem: "mission_control",
      sourceReference: `school_job:${candidate.school_job_id}:confirmation_missing`,
      notes: "Generated automatically because the T-14 confirmation checkpoint has passed without a logged confirmation.",
      automationKey: `schools_hub:pre_shoot_escalation:${candidate.school_job_id}`,
      escalationLevel: 1,
      preserveUserState: false
    });

    if (work.created || work.updated) {
      await appendSchoolActivityLog(client, {
        tenantId,
        organizationId: candidate.organization_id,
        activityType: "automation_escalated",
        summary: `Missing confirmation escalated for ${candidate.school_name}.`,
        detail: `No pre-shoot confirmation is logged for ${candidate.job_title}.`,
        metadata: { school_job_id: candidate.school_job_id, work_item_id: work.id, automation_key: work.automationKey }
      });
      await queueSchoolsHubNotification(client, {
        tenantId,
        recipientUserIds: buildRecipientList(
          candidate.owner_user_id,
          candidate.primary_internal_owner_user_id,
          candidate.backup_internal_owner_user_id
        ),
        notificationType: "schools_hub.pre_shoot_confirmation_missing",
        title: `Missing school confirmation for ${candidate.school_name}`,
        body: `${candidate.job_title} is inside the T-14 window and still has no logged confirmation.`,
        priority: "critical",
        category: "follow_up_task",
        severity: "critical",
        actionRequired: true,
        requiresAcknowledgement: true,
        allowSnooze: true,
        deepLink: "#operations/schools",
        groupKey: `schools_hub:${work.automationKey}:escalation`
      });
    }
  }
}

async function generatePreShootNoResponseFollowUps(
  client: PoolClient,
  tenantId: string,
  today: string,
  configMap: Map<string, SchoolAutomationConfig>
) {
  const plans = await loadPreShootFollowUpCandidates(client, tenantId);
  for (const plan of plans) {
    const config = configMap.get(plan.organization_id) ?? defaultSchoolAutomationConfig();
    const followUpEligibleDate = addDays(plan.due_at.slice(0, 10), config.noResponseFollowUpDays);
    if (followUpEligibleDate > today || plan.has_response) {
      continue;
    }

    const work = await ensureGeneratedWorkItem(client, {
      tenantId,
      organizationId: plan.organization_id,
      schoolJobId: plan.school_job_id,
      linkedShootId: plan.linked_shoot_id,
      linkedLocationId: plan.linked_location_id,
      workType: "follow_up",
      title: `Follow up on missing school response for ${plan.school_name}`,
      description:
        normalizeText(plan.summary) ??
        `No response has been logged for ${plan.title} after the configured follow-up interval.`,
      ownerUserId: plan.owner_user_id ?? plan.primary_internal_owner_user_id ?? plan.backup_internal_owner_user_id ?? null,
      status: "waiting",
      stage: "waiting_on_school",
      priority:
        plan.effective_event_date && plan.effective_event_date <= addDays(today, 7)
          ? "critical"
          : "high",
      dueDate: today,
      slaDate: plan.effective_event_date ? addDays(plan.effective_event_date, -1) : null,
      waitingOn: "school",
      sourceSystem: "mission_control",
      sourceReference: `touchpoint_plan:${plan.touchpoint_plan_id}`,
      notes: "Generated automatically because the school has not responded after the configured follow-up interval.",
      automationKey: `schools_hub:no_response_follow_up:${plan.touchpoint_plan_id}`,
      escalationLevel: 1,
      preserveUserState: true
    });

    if (work.created || work.updated) {
      await appendSchoolActivityLog(client, {
        tenantId,
        organizationId: plan.organization_id,
        activityType: "automation_generated",
        summary: `Generated no-response follow-up for ${plan.school_name}.`,
        detail: `The school has not responded to ${plan.title}.`,
        metadata: { touchpoint_plan_id: plan.touchpoint_plan_id, work_item_id: work.id, automation_key: work.automationKey }
      });
      await queueSchoolsHubNotification(client, {
        tenantId,
        recipientUserIds: buildRecipientList(
          plan.owner_user_id,
          plan.primary_internal_owner_user_id,
          plan.backup_internal_owner_user_id
        ),
        notificationType: "schools_hub.no_response_follow_up",
        title: `No school response for ${plan.school_name}`,
        body: `${plan.title} still has no logged response after the follow-up window.`,
        priority: "high",
        category: "follow_up_task",
        severity: "high",
        actionRequired: true,
        allowSnooze: true,
        deepLink: "#operations/schools",
        groupKey: `schools_hub:${work.automationKey}:follow_up`
      });
    }
  }
}

async function syncGalleryDueWork(client: PoolClient, tenantId: string, today: string) {
  const projects = await loadGalleryCandidates(client, tenantId);
  for (const project of projects) {
    const dueDate = project.due_date ?? addDays(today, 3);
    const waitingOn = project.release_state === "ready_to_release" || project.stage === "ready_to_release" ? "none" : "internal_production";
    const nextStage =
      project.release_state === "ready_to_release" || project.stage === "ready_to_release"
        ? "ready_for_delivery"
        : "waiting_on_internal";
    const nextStatus =
      project.stage === "released_complete" || project.release_state === "released"
        ? "completed"
        : project.stage === "blocked"
          ? "blocked"
          : waitingOn === "internal_production"
            ? "waiting"
            : "open";

    const work = await ensureGeneratedWorkItem(client, {
      tenantId,
      organizationId: project.organization_id,
      schoolJobId: project.school_job_id,
      linkedShootId: project.linked_shoot_id,
      linkedLocationId: project.linked_location_id,
      linkedProductionProjectId: project.project_id,
      workType: "gallery_release",
      title: `Gallery release for ${project.school_name}`,
      description:
        normalizeText(project.project_summary) ??
        `Keep the school release visible while ${project.project_title} moves through production.`,
      ownerUserId: project.owner_user_id ?? project.primary_internal_owner_user_id ?? project.backup_internal_owner_user_id ?? null,
      status: nextStatus,
      stage: nextStage,
      priority: dueDate <= today ? "critical" : dueDate <= addDays(today, 2) ? "high" : "normal",
      dueDate,
      slaDate: dueDate,
      blockerReason: project.blocker_reason,
      waitingOn: waitingOn as EnsureGeneratedWorkInput["waitingOn"],
      sourceSystem: "mission_control",
      sourceReference: `production_project:${project.project_id}`,
      notes: "Synced automatically from the linked production project.",
      automationKey: `schools_hub:gallery_due:${project.project_id}`,
      preserveUserState: false
    });

    if (work.created) {
      await appendSchoolActivityLog(client, {
        tenantId,
        organizationId: project.organization_id,
        activityType: "automation_generated",
        summary: `Generated gallery due work for ${project.school_name}.`,
        detail: `Linked production project: ${project.project_title}.`,
        metadata: { project_id: project.project_id, work_item_id: work.id, automation_key: work.automationKey }
      });
    }
  }
}

async function generateDeliveryBundleSuggestions(
  client: PoolClient,
  tenantId: string,
  today: string,
  configMap: Map<string, SchoolAutomationConfig>
) {
  const rows = await loadDeliveryBundleCandidates(client, tenantId);
  for (const row of rows) {
    const config = configMap.get(row.organization_id) ?? defaultSchoolAutomationConfig();
    if (!config.bundleDeliveriesEnabled) {
      continue;
    }
    if (Number(row.pending_delivery_count) < config.deliveryBundleThreshold) {
      continue;
    }
    await ensureDeliveryBundleSuggestion(client, tenantId, row.organization_id, row.school_name, config.deliveryBundleThreshold, {
      ownerUserId: row.owner_user_id ?? row.primary_internal_owner_user_id ?? row.backup_internal_owner_user_id ?? null,
      dueDate: row.earliest_due_date ?? today,
      titles: Array.isArray(row.titles) ? row.titles.filter(Boolean).slice(0, 5) : []
    });
  }
}

async function ensureDeliveryBundleSuggestion(
  client: PoolClient,
  tenantId: string,
  organizationId: string,
  schoolName: string,
  threshold: number,
  input?: {
    ownerUserId?: string | null;
    dueDate?: string | null;
    titles?: string[];
  }
) {
  const description =
    input?.titles && input.titles.length
      ? `Multiple pending deliverables could be bundled: ${input.titles.join(" | ")}`
      : `Multiple pending deliverables are open and may be worth bundling before final school delivery.`;

  const work = await ensureGeneratedWorkItem(client, {
    tenantId,
    organizationId,
    workType: "delivery",
    title: `Bundle pending deliveries for ${schoolName}`,
    description,
    ownerUserId: input?.ownerUserId ?? null,
    status: "open",
    stage: "planning",
    priority: "high",
    dueDate: input?.dueDate ?? null,
    waitingOn: "none",
    sourceSystem: "mission_control",
    sourceReference: `delivery_bundle:${organizationId}`,
    notes: `Generated automatically when ${threshold} or more delivery items were open for the same school.`,
    automationKey: `schools_hub:delivery_bundle:${organizationId}`,
    preserveUserState: true
  });

  if (work.created) {
    await appendSchoolActivityLog(client, {
      tenantId,
      organizationId,
      activityType: "automation_generated",
      summary: `Generated bundled delivery suggestion for ${schoolName}.`,
      detail: description,
      metadata: { work_item_id: work.id, automation_key: work.automationKey }
    });
  }
}

async function ensureGeneratedWorkItem(client: PoolClient, input: EnsureGeneratedWorkInput) {
  const existing = await loadAutomationWorkItem(client, input.tenantId, input.automationKey);
  const normalizedTitle = input.title.trim();
  const normalizedDescription = normalizeText(input.description);
  const normalizedNotes = normalizeText(input.notes);
  const blockerReason = normalizeText(input.blockerReason);
  const ownerUserId = input.ownerUserId ?? null;
  const waitingOn = input.waitingOn ?? "none";
  const escalationLevel = input.escalationLevel ?? existing?.escalation_level ?? 0;

  if (!existing) {
    const insert = await client.query<{ id: string }>(
      `
        INSERT INTO school_work_item (
          tenant_id,
          organization_id,
          school_job_id,
          linked_shoot_id,
          linked_location_id,
          linked_contact_id,
          linked_production_project_id,
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
          automation_last_evaluated_at,
          escalation_level,
          completed_at,
          notes
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::school_work_status,$13::school_work_stage,$14::school_work_priority,
          $15::date,$16::date,$17,$18::school_work_waiting_on,$19::school_work_source_system,$20,true,$21,now(),$22,
          CASE WHEN $12::school_work_status = 'completed' THEN now() ELSE NULL END,$23
        )
        RETURNING id::text
      `,
      [
        input.tenantId,
        input.organizationId,
        input.schoolJobId ?? null,
        input.linkedShootId ?? null,
        input.linkedLocationId ?? null,
        input.linkedContactId ?? null,
        input.linkedProductionProjectId ?? null,
        input.workType,
        normalizedTitle,
        normalizedDescription,
        ownerUserId,
        input.status,
        input.stage,
        input.priority,
        input.dueDate ?? null,
        input.slaDate ?? null,
        blockerReason,
        waitingOn,
        input.sourceSystem ?? "mission_control",
        normalizeText(input.sourceReference),
        input.automationKey,
        escalationLevel,
        normalizedNotes
      ]
    );

    await insertAuditLog(client, {
      tenantId: input.tenantId,
      action: "schools_hub.automation.generated",
      entityType: "school_work_item",
      entityId: insert.rows[0].id,
      metadata: {
        automation_key: input.automationKey,
        work_type: input.workType,
        organization_id: input.organizationId
      }
    });

    return { id: insert.rows[0].id, created: true, updated: false, automationKey: input.automationKey };
  }

  if (existing.status === "completed" || existing.status === "cancelled") {
    await client.query(
      `
        UPDATE school_work_item
        SET automation_last_evaluated_at = now(),
            escalation_level = GREATEST(escalation_level, $3),
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [input.tenantId, existing.id, escalationLevel]
    );
    return { id: existing.id, created: false, updated: false, automationKey: input.automationKey };
  }

  const nextPriority = higherPriority(existing.priority, input.priority);
  const nextStatus = input.preserveUserState ? existing.status : input.status;
  const nextStage = input.preserveUserState ? existing.stage : input.stage;
  const nextWaitingOn = input.preserveUserState && existing.waiting_on !== "none" ? existing.waiting_on : waitingOn;
  const nextBlockerReason =
    input.preserveUserState && normalizeText(existing.blocker_reason)
      ? normalizeText(existing.blocker_reason)
      : blockerReason;

  await client.query(
    `
      UPDATE school_work_item
      SET
        school_job_id = COALESCE($3::uuid, school_job_id),
        linked_shoot_id = COALESCE($4::uuid, linked_shoot_id),
        linked_location_id = COALESCE($5::uuid, linked_location_id),
        linked_contact_id = COALESCE($6::uuid, linked_contact_id),
        linked_production_project_id = COALESCE($7::uuid, linked_production_project_id),
        title = $8,
        description = $9,
        owner_user_id = COALESCE($10::uuid, owner_user_id),
        status = $11::school_work_status,
        stage = $12::school_work_stage,
        priority = $13::school_work_priority,
        due_date = $14::date,
        sla_date = $15::date,
        blocker_reason = $16,
        waiting_on = $17::school_work_waiting_on,
        source_system = $18::school_work_source_system,
        source_reference = $19,
        generated_by_rule = true,
        automation_last_evaluated_at = now(),
        escalation_level = GREATEST(escalation_level, $20),
        completed_at = CASE
          WHEN $11::school_work_status = 'completed' THEN COALESCE(completed_at, now())
          ELSE NULL
        END,
        notes = $21,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      input.tenantId,
      existing.id,
      input.schoolJobId ?? null,
      input.linkedShootId ?? null,
      input.linkedLocationId ?? null,
      input.linkedContactId ?? null,
      input.linkedProductionProjectId ?? null,
      normalizedTitle,
      normalizedDescription,
      ownerUserId,
      nextStatus,
      nextStage,
      nextPriority,
      input.dueDate ?? existing.due_date ?? null,
      input.slaDate ?? existing.sla_date ?? null,
      nextBlockerReason,
      nextWaitingOn,
      input.sourceSystem ?? "mission_control",
      normalizeText(input.sourceReference),
      escalationLevel,
      normalizedNotes ?? existing.notes
    ]
  );

  return { id: existing.id, created: false, updated: true, automationKey: input.automationKey };
}

async function ensureAutomationJob(
  client: PoolClient,
  input: {
    tenantId: string;
    organizationId: string;
    schoolJobId?: string | null;
    linkedShootId?: string | null;
    linkedLocationId?: string | null;
    jobType: "fall_portraits" | "retakes" | "spring_portraits" | "sports" | "graduation" | "yearbook" | "ids" | "admin_fulfillment" | "delivery" | "other";
    title: string;
    eventDate?: string | null;
    dueDate?: string | null;
    ownerUserId?: string | null;
    sourceSystem?: "mission_control" | "monday" | "manual_import" | "zendesk" | "outlook" | "other";
    sourceReference?: string | null;
    notes?: string | null;
  }
) {
  let existingId = normalizeText(input.schoolJobId) ?? null;
  if (!existingId && input.linkedShootId) {
    const linkedJob = await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM school_job
        WHERE tenant_id = $1
          AND linked_shoot_id = $2
          AND job_type = $3::school_job_type
        LIMIT 1
      `,
      [input.tenantId, input.linkedShootId, input.jobType]
    );
    existingId = linkedJob.rows[0]?.id ?? null;
  }
  if (!existingId && normalizeText(input.sourceReference)) {
    const matchingJob = await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM school_job
        WHERE tenant_id = $1
          AND organization_id = $2
          AND job_type = $3::school_job_type
          AND source_system = $4::school_work_source_system
          AND source_reference = $5
        LIMIT 1
      `,
      [input.tenantId, input.organizationId, input.jobType, input.sourceSystem ?? "mission_control", normalizeText(input.sourceReference)]
    );
    existingId = matchingJob.rows[0]?.id ?? null;
  }

  if (existingId) {
    await client.query(
      `
        UPDATE school_job
        SET
          linked_location_id = COALESCE($3::uuid, linked_location_id),
          owner_user_id = COALESCE($4::uuid, owner_user_id),
          event_date = COALESCE($5::date, event_date),
          due_date = COALESCE($6::date, due_date),
          source_system = $7::school_work_source_system,
          source_reference = COALESCE($8, source_reference),
          notes = COALESCE($9, notes),
          title = COALESCE(NULLIF($10, ''), title),
          status = CASE WHEN status IN ('completed','cancelled') THEN status ELSE 'active'::school_job_status END,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [
        input.tenantId,
        existingId,
        input.linkedLocationId ?? null,
        input.ownerUserId ?? null,
        input.eventDate ?? null,
        input.dueDate ?? null,
        input.sourceSystem ?? "mission_control",
        normalizeText(input.sourceReference),
        normalizeText(input.notes),
        input.title.trim()
      ]
    );
    return { id: existingId };
  }

  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO school_job (
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
        notes
      )
      VALUES ($1,$2,$3,$4,$5::school_job_type,$6::date,$7::date,$8::uuid,$9::school_work_source_system,$10,'active',$11,$12)
      RETURNING id::text
    `,
    [
      input.tenantId,
      input.organizationId,
      input.linkedShootId ?? null,
      input.linkedLocationId ?? null,
      input.jobType,
      input.eventDate ?? null,
      input.dueDate ?? null,
      input.ownerUserId ?? null,
      input.sourceSystem ?? "mission_control",
      normalizeText(input.sourceReference),
      input.title.trim(),
      normalizeText(input.notes)
    ]
  );

  await insertAuditLog(client, {
    tenantId: input.tenantId,
    action: "schools_hub.automation.job_generated",
    entityType: "school_job",
    entityId: inserted.rows[0].id,
    metadata: {
      organization_id: input.organizationId,
      job_type: input.jobType,
      source_reference: normalizeText(input.sourceReference)
    }
  });

  return { id: inserted.rows[0].id };
}

async function loadSchoolAutomationConfigMap(client: PoolClient, tenantId: string) {
  const rules = await client.query<SchoolRuleRow>(
    `
      SELECT
        organization_id::text,
        rule_type::text,
        structured_value
      FROM school_rule
      WHERE tenant_id = $1
        AND active_status = 'active'
    `,
    [tenantId]
  );

  const byOrganization = new Map<string, SchoolRuleRow[]>();
  for (const row of rules.rows) {
    const current = byOrganization.get(row.organization_id) ?? [];
    current.push(row);
    byOrganization.set(row.organization_id, current);
  }

  const configMap = new Map<string, SchoolAutomationConfig>();
  for (const [organizationId, rows] of byOrganization.entries()) {
    const config = defaultSchoolAutomationConfig();
    for (const row of rows) {
      const value = isObject(row.structured_value) ? row.structured_value : {};
      if (row.rule_type === "additional_shoot_rules") {
        config.preShootCoordinationDays =
          readNumber(value, ["pre_shoot_coordination_days", "preShootCoordinationDays"]) ?? config.preShootCoordinationDays;
        config.confirmationEscalationDays =
          readNumber(value, ["confirmation_escalation_days", "confirmationEscalationDays"]) ?? config.confirmationEscalationDays;
        config.noResponseFollowUpDays =
          readNumber(value, ["follow_up_interval_days", "pre_shoot_follow_up_days", "noResponseFollowUpDays"]) ??
          config.noResponseFollowUpDays;
      }
      if (row.rule_type === "delivery_preferences" || row.rule_type === "mailing_preferences") {
        config.bundleDeliveriesEnabled =
          readBoolean(value, ["bundle_pending_deliveries", "bundleDeliveriesEnabled"]) ?? config.bundleDeliveriesEnabled;
        config.deliveryBundleThreshold =
          readNumber(value, ["bundle_threshold", "deliveryBundleThreshold"]) ?? config.deliveryBundleThreshold;
      }
      if (row.rule_type === "subject_directory_requirements") {
        config.subjectDirectoryRequired =
          readBoolean(value, ["required", "enabled", "subject_directory_required"]) ?? config.subjectDirectoryRequired;
      }
      if (row.rule_type === "subject_directory_counts") {
        config.subjectDirectoryCount =
          readNumber(value, ["count", "subject_directory_count", "subjectDirectoryCount"]) ?? config.subjectDirectoryCount;
        if (config.subjectDirectoryCount && config.subjectDirectoryCount > 0) {
          config.subjectDirectoryRequired = true;
        }
      }
      if (row.rule_type === "yearbook_participation") {
        config.yearbookEnabled =
          readBoolean(value, ["enabled", "participating", "yearbook_enabled"]) ?? config.yearbookEnabled;
      }
    }
    configMap.set(organizationId, config);
  }

  return configMap;
}

async function loadSchoolContext(client: PoolClient, tenantId: string, organizationId: string) {
  const school = await client.query<SchoolContextRow>(
    `
      SELECT
        school_profile.organization_id::text,
        COALESCE(org.display_name, org.canonical_name) AS school_name,
        school_profile.primary_location_id::text,
        school_profile.primary_internal_owner_user_id::text,
        school_profile.backup_internal_owner_user_id::text
      FROM school_profile
      JOIN organization org
        ON org.tenant_id = school_profile.tenant_id
       AND org.id = school_profile.organization_id
      WHERE school_profile.tenant_id = $1
        AND school_profile.organization_id = $2
      LIMIT 1
    `,
    [tenantId, organizationId]
  );
  return school.rows[0] ?? null;
}

async function loadPreShootCandidates(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<PreShootCandidateRow>(
    `
      SELECT
        job.id::text AS school_job_id,
        job.organization_id::text,
        COALESCE(org.display_name, org.canonical_name) AS school_name,
        job.linked_shoot_id::text,
        COALESCE(job.linked_location_id::text, school_profile.primary_location_id::text) AS linked_location_id,
        job.owner_user_id::text,
        school_profile.primary_internal_owner_user_id::text,
        school_profile.backup_internal_owner_user_id::text,
        job.title AS job_title,
        COALESCE(job.event_date::text, shoot.shoot_date::text) AS effective_event_date,
        EXISTS (
          SELECT 1
          FROM directory_touchpoint_plan plan
          WHERE plan.tenant_id = job.tenant_id
            AND plan.organization_id = job.organization_id
            AND plan.category = 'pre_shoot_confirmation'
            AND plan.status = 'completed'
            AND (
              (job.linked_shoot_id IS NOT NULL AND plan.linked_shoot_id = job.linked_shoot_id)
              OR job.linked_shoot_id IS NULL
            )
        ) AS has_completed_confirmation,
        EXISTS (
          SELECT 1
          FROM directory_touchpoint touchpoint
          WHERE touchpoint.tenant_id = job.tenant_id
            AND touchpoint.organization_id = job.organization_id
            AND touchpoint.category = 'pre_shoot_confirmation'
            AND (
              (job.linked_shoot_id IS NOT NULL AND touchpoint.shoot_id = job.linked_shoot_id)
              OR job.linked_shoot_id IS NULL
            )
        ) AS has_logged_confirmation
      FROM school_job job
      JOIN school_profile
        ON school_profile.tenant_id = job.tenant_id
       AND school_profile.organization_id = job.organization_id
      JOIN organization org
        ON org.tenant_id = job.tenant_id
       AND org.id = job.organization_id
      LEFT JOIN shoot
        ON shoot.tenant_id = job.tenant_id
       AND shoot.id = job.linked_shoot_id
      WHERE job.tenant_id = $1
        AND job.status NOT IN ('completed', 'cancelled')
        AND (
          job.linked_shoot_id IS NOT NULL
          OR job.job_type IN ('fall_portraits', 'retakes', 'spring_portraits', 'sports', 'graduation')
        )
    `,
    [tenantId]
  );
  return rows;
}

async function loadPreShootFollowUpCandidates(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<PreShootFollowUpCandidateRow>(
    `
      SELECT
        plan.id::text AS touchpoint_plan_id,
        plan.organization_id::text,
        COALESCE(org.display_name, org.canonical_name) AS school_name,
        plan.linked_shoot_id::text,
        COALESCE(plan.location_id::text, school_profile.primary_location_id::text) AS linked_location_id,
        school_job.id::text AS school_job_id,
        plan.owner_user_id::text,
        school_profile.primary_internal_owner_user_id::text,
        school_profile.backup_internal_owner_user_id::text,
        plan.title,
        plan.summary,
        plan.due_at::text,
        COALESCE(school_job.event_date::text, shoot.shoot_date::text) AS effective_event_date,
        EXISTS (
          SELECT 1
          FROM directory_touchpoint touchpoint
          WHERE touchpoint.tenant_id = plan.tenant_id
            AND (
              touchpoint.touchpoint_plan_id = plan.id
              OR (
                touchpoint.organization_id = plan.organization_id
                AND touchpoint.category = plan.category
                AND COALESCE(touchpoint.shoot_id::text, '') = COALESCE(plan.linked_shoot_id::text, '')
              )
            )
        ) AS has_response
      FROM directory_touchpoint_plan plan
      JOIN school_profile
        ON school_profile.tenant_id = plan.tenant_id
       AND school_profile.organization_id = plan.organization_id
      JOIN organization org
        ON org.tenant_id = plan.tenant_id
       AND org.id = plan.organization_id
      LEFT JOIN shoot
        ON shoot.tenant_id = plan.tenant_id
       AND shoot.id = plan.linked_shoot_id
      LEFT JOIN LATERAL (
        SELECT school_job.id, school_job.event_date
        FROM school_job
        WHERE school_job.tenant_id = plan.tenant_id
          AND school_job.organization_id = plan.organization_id
          AND (
            (plan.linked_shoot_id IS NOT NULL AND school_job.linked_shoot_id = plan.linked_shoot_id)
            OR (plan.linked_shoot_id IS NULL AND school_job.status NOT IN ('completed', 'cancelled'))
          )
        ORDER BY
          CASE WHEN school_job.linked_shoot_id = plan.linked_shoot_id THEN 0 ELSE 1 END,
          school_job.created_at DESC
        LIMIT 1
      ) school_job ON true
      WHERE plan.tenant_id = $1
        AND plan.category = 'pre_shoot_confirmation'
        AND plan.status = 'planned'
    `,
    [tenantId]
  );
  return rows;
}

async function loadGalleryCandidates(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<GalleryCandidateRow>(
    `
      SELECT
        project.id::text AS project_id,
        COALESCE(project.linked_organization_id::text, shoot.organization_id::text) AS organization_id,
        COALESCE(org.display_name, org.canonical_name) AS school_name,
        project.linked_shoot_id::text,
        COALESCE(project.linked_location_id::text, shoot.location_id::text, school_profile.primary_location_id::text) AS linked_location_id,
        school_job.id::text AS school_job_id,
        school_job.title AS school_job_title,
        project.owner_user_id::text,
        school_profile.primary_internal_owner_user_id::text,
        school_profile.backup_internal_owner_user_id::text,
        project.title AS project_title,
        project.summary AS project_summary,
        project.due_date::text,
        project.stage::text AS stage,
        project.status::text AS status,
        project.release_state::text AS release_state,
        blocker.reason AS blocker_reason
      FROM production_project project
      LEFT JOIN shoot
        ON shoot.tenant_id = project.tenant_id
       AND shoot.id = project.linked_shoot_id
      JOIN school_profile
        ON school_profile.tenant_id = project.tenant_id
       AND school_profile.organization_id = COALESCE(project.linked_organization_id, shoot.organization_id)
      JOIN organization org
        ON org.tenant_id = project.tenant_id
       AND org.id = school_profile.organization_id
      LEFT JOIN LATERAL (
        SELECT school_job.id, school_job.title
        FROM school_job
        WHERE school_job.tenant_id = project.tenant_id
          AND (
            (project.linked_shoot_id IS NOT NULL AND school_job.linked_shoot_id = project.linked_shoot_id)
            OR (project.linked_shoot_id IS NULL AND school_job.organization_id = school_profile.organization_id)
          )
        ORDER BY
          CASE WHEN school_job.linked_shoot_id = project.linked_shoot_id THEN 0 ELSE 1 END,
          school_job.created_at DESC
        LIMIT 1
      ) school_job ON true
      LEFT JOIN LATERAL (
        SELECT blocker.reason
        FROM production_project_blocker blocker
        WHERE blocker.tenant_id = project.tenant_id
          AND blocker.project_id = project.id
          AND blocker.resolved_at IS NULL
        ORDER BY blocker.created_at DESC
        LIMIT 1
      ) blocker ON true
      WHERE project.tenant_id = $1
        AND project.job_type = 'gallery_prep_upload'
        AND project.stage NOT IN ('cancelled')
        AND project.status <> 'canceled'
    `,
    [tenantId]
  );
  return rows;
}

async function loadDeliveryBundleCandidates(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<DeliveryBundleRow>(
    `
      SELECT
        work.organization_id::text,
        COALESCE(org.display_name, org.canonical_name) AS school_name,
        MAX(work.owner_user_id::text) AS owner_user_id,
        school_profile.primary_internal_owner_user_id::text,
        school_profile.backup_internal_owner_user_id::text,
        COUNT(*)::text AS pending_delivery_count,
        MIN(work.due_date)::text AS earliest_due_date,
        ARRAY_AGG(work.title ORDER BY work.due_date NULLS LAST, work.created_at DESC) AS titles
      FROM school_work_item work
      JOIN school_profile
        ON school_profile.tenant_id = work.tenant_id
       AND school_profile.organization_id = work.organization_id
      JOIN organization org
        ON org.tenant_id = work.tenant_id
       AND org.id = work.organization_id
      WHERE work.tenant_id = $1
        AND work.work_type = 'delivery'
        AND work.status NOT IN ('completed', 'cancelled')
      GROUP BY
        work.organization_id,
        org.display_name,
        org.canonical_name,
        school_profile.primary_internal_owner_user_id,
        school_profile.backup_internal_owner_user_id
    `,
    [tenantId]
  );
  return rows;
}

async function loadAutomationWorkItem(client: PoolClient, tenantId: string, automationKey: string) {
  const existing = await client.query<ExistingAutomationWorkRow>(
    `
      SELECT
        id::text,
        organization_id::text,
        title,
        status::text,
        stage::text,
        priority::text,
        due_date::text,
        sla_date::text,
        blocker_reason,
        waiting_on::text,
        notes,
        owner_user_id::text,
        completed_at::text,
        escalation_level
      FROM school_work_item
      WHERE tenant_id = $1
        AND automation_key = $2
      LIMIT 1
    `,
    [tenantId, automationKey]
  );
  return existing.rows[0] ?? null;
}

async function appendSchoolActivityLog(
  client: PoolClient,
  input: {
    tenantId: string;
    organizationId: string;
    activityType: "automation_generated" | "automation_escalated" | "automation_trigger_received";
    summary: string;
    detail?: string | null;
    metadata?: Record<string, unknown>;
    actorUserId?: string | null;
  }
) {
  await client.query(
    `
      INSERT INTO school_activity_log (
        tenant_id,
        organization_id,
        activity_type,
        summary,
        detail,
        metadata,
        actor_user_id
      )
      VALUES ($1,$2,$3::school_activity_type,$4,$5,$6::jsonb,$7::uuid)
    `,
    [
      input.tenantId,
      input.organizationId,
      input.activityType,
      input.summary,
      normalizeText(input.detail),
      JSON.stringify(input.metadata ?? {}),
      input.actorUserId ?? null
    ]
  );
}

async function insertAuditLog(
  client: PoolClient,
  input: {
    tenantId: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
    actorUserId?: string | null;
  }
) {
  await client.query(
    `
      INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb)
    `,
    [
      input.tenantId,
      input.actorUserId ?? null,
      input.action,
      input.entityType,
      input.entityId ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

async function queueSchoolsHubNotification(
  client: PoolClient,
  input: {
    tenantId: string;
    recipientUserIds: string[];
    notificationType: string;
    title: string;
    body: string;
    priority: "normal" | "high" | "critical";
    category: "follow_up_task" | "production" | "urgent_operational_risk";
    severity: "medium" | "high" | "critical";
    actionRequired: boolean;
    requiresAcknowledgement?: boolean;
    allowSnooze?: boolean;
    deepLink?: string | null;
    groupKey: string;
  }
) {
  const recipients = [...new Set(input.recipientUserIds.filter(Boolean))];
  if (!recipients.length) {
    return;
  }

  const channels =
    input.priority === "critical"
      ? ["in_app", "push", "email"]
      : input.priority === "high"
        ? ["in_app", "push"]
        : ["in_app"];

  for (const recipientUserId of recipients) {
    await createAppEvent(client, {
      tenantId: input.tenantId,
      eventType: "notification.dispatch",
      aggregateType: "ops_notification",
      aggregateId: recipientUserId,
      dedupeKey: `schools-hub:notify:${recipientUserId}:${input.groupKey}`,
      payload: {
        tenant_id: input.tenantId,
        recipient_user_id: recipientUserId,
        notification_type: input.notificationType,
        priority: input.priority,
        category: input.category,
        severity: input.severity,
        title: input.title,
        body: input.body,
        deep_link: input.deepLink ?? "#operations/schools",
        channels,
        action_required: input.actionRequired,
        action_owner_user_id: input.actionRequired ? recipientUserId : null,
        requires_acknowledgement: Boolean(input.requiresAcknowledgement),
        allow_snooze: Boolean(input.allowSnooze),
        group_key: input.groupKey,
        metadata: {
          dedupe: input.groupKey,
          source: "schools_hub_automation"
        }
      }
    });
  }
}

async function createAppEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    eventType: string;
    aggregateType: string;
    aggregateId?: string | null;
    payload: Record<string, unknown>;
    dedupeKey?: string | null;
  }
) {
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO app_event (tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6)
      ON CONFLICT (tenant_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL
      DO NOTHING
      RETURNING id::text
    `,
    [input.tenantId, input.eventType, input.aggregateType, input.aggregateId ?? null, JSON.stringify(input.payload), input.dedupeKey ?? null]
  );

  return rows[0] ?? null;
}

function defaultSchoolAutomationConfig(): SchoolAutomationConfig {
  return {
    preShootCoordinationDays: DEFAULT_PRE_SHOOT_COORDINATION_DAYS,
    confirmationEscalationDays: DEFAULT_CONFIRMATION_ESCALATION_DAYS,
    noResponseFollowUpDays: DEFAULT_NO_RESPONSE_FOLLOW_UP_DAYS,
    deliveryBundleThreshold: DEFAULT_DELIVERY_BUNDLE_THRESHOLD,
    bundleDeliveriesEnabled: true,
    subjectDirectoryRequired: false,
    subjectDirectoryCount: null,
    yearbookEnabled: false
  };
}

function buildRecipientList(...values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function higherPriority(current: string, candidate: string) {
  const rank = (value: string) => {
    if (value === "critical") return 4;
    if (value === "high") return 3;
    if (value === "normal") return 2;
    return 1;
  };
  return rank(candidate) > rank(current) ? candidate : current;
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, delta: number) {
  const next = new Date(`${value}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + delta);
  return next.toISOString().slice(0, 10);
}

function normalizeText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readNumber(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return Math.max(1, Math.round(candidate));
    }
    if (typeof candidate === "string") {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric)) {
        return Math.max(1, Math.round(numeric));
      }
    }
  }
  return null;
}

function readBoolean(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "boolean") {
      return candidate;
    }
    if (typeof candidate === "string") {
      const normalized = candidate.trim().toLowerCase();
      if (normalized === "true" || normalized === "yes" || normalized === "enabled") {
        return true;
      }
      if (normalized === "false" || normalized === "no" || normalized === "disabled") {
        return false;
      }
    }
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildFallbackTriggerReference(prefix: string, organizationId: string, type: string, date: string | null) {
  return `${prefix}:${organizationId}:${type}:${date ?? "undated"}`;
}
