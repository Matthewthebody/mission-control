import type { SharedJobDay, SharedJobDetailResponse, SharedJobStaffAssignment } from "../jobTruthTypes";
import type { PreCallContextDefinition, PreCallContextItem, PreCallContextSection, PreCallContextTone } from "../preCallContextTypes";
import type { TeamsMeetingRecordView } from "../teamsMeetingTypes";
import type {
  DirectoryTouchpointRecord,
  OrganizationContact,
  OrganizationDetail,
  OrganizationLocation
} from "../types";
import type { SharedTaskDetailResponse } from "../workModelTypes";

function cleanText(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

function truncateText(value: string | null | undefined, max = 140) {
  const normalized = cleanText(value);
  if (!normalized) {
    return null;
  }
  return normalized.length > max ? `${normalized.slice(0, max - 1).trimEnd()}...` : normalized;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatDateOnly(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function humanizeToken(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function toItem(
  label: string,
  value: string | null | undefined,
  detail?: string | null,
  tone: PreCallContextTone = "neutral"
): PreCallContextItem | null {
  const cleanValue = cleanText(value);
  const cleanDetail = cleanText(detail);
  if (!cleanValue) {
    return null;
  }
  return {
    label,
    value: cleanValue,
    detail: cleanDetail,
    tone
  };
}

function compactSection(
  key: string,
  title: string,
  items: Array<PreCallContextItem | null | undefined>,
  emptyLabel?: string
): PreCallContextSection {
  return {
    key,
    title,
    items: items.filter(Boolean) as PreCallContextItem[],
    emptyLabel
  };
}

function buildMeetingReason(view: TeamsMeetingRecordView, fallbacks: Array<string | null | undefined>) {
  const meetingDescription = cleanText(view.meeting?.description);
  const defaultDescription = cleanText(view.defaults.suggested_description);
  if (meetingDescription && meetingDescription !== defaultDescription) {
    return meetingDescription;
  }
  const fallback = fallbacks.map((entry) => cleanText(entry)).find(Boolean);
  if (fallback) {
    return fallback;
  }
  return meetingDescription ?? defaultDescription ?? cleanText(view.meeting?.title) ?? cleanText(view.defaults.suggested_title);
}

function buildScheduleLabel(day: SharedJobDay | null, detail: SharedJobDetailResponse) {
  const date = day?.date ?? detail.summary.primary_day_date;
  const start = day?.start_time ?? detail.summary.primary_day_start_time;
  const end = day?.end_time ?? detail.summary.primary_day_end_time;
  const formattedDate = formatDateOnly(date);
  if (!formattedDate) {
    return null;
  }
  return start || end ? `${formattedDate} | ${start ?? "TBD"} - ${end ?? "TBD"}` : formattedDate;
}

function filterActiveAssignments(assignments: SharedJobStaffAssignment[], dayId: string | null) {
  return assignments
    .filter((assignment) => assignment.assignment_status !== "cancelled")
    .filter((assignment) => !dayId || !assignment.job_day_id || assignment.job_day_id === dayId)
    .slice(0, 4);
}

function buildJobIssueItems(detail: SharedJobDetailResponse) {
  const watchFlags = detail.watch_flags.slice(0, 2).map((flag) =>
    toItem(
      humanizeToken(flag.severity) ?? "Issue",
      flag.title,
      truncateText(flag.description),
      flag.severity === "critical" ? "critical" : flag.severity === "high" ? "warning" : "neutral"
    )
  );
  const blockers = detail.production_blockers.slice(0, 2).map((issue) =>
    toItem(
      "Production blocker",
      issue.title,
      truncateText(issue.description ?? issue.owner_name ?? null),
      issue.is_blocking ? "warning" : "neutral"
    )
  );
  return [...watchFlags, ...blockers];
}

export function buildJobPreCallContext(
  detail: SharedJobDetailResponse,
  selectedDay: SharedJobDay | null,
  meetingView: TeamsMeetingRecordView
): PreCallContextDefinition {
  const day = selectedDay ?? detail.days[0] ?? null;
  const staff = filterActiveAssignments(detail.staff_assignments, day?.id ?? null);
  const assignedStaffItems = staff.map((assignment) =>
    toItem(
      assignment.assignment_role,
      assignment.user_name ?? assignment.user_id,
      humanizeToken(assignment.assignment_status)
    )
  );
  const locationNotes = [
    toItem("Access", truncateText(day?.access_notes)),
    toItem("Parking", truncateText(day?.parking_notes)),
    toItem("Setup", truncateText(day?.setup_notes)),
    toItem("Travel", truncateText(day?.travel_notes))
  ];
  const callReason = buildMeetingReason(meetingView, [
    detail.watch_flags[0]?.title ? `Review ${detail.watch_flags[0].title} before the call starts.` : null,
    day?.setup_notes ? "Confirm setup, access, and day-of handoff details before starting the call." : null,
    detail.summary.organization_name ? `Coordinate ${detail.summary.organization_name} before execution moves forward.` : null
  ]);

  return {
    title: "Pre-Call Context",
    summary: "Keep the day-of basics, staff, and active issues visible before starting or joining the Teams call.",
    callReason,
    emptyLabel: "No extra job context is saved yet.",
    sections: [
      compactSection(
        "job-summary",
        "Job Summary",
        [
          toItem("Job", [detail.job.job_number, detail.job.title || detail.job.event_name].filter(Boolean).join(" | ")),
          toItem("Schedule", buildScheduleLabel(day, detail), day?.day_label ?? detail.summary.primary_day_label),
          toItem(
            "Location",
            day?.location_name ?? detail.summary.primary_location_name,
            detail.summary.organization_name ?? detail.summary.primary_location_address
          )
        ],
        "No job summary is available yet."
      ),
      compactSection(
        "people",
        "Assigned Staff",
        [
          toItem("Lead", day?.lead_user_name ?? detail.summary.lead_owner_name, day?.onsite_contact_name ? `Onsite contact: ${day.onsite_contact_name}` : null),
          ...assignedStaffItems
        ],
        "No staff assignments are attached to this job yet."
      ),
      compactSection(
        "notes",
        "Location Notes",
        locationNotes,
        "No access, parking, setup, or travel notes are saved for this job day yet."
      ),
      compactSection(
        "issues",
        "Open Issues",
        buildJobIssueItems(detail),
        "No open watch flags or production blockers are currently attached to this job."
      )
    ],
    resourceTarget: {
      objectType: "job",
      objectId: detail.job.id,
      title: "Linked Files",
      emptyLabel: "No linked job files or references yet."
    }
  };
}

export function buildTaskPreCallContext(
  detail: SharedTaskDetailResponse,
  meetingView: TeamsMeetingRecordView
): PreCallContextDefinition {
  const assignmentItems = detail.assignments.slice(0, 4).map((assignment) =>
    toItem(
      assignment.assignment_type.replace(/_/g, " "),
      assignment.user_name ?? assignment.user_id,
      humanizeToken(assignment.status)
    )
  );
  const callReason = buildMeetingReason(meetingView, [
    detail.task.blocked_reason ? `Unblock this task: ${detail.task.blocked_reason}` : null,
    detail.task.proof_required ? "Confirm proof expectations before closing the task." : null,
    detail.related_job?.title ? `Coordinate follow-through for ${detail.related_job.title}.` : null,
    detail.task.description
  ]);

  return {
    title: "Pre-Call Context",
    summary: "Show the task owner, timing, linked job, and blockers before a quick Teams handoff.",
    callReason,
    emptyLabel: "No extra task context has been recorded yet.",
    sections: [
      compactSection(
        "task-summary",
        "Task Summary",
        [
          toItem("Task", [detail.task.task_number, detail.task.title].filter(Boolean).join(" | ")),
          toItem("Status", humanizeToken(detail.task.status), humanizeToken(detail.task.priority)),
          toItem("Due", formatDateTime(detail.task.due_at), detail.task.proof_required ? "Proof is required before completion." : null)
        ],
        "Task summary is still incomplete."
      ),
      compactSection(
        "owners",
        "Task Owners",
        [
          toItem("Primary assignee", detail.task.assigned_to_name ?? detail.task.assigned_to_user_id, detail.task.assigned_team_id ? `Team: ${detail.task.assigned_team_id}` : null),
          ...assignmentItems
        ],
        "No task assignee is set yet."
      ),
      compactSection(
        "linked-job",
        "Linked Job",
        [
          toItem(
            "Job / Event",
            detail.related_job ? [detail.related_job.job_number, detail.related_job.title].filter(Boolean).join(" | ") : null,
            detail.related_job ? `${humanizeToken(detail.related_job.department_type)} | ${humanizeToken(detail.related_job.job_status)}` : null
          )
        ],
        "This task is not linked to a job yet."
      ),
      compactSection(
        "task-notes",
        "Current Notes",
        [
          toItem("Blocked reason", truncateText(detail.task.blocked_reason), null, "warning"),
          toItem("Completion note", truncateText(detail.task.completion_notes)),
          toItem("Description", truncateText(detail.task.description))
        ],
        "No additional task notes are recorded yet."
      )
    ]
  };
}

function getKeyContacts(detail: OrganizationDetail) {
  const fromOverview = detail.account_overview?.key_contacts ?? [];
  if (fromOverview.length) {
    return fromOverview.slice(0, 4);
  }
  return [...detail.contacts]
    .sort((left, right) => Number(Boolean(right.is_primary)) - Number(Boolean(left.is_primary)))
    .slice(0, 4);
}

export function buildOrganizationPreCallContext(
  detail: OrganizationDetail,
  touchpoints: DirectoryTouchpointRecord[],
  meetingView: TeamsMeetingRecordView
): PreCallContextDefinition {
  const keyContacts = getKeyContacts(detail);
  const latestTouchpoint = touchpoints[0] ?? detail.touchpoints?.[0] ?? null;
  const relationshipSummary =
    cleanText(detail.account_overview?.account_health_summary) ??
    cleanText(detail.school_profile?.relationship_summary) ??
    cleanText(detail.organization.notes);
  const callReason = buildMeetingReason(meetingView, [
    detail.next_shoot ? `Coordinate the next touchpoint before ${detail.next_shoot.title}.` : null,
    relationshipSummary,
    detail.organization.display_name ? `Align internally before reaching back out to ${detail.organization.display_name}.` : null
  ]);

  return {
    title: "Pre-Call Context",
    summary: "Put key contacts, relationship notes, and the next coordination step in view before launching Teams.",
    callReason,
    emptyLabel: "No organization context is available for this call yet.",
    sections: [
      compactSection(
        "organization-summary",
        "Organization Summary",
        [
          toItem("Organization", detail.organization.display_name, humanizeToken(detail.organization.account_type)),
          toItem("Relationship health", relationshipSummary, detail.account_overview?.contract_status ?? null),
          toItem(
            "Next shoot",
            detail.next_shoot ? detail.next_shoot.title : null,
            detail.next_shoot ? `${formatDateOnly(detail.next_shoot.shoot_date)} | ${detail.next_shoot.location_name ?? "Location TBD"}` : null
          )
        ],
        "No organization summary is available yet."
      ),
      compactSection(
        "key-contacts",
        "Key Contacts",
        keyContacts.map((contact) =>
          toItem(
            contact.full_name,
            contact.title ?? humanizeToken(contact.relationship_role) ?? "Contact",
            contact.email ?? contact.phone ?? contact.primary_internal_owner?.full_name ?? null
          )
        ),
        "No key contacts are attached to this organization yet."
      ),
      compactSection(
        "current-coordination",
        "Current Coordination",
        [
          toItem(
            "Latest touchpoint",
            latestTouchpoint?.summary ?? latestTouchpoint?.subject ?? null,
            latestTouchpoint ? `${humanizeToken(latestTouchpoint.channel)} | ${formatDateTime(latestTouchpoint.occurred_at)}` : null
          ),
          toItem(
            "Open follow-up count",
            detail.relationship_continuity ? `${detail.relationship_continuity.summary.open_follow_up_count}` : null,
            detail.relationship_continuity?.summary.next_touchpoint_label ?? null
          ),
          toItem(
            "Primary owner",
            detail.school_profile?.primary_internal_owner?.full_name ?? keyContacts[0]?.primary_internal_owner?.full_name,
            detail.school_profile?.backup_internal_owner?.full_name
              ? `Backup: ${detail.school_profile.backup_internal_owner.full_name}`
              : null
          )
        ],
        "No current coordination notes are saved yet."
      )
    ],
    resourceTarget: {
      objectType: "organization",
      objectId: detail.organization.id,
      title: "Linked Files",
      emptyLabel: "No linked organization files or references yet."
    }
  };
}

export function buildLocationPreCallContext(
  detail: OrganizationDetail,
  location: OrganizationLocation,
  contacts: OrganizationContact[],
  meetingView: TeamsMeetingRecordView
): PreCallContextDefinition {
  const callReason = buildMeetingReason(meetingView, [
    location.notes ? `Review site notes for ${location.location_name} before the call starts.` : null,
    detail.next_shoot ? `Coordinate location readiness before ${detail.next_shoot.title}.` : null,
    `Confirm access, setup, and parking for ${location.location_name}.`
  ]);

  return {
    title: "Pre-Call Context",
    summary: "Keep site access, the right people, and the latest location notes visible before you jump into Teams.",
    callReason,
    emptyLabel: "No extra location context is saved for this call yet.",
    sections: [
      compactSection(
        "location-summary",
        "Location Summary",
        [
          toItem("Location", location.location_name, detail.organization.display_name),
          toItem("Address", location.address_display ?? location.maps_label),
          toItem("Map reference", location.maps_label, location.maps_url)
        ],
        "No location summary is available yet."
      ),
      compactSection(
        "location-contacts",
        "Key Contacts",
        contacts.slice(0, 4).map((contact) =>
          toItem(
            contact.full_name,
            contact.title ?? humanizeToken(contact.relationship_role) ?? "Contact",
            contact.email ?? contact.phone ?? null
          )
        ),
        "No day-of contacts are linked to this location yet."
      ),
      compactSection(
        "site-notes",
        "Site Notes",
        [
          toItem("Location notes", truncateText(location.notes)),
          toItem(
            "Next shoot",
            detail.next_shoot?.location_name === location.location_name ? detail.next_shoot.title : null,
            detail.next_shoot?.location_name === location.location_name ? formatDateOnly(detail.next_shoot.shoot_date) : null
          )
        ],
        "No location notes are saved yet."
      )
    ],
    resourceTarget: {
      objectType: "location",
      objectId: location.id,
      title: "Linked Files",
      emptyLabel: "No linked location files or references yet."
    }
  };
}
