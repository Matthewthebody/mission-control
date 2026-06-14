// Demo-safe, forward-compatible data for the Sports Command Center (Josh) and the
// Sam sports workspace. Modeled as if real services will later replace it. Rebooking
// and the current-vs-next-season split are net-new (absent in the codebase today);
// specialty products, production status, staffing, and change/ack reuse existing
// concepts. Tone vocab matches the home-pill classes (critical|warning|watch|healthy|neutral|info).

export type SportsTone = "critical" | "warning" | "watch" | "healthy" | "neutral" | "info";

// ---- Sports Pulse (exception-driven, not vanity KPIs) -------------------------

export type SportsPulseCard = {
  id: string;
  label: string;
  value: string;
  helper: string;
  tone: SportsTone;
  drilldownHash: string;
  drilldownLabel: string;
};

// ---- Rebooking / Building Next Season (NET-NEW) -------------------------------
// A group counts as rebooked when we have communicated, created the job, and it is
// on the calendar with a date that works. A signed agreement is not required.

export type RebookingStatus =
  | "rebooked"
  | "date_held"
  | "in_conversation"
  | "needs_follow_up"
  | "at_risk"
  | "lost"
  | "unknown";

export const REBOOKING_STATUS_LABELS: Record<RebookingStatus, string> = {
  rebooked: "Rebooked",
  date_held: "Date held",
  in_conversation: "In conversation",
  needs_follow_up: "Needs follow-up",
  at_risk: "At risk",
  lost: "Lost",
  unknown: "Unknown"
};

export const REBOOKING_STATUS_TONES: Record<RebookingStatus, SportsTone> = {
  rebooked: "healthy",
  date_held: "info",
  in_conversation: "watch",
  needs_follow_up: "warning",
  at_risk: "critical",
  lost: "neutral",
  unknown: "neutral"
};

export type RebookingGroup = {
  id: string;
  association: string;
  // Optional program/sport/team for sport-level rebooking (a school may rebook
  // basketball + soccer but not volleyball).
  program?: string;
  status: RebookingStatus;
  owner: string;
  lastSeason?: string;
  nextAction: string;
  dueAt?: string;
  note?: string;
};

export const REBOOKING_GROUPS: RebookingGroup[] = [
  { id: "rb-tonka-united", association: "Tonka United", program: "Travel teams", status: "rebooked", owner: "Josh", lastSeason: "Fall 2024", nextAction: "On the calendar — no action needed", dueAt: "Booked for Fall 2025" },
  { id: "rb-wayzata-hockey", association: "Wayzata Youth Hockey", status: "rebooked", owner: "Sam", lastSeason: "Winter 2024", nextAction: "Confirm rink date with association", dueAt: "Booked for Winter 2025" },
  { id: "rb-minnetonka-hockey", association: "Minnetonka Youth Hockey", program: "House teams", status: "date_held", owner: "Sam", lastSeason: "Winter 2024", nextAction: "Create job to convert the held date", dueAt: "Hold expires in 6 days" },
  { id: "rb-armstrong-baseball", association: "Armstrong Baseball", status: "in_conversation", owner: "Josh", lastSeason: "Spring 2024", nextAction: "Send proposed spring dates", dueAt: "Books around this time last year" },
  { id: "rb-lakeville-soccer", association: "Lakeville Soccer Club", status: "needs_follow_up", owner: "Sam", lastSeason: "Fall 2024", nextAction: "Follow up — no reply to last outreach", dueAt: "Follow-up overdue 3 days", note: "Booked late last year too." },
  { id: "rb-edina-lacrosse", association: "Edina Lacrosse", program: "Volleyball not returning", status: "at_risk", owner: "Josh", lastSeason: "Spring 2024", nextAction: "Call coordinator — considering another studio", dueAt: "At risk", note: "Rebooked lacrosse, volleyball undecided." },
  { id: "rb-hopkins-basketball", association: "Hopkins Basketball", status: "in_conversation", owner: "Sam", lastSeason: "Winter 2024", nextAction: "Confirm gym availability", dueAt: "Books around this time last year" },
  { id: "rb-stlouispark-soccer", association: "St. Louis Park Soccer", status: "needs_follow_up", owner: "Josh", lastSeason: "Fall 2024", nextAction: "Send rebooking outreach", dueAt: "Due this week" }
];

