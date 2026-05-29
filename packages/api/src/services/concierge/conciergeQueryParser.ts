import type {
  ConciergeDateFilter,
  ConciergeDepartmentFilter,
  ConciergeEntityType,
  ConciergeHasFilter,
  ConciergeIntentKind,
  ConciergeSearchFilters,
  ConciergeSearchIntent,
  ConciergeSearchInput
} from "../../types/concierge.js";

type ParsedFilterAccumulator = {
  department: ConciergeDepartmentFilter | null;
  entity_types: Set<ConciergeEntityType>;
  status: string | null;
  owner: string | null;
  assignee: string | null;
  org: string | null;
  date: ConciergeDateFilter | null;
  risk: string | null;
  has_any: Set<ConciergeHasFilter>;
};

export type ParsedConciergeSearchInput = {
  query: string;
  expanded_query: string;
  search_terms: string[];
  filters: ConciergeSearchFilters;
  intent: ConciergeSearchIntent | null;
};

const TYPE_ALIASES: Record<string, ConciergeEntityType[]> = {
  organization: ["organization"],
  organizations: ["organization"],
  org: ["organization"],
  school: ["organization"],
  schools: ["organization"],
  account: ["organization"],
  accounts: ["organization"],
  contact: ["contact"],
  contacts: ["contact"],
  person: ["contact"],
  people: ["contact"],
  location: ["location"],
  locations: ["location"],
  site: ["location"],
  sites: ["location"],
  shoot: ["shoot"],
  shoots: ["shoot"],
  job: ["shoot", "production_item"],
  jobs: ["shoot", "production_item"],
  production: ["production_item"],
  digital: ["production_item"],
  graphics: ["production_item"],
  task: ["task"],
  tasks: ["task"],
  sop: ["resource_library_item"],
  sops: ["resource_library_item"],
  file: ["resource_library_item"],
  files: ["resource_library_item"],
  document: ["resource_library_item"],
  documents: ["resource_library_item"],
  reference: ["resource_library_item"],
  references: ["resource_library_item"],
  note: ["note"],
  notes: ["note"],
  comment: ["comment"],
  comments: ["comment"],
  staffing: ["staffing_assignment"],
  assignment: ["staffing_assignment"],
  assignments: ["staffing_assignment"],
  alert: ["urgent_watch_alert"],
  alerts: ["urgent_watch_alert"],
  urgent: ["urgent_watch_alert"],
  pse: ["post_shoot_evaluation"],
  evaluation: ["post_shoot_evaluation"],
  evaluations: ["post_shoot_evaluation"]
};

const SYNONYM_GROUPS: Array<[string, string[]]> = [
  ["school", ["organization", "account", "school"]],
  ["organization", ["organization", "account", "school"]],
  ["account", ["organization", "account", "school"]],
  ["job", ["job", "shoot", "event"]],
  ["shoot", ["shoot", "job", "event"]],
  ["blocked", ["blocked", "stuck", "waiting"]],
  ["stuck", ["blocked", "stuck", "waiting"]],
  ["waiting", ["blocked", "stuck", "waiting"]],
  ["rep", ["rep", "owner", "account rep"]],
  ["owner", ["owner", "rep", "account rep"]],
  ["pse", ["pse", "post shoot evaluation", "post shoot eval"]],
  ["production", ["production", "digital", "graphics"]],
  ["digital", ["production", "digital", "graphics"]],
  ["graphics", ["production", "digital", "graphics"]],
  ["sop", ["sop", "file", "document", "reference"]],
  ["file", ["file", "document", "reference", "sop"]],
  ["document", ["document", "file", "reference", "sop"]],
  ["reference", ["reference", "file", "document", "sop"]]
];

const INTENT_TERM_EXPANSIONS: Record<ConciergeIntentKind, string[]> = {
  direct_lookup: [],
  contact_lookup: ["contact", "owner", "account rep", "phone", "email"],
  risk_review: ["risk", "alert", "blocked", "overdue", "watch", "staffing gap"],
  staffing_review: ["staffing", "coverage", "assignment", "gap", "lead"],
  issue_lookup: ["issue", "problem", "watch out", "major issues", "leadership review"],
  note_history_lookup: ["note", "comment", "history", "evaluation", "memory"],
  overdue_work_lookup: ["overdue", "late", "blocked", "follow up"],
  production_blockage_lookup: ["production", "blocked", "upload", "qa", "release"]
};

