import type { OperatingArea } from "./homeRoles";
import { OPERATING_AREA_LABELS } from "./homeRoles";
import type { ActionTarget } from "./actionTargets";
import type { NeedsAttentionItem } from "./needsAttention";

// Realistic, demo-safe Kemmetmueller data so Home clearly proves the operating
// model. Replaceable later with real backend signals. Severity/tone vocab is
// kept consistent with the rest of the app (neutral|info|success|warning|danger,
// plus watch/critical where a card needs an extra step).

export type CommandCardTone = "critical" | "warning" | "watch" | "healthy" | "neutral";

// How a card's displayed value is sourced:
//   live        — a real count from a canonical backend (shown as a true number)
//   sample      — illustrative demo data (must be visibly labeled, never live truth)
//   unavailable — no connected source (rendered disabled with a reason, no count)
export type CommandCardDataSource = "live" | "sample" | "unavailable";

export type CompanyCommandCard = {
  id: string;
  label: string;
  value: string;
  helper: string;
  tone: CommandCardTone;
  dataSource: CommandCardDataSource;
  target: ActionTarget;
  drilldownLabel: string;
};

export type AreaStatus = "healthy" | "watch" | "urgent";

export type OperatingAreaPulseCard = {
  area: OperatingArea;
  label: string;
  status: AreaStatus;
  owner: string;
  issues: string[];
  nextAction: string;
  dependency?: string;
  drilldownHash: string;
};

export type AttendanceRiskRow = {
  id: string;
  employee: string;
  job: string;
  area: OperatingArea;
  callTime: string;
  statusLabel: string;
  tone: CommandCardTone;
  owner: string;
  action: string;
  relatedJobId?: string;
};

export type WeatherImpactItem = {
  id: string;
  job: string;
  area: OperatingArea;
  risk: string;
  owner: string;
  plan: string;
  acknowledgment: string;
  acknowledged: boolean;
  indoorBackup: "yes" | "no" | "na";
  level: "watch" | "urgent";
  relatedJobId?: string;
};

export type ReportTone = "good" | "watch" | "neutral" | "future";

export type LeadershipReportCard = {
  id: string;
  label: string;
  value: string;
  trend: string;
  tone: ReportTone;
};

// ---- Company Needs Attention --------------------------------------------------

