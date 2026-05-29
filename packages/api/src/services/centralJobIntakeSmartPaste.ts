import type { CentralJobDepartment } from "../domain/centralJobIntake/index.js";
import type {
  CentralJobCanonicalJobType,
  CentralJobIntakeInput,
  CentralJobSmartPasteConfidenceBand,
  CentralJobSmartPasteEntityCandidate,
  CentralJobSmartPasteFieldInference,
  CentralJobSmartPasteParseResult,
  CentralJobSmartPasteSourceSpan
} from "../types/centralJobIntake.js";

type CaptureMatch = {
  value: string;
  span: CentralJobSmartPasteSourceSpan;
  confidenceBand: CentralJobSmartPasteConfidenceBand;
  confidenceScore: number;
};

const DEFAULT_TIMEZONE = "America/Chicago";
const KNOWN_SPORT_NAMES = [
  "baseball",
  "basketball",
  "cheer",
  "dance",
  "football",
  "golf",
  "hockey",
  "lacrosse",
  "soccer",
  "softball",
  "swimming",
  "tennis",
  "track",
  "volleyball",
  "wrestling"
] as const;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildSourceSpan(sourceText: string, start: number, end: number): CentralJobSmartPasteSourceSpan {
  return {
    start,
    end,
    text: sourceText.slice(start, end)
  };
}

function displayValue(value: string | number | boolean | string[] | null) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (value == null) {
    return null;
  }
  return String(value);
}

function inferField(
  field: string,
  label: string,
  value: string | number | boolean | string[] | null,
  confidenceBand: CentralJobSmartPasteConfidenceBand,
  confidenceScore: number,
  sourceSpan: CentralJobSmartPasteSourceSpan | null,
  requiresConfirmation = false
): CentralJobSmartPasteFieldInference {
  return {
    field,
    label,
    value,
    display_value: displayValue(value),
    confidence_band: confidenceBand,
    confidence_score: confidenceScore,
    source_span: sourceSpan,
    requires_confirmation: requiresConfirmation
  };
}

function entityCandidate(
  kind: CentralJobSmartPasteEntityCandidate["kind"],
  value: string,
  confidenceBand: CentralJobSmartPasteConfidenceBand,
  confidenceScore: number,
  sourceSpan: CentralJobSmartPasteSourceSpan | null
): CentralJobSmartPasteEntityCandidate {
  return {
    kind,
    value,
    confidence_band: confidenceBand,
    confidence_score: confidenceScore,
    source_span: sourceSpan,
    requires_confirmation: confidenceBand === "low"
  };
}

function captureLabeledValue(sourceText: string, labels: string[], options?: { allowInlineSentence?: boolean }): CaptureMatch | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      `(?:^|[\\r\\n])\\s*${escaped}\\s*[:\\-]\\s*([^\\r\\n]+)`,
      "im"
    );
    const match = regex.exec(sourceText);
    if (!match) {
      continue;
    }
    const rawValue = normalizeWhitespace(match[1] ?? "");
    if (!rawValue) {
      continue;
    }
    const matchStart = (match.index ?? 0) + match[0].lastIndexOf(match[1]);
    return {
      value: options?.allowInlineSentence ? rawValue : rawValue.replace(/[.,;]+$/, "").trim(),
      span: buildSourceSpan(sourceText, matchStart, matchStart + match[1].length),
      confidenceBand: "high",
      confidenceScore: 0.94
    };
  }
  return null;
}

function capturePattern(sourceText: string, pattern: RegExp, confidenceBand: CentralJobSmartPasteConfidenceBand, confidenceScore: number) {
  const match = pattern.exec(sourceText);
  if (!match || !match[1]) {
    return null;
  }
  const value = normalizeWhitespace(match[1]);
  if (!value) {
    return null;
  }
  const matchStart = (match.index ?? 0) + match[0].lastIndexOf(match[1]);
  return {
    value,
    span: buildSourceSpan(sourceText, matchStart, matchStart + match[1].length),
    confidenceBand,
    confidenceScore
  } satisfies CaptureMatch;
}

