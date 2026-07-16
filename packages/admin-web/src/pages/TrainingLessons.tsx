import { useCallback, useEffect, useState } from "react";
import {
  addCohortMember,
  approveLessonVersion,
  assignLesson,
  createCohort,
  createLesson,
  createLessonRevision,
  getLessonDetail,
  getLessonResults,
  getPilotMetrics,
  listCohorts,
  listLessons,
  listTrainingPeople,
  rejectLessonVersion,
  retireLessonVersion,
  setCohortState,
  submitLessonVersion,
  type CohortRow,
  type LessonDetail,
  type LessonListRow,
  type LessonResults,
  type PilotMetrics,
  type TrainingPerson
} from "../services/trainingPilotApi";

// Ask Bailey H6 — Fall Field Coach manager/knowledge-owner desk. Author
// source-backed lessons (draft until approved), publish, assign to a pilot
// cohort, and review readiness — all reviewer-gated server-side. Approved
// lessons are revised through new versions, never edited in place.

type Props = { token: string };

function CreateLessonForm({ token, onCreated, onError }: { token: string; onCreated: () => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [role, setRole] = useState("associate_photographer");
  const [threshold, setThreshold] = useState(80);
  const [sectionTitle, setSectionTitle] = useState("");
  const [sectionBody, setSectionBody] = useState("");
  const [sourceVersionId, setSourceVersionId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [choiceA, setChoiceA] = useState("");
  const [choiceB, setChoiceB] = useState("");
  const [correct, setCorrect] = useState<"a" | "b">("a");

  const create = async () => {
    if (!title.trim() || !sectionTitle.trim()) {
      onError("A lesson needs a title and at least one section.");
      return;
    }
    try {
      await createLesson(token, {
        title: title.trim(),
        objective: objective.trim() || null,
        intended_role: role || null,
        pass_threshold_percent: threshold,
        is_demo: true,
        sections: [
          {
            title: sectionTitle.trim(),
            section_kind: "reading",
            body: sectionBody.trim() || null,
            knowledge_source_version_id: sourceVersionId.trim() || null
          }
        ],
        questions: prompt.trim()
          ? [
              {
                prompt: prompt.trim(),
                choices: [
                  { id: "a", label: choiceA.trim() || "Option A", correct: correct === "a" },
                  { id: "b", label: choiceB.trim() || "Option B", correct: correct === "b" }
                ],
                review_section_ordinal: 0
              }
            ]
          : []
      });
      setTitle("");
      setObjective("");
      setSectionTitle("");
      setSectionBody("");
      setSourceVersionId("");
      setPrompt("");
      setChoiceA("");
      setChoiceB("");
      setOpen(false);
      onCreated();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Creating the lesson failed.");
    }
  };

  if (!open) {
    return (
      <button type="button" className="secondary-button" onClick={() => setOpen(true)}>
        New lesson
      </button>
    );
  }
  return (
    <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.5rem" }}>
      <input aria-label="Lesson title" placeholder="Lesson title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input aria-label="Lesson objective" placeholder="Objective" value={objective} onChange={(e) => setObjective(e.target.value)} />
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input aria-label="Intended role" placeholder="Intended role" value={role} onChange={(e) => setRole(e.target.value)} />
        <label>
          Pass %{" "}
          <input aria-label="Pass threshold" type="number" min={0} max={100} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} style={{ width: 70 }} />
        </label>
      </div>
      <strong>First section (source-backed)</strong>
      <input aria-label="Section title" placeholder="Section title" value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} />
      <textarea aria-label="Section body" placeholder="Reviewed lesson text drawn from the approved source" rows={3} value={sectionBody} onChange={(e) => setSectionBody(e.target.value)} />
      <input aria-label="Knowledge source version id" placeholder="Approved knowledge source version id (optional citation)" value={sourceVersionId} onChange={(e) => setSourceVersionId(e.target.value)} />
      <strong>One readiness question (optional)</strong>
      <input aria-label="Question prompt" placeholder="Question prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <input aria-label="Choice A" placeholder="Choice A" value={choiceA} onChange={(e) => setChoiceA(e.target.value)} />
        <input aria-label="Choice B" placeholder="Choice B" value={choiceB} onChange={(e) => setChoiceB(e.target.value)} />
        <label>
          Correct{" "}
          <select aria-label="Correct choice" value={correct} onChange={(e) => setCorrect(e.target.value as "a" | "b")}>
            <option value="a">A</option>
            <option value="b">B</option>
          </select>
        </label>
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" className="primary-button" onClick={() => void create()}>
          Create draft lesson
        </button>
        <button type="button" className="secondary-button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function LessonDetailPanel({ token, lessonId, people, cohorts, onChanged, onError }: { token: string; lessonId: string; people: TrainingPerson[]; cohorts: CohortRow[]; onChanged: () => void; onError: (m: string) => void }) {
  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [results, setResults] = useState<LessonResults | null>(null);
  const [assignUser, setAssignUser] = useState("");
  const [assignCohort, setAssignCohort] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([getLessonDetail(token, lessonId), getLessonResults(token, lessonId)]);
      setDetail(d);
      setResults(r);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not load the lesson.");
    }
  }, [token, lessonId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await load();
      onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : "The action failed.");
    }
  };

  if (!detail) return <p className="section-subtitle">Loading lesson…</p>;

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <div className="section-title">{detail.lesson.title}</div>
      {detail.lesson.objective ? <p className="section-subtitle">{detail.lesson.objective}</p> : null}
      <div style={{ display: "grid", gap: "0.4rem" }}>
        {detail.versions.map((version) => (
          <div key={version.id} style={{ border: "1px solid var(--border-color, #d9d4c8)", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <strong>v{version.version_number}</strong>
              <span className="badge-pill">{version.publication_status.replace(/_/g, " ")}</span>
              {version.ai_drafted ? <span className="badge-pill">AI-drafted</span> : null}
              <span className="badge-pill">pass {version.pass_threshold_percent}%</span>
            </div>
            {version.review_notes ? <p className="section-subtitle" style={{ margin: "0.2rem 0" }}>Notes: {version.review_notes}</p> : null}
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.3rem" }}>
              {version.publication_status === "draft" || version.publication_status === "rejected" ? (
                <button type="button" className="primary-button" onClick={() => void run(() => submitLessonVersion(token, version.id))}>
                  Submit for review
                </button>
              ) : null}
              {version.publication_status === "pending_review" ? (
                <>
                  <button type="button" className="primary-button" onClick={() => void run(() => approveLessonVersion(token, version.id))}>
                    Approve
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      const note = window.prompt("What needs changing? (required)");
                      if (note && note.trim()) void run(() => rejectLessonVersion(token, version.id, note.trim()));
                    }}
                  >
                    Request changes
                  </button>
                </>
              ) : null}
              {version.publication_status === "approved" ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    const note = window.prompt("Why retire this version? (optional)") ?? undefined;
                    void run(() => retireLessonVersion(token, version.id, note));
                  }}
                >
                  Retire
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="secondary-button" onClick={() => void run(() => createLessonRevision(token, lessonId))}>
        New revision
      </button>

      <details>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Sections + rubric ({detail.sections.length} sections, {detail.questions.length} questions)</summary>
        <ul style={{ fontSize: "0.85rem" }}>
          {detail.sections.map((s) => (
            <li key={s.id}>
              {s.title} {s.source_title ? <em>— from {s.source_title}</em> : null}
            </li>
          ))}
        </ul>
        {detail.questions.map((q) => (
          <div key={q.id} style={{ fontSize: "0.85rem", marginTop: "0.3rem" }}>
            <strong>{q.prompt}</strong>
            <ul>
              {q.choices.map((c) => (
                <li key={c.id}>
                  {c.label} {c.correct ? <span className="badge-pill">correct</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </details>

      <div style={{ border: "1px solid var(--border-color, #d9d4c8)", borderRadius: 8, padding: "0.6rem 0.9rem" }}>
        <strong>Assign this lesson</strong>
        <p className="section-subtitle" style={{ margin: "0.2rem 0" }}>Only an approved version can be assigned. A pilot cohort must be enabled and the employee a member.</p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <select aria-label="Assign to employee" value={assignUser} onChange={(e) => setAssignUser(e.target.value)}>
            <option value="">Select employee…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name} ({p.department})
              </option>
            ))}
          </select>
          <select aria-label="Assign via cohort" value={assignCohort} onChange={(e) => setAssignCohort(e.target.value)}>
            <option value="">No cohort</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.enabled ? "" : "(disabled)"}
              </option>
            ))}
          </select>
          <input aria-label="Assignment reason" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button
            type="button"
            className="primary-button"
            disabled={!assignUser}
            onClick={() =>
              void run(() =>
                assignLesson(token, { lesson_id: lessonId, user_id: assignUser, cohort_id: assignCohort || null, reason: reason || null })
              )
            }
          >
            Assign
          </button>
        </div>
      </div>

      {results ? (
        <div>
          <strong>Readiness results ({results.assignments.length})</strong>
          <ul style={{ fontSize: "0.85rem" }}>
            {results.assignments.map((a) => (
              <li key={a.id}>
                {a.employee_name} — {a.status.replace(/_/g, " ")}
                {a.best_score != null ? ` · best ${a.best_score}%` : ""}
                {a.needs_review ? " · needs trainer review" : ""}
              </li>
            ))}
          </ul>
          {results.question_difficulty.some((q) => q.attempts > 0) ? (
            <>
              <strong>Question difficulty (miss rate)</strong>
              <ul style={{ fontSize: "0.85rem" }}>
                {results.question_difficulty.map((q) => (
                  <li key={q.id}>
                    {q.prompt} — {q.misses}/{q.attempts} missed
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function TrainingLessons({ token }: Props) {
  const [lessons, setLessons] = useState<LessonListRow[] | null>(null);
  const [people, setPeople] = useState<TrainingPerson[]>([]);
  const [cohorts, setCohorts] = useState<CohortRow[]>([]);
  const [metrics, setMetrics] = useState<PilotMetrics | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newCohort, setNewCohort] = useState("");
  const [cohortMemberUser, setCohortMemberUser] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [l, c, m] = await Promise.all([listLessons(token), listCohorts(token), getPilotMetrics(token)]);
      setLessons(l.lessons);
      setCohorts(c.cohorts);
      setMetrics(m);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load training lessons.");
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    listTrainingPeople(token).then(setPeople).catch(() => setPeople([]));
  }, [refresh, token]);

  const runCohort = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The cohort action failed.");
    }
  };

  return (
    <div className="workspace-shell training-lessons" style={{ display: "grid", gap: "1rem" }}>
      <section className="panel">
        <div className="section-title">Fall Field Coach — governed lessons</div>
        <p className="section-subtitle">
          Author source-backed lessons from approved knowledge. Lessons stay drafts until approved; assignments pin the
          approved version so revising or retiring never changes an in-flight assignment.
        </p>
        {metrics ? (
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            <span className="badge-pill">Assigned: {metrics.assignments.assigned}</span>
            <span className="badge-pill">Completed: {metrics.assignments.completed}</span>
            <span className="badge-pill">In progress: {metrics.assignments.in_progress}</span>
            <span className="badge-pill">Readiness attempts: {metrics.readiness.attempts}</span>
            <span className="badge-pill">Passed: {metrics.readiness.passed}</span>
            <span className="badge-pill">Needs review: {metrics.readiness.needs_review}</span>
          </div>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <CreateLessonForm token={token} onCreated={() => void refresh()} onError={setError} />
      </section>

      <section className="panel">
        <div className="section-title">Pilot cohorts ({cohorts.length})</div>
        <p className="section-subtitle">Cohorts are disabled by default. Enable one and add members before assigning through it.</p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <input aria-label="New cohort name" placeholder="New cohort name" value={newCohort} onChange={(e) => setNewCohort(e.target.value)} />
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              if (newCohort.trim()) void runCohort(() => createCohort(token, { name: newCohort.trim(), is_demo: true }).then(() => setNewCohort("")));
            }}
          >
            Create cohort
          </button>
        </div>
        <div style={{ display: "grid", gap: "0.4rem", marginTop: "0.5rem" }}>
          {cohorts.map((cohort) => (
            <div key={cohort.id} style={{ border: "1px solid var(--border-color, #d9d4c8)", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <strong>{cohort.name}</strong>
                <span className="badge-pill">{cohort.enabled ? "enabled" : "disabled"}</span>
                <span className="badge-pill">{cohort.status}</span>
                <span className="badge-pill">{cohort.member_count} members</span>
                <button type="button" className="secondary-button" onClick={() => void runCohort(() => setCohortState(token, cohort.id, { enabled: !cohort.enabled, status: cohort.enabled ? "draft" : "active" }))}>
                  {cohort.enabled ? "Disable" : "Enable"}
                </button>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginTop: "0.3rem" }}>
                <select aria-label={`Add member to ${cohort.name}`} value={cohortMemberUser} onChange={(e) => setCohortMemberUser(e.target.value)}>
                  <option value="">Add member…</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!cohortMemberUser}
                  onClick={() => cohortMemberUser && void runCohort(() => addCohortMember(token, cohort.id, cohortMemberUser).then(() => setCohortMemberUser("")))}
                >
                  Add
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-title">Lessons ({lessons?.length ?? 0})</div>
        {lessons === null ? (
          <p className="section-subtitle">Loading…</p>
        ) : (
          <div style={{ display: "grid", gap: "0.4rem" }}>
            {lessons.map((lesson) => (
              <button
                key={lesson.id}
                type="button"
                className="secondary-button"
                style={{ textAlign: "left" }}
                onClick={() => setSelected(selected === lesson.id ? null : lesson.id)}
              >
                <strong>{lesson.title}</strong>{" "}
                <span className="badge-pill">{(lesson.current_status ?? lesson.latest_status ?? "draft").replace(/_/g, " ")}</span>{" "}
                <span className="badge-pill">{lesson.assignment_count} assigned</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {selected ? (
        <section className="panel">
          <LessonDetailPanel token={token} lessonId={selected} people={people} cohorts={cohorts} onChanged={() => void refresh()} onError={setError} />
        </section>
      ) : null}
    </div>
  );
}