export type RebookingSummary = {
  expectedReturning: number;
  rebooked: number;
  percent: number;
  needsFollowUp: number;
  atRisk: number;
};

export function buildRebookingSummary(groups: RebookingGroup[] = REBOOKING_GROUPS): RebookingSummary {
  const expectedReturning = groups.filter((group) => group.status !== "lost").length;
  const rebooked = groups.filter((group) => group.status === "rebooked").length;
  const needsFollowUp = groups.filter((group) => group.status === "needs_follow_up").length;
  const atRisk = groups.filter((group) => group.status === "at_risk").length;
  const percent = expectedReturning === 0 ? 0 : Math.round((rebooked / expectedReturning) * 100);
  return { expectedReturning, rebooked, percent, needsFollowUp, atRisk };
}

// ---- Specialty Product Tracker ------------------------------------------------
// The big risk is products sent to Mike that become hard to track.

export type SpecialtyStatus =
  | "ready_for_design"
  | "in_design"
  | "sent_to_mike"
  | "proof_ready"
  | "sent_for_client_approval"
  | "revision_requested"
  | "approved"
  | "ready_to_fulfill"
  | "complete"
  | "at_risk";

export const SPECIALTY_STATUS_LABELS: Record<SpecialtyStatus, string> = {
  ready_for_design: "Ready for design",
  in_design: "In design",
  sent_to_mike: "Sent to Mike",
  proof_ready: "Proof ready",
  sent_for_client_approval: "Client approval",
  revision_requested: "Revision requested",
  approved: "Approved",
  ready_to_fulfill: "Ready to fulfill",
  complete: "Complete",
  at_risk: "At risk"
};

export const SPECIALTY_STATUS_TONES: Record<SpecialtyStatus, SportsTone> = {
  ready_for_design: "neutral",
  in_design: "info",
  sent_to_mike: "watch",
  proof_ready: "info",
  sent_for_client_approval: "watch",
  revision_requested: "warning",
  approved: "healthy",
  ready_to_fulfill: "healthy",
  complete: "healthy",
  at_risk: "critical"
};

export type SpecialtyProduct = {
  id: string;
  product: string;
  association: string;
  jobName: string;
  status: SpecialtyStatus;
  owner: string;
  dueAt?: string;
  needsJoshApproval?: boolean;
  needsClientApproval?: boolean;
  withMike?: boolean;
  blockingRelease?: boolean;
  ageWithMike?: string;
};

export const SPECIALTY_PRODUCTS: SpecialtyProduct[] = [
  { id: "sp-tonka-banner", product: "Team banners (12)", association: "Tonka United", jobName: "Tonka United Fall Teams", status: "sent_to_mike", owner: "Mike", dueAt: "Due in 4 days", withMike: true, ageWithMike: "With Mike 5 days — no proof", blockingRelease: true },
  { id: "sp-wayzata-posters", product: "Senior posters (8)", association: "Wayzata Youth Hockey", jobName: "Wayzata Hockey Day", status: "proof_ready", owner: "Josh", dueAt: "Due in 2 days", needsJoshApproval: true },
  { id: "sp-armstrong-memorymates", product: "Memory mates", association: "Armstrong Baseball", jobName: "Armstrong Spring", status: "revision_requested", owner: "Sam", dueAt: "Due tomorrow", needsClientApproval: true, blockingRelease: true },
  { id: "sp-minnetonka-banner", product: "Rink banner", association: "Minnetonka Youth Hockey", jobName: "Minnetonka House Teams", status: "sent_for_client_approval", owner: "Sam", dueAt: "Due in 3 days", needsClientApproval: true },
  { id: "sp-edina-graphics", product: "Team graphics set", association: "Edina Lacrosse", jobName: "Edina Lacrosse Day", status: "in_design", owner: "Production", dueAt: "Due in 6 days" },
  { id: "sp-hopkins-poster", product: "League poster", association: "Hopkins Basketball", jobName: "Hopkins Winter", status: "approved", owner: "Mike", dueAt: "Ready to fulfill" }
];

