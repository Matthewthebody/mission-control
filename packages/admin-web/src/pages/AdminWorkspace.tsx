import { useEffect, useMemo, useState } from "react";
import { OperationalDetailSection } from "../components/OperationalDetailSection";
import { OperationalPreviewCard } from "../components/OperationalPreviewCard";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceFilterToolbar } from "../components/workspace/WorkspaceFilterToolbar";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { canAccessRoute, canAccessSection } from "../permissions";
import {
  getAdminWorkspace,
  type AdminWorkspaceItem,
  type AdminWorkspaceResponse,
  type AdminWorkspaceSection,
  type AdminWorkspaceSummaryCard
} from "../services/adminWorkspace";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  routeId?: string;
};

type SectionKey =
  | "roles_access"
  | "integrations"
  | "automations"
  | "settings_reference"
  | "audit_security"
  | "review_tools";

export function AdminWorkspace({ token, currentUser, routeId = "admin" }: Props) {
  const canViewWorkspace = canAccessSection(currentUser, "admin");
  const canOpenHome = canAccessRoute(currentUser, "dashboard");
  const [date, setDate] = useState(getLocalDateString());
  const [workspace, setWorkspace] = useState<AdminWorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const focusedSection = useMemo(() => getFocusedSection(routeId), [routeId]);

  async function load(options: { quiet?: boolean } = {}) {
    if (!canViewWorkspace) {
      setWorkspace(null);
      setLoading(false);
      setError("");
      return;
    }
    if (!options.quiet) {
      setLoading(true);
    }
    try {
      const payload = await getAdminWorkspace(token, { date });
      setWorkspace(payload);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load the Admin workspace.");
    } finally {
      if (!options.quiet) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void load();
  }, [canViewWorkspace, date, token]);

  useEffect(() => {
    if (!workspace || !canViewWorkspace) {
      return;
    }
    const interval = window.setInterval(() => {
      void load({ quiet: true });
    }, Math.max(workspace.refresh_interval_seconds, 45) * 1000);
    return () => window.clearInterval(interval);
  }, [canViewWorkspace, date, token, workspace?.refresh_interval_seconds]);

  useEffect(() => {
    const onRefresh = () => {
      void load({ quiet: true });
    };
    window.addEventListener("focus", onRefresh);
    return () => window.removeEventListener("focus", onRefresh);
  }, [canViewWorkspace, date, token]);

  if (!canViewWorkspace) {
    return (
      <section className="panel admin-workspace admin-workspace--limited">
        <WorkspaceEmptyState
          title="Admin Workspace"
          summary="Admin holds roles, integrations, settings, audit posture, and admin-only review work. It stays out of everyday operational pages and your personal settings."
          actions={
            <>
              {canOpenHome ? (
                <button className="secondary-button" type="button" onClick={() => (window.location.hash = "#home")}>
                  Open Home
                </button>
              ) : null}
              <button className="primary-button" type="button" onClick={() => (window.location.hash = "#admin/roles")}>
                Open Roles & Access
              </button>
            </>
          }
        />
      </section>
    );
  }

  const sections: Array<{ key: SectionKey; section: AdminWorkspaceSection }> = workspace
    ? ([
        { key: "roles_access", section: workspace.roles_access },
        { key: "integrations", section: workspace.integrations },
        { key: "automations", section: workspace.automations },
        { key: "settings_reference", section: workspace.settings_reference },
        { key: "audit_security", section: workspace.audit_security },
        { key: "review_tools", section: workspace.review_tools }
      ] as Array<{ key: SectionKey; section: AdminWorkspaceSection }>).filter((entry) => entry.section.visible)
    : [];

  return (
    <div className="admin-workspace">
      <WorkspacePageHeader
        eyebrow="Admin"
        title="Admin workspace"
        summary="Roles, integrations, settings, audit posture, and admin-only review work live here, kept out of everyday business pages and personal settings."
        meta={
          workspace
            ? [
                { label: `Updated ${formatRefreshTime(workspace.generated_at)}`, tone: "info" },
                { label: `Mode: ${workspace.role_mode === "manage" ? "Manage" : "Read Only"}`, tone: workspace.role_mode === "manage" ? "success" : "neutral" }
              ]
            : []
        }
        compact
        className="admin-workspace__hero"
      />

      <WorkspaceFilterToolbar>
        <div className="workspace-toolbar__group">
          <label className="filter-field">
            <span>Anchor Date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
        </div>
        <div className="workspace-toolbar__actions">
          <button className="secondary-button" type="button" onClick={() => void load()}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </WorkspaceFilterToolbar>

      {error ? <div className="error-banner">{error}</div> : null}

      {loading && !workspace ? (
        <WorkspaceLoadingBlock
          title="Loading Admin"
          summary="Pulling roles, integrations, settings, security posture, and admin review work into one control workspace."
        />
      ) : null}

      {workspace ? (
        <>
          <div className="admin-workspace__summary">
            {workspace.summary_strip.map((card) => (
              <button
                key={card.id}
                type="button"
                className={`metric-card metric-card--button admin-summary-card admin-summary-card--${card.tone}`}
                onClick={() => (window.location.hash = card.action_hash)}
              >
                <div className="metric-card__label">{card.label}</div>
                <strong className="metric-card__value">{card.count}</strong>
                <div className="muted">{card.detail}</div>
              </button>
            ))}
          </div>

          {sections.map(({ key, section }, index) => (
            <section key={key} className="panel dashboard-panel admin-workspace__block">
              <OperationalDetailSection
                title={section.headline}
                summary={section.summary_line}
                badge={section.helper_text ?? (key === focusedSection ? "Focused" : "Admin")}
                defaultOpen={shouldOpenSection(key, focusedSection, index)}
                actions={
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      window.location.hash = section.action_hash;
                    }}
                  >
                    {section.action_label}
                  </button>
                }
              >
                <div className="admin-workspace__cards">
                  {section.cards.map((card) => (
                    <SummaryCard key={card.id} card={card} />
                  ))}
                </div>
                <div className="ops-preview-list">
                  {section.items.length ? (
                    section.items.map((item) => <SectionItemCard key={item.id} item={item} />)
                  ) : (
                    <div className="empty-state empty-state--panel">Nothing in this section is actively demanding admin follow-through right now.</div>
                  )}
                </div>
              </OperationalDetailSection>
            </section>
          ))}
        </>
      ) : null}
    </div>
  );
}

