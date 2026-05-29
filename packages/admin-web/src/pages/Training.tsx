import { useEffect, useMemo, useState } from "react";
import { TrainingReadinessBadge } from "../components/TrainingReadinessBadge";
import {
  createTrainingQuizRound,
  getTrainingCatalog,
  getTrainingDashboardSnapshot,
  listTrainingProfiles,
  submitTrainingQuizRound,
  updateTrainingManagerSignoff
} from "../services/trainingApi";
import type {
  EmployeeTrainingProfile,
  SessionUser,
  TrainingCatalogResponse,
  TrainingDashboardSnapshot,
  TrainingEmployeeSummary,
  TrainingModule,
  TrainingQuizQuestion,
  TrainingQuizRound,
  TrainingReadinessState
} from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type FilterState = {
  search: string;
  team: string;
  role: string;
  readiness: "all" | TrainingReadinessState;
};

type ActiveQuizState = {
  round: TrainingQuizRound;
  questions: TrainingQuizQuestion[];
  answers: Record<string, string>;
  result: {
    attempt: EmployeeTrainingProfile["quiz_history"][number];
    questions: TrainingQuizQuestion[];
  } | null;
};

const defaultFilters: FilterState = {
  search: "",
  team: "all",
  role: "all",
  readiness: "all"
};

const emptyTrainingCatalog: TrainingCatalogResponse = {
  workbook: {
    id: "training-catalog-loading",
    title: "Training Catalog",
    summary: "",
    version: "loading",
    updated_at: "",
    sections: []
  },
  modules: [],
  acknowledgements: []
};

