import { HomePill, HomeSectionHeader, navigateToHash } from "./homeShared";
import { SAM_GROUPS, SAM_NEXT_ACTIONS, SAM_WAITING_ON, type SportsTone } from "./sportsDemoData";

// Sam-relevant recent changes (only his groups; kept local + small).
const SAM_RECENT_CHANGES: Array<{ id: string; association: string; change: string; when: string }> = [
  { id: "src-armstrong", association: "Armstrong Baseball", change: "Shoot moved 30 minutes earlier", when: "2 hours ago" },
  { id: "src-wayzata", association: "Wayzata Youth Hockey", change: "Rink confirmed for hockey day", when: "Yesterday" }
];

const DUE_SOON = /tomorrow|this week|overdue/i;

export function SamSportsWorkspace() {
  const dueThisWeek = SAM_NEXT_ACTIONS.filter((action) => DUE_SOON.test(action.due));

  return (
    <>
      <section className="panel" aria-label="My groups">
        <HomeSectionHeader title="My Groups" count={SAM_GROUPS.length} help="The associations and groups you own or support, with the next thing each one needs." />
        <ul className="sports-cc-list">
          {SAM_GROUPS.map((group) => (
            <li key={group.id} className={`sports-cc-row sports-cc-row--${group.status as SportsTone}`}>
              <div className="sports-cc-row__main">
                <div className="sports-cc-row__head">
                  <strong>{group.association}</strong>
                  <HomePill tone={group.status}>{group.statusLabel}</HomePill>
                  {group.waitingOn ? <span className="sports-cc-row__waiting">Waiting on {group.waitingOn}</span> : null}
                </div>
                <p className="sports-cc-row__sub">
                  {group.nextAction}
                  {group.upcomingShoot ? ` · ${group.upcomingShoot}` : ""}
                </p>
              </div>
              <div className="sports-cc-row__side">
                <span className="sports-cc-row__action">{group.dueAt}</span>
                <button type="button" className="sports-cc-link" onClick={() => navigateToHash("#sports/accounts")}>
                  Open group →
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="sports-cc-split">
        <section className="panel sports-cc-panel" aria-label="My next actions">
          <HomeSectionHeader title="My Next Actions" help="Your follow-ups, schedule building, and roster checks — in priority order." />
          <ul className="sports-cc-action-list">
            {SAM_NEXT_ACTIONS.map((action) => (
              <li key={action.id} className="sports-cc-action">
                <HomePill tone={action.tone}>{action.due}</HomePill>
                <div className="sports-cc-action__text">
                  <strong>{action.label}</strong>
                  <span>{action.association}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel sports-cc-panel" aria-label="Due this week">
          <HomeSectionHeader title="Due This Week" count={dueThisWeek.length} help="What is due soon." />
          {dueThisWeek.length === 0 ? (
            <div className="home-empty">
              <strong>Nothing due this week.</strong>
            </div>
          ) : (
            <ul className="sports-cc-action-list">
              {dueThisWeek.map((action) => (
                <li key={action.id} className="sports-cc-action">
                  <HomePill tone={action.tone}>{action.due}</HomePill>
                  <div className="sports-cc-action__text">
                    <strong>{action.label}</strong>
                    <span>{action.association}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="sports-cc-split">
        <section className="panel sports-cc-panel" aria-label="Waiting on">
          <HomeSectionHeader title="Waiting On" help="What you are waiting on from clients, coaches, Josh, or production." />
          <ul className="sports-cc-list">
            {SAM_WAITING_ON.map((item) => (
              <li key={item.id} className="sports-cc-row sports-cc-row--neutral">
                <div className="sports-cc-row__main">
                  <div className="sports-cc-row__head">
                    <strong>{item.association}</strong>
                    <HomePill tone="watch">Waiting on {item.waitingOn}</HomePill>
                  </div>
                  <p className="sports-cc-row__sub">{item.detail}</p>
                </div>
                <div className="sports-cc-row__side">
                  <span className="sports-cc-row__action">Waiting {item.since}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel sports-cc-panel" aria-label="Recently changed">
          <HomeSectionHeader title="Recently Changed" help="Recent changes on your groups." />
          <ul className="sports-cc-action-list">
            {SAM_RECENT_CHANGES.map((change) => (
              <li key={change.id} className="sports-cc-action">
                <div className="sports-cc-action__text">
                  <strong>{change.association}</strong>
                  <span>{change.change} · {change.when}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