function parseDateValue(rawValue: string) {
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawValue);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(rawValue);
  if (slashMatch) {
    const year = slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3];
    return `${year}-${slashMatch[1].padStart(2, "0")}-${slashMatch[2].padStart(2, "0")}`;
  }

  const monthMatch = /^(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+(\d{1,2})(?:,\s*(\d{4}))?$/i.exec(
    rawValue
  );
  if (monthMatch) {
    const monthIndex =
      [
        "jan",
        "feb",
        "mar",
        "apr",
        "may",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec"
      ].indexOf(monthMatch[1].slice(0, 3).toLowerCase()) + 1;
    if (monthIndex > 0) {
      const year = monthMatch[3] ?? String(new Date().getUTCFullYear());
      return `${year}-${String(monthIndex).padStart(2, "0")}-${monthMatch[2].padStart(2, "0")}`;
    }
  }

  return null;
}

function parseTimeValue(rawValue: string) {
  const normalized = rawValue.trim().toLowerCase();
  const twelveHour = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(normalized);
  if (twelveHour) {
    let hours = Number.parseInt(twelveHour[1], 10);
    const minutes = twelveHour[2] ?? "00";
    if (twelveHour[3] === "pm" && hours < 12) {
      hours += 12;
    }
    if (twelveHour[3] === "am" && hours === 12) {
      hours = 0;
    }
    return `${String(hours).padStart(2, "0")}:${minutes}:00`;
  }

  const twentyFourHour = /^(\d{1,2}):(\d{2})$/.exec(normalized);
  if (twentyFourHour) {
    return `${twentyFourHour[1].padStart(2, "0")}:${twentyFourHour[2]}:00`;
  }

  return null;
}

function captureDate(sourceText: string, labels: string[]) {
  const labeled = captureLabeledValue(sourceText, labels);
  if (labeled) {
    const parsed = parseDateValue(labeled.value);
    if (parsed) {
      return { ...labeled, value: parsed };
    }
  }

  const generic = capturePattern(
    sourceText,
    /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2}(?:,\s*\d{4})?)\b/i,
    "medium",
    0.74
  );
  if (!generic) {
    return null;
  }
  const parsed = parseDateValue(generic.value);
  if (!parsed) {
    return null;
  }
  return { ...generic, value: parsed };
}

function captureTime(sourceText: string, labels: string[]) {
  const labeled = captureLabeledValue(sourceText, labels);
  if (labeled) {
    const parsed = parseTimeValue(labeled.value);
    if (parsed) {
      return { ...labeled, value: parsed };
    }
  }

  const generic = capturePattern(sourceText, /\b(\d{1,2}(?::\d{2})?\s?(?:AM|PM)|\d{1,2}:\d{2})\b/i, "medium", 0.7);
  if (!generic) {
    return null;
  }
  const parsed = parseTimeValue(generic.value);
  if (!parsed) {
    return null;
  }
  return { ...generic, value: parsed };
}

function inferSchoolJobType(sourceText: string) {
  const mappings: Array<{ token: string; value: string }> = [
    { token: "fall portrait", value: "fall_portraits" },
    { token: "spring portrait", value: "spring_portraits" },
    { token: "retake", value: "retakes" },
    { token: "graduation", value: "graduation" },
    { token: "yearbook", value: "yearbook" },
    { token: "id card", value: "ids" },
    { token: "ids", value: "ids" },
    { token: "delivery", value: "delivery" }
  ];

  const labeled = captureLabeledValue(sourceText, ["School Job Type", "School Type", "Shoot Type"]);
  if (labeled) {
    const lowered = labeled.value.toLowerCase();
    const mapping = mappings.find((entry) => lowered.includes(entry.token));
    if (mapping) {
      return { ...labeled, value: mapping.value };
    }
  }

  const loweredSource = sourceText.toLowerCase();
  for (const mapping of mappings) {
    const index = loweredSource.indexOf(mapping.token);
    if (index >= 0) {
      return {
        value: mapping.value,
        span: buildSourceSpan(sourceText, index, index + mapping.token.length),
        confidenceBand: "medium",
        confidenceScore: 0.78
      } satisfies CaptureMatch;
    }
  }
  return null;
}

