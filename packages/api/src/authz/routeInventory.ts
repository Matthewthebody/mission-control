export type RouteInventoryEntry = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  currentPermission: string | null;
  currentRoles: string[];
  nextAction: string | null;
  notes?: string;
};

export const CURRENT_ROUTE_INVENTORY: RouteInventoryEntry[] = [
  { method: "GET", path: "/auth/me", currentPermission: null, currentRoles: ["authenticated"], nextAction: "auth.session.read" },
  { method: "POST", path: "/api/shoots", currentPermission: "shoot.create", currentRoles: ["admin"], nextAction: "shoot.create" },
  {
    method: "GET",
    path: "/api/shoots?date=:date",
    currentPermission: "shoot.read",
    currentRoles: ["admin", "photographer"],
    nextAction: "shoot.read"
  },
  { method: "GET", path: "/api/shoots/:id", currentPermission: "shoot.read", currentRoles: ["admin", "photographer"], nextAction: "shoot.read" },
  { method: "PATCH", path: "/api/shoots/:id", currentPermission: "shoot.update", currentRoles: ["admin"], nextAction: "shoot.update" },
  { method: "DELETE", path: "/api/shoots/:id", currentPermission: "shoot.delete", currentRoles: ["admin"], nextAction: "shoot.delete" },
  {
    method: "POST",
    path: "/api/shoots/:id/status-events",
    currentPermission: "status_event.create",
    currentRoles: ["admin", "photographer"],
    nextAction: "status_event.create"
  },
  {
    method: "POST",
    path: "/api/shoots/:id/clock-in",
    currentPermission: "status_event.create",
    currentRoles: ["admin", "photographer"],
    nextAction: "time.clock"
  },
  {
    method: "POST",
    path: "/api/shoots/:id/clock-out",
    currentPermission: "status_event.create",
    currentRoles: ["admin", "photographer"],
    nextAction: "time.clock"
  },
  {
    method: "GET",
    path: "/api/shoots/:id/time-entries",
    currentPermission: "time_entry.read",
    currentRoles: ["admin", "photographer"],
    nextAction: "time_entry.read"
  },
  {
    method: "POST",
    path: "/api/shoots/:id/mileage/preview",
    currentPermission: "mileage.create",
    currentRoles: ["admin", "photographer"],
    nextAction: "mileage.create"
  },
  {
    method: "POST",
    path: "/api/shoots/:id/mileage/submit",
    currentPermission: "mileage.create",
    currentRoles: ["admin", "photographer"],
    nextAction: "mileage.create"
  },
  {
    method: "POST",
    path: "/api/uploads/presign",
    currentPermission: "status_event.create",
    currentRoles: ["admin", "photographer"],
    nextAction: "upload.presign",
    notes: "Legacy route currently piggybacks on status_event.create"
  },
  {
    method: "POST",
    path: "/api/shoots/:id/media",
    currentPermission: "status_event.create",
    currentRoles: ["admin", "photographer"],
    nextAction: "media.attach",
    notes: "Legacy route currently piggybacks on status_event.create"
  },
  { method: "GET", path: "/api/alerts", currentPermission: "alerts.read", currentRoles: ["admin"], nextAction: "alerts.read" },
  { method: "POST", path: "/api/alerts/:id/resolve", currentPermission: "alerts.resolve", currentRoles: ["admin"], nextAction: "alerts.resolve" },
  {
    method: "POST",
    path: "/api/push/register",
    currentPermission: "push.manage",
    currentRoles: ["admin", "photographer"],
    nextAction: "push.manage"
  },
  {
    method: "POST",
    path: "/api/push/unregister",
    currentPermission: "push.manage",
    currentRoles: ["admin", "photographer"],
    nextAction: "push.manage"
  }
];