export const DEMO_NEEDS_ATTENTION: NeedsAttentionItem[] = [
  {
    id: "na-edina-soccer-clockin",
    area: "staffing",
    title: "Edina Soccer photographer not clocked in",
    issue: "Call time passed at 3:15 PM and the assigned photographer is not clocked in.",
    owner: "Carisa",
    nextAction: "Call / replace / notify lead",
    ageLabel: "20 min past call time",
    relatedJobId: "edina-soccer",
    relatedJobName: "Edina Soccer",
    reasons: ["late"],
    severity: "urgent",
    status: "open"
  },
  {
    id: "na-white-bear-gallery-delivery",
    area: "production",
    title: "White Bear gallery behind promised delivery",
    issue: "Gallery promised Friday and production is not complete; QA step was due yesterday.",
    owner: "Spencer",
    nextAction: "Reassign queue by noon",
    dueAt: "Promised Friday",
    relatedJobId: "white-bear-gallery",
    relatedJobName: "White Bear Lake Gallery",
    reasons: ["behind_promised_delivery", "late"],
    severity: "urgent",
    status: "in_progress"
  },
  {
    id: "na-minnetonka-soccer-staffing",
    area: "sports",
    title: "Minnetonka shoot tomorrow, staffing incomplete",
    issue: "Outdoor sports shoot is within 72 hours and is missing a fifth photographer.",
    owner: "Josh",
    nextAction: "Confirm 5th photographer today",
    dueAt: "Shoot tomorrow",
    relatedJobId: "minnetonka-soccer",
    relatedJobName: "Minnetonka Youth Soccer",
    reasons: ["affects_client_or_shoot_72h"],
    severity: "urgent",
    status: "open"
  },
  {
    id: "na-production-qa-late",
    area: "production",
    title: "Production QA correction step is late",
    issue: "QA correction step was due yesterday and is blocking the White Bear gallery.",
    owner: "Spencer",
    nextAction: "Clear QA corrections by end of day",
    ageLabel: "1 day late",
    relatedJobId: "white-bear-gallery",
    relatedJobName: "White Bear Lake Gallery",
    reasons: ["late"],
    severity: "urgent",
    status: "open"
  },
  {
    id: "na-wayzata-qr-ack",
    area: "schools",
    title: "Wayzata QR code packet not acknowledged",
    issue: "QR code packet was sent to the photographer but has not been acknowledged; picture day is this week.",
    owner: "Jessica",
    nextAction: "Confirm packet reached photographer",
    dueAt: "Picture day in 2 days",
    relatedJobId: "wayzata-pd",
    relatedJobName: "Wayzata High School Picture Day",
    reasons: ["not_acknowledged", "affects_client_or_shoot_72h"],
    severity: "watch",
    status: "open"
  },
  {
    id: "na-sports-weather-ack",
    area: "sports",
    title: "Outdoor sports jobs on weather watch",
    issue: "Storms forecast after 6 PM for outdoor shoots within 72 hours; rain plan not yet acknowledged by all crew.",
    owner: "Josh",
    nextAction: "Confirm rain plan and acknowledgements",
    dueAt: "Within 72 hours",
    relatedJobId: "minnetonka-soccer",
    relatedJobName: "Minnetonka Youth Soccer",
    reasons: ["affects_client_or_shoot_72h", "not_acknowledged"],
    severity: "watch",
    status: "open"
  },
  {
    id: "na-client-response-target",
    area: "client_success",
    title: "Client issue over response target",
    issue: "An open client case has passed its response target and needs resolution or escalation.",
    owner: "Greta",
    nextAction: "Resolve or escalate today",
    ageLabel: "Over response target",
    reasons: ["late"],
    severity: "watch",
    status: "open"
  },
  {
    id: "na-minnetonka-lead-ack",
    area: "photography",
    title: "Minnetonka Youth Sports lead has not acknowledged",
    issue: "The assigned lead has not acknowledged the assignment for a shoot within 72 hours.",
    owner: "Carisa",
    nextAction: "Confirm the lead acknowledges the assignment",
    dueAt: "Shoot tomorrow",
    relatedJobId: "minnetonka-soccer",
    relatedJobName: "Minnetonka Youth Soccer",
    reasons: ["not_acknowledged", "affects_client_or_shoot_72h"],
    severity: "watch",
    status: "open"
  },
  {
    id: "na-client-missing-details",
    area: "client_success",
    title: "Client has not provided required shoot details",
    issue: "Required details for a shoot this week are still outstanding from the client.",
    owner: "Greta",
    nextAction: "Follow up with the client today",
    dueAt: "Shoot this week",
    reasons: ["affects_client_or_shoot_72h", "missing_required_details"],
    severity: "watch",
    status: "waiting"
  }
];

// ---- Company Command top row (locked eight cards) -----------------------------

export function buildCompanyCommandCards(): CompanyCommandCard[] {
  return [
    {
      id: "on-fire",
      // Live: the real unresolved urgent count is injected at render from the same
      // /api/exceptions source the Urgent Window uses (value here is a placeholder).
      label: "On Fire",
      value: "—",
      helper: "Unresolved urgent issues needing leadership action now.",
      tone: "critical",
      dataSource: "live",
      target: { sourceType: "urgent_window", focus: { status: "open" } },
      drilldownLabel: "Open Urgent Window"
    },
    {
      id: "shoots-today",
      label: "Shoots Today",
      value: "18",
      helper: "Illustrative — open the schedule for today's live shoots.",
      tone: "watch",
      dataSource: "sample",
      target: { sourceType: "schedule" },
      drilldownLabel: "Open today's schedule"
    },
    {
      id: "staffing-risk",
      label: "Staffing Risk",
      value: "3",
      helper: "Illustrative — open the staffing board for live coverage risk.",
      tone: "warning",
      dataSource: "sample",
      target: { sourceType: "staffing" },
      drilldownLabel: "Open staffing board"
    },
    {
      id: "late-not-clocked-in",
      label: "Late / Not Clocked In",
      value: "2",
      helper: "Sample figure — live clock-in status is on the Attendance page.",
      tone: "critical",
      dataSource: "sample",
      target: { sourceType: "attendance" },
      drilldownLabel: "View attendance"
    },
    {
      id: "jobs-behind",
      label: "Jobs Behind",
      value: "5",
      helper: "Sample figure — live delivery risk is in Production Tracker.",
      tone: "warning",
      dataSource: "sample",
      target: { sourceType: "project_tracking" },
      drilldownLabel: "Open project tracking"
    },
    {
      id: "weather-watch",
      label: "Weather Watch",
      value: "—",
      helper: "No live weather provider connected.",
      tone: "watch",
      dataSource: "unavailable",
      target: { sourceType: "weather", unavailableReason: "No live weather provider connected." },
      drilldownLabel: "Review affected shoots"
    },
    {
      id: "production-load",
      label: "Production Load",
      value: "5 behind",
      helper: "Illustrative — open Production for live delivery load.",
      tone: "warning",
      dataSource: "sample",
      target: { sourceType: "production" },
      drilldownLabel: "Open production"
    },
    {
      id: "client-issues",
      // No canonical client-case source feeds an urgent count, so this is shown as
      // not-connected rather than implying specific unresolved cases exist.
      label: "Client Issues",
      value: "—",
      helper: "No live client-case feed connected — client issues are not tracked here yet.",
      tone: "watch",
      dataSource: "unavailable",
      target: {
        sourceType: "client_case",
        unavailableReason: "No live client-case feed connected — client issues are not tracked here yet."
      },
      drilldownLabel: "Open client success"
    }
  ];
}

