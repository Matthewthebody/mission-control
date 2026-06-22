import { useEffect, useState } from "react";
import type { HomeRole } from "./homeRoles";
import { buildCompanyCommandCards, type CompanyCommandCard } from "./homeDemoData";
import { canSeeLeadershipReports } from "./homePermissions";
import { CompanyNeedsAttention } from "./CompanyNeedsAttention";
import { OperatingAreaPulse } from "./OperatingAreaPulse";
import { AttendanceRiskPanel } from "./AttendanceRiskPanel";
import { WeatherImpactPanel } from "./WeatherImpactPanel";
import { LeadershipReportsStrip } from "./LeadershipReportsStrip";
import { HomeSectionHeader, navigateToHash } from "./homeShared";
import { resolveActionTarget } from "./actionTargets";
import { getExceptionWorkspace } from "../services/exceptionsApi";
import { getProductionOperations } from "../services/productionOperationsApi";
import { getSharedJobStatusCounts, type SharedJobStatusCounts } from "../services/jobsApi";
import { countUnresolvedUrgentRows } from "./urgentWindow";

// Live count state for the "On Fire" card. We never fall back to a fabricated
// number: loading shows an ellipsis, error / no-session shows a dash.
type LiveCountState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; count: number }
  | { state: "error" };

function useUnresolvedUrgentCount(token?: string): LiveCountState {
  const [state, setState] = useState<LiveCountState>(token ? { state: "loading" } : { state: "idle" });
  useEffect(() => {
    if (!token) {
      setState({ state: "idle" });
      return;
    }
    let cancelled = false;
    setState({ state: "loading" });
    getExceptionWorkspace(token)
      .then((workspace) => {
        if (!cancelled) setState({ state: "ready", count: countUnresolvedUrgentRows(workspace.items, Date.now()) });
      })
      .catch(() => {
        if (!cancelled) setState({ state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);
  return state;
}

// Production Load uses the SAME canonical Production predicate as #production/operations: the
// read model's "blocked" metric. The count therefore equals the Production view's filtered total.
// Error/no-session → no fabricated number (never a demo fallback).
function useProductionBlockedCount(token?: string): LiveCountState {
  const [state, setState] = useState<LiveCountState>(token ? { state: "loading" } : { state: "idle" });
  useEffect(() => {
    if (!token) {
      setState({ state: "idle" });
      return;
    }
    let cancelled = false;
    setState({ state: "loading" });
    getProductionOperations(token, { limit: 1 })
      .then((payload) => {
        if (cancelled) return;
        const blocked = payload.metrics.find((m) => m.key === "blocked");
        if (blocked && blocked.available && blocked.count != null) setState({ state: "ready", count: blocked.count });
        else setState({ state: "error" });
      })
      .catch(() => {
        if (!cancelled) setState({ state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);
  return state;
}

function liveValue(state: LiveCountState): string {
  if (state.state === "ready") return String(state.count);
  if (state.state === "loading") return "…";
  return "—"; // idle / error — never a fabricated operational number
}

function liveHelper(state: LiveCountState, fallback: string): string {
  if (state.state === "ready") {
    return `${state.count} unresolved urgent ${state.count === 1 ? "issue" : "issues"} — open to act.`;
  }
  if (state.state === "loading") return "Loading live urgent count…";
  if (state.state === "error") return "Live count unavailable — open the Urgent Window.";
  return fallback;
}

// Live state for the canonical job-status counts (one fetch, several cards). Same
// honesty discipline: loading → "…", error / no-session → "—", never a fabricated
// number.
type JobCountsState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; counts: SharedJobStatusCounts }
  | { state: "error" };

function useJobStatusCounts(token?: string): JobCountsState {
  const [state, setState] = useState<JobCountsState>(token ? { state: "loading" } : { state: "idle" });
  useEffect(() => {
    if (!token) {
      setState({ state: "idle" });
      return;
    }
    let cancelled = false;
    setState({ state: "loading" });
    getSharedJobStatusCounts(token)
      .then((response) => {
        if (!cancelled) setState({ state: "ready", counts: response.counts });
      })
      .catch(() => {
        if (!cancelled) setState({ state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);
  return state;
}

// Project a single canonical count onto the shared LiveCountState the cards render.
function pickJobCount(state: JobCountsState, key: keyof SharedJobStatusCounts): LiveCountState {
  if (state.state === "ready") return { state: "ready", count: state.counts[key] };
  if (state.state === "loading") return { state: "loading" };
  if (state.state === "error") return { state: "error" };
  return { state: "idle" };
}

function jobsBehindHelper(state: LiveCountState, fallback: string): string {
  if (state.state === "ready") {
    return state.count === 0
      ? "No jobs behind on readiness right now."
      : `${state.count} job${state.count === 1 ? "" : "s"} behind on readiness — open to act.`;
  }
  if (state.state === "loading") return "Loading live job status…";
  if (state.state === "error") return "Live count unavailable — open Jobs.";
  return fallback;
}

function productionLoadHelper(state: LiveCountState, fallback: string): string {
  if (state.state === "ready") {
    return state.count === 0
      ? "No jobs blocked in production right now."
      : `${state.count} job${state.count === 1 ? "" : "s"} blocked in production — open to clear.`;
  }
  if (state.state === "loading") return "Loading live production load…";
  if (state.state === "error") return "Live count unavailable — open the Production queue.";
  return fallback;
}

function CommandCard({ card, live }: { card: CompanyCommandCard; live?: { state: LiveCountState; helper: string } }) {
  const resolved = resolveActionTarget(card.target);
  // Not connected: a clearly disabled state with the reason and NO operational
  // count — an unavailable source must never display a number.
  if (!resolved.available) {
    return (
      <div
        className={`home-command-card home-command-card--${card.tone} home-command-card--disabled`}
        aria-disabled="true"
      >
        <span className="home-command-card__label">{card.label}</span>
        <span className="home-command-card__badge home-command-card__badge--off">Not connected</span>
        <span className="home-command-card__helper">{resolved.reason}</span>
      </div>
    );
  }
  const isLive = card.dataSource === "live";
  const value = isLive ? liveValue(live?.state ?? { state: "idle" }) : card.value;
  const helper = isLive ? (live?.helper ?? card.helper) : card.helper;
  return (
    <button
      type="button"
      className={`home-command-card home-command-card--${card.tone}`}
      onClick={() => navigateToHash(resolved.hash)}
    >
      <span className="home-command-card__label">{card.label}</span>
      {card.dataSource === "sample" ? (
        <span className="home-command-card__badge home-command-card__badge--sample">Sample</span>
      ) : null}
      <strong className="home-command-card__value">{value}</strong>
      <span className="home-command-card__helper">{helper}</span>
      <span className="home-command-card__drill">
        {card.drilldownLabel}
        <span aria-hidden="true"> →</span>
      </span>
    </button>
  );
}

export function CompanyCommandHome({ role, token }: { role: HomeRole; token?: string }) {
  const cards = buildCompanyCommandCards();
  const unresolvedUrgent = useUnresolvedUrgentCount(token);
  const jobCounts = useJobStatusCounts(token);
  const jobsBehind = pickJobCount(jobCounts, "behind");
  // Production Load is sourced from the canonical Production read model (same predicate as the
  // #production/operations "blocked" metric), so the card count === the Production view's total.
  const productionLoad = useProductionBlockedCount(token);
  return (
    <>
      <section className="panel home-command__toprow" aria-label="Company command top row">
        <HomeSectionHeader
          title="Today across the company"
          help="What is happening today, and what could hurt us today. Every card is a drilldown."
        />
        <div className="home-command__cards">
          {cards.map((card) => {
            let live: { state: LiveCountState; helper: string } | undefined;
            if (card.id === "on-fire") {
              live = { state: unresolvedUrgent, helper: liveHelper(unresolvedUrgent, card.helper) };
            } else if (card.id === "jobs-behind") {
              live = { state: jobsBehind, helper: jobsBehindHelper(jobsBehind, card.helper) };
            } else if (card.id === "production-load") {
              live = { state: productionLoad, helper: productionLoadHelper(productionLoad, card.helper) };
            }
            return <CommandCard key={card.id} card={card} live={live} />;
          })}
        </div>
      </section>

      <section className="panel home-command__workflow" aria-label="Workflow command">
        <HomeSectionHeader
          title="Workflow Command"
          help="Leadership entry point for workflow oversight and demos. Open the builder to review or clone a workflow, or test how a job moves through statuses — no need to hunt through Admin."
        />
        <div className="home-command__cards">
          <button
            type="button"
            className="home-command-card home-command-card--info"
            onClick={() => navigateToHash("#project-tracking/workflow-templates")}
          >
            <span className="home-command-card__label">Workflow Builder & Templates</span>
            <strong className="home-command-card__value">Review or clone a workflow</strong>
            <span className="home-command-card__helper">Open the leadership workflow builder — milestones, controlled steps, owners, and SLAs.</span>
            <span className="home-command-card__drill">
              Open Workflow Command
              <span aria-hidden="true"> →</span>
            </span>
          </button>
          <button
            type="button"
            className="home-command-card home-command-card--info"
            onClick={() => navigateToHash("#project-tracking")}
          >
            <span className="home-command-card__label">Test a Job Workflow</span>
            <strong className="home-command-card__value">Move a job through statuses</strong>
            <span className="home-command-card__helper">Open Production Tracker to work a job from Ready through Working, Waiting, Review, Delivery, and Done.</span>
            <span className="home-command-card__drill">
              Open Production Tracker
              <span aria-hidden="true"> →</span>
            </span>
          </button>
        </div>
      </section>

      <CompanyNeedsAttention emphasizedArea={role.emphasizedArea} />
      <OperatingAreaPulse emphasizedArea={role.emphasizedArea} />
      <AttendanceRiskPanel emphasizedArea={role.emphasizedArea} />
      <WeatherImpactPanel emphasizedArea={role.emphasizedArea} />
      {canSeeLeadershipReports(role) ? <LeadershipReportsStrip /> : null}
    </>
  );
}
