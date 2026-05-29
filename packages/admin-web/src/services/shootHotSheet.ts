import { getShootContext } from "./mockStudioServices";
import type { LocationHistoricalContext, ShootDetail, ShootLocationEvaluation, ShootLocationPhoto, ShootSummary } from "../types";

export type ShootBoardWindow = "today" | "3day" | "week" | "30day";
export type ShootCardCategory = "schools" | "sports" | "events" | "studio";
export type ShootAlertKind = "special_gear" | "staffing" | "missing_data" | "weather" | "sync";
export type SpecialGearType = "risers" | "turf" | "flags" | "qrs" | "carpet" | "lastolites" | "grey backgrounds";

export type ShootAlertIndicator = {
  kind: ShootAlertKind;
  label: string;
  tone: "info" | "warning" | "critical";
  detail: string;
};

export type ShootBriefingContact = {
  label: string;
  name: string;
  phone?: string | null;
};

export type ShootBriefingPhoto = {
  id: string;
  url: string;
  caption: string;
  source: "reference" | "history" | "location";
};

export type ShootBriefingFile = {
  id: string;
  label: string;
  kind: "roster" | "schedule" | "data" | "photo" | "reference";
  href: string;
  previewable: boolean;
};

export type ShootBriefingViewModel = {
  id: string;
  shootId: string;
  shootCode: string;
  title: string;
  category: ShootCardCategory;
  categoryLabel: string;
  shootDate: string;
  timeRange: string;
  locationLine: string;
  fullAddress: string | null;
  priorityLabel: string | null;
  priorityLevel: "elevated" | "high_priority" | "big_shoot" | "critical_shoot" | null;
  priorityReasons: string[];
  profitabilityDisplay: string | null;
  arrivalLabel: string;
  shootLabel: string;
  teardownLabel: string;
  leadName: string | null;
  leadPhone: string | null;
  photographerCountLabel: string;
  staffingTone: "staffed" | "understaffed" | "watch";
  staffingDetail: string;
  specialGearSummary: string | null;
  specialGear: SpecialGearType[];
  weatherSummary: string | null;
  weatherDetail: string | null;
  weatherTone: "warning" | "critical" | null;
  travelSummary: string | null;
  driveTimeLabel: string | null;
  missingFields: string[];
  alertIndicators: ShootAlertIndicator[];
  notes: string[];
  customNeeds: string[];
  contacts: ShootBriefingContact[];
  recurringIssues: string[];
  bestPractices: string[];
  photos: ShootBriefingPhoto[];
  historicalContext: LocationHistoricalContext | null;
  files: ShootBriefingFile[];
  mapsUrl: string | null;
  statusNote: string;
};

type ShootBriefingSeed = {
  expectedPhotographers?: number;
  leadName?: string;
  leadPhone?: string;
  contacts?: ShootBriefingContact[];
  notes?: string[];
  customNeeds?: string[];
  specialGear?: SpecialGearType[];
  recurringIssues?: string[];
  bestPractices?: string[];
  weatherDetail?: string | null;
  files?: ShootBriefingFile[];
  filesExpected?: boolean;
};