// ---- Operating Area Pulse -----------------------------------------------------

export const OPERATING_AREA_PULSE: OperatingAreaPulseCard[] = [
  {
    area: "schools",
    label: OPERATING_AREA_LABELS.schools,
    status: "watch",
    owner: "Jessica",
    issues: ["2 jobs need details confirmation", "Wayzata QR packet not acknowledged", "3 picture days this week"],
    nextAction: "Confirm Wayzata packet and outstanding details",
    dependency: "Production dependency: 2 galleries due Friday",
    drilldownHash: "#schools"
  },
  {
    area: "sports",
    label: OPERATING_AREA_LABELS.sports,
    status: "watch",
    owner: "Josh",
    issues: ["6 outdoor jobs on weather watch", "2 schedule changes not acknowledged", "1 location changed in last 24 hours"],
    nextAction: "Confirm rain plans and schedule acknowledgements",
    dependency: "Weather dependency: storms forecast after 6 PM",
    drilldownHash: "#sports"
  },
  {
    area: "photography",
    label: "Photography / Staffing",
    status: "urgent",
    owner: "Carisa",
    issues: ["2 late / not clocked in", "1 call-out risk", "1 shoot lacks backup coverage"],
    nextAction: "Cover Edina Soccer and confirm crew",
    dependency: "Sports dependency: Minnetonka needs a 5th photographer",
    drilldownHash: "#operations/staffing"
  },
  {
    area: "production",
    label: OPERATING_AREA_LABELS.production,
    status: "urgent",
    owner: "Spencer",
    issues: ["5 jobs behind promised delivery", "Poster queue cleared", "Tomorrow's production load is low"],
    nextAction: "Reassign White Bear gallery by noon",
    dependency: "Schools dependency: 2 galleries due Friday",
    drilldownHash: "#production"
  },
  {
    area: "client_success",
    label: OPERATING_AREA_LABELS.client_success,
    status: "watch",
    owner: "Greta",
    issues: ["2 client cases over response target", "1 archive request needs follow-up"],
    nextAction: "Resolve or escalate the over-target case today",
    dependency: "Schools dependency: Wayzata details still outstanding",
    drilldownHash: "#leadership"
  },
  {
    area: "sales_orders",
    label: OPERATING_AREA_LABELS.sales_orders,
    status: "healthy",
    owner: "Matthew",
    issues: ["Order performance on pace", "Capture / Zenfolio integration coming soon"],
    nextAction: "No action needed",
    drilldownHash: "#leadership"
  },
  {
    area: "weather",
    label: OPERATING_AREA_LABELS.weather,
    status: "watch",
    owner: "Josh",
    issues: ["6 outdoor jobs at risk", "2 no indoor backup listed", "3 weather notices not acknowledged"],
    nextAction: "Confirm rain plans and indoor backups",
    dependency: "Affects Sports, Photography, and scheduling",
    drilldownHash: "#schedule"
  }
];

// ---- People / Attendance Risk -------------------------------------------------