// ---- Current Season operating work --------------------------------------------

export type CurrentSeasonItem = {
  id: string;
  association: string;
  jobName: string;
  signal: string;
  tone: SportsTone;
  owner: string;
  when: string;
  nextAction: string;
  relatedJobId?: string;
};

export const CURRENT_SEASON_WORK: CurrentSeasonItem[] = [
  { id: "cs-maple-grove", association: "Maple Grove Sports", jobName: "Maple Grove Fall Teams", signal: "Shoot tomorrow · location changed, 1 photographer not acknowledged", tone: "critical", owner: "Josh", when: "Tomorrow 4:00 PM", nextAction: "Confirm crew acknowledged the dome change", relatedJobId: "job-sports-1" },
  { id: "cs-minnetonka-soccer", association: "Minnetonka Youth Soccer", jobName: "Minnetonka Youth Soccer", signal: "Within 72 hours · staffing incomplete (needs a 5th photographer)", tone: "warning", owner: "Carisa", when: "In 2 days", nextAction: "Confirm 5th photographer with Photography", relatedJobId: "minnetonka-soccer" },
  { id: "cs-wayzata-xc", association: "Wayzata Cross Country", jobName: "Wayzata XC Meet", signal: "Outdoor · wind on weather watch, rain plan not acknowledged", tone: "watch", owner: "Josh", when: "In 3 days", nextAction: "Confirm rain plan acknowledgements" },
  { id: "cs-armstrong-baseball", association: "Armstrong Baseball", jobName: "Armstrong Spring", signal: "Roster missing for a shoot in 48 hours", tone: "warning", owner: "Sam", when: "In 2 days", nextAction: "Verify roster with the coordinator" }
];

// ---- Production & Gallery Release (sports-relevant signals only) ---------------

export type ProductionSignal = {
  id: string;
  association: string;
  jobName: string;
  state: string;
  tone: SportsTone;
  owner: string;
  due: string;
  needsJoshApproval?: boolean;
  relatedJobId?: string;
};

export const PRODUCTION_SIGNALS: ProductionSignal[] = [
  { id: "pr-wayzata-gallery", association: "Wayzata Youth Hockey", jobName: "Wayzata Hockey Day", state: "Awaiting Josh approval to release", tone: "warning", owner: "Josh", due: "Promised in 2 days", needsJoshApproval: true },
  { id: "pr-tonka-gallery", association: "Tonka United", jobName: "Tonka United Fall Teams", state: "Behind promised delivery — banners blocking release", tone: "critical", owner: "Spencer", due: "Promised yesterday", relatedJobId: "job-sports-1" },
  { id: "pr-hopkins-gallery", association: "Hopkins Basketball", jobName: "Hopkins Winter", state: "In production — on track", tone: "healthy", owner: "Spencer", due: "Promised in 5 days" }
];

// ---- Staffing / Photography readiness (sports risk signals) -------------------

export type StaffingSignal = {
  id: string;
  association: string;
  jobName: string;
  issue: string;
  tone: SportsTone;
  owner: string;
  when: string;
  relatedJobId?: string;
};

export const STAFFING_SIGNALS: StaffingSignal[] = [
  { id: "st-minnetonka", association: "Minnetonka Youth Soccer", jobName: "Minnetonka Youth Soccer", issue: "Partially staffed — short a 5th photographer", tone: "warning", owner: "Carisa", when: "Shoot in 2 days", relatedJobId: "minnetonka-soccer" },
  { id: "st-maple-grove", association: "Maple Grove Sports", jobName: "Maple Grove Fall Teams", issue: "Photographer has not acknowledged the location change", tone: "critical", owner: "Carisa", when: "Shoot tomorrow", relatedJobId: "job-sports-1" },
  { id: "st-edina-vb", association: "Edina Volleyball", jobName: "Edina Volleyball", issue: "Call-out — needs a replacement photographer", tone: "critical", owner: "Josh", when: "Shoot in 4 days" }
];

