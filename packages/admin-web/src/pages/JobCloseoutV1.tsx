import { FormEvent, useEffect, useState } from "react";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { featureFlags } from "../featureFlags";
import type { JobCloseoutDataIssue, JobCloseoutReportSnapshot, JobCloseoutWorkspace, SubmitJobCloseoutPayload } from "../jobCloseoutTypes";
import {
  createShootCheckInRequests,
  generateOperationsReportSnapshot,
  getJobCloseoutWorkspace,
  listOperationsReportSnapshots,
  respondToShootCheckIn,
  submitJobCloseoutEvaluation
} from "../services/jobCloseoutApi";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type LoadState = "idle" | "loading" | "ready" | "error";
type FormMode = "senior" | "associate";

const DATA_ISSUES: Array<{ value: JobCloseoutDataIssue; label: string }> = [
  { value: "missing_subjects", label: "Missing subjects" },
  { value: "qr_missing_or_would_not_scan", label: "QR missing or would not scan" },
  { value: "qr_sorting_issue", label: "QR sorting issue" },
  { value: "schedule_or_roster_issue", label: "Schedule or roster issue" },
  { value: "other", label: "Other" }
];

function parseJobIdFromHash() {
  const match = window.location.hash.match(/^#job-closeout\/jobs\/([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function pretty(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Not set";
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not scheduled";
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function metric(snapshot: JobCloseoutReportSnapshot | null, key: string) {
  const value = snapshot?.summary_metrics?.[key];
  return value == null ? "0" : String(value);
}

export function JobCloseoutV1({ token, currentUser }: Props) {
  const [jobId, setJobId] = useState(() => parseJobIdFromHash());
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState("");
  const [workspace, setWorkspace] = useState<JobCloseoutWorkspace | null>(null);
  const [dailyReport, setDailyReport] = useState<JobCloseoutReportSnapshot | null>(null);
  const [weeklyReport, setWeeklyReport] = useState<JobCloseoutReportSnapshot | null>(null);
  const [mode, setMode] = useState<FormMode>("senior");
  const [busyAction, setBusyAction] = useState("");

  const [overallStatus, setOverallStatus] = useState<SubmitJobCloseoutPayload["overall_status"]>("smooth");
  const [scheduleStatus, setScheduleStatus] = useState<SubmitJobCloseoutPayload["schedule_status"]>("on_schedule");
  const [scheduleNote, setScheduleNote] = useState("");
  const [staffingStatus, setStaffingStatus] = useState<SubmitJobCloseoutPayload["staffing_status"]>("none");
  const [staffingNote, setStaffingNote] = useState("");
  const [everyoneOnTime, setEveryoneOnTime] = useState(true);
  const [lateName, setLateName] = useState("");
  const [lateMinutes, setLateMinutes] = useState("");
  const [imageScore, setImageScore] = useState(5);
  const [technicalStatus, setTechnicalStatus] = useState<SubmitJobCloseoutPayload["technical_issue_status"]>("none");
  const [technicalNote, setTechnicalNote] = useState("");
  const [retakeRisk, setRetakeRisk] = useState<SubmitJobCloseoutPayload["retake_risk"]>("none");
  const [clientSentiment, setClientSentiment] = useState<SubmitJobCloseoutPayload["client_sentiment"]>("fine");
  const [clientIssueNote, setClientIssueNote] = useState("");
  const [dataIssues, setDataIssues] = useState<JobCloseoutDataIssue[]>([]);
  const [dataIssueNote, setDataIssueNote] = useState("");
  const [shoutout, setShoutout] = useState("");
  const [supportNote, setSupportNote] = useState("");
  const [nextYearNote, setNextYearNote] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [mileageQualified, setMileageQualified] = useState<boolean | null>(null);
  const [mileageReason, setMileageReason] = useState<SubmitJobCloseoutPayload["mileage_disqualification_reason"]>(null);
  const [mileageNote, setMileageNote] = useState("");
  const [associateNote, setAssociateNote] = useState("");

  const refresh = async (nextJobId = jobId) => {
    setError("");
    if (!nextJobId) {
      setLoadState("idle");
      setWorkspace(null);
      const [daily, weekly] = await Promise.all([
        listOperationsReportSnapshots(token, "daily").catch(() => ({ snapshots: [] })),
        listOperationsReportSnapshots(token, "weekly").catch(() => ({ snapshots: [] }))
      ]);
      setDailyReport(daily.snapshots[0] ?? null);
      setWeeklyReport(weekly.snapshots[0] ?? null);
      return;
    }
    setLoadState("loading");
    try {
      const payload = await getJobCloseoutWorkspace(token, nextJobId);
      setWorkspace(payload);
      setLoadState("ready");
    } catch (loadError) {
      setLoadState("error");
      setError(loadError instanceof Error ? loadError.message : "Job Closeout failed to load.");
    }
  };

  useEffect(() => {
    const handleHashChange = () => setJobId(parseJobIdFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    void refresh(jobId);
  }, [jobId, token]);

  const withAction = async (label: string, action: () => Promise<void>) => {
    setBusyAction(label);
    setError("");
    try {
      await action();
      await refresh(jobId);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `${label} failed.`);
    } finally {
      setBusyAction("");
    }
  };

  const toggleDataIssue = (issue: JobCloseoutDataIssue) => {
    setDataIssues((current) => (current.includes(issue) ? current.filter((entry) => entry !== issue) : [...current, issue]));
  };

  const submitEvaluation = (event: FormEvent) => {
    event.preventDefault();
    if (!jobId) {
      setError("Open a specific job before submitting closeout.");
      return;
    }
    const isAssociate = mode === "associate";
    const payload: SubmitJobCloseoutPayload = {
      submitter_role: isAssociate ? "associate" : "shoot_lead",
      evaluation_type: "post_shoot",
      status: "submitted",
      overall_status: overallStatus,
      overall_score: overallStatus === "smooth" ? 5 : overallStatus === "few_bumps" ? 3 : 2,
      schedule_status: isAssociate ? "on_schedule" : scheduleStatus,
      schedule_note: isAssociate ? null : scheduleNote || null,
      staffing_status: isAssociate ? "none" : staffingStatus,
      staffing_note: isAssociate ? null : staffingNote || null,
      all_photographers_on_time: isAssociate ? null : everyoneOnTime,
      late_note: isAssociate || everyoneOnTime ? null : lateName || null,
      image_confidence_score: imageScore,
      technical_issue_status: isAssociate ? "none" : technicalStatus,
      technical_issue_note: isAssociate ? null : technicalNote || null,
      retake_risk: isAssociate ? "none" : retakeRisk,
      client_sentiment: isAssociate ? "fine" : clientSentiment,
      client_issue_flag: !isAssociate && Boolean(clientIssueNote.trim()),
      client_issue_note: isAssociate ? null : clientIssueNote || null,
      data_issue_types: dataIssues,
      data_issue_note: dataIssueNote || null,
      positive_shoutout_note: isAssociate ? null : shoutout || null,
      support_needed_note: isAssociate ? null : supportNote || null,
      next_year_improvement_note: isAssociate ? null : nextYearNote || null,
      mileage_qualified: mileageQualified,
      mileage_note: mileageNote || null,
      mileage_disqualification_reason: mileageQualified === false ? mileageReason : null,
      general_note: isAssociate ? associateNote || null : null,
      late_staff:
        !isAssociate && !everyoneOnTime && lateName.trim()
          ? [
              {
                display_name: lateName.trim(),
                minutes_late: lateMinutes ? Number(lateMinutes) : null,
                reason: staffingNote || null
              }
            ]
          : [],
      attachments: photoUrl.trim()
        ? [
            {
              attachment_type: "setup",
              file_url: photoUrl.trim(),
              filename: "setup-photo-reference"
            }
          ]
        : []
    };
    void withAction("Submit closeout", async () => {
      await submitJobCloseoutEvaluation(token, jobId, payload);
    });
  };

  const createCheckIn = () => {
    if (!jobId) {
      return;
    }
    void withAction("Create check-in", async () => {
      await createShootCheckInRequests(token, jobId);
    });
  };

  const markCheckInGood = (checkInId: string) => {
    if (!jobId) {
      return;
    }
    void withAction("Respond to check-in", async () => {
      await respondToShootCheckIn(token, jobId, checkInId, { status: "good" });
    });
  };

  const markCheckInIssue = (checkInId: string) => {
    if (!jobId) {
      return;
    }
    const note = window.prompt("What's going on? A short note helps leadership support the team.")?.trim();
    if (!note) {
      return;
    }
    void withAction("Report check-in issue", async () => {
      await respondToShootCheckIn(token, jobId, checkInId, { status: "issue", issue_note: note });
    });
  };

  const generateReport = (type: "daily" | "weekly") => {
    void withAction(`Generate ${type} report`, async () => {
      const generated = await generateOperationsReportSnapshot(token, type);
      if (type === "daily") {
        setDailyReport(generated.snapshot);
      } else {
        setWeeklyReport(generated.snapshot);
      }
    });
  };

  if (!featureFlags.jobCloseoutV1) {
    return (
      <main className="job-closeout-page">
        <WorkspacePageHeader
          eyebrow="Feature flag"
          title="Job Closeout V1 is off"
          summary="Set VITE_JOB_CLOSEOUT_V1_ENABLED and JOB_CLOSEOUT_V1_ENABLED to enable the closeout, check-in, mileage, and reporting foundation."
          meta={[{ label: "Disabled", tone: "warning" }]}
        />
      </main>
    );
  }

  const latestEvaluation = workspace?.latest_evaluation ?? null;
  const openFlags = workspace?.flags.filter((flag) => flag.status !== "resolved") ?? [];
  const pendingCheckIn = workspace?.check_ins.find((checkIn) => checkIn.status === "pending") ?? null;

  return (
    <main className="job-closeout-page">
      <WorkspacePageHeader
        eyebrow="Mission Control V1"
        title={workspace ? `Closeout: ${workspace.job.event_name ?? workspace.job.title}` : "Job Closeout + Operations Reporting"}
        summary="Turn every completed job into structured operational intelligence: check-ins, closeout, mileage review, flags, daily reports, weekly trends, and future pre-shoot briefs."
        meta={[
          { label: workspace ? pretty(workspace.job.department_type) : "Operations backbone", tone: "info" },
          { label: workspace?.rules.timezone ?? "America/Chicago", tone: "neutral" },
          { label: workspace?.permissions.can_view_sensitive ? "Sensitive trends visible" : "Sensitive trends protected", tone: "warning" }
        ]}
        actions={
          <div className="job-closeout-actions">
            <button type="button" onClick={() => void refresh(jobId)} disabled={Boolean(busyAction)}>
              Refresh
            </button>
            <button type="button" onClick={() => generateReport("daily")} disabled={Boolean(busyAction)}>
              Generate daily report
            </button>
            <button type="button" onClick={() => generateReport("weekly")} disabled={Boolean(busyAction)}>
              Generate weekly report
            </button>
          </div>
        }
      />

      {error ? <div className="error-banner">{error}</div> : null}
      {busyAction ? <div className="info-banner">{busyAction}...</div> : null}

      {!jobId ? (
        <section className="job-closeout-grid">
          <ReportPulseCard title="Latest daily pulse" snapshot={dailyReport} />
          <ReportPulseCard title="Latest weekly leadership rollup" snapshot={weeklyReport} />
          <section className="panel job-closeout-card">
            <h3>Open from a job</h3>
            <p>
              Use <code>#job-closeout/jobs/&lt;job-id&gt;</code> from a canonical job detail page to submit a closeout, answer a check-in,
              review mileage, and see account history.
            </p>
            <p className="muted">The foundation is tied to jobs, accounts, assignments, watch flags, and report snapshots. No duplicate client or job system is created.</p>
          </section>
        </section>
      ) : loadState === "loading" ? (
        <WorkspaceLoadingBlock title="Loading job closeout" summary="Gathering evaluations, check-ins, flags, mileage review, and pre-shoot history." />
      ) : workspace ? (
        <>
          <section className="job-closeout-grid job-closeout-grid--hero">
            <section className="panel job-closeout-card">
              <div className="job-closeout-card__heading">
                <h3>Job pulse</h3>
                <span>{formatDate(workspace.job.scheduled_start_at)}</span>
              </div>
              <dl className="job-closeout-metrics">
                <div>
                  <dt>Account</dt>
                  <dd>{workspace.job.organization_name ?? "No account linked"}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>{workspace.job.location_name ?? "No location linked"}</dd>
                </div>
                <div>
                  <dt>Closeout</dt>
                  <dd>{latestEvaluation ? pretty(latestEvaluation.overall_status) : "Not submitted"}</dd>
                </div>
                <div>
                  <dt>Open flags</dt>
                  <dd>{openFlags.length}</dd>
                </div>
              </dl>
            </section>

            <section className="panel job-closeout-card">
              <div className="job-closeout-card__heading">
                <h3>Shoot check-in</h3>
                <span>{workspace.rules.check_in_offset_minutes} min after start</span>
              </div>
              <button type="button" onClick={createCheckIn} disabled={!workspace.permissions.can_submit || Boolean(busyAction)}>
                Request lead check-in
              </button>
              {workspace.check_ins.length ? (
                <div className="job-closeout-list">
                  {workspace.check_ins.map((checkIn) => (
                    <div key={checkIn.id} className="job-closeout-list-row">
                      <div>
                        <strong>{checkIn.requested_for_name ?? "Shoot lead"}</strong>
                        <span>
                          {pretty(checkIn.status)} by {formatDate(checkIn.due_at)}
                        </span>
                        {checkIn.issue_note ? <small>{checkIn.issue_note}</small> : null}
                      </div>
                      {checkIn.status === "pending" ? (
                        <div className="job-closeout-row-actions">
                          <button type="button" onClick={() => markCheckInGood(checkIn.id)}>
                            We are good
                          </button>
                          <button type="button" onClick={() => markCheckInIssue(checkIn.id)}>
                            Issue
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">No check-in has been requested yet.</p>
              )}
              {pendingCheckIn ? <p className="job-closeout-soft-note">This is support-oriented: missed or issue check-ins alert leadership so they can help during the shoot.</p> : null}
            </section>
          </section>

          <section className="job-closeout-layout">
            <form className="panel job-closeout-form" onSubmit={submitEvaluation}>
              <div className="job-closeout-card__heading">
                <div>
                  <h3>Post-shoot closeout</h3>
                  <p>{mode === "senior" ? "Full shoot lead version, designed for about two minutes on a phone." : "Associate version, designed for 30 to 45 seconds."}</p>
                </div>
                <div className="job-closeout-segmented" role="group" aria-label="Closeout mode">
                  <button type="button" className={mode === "senior" ? "is-active" : ""} onClick={() => setMode("senior")}>
                    Senior / lead
                  </button>
                  <button type="button" className={mode === "associate" ? "is-active" : ""} onClick={() => setMode("associate")}>
                    Associate
                  </button>
                </div>
              </div>

              <fieldset>
                <legend>Quick snapshot</legend>
                <label>
                  How did the day go?
                  <select value={overallStatus} onChange={(event) => setOverallStatus(event.target.value as SubmitJobCloseoutPayload["overall_status"])}>
                    <option value="smooth">Smooth</option>
                    <option value="few_bumps">A few bumps</option>
                    <option value="rough">Rough</option>
                  </select>
                </label>
                {mode === "senior" ? (
                  <>
                    <label>
                      Did we stay on schedule?
                      <select value={scheduleStatus ?? "on_schedule"} onChange={(event) => setScheduleStatus(event.target.value as SubmitJobCloseoutPayload["schedule_status"])}>
                        <option value="on_schedule">Yes</option>
                        <option value="slight_delays">Slight delays</option>
                        <option value="major_delays">Major delays</option>
                      </select>
                    </label>
                    <label>
                      What caused it?
                      <textarea value={scheduleNote} onChange={(event) => setScheduleNote(event.target.value)} placeholder="One sentence is plenty." />
                    </label>
                    <label>
                      Any staffing issues?
                      <select value={staffingStatus ?? "none"} onChange={(event) => setStaffingStatus(event.target.value as SubmitJobCloseoutPayload["staffing_status"])}>
                        <option value="none">None</option>
                        <option value="minor">Minor</option>
                        <option value="major">Major</option>
                      </select>
                    </label>
                    <label>
                      What happened?
                      <textarea value={staffingNote} onChange={(event) => setStaffingNote(event.target.value)} />
                    </label>
                    <label className="job-closeout-check">
                      <input type="checkbox" checked={everyoneOnTime} onChange={(event) => setEveryoneOnTime(event.target.checked)} />
                      Everyone was on time
                    </label>
                    {!everyoneOnTime ? (
                      <div className="job-closeout-inline-fields">
                        <label>
                          Who was late?
                          <input value={lateName} onChange={(event) => setLateName(event.target.value)} />
                        </label>
                        <label>
                          About how many minutes?
                          <input type="number" min="0" value={lateMinutes} onChange={(event) => setLateMinutes(event.target.value)} />
                        </label>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </fieldset>

              <fieldset>
                <legend>Image confidence</legend>
                <label>
                  How do you feel about the images?
                  <input type="range" min="1" max="5" value={imageScore} onChange={(event) => setImageScore(Number(event.target.value))} />
                  <span className="job-closeout-score">{imageScore}/5</span>
                </label>
                {mode === "senior" ? (
                  <>
                    <label>
                      Any technical issues?
                      <select value={technicalStatus ?? "none"} onChange={(event) => setTechnicalStatus(event.target.value as SubmitJobCloseoutPayload["technical_issue_status"])}>
                        <option value="none">None</option>
                        <option value="minor">Minor</option>
                        <option value="major">Major</option>
                      </select>
                    </label>
                    <label>
                      Quick note
                      <textarea value={technicalNote} onChange={(event) => setTechnicalNote(event.target.value)} />
                    </label>
                    <label>
                      Any retake risk?
                      <select value={retakeRisk ?? "none"} onChange={(event) => setRetakeRisk(event.target.value as SubmitJobCloseoutPayload["retake_risk"])}>
                        <option value="none">None</option>
                        <option value="possible">Possible</option>
                        <option value="likely">Likely</option>
                      </select>
                    </label>
                  </>
                ) : null}
              </fieldset>

              {mode === "senior" ? (
                <fieldset>
                  <legend>Client experience</legend>
                  <label>
                    How did the client feel today, from your read?
                    <select value={clientSentiment ?? "fine"} onChange={(event) => setClientSentiment(event.target.value as SubmitJobCloseoutPayload["client_sentiment"])}>
                      <option value="very_happy">Very happy</option>
                      <option value="fine">Fine</option>
                      <option value="frustrated">Frustrated</option>
                    </select>
                  </label>
                  <label>
                    Any issues or awkward moments?
                    <textarea value={clientIssueNote} onChange={(event) => setClientIssueNote(event.target.value)} placeholder="What happened?" />
                  </label>
                </fieldset>
              ) : null}

              <fieldset>
                <legend>Data check</legend>
                <div className="job-closeout-checkbox-grid">
                  {DATA_ISSUES.map((issue) => (
                    <label key={issue.value} className="job-closeout-check">
                      <input type="checkbox" checked={dataIssues.includes(issue.value)} onChange={() => toggleDataIssue(issue.value)} />
                      {issue.label}
                    </label>
                  ))}
                </div>
                <label>
                  What happened?
                  <textarea value={dataIssueNote} onChange={(event) => setDataIssueNote(event.target.value)} placeholder="Use subjects, not students." />
                </label>
              </fieldset>

              {mode === "senior" ? (
                <>
                  <fieldset>
                    <legend>Team notes</legend>
                    <label>
                      Anyone who crushed it?
                      <textarea value={shoutout} onChange={(event) => setShoutout(event.target.value)} />
                    </label>
                    <label>
                      Anyone who needs support or follow-up?
                      <textarea value={supportNote} onChange={(event) => setSupportNote(event.target.value)} />
                    </label>
                  </fieldset>
                  <fieldset className="job-closeout-next-year">
                    <legend>Next year</legend>
                    <label>
                      What should we do better next year?
                      <textarea value={nextYearNote} onChange={(event) => setNextYearNote(event.target.value)} placeholder="This feeds account history and future pre-shoot briefs." />
                    </label>
                  </fieldset>
                  <fieldset>
                    <legend>Photos</legend>
                    <label>
                      Want to add setup/location photos?
                      <input value={photoUrl} onChange={(event) => setPhotoUrl(event.target.value)} placeholder="Optional URL/storage reference for v1" />
                    </label>
                    <p className="job-closeout-soft-note">Totally optional, but this helps the next team a ton. You can still submit without it.</p>
                  </fieldset>
                </>
              ) : (
                <fieldset>
                  <legend>Anything we should know?</legend>
                  <textarea value={associateNote} onChange={(event) => setAssociateNote(event.target.value)} />
                </fieldset>
              )}

              <fieldset>
                <legend>Mileage</legend>
                <label>
                  Do you qualify for mileage for this job?
                  <select
                    value={mileageQualified == null ? "" : mileageQualified ? "yes" : "no"}
                    onChange={(event) => setMileageQualified(event.target.value === "" ? null : event.target.value === "yes")}
                  >
                    <option value="">Choose...</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <p className="job-closeout-soft-note">Only say yes if you personally drove and qualify. The office calculates the amount from the job zone.</p>
                {mileageQualified === false ? (
                  <label>
                    Reason
                    <select value={mileageReason ?? ""} onChange={(event) => setMileageReason((event.target.value || null) as SubmitJobCloseoutPayload["mileage_disqualification_reason"])}>
                      <option value="">Choose...</option>
                      <option value="company_vehicle">Company vehicle</option>
                      <option value="carpool">Carpool</option>
                      <option value="did_not_drive">Did not drive</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                ) : null}
                <label>
                  Anything we should know about mileage?
                  <textarea value={mileageNote} onChange={(event) => setMileageNote(event.target.value)} />
                </label>
              </fieldset>

              <button type="submit" className="primary-action" disabled={!workspace.permissions.can_submit || Boolean(busyAction)}>
                Submit closeout
              </button>
            </form>

            <aside className="job-closeout-side">
              <section className="panel job-closeout-card">
                <h3>Pre-shoot brief</h3>
                <p className="muted">Future-ready briefing from prior closeouts, account history, next-year notes, and a customer survey placeholder.</p>
                <div className="job-closeout-list">
                  {workspace.pre_shoot_brief.prior_next_year_notes.slice(0, 4).map((note, index) => (
                    <div key={`${note}-${index}`} className="job-closeout-list-row">
                      <strong>Next-year note</strong>
                      <span>{note}</span>
                    </div>
                  ))}
                  {workspace.pre_shoot_brief.prior_data_issues.slice(0, 6).map((issue, index) => (
                    <div key={`${issue}-${index}`} className="job-closeout-list-row">
                      <strong>Prior data issue</strong>
                      <span>{pretty(issue)}</span>
                    </div>
                  ))}
                  {!workspace.pre_shoot_brief.prior_next_year_notes.length && !workspace.pre_shoot_brief.prior_data_issues.length ? (
                    <p className="muted">No prior closeout intelligence yet. Today's closeout starts the account memory.</p>
                  ) : null}
                </div>
                <p className="job-closeout-soft-note">Customer survey summary: {pretty(workspace.pre_shoot_brief.customer_survey_summary_status)}</p>
              </section>

              <section className="panel job-closeout-card">
                <h3>Flags / exceptions</h3>
                <div className="job-closeout-list">
                  {openFlags.length ? (
                    openFlags.map((flag) => (
                      <div key={flag.id} className={`job-closeout-flag job-closeout-flag--${flag.severity}`}>
                        <strong>{flag.title}</strong>
                        <span>{pretty(flag.flag_type)} - {pretty(flag.severity)} - {flag.assigned_team ?? "Unassigned"}</span>
                        <small>{flag.description}</small>
                      </div>
                    ))
                  ) : (
                    <p className="muted">No active closeout flags for this job.</p>
                  )}
                </div>
              </section>

              <section className="panel job-closeout-card">
                <h3>Mileage review</h3>
                <div className="job-closeout-list">
                  {workspace.mileage_reviews.length ? (
                    workspace.mileage_reviews.map((review) => (
                      <div key={review.id} className="job-closeout-list-row">
                        <strong>{pretty(review.status)}</strong>
                        <span>{review.zone_name ?? "Zone needs review"} - {review.calculated_amount ?? "No amount yet"}</span>
                      </div>
                    ))
                  ) : (
                    <p className="muted">No mileage review record yet.</p>
                  )}
                </div>
              </section>
            </aside>
          </section>
        </>
      ) : loadState === "error" ? (
        <WorkspaceLoadingBlock title="Closeout unavailable" summary={error || "This job closeout could not be opened."} />
      ) : null}

      <p className="job-closeout-footer-note">
        Signed in as {currentUser.fullName ?? currentUser.email}. Personnel trends and payroll queues stay permission-protected.
      </p>
    </main>
  );
}

function ReportPulseCard({ title, snapshot }: { title: string; snapshot: JobCloseoutReportSnapshot | null }) {
  return (
    <section className="panel job-closeout-card">
      <div className="job-closeout-card__heading">
        <h3>{title}</h3>
        <span>{snapshot ? formatDate(snapshot.period_start) : "No snapshot yet"}</span>
      </div>
      <dl className="job-closeout-metrics">
        <div>
          <dt>Jobs</dt>
          <dd>{metric(snapshot, "jobs_completed")}</dd>
        </div>
        <div>
          <dt>Smooth</dt>
          <dd>{metric(snapshot, "smooth_count")}</dd>
        </div>
        <div>
          <dt>Urgent</dt>
          <dd>{metric(snapshot, "urgent_flag_count")}</dd>
        </div>
        <div>
          <dt>Mileage</dt>
          <dd>{metric(snapshot, "mileage_qualified_count")}</dd>
        </div>
      </dl>
    </section>
  );
}
