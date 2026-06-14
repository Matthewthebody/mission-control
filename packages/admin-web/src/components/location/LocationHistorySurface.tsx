import { useEffect, useState } from "react";
import { getShootLocationIntelligence } from "../../services/locationApi";
import type { ShootLocationIntelligence } from "../../types";
import { HistoricalContextPanel } from "../HistoricalContextPanel";

// Surfaces the real, seeded location intelligence (getShootLocationIntelligence)
// on a job's location. Two variants:
//  - "detail"  → a Job Detail card with the read-only HistoricalContextPanel.
//  - "preview" → a compact "known history available" strip for Job Intake.
// Read-only by design: no editing of location notes in this slice, no fake controls.

type Variant = "detail" | "preview";
type LoadState = "idle" | "loading" | "ready" | "error";

function formatVisitDate(value: string | null): string {
  if (!value) {
    return "unknown date";
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function LocationHistorySurface({
  token,
  locationName,
  locationAddress,
  variant
}: {
  token: string;
  locationName: string | null | undefined;
  locationAddress?: string | null;
  variant: Variant;
}) {
  const [status, setStatus] = useState<LoadState>("idle");
  const [intelligence, setIntelligence] = useState<ShootLocationIntelligence | null>(null);

  const name = locationName?.trim() ?? "";

  useEffect(() => {
    if (!name) {
      setStatus("idle");
      setIntelligence(null);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    const run = () => {
      void getShootLocationIntelligence(token, {
        shootLocationName: name,
        shootLocationAddress: locationAddress ?? null
      })
        .then((response) => {
          if (!cancelled) {
            setIntelligence(response);
            setStatus("ready");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setIntelligence(null);
            setStatus("error");
          }
        });
    };
    // Debounce the intake preview so selecting/typing a location does not spam the
    // endpoint; the detail panel fetches once immediately.
    const timer = variant === "preview" ? window.setTimeout(run, 250) : (run(), undefined);
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [token, name, locationAddress, variant]);

  const context = intelligence?.historical_context ?? null;
  const hasHistory =
    Boolean(context) &&
    context!.quick_context.first_time_location === false &&
    context!.quick_context.total_prior_visits > 0;

  // No known location → nothing to remember.
  if (!name) {
    return null;
  }

  if (variant === "preview") {
    // Keep intake calm: surface only when there is real history.
    if (!hasHistory || !context) {
      return null;
    }
    const quick = context.quick_context;
    const notes = quick.top_watch_outs.slice(0, 2);
    return (
      <div className="location-history-preview" aria-label="Known location history">
        <div className="location-history-preview__head">
          <span className="location-history-preview__badge">Known history available</span>
          <span className="location-history-preview__meta">
            {quick.total_prior_visits} previous {quick.total_prior_visits === 1 ? "shoot" : "shoots"}
            {quick.last_visit_date ? ` · last visit ${formatVisitDate(quick.last_visit_date)}` : ""}
          </span>
        </div>
        {notes.length > 0 ? (
          <ul className="location-history-preview__notes">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <section className="shared-job-detail__list-card location-history-detail" aria-label="Location intelligence">
      <h3>Location Intelligence</h3>
      <p className="shared-job-sidebar__muted">{name}</p>
      {status === "loading" ? (
        <p className="shared-job-sidebar__muted">Checking what we remember about this place…</p>
      ) : status === "error" ? (
        <div className="empty-state empty-state--panel">Location history is unavailable right now. Refresh to try again.</div>
      ) : hasHistory && context ? (
        <HistoricalContextPanel context={context} title="What we know about this place" />
      ) : (
        <div className="empty-state empty-state--panel">No prior location history has been recorded yet.</div>
      )}
    </section>
  );
}