const STATUS_WORDS = new Set(["blocked", "overdue", "waiting", "review", "rejected", "active", "ready", "submitted"]);
const RISK_WORDS = new Set(["critical", "high", "warning", "medium", "low", "at_risk"]);
const DEPARTMENT_WORDS = new Set(["schools", "sports", "production", "photography", "operations", "corporate", "headshots", "other"]);
const DATE_WORDS = new Set(["today", "tomorrow", "next_24h", "next_7d", "overdue"]);
const HAS_ALIASES: Record<string, ConciergeHasFilter> = {
  notes: "notes",
  alerts: "alerts",
  "staffing-gap": "staffing_gap",
  staffing_gap: "staffing_gap",
  staffinggap: "staffing_gap"
};

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function sanitizeTerm(value: string) {
  return value.replace(/^"+|"+$/g, "").trim();
}

function splitValues(value: string) {
  return value
    .split(",")
    .map((part) => sanitizeTerm(part))
    .filter(Boolean);
}

function emptyAccumulator(): ParsedFilterAccumulator {
  return {
    department: null,
    entity_types: new Set<ConciergeEntityType>(),
    status: null,
    owner: null,
    assignee: null,
    org: null,
    date: null,
    risk: null,
    has_any: new Set<ConciergeHasFilter>()
  };
}

function toFilterObject(accumulator: ParsedFilterAccumulator): ConciergeSearchFilters {
  return {
    department: accumulator.department,
    entity_types: [...accumulator.entity_types],
    status: accumulator.status,
    owner: accumulator.owner,
    assignee: accumulator.assignee,
    org: accumulator.org,
    date: accumulator.date,
    risk: accumulator.risk,
    has_any: [...accumulator.has_any]
  };
}

function mergeExplicitFilters(accumulator: ParsedFilterAccumulator, input: ConciergeSearchInput) {
  if (input.department && input.department !== "all") {
    accumulator.department = input.department;
  }
  for (const entityType of input.entity_types ?? []) {
    accumulator.entity_types.add(entityType);
  }
  if (normalizeText(input.status)) {
    accumulator.status = normalizeText(input.status);
  }
  if (normalizeText(input.owner)) {
    accumulator.owner = normalizeText(input.owner);
  }
  if (normalizeText(input.assignee)) {
    accumulator.assignee = normalizeText(input.assignee);
  }
  if (normalizeText(input.org)) {
    accumulator.org = normalizeText(input.org);
  }
  if (input.date) {
    accumulator.date = input.date;
  }
  if (normalizeText(input.risk)) {
    accumulator.risk = normalizeText(input.risk);
  }
  for (const hasFilter of input.has_any ?? []) {
    accumulator.has_any.add(hasFilter);
  }
}

function applyTypedFilter(accumulator: ParsedFilterAccumulator, key: string, value: string) {
  const values = splitValues(value);
  if (!values.length) {
    return;
  }
  switch (key) {
    case "type":
      for (const entry of values) {
        for (const entityType of TYPE_ALIASES[entry.toLowerCase()] ?? []) {
          accumulator.entity_types.add(entityType);
        }
      }
      return;
    case "department":
      for (const entry of values) {
        if (entry === "all" || DEPARTMENT_WORDS.has(entry.toLowerCase())) {
          accumulator.department = entry.toLowerCase() as ConciergeDepartmentFilter;
          return;
        }
      }
      return;
    case "status":
      accumulator.status = values.join(" ");
      return;
    case "owner":
      accumulator.owner = values.join(" ");
      return;
    case "assignee":
      accumulator.assignee = values.join(" ");
      return;
    case "org":
      accumulator.org = values.join(" ");
      return;
    case "date":
      if (DATE_WORDS.has(values[0].toLowerCase())) {
        accumulator.date = values[0].toLowerCase() as ConciergeDateFilter;
      }
      return;
    case "risk":
      accumulator.risk = values.join(" ");
      return;
    case "has":
      for (const entry of values) {
        const mapped = HAS_ALIASES[entry.toLowerCase()];
        if (mapped) {
          accumulator.has_any.add(mapped);
        }
      }
      return;
    default:
      return;
  }
}