function SummaryCard({ card }: { card: AdminWorkspaceSummaryCard }) {
  return (
    <button
      type="button"
      className={`metric-card metric-card--button admin-inline-metric admin-inline-metric--${card.tone}`}
      onClick={() => (window.location.hash = card.action_hash)}
    >
      <div className="metric-card__label">{card.label}</div>
      <strong className="metric-card__value">{card.count}</strong>
      <div className="muted">{card.detail}</div>
    </button>
  );
}

function SectionItemCard({ item }: { item: AdminWorkspaceItem }) {
  return (
    <OperationalPreviewCard
      eyebrow="Admin Follow-Through"
      title={item.title}
      summary={item.summary}
      statusLabel={item.status_label}
      statusTone={item.tone}
      density="compact"
      nextAction="Open owning admin surface"
      onClick={() => {
        window.location.hash = item.action_hash;
      }}
    />
  );
}

function getFocusedSection(routeId: string): SectionKey | null {
  switch (routeId) {
    case "admin-roles":
      return "roles_access";
    case "admin-integrations":
    case "admin":
      return null;
    case "admin-automations":
      return "automations";
    case "admin-settings":
    case "admin-reference-data":
    case "admin-system":
      return "settings_reference";
    case "admin-audit":
      return "audit_security";
    case "admin-review-tools":
      return "review_tools";
    default:
      return null;
  }
}

function shouldOpenSection(key: SectionKey, focusedSection: SectionKey | null, index: number) {
  if (focusedSection) {
    return key === focusedSection;
  }
  return index < 2;
}

function formatRefreshTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "just now";
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
