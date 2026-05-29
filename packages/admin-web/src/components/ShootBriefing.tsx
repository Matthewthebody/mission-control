import type { ShootBriefingViewModel } from "../services/shootHotSheet";
import type { HomeWeatherTravelItem } from "../types";
import { HistoricalContextPanel } from "./HistoricalContextPanel";

type PanelProps = {
  briefing: ShootBriefingViewModel | null;
  onClose?: () => void;
  title?: string;
  loading?: boolean;
};

type BodyProps = {
  briefing: ShootBriefingViewModel;
  travelWatchItems?: HomeWeatherTravelItem[];
  hidePrioritySection?: boolean;
};

export function ShootBriefingPanel({ briefing, onClose, title = "Operational Briefing", loading = false }: PanelProps) {
  return (
    <aside className="panel shoot-briefing-panel">
      <div className="shoot-briefing-panel__header">
        <div>
          <div className="eyebrow">Shoot Briefing</div>
          <h3>{title}</h3>
          <p className="section-subtitle">
            {briefing ? `${briefing.shootCode} | ${briefing.title}` : "Select a shoot card to open the operational briefing."}
          </p>
        </div>
        {onClose ? (
          <button className="secondary-button" type="button" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
      {loading ? (
        <div className="empty-state empty-state--panel">Loading the operational briefing...</div>
      ) : briefing ? (
        <ShootBriefingBody briefing={briefing} />
      ) : (
        <div className="empty-state empty-state--panel">Choose a shoot to see timing, travel, staffing, notes, history, and files.</div>
      )}
    </aside>
  );
}

export function ShootBriefingBody({ briefing, travelWatchItems = [], hidePrioritySection = false }: BodyProps) {
  const leadPhoneHref = briefing.leadPhone ? toPhoneHref(briefing.leadPhone) : "";
  return (
    <div className="shoot-briefing">
      {!hidePrioritySection && (briefing.priorityLevel || briefing.profitabilityDisplay) ? (
        <section className="shoot-briefing__section">
          <div className="section-title">Priority</div>
          <div className="shoot-briefing__stack">
            {briefing.priorityLevel && briefing.priorityLabel ? (
              <div className="shoot-briefing__row">
                <span>Priority Signal</span>
                <strong>{briefing.priorityLabel}</strong>
              </div>
            ) : null}
            {briefing.profitabilityDisplay ? (
              <div className="shoot-briefing__row">
                <span>Profitability Signal</span>
                <strong>{briefing.profitabilityDisplay}</strong>
              </div>
            ) : null}
            {briefing.priorityReasons.length ? (
              <div className="shoot-briefing__chip-row">
                {briefing.priorityReasons.map((reason) => (
                  <span key={reason} className="meta-pill">
                    {reason}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="shoot-briefing__section">
        <div className="section-title">Timing</div>
        <div className="shoot-briefing__grid">
          <div className="shoot-briefing__metric">
            <span>Arrival</span>
            <strong>{briefing.arrivalLabel}</strong>
          </div>
          <div className="shoot-briefing__metric">
            <span>Shoot</span>
            <strong>{briefing.shootLabel}</strong>
          </div>
          <div className="shoot-briefing__metric">
            <span>Teardown</span>
            <strong>{briefing.teardownLabel}</strong>
          </div>
        </div>
      </section>

      <section className="shoot-briefing__section">
        <div className="section-title">Weather &amp; Travel</div>
        <div className="shoot-briefing__stack">
          <div className="shoot-briefing__row">
            <span>Address</span>
            <strong>{briefing.fullAddress ?? "Address pending"}</strong>
          </div>
          <div className="shoot-briefing__row">
            <span>Drive Time</span>
            <strong>{briefing.driveTimeLabel ?? "Drive time pending"}</strong>
          </div>
          {briefing.travelSummary ? (
            <div className="shoot-briefing__callout">
              <strong>Travel Note</strong>
              <div className="muted">{briefing.travelSummary}</div>
            </div>
          ) : null}
          {briefing.weatherSummary ? (
            <div className={`shoot-briefing__callout shoot-briefing__callout--${briefing.weatherTone ?? "warning"}`}>
              <strong>Weather Alert</strong>
              <div className="muted">{briefing.weatherDetail ?? briefing.weatherSummary}</div>
            </div>
          ) : null}
          {travelWatchItems.length ? (
            <div>
              <div className="eyebrow">Weather &amp; Travel Watch</div>
              <div className="shoot-briefing__watch-list">
                {travelWatchItems.map((item) => (
                  <div key={`${item.kind}-${item.shoot_id}`} className="shoot-briefing__watch-row">
                    <span className={`home-tone-chip home-tone-chip--${item.severity}`}>{item.kind === "weather" ? "Weather" : "Travel"}</span>
                    <div>
                      <strong>{item.summary}</strong>
                      <div className="muted">{item.location_name} | {item.time_label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="shoot-briefing__actions">
            {briefing.mapsUrl ? (
              <a className="secondary-button" href={briefing.mapsUrl} target="_blank" rel="noreferrer">
                Open in Maps
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <section className="shoot-briefing__section">
        <div className="section-title">People</div>
        <div className="shoot-briefing__stack">
          <div className="shoot-briefing__row">
            <span>Senior Photographer</span>
            <strong>{briefing.leadName ?? "Lead pending"}</strong>
          </div>
          {briefing.leadPhone ? (
            <div className="shoot-briefing__actions">
              <a className="secondary-button" href={`tel:${leadPhoneHref}`}>
                Call Lead
              </a>
              <a className="secondary-button" href={`sms:${leadPhoneHref}`}>
                Text Lead
              </a>
            </div>
          ) : null}
          <div className="shoot-briefing__row">
            <span>Photographer Count</span>
            <strong>{briefing.photographerCountLabel}</strong>
          </div>
          {briefing.contacts.length ? (
            <div className="shoot-briefing__contact-list">
              {briefing.contacts.map((contact) => (
                <div key={`${contact.label}-${contact.name}`} className="shoot-briefing__contact-card">
                  <span>{contact.label}</span>
                  <strong>{contact.name}</strong>
                  {contact.phone ? <div className="muted">{contact.phone}</div> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">No site contacts are attached yet.</div>
          )}
        </div>
      </section>

      <section className="shoot-briefing__section">
        <div className="section-title">Notes and Equipment</div>
        <div className="shoot-briefing__stack">
          {briefing.notes.length ? (
            <div>
              <div className="eyebrow">Special Notes</div>
              <ul className="detail-bullet-list">
                {briefing.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {briefing.customNeeds.length ? (
            <div>
              <div className="eyebrow">Custom Needs</div>
              <ul className="detail-bullet-list">
                {briefing.customNeeds.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <div className="eyebrow">Special Gear</div>
            {briefing.specialGear.length ? (
              <div className="shoot-briefing__chip-row">
                {briefing.specialGear.map((gear) => (
                  <span key={gear} className="meta-pill">
                    {gear}
                  </span>
                ))}
              </div>
            ) : (
              <div className="muted">No special gear is flagged for this shoot.</div>
            )}
          </div>
          {briefing.missingFields.length ? (
            <div className="shoot-briefing__callout shoot-briefing__callout--warning">
              <strong>Missing Data</strong>
              <div className="muted">{briefing.missingFields.join(", ")}</div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="shoot-briefing__section">
        <div className="section-title">History</div>
        <div className="shoot-briefing__stack">
          {briefing.historicalContext ? (
            <HistoricalContextPanel
              context={briefing.historicalContext}
              compact
              title="Historical Context"
            />
          ) : briefing.recurringIssues.length || briefing.bestPractices.length || briefing.photos.length ? (
            <>
              {briefing.recurringIssues.length ? (
                <div>
                  <div className="eyebrow">Recurring Issues</div>
                  <ul className="detail-bullet-list">
                    {briefing.recurringIssues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {briefing.bestPractices.length ? (
                <div>
                  <div className="eyebrow">Best Practices</div>
                  <ul className="detail-bullet-list">
                    {briefing.bestPractices.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {briefing.photos.length ? (
                <div className="shoot-briefing__gallery">
                  {briefing.photos.slice(0, 2).map((photo) => (
                    <figure key={photo.id} className="setup-photo-card">
                      <img src={photo.url} alt={photo.caption} />
                      <figcaption>{photo.caption}</figcaption>
                    </figure>
                  ))}
                </div>
              ) : (
                <div className="muted">No historical reference photos are attached yet.</div>
              )}
            </>
          ) : (
            <div className="muted">No reusable historical context is attached yet.</div>
          )}
        </div>
      </section>

      <section className="shoot-briefing__section">
        <div className="section-title">Files</div>
        <div className="shoot-briefing__file-list">
          {briefing.files.map((file) => (
            <div key={file.id} className="shoot-briefing__file-card">
              <div>
                <strong>{file.label}</strong>
                <div className="muted">{file.kind}</div>
              </div>
              <div className="shoot-briefing__actions">
                {file.previewable ? (
                  <a className="secondary-button" href={file.href} target="_blank" rel="noreferrer">
                    Preview
                  </a>
                ) : null}
                <a className="secondary-button" href={file.href} download>
                  Download
                </a>
              </div>
            </div>
          ))}
          {!briefing.files.length ? <div className="muted">No files are attached yet.</div> : null}
        </div>
      </section>
    </div>
  );
}

function toPhoneHref(value: string) {
  return value.replace(/[^\d+]/g, "");
}
