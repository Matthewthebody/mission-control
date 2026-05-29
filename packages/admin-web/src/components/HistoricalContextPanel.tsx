import { useMemo, useState } from "react";
import type { LocationHistoricalContext } from "../types";

type Props = {
  context: LocationHistoricalContext | null | undefined;
  compact?: boolean;
  defaultExpanded?: boolean;
  title?: string;
};

export function HistoricalContextPanel({
  context,
  compact = false,
  defaultExpanded = false,
  title = "Historical Context"
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const hasExpandedContent = useMemo(
    () =>
      Boolean(
        (context?.repeat_pattern_signals.length ?? 0) ||
          (context?.recent_comparable_shoots.length ?? 0) > 1 ||
          (context?.open_follow_ups.length ?? 0) ||
          (context?.setup_visuals.photos.length ?? 0) > 1
      ),
    [context]
  );

  if (!context) {
    return <div className="empty-state empty-state--panel">No historical context is available for this location yet.</div>;
  }

  const quickContext = context.quick_context;
  const lastTimeHere = context.last_time_here;
  const setupPreview = context.setup_visuals.photos[0] ?? null;
  const showExpanded = !compact && expanded;

  return (
    <section className={`historical-context${compact ? " historical-context--compact" : ""}`}>
      <div className="dashboard-panel__header historical-context__header">
        <div>
          <div className="section-title">{title}</div>
          <p className="section-subtitle">
            Curated prior-location intelligence for execution and planning, without dropping users into raw history by default.
          </p>
        </div>
        <div className="historical-context__chips">
          <span className={`meta-pill meta-pill--${mapFreshnessTone(quickContext.freshness_state)}`}>
            {humanizeValue(quickContext.freshness_state)}
          </span>
          <span className="meta-pill">{humanizeTrustSource(quickContext.trust_source)}</span>
        </div>
      </div>

      <div className="historical-context__summary-grid">
        <article className="request-card">
          <strong>{quickContext.first_time_location ? "First-Time Location" : "Repeat Location"}</strong>
          <div className="muted">
            {quickContext.first_time_location
              ? "No prior operational memory is confirmed yet."
              : `${quickContext.total_prior_visits} prior visit${quickContext.total_prior_visits === 1 ? "" : "s"} on record.`}
          </div>
        </article>
        <article className="request-card">
          <strong>{quickContext.last_visit_date ? formatDate(quickContext.last_visit_date) : "No prior visit date"}</strong>
          <div className="muted">Last time here</div>
        </article>
        <article className="request-card">
          <strong>
            {typeof quickContext.recommended_arrival_buffer_minutes === "number"
              ? `${quickContext.recommended_arrival_buffer_minutes} min`
              : "No buffer saved"}
          </strong>
          <div className="muted">Recommended arrival buffer</div>
        </article>
        <article className="request-card">
          <strong>{quickContext.open_issue_count}</strong>
          <div className="muted">Open carry-forward item{quickContext.open_issue_count === 1 ? "" : "s"}</div>
        </article>
      </div>

      {quickContext.first_time_location ? (
        <div className="home-detail-callout">
          <strong>First-time location</strong>
          <div className="muted">
            No prior setup memory is confirmed yet. Setup photos and a post-shoot eval should be captured after this visit.
          </div>
        </div>
      ) : null}

      {quickContext.top_watch_outs.length ? (
        <div className="historical-context__watch-outs">
          <div className="eyebrow">Top Watch-Outs</div>
          <div className="shoot-briefing__chip-row">
            {quickContext.top_watch_outs.slice(0, 3).map((watchOut) => (
              <span key={watchOut} className="meta-pill">
                {watchOut}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="detail-two-column historical-context__compact-grid">
        <div className="request-card">
          <strong>Last Time Here</strong>
          {lastTimeHere ? (
            <div className="dashboard-summary-list">
              <div className="dashboard-summary-row">
                <span className="muted">Date</span>
                <strong>{formatDate(lastTimeHere.shoot_date)}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Shoot Type</span>
                <strong>{lastTimeHere.shoot_type ?? "Unknown"}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Outcome</span>
                <strong>{humanizeOutcome(lastTimeHere.overall_outcome)}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Staffing</span>
                <strong>{humanizeValue(lastTimeHere.staffing_fit ?? "not_recorded")}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Setup Difficulty</span>
                <strong>{humanizeValue(lastTimeHere.setup_difficulty ?? "not_recorded")}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Major Issue</span>
                <strong>{lastTimeHere.major_issue ? "Yes" : "No"}</strong>
              </div>
              <div className="muted historical-context__summary-note">
                {lastTimeHere.next_time_recommendation ?? "No next-time recommendation was captured."}
              </div>
            </div>
          ) : (
            <div className="muted">No prior shoot record is available yet.</div>
          )}
        </div>

        <div className="request-card">
          <strong>Setup Visuals & Memory</strong>
          <div className="muted">
            {context.setup_visuals.top_setup_instruction ?? "No setup instruction is saved yet."}
          </div>
          <div className="muted">
            {context.setup_visuals.top_load_in_instruction ?? "No load-in or parking instruction is saved yet."}
          </div>
          {setupPreview ? (
            <figure className="setup-photo-card historical-context__photo-preview">
              <img src={setupPreview.image_url} alt={setupPreview.caption} />
              <figcaption>
                <strong>{setupPreview.caption}</strong>
                <div className="muted">{formatDateTime(setupPreview.uploaded_at)}</div>
              </figcaption>
            </figure>
          ) : (
            <div className="muted">No prior setup photo is saved yet.</div>
          )}
        </div>
      </div>

      {context.open_follow_ups.length ? (
        <div className="request-card">
          <strong>Open Follow-Ups</strong>
          <div className="timeline-list">
            {context.open_follow_ups.slice(0, compact ? 2 : 3).map((item) => (
              <div key={item.id} className="timeline-item">
                <div className="timeline-dot" />
                <div>
                  <div className="timeline-title">
                    <span className="timeline-type">{item.title}</span>
                    <span className="muted">{item.source_label}</span>
                  </div>
                  <div className="muted">{item.detail}</div>
                  {item.related_shoot_name || item.related_shoot_date ? (
                    <div className="muted">
                      {[item.related_shoot_name, item.related_shoot_date ? formatDate(item.related_shoot_date) : null].filter(Boolean).join(" | ")}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!compact && hasExpandedContent ? (
        <div className="historical-context__toggle-row">
          <button className="secondary-button" type="button" onClick={() => setExpanded((current) => !current)}>
            {showExpanded ? "Show Summary Only" : "Show More History"}
          </button>
        </div>
      ) : null}

      {showExpanded ? (
        <div className="dashboard-stack">
          {context.repeat_pattern_signals.length ? (
            <div className="request-card">
              <strong>Repeat Pattern Signals</strong>
              <div className="timeline-list">
                {context.repeat_pattern_signals.map((pattern) => (
                  <div key={pattern.key} className="timeline-item">
                    <div className="timeline-dot" />
                    <div>
                      <div className="timeline-title">
                        <span className="timeline-type">{pattern.label}</span>
                        <span className={`home-tone-chip home-tone-chip--${mapPatternTone(pattern.severity)}`}>{pattern.evidence_count} hits</span>
                      </div>
                      <div className="muted">{pattern.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {context.recent_comparable_shoots.length ? (
            <div className="request-card">
              <strong>Recent Comparable Shoots</strong>
              <div className="timeline-list">
                {context.recent_comparable_shoots.map((shoot) => (
                  <div key={shoot.id} className="timeline-item">
                    <div className="timeline-dot" />
                    <div>
                      <div className="timeline-title">
                        <span className="timeline-type">{shoot.shoot_name}</span>
                        <span className="muted">{formatDate(shoot.shoot_date)} | {shoot.shoot_type}</span>
                      </div>
                      <div className="muted">
                        {[
                          humanizeOutcome(shoot.overall_outcome),
                          humanizeValue(shoot.staffing_fit ?? "not_recorded"),
                          humanizeValue(shoot.setup_difficulty ?? "not_recorded")
                        ].join(" | ")}
                      </div>
                      <div className="muted">{shoot.next_time_recommendation ?? "No next-time recommendation was saved."}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {context.setup_visuals.photos.length > 1 ? (
            <div className="request-card">
              <strong>Setup Photo Gallery</strong>
              <div className="setup-photo-grid">
                {context.setup_visuals.photos.map((photo) => (
                  <figure key={photo.id} className="setup-photo-card">
                    <img src={photo.image_url} alt={photo.caption} />
                    <figcaption>
                      <strong>{photo.caption}</strong>
                      <div className="muted">
                        {[photo.photo_category ? humanizeValue(photo.photo_category) : null, formatDateTime(photo.uploaded_at)].filter(Boolean).join(" | ")}
                      </div>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function humanizeValue(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function humanizeOutcome(
  value: "smooth" | "minor_issues" | "major_issues" | "needs_leadership_review" | null | undefined
) {
  if (!value) {
    return "Not recorded";
  }
  return humanizeValue(value);
}

function humanizeTrustSource(value: LocationHistoricalContext["quick_context"]["trust_source"]) {
  switch (value) {
    case "reviewed_memory":
      return "Reviewed memory";
    case "repeated_pattern":
      return "Repeated pattern";
    case "recent_eval":
      return "Recent eval";
    default:
      return "No history yet";
  }
}

function mapFreshnessTone(value: LocationHistoricalContext["quick_context"]["freshness_state"]) {
  switch (value) {
    case "fresh":
      return "success";
    case "aging":
      return "warning";
    default:
      return "critical";
  }
}

function mapPatternTone(value: "info" | "warning" | "high") {
  switch (value) {
    case "high":
      return "action_needed";
    case "warning":
      return "heads_up";
    default:
      return "neutral";
  }
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Not recorded";
  }
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? value : fallback.toLocaleDateString();
  }
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "Date pending";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
