import { useEffect, useMemo, useState } from "react";
import { buildLocationHash, getShootLocationIntelligence, linkShootLocation } from "../services/locationApi";
import { HistoricalContextPanel } from "./HistoricalContextPanel";
import { LocationSubmissionActions } from "./LocationSubmissionActions";
import type { SessionUser, ShootLocationIntelligence } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  intelligence: ShootLocationIntelligence | null | undefined;
  context: {
    shootId?: string | null;
    outlookEventId?: string | null;
    outlookCalendarId?: string | null;
    shootCode?: string | null;
    shootName?: string | null;
    shootDate?: string | null;
    eventSubject?: string | null;
    eventLocation?: string | null;
    shootLocationName?: string | null;
    shootLocationAddress?: string | null;
    photographerName?: string | null;
  };
  onRefresh?: () => Promise<void> | void;
  compact?: boolean;
};

export function LocationIntelligencePanel({ token, currentUser, intelligence, context, onRefresh, compact = false }: Props) {
  const [current, setCurrent] = useState<ShootLocationIntelligence | null>(intelligence ?? null);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setCurrent(intelligence ?? null);
    setSelectedLocationId(intelligence?.matched_location_id ?? intelligence?.suggestions[0]?.location_id ?? "");
  }, [intelligence]);

  const canRelink = currentUser.permissions.includes("shoot.update");
  const location = current?.location ?? null;
  const topSuggestion = current?.suggestions[0] ?? null;
  const showSuggestions = !location || (current?.suggestions.length ?? 0) > 1;

  async function refreshPanel() {
    if (onRefresh) {
      await onRefresh();
      return;
    }
    const refreshed = await getShootLocationIntelligence(token, {
      shootId: context.shootId ?? null,
      outlookEventId: context.outlookEventId ?? null,
      outlookCalendarId: context.outlookCalendarId ?? null,
      shootCode: context.shootCode ?? null,
      eventSubject: context.eventSubject ?? null,
      eventLocation: context.eventLocation ?? null,
      shootLocationName: context.shootLocationName ?? null,
      shootLocationAddress: context.shootLocationAddress ?? null
    });
    setCurrent(refreshed);
  }

  async function saveLocationLink() {
    if (!selectedLocationId) {
      setError("Pick a location before saving a manual match.");
      return;
    }
    setLinking(true);
    setError("");
    setNotice("");
    try {
      const next = await linkShootLocation(token, {
        location_id: selectedLocationId,
        shoot_id: context.shootId ?? null,
        outlook_event_id: context.outlookEventId ?? null,
        outlook_calendar_id: context.outlookCalendarId ?? null,
        shoot_code: context.shootCode ?? null,
        event_subject: context.eventSubject ?? null,
        event_location: context.eventLocation ?? null,
        confidence: 1
      });
      setCurrent(next);
      setNotice("Location match saved. This Outlook shoot will stay linked to the selected guide entry.");
      if (onRefresh) {
        await onRefresh();
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "We couldn't save that location match.");
    } finally {
      setLinking(false);
    }
  }

  const guideHash = useMemo(() => {
    if (!location?.id) {
      return "#directory/locations";
    }
    return buildLocationHash(location.id, {
      shootId: context.shootId ?? null,
      outlookEventId: context.outlookEventId ?? null,
      outlookCalendarId: context.outlookCalendarId ?? null,
      shootCode: context.shootCode ?? null,
      shootName: context.shootName ?? context.eventSubject ?? null,
      shootDate: context.shootDate ?? null,
      eventSubject: context.eventSubject ?? null,
      eventLocation: context.eventLocation ?? null
    });
  }, [context.eventLocation, context.eventSubject, context.outlookCalendarId, context.outlookEventId, context.shootCode, context.shootDate, context.shootId, context.shootName, location?.id]);

  return (
    <section className={`location-intelligence panel${compact ? " location-intelligence--compact" : ""}`}>
      <div className="section-title">Historical Context</div>
      <p className="section-subtitle">Curated setup memory, recent eval signals, and reusable location guidance stay attached to the shoot instead of living in tribal knowledge.</p>

      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      {current?.missing_setup_photo_alert ? (
        <div className="drawer-alert drawer-alert--high">
          <div className="drawer-alert__dot" />
          <div>
            <div className="drawer-alert__title">
              <span className="drawer-alert__type">Missing setup photo</span>
            </div>
            <div className="muted">{current.missing_setup_photo_alert.message}</div>
          </div>
        </div>
      ) : null}

      {location ? (
        <>
          <div className="location-intelligence__summary">
            <div>
              <div className="eyebrow">{humanizeLabel(current?.match_source ?? "none")} match</div>
              <strong>{location.name}</strong>
              {location.address ? <div className="muted">{location.address}</div> : null}
              {location.location_details ? <div className="muted">{location.location_details}</div> : null}
            </div>
            <div className="location-intelligence__stats">
              <span className="metric-pill">Photos {location.photo_count}</span>
              <span className="metric-pill">Evals {location.stats.evaluation_count}</span>
              <span className="metric-pill">Avg {location.stats.avg_rating ?? "—"}</span>
              <span className="metric-pill">On Time {location.stats.on_time_percent}%</span>
              <span className="metric-pill">Easy Access {location.stats.easy_access_percent}%</span>
            </div>
          </div>

          {location.latest_recommendation ? (
            <div className="request-card">
              <strong>Latest recommendation</strong>
              <div className="muted">{location.latest_recommendation}</div>
            </div>
          ) : null}

          <div className="location-actions__row">
            <button className="secondary-button" onClick={() => {
              window.location.hash = guideHash;
            }}>
              View Full Location Guide
            </button>
            {location.navigation_url ? (
              <a className="secondary-button" href={location.navigation_url} target="_blank" rel="noreferrer">
                Open in Maps
              </a>
            ) : null}
          </div>

          <LocationSubmissionActions
            token={token}
            currentUser={currentUser}
            location={location}
            context={{
              shootId: context.shootId ?? null,
              outlookEventId: context.outlookEventId ?? null,
              shootName: context.shootName ?? context.eventSubject ?? location.name,
              shootDate: context.shootDate ?? new Date().toISOString().slice(0, 10),
              photographerName: context.photographerName ?? currentUser.fullName
            }}
            openAlertId={current?.missing_setup_photo_alert?.id ?? null}
            canOverride={currentUser.permissions.includes("alerts.resolve")}
            onRefresh={() => refreshPanel()}
            compact={compact}
          />

          <HistoricalContextPanel
            context={current?.historical_context ?? null}
            compact={compact}
            defaultExpanded={!compact && canRelink}
          />
        </>
      ) : (
        <div className="empty-state empty-state--panel">No confident location guide match is attached to this shoot yet.</div>
      )}

      {showSuggestions ? (
        <div className="request-card">
          <strong>{location ? "Correct or confirm the location match" : "Suggested matches"}</strong>
          <div className="muted">
            {topSuggestion ? topSuggestion.reason : "Leadership can save a manual location match if the Outlook event text does not map cleanly."}
          </div>
          <label className="filter-field">
            <span>Location Guide Entry</span>
            <select value={selectedLocationId} onChange={(event) => setSelectedLocationId(event.target.value)}>
              <option value="">Select a location</option>
              {(current?.suggestions ?? []).map((candidate) => (
                <option key={candidate.location_id} value={candidate.location_id}>
                  {candidate.name} {candidate.address ? `| ${candidate.address}` : ""} ({Math.round(candidate.confidence * 100)}%)
                </option>
              ))}
            </select>
          </label>
          {canRelink ? (
            <div className="location-actions__row">
              <button className="primary-button" disabled={linking || !selectedLocationId} onClick={() => void saveLocationLink()}>
                {linking ? "Saving..." : "Save Location Match"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function humanizeLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}
