import { useEffect, useMemo, useState } from "react";
import {
  getProjectWorkflowCommandCenter,
  getProjectWorkflowInstance,
  instantiateProjectWorkflow,
  listProjectWorkflowTemplates
} from "../../services/projectTracking";
import type { SharedJobPrepReadinessPreview } from "../../jobTruthTypes";
import type { ProjectWorkflowInstance, ProjectWorkflowJobRow, ProjectWorkflowStep, ProjectWorkflowTemplateSummary } from "../../projectTrackingTypes";
import { WorkspaceEmptyState } from "../workspace/WorkspaceEmptyState";

type Props = {
  token: string;
  jobId: string;
  prepReadiness?: SharedJobPrepReadinessPreview | null;
};

type LoadedState = {
  row: ProjectWorkflowJobRow | null;
  workflow: ProjectWorkflowInstance | null;
};

type SequencedStep = ProjectWorkflowStep & {
  milestone_name: string;
};

function humanize(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(parsed);
}

function formatDateTime(value: string | null | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(parsed);
}

function getDepartmentQueueTarget(department: string | null | undefined) {
  const normalized = department?.toLowerCase();
  if (normalized === "schools") {
    return { href: "#schools", label: "Open Schools queue" };
  }
  if (normalized === "sports") {
    return { href: "#sports", label: "Open Sports queue" };
  }
  if (normalized === "production" || normalized === "graphics") {
    return { href: "#production-queue", label: "Open Production queue" };
  }
  return { href: "#project-tracking", label: "Open Project Dashboard" };
}

function getOwnerLabel(row: ProjectWorkflowJobRow) {
  const step = row.current_step;
  if (step?.assigned_user_name) {
    return step.assigned_user_name;
  }
  if (step?.assignment_status === "needs_assignment") {
    return `Needs Assignment${step.assigned_queue ? ` · ${humanize(step.assigned_queue)} Queue` : ""}`;
  }
  if (step?.assigned_queue) {
    return `${humanize(step.assigned_queue)} Queue`;
  }
  if (row.owner_type !== "unknown" && row.owner_display) {
    return row.owner_display;
  }
  if (step?.role_key) {
    return humanize(step.role_key);
  }
  return "Owner not set";
}

function getWaitingLabel(row: ProjectWorkflowJobRow) {
  const party = row.current_step?.waiting_on_party ?? row.waiting_on_party;
  const detail = row.current_step?.waiting_detail?.trim();
  if (!party || party === "unknown") {
    return "Waiting not set";
  }
  if (party === "none") {
    return "No wait";
  }
  return `Waiting on ${humanize(party)}${detail ? ` · ${detail}` : ""}`;
}

function getRiskLabel(row: ProjectWorkflowJobRow) {
  if (row.blocked_reason) {
    return `Blocked · ${row.blocked_reason}`;
  }
  const reason = row.health_reasons[0];
  if (reason) {
    return `${humanize(row.health)} · ${reason}`;
  }
  if (row.deadline_state === "running_late" || row.deadline_state === "due_soon") {
    return humanize(row.deadline_state);
  }
  return humanize(row.health || "unknown");
}

function getRiskTone(row: ProjectWorkflowJobRow) {
  if (row.health === "blocked" || row.health === "running_late" || row.deadline_state === "running_late") {
    return "danger";
  }
  if (row.health === "at_risk" || row.health === "due_soon" || row.deadline_state === "due_soon") {
    return "warning";
  }
  if (row.health === "complete" || row.health === "on_track") {
    return "success";
  }
  return "neutral";
}

function getSequencedSteps(workflow: ProjectWorkflowInstance | null) {
  if (!workflow) {
    return [];
  }
  return workflow.milestones.flatMap((milestone) =>
    milestone.steps.map((step) => ({
      ...step,
      milestone_name: milestone.name
    }))
  );
}

