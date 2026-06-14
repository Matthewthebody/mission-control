import { useState } from "react";
import type { HomeRole } from "./homeRoles";
import {
  CSR_QUEUE,
  CSR_TIME_CLOCK,
  GRAPHIC_ARTIST_QUEUE,
  GRAPHIC_ARTIST_TIME_CLOCK,
  SEASONAL_CHANGE_NOTICES,
  SEASONAL_EVAL_PROMPT,
  SEASONAL_PREP_CHECKLIST,
  SEASONAL_SHIFT,
  SEASONAL_TIME_CLOCK
} from "./homeDemoData";
import { HomePill, HomeSectionHeader, RelatedJobLink, navigateToHash } from "./homeShared";

function TimeClockCard({ state, helper }: { state: string; helper: string }) {
  return (
    <section className="panel home-workspace-clock" aria-label="Time clock">
      <HomeSectionHeader title="Time Clock" />
      <strong className="home-workspace-clock__state">{state}</strong>
      <span className="home-workspace-clock__helper">{helper}</span>
    </section>
  );
}

function SeasonalPhotographerWorkspace() {
  const shift = SEASONAL_SHIFT;
  const [checklist, setChecklist] = useState(SEASONAL_PREP_CHECKLIST);
  const [acked, setAcked] = useState<Record<string, boolean>>(
    Object.fromEntries(SEASONAL_CHANGE_NOTICES.map((notice) => [notice.id, notice.acknowledged]))
  );
  const [rainPlanAcked, setRainPlanAcked] = useState(false);

  return (
    <>
      <section className="panel home-workspace-shift" aria-label="Today's assignment">
        <HomeSectionHeader title="Today's Assignment" help="Everything you need for today's shoot, and nothing you do not." />
        <div className="home-shift">
          <div className="home-shift__head">
            <strong className="home-shift__job">{shift.jobName}</strong>
            <span className="home-shift__role">{shift.role}</span>
          </div>
          <div className="home-shift__grid">
            <div><span>Call time</span><strong>{shift.callTime}</strong></div>
            <div><span>Start</span><strong>{shift.startTime}</strong></div>
            {shift.endTime ? <div><span>Expected end</span><strong>{shift.endTime}</strong></div> : null}
            <div><span>Lead</span><strong>{shift.lead}</strong></div>
            <div className="home-shift__location"><span>Location</span><strong>{shift.location}</strong></div>
          </div>
          {shift.weatherNote ? (
            <div className="home-shift__weather">
              <HomePill tone="watch">Weather</HomePill>
              <span>{shift.weatherNote}</span>
            </div>
          ) : null}
          <div className="home-shift__actions">
            <a className="home-shift__map" href={shift.mapUrl} target="_blank" rel="noreferrer">Open map →</a>
            {shift.relatedJobId ? <RelatedJobLink jobName="Open job details" /> : null}
            {shift.action ? (
              <button
                type="button"
                className={`home-shift__cta${rainPlanAcked ? " is-done" : ""}`}
                onClick={() => setRainPlanAcked(true)}
                disabled={rainPlanAcked}
              >
                {rainPlanAcked ? "Rain plan acknowledged" : shift.action}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <div className="home-workspace-grid">
        <section className="panel home-workspace-checklist" aria-label="Prep checklist">
          <HomeSectionHeader title="Prep Checklist" />
          <ul className="home-checklist">
            {checklist.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`home-checklist__item${item.done ? " is-done" : ""}`}
                  onClick={() =>
                    setChecklist((current) =>
                      current.map((entry) => (entry.id === item.id ? { ...entry, done: !entry.done } : entry))
                    )
                  }
                >
                  <span className="home-checklist__box" aria-hidden="true">{item.done ? "✓" : ""}</span>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel home-workspace-changes" aria-label="Change notices">
          <HomeSectionHeader title="Change Notices" />
          <ul className="home-change-list">
            {SEASONAL_CHANGE_NOTICES.map((notice) => (
              <li key={notice.id} className={`home-change-item${acked[notice.id] ? " is-ack" : ""}`}>
                <div className="home-change-item__text">
                  <strong>{notice.title}</strong>
                  <p>{notice.detail}</p>
                </div>
                {acked[notice.id] ? (
                  <HomePill tone="healthy">Acknowledged</HomePill>
                ) : (
                  <button
                    type="button"
                    className="home-change-ack"
                    onClick={() => setAcked((current) => ({ ...current, [notice.id]: true }))}
                  >
                    Acknowledge
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="home-workspace-grid">
        <TimeClockCard state={SEASONAL_TIME_CLOCK.state} helper={SEASONAL_TIME_CLOCK.helper} />
        <section className="panel home-workspace-eval" aria-label="Post-shoot eval">
          <HomeSectionHeader title="Post-Shoot Eval" />
          <p className="home-eval__job">{SEASONAL_EVAL_PROMPT.job}</p>
          <p className="home-eval__prompt">{SEASONAL_EVAL_PROMPT.prompt}</p>
          <button type="button" className="home-eval__cta" onClick={() => navigateToHash("#jobs")}>
            Add eval
          </button>
        </section>
      </div>
    </>
  );
}

function GraphicArtistWorkspace() {
  const queue = GRAPHIC_ARTIST_QUEUE;
  return (
    <>
      <section className="panel home-workspace-queue" aria-label="My production queue">
        <HomeSectionHeader title="My Production Queue" help="Your assigned jobs, what is due, and what is blocking you." />
        <div className="home-workspace-stats">
          <div className="home-workspace-stat"><strong>{queue.assigned}</strong><span>Assigned</span></div>
          <div className="home-workspace-stat home-workspace-stat--warning"><strong>{queue.dueToday}</strong><span>Due today</span></div>
          <div className="home-workspace-stat"><strong>{queue.dueSoon}</strong><span>Due soon</span></div>
          <div className="home-workspace-stat home-workspace-stat--critical"><strong>{queue.blocked}</strong><span>Blocked</span></div>
          <div className="home-workspace-stat home-workspace-stat--warning"><strong>{queue.qaCorrections}</strong><span>QA corrections</span></div>
        </div>
        <ul className="home-workspace-list">
          {queue.jobs.map((job) => (
            <li key={job.id} className="home-workspace-item">
              <div className="home-workspace-item__main">
                <strong>{job.name}</strong>
                <HomePill tone={job.tone}>{job.status}</HomePill>
              </div>
              <div className="home-workspace-item__side">
                <span className="home-workspace-item__due">{job.due}</span>
                <RelatedJobLink jobName="Open" />
              </div>
            </li>
          ))}
        </ul>
        <div className="home-workspace-notes">
          <span className="home-workspace-notes__label">Notes from production</span>
          <ul>
            {queue.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      </section>
      <TimeClockCard state={GRAPHIC_ARTIST_TIME_CLOCK.state} helper={GRAPHIC_ARTIST_TIME_CLOCK.helper} />
    </>
  );
}

function CsrWorkspace() {
  const queue = CSR_QUEUE;
  return (
    <>
      <section className="panel home-workspace-queue" aria-label="Client success queue">
        <HomeSectionHeader title="Client Success Queue" help="Your client cases, what is due, and what is over response target." />
        <div className="home-workspace-stats">
          <div className="home-workspace-stat"><strong>{queue.openCases}</strong><span>Open cases</span></div>
          <div className="home-workspace-stat home-workspace-stat--warning"><strong>{queue.dueToday}</strong><span>Due today</span></div>
          <div className="home-workspace-stat home-workspace-stat--critical"><strong>{queue.overTarget}</strong><span>Over target</span></div>
          <div className="home-workspace-stat"><strong>{queue.archiveRequests}</strong><span>Archive requests</span></div>
        </div>
        <ul className="home-workspace-list">
          {queue.cases.map((entry) => (
            <li key={entry.id} className="home-workspace-item">
              <div className="home-workspace-item__main">
                <strong>{entry.client}</strong>
                <span className="home-workspace-item__issue">{entry.issue}</span>
              </div>
              <div className="home-workspace-item__side">
                <HomePill tone={entry.tone}>{entry.due}</HomePill>
                <RelatedJobLink jobName="Open" />
              </div>
            </li>
          ))}
        </ul>
      </section>
      <TimeClockCard state={CSR_TIME_CLOCK.state} helper={CSR_TIME_CLOCK.helper} />
    </>
  );
}

export function MyWorkspaceHome({ role }: { role: HomeRole }) {
  if (role.id === "graphic_artist") {
    return <GraphicArtistWorkspace />;
  }
  if (role.id === "csr") {
    return <CsrWorkspace />;
  }
  return <SeasonalPhotographerWorkspace />;
}