export function Training({ token, currentUser }: Props) {
  const [catalog, setCatalog] = useState<TrainingCatalogResponse>(emptyTrainingCatalog);
  const workbook = catalog.workbook;
  const modules = catalog.modules;
  const acknowledgements = catalog.acknowledgements;
  const moduleIndex = useMemo(() => new Map(modules.map((module) => [module.id, module])), [modules]);
  const [profiles, setProfiles] = useState<EmployeeTrainingProfile[]>([]);
  const [snapshot, setSnapshot] = useState<TrainingDashboardSnapshot | null>(null);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [activeQuiz, setActiveQuiz] = useState<ActiveQuizState | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [catalogNotice, setCatalogNotice] = useState("");
  const [quizWorking, setQuizWorking] = useState(false);
  const [signoffWorking, setSignoffWorking] = useState(false);

  const canManageSignoff = currentUser.roles.some((role) => ["owner_admin", "admin", "leadership"].includes(role));

  const selectedProfile = useMemo(() => {
    return profiles.find((profile) => profile.employee.id === selectedEmployeeId) ?? profiles[0] ?? null;
  }, [profiles, selectedEmployeeId]);

  const selectedModule = useMemo<TrainingModule | null>(() => {
    if (!selectedModuleId) {
      return null;
    }
    return modules.find((module) => module.id === selectedModuleId) ?? null;
  }, [modules, selectedModuleId]);

  const filteredProfiles = useMemo(() => {
    return profiles.filter((profile) => {
      const haystack = `${profile.employee.full_name} ${profile.employee.email} ${profile.assigned_learning_path}`.toLowerCase();
      const matchesSearch = haystack.includes(filters.search.trim().toLowerCase());
      const matchesTeam = filters.team === "all" || profile.employee.department === filters.team;
      const matchesRole = filters.role === "all" || profile.employee.roles.includes(filters.role);
      const matchesReadiness = filters.readiness === "all" || profile.readiness_state === filters.readiness;
      return matchesSearch && matchesTeam && matchesRole && matchesReadiness;
    });
  }, [filters, profiles]);

  const employeeSummaries = useMemo(
    () => filteredProfiles.map((profile) => buildTrainingSummary(profile, moduleIndex)),
    [filteredProfiles, moduleIndex]
  );
  const recommendedModuleId = selectedProfile ? pickRecommendedModule(selectedProfile)?.module_id ?? selectedProfile.modules[0]?.module_id ?? "" : "";
  const teams = [...new Set(profiles.map((profile) => profile.employee.department))];
  const roles = [...new Set(profiles.flatMap((profile) => profile.employee.roles))];
  const selectedModuleProgress = selectedProfile?.modules.find((module) => module.module_id === selectedModule?.id) ?? null;
  const selectedSection = selectedModule ? workbook.sections.find((section) => section.id === selectedModule.section_id) : null;
  const selectedCheckpointResults =
    selectedModule?.checkpoint_ids
      .map((checkpointId) => selectedProfile?.checkpoints.find((checkpoint) => checkpoint.checkpoint_id === checkpointId))
      .filter(Boolean) ?? [];
  const selectedAcknowledgements =
    selectedModule?.acknowledgement_ids
      .map((acknowledgementId) => {
        const definition = acknowledgements.find((ack) => ack.id === acknowledgementId);
        const state = selectedProfile?.acknowledgements.find((ack) => ack.acknowledgement_id === acknowledgementId);
        return definition ? { definition, state } : null;
      })
      .filter(Boolean) ?? [];

  useEffect(() => {
    void loadTraining();
  }, [token]);

  useEffect(() => {
    if (!selectedProfile) {
      return;
    }
    const hasModule = selectedProfile.modules.some((module) => module.module_id === selectedModuleId);
    if (!hasModule) {
      setSelectedModuleId(recommendedModuleId);
    }
  }, [recommendedModuleId, selectedModuleId, selectedProfile]);

  useEffect(() => {
    syncFromHash();
    const onHashChange = () => syncFromHash();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [modules, profiles]);

  useEffect(() => {
    if (!selectedProfile) {
      return;
    }
    syncHash(selectedProfile.employee.email, selectedModuleId || recommendedModuleId || null);
  }, [recommendedModuleId, selectedModuleId, selectedProfile]);

  async function loadTraining() {
    setLoading(true);
    try {
      const [profileRows, dashboardSnapshot, catalogResponse] = await Promise.all([
        listTrainingProfiles(token),
        getTrainingDashboardSnapshot(token),
        getTrainingCatalog(token)
      ]);
      setCatalog(catalogResponse);
      setProfiles(profileRows);
      setSnapshot(dashboardSnapshot);
      setCatalogNotice(
        catalogResponse.modules.some((module) => module.content_blocks.length)
          ? ""
          : "The durable training catalog is live, but richer SOP and playbook blocks are still being migrated into it."
      );
      setSelectedEmployeeId((current) => {
        if (current && profileRows.some((profile) => profile.employee.id === current)) {
          return current;
        }
        const fromHash = getProfileFromHash(profileRows);
        if (fromHash) {
          return fromHash.employee.id;
        }
        return profileRows.find((profile) => profile.employee.email.toLowerCase() === currentUser.email.toLowerCase())?.employee.id ?? profileRows[0]?.employee.id ?? "";
      });
      setSelectedModuleId((current) => {
        if (current && catalogResponse.modules.some((module) => module.id === current)) {
          return current;
        }
        const hashModule = getTrainingHashParams().module;
        if (hashModule && catalogResponse.modules.some((module) => module.id === hashModule)) {
          return hashModule;
        }
        const initialProfile =
          getProfileFromHash(profileRows) ??
          profileRows.find((profile) => profile.employee.email.toLowerCase() === currentUser.email.toLowerCase()) ??
          profileRows[0];
        return pickRecommendedModule(initialProfile)?.module_id ?? initialProfile?.modules[0]?.module_id ?? "";
      });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load the training workspace right now.");
    } finally {
      setLoading(false);
    }
  }

  function syncFromHash() {
    if (!profiles.length) {
      return;
    }
    const params = getTrainingHashParams();
    if (params.employee) {
      const profile = profiles.find((entry) => entry.employee.email.toLowerCase() === params.employee?.toLowerCase());
      if (profile) {
        setSelectedEmployeeId(profile.employee.id);
      }
    }
    if (params.module && modules.some((module) => module.id === params.module)) {
      setSelectedModuleId(params.module);
    }
  }

  function selectEmployee(profile: EmployeeTrainingProfile) {
    setSelectedEmployeeId(profile.employee.id);
    setSelectedModuleId(pickRecommendedModule(profile)?.module_id ?? profile.modules[0]?.module_id ?? "");
    setActiveQuiz(null);
    setNotice("");
    setError("");
  }

  async function launchChallenge(mode: TrainingQuizRound["mode"], moduleId?: string | null, retryQuestionIds?: string[]) {
    if (!selectedProfile) {
      return;
    }
    setQuizWorking(true);
    setError("");
    setNotice("");
    try {
      const response = await createTrainingQuizRound(token, {
        employeeId: selectedProfile.employee.id,
        moduleId: moduleId ?? null,
        mode,
        questionIds: retryQuestionIds
      });
      setActiveQuiz({
        round: response.round,
        questions: response.questions,
        answers: {},
        result: null
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't start a quiz round.");
    } finally {
      setQuizWorking(false);
    }
  }

  async function submitChallenge() {
    if (!selectedProfile || !activeQuiz) {
      return;
    }
    setQuizWorking(true);
    setError("");
    setNotice("");
    try {
      const response = await submitTrainingQuizRound(token, {
        employeeId: selectedProfile.employee.id,
        round: activeQuiz.round,
        answers: activeQuiz.answers
      });
      setActiveQuiz((current) =>
        current
          ? {
              ...current,
              questions: response.questions,
              result: {
                attempt: response.attempt,
                questions: response.questions
              }
            }
          : current
      );
      setProfiles((current) =>
        current.map((profile) => (profile.employee.id === response.profile.employee.id ? response.profile : profile))
      );
      setSnapshot(await getTrainingDashboardSnapshot(token));
      setNotice(
        response.attempt.passed
          ? "Picture Day Challenge passed. Readiness progress has been updated."
          : "Challenge submitted. Review the missed questions before retrying."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't submit that quiz round.");
    } finally {
      setQuizWorking(false);
    }
  }

  async function toggleManagerSignoff() {
    if (!selectedProfile || !canManageSignoff) {
      return;
    }
    setSignoffWorking(true);
    setError("");
    setNotice("");
    try {
      const nextStatus = selectedProfile.manager_signoff_status === "complete" ? "pending" : "complete";
      const updated = await updateTrainingManagerSignoff(token, selectedProfile.employee.id, nextStatus);
      setProfiles((current) =>
        current.map((profile) => (profile.employee.id === updated.employee.id ? updated : profile))
      );
      setSnapshot(await getTrainingDashboardSnapshot(token));
      setNotice(nextStatus === "complete" ? "Manager sign-off completed." : "Manager sign-off moved back to pending.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't update manager sign-off.");
    } finally {
      setSignoffWorking(false);
    }
  }

  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">Training</div>
          <h2>School Photographer Workbook</h2>
          <p>Operational training, readiness visibility, and Picture Day Challenge rounds built for onboarding and field confidence, not a generic LMS.</p>
        </div>
        <div className="page-intro-actions">
          <div className="metric-pill">Training owner: {currentUser.fullName}</div>
          <button className="secondary-button" onClick={() => setFilters(defaultFilters)}>
            Clear Filters
          </button>
          <button className="primary-button" disabled={!selectedProfile || quizWorking} onClick={() => void launchChallenge("dashboard", recommendedModuleId)}>
            {quizWorking ? "Starting..." : "Launch Picture Day Challenge"}
          </button>
        </div>
      </section>

      <section className="panel access-panel">
        <div className="section-title">Training Filters</div>
        <p className="section-subtitle">Filter readiness by employee, team, role, or state without losing sight of who is safe to staff on the next school day.</p>
        <div className="access-filter-grid">
          <label className="filter-field">
            <span>Employee</span>
            <input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search employee or learning path" />
          </label>
          <label className="filter-field">
            <span>Team</span>
            <select value={filters.team} onChange={(event) => setFilters((current) => ({ ...current, team: event.target.value }))}>
              <option value="all">All Teams</option>
              {teams.map((team) => (
                <option key={team} value={team}>
                  {humanizeLabel(team)}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Role</span>
            <select value={filters.role} onChange={(event) => setFilters((current) => ({ ...current, role: event.target.value }))}>
              <option value="all">All Roles</option>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {humanizeLabel(role)}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Status</span>
            <select
              value={filters.readiness}
              onChange={(event) => setFilters((current) => ({ ...current, readiness: event.target.value as FilterState["readiness"] }))}
            >
              <option value="all">All Readiness States</option>
              <option value="cleared">Cleared</option>
              <option value="cleared_with_oversight">Cleared With Oversight</option>
              <option value="not_cleared">Not Cleared</option>
              <option value="retraining_required">Retraining Required</option>
            </select>
          </label>
        </div>
      </section>

      {loading ? (
        <section className="panel loading-panel">
          <div className="section-title">Loading training</div>
          <p className="section-subtitle">Pulling workbook progress, quiz history, acknowledgements, and readiness state from Mission Control.</p>
        </section>
      ) : null}
      {notice ? <div className="live-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      {catalogNotice ? <div className="feedback-strip feedback-strip--warning">{catalogNotice}</div> : null}

      <section className="metrics-grid">
        <article className="stat-card panel">
          <div className="eyebrow">Org Completion</div>
          <strong>{snapshot?.org_completion_percent ?? 0}%</strong>
          <span className="muted">{snapshot?.required_completion_percent ?? 0}% required | {snapshot?.optional_completion_percent ?? 0}% optional</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Overdue Modules</div>
          <strong>{snapshot?.overdue_module_count ?? 0}</strong>
          <span className="muted">Overdue work stays visible so staffing decisions do not rely on tribal knowledge.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Not Cleared</div>
          <strong>{snapshot?.not_cleared_count ?? 0}</strong>
          <span className="muted">Employees who should not be staffed on a school shoot without more readiness work.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Oversight Only</div>
          <strong>{snapshot?.oversight_count ?? 0}</strong>
          <span className="muted">Ready to work with a senior or leadership eye still on the day.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Retraining Required</div>
          <strong>{snapshot?.retraining_required_count ?? 0}</strong>
          <span className="muted">Requires a reset before the next field assignment.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">New Hires In Onboarding</div>
          <strong>{snapshot?.new_hires_in_onboarding ?? 0}</strong>
          <span className="muted">Use this as the leadership watch count for week-one readiness.</span>
        </article>
      </section>

      <section className="training-layout">
        <div className="training-stack">
          <section className="panel dashboard-panel">
            <div className="section-title">Training Dashboard</div>
            <p className="section-subtitle">A fast operational read on who is ready, who still needs oversight, and where the workbook is stalling.</p>
            <div className="training-overview-grid">
              <article className="request-card">
                <strong>Employees Not Cleared For School Shoots</strong>
                <div className="muted">
                  {employeeSummaries.filter((summary) => summary.readiness_state !== "cleared").length
                    ? `${employeeSummaries.filter((summary) => summary.readiness_state !== "cleared").length} employees need readiness attention before the next picture day.`
                    : "Everyone in the filtered view is currently cleared."}
                </div>
                <div className="training-inline-list">
                  {employeeSummaries
                    .filter((summary) => summary.readiness_state !== "cleared")
                    .slice(0, 4)
                    .map((summary) => {
                      const profile = filteredProfiles.find((entry) => entry.employee.id === summary.identity.id);
                      return (
                        <button key={summary.identity.email} className="training-inline-chip" onClick={() => profile && selectEmployee(profile)}>
                          {summary.identity.full_name}
                        </button>
                      );
                    })}
                </div>
              </article>
              <article className="request-card">
                <strong>Workbook Completion By Team</strong>
                <div className="training-team-list">
                  {(snapshot?.completion_by_team ?? []).map((team) => (
                    <div key={team.team} className="training-team-row">
                      <span>{humanizeLabel(team.team)}</span>
                      <strong>{team.completion_percent}%</strong>
                      <span className="muted">{team.cleared_count}/{team.total_count} cleared</span>
                    </div>
                  ))}
                </div>
              </article>
              <article className="request-card">
                <strong>Recently Completed Training</strong>
                <div className="training-activity-list">
                  {(snapshot?.recent_completions ?? []).map((entry) => (
                    <div key={`${entry.employee_name}-${entry.module_title}`} className="training-activity-row">
                      <span>{entry.employee_name}</span>
                      <strong>{entry.module_title}</strong>
                      <span className="muted">{new Date(entry.completed_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              </article>
              <article className="request-card">
                <strong>Recent Quiz Scores</strong>
                <div className="training-activity-list">
                  {(snapshot?.recent_quiz_scores ?? []).map((entry) => (
                    <div key={`${entry.employee_name}-${entry.played_at}`} className="training-activity-row">
                      <span>{entry.employee_name}</span>
                      <strong>{entry.score_percent}%</strong>
                      <span className="muted">{new Date(entry.played_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              </article>
              <article className="request-card">
                <strong>Most Overdue Modules</strong>
                <div className="training-activity-list">
                  {(snapshot?.most_overdue_modules ?? []).map((entry) => (
                    <div key={`${entry.employee_name}-${entry.module_title}`} className="training-activity-row">
                      <span>{entry.employee_name}</span>
                      <strong>{entry.module_title}</strong>
                      <span className="muted">Due {new Date(entry.due_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              </article>
              <article className="request-card">
                <strong>Recent Sign-Offs</strong>
                <div className="training-activity-list">
                  {(snapshot?.recent_signoffs ?? []).map((entry) => (
                    <div key={`${entry.employee_name}-${entry.module_title}-${entry.signed_off_at}`} className="training-activity-row">
                      <span>{entry.employee_name}</span>
                      <strong>{entry.module_title}</strong>
                      <span className="muted">{entry.signed_off_by}</span>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </section>

          <section className="panel dashboard-panel">
            <div className="section-title">Readiness Directory</div>
            <p className="section-subtitle">Choose an employee to open the full training profile, quiz history, checkpoints, and manager sign-off state.</p>
            <div className="training-employee-grid">
              {employeeSummaries.map((summary) => (
                <article
                  key={summary.identity.email}
                  className={`training-employee-card${selectedProfile?.employee.email === summary.identity.email ? " training-employee-card--selected" : ""}`}
                  onClick={() => {
                    const profile = filteredProfiles.find((entry) => entry.employee.id === summary.identity.id);
                    if (profile) {
                      selectEmployee(profile);
                    }
                  }}
                >
                  <div className="training-employee-card__header">
                    <div>
                      <strong>{summary.identity.full_name}</strong>
                      <div className="muted">{summary.onboarding_stage}</div>
                    </div>
                    <TrainingReadinessBadge state={summary.readiness_state} compact />
                  </div>
                  <div className="training-employee-card__meta">
                    <span className="meta-pill">{humanizeLabel(summary.identity.department)}</span>
                    <span className="meta-pill">{summary.required_progress_percent}% required complete</span>
                    {summary.needs_signoff ? <span className="meta-pill">Needs sign-off</span> : null}
                  </div>
                  <div className="training-progress">
                    <div className="training-progress__bar">
                      <span style={{ width: `${summary.workbook_progress_percent}%` }} />
                    </div>
                    <div className="muted">{summary.next_module_title}</div>
                  </div>
                </article>
              ))}
              {!employeeSummaries.length ? <div className="empty-state">No employees matched those training filters.</div> : null}
            </div>
          </section>

          {selectedProfile ? (
            <section className="panel dashboard-panel">
              <div className="dashboard-panel__header">
                <div>
                  <div className="section-title">Employee Training Profile</div>
                  <p className="section-subtitle">Workbook progress, quiz history, acknowledgements, and the readiness signal leadership should see before staffing a school shoot.</p>
                </div>
                <div className="page-intro-actions">
                  <TrainingReadinessBadge state={selectedProfile.readiness_state} />
                  <button className="secondary-button" disabled={quizWorking} onClick={() => void launchChallenge("profile", recommendedModuleId)}>
                    {quizWorking ? "Starting..." : "Play Next Round"}
                  </button>
                </div>
              </div>

              <div className="training-profile-header">
                <div>
                  <div className="eyebrow">{selectedProfile.assigned_learning_path}</div>
                  <strong>{selectedProfile.employee.full_name}</strong>
                  <div className="muted">{selectedProfile.employee.email} | {humanizeLabel(selectedProfile.employee.department)}</div>
                </div>
                <div className="training-profile-header__pills">
                  <span className="metric-pill">{selectedProfile.onboarding_stage}</span>
                  <span className="metric-pill">{selectedProfile.workbook_progress_percent}% workbook complete</span>
                  <span className="metric-pill">{selectedProfile.quiz_history[0]?.score_percent ?? 0}% best recent score</span>
                </div>
              </div>

              <div className="detail-two-column">
                <div className="request-card">
                  <strong>Readiness</strong>
                  <div className="muted">{selectedProfile.readiness_note}</div>
                  {selectedProfile.oversight_note ? <div className="muted">{selectedProfile.oversight_note}</div> : null}
                </div>
                <div className="request-card">
                  <strong>Manager Sign-Off</strong>
                  <div className="muted">
                    {selectedProfile.manager_signoff_status === "complete"
                      ? "Field sign-off is complete."
                      : "Manager sign-off stays visible as a readiness checkpoint in this MVP pass."}
                  </div>
                  <button className="secondary-button" disabled={!canManageSignoff || signoffWorking} onClick={() => void toggleManagerSignoff()}>
                    {signoffWorking
                      ? "Saving..."
                      : selectedProfile.manager_signoff_status === "complete"
                        ? "Mark Pending"
                        : canManageSignoff
                          ? "Complete Sign-Off"
                          : "Leadership Sign-Off Required"}
                  </button>
                </div>
              </div>

              <div className="training-module-list">
                {selectedProfile.modules.map((moduleProgress) => {
                  const module = modules.find((entry) => entry.id === moduleProgress.module_id);
                  if (!module) {
                    return null;
                  }
                  return (
                    <article
                      key={module.id}
                      className={`request-card training-module-card${selectedModule?.id === module.id ? " training-module-card--selected" : ""}`}
                      onClick={() => setSelectedModuleId(module.id)}
                    >
                      <div className="training-module-card__header">
                        <div>
                          <div className="eyebrow">{humanizeLabel(module.required ? "required" : "optional")}</div>
                          <strong>{module.title}</strong>
                        </div>
                        <span className={`badge-pill badge-pill--${mapModuleStatusTone(moduleProgress.status)}`}>{humanizeLabel(moduleProgress.status)}</span>
                      </div>
                      <div className="muted">{module.summary}</div>
                      <div className="training-progress">
                        <div className="training-progress__bar">
                          <span style={{ width: `${moduleProgress.progress_percent}%` }} />
                        </div>
                        <div className="training-module-card__footer">
                          <span className="muted">{module.estimated_minutes} min</span>
                          <span className="muted">Best quiz: {moduleProgress.best_score ?? 0}%</span>
                          {moduleProgress.due_at ? <span className="muted">Due {new Date(moduleProgress.due_at).toLocaleDateString()}</span> : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="detail-two-column">
                <div className="request-card">
                  <strong>Quiz History</strong>
                  <div className="training-activity-list">
                    {selectedProfile.quiz_history.map((attempt) => (
                      <div key={attempt.id} className="training-activity-row">
                        <span>{attempt.round_title}</span>
                        <strong>{attempt.score_percent}%</strong>
                        <span className="muted">{new Date(attempt.played_at).toLocaleDateString()}</span>
                      </div>
                    ))}
                    {!selectedProfile.quiz_history.length ? <div className="empty-state">No challenge rounds have been played yet.</div> : null}
                  </div>
                </div>
                <div className="request-card">
                  <strong>Checkpoint Results</strong>
                  <div className="training-activity-list">
                    {selectedProfile.checkpoints.map((checkpoint) => (
                      <div key={checkpoint.checkpoint_id} className="training-activity-row">
                        <span>{humanizeLabel(checkpoint.checkpoint_id.replace("checkpoint-", "").replace(/-/g, " "))}</span>
                        <strong>{humanizeLabel(checkpoint.status)}</strong>
                        <span className="muted">{checkpoint.notes}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="panel training-rail">
          <div className="section-title">Workbook Detail</div>
          <p className="section-subtitle">Module detail, acknowledgements, and the Picture Day Challenge live together so the workbook feels operational instead of academic.</p>
          {selectedModule && selectedProfile ? (
            <>
              <section className="request-card training-module-detail">
                <div className="training-module-card__header">
                  <div>
                    <div className="eyebrow">{selectedSection?.title ?? "Workbook Module"}</div>
                    <strong>{selectedModule.title}</strong>
                  </div>
                  <span className="meta-pill">v{selectedModule.version}</span>
                </div>
                <div className="muted">{selectedModule.summary}</div>
                <div className="training-module-detail__meta">
                  <span className="meta-pill">{selectedModule.estimated_minutes} min</span>
                  <span className="meta-pill">{selectedModule.required ? "Required" : "Optional"}</span>
                  <span className="meta-pill">{selectedModule.signoff_required ? "Sign-off required" : "No sign-off"}</span>
                </div>
                <div className="training-content-list">
                  {selectedModule.content_blocks.length
                    ? selectedModule.content_blocks.map((block) => (
                        <article key={block.id} className="training-content-block">
                          <div className="eyebrow">{humanizeLabel(block.type)}</div>
                          <strong>{block.title}</strong>
                          <div className="muted">{block.body}</div>
                          {block.bullets?.length ? (
                            <ul className="detail-bullet-list">
                              {block.bullets.map((bullet) => (
                                <li key={bullet}>{bullet}</li>
                              ))}
                            </ul>
                          ) : null}
                        </article>
                      ))
                    : (
                      <article className="training-content-block">
                        <div className="eyebrow">Catalog Migration</div>
                        <strong>Guide content is still being moved into the durable workbook</strong>
                        <div className="muted">
                          Readiness, quizzes, checkpoints, and sign-off are live. Richer SOP and playbook blocks for this module still need to be migrated into the backend-owned catalog.
                        </div>
                        <ul className="detail-bullet-list">
                          <li>{selectedModule.summary}</li>
                          {selectedSection?.summary ? <li>{selectedSection.summary}</li> : null}
                          {selectedAcknowledgements.slice(0, 2).map((entry) => (
                            <li key={entry?.definition.id}>{entry?.definition.summary}</li>
                          ))}
                        </ul>
                      </article>
                    )}
                </div>
                <div className="request-card__actions">
                  <button className="secondary-button" disabled={quizWorking} onClick={() => void launchChallenge("module", selectedModule.id)}>
                    {quizWorking ? "Starting..." : "Challenge This Module"}
                  </button>
                  <button className="secondary-button" disabled={quizWorking} onClick={() => void launchChallenge("profile", recommendedModuleId)}>
                    Next Readiness Round
                  </button>
                </div>
              </section>

              <section className="request-card">
                <strong>Checkpoint and Acknowledgement State</strong>
                <div className="training-activity-list">
                  {selectedCheckpointResults.map((checkpoint) => (
                    <div key={checkpoint?.checkpoint_id} className="training-activity-row">
                      <span>{humanizeLabel(checkpoint?.checkpoint_id.replace("checkpoint-", "").replace(/-/g, " ") ?? "Checkpoint")}</span>
                      <strong>{humanizeLabel(checkpoint?.status ?? "pending")}</strong>
                      <span className="muted">{checkpoint?.notes ?? "Pending review"}</span>
                    </div>
                  ))}
                  {selectedAcknowledgements.map((entry) => (
                    <div key={entry?.definition.id} className="training-activity-row">
                      <span>{entry?.definition.title}</span>
                      <strong>{entry?.state?.acknowledged ? "Acknowledged" : "Pending"}</strong>
                      <span className="muted">{entry?.definition.summary}</span>
                    </div>
                  ))}
                </div>
                {selectedModuleProgress ? (
                  <div className="training-progress training-progress--stacked">
                    <div className="training-progress__bar">
                      <span style={{ width: `${selectedModuleProgress.progress_percent}%` }} />
                    </div>
                    <div className="muted">Best score {selectedModuleProgress.best_score ?? 0}% | Sign-off {humanizeLabel(selectedModuleProgress.signoff_status)}</div>
                  </div>
                ) : null}
              </section>
            </>
          ) : (
            <div className="empty-state">Pick an employee to open workbook detail.</div>
          )}

          <section className="request-card training-quiz-card">
            <div className="training-quiz-card__header">
              <strong>Picture Day Challenge</strong>
              {activeQuiz ? <span className="meta-pill">Best score {activeQuiz.round.best_score}%</span> : null}
            </div>
            {!activeQuiz ? (
              <div className="empty-state">Launch a 5-question round from the dashboard, employee profile, or module detail to start a challenge.</div>
            ) : activeQuiz.result ? (
              <div className="training-quiz-result">
                <div className="training-quiz-score">
                  <strong>{activeQuiz.result.attempt.score_percent}%</strong>
                  <span className={`badge-pill badge-pill--${activeQuiz.result.attempt.passed ? "published" : "cancelled"}`}>
                    {activeQuiz.result.attempt.passed ? "Passed" : "Retry Needed"}
                  </span>
                </div>
                <div className="muted">{activeQuiz.result.attempt.correct_count}/{activeQuiz.result.attempt.question_count} correct | Streak placeholder {activeQuiz.round.streak_placeholder}</div>
                <div className="training-review-list">
                  {activeQuiz.result.questions
                    .filter((question) => activeQuiz.result?.attempt.missed_question_ids.includes(question.id))
                    .map((question) => {
                      const selectedChoice = question.choices.find((choice) => choice.id === activeQuiz.answers[question.id]);
                      const correctChoice = question.choices.find((choice) => choice.correct);
                      return (
                        <article key={question.id} className="training-review-card">
                          <strong>{question.prompt}</strong>
                          <div className="muted">You picked: {selectedChoice?.label ?? "No answer selected"}</div>
                          <div className="muted">Correct: {correctChoice?.label ?? "No correct answer available"}</div>
                          <div className="muted">{correctChoice?.explanation ?? selectedChoice?.explanation ?? ""}</div>
                        </article>
                      );
                    })}
                  {!activeQuiz.result.attempt.missed_question_ids.length ? <div className="success-banner">Perfect round. Nothing missed to review.</div> : null}
                </div>
                <div className="request-card__actions">
                  {activeQuiz.result.attempt.missed_question_ids.length ? (
                    <button className="secondary-button" disabled={quizWorking} onClick={() => void launchChallenge(activeQuiz.round.mode, activeQuiz.round.module_id, activeQuiz.result?.attempt.missed_question_ids)}>
                      Retry Missed Questions
                    </button>
                  ) : null}
                  <button className="primary-button" disabled={quizWorking} onClick={() => void launchChallenge(activeQuiz.round.mode, activeQuiz.round.module_id)}>
                    Play Another Round
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="muted">{activeQuiz.round.title}</div>
                <div className="training-quiz-question-list">
                  {activeQuiz.questions.map((question, index) => (
                    <article key={question.id} className="training-question-card">
                      <div className="eyebrow">Question {index + 1}</div>
                      <strong>{question.prompt}</strong>
                      <div className="muted">{question.scenario}</div>
                      <div className="training-choice-list">
                        {question.choices.map((choice) => (
                          <label key={choice.id} className="training-choice">
                            <input
                              type="radio"
                              name={question.id}
                              checked={activeQuiz.answers[question.id] === choice.id}
                              onChange={() =>
                                setActiveQuiz((current) =>
                                  current
                                    ? { ...current, answers: { ...current.answers, [question.id]: choice.id } }
                                    : current
                                )
                              }
                            />
                            <span>{choice.label}</span>
                          </label>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
                <div className="request-card__actions">
                  <button className="secondary-button" onClick={() => setActiveQuiz(null)}>
                    Cancel Round
                  </button>
                  <button className="primary-button" disabled={quizWorking || activeQuiz.questions.some((question) => !activeQuiz.answers[question.id])} onClick={() => void submitChallenge()}>
                    {quizWorking ? "Submitting..." : "Submit Round"}
                  </button>
                </div>
              </>
            )}
          </section>
        </aside>
      </section>
    </>
  );
}

function buildTrainingSummary(profile: EmployeeTrainingProfile, moduleIndex: Map<string, TrainingModule>) {
  return {
    identity: profile.employee,
    readiness_state: profile.readiness_state,
    readiness_note: profile.readiness_note,
    onboarding_stage: profile.onboarding_stage,
    workbook_progress_percent: profile.workbook_progress_percent,
    required_progress_percent: profile.required_progress_percent,
    optional_progress_percent: profile.optional_progress_percent,
    overdue_module_count: profile.modules.filter((module) => module.status === "overdue").length,
    needs_signoff:
      profile.manager_signoff_status === "pending" ||
      profile.modules.some((module) => module.signoff_status === "pending" && module.status === "completed"),
    next_module_title: moduleIndex.get(pickRecommendedModule(profile)?.module_id ?? "")?.title ?? "School Photographer Workbook"
  } satisfies TrainingEmployeeSummary;
}

function pickRecommendedModule(profile: EmployeeTrainingProfile | null) {
  if (!profile) {
    return null;
  }
  return (
    profile.modules.find((module) => module.status === "overdue") ??
    profile.modules.find((module) => module.status === "needs_review") ??
    profile.modules.find((module) => module.status === "in_progress") ??
    profile.modules.find((module) => module.status === "not_started") ??
    profile.modules[0] ??
    null
  );
}

function getTrainingHashParams() {
  const raw = window.location.hash.replace(/^#(?:people-ops\/training|training)\??/, "");
  const params = new URLSearchParams(raw);
  return {
    employee: params.get("employee"),
    module: params.get("module")
  };
}

function getProfileFromHash(profiles: EmployeeTrainingProfile[]) {
  const params = getTrainingHashParams();
  if (!params.employee) {
    return null;
  }
  return profiles.find((profile) => profile.employee.email.toLowerCase() === params.employee?.toLowerCase()) ?? null;
}

function syncHash(employeeEmail: string, moduleId: string | null) {
  const params = new URLSearchParams();
  params.set("employee", employeeEmail);
  if (moduleId) {
    params.set("module", moduleId);
  }
  const nextHash = `#employees/training?${params.toString()}`;
  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
  }
}

function humanizeLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function mapModuleStatusTone(status: string) {
  if (status === "completed") {
    return "published";
  }
  if (status === "overdue" || status === "needs_review") {
    return "cancelled";
  }
  return "draft";
}