const shootSeedByCode: Record<string, ShootBriefingSeed> = {
  "DEMO-001": {
    expectedPhotographers: 3,
    leadName: "Avery Olson",
    leadPhone: "(763) 555-0148",
    contacts: [
      { label: "School Contact", name: "Nina Salazar", phone: "(763) 555-0132" },
      { label: "Custodian", name: "Rob Jensen", phone: "(763) 555-0177" }
    ],
    notes: [
      "Open with the family greeting lane before moving to the tree-line hero setup.",
      "Keep the unload flow tight on the north lot after 4 PM dismissal traffic starts."
    ],
    customNeeds: [
      "Cap-and-gown styling should be confirmed before the first hero frame.",
      "Family asked for a calm pacing update halfway through the session."
    ],
    recurringIssues: [
      "Wrap timing has drifted when outfit changes are not called early.",
      "North lot traffic tightens quickly near school release."
    ],
    bestPractices: [
      "Use the stone wall setup after 4:30 PM when the light softens.",
      "Call the family greeting window five minutes before unload to keep arrival warm and smooth."
    ],
    filesExpected: true,
    files: [
      buildDownloadFile("demo-001-roster", "Senior Session Roster", "roster", "text/csv", "student_name,time_slot\nHazel Kim,15:00\nEli Kim,15:20\n"),
      buildDownloadFile("demo-001-schedule", "Arrival Flow Notes", "schedule", "text/plain", "North lot unload.\nTree-line hero setup second.\nCap-and-gown styling check before first frame.\n")
    ]
  },
  "DEMO-002": {
    expectedPhotographers: 4,
    leadName: "Casey Mueller",
    leadPhone: "(763) 555-0189",
    contacts: [
      { label: "League Contact", name: "Coach Riley Hart", phone: "(763) 555-0161" },
      { label: "Custodian", name: "East Gate Office", phone: "(763) 555-0108" }
    ],
    notes: [
      "Thunderstorm watch means the indoor backup lane has to stay live until the first team rotation clears.",
      "Athlete flow is fastest when the east gate staging stays clean."
    ],
    customNeeds: [
      "Coach wants a live pacing update if the line falls behind one team rotation.",
      "Keep signage off the turf and stage weighted gear along the sideline only."
    ],
    specialGear: ["turf", "flags", "qrs", "grey backgrounds"],
    recurringIssues: [
      "West lot traffic can wipe out the last five minutes of arrival buffer.",
      "Outdoor lighting needs a faster decision point when cloud cover shifts."
    ],
    bestPractices: [
      "Unload at the east athlete gate first and keep a runner by the fieldhouse door.",
      "Preset the indoor backup lane before athlete warmups begin."
    ],
    weatherDetail: "Thunderstorm watch overlaps the outdoor setup window, so the indoor backup lane should stay prepped until the first team rotation clears.",
    filesExpected: true,
    files: [
      buildDownloadFile("demo-002-roster", "Athlete Rotation Roster", "roster", "text/csv", "team,start_lane\nVarsity,15:00\nJV,15:20\n"),
      buildDownloadFile("demo-002-gear", "Special Gear Notes", "data", "text/plain", "Turf staging only.\nFlags on the indoor backup lane.\nGrey backgrounds ready by the fieldhouse wall.\n")
    ]
  }
};

