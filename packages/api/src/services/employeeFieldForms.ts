import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { createAuditLog } from "./audit.js";
import { createOperationalNote } from "./operationalNotes.js";
import { findNotificationRecipients, queueNotificationDispatch } from "./opsNotifications.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export const employeeFieldFormTypes = [
  "field_issue_report",
  "location_memory_suggestion",
  "directory_update_suggestion",
  "staffing_help_request"
] as const;

export type EmployeeFieldFormType = (typeof employeeFieldFormTypes)[number];

export type FieldIssueCategory =
  | "staffing"
  | "attendance_no_show"
  | "setup_room_problem"
  | "parking_load_in"
  | "school_readiness"
  | "data_roster"
  | "equipment_technical"
  | "lighting_environment"
  | "line_flow_traffic"
  | "student_parent_flow"
  | "communication_contact_issue"
  | "special_product_deliverable_issue"
  | "other";

export type FieldIssueSeverity = "minor" | "major" | "immediate_help_needed";

export type LocationMemorySuggestionType =
  | "parking_load_in"
  | "entrance_check_in"
  | "setup_guidance"
  | "staffing_recommendation"
  | "day_of_coordination"
  | "top_watch_out";

export type DirectoryUpdateSuggestionType =
  | "contact_info_changed"
  | "title_changed"
  | "new_contact"
  | "wrong_contact"
  | "owner_change_suggestion";

export type StaffingHelpRequestType =
  | "running_late"
  | "cannot_cover"
  | "need_replacement"
  | "team_member_missing"
  | "coverage_at_risk";

export type EmployeeFieldFormInput =
  | {
      form_type: "field_issue_report";
      issue_category: FieldIssueCategory;
      severity: FieldIssueSeverity;
      summary: string;
      note?: string | null;
      follow_up_needed?: boolean;
      attachment_refs?: unknown[];
    }
  | {
      form_type: "location_memory_suggestion";
      memory_type: LocationMemorySuggestionType;
      summary: string;
      why_it_matters?: string | null;
      useful_for_future_crews?: boolean;
      attachment_refs?: unknown[];
    }
  | {
      form_type: "directory_update_suggestion";
      update_type: DirectoryUpdateSuggestionType;
      subject_name?: string | null;
      summary: string;
      suggested_change?: string | null;
      attachment_refs?: unknown[];
    }
  | {
      form_type: "staffing_help_request";
      issue_type: StaffingHelpRequestType;
      severity: FieldIssueSeverity;
      summary: string;
      requested_partner_user_id?: string | null;
      attachment_refs?: unknown[];
    };

type OwnedShiftContext = {
  id: string;
  assigned_user_id: string;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  organization_id: string | null;
  organization_display_name: string | null;
  location_id: string | null;
  location_name: string | null;
  location_address: string | null;
  department: string | null;
  title: string;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean;
  starts_at: string;
  ends_at: string;
  manager_user_id: string | null;
  manager_name: string | null;
};