function inferSportsJobType(sourceText: string) {
  const mappings: Array<{ token: string; value: string }> = [
    { token: "media day", value: "media_day" },
    { token: "league day", value: "league_day" },
    { token: "tournament", value: "tournament" },
    { token: "individual portrait", value: "individual_portraits" },
    { token: "team banner", value: "team_banners" }
  ];

  const labeled = captureLabeledValue(sourceText, ["Sports Job Type", "Event Type", "Shoot Type"]);
  if (labeled) {
    const lowered = labeled.value.toLowerCase();
    const mapping = mappings.find((entry) => lowered.includes(entry.token));
    if (mapping) {
      return { ...labeled, value: mapping.value };
    }
  }

  const loweredSource = sourceText.toLowerCase();
  for (const mapping of mappings) {
    const index = loweredSource.indexOf(mapping.token);
    if (index >= 0) {
      return {
        value: mapping.value,
        span: buildSourceSpan(sourceText, index, index + mapping.token.length),
        confidenceBand: "medium",
        confidenceScore: 0.78
      } satisfies CaptureMatch;
    }
  }
  return null;
}

function inferSportName(sourceText: string) {
  const labeled = captureLabeledValue(sourceText, ["Sport", "Sport Name"]);
  if (labeled) {
    return labeled;
  }

  const loweredSource = sourceText.toLowerCase();
  for (const sport of KNOWN_SPORT_NAMES) {
    const index = loweredSource.indexOf(sport);
    if (index >= 0) {
      return {
        value: sport.replace(/\b\w/g, (match) => match.toUpperCase()),
        span: buildSourceSpan(sourceText, index, index + sport.length),
        confidenceBand: "medium",
        confidenceScore: 0.76
      } satisfies CaptureMatch;
    }
  }
  return null;
}

function inferDepartment(
  sourceText: string,
  departmentHint: CentralJobDepartment | null,
  schoolJobType: CaptureMatch | null,
  sportsJobType: CaptureMatch | null,
  sportName: CaptureMatch | null
) {
  if (departmentHint) {
    return {
      value: departmentHint,
      span: null,
      confidenceBand: "high" as const,
      confidenceScore: 0.99
    };
  }

  const labeled = captureLabeledValue(sourceText, ["Department"]);
  if (labeled && (labeled.value === "schools" || labeled.value === "sports")) {
    return labeled;
  }

  if (sportsJobType || sportName) {
    return {
      value: "sports",
      span: sportsJobType?.span ?? sportName?.span ?? null,
      confidenceBand: "medium" as const,
      confidenceScore: 0.82
    };
  }

  if (schoolJobType || /\bschool\b/i.test(sourceText)) {
    return {
      value: "schools",
      span: schoolJobType?.span ?? null,
      confidenceBand: "medium" as const,
      confidenceScore: 0.8
    };
  }

  return null;
}

function inferCanonicalJobType(
  department: CentralJobDepartment | null,
  schoolJobType: string | null
): CentralJobCanonicalJobType | null {
  if (department === "sports") {
    return "sports";
  }
  if (department === "schools") {
    if (schoolJobType === "yearbook" || schoolJobType === "delivery" || schoolJobType === "admin_fulfillment") {
      return "schools_events";
    }
    return "schools_underclass_portraits";
  }
  return null;
}

function inferBooleanHint(sourceText: string, positivePatterns: RegExp[], negativePatterns: RegExp[]) {
  for (const pattern of negativePatterns) {
    const match = pattern.exec(sourceText);
    if (match?.[0]) {
      const start = (match.index ?? 0);
      return {
        value: false,
        span: buildSourceSpan(sourceText, start, start + match[0].length),
        confidenceBand: "high" as const,
        confidenceScore: 0.9
      };
    }
  }
  for (const pattern of positivePatterns) {
    const match = pattern.exec(sourceText);
    if (match?.[0]) {
      const start = (match.index ?? 0);
      return {
        value: true,
        span: buildSourceSpan(sourceText, start, start + match[0].length),
        confidenceBand: "medium" as const,
        confidenceScore: 0.76
      };
    }
  }
  return null;
}