export function buildShootBriefing(summary: ShootSummary, detail?: ShootDetail | null): ShootBriefingViewModel {
  const context = getShootContext(summary.shoot_code);
  const seed = shootSeedByCode[summary.shoot_code] ?? {};
  const category = getShootCategory(summary.shoot_category ?? summary.department);
  const staffedCount = Number(summary.scheduled_employee_count ?? detail?.shifts?.length ?? 0);
  const expectedCount = Number(summary.planned_staff_count ?? seed.expectedPhotographers ?? Math.max(staffedCount, 1));
  const leadName = summary.lead_name ?? seed.leadName ?? inferLeadFromDetail(detail) ?? null;
  const leadPhone = seed.leadPhone ?? null;
  const requiredLeadCount = Math.max(Number(summary.required_lead_count ?? 1), 1);
  const leadCoverageCount = Number(summary.lead_coverage_count ?? (leadName ? 1 : 0));
  const missingLead = Boolean(summary.missing_lead ?? leadCoverageCount < requiredLeadCount);
  const conflictWarningCount = Number(summary.conflict_warning_count ?? 0);
  const overStaffed = Boolean(summary.over_staffed ?? (expectedCount > 0 && staffedCount > expectedCount));
  const priorityLevel =
    summary.priority_label && summary.priority_label !== "standard"
      ? (summary.priority_label as "elevated" | "high_priority" | "big_shoot" | "critical_shoot")
      : null;
  const missingFields = buildMissingFields(summary, {
    leadName,
    staffedCount,
    hasFiles: Boolean((seed.files?.length ?? 0) || detail?.media?.length),
    filesExpected: seed.filesExpected ?? false
  });
  const historyFromLocation = buildHistoryFromLocation(detail?.location_intelligence?.recent_evaluations ?? []);
  const photos = buildPhotos(context.setupPhotos, detail?.location_intelligence?.recent_photos ?? []);
  const files = buildFiles(seed.files ?? [], detail?.media ?? [], photos);
  const weather = getWeatherPresentation(summary.shoot_code, seed.weatherDetail);
  const specialGear = seed.specialGear ?? [];
  const structuredContacts = buildStructuredContacts(summary);
  const alertIndicators = buildAlertIndicators({
    specialGear,
    staffedCount,
    expectedCount,
    missingLead,
    conflictWarningCount,
    missingFields,
    weather,
    integration: summary.integration ?? null
  });

  return {
    id: summary.id,
    shootId: summary.id,
    shootCode: summary.shoot_code,
    title: summary.title,
    category,
    categoryLabel: getCategoryLabel(category),
    shootDate: summary.shoot_date ?? deriveShootDate(summary),
    timeRange: buildCollapsedTimeRange(summary),
    locationLine: getCollapsedLocation(summary),
    fullAddress: summary.location_address ?? null,
    priorityLabel: summary.priority_label_display ?? null,
    priorityLevel,
    priorityReasons: (summary.priority_reasons ?? []).map((reason) => reason.label),
    profitabilityDisplay: summary.future_profitability_display ?? null,
    arrivalLabel: formatTimeLabel(summary.arrival_time),
    shootLabel: buildExpandedShootLabel(summary),
    teardownLabel: formatTimeLabel(summary.end_time_est),
    leadName,
    leadPhone,
    photographerCountLabel: buildPhotographerCountLabel(staffedCount, expectedCount),
    staffingTone: missingLead ? "watch" : overStaffed ? "watch" : staffedCount >= expectedCount ? "staffed" : staffedCount > 0 ? "understaffed" : "watch",
    staffingDetail: missingLead
      ? "Lead-qualified coverage still needed"
      : overStaffed
        ? `${staffedCount - expectedCount} extra photographer${staffedCount - expectedCount === 1 ? "" : "s"} assigned`
        : staffedCount >= expectedCount
          ? "Properly staffed"
          : `${expectedCount - staffedCount} more photographer${expectedCount - staffedCount === 1 ? "" : "s"} needed`,
    specialGearSummary: specialGear.length ? `${specialGear.length} gear item${specialGear.length === 1 ? "" : "s"}` : null,
    specialGear,
    weatherSummary: weather.summary,
    weatherDetail: weather.detail,
    weatherTone: weather.tone,
    travelSummary: context.travelRisk.summary,
    driveTimeLabel: summary.estimated_drive_minutes != null ? `${summary.estimated_drive_minutes} min from office` : null,
    missingFields,
    alertIndicators,
    notes: [
      ...(seed.notes ?? []),
      ...(summary.special_instructions ? [summary.special_instructions] : []),
      ...(summary.access_notes ? [`Access: ${summary.access_notes}`] : []),
      ...context.preServiceInfo
    ].slice(0, 4),
    customNeeds: [
      ...(seed.customNeeds ?? []),
      ...(summary.additional_products ? [`Products: ${summary.additional_products}`] : []),
      ...(summary.special_equipment ? [`Equipment: ${summary.special_equipment}`] : []),
      ...(summary.setup_notes ? [`Setup: ${summary.setup_notes}`] : []),
      ...(summary.day_of_notes ? [`Day-of: ${summary.day_of_notes}`] : [])
    ].slice(0, 5),
    contacts: structuredContacts.length ? structuredContacts : seed.contacts ?? [],
    recurringIssues: uniqueStrings([...(seed.recurringIssues ?? []), ...historyFromLocation.recurringIssues]),
    bestPractices: uniqueStrings([...(seed.bestPractices ?? []), ...historyFromLocation.bestPractices]),
    photos,
    historicalContext: detail?.location_intelligence?.historical_context ?? null,
    files,
    mapsUrl: summary.navigation_url ?? null,
    statusNote: missingLead
      ? "Lead-qualified coverage is still open."
      : conflictWarningCount > 0
        ? `${conflictWarningCount} staffing conflict warning${conflictWarningCount === 1 ? "" : "s"} need review.`
        : summary.integration?.manual_review_required
          ? summary.integration.review_reason ?? "Outlook changed a linked field and this shoot needs review."
          : summary.schedule_sync_required
            ? "Schedule sync is still pending for this shoot."
            : summary.integration?.last_sync_error
              ? summary.integration.last_sync_error
          : detail?.alerts?.some((alert) => alert.status !== "resolved")
            ? "Open alerts are attached to this shoot."
            : "No unresolved operational alerts are attached right now."
  };
}

