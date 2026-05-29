import { useEffect, useState } from "react";
import { ApiClientError } from "../api";
import { PermissionGate } from "../components/PermissionGate";
import { humanizeToken } from "../components/sports/SportsPrimitives";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { canAccessSportsSettings } from "../permissions";
import { getSportsSettings } from "../services/sportsApi";
import type { SportsSettingsResponse } from "../sportsTypes";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

export function SportsSettings({ token, currentUser }: Props) {
  const [payload, setPayload] = useState<SportsSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canAccessSportsSettings(currentUser)) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void getSportsSettings(token)
      .then((response) => {
        if (!cancelled) {
          setPayload(response);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load sports settings right now.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser, token]);

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading sports settings" summary="Opening checklist templates, product presets, thresholds, and role visibility notes." />;
  }

  return (
    <section className="sports-workspace">
      <WorkspacePageHeader
        eyebrow="Sports"
        title="Sports Settings"
        summary="Leadership and admin controls for sports checklist templates, saved view governance, product presets, watch thresholds, and role visibility notes."
      />
      <PermissionGate
        allowed={canAccessSportsSettings(currentUser)}
        fallback={<WorkspaceEmptyState title="Sports settings are leadership and admin only" summary="This route is wired, but only leadership and admin users can manage Sports settings." />}
      >
        {error ? <div className="error-banner">{error}</div> : null}
        {payload ? (
          <div className="sports-grid sports-grid--two">
            <section className="panel sports-detail-card">
              <h3>Checklist Templates</h3>
              <div className="sports-mini-list">
                {payload.checklist_templates.map((template) => (
                  <div key={`${template.sports_job_type}-${template.section}`} className="sports-mini-list__item">
                    <strong>{humanizeToken(template.sports_job_type)} | {humanizeToken(template.section)}</strong>
                    <span>{template.items.length} seeded items</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="panel sports-detail-card">
              <h3>Product Presets</h3>
              <div className="sports-chip-list">
                {payload.product_type_presets.map((preset) => (
                  <span key={preset} className="sports-status-pill sports-status-pill--info">{humanizeToken(preset)}</span>
                ))}
              </div>
            </section>
            <section className="panel sports-detail-card">
              <h3>Watch Thresholds</h3>
              <div className="sports-mini-list">
                {payload.watch_flag_thresholds.map((threshold) => (
                  <div key={threshold.key} className="sports-mini-list__item">
                    <strong>{threshold.label}</strong>
                    <span>{threshold.hours} hour threshold</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="panel sports-detail-card">
              <h3>Role Visibility Notes</h3>
              <ul className="sports-note-list">
                {payload.role_visibility_notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </section>
          </div>
        ) : (
          <WorkspaceEmptyState title="Sports settings are unavailable" summary="The settings contract is wired, but this tenant is not currently returning data." />
        )}
      </PermissionGate>
    </section>
  );
}