export const DEMO_ATTENDANCE_RISK: AttendanceRiskRow[] = [
  {
    id: "att-amanda-edina",
    employee: "Amanda Reyes",
    job: "Edina Soccer",
    area: "staffing",
    callTime: "3:15 PM",
    statusLabel: "Not clocked in",
    tone: "critical",
    owner: "Carisa",
    action: "Call / replace / notify lead",
    relatedJobId: "edina-soccer"
  },
  {
    id: "att-devon-minnetonka",
    employee: "Devon Clark",
    job: "Minnetonka Youth Sports",
    area: "photography",
    callTime: "8:00 AM",
    statusLabel: "Late clock-in",
    tone: "warning",
    owner: "Carisa",
    action: "Confirm en route",
    relatedJobId: "minnetonka-soccer"
  },
  {
    id: "att-priya-wayzata",
    employee: "Priya Shah",
    job: "Wayzata Picture Day",
    area: "schools",
    callTime: "7:30 AM",
    statusLabel: "Assigned, not acknowledged",
    tone: "warning",
    owner: "Jessica",
    action: "Confirm assignment",
    relatedJobId: "wayzata-pd"
  },
  {
    id: "att-whitebear-crew",
    employee: "White Bear Track (crew)",
    job: "White Bear Track Meet",
    area: "photography",
    callTime: "4:30 PM",
    statusLabel: "Shoot without full crew (3 of 4)",
    tone: "warning",
    owner: "Carisa",
    action: "Add one assistant"
  },
  {
    id: "att-sam-edina-vb",
    employee: "Sam Olson",
    job: "Edina Volleyball",
    area: "sports",
    callTime: "5:00 PM",
    statusLabel: "Call-out",
    tone: "critical",
    owner: "Josh",
    action: "Replace photographer"
  }
];

// ---- Weather Impact -----------------------------------------------------------

export const DEMO_WEATHER_IMPACT: WeatherImpactItem[] = [
  {
    id: "wx-minnetonka",
    job: "Minnetonka Youth Soccer",
    area: "sports",
    risk: "Storms after 6 PM",
    owner: "Josh",
    plan: "Confirm rain plan",
    acknowledgment: "3 of 5 crew acknowledged",
    acknowledged: false,
    indoorBackup: "no",
    level: "urgent",
    relatedJobId: "minnetonka-soccer"
  },
  {
    id: "wx-whitebear-track",
    job: "White Bear Track Meet",
    area: "sports",
    risk: "Lightning risk late afternoon",
    owner: "Josh",
    plan: "Confirm indoor backup",
    acknowledgment: "0 of 4 acknowledged",
    acknowledged: false,
    indoorBackup: "no",
    level: "urgent"
  },
  {
    id: "wx-wayzata-xc",
    job: "Wayzata Cross Country",
    area: "sports",
    risk: "Wind gusts 30+ mph",
    owner: "Josh",
    plan: "Secure backdrops and tents",
    acknowledgment: "2 of 3 acknowledged",
    acknowledged: false,
    indoorBackup: "na",
    level: "watch"
  },
  {
    id: "wx-edina-outdoor",
    job: "Edina Outdoor Sports Day",
    area: "photography",
    risk: "Heat advisory · high UV",
    owner: "Carisa",
    plan: "Add water and shade breaks",
    acknowledgment: "4 of 4 acknowledged",
    acknowledged: true,
    indoorBackup: "na",
    level: "watch"
  }
];

// ---- Leadership Reports Strip --------------------------------------------------

export const DEMO_LEADERSHIP_REPORTS: LeadershipReportCard[] = [
  { id: "rep-cs-pulse", label: "Customer service pulse", value: "12 open", trend: "2 over target", tone: "watch" },
  { id: "rep-sales", label: "Sales / order trends", value: "On pace", trend: "+4% vs typical", tone: "good" },
  { id: "rep-gallery", label: "Gallery performance", value: "94% on-time", trend: "Stable", tone: "neutral" },
  { id: "rep-throughput", label: "Production throughput", value: "38 jobs / wk", trend: "-6% vs peak", tone: "watch" },
  { id: "rep-evals", label: "Post-shoot eval trends", value: "4.4 / 5 avg", trend: "Steady", tone: "good" },
  { id: "rep-survey", label: "Client survey trends", value: "4.8 / 5", trend: "+0.2", tone: "good" },
  { id: "rep-capture", label: "Capture integration", value: "Coming soon", trend: "Future", tone: "future" },
  { id: "rep-zenfolio", label: "Zenfolio integration", value: "Coming soon", trend: "Future", tone: "future" },
  { id: "rep-zendesk", label: "Zendesk integration", value: "Coming soon", trend: "Future", tone: "future" }
];

// ---- My Workspace (associate) views ------------------------------------------

export type SeasonalShift = {
  jobName: string;
  callTime: string;
  startTime: string;
  endTime?: string;
  location: string;
  mapUrl: string;
  lead: string;
  role: string;
  weatherNote?: string;
  action?: string;
  relatedJobId?: string;
};