export function getShootWindowRange(anchorDate: string, window: ShootBoardWindow) {
  const anchor = parseDateOnly(anchorDate);
  if (window === "today") {
    return { start: anchorDate, end: anchorDate };
  }
  if (window === "3day") {
    return {
      start: formatDateOnly(anchor),
      end: formatDateOnly(addDays(anchor, 2))
    };
  }
  if (window === "week") {
    const weekday = anchor.getDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    const monday = addDays(anchor, mondayOffset);
    return {
      start: formatDateOnly(monday),
      end: formatDateOnly(addDays(monday, 6))
    };
  }
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return {
    start: formatDateOnly(monthStart),
    end: formatDateOnly(monthEnd)
  };
}

export function buildMonthGrid(anchorDate: string) {
  const anchor = parseDateOnly(anchorDate);
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const firstColumnOffset = (monthStart.getDay() + 6) % 7;
  const gridStart = addDays(monthStart, -firstColumnOffset);
  const grid: Array<{ dateKey: string; dayOfMonth: number; inCurrentMonth: boolean }> = [];

  for (let index = 0; index < 42; index += 1) {
    const date = addDays(gridStart, index);
    grid.push({
      dateKey: formatDateOnly(date),
      dayOfMonth: date.getDate(),
      inCurrentMonth: date >= monthStart && date <= monthEnd
    });
  }

  return grid;
}

export function groupShootsByDay(shoots: ShootSummary[]) {
  const groups = new Map<string, ShootSummary[]>();
  for (const shoot of shoots) {
    const key = shoot.shoot_date ?? deriveShootDate(shoot);
    const existing = groups.get(key);
    if (existing) {
      existing.push(shoot);
    } else {
      groups.set(key, [shoot]);
    }
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dateKey, dayShoots]) => ({
      dateKey,
      label: new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric"
      }),
      shoots: dayShoots.sort(compareShootSummary)
    }));
}

function buildAlertIndicators(input: {
  specialGear: SpecialGearType[];
  staffedCount: number;
  expectedCount: number;
  missingLead: boolean;
  conflictWarningCount: number;
  missingFields: string[];
  weather: { summary: string | null; detail: string | null; tone: "warning" | "critical" | null };
  integration: ShootSummary["integration"] | null;
}) {
  const alerts: ShootAlertIndicator[] = [];
  if (input.specialGear.length) {
    alerts.push({
      kind: "special_gear",
      label: "Gear",
      tone: "warning",
      detail: `Special gear required: ${input.specialGear.join(", ")}`
    });
  }
  if (input.missingLead) {
    alerts.push({
      kind: "staffing",
      label: "Lead",
      tone: "critical",
      detail: "A lead-qualified photographer is still required."
    });
  }
  if (input.staffedCount < input.expectedCount) {
    alerts.push({
      kind: "staffing",
      label: "Staff",
      tone: "critical",
      detail: `${input.expectedCount - input.staffedCount} additional photographer${input.expectedCount - input.staffedCount === 1 ? "" : "s"} still needed`
    });
  }
  if (input.conflictWarningCount > 0) {
    alerts.push({
      kind: "staffing",
      label: "Conflict",
      tone: "warning",
      detail: `${input.conflictWarningCount} staffing conflict warning${input.conflictWarningCount === 1 ? "" : "s"} need review`
    });
  }
  if (input.missingFields.length) {
    alerts.push({
      kind: "missing_data",
      label: "Data",
      tone: "warning",
      detail: `Missing: ${input.missingFields.join(", ")}`
    });
  }
  if (input.weather.summary && input.weather.tone) {
    alerts.push({
      kind: "weather",
      label: "Wx",
      tone: input.weather.tone,
      detail: input.weather.detail ?? input.weather.summary
    });
  }
  if (input.integration?.manual_review_required) {
    alerts.push({
      kind: "sync",
      label: "Sync",
      tone: "warning",
      detail: input.integration.review_reason ?? "Outlook changed a linked field and this shoot needs review."
    });
  } else if (input.integration?.last_sync_error) {
    alerts.push({
      kind: "sync",
      label: "Sync",
      tone: "critical",
      detail: input.integration.last_sync_error
    });
  } else if (input.integration?.sync_required) {
    alerts.push({
      kind: "sync",
      label: "Sync",
      tone: "info",
      detail: "Mission Control changes are ready for an explicit Outlook push."
    });
  }
  return alerts;
}

