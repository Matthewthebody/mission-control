import type { OperatingArea } from "./homeRoles";
import { OPERATING_AREA_LABELS } from "./homeRoles";
import { DEMO_NEEDS_ATTENTION } from "./homeDemoData";
import {
  NEEDS_ATTENTION_REASON_LABELS,
  NEEDS_ATTENTION_SEVERITY_LABELS,
  selectNeedsAttention,
  type NeedsAttentionItem
} from "./needsAttention";
import { HomePill, HomeSectionHeader, RelatedJobLink } from "./homeShared";

function NeedsAttentionRow({ item }: { item: NeedsAttentionItem }) {
  const timing = item.dueAt ?? item.ageLabel;
  return (
    <li className={`home-na-row home-na-row--${item.severity}`}>
      <div className="home-na-row__main">
        <div className="home-na-row__head">
          <HomePill tone={item.severity}>{NEEDS_ATTENTION_SEVERITY_LABELS[item.severity]}</HomePill>
          <span className="home-na-row__area">{OPERATING_AREA_LABELS[item.area]}</span>
          {timing ? <span className="home-na-row__timing">{timing}</span> : null}
        </div>
        <strong className="home-na-row__title">{item.title}</strong>
        <p className="home-na-row__issue">{item.issue}</p>
        <div className="home-na-row__reasons">
          {item.reasons.map((reason) => (
            <span key={reason} className="home-pill home-pill--reason">
              {NEEDS_ATTENTION_REASON_LABELS[reason]}
            </span>
          ))}
        </div>
      </div>
      <div className="home-na-row__side">
        <span className="home-na-row__owner">Owner: {item.owner}</span>
        <span className="home-na-row__next">{item.nextAction}</span>
        {item.relatedJobId ? <RelatedJobLink jobName={item.relatedJobName ?? "Open job"} /> : null}
      </div>
    </li>
  );
}

export function CompanyNeedsAttention({ emphasizedArea }: { emphasizedArea: OperatingArea }) {
  const items = selectNeedsAttention(DEMO_NEEDS_ATTENTION, emphasizedArea);
  return (
    <section className="panel home-needs-attention" aria-label="Company needs attention">
      <HomeSectionHeader
        title="Needs Attention"
        count={items.length}
        help="Strict by design. An item appears only if it is late, not acknowledged, affects a client or shoot within 72 hours, or is behind promised delivery."
      />
      {items.length === 0 ? (
        <div className="home-empty">
          <strong>No company attention items right now.</strong>
          <p>Late, unacknowledged, 72-hour shoot/client risks, and promised delivery misses will appear here.</p>
        </div>
      ) : (
        <ul className="home-needs-attention__list">
          {items.map((item) => (
            <NeedsAttentionRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}