function inferStaffingEstimate(sourceText: string) {
  const labeled = capturePattern(sourceText, /\b(?:staffing|photographers|shooter(?:s)?|camera(?:s)?)\s*[:\-]?\s*(\d{1,2})\b/i, "medium", 0.76);
  if (labeled) {
    return { ...labeled, value: Number.parseInt(labeled.value, 10) };
  }

  const generic = capturePattern(
    sourceText,
    /\bneed\s+(\d{1,2})\s+(?:photographer(?:s)?|shooter(?:s)?|camera(?:s)?)\b/i,
    "medium",
    0.74
  );
  if (!generic) {
    return null;
  }
  return { ...generic, value: Number.parseInt(generic.value, 10) };
}

function inferNotes(sourceText: string, labels: string[]) {
  return captureLabeledValue(sourceText, labels, { allowInlineSentence: true });
}

function inferEntity(sourceText: string, labels: string[], kind: CentralJobSmartPasteEntityCandidate["kind"]) {
  const labeled = captureLabeledValue(sourceText, labels);
  if (labeled) {
    return entityCandidate(kind, labeled.value, labeled.confidenceBand, labeled.confidenceScore, labeled.span);
  }

  return null;
}

export function parseJobIntakeText(rawText: string, departmentHint: CentralJobDepartment | null = null): CentralJobSmartPasteParseResult {
  const trimmed = rawText.trim();
  const inferredFields: CentralJobSmartPasteFieldInference[] = [];
  const warnings: string[] = [];

  if (!trimmed) {
    return {
      raw_text: "",
      department_hint: departmentHint,
      parsed_input: {
        department: departmentHint,
        request_source: "smart_paste",
        raw_source_text: ""
      },
      inferred_fields: [],
      unresolved_entities: {
        organization: null,
        location: null,
        primary_contact: null
      },
      warnings: ["Paste some request text before parsing."]
    };
  }

  const schoolJobType = inferSchoolJobType(trimmed);
  const sportsJobType = inferSportsJobType(trimmed);
  const sportName = inferSportName(trimmed);
  const department = inferDepartment(trimmed, departmentHint, schoolJobType, sportsJobType, sportName);
  const organization = inferEntity(trimmed, ["School", "Organization", "Org", "Client", "Team", "Club"], "organization");
  const location = inferEntity(trimmed, ["Location", "Venue", "Gym", "Field", "At"], "location");
  const primaryContact = inferEntity(trimmed, ["Contact", "Coach", "Athletic Director", "AD", "Principal"], "primary_contact");
  const startDate = captureDate(trimmed, ["Date", "Shoot Date", "Photo Day", "Event Date"]);
  const startTime = captureTime(trimmed, ["Time", "Start Time"]);
  const deliveryDueDate = captureDate(trimmed, ["Delivery Due", "Deadline", "Due Date"]);
  const staffingEstimate = inferStaffingEstimate(trimmed);
  const productionRequired = inferBooleanHint(trimmed, [/\bgallery\b/i, /\bdelivery\b/i, /\byearbook\b/i, /\bspecialty product/i], [/\bno production\b/i, /\bproduction not required\b/i]);
  const specialtyProductsRequired = inferBooleanHint(trimmed, [/\bspecialty product/i], [/\bno specialty products?\b/i]);
  const galleryRequired = inferBooleanHint(trimmed, [/\bgallery\b/i], [/\bno gallery\b/i]);
  const idRequired = inferBooleanHint(trimmed, [/\bid cards?\b/i, /\bids\b/i], [/\bno ids\b/i]);
  const yearbookRequired = inferBooleanHint(trimmed, [/\byearbook\b/i], [/\bno yearbook\b/i]);
  const rosterStatus = captureLabeledValue(trimmed, ["Roster Status", "Roster"]);
  const idSortMethod = captureLabeledValue(trimmed, ["ID Sort Method", "Sort Method"]);
  const yearbookDueDate = captureDate(trimmed, ["Yearbook Due", "Yearbook Deadline"]);
  const specialtyProductTypes = captureLabeledValue(trimmed, ["Specialty Products", "Product Types"]);
  const notes = inferNotes(trimmed, ["Notes", "Internal Notes"]);
  const instructions = inferNotes(trimmed, ["Instructions", "Special Instructions"]);

  const resolvedDepartment: CentralJobDepartment | null =
    department?.value === "schools" || department?.value === "sports" ? department.value : departmentHint ?? null;
  const resolvedSchoolJobType = resolvedDepartment === "schools" ? schoolJobType?.value ?? null : null;
  const resolvedSportsJobType = resolvedDepartment === "sports" ? sportsJobType?.value ?? null : null;
  const canonicalJobType = inferCanonicalJobType(resolvedDepartment, resolvedSchoolJobType);

  if (department) {
    inferredFields.push(inferField("department", "Department", department.value, department.confidenceBand, department.confidenceScore, department.span));
  }
  if (canonicalJobType) {
    inferredFields.push(inferField("job_type", "Job Type", canonicalJobType, resolvedDepartment === "sports" ? "high" : "medium", resolvedDepartment === "sports" ? 0.92 : 0.76, null));
  }
  if (resolvedSchoolJobType && schoolJobType) {
    inferredFields.push(inferField("school_detail.school_job_type", "School Job Type", resolvedSchoolJobType, schoolJobType.confidenceBand, schoolJobType.confidenceScore, schoolJobType.span));
  }
  if (resolvedSportsJobType && sportsJobType) {
    inferredFields.push(inferField("sports_detail.sports_job_type", "Sports Job Type", resolvedSportsJobType, sportsJobType.confidenceBand, sportsJobType.confidenceScore, sportsJobType.span));
  }
  if (sportName) {
    inferredFields.push(inferField("sports_detail.sport_name", "Sport", sportName.value, sportName.confidenceBand, sportName.confidenceScore, sportName.span));
  }
  if (organization) {
    inferredFields.push(
      inferField(
        "unresolved_organization_name",
        "Organization Candidate",
        organization.value,
        organization.confidence_band,
        organization.confidence_score,
        organization.source_span,
        organization.requires_confirmation
      )
    );
  }
  if (location) {
    inferredFields.push(
      inferField(
        "unresolved_location_name",
        "Location Candidate",
        location.value,
        location.confidence_band,
        location.confidence_score,
        location.source_span,
        location.requires_confirmation
      )
    );
  }
  if (primaryContact) {
    inferredFields.push(
      inferField(
        "unresolved_primary_contact_name",
        "Primary Contact Candidate",
        primaryContact.value,
        primaryContact.confidence_band,
        primaryContact.confidence_score,
        primaryContact.source_span,
        primaryContact.requires_confirmation
      )
    );
  }
  if (startDate) {
    inferredFields.push(inferField("start_date", "Start Date", startDate.value, startDate.confidenceBand, startDate.confidenceScore, startDate.span));
  }
  if (startTime) {
    inferredFields.push(inferField("start_time", "Start Time", startTime.value, startTime.confidenceBand, startTime.confidenceScore, startTime.span));
  }
  if (deliveryDueDate) {
    inferredFields.push(
      inferField("delivery_due_date", "Delivery Due Date", deliveryDueDate.value, deliveryDueDate.confidenceBand, deliveryDueDate.confidenceScore, deliveryDueDate.span)
    );
  }
  if (staffingEstimate) {
    inferredFields.push(
      inferField("staffing_estimate", "Staffing Estimate", staffingEstimate.value, staffingEstimate.confidenceBand, staffingEstimate.confidenceScore, staffingEstimate.span)
    );
  }
  if (productionRequired) {
    inferredFields.push(
      inferField("production_required", "Production Required", productionRequired.value, productionRequired.confidenceBand, productionRequired.confidenceScore, productionRequired.span)
    );
  }
  if (galleryRequired) {
    inferredFields.push(
      inferField("sports_detail.gallery_required", "Gallery Required", galleryRequired.value, galleryRequired.confidenceBand, galleryRequired.confidenceScore, galleryRequired.span)
    );
  }
  if (idRequired) {
    inferredFields.push(
      inferField("school_detail.id_required", "ID Required", idRequired.value, idRequired.confidenceBand, idRequired.confidenceScore, idRequired.span)
    );
  }
  if (yearbookRequired) {
    inferredFields.push(
      inferField("school_detail.yearbook_required", "Yearbook Required", yearbookRequired.value, yearbookRequired.confidenceBand, yearbookRequired.confidenceScore, yearbookRequired.span)
    );
  }
  if (rosterStatus) {
    inferredFields.push(
      inferField("school_detail.roster_status", "Roster Status", rosterStatus.value, rosterStatus.confidenceBand, rosterStatus.confidenceScore, rosterStatus.span)
    );
  }
  if (idSortMethod) {
    inferredFields.push(
      inferField("school_detail.id_sort_method", "ID Sort Method", idSortMethod.value, idSortMethod.confidenceBand, idSortMethod.confidenceScore, idSortMethod.span)
    );
  }
  if (yearbookDueDate) {
    inferredFields.push(
      inferField("school_detail.yearbook_due_date", "Yearbook Due Date", yearbookDueDate.value, yearbookDueDate.confidenceBand, yearbookDueDate.confidenceScore, yearbookDueDate.span)
    );
  }
  if (specialtyProductsRequired) {
    inferredFields.push(
      inferField(
        "sports_detail.specialty_products_required",
        "Specialty Products Required",
        specialtyProductsRequired.value,
        specialtyProductsRequired.confidenceBand,
        specialtyProductsRequired.confidenceScore,
        specialtyProductsRequired.span
      )
    );
  }
  if (specialtyProductTypes) {
    const types = specialtyProductTypes.value
      .split(/[;,]/)
      .map((entry) => normalizeWhitespace(entry))
      .filter(Boolean);
    if (types.length) {
      inferredFields.push(
        inferField(
          "sports_detail.specialty_product_types",
          "Specialty Product Types",
          types,
          specialtyProductTypes.confidenceBand,
          specialtyProductTypes.confidenceScore,
          specialtyProductTypes.span
        )
      );
    }
  }
  if (notes) {
    inferredFields.push(inferField("internal_notes", "Internal Notes", notes.value, notes.confidenceBand, notes.confidenceScore, notes.span));
  }
  if (instructions) {
    inferredFields.push(
      inferField("special_instructions", "Special Instructions", instructions.value, instructions.confidenceBand, instructions.confidenceScore, instructions.span)
    );
  }

  if (!resolvedDepartment) {
    warnings.push("Smart Paste could not confidently determine the department. The drawer default is being kept.");
  }
  if (!organization) {
    warnings.push("No organization candidate was extracted. Resolve the organization manually or keep a draft placeholder.");
  }
  if (!startDate) {
    warnings.push("No job date was extracted. Add a start date or another draft anchor before saving.");
  }

  return {
    raw_text: trimmed,
    department_hint: departmentHint,
    parsed_input: {
      department: resolvedDepartment,
      job_type: canonicalJobType,
      request_source: "smart_paste",
      unresolved_organization_name: organization?.value ?? null,
      unresolved_location_name: location?.value ?? null,
      unresolved_primary_contact_name: primaryContact?.value ?? null,
      start_date: startDate?.value ?? null,
      start_time: startTime?.value ?? null,
      timezone: DEFAULT_TIMEZONE,
      date_only: startDate ? !startTime : null,
      delivery_due_date: deliveryDueDate?.value ?? null,
      production_required: productionRequired?.value,
      staffing_required: staffingEstimate ? true : undefined,
      staffing_estimate: staffingEstimate?.value ?? null,
      internal_notes: notes?.value ?? null,
      special_instructions: instructions?.value ?? null,
      raw_source_text: trimmed,
      school_detail:
        resolvedDepartment === "schools"
          ? {
              school_job_type: resolvedSchoolJobType,
              roster_status: rosterStatus?.value ?? null,
              id_required: idRequired?.value ?? null,
              id_sort_method: idSortMethod?.value ?? null,
              yearbook_required: yearbookRequired?.value ?? null,
              yearbook_due_date: yearbookDueDate?.value ?? null
            }
          : null,
      sports_detail:
        resolvedDepartment === "sports"
          ? {
              sports_job_type: resolvedSportsJobType,
              sport_name: sportName?.value ?? null,
              specialty_products_required: specialtyProductsRequired?.value ?? null,
              specialty_product_types: specialtyProductTypes?.value
                ? specialtyProductTypes.value
                    .split(/[;,]/)
                    .map((entry) => normalizeWhitespace(entry))
                    .filter(Boolean)
                : null,
              gallery_required: galleryRequired?.value ?? null
            }
          : null
    },
    inferred_fields: inferredFields,
    unresolved_entities: {
      organization,
      location,
      primary_contact: primaryContact
    },
    warnings
  };
}
