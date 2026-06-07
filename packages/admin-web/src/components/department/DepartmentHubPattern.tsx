import type { ReactNode } from "react";

export type DepartmentHubTone = "success" | "info" | "warning" | "danger" | "neutral";

export type DepartmentHubCard = {
  label: string;
  value?: ReactNode;
  detail: string;
  href?: string;
  tone?: DepartmentHubTone;
  actionLabel?: string;
};

type Props = {
  department: string;
  openFirst: DepartmentHubCard[];
  attention: DepartmentHubCard[];
  weekly: DepartmentHubCard[];
  queues: DepartmentHubCard[];
  notes?: ReactNode;
};

export function DepartmentHubPattern({ department, openFirst, attention, weekly, queues, notes }: Props) {
  return (
    <section className="department-hub-pattern" aria-label={`${department} department hub pattern`}>
      <DepartmentHubSection title="Open First" summary="The highest-signal work to scan before opening the full department queue.">
        <div className="department-hub-pattern__card-grid department-hub-pattern__card-grid--four">
          {openFirst.slice(0, 4).map((card) => (
            <DepartmentHubCardView key={`open-${card.label}`} card={card} />
          ))}
        </div>
      </DepartmentHubSection>

      <DepartmentHubSection title="Attention Needed" summary="Concise department triage with the issue, why it matters, and the next safe place to act.">
        <div className="department-hub-pattern__attention-grid">
          {attention.map((card) => (
            <DepartmentHubCardView key={`attention-${card.label}`} card={card} compact />
          ))}
        </div>
      </DepartmentHubSection>

      <DepartmentHubSection title="This Week's Work" summary="Weekly volume, deadlines, staffing or coverage, and blocked or waiting work.">
        <div className="department-hub-pattern__card-grid">
          {weekly.map((card) => (
            <DepartmentHubCardView key={`weekly-${card.label}`} card={card} compact />
          ))}
        </div>
      </DepartmentHubSection>

      <DepartmentHubSection title="Work Queues" summary="Operational queues that take people into the real work instead of creating another tracker.">
        <div className="department-hub-pattern__queue-grid">
          {queues.map((card) => (
            <DepartmentHubCardView key={`queue-${card.label}`} card={card} queue />
          ))}
        </div>
      </DepartmentHubSection>

      {notes ? <div className="department-hub-pattern__notes">{notes}</div> : null}
    </section>
  );
}

function DepartmentHubSection({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return (
    <section className="panel department-hub-pattern__section">
      <div className="department-hub-pattern__section-heading">
        <div className="section-title">{title}</div>
        <p className="section-subtitle">{summary}</p>
      </div>
      {children}
    </section>
  );
}

function DepartmentHubCardView({ card, compact = false, queue = false }: { card: DepartmentHubCard; compact?: boolean; queue?: boolean }) {
  const className = [
    "department-hub-pattern__card",
    `department-hub-pattern__card--${card.tone ?? "neutral"}`,
    compact ? "department-hub-pattern__card--compact" : "",
    queue ? "department-hub-pattern__card--queue" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      <span>{card.label}</span>
      {card.value !== undefined ? <strong>{card.value}</strong> : null}
      <small>{card.detail}</small>
      {card.href ? <em>{card.actionLabel ?? (queue ? "View Queue" : "Open")}</em> : <em>Status only</em>}
    </>
  );
  if (card.href) {
    return (
      <a className={className} href={card.href}>
        {content}
      </a>
    );
  }
  return <article className={className}>{content}</article>;
}
