import type { PoolClient } from "pg";
import type {
  ConciergeAnswerCard,
  ConciergeResultCluster,
  ConciergeResultTone,
  ConciergeSearchResult
} from "../../types/concierge.js";
import type { ParsedConciergeSearchInput } from "./conciergeQueryParser.js";

type BuildConciergeIntelligenceInput = {
  client: PoolClient;
  tenantId: string;
  parsed: ParsedConciergeSearchInput;
  results: ConciergeSearchResult[];
};

type OrganizationAnchor = {
  orgId: string | null;
  orgName: string;
  result: ConciergeSearchResult;
};

type PrimaryContactRow = {
  organization_name: string;
  organization_id: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_phone: string | null;
};

function normalizeText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function isTruthy<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function formatEntityLabel(entityType: ConciergeSearchResult["entity_type"]) {
  switch (entityType) {
    case "organization":
      return "organization";
    case "contact":
      return "contact";
    case "location":
      return "location";
    case "shoot":
      return "shoot";
    case "production_item":
      return "production item";
    case "task":
      return "task";
    case "note":
      return "note";
    case "comment":
      return "comment";
    case "staffing_assignment":
      return "staffing assignment";
    case "urgent_watch_alert":
      return "exception alert";
    case "post_shoot_evaluation":
      return "post-shoot evaluation";
    default:
      return "record";
  }
}

function toneWeight(tone: ConciergeResultTone) {
  switch (tone) {
    case "critical":
      return 4;
    case "warning":
      return 3;
    case "info":
      return 2;
    default:
      return 1;
  }
}

function strongestTone(results: ConciergeSearchResult[]): ConciergeResultTone {
  return results.reduce<ConciergeResultTone>(
    (strongest, result) => (toneWeight(result.tone) > toneWeight(strongest) ? result.tone : strongest),
    "neutral"
  );
}

