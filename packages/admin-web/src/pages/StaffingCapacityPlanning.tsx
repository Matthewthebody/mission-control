import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Socket } from "socket.io-client";
import type { SessionUser } from "../types";
import { getOperatingSystemScope } from "../permissions";
import { ShootStaffingCommand } from "../components/ShootStaffingCommand";
import {
  buildCapacityHash,
  getStaffingCapacityPlan,
  readCapacityStateFromHash,
  type CapacityAssignmentView,
  type CapacityAvailabilityState,
  type CapacityEmployeeView,
  type CapacityHashState,
  type CapacityView,
  type StaffingCapacityPlan
} from "../services/staffingCapacity";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
};

const VIEW_OPTIONS: Array<{ value: CapacityView; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" }
];

const DEPARTMENT_OPTIONS = [
  "executive",
  "operations",
  "schools",
  "sports",
  "office",
  "production",
  "customer_service",
  "unassigned"
];

const ROLE_OPTIONS = [
  "lead_photographer",
  "senior_photographer",
  "photographer",
  "support",
  "check_in",
  "assistant",
  "producer",
  "custom"
];

const ASSIGNMENT_STATE_OPTIONS = ["draft", "published", "completed"];
const ACK_OPTIONS = ["pending", "acknowledged", "declined", "none"];
const WARNING_OPTIONS = ["overlap", "availability", "any"];

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const AVAILABILITY_LABEL: Record<CapacityAvailabilityState, string> = {
  availability_not_recorded: "Availability not recorded",
  available: "Available",
  available_with_warning: "Available with warning",
  unavailable: "Unavailable"
};

// ---- pure display formatting (never recomputes capacity) -----------------------------------------------------

function formatHours(minutes: number): string {
  const hours = minutes / 60;
  if (Number.isInteger(hours)) {
    return `${hours}h`;
  }
  return `${hours.toFixed(1)}h`;
}

