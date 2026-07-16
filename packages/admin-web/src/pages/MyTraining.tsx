import { useCallback, useEffect, useState } from "react";
import { AskBaileyLaunchButton } from "../components/askBailey/AskBaileyLauncher";
import {
  acknowledgeLesson,
  getMyLesson,
  listMyAssignments,
  recordSectionViewed,
  submitReadiness,
  type MyAssignment,
  type MyLesson,
  type ReadinessResult
} from "../services/trainingPilotApi";

// Ask Bailey H6 — the employee learning experience. Calm, source-backed, and
// accessible: assigned lessons, reading + timestamped video, acknowledgment,
// and a readiness check whose feedback points back at the approved lesson
// content. Nothing here ranks or disciplines the employee.

type Props = { token: string };

function formatClock(seconds: number | null): string {
  if (seconds === null) return "";
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function statusBadge(assignment: MyAssignment): string {
  if (assignment.status === "completed") return "completed";
  if (assignment.overdue) return "overdue";
  return assignment.status.replace(/_/g, " ");
}

function LessonRunner({ token, assignmentId, onClose, onChanged }: { token: string; assignmentId: string; onClose: () => void; onChanged: () => void }) {
  const [lesson, setLesson] = useState<MyLesson | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ReadinessResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLesson(await getMyLesson(token, assignmentId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "This lesson could not be opened.");
    }
  }, [token, assignmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <section className="panel">
        <p role="alert">{error}</p>
        <button type="button" className="secondary-button" onClick={onClose}>
          Back to my training
        </button>
      </section>
    );
  }
  if (!lesson) {
    return (
      <section className="panel">
        <p className="section-subtitle">Loading lesson…</p>
      </section>
    );
  }

  const viewed = new Set(lesson.progress.viewed_section_ids);
  const allViewed = lesson.sections.every((section) => viewed.has(section.id));

  const markViewed = async (sectionId: string) => {
    try {
      await recordSectionViewed(token, assignmentId, sectionId);
      await load();
      onChanged();
    } catch (viewError) {
      setError(viewError instanceof Error ? viewError.message : "Could not save progress.");
    }
  };

  const acknowledge = async () => {
    try {
      await acknowledgeLesson(token, assignmentId);
      await load();
      onChanged();
    } catch (ackError) {
      setError(ackError instanceof Error ? ackError.message : "Could not acknowledge.");
    }
  };

  const submit = async () => {
    try {
      setResult(await submitReadiness(token, assignmentId, answers));
      await load();
      onChanged();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not submit the readiness check.");
    }
  };

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <section className="panel">
        <button type="button" className="secondary-button" onClick={onClose}>
          ← Back to my training
        </button>
        <div className="section-title" style={{ marginTop: "0.5rem" }}>
          {lesson.lesson.title}
        </div>
        {lesson.lesson.objective ? <p className="section-subtitle">{lesson.lesson.objective}</p> : null}
        <p className="section-subtitle">
          Version {lesson.lesson.version_number} · pass mark {lesson.lesson.pass_threshold_percent}% ·{" "}
          {lesson.progress.acknowledged ? "acknowledged" : "not yet acknowledged"}
        </p>
      </section>

      <section className="panel">
        <div className="section-title">Lesson</div>
        <ol style={{ display: "grid", gap: "0.75rem", paddingLeft: "1.1rem" }}>
          {lesson.sections.map((section) => (
            <li key={section.id}>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <strong>{section.title}</strong>
                <span className="badge-pill">{section.section_kind.replace(/_/g, " ")}</span>
                {viewed.has(section.id) ? <span className="badge-pill">read</span> : null}
              </div>
              {section.body ? <p style={{ whiteSpace: "pre-wrap" }}>{section.body}</p> : null}
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                {section.media_url ? (
                  <a href={section.media_url} target="_blank" rel="noreferrer">
                    Watch from {formatClock(section.media_start_seconds)}
                  </a>
                ) : null}
                {section.source_id ? (
                  <>
                    <a href={`#knowledge/sources/${section.source_id}`}>Open source{section.source_title ? `: ${section.source_title}` : ""}</a>
                    <AskBaileyLaunchButton context={{ kind: "source", id: section.source_id, label: section.source_title ?? section.title }} label="Ask Bailey" />
                  </>
                ) : null}
                {!viewed.has(section.id) ? (
                  <button type="button" className="secondary-button" onClick={() => void markViewed(section.id)}>
                    Mark read
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        {allViewed && !lesson.progress.acknowledged ? (
          <button type="button" className="primary-button" onClick={() => void acknowledge()}>
            I have read and understood this lesson
          </button>
        ) : null}
      </section>

      {lesson.questions.length > 0 ? (
        <section className="panel">
          <div className="section-title">Readiness check</div>
          <p className="section-subtitle">
            Answer each question. If you miss one, Bailey will point you back to the exact lesson section to review.
          </p>
          {lesson.questions.map((question) => (
            <fieldset key={question.id} style={{ border: "1px solid var(--border-color, #d9d4c8)", borderRadius: 8, padding: "0.6rem 0.9rem", margin: "0.5rem 0" }}>
              <legend>{question.prompt}</legend>
              {question.scenario ? <p className="section-subtitle">{question.scenario}</p> : null}
              {question.allow_open_text ? (
                <textarea
                  aria-label={`Answer for: ${question.prompt}`}
                  rows={3}
                  value={answers[question.id] ?? ""}
                  onChange={(event) => setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))}
                />
              ) : (
                question.choices.map((choice) => (
                  <label key={choice.id} style={{ display: "block", padding: "0.15rem 0" }}>
                    <input
                      type="radio"
                      name={question.id}
                      value={choice.id}
                      checked={answers[question.id] === choice.id}
                      onChange={() => setAnswers((prev) => ({ ...prev, [question.id]: choice.id }))}
                    />{" "}
                    {choice.label}
                  </label>
                ))
              )}
            </fieldset>
          ))}
          <button type="button" className="primary-button" onClick={() => void submit()}>
            Submit readiness check
          </button>
          {result ? (
            <div style={{ marginTop: "0.75rem" }}>
              <p>
                <strong>
                  {result.passed ? "Passed" : result.needs_human_review ? "Sent for trainer review" : "Not passed yet"} — {result.score_percent}% ({result.correct_count}/{result.question_count})
                </strong>
              </p>
              <ul>
                {result.feedback.map((entry) => (
                  <li key={entry.question_id}>
                    <span className="badge-pill">{entry.result.replace(/_/g, " ")}</span> {entry.coaching}
                    {entry.review_topic ? <em> (Review: {entry.review_topic})</em> : null}
                  </li>
                ))}
              </ul>
              {!result.passed && !result.needs_human_review ? (
                <p className="section-subtitle">Review the highlighted sections above, then try the check again.</p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export default function MyTraining({ token }: Props) {
  const [assignments, setAssignments] = useState<MyAssignment[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setAssignments((await listMyAssignments(token)).assignments);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load your training.");
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (openId) {
    return <LessonRunner token={token} assignmentId={openId} onClose={() => setOpenId(null)} onChanged={() => void refresh()} />;
  }

  return (
    <div className="workspace-shell my-training" style={{ display: "grid", gap: "1rem" }}>
      <section className="panel">
        <div className="section-title">My training</div>
        <p className="section-subtitle">
          Approved lessons assigned to you, grounded in the current company playbook. Read each lesson, then take the
          readiness check when you are ready.
        </p>
        {error ? <p role="alert">{error}</p> : null}
      </section>

      <section className="panel">
        {assignments === null ? (
          <p className="section-subtitle">Loading…</p>
        ) : assignments.length === 0 ? (
          <p className="section-subtitle">No training is assigned to you right now.</p>
        ) : (
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {assignments.map((assignment) => (
              <div key={assignment.id} style={{ border: "1px solid var(--border-color, #d9d4c8)", borderRadius: 8, padding: "0.6rem 0.9rem" }}>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <strong>{assignment.title}</strong>
                  <span className="badge-pill">{statusBadge(assignment)}</span>
                  {assignment.best_score != null ? <span className="badge-pill">best {assignment.best_score}%</span> : null}
                </div>
                {assignment.objective ? <p className="section-subtitle" style={{ margin: "0.25rem 0" }}>{assignment.objective}</p> : null}
                <div style={{ fontSize: "0.85rem", opacity: 0.8 }}>
                  {[
                    assignment.assignment_reason,
                    assignment.due_at ? `Due ${assignment.due_at.slice(0, 10)}` : null,
                    `${assignment.progress_percent ?? 0}% read`,
                    `${assignment.section_count} sections · ${assignment.question_count} questions`
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                <button type="button" className="primary-button" style={{ marginTop: "0.4rem" }} onClick={() => setOpenId(assignment.id)}>
                  {assignment.status === "completed" ? "Review lesson" : "Open lesson"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
