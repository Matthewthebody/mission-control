import type { ReactNode } from "react";
import type { DashboardQuickActionDefinition } from "./dashboardConfig";
import { trackDashboardEvent } from "./dashboardRuntime";
import { hasCapability, type BusinessRole } from "../../permissions";
import type { EmployeeMyWorkResponse, EmployeeShiftPreview } from "../../services/employeeExperience";
import type { HomeDashboardResponse, ProductionProjectBoardResponse, SessionUser } from "../../types";

type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  error: string;
  loadedAt: number | null;
};

type Props = {
  role: BusinessRole;
  currentUser: SessionUser;
  anchorDate: string;
  refreshLabel: string | null;
  onRefresh: () => void;
  employeeState: AsyncState<EmployeeMyWorkResponse>;
  productionState: AsyncState<ProductionProjectBoardResponse>;
  homeState: AsyncState<HomeDashboardResponse>;
  visibleQuickActions: DashboardQuickActionDefinition[];
};

type MobileAction = {
  id: string;
  label: string;
  target: string;
  external?: boolean;
  source: string;
};

type MobileListItem = {
  id: string;
  title: string;
  detail: string;
  meta?: string;
  tone?: "good" | "heads_up" | "action_needed" | "info";
  target?: string;
};

type MobileCardProps = {
  role: BusinessRole;
  title: string;
  subtitle?: string;
  actions?: MobileAction[];
  children: ReactNode;
};

export function MobileMissionControl({
  role,
  currentUser,
  anchorDate,
  refreshLabel,
  onRefresh,
  employeeState,
  productionState,
  homeState,
  visibleQuickActions
}: Props) {
  if (role === "manager") {
    return (
      <MobileMissionShell
        role={role}
        title="Home"
        summary="Team risk, attendance pressure, production slip, and the follow-ups that need your intervention."
        anchorDate={anchorDate}
        refreshLabel={refreshLabel}
        onRefresh={onRefresh}
      >
        <MobileManagerHome role={role} homeState={homeState} visibleQuickActions={visibleQuickActions} />
      </MobileMissionShell>
    );
  }

  if (role === "production_staff") {
    return (
      <MobileMissionShell
        role={role}
        title="Home"
        summary="Your queue, blockers, and the next production work that needs action."
        anchorDate={anchorDate}
        refreshLabel={refreshLabel}
        onRefresh={onRefresh}
      >
        <MobileProductionHome role={role} productionState={productionState} visibleQuickActions={visibleQuickActions} />
      </MobileMissionShell>
    );
  }

  return (
    <MobileMissionShell
      role={role}
      title="Home"
      summary={buildFieldHomeSummary(role)}
      anchorDate={anchorDate}
      refreshLabel={refreshLabel}
      onRefresh={onRefresh}
    >
      <MobileFieldHome
        role={role}
        currentUser={currentUser}
        employeeState={employeeState}
        visibleQuickActions={visibleQuickActions}
      />
    </MobileMissionShell>
  );
}

function MobileManagerHome({
  role,
  homeState,
  visibleQuickActions
}: {
  role: BusinessRole;
  homeState: AsyncState<HomeDashboardResponse>;
  visibleQuickActions: DashboardQuickActionDefinition[];
}) {
  if (homeState.loading && !homeState.data) {
    return <MobileLoadingState title="Loading team risk" rows={5} />;
  }

  if (homeState.error && !homeState.data) {
    return (
      <MobileStateCard
        role={role}
        title="Home"
        message="We couldn't load the manager Home right now."
        detail="Retry, or open Operations for the latest team view."
        actions={[
          { id: "retry-manager-home", label: "Retry", target: "#dashboard", source: "mobile_manager_retry" },
          { id: "open-operations", label: "Open Operations", target: "#operations/shoots", source: "mobile_manager_operations" }
        ]}
      />
    );
  }

  const payload = homeState.data;
  const urgentItems = payload ? buildManagerUrgentItems(payload) : [];
  const todayStripItems = payload ? buildManagerTodayStripItems(payload) : [];
  const shootItems = payload ? buildManagerShootItems(payload) : [];
  const attendanceItems = payload ? buildManagerAttendanceItems(payload) : [];
  const productionItems = payload ? buildManagerProductionItems(payload) : [];
  const followUps = payload ? buildManagerFollowUps(payload) : [];
  const quickActions = buildQuickActionButtons(role, visibleQuickActions);

  return (
    <>
      {urgentItems.length ? <MobileUrgentBanner role={role} items={urgentItems} /> : null}
      <MobileListCard
        role={role}
        title="Today Strip"
        subtitle="Today's operating counts before you drill into the work."
        items={todayStripItems}
        emptyMessage="Today's operating counts are clear right now."
      />
      <MobileListCard
        role={role}
        title="Team Risk Today"
        subtitle="Today's shoots and the next issues that can break execution."
        items={shootItems}
        emptyMessage="No today's shoots need extra attention right now."
      />
      <MobileListCard
        role={role}
        title="Attendance Awareness"
        subtitle="The attendance exceptions that can create same-day staffing risk."
        items={attendanceItems}
        emptyMessage="No attendance issues need team review right now."
      />
      <MobileListCard
        role={role}
        title="Production Snapshot"
        subtitle="What is blocked, overdue, or likely to slip next."
        items={productionItems}
        emptyMessage="Production pressure looks steady right now."
      />
      <MobileListCard
        role={role}
        title="My Follow-Ups"
        subtitle="Approvals, high-risk items, and the next manager decisions that still need action."
        items={followUps}
        emptyMessage="Your follow-ups look clear right now."
      />
      <MobileQuickAccessCard actions={quickActions} role={role} />
    </>
  );
}

function MobileMissionShell({
  role,
  title,
  summary,
  anchorDate,
  refreshLabel,
  onRefresh,
  children
}: {
  role: BusinessRole;
  title: string;
  summary: string;
  anchorDate: string;
  refreshLabel: string | null;
  onRefresh: () => void;
  children: ReactNode;
}) {
  return (
    <div className="role-dashboard-shell role-dashboard-shell--mobile">
      <section className="page-intro page-intro--compact role-dashboard-mobile-intro">
        <div>
          <div className="eyebrow">{formatMobileRoleEyebrow(role)}</div>
          <h2>{title}</h2>
          <p>{summary}</p>
          <div className="role-dashboard-frame-meta" aria-label="Dashboard context">
            <span className="metric-pill">{formatDashboardDate(anchorDate)}</span>
            {refreshLabel ? <span className="metric-pill">{refreshLabel}</span> : null}
          </div>
        </div>
        <div className="page-intro-actions page-intro-actions--compact">
          <button type="button" className="secondary-button" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </section>
      <div className="mobile-home-stack">{children}</div>
    </div>
  );
}

