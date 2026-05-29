type ScaffoldCard = {
  id: string;
  label: string;
  description: string;
  hash: string;
};

type ScaffoldAction = {
  label: string;
  hash: string;
};

type Props = {
  eyebrow: string;
  title: string;
  description: string;
  cards?: ScaffoldCard[];
  note?: string;
  primaryAction?: ScaffoldAction;
  secondaryAction?: ScaffoldAction;
};

export function ShellRouteScaffold({
  eyebrow,
  title,
  description,
  cards = [],
  note,
  primaryAction,
  secondaryAction
}: Props) {
  return (
    <div className="workspace-shell shell-route-scaffold">
      <section className="page-intro page-intro--workspace panel">
        <div className="page-intro__body">
          <div className="eyebrow">{eyebrow}</div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {primaryAction || secondaryAction ? (
          <div className="page-intro-actions page-intro-actions--compact">
            {secondaryAction ? (
              <button className="secondary-button" type="button" onClick={() => { window.location.hash = secondaryAction.hash; }}>
                {secondaryAction.label}
              </button>
            ) : null}
            {primaryAction ? (
              <button type="button" onClick={() => { window.location.hash = primaryAction.hash; }}>
                {primaryAction.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {cards.length ? (
        <section className="shell-scaffold-grid">
          {cards.map((card) => (
            <button
              key={card.id}
              type="button"
              className="panel shell-scaffold-card"
              onClick={() => {
                window.location.hash = card.hash;
              }}
            >
              <div className="eyebrow">{card.label}</div>
              <strong>{card.label}</strong>
              <p>{card.description}</p>
            </button>
          ))}
        </section>
      ) : null}

      {note ? (
        <section className="panel shell-scaffold-note">
          <div className="section-title">Source Of Truth</div>
          <p className="section-subtitle">{note}</p>
        </section>
      ) : null}
    </div>
  );
}