function humanizeCode(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sanitizeAttachmentRefs(value: unknown) {
  return Array.isArray(value) ? value.slice(0, 10) : [];
}

async function loadOwnedShiftContext(client: PoolClient, auth: AuthUser, shiftId: string): Promise<OwnedShiftContext> {
  const { rows } = await client.query<OwnedShiftContext>(
    `
      SELECT
        ws.id,
        ws.assigned_user_id,
        ws.shoot_id,
        s.shoot_code,
        s.title AS shoot_title,
        s.organization_id,
        org.display_name AS organization_display_name,
        s.location_id,
        ws.location_name,
        ws.location_address,
        ws.department::text,
        ws.title,
        ws.staffing_role::text,
        ws.satisfies_lead_coverage,
        ws.starts_at::text,
        ws.ends_at::text,
        ws.manager_user_id,
        manager.full_name AS manager_name
      FROM work_shift ws
      LEFT JOIN shoot s ON s.id = ws.shoot_id
      LEFT JOIN organization org ON org.id = s.organization_id
      LEFT JOIN app_user manager ON manager.id = ws.manager_user_id
      WHERE ws.tenant_id = $1
        AND ws.id = $2
        AND ws.cancelled_at IS NULL
      LIMIT 1
    `,
    [auth.tenantId, shiftId]
  );

  const shift = rows[0];
  if (!shift) {
    throw new ApiError(404, "Shift not found");
  }
  if (String(shift.assigned_user_id) !== auth.id) {
    throw new ApiError(403, "You can only submit mobile field workflows for your own assignments.");
  }
  return shift;
}

function buildShiftReferenceLine(shift: OwnedShiftContext) {
  const subject = shift.shoot_code ? `${shift.shoot_code} | ${shift.shoot_title ?? shift.title}` : shift.shoot_title ?? shift.title;
  return `Shift: ${subject}`;
}

function buildLocationReferenceLine(shift: OwnedShiftContext) {
  return `Location: ${shift.location_name ?? "Unassigned"}${shift.location_address ? ` | ${shift.location_address}` : ""}`;
}

function buildFieldIssueBody(auth: AuthUser, shift: OwnedShiftContext, input: Extract<EmployeeFieldFormInput, { form_type: "field_issue_report" }>) {
  const lines = [
    "Field Issue Report",
    buildShiftReferenceLine(shift),
    buildLocationReferenceLine(shift),
    `Submitted by: ${auth.fullName}`,
    `Category: ${humanizeCode(input.issue_category)}`,
    `Severity: ${humanizeCode(input.severity)}`,
    `Summary: ${input.summary.trim()}`
  ];
  if (input.note?.trim()) {
    lines.push(`Additional Detail: ${input.note.trim()}`);
  }
  if (input.follow_up_needed) {
    lines.push("Follow-Up Needed: Yes");
  }
  return lines.join("\n");
}

function buildLocationMemoryBody(auth: AuthUser, shift: OwnedShiftContext, input: Extract<EmployeeFieldFormInput, { form_type: "location_memory_suggestion" }>) {
  const lines = [
    "Location Memory Suggestion",
    buildShiftReferenceLine(shift),
    buildLocationReferenceLine(shift),
    `Submitted by: ${auth.fullName}`,
    `Memory Type: ${humanizeCode(input.memory_type)}`,
    `Suggestion: ${input.summary.trim()}`
  ];
  if (input.why_it_matters?.trim()) {
    lines.push(`Why It Matters: ${input.why_it_matters.trim()}`);
  }
  if (input.useful_for_future_crews) {
    lines.push("Useful For Future Crews: Yes");
  }
  return lines.join("\n");
}

function buildDirectoryUpdateBody(auth: AuthUser, shift: OwnedShiftContext, input: Extract<EmployeeFieldFormInput, { form_type: "directory_update_suggestion" }>) {
  const lines = [
    "Directory Update Suggestion",
    buildShiftReferenceLine(shift),
    `Organization: ${shift.organization_display_name ?? "Unlinked organization"}`,
    buildLocationReferenceLine(shift),
    `Submitted by: ${auth.fullName}`,
    `Update Type: ${humanizeCode(input.update_type)}`,
    `Summary: ${input.summary.trim()}`
  ];
  if (input.subject_name?.trim()) {
    lines.push(`Contact / Subject: ${input.subject_name.trim()}`);
  }
  if (input.suggested_change?.trim()) {
    lines.push(`Suggested Change: ${input.suggested_change.trim()}`);
  }
  return lines.join("\n");
}

function buildStaffingHelpBody(auth: AuthUser, shift: OwnedShiftContext, input: Extract<EmployeeFieldFormInput, { form_type: "staffing_help_request" }>) {
  const lines = [
    "Staffing Help / Coverage Request",
    buildShiftReferenceLine(shift),
    buildLocationReferenceLine(shift),
    `Submitted by: ${auth.fullName}`,
    `Issue Type: ${humanizeCode(input.issue_type)}`,
    `Severity: ${humanizeCode(input.severity)}`,
    `Summary: ${input.summary.trim()}`
  ];
  if (input.requested_partner_user_id) {
    lines.push(`Requested Partner User: ${input.requested_partner_user_id}`);
  }
  if (shift.satisfies_lead_coverage || shift.staffing_role === "lead_photographer" || shift.staffing_role === "senior_photographer") {
    lines.push("Coverage Risk: Lead or senior coverage may be affected.");
  }
  return lines.join("\n");
}

function buildNotificationSpec(shift: OwnedShiftContext, input: EmployeeFieldFormInput) {
  switch (input.form_type) {
    case "field_issue_report":
      return {
        eventCode:
          input.severity === "immediate_help_needed"
            ? "attendance.field_issue_immediate"
            : input.severity === "major"
              ? "attendance.field_issue_major"
              : "attendance.field_issue_minor",
        notificationType:
          input.severity === "immediate_help_needed"
            ? "attendance.field_issue_immediate"
            : input.severity === "major"
              ? "attendance.field_issue_major"
              : "attendance.field_issue_minor",
        title: input.severity === "immediate_help_needed" ? "Immediate field issue needs help" : "Field issue reported",
        body: `${shift.shoot_code ?? shift.title}: ${input.summary.trim()}`,
        category: "urgent_operational_risk" as const,
        severity: input.severity === "immediate_help_needed" ? "critical" as const : input.severity === "major" ? "high" as const : "medium" as const,
        actionRequired: true,
        requiresAcknowledgement: input.severity === "immediate_help_needed",
        allowSnooze: input.severity !== "immediate_help_needed"
      };
    case "location_memory_suggestion":
      return {
        eventCode: "shoot.closeout_location_memory_suggestion",
        notificationType: "shoot.closeout_location_memory_suggestion",
        title: "Location memory suggestion needs review",
        body: `${shift.location_name ?? shift.title}: ${input.summary.trim()}`,
        category: "follow_up_task" as const,
        severity: "medium" as const,
        actionRequired: true,
        requiresAcknowledgement: false,
        allowSnooze: true
      };
    case "directory_update_suggestion":
      return {
        eventCode: "schedule.directory_update_suggestion",
        notificationType: "schedule.directory_update_suggestion",
        title: "Directory update suggestion submitted",
        body: `${shift.organization_display_name ?? shift.location_name ?? shift.title}: ${input.summary.trim()}`,
        category: "follow_up_task" as const,
        severity: "medium" as const,
        actionRequired: true,
        requiresAcknowledgement: false,
        allowSnooze: true
      };
    case "staffing_help_request":
      return {
        eventCode: "schedule.staffing.help_request",
        notificationType: "schedule.staffing.help_request",
        title: input.severity === "immediate_help_needed" ? "Immediate coverage help requested" : "Coverage help requested",
        body: `${shift.shoot_code ?? shift.title}: ${input.summary.trim()}`,
        category: "staffing" as const,
        severity: input.severity === "immediate_help_needed" ? "critical" as const : input.severity === "major" ? "high" as const : "medium" as const,
        actionRequired: true,
        requiresAcknowledgement: input.severity === "immediate_help_needed",
        allowSnooze: input.severity !== "immediate_help_needed"
      };
  }
}

function buildSubmitOutcome(input: EmployeeFieldFormInput) {
  switch (input.form_type) {
    case "field_issue_report":
      return "Submitted for manager review. Immediate issues alert the manager chain right away.";
    case "location_memory_suggestion":
      return "Submitted for review. A manager can promote this into reusable location memory.";
    case "directory_update_suggestion":
      return "Submitted for review. Directory owners will verify the change before updating the record.";
    case "staffing_help_request":
      return "Submitted for coverage review. Staffing risk is now visible to the manager chain.";
  }
}

function buildSourceContext(input: EmployeeFieldFormInput) {
  return `mobile_${input.form_type}`;
}

function buildNotePayload(auth: AuthUser, shift: OwnedShiftContext, input: EmployeeFieldFormInput) {
  switch (input.form_type) {
    case "field_issue_report":
      return {
        body: buildFieldIssueBody(auth, shift, input),
        noteType: input.severity === "minor" ? "temporary_note" as const : "operational_update" as const,
        attachmentRefs: sanitizeAttachmentRefs(input.attachment_refs)
      };
    case "location_memory_suggestion":
      return {
        body: buildLocationMemoryBody(auth, shift, input),
        noteType: "temporary_note" as const,
        attachmentRefs: sanitizeAttachmentRefs(input.attachment_refs)
      };
    case "directory_update_suggestion":
      return {
        body: buildDirectoryUpdateBody(auth, shift, input),
        noteType: "temporary_note" as const,
        attachmentRefs: sanitizeAttachmentRefs(input.attachment_refs)
      };
    case "staffing_help_request":
      return {
        body: buildStaffingHelpBody(auth, shift, input),
        noteType: "operational_update" as const,
        attachmentRefs: sanitizeAttachmentRefs(input.attachment_refs)
      };
  }
}

function buildDeepLink(shift: OwnedShiftContext) {
  return shift.shoot_id ? `#operations/shoots?shoot=${encodeURIComponent(shift.shoot_id)}` : "#operations/schedule";
}

export async function submitEmployeeFieldForm(
  client: PoolClient,
  auth: AuthUser,
  shiftId: string,
  input: EmployeeFieldFormInput,
  meta: RequestMeta
) {
  const shift = await loadOwnedShiftContext(client, auth, shiftId);
  const notePayload = buildNotePayload(auth, shift, input);
  const sourceContext = buildSourceContext(input);

  const note = await createOperationalNote(
    client,
    auth,
    {
      objectType: "shift",
      objectId: shift.id,
      noteType: notePayload.noteType,
      body: notePayload.body,
      visibilityScope: "assigned_staff_and_managers",
      sourceContext,
      attachmentRefs: notePayload.attachmentRefs
    },
    meta
  );

  const notification = buildNotificationSpec(shift, input);
  const recipients = await findNotificationRecipients(client, {
    tenantId: auth.tenantId,
    eventCode: notification.eventCode,
    shiftId: shift.id,
    shootId: shift.shoot_id,
    directUserIds: shift.manager_user_id ? [shift.manager_user_id] : [],
    excludeUserIds: [auth.id]
  });

  if (recipients.length) {
    await queueNotificationDispatch(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      recipientUserIds: recipients,
      notificationType: notification.notificationType,
      title: notification.title,
      body: notification.body,
      shiftId: shift.id,
      shootId: shift.shoot_id,
      deepLink: buildDeepLink(shift),
      category: notification.category,
      severity: notification.severity,
      actionRequired: notification.actionRequired,
      requiresAcknowledgement: notification.requiresAcknowledgement,
      allowSnooze: notification.allowSnooze,
      metadata: {
        form_type: input.form_type,
        source_context: sourceContext,
        operational_note_id: note.id
      }
    });
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: auth.id,
    action: "employee.field_form.submitted",
    entityType: "operational_note",
    entityId: note.id,
    metadata: {
      form_type: input.form_type,
      shift_id: shift.id,
      shoot_id: shift.shoot_id,
      source_context: sourceContext
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return {
    form_type: input.form_type,
    submission_state: "submitted" as const,
    review_state: "needs_review" as const,
    next_step_message: buildSubmitOutcome(input),
    related_shift: {
      id: shift.id,
      title: shift.title,
      shoot_id: shift.shoot_id,
      shoot_code: shift.shoot_code,
      location_name: shift.location_name
    },
    derived_record: {
      type: "operational_note" as const,
      id: note.id,
      source_context: sourceContext
    },
    notification_recipients_count: recipients.length
  };
}