function MobileFieldHome({
  role,
  currentUser,
  employeeState,
  visibleQuickActions
}: {
  role: BusinessRole;
  currentUser: SessionUser;
  employeeState: AsyncState<EmployeeMyWorkResponse>;
  visibleQuickActions: DashboardQuickActionDefinition[];
}) {
  if (employeeState.loading && !employeeState.data) {
    return <MobileLoadingState title="Loading your day" rows={5} />;
  }

  if (employeeState.error && !employeeState.data) {
    return (
      <MobileStateCard
        role={role}
        title="Home"
        message="We couldn't load your mobile Home right now."
        detail="Try again, or open your schedule for the latest assignments."
        actions={[
          { id: "retry-mobile-home", label: "Retry", target: "#dashboard", source: "mobile_home_retry" },
          { id: "open-schedule", label: "Open Schedule", target: "#dashboard/my-schedule", source: "mobile_home_schedule" }
        ]}
      />
    );
  }

  const payload = employeeState.data;
  const shifts = payload ? sortShiftsByStart(payload.shifts) : [];
  const focusShift = getCurrentShift(shifts) ?? getNextShift(shifts);
  const urgentItems = buildFieldUrgentItems(payload, role);
  const requiredActions = buildFieldRequiredActions(payload, shifts, role);
  const followUps = buildFieldFollowUps(payload);
  const recentActivity = buildFieldRecentActivity(payload);
  const quickActions = buildQuickActionButtons(role, visibleQuickActions);

  return (
    <>
      {urgentItems.length ? <MobileUrgentBanner role={role} items={urgentItems} /> : null}
      <MobileAssignmentCard role={role} currentUser={currentUser} shift={focusShift} payload={payload} />
      <MobileClockCard role={role} shift={focusShift} />
      <MobileTimelineCard shifts={shifts} role={role} />
      <MobileListCard
        role={role}
        title="Required Actions"
        subtitle="The next items that still need your action."
        items={requiredActions}
        emptyMessage="No required actions are open right now."
      />
      <MobileListCard
        role={role}
        title="My Follow-Ups"
        subtitle="Items assigned to you, due soon, or still waiting on you."
        items={followUps}
        emptyMessage="Your follow-ups look clear right now."
      />
      <MobileQuickAccessCard actions={quickActions} role={role} />
      <MobileListCard
        role={role}
        title="Recent Activity"
        subtitle="Lower-priority context and updates."
        items={recentActivity}
        emptyMessage="No recent changes need a closer look."
      />
    </>
  );
}

function MobileProductionHome({
  role,
  productionState,
  visibleQuickActions
}: {
  role: BusinessRole;
  productionState: AsyncState<ProductionProjectBoardResponse>;
  visibleQuickActions: DashboardQuickActionDefinition[];
}) {
  if (productionState.loading && !productionState.data) {
    return <MobileLoadingState title="Loading your queue" rows={4} />;
  }

  if (productionState.error && !productionState.data) {
    return (
      <MobileStateCard
        role={role}
        title="Production Home"
        message="We couldn't load your queue right now."
        detail="Retry, or open Production to review the latest work."
        actions={[
          { id: "retry-production-home", label: "Retry", target: "#dashboard", source: "mobile_production_retry" },
          { id: "open-production", label: "Open Production", target: "#production", source: "mobile_production_open" }
        ]}
      />
    );
  }

  const board = productionState.data;
  const queueItems = board ? flattenProductionItems(board) : [];
  const urgentItems = board ? buildProductionUrgentItems(board) : [];
  const queueHighlights = board ? queueItems.slice(0, 4).map((item) => buildProductionQueueItem(item)) : [];
  const dueToday = board ? queueItems.filter((item) => isDueToday(item, board.anchor_date)).slice(0, 4).map((item) => buildProductionQueueItem(item)) : [];
  const qaCorrections = board
    ? queueItems
        .filter((item) => ["ready_for_qa", "in_qa_review", "correction_needed", "ready_to_release"].includes(item.stage))
        .slice(0, 4)
        .map((item) => buildProductionQueueItem(item))
    : [];
  const followUps = board ? buildProductionFollowUps(board) : [];
  const recentActivity = board ? buildProductionRecentActivity(board) : [];
  const quickActions = buildQuickActionButtons(role, visibleQuickActions);

  return (
    <>
      {urgentItems.length ? <MobileUrgentBanner role={role} items={urgentItems} /> : null}
      <MobileQueueCard board={board} items={queueHighlights} />
      <MobileListCard
        role={role}
        title="QA & Corrections"
        subtitle="What is blocked, waiting on review, or ready for release."
        items={qaCorrections}
        emptyMessage="No QA or correction pressure needs action right now."
      />
      <MobileListCard
        role={role}
        title="Due Today"
        subtitle="The work that cannot slip before the day ends."
        items={dueToday}
        emptyMessage="Nothing is due today right now."
      />
      <MobileListCard
        role={role}
        title="My Follow-Ups"
        subtitle="The items you still own across due dates, blockers, and reviews."
        items={followUps}
        emptyMessage="Your production follow-ups look clear right now."
      />
      <MobileQuickAccessCard actions={quickActions} role={role} />
      <MobileListCard
        role={role}
        title="Recent Activity"
        subtitle="Recent movement in your queue."
        items={recentActivity}
        emptyMessage="No recent production changes need review."
      />
    </>
  );
}