function buildMissingFields(
  summary: ShootSummary,
  context: { leadName: string | null; staffedCount: number; hasFiles: boolean; filesExpected: boolean }
) {
  const missing: string[] = [];
  if (!summary.start_time) {
    missing.push("shoot time");
  }
  if (!summary.arrival_time) {
    missing.push("arrival time");
  }
  if (!summary.location_name && !summary.location_address) {
    missing.push("location");
  }
  if (!context.leadName) {
    missing.push("senior photographer");
  }
  if (context.staffedCount <= 0) {
    missing.push("staffing count");
  }
  if (summary.estimated_drive_minutes == null) {
    missing.push("drive time");
  }
  if (context.filesExpected && !context.hasFiles) {
    missing.push("files");
  }
  return missing;
}

function buildExpandedShootLabel(summary: ShootSummary) {
  const start = formatTimeLabel(summary.start_time);
  const end = formatTimeLabel(summary.end_time_est);
  if (start === "TBD" && end === "TBD") {
    return "Shoot window pending";
  }
  return `${start} - ${end}`;
}

function buildCollapsedTimeRange(summary: ShootSummary) {
  const start = summary.start_time ?? summary.arrival_time;
  const end = summary.end_time_est ?? summary.start_time;
  if (!start && !end) {
    return "Time pending";
  }
  if (!start) {
    return `Until ${formatTimeLabel(end)}`;
  }
  if (!end) {
    return `From ${formatTimeLabel(start)}`;
  }
  return `${formatTimeLabel(start)} - ${formatTimeLabel(end)}`;
}

function buildPhotographerCountLabel(staffedCount: number, expectedCount: number) {
  if (expectedCount <= staffedCount) {
    return `${staffedCount} photographers`;
  }
  return `${staffedCount}/${expectedCount} photographers`;
}

function buildFiles(seedFiles: ShootBriefingFile[], media: ShootDetail["media"], photos: ShootBriefingPhoto[]) {
  const files = [...seedFiles];
  for (const asset of media ?? []) {
    if (!asset.url) {
      continue;
    }
    files.push({
      id: `media-${asset.id}`,
      label: humanizeAssetKind(asset.kind),
      kind: asset.kind === "photo" ? "photo" : "reference",
      href: asset.url,
      previewable: isPreviewableHref(asset.url)
    });
  }
  for (const photo of photos.slice(0, 2)) {
    files.push({
      id: `photo-${photo.id}`,
      label: photo.caption,
      kind: "photo",
      href: photo.url,
      previewable: true
    });
  }
  return uniqueById(files);
}

function buildHistoryFromLocation(evaluations: ShootLocationEvaluation[]) {
  return {
    recurringIssues: uniqueStrings(
      evaluations.flatMap((evaluation) => [evaluation.late_details, evaluation.access_details, evaluation.notes].filter(Boolean) as string[])
    ),
    bestPractices: uniqueStrings(evaluations.flatMap((evaluation) => [evaluation.recommendations].filter(Boolean) as string[]))
  };
}

function buildPhotos(referencePhotos: Array<{ src: string; caption: string }>, locationPhotos: ShootLocationPhoto[]) {
  const photos: ShootBriefingPhoto[] = [];
  for (const [index, photo] of referencePhotos.slice(0, 2).entries()) {
    photos.push({
      id: `reference-${index + 1}`,
      url: photo.src,
      caption: photo.caption,
      source: "reference"
    });
  }
  for (const photo of locationPhotos.slice(0, 2)) {
    photos.push({
      id: `location-${photo.id}`,
      url: photo.image_url,
      caption: photo.caption,
      source: "location"
    });
  }
  return uniqueById(photos);
}