// ---- Association Health --------------------------------------------------------

export type AssociationHealth = {
  id: string;
  association: string;
  status: SportsTone;
  statusLabel: string;
  signal: string;
  owner: string;
};

export const ASSOCIATION_HEALTH: AssociationHealth[] = [
  { id: "ah-tonka", association: "Tonka United", status: "warning", statusLabel: "Watch", signal: "Banners behind, gallery blocked", owner: "Josh" },
  { id: "ah-edina-lax", association: "Edina Lacrosse", status: "critical", statusLabel: "At risk", signal: "Considering another studio; volleyball undecided", owner: "Josh" },
  { id: "ah-wayzata", association: "Wayzata Youth Hockey", status: "healthy", statusLabel: "Healthy", signal: "Rebooked; gallery awaiting your approval", owner: "Sam" },
  { id: "ah-lakeville", association: "Lakeville Soccer Club", status: "warning", statusLabel: "Watch", signal: "Rebooking follow-up overdue", owner: "Sam" }
];

// ---- Sam's sports workspace (task-focused, no revenue) -------------------------

export type SamGroup = {
  id: string;
  association: string;
  status: SportsTone;
  statusLabel: string;
  nextAction: string;
  dueAt: string;
  upcomingShoot?: string;
  waitingOn?: string;
};

export const SAM_GROUPS: SamGroup[] = [
  { id: "sg-armstrong", association: "Armstrong Baseball", status: "warning", statusLabel: "Roster missing", nextAction: "Verify roster with the coordinator", dueAt: "Due tomorrow", upcomingShoot: "Spring shoot in 2 days", waitingOn: "Coach" },
  { id: "sg-minnetonka-hockey", association: "Minnetonka Youth Hockey", status: "info", statusLabel: "Date held", nextAction: "Create the job to convert the held date", dueAt: "Hold expires in 6 days" },
  { id: "sg-lakeville", association: "Lakeville Soccer Club", status: "warning", statusLabel: "Needs follow-up", nextAction: "Follow up on rebooking outreach", dueAt: "Overdue 3 days", waitingOn: "Client" },
  { id: "sg-wayzata-hockey", association: "Wayzata Youth Hockey", status: "healthy", statusLabel: "On track", nextAction: "Confirm rink date", dueAt: "Due this week", upcomingShoot: "Hockey day in 9 days" }
];

export type SamAction = {
  id: string;
  label: string;
  association: string;
  tone: SportsTone;
  due: string;
  relatedJobId?: string;
};

export const SAM_NEXT_ACTIONS: SamAction[] = [
  { id: "sa-armstrong-roster", label: "Verify roster", association: "Armstrong Baseball", tone: "warning", due: "Due tomorrow" },
  { id: "sa-lakeville-followup", label: "Follow up with client", association: "Lakeville Soccer Club", tone: "warning", due: "Overdue 3 days" },
  { id: "sa-minnetonka-job", label: "Create job for held date", association: "Minnetonka Youth Hockey", tone: "info", due: "Within 6 days" },
  { id: "sa-wayzata-schedule", label: "Build shoot schedule", association: "Wayzata Youth Hockey", tone: "neutral", due: "Due this week" },
  { id: "sa-hopkins-confirm", label: "Confirm gym availability", association: "Hopkins Basketball", tone: "neutral", due: "Due this week" }
];

export type SamWaiting = {
  id: string;
  association: string;
  waitingOn: string;
  detail: string;
  since: string;
};

export const SAM_WAITING_ON: SamWaiting[] = [
  { id: "sw-armstrong", association: "Armstrong Baseball", waitingOn: "Coach", detail: "Final roster", since: "2 days" },
  { id: "sw-lakeville", association: "Lakeville Soccer Club", waitingOn: "Client", detail: "Reply to rebooking outreach", since: "3 days" },
  { id: "sw-minnetonka", association: "Minnetonka Youth Hockey", waitingOn: "Josh", detail: "Confirm rink date works", since: "1 day" }
];