function MobileUrgentBanner({ role, items }: { role: BusinessRole; items: MobileListItem[] }) {
  const tone = items.some((item) => item.tone === "action_needed") ? "action_needed" : "heads_up";

  return (
    <section
      className={`panel mobile-home-banner mobile-home-banner--${tone}`}
      aria-label={role === "production_staff" ? "Production urgent items" : "Personal urgent items"}
    >
      <div className="mobile-home-banner__head">
        <div>
          <div className="eyebrow">Needs Attention</div>
          <strong>{items[0]?.title}</strong>
        </div>
        <span className={`home-tone-chip home-tone-chip--${tone}`}>{tone === "action_needed" ? "High" : "Heads Up"}</span>
      </div>
      <div className="mobile-home-banner__body">
        <p>{items[0]?.detail}</p>
        {items.slice(1, 3).map((item) => (
          <button
            key={item.id}
            type="button"
            className="mobile-home-banner__link"
            onClick={() => navigateToTarget(item.target ?? "#dashboard")}
          >
            {item.title}
            {item.meta ? <span>{item.meta}</span> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

function MobileAssignmentCard({
  role,
  currentUser,
  shift,
  payload
}: {
  role: BusinessRole;
  currentUser: SessionUser;
  shift: EmployeeShiftPreview | null;
  payload: EmployeeMyWorkResponse | null;
}) {
  const detailsTarget = "#dashboard/my-day";
  const actions: MobileAction[] = [
    { id: "assignment-details", label: "Open Details", target: detailsTarget, source: "mobile_assignment_details" }
  ];

  if (shift?.navigation_url) {
    actions.push({ id: "assignment-map", label: "Open Map", target: shift.navigation_url, external: true, source: "mobile_assignment_map" });
  }

  const contactTarget = resolveContactTarget(currentUser);
  if (contactTarget) {
    actions.push({ id: "assignment-contact", label: "Open Contacts", target: contactTarget, source: "mobile_assignment_contacts" });
  }

  if (!shift) {
    const nextScheduled = payload ? sortShiftsByStart(payload.shifts)[0] ?? null : null;
    return (
      <MobileCard role={role} title="Next Assignment" subtitle="Where you need to be next.">
        <div className="mobile-home-hero">
          <strong>{nextScheduled ? buildShiftLabel(nextScheduled) : "No assignment today"}</strong>
          <p>
            {nextScheduled
              ? `${formatShortDate(nextScheduled.starts_at)} at ${formatTimeOnly(nextScheduled.starts_at)}`
              : "Check your schedule, tasks, and requests for the next published work."}
          </p>
        </div>
        <div className="mobile-home-card__actions">
          {actions.slice(0, 1).map((action) => (
            <MobileActionButton key={action.id} action={action} role={role} />
          ))}
        </div>
      </MobileCard>
    );
  }

  return (
    <MobileCard role={role} title={resolveAssignmentTitle(role, shift)} subtitle={buildAssignmentSubtitle(shift)}>
      <div className="mobile-home-hero">
        <strong>{buildShiftLabel(shift)}</strong>
        <p>{shift.location_name ?? shift.location_address ?? "Location pending"}</p>
      </div>
      <div className="dashboard-summary-list">
        <DashboardLikeSummaryRow label="Role" value={humanizeLabel(shift.staffing_role ?? shift.shift_kind)} detail={humanizeLabel(shift.status)} />
        <DashboardLikeSummaryRow label="Time" value={formatShortTimeRange(shift.starts_at, shift.ends_at)} detail={resolveShiftStateDetail(shift)} />
        <DashboardLikeSummaryRow label="Address" value={shift.location_address ?? "Pending"} detail="Location details" />
        {shift.manager_name ? <DashboardLikeSummaryRow label="Lead" value={shift.manager_name} detail="Lead or manager contact" /> : null}
        {role === "shoot_lead" ? (
          <DashboardLikeSummaryRow
            label="Team Readiness"
            value={shift.satisfies_lead_coverage ? "Covered" : "Needs Review"}
            detail={shift.open_exception_count ? `${shift.open_exception_count} field item${shift.open_exception_count === 1 ? "" : "s"} still open.` : "Assigned work is covered right now."}
          />
        ) : null}
      </div>
      <div className="mobile-home-card__actions">
        {actions.slice(0, 3).map((action) => (
          <MobileActionButton key={action.id} action={action} role={role} />
        ))}
      </div>
    </MobileCard>
  );
}

function MobileClockCard({ role, shift }: { role: BusinessRole; shift: EmployeeShiftPreview | null }) {
  const actionLabel = shift?.latest_punch_direction === "in" ? "Open Clock Out" : "Open Clock In";

  if (!shift) {
    return (
      <MobileStateCard
        role={role}
        title="Clock Status"
        message="No assignment is active right now."
        detail="Your next published work will show the clock state here."
        actions={[{ id: "clock-details", label: "Open My Day", target: "#dashboard/my-day", source: "mobile_clock_day" }]}
      />
    );
  }

  return (
    <MobileCard
      role={role}
      title="Clock Status"
      subtitle="Your attendance and location confidence for the current assignment."
      actions={[{ id: "clock-primary", label: actionLabel, target: "#dashboard/my-day", source: "mobile_clock_primary" }]}
    >
      <div className="mobile-home-hero">
        <strong>{buildClockHeadline(shift)}</strong>
        <p>{shift.attendance_state_note ?? "Use My Day for the full clock workflow and review detail."}</p>
      </div>
      <div className="dashboard-summary-list">
        <DashboardLikeSummaryRow
          label="Timing"
          value={humanizeAttendanceState(shift.attendance_state)}
          detail={shift.latest_punch_direction === "in" ? "Currently clocked in." : "Not currently clocked in."}
        />
        <DashboardLikeSummaryRow label="Location" value={humanizeLocationStatus(shift)} detail={buildLocationDetail(shift)} />
        <DashboardLikeSummaryRow label="Last Event" value={buildLastClockEventLabel(shift)} detail={buildLastClockEventDetail(shift)} />
      </div>
    </MobileCard>
  );
}

function MobileTimelineCard({ shifts, role }: { shifts: EmployeeShiftPreview[]; role: BusinessRole }) {
  if (!shifts.length) {
    return (
      <MobileStateCard
        role={role}
        title="My Day Timeline"
        message="No assignments are scheduled today."
        detail="Open your schedule to check upcoming work."
        actions={[{ id: "timeline-schedule", label: "Open Schedule", target: "#dashboard/my-schedule", source: "mobile_timeline_schedule" }]}
      />
    );
  }

  return (
    <MobileCard role={role} title="My Day Timeline" subtitle="Today's work in time order.">
      <div className="mobile-home-timeline">
        {shifts.slice(0, 4).map((shift) => {
          const current = isCurrentShift(shift);
          const next = !current && getNextShift(shifts)?.id === shift.id;
          return (
            <button
              key={shift.id}
              type="button"
              className={`mobile-home-timeline__item${current ? " is-current" : ""}`}
              onClick={() => navigateToTarget("#dashboard/my-day")}
            >
              <div>
                <strong>{buildShiftLabel(shift)}</strong>
                <div className="muted">{shift.location_name ?? shift.location_address ?? "Location pending"}</div>
              </div>
              <div className="mobile-home-timeline__meta">
                <span>{formatShortTimeRange(shift.starts_at, shift.ends_at)}</span>
                <span className={`home-tone-chip home-tone-chip--${current ? "good" : next ? "info" : "neutral"}`}>
                  {current ? "Current" : next ? "Next" : humanizeLabel(shift.status)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {role === "shoot_lead" ? <p className="mobile-home-footnote">Your assigned team-readiness issues stay inside the shoot and staffing views.</p> : null}
    </MobileCard>
  );
}

function MobileQueueCard({
  board,
  items
}: {
  board: ProductionProjectBoardResponse | null;
  items: MobileListItem[];
}) {
  if (!board || !items.length) {
    return (
      <MobileStateCard
        role="production_staff"
        title="My Queue"
        message="No production jobs are assigned right now."
        detail="Open Production if you need the full queue."
        actions={[{ id: "open-queue", label: "Open Production", target: "#production", source: "mobile_queue_open" }]}
      />
    );
  }

  return (
    <MobileCard
      role="production_staff"
      title="My Queue"
      subtitle="The assigned jobs that need work right now."
      actions={[{ id: "open-my-queue", label: "Open My Queue", target: "#production", source: "mobile_queue_primary" }]}
    >
      <div className="mobile-home-hero">
        <strong>{`${board.summary.open_projects} active jobs, ${countProductionDueToday(board)} due today`}</strong>
        <p>{items[0]?.detail ?? "Open your queue for the next production step."}</p>
      </div>
      <div className="mobile-home-timeline">
        {items.slice(0, 3).map((item) => (
          <button
            key={item.id}
            type="button"
            className="mobile-home-timeline__item"
            onClick={() => navigateToTarget(item.target ?? "#production")}
          >
            <div>
              <strong>{item.title}</strong>
              <div className="muted">{item.detail}</div>
            </div>
            {item.meta ? <div className="mobile-home-timeline__meta"><span>{item.meta}</span></div> : null}
          </button>
        ))}
      </div>
    </MobileCard>
  );
}

function MobileListCard({
  role,
  title,
  subtitle,
  items,
  emptyMessage
}: {
  role: BusinessRole;
  title: string;
  subtitle: string;
  items: MobileListItem[];
  emptyMessage: string;
}) {
  return (
    <MobileCard role={role} title={title} subtitle={subtitle}>
      {items.length ? (
        <div className="role-dashboard-list">
          {items.slice(0, 4).map((item) => (
            <button
              key={item.id}
              type="button"
              className="role-dashboard-list-item mobile-home-list-item"
              onClick={() => navigateToTarget(item.target ?? "#dashboard")}
            >
              <div>
                <strong>{item.title}</strong>
                <div className="muted">{item.detail}</div>
              </div>
              <div className="role-dashboard-list-item__meta">
                {item.meta ? <span>{item.meta}</span> : null}
                {item.tone ? <span className={`home-tone-chip home-tone-chip--${item.tone}`}>{formatToneLabel(item.tone)}</span> : null}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state empty-state--panel role-dashboard-empty-state">
          <span>{emptyMessage}</span>
        </div>
      )}
    </MobileCard>
  );
}

function MobileQuickAccessCard({
  actions,
  role
}: {
  actions: MobileAction[];
  role: BusinessRole;
}) {
  return (
    <MobileCard role={role} title="Quick Access" subtitle="Fast drill-ins for the next thing you need to open.">
      <div className="role-dashboard-quick-actions role-dashboard-quick-actions--mobile">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="role-dashboard-quick-action"
            onClick={() => {
              trackDashboardEvent({
                event: "quick_action_clicked",
                role,
                analyticsId: "mobile_quick_access",
                actionId: action.id,
                actionLabel: action.label,
                source: action.source
              });
              navigateToTarget(action.target, action.external);
            }}
          >
            <strong>{action.label}</strong>
          </button>
        ))}
      </div>
    </MobileCard>
  );
}

function MobileCard({ role, title, subtitle, actions = [], children }: MobileCardProps) {
  return (
    <section className="panel mobile-home-card">
      <div className="mobile-home-card__header">
        <div>
          <h3 className="section-title">{title}</h3>
          {subtitle ? <p className="section-subtitle">{subtitle}</p> : null}
        </div>
      </div>
      {children}
      {actions.length ? (
        <div className="mobile-home-card__actions">
          {actions.slice(0, 3).map((action) => (
            <MobileActionButton key={action.id} action={action} role={role} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MobileStateCard({
  role,
  title,
  message,
  detail,
  actions
}: {
  role: BusinessRole;
  title: string;
  message: string;
  detail?: string;
  actions?: MobileAction[];
}) {
  return (
    <section className="panel mobile-home-card">
      <div className="mobile-home-card__header">
        <div>
          <h3 className="section-title">{title}</h3>
        </div>
      </div>
      <div className="role-dashboard-state" role="status" aria-live="polite">
        <span>{message}</span>
        {detail ? <span className="muted">{detail}</span> : null}
      </div>
      {actions?.length ? (
        <div className="mobile-home-card__actions">
          {actions.slice(0, 3).map((action) => (
            <MobileActionButton key={action.id} action={action} role={role} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MobileLoadingState({ title, rows }: { title: string; rows: number }) {
  return (
    <section className="panel mobile-home-card">
      <div className="mobile-home-card__header">
        <div>
          <h3 className="section-title">{title}</h3>
        </div>
      </div>
      <div className="role-dashboard-state role-dashboard-state--loading" role="status" aria-live="polite">
        <span className="muted">Loading...</span>
        <div className="role-dashboard-skeleton" aria-hidden="true">
          {Array.from({ length: rows }).map((_, index) => (
            <span
              key={`${title}-loading-${index}`}
              className={`role-dashboard-skeleton__line${index === 0 ? " role-dashboard-skeleton__line--primary" : ""}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function MobileActionButton({ action, role }: { action: MobileAction; role: BusinessRole }) {
  return (
    <button
      type="button"
      className="secondary-button"
      onClick={() => {
        trackDashboardEvent({
          event: "widget_cta_clicked",
          role,
          analyticsId: "mobile_home",
          actionLabel: action.label,
          source: action.source
        });
        navigateToTarget(action.target, action.external);
      }}
    >
      {action.label}
    </button>
  );
}

function DashboardLikeSummaryRow({
  label,
  value,
  detail
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="dashboard-summary-row">
      <div>
        <span className="muted">{label}</span>
        <strong>{value}</strong>
      </div>
      <span className="muted">{detail}</span>
    </div>
  );
}

function buildFieldHomeSummary(role: BusinessRole) {
  if (role === "photographer") {
    return "Where you need to be, when you need to be there, and what still needs to be finished.";
  }
  if (role === "shoot_lead") {
    return "Your assigned field work, readiness gaps, attendance confidence, and the next issue that can break execution.";
  }
  return "Your next assignment, clock status, required actions, and follow-ups in one personal work surface.";
}

function buildFieldUrgentItems(payload: EmployeeMyWorkResponse | null, role: BusinessRole) {
  if (!payload) {
    return [];
  }

  const items: MobileListItem[] = [];

  for (const shift of payload.shifts) {
    if (isUrgentAttendanceState(shift.attendance_state)) {
      items.push({
        id: `urgent-attendance-${shift.id}`,
        title: humanizeAttendanceState(shift.attendance_state),
        detail: shift.attendance_state_note ?? `${buildShiftLabel(shift)} needs attendance review right now.`,
        meta: shift.location_name ?? undefined,
        tone: "action_needed",
        target: "#dashboard/my-day"
      });
    }
    if (shift.has_pre_service_notes && !shift.notes_acknowledged) {
      items.push({
        id: `urgent-notes-${shift.id}`,
        title: role === "photographer" ? "Pre-service briefing still open" : "Required notes still open",
        detail: shift.note_summary ?? `${buildShiftLabel(shift)} still has notes to review.`,
        meta: formatTimeOnly(shift.starts_at),
        tone: "heads_up",
        target: "#dashboard/my-day"
      });
    }
    if (Number(shift.closeout_missing_count ?? 0) > 0) {
      items.push({
        id: `urgent-closeout-${shift.id}`,
        title: "Post-shoot closeout still required",
        detail: `${buildShiftLabel(shift)} still has ${shift.closeout_missing_count} closeout item${shift.closeout_missing_count === 1 ? "" : "s"} open.`,
        tone: "heads_up",
        target: "#dashboard/my-day"
      });
    }
  }

  for (const notification of payload.notifications) {
    if (notification.priority === "critical" || notification.priority === "high") {
      items.push({
        id: `urgent-notification-${notification.id}`,
        title: notification.title,
        detail: notification.body,
        meta: formatShortDateTime(notification.created_at),
        tone: notification.priority === "critical" ? "action_needed" : "heads_up",
        target: notification.deep_link ?? "#dashboard/alerts"
      });
    }
  }

  return items.slice(0, 3);
}

function buildFieldRequiredActions(
  payload: EmployeeMyWorkResponse | null,
  shifts: EmployeeShiftPreview[],
  role: BusinessRole
) {
  if (!payload) {
    return [];
  }

  const items: MobileListItem[] = [];

  for (const shift of shifts) {
    if (shift.has_pre_service_notes && !shift.notes_acknowledged) {
      items.push({
        id: `required-notes-${shift.id}`,
        title: "Review pre-service briefing",
        detail: shift.note_summary ?? `${buildShiftLabel(shift)} still has briefing notes to review.`,
        meta: buildShiftLabel(shift),
        tone: "heads_up",
        target: "#dashboard/my-day"
      });
    }

    if (shift.open_exception_count > 0) {
      items.push({
        id: `required-exception-${shift.id}`,
        title: "Resolve open issue",
        detail: `${shift.open_exception_count} exception item${shift.open_exception_count === 1 ? "" : "s"} still needs review.`,
        meta: buildShiftLabel(shift),
        tone: "action_needed",
        target: "#dashboard/my-day"
      });
    }

    if (Number(shift.closeout_missing_count ?? 0) > 0) {
      items.push({
        id: `required-closeout-${shift.id}`,
        title: "Finish closeout",
        detail: `${shift.closeout_missing_count} closeout item${shift.closeout_missing_count === 1 ? "" : "s"} still missing.`,
        meta: buildShiftLabel(shift),
        tone: "action_needed",
        target: "#dashboard/my-day"
      });
    }

    if (shift.mileage_issue_label) {
      items.push({
        id: `required-mileage-${shift.id}`,
        title: "Review mileage",
        detail: shift.mileage_issue_label,
        meta: buildShiftLabel(shift),
        tone: "heads_up",
        target: "#employees/requests"
      });
    }

    if (role === "shoot_lead" && !shift.satisfies_lead_coverage) {
      items.push({
        id: `required-coverage-${shift.id}`,
        title: "Check team readiness",
        detail: "Assigned work still needs lead or minimum coverage review.",
        meta: buildShiftLabel(shift),
        tone: "action_needed",
        target: "#operations/staffing"
      });
    }
  }

  return dedupeMobileItems(items).slice(0, 4);
}

function buildFieldFollowUps(payload: EmployeeMyWorkResponse | null) {
  if (!payload) {
    return [];
  }

  const items: MobileListItem[] = [];

  if (payload.summary.pending_trade_requests > 0) {
    items.push({
      id: "followup-trades",
      title: formatCountLine(payload.summary.pending_trade_requests, "trade request waiting", "trade requests waiting"),
      detail: "Your trade request activity still needs a response or review.",
      tone: "heads_up",
      target: "#employees/requests"
    });
  }

  if (payload.summary.closeout_due_count > 0) {
    items.push({
      id: "followup-closeout",
      title: formatCountLine(payload.summary.closeout_due_count, "closeout item due", "closeout items due"),
      detail: "Finish required closeout before the day is fully wrapped.",
      tone: "action_needed",
      target: "#dashboard/my-day"
    });
  }

  if (payload.summary.mileage_review_count > 0) {
    items.push({
      id: "followup-mileage",
      title: formatCountLine(payload.summary.mileage_review_count, "mileage item needs review", "mileage items need review"),
      detail: "Mileage or reimbursement detail still needs your attention.",
      tone: "heads_up",
      target: "#employees/requests"
    });
  }

  if (payload.summary.unread_notifications > 0) {
    items.push({
      id: "followup-updates",
      title: formatCountLine(payload.summary.unread_notifications, "update still unread", "updates still unread"),
      detail: "Review the latest schedule, timing, or issue updates.",
      tone: "info",
      target: "#dashboard/alerts"
    });
  }

  return items.slice(0, 4);
}

function buildFieldRecentActivity(payload: EmployeeMyWorkResponse | null) {
  if (!payload) {
    return [];
  }

  return payload.notifications.slice(0, 4).map((notification) => ({
    id: notification.id,
    title: notification.title,
    detail: notification.body,
    meta: formatShortDateTime(notification.created_at),
    tone: mapNotificationTone(notification.priority),
    target: notification.deep_link ?? "#dashboard/alerts"
  }));
}

function buildProductionUrgentItems(board: ProductionProjectBoardResponse) {
  const items: MobileListItem[] = [];

  if (board.summary.overdue > 0) {
    items.push({
      id: "prod-overdue",
      title: formatCountLine(board.summary.overdue, "job is overdue", "jobs are overdue"),
      detail: "Something in your queue is already behind.",
      tone: "action_needed",
      target: "#production"
    });
  }

  if (board.summary.blocked > 0) {
    items.push({
      id: "prod-blocked",
      title: formatCountLine(board.summary.blocked, "job is blocked", "jobs are blocked"),
      detail: "Review QA, corrections, or release holds before work slips further.",
      tone: "action_needed",
      target: "#production/qa"
    });
  }

  const dueToday = countProductionDueToday(board);
  if (dueToday > 0) {
    items.push({
      id: "prod-due-today",
      title: formatCountLine(dueToday, "job is due today", "jobs are due today"),
      detail: "Today's release and review work needs close attention.",
      tone: "heads_up",
      target: "#production"
    });
  }

  return items.slice(0, 3);
}

function buildProductionFollowUps(board: ProductionProjectBoardResponse) {
  const items: MobileListItem[] = [];

  if (board.summary.team_queue > 0) {
    items.push({
      id: "production-follow-up",
      title: formatCountLine(board.summary.team_queue, "job needs follow-up", "jobs need follow-up"),
      detail: "A project is waiting on next steps or ownership.",
      tone: "heads_up",
      target: "#production/workload"
    });
  }

  if (board.summary.jobs_in_qa > 0) {
    items.push({
      id: "production-peer-review",
      title: formatCountLine(board.summary.jobs_in_qa, "job needs QA attention", "jobs need QA attention"),
      detail: "Peer review is the next blocker in your queue.",
      tone: "heads_up",
      target: "#production/qa"
    });
  }

  if (board.summary.ready_to_release > 0) {
    items.push({
      id: "production-final-qc",
      title: formatCountLine(board.summary.ready_to_release, "job is ready to release", "jobs are ready to release"),
      detail: "QC is holding up final release.",
      tone: "info",
      target: "#production/release"
    });
  }

  if (board.summary.unassigned_jobs > 0) {
    items.push({
      id: "production-unassigned",
      title: formatCountLine(board.summary.unassigned_jobs, "job still needs an owner", "jobs still need owners"),
      detail: "Some production work still has no clear owner.",
      tone: "heads_up",
      target: "#production/job-queue"
    });
  }

  return items.slice(0, 4);
}

function buildProductionRecentActivity(board: ProductionProjectBoardResponse) {
  return flattenProductionItems(board)
    .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
    .slice(0, 4)
    .map((item) => ({
      id: item.id,
      title: item.title,
      detail: item.next_action,
      meta: item.stage_label,
      tone: mapProductionTone(item.status_tone),
      target: `#production?project=${item.id}`
    }));
}

function buildProductionQueueItem(item: ProductionProjectBoardResponse["sections"][number]["items"][number]): MobileListItem {
  return {
    id: item.id,
    title: item.title,
    detail: item.next_action,
    meta: item.due_label ?? item.stage_label,
    tone: mapProductionTone(item.status_tone),
    target: `#production?project=${item.id}`
  };
}

function buildManagerUrgentItems(payload: HomeDashboardResponse): MobileListItem[] {
  return payload.widgets.urgent_watch.items.slice(0, 3).map((item) => ({
    id: item.id,
    title: item.title,
    detail: item.summary,
    meta: item.urgency_label,
    tone: mapHomeTone(item.tone),
    target: item.action_hash
  }));
}

function buildManagerTodayStripItems(payload: HomeDashboardResponse): MobileListItem[] {
  const strip = payload.widgets.today_strip;
  return [
    {
      id: "today-strip-shoots",
      title: formatCountLine(strip.shoot_count, "shoot today", "shoots today"),
      detail: "Open Today's Shoots for the operating-day lineup.",
      tone: strip.shoot_count > 0 ? "info" : "good",
      target: "#operations/shoots"
    },
    {
      id: "today-strip-urgent",
      title: formatCountLine(strip.urgent_issue_count, "urgent issue", "urgent issues"),
      detail: "Watch what needs intervention in the next 24 hours.",
      tone: strip.urgent_issue_count > 0 ? "action_needed" : "good",
      target: "#dashboard"
    },
    {
      id: "today-strip-attendance",
      title: formatCountLine(strip.late_arrival_count, "late or missing staff issue", "late or missing staff issues"),
      detail: "Review attendance gaps before staffing breaks the day.",
      tone: strip.late_arrival_count > 0 ? "heads_up" : "good",
      target: "#operations/attendance"
    },
    {
      id: "today-strip-approvals",
      title: formatCountLine(strip.approvals_waiting_count, "approval waiting", "approvals waiting"),
      detail: "Employees requests and exceptions still waiting on a decision.",
      tone: strip.approvals_waiting_count > 0 ? "heads_up" : "good",
      target: "#approvals"
    },
    {
      id: "today-strip-production",
      title: formatCountLine(strip.production_at_risk_count, "production item at risk", "production items at risk"),
      detail: "Queue pressure that can slip same-day delivery or downstream work.",
      tone: strip.production_at_risk_count > 0 ? "action_needed" : "good",
      target: "#production"
    }
  ];
}

function buildManagerShootItems(payload: HomeDashboardResponse): MobileListItem[] {
  return payload.widgets.today_shoots.shoots.slice(0, 4).map((shoot) => ({
    id: `manager-shoot-${shoot.id}`,
    title: shoot.title,
    detail: `${formatHomeShootTime(shoot)} • ${shoot.location_name}`,
    meta: buildManagerShootMeta(shoot),
    tone: mapHomeTone(shoot.attention_tone ?? shoot.staffing_readiness_tone ?? shoot.status_tone),
    target: "#operations/shoots"
  }));
}

function buildManagerAttendanceItems(payload: HomeDashboardResponse): MobileListItem[] {
  const attendance = payload.widgets.attendance_awareness;
  const groups = [
    attendance.probable_no_show?.items ?? [],
    attendance.critically_late?.items ?? [],
    attendance.missing_clock_in?.items ?? [],
    attendance.wrong_location.items,
    attendance.late.items
  ];

  return dedupeMobileItems(
    groups
      .flat()
      .slice(0, 5)
      .map((item) => ({
        id: `manager-attendance-${item.id}`,
        title: item.employee_name,
        detail: item.secondary_label ?? item.primary_label,
        meta: item.location_label ?? item.supporting_label ?? undefined,
        tone: mapAttendanceSeverity(item.severity),
        target: "#operations/attendance"
      }))
  ).slice(0, 4);
}

function buildManagerProductionItems(payload: HomeDashboardResponse): MobileListItem[] {
  const production = payload.widgets.production_projects;
  const urgent: MobileListItem[] = production.urgent_items.map((item) => ({
    id: `manager-production-urgent-${item.project_id}`,
    title: item.title,
    detail: item.summary,
    meta: item.urgency_label,
    tone: item.urgency_state === "overdue" ? "action_needed" : "heads_up",
    target: item.action_hash
  }));
  const focus: MobileListItem[] = production.focus_items.map((item) => ({
    id: `manager-production-focus-${item.project_id}`,
    title: item.title,
    detail: item.next_action,
    meta: item.due_label ?? item.stage_label,
    tone: mapHomeTone(item.tone),
    target: item.action_hash
  }));

  return dedupeMobileItems([...urgent, ...focus]).slice(0, 4);
}

function buildManagerFollowUps(payload: HomeDashboardResponse): MobileListItem[] {
  const items: MobileListItem[] = [];
  const strip = payload.widgets.today_strip;

  if (strip.approvals_waiting_count > 0) {
    items.push({
      id: "manager-followup-approvals",
      title: formatCountLine(strip.approvals_waiting_count, "approval needs your decision", "approvals need your decision"),
      detail: "Review pending requests, exceptions, and fixes waiting on approval.",
      tone: "heads_up",
      target: "#approvals"
    });
  }

  for (const item of payload.widgets.urgent_watch.items.slice(0, 3)) {
    items.push({
      id: `manager-followup-watch-${item.id}`,
      title: item.title,
      detail: item.action_label,
      meta: item.supporting_label ?? item.urgency_label ?? undefined,
      tone: mapHomeTone(item.tone),
      target: item.action_hash
    });
  }

  return dedupeMobileItems(items).slice(0, 4);
}

function buildQuickActionButtons(role: BusinessRole, quickActions: DashboardQuickActionDefinition[]) {
  return quickActions.slice(0, 3).map((action) => ({
    id: action.id,
    label: action.label,
    target: action.hash,
    source: `mobile_quick_${role}`
  }));
}

function resolveAssignmentTitle(role: BusinessRole, shift: EmployeeShiftPreview) {
  if (isCurrentShift(shift)) {
    return role === "photographer" || role === "shoot_lead" ? "Current Shoot" : "Current Assignment";
  }
  return role === "photographer" || role === "shoot_lead" ? "Next Shoot" : "Next Assignment";
}

function buildAssignmentSubtitle(shift: EmployeeShiftPreview) {
  if (isCurrentShift(shift) || shift.latest_punch_direction === "in") {
    return "Where you are right now and the next action tied to this assignment.";
  }
  return "Where you need to be next, when you need to be there, and who is leading the work.";
}

function resolveShiftStateDetail(shift: EmployeeShiftPreview) {
  if (shift.latest_punch_direction === "in") {
    return "You are currently clocked in.";
  }
  if (isCurrentShift(shift)) {
    return "This assignment is in progress.";
  }
  if (new Date(shift.ends_at).getTime() < Date.now()) {
    return "This assignment already ended.";
  }
  return "This is the next scheduled assignment.";
}

function buildClockHeadline(shift: EmployeeShiftPreview) {
  if (shift.latest_punch_direction === "in") {
    return "Clocked in";
  }
  if (shift.attendance_state === "probable_no_show") {
    return "Probable no-show risk";
  }
  if (shift.attendance_state === "missing_clock_in") {
    return "Clock-in still missing";
  }
  return "Not clocked in";
}

function buildLastClockEventLabel(shift: EmployeeShiftPreview) {
  if (!shift.latest_punch_at || !shift.latest_punch_direction) {
    return "No clock event";
  }
  return `${shift.latest_punch_direction === "in" ? "Clocked in" : "Clocked out"} ${formatShortTime(shift.latest_punch_at)}`;
}

function buildLastClockEventDetail(shift: EmployeeShiftPreview) {
  if (shift.latest_punch_approval_state && shift.latest_punch_approval_state !== "approved") {
    return "The last clock event is still under review.";
  }
  if (!shift.latest_punch_at) {
    return "Open My Day if you need the full attendance workflow.";
  }
  return shift.attendance_state_note ?? "The latest clock event is recorded.";
}

function buildLocationDetail(shift: EmployeeShiftPreview) {
  if (shift.latest_punch_approval_state && shift.latest_punch_approval_state !== "approved") {
    return "Manager review may still be required.";
  }
  if (shift.latest_geofence_status === "inside") {
    return "The last clock event was captured on site.";
  }
  if (shift.latest_geofence_status === "outside") {
    return "Review the location or retry from the assigned site.";
  }
  return "Retry location capture if the site check did not complete.";
}

function resolveContactTarget(currentUser: SessionUser) {
  if (hasCapability(currentUser, "directory_internal.view")) {
    return "#directory/internal";
  }
  if (hasCapability(currentUser, "directory_contacts.view")) {
    return "#directory/contacts";
  }
  return null;
}

function humanizeAttendanceState(value?: string | null) {
  switch (value) {
    case "on_time":
      return "On Time";
    case "early":
      return "Early";
    case "grace_window":
      return "Grace Window";
    case "late":
      return "Late";
    case "critically_late":
      return "Critically Late";
    case "missing_clock_in":
      return "Missing Clock-In";
    case "wrong_location":
      return "Wrong Location";
    case "probable_no_show":
      return "Probable No-Show";
    case "excused_exception":
      return "Excused Exception";
    case "corrected_after_review":
      return "Corrected After Review";
    default:
      return "Clock Review";
  }
}

function humanizeLocationStatus(shift: EmployeeShiftPreview) {
  if (shift.attendance_state === "wrong_location") {
    return "Wrong Location";
  }
  if (shift.latest_punch_approval_state && shift.latest_punch_approval_state !== "approved") {
    return "Clock-In Pending Location Review";
  }
  if (shift.latest_geofence_status === "inside") {
    return "Valid On-Site";
  }
  if (shift.latest_geofence_status === "outside") {
    return "Outside Allowed Zone";
  }
  return shift.latest_punch_direction ? "Clock-In Pending Location Review" : "No Location Check";
}

function isUrgentAttendanceState(value?: string | null) {
  return ["late", "critically_late", "missing_clock_in", "wrong_location", "probable_no_show"].includes(String(value ?? ""));
}

function isCurrentShift(shift: EmployeeShiftPreview) {
  const now = Date.now();
  return new Date(shift.starts_at).getTime() <= now && new Date(shift.ends_at).getTime() >= now;
}

function getCurrentShift(shifts: EmployeeShiftPreview[]) {
  return sortShiftsByStart(shifts).find((shift) => isCurrentShift(shift) || shift.latest_punch_direction === "in") ?? null;
}

function getNextShift(shifts: EmployeeShiftPreview[]) {
  const now = Date.now();
  return sortShiftsByStart(shifts).find((shift) => new Date(shift.ends_at).getTime() >= now) ?? shifts[0] ?? null;
}

function sortShiftsByStart(shifts: EmployeeShiftPreview[]) {
  return [...shifts].sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
}

function buildShiftLabel(shift: EmployeeShiftPreview) {
  return shift.shoot_code ?? shift.shoot_title ?? shift.title;
}

function flattenProductionItems(board: ProductionProjectBoardResponse) {
  return board.sections.flatMap((section) => section.items);
}

function countProductionDueToday(board: ProductionProjectBoardResponse) {
  return flattenProductionItems(board).filter((item) => isDueToday(item, board.anchor_date)).length;
}

function isDueToday(item: ProductionProjectBoardResponse["sections"][number]["items"][number], anchorDate: string) {
  return item.due_date === anchorDate || item.due_label?.toLowerCase().includes("today");
}

function dedupeMobileItems(items: MobileListItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.title}:${item.meta ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function formatCountLine(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatToneLabel(value: MobileListItem["tone"]) {
  if (value === "action_needed") {
    return "High";
  }
  if (value === "heads_up") {
    return "Heads Up";
  }
  if (value === "good") {
    return "Ready";
  }
  return "Info";
}

function mapProductionTone(value: string | null | undefined): NonNullable<MobileListItem["tone"]> {
  if (value === "critical") {
    return "action_needed";
  }
  if (value === "warning") {
    return "heads_up";
  }
  if (value === "success") {
    return "good";
  }
  return "info";
}

function mapNotificationTone(value: string | null | undefined): NonNullable<MobileListItem["tone"]> {
  if (value === "critical") {
    return "action_needed";
  }
  if (value === "high") {
    return "heads_up";
  }
  return "info";
}

function mapHomeTone(value: string | null | undefined): NonNullable<MobileListItem["tone"]> {
  if (value === "action_needed") {
    return "action_needed";
  }
  if (value === "heads_up") {
    return "heads_up";
  }
  if (value === "good") {
    return "good";
  }
  return "info";
}

function mapAttendanceSeverity(value: string | null | undefined): NonNullable<MobileListItem["tone"]> {
  if (value === "critical") {
    return "action_needed";
  }
  if (value === "high" || value === "medium") {
    return "heads_up";
  }
  return "info";
}

function formatDashboardDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function formatMobileRoleEyebrow(role: BusinessRole) {
  if (role === "manager") {
    return "Manager Home";
  }
  if (role === "photographer") {
    return "Field Home";
  }
  if (role === "shoot_lead") {
    return "Lead Home";
  }
  if (role === "production_staff") {
    return "Production Home";
  }
  return "Personal Home";
}

function formatShortDateTime(value: string) {
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatHomeShootTime(shoot: HomeDashboardResponse["widgets"]["today_shoots"]["shoots"][number]) {
  const timeValue = shoot.arrival_time ?? shoot.start_time ?? shoot.end_time_est;
  if (!timeValue) {
    return "Time pending";
  }
  return formatTimeOnly(timeValue);
}

function buildManagerShootMeta(shoot: HomeDashboardResponse["widgets"]["today_shoots"]["shoots"][number]) {
  const markers = [
    shoot.priority_display ?? null,
    shoot.lead_name ? `Lead ${shoot.lead_name}` : null,
    shoot.staffing_readiness_label ?? null,
    shoot.attention_label ?? null
  ].filter(Boolean);

  return markers.join(" • ");
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatShortTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatShortTimeRange(startsAt: string, endsAt: string) {
  return `${formatShortTime(startsAt)} - ${formatShortTime(endsAt)}`;
}

function formatTimeOnly(value: string) {
  return formatShortTime(value);
}

function humanizeLabel(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function navigateToTarget(target: string, external = false) {
  if (external || /^https?:\/\//i.test(target)) {
    window.open(target, "_blank", "noopener,noreferrer");
    return;
  }
  window.location.hash = target;
}
