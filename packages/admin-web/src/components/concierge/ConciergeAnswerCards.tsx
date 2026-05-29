import type { ConciergeAnswerCard } from "../../conciergeTypes";

type Props = {
  cards: ConciergeAnswerCard[];
  onOpenDeepLink: (deepLink: string) => void;
};

export function ConciergeAnswerCards({ cards, onOpenDeepLink }: Props) {
  if (!cards.length) {
    return null;
  }

  return (
    <section className="concierge-answer-grid" aria-label="Concierge answers">
      {cards.map((card) => (
        <article key={card.id} className={`concierge-answer-card concierge-tone concierge-tone--${card.tone}`}>
          <div className="concierge-answer-card__header">
            <div className="concierge-answer-card__eyebrow">{card.kind.replace(/_/g, " ")}</div>
            <div className="concierge-answer-card__confidence">{Math.round(card.confidence * 100)}% confidence</div>
          </div>
          <div className="concierge-answer-card__title">{card.title}</div>
          <div className="concierge-answer-card__summary">{card.summary}</div>
          {card.metrics.length ? (
            <div className="concierge-answer-card__metrics">
              {card.metrics.map((metric) => (
                <div key={`${card.id}-${metric.label}`} className="concierge-answer-card__metric">
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </div>
              ))}
            </div>
          ) : null}
          {card.actions.length ? (
            <div className="concierge-answer-card__actions">
              {card.actions.map((action) => (
                <button
                  key={`${card.id}-${action.key}-${action.deep_link}`}
                  type="button"
                  className={action.key === "open" ? "primary-button" : "secondary-button"}
                  onClick={() => onOpenDeepLink(action.deep_link)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}