function useJobWorkflowState(token: string, jobId: string) {
  const [loaded, setLoaded] = useState<LoadedState>({ row: null, workflow: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    // The command-center query schema caps limit at 200 (routes/workflows.ts) — 250 was rejected
    // with a zod 400, silently breaking this panel for every role.
    void getProjectWorkflowCommandCenter(token, { view: "global", limit: 200 })
      .then(async (commandCenter) => {
        const row = commandCenter.job_rows.find((jobRow) => jobRow.job_id === jobId) ?? null;
        const workflow = row?.workflow_run_id ? await getProjectWorkflowInstance(token, row.workflow_run_id) : null;
        if (!cancelled) {
          setLoaded({ row, workflow });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded({ row: null, workflow: null });
          setError("Project workflow state is unavailable right now.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [jobId, token]);

  return { ...loaded, loading, error };
}

function formatPrepStatus(value: string) {
  return humanize(value);
}

function formatAudience(value: string) {
  if (value === "client_facing") {
    return "Client-facing";
  }
  if (value === "employee_facing") {
    return "Employee-facing";
  }
  if (value === "internal_only") {
    return "Internal-only";
  }
  return humanize(value);
}

function renderRecipientList(recipients: SharedJobPrepReadinessPreview["client_prep"]["eligible_email_recipients"], emptyLabel: string) {
  if (!recipients.length) {
    return <p className="shared-job-sidebar__muted">{emptyLabel}</p>;
  }
  return (
    <div className="job-command-center__prep-list">
      {recipients.map((recipient) => (
        <span key={recipient.id} className="job-command-center__prep-pill">
          {recipient.display_name}
          {recipient.email ? ` - ${recipient.email}` : recipient.mobile_phone ? ` - ${recipient.mobile_phone}` : ""}
        </span>
      ))}
    </div>
  );
}

function renderMessagePreviewCard(preview: SharedJobPrepReadinessPreview["message_previews"]["client_prep_email"]) {
  return (
    <section className="job-command-center__message-preview">
      <div className="job-command-center__message-preview-header">
        <div>
          <h5>{preview.label}</h5>
          <p className="shared-job-sidebar__muted">Preview only - nothing is sent.</p>
        </div>
        <span className={`job-command-center__prep-status job-command-center__prep-status--${preview.can_preview ? "ready" : "blocked"}`}>
          {preview.can_preview ? "Preview ready" : "Needs data"}
        </span>
      </div>
      {preview.recipients.length ? (
        <>
          <h6>Would send to</h6>
          {renderRecipientList(preview.recipients, "No recipients are ready.")}
        </>
      ) : null}
      {preview.subject ? (
        <div className="job-command-center__prep-kv">
          <span>Subject</span>
          <strong>{preview.subject}</strong>
        </div>
      ) : null}
      <div className="job-command-center__message-body" aria-label={`${preview.label} body`}>
        {preview.body_lines.map((line, index) => (
          <p key={`${preview.template_key}-${index}`}>{line}</p>
        ))}
      </div>
      {preview.reference_attachments.length ? (
        <div className="job-command-center__prep-attachments">
          <h6>Attachments referenced</h6>
          {preview.reference_attachments.map((attachment) => (
            <div key={attachment.id}>
              <span className={`job-command-center__prep-audience job-command-center__prep-audience--${attachment.audience}`}>{formatAudience(attachment.audience)}</span>
              <strong>{attachment.file_url ? <a href={attachment.file_url} target="_blank" rel="noreferrer">{attachment.title}</a> : attachment.title}</strong>
              <span>{humanize(attachment.attachment_type)}{attachment.description ? ` - ${attachment.description}` : ""}</span>
            </div>
          ))}
        </div>
      ) : null}
      {preview.warnings.length ? (
        <div className="job-command-center__prep-warnings">
          {preview.warnings.map((warning) => (
            <span key={`${preview.template_key}-${warning.code}`} className={`job-command-center__prep-warning job-command-center__prep-warning--${warning.severity}`}>
              {warning.label}{warning.detail ? ` - ${warning.detail}` : ""}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function JobPrepReadinessPanel({ preview }: { preview: SharedJobPrepReadinessPreview | null | undefined }) {
  if (!preview) {
    return null;
  }
  const clientLocation = preview.client_prep.primary_location;
  const employeeLocation = preview.employee_briefing.primary_location;
  const employeeNoteRows: Array<[string, string]> = employeeLocation
    ? [
        ["Parking", employeeLocation.parking_instructions],
        ["Entrance / check-in", employeeLocation.entrance_instructions],
        ["Unloading", employeeLocation.unloading_instructions],
        ["Setup area", employeeLocation.setup_area],
        ["Backup indoor location", employeeLocation.backup_indoor_location],
        ["Power", employeeLocation.power_availability_notes],
        ["Wi-Fi / cell", employeeLocation.wifi_cell_notes],
        ["Weather contingency", employeeLocation.weather_contingency_notes],
        ["Employee-facing notes", employeeLocation.employee_facing_notes],
        ["Internal-only notes", employeeLocation.internal_only_notes]
      ].filter((row): row is [string, string] => Boolean(row[1]))
    : [];

  return (
    <div className="job-command-center__prep" aria-label="Job prep readiness preview">
      <div className="job-command-center__prep-header">
        <div>
          <h4>Job Prep Readiness Preview</h4>
          <p className="shared-job-sidebar__muted">Preview only. Mission Control is not sending email or SMS from this panel.</p>
        </div>
        <span className={`job-command-center__prep-status job-command-center__prep-status--${preview.status}`}>{formatPrepStatus(preview.status)}</span>
      </div>

      <div className="job-command-center__prep-grid">
        <section>
          <h5>Client Prep Preview</h5>
          <div className="job-command-center__prep-kv">
            <span>Account</span>
            <strong>{preview.client_prep.account_name ?? "Account not connected yet"}</strong>
            <span>Job</span>
            <strong>{preview.client_prep.job_name}</strong>
            <span>Job date</span>
            <strong>{formatDate(preview.client_prep.job_date, "Job date not connected yet")}</strong>
            <span>Location</span>
            <strong>{clientLocation?.location_name ?? "No primary location"}</strong>
            <span>Google Maps</span>
            <strong>{clientLocation?.google_maps_url ? <a href={clientLocation.google_maps_url} target="_blank" rel="noreferrer">Open in Google Maps</a> : "Map link not ready"}</strong>
            <span>Client-facing notes</span>
            <strong>{clientLocation?.client_facing_notes ?? "No client-facing notes yet"}</strong>
          </div>

          <h6>Eligible prep email recipients</h6>
          {renderRecipientList(preview.client_prep.eligible_email_recipients, "No prep email recipients are ready.")}
          <h6>Eligible prep SMS recipients</h6>
          {renderRecipientList(preview.client_prep.eligible_sms_recipients, "No SMS recipients are ready.")}

          {preview.client_prep.excluded_contacts.length ? (
            <>
              <h6>Excluded contacts</h6>
              <div className="job-command-center__prep-exclusions">
                {preview.client_prep.excluded_contacts.map((contact) => (
                  <div key={contact.id}>
                    <strong>{contact.display_name}</strong>
                    <span>{[contact.prep_email_exclusion_reason, contact.prep_sms_exclusion_reason].filter(Boolean).join(" ")}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </section>

        <section>
          <h5>Employee Briefing Preview</h5>
          {employeeLocation ? (
            <>
              <div className="job-command-center__prep-kv">
                <span>Primary location</span>
                <strong>{employeeLocation.location_name}</strong>
                <span>Address</span>
                <strong>{employeeLocation.address_display ?? "Address not ready"}</strong>
                <span>Google Maps</span>
                <strong>{employeeLocation.google_maps_url ? <a href={employeeLocation.google_maps_url} target="_blank" rel="noreferrer">Open in Google Maps</a> : "Map link not ready"}</strong>
              </div>
              {employeeNoteRows.length ? (
                <div className="job-command-center__prep-notes">
                  {employeeNoteRows.map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="shared-job-sidebar__muted">Employee briefing notes are not filled in yet.</p>
              )}
              {employeeLocation.reference_attachments.length ? (
                <div className="job-command-center__prep-attachments">
                  <h6>Reference attachments</h6>
                  {employeeLocation.reference_attachments.map((attachment) => (
                    <div key={attachment.id}>
                      <span className={`job-command-center__prep-audience job-command-center__prep-audience--${attachment.audience}`}>{formatAudience(attachment.audience)}</span>
                      <strong>{attachment.file_url ? <a href={attachment.file_url} target="_blank" rel="noreferrer">{attachment.title}</a> : attachment.title}</strong>
                      <span>{humanize(attachment.attachment_type)}{attachment.description ? ` - ${attachment.description}` : ""}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <p className="shared-job-sidebar__muted">No primary location is connected yet.</p>
          )}
        </section>
      </div>

      {preview.warnings.length ? (
        <div className="job-command-center__prep-warnings">
          <h5>Missing readiness / warnings</h5>
          {preview.warnings.map((warning) => (
            <span key={warning.code} className={`job-command-center__prep-warning job-command-center__prep-warning--${warning.severity}`}>
              {warning.label}{warning.detail ? ` - ${warning.detail}` : ""}
            </span>
          ))}
        </div>
      ) : null}

      <div className="job-command-center__message-previews" aria-label="Message template readiness previews">
        <div>
          <h5>Message Template Readiness</h5>
          <p className="shared-job-sidebar__muted">Hard-coded V1 previews assembled from job, contact, and location readiness data. No messages are sent or saved.</p>
        </div>
        {renderMessagePreviewCard(preview.message_previews.client_prep_email)}
        {renderMessagePreviewCard(preview.message_previews.client_prep_sms)}
        {renderMessagePreviewCard(preview.message_previews.employee_briefing)}
      </div>
    </div>
  );
}

export function JobOperationalCommandPanel({ token, jobId, prepReadiness }: Props) {
  const { row, workflow, loading, error } = useJobWorkflowState(token, jobId);
  const [templates, setTemplates] = useState<ProjectWorkflowTemplateSummary[]>([]);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("");
  const [assignState, setAssignState] = useState<"idle" | "loading" | "saving" | "error">("idle");
  const [assignError, setAssignError] = useState("");
  const sequencedSteps = useMemo(() => getSequencedSteps(workflow), [workflow]);
  const currentStep = row?.current_step ?? null;
  const currentStepIndex = currentStep ? sequencedSteps.findIndex((step) => step.id === currentStep.id) : -1;
  const previousStep = currentStepIndex > 0 ? sequencedSteps[currentStepIndex - 1] : null;
  const nextStep = currentStepIndex >= 0 && currentStepIndex < sequencedSteps.length - 1 ? sequencedSteps[currentStepIndex + 1] : null;
  const departmentTarget = getDepartmentQueueTarget(currentStep?.department);

  useEffect(() => {
    if (loading || row) {
      return;
    }
    let active = true;
    setAssignState("loading");
    setAssignError("");
    listProjectWorkflowTemplates(token)
      .then((payload) => {
        if (!active) {
          return;
        }
        setTemplates(payload.templates);
        setSelectedTemplateKey((current) => current || payload.templates[0]?.template_key || "");
        setAssignState("idle");
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }
        setAssignState("error");
        setAssignError(loadError instanceof Error ? loadError.message : "Workflow templates could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [loading, row, token]);

  const assignWorkflowTemplate = async () => {
    if (!selectedTemplateKey) {
      setAssignState("error");
      setAssignError("Choose a workflow template recipe before assigning this job workflow.");
      return;
    }
    setAssignState("saving");
    setAssignError("");
    try {
      const assignedWorkflow = await instantiateProjectWorkflow(token, {
        job_id: jobId,
        template_key: selectedTemplateKey,
        idempotency_key: `job-workflow-assignment:${jobId}:${selectedTemplateKey}`
      });
      window.location.hash = `#project-tracking/workflows/${assignedWorkflow.workflow_run.id}`;
    } catch (assignErrorValue) {
      setAssignState("error");
      setAssignError(assignErrorValue instanceof Error ? assignErrorValue.message : "Workflow template could not be assigned to this job.");
    }
  };

  if (loading) {
    return (
      <section className="shared-job-detail__list-card job-command-center">
        <div className="shared-job-detail__list-card-header">
          <h3>Job Command Center</h3>
        </div>
        <p className="shared-job-sidebar__muted">Loading current workflow state...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="shared-job-detail__list-card job-command-center">
        <div className="shared-job-detail__list-card-header">
          <h3>Job Command Center</h3>
        </div>
        <WorkspaceEmptyState title="Workflow state unavailable" summary={error} compact />
      </section>
    );
  }

  if (!row) {
    return (
      <section className="shared-job-detail__list-card job-command-center">
        <div className="shared-job-detail__list-card-header">
          <h3>Job Command Center</h3>
          <a href="#project-tracking">Open Project Dashboard</a>
        </div>
        <WorkspaceEmptyState
          title="No live job workflow yet"
          summary="This job is the actual shoot/event. Assign a Workflow Template recipe to create the live steps that Project Dashboard and Production Queue will track."
          compact
        />
        <div className="job-command-center__assignment-bridge" aria-label="Assign workflow template">
          <label>
            <span>Workflow Template recipe</span>
            <select
              value={selectedTemplateKey}
              onChange={(event) => setSelectedTemplateKey(event.target.value)}
              disabled={assignState === "loading" || assignState === "saving" || templates.length === 0}
            >
              {templates.length ? (
                templates.map((template) => (
                  <option key={template.id} value={template.template_key}>
                    {template.name}
                  </option>
                ))
              ) : (
                <option value="">No templates available</option>
              )}
            </select>
          </label>
          <button type="button" onClick={() => void assignWorkflowTemplate()} disabled={assignState === "loading" || assignState === "saving" || !selectedTemplateKey}>
            {assignState === "saving" ? "Assigning..." : "Create Live Job Workflow"}
          </button>
          {assignError ? <p className="job-command-center__assignment-error">{assignError}</p> : null}
          <p className="shared-job-sidebar__muted">This copies the protected template recipe into a live workflow for this job; it does not mutate the template.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="shared-job-detail__list-card job-command-center" aria-labelledby="job-command-center-title">
      <div className="shared-job-detail__list-card-header">
        <div>
          <h3 id="job-command-center-title">Job Command Center</h3>
          <p className="shared-job-sidebar__muted">Job = the actual shoot/event. Live Job Workflow = this job moving through the selected recipe.</p>
        </div>
        <div className="job-command-center__actions">
          <a href="#project-tracking">Project Dashboard</a>
          <a href={departmentTarget.href}>{departmentTarget.label}</a>
          {row.workflow_run_id ? <a href={`#project-tracking/workflows/${row.workflow_run_id}`}>Open Live Job Workflow</a> : <span>Workflow not assigned yet</span>}
        </div>
      </div>

      <div className="job-command-center__grid">
        <div>
          <span>Organization / Account</span>
          <strong>{row.organization_name ?? row.account_name ?? "Account not connected yet"}</strong>
        </div>
        <div>
          <span>Job</span>
          <strong>{row.job_title || "Untitled job"}</strong>
        </div>
        <div>
          <span>Job Date</span>
          <strong>{formatDate(row.job_date, "Job date not connected yet")}</strong>
        </div>
        <div>
          <span>Current Step</span>
          <strong>{currentStep?.name ?? (row.workflow_run_id ? "Step unknown" : "No workflow linked")}</strong>
        </div>
        <div>
          <span>Step Department / Team</span>
          <strong>{currentStep?.department ? humanize(currentStep.department) : "Team not set"}</strong>
        </div>
        <div>
          <span>Owner / Assignment</span>
          <strong>{getOwnerLabel(row)}</strong>
        </div>
        <div>
          <span>Next Deadline</span>
          <strong>{formatDateTime(row.next_deadline_at, "Deadline not set")}</strong>
        </div>
        <div>
          <span>Waiting On</span>
          <strong>{getWaitingLabel(row)}</strong>
        </div>
        <div>
          <span>Risk / Blocker</span>
          <strong className={`job-command-center__status job-command-center__status--${getRiskTone(row)}`}>{getRiskLabel(row)}</strong>
        </div>
        <div>
          <span>Related Workflow</span>
          <strong>
            {row.workflow_template_name
              ? `${row.workflow_template_name}${row.workflow_template_version ? ` · ${row.workflow_template_version}` : ""}`
              : "Workflow template not linked"}
          </strong>
        </div>
      </div>

      <div className="job-command-center__sequence" aria-label="Workflow step context">
        <div>
          <span>Previous step</span>
          <strong>{previousStep ? `${previousStep.name} · ${humanize(previousStep.milestone_name)}` : "No previous step available"}</strong>
        </div>
        <div>
          <span>Next step</span>
          <strong>{nextStep ? `${nextStep.name} · ${humanize(nextStep.milestone_name)}` : "No next step available"}</strong>
        </div>
      </div>
      <JobPrepReadinessPanel preview={prepReadiness} />
    </section>
  );
}