function formatCount(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function formatMetric(label: string, value: number) {
  return {
    label,
    value: String(value)
  };
}

function formatDateLabel(date: "today" | "tomorrow" | "next_24h" | "next_7d" | "overdue" | null | undefined) {
  switch (date) {
    case "today":
      return "today";
    case "tomorrow":
      return "tomorrow";
    case "next_24h":
      return "in the next 24 hours";
    case "next_7d":
      return "in the next 7 days";
    case "overdue":
      return "overdue";
    default:
      return "now";
  }
}

function isOverdue(result: ConciergeSearchResult) {
  if (!result.primary_date) {
    return false;
  }
  const date = new Date(result.primary_date);
  return Number.isFinite(date.getTime()) && date.getTime() < Date.now();
}

function isIssueResult(result: ConciergeSearchResult) {
  const status = normalizeText(result.status);
  const text = normalizeText([result.title, result.subtitle, result.body, result.snippet].filter(Boolean).join(" "));
  return (
    result.entity_type === "post_shoot_evaluation" ||
    result.tone === "critical" ||
    ["major_issues", "needs_leadership_review", "blocked", "rejected"].includes(status) ||
    /\b(issue|problem|wrong|follow up|watch out|leadership review)\b/.test(text)
  );
}

function scoreSubjectMatch(value: string | null | undefined, subject: string | null | undefined) {
  const normalizedValue = normalizeText(value);
  const normalizedSubject = normalizeText(subject);
  if (!normalizedValue || !normalizedSubject) {
    return 0;
  }
  if (normalizedValue === normalizedSubject) {
    return 120;
  }
  if (normalizedValue.startsWith(normalizedSubject) || normalizedSubject.startsWith(normalizedValue)) {
    return 80;
  }
  if (normalizedValue.includes(normalizedSubject) || normalizedSubject.includes(normalizedValue)) {
    return 48;
  }
  return 0;
}

function chooseAnchorOrganization(parsed: ParsedConciergeSearchInput, results: ConciergeSearchResult[]): OrganizationAnchor | null {
  const subject = parsed.intent?.subject ?? parsed.filters.org ?? parsed.query;
  const scoredCandidates = results
    .filter((result) => result.entity_type === "organization" || result.org_id || result.org_name)
    .map((result) => ({
      result,
      score:
        result.score +
        (result.entity_type === "organization" ? 28 : 0) +
        scoreSubjectMatch(result.title, subject) +
        scoreSubjectMatch(result.org_name, subject)
    }))
    .sort((left, right) => right.score - left.score);
  const candidate = scoredCandidates[0]?.result;
  if (!candidate) {
    return null;
  }
  return {
    orgId: candidate.entity_type === "organization" ? candidate.entity_id : candidate.org_id,
    orgName: candidate.entity_type === "organization" ? candidate.title : candidate.org_name ?? candidate.title,
    result: candidate
  };
}

function buildBestMatchCard(result: ConciergeSearchResult, totalResults: number): ConciergeAnswerCard | null {
  if (totalResults > 8 && result.score < 140) {
    return null;
  }
  const summary = result.snippet ?? result.body ?? result.subtitle ?? "Open the best matching record in Kemmetmueller Concierge.";
  return {
    id: `best-match:${result.search_index_id}`,
    kind: "best_match",
    title: `Best match: ${result.title}`,
    summary,
    tone: result.tone,
    confidence: Math.min(0.98, result.score >= 180 ? 0.95 : 0.8),
    metrics: [
      { label: "Type", value: formatEntityLabel(result.entity_type) },
      ...(result.status ? [{ label: "Status", value: result.status.replace(/_/g, " ") }] : []),
      ...(result.org_name ? [{ label: "Organization", value: result.org_name }] : [])
    ],
    linked_result_ids: [result.search_index_id],
    actions: result.quick_actions
  };
}

async function loadPrimaryContact(client: PoolClient, tenantId: string, organizationId: string): Promise<PrimaryContactRow | null> {
  const { rows } = await client.query<PrimaryContactRow>(
    `
      SELECT
        o.display_name AS organization_name,
        o.id::text AS organization_id,
        contact.id::text AS contact_id,
        contact.full_name AS contact_name,
        contact.title AS contact_title,
        contact.email AS contact_email,
        contact.phone AS contact_phone
      FROM organization o
      LEFT JOIN organization_contact_relationship relationship
        ON relationship.tenant_id = o.tenant_id
       AND relationship.organization_id = o.id
       AND relationship.is_current = true
      LEFT JOIN organization_contact contact
        ON contact.tenant_id = relationship.tenant_id
       AND contact.id = relationship.contact_id
      WHERE o.tenant_id = $1
        AND o.id = $2::uuid
      ORDER BY relationship.is_primary DESC, relationship.updated_at DESC NULLS LAST
      LIMIT 1
    `,
    [tenantId, organizationId]
  );
  return rows[0] ?? null;
}

async function buildContactLookupCard(input: BuildConciergeIntelligenceInput): Promise<ConciergeAnswerCard | null> {
  const anchor = chooseAnchorOrganization(input.parsed, input.results);
  if (!anchor?.orgId) {
    return null;
  }
  const contact = await loadPrimaryContact(input.client, input.tenantId, anchor.orgId);
  if (!contact) {
    return null;
  }
  if (!contact.contact_id || !contact.contact_name) {
    return {
      id: `contact:${anchor.orgId}`,
      kind: "contact_lookup",
      title: `${contact.organization_name} does not have a primary contact set`,
      summary: "Open the organization profile to review directory ownership and assign a primary contact.",
      tone: "warning",
      confidence: 0.9,
      metrics: [{ label: "Organization", value: contact.organization_name }],
      linked_result_ids: [anchor.result.search_index_id],
      actions: [{ key: "open", label: "Open Organization", deep_link: anchor.result.deep_link }]
    };
  }
  const contactSummary = [contact.contact_title, contact.contact_email, contact.contact_phone].filter(Boolean).join(" | ");
  return {
    id: `contact:${contact.contact_id}`,
    kind: "contact_lookup",
    title: `${contact.organization_name} primary contact is ${contact.contact_name}`,
    summary: contactSummary || "Open the contact record for the latest directory context.",
    tone: "info",
    confidence: 0.97,
    metrics: [
      ...(contact.contact_title ? [{ label: "Role", value: contact.contact_title }] : []),
      ...(contact.contact_email ? [{ label: "Email", value: contact.contact_email }] : []),
      ...(contact.contact_phone ? [{ label: "Phone", value: contact.contact_phone }] : [])
    ],
    linked_result_ids: [anchor.result.search_index_id],
    actions: [
      { key: "open", label: "Open Contact", deep_link: `#directory/contacts?view=contacts&contact=${contact.contact_id}&tab=relationships` },
      { key: "view_notes", label: "Open Organization", deep_link: anchor.result.deep_link }
    ]
  };
}

function filterByAnchor(results: ConciergeSearchResult[], anchor: OrganizationAnchor | null) {
  if (!anchor) {
    return results;
  }
  return results.filter((result) => {
    if (anchor.orgId && result.org_id === anchor.orgId) {
      return true;
    }
    return normalizeText(result.org_name) === normalizeText(anchor.orgName);
  });
}

function buildRiskReviewCard(input: BuildConciergeIntelligenceInput): ConciergeAnswerCard | null {
  const targetDate = input.parsed.intent?.date ?? input.parsed.filters.date;
  const relevant = input.results.filter((result) => {
    if (!(result.tone === "critical" || result.tone === "warning" || result.has_alerts || result.has_staffing_gap)) {
      return false;
    }
    if (!targetDate || !result.primary_date) {
      return true;
    }
    const date = new Date(result.primary_date);
    const today = new Date();
    const centralToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const resultDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (targetDate === "today") {
      return resultDay.getTime() === centralToday.getTime();
    }
    if (targetDate === "tomorrow") {
      const tomorrow = new Date(centralToday);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return resultDay.getTime() === tomorrow.getTime();
    }
    if (targetDate === "overdue") {
      return isOverdue(result);
    }
    return true;
  });
  if (!relevant.length) {
    return null;
  }
  const shootGapCount = relevant.filter((result) => result.entity_type === "shoot" && result.has_staffing_gap).length;
  const alertCount = relevant.filter((result) => result.has_alerts || result.entity_type === "urgent_watch_alert").length;
  const criticalCount = relevant.filter((result) => result.tone === "critical").length;
  const title =
    shootGapCount > 0 && (targetDate === "today" || targetDate === "tomorrow")
      ? `${shootGapCount} shoots ${formatDateLabel(targetDate)} are missing staffing`
      : `${relevant.length} items need attention ${formatDateLabel(targetDate)}`;
  return {
    id: `risk:${targetDate ?? "general"}`,
    kind: "risk_review",
    title,
    summary:
      criticalCount > 0
        ? `${criticalCount} records are already in a critical state, and ${alertCount} also carry alerts or watch flags.`
        : `${alertCount} records carry alerts or watch flags and should be reviewed before work begins.`,
    tone: strongestTone(relevant),
    confidence: 0.9,
    metrics: [formatMetric("Critical", criticalCount), formatMetric("Alerts", alertCount), formatMetric("Staffing gaps", shootGapCount)],
    linked_result_ids: relevant.slice(0, 5).map((result) => result.search_index_id),
    actions: [
      ...(shootGapCount > 0 ? [{ key: "view_staffing" as const, label: "Open Staffing", deep_link: "#schedule/staffing" }] : []),
      ...(relevant[0]?.quick_actions.slice(0, 1) ?? [])
    ]
  };
}

function buildStaffingReviewCard(input: BuildConciergeIntelligenceInput): ConciergeAnswerCard | null {
  const relevant = input.results.filter(
    (result) =>
      result.has_staffing_gap ||
      result.entity_type === "staffing_assignment" ||
      /\b(staff|coverage|assignment|crew|lead)\b/.test(normalizeText([result.title, result.subtitle, result.body, result.snippet].join(" ")))
  );
  if (!relevant.length) {
    return null;
  }
  const gapCount = relevant.filter((result) => result.has_staffing_gap).length;
  const assignmentCount = relevant.filter((result) => result.entity_type === "staffing_assignment").length;
  return {
    id: "staffing-review",
    kind: "staffing_review",
    title: gapCount > 0 ? `${gapCount} staffing gaps need coverage` : `${assignmentCount} staffing records matched this search`,
    summary:
      gapCount > 0
        ? "Concierge found staffing gaps, absences, or alerts that likely need coverage before execution."
        : "Concierge found staffing context tied to this question.",
    tone: strongestTone(relevant),
    confidence: 0.88,
    metrics: [formatMetric("Gaps", gapCount), formatMetric("Assignments", assignmentCount)],
    linked_result_ids: relevant.slice(0, 5).map((result) => result.search_index_id),
    actions: [{ key: "view_staffing", label: "Open Staffing", deep_link: "#schedule/staffing" }, ...(relevant[0]?.quick_actions.slice(0, 1) ?? [])]
  };
}

function buildIssueLookupCard(input: BuildConciergeIntelligenceInput): ConciergeAnswerCard | null {
  const anchor = chooseAnchorOrganization(input.parsed, input.results);
  const relevant = filterByAnchor(
    input.results.filter((result) => ["post_shoot_evaluation", "note", "comment", "urgent_watch_alert"].includes(result.entity_type) && isIssueResult(result)),
    anchor
  );
  if (!relevant.length) {
    return null;
  }
  const historical = relevant.filter((result) => {
    if (!result.primary_date) {
      return true;
    }
    return new Date(result.primary_date).getTime() <= Date.now();
  });
  const preferred = (historical.length ? historical : relevant).filter((result) => result.entity_type !== "urgent_watch_alert");
  const workingSet = preferred.length ? preferred : historical.length ? historical : relevant;
  const typePriority = new Map<ConciergeSearchResult["entity_type"], number>([
    ["post_shoot_evaluation", 4],
    ["note", 3],
    ["comment", 2],
    ["urgent_watch_alert", 1]
  ]);
  const latest = [...workingSet]
    .sort((left, right) => {
      const leftTime = left.primary_date ? new Date(left.primary_date).getTime() : 0;
      const rightTime = right.primary_date ? new Date(right.primary_date).getTime() : 0;
      return rightTime - leftTime || (typePriority.get(right.entity_type) ?? 0) - (typePriority.get(left.entity_type) ?? 0) || right.score - left.score;
    })[0];
  const recentIssueCount = workingSet.filter((result) => {
    if (!result.primary_date) {
      return false;
    }
    const date = new Date(result.primary_date);
    return Date.now() - date.getTime() <= 90 * 24 * 60 * 60 * 1000;
  }).length;
  const label = anchor?.orgName ?? input.parsed.intent?.subject ?? "This account";
  return {
    id: `issues:${anchor?.orgId ?? label}`,
    kind: "issue_lookup",
    title: `${label} had ${formatCount(Math.max(recentIssueCount, 1), "issue")} in the last 90 days`,
    summary: latest.snippet ?? latest.body ?? latest.subtitle ?? "Open the latest evaluation or note for the operational details.",
    tone: strongestTone(workingSet),
    confidence: 0.91,
    metrics: [
      { label: "Latest record", value: formatEntityLabel(latest.entity_type) },
      ...(latest.status ? [{ label: "Latest status", value: latest.status.replace(/_/g, " ") }] : [])
    ],
    linked_result_ids: workingSet.slice(0, 5).map((result) => result.search_index_id),
    actions: latest.quick_actions.length ? latest.quick_actions : [{ key: "view_notes", label: "View Notes", deep_link: latest.deep_link }]
  };
}

function buildNoteHistoryCard(input: BuildConciergeIntelligenceInput): ConciergeAnswerCard | null {
  const anchor = chooseAnchorOrganization(input.parsed, input.results);
  const relevant = filterByAnchor(
    input.results.filter((result) => ["note", "comment", "post_shoot_evaluation"].includes(result.entity_type)),
    anchor
  );
  if (!relevant.length) {
    return null;
  }
  const latest = [...relevant].sort((left, right) => {
    const leftTime = left.primary_date ? new Date(left.primary_date).getTime() : 0;
    const rightTime = right.primary_date ? new Date(right.primary_date).getTime() : 0;
    return rightTime - leftTime || right.score - left.score;
  })[0];
  const label = anchor?.orgName ?? input.parsed.intent?.subject ?? "this account";
  return {
    id: `history:${anchor?.orgId ?? label}`,
    kind: "note_history_lookup",
    title: `Found ${formatCount(relevant.length, "note")} and history items for ${label}`,
    summary: latest.snippet ?? latest.body ?? latest.subtitle ?? "Open the most relevant record for the latest context.",
    tone: strongestTone(relevant),
    confidence: 0.87,
    metrics: [
      formatMetric("Notes", relevant.filter((result) => result.entity_type === "note").length),
      formatMetric("Comments", relevant.filter((result) => result.entity_type === "comment").length),
      formatMetric("Evaluations", relevant.filter((result) => result.entity_type === "post_shoot_evaluation").length)
    ],
    linked_result_ids: relevant.slice(0, 5).map((result) => result.search_index_id),
    actions: latest.quick_actions.length ? latest.quick_actions : [{ key: "view_notes", label: "View Notes", deep_link: latest.deep_link }]
  };
}

function buildOverdueWorkCard(input: BuildConciergeIntelligenceInput): ConciergeAnswerCard | null {
  const relevant = input.results.filter(
    (result) => ["task", "production_item", "shoot", "urgent_watch_alert", "staffing_assignment"].includes(result.entity_type) && isOverdue(result)
  );
  if (!relevant.length) {
    return null;
  }
  const label = input.parsed.intent?.person ? ` assigned to ${input.parsed.intent.person}` : "";
  return {
    id: `overdue:${input.parsed.intent?.person ?? "all"}`,
    kind: "overdue_work_lookup",
    title: `${formatCount(relevant.length, "overdue item")}${label}`,
    summary: "Concierge found past-due work tied to this question. Open the top item first, then clear the remaining backlog.",
    tone: strongestTone(relevant),
    confidence: 0.9,
    metrics: [
      formatMetric("Tasks", relevant.filter((result) => result.entity_type === "task").length),
      formatMetric("Production", relevant.filter((result) => result.entity_type === "production_item").length),
      formatMetric("Shoots", relevant.filter((result) => result.entity_type === "shoot").length)
    ],
    linked_result_ids: relevant.slice(0, 5).map((result) => result.search_index_id),
    actions: relevant[0]?.quick_actions ?? [{ key: "open", label: "Open", deep_link: relevant[0]?.deep_link ?? "#my-work" }]
  };
}

function buildProductionBlockageCard(input: BuildConciergeIntelligenceInput): ConciergeAnswerCard | null {
  const relevant = input.results.filter((result) => {
    if (!["production_item", "task", "urgent_watch_alert"].includes(result.entity_type)) {
      return false;
    }
    const status = normalizeText(result.status);
    return result.tone === "critical" || status === "blocked" || status === "waiting" || /\b(upload|qa|release|approval)\b/.test(normalizeText(result.body));
  });
  if (!relevant.length) {
    return null;
  }
  const waitingForUploads = relevant.filter((result) => /\bupload\b/.test(normalizeText([result.title, result.subtitle, result.body, result.snippet].join(" ")))).length;
  return {
    id: "production-blockage",
    kind: "production_blockage_lookup",
    title:
      waitingForUploads > 0
        ? `${formatCount(relevant.length, "production item")} are blocked waiting for uploads`
        : `${formatCount(relevant.length, "production item")} are blocked`,
    summary:
      waitingForUploads > 0
        ? `${waitingForUploads} of the matched items mention uploads directly. Open the blocked queue to clear the handoff path.`
        : "Concierge found blocked production work that likely needs a handoff, QA, release, or upload decision.",
    tone: strongestTone(relevant),
    confidence: 0.92,
    metrics: [
      formatMetric("Blocked items", relevant.filter((result) => normalizeText(result.status) === "blocked").length),
      formatMetric("Upload blockers", waitingForUploads),
      formatMetric("Alerts", relevant.filter((result) => result.has_alerts).length)
    ],
    linked_result_ids: relevant.slice(0, 5).map((result) => result.search_index_id),
    actions: [{ key: "view_production", label: "Open Production", deep_link: "#production" }, ...(relevant[0]?.quick_actions.slice(0, 1) ?? [])]
  };
}

export async function buildConciergeAnswerCards(input: BuildConciergeIntelligenceInput): Promise<ConciergeAnswerCard[]> {
  const primaryKind = input.parsed.intent?.kind ?? "direct_lookup";
  let primaryCard: ConciergeAnswerCard | null = null;
  switch (primaryKind) {
    case "contact_lookup":
      primaryCard = await buildContactLookupCard(input);
      break;
    case "risk_review":
      primaryCard = buildRiskReviewCard(input);
      break;
    case "staffing_review":
      primaryCard = buildStaffingReviewCard(input);
      break;
    case "issue_lookup":
      primaryCard = buildIssueLookupCard(input);
      break;
    case "note_history_lookup":
      primaryCard = buildNoteHistoryCard(input);
      break;
    case "overdue_work_lookup":
      primaryCard = buildOverdueWorkCard(input);
      break;
    case "production_blockage_lookup":
      primaryCard = buildProductionBlockageCard(input);
      break;
    default:
      primaryCard = null;
      break;
  }

  if (!primaryCard && input.results[0]) {
    primaryCard = buildBestMatchCard(input.results[0], input.results.length);
  }
  return [primaryCard].filter(isTruthy);
}

function buildClusterSummary(results: ConciergeSearchResult[]) {
  const counts = new Map<string, number>();
  for (const result of results) {
    const label = formatEntityLabel(result.entity_type);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .slice(0, 3)
    .map(([label, count]) => formatCount(count, label))
    .join(" | ");
}

export function buildConciergeRelatedClusters({ parsed, results }: Pick<BuildConciergeIntelligenceInput, "parsed" | "results">): ConciergeResultCluster[] {
  const clusters: ConciergeResultCluster[] = [];
  const anchor = chooseAnchorOrganization(parsed, results);
  if (anchor) {
    const related = filterByAnchor(results, anchor).slice(0, 4);
    if (related.length >= 2 && new Set(related.map((result) => result.entity_type)).size >= 2) {
      clusters.push({
        id: `org:${anchor.orgId ?? anchor.orgName}`,
        title: `${anchor.orgName} related context`,
        summary: buildClusterSummary(related),
        tone: strongestTone(related),
        results: related
      });
    }
  }

  if (!clusters.length && parsed.intent && ["staffing_review", "production_blockage_lookup", "overdue_work_lookup"].includes(parsed.intent.kind)) {
    const operational = results
      .filter((result) => ["task", "production_item", "shoot", "staffing_assignment", "urgent_watch_alert"].includes(result.entity_type))
      .slice(0, 4);
    if (operational.length >= 2) {
      clusters.push({
        id: `ops:${parsed.intent.kind}`,
        title: "Related operational work",
        summary: buildClusterSummary(operational),
        tone: strongestTone(operational),
        results: operational
      });
    }
  }

  return clusters.slice(0, 2);
}