function titleCase(value: string | null): string {
  if (!value) return "";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Add days to a YYYY-MM-DD label (display scaffolding only — UTC calendar arithmetic, not capacity math). */
function addDaysLabel(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function shiftAnchor(view: CapacityView, date: string, direction: 1 | -1): string {
  if (view === "day") return addDaysLabel(date, direction);
  if (view === "week") return addDaysLabel(date, 7 * direction);
  const [y, m] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1 + direction, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Browser-local "today" as a YYYY-MM-DD default anchor (mirrors StaffAssignmentBoard; the API window is
 * always recomputed in America/Chicago from whatever anchor it receives). */
function todayLocalDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timeLabel(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// ---- component ----------------------------------------------------------------------------------------------

export function StaffingCapacityPlanning({ token, currentUser, socket }: Props) {
  const scope = getOperatingSystemScope(currentUser, "schedule");
  const canView = scope === "all" || scope === "department";

  const fallbackDate = todayLocalDate();
  const [state, setState] = useState<CapacityHashState>(() => readCapacityStateFromHash(fallbackDate));
  const [plan, setPlan] = useState<StaffingCapacityPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedShootId, setSelectedShootId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const requestSeqRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  // The hash is the single source of truth. Back/forward and shared links flow through here; we only adopt a
  // hash change when it differs semantically from current state (so our own updates don't double-load).
  useEffect(() => {
    const onHashChange = () => {
      const fromHash = readCapacityStateFromHash(fallbackDate);
      if (buildCapacityHash(fromHash) !== buildCapacityHash(stateRef.current)) {
        setState(fromHash);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onHashChange);
    };
  }, [fallbackDate]);

  const load = useCallback(
    async (next: CapacityHashState, options: { background?: boolean } = {}) => {
      if (!canView) return;
      const seq = ++requestSeqRef.current;
      if (!options.background) setLoading(true);
      try {
        const response = await getStaffingCapacityPlan(token, next);
        if (requestSeqRef.current === seq) {
          setPlan(response);
          setError("");
        }
      } catch (loadError) {
        if (requestSeqRef.current === seq) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load staffing capacity.");
        }
      } finally {
        if (requestSeqRef.current === seq && !options.background) {
          setLoading(false);
        }
      }
    },
    [token, canView]
  );

  useEffect(() => {
    void load(state);
  }, [state, load]);

  useEffect(() => {
    if (!socket) return undefined;
    const onRefresh = () => void load(state, { background: true });
    socket.on("schedule_changed", onRefresh);
    return () => {
      socket.off("schedule_changed", onRefresh);
    };
  }, [socket, state, load]);

  const updateState = useCallback((patch: Partial<CapacityHashState>) => {
    const next = { ...stateRef.current, ...patch };
    // Push to the hash (history entry for back/forward) and adopt the new state directly so the view updates
    // even where the environment does not re-fire hashchange on programmatic assignment.
    window.location.hash = buildCapacityHash(next);
    setState(next);
  }, []);

  const openShoot = useCallback((shootId: string | null) => {
    if (!shootId) {
      setNotice("This is a studio/office shift with no shoot staffing drawer.");
      return;
    }
    setNotice("");
    setSelectedShootId(shootId);
  }, []);

  const locationOptions = useMemo(() => {
    if (!plan) return [];
    const set = new Set<string>();
    for (const employee of plan.employees) {
      for (const assignment of employee.assignments) {
        if (assignment.location_name) set.add(assignment.location_name);
      }
    }
    return [...set].sort();
  }, [plan]);

  if (!canView) {
    return (
      <section className="capacity" aria-labelledby="capacity-heading">
        <h1 id="capacity-heading">Staffing Capacity Planning</h1>
        <div className="capacity__state capacity__state--denied" role="alert">
          You do not have permission to view staffing capacity. This surface is limited to staffing managers and
          leadership.
        </div>
      </section>
    );
  }

  return (
    <section className="capacity" aria-labelledby="capacity-heading">
      <header className="capacity__header">
        <div className="capacity__title">
          <h1 id="capacity-heading">Staffing Capacity Planning</h1>
          <p className="capacity__subtitle">
            Scheduled capacity (America/Chicago, Monday–Sunday weeks). Not payroll, actual, or worked time.
          </p>
        </div>

        <div className="capacity__controls">
          <div className="capacity__views" role="group" aria-label="Capacity view">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="capacity__view-btn"
                aria-pressed={state.view === option.value}
                onClick={() => updateState({ view: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="capacity__datenav" role="group" aria-label="Date navigation">
            <button
              type="button"
              className="capacity__nav-btn"
              aria-label="Previous period"
              onClick={() => updateState({ date: shiftAnchor(state.view, state.date, -1) })}
            >
              ‹
            </button>
            <label className="capacity__date">
              <span className="capacity__date-label">Anchor date</span>
              <input
                type="date"
                value={state.date}
                onChange={(event) => event.target.value && updateState({ date: event.target.value })}
              />
            </label>
            <button
              type="button"
              className="capacity__nav-btn"
              aria-label="Next period"
              onClick={() => updateState({ date: shiftAnchor(state.view, state.date, 1) })}
            >
              ›
            </button>
          </div>
        </div>
      </header>

      <CapacityFilters
        state={state}
        plan={plan}
        locationOptions={locationOptions}
        onChange={updateState}
      />

      <CapacityLegend />

      {plan ? (
        <p className="capacity__range" aria-live="polite">
          {plan.window === "month" && plan.month_start
            ? `${plan.month_start} → ${plan.month_end}`
            : `${plan.range_start} → ${plan.range_end}`}{" "}
          · {plan.summary.employee_count} employees · {formatHours(plan.summary.scheduled_minutes)} scheduled capacity
        </p>
      ) : null}

      {notice ? (
        <div className="capacity__notice" role="status">
          {notice}
        </div>
      ) : null}

      <div className="capacity__body">
        {loading ? (
          <div className="capacity__state" role="status" aria-live="polite">
            Loading staffing capacity…
          </div>
        ) : error ? (
          <div className="capacity__state capacity__state--error" role="alert">
            {error}
          </div>
        ) : !plan || plan.employees.length === 0 ? (
          <div className="capacity__state capacity__state--empty">
            No staffing capacity matches this window and filter set.
          </div>
        ) : plan.window === "day" ? (
          <DayView plan={plan} onOpenShoot={openShoot} />
        ) : plan.window === "month" ? (
          <MonthView plan={plan} onDrillWeek={(weekStart) => updateState({ view: "week", date: weekStart })} />
        ) : (
          <WeekView plan={plan} onOpenShoot={openShoot} />
        )}
      </div>

      {selectedShootId ? (
        <aside className="capacity__drawer" aria-label="Staffing drawer">
          <ShootStaffingCommand
            token={token}
            shootId={selectedShootId}
            canPublish={scope === "all" || scope === "department"}
            onNotice={setNotice}
            onError={setError}
            onClose={() => setSelectedShootId(null)}
            className="capacity__staffing-command"
          />
        </aside>
      ) : null}
    </section>
  );
}

// ---- filters ------------------------------------------------------------------------------------------------

function CapacityFilters({
  state,
  plan,
  locationOptions,
  onChange
}: {
  state: CapacityHashState;
  plan: StaffingCapacityPlan | null;
  locationOptions: string[];
  onChange: (patch: Partial<CapacityHashState>) => void;
}) {
  const employeeOptions = useMemo(() => {
    if (!plan) return [];
    return plan.employees
      .map((employee) => ({ id: employee.employee_user_id, name: employee.employee_name ?? employee.employee_user_id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [plan]);

  return (
    <div className="capacity__filters" role="group" aria-label="Capacity filters">
      <Select
        label="Department"
        value={state.department}
        onChange={(value) => onChange({ department: value })}
        options={DEPARTMENT_OPTIONS.map((value) => ({ value, label: titleCase(value) }))}
      />
      <Select
        label="Role"
        value={state.role}
        onChange={(value) => onChange({ role: value })}
        options={ROLE_OPTIONS.map((value) => ({ value, label: titleCase(value) }))}
      />
      <Select
        label="Employee"
        value={state.employee}
        onChange={(value) => onChange({ employee: value })}
        options={employeeOptions.map((employee) => ({ value: employee.id, label: employee.name }))}
      />
      <Select
        label="Location"
        value={state.location}
        onChange={(value) => onChange({ location: value })}
        options={locationOptions.map((value) => ({ value, label: value }))}
      />
      <Select
        label="Assignment state"
        value={state.assignment}
        onChange={(value) => onChange({ assignment: value })}
        options={ASSIGNMENT_STATE_OPTIONS.map((value) => ({ value, label: titleCase(value) }))}
      />
      <Select
        label="Acknowledgment"
        value={state.ack}
        onChange={(value) => onChange({ ack: value })}
        options={ACK_OPTIONS.map((value) => ({ value, label: titleCase(value) }))}
      />
      <Select
        label="Warning"
        value={state.warning}
        onChange={(value) => onChange({ warning: value })}
        options={WARNING_OPTIONS.map((value) => ({ value, label: titleCase(value) }))}
      />
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="capacity__filter">
      <span className="capacity__filter-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CapacityLegend() {
  return (
    <ul className="capacity__legend" aria-label="Status legend">
      <li className="capacity__legend-item">
        <span className="capacity__badge capacity__badge--overlap" aria-hidden="true">
          ⚠
        </span>
        Schedule overlap
      </li>
      <li className="capacity__legend-item">
        <span className="capacity__badge capacity__badge--unavailable" aria-hidden="true">
          ✕
        </span>
        Unavailable
      </li>
      <li className="capacity__legend-item">
        <span className="capacity__badge capacity__badge--warning" aria-hidden="true">
          !
        </span>
        Available with warning
      </li>
      <li className="capacity__legend-item">
        <span className="capacity__badge capacity__badge--unknown" aria-hidden="true">
          ?
        </span>
        Availability not recorded
      </li>
      <li className="capacity__legend-item">
        <span className="capacity__badge capacity__badge--calendar" aria-hidden="true">
          ◔
        </span>
        Calendar not connected
      </li>
      <li className="capacity__legend-item">
        <span className="capacity__badge capacity__badge--override" aria-hidden="true">
          ⊘
        </span>
        Override required (resolved in staffing drawer)
      </li>
    </ul>
  );
}

// ---- week view ----------------------------------------------------------------------------------------------

function WeekView({ plan, onOpenShoot }: { plan: StaffingCapacityPlan; onOpenShoot: (shootId: string | null) => void }) {
  const bucket = plan.week_buckets[0] ?? { week_start: plan.range_start, week_end: plan.range_end };
  const columnDates = WEEKDAY_LABELS.map((_, index) => addDaysLabel(bucket.week_start, index));

  return (
    <div className="capacity__scroll">
      <table className="capacity__grid capacity__grid--week">
        <caption className="capacity__sr-only">
          Weekly scheduled capacity, one row per employee, Monday through Sunday.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="capacity__col-employee">
              Employee
            </th>
            {WEEKDAY_LABELS.map((label, index) => (
              <th scope="col" key={label}>
                {label}
                <span className="capacity__col-date">{columnDates[index].slice(5)}</span>
              </th>
            ))}
            <th scope="col">Weekly total</th>
            <th scope="col">Assignments</th>
            <th scope="col">Shoots</th>
            <th scope="col">Conflicts</th>
            <th scope="col">Availability</th>
            <th scope="col">Pending</th>
            <th scope="col">Declined</th>
            <th scope="col">Incomplete</th>
          </tr>
        </thead>
        <tbody>
          {plan.employees.map((employee) => {
            const daysByDate = new Map(employee.days.map((day) => [day.operating_date, day]));
            return (
              <tr key={employee.employee_user_id} className="capacity__row">
                <th scope="row" className="capacity__col-employee">
                  <span className="capacity__employee-name">{employee.employee_name ?? "Unnamed"}</span>
                  <span className="capacity__employee-meta">
                    {titleCase(employee.department)}
                    {employee.staffing_roles.length ? ` · ${employee.staffing_roles.map(titleCase).join(", ")}` : ""}
                  </span>
                </th>
                {columnDates.map((date) => {
                  const day = daysByDate.get(date);
                  const dayAssignments = employee.assignments.filter((a) => a.operating_date === date);
                  const firstShoot = dayAssignments.find((a) => a.destination.shoot_id)?.destination.shoot_id ?? null;
                  const hasOverlap = day ? day.overlap_minutes > 0 : false;
                  if (!day) {
                    return (
                      <td key={date} className="capacity__daycell capacity__daycell--empty" aria-label={`${date}: no scheduled capacity`}>
                        —
                      </td>
                    );
                  }
                  return (
                    <td key={date} className="capacity__daycell">
                      <button
                        type="button"
                        className="capacity__daycell-btn"
                        onClick={() => onOpenShoot(firstShoot)}
                        aria-label={`${employee.employee_name ?? "Employee"} ${date}: ${formatHours(day.scheduled_minutes)} scheduled${hasOverlap ? `, ${formatHours(day.overlap_minutes)} overlapping` : ""}. Open staffing.`}
                      >
                        <span className="capacity__daycell-hours">{formatHours(day.scheduled_minutes)}</span>
                        {hasOverlap ? (
                          <span className="capacity__badge capacity__badge--overlap" title="Schedule overlap">
                            ⚠ {formatHours(day.overlap_minutes)}
                          </span>
                        ) : null}
                      </button>
                    </td>
                  );
                })}
                <td className="capacity__total">
                  <span className="capacity__total-primary">{formatHours(employee.unique_scheduled_minutes)}</span>
                  {employee.overlap_minutes > 0 ? (
                    <span className="capacity__total-detail">
                      {formatHours(employee.raw_assigned_minutes)} assigned · {formatHours(employee.overlap_minutes)} overlapping
                    </span>
                  ) : null}
                </td>
                <td>{employee.assignment_count}</td>
                <td>{employee.shoot_count}</td>
                <td>
                  <ConflictCell count={employee.schedule_conflict_count} />
                </td>
                <td>
                  <AvailabilityCell employee={employee} />
                </td>
                <td>{employee.pending_assignment_count}</td>
                <td>{employee.declined_assignment_count}</td>
                <td>{employee.incomplete_timing_count}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ConflictCell({ count }: { count: number }) {
  if (count <= 0) return <span className="capacity__muted">0</span>;
  return (
    <span className="capacity__badge capacity__badge--overlap">
      <span aria-hidden="true">⚠ </span>
      <span>{count}</span>
      <span className="capacity__sr-only"> schedule overlap conflicts</span>
    </span>
  );
}

function AvailabilityCell({ employee }: { employee: CapacityEmployeeView }) {
  if (employee.availability_warning_count <= 0) {
    return <span className="capacity__muted">—</span>;
  }
  return (
    <span className="capacity__badge capacity__badge--warning">
      <span aria-hidden="true">! </span>
      <span>{employee.availability_warning_count}</span>
      <span className="capacity__sr-only"> availability warnings</span>
    </span>
  );
}

// ---- day view -----------------------------------------------------------------------------------------------

function DayView({ plan, onOpenShoot }: { plan: StaffingCapacityPlan; onOpenShoot: (shootId: string | null) => void }) {
  const rows: Array<{ employee: CapacityEmployeeView; assignment: CapacityAssignmentView }> = [];
  for (const employee of plan.employees) {
    for (const assignment of employee.assignments) {
      rows.push({ employee, assignment });
    }
  }
  rows.sort((a, b) => (a.assignment.starts_at ?? "").localeCompare(b.assignment.starts_at ?? ""));

  if (rows.length === 0) {
    return <div className="capacity__state capacity__state--empty">No assignments scheduled on this date.</div>;
  }

  return (
    <ol className="capacity__daylist" aria-label="Assignments">
      {rows.map(({ employee, assignment }) => (
        <li
          key={assignment.shift_id}
          className={`capacity__dayrow${assignment.has_overlap ? " capacity__dayrow--overlap" : ""}`}
        >
          <button
            type="button"
            className="capacity__dayrow-btn"
            onClick={() => onOpenShoot(assignment.destination.shoot_id)}
            aria-label={`Open staffing for ${assignment.shoot_title ?? assignment.shoot_code ?? "assignment"}`}
          >
            <span className="capacity__dayrow-time">
              {timeLabel(assignment.starts_at)} – {timeLabel(assignment.ends_at)}
            </span>
            <span className="capacity__dayrow-main">
              <span className="capacity__dayrow-employee">{employee.employee_name ?? "Unnamed"}</span>
              <span className="capacity__dayrow-shoot">
                {assignment.shoot_code ? `${assignment.shoot_code} · ` : ""}
                {assignment.shoot_title ?? "Studio / office shift"}
              </span>
              <span className="capacity__dayrow-meta">
                {[assignment.location_name, titleCase(assignment.staffing_role), titleCase(assignment.department)]
                  .filter(Boolean)
                  .join(" · ")}
                {assignment.satisfies_lead_coverage ? " · Lead" : ""}
              </span>
            </span>
            <span className="capacity__dayrow-status">
              <StatusBadge tone={assignment.shift_status === "draft" ? "neutral" : "ok"}>
                {titleCase(assignment.shift_status)}
              </StatusBadge>
              <LifecycleBadge assignment={assignment} />
              {assignment.has_overlap ? (
                <StatusBadge tone="overlap" icon="⚠">
                  Schedule overlap
                </StatusBadge>
              ) : null}
              <AvailabilityBadge state={assignment.availability_state} />
              {assignment.incomplete_timing ? (
                <StatusBadge tone="warning" icon="!">
                  Incomplete timing
                </StatusBadge>
              ) : null}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function LifecycleBadge({ assignment }: { assignment: CapacityAssignmentView }) {
  switch (assignment.lifecycle_state) {
    case "acknowledged":
      return (
        <StatusBadge tone="ok" icon="✓">
          Confirmed
        </StatusBadge>
      );
    case "pending":
      return (
        <StatusBadge tone="warning" icon="…">
          Pending acknowledgment
        </StatusBadge>
      );
    case "declined":
      return (
        <StatusBadge tone="danger" icon="✕">
          Declined · replacement required
        </StatusBadge>
      );
    case "canceled":
      return (
        <StatusBadge tone="neutral" icon="⊘">
          Canceled
        </StatusBadge>
      );
    default:
      return null;
  }
}

function AvailabilityBadge({ state }: { state: CapacityAvailabilityState }) {
  const label = AVAILABILITY_LABEL[state];
  if (state === "unavailable") {
    return (
      <StatusBadge tone="danger" icon="✕">
        {label}
      </StatusBadge>
    );
  }
  if (state === "available_with_warning") {
    return (
      <StatusBadge tone="warning" icon="!">
        {label}
      </StatusBadge>
    );
  }
  if (state === "availability_not_recorded") {
    return (
      <StatusBadge tone="neutral" icon="?">
        {label}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="ok" icon="✓">
      {label}
    </StatusBadge>
  );
}

function StatusBadge({
  children,
  tone,
  icon
}: {
  children: ReactNode;
  tone: "ok" | "warning" | "danger" | "neutral" | "overlap";
  icon?: string;
}) {
  return (
    <span className={`capacity__badge capacity__badge--${tone}`}>
      {icon ? <span aria-hidden="true">{icon} </span> : null}
      {children}
    </span>
  );
}

// ---- month view ---------------------------------------------------------------------------------------------

function MonthView({ plan, onDrillWeek }: { plan: StaffingCapacityPlan; onDrillWeek: (weekStart: string) => void }) {
  return (
    <div className="capacity__scroll">
      <table className="capacity__grid capacity__grid--month">
        <caption className="capacity__sr-only">Monthly scheduled capacity, weekly rollups per employee.</caption>
        <thead>
          <tr>
            <th scope="col" className="capacity__col-employee">
              Employee
            </th>
            {plan.week_buckets.map((bucket) => (
              <th scope="col" key={bucket.week_start}>
                {bucket.week_start.slice(5)} – {bucket.week_end.slice(5)}
              </th>
            ))}
            <th scope="col">Conflicts</th>
            <th scope="col">Pending</th>
            <th scope="col">Declined</th>
            <th scope="col">Incomplete</th>
          </tr>
        </thead>
        <tbody>
          {plan.employees.map((employee) => {
            const weeksByStart = new Map(employee.weeks.map((week) => [week.week_start, week]));
            return (
              <tr key={employee.employee_user_id} className="capacity__row">
                <th scope="row" className="capacity__col-employee">
                  <span className="capacity__employee-name">{employee.employee_name ?? "Unnamed"}</span>
                  <span className="capacity__employee-meta">{titleCase(employee.department)}</span>
                </th>
                {plan.week_buckets.map((bucket) => {
                  const week = weeksByStart.get(bucket.week_start);
                  const scheduled = week ? week.scheduled_minutes : 0;
                  return (
                    <td key={bucket.week_start} className="capacity__weekcell">
                      <button
                        type="button"
                        className="capacity__weekcell-btn"
                        onClick={() => onDrillWeek(bucket.week_start)}
                        aria-label={`Open week of ${bucket.week_start} for ${employee.employee_name ?? "employee"}: ${formatHours(scheduled)} scheduled`}
                      >
                        <span className="capacity__weekcell-hours">{formatHours(scheduled)}</span>
                        <span className="capacity__weekcell-meta">
                          {week ? `${week.shoot_count} shoots` : "—"}
                          {week && week.overlap_minutes > 0 ? ` · ⚠ ${formatHours(week.overlap_minutes)}` : ""}
                        </span>
                      </button>
                    </td>
                  );
                })}
                <td>
                  <ConflictCell count={employee.schedule_conflict_count} />
                </td>
                <td>{employee.pending_assignment_count}</td>
                <td>{employee.declined_assignment_count}</td>
                <td>{employee.incomplete_timing_count}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="capacity__note">
        Availability is evaluated in Day and Week views — open a week to review availability conflicts.
      </p>
    </div>
  );
}