function getCollapsedLocation(summary: ShootSummary) {
  if (hasUsefulLocationName(summary.location_name)) {
    return summary.location_name;
  }
  if (summary.location_address) {
    return shortenAddress(summary.location_address);
  }
  return "";
}

function getShootCategory(categoryOrDepartment?: string | null): ShootCardCategory {
  if (categoryOrDepartment === "sports") {
    return "sports";
  }
  if (categoryOrDepartment === "schools") {
    return "schools";
  }
  if (categoryOrDepartment === "studio" || categoryOrDepartment === "production") {
    return "studio";
  }
  return "events";
}

function buildStructuredContacts(summary: ShootSummary): ShootBriefingContact[] {
  const contacts: ShootBriefingContact[] = [];
  if (summary.primary_contact_name) {
    contacts.push({
      label: "Primary Contact",
      name: summary.primary_contact_name,
      phone: summary.primary_contact_phone ?? undefined
    });
  }
  if (summary.secondary_contact_name) {
    contacts.push({
      label: "Additional Contact",
      name: summary.secondary_contact_name,
      phone: summary.secondary_contact_phone ?? undefined
    });
  }
  for (const contact of summary.additional_contacts ?? []) {
    if (!contact.full_name || contact.full_name === summary.secondary_contact_name) {
      continue;
    }
    contacts.push({
      label: "Additional Contact",
      name: contact.full_name,
      phone: contact.phone ?? undefined
    });
  }
  return contacts;
}

function getCategoryLabel(category: ShootCardCategory) {
  if (category === "sports") {
    return "Sports";
  }
  if (category === "schools") {
    return "Schools";
  }
  return "Events";
}

function getWeatherPresentation(shootCode: string, detail: string | null | undefined) {
  const context = getShootContext(shootCode);
  if (context.weatherRisk.level === "low") {
    return {
      summary: null,
      detail: null,
      tone: null
    } as const;
  }
  return {
    summary: context.weatherRisk.summary,
    detail: detail ?? context.weatherRisk.summary,
    tone: context.weatherRisk.level === "high" ? "critical" : "warning"
  } as const;
}

function deriveShootDate(summary: ShootSummary) {
  return summary.start_time?.slice(0, 10) ?? summary.arrival_time?.slice(0, 10) ?? summary.end_time_est?.slice(0, 10) ?? formatDateOnly(new Date());
}

function compareShootSummary(left: ShootSummary, right: ShootSummary) {
  const leftTime = new Date(left.arrival_time ?? left.start_time ?? `${deriveShootDate(left)}T00:00:00`).getTime();
  const rightTime = new Date(right.arrival_time ?? right.start_time ?? `${deriveShootDate(right)}T00:00:00`).getTime();
  return leftTime - rightTime;
}

function formatTimeLabel(value?: string | null) {
  if (!value) {
    return "TBD";
  }
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatDateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function addDays(value: Date, amount: number) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + amount);
}

function hasUsefulLocationName(value?: string | null) {
  if (!value) {
    return false;
  }
  return !/^(tbd|location pending|address pending|venue pending)$/i.test(value.trim());
}

function shortenAddress(address: string) {
  return address.split(",").slice(0, 2).join(", ");
}

function buildDownloadFile(id: string, label: string, kind: ShootBriefingFile["kind"], mime: string, content: string): ShootBriefingFile {
  return {
    id,
    label,
    kind,
    href: `data:${mime};charset=utf-8,${encodeURIComponent(content)}`,
    previewable: mime.startsWith("text/")
  };
}

function humanizeAssetKind(kind: string) {
  return kind.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function inferLeadFromDetail(detail?: ShootDetail | null) {
  const candidate =
    detail?.shifts?.find((shift) => /lead|senior/i.test(shift.shift_kind) || /lead|senior/i.test(shift.assigned_user_name)) ??
    detail?.shifts?.[0];
  return candidate?.assigned_user_name ?? null;
}

function isPreviewableHref(value: string) {
  return /^data:text\//.test(value) || /\.(png|jpe?g|gif|svg|webp|pdf)$/i.test(value);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueById<T extends { id: string }>(values: T[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.id)) {
      return false;
    }
    seen.add(value.id);
    return true;
  });
}