// ---- Sports Pulse builder (derives counts from the demo arrays + change count) -

export function buildSportsPulse(unacknowledgedChanges: number): SportsPulseCard[] {
  const rebooking = buildRebookingSummary();
  const specialtyAtRisk = SPECIALTY_PRODUCTS.filter(
    (product) => product.status === "at_risk" || product.blockingRelease || (product.withMike && product.ageWithMike)
  ).length;
  const staffingRisks = STAFFING_SIGNALS.length;
  const productionDelays = PRODUCTION_SIGNALS.filter((signal) => signal.tone === "critical").length;
  const galleriesAwaiting = PRODUCTION_SIGNALS.filter((signal) => signal.needsJoshApproval).length;
  const atRiskAssociations = ASSOCIATION_HEALTH.filter((association) => association.status === "critical").length;
  const missingRosters = CURRENT_SEASON_WORK.filter((item) => /roster/i.test(item.signal)).length;
  const unconfirmed = CURRENT_SEASON_WORK.filter((item) => /unconfirmed|not acknowledged|incomplete/i.test(item.signal)).length;

  return [
    { id: "shoots-this-week", label: "Shoots This Week", value: "9", helper: "9 sports shoots · 2 need follow-up.", tone: "watch", drilldownHash: "#sports/shoots", drilldownLabel: "Open sports shoots" },
    { id: "changes-ack", label: "Changes Needing Ack", value: String(unacknowledgedChanges), helper: "Unacknowledged changes for upcoming shoots.", tone: unacknowledgedChanges > 0 ? "critical" : "healthy", drilldownHash: "#sports/shoots", drilldownLabel: "Review changes" },
    { id: "unconfirmed", label: "Unconfirmed Shoots", value: String(unconfirmed), helper: "Details not confirmed close to shoot date.", tone: unconfirmed > 0 ? "warning" : "healthy", drilldownHash: "#sports/shoots", drilldownLabel: "View shoots" },
    { id: "missing-rosters", label: "Missing Rosters", value: String(missingRosters), helper: "Rosters missing within 72 hours.", tone: missingRosters > 0 ? "warning" : "healthy", drilldownHash: "#sports/shoots", drilldownLabel: "View shoots" },
    { id: "staffing-risks", label: "Staffing Risks", value: String(staffingRisks), helper: "Unstaffed, partial, or unacknowledged crew.", tone: "warning", drilldownHash: "#operations/staffing", drilldownLabel: "Open staffing" },
    { id: "production-delays", label: "Production Delays", value: String(productionDelays), helper: "Sports jobs behind promised delivery.", tone: productionDelays > 0 ? "critical" : "healthy", drilldownHash: "#sports/graphics", drilldownLabel: "Open production" },
    { id: "specialty-risk", label: "Specialty At Risk", value: String(specialtyAtRisk), helper: "Stuck with Mike, revisions, or blocking release.", tone: specialtyAtRisk > 0 ? "critical" : "healthy", drilldownHash: "#sports/graphics", drilldownLabel: "Open specialty" },
    { id: "galleries-awaiting", label: "Awaiting Your Approval", value: String(galleriesAwaiting), helper: "Galleries waiting on your release.", tone: galleriesAwaiting > 0 ? "warning" : "healthy", drilldownHash: "#sports/peer-qa", drilldownLabel: "Review galleries" },
    { id: "rebooking", label: "Rebooking", value: `${rebooking.percent}%`, helper: `${rebooking.rebooked} of ${rebooking.expectedReturning} returning groups booked.`, tone: rebooking.percent >= 70 ? "healthy" : "watch", drilldownHash: "#sports/accounts", drilldownLabel: "Open rebooking" },
    { id: "at-risk-associations", label: "At-Risk Associations", value: String(atRiskAssociations), helper: "Associations that may not return.", tone: atRiskAssociations > 0 ? "critical" : "healthy", drilldownHash: "#sports/accounts", drilldownLabel: "View associations" }
  ];
}