export type PrepChecklistItem = { id: string; label: string; done: boolean };

export type AssociateChangeNotice = { id: string; title: string; detail: string; acknowledged: boolean };

export const SEASONAL_SHIFT: SeasonalShift = {
  jobName: "Minnetonka Youth Soccer",
  callTime: "3:15 PM",
  startTime: "4:00 PM",
  endTime: "7:00 PM",
  location: "Field 3, Minnetonka Civic Center",
  mapUrl: "https://www.google.com/maps/search/?api=1&query=Minnetonka+Civic+Center",
  lead: "Sam Olson",
  role: "Individual camera",
  weatherNote: "Storm risk after 6 PM — rain plan attached",
  action: "Acknowledge rain plan",
  relatedJobId: "minnetonka-soccer"
};

export const SEASONAL_PREP_CHECKLIST: PrepChecklistItem[] = [
  { id: "prep-gear", label: "Confirm gear: 2 bodies, 85mm, backup batteries", done: true },
  { id: "prep-qr", label: "Pick up QR code packet from office", done: false },
  { id: "prep-shotlist", label: "Review shot list and roster", done: true },
  { id: "prep-rain", label: "Read and acknowledge rain plan", done: false }
];

export const SEASONAL_CHANGE_NOTICES: AssociateChangeNotice[] = [
  { id: "chg-calltime", title: "Call time moved 3:30 → 3:15 PM", detail: "Arrive 15 minutes earlier for setup.", acknowledged: false },
  { id: "chg-location", title: "Location set to Field 3", detail: "Park in the south lot; enter through the west gate.", acknowledged: true }
];

export const SEASONAL_TIME_CLOCK = { state: "Not clocked in", helper: "Clock in when you arrive at the field." };

export const SEASONAL_EVAL_PROMPT = {
  job: "Edina Soccer (yesterday)",
  prompt: "Add your post-shoot eval so the next crew knows what to expect."
};

export type GraphicArtistJob = {
  id: string;
  name: string;
  status: string;
  tone: CommandCardTone;
  due: string;
  relatedJobId?: string;
};

export const GRAPHIC_ARTIST_QUEUE = {
  assigned: 5,
  dueToday: 2,
  dueSoon: 3,
  blocked: 1,
  qaCorrections: 3,
  jobs: [
    { id: "ga-white-bear", name: "White Bear Lake Gallery", status: "Behind promised delivery", tone: "critical", due: "Due today", relatedJobId: "white-bear-gallery" },
    { id: "ga-edina-posters", name: "Edina Senior Posters", status: "QA correction", tone: "warning", due: "Due today", relatedJobId: "edina-soccer" },
    { id: "ga-wayzata-composites", name: "Wayzata Team Composites", status: "Blocked — missing files", tone: "warning", due: "Due soon", relatedJobId: "wayzata-pd" },
    { id: "ga-minnetonka-banners", name: "Minnetonka Banners", status: "In queue", tone: "neutral", due: "Due soon" }
  ] as GraphicArtistJob[],
  notes: [
    "Spencer: prioritize White Bear — promised Friday.",
    "Reupload missing Wayzata files before starting composites."
  ]
};

export const GRAPHIC_ARTIST_TIME_CLOCK = { state: "Clocked in", helper: "Started 8:02 AM · 3.5h today." };

export type CsrCase = {
  id: string;
  client: string;
  issue: string;
  tone: CommandCardTone;
  due: string;
  relatedJobId?: string;
};

export const CSR_QUEUE = {
  openCases: 7,
  dueToday: 2,
  overTarget: 1,
  archiveRequests: 3,
  cases: [
    { id: "csr-edina-order", client: "Edina parent", issue: "Missing order — over response target", tone: "critical", due: "Due today", relatedJobId: "edina-soccer" },
    { id: "csr-wayzata-details", client: "Wayzata High School", issue: "Outstanding shoot details follow-up", tone: "warning", due: "Due today", relatedJobId: "wayzata-pd" },
    { id: "csr-white-bear-archive", client: "White Bear Lake", issue: "Archive request needs follow-up", tone: "neutral", due: "This week", relatedJobId: "white-bear-gallery" },
    { id: "csr-minnetonka-reschedule", client: "Minnetonka Youth Sports", issue: "Reschedule question", tone: "neutral", due: "This week", relatedJobId: "minnetonka-soccer" }
  ] as CsrCase[]
};

export const CSR_TIME_CLOCK = { state: "Clocked in", helper: "Started 8:30 AM · 2.0h today." };
