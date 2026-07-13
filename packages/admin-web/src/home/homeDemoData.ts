import type { OperatingArea } from "./homeRoles";
import { OPERATING_AREA_LABELS } from "./homeRoles";
import type { ActionTarget } from "./actionTargets";

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
      value: "—",
      helper: "Jobs behind on readiness — open Jobs to review.",
      tone: "warning",
      dataSource: "live",
      target: { sourceType: "job", focus: { readinessStatus: "off_track" } },
      drilldownLabel: "Open jobs behind"
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
      value: "—",
      helper: "Production work blocked — open the Production queue to clear it.",
      tone: "warning",
      dataSource: "live",
      target: { sourceType: "production", focus: { stage: "blocked" } },
      drilldownLabel: "Open blocked production"
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
