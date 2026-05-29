import { OperationalDetailSection } from "../OperationalDetailSection";
import type { CentralJobIntakeResponse, CentralJobReadinessIssue } from "../../jobIntakeTypes";

type Props = {
  intake: CentralJobIntakeResponse;
};

export function CentralJobDetailPanel({ intake }: Props) {
  const primaryDay = intake.job_days[0] ?? null;
  const productionSummary = summarizeProduction(intake);
  const readinessTone = intake.readiness.readiness_status === "ready" ? "good" : "warning";
  const duplicateBadge = intake.job.duplicate_override_note ? "Duplicate override used" : null;
  const mergeBadge = intake.job.merge_parent_job_id ? "Merged record" : null;

  return (
    <>
      <OperationalDetailSection
        title="Central Job Header"
        summary="This published intake record is the canonical job source of truth feeding scheduling, staffing, readiness, production, and activity history."
        defaultOpen
      >
        <div className="dashboard-stack central-job-detail">
          <div className={`home-detail-callout home-detail-callout--${readinessTone}`}>
            <strong>
              {intake.job.record_state === "published" && intake.readiness.readiness_status !== "ready"
                ? "Published but still blocked"
                : "Published and ready for downstream work"}
            </strong>
            <div className="muted">
              {intake.readiness.blockers.length
                ? `${intake.readiness.blockers.length} readiness blocker${intake.readiness.blockers.length === 1 ? "" : "s"} still need follow-through.`
                : "No readiness blockers are currently attached to this job."}
            </div>
          </div>

          <div className="detail-two-column">
            <div className="dashboard-summary-list">
              <div className="dashboard-summary-row">
                <span className="muted">Job Number</span>
                <strong>{intake.job.job_number ?? intake.job.shoot_code}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Job Title</span>
                <strong>{intake.job.title}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Department</span>
                <strong>{humanizeToken(intake.job.department)}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Job Status</span>
                <strong>{humanizeToken(intake.job.job_status)}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Readiness</span>
                <strong>{humanizeToken(intake.job.readiness_status)}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Production</span>
                <strong>{productionSummary}</strong>
              </div>
            </div>
            <div className="dashboard-summary-list">
              <div className="dashboard-summary-row">
                <span className="muted">Primary Day</span>
                <strong>{primaryDay ? formatDay(primaryDay.shoot_date, primaryDay.start_time) : "Schedule pending"}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Organization</span>
                <strong>{intake.job.organization_display_name ?? intake.job.unresolved_organization_name ?? "Organization pending"}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Primary Location</span>
                <strong>{intake.job.location_display_name ?? intake.job.unresolved_location_name ?? "Location pending"}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Primary Contact</span>
                <strong>{intake.job.primary_contact_name ?? intake.job.unresolved_primary_contact_name ?? "Contact pending"}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Job Owner</span>
                <strong>{intake.job.job_owner_name ?? "Owner pending"}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Badges</span>
                <strong>{[duplicateBadge, mergeBadge].filter(Boolean).join(" | ") || "No duplicate or merge flags"}</strong>
              </div>
            </div>
          </div>
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Readiness Panel"
        summary="Current blockers and warnings stay visible here so the published job can be worked without guessing what is still missing."
        defaultOpen
      >
        <div id="central-job-readiness" className="dashboard-stack">
          {intake.readiness.blockers.map((issue) => (
            <ReadinessIssueCard key={`blocker-${issue.code}`} issue={issue} />
          ))}
          {intake.readiness.warnings.map((issue) => (
            <ReadinessIssueCard key={`warning-${issue.code}`} issue={issue} />
          ))}
          {!intake.readiness.blockers.length && !intake.readiness.warnings.length ? (
            <div className="empty-state empty-state--panel">No open readiness blockers or warnings are attached to this job.</div>
          ) : null}
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Job Days"
        summary="The publish-time schedule days stay attached to the canonical job instead of being rebuilt in downstream queues."
      >
        <div id="central-job-days" className="dashboard-stack">
          {intake.job_days.length ? (
            intake.job_days.map((day) => (
              <div key={day.id} className="request-card">
                <strong>Day {day.day_index + 1}</strong>
                <div className="muted">{formatDay(day.shoot_date, day.start_time, day.end_time)}</div>
                <div className="muted">
                  {day.location_id ? "Linked location ready" : "Location still unresolved"} | {day.date_only ? "Date only" : "Timed day"}
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state empty-state--panel">No job day rows are saved on this job yet.</div>
          )}
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Department Detail"
        summary="Department-specific intake detail stays attached to the same canonical job instead of branching into a second data model."
      >
        <div id="central-job-department-detail" className="detail-two-column">
          {intake.job.department === "schools" ? (
            <>
              <div className="dashboard-summary-list">
                <div className="dashboard-summary-row">
                  <span className="muted">School Job Type</span>
                  <strong>{intake.school_detail?.school_job_type ?? "Pending"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Roster Status</span>
                  <strong>{intake.school_detail?.roster_status ?? "Pending"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">ID Sort Method</span>
                  <strong>{intake.school_detail?.id_sort_method ?? "Not required"}</strong>
                </div>
              </div>
              <div className="dashboard-summary-list">
                <div className="dashboard-summary-row">
                  <span className="muted">Yearbook Due Date</span>
                  <strong>{intake.school_detail?.yearbook_due_date ?? "Not required"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Student Estimate</span>
                  <strong>{intake.school_detail?.student_count_estimate ?? "Not set"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">School Day Notes</span>
                  <strong>{intake.school_detail?.school_day_notes ?? "No school-day notes saved"}</strong>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="dashboard-summary-list">
                <div className="dashboard-summary-row">
                  <span className="muted">Sports Job Type</span>
                  <strong>{intake.sports_detail?.sports_job_type ?? "Pending"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Sport</span>
                  <strong>{intake.sports_detail?.sport_name ?? "Pending"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Season</span>
                  <strong>{intake.sports_detail?.season ?? "Not set"}</strong>
                </div>
              </div>
              <div className="dashboard-summary-list">
                <div className="dashboard-summary-row">
                  <span className="muted">Specialty Products</span>
                  <strong>{intake.sports_detail?.specialty_product_types?.join(", ") || "Not required"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Gallery Required</span>
                  <strong>{intake.sports_detail?.gallery_required ? "Yes" : "No"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Event Notes</span>
                  <strong>{intake.sports_detail?.event_notes ?? "No event notes saved"}</strong>
                </div>
              </div>
            </>
          )}
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Production Items"
        summary="Production shells generated from intake publish stay visible here so Production remains the execution workspace, not the source of truth."
      >
        <div id="central-job-production" className="dashboard-stack">
          {intake.production_items.length ? (
            intake.production_items.map((item) => (
              <div key={item.id} className="request-card">
                <strong>{item.title}</strong>
                <div className="muted">
                  {humanizeToken(item.status)}{item.stage ? ` | ${humanizeToken(item.stage)}` : ""}{item.owner_name ? ` | ${item.owner_name}` : ""}
                </div>
                <div className="request-card__actions">
                  <span className="meta-pill">{item.due_date ? `Due ${item.due_date}` : "No due date"}</span>
                  <a href={`#production?project=${item.id}`}>Open in Production</a>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state empty-state--panel">No production shells are attached to this published job.</div>
          )}
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Staffing"
        summary="Staffing shells stay attached to the job so Operations and Scheduling can work live coverage without a second intake system."
      >
        <div id="central-job-staffing" className="dashboard-stack">
          {intake.staffing_requirements.length ? (
            intake.staffing_requirements.map((requirement) => (
              <div key={requirement.id} className="request-card">
                <strong>{requirement.label}</strong>
                <div className="muted">
                  {humanizeToken(requirement.staffing_role)} | Min {requirement.minimum_count} | Ideal {requirement.ideal_count}
                </div>
                <div className="muted">
                  {requirement.required_for_ready ? "Required for ready" : "Support role"}{requirement.lead_required ? " | Lead required" : ""}
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state empty-state--panel">No staffing shell rows are attached to this published job.</div>
          )}
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Notes and Instructions"
        summary="Important intake notes stay visible after publish instead of disappearing once the job becomes operational."
      >
        <div id="central-job-notes" className="dashboard-summary-list">
          <div className="dashboard-summary-row">
            <span className="muted">Internal Notes</span>
            <strong>{intake.job.internal_notes ?? "No internal notes saved"}</strong>
          </div>
          <div className="dashboard-summary-row">
            <span className="muted">Client Notes</span>
            <strong>{intake.job.client_notes ?? "No client notes saved"}</strong>
          </div>
          <div className="dashboard-summary-row">
            <span className="muted">Special Instructions</span>
            <strong>{intake.job.special_instructions ?? "No special instructions saved"}</strong>
          </div>
          {intake.job.raw_source_text ? (
            <div className="dashboard-summary-row">
              <span className="muted">Raw Source</span>
              <strong>{intake.job.raw_source_text}</strong>
            </div>
          ) : null}
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Activity Log"
        summary="Draft creation, duplicate overrides, publish, readiness recomputes, and downstream shell creation stay visible as canonical job history."
      >
        <div id="central-job-activity" className="timeline-list">
          {intake.activity_log.length ? (
            intake.activity_log.map((event) => (
              <div key={event.id} className="timeline-item">
                <div className="timeline-dot" />
                <div className="timeline-content">
                  <div className="timeline-header">
                    <strong>{humanizeToken(event.event_type)}</strong>
                    <span>{formatTimestamp(event.created_at)}</span>
                  </div>
                  <div className="muted">{event.actor_name ?? "System event"}</div>
                  {renderActivityPayload(event.payload)}
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state empty-state--panel">No central intake activity has been logged yet.</div>
          )}
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Linked Context"
        summary="Open the owning directory and downstream workspaces from the canonical job instead of recreating the linked records."
      >
        <div id="central-job-links" className="request-card">
          <strong>Open linked records</strong>
          <div className="request-card__actions">
            {intake.job.organization_id ? (
              <a href={`#directory/accounts?view=organizations&organization=${intake.job.organization_id}&tab=linked_shoots`}>
                Organization history
              </a>
            ) : null}
            {intake.job.location_id ? (
              <a href={`#directory/locations?location=${intake.job.location_id}&tab=relationships`}>Location context</a>
            ) : null}
            {intake.job.primary_contact_id ? (
              <a href={`#directory/contacts?view=contacts&contact=${intake.job.primary_contact_id}&tab=relationships`}>
                Contact context
              </a>
            ) : null}
            {intake.production_items.length ? <a href="#production">Production queue</a> : null}
            {intake.staffing_requirements.length ? <a href="#operations/staffing?area=staffing">Staffing queue</a> : null}
          </div>
        </div>
      </OperationalDetailSection>
    </>
  );
}

function ReadinessIssueCard({ issue }: { issue: CentralJobReadinessIssue }) {
  const targetId = mapReadinessFieldToSectionId(issue.field);
  return (
    <div className={`request-card${issue.blocking ? " request-card--critical" : ""}`}>
      <strong>{issue.label}</strong>
      <div className="muted">{issue.message}</div>
      {targetId ? (
        <div className="request-card__actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            Jump to field context
          </button>
        </div>
      ) : null}
    </div>
  );
}

function mapReadinessFieldToSectionId(field: string) {
  if (field.includes("location") || field.includes("primary_contact")) {
    return "central-job-links";
  }
  if (field.includes("start_time")) {
    return "central-job-days";
  }
  if (field.includes("staffing_estimate")) {
    return "central-job-staffing";
  }
  if (field.includes("delivery_due_date")) {
    return "central-job-production";
  }
  if (field.includes("school_detail") || field.includes("sports_detail")) {
    return "central-job-department-detail";
  }
  return null;
}

function summarizeProduction(intake: CentralJobIntakeResponse) {
  if (!intake.production_items.length) {
    return intake.job.production_required ? "Waiting for shell" : "Not required";
  }
  const statuses = new Set(intake.production_items.map((item) => item.status));
  if (statuses.size === 1) {
    return humanizeToken(intake.production_items[0].status);
  }
  return `${intake.production_items.length} items active`;
}

function formatDay(date: string | null, startTime?: string | null, endTime?: string | null) {
  const dateLabel = date ?? "Date pending";
  if (!startTime && !endTime) {
    return dateLabel;
  }
  return `${dateLabel} | ${[startTime ?? "Time pending", endTime].filter(Boolean).join(" - ")}`;
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function humanizeToken(value: string | null | undefined) {
  if (!value) {
    return "Pending";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function renderActivityPayload(payload: Record<string, unknown>) {
  const entries = Object.entries(payload ?? {}).slice(0, 3);
  if (!entries.length) {
    return null;
  }
  return (
    <div className="muted">
      {entries
        .map(([key, value]) => `${humanizeToken(key)}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
        .join(" | ")}
    </div>
  );
}