function applyNaturalLanguageHints(accumulator: ParsedFilterAccumulator, query: string) {
  const lowered = query.toLowerCase();
  if (!accumulator.status) {
    if (/\b(blocked|stuck)\b/.test(lowered)) {
      accumulator.status = "blocked";
    } else if (/\bwaiting\b/.test(lowered)) {
      accumulator.status = "waiting";
    }
  }
  if (!accumulator.risk && /\bat risk\b/.test(lowered)) {
    accumulator.risk = "high";
  }
  if (!accumulator.date) {
    if (/\boverdue\b/.test(lowered)) {
      accumulator.date = "overdue";
    } else if (/\btomorrow\b/.test(lowered)) {
      accumulator.date = "tomorrow";
    } else if (/\btoday\b/.test(lowered)) {
      accumulator.date = "today";
    }
  }
  if (!accumulator.department) {
    const departmentMatch = [...DEPARTMENT_WORDS].find((value) => lowered.includes(value));
    if (departmentMatch) {
      accumulator.department = departmentMatch as ConciergeDepartmentFilter;
    }
  }

  const assignedToMatch = lowered.match(/\bassigned to ([a-z0-9 .'-]+)$/i);
  if (assignedToMatch && !accumulator.assignee) {
    accumulator.assignee = sanitizeTerm(assignedToMatch[1]);
  }

  const ownerMatch = lowered.match(/\b(?:owner|rep|account rep)[: ]+([a-z0-9 .'-]+)$/i);
  if (ownerMatch && !accumulator.owner) {
    accumulator.owner = sanitizeTerm(ownerMatch[1]);
  }

  const pseHint = /\b(pse|post[- ]shoot eval|post[- ]shoot evaluation)\b/i.test(lowered);
  if (pseHint) {
    accumulator.entity_types.add("post_shoot_evaluation");
  }
}

function extractIntentSubject(query: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = query.match(pattern);
    const subject = sanitizeTerm(match?.[1] ?? "");
    if (subject) {
      return subject;
    }
  }
  return null;
}

function detectIntent(query: string, filters: ConciergeSearchFilters): ConciergeSearchIntent | null {
  const normalizedQuery = query.trim();
  const lowered = normalizedQuery.toLowerCase();
  const person = filters.assignee ?? filters.owner ?? null;
  const department = filters.department ?? null;
  const date = filters.date ?? null;

  const contactSubject = extractIntentSubject(normalizedQuery, [
    /\b(?:who(?:'s| is)?|show|find|what is)\s+(?:the\s+)?(?:primary\s+)?(?:contact|owner|rep|account rep)\s+(?:for|at)\s+(.+)$/i,
    /\b(?:contact|owner|rep|account rep)\s+(?:for|at)\s+(.+)$/i
  ]);
  if (contactSubject) {
    return {
      kind: "contact_lookup",
      confidence: 0.96,
      subject: contactSubject,
      person,
      department,
      date,
      rationale: "The query is asking for a contact, owner, or representative tied to a specific account."
    };
  }

  const issueSubject = extractIntentSubject(normalizedQuery, [
    /\bwhat went wrong(?: last time)? (?:at|for) (.+)$/i,
    /\b(?:issues?|problems?) (?:from|at|for) (?:the\s+last\s+)?(.+)$/i
  ]);
  if (issueSubject || /\bwhat went wrong\b/.test(lowered)) {
    return {
      kind: "issue_lookup",
      confidence: 0.92,
      subject: issueSubject,
      person,
      department,
      date,
      rationale: "The query is asking for prior operational issues or negative history."
    };
  }

  const noteSubject = extractIntentSubject(normalizedQuery, [
    /\bwhere are the notes from the last (.+?)(?:\s+shoot)?$/i,
    /\b(?:notes?|history|comments?) (?:from|for|about) (.+)$/i
  ]);
  if (noteSubject || /\b(?:notes?|history|comments?)\b/.test(lowered)) {
    return {
      kind: "note_history_lookup",
      confidence: noteSubject ? 0.9 : 0.78,
      subject: noteSubject,
      person,
      department,
      date,
      rationale: "The query is looking for notes, comments, prior evaluations, or operational history."
    };
  }

  if (/\bblocked\b/.test(lowered) && /\bproduction\b/.test(lowered)) {
    return {
      kind: "production_blockage_lookup",
      confidence: 0.93,
      subject: filters.org ?? null,
      person,
      department,
      date,
      rationale: "The query is asking for blocked or stuck production work."
    };
  }

  if (/\boverdue\b/.test(lowered)) {
    return {
      kind: "overdue_work_lookup",
      confidence: person ? 0.92 : 0.84,
      subject: filters.org ?? null,
      person,
      department,
      date: filters.date ?? "overdue",
      rationale: "The query is asking for overdue operational work."
    };
  }

  if (/\b(?:missing staffing|staffing gap|staffing gaps|understaffed|coverage)\b/.test(lowered) || filters.has_any.includes("staffing_gap")) {
    return {
      kind: "staffing_review",
      confidence: 0.88,
      subject: filters.org ?? null,
      person,
      department,
      date,
      rationale: "The query is focused on staffing gaps, coverage, or assignment risk."
    };
  }

  if (/\bat risk\b/.test(lowered) || (filters.risk && ["high", "critical", "warning"].includes(filters.risk.toLowerCase()))) {
    return {
      kind: "risk_review",
      confidence: filters.date ? 0.92 : 0.82,
      subject: filters.org ?? null,
      person,
      department,
      date,
      rationale: "The query is asking for risky or attention-needed work."
    };
  }

  if (!normalizedQuery) {
    return null;
  }

  return {
    kind: "direct_lookup",
    confidence: normalizedQuery.split(/\s+/).length <= 3 ? 0.68 : 0.54,
    subject: filters.org ?? null,
    person,
    department,
    date,
    rationale: "The query reads like a direct record lookup."
  };
}

function buildExpandedQuery(query: string, intent: ConciergeSearchIntent | null) {
  const loweredTokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const expanded = new Set<string>(loweredTokens);
  for (const token of loweredTokens) {
    for (const [needle, aliases] of SYNONYM_GROUPS) {
      if (token === needle || token.includes(needle)) {
        for (const alias of aliases) {
          expanded.add(alias);
        }
      }
    }
    for (const entityType of TYPE_ALIASES[token] ?? []) {
      expanded.add(entityType.replace(/_/g, " "));
    }
    if (STATUS_WORDS.has(token)) {
      expanded.add(token);
    }
    if (RISK_WORDS.has(token)) {
      expanded.add(token);
    }
  }
  if (intent) {
    for (const term of INTENT_TERM_EXPANSIONS[intent.kind]) {
      expanded.add(term);
    }
    if (intent.subject) {
      for (const token of intent.subject.toLowerCase().split(/\s+/)) {
        if (token.trim()) {
          expanded.add(token.trim());
        }
      }
    }
    if (intent.person) {
      for (const token of intent.person.toLowerCase().split(/\s+/)) {
        if (token.trim()) {
          expanded.add(token.trim());
        }
      }
    }
  }
  return [...expanded].join(" ").trim();
}

export function parseConciergeSearchInput(input: ConciergeSearchInput = {}): ParsedConciergeSearchInput {
  const accumulator = emptyAccumulator();
  mergeExplicitFilters(accumulator, input);

  const rawQuery = normalizeText(input.q) ?? "";
  const typedPattern = /\b(type|department|status|owner|assignee|org|date|risk|has):("[^"]+"|[^\s]+)/gi;
  let strippedQuery = rawQuery;
  for (const match of rawQuery.matchAll(typedPattern)) {
    const key = match[1]?.toLowerCase() ?? "";
    const value = match[2] ?? "";
    applyTypedFilter(accumulator, key, value);
    strippedQuery = strippedQuery.replace(match[0], " ");
  }

  const normalizedQuery = strippedQuery.replace(/\s+/g, " ").trim();
  applyNaturalLanguageHints(accumulator, normalizedQuery || rawQuery);
  const filters = toFilterObject(accumulator);
  const intent = detectIntent(normalizedQuery || rawQuery, filters);

  const expandedQuery = buildExpandedQuery(normalizedQuery || rawQuery, intent);
  const searchTerms = [...new Set(expandedQuery.split(/\s+/).map((part) => part.trim()).filter(Boolean))];

  return {
    query: normalizedQuery,
    expanded_query: expandedQuery,
    search_terms: searchTerms,
    filters,
    intent
  };
}
