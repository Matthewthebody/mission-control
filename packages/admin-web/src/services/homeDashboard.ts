import { apiFetch } from "../api";
import type { HomeDashboardMode, HomeDashboardResponse, HomeWidgetTone, ManagerCockpitResponse } from "../types";

export type HomeWidgetId =
  | "today_strip"
  | "attendance_awareness"
  | "business_pulse"
  | "production_projects"
  | "urgent_watch"
  | "today_shoots"
  | "weather_travel_watch"
  | "customer_service_pulse"
  | "places_that_need_more_love"
  | "labor_snapshot_today";

export type HomeWidgetDefinition = {
  id: HomeWidgetId;
  title: string;
  priority: "P0" | "P1" | "P2" | "P3";
  purpose: string;
  dataSource: string;
  visibleTo: string;
  clickable: boolean;
  drilldown: string;
  refreshBehavior: string;
  desktopLayout: string;
  laptopLayout: string;
  emptyState: string;
  severityTreatment: string;
  tvModeTreatment: string;
};

export const HOME_WIDGET_DEFINITIONS: Record<HomeWidgetId, HomeWidgetDefinition> = {
  today_strip: {
    id: "today_strip",
    title: "Today Strip",
    priority: "P0",
    purpose: "Show the operating-day counts leadership and managers need before they drill into attendance, shoots, or production.",
    dataSource: "Home dashboard rollup from shoots, approvals, attendance, and production risk.",
    visibleTo: "Leadership and manager dashboard users.",
    clickable: true,
    drilldown: "Anchors the compact Today strip and links into Operations, Attendance, Employees, and Production workflows.",
    refreshBehavior: "Refreshes every 60 seconds with the main Home payload.",
    desktopLayout: "Full-width compact strip directly below What Needs Attention Right Now.",
    laptopLayout: "Full-width compact strip directly below What Needs Attention Right Now.",
    emptyState: "Today still shows cleanly even when counts are zero.",
    severityTreatment: "Urgent issues, late arrivals, approvals, and production risk stay count-first.",
    tvModeTreatment: "Hidden in TV mode."
  },
  attendance_awareness: {
    id: "attendance_awareness",
    title: "Attendance Awareness",
    priority: "P1",
    purpose: "Show who is clocked in, not clocked in, late, missing, or at the wrong location without opening the full attendance workspace.",
    dataSource: "Time clock sessions, live presence observation, scheduled shifts, and attendance exception tracking.",
    visibleTo: "Leadership and manager dashboard users.",
    clickable: false,
    drilldown: "Acts as a compact scan widget with drill-in routes into Operations > Attendance.",
    refreshBehavior: "Refreshes every 60 seconds with live attendance socket refreshes.",
    desktopLayout: "Large left-side operational card paired with Production Snapshot.",
    laptopLayout: "Large stacked card focused on exception buckets.",
    emptyState: "No attendance issues or active clock-ins need attention right now.",
    severityTreatment: "Missing, late, wrong-location, and not-clocked-in states stay explicit and action-oriented.",
    tvModeTreatment: "Hidden in TV mode."
  },
  business_pulse: {
    id: "business_pulse",
    title: "Business Pulse",
    priority: "P0",
    purpose: "Show the quickest possible top-line status of the business for this week and today.",
    dataSource: "Scheduling totals plus production queue adapter and operational reporting.",
    visibleTo: "Leadership dashboard users and office TV mode.",
    clickable: true,
    drilldown: "Opens a focused insight overlay with weekly volume, queue context, and jobs needing attention.",
    refreshBehavior: "Auto-refresh every 60 seconds with manual refresh support.",
    desktopLayout: "Full-width ribbon across the top row.",
    laptopLayout: "Full-width ribbon across the top row.",
    emptyState: "Shows zero states cleanly instead of an empty widget.",
    severityTreatment: "Counts stay neutral or informational except for queue pressure and jobs needing attention.",
    tvModeTreatment: "Always visible with larger numerals and public-safe copy."
  },
  production_projects: {
    id: "production_projects",
    title: "Production Snapshot",
    priority: "P0",
    purpose: "Show work in progress, blocked items, overdue work, and owner pressure without leaving Home.",
    dataSource: "Production project board projection with ownership, due-state, and QA-stage rollups.",
    visibleTo: "Leadership and manager dashboard users. Hidden in TV mode.",
    clickable: true,
    drilldown: "Jumps into Production so managers can assign, review, and advance work.",
    refreshBehavior: "Refreshes with the main home dashboard cadence and manual refresh support.",
    desktopLayout: "Large right-side operational card paired with Attendance Awareness.",
    laptopLayout: "Full-width production control snapshot below attendance.",
    emptyState: "No active production work needs attention right now.",
    severityTreatment: "Overdue, peer-review, and final-QC pressure become the main urgency drivers.",
    tvModeTreatment: "Hidden in TV mode because owner-level project detail is not public-safe."
  },
  urgent_watch: {
    id: "urgent_watch",
    title: "What Needs Attention Right Now",
    priority: "P0",
    purpose: "Turn the next 24 hours of operational risk into a compact action list with exact drill-ins.",
    dataSource: "Backend-authored home dashboard projection that combines same-day operations, attendance, and production urgency.",
    visibleTo: "Leadership and manager dashboard users.",
    clickable: true,
    drilldown: "Each watch item can preview inline on Home or deep-link into its owning workspace with context preserved.",
    refreshBehavior: "Refreshes with the main home dashboard cadence and live socket refreshes where available.",
    desktopLayout: "Compact full-width alert block near the top of Home that expands when urgency is real.",
    laptopLayout: "Compact full-width alert block near the top of Home.",
    emptyState: "Hidden when no urgent items are due in the next 24 hours.",
    severityTreatment: "Uses red plus explicit urgency wording and badges instead of relying on color alone.",
    tvModeTreatment: "Hidden in TV mode because the main app is the actionable destination."
  },
  today_shoots: {
    id: "today_shoots",
    title: "Today's Shoots",
    priority: "P0",
    purpose: "Show what is happening today, what is next, and which shoots deserve a closer look.",
    dataSource: "Unified shoot schedule and location context.",
    visibleTo: "Leadership dashboard users and office TV mode.",
    clickable: true,
    drilldown: "Opens a large operational workspace for the selected shoot.",
    refreshBehavior: "Auto-refresh every 60 seconds with live socket refreshes where available.",
    desktopLayout: "Primary hero widget spanning the left side of the second row.",
    laptopLayout: "Full-width hero widget.",
    emptyState: "No shoots or meetings scheduled for today.",
    severityTreatment: "Mostly neutral with amber or red only for real operational blockers.",
    tvModeTreatment: "Time-first grouping, larger copy, no employee names by default."
  },
  weather_travel_watch: {
    id: "weather_travel_watch",
    title: "Weather & Travel",
    priority: "P1",
    purpose: "Surface weather and route issues that could affect the day.",
    dataSource: "Weather and travel adapter wired to scheduled locations.",
    visibleTo: "Leadership dashboard users, office TV mode, and senior field leaders when allowed.",
    clickable: true,
    drilldown: "Highlights today-only watch items and links directly into the affected shoot workspace.",
    refreshBehavior: "Primary dashboard refreshes every 60 seconds and carries a dedicated 5-minute watch cadence.",
    desktopLayout: "Right column companion to Today's Shoots.",
    laptopLayout: "Full-width below Today's Shoots.",
    emptyState: "No weather or travel issues right now.",
    severityTreatment: "Neutral when clear, amber for manageable friction, red for severe disruption.",
    tvModeTreatment: "Visible as concise banners with readable text instead of tiny icons."
  },
  customer_service_pulse: {
    id: "customer_service_pulse",
    title: "Customer Service Pulse",
    priority: "P1",
    purpose: "Give a quick sense of support health without turning the home screen into Zendesk.",
    dataSource: "Zendesk leadership summary with a public-safe summary shell.",
    visibleTo: "Leadership dashboard users and a safe TV summary.",
    clickable: true,
    drilldown: "Opens a support summary overlay with trend context and a link to Customer Service.",
    refreshBehavior: "Refreshes every 5 minutes and on manual dashboard refresh.",
    desktopLayout: "Small support block paired with My Follow-Ups near the bottom of Home.",
    laptopLayout: "Small support block beneath follow-ups when space is tight.",
    emptyState: "Support looks steady right now.",
    severityTreatment: "Green when healthy, amber when backlog grows, red when response health slips.",
    tvModeTreatment: "Counts and health only, never names or ticket contents."
  },
  places_that_need_more_love: {
    id: "places_that_need_more_love",
    title: "Location Exceptions",
    priority: "P2",
    purpose: "Highlight recurring environments where extra prep, communication, or setup care pays off.",
    dataSource: "Location evaluations, historical notes, and recurring issue context.",
    visibleTo: "Leadership users, department heads, and a softened TV version.",
    clickable: true,
    drilldown: "Opens a location-history overlay with notes, photos, evaluations, and recurring watchouts.",
    refreshBehavior: "Refreshes every 15 minutes and on manual dashboard refresh.",
    desktopLayout: "One third of the third row.",
    laptopLayout: "Shares the third row when space allows, otherwise stacks.",
    emptyState: "No locations need extra love right now.",
    severityTreatment: "Warm neutral and amber most of the time, red only for true blockers.",
    tvModeTreatment: "Public-safe categories only, with supportive language."
  },
  labor_snapshot_today: {
    id: "labor_snapshot_today",
    title: "Today's Labor",
    priority: "P3",
    purpose: "Show a high-level operational labor view without exposing payroll or private personnel detail.",
    dataSource: "Time clock summaries, schedule summaries, and labor planning rollups.",
    visibleTo: "Leadership dashboard users when enabled by feature flag and permission.",
    clickable: true,
    drilldown: "Opens a labor summary overlay with department and shoot rollups.",
    refreshBehavior: "Refreshes every 5 minutes and on manual dashboard refresh.",
    desktopLayout: "Lower-emphasis third-row slot.",
    laptopLayout: "Last and lowest emphasis.",
    emptyState: "No labor activity to show.",
    severityTreatment: "Neutral when on track, amber when variance grows, red only for significant risk.",
    tvModeTreatment: "Off by default."
  }
};

export async function getHomeDashboard(token: string, mode: HomeDashboardMode) {
  return apiFetch<HomeDashboardResponse>(`/api/dashboard/home?mode=${mode}`, token);
}

export async function getManagerCockpit(token: string, date: string) {
  return apiFetch<ManagerCockpitResponse>(`/api/dashboard/manager-cockpit?date=${date}`, token);
}

export function formatRefreshTime(value: string | null | undefined) {
  if (!value) {
    return "pending";
  }
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function toneLabel(value: HomeWidgetTone) {
  if (value === "good") {
    return "Good";
  }
  if (value === "heads_up") {
    return "Heads Up";
  }
  if (value === "action_needed") {
    return "Action Needed";
  }
  if (value === "info") {
    return "Info";
  }
  return "Neutral";
}

export function humanizeDepartment(value: string | null | undefined) {
  if (!value) {
    return "Operations";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

export function formatHours(value: number) {
  return `${value.toFixed(1)}h`;
}
