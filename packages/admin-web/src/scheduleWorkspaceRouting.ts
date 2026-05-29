export type ScheduleWorkspaceArea = "calendar" | "staffing" | "exceptions" | "outlook";
export type MasterScheduleView = "jobs" | "staffing" | "assignment_board";

export type ScheduleWorkspaceRouteState = {
  area: ScheduleWorkspaceArea | null;
  view: MasterScheduleView;
  date: string | null;
  shootId: string | null;
  shiftId: string | null;
};

function parseHashQuery(hashValue: string) {
  const [, query = ""] = hashValue.replace(/^#/, "").split("?");
  return new URLSearchParams(query);
}

function parseHashPath(hashValue: string) {
  const [path = ""] = hashValue.replace(/^#/, "").split("?");
  return path.toLowerCase();
}

function resolveMasterScheduleView(path: string, area: string | null): MasterScheduleView {
  if (
    path === "schedule/staffing" ||
    path === "operations/staffing" ||
    path === "photography/staffing" ||
    area === "staffing"
  ) {
    return "staffing";
  }
  if (path === "schedule/assignment-board" || path === "operations/assignment-board") {
    return "assignment_board";
  }
  return "jobs";
}

export function parseScheduleWorkspaceRouteState(hashValue: string): ScheduleWorkspaceRouteState {
  const path = parseHashPath(hashValue);
  const params = parseHashQuery(hashValue);
  const area = params.get("area");
  const date = params.get("date");
  const shootId = params.get("shoot");
  const shiftId = params.get("shift");

  return {
    area: area === "calendar" || area === "staffing" || area === "exceptions" || area === "outlook" ? area : null,
    view: resolveMasterScheduleView(path, area),
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    shootId: shootId || null,
    shiftId: shiftId || null
  };
}

export function buildSchedulingWorkspaceHash(
  area: ScheduleWorkspaceArea,
  options?: {
    date?: string | null;
    shootId?: string | null;
    shiftId?: string | null;
  }
) {
  const params = new URLSearchParams();
  if (area !== "calendar") {
    params.set("area", area);
  }
  if (options?.date) {
    params.set("date", options.date);
  }
  if (options?.shootId) {
    params.set("shoot", options.shootId);
  }
  if (options?.shiftId) {
    params.set("shift", options.shiftId);
  }
  const query = params.toString();
  return query ? `#scheduling?${query}` : "#scheduling";
}

export function buildMasterScheduleHash(
  view: MasterScheduleView = "jobs",
  options?: {
    date?: string | null;
    shootId?: string | null;
    shiftId?: string | null;
  }
) {
  const params = new URLSearchParams();
  if (options?.date) {
    params.set("date", options.date);
  }
  if (options?.shootId) {
    params.set("shoot", options.shootId);
  }
  if (options?.shiftId) {
    params.set("shift", options.shiftId);
  }
  const query = params.toString();
  const base =
    view === "staffing"
      ? "#schedule/staffing"
      : view === "assignment_board"
        ? "#schedule/assignment-board"
        : "#schedule/jobs";
  return query ? `${base}?${query}` : base;
}

export function buildScheduleWorkspaceHash(options?: {
  date?: string | null;
  shootId?: string | null;
  shiftId?: string | null;
}) {
  return buildMasterScheduleHash("jobs", options);
}
